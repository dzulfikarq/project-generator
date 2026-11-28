import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, copyFileSync, existsSync, lstatSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { spawnSync, spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { withNodeOnPath } from './node-path.mjs'

const root = resolve(import.meta.dirname, '..')
const desktop = join(root, 'packages', 'desktop')
const tauriDir = join(desktop, 'src-tauri')
const mode = process.argv[3]
const action = process.argv[2]
const version = process.argv[4] ?? '0.1.0'
const testResourceRoot = process.env.PG_NATIVE_ACCEPTANCE_RESOURCE_ROOT
  ? resolve(process.env.PG_NATIVE_ACCEPTANCE_RESOURCE_ROOT)
  : undefined
const testSupervisor = process.env.PG_NATIVE_ACCEPTANCE_SUPERVISOR_BINARY
  ? resolve(process.env.PG_NATIVE_ACCEPTANCE_SUPERVISOR_BINARY)
  : undefined
const resources = testResourceRoot ?? join(tauriDir, 'resources', 'pg-runtime')
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')

if (!['system', 'bundled'].includes(mode)) throw new Error('Pass runtime mode: system or bundled.')
if (!['dev', 'build'].includes(action)) throw new Error('Pass action: dev or build.')
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Pass a semantic version such as 0.1.0.')
if (Boolean(testResourceRoot) !== Boolean(testSupervisor) || (testResourceRoot && action !== 'dev')) {
  throw new Error('Native acceptance resource overrides require a paired supervisor binary and dev action.')
}
if (testSupervisor && !existsSync(testSupervisor)) throw new Error('Test-owned native acceptance supervisor binary is missing.')

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: root, stdio: 'inherit', windowsHide: true, ...options })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${program} failed with exit code ${result.status}.`)
}

function runNpm(args, options = {}) {
  const env = withNodeOnPath({ ...process.env, ...options.env }, process.execPath)
  run(process.execPath, [npmCli, ...args], { ...options, env })
}

function copyJavaScriptTree(source, destination) {
  mkdirSync(destination, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(destination, entry.name)
    if (entry.isDirectory()) copyJavaScriptTree(from, to)
    else if (entry.isFile() && entry.name.endsWith('.js')) copyFileSync(from, to)
  }
}

function prepareResources() {
  if (testResourceRoot) {
    if (existsSync(resources) && (!lstatSync(resources).isDirectory() || readdirSync(resources).length > 0)) {
      throw new Error('Native acceptance resource root must be an empty, non-symlink directory.')
    }
  } else {
    // ponytail: rebuild only generated children so the tracked resource placeholder remains intact.
    for (const name of ['cli', 'runtime', 'catalog.json', 'runtime-manifest.json']) {
      rmSync(join(resources, name), { recursive: true, force: true })
    }
  }
  mkdirSync(resources, { recursive: true })
  const cliDist = join(root, 'packages', 'cli', 'dist', 'src')
  const coreDist = join(root, 'packages', 'core', 'dist', 'src')
  const corePackage = join(root, 'packages', 'core', 'package.json')
  const supervisor = testSupervisor ?? join(root, 'packages', 'core', 'native', 'pg-windows-supervisor.exe')
  const pathVerifier = join(root, 'packages', 'core', 'native', 'pg-db-path-verifier.exe')
  if (![cliDist, coreDist, supervisor, pathVerifier].every(existsSync)) throw new Error('Build CLI, core, Windows supervisor, and BE-07 path verifier before staging desktop resources.')

  const appDir = join(resources, 'cli')
  const coreTarget = join(appDir, 'node_modules', '@project-generator', 'core')
  copyJavaScriptTree(cliDist, join(appDir, 'dist', 'src'))
  writeFileSync(join(appDir, 'package.json'), JSON.stringify({ name: '@project-generator/cli', private: true, type: 'module' }))
  copyJavaScriptTree(coreDist, join(coreTarget, 'dist', 'src'))
  writeFileSync(join(coreTarget, 'package.json'), JSON.stringify(JSON.parse(readFileSync(corePackage, 'utf8'))))
  mkdirSync(join(coreTarget, 'native'), { recursive: true })
  copyFileSync(supervisor, join(coreTarget, 'native', 'pg-windows-supervisor.exe'))
  copyFileSync(pathVerifier, join(coreTarget, 'native', 'pg-db-path-verifier.exe'))

  const catalogRun = spawnSync(process.execPath, [join(cliDist, 'index.js'), 'catalog', '--json'], {
    cwd: root, encoding: 'utf8', windowsHide: true,
  })
  if (catalogRun.status !== 0 || !catalogRun.stdout) throw new Error('Could not generate the packaged recipe catalog.')
  const catalog = JSON.parse(catalogRun.stdout)
  if (catalog.schemaVersion !== 1 || catalog.ok !== true) throw new Error('CLI catalog schema is unsupported.')
  writeFileSync(join(resources, 'catalog.json'), catalogRun.stdout)

  if (mode === 'bundled') {
    const runtime = join(resources, 'runtime')
    const nodeRoot = dirname(process.execPath)
    const npmSource = join(nodeRoot, 'node_modules', 'npm')
    const npmPackage = JSON.parse(readFileSync(join(npmSource, 'package.json'), 'utf8'))
    if (npmPackage.name !== 'npm' || !existsSync(join(npmSource, 'bin', 'npm-cli.js'))) {
      throw new Error('Matching npm JavaScript CLI was not found beside the build Node runtime.')
    }
    mkdirSync(join(runtime, 'node_modules'), { recursive: true })
    copyFileSync(process.execPath, join(runtime, 'node.exe'))
    cpSync(npmSource, join(runtime, 'node_modules', 'npm'), { recursive: true })
    writeFileSync(join(resources, 'runtime-manifest.json'), JSON.stringify({ schemaVersion: 1, mode, nodeVersion: process.version, npmVersion: npmPackage.version }, null, 2))
  } else {
    writeFileSync(join(resources, 'runtime-manifest.json'), JSON.stringify({ schemaVersion: 1, mode }, null, 2))
  }
}

function stagePortableNsis() {
  const source = process.env.PG_NSIS_DIR
  if (!source || !existsSync(join(source, 'makensis.exe'))) {
    throw new Error('Set PG_NSIS_DIR to the approved portable NSIS 3.13 folder; no installer tool is installed or downloaded automatically.')
  }
  const requiredPlugin = join(source, 'Plugins', 'x86-unicode', 'additional', 'nsis_tauri_utils.dll')
  if (!existsSync(requiredPlugin)) throw new Error('Portable NSIS folder lacks Tauri’s verified nsis_tauri_utils.dll plugin.')
  const sha1 = (path) => createHash('sha1').update(readFileSync(path)).digest('hex').toUpperCase()
  if (sha1(join(source, 'NSIS.exe')) !== '6D45D4E8CCF18FE1FDAC9164058F356102A2ECF2'
    || sha1(requiredPlugin) !== '75197FEE3C6A814FE035788D1C34EAD39349B860') {
    throw new Error('Portable NSIS executable/plugin hash does not match Tauri 2.12.4 pins.')
  }
  const compiler = spawnSync(join(source, 'makensis.exe'), ['/VERSION'], { encoding: 'utf8', windowsHide: true })
  if (compiler.status !== 0 || compiler.stdout.trim() !== 'v3.13') throw new Error('PG_NSIS_DIR must contain NSIS 3.13.')
  const localTools = join(tauriDir, 'target', '.tauri')
  mkdirSync(localTools, { recursive: true })
  cpSync(source, join(localTools, 'NSIS'), { recursive: true, force: true })
}

function tauriCli() {
  const require = createRequire(join(desktop, 'package.json'))
  const packagePath = require.resolve('@tauri-apps/cli/package.json')
  const metadata = JSON.parse(readFileSync(packagePath, 'utf8'))
  const bin = typeof metadata.bin === 'string' ? metadata.bin : metadata.bin.tauri
  return resolve(dirname(packagePath), bin)
}

if (action === 'dev') {
  if (testResourceRoot) {
    runNpm(['run', 'build', '--workspace', '@project-generator/core'], { cwd: root })
    run(process.execPath, [join(root, 'scripts', 'set-core-build-profile.mjs'), 'development'])
    runNpm(['run', 'build', '--workspace', '@project-generator/cli'], { cwd: root })
  } else runNpm(['run', 'build:development'], { cwd: root })
  prepareResources()
  const args = [tauriCli(), 'dev']
  if (testResourceRoot) args.push('--features', 'native-acceptance')
  const child = spawn(process.execPath, args, {
    cwd: desktop,
    stdio: 'inherit',
    windowsHide: false,
    env: { ...process.env, PG_RUNTIME_MODE: mode },
  })
  child.on('error', (error) => { throw error })
  child.on('exit', (code) => { process.exitCode = code ?? 1 })
} else {
  runNpm(['run', 'build'], { cwd: root })
  prepareResources()
  run(process.execPath, [join(root, 'scripts', 'packaged-cli-policy-smoke.mjs'), mode])
  stagePortableNsis()
  const args = [tauriCli(), 'build', '--bundles', 'nsis']
  let overlay
  if (version !== '0.1.0') {
    overlay = join(tauriDir, 'tauri.conf.poc-update.json')
    writeFileSync(overlay, JSON.stringify({ version }))
    args.push('--config', overlay)
  }
  try {
    run(process.execPath, args, { cwd: desktop, env: { ...process.env, PG_RUNTIME_MODE: mode } })
  } finally {
    if (overlay) rmSync(overlay, { force: true })
  }
  const bundleDir = join(tauriDir, 'target', 'release', 'bundle', 'nsis')
  const installer = join(bundleDir, `Project Generator_${version}_x64-setup.exe`)
  if (!existsSync(installer)) throw new Error(`NSIS installer not found: ${installer}`)
  const artifactDir = join(root, 'artifacts', 'phase-02.6')
  mkdirSync(artifactDir, { recursive: true })
  const artifact = join(artifactDir, `project-generator-${mode}-${version}-x64-setup.exe`)
  copyFileSync(installer, artifact)
  console.log(`Installer: ${artifact}`)
}
