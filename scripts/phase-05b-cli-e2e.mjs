import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'
import { resolveGoTool, supportsGo } from '../packages/core/dist/src/index.js'

if (process.platform !== 'win32') throw new Error('Phase 05B CLI acceptance requires Windows.')
const root = resolve(import.meta.dirname, '..')
const cli = resolve(root, 'packages', 'cli', 'dist', 'src', 'index.js')
const go = await resolveGoTool()
if (!go) throw new Error('Go SDK not found on PATH or GOROOT.')
const goVersionResult = spawnSync(go.executablePath, ['version'], { encoding: 'utf8', windowsHide: true })
assert.equal(goVersionResult.status, 0, goVersionResult.stderr)
const goVersion = /^go version go(\d+\.\d+(?:\.\d+)?)/.exec(goVersionResult.stdout)?.[1]
assert.ok(goVersion && supportsGo(goVersion), `unsupported Go toolchain: ${goVersionResult.stdout}`)

const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
await access(tempBase)
assert.ok((await stat(tempBase)).isDirectory())
const parent = await mkdtemp(join(tempBase, 'phase-05b-cli-e2e-20261115 spaces-雪-'))
const cache = join(parent, 'go-cache')
const moduleCache = join(parent, 'go-mod-cache')
const temp = join(parent, 'go-tmp')
await Promise.all([mkdir(cache), mkdir(moduleCache), mkdir(temp)])
const baseEnvironment = { ...process.env }
const goEnvironment = {
  ...baseEnvironment,
  GOTOOLCHAIN: 'local',
  GOPROXY: 'off',
  GOSUMDB: 'off',
  GOCACHE: cache,
  GOMODCACHE: moduleCache,
  GOTMPDIR: temp,
}
const goEnvBefore = spawnSync(go.executablePath, ['env', 'GOROOT', 'GOTOOLCHAIN', 'GOPROXY'], { env: baseEnvironment, encoding: 'utf8', windowsHide: true })
let jobLogs = []
let server

function selection(name, modulePath = `example.com/${name}`) {
  return {
    schemaVersion: 1,
    project: { name, parentDirectory: parent, type: 'backend' },
    backend: { adapterId: 'backend.go-net-http', manager: 'go-modules', modulePath },
    documentation: 'standard',
    git: { initialize: false, initialCommit: false },
  }
}

function invoke(args, env = baseEnvironment, timeout = 20 * 60 * 1000) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout,
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
    env: goEnvironment,
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
      if (event.type === 'stage-started' && event.stageId === 'validating' && !cancelSent) {
        cancelSent = true
        cancelTimer = setTimeout(() => {
          if (child.exitCode === null) child.stdin.end('{"schemaVersion":1,"kind":"cancel"}\n')
        }, 200)
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
  assert.equal(cancelSent, true, `cancel run never reached validation: ${stderr}\n${stdout}`)
  assert.equal(exit.exitCode, 5, `unexpected cancelled CLI exit ${JSON.stringify(exit)}: ${stderr}\n${stdout}`)
  assert.ok(events(stdout).some((event) => event.type === 'job-finished' && event.status === 'cancelled'), stdout)
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])
  await assert.rejects(access(join(parent, 'cancel-go-api')))
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
  const binary = join(parent, 'go-api-smoke.exe')
  const build = spawnSync(go.executablePath, ['build', '-o', binary, './cmd/server'], { cwd: projectPath, env: goEnvironment, encoding: 'utf8', windowsHide: true, timeout: 5 * 60 * 1000 })
  if (build.error) throw build.error
  assert.equal(build.status, 0, `go build server: ${build.stdout}\n${build.stderr}`)
  const child = spawn(binary, [], {
    cwd: projectPath,
    env: { ...goEnvironment, HOST: '127.0.0.1', PORT: String(port) },
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
        assert.deepEqual(await info.json(), { name: 'go-api API', version: '0.1.0' })
        ready = health.status === 200 && info.status === 200
        if (ready) break
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 250))
      }
    }
    assert.equal(ready, true, `generated Go server failed HTTP smoke: ${stderr}`)
  } finally {
    if (child.exitCode === null) child.kill()
    await new Promise((resolveClose) => child.once('close', resolveClose))
    if (server === child) server = undefined
  }
}

try {
  await access(cli)
  const configPath = join(parent, 'BE-02.json')
  await writeFile(configPath, JSON.stringify(selection('go-api'), null, 2))
  const invalidModulePaths = [
    'github.com/con/api',
    'github.com/acme/pkg~1',
    'github.com/acme/pkg/v02',
    'github.com/acme/pkg/v2.1',
    'github.com/COM1/api',
  ]
  const invalidConfigs = await Promise.all(invalidModulePaths.map(async (modulePath, index) => {
    const name = `invalid-go-api-${index}`
    const configPath = join(parent, `invalid-module-${index}.json`)
    await writeFile(configPath, JSON.stringify(selection(name, modulePath), null, 2))
    return { configPath, name }
  }))
  const cancelPath = join(parent, 'cancel.json')
  await writeFile(cancelPath, JSON.stringify(selection('cancel-go-api'), null, 2))

  const catalogResult = invoke(['catalog', '--json'])
  assert.equal(catalogResult.status, 0, catalogResult.stderr)
  const catalog = JSON.parse(catalogResult.stdout).data
  const recipe = catalog.recipes.find(({ id }) => id === 'BE-02')
  assert.equal(recipe?.status, 'planned')
  assert.equal(recipe?.backend, 'backend.go-net-http')
  assert.equal(recipe?.manager, 'go-modules')
  assert.deepEqual(recipe?.dependencies, undefined)

  const plan = invoke(['plan', '--config', configPath, '--json'])
  assert.equal(plan.status, 0, plan.stdout)
  const planData = JSON.parse(plan.stdout).data
  assert.equal(planData.executionAvailable, false)
  assert.deepEqual(planData.networkAccess, [])
  assert.equal(planData.executesDependencyLifecycleScripts, false)
  assert.ok(planData.expectedWrites.includes('go.mod'))
  assert.ok(!planData.expectedWrites.includes('go.sum'))

  const doctor = invoke(['doctor', '--config', configPath, '--json'])
  assert.equal(doctor.status, 0, doctor.stdout)
  const doctorData = JSON.parse(doctor.stdout).data
  assert.ok(doctorData.tools.some((tool) => tool.id === 'go' && tool.available && tool.version === goVersion))
  assert.ok(!doctorData.tools.some((tool) => tool.id === 'npm' || tool.id === 'node'))

  for (const { configPath, name } of invalidConfigs) {
    const invalidPlan = invoke(['plan', '--config', configPath, '--json'])
    assert.equal(invalidPlan.status, 2, invalidPlan.stdout)
    assert.equal(JSON.parse(invalidPlan.stdout).error.code, 'GEN_CONFIG_INVALID')
    const invalidGenerate = invoke(['generate', '--config', configPath, '--jsonl', '--development-allow-planned'])
    assert.equal(invalidGenerate.status, 3, `${invalidGenerate.stderr}\n${invalidGenerate.stdout}`)
    assert.ok(events(invalidGenerate.stdout).some((event) => event.code === 'GEN_CONFIG_INVALID'), `${invalidGenerate.stderr}\n${invalidGenerate.stdout}`)
    await assert.rejects(access(join(parent, name)))
  }
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])

  const missingGoEnvironment = { ...baseEnvironment, PATH: `${dirname(process.execPath)};${win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32')}` }
  delete missingGoEnvironment.GOROOT
  const missingDoctor = invoke(['doctor', '--config', configPath, '--json'], missingGoEnvironment)
  assert.equal(missingDoctor.status, 3)
  assert.ok(JSON.parse(missingDoctor.stdout).data.tools.some((tool) => tool.id === 'go' && !tool.available && /Install Go 1\.22/.test(tool.message)))
  const missingGenerate = invoke(['generate', '--config', configPath, '--jsonl', '--development-allow-planned'], missingGoEnvironment)
  assert.equal(missingGenerate.status, 3)
  assert.ok(events(missingGenerate.stdout).some((event) => event.code === 'GEN_TOOL_MISSING'))
  await assert.rejects(access(join(parent, 'go-api')))

  await runCancelled(cancelPath)
  await cleanJobLogs()

  const generated = invoke(['generate', '--config', configPath, '--jsonl', '--development-allow-planned'], goEnvironment)
  keepJobLog(generated.stderr)
  assert.equal(generated.status, 0, `${generated.stderr}\n${generated.stdout}`)
  const generatedEvents = events(generated.stdout)
  assert.ok(generatedEvents.some((event) => event.type === 'job-finished' && event.status === 'completed'))
  const projectPath = join(parent, 'go-api')
  const manifest = JSON.parse(await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8'))
  assert.equal(manifest.recipeId, 'BE-02')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.packageManager, 'go-modules')
  assert.equal(manifest.modulePath, 'example.com/go-api')
  assert.deepEqual(manifest.dependencyFiles, ['go.mod'])
  assert.equal(manifest.lockfiles, undefined)
  for (const check of ['go-module', 'go-fmt', 'go-vet', 'go-test', 'go-build', 'http-smoke']) {
    assert.equal(manifest.validation.find((item) => item.id === check)?.status, 'pass', check)
  }
  await assert.rejects(access(join(projectPath, 'go.sum')))
  for (const file of ['cmd/server/main.go', 'internal/handlers/health.go', 'internal/handlers/info.go', 'internal/server/server.go', 'internal/server/server_test.go', 'go.mod', '.env.example', 'README.md']) {
    await access(join(projectPath, file))
  }
  const module = await readFile(join(projectPath, 'go.mod'), 'utf8')
  assert.equal(module, 'module example.com/go-api\n\ngo 1.22.0\n')

  for (const args of [['fmt', './...'], ['vet', './...'], ['test', './...'], ['build', './...']]) {
    const result = spawnSync(go.executablePath, args, { cwd: projectPath, env: goEnvironment, encoding: 'utf8', windowsHide: true, timeout: 5 * 60 * 1000, maxBuffer: 10 * 1024 * 1024 })
    if (result.error) throw result.error
    assert.equal(result.status, 0, `go ${args.join(' ')}:\n${result.stdout}\n${result.stderr}`)
  }
  await validateHttp(projectPath)

  const collisionPath = join(parent, 'collision-go-api')
  await mkdir(collisionPath)
  const sentinelPath = join(collisionPath, 'keep.txt')
  await writeFile(sentinelPath, 'do not overwrite\n')
  const collisionConfig = join(parent, 'collision.json')
  await writeFile(collisionConfig, JSON.stringify(selection('collision-go-api'), null, 2))
  const collision = invoke(['generate', '--config', collisionConfig, '--jsonl', '--development-allow-planned'])
  keepJobLog(collision.stderr)
  assert.equal(collision.status, 6, `${collision.stderr}\n${collision.stdout}`)
  assert.ok(events(collision.stdout).some((event) => event.code === 'GEN_PATH_EXISTS'))
  assert.equal(await readFile(sentinelPath, 'utf8'), 'do not overwrite\n')
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])

  const goEnvAfter = spawnSync(go.executablePath, ['env', 'GOROOT', 'GOTOOLCHAIN', 'GOPROXY'], { env: baseEnvironment, encoding: 'utf8', windowsHide: true })
  assert.equal(goEnvAfter.status, 0)
  assert.equal(goEnvAfter.stdout, goEnvBefore.stdout, 'generation must not change global Go environment/configuration')

  console.log(JSON.stringify({
    phase: '05B',
    flow: 'Windows CLI',
    host: `${process.platform}-${process.arch}`,
    go: goVersion,
    recipe: 'BE-02',
    recipeStatus: manifest.recipeStatusAtCreation,
    modulePath: manifest.modulePath,
    validations: manifest.validation,
    missingGo: 'Doctor and generation blocked before staging',
    cancellation: 'cancelled during validation; stage cleaned; target absent',
    collision: 'sentinel preserved; no stage left',
    http: 'GET /health and GET /api/info returned expected JSON',
    goEnvironmentUnchanged: true,
  }, null, 2))
} finally {
  if (server && server.exitCode === null) server.kill()
  await cleanJobLogs()
  await rm(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}
