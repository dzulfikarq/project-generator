import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { closeSync, cpSync, existsSync, openSync, readFileSync, rmSync } from 'node:fs'
import { access, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve, win32 } from 'node:path'
import { createServer } from 'node:net'
import { inspectRecovery, resolveGoTool, supportsGo } from '../packages/core/dist/src/index.js'
import { assertGoValidationResults, captureCleanupFailure, createBuildFailure, runNativeGenerationFlow, safeCleanupFailure, safeFailureMetadata, safeSupervisorDiagnostic, safeSupervisorLaunchObservation, safeSupervisorProcessResult, safeTerminalMetadata, waitForTerminalGeneration } from './phase-05b-native-e2e-support.mjs'

if (process.platform !== 'win32') throw new Error('Phase 05B native acceptance requires Windows.')
const diagnosticOnly = process.argv.includes('--diagnostic-only')
const phase08a5Focused = process.argv.includes('--phase-08a5-focused')
const phase08b1Flag = process.argv.includes('--phase-08b1')
const phase08b3 = process.argv.includes('--phase-08b3')
const phase08b1 = phase08b1Flag || phase08b3
const phase08bPhase = phase08b3 ? '08B.3' : '08B.1'
if (process.argv.slice(2).some((argument) => !['--diagnostic-only', '--phase-08a5-focused', '--phase-08b1', '--phase-08b3'].includes(argument))
  || [diagnosticOnly, phase08a5Focused, phase08b1Flag, phase08b3].filter(Boolean).length > 1) throw new Error('Unsupported Phase 05B native harness argument.')
const debugPort = Number(process.env.PG_WEBVIEW_DEBUG_PORT ?? 9339)
const debugBase = `http://127.0.0.1:${debugPort}`
const root = resolve(import.meta.dirname, '..')
const hostTempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
let goVersion
let goVersionProbeExitCode
let goExecutablePath
let goToolError
try {
  const go = await resolveGoTool()
  if (!go) throw new Error('Go SDK not found on PATH or GOROOT.')
  goExecutablePath = go.executablePath
  const result = spawnSync(go.executablePath, ['version'], { encoding: 'utf8', windowsHide: true })
  goVersionProbeExitCode = result.status
  if (result.status !== 0) throw new Error(result.stderr)
  goVersion = /^go version go(\d+\.\d+(?:\.\d+)?)/.exec(result.stdout)?.[1]
  if (!goVersion || !supportsGo(goVersion)) throw new Error(`unsupported Go toolchain: ${result.stdout}`)
} catch (error) {
  if (!diagnosticOnly && !phase08b1) throw error
  goToolError = 'Go SDK unavailable, unresponsive, or unsupported.'
}
let runRoot
let tempBase
let isolatedLocalAppData
let isolatedTemp
let parent
let testResourceRoot
let testSupervisorBinary
let testSupervisorSha256
let diagnosticSupervisorBuild
let cleanupPostconditions
let repositorySupervisorSha256Before
let repositoryPathVerifierSha256Before
let repositoryStagedSupervisorSha256Before
let preflightEvidence = {}
let sourceFingerprintEvidence
let sourceRevision
let runtimeCorePackageSha256
let runtimeSupervisorModuleSha256
let releaseRestorationCommands = []
let cleanupNotRequired = false
let focusedEvidence
const generatedName = 'pg-be-02-go'
const generatedModule = 'github.com/example/pg-be-02-go'
const faultName = 'pg-be-02-supervisor-fault'
const faultModule = 'example.com/pg-be-02-supervisor-fault'
const cancelledName = 'pg-be-02-cancel'
const collisionName = 'pg-be-02-collision'
let collisionPath
let sentinelPath
let sentinelHash
const invalidModulePaths = [
  'github.com/con/api',
  'github.com/acme/pkg~1',
  'github.com/acme/pkg/v02',
  'github.com/acme/pkg/v2.1',
  'github.com/acme/COM1/api',
]

let socket
let nextCommandId = 0
const pending = new Map()
let allChecksComplete = false
let devProcess
let devLogFd
let devStartError
let devToolsOwned = false
let resourceSnapshot
let cleanupPromise
let releaseBuildRestored = false
let cleanupFailures = []
let localStorageSnapshot
let manifest
let artifactHashes
let generationTerminal
let diagnosticResult
let preflightComplete = false
let generationAttemptStarted = false
let preflightStage = 'startup'
let hostVsCodeExecutable
let vscodeUserData
let vscodeExtensions
let vscodeLaunchAttempted = false
let supervisorLaunchEvidencePath
let preGenerationSupervisorLaunchEvidence
let supervisorLaunchEvidenceAfterGeneration

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

function safeFailureSummary(cause) {
  let summary = String(cause?.message ?? 'Native acceptance failed.')
  if (runRoot) summary = summary.replaceAll(runRoot, '<run-owned>')
  return summary.replaceAll(root, '<source-root>').slice(0, 300)
}

function sha256File(path) {
  try { return createHash('sha256').update(readFileSync(path)).digest('hex') } catch { return null }
}

function cargoSearchPath() {
  const configured = process.env.CARGO
  if (configured && win32.isAbsolute(configured)) return dirname(configured)
  const userCargoBin = join(homedir(), '.cargo', 'bin')
  return existsSync(join(userCargoBin, 'cargo.exe')) ? userCargoBin : undefined
}

function findVsCodeExecutable(environment = process.env) {
  const candidates = [
    environment.LOCALAPPDATA && join(environment.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
    environment.ProgramFiles && join(environment.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
    environment['ProgramFiles(x86)'] && join(environment['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe'),
    ...(environment.PATH ?? '').split(win32.delimiter).filter(Boolean).map((entry) => join(entry, 'Code.exe')),
  ].filter(Boolean)
  return candidates.find((path) => existsSync(path))
}

const phase08bFingerprintRoots = [
  'native/windows-supervisor',
  'packages/core',
  'packages/cli',
  'packages/desktop',
  'package.json',
  'package-lock.json',
  'scripts/desktop.mjs',
  'scripts/node-path.mjs',
  'scripts/node-path.test.mjs',
  'scripts/set-core-build-profile.mjs',
  'scripts/phase-05b-native-e2e.mjs',
  'scripts/phase-05b-native-e2e-support.mjs',
  'scripts/phase-05b-native-e2e-support.test.mjs',
]
const generatedSourceDirectories = new Set(['.git', 'dist', 'node_modules', 'resources', 'target'])

async function collectSourceFiles(directory, excludeGenerated = true) {
  const files = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (excludeGenerated && entry.isDirectory() && generatedSourceDirectories.has(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) files.push(...await collectSourceFiles(path, excludeGenerated))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

async function fingerprintPhase08bInputs() {
  const files = []
  for (const relative of phase08bFingerprintRoots) {
    const path = join(root, relative)
    if (!existsSync(path)) throw new Error(`Phase 08B fingerprint input is missing: ${relative}`)
    const info = await stat(path)
    files.push(...(info.isDirectory() ? await collectSourceFiles(path) : [path]))
  }
  const entries = await Promise.all(files.map(async (path) => ({
    path: path.slice(root.length + 1).replaceAll('\\', '/'),
    content: await readFile(path),
  })))
  entries.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const hash = createHash('sha256')
  for (const entry of entries) hash.update(entry.path).update('\0').update(entry.content).update('\0')
  return {
    sha256: hash.digest('hex'),
    fileCount: entries.length,
    scope: phase08bFingerprintRoots,
  }
}

function readSourceRevision() {
  const safeDirectory = root.replaceAll('\\', '/')
  const result = spawnSync('git', ['-c', `safe.directory=${safeDirectory}`, 'rev-parse', 'HEAD'], {
    cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30_000,
  })
  if (result.error || result.status !== 0 || !/^[0-9a-f]{40}$/i.test(result.stdout.trim())) {
    throw new Error('Could not verify Phase 08B source revision.')
  }
  return result.stdout.trim()
}

async function hashDirectory(directory) {
  const files = await collectSourceFiles(directory, false)
  const entries = await Promise.all(files.map(async (path) => ({
    path: path.slice(directory.length + 1).replaceAll('\\', '/'),
    content: await readFile(path),
  })))
  entries.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const hash = createHash('sha256')
  for (const entry of entries) hash.update(entry.path).update('\0').update(entry.content).update('\0')
  return hash.digest('hex')
}

function powershellPath() {
  return join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

function runPowerShell(command, environment = process.env) {
  const result = spawnSync(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8', windowsHide: true, env: environment, timeout: 30_000,
  })
  if (result.error || result.status !== 0) {
    const error = new Error('Windows preflight or graceful process cleanup could not be verified.')
    if (typeof result.error?.code === 'string') error.code = result.error.code
    if (Number.isSafeInteger(result.error?.errno)) error.errno = result.error.errno
    if (Number.isSafeInteger(result.status)) error.exitCode = result.status
    throw error
  }
  return result.stdout.trim()
}

function normalizeImagePath(path) {
  return win32.resolve(path.replace(/^\\\\\?\\/, '')).toLowerCase()
}

async function readSupervisorLaunchEvidence() {
  let text
  try { text = await readFile(supervisorLaunchEvidencePath, 'utf8') } catch (error) {
    if (error?.code === 'ENOENT') return []
    throw error
  }
  return text.split(/\r?\n/).filter(Boolean).map((line) => {
    const observation = safeSupervisorLaunchObservation(JSON.parse(line))
    if (!observation) throw new Error('Supervisor launch evidence contains invalid process identity.')
    return observation
  })
}

function verifySupervisorLaunchEvidence(observations) {
  assert.ok(observations.length > 0, 'Tauri runtime did not record a launched supervisor process.')
  const expectedPath = join(testResourceRoot, 'cli', 'node_modules', '@project-generator', 'core', 'native', 'pg-windows-supervisor.exe')
  const expectedIdentity = normalizeImagePath(expectedPath)
  for (const observation of observations) {
    assert.equal(normalizeImagePath(observation.executablePath), expectedIdentity, 'launched supervisor executable path differs from isolated staged binary')
    assert.equal(observation.sha256, testSupervisorSha256, 'launched supervisor SHA-256 differs from isolated build')
  }
  assert.equal(sha256File(testSupervisorBinary), testSupervisorSha256)
  assert.equal(sha256File(expectedPath), testSupervisorSha256)
  return observations
}

async function verifyPreGenerationSupervisorIdentity() {
  await click('.recovery-strip button', 'Inspect recovery')
  await waitFor("document.querySelector('.recovery-details pre') !== null", 'isolated recovery identity probe')
  const recovery = JSON.parse(await evaluate("document.querySelector('.recovery-details pre')?.textContent ?? 'null'"))
  assert.deepEqual(recovery, [], 'fresh isolated recovery probe must return no records')
  preGenerationSupervisorLaunchEvidence = verifySupervisorLaunchEvidence(await readSupervisorLaunchEvidence())
  assert.ok(preGenerationSupervisorLaunchEvidence.some(({ mode }) => mode === '--recovery-inspect'), 'runtime image proof must come from Tauri recovery inspection')
  assert.equal(preGenerationSupervisorLaunchEvidence.some(({ mode }) => mode === '--run'), false, 'generation supervisor must not launch before provenance gate passes')
  return {
    status: 'PASS',
    timing: 'verified before generation',
    trigger: 'Tauri Inspect recovery action',
    observationMethod: 'Successful Node child_process spawn event; process ID, spawnfile path, and spawnfile SHA-256.',
    recoveryReports: recovery,
    processCount: preGenerationSupervisorLaunchEvidence.length,
    observations: preGenerationSupervisorLaunchEvidence,
    evidenceFile: '<run-owned>/app-data/temp/phase-08b3-supervisor-launches.jsonl',
    buildSha256: testSupervisorSha256,
    stagedSha256: sha256File(join(testResourceRoot, 'cli', 'node_modules', '@project-generator', 'core', 'native', 'pg-windows-supervisor.exe')),
  }
}

function cleanupOperationError(operation, cause, fallbackCode = 'CLEANUP_OPERATION_FAILED') {
  const error = new Error('Owned-run cleanup operation failed.')
  error.cleanupOperation = operation
  error.code = typeof cause?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(cause.code) ? cause.code : fallbackCode
  if (Number.isSafeInteger(cause?.errno)) error.errno = cause.errno
  if (Number.isSafeInteger(cause?.winerror)) error.winerror = cause.winerror
  if (Number.isSafeInteger(cause?.exitCode)) error.exitCode = cause.exitCode
  else if (Number.isSafeInteger(cause?.status)) error.exitCode = cause.status
  return error
}

async function assertPortFree(port) {
  const listener = createServer()
  await new Promise((resolveListen, reject) => {
    listener.once('error', reject)
    listener.listen(port, '127.0.0.1', resolveListen)
  })
  await new Promise((resolveClose, reject) => listener.close((error) => error ? reject(error) : resolveClose()))
}

function assertNotElevated() {
  const elevated = runPowerShell('[Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)')
  if (elevated.toLowerCase() !== 'false') throw new Error('Diagnostic run requires a non-elevated Windows process.')
}

function assertNoAcceptanceProcesses() {
  const command = `$owned = @([int]$env:PG_NATIVE_E2E_PREFLIGHT_PID); $cursor = $owned[0]; for ($depth = 0; $depth -lt 8; $depth++) { $entry = Get-CimInstance Win32_Process -Filter "ProcessId = $cursor"; if (!$entry -or !$entry.ParentProcessId) { break }; $cursor = [int]$entry.ParentProcessId; if ($owned -contains $cursor) { break }; $owned += $cursor }; $found = @(Get-CimInstance Win32_Process | Where-Object { ($owned -notcontains [int]$_.ProcessId) -and $_.Name -notmatch '^(powershell|pwsh)\\.exe$' -and ($_.Name -match '(?i)project[- ]generator|pg-windows-supervisor|pg-cli' -or $_.CommandLine -match '(?i)(phase-05b-native-e2e|phase-08a-be02-repro|phase-07a-native-e2e|scripts[\\\\/]desktop\\.mjs.{0,100}\\bdev\\b)') }); if ($found.Count -gt 0) { exit 3 }; exit 0`
  const result = spawnSync(powershellPath(), ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8', windowsHide: true, timeout: 30_000,
    env: { ...process.env, PG_NATIVE_E2E_PREFLIGHT_PID: String(process.pid) },
  })
  if (result.error || result.status !== 0) throw new Error('A previous native acceptance process is active or process preflight could not be verified.')
}

function buildFaultSupervisor() {
  const cargo = process.env.CARGO ?? [join(homedir(), '.cargo', 'bin', 'cargo.exe'), 'cargo'].find((path) => path === 'cargo' || existsSync(path))
  if (!cargo) throw new Error('Cargo is required for the isolated supervisor fault-injection build.')
  const targetDirectory = join(runRoot, 'cargo-supervisor-target')
  const args = [
    'build', '--locked', '--release', '--offline', '--manifest-path', join(root, 'native', 'windows-supervisor', 'Cargo.toml'),
    '--bin', 'pg-windows-supervisor', '--features', 'test-fault-injection', '--target-dir', targetDirectory,
  ]
  const result = spawnSync(cargo, args, { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 10 * 60 * 1000 })
  const evidence = {
    command: 'cargo build --locked --release --offline --manifest-path native/windows-supervisor/Cargo.toml --bin pg-windows-supervisor --features test-fault-injection --target-dir <run-owned>/cargo-supervisor-target',
    exitCode: result.status,
    spawnError: result.error?.code ?? null,
  }
  if (focusedEvidence) focusedEvidence.supervisorBuild = evidence
  assert.ifError(result.error)
  assert.equal(result.status, 0, 'Isolated test-only supervisor build failed.')
  testSupervisorBinary = join(targetDirectory, 'release', 'pg-windows-supervisor.exe')
  assert.equal(existsSync(testSupervisorBinary), true)
  testSupervisorSha256 = createHash('sha256').update(readFileSync(testSupervisorBinary)).digest('hex')
  evidence.supervisorSha256 = testSupervisorSha256
  return evidence
}

function buildDiagnosticSupervisor() {
  const cargo = process.env.CARGO ?? [join(homedir(), '.cargo', 'bin', 'cargo.exe'), 'cargo'].find((path) => path === 'cargo' || existsSync(path))
  if (!cargo) throw new Error('Cargo is required to build the isolated diagnostic supervisor.')
  repositorySupervisorSha256Before = sha256File(join(root, 'packages', 'core', 'native', 'pg-windows-supervisor.exe'))
  repositoryPathVerifierSha256Before = sha256File(join(root, 'packages', 'core', 'native', 'pg-db-path-verifier.exe'))
  repositoryStagedSupervisorSha256Before = sha256File(join(root, 'packages', 'desktop', 'src-tauri', 'resources', 'pg-runtime', 'cli', 'node_modules', '@project-generator', 'core', 'native', 'pg-windows-supervisor.exe'))
  if (!repositoryPathVerifierSha256Before) {
    const error = new Error('Packaged path verifier is missing; cannot build isolated native resources.')
    error.code = 'PATH_VERIFIER_RESOURCE_UNAVAILABLE'
    throw error
  }
  const targetDirectory = join(runRoot, 'cargo-supervisor-target')
  const args = [
    'build', '--locked', '--release', '--offline', '--manifest-path', join(root, 'native', 'windows-supervisor', 'Cargo.toml'),
    '--bin', 'pg-windows-supervisor', '--target-dir', targetDirectory,
  ]
  const result = spawnSync(cargo, args, { cwd: root, stdio: 'inherit', windowsHide: true, timeout: 10 * 60 * 1000 })
  const evidence = {
    command: `${cargo} ${args.map((argument) => JSON.stringify(argument)).join(' ')}`,
    program: cargo,
    args,
    cwd: root,
    buildProfile: 'release',
    features: [],
    sourceRevision: sourceRevision ?? null,
    exitCode: result.status,
    spawnError: result.error?.code ?? null,
    repositorySupervisorSha256Before,
    repositoryPathVerifierSha256Before,
    supervisorSourceSha256: sha256File(join(root, 'native', 'windows-supervisor', 'src', 'main.rs')),
    cargoLockSha256: sha256File(join(root, 'native', 'windows-supervisor', 'Cargo.lock')),
  }
  diagnosticSupervisorBuild = evidence
  if (result.error || result.status !== 0) {
    const error = new Error('Isolated production supervisor build failed.')
    error.code = typeof result.error?.code === 'string' ? result.error.code : 'SUPERVISOR_BUILD_FAILED'
    if (Number.isSafeInteger(result.error?.errno)) error.errno = result.error.errno
    if (Number.isSafeInteger(result.status)) error.exitCode = result.status
    throw error
  }
  testSupervisorBinary = join(targetDirectory, 'release', 'pg-windows-supervisor.exe')
  assert.equal(existsSync(testSupervisorBinary), true)
  testSupervisorSha256 = createHash('sha256').update(readFileSync(testSupervisorBinary)).digest('hex')
  evidence.executablePath = testSupervisorBinary
  evidence.supervisorSha256 = testSupervisorSha256
  return evidence
}

async function prepareDiagnosticIsolation() {
  if (diagnosticOnly && (!/^[0-9a-f]{64}$/i.test(process.env.PG_PHASE08A7_SOURCE_FINGERPRINT ?? '')
    || !/^[0-9a-f]{40}$/i.test(process.env.PG_PHASE08A7_HEAD ?? ''))) {
    preflightStage = 'source-inventory'
    throw new Error('Phase 08A.7 requires a current source/build inventory fingerprint.')
  }
  if (phase08b1) {
    preflightStage = 'source-inventory'
    sourceFingerprintEvidence = await fingerprintPhase08bInputs()
    sourceRevision = readSourceRevision()
    const expectedFingerprint = process.env[phase08b3 ? 'PG_PHASE08B3_SOURCE_FINGERPRINT' : 'PG_PHASE08B1_SOURCE_FINGERPRINT']
    const expectedHead = process.env[phase08b3 ? 'PG_PHASE08B3_HEAD' : 'PG_PHASE08B1_HEAD']
    if (expectedFingerprint && expectedFingerprint.toLowerCase() !== sourceFingerprintEvidence.sha256) {
      throw new Error('Phase 08B source fingerprint changed after inventory.')
    }
    if (expectedHead && expectedHead.toLowerCase() !== sourceRevision.toLowerCase()) {
      throw new Error('Phase 08B HEAD revision changed after inventory.')
    }
  }
  hostVsCodeExecutable = findVsCodeExecutable()
  preflightEvidence = {
    sourceFingerprint: phase08b1 ? sourceFingerprintEvidence?.sha256 : process.env.PG_PHASE08A7_SOURCE_FINGERPRINT ?? null,
    sourceFingerprintFileCount: phase08b1 ? sourceFingerprintEvidence?.fileCount : undefined,
    sourceFingerprintScope: phase08b1 ? sourceFingerprintEvidence?.scope : null,
    head: phase08b1 ? sourceRevision : process.env.PG_PHASE08A7_HEAD ?? null,
    goVersion,
    goVersionProbeExitCode,
    hostVsCode: phase08b1 ? {
      available: Boolean(hostVsCodeExecutable),
      executable: hostVsCodeExecutable ?? null,
      sha256: hostVsCodeExecutable ? sha256File(hostVsCodeExecutable) : null,
    } : undefined,
  }
  preflightStage = 'approved-temp-root'
  await access(hostTempBase)
  assert.ok((await stat(hostTempBase)).isDirectory())
  preflightEvidence.approvedTempRootAvailable = true
  preflightStage = 'release-policy-baseline'
  const sourcePolicy = await readFile(join(root, 'packages', 'core', 'src', 'build-policy.ts'), 'utf8')
  const baselinePolicy = await readFile(join(root, 'packages', 'core', 'dist', 'src', 'build-policy.js'), 'utf8')
  if (!sourcePolicy.includes("= 'release'") || !sourcePolicy.includes('ALLOW_PLANNED_RECIPE_GENERATION: boolean = false')
    || !baselinePolicy.includes("BUILD_PROFILE = 'release'") || !baselinePolicy.includes('ALLOW_PLANNED_RECIPE_GENERATION = false')) {
    throw new Error('Diagnostic preflight requires a release-profile baseline build.')
  }
  preflightEvidence.baselineBuildProfile = 'release'
  preflightEvidence.releasePolicySource = 'release; planned generation disabled'
  preflightStage = 'port-configuration'
  if (!Number.isInteger(debugPort) || debugPort < 1024 || debugPort > 65535) throw new Error('PG_WEBVIEW_DEBUG_PORT must be a valid non-privileged TCP port.')
  if (debugPort === 1420) throw new Error('WebView2 DevTools port must differ from Tauri/Vite port 1420.')
  preflightEvidence.webviewDebugPort = debugPort
  preflightStage = 'non-elevated-token'
  assertNotElevated()
  preflightEvidence.elevated = false
  preflightStage = 'acceptance-processes'
  assertNoAcceptanceProcesses()
  preflightEvidence.acceptanceProcessesBeforeRun = 0
  preflightStage = 'vite-port-free'
  await assertPortFree(1420)
  preflightEvidence.vitePortBeforeRun = 'free'
  preflightStage = 'webview-port-free'
  await assertPortFree(debugPort)
  preflightEvidence.webviewPortBeforeRun = 'free'

  preflightStage = 'run-owned-root'
  runRoot = await mkdtemp(join(hostTempBase, phase08a5Focused ? 'phase-08a5-be02-' : phase08b3 ? 'phase-08b3-be02-' : phase08b1 ? 'phase-08b1-be02-' : 'phase-08a7-be02-diagnostic-'))
  isolatedLocalAppData = join(runRoot, 'app-data', 'local')
  isolatedTemp = join(runRoot, 'app-data', 'temp')
  supervisorLaunchEvidencePath = join(isolatedTemp, 'phase-08b3-supervisor-launches.jsonl')
  tempBase = join(isolatedLocalAppData, 'Temp', 'opencode')
  parent = join(runRoot, 'workspace')
  vscodeUserData = join(runRoot, 'vscode-user-data')
  vscodeExtensions = join(runRoot, 'vscode-extensions')
  for (const path of [isolatedLocalAppData, join(runRoot, 'app-data', 'roaming'), isolatedTemp, join(runRoot, 'webview-profile'), tempBase, parent,
    ...(phase08b1 && hostVsCodeExecutable ? [vscodeUserData, vscodeExtensions] : [])]) {
    await mkdir(path, { recursive: true })
  }
  if (phase08b1 && hostVsCodeExecutable) {
    await mkdir(join(vscodeUserData, 'User'), { recursive: true })
    await writeFile(join(vscodeUserData, 'User', 'settings.json'), JSON.stringify({
      'update.mode': 'none',
      'extensions.autoUpdate': false,
      'extensions.autoCheckUpdates': false,
      'telemetry.telemetryLevel': 'off',
    }, null, 2) + '\n')
  }
  assert.deepEqual(await readdir(parent), [], 'diagnostic target parent must be new and empty')
  if (phase08a5Focused || diagnosticOnly || phase08b1) {
    preflightStage = 'isolated-native-resources'
    testResourceRoot = join(runRoot, 'resources', 'pg-runtime')
    await mkdir(testResourceRoot, { recursive: true })
    assert.deepEqual(await readdir(testResourceRoot), [], 'native diagnostic resources must be test-owned and empty')
  }
  preflightEvidence.isolation = {
    runRoot,
    workspace: parent,
    appData: isolatedLocalAppData,
    temp: isolatedTemp,
    webviewProfile: join(runRoot, 'webview-profile'),
    vscodeUserData: phase08b1 && hostVsCodeExecutable ? vscodeUserData : null,
    vscodeExtensions: phase08b1 && hostVsCodeExecutable ? vscodeExtensions : null,
    tauriTarget: join(runRoot, 'cargo-tauri-target'),
    supervisorTarget: join(runRoot, 'cargo-supervisor-target'),
    resources: testResourceRoot,
    workspaceInitiallyEmpty: true,
    resourcesInitiallyEmpty: Boolean(testResourceRoot),
  }
  if (phase08a5Focused) {
    preflightStage = 'test-supervisor-build'
    focusedEvidence = {
      phase: '08A.5',
      status: 'RUNNING',
      preflight: 'GO',
      tests: {},
    }
    focusedEvidence.supervisorBuild = buildFaultSupervisor()
  } else if (diagnosticOnly || phase08b1) {
    preflightStage = 'production-supervisor-build'
    diagnosticSupervisorBuild = buildDiagnosticSupervisor()
    preflightEvidence.supervisorBuild = diagnosticSupervisorBuild
  } else await snapshotNativeResources()
  preflightStage = 'desktop-launch'
  await launchOwnedDesktop()
  preflightStage = 'webview-devtools'
  const target = await waitForDevTools(30 * 60 * 1000)
  preflightStage = 'webview-connect'
  await connectDevTools(target)
  devToolsOwned = true
  preflightStage = 'resource-verification'
  await assertDevelopmentResources()
  preflightEvidence.developmentResourceProfile = 'development'
  preflightEvidence.supervisorSha256 = testSupervisorSha256
  preflightEvidence.supervisorResourceSha256 = diagnosticSupervisorBuild?.supervisorResourceSha256 ?? testSupervisorSha256
  preflightEvidence.supervisorBuildPath = diagnosticSupervisorBuild?.executablePath ?? null
  preflightEvidence.supervisorResourcePath = join(testResourceRoot, 'cli', 'node_modules', '@project-generator', 'core', 'native', 'pg-windows-supervisor.exe')
  preflightEvidence.pathVerifierResourceSha256 = diagnosticSupervisorBuild?.pathVerifierResourceSha256 ?? null
  preflightEvidence.nativeRuntime = phase08b1 ? {
    runtimeMode: 'system',
    tauriFeature: 'native-acceptance',
    resourceRootOverride: testResourceRoot,
    supervisorModule: diagnosticSupervisorBuild?.runtimeCorePackage?.supervisorModule ?? null,
    supervisorExecutable: diagnosticSupervisorBuild?.runtimeCorePackage?.resolvedSupervisorExecutable ?? null,
    supervisorExecutableSha256: diagnosticSupervisorBuild?.runtimeCorePackage?.supervisorExecutableSha256 ?? null,
    corePackageTreeSha256: runtimeCorePackageSha256,
  } : undefined
}

async function snapshotNativeResources() {
  const resourceRoot = join(root, 'packages', 'desktop', 'src-tauri', 'resources', 'pg-runtime')
  const backupRoot = join(runRoot, 'resource-backup')
  await mkdir(backupRoot)
  resourceSnapshot = []
  for (const name of ['cli', 'runtime', 'catalog.json', 'runtime-manifest.json']) {
    const source = join(resourceRoot, name)
    const existed = existsSync(source)
    const backupPath = join(backupRoot, name)
    if (existed) cpSync(source, backupPath, { recursive: true })
    resourceSnapshot.push({ name, existed, backupPath })
  }
}

function isolatedEnvironment() {
  const env = { ...process.env }
  const extraPath = [
    phase08b1 ? dirname(process.execPath) : undefined,
    phase08b1 && hostVsCodeExecutable ? dirname(hostVsCodeExecutable) : undefined,
    phase08b1 ? cargoSearchPath() : undefined,
    phase08b1 && goExecutablePath ? dirname(goExecutablePath) : undefined,
    env.PATH,
  ].filter(Boolean).join(win32.delimiter)
  for (const key of Object.keys(env)) {
    if (/^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSERVICE|PGSSLMODE|PGOPTIONS|PGAPPNAME|PGTARGETSESSIONATTRS|PGDATA|PG_E2E_DATABASE_URL)$/i.test(key)) delete env[key]
  }
  delete env.DATABASE_URL
  Object.assign(env, {
    LOCALAPPDATA: isolatedLocalAppData,
    APPDATA: join(runRoot, 'app-data', 'roaming'),
    TEMP: isolatedTemp,
    TMP: isolatedTemp,
    PG_WEBVIEW_DEBUG_PORT: String(debugPort),
    PG_NATIVE_E2E_SKIP_VSCODE: phase08b1 && hostVsCodeExecutable ? '0' : '1',
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --user-data-dir="${join(runRoot, 'webview-profile')}"`,
    GOTOOLCHAIN: 'local',
    GOENV: 'off',
    GOPROXY: 'off',
    GOSUMDB: 'off',
    CARGO_NET_OFFLINE: 'true',
    ...(phase08b1 ? { PATH: extraPath } : {}),
    ...(phase08b3 ? { PG_NATIVE_ACCEPTANCE_SUPERVISOR_LAUNCH_EVIDENCE: supervisorLaunchEvidencePath } : {}),
    ...(testResourceRoot && testSupervisorBinary ? {
      CARGO_TARGET_DIR: join(runRoot, 'cargo-tauri-target'),
      PG_NATIVE_ACCEPTANCE_RESOURCE_ROOT: testResourceRoot,
      PG_NATIVE_ACCEPTANCE_SUPERVISOR_BINARY: testSupervisorBinary,
    } : {}),
    ...(phase08a5Focused ? {
      PG_SUPERVISOR_TEST_FAULT: 'start-failure-once',
      PG_SUPERVISOR_TEST_FAULT_MARKER: join(isolatedTemp, 'phase-08a5-supervisor-fault-consumed'),
    } : {}),
    ...(phase08b1 && hostVsCodeExecutable ? {
      PG_NATIVE_ACCEPTANCE_VSCODE_USER_DATA_DIR: vscodeUserData,
      PG_NATIVE_ACCEPTANCE_VSCODE_EXTENSIONS_DIR: vscodeExtensions,
    } : {}),
  })
  return env
}

async function launchOwnedDesktop() {
  const logPath = join(runRoot, 'desktop-dev.log')
  devLogFd = openSync(logPath, 'wx')
  devProcess = spawn(process.execPath, [join(root, 'scripts', 'desktop.mjs'), 'dev', 'system'], {
    cwd: root,
    env: isolatedEnvironment(),
    windowsHide: false,
    stdio: ['ignore', devLogFd, devLogFd],
  })
  devProcess.once('error', (error) => { devStartError = error })
}

async function assertDevelopmentResources() {
  const resourceRoot = testResourceRoot ?? join(root, 'packages', 'desktop', 'src-tauri', 'resources', 'pg-runtime')
  const core = join(resourceRoot, 'cli', 'node_modules', '@project-generator', 'core', 'dist', 'src')
  const [policy, runner, job, bridge, ui] = await Promise.all([
    readFile(join(core, 'build-policy.js'), 'utf8'),
    readFile(join(core, 'runner.js'), 'utf8'),
    readFile(join(core, 'job.js'), 'utf8'),
    readFile(join(root, 'packages', 'desktop', 'src-tauri', 'src', 'main.rs'), 'utf8'),
    readFile(join(root, 'packages', 'desktop', 'src', 'ui.tsx'), 'utf8'),
  ])
  assert.match(policy, /BUILD_PROFILE = 'development'/)
  assert.match(policy, /ALLOW_PLANNED_RECIPE_GENERATION = true/)
  assert.match(runner, /supervisor-diagnostic/)
  if (phase08a5Focused) assert.match(runner, /start-failure-once/)
  assert.match(job, /diagnosticRef/)
  assert.match(bridge, /diagnostic_ref/)
  assert.match(bridge, /child_process_state/)
  assert.match(ui, /generation-terminal-metadata/)
  if (phase08a5Focused || diagnosticOnly || phase08b1) {
    const stagedSupervisor = await readFile(join(resourceRoot, 'cli', 'node_modules', '@project-generator', 'core', 'native', 'pg-windows-supervisor.exe'))
    const stagedSupervisorSha256 = createHash('sha256').update(stagedSupervisor).digest('hex')
    assert.equal(stagedSupervisorSha256, testSupervisorSha256)
    if (focusedEvidence) focusedEvidence.supervisorResourceSha256 = testSupervisorSha256
    if (diagnosticSupervisorBuild) diagnosticSupervisorBuild.supervisorResourceSha256 = testSupervisorSha256
    const stagedVerifier = await readFile(join(resourceRoot, 'cli', 'node_modules', '@project-generator', 'core', 'native', 'pg-db-path-verifier.exe'))
    diagnosticSupervisorBuild ??= {}
    diagnosticSupervisorBuild.pathVerifierResourceSha256 = createHash('sha256').update(stagedVerifier).digest('hex')
    if (phase08b1) {
      const corePackageRoot = join(resourceRoot, 'cli', 'node_modules', '@project-generator', 'core')
      const modulePath = join(corePackageRoot, 'dist', 'src', 'native-supervisor.js')
      const executablePath = join(corePackageRoot, 'native', 'pg-windows-supervisor.exe')
      const moduleSource = await readFile(modulePath, 'utf8')
      assert.match(moduleSource, /new URL\(['"]\.\.\/\.\.\/native\/pg-windows-supervisor\.exe['"], import\.meta\.url\)/)
      if (phase08b3) assert.match(moduleSource, /PG_NATIVE_ACCEPTANCE_SUPERVISOR_LAUNCH_EVIDENCE/)
      assert.equal(resolve(dirname(modulePath), '..', '..', 'native', 'pg-windows-supervisor.exe'), resolve(executablePath))
      assert.equal(sha256File(executablePath), testSupervisorSha256)
      runtimeCorePackageSha256 = await hashDirectory(corePackageRoot)
      runtimeSupervisorModuleSha256 = sha256File(modulePath)
      diagnosticSupervisorBuild.runtimeCorePackage = {
        packageRoot: corePackageRoot,
        packageTreeSha256: runtimeCorePackageSha256,
        supervisorModule: modulePath,
        supervisorModuleSha256: runtimeSupervisorModuleSha256,
        resolvedSupervisorExecutable: executablePath,
        supervisorExecutableSha256: stagedSupervisorSha256,
        pathResolution: "native-supervisor.js -> new URL('../../native/pg-windows-supervisor.exe', import.meta.url)",
      }
    }
  }
}

async function waitForDevTools(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (devStartError) throw new Error('Owned native desktop failed to start.')
    if ((devProcess?.exitCode !== null && devProcess?.exitCode !== undefined) || devProcess?.signalCode) throw new Error('Owned native desktop exited before the WebView became available.')
    try {
      const response = await fetch(`${debugBase}/json/list`)
      if (!response.ok) throw new Error('DevTools endpoint not ready')
      const target = (await response.json()).find((item) => item.type === 'page'
        && item.webSocketDebuggerUrl
        && (!(diagnosticOnly || phase08b1) || (item.url ?? '').startsWith('http://127.0.0.1:1420/')))
      if (target) return target
    } catch {}
    await delay(500)
  }
  throw new Error(`WebView2 DevTools endpoint unavailable on selected port ${debugPort}.`)
}

async function connectDevTools(target) {
  socket = new WebSocket(target.webSocketDebuggerUrl)
  socket.addEventListener('message', async (event) => {
    const payload = typeof event.data === 'string' ? event.data : await event.data.text()
    const message = JSON.parse(payload)
    if (message.id === undefined) return
    const request = pending.get(message.id)
    if (!request) return
    pending.delete(message.id)
    clearTimeout(request.timer)
    if (message.error) request.reject(new Error(message.error.message))
    else request.resolve(message.result)
  })
  await new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener('open', resolveOpen, { once: true })
    socket.addEventListener('error', rejectOpen, { once: true })
  })
  await command('Runtime.enable')
  await command('Page.enable')
}

function command(method, params = {}, timeoutMs = 30_000) {
  const id = ++nextCommandId
  return new Promise((resolveCommand, rejectCommand) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      rejectCommand(new Error(`DevTools command timed out: ${method}`))
    }, timeoutMs)
    pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function sendBrowserClose() {
  let closer
  try {
    const response = await fetch(`${debugBase}/json/version`)
    const endpoint = response.ok ? (await response.json()).webSocketDebuggerUrl : undefined
    if (!endpoint) return
    closer = new WebSocket(endpoint)
    await new Promise((resolveOpen, rejectOpen) => {
      closer.addEventListener('open', resolveOpen, { once: true })
      closer.addEventListener('error', rejectOpen, { once: true })
    })
    await new Promise((resolveClose) => {
      const timer = setTimeout(resolveClose, 3_000)
      const finish = () => { clearTimeout(timer); resolveClose() }
      closer.addEventListener('message', finish, { once: true })
      closer.addEventListener('close', finish, { once: true })
      closer.addEventListener('error', finish, { once: true })
      closer.send(JSON.stringify({ id: 1, method: 'Browser.close' }))
    })
  } catch {
    // The app may already be exiting or DevTools may not have started.
  } finally {
    if (closer && closer.readyState < WebSocket.CLOSING) closer.close()
  }
}

function requestOwnedWindowClose() {
  if (!devProcess?.pid) return
  const commandText = `$root = [int]$env:PG_NATIVE_E2E_ROOT_PID; $all = @(Get-CimInstance Win32_Process); $ids = @($root); do { $added = @($all | Where-Object { $ids -contains [int]$_.ParentProcessId -and $ids -notcontains [int]$_.ProcessId } | ForEach-Object { [int]$_.ProcessId }); if ($added.Count -gt 0) { $ids += $added } } while ($added.Count -gt 0); foreach ($id in $ids) { $p = Get-Process -Id $id -ErrorAction SilentlyContinue; if ($p -and $p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() } }`
  runPowerShell(commandText, { ...process.env, PG_NATIVE_E2E_ROOT_PID: String(devProcess.pid) })
}

async function waitForOwnedDesktopExit(timeoutMs = 30_000) {
  if (!devProcess || devProcess.exitCode !== null || devProcess.signalCode !== null) return true
  return await new Promise((resolveExit) => {
    const timer = setTimeout(() => finish(false), timeoutMs)
    const finish = (exited) => {
      clearTimeout(timer)
      devProcess.removeListener('exit', onExit)
      resolveExit(exited)
    }
    const onExit = () => finish(true)
    devProcess.once('exit', onExit)
  })
}

async function stopOwnedDesktop() {
  const failures = []
  const attempt = (operation, action) => captureCleanupFailure(operation, action, failures)
  cleanupPostconditions = {
    desktopProcessExited: !devProcess?.pid || devProcess.exitCode !== null || devProcess.signalCode !== null,
    acceptanceProcessesRemaining: null,
    ports: { vite: 'unknown', webview: 'unknown' },
  }
  if (devProcess?.pid) {
    if (devToolsOwned) await sendBrowserClose()
    if (devProcess.exitCode === null && devProcess.signalCode === null) {
      await attempt('request-owned-window-close', requestOwnedWindowClose)
      await attempt('owned-desktop-exit', async () => {
        if (await waitForOwnedDesktopExit()) return
        const error = new Error('Owned desktop did not exit after graceful close request.')
        error.code = 'OWNED_DESKTOP_EXIT_TIMEOUT'
        throw error
      })
    }
  }
  if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) {
    await attempt('close-devtools-socket', () => socket.close())
  }
  if (devLogFd !== undefined) {
    await attempt('close-desktop-log', () => {
      closeSync(devLogFd)
      devLogFd = undefined
    })
  }
  cleanupPostconditions.desktopProcessExited = !devProcess?.pid || devProcess.exitCode !== null || devProcess.signalCode !== null
  cleanupPostconditions.desktopExitCode = devProcess?.exitCode ?? null
  cleanupPostconditions.desktopSignalCode = devProcess?.signalCode ?? null
  await attempt('acceptance-process-postcondition', async () => {
    const processCount = runAcceptanceProcessCount()
    cleanupPostconditions.acceptanceProcessesRemaining = processCount
    if (processCount !== 0) {
      const error = new Error('Acceptance process remained after graceful desktop shutdown.')
      error.code = 'ACCEPTANCE_PROCESS_REMAINS'
      error.exitCode = processCount
      throw error
    }
  })
  for (const [operation, port, key] of [
    ['vite-port-postcondition', 1420, 'vite'],
    ['webview-port-postcondition', debugPort, 'webview'],
  ]) {
    await attempt(operation, async () => {
      await assertPortFree(port)
      cleanupPostconditions.ports[key] = 'free'
    })
  }
  if (failures.length) {
    const error = new Error('Owned desktop cleanup postconditions failed.')
    error.code = 'CLEANUP_POSTCONDITIONS_FAILED'
    error.cleanupFailures = failures
    throw error
  }
}

function runAcceptanceProcessCount() {
  const commandText = `$owned = @([int]$env:PG_NATIVE_E2E_PREFLIGHT_PID); $cursor = $owned[0]; for ($depth = 0; $depth -lt 8; $depth++) { $entry = Get-CimInstance Win32_Process -Filter "ProcessId = $cursor"; if (!$entry -or !$entry.ParentProcessId) { break }; $cursor = [int]$entry.ParentProcessId; if ($owned -contains $cursor) { break }; $owned += $cursor }; @(Get-CimInstance Win32_Process | Where-Object { ($owned -notcontains [int]$_.ProcessId) -and $_.Name -notmatch '^(powershell|pwsh)\\.exe$' -and ($_.Name -match '(?i)project[- ]generator|pg-windows-supervisor|pg-cli' -or $_.CommandLine -match '(?i)(phase-05b-native-e2e|phase-08a-be02-repro|phase-07a-native-e2e|scripts[\\\\/]desktop\\.mjs.{0,100}\\bdev\\b)') }).Count`
  const output = runPowerShell(commandText, { ...process.env, PG_NATIVE_E2E_PREFLIGHT_PID: String(process.pid) })
  const count = Number(output)
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Acceptance process postcondition could not be verified.')
  return count
}

function ownedVsCodeProcesses(projectPath) {
  if (!vscodeUserData) return []
  const output = runPowerShell(`$profile = $env:PG_NATIVE_E2E_VSCODE_PROFILE; $extensions = $env:PG_NATIVE_E2E_VSCODE_EXTENSIONS; $project = $env:PG_NATIVE_E2E_VSCODE_PROJECT; $found = @(Get-CimInstance Win32_Process -Filter "Name = 'Code.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($profile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 } | ForEach-Object { [pscustomobject]@{ processId=[int]$_.ProcessId; projectArgument=($_.CommandLine.IndexOf($project, [System.StringComparison]::OrdinalIgnoreCase) -ge 0); isolatedProfile=($_.CommandLine.IndexOf($profile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0); extensionsDisabled=($_.CommandLine.IndexOf('--disable-extensions', [System.StringComparison]::OrdinalIgnoreCase) -ge 0); isolatedExtensions=($_.CommandLine.IndexOf($extensions, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) } }); ConvertTo-Json -InputObject @($found) -Compress`, {
    ...process.env,
    PG_NATIVE_E2E_VSCODE_PROFILE: vscodeUserData,
    PG_NATIVE_E2E_VSCODE_EXTENSIONS: vscodeExtensions,
    PG_NATIVE_E2E_VSCODE_PROJECT: projectPath,
  })
  if (!output) return []
  const parsed = JSON.parse(output)
  return (Array.isArray(parsed) ? parsed : [parsed]).filter((item) => Number.isSafeInteger(item.processId))
}

async function waitForOwnedVsCode(projectPath) {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const processes = ownedVsCodeProcesses(projectPath)
    if (processes.some((item) => item.projectArgument && item.extensionsDisabled && item.isolatedExtensions)) return processes
    await delay(500)
  }
  throw new Error('VS Code did not launch the generated project with the isolated user-data profile.')
}

function closeOwnedVsCode() {
  const output = runPowerShell(`$profile = $env:PG_NATIVE_E2E_VSCODE_PROFILE; $find = { @(Get-CimInstance Win32_Process -Filter "Name = 'Code.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.IndexOf($profile, [System.StringComparison]::OrdinalIgnoreCase) -ge 0 }) }; foreach ($entry in (& $find)) { $process = Get-Process -Id ([int]$entry.ProcessId) -ErrorAction SilentlyContinue; if ($process -and $process.MainWindowHandle -ne 0) { [void]$process.CloseMainWindow() } }; $deadline = (Get-Date).AddSeconds(20); do { $remaining = @(& $find); if ($remaining.Count -eq 0) { break }; Start-Sleep -Milliseconds 250 } while ((Get-Date) -lt $deadline); $remaining = @(& $find); if ($remaining.Count -gt 0) { exit 8 }; ConvertTo-Json -InputObject ([pscustomobject]@{ remaining=0 }) -Compress`, {
    ...process.env,
    PG_NATIVE_E2E_VSCODE_PROFILE: vscodeUserData,
  })
  return JSON.parse(output)
}

function restoreNativeResources() {
  if (!resourceSnapshot) return
  const resourceRoot = join(root, 'packages', 'desktop', 'src-tauri', 'resources', 'pg-runtime')
  for (const { name, existed, backupPath } of resourceSnapshot) {
    const target = join(resourceRoot, name)
    rmSync(target, { recursive: true, force: true })
    if (existed) cpSync(backupPath, target, { recursive: true })
  }
  resourceSnapshot = undefined
}

async function restoreReleaseBuildProfile() {
  if (!devProcess || releaseBuildRestored) return
  releaseRestorationCommands = []
  const build = (args, commandText) => {
    const result = spawnSync(process.execPath, [npmCli, ...args], {
      cwd: root, stdio: 'ignore', windowsHide: true, timeout: 15 * 60 * 1000,
    })
    releaseRestorationCommands.push({
      command: commandText,
      program: process.execPath,
      args: [npmCli, ...args],
      cwd: root,
      exitCode: result.status,
      spawnError: result.error?.code ?? null,
    })
    return result
  }
  const setReleaseProfile = () => {
    const result = spawnSync(process.execPath, [join(root, 'scripts', 'set-core-build-profile.mjs'), 'release'], {
      cwd: root, stdio: 'ignore', windowsHide: true, timeout: 30_000,
    })
    releaseRestorationCommands.push({
      command: 'node scripts/set-core-build-profile.mjs release',
      program: process.execPath,
      args: [join(root, 'scripts', 'set-core-build-profile.mjs'), 'release'],
      cwd: root,
      exitCode: result.status,
      spawnError: result.error?.code ?? null,
    })
    return result
  }
  let failure
  if (phase08a5Focused || diagnosticOnly || phase08b1) {
    const core = build(['run', 'build', '--workspace', '@project-generator/core'], 'npm run build --workspace @project-generator/core')
    if (core.error || core.status !== 0) failure = createBuildFailure('release-core-build', core)
    const profile = failure ? undefined : setReleaseProfile()
    if (!failure && (profile.error || profile.status !== 0)) failure = createBuildFailure('release-profile-set', profile)
    const cli = failure ? undefined : build(['run', 'build', '--workspace', '@project-generator/cli'], 'npm run build --workspace @project-generator/cli')
    if (!failure && (cli.error || cli.status !== 0)) failure = createBuildFailure('release-cli-build', cli)
  } else {
    const result = build(['run', 'build:release'], 'npm run build:release')
    if (result.error || result.status !== 0) failure = createBuildFailure('release-full-build', result)
  }
  if (failure) {
    setReleaseProfile()
    throw failure
  }
  const policy = await readFile(join(root, 'packages', 'core', 'dist', 'src', 'build-policy.js'), 'utf8')
  if (!policy.includes("BUILD_PROFILE = 'release'") || !policy.includes('ALLOW_PLANNED_RECIPE_GENERATION = false')) {
    throw cleanupOperationError('release-profile-postcondition', { code: 'RELEASE_PROFILE_POSTCONDITION_FAILED' })
  }
  releaseBuildRestored = true
}

async function cleanupRun() {
  if (cleanupPromise) return cleanupPromise
  cleanupPromise = (async () => {
    cleanupFailures = []
    const attempt = (operation, action) => captureCleanupFailure(operation, action, cleanupFailures)
    if (diagnosticOnly || phase08a5Focused || phase08b1) {
      if (phase08b1 && !devProcess) {
        cleanupNotRequired = true
      } else {
        await attempt('cleanup-run', stopOwnedDesktop)
        if (phase08b1 && vscodeLaunchAttempted) await attempt('close-isolated-vscode', closeOwnedVsCode)
        const processExited = !devProcess || !devProcess.pid || devProcess.exitCode !== null || devProcess.signalCode !== null
        if (processExited) {
          if (phase08b1 && testResourceRoot && testSupervisorBinary && testSupervisorSha256) {
            await attempt('staged-supervisor-identity-postcondition', async () => {
              const builtHash = sha256File(testSupervisorBinary)
              const stagedHash = sha256File(join(testResourceRoot, 'cli', 'node_modules', '@project-generator', 'core', 'native', 'pg-windows-supervisor.exe'))
              if (builtHash !== testSupervisorSha256 || stagedHash !== testSupervisorSha256) {
                throw cleanupOperationError('staged-supervisor-identity-postcondition', { code: 'SUPERVISOR_BINARY_CHANGED' })
              }
            })
            await attempt('staged-runtime-identity-postcondition', async () => {
              const packagePath = join(testResourceRoot, 'cli', 'node_modules', '@project-generator', 'core')
              const packageHash = await hashDirectory(packagePath)
              if (runtimeCorePackageSha256 && packageHash !== runtimeCorePackageSha256) {
                throw cleanupOperationError('staged-runtime-identity-postcondition', { code: 'STAGED_RUNTIME_CHANGED' })
              }
            })
          }
          await attempt('release-profile-restore', restoreReleaseBuildProfile)
          await attempt('native-resource-restore', restoreNativeResources)
        } else {
          const error = cleanupOperationError('owned-desktop-exit', { code: 'OWNED_DESKTOP_EXIT_UNVERIFIED' })
          cleanupFailures.push(safeCleanupFailure(error.cleanupOperation, error))
        }
      }
    } else if (socket?.readyState === WebSocket.OPEN && localStorageSnapshot) {
      await evaluate(`(() => {
        localStorage.clear();
        for (const [key, value] of ${JSON.stringify(localStorageSnapshot)}) localStorage.setItem(key, value);
        return true;
      })()`).catch(() => undefined)
      await command('Page.reload', { ignoreCache: true }).catch(() => undefined)
      socket.close()
    }
    if (cleanupFailures.length) {
      const error = new Error('One or more owned-run cleanup postconditions failed.')
      error.code = 'CLEANUP_POSTCONDITIONS_FAILED'
      error.cleanupFailures = cleanupFailures
      throw error
    }
  })()
  return cleanupPromise
}

async function evaluate(expression, timeoutMs = 30_000) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeoutMs)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result?.value
}

async function waitFor(predicate, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await evaluate(`(() => { return ${predicate} })()`)
    if (value) return value
    await delay(250)
  }
  throw new Error(`Timed out waiting for ${description}. Page text:\n${await evaluate('document.body.innerText.slice(-5000)')}`)
}

async function click(selector, text) {
  const result = await evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})].find((candidate) => candidate.textContent.includes(${JSON.stringify(text)}));
    if (!element) return { error: 'missing', selector: ${JSON.stringify(selector)}, text: ${JSON.stringify(text)} };
    if (element.disabled) return { error: 'disabled', selector: ${JSON.stringify(selector)}, text: ${JSON.stringify(text)} };
    element.click();
    return { clicked: true };
  })()`)
  assert.deepEqual(result, { clicked: true }, `Could not click ${selector} containing ${text}: ${JSON.stringify(result)}`)
}

async function fill(selector, value) {
  const result = await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input) return { error: 'missing input' };
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    return { value: input.value };
  })()`)
  assert.deepEqual(result, { value }, `Could not set ${selector}: ${JSON.stringify(result)}`)
}

async function setCheckbox(selector) {
  const result = await evaluate(`(() => {
    const input = document.querySelector(${JSON.stringify(selector)});
    if (!input || input.checked) return { checked: input?.checked ?? null };
    input.click();
    return { checked: input.checked };
  })()`)
  assert.deepEqual(result, { checked: true }, `Could not affirm ${selector}`)
}

async function hashProject(projectPath) {
  const files = []
  async function collect(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) await collect(path)
      else if (entry.isFile()) files.push(path)
    }
  }
  await collect(projectPath)
  files.sort((left, right) => left.localeCompare(right, 'en'))
  const manifestPath = join(projectPath, '.project-generator', 'manifest.json')
  const artifact = createHash('sha256')
  for (const path of files) {
    if (path === manifestPath) continue
    artifact.update(path.slice(projectPath.length + 1).replaceAll('\\', '/'))
    artifact.update('\0')
    artifact.update(await readFile(path))
    artifact.update('\0')
  }
  return {
    generatedTreeSha256: artifact.digest('hex'),
    manifestSha256: createHash('sha256').update(await readFile(manifestPath)).digest('hex'),
    generatedFileCount: files.length - 1,
    files: files.map((path) => path.slice(projectPath.length + 1).replaceAll('\\', '/')),
  }
}

async function inspectIsolatedRecovery(jobId) {
  if (!isolatedLocalAppData || (jobId !== undefined && !/^[0-9a-f-]{36}$/i.test(jobId))) return null
  const previous = process.env.LOCALAPPDATA
  process.env.LOCALAPPDATA = isolatedLocalAppData
  try {
    const reports = await inspectRecovery(jobId)
    return reports.map(({ jobId: reportJobId, phase, state, canFinalize, canCleanupStage, canDiscardJournal }) => ({
      jobId: /^[0-9a-f-]{36}$/i.test(reportJobId) ? reportJobId : 'unknown',
      phase: typeof phase === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(phase) ? phase : 'unknown',
      state: typeof state === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(state) ? state : 'unknown',
      canFinalize: canFinalize === true,
      canCleanupStage: canCleanupStage === true,
      canDiscardJournal: canDiscardJournal === true,
    }))
  } finally {
    if (previous === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = previous
  }
}

async function readSupervisorRecords(jobId) {
  if (!isolatedTemp) return { diagnostic: null, diagnosticRaw: null, cancelled: null }
  let directories
  try { directories = await readdir(isolatedTemp, { withFileTypes: true }) } catch { return { diagnostic: null, diagnosticRaw: null, cancelled: null } }
  let diagnostic
  let diagnosticRaw
  let cancelled
  for (const directory of directories) {
    if (!directory.isDirectory() || !directory.name.startsWith('project-generator-job-')) continue
    let files
    try { files = await readdir(join(isolatedTemp, directory.name)) } catch { continue }
    for (const file of files) {
      if (!file.endsWith('.log')) continue
      let lines
      try { lines = (await readFile(join(isolatedTemp, directory.name, file), 'utf8')).split(/\r?\n/) } catch { continue }
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line)
          const safeDiagnostic = safeSupervisorDiagnostic(parsed)
          if (safeDiagnostic && (jobId === undefined || safeDiagnostic.jobId === jobId)) {
            diagnostic = safeDiagnostic
            diagnosticRaw = parsed
          }
          const safeResult = safeSupervisorProcessResult(parsed)
          if (safeResult && (jobId === undefined || safeResult.jobId === jobId)) cancelled = { result: safeResult, raw: parsed }
        } catch {}
      }
    }
  }
  return { diagnostic, diagnosticRaw, cancelled }
}

async function readLatestSupervisorDiagnostic(jobId = 'unknown') {
  return (await readSupervisorRecords(jobId === 'unknown' ? undefined : jobId)).diagnostic
}

async function failurePostconditions(terminal, diagnostic, targetName = generatedName) {
  const names = await readdir(parent)
  const stages = names.filter((name) => name.startsWith('.project-generator-stage-'))
  const recovery = await inspectIsolatedRecovery(terminal?.jobId ?? diagnostic?.jobId ?? 'unknown').catch(() => null)
  return {
    destinationAbsent: !existsSync(join(parent, targetName)),
    ownedStagingCount: stages.length,
    ownedStagingRetained: stages.length > 0,
    recovery: recovery === null ? 'unverified' : recovery,
    isolation: 'fresh run-owned app-data and workspace; prior recovery/journal state not accessed',
  }
}

async function chooseGoBackend(name, modulePath, testInvalidPath = false) {
  await waitFor("document.querySelector('#project-name') !== null", `${name} details`)
  await fill('#project-name', name)
  await fill('#project-parent', parent)
  await click('.wizard-actions .primary-button', 'Choose framework')
  await waitFor("[...document.querySelectorAll('.compact-choice')].some((button) => button.textContent.includes('Backend'))", `${name} project types`)
  await click('.compact-choice', 'Backend')
  await click('.select-card', 'net/http')
  await click('.wizard-actions .primary-button', 'Choose tools')
  await waitFor("document.querySelector('#go-module-path') !== null", `${name} Go module path`)
  if (testInvalidPath) {
    for (const invalidPath of invalidModulePaths) {
      await fill('#go-module-path', invalidPath)
      const invalidState = await evaluate(`({
        invalid: document.querySelector('#go-module-path').getAttribute('aria-invalid') === 'true',
        nextDisabled: [...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Documentation') && button.disabled),
        error: document.querySelector('#go-module-path-error')?.textContent,
      })`)
      assert.equal(invalidState.invalid, true, invalidPath)
      assert.equal(invalidState.nextDisabled, true, invalidPath)
      assert.match(invalidState.error ?? '', /valid Go module path/, invalidPath)
    }
  }
  await fill('#go-module-path', modulePath)
  await click('.wizard-actions .primary-button', 'Documentation')
  await click('.docs-card', 'Standard')
  await click('.wizard-actions .primary-button', 'Review configuration')
}

async function reviewGo(name, modulePath, validatePath = false) {
  await chooseGoBackend(name, modulePath, validatePath)
  await waitFor("document.body.innerText.includes('BE-02') && document.body.innerText.includes('Go Modules')", `${name} BE-02 review plan`)
  await click('summary', 'Expected project files')
  return await evaluate(`({
    text: document.body.innerText,
    doctor: [...document.querySelectorAll('.doctor-row')].map((row) => row.innerText),
    lifecycleConsentPresent: document.querySelector('.consent-box') !== null,
    lifecycleHint: document.body.innerText.includes('No dependency lifecycle scripts'),
    plannedUnchecked: document.querySelector('.internal-consent input')?.checked === false,
    createDisabled: [...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && button.disabled),
  })`)
}

async function readTerminalMetadata() {
  return evaluate(`(() => {
    const event = document.querySelector('#generation-terminal-metadata')
    if (!event?.dataset.jobId) return null
    return {
      eventType: event.dataset.eventType,
      jobId: event.dataset.jobId,
      status: event.dataset.jobStatus,
      errorCode: event.dataset.errorCode,
      stageId: event.dataset.stageId,
      diagnosticRef: event.dataset.diagnosticRef,
      childProcessState: event.dataset.childProcessState,
    }
  })()`)
}

async function startFocusedGeneration(name, modulePath, fromResultPage = false) {
  if (fromResultPage) await click('.result-next .primary-button', 'Create another')
  else await click('.hero-actions .primary-button', 'Create project')
  const review = await reviewGo(name, modulePath)
  assert.ok(review.text.includes('planned'))
  assert.ok(review.text.includes('Go · net/http'))
  assert.ok(review.text.includes(`Module: ${modulePath}`))
  assert.equal(review.plannedUnchecked, true)
  assert.equal(review.createDisabled, true)
  await setCheckbox('.internal-consent input')
  const consentState = await evaluate(`({
    checked: document.querySelector('.internal-consent input')?.checked ?? null,
    buttons: [...document.querySelectorAll('.wizard-actions .primary-button')].map((button) => ({ text: button.textContent.trim(), disabled: button.disabled })),
  })`)
  assert.equal(consentState.checked, true, `${name} planned consent state: ${JSON.stringify(consentState)}`)
  assert.ok(consentState.buttons.some((button) => button.text.includes('Create project') && !button.disabled), `${name} evidence consent did not enable create: ${JSON.stringify(consentState)}`)
  generationAttemptStarted = true
  await click('.wizard-actions .primary-button', 'Create project')
  await waitFor("document.querySelector('#generation-title') !== null", `${name} Tauri generation start`)
}

async function verifyFocusedSuccess(terminal, name, modulePath) {
  await waitFor("document.querySelector('#result-title')?.textContent.includes('Project checks passed')", `${name} completed result page`)
  const projectPath = join(parent, name)
  const targetInfo = await lstat(projectPath)
  assert.ok(targetInfo.isDirectory())
  assert.equal(targetInfo.isSymbolicLink(), false)
  const actualTarget = (await realpath(projectPath)).replace(/^\\\\\?\\/, '')
  assert.equal(win32.resolve(actualTarget).toLowerCase(), win32.resolve(projectPath).toLowerCase())
  const manifestPath = join(projectPath, '.project-generator', 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.equal(manifest.recipeId, 'BE-02')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.projectName, name)
  assert.equal(manifest.projectType, 'backend')
  assert.equal(manifest.packageManager, 'go-modules')
  assert.equal(manifest.modulePath, modulePath)
  assert.deepEqual(manifest.dependencyFiles, ['go.mod'])
  assert.equal(manifest.lockfiles, undefined)
  assert.equal(await readFile(join(projectPath, 'go.mod'), 'utf8'), `module ${modulePath}\n\ngo 1.22.0\n`)
  await assert.rejects(access(join(projectPath, 'go.sum')))
  for (const check of ['go-module', 'go-fmt', 'go-vet', 'go-test', 'go-build', 'http-smoke']) {
    assert.equal(manifest.validation.find((item) => item.id === check)?.status, 'pass', check)
  }
  const artifactHashes = await hashProject(projectPath)
  assert.deepEqual([...manifest.generatedFiles].sort((a, b) => a.localeCompare(b, 'en')), artifactHashes.files)
  assert.ok(artifactHashes.files.includes('.project-generator/manifest.json'))
  assert.ok(artifactHashes.files.includes('go.mod'))
  assert.equal(artifactHashes.generatedFileCount, manifest.generatedFiles.length - 1)
  const recovery = await inspectIsolatedRecovery(terminal.jobId)
  assert.deepEqual(recovery, [])
  assert.equal((await readdir(parent)).some((entry) => entry.startsWith('.project-generator-stage-')), false)
  return {
    jobId: terminal.jobId,
    terminalStatus: terminal.status,
    stageId: terminal.stageId,
    targetName: name,
    targetIsDirectory: true,
    manifestConsistentWithFiles: true,
    validations: manifest.validation.map(({ id, status }) => ({ id, status })),
    artifactHashes,
    recovery,
    ownedStagingCount: 0,
  }
}

async function runFocusedAcceptanceFlow() {
  const runtime = await evaluate('document.body.innerText')
  assert.ok(runtime.includes('LOCAL DEVELOPMENT'))
  assert.ok(runtime.includes('No release approval'))
  preflightComplete = true
  focusedEvidence.host = `${process.platform}-${process.arch}`
  focusedEvidence.goVersion = goVersion

  collisionPath = join(parent, collisionName)
  await mkdir(collisionPath)
  sentinelPath = join(collisionPath, 'keep.txt')
  await writeFile(sentinelPath, 'preserve this file\n', { flag: 'wx' })
  sentinelHash = createHash('sha256').update(await readFile(sentinelPath)).digest('hex')

  await click('.nav-item', 'Overview')
  await waitFor("document.querySelector('.hero-actions .primary-button') && !document.querySelector('.hero-actions .primary-button').disabled", 'Forge Studio home and packaged catalog')
  preflightStage = 'supervisor-fault-ui'
  await startFocusedGeneration(faultName, faultModule)
  let injectedFailure
  try {
    await waitForTerminalGeneration(readTerminalMetadata, { timeoutMs: 20 * 60 * 1000 })
  } catch (error) {
    injectedFailure = error
  }
  const failedTerminal = safeTerminalMetadata(injectedFailure?.terminal)
  assert.ok(injectedFailure, 'controlled native start failure must terminate unsuccessfully')
  assert.equal(failedTerminal?.status, 'failed')
  assert.equal(failedTerminal?.errorCode, 'GEN_PROCESS_SUPERVISOR_FAILED')
  assert.equal(failedTerminal?.stageId, 'validating')
  assert.equal(failedTerminal?.childProcessState, 'none')
  assert.match(failedTerminal?.diagnosticRef ?? '', /^supdiag-/)
  const faultRecords = await readSupervisorRecords(failedTerminal.jobId)
  const diagnostic = faultRecords.diagnostic
  const rawDiagnostic = faultRecords.diagnosticRaw
  assert.equal(diagnostic?.failureCategory, 'process_start_failure')
  assert.equal(diagnostic?.started, false)
  assert.equal(diagnostic?.terminationConfirmed, true)
  assert.equal(diagnostic?.osErrorCategory, 'access_denied')
  assert.equal(diagnostic?.osErrorCode, 5)
  assert.equal(diagnostic?.activeProcessState, 'none')
  assert.equal(diagnostic?.diagnosticRef, failedTerminal.diagnosticRef)
  assert.deepEqual(Object.keys(rawDiagnostic ?? {}).sort(), [
    'activeChildProcessCount', 'childExitCode', 'diagnosticRef', 'failureCategory', 'jobId', 'schemaVersion',
    'stageId', 'started', 'supervisorExitCode', 'supervisorResponseStatus', 'systemError', 'terminationConfirmed', 'timestamp', 'type',
  ].sort())
  assert.deepEqual(Object.keys(rawDiagnostic.systemError).sort(), ['category', 'code'])
  assert.equal(JSON.stringify(rawDiagnostic).includes(runRoot), false)
  assert.equal(JSON.stringify(rawDiagnostic).includes('command'), false)
  assert.equal(JSON.stringify(rawDiagnostic).includes('environment'), false)
  assert.equal(existsSync(join(isolatedTemp, 'phase-08a5-supervisor-fault-consumed')), true)
  const faultPostconditions = await failurePostconditions(failedTerminal, diagnostic, faultName)
  assert.equal(faultPostconditions.destinationAbsent, true)
  assert.equal(faultPostconditions.ownedStagingCount, 0)
  assert.deepEqual(faultPostconditions.recovery, [])
  focusedEvidence.tests.supervisorStartFailure = {
    status: 'PASS',
    jobId: failedTerminal.jobId,
    terminal: failedTerminal,
    diagnostic,
    postconditions: faultPostconditions,
    rawDiagnosticRedacted: true,
  }

  preflightStage = 'successful-finalization-ui'
  await startFocusedGeneration(generatedName, generatedModule, true)
  const successfulTerminal = await waitForTerminalGeneration(readTerminalMetadata, { timeoutMs: 20 * 60 * 1000 })
  focusedEvidence.tests.finalization = { status: 'PASS', ...(await verifyFocusedSuccess(successfulTerminal, generatedName, generatedModule)) }

  preflightStage = 'cancellation-ui'
  await startFocusedGeneration(cancelledName, `example.com/${cancelledName}`, true)
  await waitFor("document.body.innerText.includes('go.mod parsed with')", 'Go validation before cancellation', 2 * 60 * 1000)
  await click('.cancel-row .danger-button', 'Cancel generation')
  let cancellationFailure
  try {
    await waitForTerminalGeneration(readTerminalMetadata, { timeoutMs: 3 * 60 * 1000 })
  } catch (error) {
    cancellationFailure = error
  }
  const cancelledTerminal = safeTerminalMetadata(cancellationFailure?.terminal)
  assert.ok(cancellationFailure, 'native cancellation must produce non-success terminal event')
  assert.equal(cancelledTerminal?.status, 'cancelled')
  assert.equal(cancelledTerminal?.errorCode, 'GEN_CANCELLED')
  const cancellationRecords = await readSupervisorRecords(cancelledTerminal.jobId)
  const cancellation = cancellationRecords.cancelled?.result
  assert.equal(cancellation?.cancelled, true)
  assert.equal(cancellation?.started, true)
  assert.equal(typeof cancellation?.childExitCode, 'number')
  assert.equal(cancellation?.terminationConfirmed, true)
  assert.equal(cancellation?.activeChildProcessCount, 0)
  const cancelPostconditions = await failurePostconditions(cancelledTerminal, undefined, cancelledName)
  assert.equal(cancelPostconditions.destinationAbsent, true)
  assert.equal(cancelPostconditions.ownedStagingCount, 0)
  assert.deepEqual(cancelPostconditions.recovery, [])
  assert.equal(JSON.stringify(cancellationRecords.cancelled.raw).includes(runRoot), false)
  focusedEvidence.tests.cancellation = {
    status: 'PASS',
    jobId: cancelledTerminal.jobId,
    terminal: cancelledTerminal,
    supervisorResult: cancellation,
    postconditions: cancelPostconditions,
    pidSpecificCausalityClaimed: false,
  }

  preflightStage = 'collision-ui'
  await click('.result-next button', 'Inspect recovery')
  await waitFor("document.querySelector('.recovery-details pre') !== null", 'cancellation recovery inspection')
  const recoveryText = await evaluate("document.querySelector('.recovery-details pre')?.textContent ?? null")
  assert.deepEqual(JSON.parse(recoveryText ?? 'null'), [])
  const recoveryBeforeCollision = await inspectIsolatedRecovery()
  await click('.result-next .primary-button', 'Create another')
  const collisionReview = await reviewGo(collisionName, `example.com/${collisionName}`)
  assert.ok(collisionReview.text.includes('BLOCKED'))
  assert.ok(collisionReview.text.includes('already exists'))
  assert.equal(collisionReview.createDisabled, true)
  assert.equal(createHash('sha256').update(await readFile(sentinelPath)).digest('hex'), sentinelHash)
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])
  assert.deepEqual(await inspectIsolatedRecovery(), recoveryBeforeCollision)
  focusedEvidence.tests.collision = {
    status: 'PASS',
    targetRejected: true,
    sentinelSha256: sentinelHash,
    sentinelUnchanged: true,
    ownedStagingCount: 0,
    recoveryUnchanged: true,
  }

  focusedEvidence.status = 'PASS WITH FINDINGS'
  focusedEvidence.findings = [
    'Controlled start-failure injection validates response/error propagation, not historical root cause.',
    'Cancellation records supervisor-reported child exit and Job Object termination; no PID-specific causal claim.',
    'Historical shared finalization anomaly remains outside this focused current-tree scope.',
  ]
  focusedEvidence.runRoot = runRoot
}

async function runAcceptance() {
  if (goToolError) {
    preflightStage = 'go-toolchain'
    throw new Error(goToolError)
  }
  if (phase08a5Focused) {
    await prepareDiagnosticIsolation()
    await waitFor("document.querySelector('.nav-item') !== null", 'Forge Studio navigation')
    await waitFor("document.querySelector('.hero-actions .primary-button') && !document.querySelector('.hero-actions .primary-button').disabled", 'Forge Studio home and packaged catalog')
    await runFocusedAcceptanceFlow()
    return
  }
  if (diagnosticOnly || phase08b1) {
    await prepareDiagnosticIsolation()
  } else {
    await access(hostTempBase)
    assert.ok((await stat(hostTempBase)).isDirectory())
    tempBase = hostTempBase
    parent = await mkdtemp(join(tempBase, 'phase-05b-native-e2e-20261115 spaces-雪-'))
    collisionPath = join(parent, collisionName)
    await mkdir(collisionPath)
    sentinelPath = join(collisionPath, 'keep.txt')
    await writeFile(sentinelPath, 'preserve this file\n')
    sentinelHash = createHash('sha256').update(await readFile(sentinelPath)).digest('hex')
    await connectDevTools(await waitForDevTools())
    localStorageSnapshot = await evaluate('Array.from({length: localStorage.length}, (_, i) => { const key = localStorage.key(i); return [key, localStorage.getItem(key)] })')
  }

  await waitFor("document.querySelector('.nav-item') !== null", 'Forge Studio navigation')
  await waitFor("document.querySelector('.hero-actions .primary-button') && !document.querySelector('.hero-actions .primary-button').disabled", 'Forge Studio home and packaged catalog')
  if (diagnosticOnly || phase08b1) {
    const runtime = await evaluate('document.body.innerText')
    assert.ok(runtime.includes('LOCAL DEVELOPMENT'))
    assert.ok(runtime.includes('No release approval'))
    if (phase08b3) {
      preflightStage = 'supervisor-launch-provenance'
      preflightEvidence.supervisorLaunchIdentity = await verifyPreGenerationSupervisorIdentity()
    }
  }
  preflightStage = 'generation-review'
  await click('.nav-item', 'Overview')
  await waitFor("document.querySelector('.hero-actions .primary-button') && !document.querySelector('.hero-actions .primary-button').disabled", 'Forge Studio home and packaged catalog')
  await click('.hero-actions .primary-button', 'Create project')
  const initialReview = await reviewGo(generatedName, generatedModule, !(diagnosticOnly || phase08b1))
  assert.ok(initialReview.text.includes('planned'))
  assert.ok(initialReview.text.includes('Go · net/http'))
  assert.ok(initialReview.text.includes('Module: ' + generatedModule))
  assert.ok(initialReview.text.includes('go.mod'))
  assert.ok(initialReview.text.includes('Network operations (0)'))
  assert.ok(initialReview.text.includes('No dependency lifecycle scripts'))
  assert.ok(initialReview.doctor.some((row) => row.includes(`Go · ${goVersion}`) && row.includes('Ready')), `Go Doctor row missing: ${JSON.stringify(initialReview.doctor)}`)
  assert.equal(initialReview.lifecycleConsentPresent, false)
  assert.equal(initialReview.lifecycleHint, true)
  assert.equal(initialReview.plannedUnchecked, true)
  assert.equal(initialReview.createDisabled, true)
  await setCheckbox('.internal-consent input')
  await waitFor("[...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && !button.disabled)", 'planned-only Go evidence authorization')
  preflightComplete = true
  preflightStage = 'ready-to-generate'

  await runNativeGenerationFlow({
    diagnosticOnly,
    runGeneration: async () => {
      generationAttemptStarted = true
      await click('.wizard-actions .primary-button', 'Create project')
      await waitFor("document.querySelector('#generation-title') !== null", 'Tauri Go CLI generation start')
      const terminal = await waitForTerminalGeneration(async () => evaluate(`(() => {
        const event = document.querySelector('#generation-terminal-metadata')
        if (!event) return null
        return {
          eventType: event.dataset.eventType,
          jobId: event.dataset.jobId,
          status: event.dataset.jobStatus,
          errorCode: event.dataset.errorCode,
          stageId: event.dataset.stageId,
          diagnosticRef: event.dataset.diagnosticRef,
          childProcessState: event.dataset.childProcessState,
        }
      })()`), { timeoutMs: 20 * 60 * 1000 }).catch(async (error) => {
        if (diagnosticOnly || phase08b1) throw error
        throw new Error(`${error.message}\nPage text:\n${await evaluate('document.body.innerText.slice(-5000)')}`)
      })
      generationTerminal = terminal
      if (phase08b3) {
        supervisorLaunchEvidenceAfterGeneration = verifySupervisorLaunchEvidence(await readSupervisorLaunchEvidence())
        assert.ok(supervisorLaunchEvidenceAfterGeneration.some(({ mode }) => mode === '--run'), 'native generation did not record a launched generation supervisor')
      }
      preflightStage = 'generation-result-verification'
      return terminal
    },
    verifySuccess: async (terminal) => {
      await waitFor("document.querySelector('#result-title')?.textContent.includes('Project checks passed')", 'BE-02 completed result page')
      const projectPath = join(parent, generatedName)
      manifest = JSON.parse(await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8'))
      assert.equal(manifest.recipeId, 'BE-02')
      assert.equal(manifest.recipeStatusAtCreation, 'planned')
      assert.equal(manifest.projectType, 'backend')
      assert.equal(manifest.packageManager, 'go-modules')
      assert.equal(manifest.modulePath, generatedModule)
      assert.deepEqual(manifest.dependencyFiles, ['go.mod'])
      assert.equal(manifest.lockfiles, undefined)
      assertGoValidationResults(manifest.validation)
      assert.equal(await readFile(join(projectPath, 'go.mod'), 'utf8'), `module ${generatedModule}\n\ngo 1.22.0\n`)
      await assert.rejects(access(join(projectPath, 'go.sum')))
      assert.equal((await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8')).includes('npm'), false)
      const validations = await evaluate("[...document.querySelectorAll('.validation-list li')].map((item) => item.textContent.trim())")
      assert.equal(validations.length, 7)
      assert.ok(validations.some((line) => line.includes('http-smoke')))
      assert.ok((await evaluate('document.body.innerText')).includes('Recipe remains planned.'))
      artifactHashes = await hashProject(projectPath)
      if (diagnosticOnly || phase08b1) {
        assert.deepEqual(await readdir(parent), [generatedName])
        const recovery = await inspectIsolatedRecovery(terminal.jobId)
        assert.deepEqual(recovery, [])
        const targetInfo = await lstat(projectPath)
        const actualTarget = (await realpath(projectPath)).replace(/^\\\\\?\\/, '')
        assert.ok(targetInfo.isDirectory())
        assert.equal(targetInfo.isSymbolicLink(), false)
        assert.equal(win32.resolve(actualTarget).toLowerCase(), win32.resolve(projectPath).toLowerCase())
        const parentEntries = await readdir(parent)
        const ownedStagingCount = parentEntries.filter((entry) => entry.startsWith('.project-generator-stage-')).length
        diagnosticResult = {
          status: 'PASS',
          phase: phase08b1 ? phase08bPhase : '08A.7',
          preflight: 'GO',
          nativeGeneration: 'PASS',
          generationAttempts: 1,
          automaticRetries: 0,
          jobId: terminal.jobId,
          terminalStatus: terminal.status,
          generationJobExitCode: terminal.status === 'completed' ? 0 : null,
          stageId: terminal.stageId,
          recipe: manifest.recipeId,
          recipeStatus: manifest.recipeStatusAtCreation,
          validations: manifest.validation.map(({ id, status, exitCode }) => ({ id, status, exitCode: exitCode ?? null })),
          artifactHashes,
          recovery,
          filesystem: {
            destinationPresent: true,
            destinationIsDirectory: true,
            destinationIsSymlink: false,
            destinationCanonical: true,
            parentEntries,
            ownedStagingCount,
            priorCollisionSentinelAccessed: false,
            runRootRetainedForEvidence: true,
          },
          collisionSentinel: 'not accessed; prior sentinel isolated from fresh workspace',
          priorFailureArtifactsPreserved: true,
          raceCreateAndProtectedDiagnosticsAccessed: false,
          rootCause: 'UNKNOWN',
          promotion: 'NO-GO',
          releaseApproved: false,
        }
      }
    },
    runDefaultChecks: async () => {
      await click('.result-actions button', 'Open folder')
      await delay(750)
      assert.equal(await evaluate("document.querySelector('[role=alert]')?.textContent ?? null"), null, 'Open Folder returned a desktop error.')
      const canOpenCode = await evaluate("[...document.querySelectorAll('.result-actions button')].some((button) => button.textContent.includes('Open in VS Code'))")
      const openInCode = canOpenCode && process.env.PG_NATIVE_E2E_SKIP_VSCODE !== '1'
      if (phase08b1 && Boolean(hostVsCodeExecutable) !== canOpenCode) throw new Error('VS Code availability did not match isolated host preflight.')
      let vscodeEvidence = { status: hostVsCodeExecutable ? 'NOT VERIFIED' : 'NOT AVAILABLE' }
      if (openInCode) {
        vscodeLaunchAttempted = true
        await click('.result-actions button', 'Open in VS Code')
        let ownedProcesses
        let closed
        try {
          ownedProcesses = await waitForOwnedVsCode(join(parent, generatedName))
          assert.equal(await evaluate("document.querySelector('[role=alert]')?.textContent ?? null"), null, 'Open in VS Code returned a desktop error.')
        } finally {
          closed = closeOwnedVsCode()
        }
        vscodeEvidence = {
          status: 'PASS',
          executableSha256: sha256File(hostVsCodeExecutable),
          processIds: ownedProcesses.map(({ processId }) => processId),
          projectArgumentVerified: ownedProcesses.some(({ projectArgument }) => projectArgument),
          userDataIsolated: ownedProcesses.every(({ isolatedProfile }) => isolatedProfile),
          extensionsDisabled: ownedProcesses.some(({ projectArgument, extensionsDisabled, isolatedExtensions }) => projectArgument && extensionsDisabled && isolatedExtensions),
          processExitedGracefully: closed.remaining === 0,
        }
      }
      await click('.nav-item', 'Recent projects')
      await waitFor("document.querySelector('#projects-title') !== null", 'BE-02 history record')
      const history = await evaluate('document.body.innerText')
      assert.ok(history.includes(generatedName))
      assert.ok(history.includes('BE-02'))

      if (phase08b1) {
        diagnosticResult.openActions = {
          openFolder: 'PASS',
          history: 'PASS',
          openVsCode: vscodeEvidence,
        }
        diagnosticResult.openActionsPath = '<run-owned>/workspace/pg-be-02-go'
        allChecksComplete = true
        console.log(JSON.stringify({
          phase: phase08bPhase,
          recipe: manifest.recipeId,
          jobId: generationTerminal?.jobId,
          resultAndHistory: 'PASS',
          openFolder: 'PASS',
          openVsCode: vscodeEvidence,
          generationAttempts: 1,
          automaticRetries: 0,
          historicalUnknowns: {
            supervisorFailure: 'UNKNOWN',
            cleanupFailure: 'UNKNOWN',
            currentRunDoesNotResolveHistoricalCauses: true,
            riskOwnerDecision: 'PENDING',
          },
          residualRisks: [
            'Prior supervisor failure source, executable, and causal mechanism remain unverified.',
            'Prior cleanup failure cause remains unverified; this run covers only current-run cleanup.',
          ],
          phase08a4: 'MISSING; not searched',
          releaseApproved: false,
        }, null, 2))
        return
      }

      await click('.page-heading .primary-button', 'Create project')
      await reviewGo(cancelledName, `example.com/${cancelledName}`)
      await setCheckbox('.internal-consent input')
      await click('.wizard-actions .primary-button', 'Create project')
      await waitFor("document.querySelector('#generation-title') !== null", 'Tauri cancellation run start')
      await waitFor("document.body.innerText.includes('go.mod parsed with')", 'Go validation began before cancellation', 2 * 60 * 1000)
      await click('.cancel-row .danger-button', 'Cancel generation')
      await waitFor("document.querySelector('#result-title')?.textContent.includes('Generation cancelled')", 'Tauri Go cancellation result', 3 * 60 * 1000)
      await assert.rejects(access(join(parent, cancelledName)))
      assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])
      await click('.result-next button', 'Inspect recovery')
      await waitFor("document.querySelector('.recovery-details pre') !== null", 'read-only recovery inspection result')
      const recoveryText = await evaluate("document.querySelector('.recovery-details pre')?.textContent ?? null")
      const recoveryReports = JSON.parse(recoveryText ?? 'null')
      assert.ok(Array.isArray(recoveryReports), `Expected recovery report array, got ${JSON.stringify(recoveryText)}`)
      const cancellationReports = recoveryReports.filter((report) => Object.values(report).some((value) => typeof value === 'string' && value.toLowerCase().includes(cancelledName.toLowerCase())))
      assert.deepEqual(cancellationReports, [], `BE-02 cancellation left a recovery record: ${JSON.stringify(cancellationReports)}`)

      await click('.result-next .primary-button', 'Create another')
      const collisionReview = await reviewGo(collisionName, `example.com/${collisionName}`)
      assert.ok(collisionReview.text.includes('BLOCKED'))
      assert.ok(collisionReview.text.includes('already exists'))
      assert.equal(collisionReview.createDisabled, true)
      assert.equal(createHash('sha256').update(await readFile(sentinelPath)).digest('hex'), sentinelHash)
      assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])

      allChecksComplete = true
      console.log(JSON.stringify({
        phase: '05B',
        flow: 'Windows Forge Studio + Tauri + packaged development CLI',
        host: `${process.platform}-${process.arch}`,
        go: goVersion,
        recipe: manifest.recipeId,
        modulePath: manifest.modulePath,
        validations: manifest.validation.map(({ id, status }) => ({ id, status })),
        lifecycleConsent: 'not shown or required; no external modules',
        plannedConsent: 'closed by default; explicitly affirmed for evidence generation',
        resultAndHistory: 'pass; planned status retained',
        openFolder: 'pass',
        openVsCode: openInCode ? 'pass' : process.env.PG_NATIVE_E2E_SKIP_VSCODE === '1' ? 'intentionally skipped to preserve user profile' : 'skipped; VS Code unavailable',
        artifactHashes,
        cancellation: 'reached Go validation; target absent; owned staging cleaned; no BE-02 recovery record',
        unrelatedRecoveryReports: recoveryReports.map(({ jobId, state, phase }) => ({ jobId, state, phase })),
        collision: 'blocked in Doctor; sentinel preserved; no staging',
        releaseApproved: false,
      }, null, 2))
    },
    cleanup: cleanupRun,
  })
}

try {
  await runAcceptance()
} catch (cause) {
  if (phase08a5Focused) {
    focusedEvidence ??= { phase: '08A.5', tests: {} }
    focusedEvidence.status = preflightComplete ? 'FAIL' : 'BLOCKED'
    focusedEvidence.blockingReason = preflightComplete ? 'focused_acceptance_failed' : 'isolation_or_instrumentation_preflight_failed'
    focusedEvidence.failureCode = typeof cause?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(cause.code) ? cause.code : 'NATIVE_ACCEPTANCE_FAILED'
    focusedEvidence.failureStage = preflightStage
    focusedEvidence.failureSummary = safeFailureSummary(cause)
    focusedEvidence.runRoot = runRoot
    process.exitCode = 1
  } else if (!diagnosticOnly && !phase08b1) throw cause
  else {
  const terminal = safeTerminalMetadata(cause?.terminal ?? generationTerminal)
  const diagnostic = await readLatestSupervisorDiagnostic(terminal?.jobId ?? 'unknown')
  const failureMetadata = safeFailureMetadata(terminal, diagnostic)
  let postconditions
  if (generationAttemptStarted && parent) postconditions = await failurePostconditions(terminal, diagnostic).catch(() => ({ verified: false }))
  else postconditions = { destinationCreated: false, targetParentWasRunOwned: Boolean(parent), recovery: 'no generation job to inspect' }
  const failure = {
    status: preflightComplete ? 'FAIL' : 'BLOCKED',
    phase: phase08b1 ? phase08bPhase : '08A.7',
    preflight: preflightComplete ? 'GO' : 'BLOCKED',
    nativeGeneration: generationAttemptStarted ? 'FAIL' : 'NOT RUN',
    automaticRetries: 0,
    blockingReason: preflightComplete ? undefined : goToolError ? 'go_preflight_failed'
      : preflightStage === 'source-inventory' ? 'source_inventory_failed' : 'isolation_or_instrumentation_preflight_failed',
    failureStage: preflightStage,
    failureCode: typeof cause?.code === 'string' && /^[A-Z0-9_]{1,80}$/.test(cause.code) ? cause.code : 'NATIVE_ACCEPTANCE_FAILED',
    failureSummary: safeFailureSummary(cause),
    generationAttempts: generationAttemptStarted ? 1 : 0,
    jobId: failureMetadata.jobId,
    stageId: failureMetadata.stageId,
    terminalStatus: failureMetadata.terminalStatus,
    publicErrorCode: failureMetadata.publicErrorCode,
    diagnosticRef: failureMetadata.diagnosticRef,
    started: diagnostic?.started ?? null,
    exitCode: diagnostic?.childExitCode ?? null,
    supervisorExitCode: diagnostic?.supervisorExitCode ?? null,
    terminationConfirmed: diagnostic?.terminationConfirmed ?? null,
    osErrorCategory: diagnostic?.osErrorCategory ?? 'unknown',
    osErrorCode: diagnostic?.osErrorCode ?? null,
    activeProcessState: failureMetadata.activeProcessState,
    supervisor: diagnostic,
    timeout: cause?.code === 'NATIVE_GENERATION_TIMEOUT',
    postconditions,
    priorFailureArtifactsPreserved: true,
    raceCreateAndProtectedDiagnosticsAccessed: false,
    rootCause: 'UNKNOWN',
    promotion: 'NO-GO',
    releaseApproved: false,
  }
  if (phase08b1 && diagnosticResult) {
    Object.assign(diagnosticResult, {
      status: 'FAIL',
      failureStage: preflightStage,
      failureCode: typeof cause?.code === 'string' ? cause.code : 'NATIVE_ACCEPTANCE_FAILED',
      failureSummary: safeFailureSummary(cause),
      ...(diagnosticResult.nativeGeneration === 'PASS' ? {} : { postconditions }),
    })
  } else diagnosticResult = failure
  process.exitCode = 1
  }
} finally {
  let cleanupFailed = false
  try { await cleanupRun() } catch (error) {
    cleanupFailed = true
    cleanupFailures = Array.isArray(error?.cleanupFailures)
      ? error.cleanupFailures
      : [safeCleanupFailure('cleanup-run', error)]
    process.exitCode = 1
  }
  if (phase08a5Focused) {
    if (focusedEvidence) {
      focusedEvidence.cleanup = cleanupFailed ? 'FAIL' : 'PASS'
      focusedEvidence.acceptanceProcessesRemaining = cleanupFailed ? 'unknown' : 0
      focusedEvidence.releaseBuildProfile = releaseBuildRestored ? 'release' : 'NOT VERIFIED'
      focusedEvidence.portsAvailableAfterRun = cleanupFailed ? 'unknown' : [1420, debugPort]
      focusedEvidence.cleanupFailures = cleanupFailures
      focusedEvidence.rootCause ??= 'UNKNOWN'
      focusedEvidence.promotion = 'NO-GO'
      focusedEvidence.releaseApproved = false
      focusedEvidence.raceCreateAndProtectedDiagnosticsAccessed = false
      if (cleanupFailed) focusedEvidence.status = 'FAIL'
      if (runRoot) {
        try { await writeFile(join(runRoot, 'phase-08a5-report.json'), `${JSON.stringify(focusedEvidence, null, 2)}\n`) } catch (error) {
          cleanupFailed = true
          cleanupFailures.push(safeCleanupFailure('write-run-report', error))
          focusedEvidence.cleanupFailures = cleanupFailures
        }
      }
      if (cleanupFailed) {
        focusedEvidence.cleanup = 'FAIL'
        process.exitCode = 1
      }
      const output = JSON.stringify(focusedEvidence, null, 2)
      if (focusedEvidence.status === 'PASS WITH FINDINGS') console.log(output)
      else console.error(output)
    }
  } else if (diagnosticOnly || phase08b1) {
    if (diagnosticResult) {
      const repositorySupervisorSha256After = sha256File(join(root, 'packages', 'core', 'native', 'pg-windows-supervisor.exe'))
      const repositoryPathVerifierSha256After = sha256File(join(root, 'packages', 'core', 'native', 'pg-db-path-verifier.exe'))
      const repositoryStagedSupervisorSha256After = sha256File(join(root, 'packages', 'desktop', 'src-tauri', 'resources', 'pg-runtime', 'cli', 'node_modules', '@project-generator', 'core', 'native', 'pg-windows-supervisor.exe'))
      if (repositorySupervisorSha256Before && repositorySupervisorSha256After !== repositorySupervisorSha256Before) {
        cleanupFailed = true
        cleanupFailures.push(safeCleanupFailure('repository-supervisor-identity-postcondition', { code: 'SUPERVISOR_BINARY_CHANGED' }))
      }
      if (repositoryPathVerifierSha256Before && repositoryPathVerifierSha256After !== repositoryPathVerifierSha256Before) {
        cleanupFailed = true
        cleanupFailures.push(safeCleanupFailure('repository-path-verifier-identity-postcondition', { code: 'PATH_VERIFIER_BINARY_CHANGED' }))
      }
     if (phase08b1 && repositoryStagedSupervisorSha256Before && repositoryStagedSupervisorSha256After !== repositoryStagedSupervisorSha256Before) {
        cleanupFailed = true
        cleanupFailures.push(safeCleanupFailure('staged-supervisor-identity-postcondition', { code: 'SUPERVISOR_BINARY_CHANGED' }))
      }
      let sourceFingerprintAfter = null
      let sourceRevisionAfter = null
      if (phase08b1 && sourceFingerprintEvidence) {
        try {
          sourceFingerprintAfter = await fingerprintPhase08bInputs()
          sourceRevisionAfter = readSourceRevision()
          if (sourceFingerprintAfter.sha256 !== sourceFingerprintEvidence.sha256 || sourceRevisionAfter !== sourceRevision) {
            cleanupFailed = true
            cleanupFailures.push(safeCleanupFailure('source-stability-postcondition', { code: 'SOURCE_CHANGED' }))
          }
        } catch {
          cleanupFailed = true
          cleanupFailures.push(safeCleanupFailure('source-stability-postcondition', { code: 'SOURCE_CHANGED' }))
        }
      }
      const isolatedSupervisorPath = testResourceRoot
        ? join(testResourceRoot, 'cli', 'node_modules', '@project-generator', 'core', 'native', 'pg-windows-supervisor.exe')
        : null
      const isolatedSupervisorSha256After = isolatedSupervisorPath ? sha256File(isolatedSupervisorPath) : null
      const runtimeCorePackageSha256After = phase08b1 && testResourceRoot
        ? await hashDirectory(join(testResourceRoot, 'cli', 'node_modules', '@project-generator', 'core')).catch(() => null)
        : null
      if (phase08b1 && runtimeCorePackageSha256 && runtimeCorePackageSha256After !== runtimeCorePackageSha256) {
        cleanupFailed = true
        cleanupFailures.push(safeCleanupFailure('staged-runtime-identity-postcondition', { code: 'STAGED_RUNTIME_CHANGED' }))
      }
      diagnosticResult.phase = phase08b1 ? phase08bPhase : '08A.7'
      diagnosticResult.nativeCommand = phase08b1
        ? `node scripts/phase-05b-native-e2e.mjs ${phase08b3 ? '--phase-08b3' : '--phase-08b1'}`
        : 'node scripts/phase-05b-native-e2e.mjs --diagnostic-only'
      diagnosticResult.automaticRetries = 0
      diagnosticResult.host = `${process.platform}-${process.arch}`
      diagnosticResult.nodeVersion = process.version
      diagnosticResult.goVersion = goVersion ?? null
      diagnosticResult.goVersionProbeExitCode = goVersionProbeExitCode ?? null
      diagnosticResult.sourceFingerprint = phase08b1 ? sourceFingerprintEvidence?.sha256 ?? null : process.env.PG_PHASE08A7_SOURCE_FINGERPRINT
      diagnosticResult.sourceFingerprintScope = phase08b1 ? sourceFingerprintEvidence?.scope ?? null : undefined
      diagnosticResult.sourceFingerprintFileCount = phase08b1 ? sourceFingerprintEvidence?.fileCount ?? null : undefined
      diagnosticResult.sourceFingerprintAfter = phase08b1 ? sourceFingerprintAfter : undefined
      diagnosticResult.sourceRevision = phase08b1 ? sourceRevision ?? null : undefined
      diagnosticResult.sourceRevisionAfter = phase08b1 ? sourceRevisionAfter : undefined
      diagnosticResult.sourceStable = phase08b1 && sourceFingerprintAfter
        ? sourceFingerprintAfter.sha256 === sourceFingerprintEvidence?.sha256 && sourceRevisionAfter === sourceRevision
        : undefined
      diagnosticResult.head = phase08b1 ? sourceRevision ?? null : process.env.PG_PHASE08A7_HEAD ?? null
      diagnosticResult.provenance = {
        harnessSha256: sha256File(join(root, 'scripts', 'phase-05b-native-e2e.mjs')),
        cleanupHelperSha256: sha256File(join(root, 'scripts', 'phase-05b-native-e2e-support.mjs')),
        supervisorBuild: diagnosticSupervisorBuild ?? null,
        repositorySupervisorSha256Before,
        repositorySupervisorSha256After,
        repositoryPathVerifierSha256Before,
        repositoryPathVerifierSha256After,
        repositoryStagedSupervisorSha256Before,
        repositoryStagedSupervisorSha256After,
        runBuiltSupervisorSha256After: sha256File(testSupervisorBinary),
        isolatedStagedSupervisorPath: isolatedSupervisorPath,
        isolatedStagedSupervisorSha256After: isolatedSupervisorSha256After,
        runtimeCorePackageSha256,
        runtimeCorePackageSha256After,
        runtimeSupervisorModuleSha256,
        repositorySupervisorUnchanged: repositorySupervisorSha256Before ? repositorySupervisorSha256Before === repositorySupervisorSha256After : null,
        repositoryPathVerifierUnchanged: repositoryPathVerifierSha256Before ? repositoryPathVerifierSha256Before === repositoryPathVerifierSha256After : null,
        repositoryStagedSupervisorUnchanged: repositoryStagedSupervisorSha256Before ? repositoryStagedSupervisorSha256Before === repositoryStagedSupervisorSha256After : null,
        runBuiltEqualsIsolatedStaged: Boolean(testSupervisorSha256)
          && testSupervisorSha256 === isolatedSupervisorSha256After,
      runtimeLaunchIdentity: phase08b3 ? {
          status: supervisorLaunchEvidenceAfterGeneration?.some(({ mode }) => mode === '--run') ? 'PASS' : preGenerationSupervisorLaunchEvidence ? 'PRE-GENERATION PASS; generation NOT VERIFIED' : 'NOT VERIFIED',
          evidenceFile: '<run-owned>/app-data/temp/phase-08b3-supervisor-launches.jsonl',
          preGeneration: preflightEvidence.supervisorLaunchIdentity ?? null,
          allObservedLaunches: supervisorLaunchEvidenceAfterGeneration ?? null,
        } : preflightEvidence.supervisorLaunchIdentity ?? null,
      }
      diagnosticResult.isolation = {
        runRoot,
        workspace: parent,
        appData: isolatedLocalAppData,
        temp: isolatedTemp,
        webviewProfile: runRoot ? join(runRoot, 'webview-profile') : null,
        resources: testResourceRoot,
        vscodeUserData: phase08b1 && hostVsCodeExecutable ? vscodeUserData : null,
        vscodeExtensions: phase08b1 && hostVsCodeExecutable ? vscodeExtensions : null,
        cargoSupervisorTarget: runRoot ? join(runRoot, 'cargo-supervisor-target') : null,
        cargoTauriTarget: runRoot ? join(runRoot, 'cargo-tauri-target') : null,
        runOwnedArtifactsRetainedForEvidence: true,
      }
      diagnosticResult.preflightChecks = preflightEvidence
      if (phase08b1) {
        diagnosticResult.historicalUnknowns = {
          supervisorFailure: 'UNKNOWN',
          cleanupFailure: 'UNKNOWN',
          currentRunDoesNotResolveHistoricalCauses: true,
          riskOwnerDecision: 'PENDING',
        }
        diagnosticResult.residualRisks = [
          'Prior supervisor failure source, executable, and causal mechanism remain unverified.',
          'Prior cleanup failure cause remains unverified; this run covers only current-run cleanup.',
        ]
        diagnosticResult.phase08a4 = 'MISSING; not searched'
        diagnosticResult.promotion = 'NO-GO'
        diagnosticResult.releaseApproved = false
      }
      diagnosticResult.commands = phase08b1 ? {
        goVersion: {
          command: `${goExecutablePath} version`,
          program: goExecutablePath ?? null,
          args: ['version'],
          exitCode: goVersionProbeExitCode ?? null,
        },
        supervisorBuild: diagnosticSupervisorBuild ? {
          command: diagnosticSupervisorBuild.command,
          program: diagnosticSupervisorBuild.program,
          args: diagnosticSupervisorBuild.args,
          cwd: diagnosticSupervisorBuild.cwd,
          exitCode: diagnosticSupervisorBuild.exitCode,
        } : null,
        desktopDev: {
          command: 'node scripts/desktop.mjs dev system',
          program: process.execPath,
          args: [join(root, 'scripts', 'desktop.mjs'), 'dev', 'system'],
          cwd: root,
          exitCode: cleanupPostconditions?.desktopExitCode ?? null,
        },
        releaseProfileRestoration: releaseRestorationCommands,
        nativeAcceptance: {
          command: `node scripts/phase-05b-native-e2e.mjs ${phase08b3 ? '--phase-08b3' : '--phase-08b1'}`,
          program: process.execPath,
          args: [process.argv[1], phase08b3 ? '--phase-08b3' : '--phase-08b1'],
          cwd: root,
          exitCode: process.exitCode ?? 0,
        },
      } : undefined
      diagnosticResult.cleanup = cleanupNotRequired ? 'NOT REQUIRED' : cleanupFailed ? 'FAIL' : 'PASS'
      diagnosticResult.acceptanceProcessesRemaining = cleanupPostconditions?.acceptanceProcessesRemaining
        ?? (cleanupNotRequired ? preflightEvidence.acceptanceProcessesBeforeRun ?? 'NOT CHECKED' : cleanupFailed ? 'unknown' : 0)
      diagnosticResult.cleanupFailures = cleanupFailures
      diagnosticResult.cleanupPostconditions = cleanupPostconditions ?? null
      diagnosticResult.raceCreateAndProtectedDiagnosticsAccessed ??= false
      diagnosticResult.priorFailureArtifactsPreserved ??= true
      diagnosticResult.releaseBuildProfile = releaseBuildRestored
        ? 'release'
        : cleanupNotRequired && preflightEvidence.baselineBuildProfile === 'release' ? 'release; unchanged before launch' : 'NOT VERIFIED'
      diagnosticResult.releaseProfileRestorationCommands = phase08b1 ? releaseRestorationCommands : undefined
      diagnosticResult.portsAvailableAfterRun = cleanupPostconditions?.ports ?? 'unknown'
      diagnosticResult.webViewDebugPortAvailableAfterRun = cleanupPostconditions?.ports?.webview ?? 'unknown'
      if (cleanupFailed) {
        diagnosticResult.status = 'FAIL'
        process.exitCode = 1
      }
      if (runRoot) {
        const reportName = phase08b1 ? `phase-${phase08b3 ? '08b3' : '08b1'}-report.json` : 'diagnostic-report.json'
        try { await writeFile(join(runRoot, reportName), `${JSON.stringify(diagnosticResult, null, 2)}\n`) } catch (error) {
          cleanupFailed = true
          cleanupFailures.push(safeCleanupFailure('write-run-report', error))
          diagnosticResult.cleanupFailures = cleanupFailures
          if (diagnosticResult.commands?.nativeAcceptance) diagnosticResult.commands.nativeAcceptance.exitCode = 1
        }
      }
      if (cleanupFailed) {
        diagnosticResult.cleanup = 'FAIL'
        if (diagnosticResult.commands?.nativeAcceptance) diagnosticResult.commands.nativeAcceptance.exitCode = 1
        process.exitCode = 1
      }
      const output = JSON.stringify(diagnosticResult, null, 2)
      if (diagnosticResult.status === 'PASS') console.log(output)
      else console.error(output)
    }
  } else if (allChecksComplete) {
    await rm(parent, { recursive: true, force: true })
  } else if (parent) {
    console.error(`Incomplete native BE-02 E2E artifacts retained for diagnosis: ${parent}`)
  }
}
