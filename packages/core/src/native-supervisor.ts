import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFileSync, readFileSync } from 'node:fs'
import { win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILD_PROFILE } from './build-policy.js'
import { GeneratorError } from './errors.js'

const RESPONSE_LIMIT = 4 * 1024 * 1024
const SUPERVISOR_TIMEOUT_MS = 15_000
const helperPath = fileURLToPath(new URL('../../native/pg-windows-supervisor.exe', import.meta.url))

export interface SupervisorResult {
  response: Record<string, unknown>
  exitCode: number | null
}

export type SupervisorResponseStatus = 'received' | 'malformed' | 'timed_out' | 'oversized' | 'spawn_failed' | 'unavailable'

export class SupervisorResponseError extends Error {
  constructor(readonly status: Exclude<SupervisorResponseStatus, 'received' | 'unavailable'>, message: string) {
    super(message)
    this.name = 'SupervisorResponseError'
  }
}

function recordSupervisorLaunch(child: ChildProcess, mode: string): void {
  const evidencePath = process.env.PG_NATIVE_ACCEPTANCE_SUPERVISOR_LAUNCH_EVIDENCE
  const tempRoot = process.env.TEMP
  if (BUILD_PROFILE !== 'development' || process.platform !== 'win32'
    || !['--run', '--check-elevation', '--recovery-inspect'].includes(mode)
    || !evidencePath || !tempRoot || !win32.isAbsolute(evidencePath) || !win32.isAbsolute(tempRoot)) return
  const relativePath = win32.relative(win32.resolve(tempRoot), win32.resolve(evidencePath))
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${win32.sep}`) || win32.isAbsolute(relativePath)) return
  child.once('spawn', () => {
    try {
      const executablePath = child.spawnfile
      if (!Number.isSafeInteger(child.pid) || !executablePath) return
      const sha256 = createHash('sha256').update(readFileSync(executablePath)).digest('hex')
      appendFileSync(evidencePath, `${JSON.stringify({
        processId: child.pid,
        mode,
        executablePath,
        sha256,
        observedAt: new Date().toISOString(),
      })}\n`, 'utf8')
    } catch {
      // ponytail: evidence capture must never change supervisor execution; harness blocks on missing evidence.
    }
  })
}

export function spawnSupervisor(mode: string): ChildProcess {
  if (process.platform !== 'win32') {
    throw new GeneratorError({ code: 'GEN_NATIVE_SUPERVISOR_UNAVAILABLE', stage: 'process', message: 'Windows native supervisor is required for generation.', nextAction: 'Build and run Project Generator on supported Windows.', targetModified: false })
  }
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
  const system32 = `${systemRoot}\\System32`
  const child = spawn(helperPath, [mode], {
    cwd: system32,
    env: { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: system32 },
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  recordSupervisorLaunch(child, mode)
  child.stdin?.on('error', () => undefined)
  return child
}

export function sendSupervisorRequest(child: ChildProcess, request: unknown): void {
  child.stdin?.write(`${JSON.stringify(request)}\n`)
}

export function readSupervisorResponse(child: ChildProcess, timeoutMs = SUPERVISOR_TIMEOUT_MS): Promise<SupervisorResult> {
  return new Promise((resolve, reject) => {
    const output: Buffer[] = []
    let length = 0
    let settled = false
    const finish = (error?: Error, result?: SupervisorResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (error) reject(error)
      else resolve(result!)
    }
    child.stdout?.on('data', (chunk: Buffer) => {
      length += chunk.length
      if (length > RESPONSE_LIMIT) {
        child.kill()
        finish(new SupervisorResponseError('oversized', 'Native supervisor response exceeded limit.'))
      } else output.push(chunk)
    })
    child.once('error', () => finish(new SupervisorResponseError('spawn_failed', 'Native supervisor could not start.')))
    child.once('close', (exitCode) => {
      try {
        const response: unknown = JSON.parse(Buffer.concat(output).toString('utf8'))
        if (typeof response !== 'object' || response === null || Array.isArray(response)) throw new SupervisorResponseError('malformed', 'Invalid supervisor response.')
        finish(undefined, { response: response as Record<string, unknown>, exitCode })
      } catch {
        finish(new SupervisorResponseError('malformed', 'Native supervisor returned no valid response.'))
      }
    })
    const timeout = setTimeout(() => {
      child.kill()
      finish(new SupervisorResponseError('timed_out', 'Native supervisor did not respond in time.'))
    }, timeoutMs)
  })
}

export async function callSupervisor(mode: string, request?: unknown, timeoutMs = 10 * 60 * 1000): Promise<SupervisorResult> {
  let child: ChildProcess
  try {
    child = spawnSupervisor(mode)
  } catch (error) {
    if (error instanceof GeneratorError) throw error
    throw new GeneratorError({ code: 'GEN_NATIVE_SUPERVISOR_UNAVAILABLE', stage: 'process', message: 'Windows native supervisor is unavailable.', nextAction: 'Rebuild the Project Generator Windows supervisor and retry.', targetModified: false }, { cause: error })
  }
  child.once('spawn', () => {
    if (request !== undefined) sendSupervisorRequest(child, request)
    child.stdin?.end()
  })
  try {
    return await readSupervisorResponse(child, timeoutMs)
  } catch (error) {
    throw new GeneratorError({ code: 'GEN_NATIVE_SUPERVISOR_UNAVAILABLE', stage: 'process', message: 'Windows native supervisor failed before confirming its operation.', nextAction: 'Do not remove retained staging; rebuild the supervisor and inspect the job state before retrying.', targetModified: false }, { cause: error })
  }
}

export async function assertGenerationAllowed(): Promise<void> {
  if (process.platform !== 'win32') {
    throw new GeneratorError({ code: 'GEN_NATIVE_SUPERVISOR_UNAVAILABLE', stage: 'preflight', message: 'Windows native supervisor is required for generation.', nextAction: 'Build and run Project Generator on supported Windows.', targetModified: false })
  }
  const { response, exitCode } = await callSupervisor('--check-elevation', undefined, 15_000)
  if (exitCode !== 0 || typeof response.elevated !== 'boolean') {
    throw new GeneratorError({ code: 'GEN_ELEVATION_CHECK_FAILED', stage: 'preflight', message: 'Windows caller privilege could not be verified; generation was blocked.', nextAction: 'Run without administrator elevation and rebuild the native supervisor if the check still fails.', targetModified: false })
  }
  if (response.elevated) {
    throw new GeneratorError({ code: 'GEN_ELEVATED_CALLER', stage: 'preflight', message: 'Generation is blocked in an elevated Windows session.', nextAction: 'Start Project Generator without administrator elevation and retry.', targetModified: false })
  }
}
