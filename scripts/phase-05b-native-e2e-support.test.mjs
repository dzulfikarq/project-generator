import assert from 'node:assert/strict'
import test from 'node:test'
import { assertGoValidationResults, captureCleanupFailure, createBuildFailure, runNativeGenerationFlow, safeCleanupFailure, safeFailureMetadata, safeSupervisorDiagnostic, safeSupervisorLaunchObservation, safeSupervisorProcessResult, waitForTerminalGeneration } from './phase-05b-native-e2e-support.mjs'

const completed = {
  eventType: 'job-finished',
  jobId: '550e8400-e29b-41d4-a716-446655440000',
  status: 'completed',
  stageId: 'finalizing',
  errorCode: 'unknown',
  diagnosticRef: 'unknown',
  childProcessState: 'none',
}

const goValidations = [
  { id: 'scaffold-identity', status: 'pass', message: 'Generated module and project identity match the requested configuration.' },
  ...['go-module', 'go-fmt', 'go-vet', 'go-test', 'go-build', 'http-smoke']
    .map((id) => ({ id, status: 'pass', message: 'Command completed successfully.', exitCode: 0 })),
]

test('BE-02 identity validation needs pass evidence but no process exit code', () => {
  assert.equal(Object.hasOwn(goValidations[0], 'exitCode'), false)
  assert.doesNotThrow(() => assertGoValidationResults(goValidations))

  const missingEvidence = goValidations.map((result) => ({ ...result }))
  missingEvidence[0].message = 'Identity was not checked.'
  assert.throws(() => assertGoValidationResults(missingEvidence), /scaffold-identity evidence/)
})

test('BE-02 process validations still require pass status and exit code zero', () => {
  const missingExitCode = goValidations.map((result) => ({ ...result }))
  delete missingExitCode.find(({ id }) => id === 'go-test').exitCode
  assert.throws(() => assertGoValidationResults(missingExitCode), /go-test exitCode/)

  const failedProcess = goValidations.map((result) => ({ ...result }))
  Object.assign(failedProcess.find(({ id }) => id === 'go-test'), { status: 'fail', exitCode: 1 })
  assert.throws(() => assertGoValidationResults(failedProcess), /go-test status/)
})

test('core build failure is classified without leaking process details', () => {
  const failure = createBuildFailure('release-core-build', { status: 1 })
  assert.deepEqual(safeCleanupFailure(failure.cleanupOperation, failure), {
    operation: 'release-core-build',
    errorCategory: 'build_process',
    errorCode: 'BUILD_STEP_FAILED',
    errorNumber: null,
    exitCode: 1,
  })
  assert.equal(failure.message.includes('path'), false)
})

test('missing terminal metadata falls back to sanitized supervisor identity', () => {
  assert.deepEqual(safeFailureMetadata(null, {
    jobId: '550e8400-e29b-41d4-a716-446655440000',
    stageId: 'validating',
    activeProcessState: 'none',
    privatePath: 'C:\\private\\path',
  }), {
    jobId: '550e8400-e29b-41d4-a716-446655440000',
    stageId: 'validating',
    terminalStatus: 'unknown',
    publicErrorCode: 'unknown',
    diagnosticRef: 'unknown',
    activeProcessState: 'none',
  })
})

test('supervisor launch observation requires process and image identity', () => {
  assert.deepEqual(safeSupervisorLaunchObservation({
    processId: 1234,
    mode: '--recovery-inspect',
    executablePath: 'E:\\run-owned\\pg-windows-supervisor.exe',
    sha256: 'a'.repeat(64),
    observedAt: '2026-11-26T12:00:00.000Z',
    ignored: 'not retained',
  }), {
    processId: 1234,
    mode: '--recovery-inspect',
    executablePath: 'E:\\run-owned\\pg-windows-supervisor.exe',
    sha256: 'a'.repeat(64),
    observedAt: '2026-11-26T12:00:00.000Z',
  })
  assert.equal(safeSupervisorLaunchObservation({ processId: 0, mode: '--run', executablePath: 'x', sha256: 'a'.repeat(64), observedAt: 'now' }), null)
  assert.equal(safeSupervisorLaunchObservation({ processId: 1, mode: '--run', executablePath: '', sha256: 'a'.repeat(64), observedAt: 'now' }), null)
})

test('terminal failure stops harness wait immediately with public status and code', async () => {
  let reads = 0
  let failure
  try {
    await waitForTerminalGeneration(async () => {
      reads += 1
      return {
        eventType: 'job-finished',
        jobId: '550e8400-e29b-41d4-a716-446655440000',
        status: 'failed',
        errorCode: 'GEN_PROCESS_SUPERVISOR_FAILED',
        stageId: 'validating',
        diagnosticRef: 'supdiag-550e8400-e29b-41d4-a716-446655440000',
        childProcessState: 'active',
        internalDiagnostic: 'must not appear',
      }
    }, { timeoutMs: 20 * 60 * 1000 })
  } catch (error) {
    failure = error
  }
  assert.match(failure?.message ?? '', /status=failed jobId=550e8400-e29b-41d4-a716-446655440000 stage=validating code=GEN_PROCESS_SUPERVISOR_FAILED diagnosticRef=supdiag-550e8400-e29b-41d4-a716-446655440000 childProcessState=active/)
  assert.equal(reads, 1)
  assert.equal(failure?.message.includes('must not appear'), false)
})

test('cancelled terminal returns typed status instead of waiting for success', async () => {
  await assert.rejects(waitForTerminalGeneration(async () => ({
    eventType: 'job-finished',
    jobId: '550e8400-e29b-41d4-a716-446655440000',
    status: 'cancelled',
    errorCode: 'GEN_CANCELLED',
    stageId: 'validating',
    childProcessState: 'unknown',
  }), { timeoutMs: 20 * 60 * 1000 }), (error) => {
    assert.equal(error.terminal.status, 'cancelled')
    assert.equal(error.terminal.errorCode, 'GEN_CANCELLED')
    return true
  })
})

test('nonterminal events keep waiting until completed terminal event', async () => {
  let clock = 0
  let reads = 0
  const terminal = await waitForTerminalGeneration(async () => {
    reads += 1
    return reads < 3
      ? { eventType: reads === 1 ? 'stage-progress' : 'error', status: undefined }
      : { eventType: 'job-finished', status: 'completed', errorCode: undefined }
  }, {
    timeoutMs: 100,
    pollIntervalMs: 10,
    now: () => clock,
    delay: async (ms) => { clock += ms },
  })
  assert.equal(terminal.status, 'completed')
  assert.equal(reads, 3)
  assert.equal(clock, 20)
})

test('wait times out when no terminal event arrives', async () => {
  let clock = 0
  let reads = 0
  await assert.rejects(waitForTerminalGeneration(async () => {
    reads += 1
    return { eventType: 'stage-progress', status: undefined }
  }, {
    timeoutMs: 25,
    pollIntervalMs: 10,
    now: () => clock,
    delay: async (ms) => { clock += ms },
  }), /Timed out waiting for terminal generation event after 25ms/)
  assert.equal(reads, 4)
  assert.equal(clock, 25)
})

test('diagnostic-only success permits one generation and skips legacy followups', async () => {
  let attempts = 0
  let followups = 0
  let cleanups = 0
  const terminal = await runNativeGenerationFlow({
    diagnosticOnly: true,
    runGeneration: async () => { attempts += 1; return completed },
    verifySuccess: async (event) => assert.equal(event.jobId, completed.jobId),
    runDefaultChecks: async () => { followups += 1 },
    cleanup: async () => { cleanups += 1 },
  })
  assert.equal(terminal.status, 'completed')
  assert.equal(attempts, 1)
  assert.equal(followups, 0)
  assert.equal(cleanups, 1)
})

test('diagnostic-only terminal failure stops before verification or followups and cleans up', async () => {
  let attempts = 0
  let verified = false
  let followups = 0
  let cleanups = 0
  const failure = new Error('safe terminal failure')
  await assert.rejects(runNativeGenerationFlow({
    diagnosticOnly: true,
    runGeneration: async () => { attempts += 1; throw failure },
    verifySuccess: async () => { verified = true },
    runDefaultChecks: async () => { followups += 1 },
    cleanup: async () => { cleanups += 1 },
  }), failure)
  assert.equal(attempts, 1)
  assert.equal(verified, false)
  assert.equal(followups, 0)
  assert.equal(cleanups, 1)
})

test('diagnostic-only timeout does not retry and still cleans up', async () => {
  let attempts = 0
  let cleanups = 0
  let clock = 0
  await assert.rejects(runNativeGenerationFlow({
    diagnosticOnly: true,
    runGeneration: async () => {
      attempts += 1
      return waitForTerminalGeneration(async () => ({ eventType: 'stage-progress', stageId: 'validating' }), {
        timeoutMs: 20,
        pollIntervalMs: 10,
        now: () => clock,
        delay: async (ms) => { clock += ms },
      })
    },
    verifySuccess: async () => assert.fail('timeout must not verify success'),
    runDefaultChecks: async () => assert.fail('timeout must not run followups'),
    cleanup: async () => { cleanups += 1 },
  }), (error) => error.code === 'NATIVE_GENERATION_TIMEOUT')
  assert.equal(attempts, 1)
  assert.equal(cleanups, 1)
})

test('default mode keeps legacy followups and cleanup', async () => {
  let attempts = 0
  let verified = 0
  let followups = 0
  let cleanups = 0
  await runNativeGenerationFlow({
    diagnosticOnly: false,
    runGeneration: async () => { attempts += 1; return completed },
    verifySuccess: async () => { verified += 1 },
    runDefaultChecks: async () => { followups += 1 },
    cleanup: async () => { cleanups += 1 },
  })
  assert.deepEqual({ attempts, verified, followups, cleanups }, { attempts: 1, verified: 1, followups: 1, cleanups: 1 })
})

test('cleanup failure rejects an otherwise successful generation flow', async () => {
  let verified = false
  let cleanups = 0
  const cleanupFailure = Object.assign(new Error('owned cleanup failed'), { code: 'EACCES' })
  await assert.rejects(runNativeGenerationFlow({
    diagnosticOnly: true,
    runGeneration: async () => completed,
    verifySuccess: async () => { verified = true },
    runDefaultChecks: async () => assert.fail('diagnostic mode skips followups'),
    cleanup: async () => { cleanups += 1; throw cleanupFailure },
  }), cleanupFailure)
  assert.equal(verified, true)
  assert.equal(cleanups, 1)
  assert.equal(safeCleanupFailure('cleanup-run', cleanupFailure).errorCategory, 'access_denied')
})

test('supervisor diagnostics retain only safe typed fields', () => {
  const diagnostic = safeSupervisorDiagnostic({
    type: 'supervisor-diagnostic',
    diagnosticRef: 'supdiag-550e8400-e29b-41d4-a716-446655440000',
    jobId: '550e8400-e29b-41d4-a716-446655440000',
    stageId: 'validating',
    failureCategory: 'process_start_failure',
    started: false,
    childExitCode: null,
    supervisorExitCode: 1,
    terminationConfirmed: true,
    systemError: { category: 'access_denied', code: 5, raw: 'private path and command' },
    activeChildProcessCount: 0,
    executablePath: 'C:\\private\\tool.exe',
  })
  assert.deepEqual(diagnostic, {
    diagnosticRef: 'supdiag-550e8400-e29b-41d4-a716-446655440000',
    jobId: '550e8400-e29b-41d4-a716-446655440000',
    stageId: 'validating',
    failureCategory: 'process_start_failure',
    started: false,
    childExitCode: null,
    supervisorExitCode: 1,
    terminationConfirmed: true,
    osErrorCategory: 'access_denied',
    osErrorCode: 5,
    activeProcessCount: 0,
    activeProcessState: 'none',
  })
  assert.equal(JSON.stringify(diagnostic).includes('private'), false)
})

test('cancelled supervisor result retains exit confirmation without raw fields', () => {
  const result = safeSupervisorProcessResult({
    type: 'supervisor-process-result',
    jobId: '550e8400-e29b-41d4-a716-446655440000',
    stageId: 'validating',
    started: true,
    childExitCode: -1073741510,
    supervisorExitCode: 0,
    cancelled: true,
    terminationConfirmed: true,
    activeChildProcessCount: 0,
    command: 'go test ./... secret=private',
    path: 'C:\\private\\workspace',
  })
  assert.deepEqual(result, {
    jobId: '550e8400-e29b-41d4-a716-446655440000',
    stageId: 'validating',
    started: true,
    childExitCode: -1073741510,
    supervisorExitCode: 0,
    cancelled: true,
    terminationConfirmed: true,
    activeChildProcessCount: 0,
  })
  assert.equal(JSON.stringify(result).includes('private'), false)
  assert.equal(safeSupervisorProcessResult({ type: 'supervisor-process-result', cancelled: false }), null)
})

test('cleanup report preserves operation and safe error codes but omits raw paths and messages', () => {
  const failure = Object.assign(new Error('private C:\\Users\\someone\\workspace'), {
    code: 'EADDRINUSE',
    errno: -4091,
    winerror: 10048,
    exitCode: 3,
    path: 'C:\\private\\resource',
  })
  const safe = safeCleanupFailure('vite-port-postcondition', failure)
  assert.deepEqual(safe, {
    operation: 'vite-port-postcondition',
    errorCategory: 'port_in_use',
    errorCode: 'EADDRINUSE',
    errorNumber: 10048,
    exitCode: 3,
  })
  assert.equal(JSON.stringify(safe).includes('private'), false)
})

test('cleanup report rejects unknown operations and malformed error codes', () => {
  const safe = safeCleanupFailure('../private/path', {
    code: 'EADDRINUSE C:\\secret',
    errno: Number.MAX_SAFE_INTEGER,
    status: '3',
  })
  assert.deepEqual(safe, {
    operation: 'unknown',
    errorCategory: 'unknown',
    errorCode: null,
    errorNumber: null,
    exitCode: null,
  })
})

test('cleanup report retains bounded signed errno when no Win32 code exists', () => {
  assert.deepEqual(safeCleanupFailure('owned-desktop-exit', {
    code: 'ETIMEDOUT',
    errno: -110,
    exitCode: -1,
  }), {
    operation: 'owned-desktop-exit',
    errorCategory: 'timeout',
    errorCode: 'ETIMEDOUT',
    errorNumber: -110,
    exitCode: -1,
  })
})

test('cleanup capture retains safe failure and ignores successful cleanup steps', async () => {
  const failures = []
  assert.equal(await captureCleanupFailure('vite-port-postcondition', async () => {}, failures), false)
  assert.equal(await captureCleanupFailure('vite-port-postcondition', async () => {
    throw Object.assign(new Error('private path'), { code: 'EADDRINUSE', winerror: 10048 })
  }, failures), true)
  assert.deepEqual(failures, [{
    operation: 'vite-port-postcondition',
    errorCategory: 'port_in_use',
    errorCode: 'EADDRINUSE',
    errorNumber: 10048,
    exitCode: null,
  }])
})

test('cleanup capture preserves every already-sanitized operation failure', async () => {
  const failures = []
  await captureCleanupFailure('cleanup-run', async () => {
    const error = new Error('aggregate')
    error.cleanupFailures = [
      { operation: 'vite-port-postcondition', errorCategory: 'port_in_use', errorCode: 'EADDRINUSE', errorNumber: 10048, exitCode: null },
      { operation: 'webview-port-postcondition', errorCategory: 'port_in_use', errorCode: 'EADDRINUSE', errorNumber: 10048, exitCode: null },
    ]
    throw error
  }, failures)
  assert.deepEqual(failures.map(({ operation }) => operation), ['vite-port-postcondition', 'webview-port-postcondition'])
})
