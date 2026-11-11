import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { access, lstat, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, win32 } from 'node:path'
import { GeneratorError, asGeneratorError } from './errors.js'
import { runDoctor } from './doctor.js'
import { createPlan } from './plan.js'
import { writeProjectDocs, writeProjectManifest } from './project-docs.js'
import { runNodeProcess, startNodeProcess, type ProcessResult, type SafeProcessOptions } from './runner.js'
import { createOwnedStage, cleanupOwnedStage, cleanupStageSupportFiles, moveDirectoryNoReplace, type OwnedStage } from './staging.js'
import { resolveNpmTool, supportsNpm } from './toolchain.js'
import { resolveSelection } from './resolver.js'
import type { DoctorReport, JobEventV1, JobStatus, ProjectSelectionV1, RecipeManifestV1, ResolvedSelection, StageId, ValidationOutcome } from './types.js'

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
  installing: 'npm',
  finalizing: 'core',
}

function stageOwner(stage: StageId, frontendId: string): string {
  return fixedStageOwners[stage] ?? frontendId
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
    return userError('GEN_TOOL_UNSUPPORTED', 'preflight', 'Active Node.js version does not satisfy this recipe.', 'Install a supported Node.js version, restart the CLI, and rerun doctor.')
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
    installing: { code: 'GEN_INSTALL_FAILED', message: `npm install exited with code ${result.exitCode}.`, nextAction: 'Check npm registry/network access and review the local redacted job log.' },
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
  for (const directory of [tools, home, temp, cache]) await mkdir(directory)
  await mkdir(win32.join(home, 'AppData', 'Roaming'), { recursive: true })
  await mkdir(win32.join(home, 'AppData', 'Local'), { recursive: true })
  await writeFile(userConfig, 'registry=https://registry.npmjs.org/\n', { flag: 'wx' })
  await writeFile(globalConfig, 'registry=https://registry.npmjs.org/\n', { flag: 'wx' })
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

async function checkScaffoldIdentity(projectPath: string, projectName: string): Promise<void> {
  try {
    const entry = await lstat(projectPath)
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new Error('Not a regular project directory.')
    const manifest = JSON.parse(await readFile(win32.join(projectPath, 'package.json'), 'utf8')) as { name?: unknown }
    if (manifest.name !== projectName) throw new Error('Package identity does not match the requested project name.')
  } catch {
    throw userError('GEN_SCAFFOLD_INVALID', 'scaffolding', 'Official scaffold output is missing or project identity is incorrect.', 'Review the local redacted job log and retry.')
  }
}

async function checkToolPin(tools: string, recipe: RecipeManifestV1): Promise<string> {
  const lockPath = win32.join(tools, 'package-lock.json')
  try {
    const lock = JSON.parse(await readFile(lockPath, 'utf8')) as { packages?: Record<string, { version?: string; integrity?: string }> }
    const installed = lock.packages?.[`node_modules/${recipe.scaffold.packageName}`]
    if (!installed || installed.version !== recipe.scaffold.version || installed.integrity !== recipe.scaffold.integrity) throw new Error('Pinned scaffold lock entry does not match expected metadata.')
    const binPath = win32.join(tools, 'node_modules', recipe.scaffold.packageName, recipe.scaffold.binPath)
    await access(binPath)
    return binPath
  } catch {
    throw userError('GEN_SCAFFOLD_INTEGRITY', 'scaffolding', 'Pinned scaffold version or package integrity did not match the reviewed catalog.', 'Check npm registry integrity and retry; no target project was committed.')
  }
}

async function writeToolPackage(tools: string, name: string, version: string): Promise<void> {
  await writeFile(win32.join(tools, 'package.json'), JSON.stringify({ name: 'project-generator-staging-tools', private: true, version: '0.0.0', dependencies: { [name]: version } }, null, 2), { flag: 'wx' })
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

function checkOutcome(id: string, result: ProcessResult): ValidationOutcome {
  return {
    id,
    status: result.exitCode === 0 ? 'pass' : 'fail',
    message: result.exitCode === 0 ? 'Command completed successfully.' : `Command exited with code ${result.exitCode}.`,
    exitCode: result.exitCode,
  }
}

function emitValidation(emit: ReturnType<typeof createEventEmitter>, outcome: ValidationOutcome, frontendId: string): void {
  emit({ type: 'validation', stageId: 'validating', stageOwner: frontendId, stageStatus: outcome.status === 'pass' ? 'passed' : 'failed', message: `${outcome.id}: ${outcome.message}`, ...(outcome.status === 'fail' ? { code: 'GEN_VALIDATE_FAILED' } : {}) })
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
  recipeId: 'FE-01' | 'FE-02',
  signal: AbortSignal | undefined,
  log: JobLog,
): Promise<ValidationOutcome> {
  const port = await freePort()
  const cliPath = recipeId === 'FE-01'
    ? win32.join(projectPath, 'node_modules', 'vite', 'bin', 'vite.js')
    : win32.join(projectPath, 'node_modules', 'next', 'dist', 'bin', 'next')
  const args = recipeId === 'FE-01'
    ? ['preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
    : ['start', '--hostname', '127.0.0.1', '--port', String(port)]
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

async function executeScaffold(
  stage: OwnedStage,
  resolved: ResolvedSelection,
  npmCliPath: string,
  dirs: { tools: string; home: string; temp: string; cache: string; userConfig: string; globalConfig: string },
  log: JobLog,
  signal?: AbortSignal,
): Promise<void> {
  const npmRoot = npmRootFromCli(npmCliPath)
  await writeToolPackage(dirs.tools, resolved.recipe.scaffold.packageName, resolved.recipe.scaffold.version)
  const scaffoldInstall = await runNpm([
    'install', '--prefix', dirs.tools, '--package-lock=true', '--ignore-scripts',
    `${resolved.recipe.scaffold.packageName}@${resolved.recipe.scaffold.version}`,
  ], stage.path, stage, npmCliPath, npmRoot, dirs, log, 'scaffold-package-install', signal)
  if (scaffoldInstall.exitCode !== 0) throw mappedProcessError('scaffolding', scaffoldInstall)
  const scaffoldBin = await checkToolPin(dirs.tools, resolved.recipe)
  const scaffold = await runNodeProcess({
    scriptPath: scaffoldBin,
    allowedScriptRoot: dirs.tools,
    cwd: stage.path,
    allowedCwdRoot: stage.path,
    args: [resolved.selection.project.name, ...resolved.recipe.scaffoldArgs],
    homeDirectory: dirs.home,
    tempDirectory: dirs.temp,
    ...(signal ? { signal } : {}),
    timeoutMs: 5 * 60 * 1000,
  })
  log.process('pinned-official-scaffold', scaffold, [stage.parentPath, stage.path, stage.targetPath, dirs.home, dirs.temp, tmpdir()])
  if (scaffold.exitCode !== 0) throw mappedProcessError('scaffolding', scaffold)
}

async function generateInJob(selection: ProjectSelectionV1, options: GenerateOptions, emit: ReturnType<typeof createEventEmitter>, log: JobLog, jobId: string): Promise<GenerateResult> {
  let stage: OwnedStage | undefined
  let committed = false
  let currentStage: StageId = 'preflight'
  const validations: ValidationOutcome[] = []
  const resolved = resolveSelection(selection)
  const stageStart = (id: StageId): void => { currentStage = id; emit({ type: 'stage-started', stageId: id, stageOwner: stageOwner(id, resolved.recipe.frontend), stageStatus: 'running', message: `${id} started.` }) }
  const stageFinish = (id: StageId, status: 'passed' | 'failed' | 'skipped', message = `${id} completed.`): void => { emit({ type: 'stage-finished', stageId: id, stageOwner: stageOwner(id, resolved.recipe.frontend), stageStatus: status, message }) }

  emit({ type: 'job-started', stageOwner: 'core', status: 'running', message: `Generation job ${jobId} started.` })
  emit({ type: 'warning', stageOwner: 'core', code: 'GEN_LIFECYCLE_SCRIPTS', message: 'npm install can execute third-party lifecycle scripts; execution is not sandboxed.' })
  try {
    stageStart('preflight')
    throwIfCancelled(options.signal, currentStage)
    if (resolved.recipe.status !== 'tested' && !(options.allowPlanned && resolved.recipe.status === 'planned')) {
      throw userError('GEN_RECIPE_UNTESTED', 'preflight', `${resolved.recipe.id} is planned and disabled for normal generation.`, 'Use a tested recipe; development-only runs do not change recipe status.')
    }
    const doctor = await runDoctor(selection)
    if (!doctor.ready) throw preflightError(doctor)
    const npmTool = await resolveNpmTool()
    if (!npmTool || !supportsNpm(npmTool.version)) throw userError('GEN_TOOL_MISSING', 'preflight', 'Trusted npm CLI is missing or unsupported.', 'Install Node.js with npm 10 or newer and rerun doctor.')
    stageFinish('preflight', 'passed')

    stageStart('staging')
    throwIfCancelled(options.signal, currentStage)
    const target = doctor.target
    stage = await createOwnedStage(win32.dirname(target.path), target.path, selection.project.name, jobId)
    const dirs = await prepareDirectories(stage)
    stageFinish('staging', 'passed')

    stageStart('scaffolding')
    throwIfCancelled(options.signal, currentStage)
    await executeScaffold(stage, resolved, npmTool.cliPath, dirs, log, options.signal)
    const projectPath = stage.childPath
    await checkScaffoldIdentity(projectPath, selection.project.name)
    const identityOutcome: ValidationOutcome = { id: 'scaffold-identity', status: 'pass', message: 'Generated package identity matches the requested name.' }
    validations.push(identityOutcome)
    emit({ type: 'validation', stageId: 'scaffolding', stageOwner: resolved.recipe.frontend, stageStatus: 'passed', message: identityOutcome.message })
    stageFinish('scaffolding', 'passed')

    stageStart('configuring')
    throwIfCancelled(options.signal, currentStage)
    const generatedFiles = await writeProjectDocs(projectPath, resolved, process.version.replace(/^v/, ''), npmTool)
    stageFinish('configuring', 'passed')

    stageStart('installing')
    throwIfCancelled(options.signal, currentStage)
    const unexpectedNpmrc = win32.join(projectPath, '.npmrc')
    try {
      await lstat(unexpectedNpmrc)
      throw userError('GEN_PATH_UNSAFE', 'installing', 'Scaffold produced a project .npmrc; refusing to read untrusted registry or credential configuration.', 'Inspect the scaffold output and retry with a reviewed version.')
    } catch (error) {
      if (error instanceof GeneratorError) throw error
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    const install = await runNpm(['install', '--package-lock=true'], projectPath, stage, npmTool.cliPath, npmRootFromCli(npmTool.cliPath), dirs, log, 'project-dependency-install', options.signal)
    validations.push(checkOutcome('dependency-install', install))
    if (install.exitCode !== 0) throw mappedProcessError('installing', install)
    emit({ type: 'validation', stageId: 'installing', stageOwner: 'npm', stageStatus: 'passed', message: 'npm dependency install passed; package lifecycle scripts were allowed.' })
    stageFinish('installing', 'passed')

    stageStart('validating')
    throwIfCancelled(options.signal, currentStage)
    const checks: { id: string; path: string; args: string[] }[] = resolved.recipe.id === 'FE-01'
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
      emitValidation(emit, outcome, resolved.recipe.frontend)
      if (result.exitCode !== 0) throw mappedProcessError('validating', result)
    }
    throwIfCancelled(options.signal, currentStage)
    const smoke = await servedPageSmoke(projectPath, stage, dirs, resolved.recipe.id, options.signal, log)
    validations.push(smoke)
    emitValidation(emit, smoke, resolved.recipe.frontend)
    const allPassed = validations.every((item) => item.status === 'pass')
    if (!allPassed) throw userError('GEN_VALIDATE_FAILED', 'validating', 'One or more required checks did not pass.', 'Review the local redacted job log and retry.')
    await writeProjectManifest(projectPath, resolved, process.version.replace(/^v/, ''), npmTool, validations, generatedFiles)
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
    const detail = new GeneratorError({
      ...original.toJSON(),
      stage: currentStage,
      targetModified: committed,
    }, { cause: original })
    stageFinish(currentStage, detail.code === 'GEN_CANCELLED' ? 'skipped' : 'failed', detail.message)
    emit({ type: detail.code === 'GEN_CANCELLED' ? 'warning' : 'error', stageId: currentStage, stageOwner: stageOwner(currentStage, resolved.recipe.frontend), code: detail.code, message: detail.message })
    if (stage && !committed && detail.code === 'GEN_PROCESS_TREE_UNCONFIRMED') {
      emit({ type: 'warning', stageId: 'staging', stageOwner: 'core', code: 'GEN_STAGING_LEFTOVER', message: 'Owned staging was retained because process-tree termination could not be confirmed.' })
    } else if (stage && !committed) {
      try {
        await cleanupOwnedStage(stage)
      } catch {
        emit({ type: 'warning', stageId: 'staging', stageOwner: 'core', code: 'GEN_STAGING_LEFTOVER', message: 'Owned staging was retained because cleanup could not be verified safely.' })
      }
    }
    const status = detail.code === 'GEN_CANCELLED' ? 'cancelled' : 'failed'
    emit({ type: 'job-finished', stageOwner: 'core', status, message: status === 'cancelled' ? 'Generation cancelled; cleanup attempted.' : 'Generation failed; final destination was not committed.', code: detail.code })
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
