import { randomUUID } from 'node:crypto'
import type { ChildProcess } from 'node:child_process'
import { closeSync, openSync } from 'node:fs'
import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, win32 } from 'node:path'
import { BUILD_PROFILE } from './build-policy.js'
import { GeneratorError } from './errors.js'
import { readSupervisorResponse, sendSupervisorRequest, spawnSupervisor, SupervisorResponseError, type SupervisorResponseStatus } from './native-supervisor.js'

export type SupervisorFailureCategory = 'process_start_failure' | 'process_nonzero_exit' | 'supervisor_operational_failure' | 'termination_unconfirmed' | 'malformed_response'
export interface SupervisorDiagnosticV1 {
  schemaVersion: 1
  type: 'supervisor-diagnostic'
  diagnosticRef: string
  jobId: string
  stageId: string
  failureCategory: SupervisorFailureCategory
  started: boolean | null
  childExitCode: number | null
  supervisorExitCode: number | null
  terminationConfirmed: boolean | null
  systemError: { category: 'access_denied' | 'not_found' | 'invalid_handle' | 'invalid_parameter' | 'resource_exhausted' | 'other' | 'unknown'; code: number | null }
  activeChildProcessCount: number | null
  supervisorResponseStatus: SupervisorResponseStatus
  timestamp: string
}

export interface SupervisorDiagnosticContext {
  jobId: string
  stageId: string
  onDiagnostic(diagnostic: SupervisorDiagnosticV1): void
  onProcessResult?(result: SupervisorProcessResultV1): void
}

export interface SupervisorProcessResultV1 {
  schemaVersion: 1
  type: 'supervisor-process-result'
  jobId: string
  stageId: string
  started: boolean | null
  childExitCode: number | null
  supervisorExitCode: number | null
  cancelled: true
  terminationConfirmed: boolean | null
  activeChildProcessCount: number | null
}

export interface SafeProcessOptions {
  scriptPath?: string
  allowedScriptRoot?: string
  executablePath?: string
  allowedExecutableRoot?: string
  cwd: string
  allowedCwdRoot: string
  args: readonly string[]
  homeDirectory: string
  tempDirectory: string
  timeoutMs?: number
  signal?: AbortSignal
  extraPath?: readonly string[]
  environment?: Readonly<Record<string, string>>
  supervisorDiagnostic?: SupervisorDiagnosticContext
}

export interface ProcessResult {
  exitCode: number
  stdout: string
  stderr: string
  truncated: boolean
  cancelled?: boolean
  timedOut?: boolean
  terminationConfirmed?: boolean
}

export interface RunningProcess {
  result: Promise<ProcessResult>
  stop(): Promise<void>
}

function processTreeError(): GeneratorError {
  return new GeneratorError({ code: 'GEN_PROCESS_TREE_UNCONFIRMED', stage: 'process', message: 'Could not confirm termination of the owned process tree.', nextAction: 'Inspect the owned staging directory only after confirming all generator child processes have exited.', targetModified: false })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeNumber(value: unknown, maximum = 0xffff_ffff): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= maximum ? value : null
}

function systemErrorCategory(code: number | null): SupervisorDiagnosticV1['systemError']['category'] {
  if (code === null) return 'unknown'
  if ([5, 1314].includes(code)) return 'access_denied'
  if ([2, 3].includes(code)) return 'not_found'
  if (code === 6) return 'invalid_handle'
  if ([87, 123].includes(code)) return 'invalid_parameter'
  if ([8, 14, 1450, 1453].includes(code)) return 'resource_exhausted'
  return 'other'
}

function safeExitCode(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= -0x8000_0000 && value <= 0x7fff_ffff ? value : null
}

function emitSupervisorDiagnostic(
  context: SupervisorDiagnosticContext | undefined,
  response: unknown,
  supervisorExitCode: number | null,
  responseStatus: SupervisorResponseStatus,
  failureCategory: SupervisorFailureCategory,
): SupervisorDiagnosticV1 | undefined {
  if (!context) return undefined
  const record = isRecord(response) ? response : undefined
  const systemErrorCode = safeNumber(record?.systemError)
  const activeCount = safeNumber(record?.activeProcesses)
  const diagnostic: SupervisorDiagnosticV1 = {
    schemaVersion: 1,
    type: 'supervisor-diagnostic',
    diagnosticRef: `supdiag-${randomUUID()}`,
    jobId: context.jobId,
    stageId: context.stageId,
    failureCategory,
    started: typeof record?.started === 'boolean' ? record.started : null,
    childExitCode: safeExitCode(record?.exitCode),
    supervisorExitCode: safeExitCode(supervisorExitCode),
    terminationConfirmed: typeof record?.terminationConfirmed === 'boolean' ? record.terminationConfirmed : null,
    systemError: { category: systemErrorCategory(systemErrorCode), code: systemErrorCode },
    activeChildProcessCount: activeCount,
    supervisorResponseStatus: responseStatus,
    timestamp: new Date().toISOString(),
  }
  try {
    context.onDiagnostic(diagnostic)
  } catch {
    // ponytail: diagnostic write failure must not change process or cancellation behavior.
  }
  return diagnostic
}

function emitCancelledProcessResult(
  context: SupervisorDiagnosticContext | undefined,
  response: Record<string, unknown> | undefined,
  supervisorExitCode: number | null,
): void {
  if (response?.cancelled !== true || !context?.onProcessResult) return
  try {
    context.onProcessResult({
      schemaVersion: 1,
      type: 'supervisor-process-result',
      jobId: context.jobId,
      stageId: context.stageId,
      started: typeof response.started === 'boolean' ? response.started : null,
      childExitCode: safeExitCode(response.exitCode),
      supervisorExitCode: safeExitCode(supervisorExitCode),
      cancelled: true,
      terminationConfirmed: typeof response.terminationConfirmed === 'boolean' ? response.terminationConfirmed : null,
      activeChildProcessCount: safeNumber(response.activeProcesses),
    })
  } catch {
    // ponytail: cancellation telemetry must not change process cleanup.
  }
}

function claimTestSupervisorStartFailure(): boolean {
  if (BUILD_PROFILE !== 'development' || process.platform !== 'win32'
    || process.env.PG_SUPERVISOR_TEST_FAULT !== 'start-failure-once') return false
  const temporaryRoot = process.env.TEMP
  const marker = process.env.PG_SUPERVISOR_TEST_FAULT_MARKER
  if (!temporaryRoot || !marker || !win32.isAbsolute(temporaryRoot) || !win32.isAbsolute(marker)
    || win32.basename(marker) !== 'phase-08a5-supervisor-fault-consumed'
    || !isWithin(win32.resolve(temporaryRoot), win32.resolve(marker))) return false
  try {
    closeSync(openSync(marker, 'wx'))
    return true
  } catch {
    return false
  }
}

function validRunResponse(response: unknown): response is Record<string, unknown> {
  if (!isRecord(response)) return false
  return typeof response.started === 'boolean'
    && safeExitCode(response.exitCode) !== null
    && typeof response.stdout === 'string'
    && typeof response.stderr === 'string'
    && typeof response.truncated === 'boolean'
    && typeof response.terminationConfirmed === 'boolean'
    && (response.activeProcesses === undefined || response.activeProcesses === null || safeNumber(response.activeProcesses) !== null)
    && (response.systemError === undefined || response.systemError === null || safeNumber(response.systemError) !== null)
}

export function processSupervisorResponse(
  response: unknown,
  supervisorExitCode: number | null,
  diagnosticContext?: SupervisorDiagnosticContext,
  responseStatus: SupervisorResponseStatus = 'received',
): ProcessResult {
  if (responseStatus !== 'received') {
    emitSupervisorDiagnostic(diagnosticContext, response, supervisorExitCode, responseStatus,
      responseStatus === 'malformed' ? 'malformed_response' : 'supervisor_operational_failure')
    throw processTreeError()
  }

  const record = isRecord(response) ? response : undefined
  emitCancelledProcessResult(diagnosticContext, record, supervisorExitCode)
  const errorPresent = record?.error !== null && record?.error !== undefined
  let category: SupervisorFailureCategory | undefined
  if (record?.terminationConfirmed === false) category = 'termination_unconfirmed'
  else if (!validRunResponse(response)) category = 'malformed_response'
  else if (errorPresent && record?.started === false) category = 'process_start_failure'
  else if (errorPresent) category = 'supervisor_operational_failure'
  else if (record?.started === false) category = 'malformed_response'
  else if (record?.exitCode !== 0) category = 'process_nonzero_exit'
  else if (supervisorExitCode !== 0) category = 'supervisor_operational_failure'
  if (category) emitSupervisorDiagnostic(diagnosticContext, response, supervisorExitCode,
    category === 'malformed_response' ? 'malformed' : 'received', category)

  if (record?.terminationConfirmed !== true) throw processTreeError()
  if (!validRunResponse(response)) throw processTreeError()
  if (errorPresent) {
    if (record.error === 'elevated caller is not allowed') {
      throw new GeneratorError({ code: 'GEN_ELEVATED_CALLER', stage: 'process', message: 'Generation is blocked in an elevated Windows session.', nextAction: 'Start Project Generator without administrator elevation and retry.', targetModified: false })
    }
    throw new GeneratorError({ code: 'GEN_PROCESS_SUPERVISOR_FAILED', stage: 'process', message: 'Windows supervisor could not complete the owned process tree safely.', nextAction: 'Leave staging untouched if termination was not confirmed; inspect the redacted job log before retrying.', targetModified: false })
  }
  if (supervisorExitCode !== 0) throw processTreeError()
  return {
    exitCode: record.exitCode as number,
    stdout: record.stdout as string,
    stderr: record.stderr as string,
    truncated: record.truncated as boolean,
    cancelled: record.cancelled === true,
    timedOut: record.timedOut === true,
    terminationConfirmed: true,
  }
}

function isWithin(root: string, candidate: string): boolean {
  const pathApi = process.platform === 'win32' ? win32 : undefined
  const rel = pathApi ? pathApi.relative(root, candidate) : relative(root, candidate)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${pathApi ? '\\' : '/'}`))
}

async function checkedFile(file: string, root: string): Promise<string> {
  const [realRoot, realFile, entry] = await Promise.all([realpath(root), realpath(file), lstat(file)])
  if (!entry.isFile() || entry.isSymbolicLink() || !isWithin(realRoot, realFile)) {
    throw new GeneratorError({ code: 'GEN_RUNNER_BLOCKED', stage: 'process', message: 'Refused an executable outside its reviewed package directory.', nextAction: 'Reinstall the verified toolchain and retry.', targetModified: false })
  }
  return realFile
}

async function checkedDirectory(directory: string, root: string): Promise<string> {
  const [realRoot, realDirectory, entry] = await Promise.all([realpath(root), realpath(directory), lstat(directory)])
  if (!entry.isDirectory() || entry.isSymbolicLink() || !isWithin(realRoot, realDirectory)) {
    throw new GeneratorError({ code: 'GEN_RUNNER_BLOCKED', stage: 'process', message: 'Refused a process working directory outside owned staging.', nextAction: 'Retry generation in a new destination.', targetModified: false })
  }
  return realDirectory
}

function processEnvironment(home: string, temp: string, cwd: string, extraPath: readonly string[] = [], overrides: Readonly<Record<string, string>> = {}): NodeJS.ProcessEnv {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
  const system32 = win32.join(systemRoot, 'System32')
  const nodeDirectory = dirname(process.execPath)
  const pathValue = [nodeDirectory, system32, win32.join(cwd, 'node_modules', '.bin'), ...extraPath].join(';')
  const drive = win32.parse(home).root.replace(/\\$/, '')
  const homePath = home.slice(drive.length)
  return {
    SystemRoot: systemRoot,
    WINDIR: systemRoot,
    PATH: pathValue,
    ComSpec: win32.join(system32, 'cmd.exe'),
    TEMP: temp,
    TMP: temp,
    USERPROFILE: home,
    HOME: home,
    APPDATA: win32.join(home, 'AppData', 'Roaming'),
    LOCALAPPDATA: win32.join(home, 'AppData', 'Local'),
    HOMEDRIVE: drive,
    HOMEPATH: homePath,
    CI: '1',
    NO_COLOR: '1',
    NEXT_TELEMETRY_DISABLED: '1',
    ...overrides,
  }
}

const allowedEnvironmentOverrides = new Set([
  'HOST',
  'PORT',
  'API_PORT',
  'NODE_ENV',
  'DB_FILE',
  'YARN_ENABLE_SCRIPTS',
  'YARN_ENABLE_IMMUTABLE_INSTALLS',
  'YARN_NODE_LINKER',
  'YARN_NPM_REGISTRY_SERVER',
  'YARN_ENABLE_TELEMETRY',
  'pnpm_config_dangerously_allow_all_builds',
  'pnpm_config_registry',
  'GOTOOLCHAIN',
  'GOENV',
  'GOPROXY',
  'GOSUMDB',
  'GOCACHE',
  'GOMODCACHE',
  'GOTMPDIR',
  'UV_NO_CONFIG',
  'UV_INDEX_URL',
  'UV_CACHE_DIR',
  'UV_PROJECT_ENVIRONMENT',
  'UV_PYTHON_DOWNLOADS',
  'UV_PYTHON_NO_REGISTRY',
  'PYTHONNOUSERSITE',
  'PYTHONDONTWRITEBYTECODE',
  'COMPOSER_HOME',
  'COMPOSER_CACHE_DIR',
  'COMPOSER_DISABLE_XDEBUG_WARN',
  'APP_ENV',
  'APP_KEY',
  'APP_DEBUG',
  'DB_CONNECTION',
  'DB_HOST',
  'DB_PORT',
  'DB_DATABASE',
  'DB_USERNAME',
  'DB_PASSWORD',
  'CACHE_STORE',
  'QUEUE_CONNECTION',
  'SESSION_DRIVER',
])

async function startSafeProcessInternal(options: SafeProcessOptions, postgresSmokeProbePort?: number): Promise<RunningProcess> {
  if (process.platform !== 'win32') throw new GeneratorError({ code: 'GEN_NATIVE_SUPERVISOR_UNAVAILABLE', stage: 'process', message: 'Windows native supervisor is required for generation.', nextAction: 'Build and run Project Generator on supported Windows.', targetModified: false })
  if (options.signal?.aborted) throw new GeneratorError({ code: 'GEN_CANCELLED', stage: 'process', message: 'Generation was cancelled.', nextAction: 'Retry from the beginning.', targetModified: false })
  if (options.args.some((arg) => typeof arg !== 'string' || arg.includes('\0')) || options.args.join('').length > 28_000) {
    throw new GeneratorError({ code: 'GEN_RUNNER_BLOCKED', stage: 'process', message: 'Refused invalid process arguments.', nextAction: 'Use a valid generator config and retry.', targetModified: false })
  }
  const postgresSmokeUrl = postgresSmokeProbePort === undefined ? undefined : `postgresql://probe:probe@127.0.0.1:${postgresSmokeProbePort}/probe_db`
  if (Object.entries(options.environment ?? {}).some(([key, value]) => (!allowedEnvironmentOverrides.has(key) && !(key === 'DATABASE_URL' && value === postgresSmokeUrl)) || value.includes('\0') || (key === 'DB_FILE' && value !== ':memory:'))) {
    throw new GeneratorError({ code: 'GEN_RUNNER_BLOCKED', stage: 'process', message: 'Refused unreviewed process environment overrides.', nextAction: 'Use the pinned package-manager adapter and retry.', targetModified: false })
  }
  const scriptMode = options.scriptPath !== undefined && options.allowedScriptRoot !== undefined
  const executableMode = options.executablePath !== undefined && options.allowedExecutableRoot !== undefined
  if (scriptMode === executableMode || (options.scriptPath !== undefined) !== (options.allowedScriptRoot !== undefined)
    || (options.executablePath !== undefined) !== (options.allowedExecutableRoot !== undefined)) {
    throw new GeneratorError({ code: 'GEN_RUNNER_BLOCKED', stage: 'process', message: 'Refused an incomplete or ambiguous process executable.', nextAction: 'Use a reviewed executable and its allowed installation directory.', targetModified: false })
  }
  const [scriptPath, cwd, extraPath] = await Promise.all([
    checkedFile(scriptMode ? options.scriptPath! : options.executablePath!, scriptMode ? options.allowedScriptRoot! : options.allowedExecutableRoot!),
    checkedDirectory(options.cwd, options.allowedCwdRoot),
    Promise.all((options.extraPath ?? []).map((directory) => checkedDirectory(directory, directory))),
  ])
  if (options.signal?.aborted) throw new GeneratorError({ code: 'GEN_CANCELLED', stage: 'process', message: 'Generation was cancelled.', nextAction: 'Retry from the beginning.', targetModified: false })
  const testFault = options.supervisorDiagnostic?.stageId === 'validating' && claimTestSupervisorStartFailure()
  let child: ChildProcess
  try {
    child = spawnSupervisor('--run')
  } catch (error) {
    emitSupervisorDiagnostic(options.supervisorDiagnostic, undefined, null, 'unavailable', 'supervisor_operational_failure')
    throw new GeneratorError({ code: 'GEN_NATIVE_SUPERVISOR_UNAVAILABLE', stage: 'process', message: 'Windows native supervisor is unavailable.', nextAction: 'Rebuild the Project Generator Windows supervisor and retry.', targetModified: false }, { cause: error })
  }
  child.once('spawn', () => {
    sendSupervisorRequest(child, {
      executable: executableMode ? scriptPath : process.execPath,
      args: scriptMode ? [scriptPath, ...options.args] : [...options.args],
      cwd,
      env: Object.fromEntries(Object.entries(processEnvironment(options.homeDirectory, options.tempDirectory, cwd, extraPath, options.environment)).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
      ...(testFault ? { testFault: 'start-failure' } : {}),
    })
  })
  const responseTimeout = options.timeoutMs === undefined ? 24 * 60 * 60 * 1000 : options.timeoutMs + 15_000
  const result = readSupervisorResponse(child, responseTimeout).then(({ response, exitCode }) =>
    processSupervisorResponse(response, exitCode, options.supervisorDiagnostic))
    .catch((error: unknown) => {
    if (error instanceof GeneratorError) throw error
    if (error instanceof SupervisorResponseError) {
      emitSupervisorDiagnostic(options.supervisorDiagnostic, undefined, null, error.status, error.status === 'malformed' ? 'malformed_response' : 'supervisor_operational_failure')
      throw processTreeError()
    }
    throw processTreeError()
  })

  let stopPromise: Promise<void> | undefined
  const stop = (): Promise<void> => {
    stopPromise ??= (async () => {
      if (child.exitCode !== null || child.signalCode !== null) {
        await result
        return
      }
      try {
        child.stdin?.write('{"kind":"cancel"}\n')
        const completed = await result
        if (completed.terminationConfirmed !== true) throw processTreeError()
      } catch {
        throw processTreeError()
      }
    })()
    return stopPromise
  }
  return { result, stop }
}

export function startSafeProcess(options: SafeProcessOptions): Promise<RunningProcess> {
  return startSafeProcessInternal(options)
}

export async function startPostgresSmokeProcess(options: SafeProcessOptions, probePort: number): Promise<RunningProcess> {
  if (!Number.isInteger(probePort) || probePort < 1 || probePort > 65535 || probePort === 5432
    || Object.hasOwn(options.environment ?? {}, 'DATABASE_URL')) {
    throw new GeneratorError({ code: 'GEN_RUNNER_BLOCKED', stage: 'process', message: 'Refused invalid owned PostgreSQL smoke probe.', nextAction: 'Use the smoke-owned loopback probe port and do not provide a DATABASE_URL override.', targetModified: false })
  }
  const environment = {
    ...options.environment,
    DATABASE_URL: `postgresql://probe:probe@127.0.0.1:${probePort}/probe_db`,
  }
  return startSafeProcessInternal({ ...options, environment }, probePort)
}

export function startNodeProcess(options: SafeProcessOptions): Promise<RunningProcess> {
  return startSafeProcess(options)
}

export async function runSafeProcess(options: SafeProcessOptions): Promise<ProcessResult> {
  const running = await startSafeProcess(options)
  let timeout: NodeJS.Timeout | undefined
  let abortListener: (() => void) | undefined
  let failure: GeneratorError | undefined
  const stop = async (code: string, message: string, nextAction: string): Promise<void> => {
    failure = new GeneratorError({ code, stage: 'process', message, nextAction, targetModified: false })
    try {
      await running.stop()
    } catch {
      failure = processTreeError()
    }
  }
  const interruption = new Promise<never>((_, reject) => {
    if (options.signal) {
      abortListener = () => { void stop('GEN_CANCELLED', 'Generation was cancelled.', 'Retry from the beginning.').then(() => reject(failure)) }
      options.signal.addEventListener('abort', abortListener, { once: true })
    }
    if (options.timeoutMs) timeout = setTimeout(() => { void stop('GEN_PROCESS_TIMEOUT', 'A reviewed tool exceeded its time limit.', 'Check network/tool health and retry.').then(() => reject(failure)) }, options.timeoutMs)
  })
  try {
    if (options.signal?.aborted) {
      await stop('GEN_CANCELLED', 'Generation was cancelled.', 'Retry from the beginning.')
      throw failure
    }
    const completed = await Promise.race([running.result, interruption])
    if (failure) throw failure
    if (completed.timedOut) throw new GeneratorError({ code: 'GEN_PROCESS_TIMEOUT', stage: 'process', message: 'A reviewed tool exceeded its time limit.', nextAction: 'Check network/tool health and retry.', targetModified: false })
    if (options.signal?.aborted) {
      await running.stop()
      throw new GeneratorError({ code: 'GEN_CANCELLED', stage: 'process', message: 'Generation was cancelled.', nextAction: 'Retry from the beginning.', targetModified: false })
    }
    return completed
  } catch (error) {
    if (failure) throw failure
    throw error
  } finally {
    if (timeout) clearTimeout(timeout)
    if (abortListener) options.signal?.removeEventListener('abort', abortListener)
  }
}

export function runNodeProcess(options: SafeProcessOptions): Promise<ProcessResult> {
  return runSafeProcess(options)
}
