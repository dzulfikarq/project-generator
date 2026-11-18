import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { closeSync, openSync, readFileSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve, win32 } from 'node:path'
import { createServer } from 'node:net'
import { assertFullstackInstallPathSafe } from '../packages/core/dist/src/paths.js'

class BlockedError extends Error {}

const root = resolve(import.meta.dirname, '..')
const cli = join(root, 'packages', 'cli', 'dist', 'src', 'index.js')
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const supervisor = join(root, 'packages', 'core', 'native', 'pg-windows-supervisor.exe')
const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
const secrets = new Set()
let runRoot
let serverStarted = false
let startupReturned = false
let retainRunRoot = false
let probe
let probeConnections = 0
let cancelChild

function redact(value) {
  let output = String(value ?? '')
  for (const secret of secrets) if (secret) output = output.replaceAll(secret, '[redacted]')
  return output
}

function environmentWith(overrides = {}) {
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (/^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSERVICE|PGSSLMODE|PGOPTIONS|PGAPPNAME|PGTARGETSESSIONATTRS|PGDATA|PG_E2E_DATABASE_URL)$/i.test(key)) delete environment[key]
  }
  delete environment.DATABASE_URL
  if (runRoot) Object.assign(environment, {
    TEMP: join(runRoot, 'tmp'),
    TMP: join(runRoot, 'tmp'),
    npm_config_cache: join(runRoot, 'npm-cache'),
  })
  return Object.assign(environment, overrides)
}

function captured(program, args, options = {}) {
  const result = spawnSync(program, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? environmentWith(),
    encoding: 'utf8',
    input: options.input,
    windowsHide: true,
    timeout: options.timeout ?? 20 * 60 * 1000,
    maxBuffer: 60 * 1024 * 1024,
  })
  if (result.error) throw result.error
  return result
}

function capturedToFiles(program, args, options) {
  let stdoutFd
  let stderrFd
  let result
  try {
    stdoutFd = openSync(options.stdoutPath, 'w')
    stderrFd = openSync(options.stderrPath, 'w')
    result = spawnSync(program, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? environmentWith(),
      windowsHide: true,
      timeout: options.timeout ?? 90_000,
      maxBuffer: 60 * 1024 * 1024,
      stdio: ['ignore', stdoutFd, stderrFd],
    })
  } finally {
    try { if (stderrFd !== undefined) closeSync(stderrFd) }
    finally { if (stdoutFd !== undefined) closeSync(stdoutFd) }
  }
  return {
    ...result,
    stdout: redact(readFileSync(options.stdoutPath, 'utf8')),
    stderr: redact(readFileSync(options.stderrPath, 'utf8')),
  }
}

function requireSuccess(result, label) {
  if (result.status !== 0 || result.signal) {
    throw new Error(`${label} failed (exit ${result.status ?? result.signal ?? 'unknown'}):\n${redact(result.stdout)}\n${redact(result.stderr)}`)
  }
  return result
}

async function findProgram(name) {
  const file = name.endsWith('.exe') ? name : `${name}.exe`
  const dirs = [process.env.PG_BINDIR, ...(process.env.PATH ?? '').split(win32.delimiter)].filter(Boolean)
  for (const dir of dirs) {
    const candidate = join(dir, file)
    try { await access(candidate); return candidate } catch { /* continue through PATH */ }
  }
  throw new BlockedError(`${file} missing; install/use PostgreSQL 16+ binaries or set PG_BINDIR. No service was installed.`)
}

async function allocatePort() {
  for (;;) {
    const listener = createServer()
    await new Promise((resolveListen, reject) => {
      listener.once('error', reject)
      listener.listen(0, '127.0.0.1', resolveListen)
    })
    const address = listener.address()
    assert.ok(address && typeof address === 'object')
    await new Promise((resolveClose, reject) => listener.close((error) => error ? reject(error) : resolveClose()))
    if (address.port !== 5432) return address.port
  }
}

async function verifyPortAvailable(port) {
  const listener = createServer()
  await new Promise((resolveListen, reject) => {
    listener.once('error', reject)
    listener.listen(port, '127.0.0.1', resolveListen)
  })
  await new Promise((resolveClose, reject) => listener.close((error) => error ? reject(error) : resolveClose()))
}

function psqlArgs(port, user, database, sql) {
  return [
    '--no-psqlrc', '--no-password', '--host', '127.0.0.1', '--port', String(port),
    '--username', user, '--dbname', database, '--tuples-only', '--no-align', '--set=ON_ERROR_STOP=1',
    ...(sql === undefined ? [] : ['--command', sql]),
  ]
}

function psql(executable, port, user, database, sql, input) {
  const result = captured(executable, psqlArgs(port, user, database, sql), { input })
  requireSuccess(result, 'run-owned psql command')
  return result.stdout.trim()
}

async function buildOwnedCluster(binaries, port, password) {
  const cluster = join(runRoot, 'postgres-data')
  await mkdir(cluster)
  await verifyPortAvailable(port)
  const initialized = captured(binaries.initdb, [
    '-D', cluster, '-U', 'e2e_admin', '--encoding', 'UTF8', '--no-locale', '--no-instructions',
    '--auth-local=trust', '--auth-host=trust',
  ])
  requireSuccess(initialized, 'run-owned initdb')
  const log = join(runRoot, 'postgres.log')
  await writeFile(log, '', { flag: 'wx' })
  serverStarted = true
  const args = ['-D', cluster, '-l', log, '-o', `-h 127.0.0.1 -p ${port} -c listen_addresses=127.0.0.1`, '-w', '-t', '30', 'start']
  const started = capturedToFiles(binaries.pg_ctl, args, {
    env: environmentWith(),
    timeout: 90_000,
    stdoutPath: join(runRoot, 'pg-ctl-start.stdout.log'),
    stderrPath: join(runRoot, 'pg-ctl-start.stderr.log'),
  })
  startupReturned = !started.error
  if (started.error || started.status !== 0) throw new BlockedError(`Run-owned PostgreSQL failed to start on 127.0.0.1:${port}; exit=${started.status ?? 'unknown'}; ${redact(started.stderr)}`)
  const status = captured(binaries.pg_ctl, ['-D', cluster, 'status'])
  requireSuccess(status, 'run-owned pg_ctl status')
  const identity = psql(binaries.psql, port, 'e2e_admin', 'postgres', "SELECT current_database() || '|' || current_user || '|' || host(inet_server_addr()) || '|' || inet_server_port() || '|' || current_setting('data_directory')")
  const [database, user, address, serverPort, dataDirectory] = identity.split('|')
  assert.deepEqual({ database, user, address, port: Number(serverPort), dataDirectory: win32.resolve(dataDirectory ?? '').toLowerCase() }, {
    database: 'postgres', user: 'e2e_admin', address: '127.0.0.1', port,
    dataDirectory: win32.resolve(cluster).toLowerCase(),
  }, 'PostgreSQL server identity must match this run-owned loopback cluster')
  psql(binaries.psql, port, 'e2e_admin', 'postgres', undefined,
    `CREATE ROLE e2e_app LOGIN PASSWORD '${password}';\nCREATE DATABASE pg_e2e_app OWNER e2e_app;\nCREATE DATABASE pg_e2e_other OWNER e2e_app;\nCREATE DATABASE pg_e2e_rollback OWNER e2e_app;\n`)
  retainRunRoot = false
  return cluster
}

function selection(name, parentDirectory, recipe = 'FS-06') {
  if (recipe === 'FS-06') return {
    schemaVersion: 1,
    project: { name, parentDirectory, type: 'fullstack' },
    frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'npm' },
    backend: { adapterId: 'backend.express', manager: 'npm' },
    database: { adapterId: 'database.postgresql', accessAdapterId: 'data-access.drizzle-postgresql', mode: 'existing-service' },
    styling: { adapterId: 'styling.css' },
    documentation: 'standard',
    git: { initialize: false, initialCommit: false },
  }
  if (recipe === 'BE-07') return {
    schemaVersion: 1,
    project: { name, parentDirectory, type: 'backend' },
    backend: { adapterId: 'backend.express', manager: 'npm' },
    database: { adapterId: 'database.sqlite', accessAdapterId: 'data-access.drizzle-sqlite', mode: 'embedded' },
    documentation: 'minimal', git: { initialize: false, initialCommit: false },
  }
  if (recipe === 'BE-08') return {
    schemaVersion: 1,
    project: { name, parentDirectory, type: 'backend' },
    backend: { adapterId: 'backend.express', manager: 'npm' },
    database: { adapterId: 'database.postgresql', accessAdapterId: 'data-access.drizzle-postgresql', mode: 'existing-service' },
    documentation: 'minimal', git: { initialize: false, initialCommit: false },
  }
  return {
    schemaVersion: 1,
    project: { name, parentDirectory, type: recipe === 'FE-01' ? 'frontend' : 'backend' },
    ...(recipe === 'FE-01'
      ? { frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'npm' }, styling: { adapterId: 'styling.css' } }
      : { backend: { adapterId: 'backend.express', manager: 'npm' } }),
    documentation: 'minimal', git: { initialize: false, initialCommit: false },
  }
}

function parseEvents(stdout) {
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

function cliRun(args, env = environmentWith(), timeout = 30 * 60 * 1000) {
  return captured(process.execPath, [cli, ...args], { env, timeout })
}

function npmRun(args, cwd, env, timeout = 10 * 60 * 1000) {
  return captured(process.execPath, [npmCli, ...args], { cwd, env, timeout })
}

async function runCancelled(configPath, env) {
  cancelChild = spawn(process.execPath, [cli, 'generate', '--config', configPath, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts', '--desktop-control'], {
    cwd: root, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let pending = ''
  let installing = false
  let cancelSent = false
  let cancelTimer
  cancelChild.stdout.setEncoding('utf8')
  cancelChild.stderr.setEncoding('utf8')
  cancelChild.stdout.on('data', (chunk) => {
    stdout += chunk
    pending += chunk
    for (;;) {
      const newline = pending.indexOf('\n')
      if (newline < 0) break
      const line = pending.slice(0, newline).trim()
      pending = pending.slice(newline + 1)
      if (!line) continue
      const event = JSON.parse(line)
      if (event.type === 'stage-started' && event.stageId === 'installing' && !installing) {
        installing = true
        cancelTimer = setTimeout(() => {
          if (cancelChild?.exitCode === null) {
            cancelSent = true
            cancelChild.stdin.end('{"schemaVersion":1,"kind":"cancel"}\n')
          }
        }, 100)
      }
    }
  })
  cancelChild.stderr.on('data', (chunk) => { stderr += chunk })
  const watchdog = setTimeout(() => {
    if (cancelChild?.exitCode === null && !cancelSent) cancelChild.stdin.end('{"schemaVersion":1,"kind":"cancel"}\n')
  }, 20 * 60 * 1000)
  let exit
  try {
    exit = await new Promise((resolveExit, reject) => {
      cancelChild.once('error', reject)
      cancelChild.once('close', (code, signal) => resolveExit({ code, signal }))
    })
  } finally {
    clearTimeout(watchdog)
    if (cancelTimer) clearTimeout(cancelTimer)
    cancelChild = undefined
  }
  assert.equal(installing, true, `FS-06 cancellation never entered install stage: ${redact(stderr)}\n${redact(stdout)}`)
  assert.equal(cancelSent, true, `FS-06 cancellation did not reach CLI: ${JSON.stringify(exit)}`)
  assert.equal(exit.code, 5, `Unexpected FS-06 cancellation result ${JSON.stringify(exit)}: ${redact(stderr)}`)
  assert.ok(parseEvents(stdout).some((event) => event.type === 'job-finished' && event.status === 'cancelled'), redact(stdout))
}

async function freePortForApi() { return allocatePort() }

async function startApi(projectPath, port, databaseUrl) {
  const child = spawn(process.execPath, [join(projectPath, 'apps', 'api', 'dist', 'server.js')], {
    cwd: join(projectPath, 'apps', 'api'),
    env: environmentWith({ HOST: '127.0.0.1', PORT: String(port), NODE_ENV: 'test', ...(databaseUrl ? { DATABASE_URL: databaseUrl } : {}) }),
    windowsHide: true,
    stdio: 'ignore',
  })
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Generated FS-06 API exited during startup (${child.exitCode}).`)
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(500) })
      if (response.status === 200) return child
    } catch { /* poll owned loopback server */ }
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  child.kill()
  throw new Error('Generated FS-06 API did not become healthy within 15 seconds.')
}

async function stopApi(child) {
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM')
  if (child.exitCode !== null || child.signalCode !== null) return
  await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => reject(new Error('Generated FS-06 API did not stop after SIGTERM.')), 20_000)
    child.once('error', (error) => { clearTimeout(timer); reject(error) })
    child.once('close', () => { clearTimeout(timer); resolveExit() })
  })
}

async function runAcceptance() {
  if (process.platform !== 'win32') throw new BlockedError('Phase 07A PostgreSQL E2E requires Windows; no service or cluster was created.')
  const nodeVersion = process.versions.node.split('.').map(Number)
  if (nodeVersion[0] < 22 || (nodeVersion[0] === 22 && nodeVersion[1] < 13)) throw new BlockedError('Node.js 22.13+ required for Phase 07A runtime E2E.')
  for (const path of [cli, npmCli, supervisor, tempBase]) await access(path)
  if (!(await stat(tempBase)).isDirectory()) throw new BlockedError('Approved OpenCode temp path is not a directory.')
  const elevation = captured(supervisor, ['--check-elevation'])
  requireSuccess(elevation, 'Windows elevation preflight')
  if (JSON.parse(elevation.stdout).elevated) throw new BlockedError('Phase 07A E2E requires a non-elevated caller; no cluster was created.')

  const binaries = { initdb: await findProgram('initdb'), pg_ctl: await findProgram('pg_ctl'), psql: await findProgram('psql') }
  const pgVersion = requireSuccess(captured(binaries.pg_ctl, ['--version']), 'PostgreSQL version').stdout.trim()
  const major = Number(pgVersion.match(/\b(\d+)\./)?.[1])
  if (!Number.isInteger(major) || major < 16) throw new BlockedError(`PostgreSQL 16+ binaries required; found ${redact(pgVersion)}.`)

  runRoot = await mkdtemp(join(tempBase, 'phase-07a-fullstack-e2e-'))
  await mkdir(join(runRoot, 'tmp'))
  const parent = join(runRoot, 'projects')
  await mkdir(parent)
  const password = randomBytes(24).toString('base64url')
  secrets.add(password)
  const pgPort = await allocatePort()
  const cluster = await buildOwnedCluster(binaries, pgPort, password)

  probe = createServer((socket) => { probeConnections += 1; socket.destroy() })
  await new Promise((resolveListen, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolveListen)
  })
  const probeAddress = probe.address()
  assert.ok(probeAddress && typeof probeAddress === 'object')
  const probeUrl = `postgresql://probe:probe@127.0.0.1:${probeAddress.port}/probe_db`
  secrets.add(probeUrl)
  const appUrl = `postgresql://e2e_app:${password}@127.0.0.1:${pgPort}/pg_e2e_app`
  secrets.add(appUrl)
  const cliEnvironment = environmentWith({
    NODE_ENV: 'development',
    PG_BUILD_PROFILE: 'development',
    PG_ALLOW_PLANNED_RECIPE_GENERATION: 'true',
    DATABASE_URL: probeUrl,
  })
  const configPath = join(runRoot, 'FS-06.json')
  await writeFile(configPath, JSON.stringify(selection('fullstack-e2e', parent), null, 2))

  const catalogRun = requireSuccess(cliRun(['catalog', '--json'], cliEnvironment), 'catalog')
  const catalog = JSON.parse(catalogRun.stdout).data
  const fullstackRecipe = catalog.recipes.find(({ id }) => id === 'FS-06')
  assert.equal(fullstackRecipe?.status, 'planned')
  assert.equal(fullstackRecipe?.projectType, 'fullstack')
  assert.equal(catalog.recipes.find(({ id }) => id === 'BE-08')?.backend, 'backend.express')

  const planRun = requireSuccess(cliRun(['plan', '--config', configPath, '--json'], cliEnvironment), 'FS-06 plan')
  const plan = JSON.parse(planRun.stdout).data
  assert.equal(plan.recipeId, 'FS-06')
  assert.equal(plan.recipeStatus, 'planned')
  assert.equal(plan.executionAvailable, false)
  assert.equal(new Set(plan.expectedWrites).size, plan.expectedWrites.length)
  assert.ok(plan.expectedWrites.includes('package-lock.json'))
  assert.equal(plan.expectedWrites.filter((path) => path === 'package-lock.json').length, 1)
  assert.ok(plan.expectedWrites.includes('apps/api/src/db/migrate.ts'))
  assert.ok(plan.expectedWrites.includes('apps/web/vite.config.ts'))

  for (const [id, tuple] of [
    ['FE-01', selection('fe01-regression', parent, 'FE-01')],
    ['BE-01', selection('be01-regression', parent, 'BE-01')],
    ['BE-07', selection('be07-regression', parent, 'BE-07')],
    ['BE-08', selection('be08-regression', parent, 'BE-08')],
  ]) {
    const regressionConfig = join(runRoot, `${id}.json`)
    await writeFile(regressionConfig, JSON.stringify(tuple, null, 2))
    const regression = requireSuccess(cliRun(['plan', '--config', regressionConfig, '--json'], cliEnvironment), `${id} plan regression`)
    assert.equal(JSON.parse(regression.stdout).data.recipeId, id)
  }
  const be01Plan = JSON.parse(cliRun(['plan', '--config', join(runRoot, 'BE-01.json'), '--json'], cliEnvironment).stdout).data
  assert.equal(be01Plan.expectedWrites.includes('src/db/schema.ts'), false)
  const be07Plan = JSON.parse(cliRun(['plan', '--config', join(runRoot, 'BE-07.json'), '--json'], cliEnvironment).stdout).data
  assert.ok(be07Plan.expectedWrites.includes('native/pg-db-path-verifier.exe'))
  const be08Plan = JSON.parse(cliRun(['plan', '--config', join(runRoot, 'BE-08.json'), '--json'], cliEnvironment).stdout).data
  assert.ok(be08Plan.expectedWrites.includes('src/db/target.ts'))

  assert.throws(() => assertFullstackInstallPathSafe(win32.join('C:\\', 'x'.repeat(180)), 'fullstack-e2e', 'phase-07a-long-path'), (error) => error?.code === 'GEN_PATH_UNSAFE')
  const doctorRun = requireSuccess(cliRun(['doctor', '--config', configPath, '--json'], cliEnvironment), 'FS-06 Doctor')
  assert.equal(JSON.parse(doctorRun.stdout).data.ready, true)

  const generated = cliRun(['generate', '--config', configPath, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts'], cliEnvironment)
  requireSuccess(generated, 'FS-06 generation')
  assert.ok(parseEvents(generated.stdout).some((event) => event.type === 'job-finished' && event.status === 'completed'), redact(generated.stdout))
  assert.equal(probeConnections, 0, 'FS-06 generation/Drizzle SQL/HTTP smoke connected to DATABASE_URL trap')

  const projectPath = join(parent, 'fullstack-e2e')
  const manifest = JSON.parse(await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8'))
  assert.equal(manifest.recipeId, 'FS-06')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.packageManager, 'npm')
  for (const id of ['scaffold-identity', 'dependency-install', 'dependency-integrity', 'lockfile-integrity', 'migration-generation', 'api-typecheck', 'web-typecheck', 'lint', 'unit-tests', 'database-safety-tests', 'frontend-client-tests', 'api-build', 'web-build', 'fullstack-http-smoke', 'graceful-shutdown']) {
    assert.equal(manifest.validation.find((item) => item.id === id)?.status, 'pass', id)
  }
  for (const path of ['README.md', 'docs/SETUP.md', 'docs/DATABASE-SAFETY.md', 'docs/ARCHITECTURE.md', 'docs/TESTING.md', 'apps/web/src/App.tsx', 'apps/web/src/vite-env.d.ts', 'apps/web/src/services/items.ts', 'apps/api/src/db/migrate.ts', 'apps/api/src/routes/items.ts', 'apps/api/drizzle/meta/_journal.json']) await access(join(projectPath, path))
  const rootEntries = await readdir(projectPath)
  assert.ok(rootEntries.includes('package-lock.json'))
  for (const nested of ['apps/web', 'apps/api']) assert.equal((await readdir(join(projectPath, nested))).includes('package-lock.json'), false)
  const packageJson = JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf8'))
  assert.deepEqual(packageJson.workspaces, ['apps/web', 'apps/api'])
  const lock = JSON.parse(await readFile(join(projectPath, 'package-lock.json'), 'utf8'))
  const lockRoot = lock.packages['']
  const workspacePaths = Array.isArray(lockRoot.workspaces) ? lockRoot.workspaces : lockRoot.workspaces?.packages ?? []
  for (const dependency of fullstackRecipe.dependencies) {
    const owners = ['', ...workspacePaths].filter((path) => {
      const manifest = lock.packages[path]
      return manifest?.dependencies?.[dependency.packageName] !== undefined || manifest?.devDependencies?.[dependency.packageName] !== undefined
    })
    assert.ok(owners.length, `${dependency.packageName} missing from root/workspace manifests`)
    for (const owner of owners) {
      const manifest = lock.packages[owner]
      assert.equal(manifest.dependencies?.[dependency.packageName] ?? manifest.devDependencies?.[dependency.packageName], dependency.version, `${dependency.packageName} declaration in ${owner || 'root'}`)
      let location = owner
      let entry
      while (true) {
        const candidate = `${location ? `${location}/` : ''}node_modules/${dependency.packageName}`
        if (lock.packages[candidate]) { location = candidate; entry = lock.packages[candidate]; break }
        const separator = location.lastIndexOf('/')
        if (separator < 0) { if (!location) { location = ''; break }; location = '' }
        else location = location.slice(0, separator)
      }
      assert.equal(entry?.version, dependency.version, `${dependency.packageName} resolved for ${owner || 'root'} at ${location}`)
      assert.equal(entry?.integrity, dependency.integrity, `${dependency.packageName} integrity for ${owner || 'root'}`)
    }
  }
  assert.equal(await psql(binaries.psql, pgPort, 'e2e_app', 'pg_e2e_app', "SELECT COALESCE(to_regclass('public.items')::text, '')"), '')

  const noDatabasePort = await freePortForApi()
  const noDatabaseApi = await startApi(projectPath, noDatabasePort, probeUrl)
  try {
    const health = await fetch(`http://127.0.0.1:${noDatabasePort}/health`)
    assert.equal(health.status, 200)
    assert.deepEqual(await health.json(), { status: 'ok' })
    const info = await fetch(`http://127.0.0.1:${noDatabasePort}/api/info`)
    assert.deepEqual(await info.json(), { name: 'FS-06 Express PostgreSQL API', version: '0.1.0', environment: 'test' })
  } finally { await stopApi(noDatabaseApi) }
  assert.equal(probeConnections, 0, 'DB-free FS-06 API startup/health connected to trap')

  const mismatch = npmRun(['run', 'db:migrate', '--', '--target', `127.0.0.1:${pgPort}/pg_e2e_other`], projectPath, environmentWith({ DATABASE_URL: appUrl }))
  assert.notEqual(mismatch.status, 0, 'migration target mismatch must fail')
  assert.match(redact(mismatch.stderr), /does not match/)
  assert.equal(await psql(binaries.psql, pgPort, 'e2e_app', 'pg_e2e_other', "SELECT COALESCE(to_regclass('public.items')::text, '')"), '')
  const migration = npmRun(['run', 'db:migrate', '--', '--target', `127.0.0.1:${pgPort}/pg_e2e_app`], projectPath, environmentWith({ DATABASE_URL: appUrl }))
  requireSuccess(migration, 'guarded FS-06 migration')
  assert.equal(await psql(binaries.psql, pgPort, 'e2e_app', 'pg_e2e_app', "SELECT to_regclass('public.items')::text"), 'items')

  psql(binaries.psql, pgPort, 'e2e_app', 'pg_e2e_rollback', undefined, 'CREATE TABLE items (id integer PRIMARY KEY);\n')
  const rollbackUrl = `postgresql://e2e_app:${password}@127.0.0.1:${pgPort}/pg_e2e_rollback`
  const rollback = npmRun(['run', 'db:migrate', '--', '--target', `127.0.0.1:${pgPort}/pg_e2e_rollback`], projectPath, environmentWith({ DATABASE_URL: rollbackUrl }))
  assert.notEqual(rollback.status, 0, 'conflicting FS-06 migration must fail')
  assert.equal(await psql(binaries.psql, pgPort, 'e2e_app', 'pg_e2e_rollback', "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema='public' AND table_name='items'"), 'id', 'failed migration must preserve pre-existing table')

  const apiPort = await freePortForApi()
  const api = await startApi(projectPath, apiPort, appUrl)
  try {
    const base = `http://127.0.0.1:${apiPort}`
    const list = await fetch(`${base}/api/items`)
    assert.equal(list.status, 200)
    assert.deepEqual((await list.json()).data, [])
    const created = await fetch(`${base}/api/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Phase 07A item', description: 'create' }) })
    assert.equal(created.status, 201)
    const item = (await created.json()).data
    assert.equal(item.name, 'Phase 07A item')
    const updated = await fetch(`${base}/api/items/${item.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ description: 'updated' }) })
    assert.equal((await updated.json()).data.description, 'updated')
    const invalid = await fetch(`${base}/api/items`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '', unexpected: true }) })
    assert.equal(invalid.status, 400)
    const deleted = await fetch(`${base}/api/items/${item.id}`, { method: 'DELETE' })
    assert.equal((await deleted.json()).data.id, item.id)
    assert.deepEqual((await (await fetch(`${base}/api/items`)).json()).data, [])
  } finally { await stopApi(api) }

  const cancelConfig = join(runRoot, 'cancel.json')
  await writeFile(cancelConfig, JSON.stringify(selection('cancel-fs06', parent), null, 2))
  await runCancelled(cancelConfig, environmentWith({ ...cliEnvironment, npm_config_cache: join(runRoot, 'cancel-npm-cache') }))
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])
  await assert.rejects(access(join(parent, 'cancel-fs06')))

  const collisionPath = join(parent, 'collision-fs06')
  await mkdir(collisionPath)
  const sentinel = join(collisionPath, 'preserve.txt')
  await writeFile(sentinel, 'run-owned sentinel\n', { flag: 'wx' })
  const collisionConfig = join(runRoot, 'collision.json')
  await writeFile(collisionConfig, JSON.stringify(selection('collision-fs06', parent), null, 2))
  const collision = cliRun(['generate', '--config', collisionConfig, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts'], cliEnvironment)
  assert.equal(collision.status, 6, `${redact(collision.stderr)}\n${redact(collision.stdout)}`)
  assert.ok(parseEvents(collision.stdout).some((event) => event.code === 'GEN_PATH_EXISTS'))
  assert.equal(await readFile(sentinel, 'utf8'), 'run-owned sentinel\n')

  await new Promise((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose()))
  probe = undefined
  assert.equal(probeConnections, 0)
  return {
    status: 'PASS',
    phase: '07A',
    flow: 'Windows CLI + fresh run-owned PostgreSQL 16+ loopback cluster',
    host: `${process.platform}-${process.arch}`,
    node: process.version,
    postgres: pgVersion,
    postgresAddress: `127.0.0.1:${pgPort} (5432 excluded)`,
    recipe: manifest.recipeId,
    recipeStatus: manifest.recipeStatusAtCreation,
    generation: 'single root lockfile; pinned dependency integrity; generated SQL; typecheck/lint/tests/builds; React/Vite proxy/API smoke; zero trap connections',
    database: 'startup/health and generation did not connect; mismatch blocked; explicit guarded migration succeeded only on run-owned database; CRUD passed',
    rollback: 'conflicting migration failed and preserved pre-existing table schema',
    cancellation: 'cancelled during npm installation; final target absent; owned stage removed',
    collision: 'pre-existing sentinel preserved; no target overwrite',
    regressions: 'FE-01, BE-01, BE-07, and BE-08 exact plans preserved; FS-06 long install path rejected before execution',
    releaseApproved: false,
  }
}

let outcome
try {
  outcome = await runAcceptance()
} catch (error) {
  outcome = { status: error instanceof BlockedError ? 'BLOCKED' : 'FAIL', reason: redact(error instanceof Error ? error.message : error) }
  if (serverStarted) retainRunRoot = true
} finally {
  if (cancelChild && cancelChild.exitCode === null) {
    cancelChild.stdin.end('{"schemaVersion":1,"kind":"cancel"}\n')
  }
  if (probe) await new Promise((resolveClose) => probe.close(() => resolveClose()))
  if (serverStarted && runRoot) {
    try {
      const pgCtl = await findProgram('pg_ctl')
      const cluster = join(runRoot, 'postgres-data')
      const status = captured(pgCtl, ['-D', cluster, 'status'], { timeout: 30_000 })
      if (status.status === 0) {
        const stopped = captured(pgCtl, ['-D', cluster, '-m', 'fast', '-w', '-t', '30', 'stop'], { timeout: 45_000 })
        requireSuccess(stopped, 'run-owned pg_ctl stop')
        const after = captured(pgCtl, ['-D', cluster, 'status'], { timeout: 30_000 })
        if (!/no server running/i.test(`${after.stdout}\n${after.stderr}`)) throw new Error('PostgreSQL stopped state could not be confirmed.')
        serverStarted = false
      } else if (startupReturned && /no server running/i.test(`${status.stdout}\n${status.stderr}`)) {
        serverStarted = false
      } else {
        retainRunRoot = true
        outcome = { status: 'BLOCKED', reason: `Run-owned PostgreSQL state uncertain; retained only its run root ${runRoot}.` }
      }
    } catch (error) {
      retainRunRoot = true
      outcome = { status: 'FAIL', reason: `Could not stop/verify run-owned PostgreSQL; retained ${runRoot}: ${redact(error instanceof Error ? error.message : error)}` }
    }
  }
  if (runRoot && !serverStarted && !retainRunRoot) await rm(runRoot, { recursive: true, force: true }).catch((error) => {
    outcome = { status: 'FAIL', reason: `Run-owned temporary cleanup failed at ${runRoot}: ${redact(error instanceof Error ? error.message : error)}` }
  })
}

if (outcome.status === 'PASS') console.log(JSON.stringify(outcome, null, 2))
else {
  if (retainRunRoot && runRoot && !outcome.reason?.includes(runRoot)) outcome.reason += `\nRun-owned evidence retained at ${runRoot}.`
  console.error(JSON.stringify(outcome, null, 2))
  process.exitCode = outcome.status === 'BLOCKED' ? 2 : 1
}
