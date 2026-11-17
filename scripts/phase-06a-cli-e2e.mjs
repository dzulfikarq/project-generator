import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'

if (process.platform !== 'win32') throw new Error('Phase 06A CLI acceptance requires Windows.')
const root = resolve(import.meta.dirname, '..')
const cli = resolve(root, 'packages', 'cli', 'dist', 'src', 'index.js')
const npmCli = resolve(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
await Promise.all([access(cli), access(npmCli)])
const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
await access(tempBase)
assert.ok((await stat(tempBase)).isDirectory())
const parent = await mkdtemp(join(tempBase, 'phase-06a-cli-e2e-20261116 spaces-雪-'))
const environment = { ...process.env }
const preserveArtifacts = process.env.PG_KEEP_PHASE_06A_ARTIFACTS === '1'
let jobLogs = []
let server

function selection(name, database = undefined) {
  return {
    schemaVersion: 1,
    project: { name, parentDirectory: parent, type: 'backend' },
    backend: { adapterId: 'backend.express', manager: 'npm' },
    ...(database ? { database } : {}),
    documentation: 'standard',
    git: { initialize: false, initialCommit: false },
  }
}

function invoke(args, options = {}) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    env: environment,
    encoding: 'utf8',
    windowsHide: true,
    timeout: options.timeout ?? 20 * 60 * 1000,
    maxBuffer: 30 * 1024 * 1024,
  })
  if (result.error) throw result.error
  return result
}

function events(stdout) {
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

function rememberLog(stderr) {
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
  rememberLog(stderr)
  assert.equal(cancelSent, true, 'cancellation run reached npm install')
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

async function waitForServer(url) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server?.exitCode !== null) break
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(500) })
      if (response.ok) return response
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 250))
    }
  }
  throw new Error(`Generated API did not start. ${server?.stderrText ?? ''}`)
}

async function npm(args, cwd, env = environment, timeout = 10 * 60 * 1000) {
  const result = spawnSync(process.execPath, [npmCli, ...args], { cwd, env, encoding: 'utf8', windowsHide: true, timeout, maxBuffer: 20 * 1024 * 1024 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `npm ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`)
  return result
}

async function verifyIsolatedMigrationAndCrud(projectPath) {
  const databaseDirectory = join(projectPath, 'data')
  const testEnvironment = { ...environment }
  delete testEnvironment.DB_FILE
  try {
    await assert.rejects(access(databaseDirectory), { code: 'ENOENT' })
    const externalFile = join(dirname(projectPath), 'external.sqlite')
    const traversalFile = join(dirname(projectPath), 'external-traversal.sqlite')
    for (const [dbFile, target] of [[externalFile, externalFile], ['..\\external-traversal.sqlite', traversalFile], [':memory:', undefined]]) {
      const blocked = spawnSync(process.execPath, [npmCli, 'run', 'db:migrate'], {
        cwd: projectPath,
        env: { ...testEnvironment, DB_FILE: dbFile },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60_000,
      })
      assert.equal(blocked.error, undefined, `Could not start DB_FILE rejection check: ${dbFile}`)
      assert.equal(blocked.signal, null, `DB_FILE rejection check was interrupted: ${dbFile}`)
      assert.ok(Number.isInteger(blocked.status) && blocked.status !== 0, `Unsafe DB_FILE was accepted or process did not complete: ${dbFile}`)
      if (target) await assert.rejects(access(target), { code: 'ENOENT' })
      await assert.rejects(access(databaseDirectory), { code: 'ENOENT' })
    }
    for (const dbFile of [externalFile, '..\\external-traversal.sqlite', ':memory:']) {
      const badDrizzleConfig = spawnSync(process.execPath, [npmCli, 'run', 'db:generate'], {
        cwd: projectPath,
        env: { ...testEnvironment, DB_FILE: dbFile },
        encoding: 'utf8',
        windowsHide: true,
        timeout: 60_000,
      })
      assert.equal(badDrizzleConfig.error, undefined, `Could not start Drizzle config rejection check: ${dbFile}`)
      assert.equal(badDrizzleConfig.signal, null, `Drizzle config rejection check was interrupted: ${dbFile}`)
      assert.ok(Number.isInteger(badDrizzleConfig.status) && badDrizzleConfig.status !== 0, `Drizzle config accepted unsafe DB_FILE or process did not complete: ${dbFile}`)
      await assert.rejects(access(databaseDirectory), { code: 'ENOENT' })
    }
    await npm(['run', 'db:migrate'], projectPath, testEnvironment)
    await access(databaseDirectory)
    await access(join(databaseDirectory, 'notes.sqlite'))
    const migrationFiles = (await readdir(join(projectPath, 'drizzle'))).filter((file) => file.endsWith('.sql'))
    assert.ok(migrationFiles.length > 0)
    assert.match(await readFile(join(projectPath, 'drizzle', migrationFiles[0]), 'utf8'), /CREATE TABLE.*notes/i)

    const port = await allocatePort()
    const child = spawn(process.execPath, ['dist/server.js'], {
      cwd: projectPath,
      env: { ...testEnvironment, HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'acceptance' },
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    server = child
    let stderr = ''
    const closed = new Promise((resolveExit) => child.once('close', resolveExit))
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', (chunk) => { stderr += chunk; child.stderrText = stderr })
    try {
      const health = await waitForServer(`http://127.0.0.1:${port}/health`)
      assert.deepEqual(await health.json(), { status: 'ok' })
      const base = `http://127.0.0.1:${port}/api/notes`
      const created = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'isolated acceptance', body: 'before update' }) })
      assert.equal(created.status, 201)
      const note = (await created.json()).data
      assert.equal(note.title, 'isolated acceptance')
      assert.equal((await (await fetch(`${base}/${note.id}`)).json()).data.body, 'before update')
      const updated = await fetch(`${base}/${note.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ body: 'after update' }) })
      assert.equal((await updated.json()).data.body, 'after update')
      assert.equal((await fetch(`${base}/${note.id}`, { method: 'DELETE' })).status, 200)
      assert.equal((await fetch(`${base}/${note.id}`)).status, 404)
    } finally {
      if (child.exitCode === null) child.kill()
      await closed
      if (server === child) server = undefined
    }
  } finally {
    await rm(databaseDirectory, { recursive: true, force: true })
  }
}

try {
  const be01Config = join(parent, 'BE-01.json')
  const be07Config = join(parent, 'BE-07.json')
  const invalidConfig = join(parent, 'invalid-orm.json')
  const cancelConfig = join(parent, 'cancel.json')
  await writeFile(be01Config, JSON.stringify(selection('be01-no-db'), null, 2))
  await writeFile(be07Config, JSON.stringify(selection('be07-notes', {
    adapterId: 'database.sqlite', accessAdapterId: 'data-access.drizzle-sqlite', mode: 'embedded',
  }), null, 2))
  await writeFile(invalidConfig, JSON.stringify(selection('invalid-orm', {
    adapterId: 'database.sqlite', accessAdapterId: 'data-access.none', mode: 'embedded',
  }), null, 2))
  await writeFile(cancelConfig, JSON.stringify(selection('cancel-api', {
    adapterId: 'database.sqlite', accessAdapterId: 'data-access.drizzle-sqlite', mode: 'embedded',
  }), null, 2))

  const catalogResult = invoke(['catalog', '--json'])
  assert.equal(catalogResult.status, 0, catalogResult.stderr)
  const catalog = JSON.parse(catalogResult.stdout).data
  const be01 = catalog.recipes.find(({ id }) => id === 'BE-01')
  const recipe = catalog.recipes.find(({ id }) => id === 'BE-07')
  assert.equal(be01?.status, 'planned')
  assert.equal(be01?.database, undefined)
  assert.equal(recipe?.status, 'planned')
  assert.equal(recipe?.database, 'database.sqlite')
  assert.equal(recipe?.dataAccess, 'data-access.drizzle-sqlite')
  assert.ok(catalog.databaseAdapters.some(({ id }) => id === 'database.sqlite'))
  assert.ok(catalog.ormAdapters.some(({ id }) => id === 'data-access.drizzle-sqlite'))
  assert.ok(recipe.dependencies.every(({ integrity }) => integrity.startsWith('sha512-')))

  const be01Plan = invoke(['plan', '--config', be01Config, '--json'])
  assert.equal(be01Plan.status, 0, be01Plan.stdout)
  assert.equal(JSON.parse(be01Plan.stdout).data.recipeId, 'BE-01')
  assert.equal(JSON.parse(be01Plan.stdout).data.expectedWrites.includes('data/notes.sqlite'), false)
  const be01Generated = invoke(['generate', '--config', be01Config, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts'])
  rememberLog(be01Generated.stderr)
  assert.equal(be01Generated.status, 0, `${be01Generated.stderr}\n${be01Generated.stdout}`)
  assert.ok(events(be01Generated.stdout).some((event) => event.type === 'job-finished' && event.status === 'completed'))
  const be01Path = join(parent, 'be01-no-db')
  const be01Manifest = JSON.parse(await readFile(join(be01Path, '.project-generator', 'manifest.json'), 'utf8'))
  const be01Package = JSON.parse(await readFile(join(be01Path, 'package.json'), 'utf8'))
  assert.equal(be01Manifest.recipeId, 'BE-01')
  assert.equal(be01Manifest.recipeStatusAtCreation, 'planned')
  assert.deepEqual(be01Manifest.selectedAdapters.map(({ id }) => id), ['backend.express'])
  assert.equal(be01Manifest.selectedAdapters.some(({ id }) => id.startsWith('database.') || id.startsWith('data-access.')), false)
  assert.equal(Object.hasOwn(be01Package.scripts, 'db:migrate'), false)
  assert.equal(Object.hasOwn(be01Package.scripts, 'db:generate'), false)
  const be01Dependencies = { ...be01Package.dependencies, ...be01Package.devDependencies }
  for (const packageName of ['better-sqlite3', 'drizzle-orm', 'drizzle-kit']) assert.equal(Object.hasOwn(be01Dependencies, packageName), false, packageName)
  await assert.rejects(access(join(be01Path, 'data')), { code: 'ENOENT' })
  await assert.rejects(access(join(be01Path, 'data', 'notes.sqlite')), { code: 'ENOENT' })
  for (const check of ['dependency-install', 'dependency-integrity', 'lockfile-integrity', 'typecheck', 'unit-tests', 'build', 'http-smoke', 'graceful-shutdown']) {
    assert.equal(be01Manifest.validation.find((item) => item.id === check)?.status, 'pass', check)
  }
  const plan = invoke(['plan', '--config', be07Config, '--json'])
  assert.equal(plan.status, 0, plan.stdout)
  const planData = JSON.parse(plan.stdout).data
  assert.equal(planData.recipeId, 'BE-07')
  assert.equal(planData.executionAvailable, false)
  assert.equal(new Set(planData.expectedWrites).size, planData.expectedWrites.length)
  assert.ok(planData.expectedWrites.includes('drizzle/*.sql'))
  assert.ok(planData.expectedWrites.includes('native/pg-db-path-verifier.exe'))
  assert.equal(planData.expectedWrites.includes('data/notes.sqlite'), false)
  assert.ok(planData.warnings.some((warning) => warning.includes('never applies migrations')))
  assert.ok(planData.warnings.some((warning) => warning.includes('isolated temporary SQLite database')))

  const invalidPlan = invoke(['plan', '--config', invalidConfig, '--json'])
  assert.equal(invalidPlan.status, 3)
  assert.equal(JSON.parse(invalidPlan.stdout).error.code, 'GEN_INCOMPATIBLE')
  const invalidGenerate = invoke(['generate', '--config', invalidConfig, '--jsonl', '--development-allow-planned'])
  assert.equal(invalidGenerate.status, 3)
  assert.ok(events(invalidGenerate.stdout).some((event) => event.code === 'GEN_INCOMPATIBLE'))
  await assert.rejects(access(join(parent, 'invalid-orm')))

  await runCancelled(cancelConfig)
  await cleanJobLogs()

  const generated = invoke(['generate', '--config', be07Config, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts'])
  rememberLog(generated.stderr)
  assert.equal(generated.status, 0, `${generated.stderr}\n${generated.stdout}`)
  const generatedEvents = events(generated.stdout)
  assert.ok(generatedEvents.some((event) => event.type === 'job-finished' && event.status === 'completed'))
  const projectPath = join(parent, 'be07-notes')
  const manifest = JSON.parse(await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8'))
  assert.equal(manifest.recipeId, 'BE-07')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.packageManager, 'npm')
  assert.ok(manifest.selectedAdapters.some(({ id }) => id === 'database.sqlite'))
  assert.ok(manifest.selectedAdapters.some(({ id }) => id === 'data-access.drizzle-sqlite'))
  for (const check of ['dependency-install', 'dependency-integrity', 'lockfile-integrity', 'migration-generation', 'typecheck', 'lint', 'unit-tests', 'database-integration-tests', 'build', 'http-smoke', 'graceful-shutdown']) {
    assert.equal(manifest.validation.find((item) => item.id === check)?.status, 'pass', check)
  }
  const packageJson = JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf8'))
  assert.equal(packageJson.engines.node, '>=22.13.0')
  assert.equal(packageJson.scripts['db:generate'], 'drizzle-kit generate')
  assert.equal(packageJson.scripts['db:migrate'], 'node --import tsx src/db/migrate.ts')
  assert.equal(packageJson.dependencies['drizzle-orm'], '0.45.4')
  assert.equal(packageJson.dependencies['better-sqlite3'], '13.2.0')
  assert.equal(packageJson.devDependencies['drizzle-kit'], '0.31.11')
  const lock = JSON.parse(await readFile(join(projectPath, 'package-lock.json'), 'utf8'))
  for (const dependency of recipe.dependencies) {
    const entry = lock.packages[`node_modules/${dependency.packageName}`]
    assert.equal(entry.version, dependency.version, dependency.packageName)
    assert.equal(entry.integrity, dependency.integrity, dependency.packageName)
  }
  for (const file of ['drizzle.config.ts', 'drizzle/0000_notes.sql', 'drizzle/meta/_journal.json', 'docs/DATABASE-SAFETY.md', 'native/pg-db-path-verifier.exe', 'src/db/schema.ts', 'src/db/path.ts', 'src/db/client.ts', 'src/db/migrate.ts', 'src/db/notes.ts', 'src/routes/notes.ts', 'test/database.test.ts', 'README.md', 'docs/SETUP.md']) {
    if (file.includes('0000_')) assert.ok((await readdir(join(projectPath, 'drizzle'))).some((entry) => /^\d{4}_.+\.sql$/.test(entry)))
    else await access(join(projectPath, file))
  }
  assert.deepEqual(await readFile(join(projectPath, 'native', 'pg-db-path-verifier.exe')), await readFile(join(root, 'packages', 'core', 'native', 'pg-db-path-verifier.exe')))
  const generatedPathValidator = await readFile(join(projectPath, 'src', 'db', 'path.ts'), 'utf8')
  assert.doesNotMatch(generatedPathValidator, /powershell|SystemRoot|WINDIR/i)
  await assert.rejects(access(join(projectPath, 'data', 'notes.sqlite')))
  await assert.rejects(access(join(projectPath, 'data')))
  await assert.rejects(access(join(projectPath, '.tmp')))
  const readme = await readFile(join(projectPath, 'README.md'), 'utf8')
  assert.match(readme, /never applies migrations|never.*migrations/i)
  assert.match(readme, /review generated schema and SQL/i)
  assert.match(readme, /npm run db:migrate/)
  const migrationFile = (await readdir(join(projectPath, 'drizzle'))).find((entry) => /^\d{4}_.+\.sql$/.test(entry))
  assert.ok(migrationFile)
  assert.match(await readFile(join(projectPath, 'drizzle', migrationFile), 'utf8'), /CREATE TABLE.*notes/i)

  for (const args of [['run', 'typecheck'], ['run', 'lint'], ['run', 'test'], ['run', 'build']]) await npm(args, projectPath)
  await verifyIsolatedMigrationAndCrud(projectPath)

  const collisionPath = join(parent, 'collision-api')
  await mkdir(collisionPath)
  const sentinelPath = join(collisionPath, 'keep.txt')
  await writeFile(sentinelPath, 'preserve this file\n')
  const collisionConfig = join(parent, 'collision.json')
  await writeFile(collisionConfig, JSON.stringify(selection('collision-api', {
    adapterId: 'database.sqlite', accessAdapterId: 'data-access.drizzle-sqlite', mode: 'embedded',
  }), null, 2))
  const collision = invoke(['generate', '--config', collisionConfig, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts'])
  rememberLog(collision.stderr)
  assert.equal(collision.status, 6, `${collision.stderr}\n${collision.stdout}`)
  assert.ok(events(collision.stdout).some((event) => event.code === 'GEN_PATH_EXISTS'))
  assert.equal(await readFile(sentinelPath, 'utf8'), 'preserve this file\n')
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])

  console.log(JSON.stringify({
    phase: '06A',
    flow: 'Windows CLI',
    host: `${process.platform}-${process.arch}`,
    node: process.version,
    recipe: manifest.recipeId,
    recipeStatus: manifest.recipeStatusAtCreation,
    validations: manifest.validation,
    migration: 'generated during generation; absolute/traversal DB_FILE rejected by runtime migrator and Drizzle config; explicitly applied only to isolated test database; CRUD passed',
    nativePathVerifier: 'project-local Rust helper copied from first-party package; fake SystemRoot/WINDIR did not execute powershell.exe sentinel',
    applicationDatabase: 'not created or migrated during generation; smoke used :memory:',
    cancellation: 'cancelled during npm install; owned staging cleaned',
    collision: 'existing sentinel preserved; no staging left',
    be01: 'fresh project generated; no database adapters, SQLite/Drizzle packages, migration scripts, data directory, or DB file',
    releaseApproved: false,
  }, null, 2))
} finally {
  if (server && server.exitCode === null) server.kill()
  if (preserveArtifacts) console.error(`Phase 06A CLI artifacts retained for diagnosis: ${parent}\nJob logs: ${jobLogs.join(', ')}`)
  else {
    await cleanJobLogs()
    await rm(parent, { recursive: true, force: true })
  }
}
