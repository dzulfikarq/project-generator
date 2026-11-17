import assert from 'node:assert/strict'
import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const mode = process.argv[2]
if (mode !== 'system' && mode !== 'bundled') throw new Error('Pass runtime mode: system or bundled.')

const resourceRoot = process.argv[3]
  ? resolve(process.argv[3])
  : resolve(import.meta.dirname, '..', 'packages', 'desktop', 'src-tauri', 'resources', 'pg-runtime')
const runtime = mode === 'bundled' ? join(resourceRoot, 'runtime', 'node.exe') : process.execPath
const cli = join(resourceRoot, 'cli', 'dist', 'src', 'index.js')
const core = join(resourceRoot, 'cli', 'node_modules', '@project-generator', 'core', 'dist', 'src', 'index.js')
await Promise.all([access(runtime), access(cli), access(core)])

const tempBase = join(process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
await access(tempBase)
const root = await mkdtemp(join(tempBase, 'pg-packaged-cli-policy-'))
const untrustedEnvironment = {
  ...process.env,
  TEMP: tempBase,
  TMP: tempBase,
  NODE_ENV: 'development',
  PG_BUILD_PROFILE: 'development',
  PG_ALLOW_PLANNED_RECIPE_GENERATION: 'true',
}
const configs = [
  ['FE-01', 'frontend.react-vite', 'styling.css'],
  ['FE-02', 'frontend.nextjs-app', 'styling.tailwind'],
  ['FE-03', 'frontend.vue-vite', 'styling.css'],
  ['FE-04', 'frontend.react-vite', 'styling.bootstrap'],
  ['FE-05', 'frontend.vue-vite', 'styling.bootstrap'],
  ['FE-06', 'frontend.nuxt', 'styling.css'],
  ['FE-07', 'frontend.angular', 'styling.scss'],
  ['FE-08', 'frontend.react-vite', 'styling.scss'],
  ['FE-09', 'frontend.vue-vite', 'styling.scss'],
  ['FE-10', 'frontend.react-vite', 'styling.tailwind'],
  ['FE-11', 'frontend.vue-vite', 'styling.tailwind'],
  ['FE-12', 'frontend.react-vite', 'styling.css', undefined, 'yarn'],
  ['FE-13', 'frontend.vue-vite', 'styling.css', undefined, 'yarn'],
  ['FE-14', 'frontend.react-vite', 'styling.css', undefined, 'pnpm'],
  ['FE-15', 'frontend.vue-vite', 'styling.css', undefined, 'pnpm'],
  ['BE-01', 'backend.express', undefined, undefined, 'npm'],
  ['BE-07', 'backend.express', undefined, undefined, 'npm'],
  ['BE-08', 'backend.express', undefined, undefined, 'npm'],
  ['BE-02', 'backend.go-net-http', undefined, undefined, 'go-modules'],
  ['FM-01', 'frontend.react-vite', undefined, 'focus-planner'],
  ['FM-02', 'frontend.nextjs-app', undefined, 'staywise-host-dashboard'],
]

function selection(id, frontend, styling, templateId, manager = 'npm') {
  if (id === 'BE-01') return {
    schemaVersion: 1,
    project: { name: 'planned-be-01', parentDirectory: root, type: 'backend' },
    backend: { adapterId: 'backend.express', manager: 'npm' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }
  if (id === 'BE-02') return {
    schemaVersion: 1,
    project: { name: 'planned-be-02', parentDirectory: root, type: 'backend' },
    backend: { adapterId: 'backend.go-net-http', manager: 'go-modules', modulePath: 'example.com/planned-be-02' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }
  if (id === 'BE-07') return {
    schemaVersion: 1,
    project: { name: 'planned-be-07', parentDirectory: root, type: 'backend' },
    backend: { adapterId: 'backend.express', manager: 'npm' },
    database: { adapterId: 'database.sqlite', accessAdapterId: 'data-access.drizzle-sqlite', mode: 'embedded' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }
  if (id === 'BE-08') return {
    schemaVersion: 1,
    project: { name: 'planned-be-08', parentDirectory: root, type: 'backend' },
    backend: { adapterId: 'backend.express', manager: 'npm' },
    database: { adapterId: 'database.postgresql', accessAdapterId: 'data-access.drizzle-postgresql', mode: 'existing-service' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }
  const project = {
    schemaVersion: 1,
    project: { name: `planned-${id.toLowerCase()}`, parentDirectory: root, type: 'frontend' },
    frontend: { adapterId: frontend, language: 'ts', manager },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }
  if (templateId) project.template = { adapterId: 'template.forma', templateId, commitSha: '5cf3c4e5b7b0bc454a653f58d12237c56f2548e2' }
  else project.styling = { adapterId: styling }
  return project
}

function invoke(args) {
  const result = spawnSync(runtime, [cli, ...args], { cwd: root, encoding: 'utf8', windowsHide: true, env: untrustedEnvironment })
  if (result.error) throw result.error
  return result
}

function events(stdout) {
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

async function cleanJobLog(stderr) {
  const log = stderr.match(/^Redacted job log: (.+)$/m)?.[1]
  if (log) await rm(dirname(log.trim()), { recursive: true, force: true })
}

try {
  const configPaths = []
  for (const [id, frontend, styling, templateId, manager] of configs) {
    const configPath = join(root, `${id}.json`)
    await writeFile(configPath, JSON.stringify(selection(id, frontend, styling, templateId, manager)))
    configPaths.push(configPath)
  }

  const catalogResult = invoke(['catalog', '--json'])
  assert.equal(catalogResult.status, 0, catalogResult.stderr)
  const catalog = JSON.parse(catalogResult.stdout)
  assert.equal(catalog.ok, true)
  assert.deepEqual(catalog.data.recipes.map(({ id, status }) => [id, status]), [
    ...configs.filter(([id]) => id.startsWith('FE-')).map(([id]) => [id, 'planned']),
    ['BE-01', 'planned'],
    ['BE-07', 'planned'],
    ['BE-08', 'planned'],
    ['BE-03', 'planned'],
    ['BE-02', 'planned'],
    ['BE-04', 'planned'],
    ['BE-05', 'planned'],
    ['BE-06', 'planned'],
  ])
  assert.deepEqual(catalog.data.forma.integrations.map(({ recipeId, status }) => [recipeId, status]), [['FM-01', 'planned'], ['FM-02', 'planned']])

  const planResult = invoke(['plan', '--config', configPaths[0], '--json'])
  assert.equal(planResult.status, 0, planResult.stdout)
  const plan = JSON.parse(planResult.stdout).data
  assert.equal(plan.recipeId, 'FE-01')
  assert.equal(plan.recipeStatus, 'planned')
  assert.equal(plan.executionAvailable, false)

  const backendConfigPath = join(root, 'BE-01.json')
  const backendPlan = invoke(['plan', '--config', backendConfigPath, '--json'])
  assert.equal(backendPlan.status, 0, backendPlan.stdout)
  assert.equal(JSON.parse(backendPlan.stdout).data.recipeId, 'BE-01')
  assert.equal(JSON.parse(backendPlan.stdout).data.executionAvailable, false)

  const postgresConfigPath = join(root, 'BE-08.json')
  const postgresPlan = invoke(['plan', '--config', postgresConfigPath, '--json'])
  assert.equal(postgresPlan.status, 0, postgresPlan.stdout)
  const postgresPlanData = JSON.parse(postgresPlan.stdout).data
  assert.equal(postgresPlanData.recipeId, 'BE-08')
  assert.equal(postgresPlanData.recipeStatus, 'planned')
  assert.equal(postgresPlanData.executionAvailable, false)
  assert.ok(postgresPlanData.expectedWrites.includes('src/db/migrate.ts'))
  assert.ok(postgresPlanData.expectedWrites.includes('docs/DATABASE-SAFETY.md'))
  assert.equal(new Set(postgresPlanData.expectedWrites).size, postgresPlanData.expectedWrites.length)
  assert.ok(postgresPlanData.warnings.some((warning) => warning.includes('does not connect') && warning.includes('/health')))

  const goConfigPath = join(root, 'BE-02.json')
  const goPlan = invoke(['plan', '--config', goConfigPath, '--json'])
  assert.equal(goPlan.status, 0, goPlan.stdout)
  const goPlanData = JSON.parse(goPlan.stdout).data
  assert.equal(goPlanData.recipeId, 'BE-02')
  assert.equal(goPlanData.executionAvailable, false)
  assert.deepEqual(goPlanData.networkAccess, [])
  assert.ok(goPlanData.expectedWrites.includes('go.mod'))
  assert.ok(!goPlanData.expectedWrites.includes('go.sum'))

  const doctorResult = invoke(['doctor', '--config', configPaths[0], '--json'])
  assert.equal(doctorResult.status, 0, doctorResult.stdout)
  assert.equal(JSON.parse(doctorResult.stdout).data.ready, true)

  const help = invoke(['--help'])
  assert.equal(help.status, 0, help.stderr)
  assert.equal(help.stdout.includes('--development-allow-planned'), false, 'release help must not advertise internal override')

  const firstConfig = configPaths[0]
  const forced = invoke(['generate', '--config', firstConfig, '--jsonl', '--development-allow-planned'])
  assert.equal(forced.status, 3, forced.stderr)
  assert.ok(events(forced.stdout).some((event) => event.code === 'GEN_RECIPE_UNTESTED'), forced.stdout)
  await assert.rejects(access(join(root, 'planned-fe-01')))
  await cleanJobLog(forced.stderr)

  for (const [index, [id]] of configs.entries()) {
    const result = invoke(['generate', '--config', configPaths[index], '--jsonl'])
    assert.equal(result.status, 3, `${id}: ${result.stderr}\n${result.stdout}`)
    const output = events(result.stdout)
    assert.ok(output.some((event) => event.code === 'GEN_RECIPE_UNTESTED'), `${id}: ${result.stdout}`)
    assert.equal(output.some((event) => event.type === 'stage-started' && ['staging', 'scaffolding', 'installing'].includes(event.stageId)), false, `${id} entered execution stage`)
    await assert.rejects(access(join(root, `planned-${id.toLowerCase()}`)))
    if (id.startsWith('FE-') || id === 'BE-02' || id === 'BE-07' || id === 'BE-08') {
      const override = invoke(['generate', '--config', configPaths[index], '--jsonl', '--development-allow-planned'])
      assert.equal(override.status, 3, `${id} release override: ${override.stderr}\n${override.stdout}`)
      assert.ok(events(override.stdout).some((event) => event.code === 'GEN_RECIPE_UNTESTED'), `${id} release override was not blocked: ${override.stdout}`)
      assert.equal(events(override.stdout).some((event) => event.type === 'stage-started' && ['staging', 'scaffolding', 'installing'].includes(event.stageId)), false, `${id} override entered execution stage`)
      await assert.rejects(access(join(root, `planned-${id.toLowerCase()}`)))
      await cleanJobLog(override.stderr)
    }
    await cleanJobLog(result.stderr)
  }

  for (const args of [[], ['--development-allow-planned']]) {
    const blocked = invoke(['generate', '--config', backendConfigPath, '--jsonl', ...args])
    assert.equal(blocked.status, 3, `BE-01 release block: ${blocked.stderr}\n${blocked.stdout}`)
    assert.ok(events(blocked.stdout).some((event) => event.code === 'GEN_RECIPE_UNTESTED'), blocked.stdout)
    assert.equal(events(blocked.stdout).some((event) => event.type === 'stage-started' && ['staging', 'scaffolding', 'installing'].includes(event.stageId)), false)
    await assert.rejects(access(join(root, 'planned-be-01')))
    await cleanJobLog(blocked.stderr)
  }

  const coreUrl = pathToFileURL(core).href
  const directCore = spawnSync(runtime, ['--input-type=module', '-e', `
    import { dirname } from 'node:path'
    import { rm } from 'node:fs/promises'
    const core = await import(${JSON.stringify(coreUrl)})
    const selection = core.parseSelection(${JSON.stringify(selection('CORE', 'frontend.react-vite', 'styling.css'))})
    const result = await core.generateProject(selection, { allowPlanned: true })
    if (result.logFile) await rm(dirname(result.logFile), { recursive: true, force: true })
    process.stdout.write(JSON.stringify({ profile: core.BUILD_PROFILE, allowed: core.ALLOW_PLANNED_RECIPE_GENERATION, error: result.error }))
  `], { cwd: root, encoding: 'utf8', windowsHide: true, env: untrustedEnvironment })
  assert.equal(directCore.status, 0, directCore.stderr)
  const directResult = JSON.parse(directCore.stdout)
  assert.equal(directResult.profile, 'release')
  assert.equal(directResult.allowed, false)
  assert.equal(directResult.error?.code, 'GEN_RECIPE_UNTESTED')

  assert.deepEqual((await readdir(root)).sort(), configPaths.map((path) => path.split(/[\\/]/).at(-1)).sort())
  console.log(`Packaged ${mode} CLI policy smoke passed: catalog/plan/doctor read-only; release override rejected; FE-01–FE-15, BE-01/BE-02/BE-07/BE-08, and FM-01/FM-02 blocked before staging.`)
} finally {
  await rm(root, { recursive: true, force: true })
}
