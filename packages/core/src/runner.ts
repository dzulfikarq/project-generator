import { spawn, type ChildProcess } from 'node:child_process'
import { lstat, realpath } from 'node:fs/promises'
import { dirname, isAbsolute, relative, win32 } from 'node:path'
import { GeneratorError } from './errors.js'

const OUTPUT_LIMIT = 256 * 1024

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
}

export interface ProcessResult {
  exitCode: number
  stdout: string
  stderr: string
  truncated: boolean
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

function processEnvironment(home: string, temp: string, cwd: string): NodeJS.ProcessEnv {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
  const system32 = win32.join(systemRoot, 'System32')
  const nodeDirectory = dirname(process.execPath)
  const pathValue = [nodeDirectory, system32, win32.join(cwd, 'node_modules', '.bin')].join(';')
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

function appendBounded(chunks: Buffer[], current: number, data: Buffer): { length: number; truncated: boolean } {
  if (current >= OUTPUT_LIMIT) return { length: current, truncated: data.length > 0 }
  const available = OUTPUT_LIMIT - current
  chunks.push(data.subarray(0, available))
  return { length: current + Math.min(data.length, available), truncated: data.length > available }
}

export async function startNodeProcess(options: SafeProcessOptions): Promise<RunningProcess> {
  if (options.signal?.aborted) throw new GeneratorError({ code: 'GEN_CANCELLED', stage: 'process', message: 'Generation was cancelled.', nextAction: 'Retry from the beginning.', targetModified: false })
  if (options.args.some((arg) => typeof arg !== 'string' || arg.includes('\0')) || options.args.join('').length > 28_000) {
    throw new GeneratorError({ code: 'GEN_RUNNER_BLOCKED', stage: 'process', message: 'Refused invalid process arguments.', nextAction: 'Use a valid generator config and retry.', targetModified: false })
  }
  const [scriptPath, cwd] = await Promise.all([
    checkedFile(options.scriptPath, options.allowedScriptRoot),
    checkedDirectory(options.cwd, options.allowedCwdRoot),
  ])
  if (options.signal?.aborted) throw new GeneratorError({ code: 'GEN_CANCELLED', stage: 'process', message: 'Generation was cancelled.', nextAction: 'Retry from the beginning.', targetModified: false })
  const child = spawn(process.execPath, [scriptPath, ...options.args], {
    cwd,
    env: processEnvironment(options.homeDirectory, options.tempDirectory, cwd),
    shell: false,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const stdout: Buffer[] = []
  const stderr: Buffer[] = []
  let stdoutLength = 0
  let stderrLength = 0
  let truncated = false
  child.stdout?.on('data', (chunk: Buffer) => {
    const result = appendBounded(stdout, stdoutLength, chunk)
    stdoutLength = result.length
    truncated ||= result.truncated
  })
  child.stderr?.on('data', (chunk: Buffer) => {
    const result = appendBounded(stderr, stderrLength, chunk)
    stderrLength = result.length
    truncated ||= result.truncated
  })

  const result = new Promise<ProcessResult>((resolveResult, rejectResult) => {
    child.once('error', rejectResult)
    child.once('close', (code) => resolveResult({
      exitCode: code ?? 1,
      stdout: Buffer.concat(stdout).toString('utf8'),
      stderr: Buffer.concat(stderr).toString('utf8'),
      truncated,
    }))
  })

  let stopPromise: Promise<void> | undefined
  const stop = (): Promise<void> => {
    stopPromise ??= terminateProcessTree(child, result)
    return stopPromise
  }
  return { result, stop }
}

async function terminateProcessTree(child: ChildProcess, result: Promise<ProcessResult>): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
    const taskkill = win32.join(systemRoot, 'System32', 'taskkill.exe')
    const killResult = await new Promise<{ code: number | null; failedToStart: boolean }>((resolveKill) => {
      const killer = spawn(taskkill, ['/PID', String(child.pid), '/T', '/F'], {
        env: { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: win32.join(systemRoot, 'System32') },
        shell: false,
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.once('error', () => resolveKill({ code: null, failedToStart: true }))
      killer.once('close', (code) => resolveKill({ code, failedToStart: false }))
    })
    if (killResult.failedToStart || killResult.code !== 0) {
      child.kill()
      await waitForExit(result, 1000)
      throw processTreeError()
    }
  } else {
    child.kill('SIGTERM')
  }
  if (!await waitForExit(result, 5000)) {
    child.kill()
    throw processTreeError()
  }
}

function waitForExit(result: Promise<ProcessResult>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolveExit) => {
    const timeout = setTimeout(() => resolveExit(false), timeoutMs)
    result.then(() => {
      clearTimeout(timeout)
      resolveExit(true)
    }, () => {
      clearTimeout(timeout)
      resolveExit(true)
    })
  })
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
    const completed = await Promise.race([running.result, interruption])
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
