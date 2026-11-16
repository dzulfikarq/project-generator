import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, win32 } from 'node:path'

if (process.platform !== 'win32') throw new Error('Phase 06A release-policy check requires Windows.')
const root = join(import.meta.dirname, '..')
const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
const parent = await mkdtemp(join(tempBase, 'phase-06a-release-policy-'))
const cli = join(root, 'packages', 'cli', 'dist', 'src', 'index.js')
const cases = [
  ['BE-01', 'express-no-db.json', {
    schemaVersion: 1,
    project: { name: 'planned-express-api', parentDirectory: parent, type: 'backend' },
    backend: { adapterId: 'backend.express', manager: 'npm' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }],
  ['BE-07', 'express-sqlite-drizzle.json', {
    schemaVersion: 1,
    project: { name: 'planned-express-sqlite-api', parentDirectory: parent, type: 'backend' },
    backend: { adapterId: 'backend.express', manager: 'npm' },
    database: { adapterId: 'database.sqlite', accessAdapterId: 'data-access.drizzle-sqlite', mode: 'embedded' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }],
]
const logs = []

try {
  for (const [recipeId, configName, selection] of cases) {
    const config = join(parent, configName)
    await writeFile(config, JSON.stringify(selection, null, 2))
    const result = spawnSync(process.execPath, [cli, 'generate', '--config', config, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 60_000,
      env: { ...process.env, NODE_ENV: 'development', PG_BUILD_PROFILE: 'development', PG_ALLOW_PLANNED_RECIPE_GENERATION: 'true' },
      maxBuffer: 8 * 1024 * 1024,
    })
    assert.ifError(result.error)
    const jobLog = result.stderr?.match(/^Redacted job log: (.+)$/m)?.[1]?.trim()
    if (jobLog) logs.push(jobLog)
    assert.equal(result.status, 3, `${recipeId}: ${result.stderr}\n${result.stdout}`)
    const events = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    assert.ok(events.some((event) => event.code === 'GEN_RECIPE_UNTESTED'), `${recipeId}: ${result.stdout}`)
    assert.equal(events.some((event) => event.stageId === 'staging'), false, `${recipeId}: ${result.stdout}`)
  }
  assert.deepEqual((await readdir(parent)).sort(), cases.map(([, configName]) => configName).sort())
  console.log('Release build blocked planned BE-01 and BE-07 before staging despite CLI flags and runtime environment overrides.')
} finally {
  for (const log of logs) await rm(dirname(log), { recursive: true, force: true })
  await rm(parent, { recursive: true, force: true })
}
