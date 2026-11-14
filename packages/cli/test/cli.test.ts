import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import test, { type TestContext } from 'node:test'
import { ALLOW_PLANNED_RECIPE_GENERATION } from '@project-generator/core'

const cli = resolve(dirname(fileURLToPath(import.meta.url)), '../src/index.js')

test('catalog emits local versioned JSON without network', () => {
  const result = spawnSync(process.execPath, [cli, 'catalog', '--json'], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  const envelope = JSON.parse(result.stdout) as {
    ok: boolean
    data: {
      adapters: { id: string; compatibleWith: string[]; incompatibleWith: string[] }[]
      recipes: { id: string; status: string; scaffold: { packageName: string; version: string; integrity: string; source?: { commitSha: string } }; dependencies?: { packageName: string; version: string; integrity: string; scope?: string }[] }[]
    }
  }
  assert.equal(envelope.ok, true)
  assert.deepEqual(envelope.data.recipes.map(({ id, status }) => [id, status]), [
    ['FE-01', 'planned'], ['FE-02', 'planned'], ['FE-03', 'planned'], ['FE-04', 'planned'], ['FE-05', 'planned'], ['FE-06', 'planned'], ['FE-07', 'planned'], ['FE-08', 'planned'], ['FE-09', 'planned'], ['FE-10', 'planned'], ['FE-11', 'planned'],
  ])
  const vue = envelope.data.recipes.find(({ id }) => id === 'FE-03')!
  assert.equal(vue.scaffold.packageName, 'create-vue')
  assert.equal(vue.scaffold.version, '3.24.0')
  assert.match(vue.scaffold.integrity, /^sha512-/)
  for (const id of ['FE-04', 'FE-05']) {
    const recipe = envelope.data.recipes.find((item) => item.id === id)!
    assert.deepEqual(recipe.dependencies?.map(({ packageName, version }) => [packageName, version]), [['bootstrap', '5.3.9']])
    assert.match(recipe.dependencies?.[0]?.integrity ?? '', /^sha512-/)
  }
  const nuxt = envelope.data.recipes.find(({ id }) => id === 'FE-06')!
  assert.equal(nuxt.scaffold.packageName, 'create-nuxt')
  assert.equal(nuxt.scaffold.version, '4.0.3')
  assert.equal(nuxt.scaffold.source?.commitSha, 'db01806fcb37f2e369fb09443c72cac696b31548')
  assert.deepEqual(nuxt.dependencies?.map(({ packageName, version, scope }) => [packageName, version, scope]), [
    ['nuxt', '4.6.4', undefined],
    ['typescript', '5.9.3', 'devDependencies'],
    ['vue-tsc', '3.3.14', 'devDependencies'],
  ])
  assert.ok(nuxt.dependencies?.every(({ integrity }) => integrity.startsWith('sha512-')))
  const angular = envelope.data.recipes.find(({ id }) => id === 'FE-07')!
  assert.equal(angular.scaffold.packageName, '@angular/cli')
  assert.equal(angular.scaffold.version, '21.2.30')
  assert.deepEqual(angular.dependencies?.map(({ packageName, version }) => [packageName, version]), [['@angular/core', '21.2.26'], ['@angular/cli', '21.2.30']])
  const forma = envelope.data.adapters.find(({ id }) => id === 'template.forma')!
  assert.equal(forma.compatibleWith.includes('frontend.vue-vite'), false)
  const bootstrap = envelope.data.adapters.find(({ id }) => id === 'styling.bootstrap')!
  assert.ok(bootstrap.incompatibleWith.includes('styling.tailwind'))
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

test('CLI plans FE-03 through FE-11 read-only and preserves planned status', async () => {
  const parent = await mkdtemp(resolve(tmpdir(), 'pg-phase04a-plan-'))
  const cases = [
    ['FE-03', 'frontend.vue-vite', 'styling.css'],
    ['FE-04', 'frontend.react-vite', 'styling.bootstrap'],
    ['FE-05', 'frontend.vue-vite', 'styling.bootstrap'],
    ['FE-06', 'frontend.nuxt', 'styling.css'],
    ['FE-07', 'frontend.angular', 'styling.scss'],
    ['FE-08', 'frontend.react-vite', 'styling.scss'],
    ['FE-09', 'frontend.vue-vite', 'styling.scss'],
    ['FE-10', 'frontend.react-vite', 'styling.tailwind'],
    ['FE-11', 'frontend.vue-vite', 'styling.tailwind'],
  ] as const
  try {
    for (const [id, frontend, styling] of cases) {
      const configPath = resolve(parent, `${id}.json`)
      const targetName = `target-${id.toLowerCase()}`
      await writeFile(configPath, JSON.stringify({
        schemaVersion: 1,
        project: { name: targetName, type: 'frontend', parentDirectory: parent },
        frontend: { adapterId: frontend, language: 'ts', manager: 'npm' },
        styling: { adapterId: styling },
        documentation: 'minimal',
        git: { initialize: false, initialCommit: false },
      }))
      const result = spawnSync(process.execPath, [cli, 'plan', '--config', configPath, '--json'], { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stdout)
      const plan = (JSON.parse(result.stdout) as { data: { recipeId: string; recipeStatus: string; executionAvailable: boolean; expectedWrites: string[]; networkAccess: string[] } }).data
      assert.equal(plan.recipeId, id)
      assert.equal(plan.recipeStatus, 'planned')
      assert.equal(plan.executionAvailable, false)
      if (styling === 'styling.bootstrap') assert.ok(plan.expectedWrites.includes('src/project-generator-bootstrap.css'))
      if (id === 'FE-06') {
        assert.ok(plan.networkAccess.includes('https://api.github.com'))
        assert.ok(plan.networkAccess.includes('https://codeload.github.com'))
      }
      if (id === 'FE-07') assert.ok(plan.expectedWrites.includes('<pinned Angular CLI workspace files>'))
      if (id === 'FE-08' || id === 'FE-09') assert.ok(plan.expectedWrites.includes('src/project-generator.scss'))
      if (id === 'FE-10' || id === 'FE-11') assert.ok(plan.expectedWrites.includes('src/project-generator-tailwind.css'))
      await assert.rejects(access(resolve(parent, targetName)))
    }
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})

test('internal CLI planned override reaches preflight while default generation stays blocked', { skip: !ALLOW_PLANNED_RECIPE_GENERATION }, async (t: TestContext) => {
  if (process.platform !== 'win32') {
    t.skip('planned generation requires the Windows supervisor')
    return
  }
  const supervisor = resolve(dirname(fileURLToPath(import.meta.url)), '../../../core/native/pg-windows-supervisor.exe')
  const elevation = spawnSync(supervisor, ['--check-elevation'], { encoding: 'utf8', windowsHide: true })
  assert.equal(elevation.status, 0)
  if ((JSON.parse(elevation.stdout) as { elevated: boolean }).elevated) {
    t.skip('internal generation policy check requires a non-elevated caller')
    return
  }

  const parent = await mkdtemp(resolve(tmpdir(), 'pg-internal-policy-'))
  const occupiedTarget = resolve(parent, 'occupied-project')
  const sentinel = resolve(occupiedTarget, 'keep.txt')
  const overrideConfig = resolve(parent, 'override.json')
  const blockedConfig = resolve(parent, 'blocked.json')
  const config = (name: string) => ({
    schemaVersion: 1,
    project: { name, parentDirectory: parent, type: 'frontend' },
    frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'npm' },
    styling: { adapterId: 'styling.css' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  })
  const codes = (stdout: string): string[] => stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as { code?: string }).map((event) => event.code ?? '')
  const cleanupLog = async (stderr: string): Promise<void> => {
    const log = stderr.match(/^Redacted job log: (.+)$/m)?.[1]
    if (log) await rm(dirname(log.trim()), { recursive: true, force: true })
  }

  try {
    await mkdir(occupiedTarget)
    await writeFile(sentinel, 'preserve')
    await writeFile(overrideConfig, JSON.stringify(config('occupied-project')))
    await writeFile(blockedConfig, JSON.stringify(config('blocked-project')))

    const allowed = spawnSync(process.execPath, [cli, 'generate', '--config', overrideConfig, '--jsonl', '--development-allow-planned'], { encoding: 'utf8', windowsHide: true })
    assert.equal(allowed.status, 6, allowed.stderr)
    assert.ok(codes(allowed.stdout).includes('GEN_PATH_EXISTS'), allowed.stdout)
    await cleanupLog(allowed.stderr)

    const blocked = spawnSync(process.execPath, [cli, 'generate', '--config', blockedConfig, '--jsonl'], { encoding: 'utf8', windowsHide: true })
    assert.equal(blocked.status, 3, blocked.stderr)
    assert.ok(codes(blocked.stdout).includes('GEN_RECIPE_UNTESTED'), blocked.stdout)
    await cleanupLog(blocked.stderr)

    assert.equal(await readFile(sentinel, 'utf8'), 'preserve')
    assert.deepEqual((await readdir(parent)).sort(), ['blocked.json', 'occupied-project', 'override.json'])
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
