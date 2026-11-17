import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { closeSync, openSync, readFileSync } from 'node:fs'
import { access, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve, win32 } from 'node:path'
import { createServer } from 'node:net'

class BlockedError extends Error {}

const root = resolve(import.meta.dirname, '..')
const cli = join(root, 'packages', 'cli', 'dist', 'src', 'index.js')
const npmCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
const secretValues = new Set()
let runRoot
let serverStarted = false
let startupAttemptReturned = false
let retainRunRoot = false
let probe
let probeConnections = 0
let child
let childTimer
let startupEvidence

function redact(value) {
  let result = String(value ?? '')
  for (const secret of secretValues) if (secret) result = result.replaceAll(secret, '[redacted]')
  return result
}

function environmentWith(overrides = {}) {
  const environment = { ...process.env }
  for (const key of Object.keys(environment)) {
    if (/^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSERVICE|PGSSLMODE|PGOPTIONS|PGAPPNAME|PGTARGETSESSIONATTRS|PGDATA)$/i.test(key)) delete environment[key]
  }
  delete environment.PG_E2E_DATABASE_URL
  if (runRoot) Object.assign(environment, {
    TEMP: join(runRoot, 'tmp'),
    TMP: join(runRoot, 'tmp'),
    npm_config_cache: join(runRoot, 'npm-cache'),
  })
  Object.assign(environment, overrides)
  return environment
}

function executeCaptured(program, args, options = {}) {
  return spawnSync(program, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? environmentWith(),
    encoding: 'utf8',
    input: options.input,
    windowsHide: true,
    timeout: options.timeout ?? 20 * 60 * 1000,
    maxBuffer: 60 * 1024 * 1024,
  })
}

function executeCapturedToFiles(program, args, options, fileOps = { openSync, closeSync }) {
  let stdoutFd
  let stderrFd
  let result
  try {
    stdoutFd = fileOps.openSync(options.stdoutPath, 'w')
    stderrFd = fileOps.openSync(options.stderrPath, 'w')
    result = spawnSync(program, args, {
      cwd: options.cwd ?? root,
      env: options.env ?? environmentWith(),
      windowsHide: true,
      timeout: options.timeout ?? 20 * 60 * 1000,
      maxBuffer: 60 * 1024 * 1024,
      stdio: ['ignore', stdoutFd, stderrFd],
    })
  } finally {
    try {
      if (stderrFd !== undefined) fileOps.closeSync(stderrFd)
    } finally {
      if (stdoutFd !== undefined) fileOps.closeSync(stdoutFd)
    }
  }
  return {
    ...result,
    stdout: redact(readFileSync(options.stdoutPath, 'utf8')),
    stderr: redact(readFileSync(options.stderrPath, 'utf8')),
  }
}

function testCapturedOutputCleanup() {
  const closed = []
  let openCount = 0
  assert.throws(() => executeCapturedToFiles('unused', [], { stdoutPath: 'stdout', stderrPath: 'stderr' }, {
    openSync() {
      if (openCount++ === 0) return 123
      throw new Error('expected stderr open failure')
    },
    closeSync(fd) { closed.push(fd) },
  }), /expected stderr open failure/)
  assert.deepEqual(closed, [123])
}

function execute(program, args, options = {}) {
  const result = executeCaptured(program, args, options)
  if (result.error) throw result.error
  return result
}

function processEvidence(result) {
  return {
    exitCode: result.status,
    signal: result.signal,
    pid: result.pid,
    error: result.error ? {
      name: result.error.name,
      code: result.error.code,
      message: redact(result.error.message),
    } : null,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr),
  }
}

async function saveStartupEvidence(fields) {
  startupEvidence = { ...startupEvidence, ...fields }
  await writeFile(join(runRoot, 'startup-evidence.json'), `${JSON.stringify(startupEvidence, null, 2)}\n`)
}

async function readStartupLog() {
  try { return redact(await readFile(join(runRoot, 'postgres.log'), 'utf8')) } catch { return null }
}

async function writableDirectoryCheck(directory) {
  const probePath = join(directory, `.phase-06b-write-check-${randomBytes(8).toString('hex')}`)
  try {
    await writeFile(probePath, 'phase-06b-write-check\n', { flag: 'wx' })
    assert.equal(await readFile(probePath, 'utf8'), 'phase-06b-write-check\n')
    await rm(probePath)
    return { path: directory, createReadDelete: 'pass' }
  } catch (error) {
    await rm(probePath, { force: true }).catch(() => {})
    return { path: directory, createReadDelete: 'fail', error: redact(error instanceof Error ? error.message : error) }
  }
}

function requireSuccess(result, label) {
  if (result.status !== 0 || result.signal) {
    throw new Error(`${label} failed (exit ${result.status ?? result.signal ?? 'unknown'}):\n${redact(result.stdout)}\n${redact(result.stderr)}`)
  }
  return result
}

async function findProgram(name) {
  const suffix = name.endsWith('.exe') ? name : `${name}.exe`
  const directories = [process.env.PG_BINDIR, ...(process.env.PATH ?? '').split(win32.delimiter)].filter(Boolean)
  for (const directory of directories) {
    const path = join(directory, suffix)
    try { await access(path); return path } catch { /* try next PATH entry */ }
  }
  throw new BlockedError(`${suffix} not found. Install/use PostgreSQL 16+ binaries or set PG_BINDIR; no service will be installed.`)
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
  return { address: '127.0.0.1', port, bindPreflight: 'pass', reservedServicePort5432: 'not selected' }
}

async function listenProbe() {
  probe = createServer((socket) => { probeConnections += 1; socket.destroy() })
  await new Promise((resolveListen, reject) => {
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', resolveListen)
  })
  const address = probe.address()
  assert.ok(address && typeof address === 'object')
  return `postgresql://probe:probe@127.0.0.1:${address.port}/probe_db`
}

function postgresCommand(executable, args, options = {}) {
  return execute(executable, args, { ...options, env: environmentWith(options.env) })
}

function psqlArgs(port, user, database, extra = []) {
  return ['--no-psqlrc', '--no-password', '--host', '127.0.0.1', '--port', String(port), '--username', user, '--dbname', database, '--set=ON_ERROR_STOP=1', ...extra]
}

function psql(executable, port, user, database, sql, options = {}) {
  const extra = ['--tuples-only', '--no-align', ...(sql === undefined ? [] : ['--command', sql])]
  const result = postgresCommand(executable, psqlArgs(port, user, database, extra), options)
  requireSuccess(result, 'psql query')
  return result.stdout.trim()
}

function selection(name, parentDirectory, database = 'postgresql') {
  return {
    schemaVersion: 1,
    project: { name, parentDirectory, type: 'backend' },
    backend: { adapterId: 'backend.express', manager: 'npm' },
    ...(database === false ? {} : { database: database === 'sqlite'
      ? { adapterId: 'database.sqlite', accessAdapterId: 'data-access.drizzle-sqlite', mode: 'embedded' }
      : { adapterId: 'database.postgresql', accessAdapterId: 'data-access.drizzle-postgresql', mode: 'existing-service' } }),
    documentation: 'standard',
    git: { initialize: false, initialCommit: false },
  }
}

function events(stdout) {
  return stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
}

function recordProbeConnectionCount() {
  assert.equal(probeConnections, 0, 'BE-08 generation/startup connected to DATABASE_URL probe')
}

async function stopProbe() {
  if (!probe) return
  await new Promise((resolveClose, reject) => probe.close((error) => error ? reject(error) : resolveClose()))
  probe = undefined
}

async function runCancelled(configPath, cliEnvironment) {
  child = spawn(process.execPath, [cli, 'generate', '--config', configPath, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts', '--desktop-control'], {
    cwd: root,
    env: cliEnvironment,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  let pending = ''
  let cancelSent = false
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
        childTimer = setTimeout(() => {
          if (child?.exitCode === null) child.stdin.end('{"schemaVersion":1,"kind":"cancel"}\n')
        }, 100)
      }
    }
  })
  child.stderr.on('data', (chunk) => { stderr += chunk })
  const watchdog = setTimeout(() => child?.kill(), 20 * 60 * 1000)
  let exit
  try {
    exit = await new Promise((resolveExit, reject) => {
      child.once('error', reject)
      child.once('close', (exitCode, signal) => resolveExit({ exitCode, signal }))
    })
  } finally {
    clearTimeout(watchdog)
    if (childTimer) clearTimeout(childTimer)
    childTimer = undefined
    child = undefined
  }
  assert.equal(cancelSent, true, `cancellation did not reach npm install: ${redact(stderr)}`)
  assert.equal(exit.exitCode, 5, `unexpected cancellation result ${JSON.stringify(exit)}: ${redact(stderr)}\n${redact(stdout)}`)
  assert.ok(events(stdout).some((event) => event.type === 'job-finished' && event.status === 'cancelled'), redact(stdout))
  assert.deepEqual((await readdir(join(runRoot, 'projects'))).filter((entry) => entry.startsWith('.project-generator-stage-')), [])
  await assert.rejects(access(join(runRoot, 'projects', 'cancel-be08')))
}

async function buildOwnedCluster(binaries, port, password) {
  const cluster = join(runRoot, 'postgres-data')
  await mkdir(cluster)
  retainRunRoot = true
  const directoryPermission = await writableDirectoryCheck(cluster)
  let portPreflight
  try {
    portPreflight = await verifyPortAvailable(port)
  } catch (error) {
    portPreflight = { address: '127.0.0.1', port, bindPreflight: 'fail', error: redact(error instanceof Error ? error.message : error) }
  }
  await saveStartupEvidence({
    stage: 'preflight',
    postgresVersion: execute(binaries.pg_ctl, ['--version']).stdout.trim(),
    binaries,
    dataDirectory: cluster,
    logFile: join(runRoot, 'postgres.log'),
    port: portPreflight,
    directoryPermission,
    initdbArguments: ['-D', cluster, '-U', 'e2e_admin', '--encoding', 'UTF8', '--no-locale', '--no-instructions', '--auth-local=trust', '--auth-host=trust'],
  })
  if (portPreflight.bindPreflight !== 'pass') throw new BlockedError(`Loopback PostgreSQL port preflight failed for 127.0.0.1:${port}: ${portPreflight.error}`)
  if (directoryPermission.createReadDelete !== 'pass') throw new BlockedError(`Run-owned PostgreSQL data-directory permission preflight failed: ${directoryPermission.error}`)

  const initdbArgs = [
    '-D', cluster,
    '-U', 'e2e_admin',
    '--encoding', 'UTF8',
    '--no-locale',
    '--no-instructions',
    '--auth-local=trust',
    '--auth-host=trust',
  ]
  const initialized = executeCaptured(binaries.initdb, initdbArgs, { env: environmentWith() })
  await saveStartupEvidence({ initdb: processEvidence(initialized) })
  if (initialized.error || initialized.status !== 0) throw new BlockedError(`Could not initialize run-owned PostgreSQL 16+ cluster (exit ${initialized.status ?? initialized.error?.code ?? 'unknown'}):\n${redact(initialized.stdout)}\n${redact(initialized.stderr)}`)
  serverStarted = true
  const logFile = join(runRoot, 'postgres.log')
  await writeFile(logFile, '', { flag: 'wx' })
  const configFile = join(cluster, 'postgresql.conf')
  const configLines = (await readFile(configFile, 'utf8')).split(/\r?\n/)
    .filter((line) => /^\s*(?:include|include_if_exists|include_dir|listen_addresses|port|hba_file|ident_file|data_directory|logging_collector|log_destination|log_directory|log_filename)\s*=/i.test(line))
  const startArgs = [
    '-D', cluster,
    '-l', logFile,
    '-o', `-h 127.0.0.1 -p ${port} -c listen_addresses=127.0.0.1`,
    '-w', '-t', '30', 'start',
  ]
  const stdoutPath = join(runRoot, 'pg_ctl.stdout.log')
  const stderrPath = join(runRoot, 'pg_ctl.stderr.log')
  await saveStartupEvidence({
    stage: 'pg_ctl-starting',
    startupCommand: { executable: binaries.pg_ctl, args: startArgs, timeoutMs: 90_000, pgCtlWaitSeconds: 30, stdoutPath, stderrPath, stdio: 'run-owned files; no pipes' },
    postgresqlConfig: {
      file: configFile,
      activeRelevantLines: configLines,
      host: '127.0.0.1 (pg_ctl -o -h and listen_addresses override)',
      port,
      hostAuthentication: 'trust (run-owned disposable cluster only)',
    },
  })
  const startedAt = new Date().toISOString()
  const started = executeCapturedToFiles(binaries.pg_ctl, startArgs, { env: environmentWith(), timeout: 90_000, stdoutPath, stderrPath })
  startupAttemptReturned = !started.error
  await saveStartupEvidence({
    stage: started.error || started.status !== 0 ? 'pg_ctl-start-failed' : 'pg_ctl-start-returned',
    startupAttempt: { startedAt, finishedAt: new Date().toISOString(), ...processEvidence(started) },
    postgresLog: await readStartupLog(),
  })
  if (started.error || started.status !== 0) {
    retainRunRoot = true
    throw new BlockedError(`Could not start run-owned PostgreSQL on 127.0.0.1:${port}; pg_ctl exit ${started.status ?? 'unknown'}, wait error ${started.error?.code ?? 'none'}; retaining cluster files until state is verified:\n${redact(started.stdout)}\n${redact(started.stderr)}\nStartup log: ${await readStartupLog() ?? '[not created]'}`)
  }
  const clusterStatus = executeCaptured(binaries.pg_ctl, ['-D', cluster, 'status'], { timeout: 30_000 })
  await saveStartupEvidence({ clusterStatus: processEvidence(clusterStatus), postgresLog: await readStartupLog() })
  if (clusterStatus.error || clusterStatus.status !== 0) {
    retainRunRoot = true
    throw new BlockedError(`Run-owned PostgreSQL status could not be verified before connection; retaining cluster files:\n${redact(clusterStatus.stdout)}\n${redact(clusterStatus.stderr)}\nStartup log: ${await readStartupLog() ?? '[not created]'}`)
  }

  const identity = psql(binaries.psql, port, 'e2e_admin', 'postgres', "SELECT current_database() || '|' || current_user || '|' || host(inet_server_addr()) || '|' || inet_server_port() || '|' || current_setting('data_directory')")
  const [database, user, address, serverPort, dataDirectory] = identity.split('|')
  const expectedDirectory = win32.resolve(cluster).replace(/[\\/]+$/, '').toLowerCase()
  const actualDirectory = win32.resolve(dataDirectory ?? '').replace(/[\\/]+$/, '').toLowerCase()
  const identityMatches = database === 'postgres' && user === 'e2e_admin' && address === '127.0.0.1' && Number(serverPort) === port && actualDirectory === expectedDirectory
  await saveStartupEvidence({ identityCheck: {
    raw: identity,
    actual: { database, user, address, serverPort, dataDirectory, normalizedDataDirectory: actualDirectory },
    expected: { database: 'postgres', user: 'e2e_admin', address: '127.0.0.1', port, normalizedDataDirectory: expectedDirectory },
    matches: identityMatches,
  } })
  if (!identityMatches) throw new BlockedError(`PostgreSQL identity did not match run-owned loopback cluster; no test database was used. ${JSON.stringify({ database, user, address, serverPort, dataDirectory, actualDirectory, expectedDirectory })}`)

  const setup = psql(binaries.psql, port, 'e2e_admin', 'postgres', undefined, {
    input: `CREATE ROLE e2e_app LOGIN PASSWORD '${password}';\nCREATE DATABASE pg_e2e_app OWNER e2e_app;\nCREATE DATABASE pg_e2e_other OWNER e2e_app;\nCREATE DATABASE pg_e2e_rollback OWNER e2e_app;\n`,
  })
  void setup
  retainRunRoot = false
  for (const name of ['pg_e2e_app', 'pg_e2e_other', 'pg_e2e_rollback']) {
    const owner = psql(binaries.psql, port, 'e2e_admin', 'postgres', `SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname = '${name}'`)
    assert.equal(owner, 'e2e_app')
  }
  return cluster
}

function npmRun(args, cwd, env, timeout = 10 * 60 * 1000) {
  return execute(process.execPath, [npmCli, ...args], { cwd, env, timeout, maxBuffer: 40 * 1024 * 1024 })
}

async function runAcceptance() {
  if (process.argv[2] === '--test-capture-cleanup') {
    testCapturedOutputCleanup()
    console.log('Phase 06B capture cleanup regression passed.')
    return
  }
  if (process.platform !== 'win32') throw new BlockedError('Phase 06B PostgreSQL runtime E2E requires Windows; no service or cluster was created.')
  const version = process.versions.node.split('.').map(Number)
  if (version[0] < 22 || (version[0] === 22 && version[1] < 13)) throw new BlockedError('Node.js 22.13+ is required for Phase 06B runtime E2E.')
  for (const path of [cli, npmCli, tempBase]) await access(path)
  if (!(await stat(tempBase)).isDirectory()) throw new BlockedError('Approved OpenCode temp path is not a directory.')
  const binaries = {
    initdb: await findProgram('initdb'),
    pg_ctl: await findProgram('pg_ctl'),
    psql: await findProgram('psql'),
  }
  const pgVersion = execute(binaries.pg_ctl, ['--version']).stdout
  const major = Number(pgVersion.match(/\b(\d+)\./)?.[1])
  if (!Number.isInteger(major) || major < 16) throw new BlockedError(`PostgreSQL 16+ binaries required; found ${redact(pgVersion.trim())}.`)

  runRoot = await mkdtemp(join(tempBase, 'phase-06b-postgres-e2e-'))
  await mkdir(join(runRoot, 'tmp'))
  const parent = join(runRoot, 'projects')
  await mkdir(parent)
  const password = randomBytes(24).toString('base64url')
  secretValues.add(password)
  const port = await allocatePort()
  try {
    await buildOwnedCluster(binaries, port, password)
  } catch (error) {
    if (error instanceof BlockedError) throw error
    throw new BlockedError(`Run-owned PostgreSQL cluster setup failed:\n${redact(error instanceof Error ? error.message : error)}`)
  }

  const trapUrl = await listenProbe()
  secretValues.add(trapUrl)
  const appUrl = `postgresql://e2e_app:${password}@127.0.0.1:${port}/pg_e2e_app`
  secretValues.add(appUrl)
  const cliEnvironment = environmentWith({
    NODE_ENV: 'development',
    PG_BUILD_PROFILE: 'development',
    PG_ALLOW_PLANNED_RECIPE_GENERATION: 'true',
    DATABASE_URL: trapUrl,
  })
  const config = join(runRoot, 'BE-08.json')
  const selectionData = selection('be08-api', parent)
  await writeFile(config, JSON.stringify(selectionData, null, 2))

  const catalog = requireSuccess(execute(process.execPath, [cli, 'catalog', '--json'], { env: cliEnvironment }), 'catalog')
  const catalogData = JSON.parse(catalog.stdout).data
  assert.equal(catalogData.recipes.find(({ id }) => id === 'BE-08')?.status, 'planned')
  assert.equal(catalogData.recipes.find(({ id }) => id === 'BE-01')?.database, undefined)
  assert.equal(catalogData.recipes.find(({ id }) => id === 'BE-07')?.database, 'database.sqlite')
  assert.ok(catalogData.databaseAdapters.some(({ id }) => id === 'database.postgresql'))

  const be01Config = join(runRoot, 'BE-01.json')
  await writeFile(be01Config, JSON.stringify(selection('be01-regression', parent, false), null, 2))
  const be01Plan = requireSuccess(execute(process.execPath, [cli, 'plan', '--config', be01Config, '--json'], { env: cliEnvironment }), 'BE-01 regression plan')
  const be01PlanData = JSON.parse(be01Plan.stdout).data
  assert.equal(be01PlanData.recipeId, 'BE-01')
  assert.ok(!be01PlanData.expectedWrites.includes('src/db/schema.ts'))
  assert.ok(!be01PlanData.expectedWrites.includes('src/db/target.ts'))

  const be07Config = join(runRoot, 'BE-07.json')
  await writeFile(be07Config, JSON.stringify(selection('be07-regression', parent, 'sqlite'), null, 2))
  const be07Plan = requireSuccess(execute(process.execPath, [cli, 'plan', '--config', be07Config, '--json'], { env: cliEnvironment }), 'BE-07 regression plan')
  const be07PlanData = JSON.parse(be07Plan.stdout).data
  assert.equal(be07PlanData.recipeId, 'BE-07')
  assert.ok(be07PlanData.expectedWrites.includes('native/pg-db-path-verifier.exe'))
  assert.ok(be07PlanData.expectedWrites.includes('src/db/path.ts'))
  assert.ok(!be07PlanData.expectedWrites.includes('src/db/target.ts'))

  const plan = requireSuccess(execute(process.execPath, [cli, 'plan', '--config', config, '--json'], { env: cliEnvironment }), 'BE-08 plan')
  const planData = JSON.parse(plan.stdout).data
  assert.equal(planData.recipeId, 'BE-08')
  assert.equal(planData.recipeStatus, 'planned')
  assert.equal(planData.executionAvailable, false)
  assert.equal(new Set(planData.expectedWrites).size, planData.expectedWrites.length)
  assert.ok(planData.expectedWrites.includes('src/db/migrate.ts'))
  assert.ok(planData.expectedWrites.includes('docs/DATABASE-SAFETY.md'))

  const doctor = requireSuccess(execute(process.execPath, [cli, 'doctor', '--config', config, '--json'], { env: cliEnvironment }), 'BE-08 Doctor')
  assert.equal(JSON.parse(doctor.stdout).data.ready, true)
  recordProbeConnectionCount()

  const generated = execute(process.execPath, [cli, 'generate', '--config', config, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts'], {
    env: cliEnvironment,
    timeout: 30 * 60 * 1000,
  })
  requireSuccess(generated, 'BE-08 generation')
  const outputEvents = events(generated.stdout)
  assert.ok(outputEvents.some((event) => event.type === 'job-finished' && event.status === 'completed'), redact(generated.stdout))
  recordProbeConnectionCount()

  const projectPath = join(parent, 'be08-api')
  const manifest = JSON.parse(await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8'))
  assert.equal(manifest.recipeId, 'BE-08')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.deepEqual(manifest.selectedAdapters.map(({ id }) => id), ['backend.express', 'database.postgresql', 'data-access.drizzle-postgresql'])
  for (const id of ['dependency-install', 'dependency-integrity', 'lockfile-integrity', 'migration-generation', 'typecheck', 'lint', 'unit-tests', 'database-safety-tests', 'build', 'http-smoke', 'graceful-shutdown']) {
    assert.equal(manifest.validation.find((item) => item.id === id)?.status, 'pass', id)
  }
  const packageJson = JSON.parse(await readFile(join(projectPath, 'package.json'), 'utf8'))
  assert.equal(packageJson.engines.node, '>=22.13.0')
  assert.equal(packageJson.dependencies['drizzle-orm'], '0.45.4')
  assert.equal(packageJson.dependencies.pg, '8.23.1')
  assert.equal(packageJson.devDependencies['drizzle-kit'], '0.31.11')
  assert.equal(packageJson.devDependencies['@types/pg'], '8.23.1')
  const lock = JSON.parse(await readFile(join(projectPath, 'package-lock.json'), 'utf8'))
  for (const dependency of catalogData.recipes.find(({ id }) => id === 'BE-08').dependencies) {
    const entry = lock.packages[`node_modules/${dependency.packageName}`]
    assert.equal(entry.version, dependency.version, dependency.packageName)
    assert.equal(entry.integrity, dependency.integrity, dependency.packageName)
  }
  for (const file of ['README.md', 'docs/SETUP.md', 'docs/DATABASE-SAFETY.md', 'docs/ARCHITECTURE.md', 'docs/TESTING.md', 'src/db/target.ts', 'src/db/migrate.ts', 'src/routes/items.ts', 'test/database.test.ts', 'drizzle/meta/_journal.json']) await access(join(projectPath, file))
  const migration = (await readdir(join(projectPath, 'drizzle'))).find((file) => /^\d{4}_.+\.sql$/.test(file))
  assert.ok(migration)
  assert.match(await readFile(join(projectPath, 'drizzle', migration), 'utf8'), /CREATE TABLE "items"/i)
  const readme = await readFile(join(projectPath, 'README.md'), 'utf8')
  assert.match(readme, /PostgreSQL 16\+/)
  assert.match(readme, /--target host:port\/database/)
  assert.match(readme, /planned starter/)
  assert.equal(await psql(binaries.psql, port, 'e2e_app', 'pg_e2e_app', "SELECT COALESCE(to_regclass('public.items')::text, '')"), '')
  recordProbeConnectionCount()

  const mismatch = npmRun(['run', 'db:migrate', '--', '--target', `127.0.0.1:${port}/pg_e2e_other`], projectPath, environmentWith({ DATABASE_URL: appUrl }))
  assert.notEqual(mismatch.status, 0, 'migration target mismatch must fail')
  assert.match(redact(mismatch.stderr), /does not match/)
  assert.equal(await psql(binaries.psql, port, 'e2e_app', 'pg_e2e_other', "SELECT COALESCE(to_regclass('public.items')::text, '')"), '')

  const migrationRun = npmRun(['run', 'db:migrate', '--', '--target', `127.0.0.1:${port}/pg_e2e_app`], projectPath, environmentWith({ DATABASE_URL: appUrl }))
  requireSuccess(migrationRun, 'guarded PostgreSQL migration')
  assert.equal(await psql(binaries.psql, port, 'e2e_app', 'pg_e2e_app', "SELECT to_regclass('public.items')::text"), 'items')

  const e2eEnvironment = environmentWith({ DATABASE_URL: appUrl, PG_E2E_DATABASE_URL: appUrl })
  const generatedTests = npmRun(['test'], projectPath, e2eEnvironment)
  requireSuccess(generatedTests, 'BE-08 generated tests against owned PostgreSQL')
  assert.match(generatedTests.stdout, /# pass [1-9]/)
  assert.match(generatedTests.stdout, /# fail 0/)

  const rollbackSeed = psql(binaries.psql, port, 'e2e_app', 'pg_e2e_rollback', 'CREATE TABLE items (id integer PRIMARY KEY)')
  void rollbackSeed
  const rollbackUrl = `postgresql://e2e_app:${password}@127.0.0.1:${port}/pg_e2e_rollback`
  const rollback = npmRun(['run', 'db:migrate', '--', '--target', `127.0.0.1:${port}/pg_e2e_rollback`], projectPath, environmentWith({ DATABASE_URL: rollbackUrl }))
  assert.notEqual(rollback.status, 0, 'conflicting migration must fail')
  assert.equal(await psql(binaries.psql, port, 'e2e_app', 'pg_e2e_rollback', "SELECT string_agg(column_name, ',' ORDER BY ordinal_position) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'items'"), 'id')

  const cancelConfig = join(runRoot, 'cancel.json')
  await writeFile(cancelConfig, JSON.stringify(selection('cancel-be08', parent), null, 2))
  await runCancelled(cancelConfig, cliEnvironment)
  recordProbeConnectionCount()

  const collisionPath = join(parent, 'collision-be08')
  await mkdir(collisionPath)
  const sentinel = join(collisionPath, 'keep.txt')
  await writeFile(sentinel, 'preserve\n')
  const collisionConfig = join(runRoot, 'collision.json')
  await writeFile(collisionConfig, JSON.stringify(selection('collision-be08', parent), null, 2))
  const collision = execute(process.execPath, [cli, 'generate', '--config', collisionConfig, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts'], { env: cliEnvironment })
  assert.equal(collision.status, 6, `${redact(collision.stderr)}\n${redact(collision.stdout)}`)
  assert.ok(events(collision.stdout).some((event) => event.code === 'GEN_PATH_EXISTS'))
  assert.equal(await readFile(sentinel, 'utf8'), 'preserve\n')
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])
  recordProbeConnectionCount()

  await stopProbe()
  acceptanceReport = {
    phase: '06B',
    flow: 'Windows CLI + run-owned PostgreSQL cluster',
    host: `${process.platform}-${process.arch}`,
    node: process.version,
    postgres: pgVersion.trim(),
    recipe: 'BE-08',
    recipeStatus: manifest.recipeStatusAtCreation,
    generation: 'exact pins/lock integrity, migration SQL generation, typecheck/lint/tests/build, DB-free health smoke; trap observed zero connection',
    migration: 'URL/target mismatch blocked before connection; confirmed migration applied only to run-owned database',
    runtime: 'CRUD, invalid requests, unavailable DB sanitization, and shutdown passed against run-owned loopback PostgreSQL',
    rollback: 'conflicting migration failed; pre-existing table schema remained unchanged',
    cancellation: 'cancelled during npm install; owned stage removed',
    collision: 'existing sentinel preserved; no stage left',
    be01Be07Regression: 'BE-01 plan remains database-free; BE-07 plan remains SQLite/Drizzle with its native path verifier',
    releaseApproved: false,
  }
}

let outcome
let acceptanceReport
try {
  await runAcceptance()
  outcome = { status: 'PASS' }
} catch (error) {
  outcome = {
    status: error instanceof BlockedError ? 'BLOCKED' : 'FAIL',
    reason: redact(error instanceof Error ? error.message : error),
  }
  if (runRoot && serverStarted) retainRunRoot = true
} finally {
  if (child && child.exitCode === null) child.kill()
  if (childTimer) clearTimeout(childTimer)
  if (probe) await stopProbe().catch(() => {})
  if (serverStarted) {
    try {
      const pgCtl = await findProgram('pg_ctl')
      const cluster = join(runRoot, 'postgres-data')
      const status = executeCaptured(pgCtl, ['-D', cluster, 'status'], { timeout: 30_000 })
      await saveStartupEvidence({ finalStatus: processEvidence(status), postgresLogBeforeCleanup: await readStartupLog() })
      const reportsNoServer = !status.error && /no server running/i.test(`${status.stdout}\n${status.stderr}`)
      if (!status.error && status.status === 0) {
        const stopped = executeCaptured(pgCtl, ['-D', cluster, '-m', 'fast', '-w', '-t', '30', 'stop'], { timeout: 45_000 })
        await saveStartupEvidence({ stop: processEvidence(stopped) })
        if (stopped.error || stopped.status !== 0) throw new Error(`pg_ctl stop failed: ${stopped.error?.message ?? stopped.stderr}`)
        const afterStop = executeCaptured(pgCtl, ['-D', cluster, 'status'], { timeout: 30_000 })
        await saveStartupEvidence({ statusAfterStop: processEvidence(afterStop), postgresLog: await readStartupLog() })
        if (afterStop.error || afterStop.status === 0 || !/no server running/i.test(`${afterStop.stdout}\n${afterStop.stderr}`)) throw new Error('PostgreSQL server state after stop could not be confirmed.')
        serverStarted = false
      } else if (reportsNoServer && startupAttemptReturned) {
        serverStarted = false
      } else if (!reportsNoServer) {
        throw new Error(`pg_ctl status could not verify run-owned cluster: ${status.error?.message ?? status.stderr ?? status.stdout}`)
      } else {
        retainRunRoot = true
        outcome = { status: 'BLOCKED', reason: `PostgreSQL startup state is uncertain; retained run-owned files at ${runRoot}. No external database was contacted.` }
      }
    } catch (error) {
      retainRunRoot = true
      outcome = { status: 'FAIL', reason: `Could not stop or verify run-owned PostgreSQL cluster; retained files at ${runRoot}: ${redact(error instanceof Error ? error.message : error)}` }
    }
  }
  if (runRoot && !serverStarted && !retainRunRoot) await rm(runRoot, { recursive: true, force: true }).catch((error) => {
    outcome = { status: 'FAIL', reason: `Run-owned temporary cleanup failed at ${runRoot}: ${redact(error instanceof Error ? error.message : error)}` }
  })
}

if (outcome.status === 'PASS' && acceptanceReport) {
  acceptanceReport.clusterStartup = {
    port: startupEvidence?.port,
    directoryPermission: startupEvidence?.directoryPermission,
    pgCtlStart: startupEvidence?.startupAttempt,
    clusterStatus: startupEvidence?.clusterStatus,
    startupLog: startupEvidence?.postgresLogBeforeCleanup ?? startupEvidence?.postgresLog,
    stop: startupEvidence?.stop,
    statusAfterStop: startupEvidence?.statusAfterStop,
  }
  console.log(JSON.stringify(acceptanceReport, null, 2))
}

if (outcome.status !== 'PASS') {
  if (retainRunRoot && runRoot && !outcome.reason.includes(runRoot)) outcome.reason += `\nRun-owned evidence retained at ${runRoot}.`
  console.error(JSON.stringify(outcome, null, 2))
  process.exitCode = outcome.status === 'BLOCKED' ? 2 : 1
}
