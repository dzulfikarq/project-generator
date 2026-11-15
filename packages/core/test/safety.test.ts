import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, win32 } from 'node:path'
import test, { type TestContext } from 'node:test'
import { GeneratorError } from '../src/errors.js'
import { callSupervisor } from '../src/native-supervisor.js'
import { assertNoReparsePoints, inspectTarget } from '../src/paths.js'
import { applyRecovery, bindOwnedStageProjectIdentity, checkFsResult, cleanupOwnedStage, cleanupStageSupportFiles, createOwnedStage, inspectRecovery, markOwnedStageGenerating, moveDirectoryNoReplace, mutateOwnedStage, verifyOwnedStageProjectIdentity } from '../src/staging.js'
import type { OwnedStage } from '../src/staging.js'

const debugSupervisorPath = resolve(import.meta.dirname, '../../../../native/windows-supervisor/target/debug/pg-windows-supervisor.exe')

function debugCrash(mode: string, request: Record<string, unknown>): void {
  const result = spawnSync(debugSupervisorPath, [mode], {
    input: `${JSON.stringify(request)}\n`,
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
  })
  assert.equal(result.error, undefined, result.error?.message)
  assert.equal(result.status, 86, `expected debug supervisor crash at ${String(request.testCrashAt)}; output=${result.stdout} ${result.stderr}`)
}

function stageRequest(stage: OwnedStage, projectName = win32.basename(stage.targetPath)): Record<string, unknown> {
  return {
    jobId: stage.jobId,
    transactionNonce: stage.transactionNonce,
    journalRootPath: stage.journalRootPath,
    stagePath: stage.path,
    parentPath: stage.parentPath,
    projectName,
    targetPath: stage.targetPath,
  }
}

function transactionRequest(parentPath: string, projectName: string, jobId = randomUUID()): Record<string, unknown> & { jobId: string; stagePath: string; targetPath: string; transactionNonce: string; journalRootPath: string } {
  const localAppData = process.env.LOCALAPPDATA
  assert.ok(localAppData && win32.isAbsolute(localAppData), 'LOCALAPPDATA is required on Windows')
  return {
    jobId,
    transactionNonce: randomBytes(32).toString('hex'),
    journalRootPath: win32.join(localAppData, '.project-generator-transactions'),
    stagePath: win32.join(parentPath, `.project-generator-stage-${jobId}`),
    sourcePath: win32.join(parentPath, `.project-generator-stage-${jobId}`, projectName),
    parentPath,
    projectName,
    targetPath: win32.join(parentPath, projectName),
  }
}

async function createJournal(request: Record<string, unknown>): Promise<void> {
  const result = await callSupervisor('--create-journal', request)
  assert.equal(result.exitCode, 0)
  assert.equal(result.response.ok, true)
}

async function removeJournalForTest(journalRoot: string, jobId: string): Promise<void> {
  await rm(win32.join(journalRoot, `.transaction-${jobId}.jsonl`), { force: true }).catch(() => undefined)
}

test('Windows crash/restart recovery preserves ambiguous and outside data', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-recovery-crash-'))
  const journalRoot = win32.join(process.env.LOCALAPPDATA!, '.project-generator-transactions')
  const sentinel = win32.join(parent, 'outside-sentinel.txt')
  const jobIds: string[] = []
  await writeFile(sentinel, 'preserve-me')
  const track = (jobId: string): void => { jobIds.push(jobId) }
  const readyStage = async (name: string): Promise<OwnedStage> => {
    const stage = await createOwnedStage(parent, win32.join(parent, name), name)
    track(stage.jobId)
    await markOwnedStageGenerating(stage)
    await mkdir(stage.childPath)
    await writeFile(win32.join(stage.childPath, 'generated.txt'), name)
    await bindOwnedStageProjectIdentity(stage, name)
    await cleanupStageSupportFiles(stage)
    return stage
  }
  try {
    const intent = transactionRequest(parent, 'before-create')
    track(intent.jobId)
    debugCrash('--create-journal', { ...intent, testCrashAt: 'afterJournalIntent' })
    const intentReport = (await inspectRecovery(intent.jobId))[0]!
    assert.equal(intentReport.phase, 'createIntent')
    assert.equal(intentReport.canDiscardJournal, true)
    await applyRecovery(intent.jobId, 'cleanup', intent.jobId)

    const unmarked = transactionRequest(parent, 'unmarked-stage')
    track(unmarked.jobId)
    await createJournal(unmarked)
    debugCrash('--create-stage', { ...unmarked, testCrashAt: 'afterStageDirectory' })
    const unmarkedReport = (await inspectRecovery(unmarked.jobId))[0]!
    assert.equal(unmarkedReport.state, 'unverifiedStage')
    assert.equal(unmarkedReport.canCleanupStage, false)
    await assert.rejects(applyRecovery(unmarked.jobId, 'cleanup', unmarked.jobId))
    await rm(unmarked.stagePath, { recursive: true, force: true })
    await removeJournalForTest(journalRoot, unmarked.jobId)

    const marked = transactionRequest(parent, 'marker-persisted')
    track(marked.jobId)
    await createJournal(marked)
    debugCrash('--create-stage', { ...marked, testCrashAt: 'afterStageMarker' })
    const markedReport = (await inspectRecovery(marked.jobId))[0]!
    assert.equal(markedReport.state, 'journalReconcileRequired')
    assert.equal(markedReport.canCleanupStage, true)
    await applyRecovery(marked.jobId, 'cleanup', marked.jobId)
    assert.deepEqual(await inspectRecovery(marked.jobId), [])
    await assert.rejects(lstat(marked.stagePath), { code: 'ENOENT' })

    const projectMarker = await createOwnedStage(parent, win32.join(parent, 'project-marker-persisted'), 'project-marker-persisted')
    track(projectMarker.jobId)
    await markOwnedStageGenerating(projectMarker)
    await mkdir(projectMarker.childPath)
    await writeFile(win32.join(projectMarker.childPath, 'generated.txt'), 'project-marker')
    debugCrash('--bind-stage-identity', { ...stageRequest(projectMarker), testCrashAt: 'afterProjectMarker' })
    const projectMarkerReport = (await inspectRecovery(projectMarker.jobId))[0]!
    assert.equal(projectMarkerReport.state, 'journalReconcileRequired')
    assert.equal(projectMarkerReport.canCleanupStage, true)
    debugCrash('--recovery-apply', {
      journalRootPath: projectMarker.journalRootPath,
      jobId: projectMarker.jobId,
      action: 'cleanup',
      confirmJobId: projectMarker.jobId,
      testCrashAt: 'afterProjectIdentityRebind',
    })
    const reboundReport = (await inspectRecovery(projectMarker.jobId))[0]!
    assert.equal(reboundReport.phase, 'projectBound')
    assert.equal(reboundReport.state, 'stagingPresent')
    assert.equal(reboundReport.canCleanupStage, true)
    await applyRecovery(projectMarker.jobId, 'cleanup', projectMarker.jobId)
    assert.deepEqual(await inspectRecovery(projectMarker.jobId), [])
    await assert.rejects(lstat(projectMarker.path), { code: 'ENOENT' })

    const lostResponse = transactionRequest(parent, 'lost-create-response')
    track(lostResponse.jobId)
    await createJournal(lostResponse)
    debugCrash('--create-stage', { ...lostResponse, testCrashAt: 'afterJournalAppend' })
    const lostResponseReport = (await inspectRecovery(lostResponse.jobId))[0]!
    assert.equal(lostResponseReport.state, 'stageCreated')
    assert.equal(lostResponseReport.canCleanupStage, true)
    assertRestrictedAcl(journalRoot, true)
    assertRestrictedAcl(win32.join(journalRoot, `.transaction-${lostResponse.jobId}.jsonl`), true)
    await applyRecovery(lostResponse.jobId, 'cleanup', lostResponse.jobId)

    const generation = await createOwnedStage(parent, win32.join(parent, 'generation-interrupted'), 'generation-interrupted')
    track(generation.jobId)
    await markOwnedStageGenerating(generation)
    debugCrash('--prepare-stage', {
      ...stageRequest(generation),
      directories: [],
      files: [{ path: 'partial-generation.txt', content: 'partial', replace: false, skipExisting: false }],
      testCrashAt: 'afterStageMutation',
    })
    const generationReport = (await inspectRecovery(generation.jobId))[0]!
    assert.equal(generationReport.state, 'generationInterrupted')
    await applyRecovery(generation.jobId, 'cleanup', generation.jobId)

    const beforeFinalize = await readyStage('before-finalize')
    debugCrash('--finalize-stage', { ...stageRequest(beforeFinalize), testCrashAt: 'beforeFinalizeRename' })
    const beforeFinalizeReport = (await inspectRecovery(beforeFinalize.jobId))[0]!
    assert.equal(beforeFinalizeReport.canFinalize, true)
    await applyRecovery(beforeFinalize.jobId, 'finalize', beforeFinalize.jobId)
    assert.equal(await readFile(win32.join(beforeFinalize.targetPath, 'generated.txt'), 'utf8'), 'before-finalize')

    const afterFinalize = await readyStage('after-finalize')
    debugCrash('--finalize-stage', { ...stageRequest(afterFinalize), testCrashAt: 'afterFinalizeRename' })
    const afterFinalizeReport = (await inspectRecovery(afterFinalize.jobId))[0]!
    assert.equal(afterFinalizeReport.state, 'committedWrapperNeedsCleanup')
    await applyRecovery(afterFinalize.jobId, 'cleanup', afterFinalize.jobId)
    assert.equal(await readFile(win32.join(afterFinalize.targetPath, 'generated.txt'), 'utf8'), 'after-finalize')

    const beforeAcl = await readyStage('before-finalize-acl')
    icacls(beforeAcl.childPath, '/inheritance:e')
    assertRestrictedAcl(beforeAcl.childPath, false)
    debugCrash('--finalize-stage', { ...stageRequest(beforeAcl), testCrashAt: 'afterFinalizeRenameBeforeAcl' })
    assertRestrictedAcl(beforeAcl.targetPath, false)
    const beforeAclReport = (await inspectRecovery(beforeAcl.jobId))[0]!
    assert.equal(beforeAclReport.state, 'targetAclUnverified')
    assert.equal(beforeAclReport.canCleanupStage, false)
    assert.equal(beforeAclReport.canDiscardJournal, false)
    await assert.rejects(applyRecovery(beforeAcl.jobId, 'cleanup', beforeAcl.jobId))
    assert.equal(await readFile(win32.join(beforeAcl.targetPath, 'generated.txt'), 'utf8'), 'before-finalize-acl')

    const collision = await readyStage('recovery-collision')
    debugCrash('--finalize-stage', { ...stageRequest(collision), testCrashAt: 'beforeFinalizeRename' })
    await mkdir(collision.targetPath)
    await writeFile(win32.join(collision.targetPath, 'user.txt'), 'do-not-overwrite')
    const collisionReport = (await inspectRecovery(collision.jobId))[0]!
    assert.equal(collisionReport.canFinalize, false)
    await assert.rejects(applyRecovery(collision.jobId, 'finalize', collision.jobId))
    await applyRecovery(collision.jobId, 'cleanup', collision.jobId)
    assert.equal(await readFile(win32.join(collision.targetPath, 'user.txt'), 'utf8'), 'do-not-overwrite')

    const markerCrash = await createOwnedStage(parent, win32.join(parent, 'marker-cleanup-crash'), 'marker-cleanup-crash')
    track(markerCrash.jobId)
    debugCrash('--cleanup-stage', { ...stageRequest(markerCrash), testCrashAt: 'afterOwnershipMarkerRemoval' })
    const markerReport = (await inspectRecovery(markerCrash.jobId))[0]!
    assert.equal(markerReport.state, 'cleanupInterrupted')
    await applyRecovery(markerCrash.jobId, 'cleanup', markerCrash.jobId)

    const rootCrash = await createOwnedStage(parent, win32.join(parent, 'root-cleanup-crash'), 'root-cleanup-crash')
    track(rootCrash.jobId)
    debugCrash('--cleanup-stage', { ...stageRequest(rootCrash), testCrashAt: 'afterStageRootRemoval' })
    const rootReport = (await inspectRecovery(rootCrash.jobId))[0]!
    assert.equal(rootReport.state, 'cleanupFinishedJournalPending')
    debugCrash('--recovery-apply', {
      journalRootPath: rootCrash.journalRootPath,
      jobId: rootCrash.jobId,
      action: 'cleanup',
      confirmJobId: rootCrash.jobId,
      testCrashAt: 'beforeJournalRemoval',
    })
    assert.equal((await inspectRecovery(rootCrash.jobId))[0]!.canDiscardJournal, true)
    debugCrash('--recovery-apply', {
      journalRootPath: rootCrash.journalRootPath,
      jobId: rootCrash.jobId,
      action: 'cleanup',
      confirmJobId: rootCrash.jobId,
      testCrashAt: 'afterJournalRemoval',
    })
    assert.deepEqual(await inspectRecovery(rootCrash.jobId), [])
    assert.equal(await readFile(sentinel, 'utf8'), 'preserve-me')
  } finally {
    for (const jobId of jobIds) await removeJournalForTest(journalRoot, jobId)
    await rm(parent, { recursive: true, force: true })
  }
})

async function skipElevatedStageOperation(t: TestContext): Promise<boolean> {
  const { response, exitCode } = await callSupervisor('--check-elevation', undefined, 15_000)
  assert.equal(exitCode, 0)
  if (response.elevated) {
    t.skip('native staging integration requires a non-elevated caller')
    return true
  }
  return false
}

test('finalize rejects contradictory supervisor response as unconfirmed', () => {
  for (const result of [
    { response: { ok: true }, exitCode: 1 },
    { response: { ok: false }, exitCode: 0 },
    { response: { ok: true }, exitCode: null },
    { response: { ok: false }, exitCode: null },
  ]) {
    assert.throws(
      () => checkFsResult(result, 'finalize'),
      (error: unknown) => error instanceof GeneratorError
        && error.code === 'GEN_FINALIZE_UNCONFIRMED'
        && error.targetModified,
    )
  }
  assert.throws(
    () => checkFsResult({ response: { ok: false, code: 'target_exists' }, exitCode: 1 }, 'finalize'),
    (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_PATH_EXISTS',
  )
})

function icacls(...args: string[]): void {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
  execFileSync(win32.join(systemRoot, 'System32', 'icacls.exe'), args, { stdio: 'ignore', windowsHide: true })
}

interface AclInfo {
  protected: boolean
  userSid: string
  entries: { sid: string; inherited: boolean; rights: string }[]
}

function readAcl(path: string): AclInfo {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
  const powershell = win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const script = [
    '$acl = Get-Acl -LiteralPath $env:PG_TEST_ACL_PATH',
    '$entries = @($acl.Access | ForEach-Object { [pscustomobject]@{ sid = $_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; inherited = $_.IsInherited; rights = $_.FileSystemRights.ToString() } })',
    '$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value',
    '[Console]::WriteLine((ConvertTo-Json -Compress -InputObject ([pscustomobject]@{ protected = $acl.AreAccessRulesProtected; userSid = $userSid; entries = $entries })))',
  ].join('; ')
  const output = execFileSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    env: { ...process.env, PG_TEST_ACL_PATH: path },
    windowsHide: true,
  })
  const parsed = JSON.parse(output) as AclInfo | (Omit<AclInfo, 'entries'> & { entries: AclInfo['entries'][number] })
  return { ...parsed, entries: Array.isArray(parsed.entries) ? parsed.entries : [parsed.entries] }
}

function assertRestrictedAcl(path: string, protectedDacl: boolean): void {
  const acl = readAcl(path)
  assert.equal(acl.protected, protectedDacl)
  assert.deepEqual(new Set(acl.entries.map((entry) => entry.sid)), new Set([acl.userSid, 'S-1-5-18']))
  assert.ok(acl.entries.every((entry) => entry.rights === 'FullControl'))
  if (protectedDacl) assert.ok(acl.entries.every((entry) => !entry.inherited))
}

function startJunctionSwap(path: string, backup: string, target: string): () => Promise<number> {
  let active = true
  let attempts = 0
  const running = (async () => {
    while (active) {
      attempts += 1
      await rename(path, backup).catch(() => undefined)
      await symlink(target, path, 'junction').catch(() => undefined)
      await unlink(path).catch(() => undefined)
      await rename(backup, path).catch(() => undefined)
      await new Promise((resolveWait) => setTimeout(resolveWait, 0))
    }
  })()
  return async () => {
    active = false
    await running
    await unlink(path).catch(() => undefined)
    await rename(backup, path).catch(() => undefined)
    return attempts
  }
}

test('rejects a junction in the destination path on Windows', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-junction-'))
  const target = win32.join(root, 'real')
  const junction = win32.join(root, 'junction')
  await mkdir(target)
  try {
    await symlink(target, junction, 'junction')
    await assert.rejects(assertNoReparsePoints(junction), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_PATH_UNSAFE')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('refuses forged marker cleanup without in-process ownership', async () => {
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-owned-'))
  const stagePath = win32.join(parent, '.project-generator-stage-forged')
  await mkdir(stagePath)
  await writeFile(win32.join(stagePath, '.ownership.json'), JSON.stringify({ schemaVersion: 1, jobId: 'forged', stageName: win32.basename(stagePath) }))
  const forged = {
    jobId: 'forged',
    path: stagePath,
    childPath: win32.join(stagePath, 'demo'),
    parentPath: parent,
    targetPath: win32.join(parent, 'demo'),
    markerPath: win32.join(stagePath, '.ownership.json'),
  } as OwnedStage
  try {
    await assert.rejects(cleanupOwnedStage(forged), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_STAGING_LEFTOVER')
    assert.equal((await readFile(forged.markerPath, 'utf8')).includes('forged'), true)
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('protected stage ACL ignores inherited parent deny', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-marker-rollback-'))
  const parent = win32.join(root, 'parent')
  await mkdir(parent)
  let stage: OwnedStage | undefined
  try {
    icacls(parent, '/deny', '*S-1-1-0:(CI)(IO)(WD)')
    stage = await createOwnedStage(parent, win32.join(parent, 'demo'), 'demo', 'marker-denied')
    assertRestrictedAcl(stage.path, true)
    await readFile(stage.markerPath, 'utf8')
    await cleanupOwnedStage(stage)
    assert.deepEqual(await readdir(parent), [])
  } finally {
    icacls(parent, '/reset', '/t', '/c')
    if (stage) await cleanupOwnedStage(stage).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('native stage writes stay rooted and preserve skip-existing files', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-stage-write-'))
  const stage = await createOwnedStage(parent, win32.join(parent, 'project'), 'project', 'unit-write')
  await mkdir(stage.childPath)
  await writeFile(win32.join(stage.childPath, 'README.md'), 'scaffold README')
  await writeFile(win32.join(stage.childPath, 'keep.md'), 'user content')
  try {
    const written = await mutateOwnedStage(stage, ['project/docs/guide'], [
      { path: 'project/README.md', content: 'generated README', replace: true },
      { path: 'project/keep.md', content: 'must not replace', skipExisting: true },
      { path: 'project/docs/guide/SETUP.md', content: 'setup instructions' },
    ])
    assert.deepEqual(written.sort(), ['project/README.md', 'project/docs/guide/SETUP.md'].sort())
    assert.equal(await readFile(win32.join(stage.childPath, 'README.md'), 'utf8'), 'generated README')
    assert.equal(await readFile(win32.join(stage.childPath, 'keep.md'), 'utf8'), 'user content')
    assert.equal(await readFile(win32.join(stage.childPath, 'docs', 'guide', 'SETUP.md'), 'utf8'), 'setup instructions')
  } finally {
    await cleanupOwnedStage(stage)
    await rm(parent, { recursive: true, force: true })
  }
})

test('native staging writes do not follow a concurrently swapped junction', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-stage-write-junction-'))
  const outside = win32.join(root, 'outside')
  const sentinel = win32.join(outside, 'keep.txt')
  const parent = win32.join(root, 'parent')
  await mkdir(parent)
  const stage = await createOwnedStage(parent, win32.join(parent, 'project'), 'project', 'race-write')
  const docs = win32.join(stage.childPath, 'docs')
  const displaced = win32.join(stage.childPath, 'docs-real')
  await mkdir(outside)
  await mkdir(stage.childPath)
  await mkdir(docs)
  await writeFile(sentinel, 'outside data')
  const stopRace = startJunctionSwap(docs, displaced, outside)
  try {
    await mutateOwnedStage(stage, [], [{ path: 'project/docs/generated.txt', content: 'owned data' }]).catch((error: unknown) => {
      assert.ok(error instanceof GeneratorError, 'junction replacement should fail closed')
    })
    const attempts = await stopRace()
    assert.ok(attempts > 0, 'junction swap loop should run')
    assert.equal(await readFile(sentinel, 'utf8'), 'outside data')
    assert.deepEqual((await readdir(outside)).sort(), ['keep.txt'])
  } finally {
    await stopRace().catch(() => 0)
    await cleanupOwnedStage(stage).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('cleanup failure retains ownership marker and retry can finish cleanup', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-cleanup-denied-'))
  const stage = await createOwnedStage(parent, win32.join(parent, 'project'), 'project', 'cleanup-denied')
  await mkdir(stage.childPath)
  const protectedFile = win32.join(stage.childPath, 'protected.txt')
  await writeFile(protectedFile, 'owned data')
  try {
    icacls(protectedFile, '/deny', '*S-1-1-0:(D)')
    await assert.rejects(cleanupOwnedStage(stage), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_STAGING_LEFTOVER')
    await readFile(stage.markerPath, 'utf8')
    assert.deepEqual(await readdir(stage.childPath), ['protected.txt'])
    icacls(protectedFile, '/reset')
    assert.equal(await readFile(protectedFile, 'utf8'), 'owned data')
    await cleanupOwnedStage(stage)
    await assert.rejects(lstat(stage.path), { code: 'ENOENT' })
  } finally {
    icacls(parent, '/reset', '/t', '/c')
    await cleanupOwnedStage(stage).catch(() => undefined)
    await rm(parent, { recursive: true, force: true })
  }
})

test('cleanup race never leaves a stage without ownership evidence', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-cleanup-marker-race-'))
  const stage = await createOwnedStage(parent, win32.join(parent, 'project'), 'project', 'cleanup-marker-race')
  await mkdir(stage.childPath)
  let active = true
  let sequence = 0
  let resolveStarted: (() => void) | undefined
  const started = new Promise<void>((resolve) => { resolveStarted = resolve })
  const writer = (async () => {
    while (active) {
      const name = `.racing-entry-${sequence++}`
      await writeFile(win32.join(stage.path, name), 'racing').then(() => resolveStarted?.()).catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  })()
  await started
  try {
    await cleanupOwnedStage(stage).catch((error: unknown) => {
      assert.ok(error instanceof GeneratorError && error.code === 'GEN_STAGING_LEFTOVER')
    })
  } finally {
    active = false
    await writer
  }
  try {
    const entries = await readdir(stage.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return undefined
      throw error
    })
    if (entries) {
      assert.ok(entries.includes('.ownership.json'), 'retained stage must keep ownership marker')
      await cleanupOwnedStage(stage)
    }
    await assert.rejects(lstat(stage.path), { code: 'ENOENT' }, 'successful cleanup must remove stage')
  } finally {
    await cleanupOwnedStage(stage).catch(() => undefined)
    await rm(parent, { recursive: true, force: true })
  }
})

test('destination collision check is case-insensitive on Windows', { skip: process.platform !== 'win32' }, async () => {
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-case-collision-'))
  await mkdir(win32.join(parent, 'Existing-App'))
  try {
    await assert.rejects(inspectTarget(parent, 'existing-app'), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_PATH_EXISTS')
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('Windows no-replace finalize preserves an occupied target', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-race-'))
  const target = win32.join(parent, 'occupied')
  const stage = await createOwnedStage(parent, target, 'occupied', 'unit-race')
  await mkdir(stage.childPath)
  await writeFile(win32.join(stage.childPath, 'generated.txt'), 'generator data')
  await mkdir(target)
  await writeFile(win32.join(target, 'user.txt'), 'user data')
  try {
    await bindOwnedStageProjectIdentity(stage, 'occupied')
    await assert.rejects(moveDirectoryNoReplace(stage), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_PATH_EXISTS')
    assert.equal(await readFile(win32.join(target, 'user.txt'), 'utf8'), 'user data')
    assert.equal(await readFile(win32.join(stage.childPath, 'generated.txt'), 'utf8'), 'generator data')
  } finally {
    await cleanupOwnedStage(stage)
    await rm(parent, { recursive: true, force: true })
  }
})

test('Windows no-replace finalize moves only validated staging content', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-move-'))
  const target = win32.join(parent, 'committed')
  const stage = await createOwnedStage(parent, target, 'committed', 'unit-commit')
  await mkdir(stage.childPath)
  await writeFile(win32.join(stage.childPath, 'generated.txt'), 'verified')
  try {
    await bindOwnedStageProjectIdentity(stage, 'committed')
    await moveDirectoryNoReplace(stage)
    await cleanupOwnedStage(stage)
    assert.equal(await readFile(win32.join(target, 'generated.txt'), 'utf8'), 'verified')
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('owned staging and finalized output use protected current-user ACLs', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-stage-acl-'))
  const target = win32.join(parent, 'project')
  icacls(parent, '/grant', '*S-1-1-0:(OI)(CI)(M)')
  const stage = await createOwnedStage(parent, target, 'project', 'acl-protected')
  await mkdir(stage.childPath)
  await writeFile(win32.join(stage.childPath, 'generated.txt'), 'verified')
  try {
    assertRestrictedAcl(stage.path, true)
    assertRestrictedAcl(stage.childPath, false)
    await bindOwnedStageProjectIdentity(stage, 'project')
    await moveDirectoryNoReplace(stage)
    assertRestrictedAcl(target, true)
    await cleanupOwnedStage(stage)
    assert.equal(await readFile(win32.join(target, 'generated.txt'), 'utf8'), 'verified')
  } finally {
    await cleanupOwnedStage(stage).catch(() => undefined)
    icacls(parent, '/reset', '/t', '/c')
    await rm(parent, { recursive: true, force: true })
  }
})

test('scaffold package identity is read through the bound native directory handle', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-scaffold-identity-'))
  const stage = await createOwnedStage(parent, win32.join(parent, 'project'), 'project', 'scaffold-identity')
  await mkdir(stage.childPath)
  const manifestPath = win32.join(stage.childPath, 'package.json')
  try {
    await writeFile(manifestPath, JSON.stringify({ name: 'project' }))
    await bindOwnedStageProjectIdentity(stage, 'project')
    await verifyOwnedStageProjectIdentity(stage, 'project')
    await writeFile(manifestPath, JSON.stringify({ name: 'different-project' }))
    await assert.rejects(
      verifyOwnedStageProjectIdentity(stage, 'project'),
      (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_SCAFFOLD_INVALID',
    )
  } finally {
    await cleanupOwnedStage(stage).catch(() => undefined)
    await rm(parent, { recursive: true, force: true })
  }
})

test('FastAPI project identity is verified from pyproject.toml through the bound native directory handle', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-python-scaffold-identity-'))
  const stage = await createOwnedStage(parent, win32.join(parent, 'project'), 'project', 'python-scaffold-identity')
  try {
    await mkdir(stage.childPath)
    await writeFile(win32.join(stage.childPath, 'pyproject.toml'), '[project]\nname = "project"\n')
    await bindOwnedStageProjectIdentity(stage, 'project')
    await verifyOwnedStageProjectIdentity(stage, 'project', undefined, 'pyproject.toml')
    await writeFile(win32.join(stage.childPath, 'pyproject.toml'), '[project]\nname = "different-project"\n')
    await assert.rejects(
      verifyOwnedStageProjectIdentity(stage, 'project', undefined, 'pyproject.toml'),
      (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_SCAFFOLD_INVALID',
    )
  } finally {
    await cleanupOwnedStage(stage).catch(() => undefined)
    await rm(parent, { recursive: true, force: true })
    await removeJournalForTest(stage.journalRootPath, stage.jobId)
  }
})

test('finalize rejects replaced ordinary project directory and retains stage marker', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-project-identity-'))
  const target = win32.join(parent, 'project')
  const stage = await createOwnedStage(parent, target, 'project', `identity-replaced-${randomUUID()}`)
  const displaced = win32.join(stage.path, 'project-original')
  await mkdir(stage.childPath)
  await writeFile(win32.join(stage.childPath, 'generated.txt'), 'validated')
  try {
    await bindOwnedStageProjectIdentity(stage, 'project')
    await rename(stage.childPath, displaced)
    await mkdir(stage.childPath)
    await writeFile(win32.join(stage.childPath, 'generated.txt'), 'substituted')
    await assert.rejects(
      moveDirectoryNoReplace(stage),
      (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_STAGE_IDENTITY_MISMATCH',
    )
    await assert.rejects(
      verifyOwnedStageProjectIdentity(stage, 'project'),
      (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_STAGE_IDENTITY_MISMATCH',
    )
    assert.equal(await readFile(win32.join(displaced, 'generated.txt'), 'utf8'), 'validated')
    assert.equal(await readFile(win32.join(stage.childPath, 'generated.txt'), 'utf8'), 'substituted')
    assert.ok(await readFile(stage.markerPath, 'utf8').then((text) => JSON.parse(text).projectIdentity))
    await assert.rejects(
      cleanupOwnedStage(stage),
      (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_STAGE_IDENTITY_MISMATCH',
    )
    assert.ok(await readFile(stage.markerPath, 'utf8'), 'identity mismatch must retain ownership evidence')
    await assert.rejects(readdir(target), (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT')
  } finally {
    await cleanupOwnedStage(stage).catch(() => undefined)
    await rm(parent, { recursive: true, force: true })
    await removeJournalForTest(stage.journalRootPath, stage.jobId)
  }
})

test('stage creation rejects parent junction swaps without creating outside entries', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-stage-parent-swap-'))
  const parent = win32.join(root, 'parent')
  const displaced = win32.join(root, 'parent-real')
  const outside = win32.join(root, 'outside')
  const sentinel = win32.join(outside, 'keep.txt')
  const journalRoot = win32.join(process.env.LOCALAPPDATA!, '.project-generator-transactions')
  const jobId = randomUUID()
  await Promise.all([mkdir(parent), mkdir(outside)])
  await writeFile(sentinel, 'outside data')
  const stopRace = startJunctionSwap(parent, displaced, outside)
  let stage: OwnedStage | undefined
  try {
    try {
      stage = await createOwnedStage(parent, win32.join(parent, 'race-project'), 'race-project', jobId)
    } catch (error) {
      assert.ok(error instanceof GeneratorError, 'native create failure should be reported')
    }
    const attempts = await stopRace()
    assert.ok(attempts > 0, 'parent swap loop should run')
    assert.equal(await readFile(sentinel, 'utf8'), 'outside data')
    assert.deepEqual((await readdir(outside)).sort(), ['keep.txt'])
  } finally {
    await stopRace()
    if (stage) await cleanupOwnedStage(stage).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
    await removeJournalForTest(journalRoot, jobId)
    await assert.rejects(lstat(win32.join(journalRoot, `.transaction-${jobId}.jsonl`)), { code: 'ENOENT' })
  }
})

test('support cleanup contains concurrent junction replacement within staging', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-cleanup-junction-swap-'))
  const outside = win32.join(root, 'outside')
  const sentinel = win32.join(outside, 'keep.txt')
  const target = win32.join(root, 'project')
  const stage = await createOwnedStage(root, target, 'project', 'race-cleanup')
  const support = win32.join(stage.path, '.tools')
  const displaced = win32.join(stage.path, '.tools-real')
  await Promise.all([mkdir(outside), mkdir(support)])
  await writeFile(sentinel, 'outside data')
  const stopRace = startJunctionSwap(support, displaced, outside)
  try {
    await cleanupStageSupportFiles(stage).catch((error: unknown) => {
      assert.ok(error instanceof GeneratorError && error.code === 'GEN_STAGING_LEFTOVER')
    })
    assert.equal(await readFile(sentinel, 'utf8'), 'outside data')
    const attempts = await stopRace()
    assert.ok(attempts > 0, 'junction swap loop should run')
    assert.equal(await readFile(sentinel, 'utf8'), 'outside data')
  } finally {
    await stopRace().catch(() => 0)
    await cleanupOwnedStage(stage).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})

test('no-replace finalize contains concurrent project junction replacement', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-finalize-junction-swap-'))
  const outside = win32.join(root, 'outside')
  const sentinel = win32.join(outside, 'keep.txt')
  const target = win32.join(root, 'project')
  const stage = await createOwnedStage(root, target, 'project', 'race-finalize')
  const displaced = win32.join(stage.path, 'project-real')
  await Promise.all([mkdir(outside), mkdir(stage.childPath)])
  await writeFile(sentinel, 'outside data')
  await writeFile(win32.join(stage.childPath, 'generated.txt'), 'owned data')
  await bindOwnedStageProjectIdentity(stage, 'project')
  const stopRace = startJunctionSwap(stage.childPath, displaced, outside)
  let finalized = false
  try {
    await moveDirectoryNoReplace(stage).then(() => {
      finalized = true
    }).catch((error: unknown) => {
      assert.ok(error instanceof GeneratorError, 'native finalize race should fail closed')
    })
    const attempts = await stopRace()
    assert.ok(attempts > 0, 'junction swap loop should run')
    assert.equal(await readFile(sentinel, 'utf8'), 'outside data')
    if (finalized) assert.equal(await readFile(win32.join(target, 'generated.txt'), 'utf8'), 'owned data')
  } finally {
    await stopRace().catch(() => 0)
    await cleanupOwnedStage(stage).catch(() => undefined)
    await rm(root, { recursive: true, force: true })
  }
})
