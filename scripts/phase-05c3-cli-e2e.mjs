import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, lstat, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'

if (process.platform !== 'win32') throw new Error('Phase 05C.3 CLI acceptance requires Windows.')

const local = process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local')
const tempBase = join(local, 'Temp', 'opencode')
await access(tempBase)
assert.ok((await stat(tempBase)).isDirectory())

const root = join(import.meta.dirname, '..')
const cli = join(root, 'packages', 'cli', 'dist', 'src', 'index.js')
const parent = await mkdtemp(join(tempBase, 'phase-05c3-laravel-cli-20261115 spaces-雪-'))
const name = 'ff-be05-laravel-cli'
const target = join(parent, name)
const config = join(parent, 'selection.json')
const selection = {
  schemaVersion: 1,
  project: { name, parentDirectory: parent, type: 'backend' },
  backend: { adapterId: 'backend.laravel', manager: 'composer' },
  documentation: 'standard',
  git: { initialize: false, initialCommit: false },
}
await writeFile(config, JSON.stringify(selection, null, 2))

function cliRun(args, timeout = 60_000) {
  const result = spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout,
    maxBuffer: 32 * 1024 * 1024,
  })
  assert.ifError(result.error)
  return result
}

function jsonResult(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout)
  const envelope = JSON.parse(result.stdout)
  assert.equal(envelope.ok, true, JSON.stringify(envelope.error))
  return envelope.data
}

let success = false
try {
  const plan = jsonResult(cliRun(['plan', '--config', config, '--json']))
  assert.equal(plan.recipeId, 'BE-05')
  assert.equal(plan.recipeStatus, 'planned')
  assert.equal(plan.executionAvailable, false)
  assert.equal(plan.executesDependencyLifecycleScripts, false)
  assert.equal(plan.requiresDependencyConsent, true)
  assert.ok(plan.networkAccess.includes('https://repo.packagist.org/'))
  assert.ok(plan.expectedWrites.includes('composer.lock'))
  assert.ok(!plan.expectedWrites.includes('.env'))

  const doctor = jsonResult(cliRun(['doctor', '--config', config, '--json']))
  assert.equal(doctor.ready, true, JSON.stringify(doctor.tools))
  const php = doctor.tools.find(({ id }) => id === 'php')
  const composer = doctor.tools.find(({ id }) => id === 'composer')
  assert.equal(php?.available, true)
  assert.match(php?.version ?? '', /^8\.\d+\.\d+$/)
  assert.equal(composer?.available, true)
  assert.match(composer?.version ?? '', /^2\./)

  const generation = cliRun([
    'generate', '--config', config, '--jsonl', '--development-allow-planned', '--allow-dependency-scripts',
  ], 40 * 60 * 1000)
  assert.equal(generation.status, 0, `${generation.stderr}\n${generation.stdout}`)
  const events = generation.stdout.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  assert.equal(events.findLast(({ type }) => type === 'job-finished')?.status, 'completed')
  const manifestPath = join(target, '.project-generator', 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.recipeId, 'BE-05')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.projectType, 'backend')
  assert.equal(manifest.packageManager, 'composer')
  assert.deepEqual(manifest.toolVersions, {
    php: php.version,
    composer: composer.version,
    laravel: '12.72.0',
    phpunit: manifest.toolVersions.phpunit,
  })
  assert.match(manifest.toolVersions.phpunit, /^11\./)

  const composerJson = JSON.parse(await readFile(join(target, 'composer.json'), 'utf8'))
  assert.equal(composerJson.name, `forma/${name}`)
  assert.equal(composerJson.require['laravel/framework'], '12.72.0')
  assert.equal(composerJson.require['ext-pdo_mysql'], '*')
  assert.equal(composerJson.scripts, undefined)
  assert.equal(composerJson.config['allow-plugins'], false)
  assert.equal(composerJson['require-dev']['laravel/sail'], undefined)
  const lockBytes = await readFile(join(target, 'composer.lock'))
  const lockHash = createHash('sha256').update(lockBytes).digest('hex')
  assert.equal(manifest.lockfiles.length, 1)
  assert.equal(manifest.lockfiles[0].name, 'composer.lock')
  assert.equal(manifest.lockfiles[0].sha256, lockHash)
  const lock = JSON.parse(lockBytes.toString('utf8'))
  assert.equal(lock.packages.find(({ name: packageName }) => packageName === 'laravel/framework')?.version.replace(/^v/, ''), '12.72.0')
  assert.equal(lock['packages-dev'].find(({ name: packageName }) => packageName === 'phpunit/phpunit')?.version.replace(/^v/, ''), manifest.toolVersions.phpunit)
  assert.ok(await lstat(join(target, 'vendor', 'autoload.php')))

  const files = await readdir(target)
  for (const forbidden of [
    '.env', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml',
    'bun.lock', 'bun.lockb', 'uv.lock', 'vite.config.js', 'routes/web.php',
  ]) assert.ok(!files.includes(forbidden), `Unexpected generated file: ${forbidden}`)
  assert.ok(!files.includes('resources'), 'Laravel frontend source directory must be excluded.')
  assert.ok(!files.includes('node_modules'))
  assert.ok(files.includes('.env.example'))
  const gitignore = await readFile(join(target, '.gitignore'), 'utf8')
  assert.match(gitignore, /^\/\.env\s*$/m)
  assert.match(gitignore, /^\/\.env\.\*\s*$/m)
  assert.match(gitignore, /^!\/\.env\.example\s*$/m)
  assert.match(await readFile(join(target, 'config/database.php'), 'utf8'), /env\('DB_CONNECTION', 'mysql'\)/)
  assert.match(await readFile(join(target, 'config/filesystems.php'), 'utf8'), /'local'[\s\S]*?'serve'\s*=>\s*false/)
  assert.ok(await lstat(join(target, 'app', 'Models', 'ProjectNote.php')))
  const migrations = await readdir(join(target, 'database', 'migrations'))
  assert.deepEqual(migrations, ['2026_11_15_000000_create_project_notes_table.php'])
  assert.ok(await lstat(join(target, 'tests', 'Feature', 'ApiTest.php')))
  await access(join(target, 'docs', 'SETUP.md'))

  const requiredChecks = [
    'laravel-scaffold', 'composer-lock', 'composer-install', 'php-lint-bootstrap', 'php-lint-database', 'php-lint-filesystems',
    'php-lint-routes', 'php-lint-model', 'php-lint-migration', 'php-lint-tests', 'artisan-version',
    'artisan-route-list', 'phpunit', 'lockfile-integrity', 'http-smoke',
  ]
  for (const id of requiredChecks) assert.equal(manifest.validation.find((item) => item.id === id)?.status, 'pass', id)
  assert.ok((await readFile(join(target, 'routes', 'api.php'), 'utf8')).includes("Route::post('/notes'"))
  assert.ok((await readFile(join(target, 'tests', 'Feature', 'ApiTest.php'), 'utf8')).includes('assertJsonValidationErrors'))
  assert.ok((await readFile(join(target, 'README.md'), 'utf8')).includes('does not install PHP/Composer, create `.env`'))

  success = true
  console.log(JSON.stringify({
    phase: '05C.3',
    flow: 'Windows CLI plan + Doctor + consented Laravel generation',
    host: `${process.platform}-${process.arch}`,
    php: php.version,
    composer: composer.version,
    laravel: manifest.toolVersions.laravel,
    phpunit: manifest.toolVersions.phpunit,
    recipeStatus: manifest.recipeStatusAtCreation,
    lockSha256: lockHash,
    validations: manifest.validation.map(({ id, status }) => ({ id, status })),
    forbiddenFrontendAndSecrets: 'no .env, npm/Vite assets, frontend, auth, or unexpected database migrations',
    mysqlIntegration: 'BLOCKED: no approved isolated MySQL database; no database connection or migration attempted',
    releaseApproved: false,
  }, null, 2))
} finally {
  if (success) await rm(parent, { recursive: true, force: true })
  else console.error(`Incomplete Phase 05C.3 CLI artifacts retained for diagnosis: ${parent}`)
}
