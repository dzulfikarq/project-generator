import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, win32 } from 'node:path'
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

test('recovery apply refuses mismatched confirmation before native operations', () => {
  const result = spawnSync(process.execPath, [cli, 'recovery', 'apply', '--job-id', 'transaction-1', '--action', 'cleanup', '--confirm-job', 'other', '--json'], { encoding: 'utf8' })
  assert.equal(result.status, 4)
  const envelope = JSON.parse(result.stdout) as { ok: boolean; error: { code: string } }
  assert.equal(envelope.ok, false)
  assert.equal(envelope.error.code, 'GEN_RECOVERY_CONFIRMATION_REQUIRED')
})

test('recovery apply requires explicit action and matching job confirmation', () => {
  const result = spawnSync(process.execPath, [cli, 'recovery', 'apply', '--job-id', 'transaction-1', '--json'], { encoding: 'utf8' })
  assert.equal(result.status, 2)
  const envelope = JSON.parse(result.stdout) as { ok: boolean; error: { code: string } }
  assert.equal(envelope.ok, false)
  assert.equal(envelope.error.code, 'GEN_CLI_USAGE')
})

test('recovery inspect prints complete actionable cleanup command', { skip: process.platform !== 'win32' }, async (t) => {
  const supervisor = resolve(dirname(fileURLToPath(import.meta.url)), '../../../core/native/pg-windows-supervisor.exe')
  const elevation = spawnSync(supervisor, ['--check-elevation'], { encoding: 'utf8', windowsHide: true })
  assert.equal(elevation.status, 0)
  if ((JSON.parse(elevation.stdout) as { elevated: boolean }).elevated) {
    t.skip('native recovery integration requires a non-elevated caller')
    return
  }
  const parent = await mkdtemp(resolve(tmpdir(), 'pg-cli-recovery-'))
  const jobId = randomUUID()
  const localAppData = process.env.LOCALAPPDATA
  assert.ok(localAppData && win32.isAbsolute(localAppData))
  const journalRootPath = win32.join(localAppData, '.project-generator-transactions')
  const stagePath = win32.join(parent, `.project-generator-stage-${jobId}`)
  const request = {
    jobId,
    transactionNonce: randomBytes(32).toString('hex'),
    journalRootPath,
    stagePath,
    sourcePath: win32.join(stagePath, 'project'),
    parentPath: parent,
    projectName: 'project',
    targetPath: win32.join(parent, 'project'),
  }
  try {
    const created = spawnSync(supervisor, ['--create-journal'], {
      input: `${JSON.stringify(request)}\n`,
      encoding: 'utf8',
      windowsHide: true,
    })
    assert.equal(created.status, 0, created.stdout)
    const result = spawnSync(process.execPath, [cli, 'recovery', 'inspect', '--job-id', jobId], { encoding: 'utf8' })
    assert.equal(result.status, 0)
    assert.match(result.stdout, new RegExp(`project-generator recovery apply --job-id ${jobId} --action cleanup --confirm-job ${jobId}`))
  } finally {
    await rm(win32.join(journalRootPath, `.transaction-${jobId}.jsonl`), { force: true }).catch(() => undefined)
    await rm(parent, { recursive: true, force: true })
  }
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
