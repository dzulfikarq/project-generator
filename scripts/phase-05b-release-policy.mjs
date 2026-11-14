import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, win32 } from 'node:path'

if (process.platform !== 'win32') throw new Error('Phase 05B release-policy check requires Windows.')
const root = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
const parent = await mkdtemp(join(root, 'phase-05b-release-policy-'))
const config = join(parent, 'go.json')
const selection = {
  schemaVersion: 1,
  project: { name: 'planned-go-api', parentDirectory: parent, type: 'backend' },
  backend: { adapterId: 'backend.go-net-http', manager: 'go-modules', modulePath: 'example.com/planned-go-api' },
  documentation: 'minimal',
  git: { initialize: false, initialCommit: false },
}
let jobLog

try {
  await writeFile(config, JSON.stringify(selection, null, 2))
  const cli = join(import.meta.dirname, '..', 'packages', 'cli', 'dist', 'src', 'index.js')
  const result = spawnSync(process.execPath, [cli, 'generate', '--config', config, '--jsonl', '--development-allow-planned'], {
    cwd: join(import.meta.dirname, '..'),
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, NODE_ENV: 'development', PG_BUILD_PROFILE: 'development', PG_ALLOW_PLANNED_RECIPE_GENERATION: 'true' },
  })
  assert.ifError(result.error)
  jobLog = result.stderr?.match(/^Redacted job log: (.+)$/m)?.[1]?.trim()
  assert.equal(result.status, 3, `${result.stderr}\n${result.stdout}`)
  const events = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  assert.ok(events.some((event) => event.code === 'GEN_RECIPE_UNTESTED'), result.stdout)
  assert.equal(events.some((event) => event.stageId === 'staging'), false, result.stdout)
  assert.deepEqual(await readdir(parent), ['go.json'])
  console.log('BE-02 release CLI policy passed: environment override and development-only flag blocked before staging.')
} finally {
  if (jobLog) await rm(dirname(jobLog), { recursive: true, force: true })
  await rm(parent, { recursive: true, force: true })
}
