import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'
import { resolveGoTool, supportsGoGin } from '../packages/core/dist/src/index.js'
import { createGinGoMod } from '../packages/core/dist/src/gin-module-graph.js'

if (process.platform !== 'win32') throw new Error('Phase 05D.2 CLI acceptance requires Windows.')
const root = resolve(import.meta.dirname, '..')
const cli = resolve(root, 'packages', 'cli', 'dist', 'src', 'index.js')
const hostEnvironment = { ...process.env }
const go = await resolveGoTool()
if (!go) throw new Error('Go SDK not found on PATH or GOROOT.')
const versionResult = spawnSync(go.executablePath, ['version'], {
  encoding: 'utf8',
  windowsHide: true,
  env: { ...hostEnvironment, GOTOOLCHAIN: 'local', GOENV: 'off' },
})
assert.equal(versionResult.status, 0, versionResult.stderr)
const goVersion = /^go version go(\d+\.\d+(?:\.\d+)?)/.exec(versionResult.stdout)?.[1]
assert.ok(goVersion && supportsGoGin(goVersion), `Go >=1.25.0 required: ${versionResult.stdout}`)

function globalGoSettings() {
  const result = spawnSync(go.executablePath, ['env', 'GOENV', 'GOPROXY', 'GOSUMDB', 'GOTOOLCHAIN'], {
    encoding: 'utf8',
    windowsHide: true,
    env: hostEnvironment,
  })
  assert.equal(result.status, 0, result.stderr)
  return result.stdout
}

const globalGoSettingsBefore = globalGoSettings()

const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
await access(cli)
await access(tempBase)
assert.ok((await stat(tempBase)).isDirectory())
const parent = await mkdtemp(join(tempBase, 'phase-05d2-gin-cli-20261116 spaces-雪-'))
const environment = { ...process.env, GOTOOLCHAIN: 'local', GOENV: 'off' }
let jobLogs = []
let complete = false

function selection(name, backend = { adapterId: 'backend.go-gin', manager: 'go-modules', modulePath: `example.com/${name}` }) {
  return {
    schemaVersion: 1,
    project: { name, parentDirectory: parent, type: 'backend' },
    backend,
    documentation: 'standard',
    git: { initialize: false, initialCommit: false },
  }
}

function invoke(args, timeout = 45 * 60 * 1000) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
    timeout,
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
  const child = spawn(process.execPath, [cli, 'generate', '--config', configPath, '--jsonl', '--development-allow-planned', '--allow-module-downloads', '--desktop-control'], {
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
        }, 150)
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
  assert.equal(cancelSent, true, `cancellation reached Go module download; exited ${JSON.stringify(exit)}\n${stderr}\n${stdout}`)
  assert.equal(exit.exitCode, 5, `unexpected cancellation exit ${JSON.stringify(exit)}: ${stderr}\n${stdout}`)
  assert.ok(events(stdout).some((event) => event.type === 'job-finished' && event.status === 'cancelled'), stdout)
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])
  await assert.rejects(access(join(parent, 'cancel-gin')))
}

try {
  const configPath = join(parent, 'BE-04.json')
  await writeFile(configPath, JSON.stringify(selection('gin-api'), null, 2))
  const cancelPath = join(parent, 'cancel.json')
  await writeFile(cancelPath, JSON.stringify(selection('cancel-gin'), null, 2))
  const badManagerPath = join(parent, 'invalid-manager.json')
  await writeFile(badManagerPath, JSON.stringify(selection('invalid-gin', { adapterId: 'backend.go-gin', manager: 'npm' }), null, 2))
  const goRegressionPath = join(parent, 'BE-02.json')
  await writeFile(goRegressionPath, JSON.stringify(selection('net-http-api', { adapterId: 'backend.go-net-http', manager: 'go-modules', modulePath: 'example.com/net-http-api' }), null, 2))

  const catalogResult = invoke(['catalog', '--json'], 30_000)
  assert.equal(catalogResult.status, 0, catalogResult.stderr)
  const catalog = JSON.parse(catalogResult.stdout).data
  const recipe = catalog.recipes.find(({ id }) => id === 'BE-04')
  assert.equal(recipe?.status, 'planned')
  assert.equal(recipe?.backend, 'backend.go-gin')
  assert.equal(recipe?.manager, 'go-modules')
  assert.ok(recipe?.limitations.some((limitation) => limitation.includes('Gin 1.12.0') && limitation.includes('no database')))

  const planResult = invoke(['plan', '--config', configPath, '--json'], 30_000)
  assert.equal(planResult.status, 0, planResult.stdout)
  const plan = JSON.parse(planResult.stdout).data
  assert.equal(plan.recipeId, 'BE-04')
  assert.equal(plan.executionAvailable, false)
  assert.equal(plan.requiresDependencyConsent, false)
  assert.equal(plan.requiresNetworkConsent, true)
  assert.equal(plan.executesDependencyLifecycleScripts, false)
  assert.ok(plan.expectedWrites.includes('go.mod'))
  assert.ok(plan.expectedWrites.includes('go.sum'))
  assert.ok(plan.networkAccess.includes('https://proxy.golang.org/'))
  assert.ok(plan.networkAccess.includes('https://sum.golang.org/ (Go checksum database)'))

  const invalid = invoke(['plan', '--config', badManagerPath, '--json'], 30_000)
  assert.equal(invalid.status, 3)
  assert.equal(JSON.parse(invalid.stdout).error.code, 'GEN_INCOMPATIBLE')

  const noConsent = invoke(['generate', '--config', configPath, '--jsonl', '--development-allow-planned'], 30_000)
  keepJobLog(noConsent.stderr)
  assert.equal(noConsent.status, 3, `${noConsent.stderr}\n${noConsent.stdout}`)
  assert.ok(events(noConsent.stdout).some((event) => event.code === 'GEN_MODULE_DOWNLOAD_CONSENT_REQUIRED'))
  assert.equal(events(noConsent.stdout).some((event) => event.stageId === 'staging'), false)
  await assert.rejects(access(join(parent, 'gin-api')))
  await cleanJobLogs()

  const invalidGo = invoke(['plan', '--config', goRegressionPath, '--json'], 30_000)
  assert.equal(invalidGo.status, 0, invalidGo.stdout)
  assert.equal(JSON.parse(invalidGo.stdout).data.recipeId, 'BE-02')
  assert.deepEqual(JSON.parse(invalidGo.stdout).data.networkAccess, [])
  assert.equal(JSON.parse(invalidGo.stdout).data.requiresNetworkConsent, false)

  await runCancelled(cancelPath)
  await cleanJobLogs()

  const generated = invoke(['generate', '--config', configPath, '--jsonl', '--development-allow-planned', '--allow-module-downloads'])
  keepJobLog(generated.stderr)
  assert.equal(generated.status, 0, `${generated.stderr}\n${generated.stdout}`)
  assert.ok(events(generated.stdout).some((event) => event.type === 'job-finished' && event.status === 'completed'))

  const projectPath = join(parent, 'gin-api')
  const manifest = JSON.parse(await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8'))
  assert.equal(manifest.recipeId, 'BE-04')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.projectType, 'backend')
  assert.equal(manifest.packageManager, 'go-modules')
  assert.equal(manifest.modulePath, 'example.com/gin-api')
  assert.equal(manifest.toolVersions.gin, '1.12.0')
  for (const check of ['module-download', 'go-module-integrity', 'go-module-compatibility', 'go-module', 'gofmt', 'go-vet', 'go-test', 'go-build', 'http-smoke']) {
    assert.equal(manifest.validation.find((item) => item.id === check)?.status, 'pass', check)
  }
  const goMod = await readFile(join(projectPath, 'go.mod'), 'utf8')
  assert.equal(goMod, createGinGoMod('example.com/gin-api'))
  const goSumHash = createHash('sha256').update(await readFile(join(projectPath, 'go.sum'))).digest('hex')
  assert.equal(goSumHash, manifest.dependencyIntegrity.goSumSha256)
  assert.match(await readFile(join(projectPath, 'README.md'), 'utf8'), /Standalone Go \+ Gin REST API/)
  assert.match(await readFile(join(projectPath, 'docs/SETUP.md'), 'utf8'), /separate affirmative network consent/)
  await assert.rejects(access(join(projectPath, '.env')))
  await assert.rejects(access(join(projectPath, 'vendor')))

  const collisionPath = join(parent, 'collision-gin')
  await mkdir(collisionPath)
  const sentinelPath = join(collisionPath, 'keep.txt')
  await writeFile(sentinelPath, 'preserve this file\n')
  const collisionConfig = join(parent, 'collision.json')
  await writeFile(collisionConfig, JSON.stringify(selection('collision-gin'), null, 2))
  const collision = invoke(['generate', '--config', collisionConfig, '--jsonl', '--development-allow-planned', '--allow-module-downloads'], 30_000)
  keepJobLog(collision.stderr)
  assert.equal(collision.status, 6, `${collision.stderr}\n${collision.stdout}`)
  assert.ok(events(collision.stdout).some((event) => event.code === 'GEN_PATH_EXISTS'))
  assert.equal(await readFile(sentinelPath, 'utf8'), 'preserve this file\n')
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])
  assert.equal(globalGoSettings(), globalGoSettingsBefore, 'Go global configuration changed during acceptance')

  complete = true
  console.log(JSON.stringify({
    phase: '05D.2',
    flow: 'Windows CLI',
    host: `${process.platform}-${process.arch}`,
    go: goVersion,
    recipe: manifest.recipeId,
    recipeStatus: manifest.recipeStatusAtCreation,
    gin: manifest.toolVersions.gin,
    goSumSha256: goSumHash,
    moduleDownloadConsent: 'affirmed only for successful/cancelled acceptance runs; lifecycle consent not granted',
    globalGoConfiguration: 'unchanged; GOTOOLCHAIN=local and GOENV=off scoped to child processes',
    validations: manifest.validation.map(({ id, status }) => ({ id, status })),
    consentDeniedBeforeStaging: 'pass',
    cancellationCleanup: 'pass',
    BE02PlanRegression: 'pass; no module network consent',
    collision: 'blocked; sentinel preserved; no staging',
    releaseApproved: false,
  }, null, 2))
} finally {
  if (complete) {
    await cleanJobLogs()
    await rm(parent, { recursive: true, force: true })
  } else {
    console.error(`Incomplete CLI BE-04 E2E artifacts retained for diagnosis: ${parent}; job logs: ${jobLogs.join(', ')}`)
  }
}
