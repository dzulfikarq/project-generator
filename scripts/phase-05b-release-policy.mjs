import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, win32 } from 'node:path'

if (process.platform !== 'win32') throw new Error('Phase 05B release-policy check requires Windows.')
const root = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
const parent = await mkdtemp(join(root, 'phase-05b-release-policy-'))
const config = join(parent, 'go.json')
const temp = join(parent, 'temp')
const faultMarker = join(temp, 'phase-08a5-supervisor-fault-consumed')
const selection = {
  schemaVersion: 1,
  project: { name: 'planned-go-api', parentDirectory: parent, type: 'backend' },
  backend: { adapterId: 'backend.go-net-http', manager: 'go-modules', modulePath: 'example.com/planned-go-api' },
  documentation: 'minimal',
  git: { initialize: false, initialCommit: false },
}
let jobLog

try {
  await mkdir(temp)
  await writeFile(config, JSON.stringify(selection, null, 2))
  const cli = join(import.meta.dirname, '..', 'packages', 'cli', 'dist', 'src', 'index.js')
  const result = spawnSync(process.execPath, [cli, 'generate', '--config', config, '--jsonl', '--development-allow-planned'], {
    cwd: join(import.meta.dirname, '..'),
    encoding: 'utf8',
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PG_BUILD_PROFILE: 'development',
      PG_ALLOW_PLANNED_RECIPE_GENERATION: 'true',
      PG_SUPERVISOR_TEST_FAULT: 'start-failure-once',
      PG_SUPERVISOR_TEST_FAULT_MARKER: faultMarker,
      TEMP: temp,
      TMP: temp,
    },
  })
  assert.ifError(result.error)
  jobLog = result.stderr?.match(/^Redacted job log: (.+)$/m)?.[1]?.trim()
  if (jobLog) {
    const relativeLogDirectory = win32.relative(win32.resolve(temp), win32.resolve(dirname(jobLog)))
    assert.ok(relativeLogDirectory !== '..' && !relativeLogDirectory.startsWith(`..${win32.sep}`)
      && !win32.isAbsolute(relativeLogDirectory), 'Job log escaped isolated temporary directory.')
  }
  assert.equal(result.status, 3, `${result.stderr}\n${result.stdout}`)
  const events = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  assert.ok(events.some((event) => event.code === 'GEN_RECIPE_UNTESTED'), result.stdout)
  assert.equal(events.some((event) => event.stageId === 'staging'), false, result.stdout)
  assert.deepEqual((await readdir(parent)).sort(), ['go.json', 'temp'])
  await assert.rejects(access(faultMarker))
  console.log('BE-02 release CLI policy passed: planned-generation and test fault overrides blocked before staging.')
} finally {
  await rm(parent, { recursive: true, force: true })
}
