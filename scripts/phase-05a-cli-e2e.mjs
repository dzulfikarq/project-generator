import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'

if (process.platform !== 'win32') throw new Error('Phase 05A CLI acceptance requires Windows.')
const root = resolve(import.meta.dirname, '..')
const cli = resolve(root, 'packages', 'cli', 'dist', 'src', 'index.js')
const nodeRoot = dirname(process.execPath)
const npmCli = resolve(nodeRoot, 'node_modules', 'npm', 'bin', 'npm-cli.js')
await Promise.all([access(cli), access(npmCli)])
const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
await access(tempBase)
assert.ok((await stat(tempBase)).isDirectory())
const parent = await mkdtemp(join(tempBase, 'phase-05a-cli-e2e-20261114 spaces-雪-'))
const environment = { ...process.env }
let jobLogs = []
let server

function selection(name, extra = {}) {
  return {
    schemaVersion: 1,
    project: { name, parentDirectory: parent, type: 'backend' },
    backend: { adapterId: 'backend.express', manager: 'npm' },
    documentation: 'standard',
    git: { initialize: false, initialCommit: false },
    ...extra,
  }
}

function invoke(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout ?? 20 * 60 * 1000,
    maxBuffer: 20 * 1024 * 1024,
  })
  if (result.error) throw result.error
  return result
}

function events(stdout) {
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

function keepJobLog(stderr) {
  const match = stderr.match(/^Redacted job log: (.+)$/m)
  if (match) jobLogs.push(match[1].trim())
}

async function cleanJobLogs() {
  for (const log of jobLogs) await rm(dirname(log), { recursive: true, force: true })
  jobLogs = []
}

async function runCancelled(configPath) {
  const child = spawn(process.execPath, [cli, 'generate', '--config', configPath, '--jsonl', '--development-allow-planned', '--desktop-control'], {
    cwd: root,
    env: environment,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let pending = ''
  let cancelSent = false
  let cancelTimer
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    pending += chunk
    for (;;) {
      const newline = pending.indexOf('\n')
      if (newline < 0) break
      const line = pending.slice(0, newline).trim()
      pending = pending.slice(newline + 1)
      if (!line) continue
      const event = JSON.parse(line)
      if (event.type === 'stage-started' && event.stageId === 'installing' && !cancelSent) {
        cancelSent = true
        cancelTimer = setTimeout(() => {
          if (child.exitCode === null) child.stdin.end('{"schemaVersion":1,"kind":"cancel"}\n')
        }, 800)
      }
    }
  })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const timer = setTimeout(() => child.kill(), 20 * 60 * 1000)
  const exit = await new Promise((resolveExit, reject) => {
    child.once('error', reject)
    child.once('close', (exitCode, signal) => resolveExit({ exitCode, signal }))
  }).finally(() => { clearTimeout(timer); if (cancelTimer) clearTimeout(cancelTimer) })
  keepJobLog(stderr)
  assert.equal(cancelSent, true, 'cancellation run reached npm installation')
  assert.equal(exit.exitCode, 5, `unexpected cancelled CLI exit ${JSON.stringify(exit)}: ${stderr}\n${stdout}`)
  assert.ok(events(stdout).some((event) => event.type === 'job-finished' && event.status === 'cancelled'), stdout)
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])
  await assert.rejects(access(join(parent, 'cancel-api')))
}

async function allocatePort() {
  const listener = createServer()
  await new Promise((resolveListen, reject) => {
    listener.once('error', reject)
    listener.listen(0, '127.0.0.1', resolveListen)
  })
  const address = listener.address()
  assert.ok(address && typeof address === 'object')
  await new Promise((resolveClose, reject) => listener.close((error) => error ? reject(error) : resolveClose()))
  return address.port
}

async function validateHttpAndShutdown(projectPath) {
  const port = await allocatePort()
  const child = spawn(process.execPath, ['dist/server.js'], {
    cwd: projectPath,
    env: { ...environment, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'acceptance' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server = child
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk) => { stdout += chunk })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  try {
    let ready = false
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (child.exitCode !== null) break
      try {
        const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) })
        const info = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(500) })
        assert.deepEqual(await health.json(), { status: 'ok' })
        assert.deepEqual(await info.json(), { name: 'BE-01 Express API', version: '0.1.0', environment: 'acceptance' })
        ready = health.status === 200 && info.status === 200
        if (ready) break
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 250))
      }
    }
    assert.equal(ready, true, `generated server failed to serve HTTP: ${stderr}`)
    child.kill()
    await new Promise((resolveExit) => child.once('close', resolveExit))
  } finally {
    if (child.exitCode === null) child.kill()
    if (server === child) server = undefined
  }

}

try {
  const configPath = join(parent, 'BE-01.json')
  await writeFile(configPath, JSON.stringify(selection('be-api'), null, 2))
  const invalidPath = join(parent, 'invalid-backend.json')
  await writeFile(invalidPath, JSON.stringify(selection('invalid-backend', {
    frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'npm' },
  }), null, 2))
  const cancelPath = join(parent, 'cancel.json')
  await writeFile(cancelPath, JSON.stringify(selection('cancel-api'), null, 2))

  const catalogResult = invoke(['catalog', '--json'])
  assert.equal(catalogResult.status, 0, catalogResult.stderr)
  const catalog = JSON.parse(catalogResult.stdout).data
  const recipe = catalog.recipes.find(({ id }) => id === 'BE-01')
  assert.equal(recipe?.status, 'planned')
  assert.deepEqual(recipe.dependencies.map(({ packageName, version }) => [packageName, version]), [
    ['express', '5.1.0'], ['@types/express', '5.0.3'], ['@types/node', '22.20.5'], ['tsx', '4.20.5'], ['typescript', '5.9.3'],
  ])
  assert.ok(recipe.dependencies.every(({ integrity }) => integrity.startsWith('sha512-')))

  const plan = invoke(['plan', '--config', configPath, '--json'])
  assert.equal(plan.status, 0, plan.stdout)
  assert.equal(JSON.parse(plan.stdout).data.executionAvailable, false)
  assert.ok(JSON.parse(plan.stdout).data.expectedWrites.includes('src/server.ts'))

  const invalidPlan = invoke(['plan', '--config', invalidPath, '--json'])
  assert.equal(invalidPlan.status, 3)
  assert.equal(JSON.parse(invalidPlan.stdout).error.code, 'GEN_INCOMPATIBLE')
  const invalidGenerate = invoke(['generate', '--config', invalidPath, '--jsonl', '--development-allow-planned'])
  assert.equal(invalidGenerate.status, 3)
  assert.ok(events(invalidGenerate.stdout).some((event) => event.code === 'GEN_INCOMPATIBLE'))
  await assert.rejects(access(join(parent, 'invalid-backend')))

  await runCancelled(cancelPath)
  await cleanJobLogs()

  const generated = invoke(['generate', '--config', configPath, '--jsonl', '--development-allow-planned'])
  keepJobLog(generated.stderr)
  assert.equal(generated.status, 0, `${generated.stderr}\n${generated.stdout}`)
  const generatedEvents = events(generated.stdout)
  assert.ok(generatedEvents.some((event) => event.type === 'job-finished' && event.status === 'completed'))
  const projectPath = join(parent, 'be-api')
  const manifest = JSON.parse(await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8'))
  assert.equal(manifest.recipeId, 'BE-01')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.projectType, 'backend')
  assert.equal(manifest.packageManager, 'npm')
  for (const check of ['dependency-install', 'dependency-integrity', 'lockfile-integrity', 'typecheck', 'unit-tests', 'graceful-shutdown', 'build', 'http-smoke']) {
    assert.equal(manifest.validation.find((item) => item.id === check)?.status, 'pass', check)
  }
  const packageJson = JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf8'))
  assert.equal(packageJson.engines.node, '>=22.13.0')
  assert.deepEqual(Object.keys(packageJson.scripts).sort(), ['build', 'dev', 'start', 'test', 'typecheck'])
  assert.equal(packageJson.dependencies.express, '5.1.0')
  assert.equal(packageJson.devDependencies.typescript, '5.9.3')
  assert.equal(packageJson.devDependencies.tsx, '4.20.5')
  const lock = JSON.parse(await readFile(join(projectPath, 'package-lock.json'), 'utf8'))
  for (const dependency of recipe.dependencies) {
    const entry = lock.packages[`node_modules/${dependency.packageName}`]
    assert.equal(entry.version, dependency.version, dependency.packageName)
    assert.equal(entry.integrity, dependency.integrity, dependency.packageName)
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path && !entry.link && entry.resolved) {
      assert.ok(entry.version && entry.integrity, `${path} must have a pinned version and registry integrity`)
    }
  }
  for (const file of ['src/app.ts', 'src/config.ts', 'src/server.ts', 'test/backend.test.ts', 'test/shutdown.test.ts', '.env.example', 'README.md', 'docs/SETUP.md']) {
    await access(join(projectPath, file))
  }
  assert.equal(await readFile(join(projectPath, '.env.example'), 'utf8'), 'HOST=127.0.0.1\nPORT=3000\nNODE_ENV=development\n')
  assert.match(await readFile(join(projectPath, 'README.md'), 'utf8'), /GET \/health/)

  for (const script of ['typecheck', 'test', 'build']) {
    const result = spawnSync(process.execPath, [npmCli, 'run', script], { cwd: projectPath, env: environment, encoding: 'utf8', windowsHide: true, timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 })
    if (result.error) throw result.error
    assert.equal(result.status, 0, `npm run ${script}:\n${result.stdout}\n${result.stderr}`)
  }
  await validateHttpAndShutdown(projectPath)

  const collisionPath = join(parent, 'collision-api')
  await mkdir(collisionPath)
  const sentinelPath = join(collisionPath, 'keep.txt')
  await writeFile(sentinelPath, 'do not overwrite\n')
  const collisionConfig = join(parent, 'collision.json')
  await writeFile(collisionConfig, JSON.stringify(selection('collision-api'), null, 2))
  const collision = invoke(['generate', '--config', collisionConfig, '--jsonl', '--development-allow-planned'])
  keepJobLog(collision.stderr)
  assert.equal(collision.status, 6, `${collision.stderr}\n${collision.stdout}`)
  assert.ok(events(collision.stdout).some((event) => event.code === 'GEN_PATH_EXISTS'))
  assert.equal(await readFile(sentinelPath, 'utf8'), 'do not overwrite\n')
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])

  console.log(JSON.stringify({
    phase: '05A',
    flow: 'Windows CLI',
    host: `${process.platform}-${process.arch}`,
    node: process.version,
    recipe: 'BE-01',
    recipeStatus: manifest.recipeStatusAtCreation,
    dependencies: recipe.dependencies.map(({ packageName, version }) => `${packageName}@${version}`),
    validations: manifest.validation,
    cancellation: 'cancelled before commit; staging cleaned',
    collision: 'existing sentinel preserved; no staging left',
    gracefulShutdown: 'generated test emitted SIGTERM to registered handler; listener close verified',
    generatedProjectCleaned: true,
    releaseApproved: false,
  }, null, 2))
} finally {
  if (server && server.exitCode === null) server.kill()
  await cleanJobLogs()
  await rm(parent, { recursive: true, force: true })
}
