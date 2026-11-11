import assert from 'node:assert/strict'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/index.js')

test('catalog emits local versioned JSON without network', () => {
  const result = spawnSync(process.execPath, [cli, 'catalog', '--json'], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  const envelope = JSON.parse(result.stdout) as { ok: boolean; data: { recipes: { id: string; status: string }[] } }
  assert.equal(envelope.ok, true)
  assert.deepEqual(envelope.data.recipes.map(({ id, status }) => [id, status]), [['FE-01', 'planned'], ['FE-02', 'planned']])
})

test('plan reads config but does not create a missing destination', async () => {
  const parent = await mkdtemp(resolve(tmpdir(), 'pg-plan-parent-'))
  const missing = resolve(parent, 'not-created')
  const configPath = resolve(parent, 'selection.json')
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    project: { name: 'read-only-check', type: 'frontend', parentDirectory: missing },
    frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'npm' },
    styling: { adapterId: 'styling.css' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }))
  try {
    const result = spawnSync(process.execPath, [cli, 'plan', '--config', configPath, '--json'], { encoding: 'utf8' })
    assert.equal(result.status, 0)
    assert.equal((JSON.parse(result.stdout) as { ok: boolean }).ok, true)
    await assert.rejects(import('node:fs/promises').then(({ access }) => access(missing)))
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('doctor reports actual Node/npm and absent destination without writes', async () => {
  const parent = await mkdtemp(resolve(tmpdir(), 'pg-doctor-parent-'))
  const configPath = resolve(parent, 'selection.json')
  const target = resolve(parent, 'doctor-target')
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    project: { name: 'doctor-target', type: 'frontend', parentDirectory: parent },
    frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'npm' },
    styling: { adapterId: 'styling.css' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }))
  try {
    const result = spawnSync(process.execPath, [cli, 'doctor', '--config', configPath, '--json'], { encoding: 'utf8' })
    assert.equal(result.status, 0)
    const report = (JSON.parse(result.stdout) as { data: { ready: boolean; tools: { id: string; available: boolean }[] } }).data
    assert.equal(report.ready, true)
    assert.deepEqual(report.tools.map(({ id, available }) => [id, available]), [['node', true], ['npm', true], ['target', true]])
    await assert.rejects(access(target))
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
