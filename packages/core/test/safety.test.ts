import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { win32 } from 'node:path'
import test, { type TestContext } from 'node:test'
import { GeneratorError } from '../src/errors.js'
import { callSupervisor } from '../src/native-supervisor.js'
import { assertNoReparsePoints, inspectTarget } from '../src/paths.js'
import { cleanupOwnedStage, cleanupStageSupportFiles, createOwnedStage, moveDirectoryNoReplace, mutateOwnedStage } from '../src/staging.js'
import type { OwnedStage } from '../src/staging.js'

async function skipElevatedStageOperation(t: TestContext): Promise<boolean> {
  const { response, exitCode } = await callSupervisor('--check-elevation', undefined, 15_000)
  assert.equal(exitCode, 0)
  if (response.elevated) {
    t.skip('native staging integration requires a non-elevated caller')
    return true
  }
  return false
}

function icacls(...args: string[]): void {
  const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
  execFileSync(win32.join(systemRoot, 'System32', 'icacls.exe'), args, { stdio: 'ignore', windowsHide: true })
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

test('marker creation failure rolls back newly created staging', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-marker-rollback-'))
  const parent = win32.join(root, 'parent')
  await mkdir(parent)
  try {
    icacls(parent, '/deny', '*S-1-1-0:(CI)(IO)(WD)')
    await assert.rejects(
      createOwnedStage(parent, win32.join(parent, 'demo'), 'demo', 'marker-denied'),
      (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_STAGE_CREATE_FAILED',
    )
    assert.deepEqual(await readdir(parent), [], 'failed marker creation must remove the new stage')
  } finally {
    icacls(parent, '/reset', '/t', '/c')
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
    await assert.rejects(readdir(stage.path))
  } finally {
    icacls(parent, '/reset', '/t', '/c')
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
    await moveDirectoryNoReplace(stage)
    await cleanupOwnedStage(stage)
    assert.equal(await readFile(win32.join(target, 'generated.txt'), 'utf8'), 'verified')
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('stage creation rejects parent junction swaps without creating outside entries', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedStageOperation(t)) return
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-stage-parent-swap-'))
  const parent = win32.join(root, 'parent')
  const displaced = win32.join(root, 'parent-real')
  const outside = win32.join(root, 'outside')
  const sentinel = win32.join(outside, 'keep.txt')
  await Promise.all([mkdir(parent), mkdir(outside)])
  await writeFile(sentinel, 'outside data')
  const stopRace = startJunctionSwap(parent, displaced, outside)
  let stage: OwnedStage | undefined
  try {
    try {
      stage = await createOwnedStage(parent, win32.join(parent, 'race-project'), 'race-project', 'race-create')
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
