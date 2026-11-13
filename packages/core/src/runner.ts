import type { ChildProcess } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, win32 } from 'node:path'
import { GeneratorError } from './errors.js'
import { readSupervisorResponse, sendSupervisorRequest, spawnSupervisor } from './native-supervisor.js'

export interface SafeProcessOptions {
  scriptPath: string
  allowedScriptRoot: string
  cwd: string
  allowedCwdRoot: string
  args: readonly string[]
  homeDirectory: string
  tempDirectory: string
  timeoutMs?: number
  signal?: AbortSignal
  extraPath?: readonly string[]
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

function processEnvironment(home: string, temp: string, cwd: string, extraPath: readonly string[] = []): NodeJS.ProcessEnv {
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
  }
}

export async function startNodeProcess(options: SafeProcessOptions): Promise<RunningProcess> {
  if (process.platform !== 'win32') throw new GeneratorError({ code: 'GEN_NATIVE_SUPERVISOR_UNAVAILABLE', stage: 'process', message: 'Windows native supervisor is required for generation.', nextAction: 'Build and run Project Generator on supported Windows.', targetModified: false })
  if (options.signal?.aborted) throw new GeneratorError({ code: 'GEN_CANCELLED', stage: 'process', message: 'Generation was cancelled.', nextAction: 'Retry from the beginning.', targetModified: false })
  if (options.args.some((arg) => typeof arg !== 'string' || arg.includes('\0')) || options.args.join('').length > 28_000) {
    throw new GeneratorError({ code: 'GEN_RUNNER_BLOCKED', stage: 'process', message: 'Refused invalid process arguments.', nextAction: 'Use a valid generator config and retry.', targetModified: false })
  }
  const [scriptPath, cwd, extraPath] = await Promise.all([
    checkedFile(options.scriptPath, options.allowedScriptRoot),
    checkedDirectory(options.cwd, options.allowedCwdRoot),
    Promise.all((options.extraPath ?? []).map((directory) => checkedDirectory(directory, directory))),
  ])
  if (options.signal?.aborted) throw new GeneratorError({ code: 'GEN_CANCELLED', stage: 'process', message: 'Generation was cancelled.', nextAction: 'Retry from the beginning.', targetModified: false })
  let child: ChildProcess
  try {
    child = spawnSupervisor('--run')
  } catch (error) {
    throw new GeneratorError({ code: 'GEN_NATIVE_SUPERVISOR_UNAVAILABLE', stage: 'process', message: 'Windows native supervisor is unavailable.', nextAction: 'Rebuild the Project Generator Windows supervisor and retry.', targetModified: false }, { cause: error })
  }
  child.once('spawn', () => {
    sendSupervisorRequest(child, {
      executable: process.execPath,
      args: [scriptPath, ...options.args],
      cwd,
      env: Object.fromEntries(Object.entries(processEnvironment(options.homeDirectory, options.tempDirectory, cwd, extraPath)).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
      ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
    })
  })
  const responseTimeout = options.timeoutMs === undefined ? 24 * 60 * 60 * 1000 : options.timeoutMs + 15_000
  const result = readSupervisorResponse(child, responseTimeout).then(({ response, exitCode }) => {
    if (typeof response.terminationConfirmed !== 'boolean' || !response.terminationConfirmed) throw processTreeError()
    if (typeof response.started !== 'boolean' || typeof response.exitCode !== 'number'
      || typeof response.stdout !== 'string' || typeof response.stderr !== 'string'
      || typeof response.truncated !== 'boolean') throw processTreeError()
    if (response.error !== null && response.error !== undefined) {
      if (response.error === 'elevated caller is not allowed') {
        throw new GeneratorError({ code: 'GEN_ELEVATED_CALLER', stage: 'process', message: 'Generation is blocked in an elevated Windows session.', nextAction: 'Start Project Generator without administrator elevation and retry.', targetModified: false })
      }
      throw new GeneratorError({ code: 'GEN_PROCESS_SUPERVISOR_FAILED', stage: 'process', message: 'Windows supervisor could not complete the owned process tree safely.', nextAction: 'Leave staging untouched if termination was not confirmed; inspect the redacted job log before retrying.', targetModified: false })
    }
    if (exitCode !== 0) throw processTreeError()
    return {
      exitCode: response.exitCode,
      stdout: response.stdout,
      stderr: response.stderr,
      truncated: response.truncated,
      cancelled: response.cancelled === true,
      timedOut: response.timedOut === true,
      terminationConfirmed: true,
    }
  }).catch((error: unknown) => {
    if (error instanceof GeneratorError) throw error
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

export async function runNodeProcess(options: SafeProcessOptions): Promise<ProcessResult> {
  const running = await startNodeProcess(options)
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
