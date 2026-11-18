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
import { writeDatabaseBackendStarter } from './database-backend-starter.js'
import { writePostgresBackendStarter } from './postgres-backend-starter.js'
import { writeNestBackendStarter } from './nest-backend-starter.js'
import { writeNestPostgresBackendStarter } from './nest-postgres-backend-starter.js'
import { writeFullstackStarter } from './fullstack-starter.js'
import { writeFastApiBackendStarter } from './fastapi-backend-starter.js'
import { verifyUvLockfile, writeFastApiProjectDocs, writeFastApiProjectManifest } from './fastapi-project-docs.js'
import { writeLaravelBackendStarter, LARAVEL_PINS } from './laravel-backend-starter.js'
import { verifyComposerLockfile, writeLaravelProjectDocs, writeLaravelProjectManifest } from './laravel-project-docs.js'
import { writeGoBackendStarter } from './go-backend-starter.js'
import { writeGinBackendStarter } from './gin-backend-starter.js'
import { writeGoProjectDocs, writeGoProjectManifest } from './go-project-docs.js'
import { writeGinProjectDocs, writeGinProjectManifest } from './gin-project-docs.js'
import { createGinGoMod, verifyGinModuleGraph, GIN_GO_MINIMUM, GIN_GO_SUM_SHA256 } from './gin-module-graph.js'
import { runDoctor } from './doctor.js'
import { createPlan } from './plan.js'
import { assertFullstackInstallPathSafe, assertNestPostgresInstallPathSafe } from './paths.js'
import { writeProjectDocs, writeProjectManifest } from './project-docs.js'
import { runNodeProcess, runSafeProcess, startNodeProcess, startPostgresSmokeProcess, startSafeProcess, type ProcessResult, type SafeProcessOptions } from './runner.js'
import { bindOwnedStageProjectIdentity, createOwnedStage, cleanupOwnedStage, cleanupStageSupportFiles, markOwnedStageGenerating, mutateOwnedStage, moveDirectoryNoReplace, verifyOwnedStageProjectIdentity, type OwnedStage } from './staging.js'
import { resolveComposerPhar, resolveGoTool, resolveNpmTool, resolvePhpExecutable, resolvePythonExecutable, resolveUvExecutable, supportsComposer, supportsGo, supportsGoGin, supportsNpm, supportsPhp, supportsPython, supportsUv, type ComposerPhar, type GoTool, type NpmTool, type PhpExecutable, type PythonExecutable, type UvExecutable } from './toolchain.js'
import { assertGenerationAllowed } from './native-supervisor.js'
import { resolveSelection } from './resolver.js'
import { installFormaTemplate, type FormaInstallEvidence } from './forma.js'
import type { DoctorReport, JobEventV1, JobStatus, PackageManagerManifestV1, ProjectSelectionV1, RecipeManifestV1, ResolvedSelection, StageId, ValidationOutcome } from './types.js'

export interface GenerateOptions {
  allowPlanned?: boolean
  allowDependencyScripts?: boolean
  allowModuleDownloads?: boolean
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
  const go = report.tools.find((tool) => tool.id === 'go')
  if (go && !go.available) {
    return userError(go.version ? 'GEN_TOOL_UNSUPPORTED' : 'GEN_TOOL_MISSING', 'preflight', go.message, 'Install the Go version required by this recipe, add its bin directory to PATH, and rerun Doctor.')
  }
  if (!report.target.available) {
    const exists = report.target.message.includes('already exists')
    return userError(exists ? 'GEN_PATH_EXISTS' : 'GEN_PATH_UNSAFE', 'preflight', report.target.message, 'Choose a safe, absent destination under an existing local drive directory.')
  }
  if (!report.platform.startsWith('win32-')) {
    return userError('GEN_PLATFORM_UNSUPPORTED', 'preflight', 'Phase 01 generation is supported on Windows only.', 'Run generation on Windows.')
  }
  if (go) return userError('GEN_TOOL_MISSING', 'preflight', 'Go toolchain preflight did not pass.', 'Review Doctor output and install a supported Go SDK.')
  const php = report.tools.find((tool) => tool.id === 'php')
  if (php && !php.available) return userError(php.version ? 'GEN_TOOL_UNSUPPORTED' : 'GEN_TOOL_MISSING', 'preflight', php.message, 'Install user-managed PHP 8.2+ with required extensions including pdo_mysql, add php.exe to PATH, and rerun Doctor.')
  const composer = report.tools.find((tool) => tool.id === 'composer')
  if (composer && !composer.available) return userError(composer.version ? 'GEN_TOOL_UNSUPPORTED' : 'GEN_TOOL_MISSING', 'preflight', composer.message, 'Install Composer 2.2+ for the current user and rerun Doctor.')
  const python = report.tools.find((tool) => tool.id === 'python')
  if (python && !python.available) {
    return userError(python.version ? 'GEN_TOOL_UNSUPPORTED' : 'GEN_TOOL_MISSING', 'preflight', python.message, 'Install a user-managed Python 3.14.x runtime, add python.exe to PATH, then rerun Doctor. Automatic runtime downloads are disabled.')
  }
  const uv = report.tools.find((tool) => tool.id === 'uv')
  if (uv && !uv.available) {
    return userError(uv.version ? 'GEN_TOOL_UNSUPPORTED' : 'GEN_TOOL_MISSING', 'preflight', uv.message, 'Install uv using its official user-managed installer, add uv.exe to PATH, then rerun Doctor.')
  }
  const node = report.tools.find((tool) => tool.id === 'node')
  const npm = report.tools.find((tool) => tool.id === 'npm')
  if (!node?.available) {
    return userError('GEN_TOOL_UNSUPPORTED', 'preflight', 'Active Node.js version does not satisfy this recipe and selected package manager.', 'Install a supported Node.js version, restart the CLI, and rerun doctor.')
  }
  if (!npm?.available) {
    return userError('GEN_TOOL_MISSING', 'preflight', 'Trusted npm CLI is missing or unsupported beside active Node.js.', 'Install Node.js with npm 10 or newer and rerun doctor.')
  }
  return userError('GEN_TOOL_MISSING', 'preflight', 'Required toolchain preflight did not pass.', 'Review doctor output and retry.')
}

function mappedProcessError(stage: StageId, result: ProcessResult): GeneratorError {
  const details: Record<StageId, { code: string; message: string; nextAction: string }> = {
    preflight: { code: 'GEN_TOOL_MISSING', message: 'Toolchain probe failed.', nextAction: 'Rerun doctor and review the local log.' },
    staging: { code: 'GEN_STAGE_CREATE_FAILED', message: 'Could not prepare owned staging.', nextAction: 'Check destination permissions and retry.' },
    scaffolding: { code: 'GEN_SCAFFOLD_FAILED', message: `Pinned official scaffold exited with code ${result.exitCode}.`, nextAction: 'Review the local redacted job log and retry.' },
    configuring: { code: 'GEN_CONFIGURE_FAILED', message: 'Could not write declared project documentation.', nextAction: 'Review the local redacted job log and retry.' },
    installing: { code: 'GEN_INSTALL_FAILED', message: `Selected package-manager command exited with code ${result.exitCode}.`, nextAction: 'Check package registry/network access and review the local redacted job log.' },
    validating: { code: 'GEN_VALIDATE_FAILED', message: `Required project check exited with code ${result.exitCode}.`, nextAction: 'Review the local redacted job log and fix the reported check before retrying.' },
    finalizing: { code: 'GEN_FINALIZE_FAILED', message: 'Could not finalize the validated project.', nextAction: 'Review the local redacted job log and retry at a new destination.' },
  }
  const detail = details[stage]
  return userError(detail.code, stage, detail.message, detail.nextAction)
}

function throwIfCancelled(signal: AbortSignal | undefined, stage: StageId): void {
  if (signal?.aborted) throw userError('GEN_CANCELLED', stage, 'Generation was cancelled.', 'Retry from the beginning at a new destination.')
}

async function prepareDirectories(stage: OwnedStage): Promise<{ tools: string; home: string; temp: string; cache: string; goCache: string; goModCache: string; uvCache: string; composerCache: string; composerHome: string; userConfig: string; globalConfig: string }> {
  const tools = win32.join(stage.path, '.tools')
  const home = win32.join(stage.path, '.home')
  const temp = win32.join(stage.path, '.tmp')
  const cache = win32.join(stage.path, '.npm-cache')
  const goCache = win32.join(stage.path, '.go-cache')
  const goModCache = win32.join(stage.path, '.go-mod-cache')
  const uvCache = win32.join(stage.path, '.uv-cache')
  const composerCache = win32.join(stage.path, '.composer-cache')
  const composerHome = win32.join(home, 'composer')
  const userConfig = win32.join(stage.path, '.npmrc-user')
  const globalConfig = win32.join(stage.path, '.npmrc-global')
  await mutateOwnedStage(stage, [
    '.tools',
    '.home/AppData/Roaming',
    '.home/AppData/Local',
    '.home/composer',
    '.tmp',
    '.npm-cache',
    '.go-cache',
    '.go-mod-cache',
    '.uv-cache',
    '.composer-cache',
  ], [
    { path: '.npmrc-user', content: 'registry=https://registry.npmjs.org/\n' },
    { path: '.npmrc-global', content: 'registry=https://registry.npmjs.org/\n' },
  ])
  return { tools, home, temp, cache, goCache, goModCache, uvCache, composerCache, composerHome, userConfig, globalConfig }
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

async function runGo(
  args: readonly string[],
  cwd: string,
  stage: OwnedStage,
  go: GoTool,
  dirs: { home: string; temp: string; goCache: string; goModCache: string },
  log: JobLog,
  label: string,
  signal?: AbortSignal,
  timeoutMs = 10 * 60 * 1000,
  allowModuleDownloads = false,
): Promise<ProcessResult> {
  const result = await runSafeProcess({
    executablePath: go.executablePath,
    allowedExecutableRoot: go.directory,
    cwd,
    allowedCwdRoot: stage.path,
    args,
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    extraPath: [go.directory],
    environment: {
      GOTOOLCHAIN: 'local',
      GOENV: 'off',
      GOPROXY: allowModuleDownloads ? 'https://proxy.golang.org' : 'off',
      GOSUMDB: allowModuleDownloads ? 'sum.golang.org' : 'off',
      GOCACHE: dirs.goCache,
      GOMODCACHE: dirs.goModCache,
      GOTMPDIR: dirs.temp,
    },
    ...(signal ? { signal } : {}),
    timeoutMs,
  })
  log.process(label, result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, tmpdir()])
  return result
}

async function runGofmt(
  args: readonly string[],
  cwd: string,
  stage: OwnedStage,
  go: GoTool,
  dirs: { home: string; temp: string },
  log: JobLog,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  const result = await runSafeProcess({
    executablePath: win32.join(go.directory, 'gofmt.exe'),
    allowedExecutableRoot: go.directory,
    cwd,
    allowedCwdRoot: stage.path,
    args,
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    extraPath: [go.directory],
    environment: { GOTOOLCHAIN: 'local', GOENV: 'off', GOTMPDIR: dirs.temp },
    ...(signal ? { signal } : {}),
    timeoutMs: 2 * 60 * 1000,
  })
  log.process('gofmt', result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, tmpdir()])
  return result
}

async function runUv(
  args: readonly string[],
  cwd: string,
  stage: OwnedStage,
  uv: UvExecutable,
  python: PythonExecutable,
  dirs: { home: string; temp: string; uvCache: string },
  log: JobLog,
  label: string,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  const result = await runSafeProcess({
    executablePath: uv.executablePath,
    allowedExecutableRoot: uv.directory,
    cwd,
    allowedCwdRoot: stage.path,
    args,
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    extraPath: [uv.directory, python.directory],
    environment: {
      UV_NO_CONFIG: '1',
      UV_INDEX_URL: 'https://pypi.org/simple',
      UV_CACHE_DIR: dirs.uvCache,
      UV_PROJECT_ENVIRONMENT: win32.join(cwd, '.venv'),
      UV_PYTHON_DOWNLOADS: 'never',
      UV_PYTHON_NO_REGISTRY: '1',
      PYTHONNOUSERSITE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
    },
    ...(signal ? { signal } : {}),
    timeoutMs: 10 * 60 * 1000,
  })
  log.process(label, result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, dirs.uvCache, tmpdir()])
  return result
}

async function runComposer(
  args: readonly string[],
  cwd: string,
  stage: OwnedStage,
  php: PhpExecutable,
  composer: ComposerPhar,
  dirs: { home: string; temp: string; composerHome: string; composerCache: string },
  log: JobLog,
  label: string,
  signal?: AbortSignal,
): Promise<ProcessResult> {
  const result = await runSafeProcess({
    executablePath: php.executablePath,
    allowedExecutableRoot: php.directory,
    cwd,
    allowedCwdRoot: stage.path,
    args: [composer.pharPath, ...args],
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    extraPath: [php.directory, composer.directory],
    environment: {
      COMPOSER_HOME: dirs.composerHome,
      COMPOSER_CACHE_DIR: dirs.composerCache,
      COMPOSER_DISABLE_XDEBUG_WARN: '1',
    },
    ...(signal ? { signal } : {}),
    timeoutMs: 20 * 60 * 1000,
  })
  log.process(label, result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, dirs.composerHome, dirs.composerCache, tmpdir()])
  return result
}

async function runPhp(
  args: readonly string[],
  cwd: string,
  stage: OwnedStage,
  php: PhpExecutable,
  dirs: { home: string; temp: string },
  log: JobLog,
  label: string,
  signal?: AbortSignal,
  environment?: Readonly<Record<string, string>>,
): Promise<ProcessResult> {
  const result = await runSafeProcess({
    executablePath: php.executablePath,
    allowedExecutableRoot: php.directory,
    cwd,
    allowedCwdRoot: stage.path,
    args,
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    extraPath: [php.directory],
    ...(environment ? { environment } : {}),
    ...(signal ? { signal } : {}),
    timeoutMs: 10 * 60 * 1000,
  })
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

type NpmLockPackages = Record<string, {
  version?: string
  integrity?: string
  link?: boolean
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  workspaces?: string[] | { packages?: string[] }
}>

export function assertNpmDependencyPins(packages: NpmLockPackages, pins: NonNullable<RecipeManifestV1['dependencies']>): void {
  const root = packages['']
  const workspacePaths = Array.isArray(root?.workspaces)
    ? root.workspaces
    : root?.workspaces?.packages ?? []
  const owners = [...new Set(['', ...workspacePaths])]
    .filter((path) => Object.hasOwn(packages, path))

  for (const pin of pins) {
    const declaredBy = owners.flatMap((path) => {
      const manifest = packages[path]!
      return [manifest.dependencies?.[pin.packageName], manifest.devDependencies?.[pin.packageName]]
        .filter((version): version is string => version !== undefined)
        .map((version) => ({ path, version }))
    })
    if (declaredBy.length === 0) throw new Error(`${pin.packageName} is not declared by the generated root or workspace manifests.`)

    for (const declaration of declaredBy) {
      if (declaration.version !== pin.version) {
        throw new Error(`${pin.packageName} declares ${declaration.version} in ${declaration.path || 'root'}; expected ${pin.version}.`)
      }

      let ownerPath = declaration.path
      let resolvedPath: string | undefined
      while (true) {
        const candidate = `${ownerPath ? `${ownerPath}/` : ''}node_modules/${pin.packageName}`
        if (Object.hasOwn(packages, candidate)) {
          resolvedPath = candidate
          break
        }
        const separator = ownerPath.lastIndexOf('/')
        if (separator < 0) {
          if (!ownerPath) break
          ownerPath = ''
        } else ownerPath = ownerPath.slice(0, separator)
      }

      const resolved = resolvedPath ? packages[resolvedPath] : undefined
      if (!resolved || resolved.version !== pin.version || resolved.integrity !== pin.integrity) {
        throw new Error(`${pin.packageName} for ${declaration.path || 'root'} resolves to ${resolved?.version ?? 'missing'} at ${resolvedPath ?? 'no lock entry'}; expected ${pin.version} with reviewed integrity.`)
      }
    }
  }
}

async function verifyDependencyPins(projectPath: string, pins: NonNullable<RecipeManifestV1['dependencies']>): Promise<void> {
  if (pins.length === 0) return
  try {
    const lock = JSON.parse(await readFile(win32.join(projectPath, 'package-lock.json'), 'utf8')) as {
      packages?: NpmLockPackages
    }
    if (!lock.packages) throw new Error('npm lock packages are missing.')
    assertNpmDependencyPins(lock.packages, pins)
    if (pins.some(({ packageName }) => packageName === 'bootstrap') && lock.packages?.['node_modules/@popperjs/core']) {
      throw new Error('CSS-only Bootstrap install unexpectedly resolved Popper.')
    }
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : 'npm lock validation failed.'
    throw userError('GEN_DEPENDENCY_INTEGRITY', 'installing', `Pinned dependency version or npm integrity did not match the reviewed catalog: ${reason}`, 'Check npm registry integrity and the generated lockfile, then retry; no target project was committed.')
  }
}

async function verifyProjectLockfile(projectPath: string, manager: PackageManagerManifestV1): Promise<string> {
  if (!manager.lockfile) throw new Error(`No lockfile is configured for ${manager.id}.`)
  try {
    const entries = await readdir(projectPath)
    const present = entries.filter((entry) => ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb'].includes(entry))
    if (present.length !== 1 || present[0] !== manager.lockfile) throw new Error('Project must contain only the selected package-manager lockfile.')
    const lockfile = manager.lockfile
    const lock = await readFile(win32.join(projectPath, lockfile), 'utf8')
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

async function listRegularFiles(root: string, current = root): Promise<string[]> {
  const result: string[] = []
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const path = win32.join(current, entry.name)
    if (entry.isDirectory()) result.push(...await listRegularFiles(root, path))
    else if (entry.isFile()) result.push(win32.relative(root, path).replaceAll('\\', '/'))
    else throw userError('GEN_PATH_UNSAFE', 'configuring', 'Migration generator produced a non-regular filesystem entry.', 'Inspect the owned staging files and retry; no destination was committed.')
  }
  return result
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
  allowedScriptRoot = projectPath,
): Promise<ProcessResult> {
  const result = await runNodeProcess({
    scriptPath,
    allowedScriptRoot,
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
  isNest = false,
  isDatabaseBackend = false,
  isPostgresBackend = false,
): Promise<ValidationOutcome> {
  const port = await freePort()
  let databaseConnections = 0
  const databaseProbe = isPostgresBackend ? createServer((socket) => {
    databaseConnections += 1
    socket.destroy()
  }) : undefined
  let databaseProbePort: number | undefined
  if (databaseProbe) {
    await new Promise<void>((resolveListen, reject) => {
      databaseProbe.once('error', reject)
      databaseProbe.listen(0, '127.0.0.1', () => { databaseProbe.off('error', reject); resolveListen() })
    })
    const address = databaseProbe.address()
    if (!address || typeof address === 'string') throw userError('GEN_VALIDATE_FAILED', 'validating', 'Owned PostgreSQL probe did not bind a TCP port.', 'Retry generation in a writable local environment.')
    databaseProbePort = address.port
  }
  let running: Awaited<ReturnType<typeof startNodeProcess>> | undefined
  let outcome: ValidationOutcome | undefined
  try {
    const processOptions: SafeProcessOptions = {
      scriptPath: win32.join(projectPath, 'dist', isNest ? 'main.js' : 'server.js'),
      allowedScriptRoot: projectPath,
      cwd: projectPath,
      allowedCwdRoot: stage.path,
      args: [],
      homeDirectory: dirs.home,
      tempDirectory: dirs.temp,
      environment: {
        HOST: '127.0.0.1',
        PORT: String(port),
        NODE_ENV: 'test',
        ...(isDatabaseBackend ? { DB_FILE: ':memory:' } : {}),
      },
      ...(signal ? { signal } : {}),
    }
    running = isPostgresBackend
      ? await startPostgresSmokeProcess(processOptions, databaseProbePort!)
      : await startNodeProcess(processOptions)
    for (let attempt = 0; attempt < 30; attempt += 1) {
      throwIfCancelled(signal, 'validating')
      try {
        const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(800) })
        const healthBody = await health.json() as { status?: string }
        const info = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(800) })
        const infoBody = await info.json() as { name?: string; version?: string; environment?: string }
        if (health.status === 200 && healthBody.status === 'ok' && info.status === 200
          && infoBody.name === (isNest && isPostgresBackend ? 'BE-09 NestJS PostgreSQL API' : isNest ? 'BE-03 NestJS API' : isDatabaseBackend ? 'BE-07 Express SQLite API' : isPostgresBackend ? 'BE-08 Express PostgreSQL API' : 'BE-01 Express API') && infoBody.version === '0.1.0' && infoBody.environment === 'test') {
          outcome = { id: 'http-smoke', status: 'pass', message: isPostgresBackend ? 'Built API returned valid JSON from /health and /api/info; owned loopback PostgreSQL probe observed no connection.' : 'Built API returned valid JSON from /health and /api/info.', exitCode: 0 }
          break
        }
      } catch {
        // Keep probing until bounded smoke-test timeout; no response body is surfaced.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    }
  } finally {
    if (running) {
      await running.stop()
      const result = await running.result.catch(() => undefined)
      if (result) log.process('http-smoke-server', result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, tmpdir()])
    }
    if (databaseProbe) await new Promise<void>((resolveClose, reject) => databaseProbe.close((error) => error ? reject(error) : resolveClose()))
  }
  if (isPostgresBackend && databaseConnections !== 0) throw userError('GEN_VALIDATE_FAILED', 'validating', 'Generated startup or health attempted a PostgreSQL connection.', 'Review the starter so generation validation never contacts a database.')
  if (!outcome) throw userError('GEN_VALIDATE_FAILED', 'validating', 'Built API did not return valid JSON from /health and /api/info within 15 seconds.', 'Review the local redacted job log and retry.')
  return outcome
}

async function servedFullstackSmoke(
  projectPath: string,
  stage: OwnedStage,
  dirs: { home: string; temp: string },
  signal: AbortSignal | undefined,
  log: JobLog,
): Promise<ValidationOutcome> {
  const apiPort = await freePort()
  const webPort = await freePort()
  let databaseConnections = 0
  const databaseProbe = createServer((socket) => { databaseConnections += 1; socket.destroy() })
  await new Promise<void>((resolveListen, reject) => {
    databaseProbe.once('error', reject)
    databaseProbe.listen(0, '127.0.0.1', () => { databaseProbe.off('error', reject); resolveListen() })
  })
  const databaseAddress = databaseProbe.address()
  if (!databaseAddress || typeof databaseAddress === 'string') throw userError('GEN_VALIDATE_FAILED', 'validating', 'Owned PostgreSQL probe did not bind a TCP port.', 'Retry generation in a writable local environment.')
  let api: Awaited<ReturnType<typeof startNodeProcess>> | undefined
  let web: Awaited<ReturnType<typeof startNodeProcess>> | undefined
  let passed = false
  try {
    api = await startPostgresSmokeProcess({
      scriptPath: win32.join(projectPath, 'apps', 'api', 'dist', 'server.js'),
      allowedScriptRoot: projectPath,
      cwd: win32.join(projectPath, 'apps', 'api'),
      allowedCwdRoot: stage.path,
      args: [],
      homeDirectory: dirs.home,
      tempDirectory: dirs.temp,
      environment: { HOST: '127.0.0.1', PORT: String(apiPort), NODE_ENV: 'test' },
      ...(signal ? { signal } : {}),
    }, databaseAddress.port)
    web = await startNodeProcess({
      scriptPath: win32.join(projectPath, 'node_modules', 'vite', 'bin', 'vite.js'),
      allowedScriptRoot: projectPath,
      cwd: win32.join(projectPath, 'apps', 'web'),
      allowedCwdRoot: stage.path,
      args: ['preview', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
      homeDirectory: dirs.home,
      tempDirectory: dirs.temp,
      environment: { API_PORT: String(apiPort) },
      ...(signal ? { signal } : {}),
    })
    for (let attempt = 0; attempt < 30; attempt += 1) {
      throwIfCancelled(signal, 'validating')
      try {
        const page = await fetch(`http://127.0.0.1:${webPort}/`, { signal: AbortSignal.timeout(800) })
        const html = await page.text()
        const asset = /<script[^>]+src="([^"]+\.js)"/i.exec(html)?.[1]
        const script = asset ? await fetch(new URL(asset, `http://127.0.0.1:${webPort}`), { signal: AbortSignal.timeout(800) }) : undefined
        const scriptText = script?.ok ? await script.text() : ''
        const health = await fetch(`http://127.0.0.1:${webPort}/health`, { signal: AbortSignal.timeout(800) })
        const healthBody = await health.json() as { status?: string }
        const info = await fetch(`http://127.0.0.1:${webPort}/api/info`, { signal: AbortSignal.timeout(800) })
        const infoBody = await info.json() as { name?: string; version?: string; environment?: string }
        passed = page.status === 200 && page.headers.get('content-type')?.includes('text/html') === true
          && script?.status === 200 && scriptText.includes('/api/items')
          && health.status === 200 && healthBody.status === 'ok'
          && info.status === 200 && infoBody.name === 'FS-06 Express PostgreSQL API'
          && infoBody.version === '0.1.0' && infoBody.environment === 'test'
        if (passed) break
      } catch {
        // Bounded loopback smoke; response bodies stay local.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    }
  } finally {
    for (const [label, running] of [['fullstack-web-smoke', web], ['fullstack-api-smoke', api]] as const) {
      if (!running) continue
      await running.stop()
      const result = await running.result.catch(() => undefined)
      if (result) log.process(label, result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, tmpdir()])
    }
    await new Promise<void>((resolveClose, reject) => databaseProbe.close((error) => error ? reject(error) : resolveClose()))
  }
  if (databaseConnections !== 0) throw userError('GEN_VALIDATE_FAILED', 'validating', 'Fullstack startup, frontend proxy, or health smoke attempted a PostgreSQL connection.', 'Review the starter so generation validation never contacts a database.')
  if (!passed) throw userError('GEN_VALIDATE_FAILED', 'validating', 'Fullstack frontend, Vite API proxy, or database-free API health smoke failed.', 'Review the local redacted job log and retry; smoke checks must not require PostgreSQL.')
  return { id: 'fullstack-http-smoke', status: 'pass', message: 'Built React page, Vite API proxy, Express health/info, and zero-connection PostgreSQL probe passed.', exitCode: 0 }
}

async function servedGoBackendSmoke(
  projectPath: string,
  stage: OwnedStage,
  dirs: { home: string; temp: string; goCache: string; goModCache: string },
  go: GoTool,
  projectName: string,
  signal: AbortSignal | undefined,
  log: JobLog,
): Promise<ValidationOutcome> {
  const port = await freePort()
  const binaryPath = win32.join(stage.path, '.tmp', 'go-api-smoke.exe')
  const build = await runGo(['build', '-o', binaryPath, './cmd/server'], projectPath, stage, go, dirs, log, 'go-http-smoke-build', signal, 2 * 60 * 1000)
  if (build.exitCode !== 0) throw mappedProcessError('validating', build)
  const running = await startSafeProcess({
    executablePath: binaryPath,
    allowedExecutableRoot: stage.path,
    cwd: projectPath,
    allowedCwdRoot: stage.path,
    args: [],
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    extraPath: [go.directory],
    environment: {
      HOST: '127.0.0.1',
      PORT: String(port),
      GOTOOLCHAIN: 'local',
      GOENV: 'off',
      GOPROXY: 'off',
      GOSUMDB: 'off',
      GOCACHE: dirs.goCache,
      GOMODCACHE: dirs.goModCache,
      GOTMPDIR: dirs.temp,
    },
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
        const infoBody = await info.json() as { name?: string; version?: string }
        if (health.status === 200 && healthBody.status === 'ok' && info.status === 200
          && infoBody.name === `${projectName} API` && infoBody.version === '0.1.0') {
          outcome = { id: 'http-smoke', status: 'pass', message: 'Built Go API returned valid JSON from /health and /api/info.', exitCode: 0 }
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
    if (result) log.process('go-http-smoke-server', result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, tmpdir()])
  }
  if (!outcome) throw userError('GEN_VALIDATE_FAILED', 'validating', 'Built Go API did not return valid JSON from /health and /api/info within 15 seconds.', 'Review the local redacted job log and retry.')
  return outcome
}

async function servedFastApiSmoke(
  projectPath: string,
  stage: OwnedStage,
  dirs: { home: string; temp: string; uvCache: string },
  uv: UvExecutable,
  python: PythonExecutable,
  signal: AbortSignal | undefined,
  log: JobLog,
): Promise<ValidationOutcome[]> {
  const port = await freePort()
  const running = await startSafeProcess({
    executablePath: uv.executablePath,
    allowedExecutableRoot: uv.directory,
    cwd: projectPath,
    allowedCwdRoot: stage.path,
    args: ['run', '--locked', '--no-sync', '--python', python.executablePath, 'python', '-m', 'app'],
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    extraPath: [uv.directory, python.directory],
    environment: {
      UV_NO_CONFIG: '1',
      UV_INDEX_URL: 'https://pypi.org/simple',
      UV_CACHE_DIR: dirs.uvCache,
      UV_PROJECT_ENVIRONMENT: win32.join(projectPath, '.venv'),
      UV_PYTHON_DOWNLOADS: 'never',
      UV_PYTHON_NO_REGISTRY: '1',
      PYTHONNOUSERSITE: '1',
      PYTHONDONTWRITEBYTECODE: '1',
      HOST: '127.0.0.1',
      PORT: String(port),
    },
    ...(signal ? { signal } : {}),
  })
  let apiPassed = false
  let openApiPassed = false
  const smokeTimeout = AbortSignal.timeout(15_000)
  const requestSignal = (): AbortSignal => AbortSignal.any([smokeTimeout, AbortSignal.timeout(800)])
  try {
    for (let attempt = 0; attempt < 30 && !smokeTimeout.aborted; attempt += 1) {
      throwIfCancelled(signal, 'validating')
      try {
        const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: requestSignal() })
        const healthBody = await health.json() as { status?: string }
        const info = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: requestSignal() })
        const infoBody = await info.json() as { name?: string; version?: string }
        const docs = await fetch(`http://127.0.0.1:${port}/docs`, { signal: requestSignal() })
        const docsBody = await docs.text()
        const openapi = await fetch(`http://127.0.0.1:${port}/openapi.json`, { signal: requestSignal() })
        const openapiBody = await openapi.json() as { paths?: Record<string, unknown> }
        apiPassed = health.status === 200 && healthBody.status === 'ok'
          && info.status === 200 && infoBody.name === `${win32.basename(projectPath)} API` && infoBody.version === '0.1.0'
        openApiPassed = Boolean(docs.status === 200 && docs.headers.get('content-type')?.includes('text/html') && /swagger-ui/i.test(docsBody)
          && openapi.status === 200 && openapiBody.paths?.['/health'] && openapiBody.paths?.['/api/info'])
        if (apiPassed && openApiPassed) break
      } catch {
        // Keep probing until bounded smoke-test timeout; response bodies stay local.
        if (smokeTimeout.aborted) break
      }
      if (!smokeTimeout.aborted) await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    }
  } finally {
    await running.stop()
    const result = await running.result.catch(() => undefined)
    if (result) log.process('fastapi-http-smoke-server', result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, dirs.uvCache, tmpdir()])
  }
  if (!apiPassed || !openApiPassed) throw userError('GEN_VALIDATE_FAILED', 'validating', 'FastAPI did not return expected health, info, Swagger UI, or OpenAPI responses within 15 seconds.', 'Review the local redacted job log and retry with the generated locked environment.')
  return [
    { id: 'http-smoke', status: 'pass', message: 'FastAPI returned valid JSON from /health and /api/info.', exitCode: 0 },
    { id: 'openapi', status: 'pass', message: 'Swagger UI and OpenAPI schema expose the generated routes.', exitCode: 0 },
  ]
}

async function verifyGinPinnedFiles(projectPath: string, modulePath: string): Promise<void> {
  let goMod: string
  let goSum: Buffer
  try {
    ;[goMod, goSum] = await Promise.all([
      readFile(win32.join(projectPath, 'go.mod'), 'utf8'),
      readFile(win32.join(projectPath, 'go.sum')),
    ])
  } catch {
    throw userError('GEN_MODULE_INTEGRITY', 'installing', 'Generated Go module files are missing.', 'Retry with the reviewed Gin starter and pinned Go module graph.')
  }
  const sumHash = createHash('sha256').update(goSum).digest('hex')
  if (goMod !== createGinGoMod(modulePath) || sumHash !== GIN_GO_SUM_SHA256) {
    throw userError('GEN_MODULE_INTEGRITY', 'installing', 'Generated go.mod or go.sum differs from the reviewed Gin module pins.', 'Do not download modules from this project; review the generator pins and retry.')
  }
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

async function servedLaravelSmoke(
  projectPath: string,
  stage: OwnedStage,
  php: PhpExecutable,
  dirs: { home: string; temp: string },
  signal: AbortSignal | undefined,
  log: JobLog,
): Promise<ValidationOutcome> {
  const port = await freePort()
  const running = await startSafeProcess({
    executablePath: php.executablePath,
    allowedExecutableRoot: php.directory,
    cwd: projectPath,
    allowedCwdRoot: stage.path,
    args: [win32.join(projectPath, 'artisan'), 'serve', '--host=127.0.0.1', `--port=${port}`],
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    extraPath: [php.directory],
    environment: {
      APP_ENV: 'testing',
      APP_KEY: '',
      APP_DEBUG: 'true',
      DB_CONNECTION: 'mysql',
      DB_HOST: '127.0.0.1',
      DB_PORT: '3306',
      DB_DATABASE: 'laravel_test',
      DB_USERNAME: 'root',
      DB_PASSWORD: '',
      CACHE_STORE: 'array',
      QUEUE_CONNECTION: 'sync',
      SESSION_DRIVER: 'array',
    },
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
        const infoBody = await info.json() as { name?: string; framework?: string; version?: string }
        if (health.status === 200 && healthBody.status === 'ok'
          && info.status === 200 && info.headers.get('content-type')?.includes('application/json')
          && infoBody.name && infoBody.framework === 'Laravel' && infoBody.version === '0.1.0') {
          outcome = { id: 'http-smoke', status: 'pass', message: 'Laravel returned JSON from /health and /api/info without connecting to MySQL.', exitCode: 0 }
          break
        }
      } catch {
        // Probe stays local and bounded; response bodies are not surfaced.
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 500))
    }
  } finally {
    await running.stop()
    const result = await running.result.catch(() => undefined)
    if (result) log.process('laravel-http-smoke-server', result, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, tmpdir()])
  }
  if (!outcome) throw userError('GEN_VALIDATE_FAILED', 'validating', 'Laravel did not return valid JSON from /health and /api/info within 15 seconds.', 'Review the local redacted job log; MySQL is not required for these endpoints.')
  return outcome
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
    args: scaffoldPin.packageName === '@angular/cli' || scaffoldPin.packageName === '@nestjs/cli'
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
  selection = resolved.selection
  const isGo = resolved.recipe.id === 'BE-02'
  const isGin = resolved.recipe.id === 'BE-04'
  const usesGo = isGo || isGin
  const isNestPostgres = resolved.recipe.id === 'BE-09'
  const isNest = resolved.recipe.id === 'BE-03' || isNestPostgres
  const isDatabaseBackend = resolved.recipe.id === 'BE-07'
  const isPostgresBackend = resolved.recipe.id === 'BE-08'
  const isFullstack = resolved.recipe.id === 'FS-06'
  const isLaravel = resolved.recipe.id === 'BE-05'
  const isPython = resolved.recipe.id === 'BE-06'
  const isForma = Boolean(selection.template)
  const recipeOwnerId = resolved.recipe.backend ?? resolved.recipe.frontend ?? 'core'
  const eventOwner = (id: StageId): string => stageOwner(id, recipeOwnerId, resolved.recipe.manager, isForma)
  const stageStart = (id: StageId): void => { currentStage = id; emit({ type: 'stage-started', stageId: id, stageOwner: eventOwner(id), stageStatus: 'running', message: `${id} started.` }) }
  const stageFinish = (id: StageId, status: 'passed' | 'failed' | 'skipped', message = `${id} completed.`): void => { emit({ type: 'stage-finished', stageId: id, stageOwner: eventOwner(id), stageStatus: status, message }) }
  let formaEvidence: FormaInstallEvidence | undefined
  let npmTool: NpmTool | undefined
  let goTool: GoTool | undefined
  let phpTool: PhpExecutable | undefined
  let composerPhar: ComposerPhar | undefined
  let pythonExecutable: PythonExecutable | undefined
  let uvExecutable: UvExecutable | undefined
  let phpVersion: string | undefined
  let composerVersion: string | undefined
  let pythonVersion: string | undefined
  let uvVersion: string | undefined

  emit({ type: 'job-started', stageOwner: 'core', status: 'running', message: `Generation job ${jobId} started.` })
  const plan = createPlan(selection)
  if (plan.requiresDependencyConsent) emit({ type: 'warning', stageOwner: 'core', code: 'GEN_LIFECYCLE_SCRIPTS', message: isLaravel
    ? 'Composer package installation and generated Artisan/PHPUnit checks load third-party PHP code without a sandbox; Composer scripts and plugins are disabled.'
    : isPython ? 'uv sync can execute third-party package build code; execution is not sandboxed.' : `${resolved.recipe.manager} install can execute third-party lifecycle scripts; execution is not sandboxed.` })
  if (plan.requiresNetworkConsent) emit({ type: 'warning', stageOwner: 'core', code: 'GEN_MODULE_DOWNLOADS', message: 'Pinned Go Modules will download from proxy.golang.org and verify through sum.golang.org only after separate affirmative consent.' })
  try {
    stageStart('preflight')
    throwIfCancelled(options.signal, currentStage)
    if (resolved.recipe.status !== 'tested' && !(ALLOW_PLANNED_RECIPE_GENERATION && options.allowPlanned && resolved.recipe.status === 'planned')) {
      throw userError('GEN_RECIPE_UNTESTED', 'preflight', `${resolved.recipe.id} is planned and disabled for normal generation.`, 'Use a tested recipe; development-only runs do not change recipe status.')
    }
    if (plan.requiresDependencyConsent && !options.allowDependencyScripts) {
      throw userError('GEN_DEPENDENCY_CONSENT_REQUIRED', 'preflight', 'Generation was not started because dependency installation and validation load third-party code.', 'Review the plan and explicitly consent to unsandboxed dependency execution before generation.')
    }
    if (plan.requiresNetworkConsent && !options.allowModuleDownloads) {
      throw userError('GEN_MODULE_DOWNLOAD_CONSENT_REQUIRED', 'preflight', 'Generation was not started because Go Modules download requires separate network consent.', 'Review the disclosed Go module proxy and checksum database, then explicitly allow module downloads for this run.')
    }
    await assertGenerationAllowed()
    throwIfCancelled(options.signal, currentStage)
    const doctor = await runDoctor(selection)
    if (!doctor.ready) throw preflightError(doctor)
    if (usesGo) {
      const executable = await resolveGoTool()
      const version = doctor.tools.find((tool) => tool.id === 'go')?.version
      if (!executable || !version) throw userError('GEN_TOOL_MISSING', 'preflight', 'Go SDK could not be resolved after Doctor verification.', `Install Go ${isGin ? GIN_GO_MINIMUM : '1.22.0'} or newer, add its bin directory to PATH, and rerun Doctor.`)
      if (isGin ? !supportsGoGin(version) : !supportsGo(version)) throw userError('GEN_TOOL_UNSUPPORTED', 'preflight', `Go ${version} is below the required Go ${isGin ? GIN_GO_MINIMUM : '1.22.0'} minimum.`, `Install Go ${isGin ? GIN_GO_MINIMUM : '1.22.0'} or newer and rerun Doctor.`)
      goTool = { ...executable, version }
    } else if (isLaravel) {
      phpTool = await resolvePhpExecutable()
      composerPhar = await resolveComposerPhar()
      phpVersion = doctor.tools.find((tool) => tool.id === 'php')?.version
      composerVersion = doctor.tools.find((tool) => tool.id === 'composer')?.version
      if (!phpTool || !phpVersion || !supportsPhp(phpVersion)) throw userError('GEN_TOOL_UNSUPPORTED', 'preflight', 'PHP 8.2+ with pdo_mysql could not be resolved after Doctor verification.', 'Install user-managed PHP 8.2+ with required extensions and rerun Doctor.')
      if (!composerPhar || !composerVersion || !supportsComposer(composerVersion)) throw userError('GEN_TOOL_UNSUPPORTED', 'preflight', 'Composer 2.2+ could not be resolved after Doctor verification.', 'Install Composer 2.2+ for the current user and rerun Doctor.')
    } else if (isPython) {
      pythonExecutable = await resolvePythonExecutable()
      uvExecutable = await resolveUvExecutable()
      pythonVersion = doctor.tools.find((tool) => tool.id === 'python')?.version
      uvVersion = doctor.tools.find((tool) => tool.id === 'uv')?.version
      if (!pythonExecutable || !pythonVersion || !supportsPython(pythonVersion)) {
        throw userError('GEN_TOOL_UNSUPPORTED', 'preflight', 'Python 3.14.x could not be resolved after Doctor verification.', 'Install a user-managed Python 3.14.x runtime and rerun Doctor; automatic runtime downloads are disabled.')
      }
      if (!uvExecutable || !uvVersion || !supportsUv(uvVersion)) {
        throw userError('GEN_TOOL_UNSUPPORTED', 'preflight', 'uv 0.8.0 or newer could not be resolved after Doctor verification.', 'Install a supported uv executable and rerun Doctor.')
      }
    } else {
      npmTool = await resolveNpmTool()
      if (!npmTool || !supportsNpm(npmTool.version)) throw userError('GEN_TOOL_MISSING', 'preflight', 'Trusted npm CLI is missing or unsupported.', 'Install Node.js with npm 10 or newer and rerun doctor.')
    }
    if (isNestPostgres) assertNestPostgresInstallPathSafe(win32.dirname(doctor.target.path), selection.project.name, jobId)
    if (isFullstack) assertFullstackInstallPathSafe(win32.dirname(doctor.target.path), selection.project.name, jobId)
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
    } else if (isFullstack) {
      starterFiles = await writeFullstackStarter(stage, selection.project.name, resolved.recipe.dependencies ?? [])
    } else if (isLaravel) {
      const scaffoldPath = win32.join(dirs.tools, 'laravel-scaffold')
      const scaffold = await runComposer([
        'create-project', 'laravel/laravel', scaffoldPath, LARAVEL_PINS.scaffold,
        '--no-install', '--no-scripts', '--no-plugins', '--no-interaction', '--prefer-dist', '--no-progress',
      ], stage.path, stage, phpTool!, composerPhar!, dirs, log, 'laravel-official-scaffold', options.signal)
      if (scaffold.exitCode !== 0) throw mappedProcessError('scaffolding', scaffold)
      starterFiles = await writeLaravelBackendStarter(stage, scaffoldPath, selection.project.name)
    } else if (isPython) {
      starterFiles = await writeFastApiBackendStarter(stage, selection.project.name)
    } else if (isGo) {
      starterFiles = await writeGoBackendStarter(stage, selection.project.name, selection.backend!.modulePath!)
    } else if (isGin) {
      starterFiles = await writeGinBackendStarter(stage, selection.project.name, selection.backend!.modulePath!)
    } else if (isNest) {
      await executeScaffold(stage, resolved, npmTool!.cliPath, dirs, log, options.signal)
      starterFiles = isNestPostgres
        ? await writeNestPostgresBackendStarter(stage, selection.project.name, resolved.recipe.dependencies ?? [])
        : await writeNestBackendStarter(stage, selection.project.name, resolved.recipe.dependencies ?? [])
    } else if (isDatabaseBackend) {
      starterFiles = await writeDatabaseBackendStarter(stage, selection.project.name, resolved.recipe.dependencies ?? [])
    } else if (isPostgresBackend) {
      starterFiles = await writePostgresBackendStarter(stage, selection.project.name, resolved.recipe.dependencies ?? [])
    } else if (resolved.recipe.projectType === 'backend') {
      starterFiles = await writeBackendStarter(stage, selection.project.name, resolved.recipe.dependencies ?? [])
    } else {
      ({ managerCliPath } = await executeScaffold(stage, resolved, npmTool!.cliPath, dirs, log, options.signal))
      if (resolved.recipe.manager !== 'npm') {
        const integrity: ValidationOutcome = { id: 'package-manager-integrity', status: 'pass', message: `Pinned ${resolved.recipe.manager} ${packageManager(resolved.recipe.manager).version} package version and npm integrity verified.`, exitCode: 0 }
        validations.push(integrity)
        emitValidation(emit, integrity, resolved.recipe.manager)
      }
    }
    const projectPath = stage.childPath
    await bindOwnedStageProjectIdentity(stage, selection.project.name)
    await verifyOwnedStageProjectIdentity(stage, selection.project.name, usesGo ? selection.backend?.modulePath : undefined, isPython ? 'pyproject.toml' : isLaravel ? 'composer.json' : undefined)
    const identityOutcome: ValidationOutcome = { id: isLaravel ? 'laravel-scaffold' : 'scaffold-identity', status: 'pass', message: usesGo ? 'Generated module and project identity match the requested configuration.' : isPython ? 'Generated pyproject project name matches the requested project identity.' : isLaravel ? 'Generated Composer package identity matches the requested project name.' : 'Generated package identity matches the requested name.' }
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
    const generatedFiles = [...starterFiles, ...(usesGo || isPython || isLaravel || isNest || isDatabaseBackend || isPostgresBackend || isFullstack ? [] : await configureRecipeDependencies(stage, resolved))]
    const managerConfig = packageManagerConfiguration(resolved.recipe.manager)
    if (managerConfig) {
      const projectPrefix = `${win32.basename(projectPath)}/`
      const written = await mutateOwnedStage(stage, [], [{ ...managerConfig, path: `${projectPrefix}${managerConfig.path}` }])
      generatedFiles.push(...written.map((path) => path.slice(projectPrefix.length)))
    }
    if (isGin) generatedFiles.push(...await writeGinProjectDocs(stage, resolved, goTool!.version))
    else if (isGo) generatedFiles.push(...await writeGoProjectDocs(stage, resolved, goTool!.version))
    else if (isPython) generatedFiles.push(...await writeFastApiProjectDocs(stage, resolved, pythonVersion!, uvVersion!))
    else if (isLaravel) generatedFiles.push(...await writeLaravelProjectDocs(stage, resolved, phpVersion!, composerVersion!))
    else generatedFiles.push(...await writeProjectDocs(stage, resolved, process.version.replace(/^v/, ''), npmTool!, formaEvidence))
    if (formaEvidence) generatedFiles.push('FORMA-INSTALL.md', 'INSTALL.md', 'forma.install.json', 'forma-install-report.json')
    stageFinish('configuring', 'passed')

    stageStart('installing')
    throwIfCancelled(options.signal, currentStage)
    if (isGin) {
      await verifyGinPinnedFiles(projectPath, selection.backend!.modulePath!)
      const download = await runGo(['mod', 'download', 'all'], projectPath, stage, goTool!, dirs, log, 'go-module-download', options.signal, 10 * 60 * 1000, true)
      const downloadOutcome = checkOutcome('module-download', download)
      validations.push(downloadOutcome)
      emitValidation(emit, downloadOutcome, 'go-modules')
      if (download.exitCode !== 0) throw mappedProcessError('installing', download)
      await verifyGinPinnedFiles(projectPath, selection.backend!.modulePath!)

      const verify = await runGo(['mod', 'verify'], projectPath, stage, goTool!, dirs, log, 'go-module-verify', options.signal)
      const verifyOutcome = checkOutcome('go-module-integrity', verify)
      validations.push(verifyOutcome)
      emitValidation(emit, verifyOutcome, 'go-modules')
      if (verify.exitCode !== 0) throw mappedProcessError('installing', verify)
      if (!verify.stdout.includes('all modules verified')) {
        throw userError('GEN_MODULE_INTEGRITY', 'installing', 'go mod verify did not confirm the complete pinned module cache.', 'Review Go module download output and retry with the approved checksum database.')
      }

      const graph = await runGo(['list', '-m', '-f', '{{.Path}}|{{.Version}}|{{.GoVersion}}', 'all'], projectPath, stage, goTool!, dirs, log, 'go-module-compatibility', options.signal)
      if (graph.exitCode !== 0) throw mappedProcessError('installing', graph)
      let graphEvidence: { moduleCount: number; maximumGoVersion: string }
      try {
        graphEvidence = verifyGinModuleGraph(graph.stdout)
      } catch (error) {
        throw userError('GEN_MODULE_COMPATIBILITY', 'installing', error instanceof Error ? error.message : 'Go module graph is incompatible.', `Use Go ${GIN_GO_MINIMUM} or newer and review the pinned transitive module requirements.`)
      }
      const graphOutcome: ValidationOutcome = {
        id: 'go-module-compatibility',
        status: 'pass',
        message: `${graphEvidence.moduleCount} pinned modules verified; maximum declared dependency Go version ${graphEvidence.maximumGoVersion}.`,
        exitCode: 0,
      }
      validations.push(graphOutcome)
      emitValidation(emit, graphOutcome, 'go-modules')
      await verifyGinPinnedFiles(projectPath, selection.backend!.modulePath!)
      stageFinish('installing', 'passed')
    } else if (isGo) {
      stageFinish('installing', 'skipped', 'No dependency installation required; Go standard library only.')
    } else if (isLaravel) {
      const update = await runComposer([
        'update', '--no-install', '--no-scripts', '--no-plugins', '--no-interaction', '--prefer-dist', '--no-progress',
      ], projectPath, stage, phpTool!, composerPhar!, dirs, log, 'composer-lock-resolution', options.signal)
      const updateOutcome = checkOutcome('composer-lock', update)
      validations.push(updateOutcome)
      emitValidation(emit, updateOutcome, 'composer')
      if (update.exitCode !== 0) throw mappedProcessError('installing', update)

      let lockEvidence
      try {
        lockEvidence = await verifyComposerLockfile(projectPath)
      } catch {
        throw userError('GEN_LOCKFILE_INTEGRITY', 'installing', 'composer.lock does not match the reviewed Laravel/PHPUnit pins or contains an unexpected lockfile.', 'Review the local redacted Composer log and generated composer.json; retry without editing the destination.')
      }

      const install = await runComposer([
        'install', '--no-scripts', '--no-plugins', '--no-interaction', '--prefer-dist', '--no-progress',
      ], projectPath, stage, phpTool!, composerPhar!, dirs, log, 'composer-locked-install', options.signal)
      const installOutcome = checkOutcome('composer-install', install)
      validations.push(installOutcome)
      emitValidation(emit, installOutcome, 'composer')
      if (install.exitCode !== 0) throw mappedProcessError('installing', install)

      const installedLock = await verifyComposerLockfile(projectPath).catch(() => undefined)
      if (!installedLock || installedLock.sha256 !== lockEvidence.sha256) {
        throw userError('GEN_LOCKFILE_INTEGRITY', 'installing', 'composer.lock changed or failed verification during locked installation.', 'Review the redacted Composer log and retry in a new destination.')
      }
      const integrity: ValidationOutcome = {
        id: 'lockfile-integrity',
        status: 'pass',
        message: `composer.lock pins Laravel ${lockEvidence.frameworkVersion}, PHPUnit ${lockEvidence.phpunitVersion}, and ${lockEvidence.packageCount} resolved packages (SHA-256 ${lockEvidence.sha256}).`,
        exitCode: 0,
      }
      validations.push(integrity)
      emitValidation(emit, integrity, 'composer')
      generatedFiles.push('composer.lock')
      stageFinish('installing', 'passed')
    } else if (isPython) {
      const lock = await runUv(['lock', '--python', pythonExecutable!.executablePath], projectPath, stage, uvExecutable!, pythonExecutable!, dirs, log, 'uv-lock', options.signal)
      const lockOutcome = checkOutcome('uv-lock', lock)
      validations.push(lockOutcome)
      emitValidation(emit, lockOutcome, 'uv')
      if (lock.exitCode !== 0) throw mappedProcessError('installing', lock)

      let lockHash: string
      try {
        lockHash = await verifyUvLockfile(projectPath)
      } catch {
        throw userError('GEN_LOCKFILE_INTEGRITY', 'installing', 'uv.lock is missing pinned package versions or SHA-256 integrity hashes.', 'Review the generated uv.lock and retry with a supported uv version.')
      }
      const lockCheck = await runUv(['lock', '--check', '--python', pythonExecutable!.executablePath], projectPath, stage, uvExecutable!, pythonExecutable!, dirs, log, 'uv-lock-check', options.signal)
      if (lockCheck.exitCode !== 0) throw mappedProcessError('installing', lockCheck)

      const install = await runUv(['sync', '--locked', '--extra', 'test', '--python', pythonExecutable!.executablePath], projectPath, stage, uvExecutable!, pythonExecutable!, dirs, log, 'uv-locked-sync', options.signal)
      const installOutcome = checkOutcome('dependency-install', install)
      validations.push(installOutcome)
      emitValidation(emit, installOutcome, 'uv')
      if (install.exitCode !== 0) throw mappedProcessError('installing', install)

      const integrity: ValidationOutcome = { id: 'dependency-integrity', status: 'pass', message: 'uv locked sync verified package artifact hashes against uv.lock.', exitCode: 0 }
      validations.push(integrity)
      emitValidation(emit, integrity, 'uv')
      const finalLockHash = await verifyUvLockfile(projectPath)
      if (finalLockHash !== lockHash) throw userError('GEN_LOCKFILE_INTEGRITY', 'installing', 'uv.lock changed during locked dependency installation.', 'Review the local redacted job log and retry.')
      const lockIntegrity: ValidationOutcome = { id: 'lockfile-integrity', status: 'pass', message: `uv.lock pins exact direct versions and SHA-256 artifact hashes (lock SHA-256 ${lockHash}).`, exitCode: 0 }
      validations.push(lockIntegrity)
      emitValidation(emit, lockIntegrity, 'uv')
      generatedFiles.push('uv.lock')
      stageFinish('installing', 'passed')
    } else {
      // ponytail: clean Angular 21 scaffold crashes npm 10.9.8 Arborist; remove when ordinary install passes on pinned toolchain.
      const legacyPeerHandling = resolved.recipe.styling === 'styling.bootstrap' || resolved.recipe.frontend === 'frontend.angular'
      const manager = packageManager(resolved.recipe.manager)
      const install = manager.id === 'npm'
        ? await runNpm(['install', ...(legacyPeerHandling ? ['--legacy-peer-deps'] : []), '--package-lock=true'], projectPath, stage, npmTool!.cliPath, npmRootFromCli(npmTool!.cliPath), dirs, log, 'project-dependency-install', options.signal)
        : managerCliPath
          ? await runPinnedPackageManager(manager, managerCliPath, projectPath, stage, dirs, log, options.signal)
          : (() => { throw userError('GEN_PACKAGE_MANAGER_INTEGRITY', 'installing', `Pinned ${manager.id} executable was not staged.`, 'Retry with the verified catalog package-manager pin.') })()
      validations.push(checkOutcome('dependency-install', install))
      if (install.exitCode !== 0) throw mappedProcessError('installing', install)
      await verifyDependencyPins(projectPath, resolved.recipe.dependencies ?? [])
      if (isDatabaseBackend || isPostgresBackend || isNestPostgres || isFullstack) {
        const migrationCwd = isFullstack ? win32.join(projectPath, 'apps', 'api') : projectPath
        const migration = await runAppScript(
          win32.join(projectPath, 'node_modules', 'drizzle-kit', 'bin.cjs'),
          ['generate'], migrationCwd, stage, dirs, options.signal, log, 'drizzle-migration-generation', projectPath,
        )
        const migrationOutcome = checkOutcome('migration-generation', migration)
        validations.push(migrationOutcome)
        emitValidation(emit, migrationOutcome, isPostgresBackend || isNestPostgres ? 'data-access.drizzle-postgresql' : 'data-access.drizzle-sqlite')
        if (migration.exitCode !== 0) throw mappedProcessError('installing', migration)
        const migrationRoot = win32.join(projectPath, ...(isFullstack ? ['apps', 'api', 'drizzle'] : ['drizzle']))
        const migrationFiles = await listRegularFiles(migrationRoot)
        if (!migrationFiles.some((file) => /^\d{4}_.+\.sql$/.test(file))
          || !migrationFiles.includes('meta/_journal.json')
           || !migrationFiles.some((file) => /^meta\/\d{4}_(?:.+_)?snapshot\.json$/.test(file))) {
          throw userError('GEN_LOCKFILE_INTEGRITY', 'installing', 'Drizzle Kit did not produce a SQL migration, journal, and schema snapshot.', 'Review the pinned Drizzle schema/config and retry in a new destination.')
        }
        generatedFiles.push(...migrationFiles.map((file) => `${isFullstack ? 'apps/api/' : ''}drizzle/${file}`))
      }
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
    }

    stageStart('validating')
    throwIfCancelled(options.signal, currentStage)
    if (isGin) {
      const moduleResult = await runGo(['mod', 'edit', '-json'], projectPath, stage, goTool!, dirs, log, 'go-module-validation', options.signal)
      if (moduleResult.exitCode !== 0) throw mappedProcessError('validating', moduleResult)
      let module: { Module?: { Path?: string }; Go?: string }
      try { module = JSON.parse(moduleResult.stdout) as typeof module } catch { throw userError('GEN_VALIDATE_FAILED', 'validating', 'Go Modules metadata could not be parsed.', 'Review the generated go.mod and retry.') }
      if (module.Module?.Path !== selection.backend?.modulePath || module.Go !== GIN_GO_MINIMUM) {
        throw userError('GEN_MODULE_INTEGRITY', 'validating', `Gin module must declare the requested path and Go ${GIN_GO_MINIMUM}.`, 'Review the generated go.mod and retry.')
      }
      await verifyGinPinnedFiles(projectPath, selection.backend!.modulePath!)
      const moduleOutcome: ValidationOutcome = { id: 'go-module', status: 'pass', message: `Go module path and Go ${GIN_GO_MINIMUM} minimum match the reviewed Gin recipe.`, exitCode: 0 }
      validations.push(moduleOutcome)
      emitValidation(emit, moduleOutcome, recipeOwnerId)
    } else if (isGo) {
      const moduleResult = await runGo(['mod', 'edit', '-json'], projectPath, stage, goTool!, dirs, log, 'go-module-validation', options.signal)
      if (moduleResult.exitCode !== 0) throw mappedProcessError('validating', moduleResult)
      let module: { Module?: { Path?: string }; Go?: string }
      try { module = JSON.parse(moduleResult.stdout) as typeof module } catch { throw userError('GEN_VALIDATE_FAILED', 'validating', 'Go Modules metadata could not be parsed.', 'Review the generated go.mod and retry.') }
      if (!module.Module || module.Module.Path !== selection.backend?.modulePath || module.Go !== '1.22.0') {
        throw userError('GEN_VALIDATE_FAILED', 'validating', 'Go Modules metadata does not match the reviewed module path and Go minimum.', 'Review the generated go.mod and retry.')
      }
      try {
        await access(win32.join(projectPath, 'go.sum'))
        throw userError('GEN_VALIDATE_FAILED', 'validating', 'Unexpected go.sum was created for a standard-library-only project.', 'Review the generated module files and retry.')
      } catch (error) {
        if (error instanceof GeneratorError) throw error
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
      const moduleOutcome: ValidationOutcome = { id: 'go-module', status: 'pass', message: 'go.mod parsed with the requested module path; no external dependencies or go.sum.', exitCode: 0 }
      validations.push(moduleOutcome)
      emitValidation(emit, moduleOutcome, recipeOwnerId)
    }
    const checks: { id: string; path?: string; args: string[]; cwd?: string }[] = isFullstack
      ? [
        { id: 'api-typecheck', path: win32.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc'), args: ['--project', 'apps/api/tsconfig.json', '--noEmit'] },
        { id: 'web-typecheck', path: win32.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc'), args: ['--project', 'apps/web/tsconfig.json', '--noEmit'] },
        { id: 'lint', path: win32.join(projectPath, 'node_modules', 'eslint', 'bin', 'eslint.js'), args: ['apps/api/src', 'apps/api/test', 'apps/web/src'] },
        { id: 'unit-tests', path: win32.join(projectPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), args: ['--test', 'apps/api/test/backend.test.ts'] },
        { id: 'database-safety-tests', path: win32.join(projectPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), args: ['--test', 'apps/api/test/database.test.ts'] },
        { id: 'frontend-client-tests', path: win32.join(projectPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), args: ['--test', 'apps/web/src/services/items.test.ts'] },
        { id: 'graceful-shutdown', path: win32.join(projectPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), args: ['--test', 'apps/api/test/shutdown.test.ts'] },
        { id: 'api-build', path: win32.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc'), args: ['--project', 'apps/api/tsconfig.json'] },
        { id: 'web-build', path: win32.join(projectPath, 'node_modules', 'vite', 'bin', 'vite.js'), args: ['build'], cwd: win32.join(projectPath, 'apps', 'web') },
      ]
      : isNestPostgres
      ? [
        { id: 'typecheck', path: win32.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc'), args: ['--project', 'tsconfig.json', '--noEmit'] },
        { id: 'lint', path: win32.join(projectPath, 'node_modules', 'eslint', 'bin', 'eslint.js'), args: ['src', 'test'] },
        { id: 'unit-tests', path: win32.join(projectPath, 'node_modules', 'jest', 'bin', 'jest.js'), args: ['--runInBand'] },
        { id: 'database-safety-tests', path: win32.join(projectPath, 'node_modules', 'jest', 'bin', 'jest.js'), args: ['--runInBand', '--runTestsByPath', 'src/app.controller.spec.ts'] },
        { id: 'e2e-tests', path: win32.join(projectPath, 'node_modules', 'jest', 'bin', 'jest.js'), args: ['--config', 'test/jest-e2e.json', '--runInBand', '--testPathIgnorePatterns', 'shutdown.e2e-spec.ts'] },
        { id: 'graceful-shutdown', path: win32.join(projectPath, 'node_modules', 'jest', 'bin', 'jest.js'), args: ['--config', 'test/jest-e2e.json', '--runInBand', '--runTestsByPath', 'test/shutdown.e2e-spec.ts'] },
        { id: 'build', path: win32.join(projectPath, 'node_modules', '@nestjs', 'cli', 'bin', 'nest.js'), args: ['build'] },
      ]
      : isPostgresBackend
      ? [
        { id: 'typecheck', path: win32.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc'), args: ['--project', 'tsconfig.json', '--noEmit'] },
        { id: 'lint', path: win32.join(projectPath, 'node_modules', 'eslint', 'bin', 'eslint.js'), args: ['src', 'test'] },
        { id: 'unit-tests', path: win32.join(projectPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), args: ['--test', 'test/backend.test.ts'] },
        { id: 'database-safety-tests', path: win32.join(projectPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), args: ['--test', 'test/database.test.ts'] },
        { id: 'graceful-shutdown', path: win32.join(projectPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), args: ['--test', 'test/shutdown.test.ts'] },
        { id: 'build', path: win32.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc'), args: ['--project', 'tsconfig.json'] },
      ]
      : isDatabaseBackend
      ? [
        { id: 'typecheck', path: win32.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc'), args: ['--project', 'tsconfig.json', '--noEmit'] },
        { id: 'lint', path: win32.join(projectPath, 'node_modules', 'eslint', 'bin', 'eslint.js'), args: ['src', 'test'] },
        { id: 'unit-tests', path: win32.join(projectPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), args: ['--test', 'test/backend.test.ts'] },
        { id: 'database-integration-tests', path: win32.join(projectPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), args: ['--test', 'test/database.test.ts'] },
        { id: 'graceful-shutdown', path: win32.join(projectPath, 'node_modules', 'tsx', 'dist', 'cli.mjs'), args: ['--test', 'test/shutdown.test.ts'] },
        { id: 'build', path: win32.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc'), args: ['--project', 'tsconfig.json'] },
      ]
      : isNest
      ? [
        { id: 'typecheck', path: win32.join(projectPath, 'node_modules', 'typescript', 'bin', 'tsc'), args: ['--project', 'tsconfig.json', '--noEmit'] },
        { id: 'lint', path: win32.join(projectPath, 'node_modules', 'eslint', 'bin', 'eslint.js'), args: ['src', 'test'] },
        { id: 'unit-tests', path: win32.join(projectPath, 'node_modules', 'jest', 'bin', 'jest.js'), args: ['--runInBand'] },
        { id: 'e2e-tests', path: win32.join(projectPath, 'node_modules', 'jest', 'bin', 'jest.js'), args: ['--config', 'test/jest-e2e.json', '--runInBand', '--testPathIgnorePatterns', 'shutdown.e2e-spec.ts'] },
        { id: 'graceful-shutdown', path: win32.join(projectPath, 'node_modules', 'jest', 'bin', 'jest.js'), args: ['--config', 'test/jest-e2e.json', '--runInBand', '--runTestsByPath', 'test/shutdown.e2e-spec.ts'] },
        { id: 'build', path: win32.join(projectPath, 'node_modules', '@nestjs', 'cli', 'bin', 'nest.js'), args: ['build'] },
      ]
      : isLaravel
      ? [
        { id: 'php-lint-bootstrap', args: ['-l', 'bootstrap/app.php'] },
        { id: 'php-lint-database', args: ['-l', 'config/database.php'] },
        { id: 'php-lint-filesystems', args: ['-l', 'config/filesystems.php'] },
        { id: 'php-lint-routes', args: ['-l', 'routes/api.php'] },
        { id: 'php-lint-model', args: ['-l', 'app/Models/ProjectNote.php'] },
        { id: 'php-lint-migration', args: ['-l', 'database/migrations/2026_11_15_000000_create_project_notes_table.php'] },
        { id: 'php-lint-tests', args: ['-l', 'tests/Feature/ApiTest.php'] },
        { id: 'artisan-version', args: ['artisan', '--version'] },
        { id: 'artisan-route-list', args: ['artisan', 'route:list', '--json'] },
        { id: 'phpunit', args: ['vendor/phpunit/phpunit/phpunit', '--configuration', 'phpunit.xml'] },
      ]
      : isPython
      ? [
        { id: 'python-syntax', args: ['run', '--locked', '--no-sync', '--extra', 'test', '--python', pythonExecutable!.executablePath, 'python', '-m', 'compileall', '-q', 'app', 'tests'] },
        { id: 'pytest', args: ['run', '--locked', '--no-sync', '--extra', 'test', '--python', pythonExecutable!.executablePath, 'pytest', 'tests/test_health.py', 'tests/test_info.py'] },
        { id: 'graceful-shutdown', args: ['run', '--locked', '--no-sync', '--extra', 'test', '--python', pythonExecutable!.executablePath, 'pytest', 'tests/test_shutdown.py'] },
      ]
      : isGin
      ? [
        { id: 'gofmt', args: ['-w', 'cmd/server/main.go', 'internal/server/server.go', 'internal/server/server_test.go'] },
        { id: 'go-vet', args: ['vet', './...'] },
        { id: 'go-test', args: ['test', './...'] },
        { id: 'go-build', args: ['build', './...'] },
      ]
      : isGo
      ? [
        { id: 'go-fmt', args: ['fmt', './...'] },
        { id: 'go-vet', args: ['vet', './...'] },
        { id: 'go-test', args: ['test', './...'] },
        { id: 'go-build', args: ['build', './...'] },
      ]
      : resolved.recipe.projectType === 'backend'
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
      const result = isLaravel
        ? await runPhp(check.args, projectPath, stage, phpTool!, dirs, log, check.id, options.signal)
        : isPython
        ? await runUv(check.args, projectPath, stage, uvExecutable!, pythonExecutable!, dirs, log, check.id, options.signal)
        : isGin && check.id === 'gofmt'
        ? await runGofmt(check.args, projectPath, stage, goTool!, dirs, log, options.signal)
        : usesGo
        ? await runGo(check.args, projectPath, stage, goTool!, dirs, log, check.id, options.signal)
        : await runAppScript(check.path!, check.args, check.cwd ?? projectPath, stage, dirs, options.signal, log, check.id, projectPath)
      let outcome = checkOutcome(check.id, result)
      if (isLaravel && result.exitCode === 0 && check.id === 'artisan-version'
        && !result.stdout.includes(`Laravel Framework ${LARAVEL_PINS.framework}`)) {
        outcome = { id: check.id, status: 'fail', message: `Artisan did not report Laravel Framework ${LARAVEL_PINS.framework}.`, exitCode: result.exitCode }
      }
      if (isLaravel && result.exitCode === 0 && check.id === 'artisan-route-list') {
        try {
          const routes = JSON.parse(result.stdout.trim()) as { uri?: string; method?: string }[]
          const expected = [
            ['health', 'GET'],
            ['api/info', 'GET'],
            ['api/notes', 'POST'],
          ] as const
          const routeListValid = routes.length === expected.length
            && expected.every(([uri, method]) => routes.some((route) => route.uri === uri && route.method?.split('|').includes(method)))
          if (!routeListValid) outcome = { id: check.id, status: 'fail', message: 'Artisan route list omitted a required health/info/notes route or HTTP method.', exitCode: result.exitCode }
        } catch {
          outcome = { id: check.id, status: 'fail', message: 'Artisan route list did not return valid JSON.', exitCode: result.exitCode }
        }
      }
      validations.push(outcome)
      emitValidation(emit, outcome, recipeOwnerId)
      if (outcome.status !== 'pass') {
        if (result.exitCode !== 0) throw mappedProcessError('validating', result)
        throw userError('GEN_VALIDATE_FAILED', 'validating', outcome.message, 'Review the generated Laravel version, API routes, and PHPUnit output before retrying.')
      }
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
    const smokeOutcomes = isLaravel
      ? [await servedLaravelSmoke(projectPath, stage, phpTool!, dirs, options.signal, log)]
      : isPython
      ? await servedFastApiSmoke(projectPath, stage, dirs, uvExecutable!, pythonExecutable!, options.signal, log)
      : [usesGo
        ? await servedGoBackendSmoke(projectPath, stage, dirs, goTool!, selection.project.name, options.signal, log)
        : resolved.recipe.projectType === 'backend'
             ? await servedBackendSmoke(projectPath, stage, dirs, options.signal, log, isNest, isDatabaseBackend, isPostgresBackend || isNestPostgres)
      : isFullstack
        ? await servedFullstackSmoke(projectPath, stage, dirs, options.signal, log)
        : await servedPageSmoke(projectPath, stage, dirs, resolved.recipe.frontend!, options.signal, log)]
    validations.push(...smokeOutcomes)
    for (const smoke of smokeOutcomes) emitValidation(emit, smoke, recipeOwnerId)
    const allPassed = validations.every((item) => item.status === 'pass'
      || (selection.template !== undefined && item.id === 'lint' && item.status === 'skipped'))
    if (!allPassed) throw userError('GEN_VALIDATE_FAILED', 'validating', 'One or more required checks did not pass.', 'Review the local redacted job log and retry.')
    if (isGin) {
      await verifyGinPinnedFiles(projectPath, selection.backend!.modulePath!)
      await writeGinProjectManifest(stage, resolved, goTool!.version, validations, generatedFiles)
    }
    else if (isGo) await writeGoProjectManifest(stage, resolved, goTool!.version, validations, generatedFiles)
    else if (isLaravel) await writeLaravelProjectManifest(stage, resolved, phpVersion!, composerVersion!, await verifyComposerLockfile(projectPath), validations, generatedFiles)
    else if (isPython) await writeFastApiProjectManifest(stage, resolved, pythonVersion!, uvVersion!, await verifyUvLockfile(projectPath), validations, generatedFiles)
    else await writeProjectManifest(stage, resolved, process.version.replace(/^v/, ''), npmTool!, validations, generatedFiles, formaEvidence)
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
