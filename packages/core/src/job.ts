import { createHash, randomUUID } from 'node:crypto'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { access, lstat, readFile, readdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, win32 } from 'node:path'
import { GeneratorError, asGeneratorError } from './errors.js'
import { ALLOW_PLANNED_RECIPE_GENERATION } from './build-policy.js'
import { packageManager, packageManagerConfiguration } from './catalog.js'
import { writeBackendStarter } from './backend-starter.js'
import { runDoctor } from './doctor.js'
import { createPlan } from './plan.js'
import { writeProjectDocs, writeProjectManifest } from './project-docs.js'
import { runNodeProcess, startNodeProcess, type ProcessResult, type SafeProcessOptions } from './runner.js'
import { bindOwnedStageProjectIdentity, createOwnedStage, cleanupOwnedStage, cleanupStageSupportFiles, markOwnedStageGenerating, mutateOwnedStage, moveDirectoryNoReplace, verifyOwnedStageProjectIdentity, type OwnedStage } from './staging.js'
import { resolveNpmTool, supportsNpm } from './toolchain.js'
import { assertGenerationAllowed } from './native-supervisor.js'
import { resolveSelection } from './resolver.js'
import { installFormaTemplate, type FormaInstallEvidence } from './forma.js'
import type { DoctorReport, JobEventV1, JobStatus, PackageManagerManifestV1, ProjectSelectionV1, RecipeManifestV1, ResolvedSelection, StageId, ValidationOutcome } from './types.js'

export interface GenerateOptions {
  allowPlanned?: boolean
  signal?: AbortSignal
  onEvent?: (event: JobEventV1) => void
}

export interface GenerateResult {
  jobId: string
  status: JobStatus
  targetPath: string
  exitCode: number
  error?: { code: string; stage: string; message: string; nextAction: string; targetModified: boolean }
  logFile?: string
  validations: readonly ValidationOutcome[]
}

interface JobLog {
  readonly file: string
  write(text: string): void
  process(label: string, result: ProcessResult, hiddenPaths: readonly string[]): void
}

const fixedStageOwners: Partial<Record<StageId, string>> = {
  preflight: 'core',
  staging: 'core',
  configuring: 'documentation-adapter',
  finalizing: 'core',
}

function stageOwner(stage: StageId, recipeOwnerId: string, managerId: string, isForma = false): string {
  if (stage === 'scaffolding' && isForma) return 'template.forma'
  if (stage === 'installing') return managerId
  return fixedStageOwners[stage] ?? recipeOwnerId
}

function replacePath(text: string, path: string | undefined): string {
  if (!path) return text
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return text.replace(new RegExp(escaped, 'gi'), '<private-path>')
}

export function redact(text: string, paths: readonly string[] = []): string {
  let clean = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
  for (const path of paths) clean = replacePath(clean, path)
  return clean
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer <redacted>')
    .replace(/\b(?:npm_[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '<redacted>')
    .replace(/\b(token|password|secret|api[_-]?key|authorization)\s*[:=]\s*[^\s"']+/gi, '$1=<redacted>')
    .replace(/(https?:\/\/)[^/@\s:]+:[^/@\s]+@/gi, '$1<redacted>@')
}

function createJobLog(jobId: string): JobLog {
  const directory = mkdtempSync(win32.join(tmpdir(), 'project-generator-job-'))
  const file = win32.join(directory, `${jobId}.log`)
  writeFileSync(file, 'Project Generator redacted process log\n', { flag: 'wx' })
  return {
    file,
    write(text) { appendFileSync(file, `${text}\n`, 'utf8') },
    process(label, result, hiddenPaths) {
      this.write(`[${label}] exit=${result.exitCode}${result.truncated ? ' output-truncated' : ''}`)
      if (result.stdout) this.write(`[${label} stdout]\n${redact(result.stdout, hiddenPaths)}`)
      if (result.stderr) this.write(`[${label} stderr]\n${redact(result.stderr, hiddenPaths)}`)
    },
  }
}

function createEventEmitter(jobId: string, onEvent?: GenerateOptions['onEvent'], log?: JobLog) {
  let sequence = 0
  return (event: Omit<JobEventV1, 'schemaVersion' | 'jobId' | 'sequence' | 'timestamp'>): void => {
    const complete: JobEventV1 = {
      schemaVersion: 1,
      jobId,
      sequence: ++sequence,
      timestamp: new Date().toISOString(),
      ...event,
    }
    log?.write(JSON.stringify(complete))
    onEvent?.(complete)
  }
}

function userError(code: string, stage: StageId, message: string, nextAction: string): GeneratorError {
  return new GeneratorError({ code, stage, message, nextAction, targetModified: false })
}

function preflightError(report: DoctorReport): GeneratorError {
  const node = report.tools.find((tool) => tool.id === 'node')
  const npm = report.tools.find((tool) => tool.id === 'npm')
  if (!node?.available) {
    return userError('GEN_TOOL_UNSUPPORTED', 'preflight', 'Active Node.js version does not satisfy this recipe and selected package manager.', 'Install a supported Node.js version, restart the CLI, and rerun doctor.')
  }
  if (!npm?.available) {
    return userError('GEN_TOOL_MISSING', 'preflight', 'Trusted npm CLI is missing or unsupported beside active Node.js.', 'Install Node.js with npm 10 or newer and rerun doctor.')
  }
  if (!report.target.available) {
    const exists = report.target.message.includes('already exists')
    return userError(exists ? 'GEN_PATH_EXISTS' : 'GEN_PATH_UNSAFE', 'preflight', report.target.message, 'Choose a safe, absent destination under an existing local drive directory.')
  }
  if (!report.platform.startsWith('win32-')) {
    return userError('GEN_PLATFORM_UNSUPPORTED', 'preflight', 'Phase 01 generation is supported on Windows only.', 'Run generation on Windows.')
  }
  return userError('GEN_TOOL_MISSING', 'preflight', 'Required toolchain preflight did not pass.', 'Review doctor output and retry.')
}

function mappedProcessError(stage: StageId, result: ProcessResult): GeneratorError {
  const details: Record<StageId, { code: string; message: string; nextAction: string }> = {
    preflight: { code: 'GEN_TOOL_MISSING', message: 'Toolchain probe failed.', nextAction: 'Rerun doctor and review the local log.' },
    staging: { code: 'GEN_STAGE_CREATE_FAILED', message: 'Could not prepare owned staging.', nextAction: 'Check destination permissions and retry.' },
    scaffolding: { code: 'GEN_SCAFFOLD_FAILED', message: `Pinned official scaffold exited with code ${result.exitCode}.`, nextAction: 'Review the local redacted job log and retry.' },
    configuring: { code: 'GEN_CONFIGURE_FAILED', message: 'Could not write declared project documentation.', nextAction: 'Review the local redacted job log and retry.' },
    installing: { code: 'GEN_INSTALL_FAILED', message: `Selected package-manager install exited with code ${result.exitCode}.`, nextAction: 'Check npm registry/network access and review the local redacted job log.' },
    validating: { code: 'GEN_VALIDATE_FAILED', message: `Required project check exited with code ${result.exitCode}.`, nextAction: 'Review the local redacted job log and fix the reported check before retrying.' },
    finalizing: { code: 'GEN_FINALIZE_FAILED', message: 'Could not finalize the validated project.', nextAction: 'Review the local redacted job log and retry at a new destination.' },
  }
  const detail = details[stage]
  return userError(detail.code, stage, detail.message, detail.nextAction)
}

function throwIfCancelled(signal: AbortSignal | undefined, stage: StageId): void {
  if (signal?.aborted) throw userError('GEN_CANCELLED', stage, 'Generation was cancelled.', 'Retry from the beginning at a new destination.')
}

async function prepareDirectories(stage: OwnedStage): Promise<{ tools: string; home: string; temp: string; cache: string; userConfig: string; globalConfig: string }> {
  const tools = win32.join(stage.path, '.tools')
  const home = win32.join(stage.path, '.home')
  const temp = win32.join(stage.path, '.tmp')
  const cache = win32.join(stage.path, '.npm-cache')
  const userConfig = win32.join(stage.path, '.npmrc-user')
  const globalConfig = win32.join(stage.path, '.npmrc-global')
  await mutateOwnedStage(stage, [
    '.tools',
    '.home/AppData/Roaming',
    '.home/AppData/Local',
    '.tmp',
    '.npm-cache',
  ], [
    { path: '.npmrc-user', content: 'registry=https://registry.npmjs.org/\n' },
    { path: '.npmrc-global', content: 'registry=https://registry.npmjs.org/\n' },
  ])
  return { tools, home, temp, cache, userConfig, globalConfig }
}

function npmArguments(userConfig: string, globalConfig: string, cache: string, commandArgs: readonly string[]): string[] {
  return [
    '--userconfig', userConfig,
    '--globalconfig', globalConfig,
    '--registry', 'https://registry.npmjs.org/',
    '--cache', cache,
    '--no-audit',
    '--no-fund',
    ...commandArgs,
  ]
}

function processOptions(
  npmCliPath: string,
  npmRoot: string,
  cwd: string,
  stage: OwnedStage,
  dirs: { home: string; temp: string },
  args: readonly string[],
  signal?: AbortSignal,
  environment?: Readonly<Record<string, string>>,
): SafeProcessOptions {
  return {
    scriptPath: npmCliPath,
    allowedScriptRoot: npmRoot,
    cwd,
    allowedCwdRoot: stage.path,
    args,
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    ...(signal ? { signal } : {}),
    ...(environment ? { environment } : {}),
    timeoutMs: 10 * 60 * 1000,
  }
}

async function runNpm(
  commandArgs: readonly string[],
  cwd: string,
  stage: OwnedStage,
  npmCliPath: string,
  npmRoot: string,
  dirs: { home: string; temp: string; userConfig: string; globalConfig: string; cache: string },
  log: JobLog,
  label: string,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  const result = await runNodeProcess(processOptions(
    npmCliPath,
    npmRoot,
    cwd,
    stage,
    dirs,
    npmArguments(dirs.userConfig, dirs.globalConfig, dirs.cache, commandArgs),
    signal,
  ))
  log.process(label, result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, tmpdir()])
  return result
}

async function checkPackagePin(tools: string, pin: { packageName: string; version: string; integrity: string; binPath: string }, label: string): Promise<string> {
  const lockPath = win32.join(tools, 'package-lock.json')
  try {
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { packages?: Record<string, { version?: string; integrity?: string }> }
    const installed = lock.packages?.[`node_modules/${pin.packageName}`]
    if (!installed || installed.version !== pin.version || installed.integrity !== pin.integrity) throw new Error('Pinned package lock entry does not match expected metadata.')
    const packagePath = win32.join(tools, 'node_modules', pin.packageName)
    const packageJson = JSON.parse(await readFile(win32.join(packagePath, 'package.json'), 'utf8')) as { name?: string; version?: string }
    if (packageJson.name !== pin.packageName || packageJson.version !== pin.version) throw new Error('Installed package metadata does not match the pin.')
    const binPath = win32.join(packagePath, pin.binPath)
    await access(binPath)
    return binPath
  } catch {
    throw userError(label === 'package-manager' ? 'GEN_PACKAGE_MANAGER_INTEGRITY' : 'GEN_SCAFFOLD_INTEGRITY', 'scaffolding', `Pinned ${label} version or npm integrity did not match the reviewed catalog.`, 'Check npm registry integrity and retry; no target project was committed.')
  }
}

async function writeToolPackage(stage: OwnedStage, dependencies: Record<string, string>): Promise<void> {
  await mutateOwnedStage(stage, [], [{
    path: '.tools/package.json',
    content: JSON.stringify({ name: 'project-generator-staging-tools', private: true, version: '0.0.0', dependencies }, null, 2),
  }])
}

async function readScaffoldFile(stage: OwnedStage, path: string): Promise<string> {
  try {
    return await readFile(win32.join(stage.childPath, path), 'utf8')
  } catch {
    throw userError('GEN_CONFIGURE_FAILED', 'configuring', 'Pinned styling integration did not find an expected official scaffold file.', 'Review the local redacted job log and retry with the pinned official scaffold.')
  }
}

function replaceScaffoldText(source: string, expected: string, replacement: string): string {
  const first = source.indexOf(expected)
  if (first < 0 || source.indexOf(expected, first + expected.length) >= 0) {
    throw userError('GEN_CONFIGURE_FAILED', 'configuring', 'Pinned styling integration found an unexpected official scaffold layout.', 'Review the local redacted job log and retry with the pinned official scaffold.')
  }
  return `${source.slice(0, first)}${replacement}${source.slice(first + expected.length)}`
}

async function configureRecipeDependencies(stage: OwnedStage, resolved: ResolvedSelection): Promise<string[]> {
  const pins = resolved.recipe.dependencies ?? []
  if (pins.length === 0 && resolved.recipe.manager === 'npm') return []
  const manager = packageManager(resolved.recipe.manager)
  const bootstrap = resolved.recipe.styling === 'styling.bootstrap'
  const frameworkPins = resolved.recipe.frontend === 'frontend.nuxt' || resolved.recipe.frontend === 'frontend.angular'
  const backend = resolved.recipe.projectType === 'backend'
  const viteScss = resolved.recipe.styling === 'styling.scss'
    && (resolved.recipe.frontend === 'frontend.react-vite' || resolved.recipe.frontend === 'frontend.vue-vite')
  const viteTailwind = resolved.recipe.styling === 'styling.tailwind'
    && (resolved.recipe.frontend === 'frontend.react-vite' || resolved.recipe.frontend === 'frontend.vue-vite')
  const expectedPins = backend ? ['express', '@types/express', '@types/node', 'tsx', 'typescript']
    : bootstrap ? ['bootstrap']
    : resolved.recipe.frontend === 'frontend.nuxt' ? ['nuxt', 'typescript', 'vue-tsc']
      : resolved.recipe.frontend === 'frontend.angular' ? ['@angular/core', '@angular/cli']
        : viteScss ? ['sass'] : viteTailwind ? ['tailwindcss', '@tailwindcss/vite'] : []
  if (pins.length > 0 && ((!backend && !bootstrap && !frameworkPins && !viteScss && !viteTailwind) || pins.length !== expectedPins.length || pins.some((pin) => !expectedPins.includes(pin.packageName)))) {
    throw userError('GEN_CONFIGURE_FAILED', 'configuring', 'Recipe dependency pin does not match its reviewed framework or styling adapter.', 'Use an exact catalog recipe and retry.')
  }

  const projectName = win32.basename(stage.childPath)
  let packageJson: Record<string, unknown>
  try {
    packageJson = JSON.parse(await readFile(win32.join(stage.childPath, 'package.json'), 'utf8')) as Record<string, unknown>
  } catch {
    throw userError('GEN_CONFIGURE_FAILED', 'configuring', 'Pinned dependency integration could not read the scaffold package manifest.', 'Review the local redacted job log and retry with the pinned official scaffold.')
  }
  if (packageJson.name !== resolved.selection.project.name
    || typeof packageJson.dependencies !== 'object' || packageJson.dependencies === null || Array.isArray(packageJson.dependencies)) {
    throw userError('GEN_CONFIGURE_FAILED', 'configuring', 'Pinned dependency integration found an unexpected scaffold package manifest.', 'Review the local redacted job log and retry with the pinned official scaffold.')
  }
  if (resolved.recipe.manager !== 'npm') packageJson.packageManager = `${manager.id}@${manager.version}`
  const dependencies = packageJson.dependencies as Record<string, unknown>
  let developmentDependencies = typeof packageJson.devDependencies === 'object' && packageJson.devDependencies !== null && !Array.isArray(packageJson.devDependencies)
    ? packageJson.devDependencies as Record<string, unknown>
    : undefined
  for (const pin of pins) {
    const scopes = [dependencies, developmentDependencies].filter((scope): scope is Record<string, unknown> => Boolean(scope && Object.hasOwn(scope, pin.packageName)))
    if (bootstrap) {
      if (scopes.length > 0) throw userError('GEN_CONFIGURE_FAILED', 'configuring', `Pinned styling dependency ${pin.packageName} already exists in the scaffold.`, 'Review the local redacted job log before retrying.')
      dependencies[pin.packageName] = pin.version
    } else if (scopes.length === 0 && pin.scope === 'devDependencies') {
      developmentDependencies ??= {}
      packageJson.devDependencies = developmentDependencies
      developmentDependencies[pin.packageName] = pin.version
    } else {
      if (scopes.length !== 1 || typeof scopes[0]![pin.packageName] !== 'string') {
        throw userError('GEN_CONFIGURE_FAILED', 'configuring', `Pinned framework dependency ${pin.packageName} was not declared exactly once by the scaffold.`, 'Review the scaffold package manifest and retry with the pinned official CLI.')
      }
      if (pin.scope === 'devDependencies' && scopes[0] !== developmentDependencies) {
        delete scopes[0]![pin.packageName]
        developmentDependencies ??= {}
        packageJson.devDependencies = developmentDependencies
        developmentDependencies[pin.packageName] = pin.version
      } else {
        scopes[0]![pin.packageName] = pin.version
      }
    }
  }

  if (resolved.recipe.frontend === 'frontend.nuxt') {
    if (typeof packageJson.scripts !== 'object' || packageJson.scripts === null || Array.isArray(packageJson.scripts)) {
      throw userError('GEN_CONFIGURE_FAILED', 'configuring', 'Pinned Nuxt starter did not provide its expected npm scripts.', 'Review the local redacted job log and retry with the pinned official starter.')
    }
    const scripts = packageJson.scripts as Record<string, unknown>
    if (scripts.typecheck !== undefined) {
      throw userError('GEN_CONFIGURE_FAILED', 'configuring', 'Pinned Nuxt starter already defines a typecheck script.', 'Review the starter package manifest before retrying.')
    }
    scripts.typecheck = 'nuxt typecheck'
  }
  const writes: { path: string; content: string; replace?: boolean }[] = [
    { path: `${projectName}/package.json`, content: `${JSON.stringify(packageJson, null, 2)}\n`, replace: true },
  ]
  const generatedFiles: string[] = []
  if (bootstrap) {
    let html: string
    try {
      html = await readFile(win32.join(stage.childPath, 'index.html'), 'utf8')
    } catch {
      throw userError('GEN_CONFIGURE_FAILED', 'configuring', 'Pinned Bootstrap integration could not read the scaffold HTML entry.', 'Review the local redacted job log and retry with the pinned official scaffold.')
    }
    const closingHead = /<\/head\s*>/gi
    if ((html.match(closingHead) ?? []).length !== 1 || html.includes('project-generator-bootstrap.css')) {
      throw userError('GEN_CONFIGURE_FAILED', 'configuring', 'Pinned Bootstrap integration found an unexpected HTML entry.', 'Review the local redacted job log and retry with the pinned official scaffold.')
    }
    const configuredHtml = html.replace(/<\/head\s*>/i, '  <link rel="stylesheet" href="/src/project-generator-bootstrap.css">\n</head>')
    writes.push(
      { path: `${projectName}/index.html`, content: configuredHtml, replace: true },
      { path: `${projectName}/src/project-generator-bootstrap.css`, content: "@import 'bootstrap/dist/css/bootstrap.min.css';\n" },
      { path: `${projectName}/.npmrc`, content: 'legacy-peer-deps=true\n' },
    )
    generatedFiles.push('src/project-generator-bootstrap.css', '.npmrc')
  }
  if (viteScss) {
    const react = resolved.recipe.frontend === 'frontend.react-vite'
    const appPath = react ? 'src/App.tsx' : 'src/App.vue'
    const mainPath = react ? 'src/main.tsx' : 'src/main.ts'
    const appSource = await readScaffoldFile(stage, appPath)
    const mainSource = await readScaffoldFile(stage, mainPath)
    const app = replaceScaffoldText(appSource, react ? '<section id="center">' : '<main>', react
      ? '<section id="center" className="pg-starter">'
      : '<main class="pg-starter">')
    const main = replaceScaffoldText(mainSource, react ? "import './index.css'\n" : "import './assets/main.css'\n", react
      ? "import './index.css'\nimport './project-generator.scss'\n"
      : "import './assets/main.css'\nimport './project-generator.scss'\n")
    writes.push(
      { path: `${projectName}/${appPath}`, content: app, replace: true },
      { path: `${projectName}/${mainPath}`, content: main, replace: true },
      { path: `${projectName}/src/project-generator.scss`, content: '$starter-accent: #646cff;\n\n.pg-starter {\n  border-top: 4px solid $starter-accent;\n\n  @media (max-width: 48rem) {\n    border-top-width: 3px;\n  }\n}\n' },
    )
    generatedFiles.push('src/project-generator.scss')
  }
  if (viteTailwind) {
    const react = resolved.recipe.frontend === 'frontend.react-vite'
    const appPath = react ? 'src/App.tsx' : 'src/App.vue'
    const mainPath = react ? 'src/main.tsx' : 'src/main.ts'
    let viteConfig = await readScaffoldFile(stage, 'vite.config.ts')
    if (react) {
      viteConfig = replaceScaffoldText(viteConfig, "import react from '@vitejs/plugin-react'\n", "import react from '@vitejs/plugin-react'\nimport tailwindcss from '@tailwindcss/vite'\n")
      viteConfig = replaceScaffoldText(viteConfig, 'plugins: [react()],', 'plugins: [react(), tailwindcss()],')
    } else {
      viteConfig = replaceScaffoldText(viteConfig, "import vueDevTools from 'vite-plugin-vue-devtools'\n", "import vueDevTools from 'vite-plugin-vue-devtools'\nimport tailwindcss from '@tailwindcss/vite'\n")
      viteConfig = replaceScaffoldText(viteConfig, 'plugins: [\n    vue(),\n    vueDevTools(),\n  ],', 'plugins: [\n    vue(),\n    vueDevTools(),\n    tailwindcss(),\n  ],')
    }
    const appSource = await readScaffoldFile(stage, appPath)
    const mainSource = await readScaffoldFile(stage, mainPath)
    const app = replaceScaffoldText(appSource, react ? '<section id="center">' : '<main>', react
      ? '<section id="center" className="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-12">'
      : '<main class="mx-auto flex min-h-screen max-w-5xl flex-col gap-8 px-6 py-12">')
    const main = replaceScaffoldText(mainSource, react ? "import './index.css'\n" : "import './assets/main.css'\n", react
      ? "import './index.css'\nimport './project-generator-tailwind.css'\n"
      : "import './assets/main.css'\nimport './project-generator-tailwind.css'\n")
    writes.push(
      { path: `${projectName}/vite.config.ts`, content: viteConfig, replace: true },
      { path: `${projectName}/${appPath}`, content: app, replace: true },
      { path: `${projectName}/${mainPath}`, content: main, replace: true },
      { path: `${projectName}/src/project-generator-tailwind.css`, content: '@import "tailwindcss";\n' },
    )
    generatedFiles.push('src/project-generator-tailwind.css')
  }
  await mutateOwnedStage(stage, [], writes)
  return generatedFiles
}

async function verifyDependencyPins(projectPath: string, pins: NonNullable<RecipeManifestV1['dependencies']>): Promise<void> {
  if (pins.length === 0) return
  try {
    const lock = JSON.parse(await readFile(win32.join(projectPath, 'package-lock.json'), 'utf8')) as {
      packages?: Record<string, { version?: string; integrity?: string }>
    }
    for (const pin of pins) {
      const installed = lock.packages?.[`node_modules/${pin.packageName}`]
      if (!installed || installed.version !== pin.version || installed.integrity !== pin.integrity) throw new Error('Pinned dependency lock entry did not match.')
    }
    if (pins.some(({ packageName }) => packageName === 'bootstrap') && lock.packages?.['node_modules/@popperjs/core']) {
      throw new Error('CSS-only Bootstrap install unexpectedly resolved Popper.')
    }
  } catch {
    throw userError('GEN_DEPENDENCY_INTEGRITY', 'installing', 'Pinned dependency version or npm integrity did not match the reviewed catalog.', 'Check npm registry integrity and the generated lockfile, then retry; no target project was committed.')
  }
}

async function verifyProjectLockfile(projectPath: string, manager: PackageManagerManifestV1): Promise<string> {
  try {
    const entries = await readdir(projectPath)
    const present = entries.filter((entry) => ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'].includes(entry))
    if (present.length !== 1 || present[0] !== manager.lockfile) throw new Error('Project must contain only the selected package-manager lockfile.')
    const lock = await readFile(win32.join(projectPath, manager.lockfile), 'utf8')
    if (manager.id === 'yarn' && (!lock.includes('__metadata:') || !/^\s+checksum:\s+\S+/m.test(lock))) throw new Error('Yarn lockfile lacks modern metadata or package checksums.')
    if (manager.id === 'pnpm' && (!/^lockfileVersion:/m.test(lock) || !/integrity:\s*['"]?sha512-/m.test(lock))) throw new Error('pnpm lockfile lacks version metadata or package integrity entries.')
    if (manager.id === 'npm') {
      const parsed = JSON.parse(lock) as { lockfileVersion?: number; packages?: Record<string, { version?: string; integrity?: string; resolved?: string; link?: boolean }> }
      if (!parsed.lockfileVersion || !parsed.packages) throw new Error('npm lockfile metadata is missing.')
      for (const [path, entry] of Object.entries(parsed.packages)) {
        if (!path || entry.link) continue
        if (entry.resolved && (!entry.version || !entry.integrity)) throw new Error('npm lockfile contains an unpinned or unchecked registry package.')
      }
    }
    const hash = createHash('sha256').update(lock).digest('hex')
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Lockfile hash could not be computed.')
    return hash
  } catch {
    throw userError('GEN_LOCKFILE_INTEGRITY', 'installing', `Expected exactly one valid ${manager.id} lockfile (${manager.lockfile}).`, 'Check the selected package manager output and retry; no target project was committed.')
  }
}

function npmRootFromCli(cliPath: string): string {
  return dirname(dirname(cliPath))
}

async function runAppScript(
  scriptPath: string,
  args: readonly string[],
  projectPath: string,
  stage: OwnedStage,
  dirs: { home: string; temp: string },
  signal: AbortSignal | undefined,
  log: JobLog,
  label: string,
): Promise<ProcessResult> {
  const result = await runNodeProcess({
    scriptPath,
    allowedScriptRoot: projectPath,
    cwd: projectPath,
    allowedCwdRoot: stage.path,
    args,
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    ...(signal ? { signal } : {}),
    timeoutMs: 10 * 60 * 1000,
  })
  log.process(label, result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, tmpdir()])
  return result
}

async function runPinnedPackageManager(
  manager: PackageManagerManifestV1,
  managerCliPath: string,
  cwd: string,
  stage: OwnedStage,
  dirs: { tools: string; home: string; temp: string },
  log: JobLog,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  const environment = manager.id === 'yarn' ? {
    YARN_ENABLE_SCRIPTS: 'true',
    YARN_ENABLE_IMMUTABLE_INSTALLS: 'false',
    YARN_NODE_LINKER: manager.nodeLinker ?? 'node-modules',
    YARN_NPM_REGISTRY_SERVER: 'https://registry.npmjs.org',
    YARN_ENABLE_TELEMETRY: '0',
  } : {
    pnpm_config_dangerously_allow_all_builds: 'true',
    pnpm_config_registry: 'https://registry.npmjs.org/',
  }
  const args = manager.id === 'yarn'
    ? ['install']
    : ['install', ...(manager.nodeLinker ? [`--node-linker=${manager.nodeLinker}`] : []), '--registry', 'https://registry.npmjs.org/']
  const result = await runNodeProcess({
    scriptPath: managerCliPath,
    allowedScriptRoot: dirs.tools,
    cwd,
    allowedCwdRoot: stage.path,
    args,
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    environment,
    ...(signal ? { signal } : {}),
    timeoutMs: 10 * 60 * 1000,
  })
  log.process(`${manager.id}-project-dependency-install`, result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, tmpdir()])
  return result
}

function checkOutcome(id: string, result: ProcessResult): ValidationOutcome {
  return {
    id,
    status: result.exitCode === 0 ? 'pass' : 'fail',
    message: result.exitCode === 0 ? 'Command completed successfully.' : `Command exited with code ${result.exitCode}.`,
    exitCode: result.exitCode,
  }
}

function emitValidation(emit: ReturnType<typeof createEventEmitter>, outcome: ValidationOutcome, frontendId: string): void {
  const stageStatus = outcome.status === 'pass' ? 'passed' : outcome.status === 'skipped' ? 'skipped' : 'failed'
  emit({ type: 'validation', stageId: 'validating', stageOwner: frontendId, stageStatus, message: `${outcome.id}: ${outcome.message}`, ...(outcome.status === 'fail' ? { code: 'GEN_VALIDATE_FAILED' } : {}) })
}

async function freePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Could not allocate a local smoke-test port.')
  const port = address.port
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()))
  return port
}

async function servedPageSmoke(
  projectPath: string,
  stage: OwnedStage,
  dirs: { home: string; temp: string },
  frontendId: 'frontend.react-vite' | 'frontend.nextjs-app' | 'frontend.vue-vite' | 'frontend.nuxt' | 'frontend.angular',
  signal: AbortSignal | undefined,
  log: JobLog,
): Promise<ValidationOutcome> {
  const port = await freePort()
  const vite = frontendId === 'frontend.react-vite' || frontendId === 'frontend.vue-vite'
  const cliPath = vite
    ? win32.join(projectPath, 'node_modules', 'vite', 'bin', 'vite.js')
    : frontendId === 'frontend.nextjs-app' ? win32.join(projectPath, 'node_modules', 'next', 'dist', 'bin', 'next')
      : frontendId === 'frontend.nuxt' ? win32.join(projectPath, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs')
        : win32.join(projectPath, 'node_modules', '@angular', 'cli', 'bin', 'ng.js')
  const args = vite
      ? ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
      : frontendId === 'frontend.nextjs-app' ? ['start', '--hostname', '127.0.0.1', '--port', String(port)]
        : frontendId === 'frontend.nuxt' ? ['preview', '--host', '127.0.0.1', '--port', String(port)]
        : ['serve', '--host', '127.0.0.1', '--port', String(port)]
  const running = await startNodeProcess({
    scriptPath: cliPath,
    allowedScriptRoot: projectPath,
    cwd: projectPath,
    allowedCwdRoot: stage.path,
    args,
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    ...(signal ? { signal } : {}),
  })
  let outcome: ValidationOutcome | undefined
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      throwIfCancelled(signal, 'validating')
      try {
        const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(800) })
        const body = await response.text()
        if (response.status === 200 && response.headers.get('content-type')?.includes('text/html') && /<html[\s>]/i.test(body)) {
          outcome = { id: 'http-smoke', status: 'pass', message: 'Local server returned an HTML page.', exitCode: 0 }
          break
        }
      } catch {
        // Keep probing until bounded smoke-test timeout; no error body is shown to users.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    }
  } finally {
    await running.stop()
    const result = await running.result.catch(() => undefined)
    if (result) log.process('http-smoke-server', result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, tmpdir()])
  }
  if (!outcome) throw userError('GEN_VALIDATE_FAILED', 'validating', 'Local server did not return an HTTP-served HTML page within 15 seconds.', 'Review the local redacted job log and retry.')
  return outcome
}

async function servedBackendSmoke(
  projectPath: string,
  stage: OwnedStage,
  dirs: { home: string; temp: string },
  signal: AbortSignal | undefined,
  log: JobLog,
): Promise<ValidationOutcome> {
  const port = await freePort()
  const running = await startNodeProcess({
    scriptPath: win32.join(projectPath, 'dist', 'server.js'),
    allowedScriptRoot: projectPath,
    cwd: projectPath,
    allowedCwdRoot: stage.path,
    args: [],
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    environment: { HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'test' },
    ...(signal ? { signal } : {}),
  })
  let outcome: ValidationOutcome | undefined
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      throwIfCancelled(signal, 'validating')
      try {
        const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) })
        const healthBody = await health.json() as { status?: string }
        const info = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(800) })
        const infoBody = await info.json() as { name?: string; version?: string; environment?: string }
        if (health.status === 200 && healthBody.status === 'ok' && info.status === 200
          && infoBody.name === 'BE-01 Express API' && infoBody.version === '0.1.0' && infoBody.environment === 'test') {
          outcome = { id: 'http-smoke', status: 'pass', message: 'Built API returned valid JSON from /health and /api/info.', exitCode: 0 }
          break
        }
      } catch {
        // Keep probing until bounded smoke-test timeout; no response body is surfaced.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    }
  } finally {
    await running.stop()
    const result = await running.result.catch(() => undefined)
    if (result) log.process('http-smoke-server', result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, tmpdir()])
  }
  if (!outcome) throw userError('GEN_VALIDATE_FAILED', 'validating', 'Built API did not return valid JSON from /health and /api/info within 15 seconds.', 'Review the local redacted job log and retry.')
  return outcome
}

async function verifyGeneratedStyling(projectPath: string, recipe: RecipeManifestV1): Promise<ValidationOutcome | undefined> {
  const viteScss = recipe.styling === 'styling.scss'
    && (recipe.frontend === 'frontend.react-vite' || recipe.frontend === 'frontend.vue-vite')
  const viteTailwind = recipe.styling === 'styling.tailwind'
    && (recipe.frontend === 'frontend.react-vite' || recipe.frontend === 'frontend.vue-vite')
  if (!viteScss && !viteTailwind) return undefined
  let css = ''
  try {
    const assetsPath = win32.join(projectPath, 'dist', 'assets')
    const assets = await readdir(assetsPath)
    const cssFiles = assets.filter((file) => file.endsWith('.css'))
    if (cssFiles.length === 0) throw new Error('No CSS asset was emitted.')
    css = (await Promise.all(cssFiles.map((file) => readFile(win32.join(assetsPath, file), 'utf8')))).join('\n')
  } catch {
    throw userError('GEN_VALIDATE_FAILED', 'validating', 'Production build did not emit the selected styling output.', 'Review the local redacted job log and check the generated stylesheet import and Vite configuration.')
  }
  const requiredOutput = viteScss ? ['.pg-starter'] : ['.min-h-screen', '.max-w-5xl']
  if (requiredOutput.some((token) => !css.includes(token))) {
    throw userError('GEN_VALIDATE_FAILED', 'validating', 'Production CSS is missing the selected SCSS rule or Tailwind utilities.', 'Review the generated source imports, utility class names, and Vite styling integration.')
  }
  return {
    id: 'styling-output',
    status: 'pass',
    message: viteScss ? 'Generated SCSS selector is present in production CSS.' : 'Generated Tailwind utility classes are present in production CSS.',
    exitCode: 0,
  }
}

async function executeScaffold(
  stage: OwnedStage,
  resolved: ResolvedSelection,
  npmCliPath: string,
  dirs: { tools: string; home: string; temp: string; cache: string; userConfig: string; globalConfig: string },
  log: JobLog,
  signal?: AbortSignal,
): Promise<{ managerCliPath?: string }> {
  const scaffoldPin = resolved.recipe.scaffold
  if (!scaffoldPin) throw userError('GEN_SCAFFOLD_FAILED', 'scaffolding', 'Recipe has no external scaffold pin.', 'Use the reviewed built-in backend starter or a valid catalog recipe.')
  const npmRoot = npmRootFromCli(npmCliPath)
  const manager = packageManager(resolved.recipe.manager)
  const toolDependencies = {
    [scaffoldPin.packageName]: scaffoldPin.version,
    ...(manager.packageName ? { [manager.packageName]: manager.version } : {}),
  }
  await writeToolPackage(stage, toolDependencies)
  const scaffoldInstall = await runNpm([
    'install', '--prefix', dirs.tools, '--package-lock=true', '--ignore-scripts',
    ...Object.entries(toolDependencies).map(([name, version]) => `${name}@${version}`),
  ], stage.path, stage, npmCliPath, npmRoot, dirs, log, 'scaffold-package-install', signal)
  if (scaffoldInstall.exitCode !== 0) throw mappedProcessError('scaffolding', scaffoldInstall)
  const scaffoldBin = await checkPackagePin(dirs.tools, scaffoldPin, 'scaffold')
  const managerCliPath = manager.packageName && manager.integrity && manager.binPath
    ? await checkPackagePin(dirs.tools, { packageName: manager.packageName, version: manager.version, integrity: manager.integrity, binPath: manager.binPath }, 'package-manager')
    : undefined
  const scaffold = await runNodeProcess({
    scriptPath: scaffoldBin,
    allowedScriptRoot: dirs.tools,
    cwd: stage.path,
    allowedCwdRoot: stage.path,
    args: scaffoldPin.packageName === '@angular/cli'
      ? ['new', resolved.selection.project.name, ...(resolved.recipe.scaffoldArgs ?? [])]
      : [resolved.selection.project.name, ...(resolved.recipe.scaffoldArgs ?? [])],
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    ...(signal ? { signal } : {}),
    timeoutMs: 5 * 60 * 1000,
  })
  log.process('pinned-official-scaffold', scaffold, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, tmpdir()])
  if (scaffold.exitCode !== 0) throw mappedProcessError('scaffolding', scaffold)
  return managerCliPath ? { managerCliPath } : {}
}

async function generateInJob(selection: ProjectSelectionV1, options: GenerateOptions, emit: ReturnType<typeof createEventEmitter>, log: JobLog, jobId: string): Promise<GenerateResult> {
  let stage: OwnedStage | undefined
  let committed = false
  let currentStage: StageId = 'preflight'
  const validations: ValidationOutcome[] = []
  const resolved = resolveSelection(selection)
  const isForma = Boolean(selection.template)
  const recipeOwnerId = resolved.recipe.backend ?? resolved.recipe.frontend ?? 'core'
  const eventOwner = (id: StageId): string => stageOwner(id, recipeOwnerId, resolved.recipe.manager, isForma)
  const stageStart = (id: StageId): void => { currentStage = id; emit({ type: 'stage-started', stageId: id, stageOwner: eventOwner(id), stageStatus: 'running', message: `${id} started.` }) }
  const stageFinish = (id: StageId, status: 'passed' | 'failed' | 'skipped', message = `${id} completed.`): void => { emit({ type: 'stage-finished', stageId: id, stageOwner: eventOwner(id), stageStatus: status, message }) }
  let formaEvidence: FormaInstallEvidence | undefined

  emit({ type: 'job-started', stageOwner: 'core', status: 'running', message: `Generation job ${jobId} started.` })
  emit({ type: 'warning', stageOwner: 'core', code: 'GEN_LIFECYCLE_SCRIPTS', message: `${resolved.recipe.manager} install can execute third-party lifecycle scripts; execution is not sandboxed.` })
  try {
    stageStart('preflight')
    throwIfCancelled(options.signal, currentStage)
    if (resolved.recipe.status !== 'tested' && !(ALLOW_PLANNED_RECIPE_GENERATION && options.allowPlanned && resolved.recipe.status === 'planned')) {
      throw userError('GEN_RECIPE_UNTESTED', 'preflight', `${resolved.recipe.id} is planned and disabled for normal generation.`, 'Use a tested recipe; development-only runs do not change recipe status.')
    }
    await assertGenerationAllowed()
    throwIfCancelled(options.signal, currentStage)
    const doctor = await runDoctor(selection)
    if (!doctor.ready) throw preflightError(doctor)
    const npmTool = await resolveNpmTool()
    if (!npmTool || !supportsNpm(npmTool.version)) throw userError('GEN_TOOL_MISSING', 'preflight', 'Trusted npm CLI is missing or unsupported.', 'Install Node.js with npm 10 or newer and rerun doctor.')
    stageFinish('preflight', 'passed')

    stageStart('staging')
    throwIfCancelled(options.signal, currentStage)
    const target = doctor.target
    stage = await createOwnedStage(win32.dirname(target.path), target.path, selection.project.name, jobId)
    await markOwnedStageGenerating(stage)
    const dirs = await prepareDirectories(stage)
    stageFinish('staging', 'passed')

    stageStart('scaffolding')
    throwIfCancelled(options.signal, currentStage)
    let managerCliPath: string | undefined
    let starterFiles: string[] = []
    if (selection.template) {
      formaEvidence = await installFormaTemplate(stage, selection.template, resolved.recipe.frontend!, selection.project.name, dirs, log, options.signal)
    } else if (resolved.recipe.projectType === 'backend') {
      starterFiles = await writeBackendStarter(stage, selection.project.name, resolved.recipe.dependencies ?? [])
    } else {
      ({ managerCliPath } = await executeScaffold(stage, resolved, npmTool.cliPath, dirs, log, options.signal))
      if (resolved.recipe.manager !== 'npm') {
        const integrity: ValidationOutcome = { id: 'package-manager-integrity', status: 'pass', message: `Pinned ${resolved.recipe.manager} ${packageManager(resolved.recipe.manager).version} package version and npm integrity verified.`, exitCode: 0 }
        validations.push(integrity)
        emitValidation(emit, integrity, resolved.recipe.manager)
      }
    }
    const projectPath = stage.childPath
    await bindOwnedStageProjectIdentity(stage, selection.project.name)
    await verifyOwnedStageProjectIdentity(stage, selection.project.name)
    const identityOutcome: ValidationOutcome = { id: 'scaffold-identity', status: 'pass', message: 'Generated package identity matches the requested name.' }
    validations.push(identityOutcome)
    emit({ type: 'validation', stageId: 'scaffolding', stageOwner: eventOwner('scaffolding'), stageStatus: 'passed', message: identityOutcome.message })
    stageFinish('scaffolding', 'passed')

    stageStart('configuring')
    throwIfCancelled(options.signal, currentStage)
    try {
      await lstat(win32.join(projectPath, '.npmrc'))
      throw userError('GEN_PATH_UNSAFE', 'configuring', 'Scaffold produced a project .npmrc; refusing to read untrusted registry or credential configuration.', 'Inspect the scaffold output and retry with the pinned official scaffold.')
    } catch (error) {
      if (error instanceof GeneratorError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const generatedFiles = [...starterFiles, ...await configureRecipeDependencies(stage, resolved)]
    const managerConfig = packageManagerConfiguration(resolved.recipe.manager)
    if (managerConfig) {
      const projectPrefix = `${win32.basename(projectPath)}/`
      const written = await mutateOwnedStage(stage, [], [{ ...managerConfig, path: `${projectPrefix}${managerConfig.path}` }])
      generatedFiles.push(...written.map((path) => path.slice(projectPrefix.length)))
    }
    generatedFiles.push(...await writeProjectDocs(stage, resolved, process.version.replace(/^v/, ''), npmTool, formaEvidence))
    if (formaEvidence) generatedFiles.push('FORMA-INSTALL.md', 'INSTALL.md', 'forma.install.json', 'forma-install-report.json')
    stageFinish('configuring', 'passed')

    stageStart('installing')
    throwIfCancelled(options.signal, currentStage)
    // ponytail: clean Angular 21 scaffold crashes npm 10.9.8 Arborist; remove when ordinary install passes on pinned toolchain.
    const legacyPeerHandling = resolved.recipe.styling === 'styling.bootstrap' || resolved.recipe.frontend === 'frontend.angular'
    const manager = packageManager(resolved.recipe.manager)
    const install = manager.id === 'npm'
      ? await runNpm(['install', ...(legacyPeerHandling ? ['--legacy-peer-deps'] : []), '--package-lock=true'], projectPath, stage, npmTool.cliPath, npmRootFromCli(npmTool.cliPath), dirs, log, 'project-dependency-install', options.signal)
      : managerCliPath
        ? await runPinnedPackageManager(manager, managerCliPath, projectPath, stage, dirs, log, options.signal)
        : (() => { throw userError('GEN_PACKAGE_MANAGER_INTEGRITY', 'installing', `Pinned ${manager.id} executable was not staged.`, 'Retry with the verified catalog package-manager pin.') })()
    validations.push(checkOutcome('dependency-install', install))
    if (install.exitCode !== 0) throw mappedProcessError('installing', install)
    await verifyDependencyPins(projectPath, resolved.recipe.dependencies ?? [])
    if (resolved.recipe.dependencies?.length) {
      const integrity: ValidationOutcome = { id: 'dependency-integrity', status: 'pass', message: 'Pinned project dependency versions and npm integrity match the reviewed catalog.', exitCode: 0 }
      validations.push(integrity)
      emitValidation(emit, integrity, recipeOwnerId)
    }
    const lockHash = await verifyProjectLockfile(projectPath, manager)
    const lockIntegrity: ValidationOutcome = {
      id: 'lockfile-integrity',
      status: 'pass',
      message: `Exactly one ${manager.lockfile} is present with ${manager.id} integrity metadata (SHA-256 ${lockHash}).`,
      exitCode: 0,
    }
    validations.push(lockIntegrity)
    emitValidation(emit, lockIntegrity, resolved.recipe.manager)
    emit({ type: 'validation', stageId: 'installing', stageOwner: resolved.recipe.manager, stageStatus: 'passed', message: `${resolved.recipe.manager} dependency install passed after lifecycle-script consent.` })
    stageFinish('installing', 'passed')

    stageStart('validating')
    throwIfCancelled(options.signal, currentStage)
    const checks: { id: string; path: string; args: string[] }[] = resolved.recipe.projectType === 'backend'
      ? [
        { id: 'typecheck', path: win32.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc'), args: ['--project', 'tsconfig.json', '--noEmit'] },
        { id: 'unit-tests', path: win32.join(projectPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), args: ['--test', 'test/backend.test.ts'] },
        { id: 'graceful-shutdown', path: win32.join(projectPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), args: ['--test', 'test/shutdown.test.ts'] },
        { id: 'build', path: win32.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc'), args: ['--project', 'tsconfig.json'] },
      ]
      : selection.template
      ? [
        { id: 'typecheck', path: win32.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc'), args: ['--noEmit'] },
        ...(resolved.recipe.frontend === 'frontend.react-vite'
          ? [{ id: 'build', path: win32.join(projectPath, 'node_modules', 'vite', 'bin', 'vite.js'), args: ['build'] }]
          : [{ id: 'build', path: win32.join(projectPath, 'node_modules', 'next', 'dist', 'bin', 'next'), args: ['build'] }]),
      ]
      : resolved.recipe.frontend === 'frontend.nuxt'
      ? [
        { id: 'typecheck', path: win32.join(projectPath, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs'), args: ['typecheck'] },
        { id: 'build', path: win32.join(projectPath, 'node_modules', 'nuxt', 'bin', 'nuxt.mjs'), args: ['build'] },
      ]
      : resolved.recipe.frontend === 'frontend.angular'
      ? [
        { id: 'build', path: win32.join(projectPath, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'), args: ['build'] },
        { id: 'unit-tests', path: win32.join(projectPath, 'node_modules', '@angular', 'cli', 'bin', 'ng.js'), args: ['test', '--watch=false'] },
      ]
      : resolved.recipe.frontend === 'frontend.vue-vite'
      ? [
        { id: 'lint', path: win32.join(projectPath, 'node_modules', 'eslint', 'bin', 'eslint.js'), args: ['.'] },
        { id: 'typecheck', path: win32.join(projectPath, 'node_modules', 'vue-tsc', 'bin', 'vue-tsc.js'), args: ['--build'] },
        { id: 'build', path: win32.join(projectPath, 'node_modules', 'vite', 'bin', 'vite.js'), args: ['build'] },
      ]
      : resolved.recipe.frontend === 'frontend.react-vite'
      ? [
        { id: 'lint', path: win32.join(projectPath, 'node_modules', 'eslint', 'bin', 'eslint.js'), args: ['.'] },
        { id: 'typecheck', path: win32.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc'), args: ['-b'] },
        { id: 'build', path: win32.join(projectPath, 'node_modules', 'vite', 'bin', 'vite.js'), args: ['build'] },
      ]
      : [
        { id: 'lint', path: win32.join(projectPath, 'node_modules', 'eslint', 'bin', 'eslint.js'), args: ['.'] },
        { id: 'build-and-typecheck', path: win32.join(projectPath, 'node_modules', 'next', 'dist', 'bin', 'next'), args: ['build'] },
      ]
    for (const check of checks) {
      throwIfCancelled(options.signal, currentStage)
      const result = await runAppScript(check.path, check.args, projectPath, stage, dirs, options.signal, log, check.id)
      const outcome = checkOutcome(check.id, result)
      validations.push(outcome)
      emitValidation(emit, outcome, recipeOwnerId)
      if (result.exitCode !== 0) throw mappedProcessError('validating', result)
    }
    const stylingOutput = await verifyGeneratedStyling(projectPath, resolved.recipe)
    if (stylingOutput) {
      validations.push(stylingOutput)
      emitValidation(emit, stylingOutput, recipeOwnerId)
    }
    if (selection.template) {
      const lint: ValidationOutcome = { id: 'lint', status: 'skipped', message: 'The pinned Forma installer does not define a lint script or install a lint tool.' }
      validations.push(lint)
      emitValidation(emit, lint, recipeOwnerId)
    }
    throwIfCancelled(options.signal, currentStage)
    const smoke = resolved.recipe.projectType === 'backend'
      ? await servedBackendSmoke(projectPath, stage, dirs, options.signal, log)
      : await servedPageSmoke(projectPath, stage, dirs, resolved.recipe.frontend!, options.signal, log)
    validations.push(smoke)
    emitValidation(emit, smoke, recipeOwnerId)
    const allPassed = validations.every((item) => item.status === 'pass'
      || (selection.template !== undefined && item.id === 'lint' && item.status === 'skipped'))
    if (!allPassed) throw userError('GEN_VALIDATE_FAILED', 'validating', 'One or more required checks did not pass.', 'Review the local redacted job log and retry.')
    await writeProjectManifest(stage, resolved, process.version.replace(/^v/, ''), npmTool, validations, generatedFiles, formaEvidence)
    stageFinish('validating', 'passed')

    stageStart('finalizing')
    throwIfCancelled(options.signal, currentStage)
    await cleanupStageSupportFiles(stage)
    throwIfCancelled(options.signal, currentStage)
    await moveDirectoryNoReplace(stage)
    committed = true
    try {
      await cleanupOwnedStage(stage)
    } catch {
      emit({ type: 'warning', stageId: 'finalizing', stageOwner: 'core', code: 'GEN_STAGING_LEFTOVER', message: 'Project committed, but owned temporary staging could not be removed safely.' })
      stageFinish('finalizing', 'passed', 'Project committed; temporary staging retained for manual recovery.')
      emit({ type: 'job-finished', stageOwner: 'core', status: 'partial', message: 'Project generated and validated; cleanup needs manual attention.', code: 'GEN_STAGING_LEFTOVER' })
      return { jobId, status: 'partial', targetPath: resolved.outputPath, exitCode: 4, validations, logFile: log.file }
    }
    stageFinish('finalizing', 'passed')
    emit({ type: 'job-finished', stageOwner: 'core', status: 'completed', message: 'Project generated and required checks passed.' })
    return { jobId, status: 'completed', targetPath: resolved.outputPath, exitCode: 0, validations, logFile: log.file }
  } catch (error) {
    const original = asGeneratorError(error, currentStage)
    const finalizeUnconfirmed = original.code === 'GEN_FINALIZE_UNCONFIRMED'
    const preserveStage = original.code === 'GEN_PROCESS_TREE_UNCONFIRMED'
      || finalizeUnconfirmed
      || original.code === 'GEN_STAGE_IDENTITY_MISMATCH'
      || original.code === 'GEN_STAGE_IDENTITY_UNCONFIRMED'
      || original.code === 'GEN_STAGING_LEFTOVER'
    const detail = new GeneratorError({
      ...original.toJSON(),
      stage: currentStage,
      targetModified: committed || finalizeUnconfirmed,
    }, { cause: original })
    stageFinish(currentStage, detail.code === 'GEN_CANCELLED' ? 'skipped' : 'failed', detail.message)
    emit({ type: detail.code === 'GEN_CANCELLED' ? 'warning' : 'error', stageId: currentStage, stageOwner: eventOwner(currentStage), code: detail.code, message: detail.message })
    if (stage && !committed && preserveStage) {
      emit({ type: 'warning', stageId: 'staging', stageOwner: 'core', code: 'GEN_STAGING_LEFTOVER', message: finalizeUnconfirmed
        ? 'Owned staging was retained because native finalization outcome could not be confirmed.'
        : original.code === 'GEN_STAGE_IDENTITY_MISMATCH' || original.code === 'GEN_STAGE_IDENTITY_UNCONFIRMED'
          ? 'Owned staging was retained because project identity could not be verified.'
          : original.code === 'GEN_STAGING_LEFTOVER'
            ? 'Owned staging was retained because a native filesystem operation could not be confirmed.'
            : 'Owned staging was retained because process-tree termination could not be confirmed.' })
    } else if (stage && !committed) {
      try {
        await cleanupOwnedStage(stage)
      } catch {
        emit({ type: 'warning', stageId: 'staging', stageOwner: 'core', code: 'GEN_STAGING_LEFTOVER', message: 'Owned staging was retained because cleanup could not be verified safely.' })
      }
    }
    const status = detail.code === 'GEN_CANCELLED' ? 'cancelled' : 'failed'
    emit({ type: 'job-finished', stageOwner: 'core', status, message: status === 'cancelled'
      ? 'Generation cancelled; cleanup attempted.'
      : finalizeUnconfirmed ? 'Finalization outcome is uncertain; inspect destination and retained staging.' : 'Generation failed; final destination was not committed.', code: detail.code })
    return {
      jobId,
      status,
      targetPath: resolved.outputPath,
      exitCode: detail.code === 'GEN_CANCELLED' ? 5 : detail.code === 'GEN_PATH_EXISTS' ? 6 : detail.code === 'GEN_RECIPE_UNTESTED' || detail.stage === 'preflight' ? 3 : 4,
      error: detail.toJSON(),
      logFile: log.file,
      validations,
    }
  }
}

export async function generateProject(selection: ProjectSelectionV1, options: GenerateOptions = {}): Promise<GenerateResult> {
  const jobId = randomUUID()
  let log: JobLog
  try {
    createPlan(selection)
    log = createJobLog(jobId)
  } catch (error) {
    const detail = asGeneratorError(error, 'preflight')
    const emit = createEventEmitter(jobId, options.onEvent)
    emit({ type: 'job-started', stageOwner: 'core', status: 'running', message: `Generation job ${jobId} started.` })
    emit({ type: 'error', stageId: 'preflight', stageOwner: 'core', code: detail.code, message: detail.message })
    emit({ type: 'job-finished', stageOwner: 'core', status: 'failed', code: detail.code, message: 'Generation failed before staging.' })
    return { jobId, status: 'failed', targetPath: '', exitCode: 3, error: detail.toJSON(), validations: [] }
  }
  const emit = createEventEmitter(jobId, options.onEvent, log)
    return generateInJob(selection, options, emit, log, jobId)
}
