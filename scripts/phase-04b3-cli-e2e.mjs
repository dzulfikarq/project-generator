import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, win32 } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const cli = resolve(root, 'packages', 'cli', 'dist', 'src', 'index.js')
await access(cli)
const parent = await mkdtemp(win32.join(tmpdir(), 'pg-phase-04b3-cli-'))
const cases = [
  ['FE-12', 'react-yarn', 'frontend.react-vite', 'yarn', '4.18.1', 'yarn.lock'],
  ['FE-13', 'vue-yarn', 'frontend.vue-vite', 'yarn', '4.18.1', 'yarn.lock'],
  ['FE-14', 'react-pnpm', 'frontend.react-vite', 'pnpm', '11.28.11', 'pnpm-lock.yaml'],
  ['FE-15', 'vue-pnpm', 'frontend.vue-vite', 'pnpm', '11.28.11', 'pnpm-lock.yaml'],
]
const jobLogs = []
const results = []

try {
  for (const [recipeId, name, frontend, manager, managerVersion, lockfile] of cases) {
    const configPath = win32.join(parent, `${name}.json`)
    await writeFile(configPath, JSON.stringify({
      schemaVersion: 1,
      project: { name, parentDirectory: parent, type: 'frontend' },
      frontend: { adapterId: frontend, language: 'ts', manager },
      styling: { adapterId: 'styling.css' },
      documentation: 'standard',
      git: { initialize: false, initialCommit: false },
    }))
    const result = spawnSync(process.execPath, [cli, 'generate', '--config', configPath, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 20 * 60 * 1000,
    })
    if (result.error) throw result.error
    const events = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    const logPath = result.stderr.match(/^Redacted job log: (.+)$/m)?.[1]?.trim()
    if (logPath) jobLogs.push(dirname(logPath))
    if (result.status !== 0) {
      const diagnostics = logPath ? await readFile(logPath, 'utf8').catch(() => '') : ''
      throw new Error(`${recipeId}: ${events.find((event) => event.type === 'error')?.message ?? result.stderr}\n${diagnostics}`)
    }
    const finished = events.find((event) => event.type === 'job-finished')
    assert.equal(finished?.status, 'completed', `${recipeId}: ${finished?.message}`)

    const projectPath = win32.join(parent, name)
    const manifest = JSON.parse(await readFile(win32.join(projectPath, '.project-generator', 'manifest.json'), 'utf8'))
    assert.equal(manifest.recipeId, recipeId)
    assert.equal(manifest.recipeStatusAtCreation, 'planned')
    assert.equal(manifest.packageManager, manager)
    assert.equal(manifest.toolVersions[manager], managerVersion)
    assert.deepEqual(manifest.lockfiles.map(({ name: file }) => file), [lockfile])
    const nodeLinker = manager === 'yarn' ? 'node-modules' : 'hoisted'
    const configFile = manager === 'yarn' ? '.yarnrc.yml' : 'pnpm-workspace.yaml'
    assert.deepEqual(manifest.packageManagerConfig, { nodeLinker, file: configFile })
    assert.ok(manifest.generatedFiles.includes(configFile))
    assert.equal(await readFile(win32.join(projectPath, configFile), 'utf8'), `nodeLinker: ${nodeLinker}\n`)
    const lockBytes = await readFile(win32.join(projectPath, lockfile))
    assert.equal(manifest.lockfiles[0].sha256, createHash('sha256').update(lockBytes).digest('hex'))
    const locks = (await readdir(projectPath)).filter((file) => ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'].includes(file))
    assert.deepEqual(locks, [lockfile])
    for (const id of ['package-manager-integrity', 'dependency-install', 'lockfile-integrity', 'lint', 'typecheck', 'build', 'http-smoke']) {
      assert.equal(manifest.validation.find((item) => item.id === id)?.status, 'pass', `${recipeId}: ${id}`)
    }
    assert.match(await readFile(win32.join(projectPath, 'README.md'), 'utf8'), new RegExp(`${manager} install`))
    assert.match(await readFile(win32.join(projectPath, 'AGENTS.md'), 'utf8'), new RegExp(`${manager}.*${lockfile}`))
    results.push({ recipeId, manager, managerVersion, nodeLinker, configFile, lockfile, lockSha256: manifest.lockfiles[0].sha256, validations: manifest.validation.filter(({ status }) => status === 'pass').map(({ id }) => id) })
    console.log(`${recipeId} ${frontend} + Vite + Plain CSS + ${manager}@${managerVersion}: PASS (${lockfile}, checks, planned retained)`)
  }
  assert.deepEqual((await readdir(parent)).filter((name) => name.endsWith('.json')).sort(), cases.map(([, name]) => `${name}.json`).sort())
} finally {
  for (const path of jobLogs) await rm(path, { recursive: true, force: true })
  await rm(parent, { recursive: true, force: true })
}

console.log(JSON.stringify({
  phase: '04B.3',
  flow: 'CLI',
  host: `${process.platform}-${process.arch}`,
  node: process.version,
  runDirectory: parent.split(/[\\/]/).at(-1),
  generatedProjectsCleaned: true,
  recipes: results,
  releaseApproved: false,
  recipesRemainPlanned: true,
}, null, 2))
