import assert from 'node:assert/strict'
import { openSync, closeSync, readFileSync } from 'node:fs'
import { access, mkdir, mkdtemp, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { dirname, join, resolve, win32 } from 'node:path'
import { createServer } from 'node:net'

const assertionCounts = { passed: 0, failed: 0 }
for (const method of ['ok', 'equal', 'deepEqual', 'match']) {
  const original = assert[method]
  assert[method] = (...args) => {
    try { const value = original.apply(assert, args); assertionCounts.passed++; return value }
    catch (error) { assertionCounts.failed++; throw error }
  }
}
const originalFail = assert.fail
assert.fail = (...args) => { assertionCounts.failed++; return originalFail.apply(assert, args) }

if (process.platform !== 'win32') throw new Error('Phase 07A native acceptance requires Windows.')
const root = resolve(import.meta.dirname, '..')
const cli = join(root, 'packages', 'cli', 'dist', 'src', 'index.js')
const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
const debugPort = Number(process.env.PG_WEBVIEW_DEBUG_PORT ?? 9339)
const debugBase = `http://127.0.0.1:${debugPort}`
const cancelName = 'pg-fs06-native-cancel'
const collisionName = 'pg-fs06-native-collision'
const runtimeEnv = { ...process.env }
for (const key of Object.keys(runtimeEnv)) if (/^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSERVICE|PGSSLMODE|PGOPTIONS|PGAPPNAME|PGTARGETSESSIONATTRS|PGDATA|PG_E2E_DATABASE_URL)$/i.test(key)) delete runtimeEnv[key]
delete runtimeEnv.DATABASE_URL

let runRoot
let localAppData
let parent
let devProcess
let devLogFd
let devStartError
let socket
let nextId = 0
let lastNpmCandidates = []
let result
const pending = new Map()

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

async function assertPortFree(port) {
  const listener = createServer()
  await new Promise((resolveListen, reject) => {
    listener.once('error', reject)
    listener.listen(port, '127.0.0.1', resolveListen)
  })
  await new Promise((resolveClose, reject) => listener.close((error) => error ? reject(error) : resolveClose()))
}

function isolatedEnvironment() {
  return {
    ...runtimeEnv,
    LOCALAPPDATA: localAppData,
    APPDATA: join(runRoot, 'app-data', 'roaming'),
    TEMP: join(runRoot, 'app-data', 'temp'),
    TMP: join(runRoot, 'app-data', 'temp'),
    CARGO_TARGET_DIR: join(runRoot, 'cargo-target'),
    PG_NATIVE_E2E_ROOT: runRoot,
    PG_NATIVE_E2E_LOCALAPPDATA: localAppData,
    PG_WEBVIEW_DEBUG_PORT: String(debugPort),
    WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort} --user-data-dir="${join(runRoot, 'webview-profile')}"`,
  }
}

async function waitForDevTools(timeoutMs = 30 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs
  let lastError
  while (Date.now() < deadline) {
    if (devStartError) throw devStartError
    if (devProcess?.exitCode !== null) throw new Error(`Tauri dev process exited (${devProcess?.exitCode}):\n${readFileSync(join(runRoot, 'desktop-dev.log'), 'utf8').slice(-12000)}`)
    try {
      const response = await fetch(`${debugBase}/json/list`)
      if (response.ok) {
        const target = (await response.json()).find((item) => item.type === 'page'
          && (item.url ?? '').startsWith('http://127.0.0.1:1420/') && item.webSocketDebuggerUrl)
        if (target) return target
      }
    } catch (error) { lastError = error }
    await delay(500)
  }
  throw new Error(`WebView2 DevTools unavailable at ${debugBase}: ${lastError ?? 'startup timed out'}\n${readFileSync(join(runRoot, 'desktop-dev.log'), 'utf8').slice(-12000)}`)
}

async function connectDevTools(target) {
  socket = new WebSocket(target.webSocketDebuggerUrl)
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
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
  const id = ++nextId
  return new Promise((resolveCommand, rejectCommand) => {
    const timer = setTimeout(() => { pending.delete(id); rejectCommand(new Error(`DevTools command timed out: ${method}`)) }, timeoutMs)
    pending.set(id, { resolve: resolveCommand, reject: rejectCommand, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

async function evaluate(expression, timeoutMs = 30_000) {
  const response = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeoutMs)
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  return response.result?.value
}

async function waitFor(predicate, description, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await evaluate(`(() => ${predicate})()`)
    if (value) return value
    await delay(300)
  }
  throw new Error(`Timed out waiting for ${description}. Page text:\n${await evaluate('document.body.innerText.slice(-6000)')}`)
}

function queryPowerShell(script) {
  const response = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
  if (response.error || response.status !== 0) throw new Error(`PowerShell process inspection failed: ${response.error?.message ?? response.stderr}`)
  const output = response.stdout.trim()
  if (!output) return []
  const parsed = JSON.parse(output)
  return parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed]
}

async function npmInstallProcesses() {
  const query = [
    '$processes=Get-CimInstance Win32_Process',
    '$byId=@{}; foreach($item in $processes){$byId[[int]$item.ProcessId]=$item}',
    "@(foreach($item in $processes){if($item.ExecutablePath -notmatch '(?i)\\\\node\\.exe$' -or $item.CommandLine -notlike '*npm-cli.js*'){continue}; $supervisor=$byId[[int]$item.ParentProcessId]; $cli=if($supervisor){$byId[[int]$supervisor.ParentProcessId]}; $parentPath=''; $parentCommandLine=''; $generatorPid=0; $generatorPath=''; $generatorCommandLine=''; if($supervisor){$parentPath=$supervisor.ExecutablePath;$parentCommandLine=$supervisor.CommandLine}; if($cli){$generatorPid=$cli.ProcessId;$generatorPath=$cli.ExecutablePath;$generatorCommandLine=$cli.CommandLine}; [pscustomobject]@{processId=$item.ProcessId;parentProcessId=$item.ParentProcessId;executablePath=$item.ExecutablePath;CommandLine=$item.CommandLine;parentExecutablePath=$parentPath;parentCommandLine=$parentCommandLine;generatorPid=$generatorPid;generatorExecutablePath=$generatorPath;generatorCommandLine=$generatorCommandLine}}) | ConvertTo-Json -Compress",
  ].join('; ')
  const candidates = queryPowerShell(query)
  lastNpmCandidates = candidates.map(({ processId, parentProcessId, parentExecutablePath, parentCommandLine, generatorCommandLine, CommandLine }) => ({ processId, parentProcessId, parentExecutablePath, parentCommandLine, generatorCommandLine, CommandLine }))
  const matched = []
  for (const candidate of candidates) {
    if (!/(?:^|\s)["']?install["']?(?:\s|$)/i.test(candidate.CommandLine ?? '')
      || !/\\pg-windows-supervisor\.exe$/i.test(candidate.parentExecutablePath ?? '')
      || !/\bindex\.js[" ]+generate\b/i.test(candidate.generatorCommandLine ?? '')) continue
    const configMatch = /\s--config\s+(?:"([^"]+)"|(\S+))/i.exec(candidate.generatorCommandLine)
    const configPath = configMatch?.[1] ?? configMatch?.[2]
    if (!configPath) continue
    try {
      const config = JSON.parse(await readFile(configPath, 'utf8'))
      if (config.project?.parentDirectory?.toLowerCase() !== parent.toLowerCase() || config.project?.name !== cancelName) continue
      matched.push(candidate)
    } catch { /* ignore unrelated or exited generator processes */ }
  }
  return matched
}

function processExists(pid) {
  const query = "@(Get-CimInstance Win32_Process -Filter 'ProcessId = " + Number(pid) + "' | Select-Object ProcessId) | ConvertTo-Json -Compress"
  return queryPowerShell(query).length > 0
}

async function currentInstallingEvent(jobId) {
  return evaluate(`(() => { const events=[...document.querySelectorAll('.activity-event')].filter(e=>e.dataset.jobId===${JSON.stringify(jobId)}&&e.dataset.stageId==='installing'); const e=events.at(-1); return e?.dataset.eventType==='stage-started'&&e.dataset.stageStatus==='running'?{type:e.dataset.eventType,stageId:e.dataset.stageId,stageStatus:e.dataset.stageStatus,jobId:e.dataset.jobId}:null })()`)
}

async function waitForNativeNpmInstall(jobId, timeoutMs = 10 * 60 * 1000) {
  const stagePath = join(parent, `.project-generator-stage-${jobId}`)
  const deadline = Date.now() + timeoutMs
  let activeEvent = null
  while (Date.now() < deadline) {
    activeEvent = await currentInstallingEvent(jobId)
    if (activeEvent) {
      try {
        await access(stagePath)
        const active = await npmInstallProcesses()
        if (active.length) return { stagePath, installingEvent: activeEvent, npmProcess: active[0] }
      } catch { /* staging may not exist until after stage-started event */ }
    }
    await delay(100)
  }
  throw new Error(`No live owned npm PID observed while job ${jobId} had stageId=installing; event=${JSON.stringify(activeEvent)}, process candidates=${JSON.stringify(lastNpmCandidates)}`)
}

async function waitForProcessExit(pid, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true
    await delay(150)
  }
  return false
}

function inspectRecovery(jobId) {
  const env = {
    ...runtimeEnv,
    LOCALAPPDATA: localAppData,
    TEMP: join(runRoot, 'app-data', 'temp'),
    TMP: join(runRoot, 'app-data', 'temp'),
  }
  const response = spawnSync(process.execPath, [cli, 'recovery', 'inspect', '--job-id', jobId, '--json'], { cwd: root, env, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  if (response.error || response.status !== 0) throw new Error(`Read-only recovery inspection failed: ${response.error?.message ?? response.stderr}`)
  const envelope = JSON.parse(response.stdout)
  if (envelope.ok !== true || !Array.isArray(envelope.data)) throw new Error(`Unexpected recovery response: ${response.stdout}`)
  return envelope.data
}

async function click(selector, text) {
  const value = await evaluate(`(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.textContent.includes(${JSON.stringify(text)})); if(!e)return {error:'missing'}; if(e.disabled)return {error:'disabled',text:e.textContent}; e.click(); return {clicked:true,text:e.textContent} })()`)
  assert.equal(value.clicked, true, `Could not click ${selector} containing ${text}: ${JSON.stringify(value)}`)
  await delay(150)
}

async function fill(selector, value) {
  const response = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return {error:'missing'}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return {value:e.value} })()`)
  assert.deepEqual(response, { value }, `Could not fill ${selector}`)
}

async function check(selector) {
  const response = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return {error:'missing'}; if(!e.checked)e.click(); return {checked:e.checked} })()`)
  assert.deepEqual(response, { checked: true }, `Could not check ${selector}`)
}

async function makeFullstackReview(name, expectedDoctorState = 'READY', fromResult = false) {
  if (fromResult) await click('.result-next .primary-button', 'Create another')
  else if (!(await evaluate("document.querySelector('#project-name') !== null"))) await click('.hero-actions .primary-button', 'Create project')
  await waitFor("document.querySelector('#project-name') !== null", `${name} details`)
  await fill('#project-name', name)
  await fill('#project-parent', parent)
  await click('.wizard-actions .primary-button', 'Choose framework')
  await click('.compact-choice', 'Full-stack')
  const stack = await evaluate(`JSON.stringify({selected:[...document.querySelectorAll('.compact-choice')].find(e=>e.innerText.includes('Full-stack'))?.getAttribute('aria-pressed'),summary:document.body.innerText.includes('FS-06 · React + Vite + Express + PostgreSQL + Drizzle')})`)
  assert.deepEqual(JSON.parse(stack), { selected: 'true', summary: true })
  await click('.wizard-actions .primary-button', 'Choose tools')
  assert.match(await evaluate('document.body.innerText'), /one owned workspace, one root lockfile/i)
  await click('.wizard-actions .primary-button', 'Documentation')
  await click('.docs-card', 'Standard')
  await click('.wizard-actions .primary-button', 'Review configuration')
  const doctorStatus = `[...document.querySelectorAll('.review-section')].find(section => section.querySelector('h3')?.innerText === 'Environment checks')?.querySelector('.status-pill')?.innerText.trim()`
  await waitFor(`${doctorStatus} === ${JSON.stringify(expectedDoctorState)}`, `${name} Doctor ${expectedDoctorState}`)
  const review = JSON.parse(await evaluate(`JSON.stringify({
    text:document.body.innerText,
    doctorStatus:${doctorStatus},
    consent:document.querySelector('.consent-box input')?.checked,
    planned:document.querySelector('.internal-consent input')?.checked,
    hasConsent:!!document.querySelector('.consent-box input'),
    hasPlanned:!!document.querySelector('.internal-consent input'),
    createDisabled:[...document.querySelectorAll('.wizard-actions .primary-button')].find(x=>x.innerText.includes('Create project'))?.disabled,
    stack:[...document.querySelectorAll('.stack-summary strong')].map(x=>x.innerText.trim())
  })`))
  assert.equal(review.doctorStatus, expectedDoctorState)
  return review
}

async function startCancelledGeneration() {
  const review = await makeFullstackReview(cancelName)
  assert.ok(review.hasConsent && review.hasPlanned)
  assert.equal(review.consent, false)
  assert.equal(review.planned, false)
  assert.equal(review.createDisabled, true)
  assert.ok(review.text.includes('FS-06') && review.text.toLowerCase().includes('planned'))
  assert.match(review.text, /PostgreSQL is user-provided/i)
  assert.match(review.text, /Direct Drizzle Kit migration remains callable outside the wrapper/i)
  assert.ok(review.text.includes('one owned generation transaction'))
  assert.deepEqual(review.stack, [cancelName, 'React + Vite + Express + PostgreSQL + Drizzle'])

  await click('.disclosure-details summary', 'Expected project files')
  const expectedWrites = await evaluate("[...document.querySelectorAll('.disclosure-details li code')].map(e=>e.innerText)")
  assert.equal(expectedWrites.filter((path) => path === 'package-lock.json').length, 1)
  for (const path of ['apps/web/vite.config.ts', 'apps/web/src/vite-env.d.ts', 'apps/api/src/db/migrate.ts']) assert.ok(expectedWrites.includes(path), path)
  assert.equal(await evaluate("document.body.innerText.toLowerCase().includes('separate network approval required')"), false)

  await check('.consent-box input')
  assert.equal(await evaluate("[...document.querySelectorAll('.wizard-actions .primary-button')].find(x=>x.innerText.includes('Create project'))?.disabled"), true, 'dependency consent alone must not authorize planned FS-06')
  await check('.internal-consent input')
  await waitFor("[...document.querySelectorAll('.wizard-actions .primary-button')].some(x=>x.innerText.includes('Create project')&&!x.disabled)", 'explicit npm and planned-recipe approvals')
  const priorJobs = await evaluate("[...document.querySelectorAll('[data-event-type=\"job-started\"]')].map(e=>e.dataset.jobId)")
  await click('.wizard-actions .primary-button', 'Create project')
  await waitFor("document.querySelector('#generation-title') !== null", 'native FS-06 generation screen')
  await waitFor(`([...document.querySelectorAll('[data-event-type="job-started"]')].some(e=>!${JSON.stringify(priorJobs)}.includes(e.dataset.jobId)))`, 'new native job-started event')
  const jobId = await evaluate(`([...document.querySelectorAll('[data-event-type="job-started"]')].map(e=>e.dataset.jobId).find(id=>!${JSON.stringify(priorJobs)}.includes(id)))`)
  assert.ok(jobId)
  return { review, jobId }
}

async function runAcceptance() {
  if (!Number.isInteger(debugPort) || debugPort < 1024 || debugPort > 65535) throw new Error('PG_WEBVIEW_DEBUG_PORT must be a valid non-privileged TCP port.')
  await access(tempBase)
  if (!(await stat(tempBase)).isDirectory()) throw new Error('Approved OpenCode temp path is not a directory.')
  await assertPortFree(1420)
  await assertPortFree(debugPort)
  runRoot = await mkdtemp(join(tempBase, 'phase-07a-native-e2e-'))
  localAppData = join(runRoot, 'app-data', 'local')
  parent = join(runRoot, 'w')
  for (const path of [localAppData, join(runRoot, 'app-data', 'roaming'), join(runRoot, 'app-data', 'temp'), join(runRoot, 'webview-profile')]) await mkdir(path, { recursive: true })
  await mkdir(parent)
  assert.deepEqual(await readdir(parent), [], 'native disposable workspace must start empty')

  const collisionPath = join(parent, collisionName)
  await mkdir(collisionPath)
  const sentinelPath = join(collisionPath, 'preserve.txt')
  await writeFile(sentinelPath, 'preserve FS-06 collision sentinel\n', { flag: 'wx' })
  const logPath = join(runRoot, 'desktop-dev.log')
  devLogFd = openSync(logPath, 'wx')
  devProcess = spawn(process.execPath, [join(root, 'scripts', 'desktop.mjs'), 'dev', 'system'], {
    cwd: root,
    env: isolatedEnvironment(),
    windowsHide: false,
    stdio: ['ignore', devLogFd, devLogFd],
  })
  devProcess.once('error', (error) => { devStartError = error })
  const target = await waitForDevTools()
  await connectDevTools(target)
  await waitFor("document.querySelector('#project-name') !== null || (document.querySelector('.hero-actions .primary-button') && !document.querySelector('.hero-actions .primary-button').disabled)", 'native Forge Studio surface and loaded catalog', 120_000)
  if (!(await evaluate("document.querySelector('.hero-actions .primary-button') !== null"))) await click('button', 'Cancel')
  await waitFor("document.querySelector('.hero-actions .primary-button') !== null", 'native Forge Studio home')
  const runtime = await evaluate('document.body.innerText')
  assert.ok(runtime.includes('LOCAL DEVELOPMENT'))
  assert.ok(runtime.includes('No release approval'))

  const cancelFlow = await startCancelledGeneration()
  const { installingEvent, npmProcess } = await waitForNativeNpmInstall(cancelFlow.jobId)
  assert.deepEqual({ type: installingEvent.type, stageId: installingEvent.stageId, stageStatus: installingEvent.stageStatus }, {
    type: 'stage-started', stageId: 'installing', stageStatus: 'running',
  }, 'native UI must render active FS-06 installing stage')
  assert.ok(Number.isInteger(Number(npmProcess.processId)) && Number(npmProcess.processId) > 0)
  assert.match(npmProcess.CommandLine, /npm-cli\.js.*\binstall\b/i)
  await waitFor("document.querySelector('.cancel-row button') && !document.querySelector('.cancel-row button').disabled", 'active native cancellation button')
  assert.deepEqual(await currentInstallingEvent(cancelFlow.jobId), installingEvent)
  const stillRunning = (await npmInstallProcesses()).find((process) => Number(process.processId) === Number(npmProcess.processId))
  assert.ok(stillRunning, 'same npm install PID must remain live immediately before cancellation')
  const npmPid = Number(stillRunning.processId)
  const liveInstall = {
    observedAt: new Date().toISOString(), jobId: cancelFlow.jobId, recipeId: 'FS-06',
    stageId: installingEvent.stageId, npmPid, npmCommandLine: stillRunning.CommandLine,
    npmParentPid: stillRunning.parentProcessId, generatorPid: stillRunning.generatorPid,
    generatorCommandLine: stillRunning.generatorCommandLine,
  }
  await writeFile(join(runRoot, 'native-cancellation-live.json'), `${JSON.stringify(liveInstall, null, 2)}\n`, { flag: 'wx' })
  await click('.cancel-row button', 'Cancel generation')
  await waitFor("document.querySelector('.result-hero.cancelled') !== null && document.querySelector('#result-title')?.textContent.trim() === 'Generation cancelled' && [...document.querySelectorAll('.result-tags span')].some(e=>e.innerText.trim().toLowerCase()==='cancelled')", 'native FS-06 cancelled terminal result', 5 * 60 * 1000)
  const cancelledResult = await evaluate("(() => { const hero=document.querySelector('.result-hero'); const status=[...document.querySelectorAll('.result-tags span')].map(e=>e.innerText.trim()).find(x=>x.toLowerCase()==='cancelled'); return {status:hero?.classList.contains('cancelled')&&status?'cancelled':'unknown',displayedStatus:status?.toLowerCase()??null,title:document.querySelector('#result-title')?.textContent.trim()} })()")
  assert.deepEqual(cancelledResult, { status: 'cancelled', displayedStatus: 'cancelled', title: 'Generation cancelled' })
  const npmTerminated = await waitForProcessExit(npmPid)
  assert.equal(npmTerminated, true, `owned npm PID ${npmPid} remained alive after cancelled result`)

  await assert.rejects(access(join(parent, cancelName)))
  const stageEntries = (await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-'))
  const recovery = inspectRecovery(cancelFlow.jobId)
  let stagingOutcome
  if (stageEntries.length === 0) {
    assert.deepEqual(recovery, [], 'clean cancellation must leave no pending recovery record')
    stagingOutcome = 'owned stage removed; no recovery entry'
  } else {
    assert.deepEqual(stageEntries, [`.project-generator-stage-${cancelFlow.jobId}`])
    assert.equal(recovery.length, 1)
    assert.equal(recovery[0].jobId, cancelFlow.jobId)
    assert.equal(recovery[0].state, 'stagingPresent')
    assert.equal(recovery[0].canCleanupStage, true)
    assert.equal(recovery[0].canFinalize, false)
    stagingOutcome = 'owned stage retained; recovery reports stagingPresent and cleanup allowed'
  }
  assert.deepEqual((await readdir(parent)).sort(), [collisionName, ...stageEntries].sort())
  const cancellationEvidence = {
    ...liveInstall,
    terminalResult: { ...cancelledResult, jobId: cancelFlow.jobId },
    npmPidExitedAfterTerminalResult: npmTerminated,
    destinationAbsent: true,
    stageEntries,
    stagingOutcome,
    recovery,
  }
  await writeFile(join(runRoot, 'native-cancellation-live.json'), `${JSON.stringify(cancellationEvidence, null, 2)}\n`)

  const collisionReview = await makeFullstackReview(collisionName, 'BLOCKED', true)
  assert.ok(collisionReview.text.includes('FS-06'))
  assert.match(collisionReview.text, /already exists/i)
  assert.equal(collisionReview.doctorStatus, 'BLOCKED')
  assert.equal(collisionReview.createDisabled, true)
  assert.equal(collisionReview.consent, false)
  assert.equal(collisionReview.planned, false)
  assert.equal(await readFile(sentinelPath, 'utf8'), 'preserve FS-06 collision sentinel\n')
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')).sort(), stageEntries.sort())
  assert.deepEqual((await readdir(parent)).sort(), [collisionName, ...stageEntries].sort())

  result = {
    status: 'PASS',
    phase: '07A',
    assertions: { ...assertionCounts },
    flow: 'native Tauri + isolated WebView2 profile + disposable workspace; no PostgreSQL service or DATABASE_URL',
    host: `${process.platform}-${process.arch}`,
    node: process.version,
    recipe: 'FS-06',
    recipeStatus: 'planned',
    review: 'React + Vite + Express + PostgreSQL + Drizzle and one-workspace/one-root-lock plan shown; expected root lockfile listed once; docs and DB safety warnings shown',
    consent: 'npm execution and planned-recipe consents visible/unchecked; npm consent alone kept Create disabled; both explicit checks enabled internal debug generation',
    cancellation: cancellationEvidence,
    collision: 'Doctor BLOCKED; Create disabled; pre-existing sentinel unchanged; no extra owned stage',
    releaseApproved: false,
    projectPath: join(parent, cancelName),
    evidenceRoot: runRoot,
  }
}

async function stopOwnedDesktop() {
  if (socket?.readyState === WebSocket.OPEN) socket.close()
  if (devProcess && devProcess.exitCode === null) {
    const stopped = spawnSync('taskkill.exe', ['/PID', String(devProcess.pid), '/T', '/F'], { encoding: 'utf8', windowsHide: true, timeout: 30_000 })
    if (stopped.error) throw stopped.error
    if (stopped.status !== 0 && processExists(devProcess.pid)) throw new Error(`Could not stop owned Tauri dev process tree ${devProcess.pid}: ${stopped.stderr}`)
    await new Promise((resolveClose, rejectClose) => {
      const timer = setTimeout(() => rejectClose(new Error('Owned Tauri dev process tree did not exit after taskkill.')), 30_000)
      devProcess.once('close', (...args) => { clearTimeout(timer); resolveClose(args) })
    })
  }
  if (devLogFd !== undefined) { closeSync(devLogFd); devLogFd = undefined }
}

try {
  await runAcceptance()
} catch (cause) {
  result = {
    status: 'FAIL', phase: '07A', assertions: { ...assertionCounts },
    reason: cause instanceof Error ? cause.message : String(cause),
    evidenceRoot: runRoot,
  }
} finally {
  try { await stopOwnedDesktop() }
  catch (cause) {
    result = { status: 'FAIL', phase: '07A', assertions: { ...assertionCounts }, reason: `Native app cleanup failed: ${cause instanceof Error ? cause.message : String(cause)}`, evidenceRoot: runRoot }
    process.exitCode = 1
  }
  if (runRoot) {
    try { await writeFile(join(runRoot, 'native-acceptance-report.json'), `${JSON.stringify(result, null, 2)}\n`) }
    catch (cause) { process.stderr.write(`Could not write native report under ${runRoot}: ${cause}\n`) }
  }
}

if (result?.status === 'PASS') console.log(JSON.stringify(result, null, 2))
else {
  console.error(JSON.stringify(result, null, 2))
  process.exitCode = 1
}
