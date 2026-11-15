import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'

if (process.platform !== 'win32') throw new Error('Phase 05D.1 CLI acceptance requires Windows.')
const root = resolve(import.meta.dirname, '..')
const cli = resolve(root, 'packages', 'cli', 'dist', 'src', 'index.js')
const npmCli = resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
await Promise.all([access(cli), access(npmCli)])
const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
await access(tempBase)
assert.ok((await stat(tempBase)).isDirectory())
const parent = await mkdtemp(join(tempBase, 'phase-05d1-nest-cli-20261116 spaces-雪-'))
const environment = { ...process.env }
let jobLogs = []
let server
let complete = false

function selection(name, extra = {}) {
  return {
    schemaVersion: 1,
    project: { name, parentDirectory: parent, type: 'backend' },
    backend: { adapterId: 'backend.nestjs', manager: 'npm' },
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
    maxBuffer: 32 * 1024 * 1024,
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
  const child = spawn(process.execPath, [cli, 'generate', '--config', configPath, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts', '--desktop-control'], {
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
        }, 300)
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
  assert.equal(cancelSent, true, `cancellation reached project npm installation; exited ${JSON.stringify(exit)}\n${stderr}\n${stdout}`)
  assert.equal(exit.exitCode, 5, `unexpected cancelled CLI exit ${JSON.stringify(exit)}: ${stderr}\n${stdout}`)
  assert.ok(events(stdout).some((event) => event.type === 'job-finished' && event.status === 'cancelled'), stdout)
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])
  await assert.rejects(access(join(parent, 'cancel-nest')))
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

async function validateHttp(projectPath) {
  const port = await allocatePort()
  const child = spawn(process.execPath, ['dist/main.js'], {
    cwd: projectPath,
    env: { ...environment, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'acceptance' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  server = child
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  try {
    let ready = false
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (child.exitCode !== null) break
      try {
        const health = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) })
        const info = await fetch(`http://127.0.0.1:${port}/api/info`, { signal: AbortSignal.timeout(500) })
        assert.deepEqual(await health.json(), { status: 'ok' })
        assert.deepEqual(await info.json(), { name: 'BE-03 NestJS API', version: '0.1.0', environment: 'acceptance' })
        ready = health.status === 200 && info.status === 200
        if (ready) break
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 250))
      }
    }
    assert.equal(ready, true, `generated Nest server failed to serve HTTP: ${stderr}`)
    const missing = await fetch(`http://127.0.0.1:${port}/missing`)
    assert.equal(missing.status, 404)
    assert.deepEqual(await missing.json(), { error: { code: 'NOT_FOUND', message: 'Route not found.' }, path: '/missing' })
  } finally {
    child.kill()
    await new Promise((resolveExit) => child.once('close', resolveExit))
    if (server === child) server = undefined
  }
}

try {
  const configPath = join(parent, 'BE-03.json')
  await writeFile(configPath, JSON.stringify(selection('nest-api'), null, 2))
  const cancelPath = join(parent, 'cancel.json')
  await writeFile(cancelPath, JSON.stringify(selection('cancel-nest'), null, 2))
  const badManagerPath = join(parent, 'invalid-manager.json')
  await writeFile(badManagerPath, JSON.stringify(selection('invalid-nest', { backend: { adapterId: 'backend.nestjs', manager: 'yarn' } }), null, 2))

  const catalogResult = invoke(['catalog', '--json'])
  assert.equal(catalogResult.status, 0, catalogResult.stderr)
  const catalog = JSON.parse(catalogResult.stdout).data
  const recipe = catalog.recipes.find(({ id }) => id === 'BE-03')
  assert.equal(recipe?.status, 'planned')
  assert.equal(recipe.scaffold.packageName, '@nestjs/cli')
  assert.equal(recipe.scaffold.version, '11.0.24')
  assert.equal(recipe.dependencies.length, 21)
  assert.ok(recipe.dependencies.every(({ integrity }) => integrity.startsWith('sha512-')))

  const planResult = invoke(['plan', '--config', configPath, '--json'])
  assert.equal(planResult.status, 0, planResult.stdout)
  const plan = JSON.parse(planResult.stdout).data
  assert.equal(plan.recipeId, 'BE-03')
  assert.equal(plan.executionAvailable, false)
  assert.equal(plan.requiresDependencyConsent, true)
  assert.ok(plan.expectedWrites.includes('test/jest-e2e.json'))
  assert.ok(plan.expectedWrites.includes('src/api-exception.filter.ts'))
  assert.ok(plan.networkAccess.includes('https://registry.npmjs.org/'))

  const invalid = invoke(['plan', '--config', badManagerPath, '--json'])
  assert.equal(invalid.status, 3)
  assert.equal(JSON.parse(invalid.stdout).error.code, 'GEN_INCOMPATIBLE')
  const noConsent = invoke(['generate', '--config', configPath, '--jsonl', '--development-allow-planned'])
  keepJobLog(noConsent.stderr)
  assert.equal(noConsent.status, 3)
  assert.ok(events(noConsent.stdout).some((event) => event.code === 'GEN_DEPENDENCY_CONSENT_REQUIRED'))
  await assert.rejects(access(join(parent, 'nest-api')))

  await runCancelled(cancelPath)
  await cleanJobLogs()

  const generated = invoke(['generate', '--config', configPath, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts'], { timeout: 45 * 60 * 1000 })
  keepJobLog(generated.stderr)
  assert.equal(generated.status, 0, `${generated.stderr}\n${generated.stdout}`)
  assert.ok(events(generated.stdout).some((event) => event.type === 'job-finished' && event.status === 'completed'))

  const projectPath = join(parent, 'nest-api')
  const manifest = JSON.parse(await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8'))
  assert.equal(manifest.recipeId, 'BE-03')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.projectType, 'backend')
  assert.equal(manifest.packageManager, 'npm')
  for (const check of ['dependency-install', 'dependency-integrity', 'lockfile-integrity', 'typecheck', 'lint', 'unit-tests', 'e2e-tests', 'graceful-shutdown', 'build', 'http-smoke']) {
    assert.equal(manifest.validation.find((item) => item.id === check)?.status, 'pass', check)
  }
  const packageJson = JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf8'))
  assert.equal(packageJson.engines.node, '>=22.13.0')
  assert.equal(packageJson.dependencies['@nestjs/core'], '11.2.10')
  assert.equal(packageJson.devDependencies.jest, '30.0.0')
  assert.equal(packageJson.devDependencies['ts-jest'], '29.4.15')
  assert.deepEqual(Object.keys(packageJson.scripts).sort(), ['build', 'format', 'lint', 'start', 'start:dev', 'start:prod', 'test', 'test:e2e', 'typecheck'])
  const lockBytes = await readFile(join(projectPath, 'package-lock.json'))
  const lockHash = createHash('sha256').update(lockBytes).digest('hex')
  const lock = JSON.parse(lockBytes.toString('utf8'))
  assert.equal(manifest.lockfiles[0].sha256, lockHash)
  for (const pin of recipe.dependencies) {
    const entry = lock.packages[`node_modules/${pin.packageName}`]
    assert.equal(entry.version, pin.version, pin.packageName)
    assert.equal(entry.integrity, pin.integrity, pin.packageName)
    assert.equal(packageJson[pin.scope === 'devDependencies' ? 'devDependencies' : 'dependencies'][pin.packageName], pin.version)
  }
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (path && !entry.link && entry.resolved) assert.ok(entry.version && entry.integrity, `${path} lacks npm integrity`)
  }
  assert.equal((await readFile(join(projectPath, 'tsconfig.json'), 'utf8')).toLowerCase().includes('"module": "nodenext"'), true)
  assert.equal((await readFile(join(projectPath, '.env.example'), 'utf8')), 'HOST=127.0.0.1\nPORT=3000\nNODE_ENV=development\n')
  assert.match(await readFile(join(projectPath, 'README.md'), 'utf8'), /NestJS REST API/)
  assert.match(await readFile(join(projectPath, 'docs/TESTING.md'), 'utf8'), /Jest 30/)
  await assert.rejects(access(join(projectPath, '.env')))

  for (const script of ['typecheck', 'lint', 'test', 'test:e2e', 'build']) {
    const result = spawnSync(process.execPath, [npmCli, 'run', script], { cwd: projectPath, env: environment, encoding: 'utf8', windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 32 * 1024 * 1024 })
    if (result.error) throw result.error
    assert.equal(result.status, 0, `npm run ${script}:\n${result.stdout}\n${result.stderr}`)
  }
  await validateHttp(projectPath)

  const collisionPath = join(parent, 'collision-nest')
  await mkdir(collisionPath)
  const sentinelPath = join(collisionPath, 'keep.txt')
  await writeFile(sentinelPath, 'do not overwrite\n')
  const collisionConfig = join(parent, 'collision.json')
  await writeFile(collisionConfig, JSON.stringify(selection('collision-nest'), null, 2))
  const collision = invoke(['generate', '--config', collisionConfig, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts'])
  keepJobLog(collision.stderr)
  assert.equal(collision.status, 6, `${collision.stderr}\n${collision.stdout}`)
  assert.ok(events(collision.stdout).some((event) => event.code === 'GEN_PATH_EXISTS'))
  assert.equal(await readFile(sentinelPath, 'utf8'), 'do not overwrite\n')
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])

  complete = true
  console.log(JSON.stringify({
    phase: '05D.1',
    flow: 'Windows CLI',
    host: `${process.platform}-${process.arch}`,
    node: process.version,
    recipe: manifest.recipeId,
    recipeStatus: manifest.recipeStatusAtCreation,
    lockSha256: lockHash,
    dependencies: recipe.dependencies.map(({ packageName, version }) => `${packageName}@${version}`),
    validations: manifest.validation,
    lifecycleConsentRequired: true,
    cancellation: 'cancelled during npm install; owned staging cleaned',
    collision: 'existing sentinel preserved; no staging left',
    releaseApproved: false,
  }, null, 2))
} finally {
  if (server && server.exitCode === null) server.kill()
  if (complete) {
    await cleanJobLogs()
    await rm(parent, { recursive: true, force: true })
  }
  else console.error(`Incomplete CLI BE-03 E2E artifacts retained for diagnosis: ${parent}`)
}
