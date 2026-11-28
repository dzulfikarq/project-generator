import assert from 'node:assert/strict'

const defaultDelay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const diagnosticRefPattern = /^supdiag-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const failureCategories = new Set(['process_start_failure', 'process_nonzero_exit', 'supervisor_operational_failure', 'termination_unconfirmed', 'malformed_response'])
const systemErrorCategories = new Set(['access_denied', 'not_found', 'invalid_handle', 'invalid_parameter', 'resource_exhausted', 'other', 'unknown'])
const goValidationIds = ['scaffold-identity', 'go-module', 'go-fmt', 'go-vet', 'go-test', 'go-build', 'http-smoke']

export function assertGoValidationResults(validation) {
  assert.deepEqual(validation.map(({ id }) => id), goValidationIds)
  const identity = validation.find(({ id }) => id === 'scaffold-identity')
  assert.equal(identity.status, 'pass', 'scaffold-identity status')
  assert.equal(identity.message, 'Generated module and project identity match the requested configuration.', 'scaffold-identity evidence')
  for (const result of validation.filter(({ id }) => id !== 'scaffold-identity')) {
    assert.equal(result.status, 'pass', `${result.id} status`)
    assert.equal(result.exitCode, 0, `${result.id} exitCode`)
  }
}
const cleanupOperations = new Set([
  'request-owned-window-close', 'owned-desktop-exit', 'acceptance-process-postcondition',
  'vite-port-postcondition', 'webview-port-postcondition', 'release-core-build',
  'release-profile-set', 'release-cli-build', 'release-full-build',
  'release-profile-postcondition', 'native-resource-restore', 'release-profile-restore',
  'write-run-report', 'cleanup-run', 'close-desktop-log', 'close-devtools-socket',
  'close-isolated-vscode', 'source-stability-postcondition',
  'staged-runtime-identity-postcondition',
  'repository-supervisor-identity-postcondition', 'repository-path-verifier-identity-postcondition',
  'staged-supervisor-identity-postcondition', 'unknown',
])

function safeInteger(value, minimum = 0, maximum = 0xffff_ffff) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum ? value : null
}

function safeExitCode(value) {
  return safeInteger(value, -0x8000_0000, 0x7fff_ffff)
}

export function safeCleanupFailure(operation, error) {
  const code = typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code) ? error.code : null
  const errorCategory = code === 'EADDRINUSE' ? 'port_in_use'
    : code === 'ETIMEDOUT' || code === 'OWNED_DESKTOP_EXIT_TIMEOUT' ? 'timeout'
      : code === 'EACCES' || code === 'EPERM' ? 'access_denied'
        : code === 'ENOENT' ? 'not_found'
          : code === 'BUILD_STEP_FAILED' ? 'build_process'
            : code === 'CLEANUP_OPERATION_FAILED' || code === 'CLEANUP_POSTCONDITIONS_FAILED'
              || code === 'OWNED_DESKTOP_EXIT_UNVERIFIED' || code === 'ACCEPTANCE_PROCESS_REMAINS'
              || code === 'RELEASE_PROFILE_POSTCONDITION_FAILED' || code === 'SUPERVISOR_BINARY_CHANGED'
              || code === 'PATH_VERIFIER_BINARY_CHANGED' || code === 'STAGED_RUNTIME_CHANGED'
              || code === 'SOURCE_CHANGED' ? 'harness_postcondition'
                : safeInteger(error?.winerror) !== null ? 'win32'
                  : code || safeExitCode(error?.errno) !== null ? 'system' : 'unknown'
  return {
    operation: cleanupOperations.has(operation) ? operation : 'unknown',
    errorCategory,
    errorCode: code,
    errorNumber: safeInteger(error?.winerror) ?? safeExitCode(error?.errno),
    exitCode: safeExitCode(error?.exitCode ?? error?.status),
  }
}

export function createBuildFailure(operation, result) {
  const error = new Error('Release build restoration step failed.')
  error.cleanupOperation = cleanupOperations.has(operation) ? operation : 'unknown'
  error.code = typeof result?.error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(result.error.code)
    ? result.error.code
    : 'BUILD_STEP_FAILED'
  if (Number.isSafeInteger(result?.error?.errno)) error.errno = result.error.errno
  if (Number.isSafeInteger(result?.status)) error.exitCode = result.status
  return error
}

export async function captureCleanupFailure(operation, action, failures) {
  try {
    await action()
    return false
  } catch (error) {
    if (Array.isArray(error?.cleanupFailures)) failures.push(...error.cleanupFailures)
    else failures.push(safeCleanupFailure(error?.cleanupOperation ?? operation, error))
    return true
  }
}

export function safeTerminalMetadata(value) {
  if (!value || typeof value !== 'object') return null
  return {
    eventType: value.eventType === 'job-finished' ? 'job-finished' : 'nonterminal',
    jobId: typeof value.jobId === 'string' && uuidPattern.test(value.jobId) ? value.jobId : 'unknown',
    status: ['completed', 'failed', 'partial', 'cancelled'].includes(value.status) ? value.status : 'unknown',
    errorCode: typeof value.errorCode === 'string' && /^GEN_[A-Z0-9_]{1,80}$/.test(value.errorCode) ? value.errorCode : 'unknown',
    stageId: typeof value.stageId === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.stageId) ? value.stageId : 'unknown',
    diagnosticRef: typeof value.diagnosticRef === 'string' && diagnosticRefPattern.test(value.diagnosticRef) ? value.diagnosticRef : 'unknown',
    childProcessState: ['none', 'active', 'unknown'].includes(value.childProcessState) ? value.childProcessState : 'unknown',
  }
}

export function safeSupervisorLaunchObservation(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  if (!Number.isSafeInteger(value.processId) || value.processId <= 0
    || !['--run', '--check-elevation', '--recovery-inspect'].includes(value.mode)
    || typeof value.executablePath !== 'string' || value.executablePath.length === 0 || value.executablePath.length > 32767
    || typeof value.sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(value.sha256)
    || typeof value.observedAt !== 'string' || value.observedAt.length === 0 || value.observedAt.length > 64) return null
  return {
    processId: value.processId,
    mode: value.mode,
    executablePath: value.executablePath,
    sha256: value.sha256.toLowerCase(),
    observedAt: value.observedAt,
  }
}

function terminalError(metadata) {
  const error = new Error(`Generation ended status=${metadata.status} jobId=${metadata.jobId} stage=${metadata.stageId} code=${metadata.errorCode} diagnosticRef=${metadata.diagnosticRef} childProcessState=${metadata.childProcessState}.`)
  error.code = 'NATIVE_GENERATION_TERMINAL_FAILURE'
  error.terminal = metadata
  return error
}

export async function waitForTerminalGeneration(readTerminal, {
  timeoutMs,
  pollIntervalMs = 250,
  now = Date.now,
  delay = defaultDelay,
}) {
  const deadline = now() + timeoutMs
  let lastTerminal = null
  while (true) {
    const value = await readTerminal()
    if (value?.eventType === 'job-finished') {
      lastTerminal = safeTerminalMetadata(value)
      if (lastTerminal.status === 'completed') return lastTerminal
      throw terminalError(lastTerminal)
    }
    if (value) lastTerminal = safeTerminalMetadata(value)
    const remaining = deadline - now()
    if (remaining <= 0) {
      const error = new Error(`Timed out waiting for terminal generation event after ${timeoutMs}ms.`)
      error.code = 'NATIVE_GENERATION_TIMEOUT'
      error.terminal = lastTerminal
      throw error
    }
    await delay(Math.min(pollIntervalMs, remaining))
  }
}

export async function runNativeGenerationFlow({ diagnosticOnly, runGeneration, verifySuccess, runDefaultChecks, cleanup }) {
  try {
    const terminal = await runGeneration()
    await verifySuccess(terminal)
    if (!diagnosticOnly) await runDefaultChecks()
    return terminal
  } finally {
    await cleanup()
  }
}

export function safeSupervisorDiagnostic(value) {
  if (!value || value.type !== 'supervisor-diagnostic') return null
  const systemError = value.systemError && typeof value.systemError === 'object' ? value.systemError : {}
  const activeProcessCount = safeInteger(value.activeChildProcessCount)
  return {
    diagnosticRef: typeof value.diagnosticRef === 'string' && diagnosticRefPattern.test(value.diagnosticRef) ? value.diagnosticRef : 'unknown',
    jobId: typeof value.jobId === 'string' && uuidPattern.test(value.jobId) ? value.jobId : 'unknown',
    stageId: typeof value.stageId === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.stageId) ? value.stageId : 'unknown',
    failureCategory: failureCategories.has(value.failureCategory) ? value.failureCategory : 'unknown',
    started: typeof value.started === 'boolean' ? value.started : null,
    childExitCode: safeInteger(value.childExitCode, -0x8000_0000, 0x7fff_ffff),
    supervisorExitCode: safeInteger(value.supervisorExitCode, -0x8000_0000, 0x7fff_ffff),
    terminationConfirmed: typeof value.terminationConfirmed === 'boolean' ? value.terminationConfirmed : null,
    osErrorCategory: systemErrorCategories.has(systemError.category) ? systemError.category : 'unknown',
    osErrorCode: safeInteger(systemError.code),
    activeProcessCount,
    activeProcessState: activeProcessCount === null ? 'unknown' : activeProcessCount === 0 ? 'none' : 'active',
  }
}

export function safeFailureMetadata(terminal, diagnostic) {
  const terminalJobId = typeof terminal?.jobId === 'string' && uuidPattern.test(terminal.jobId) ? terminal.jobId : 'unknown'
  const terminalStageId = typeof terminal?.stageId === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(terminal.stageId) ? terminal.stageId : 'unknown'
  return {
    jobId: terminalJobId !== 'unknown'
      ? terminalJobId
      : typeof diagnostic?.jobId === 'string' && uuidPattern.test(diagnostic.jobId) ? diagnostic.jobId : 'unknown',
    stageId: terminalStageId !== 'unknown'
      ? terminalStageId
      : typeof diagnostic?.stageId === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(diagnostic.stageId) ? diagnostic.stageId : 'unknown',
    terminalStatus: ['completed', 'failed', 'partial', 'cancelled'].includes(terminal?.status) ? terminal.status : 'unknown',
    publicErrorCode: typeof terminal?.errorCode === 'string' && /^GEN_[A-Z0-9_]{1,80}$/.test(terminal.errorCode) ? terminal.errorCode : 'unknown',
    diagnosticRef: typeof terminal?.diagnosticRef === 'string' && diagnosticRefPattern.test(terminal.diagnosticRef)
      ? terminal.diagnosticRef
      : 'unknown',
    activeProcessState: ['none', 'active', 'unknown'].includes(diagnostic?.activeProcessState)
      ? diagnostic.activeProcessState
      : ['none', 'active', 'unknown'].includes(terminal?.childProcessState) ? terminal.childProcessState : 'unknown',
  }
}

export function safeSupervisorProcessResult(value) {
  if (!value || value.type !== 'supervisor-process-result' || value.cancelled !== true) return null
  return {
    jobId: typeof value.jobId === 'string' && uuidPattern.test(value.jobId) ? value.jobId : 'unknown',
    stageId: typeof value.stageId === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value.stageId) ? value.stageId : 'unknown',
    started: typeof value.started === 'boolean' ? value.started : null,
    childExitCode: safeExitCode(value.childExitCode),
    supervisorExitCode: safeExitCode(value.supervisorExitCode),
    cancelled: true,
    terminationConfirmed: typeof value.terminationConfirmed === 'boolean' ? value.terminationConfirmed : null,
    activeChildProcessCount: safeInteger(value.activeChildProcessCount),
  }
}
