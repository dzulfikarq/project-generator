import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { win32 } from 'node:path'
import test from 'node:test'
import { GeneratorError } from '../src/errors.js'
import { assertNoReparsePoints, inspectTarget } from '../src/paths.js'
import { cleanupOwnedStage, createOwnedStage, moveDirectoryNoReplace } from '../src/staging.js'
import type { OwnedStage } from '../src/staging.js'

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

test('destination collision check is case-insensitive on Windows', { skip: process.platform !== 'win32' }, async () => {
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-case-collision-'))
  await mkdir(win32.join(parent, 'Existing-App'))
  try {
    await assert.rejects(inspectTarget(parent, 'existing-app'), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_PATH_EXISTS')
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('Windows no-replace finalize preserves an occupied target', { skip: process.platform !== 'win32' }, async () => {
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

test('Windows no-replace finalize moves only validated staging content', { skip: process.platform !== 'win32' }, async () => {
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
