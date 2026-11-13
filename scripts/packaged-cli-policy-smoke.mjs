import assert from 'node:assert/strict'
import { access, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'

const mode = process.argv[2]
if (mode !== 'system' && mode !== 'bundled') throw new Error('Pass runtime mode: system or bundled.')

const resourceRoot = resolve(import.meta.dirname, '..', 'packages', 'desktop', 'src-tauri', 'resources', 'pg-runtime')
const runtime = mode === 'bundled' ? join(resourceRoot, 'runtime', 'node.exe') : process.execPath
const cli = join(resourceRoot, 'cli', 'dist', 'src', 'index.js')
const core = join(resourceRoot, 'cli', 'node_modules', '@project-generator', 'core', 'dist', 'src', 'index.js')
await Promise.all([access(runtime), access(cli), access(core)])

const root = await mkdtemp(join(tmpdir(), 'pg-packaged-cli-policy-'))
const untrustedEnvironment = {
  ...process.env,
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
  ['FM-01', 'frontend.react-vite', undefined, 'focus-planner'],
  ['FM-02', 'frontend.nextjs-app', undefined, 'staywise-host-dashboard'],
]

function selection(id, frontend, styling, templateId) {
  const project = {
    schemaVersion: 1,
    project: { name: `planned-${id.toLowerCase()}`, parentDirectory: root, type: 'frontend' },
    frontend: { adapterId: frontend, language: 'ts', manager: 'npm' },
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
  for (const [id, frontend, styling, templateId] of configs) {
    const configPath = join(root, `${id}.json`)
    await writeFile(configPath, JSON.stringify(selection(id, frontend, styling, templateId)))
    configPaths.push(configPath)
  }

  const help = invoke(['--help'])
  assert.equal(help.status, 0, help.stderr)
  assert.equal(help.stdout.includes('--development-allow-planned'), false, 'release help must not advertise internal override')

  const firstConfig = configPaths[0]
  const forced = invoke(['generate', '--config', firstConfig, '--jsonl', '--development-allow-planned'])
  assert.equal(forced.status, 3, forced.stderr)
  assert.ok(events(forced.stdout).some((event) => event.code === 'GEN_RECIPE_UNTESTED'), forced.stdout)
  await assert.rejects(access(join(root, 'planned-fe-01')))

  for (const [index, [id]] of configs.entries()) {
    const result = invoke(['generate', '--config', configPaths[index], '--jsonl'])
    assert.equal(result.status, 3, `${id}: ${result.stderr}\n${result.stdout}`)
    const output = events(result.stdout)
    assert.ok(output.some((event) => event.code === 'GEN_RECIPE_UNTESTED'), `${id}: ${result.stdout}`)
    assert.equal(output.some((event) => event.type === 'stage-started' && ['staging', 'scaffolding', 'installing'].includes(event.stageId)), false, `${id} entered execution stage`)
    await assert.rejects(access(join(root, `planned-${id.toLowerCase()}`)))
    await cleanJobLog(result.stderr)
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
  console.log(`Packaged ${mode} CLI policy smoke passed: release override rejected; FE-01–FE-05 and FM-01/FM-02 blocked before staging.`)
} finally {
  await rm(root, { recursive: true, force: true })
}
