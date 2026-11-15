import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, win32 } from 'node:path'

if (process.platform !== 'win32') throw new Error('Phase 05C.1 release-policy check requires Windows.')
const root = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
const parent = await mkdtemp(join(root, 'phase-05c1-release-policy-'))
const cases = [
  ['BE-02', 'go.json', {
    schemaVersion: 1,
    project: { name: 'planned-go-api', parentDirectory: parent, type: 'backend' },
    backend: { adapterId: 'backend.go-net-http', manager: 'go-modules', modulePath: 'example.com/planned-go-api' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }],
  ['BE-06', 'fastapi.json', {
    schemaVersion: 1,
    project: { name: 'planned-fastapi-api', parentDirectory: parent, type: 'backend' },
    backend: { adapterId: 'backend.fastapi', manager: 'uv' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }],
]
let jobLogs = []

try {
  const cli = join(import.meta.dirname, '..', 'packages', 'cli', 'dist', 'src', 'index.js')
  for (const [recipeId, configName, selection] of cases) {
    const config = join(parent, configName)
    await writeFile(config, JSON.stringify(selection, null, 2))
    const result = spawnSync(process.execPath, [cli, 'generate', '--config', config, '--jsonl', '--development-allow-planned'], {
      cwd: join(import.meta.dirname, '..'),
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, NODE_ENV: 'development', PG_BUILD_PROFILE: 'development', PG_ALLOW_PLANNED_RECIPE_GENERATION: 'true' },
    })
    assert.ifError(result.error)
    const jobLog = result.stderr?.match(/^Redacted job log: (.+)$/m)?.[1]?.trim()
    if (jobLog) jobLogs.push(jobLog)
    assert.equal(result.status, 3, `${recipeId}: ${result.stderr}\n${result.stdout}`)
    const events = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    assert.ok(events.some((event) => event.code === 'GEN_RECIPE_UNTESTED'), `${recipeId}: ${result.stdout}`)
    assert.equal(events.some((event) => event.stageId === 'staging'), false, `${recipeId}: ${result.stdout}`)
  }
  assert.deepEqual((await readdir(parent)).sort(), cases.map(([, configName]) => configName).sort())
  console.log('Release policy blocked planned BE-02 and BE-06 before staging despite runtime override attempts.')
} finally {
  for (const jobLog of jobLogs) await rm(dirname(jobLog), { recursive: true, force: true })
  await rm(parent, { recursive: true, force: true })
}
