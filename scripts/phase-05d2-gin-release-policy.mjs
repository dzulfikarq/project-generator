import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, win32 } from 'node:path'

if (process.platform !== 'win32') throw new Error('Phase 05D.2 release-policy check requires Windows.')
const root = join(import.meta.dirname, '..')
const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
const parent = await mkdtemp(join(tempBase, 'phase-05d2-release-policy-'))
const cli = join(root, 'packages', 'cli', 'dist', 'src', 'index.js')
let jobLogs = []
const configs = []

try {
  for (const [recipeId, adapterId, manager] of [
    ['BE-02', 'backend.go-net-http', 'go-modules'],
    ['BE-04', 'backend.go-gin', 'go-modules'],
  ]) {
    const name = recipeId.toLowerCase().replace('-', '')
    const config = join(parent, `${recipeId}.json`)
    const selection = {
      schemaVersion: 1,
      project: { name, parentDirectory: parent, type: 'backend' },
      backend: { adapterId, manager, modulePath: `example.com/${name}` },
      documentation: 'minimal',
      git: { initialize: false, initialCommit: false },
    }
    configs.push(`${recipeId}.json`)
    await writeFile(config, JSON.stringify(selection, null, 2))
    const result = spawnSync(process.execPath, [cli, 'generate', '--config', config, '--jsonl', '--development-allow-planned', ...(recipeId === 'BE-04' ? ['--allow-module-downloads'] : [])], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      env: { ...process.env, NODE_ENV: 'development', PG_BUILD_PROFILE: 'development', PG_ALLOW_PLANNED_RECIPE_GENERATION: 'true' },
    })
    assert.ifError(result.error)
    const log = result.stderr?.match(/^Redacted job log: (.+)$/m)?.[1]?.trim()
    if (log) jobLogs.push(log)
    assert.equal(result.status, 3, `${recipeId} release override unexpectedly ran: ${result.stderr}\n${result.stdout}`)
    const events = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    assert.ok(events.some((event) => event.code === 'GEN_RECIPE_UNTESTED'), result.stdout)
    assert.equal(events.some((event) => event.stageId === 'staging'), false, result.stdout)
    assert.deepEqual((await readdir(parent)).sort(), [...configs].sort(), `${recipeId} created output before planned-recipe rejection`)
  }
  console.log('BE-02 and BE-04 release policy passed: environment overrides and development-only planned flags blocked before staging.')
} finally {
  for (const log of jobLogs) await rm(dirname(log), { recursive: true, force: true })
  await rm(parent, { recursive: true, force: true })
}
