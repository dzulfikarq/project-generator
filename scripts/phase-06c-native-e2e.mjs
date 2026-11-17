import assert from 'node:assert/strict'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'

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

const root = process.env.PG_NATIVE_E2E_ROOT
if (!root) throw new Error('PG_NATIVE_E2E_ROOT must name a fresh isolated acceptance root.')
const parent = join(root, 'w')
const base = 'http://127.0.0.1:9339'
const projectName = 'pg-be09-native'
const cancelName = 'pg-be09-cancel'
const collisionName = 'pg-be09-collision-test'
let lastNpmCandidates = []
await mkdir(parent, { recursive: true })
assert.deepEqual(await readdir(parent), [], 'disposable workspace must start empty')
const collisionPath = join(parent, collisionName)
await mkdir(collisionPath)
const sentinelPath = join(collisionPath, 'keep.txt')
await writeFile(sentinelPath, 'preserve acceptance sentinel\n', { flag: 'wx' })

const targets = await (await fetch(`${base}/json/list`)).json()
const target = targets.find((item) => item.type === 'page' && item.url?.startsWith('http://127.0.0.1:1420/') && item.webSocketDebuggerUrl)
assert.ok(target, 'acceptance Tauri WebView CDP target missing')
const socket = new WebSocket(target.webSocketDebuggerUrl)
let nextId = 0
const pending = new Map()
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
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true })
  socket.addEventListener('error', reject, { once: true })
})
function command(method, params = {}, timeoutMs = 30_000) {
  const id = ++nextId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)) }, timeoutMs)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression, timeoutMs = 30_000) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeoutMs)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result?.value
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
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
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', windowsHide: true, timeout: 15_000 })
  if (result.error || result.status !== 0) throw new Error(`PowerShell process inspection failed: ${result.error?.message ?? result.stderr}`)
  const output = result.stdout.trim()
  if (!output) return []
  const parsed = JSON.parse(output)
  return parsed === null ? [] : Array.isArray(parsed) ? parsed : [parsed]
}
async function npmInstallProcesses(stagePath) {
  const query = [
    '$processes=Get-CimInstance Win32_Process',
    '$byId=@{}; foreach($item in $processes){$byId[[int]$item.ProcessId]=$item}',
    "@(foreach($item in $processes){if($item.ExecutablePath -notmatch '(?i)\\\\node\\.exe$' -or $item.CommandLine -notlike '*npm-cli.js*'){continue}; $supervisor=$byId[[int]$item.ParentProcessId]; $cli=if($supervisor){$byId[[int]$supervisor.ParentProcessId]}; $parentPath=''; $parentCommandLine=''; $generatorPid=0; $generatorPath=''; $generatorCommandLine=''; if($supervisor){$parentPath=$supervisor.ExecutablePath;$parentCommandLine=$supervisor.CommandLine}; if($cli){$generatorPid=$cli.ProcessId;$generatorPath=$cli.ExecutablePath;$generatorCommandLine=$cli.CommandLine}; [pscustomobject]@{processId=$item.ProcessId;parentProcessId=$item.ParentProcessId;executablePath=$item.ExecutablePath;CommandLine=$item.CommandLine;parentExecutablePath=$parentPath;parentCommandLine=$parentCommandLine;generatorPid=$generatorPid;generatorExecutablePath=$generatorPath;generatorCommandLine=$generatorCommandLine}}) | ConvertTo-Json -Compress",
  ].join('; ')
  const candidates = queryPowerShell(query)
  lastNpmCandidates = candidates.filter((candidate) => /(?:^|\s)["']?install["']?(?:\s|$)/i.test(candidate.CommandLine ?? '')).map(({ processId, parentProcessId, parentExecutablePath, generatorCommandLine, CommandLine }) => ({ processId, parentProcessId, parentExecutablePath, generatorCommandLine, CommandLine }))
  const expectedParent = parent.toLowerCase()
  const expectedName = cancelName
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
      if (config.project?.parentDirectory?.toLowerCase() !== expectedParent || config.project?.name !== expectedName) continue
      matched.push({ ...candidate, stagePath, configPath })
    } catch {
      continue
    }
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
async function waitForNativeNpmInstall(jobId, stagePath, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs
  let activeEvent = null
  while (Date.now() < deadline) {
    activeEvent = await currentInstallingEvent(jobId)
    if (activeEvent) {
      let stageExists = true
      try {
        await access(stagePath)
      } catch {
        stageExists = false
      }
      if (stageExists) {
        const active = await npmInstallProcesses(stagePath)
        if (active.length) return { installingEvent: activeEvent, npmProcess: active[0] }
      }
    }
    await delay(100)
  }
  throw new Error(`No live npm PID observed while job ${jobId} had stageId=installing; current stage=${JSON.stringify(activeEvent)}, process candidates=${JSON.stringify(lastNpmCandidates)}`)
}
async function waitForProcessExit(pid, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processExists(pid)) return true
    await delay(100)
  }
  return false
}
function inspectRecovery(jobId) {
  const env = { ...process.env, LOCALAPPDATA: process.env.PG_NATIVE_E2E_LOCALAPPDATA ?? join(root, 'app-data', 'process-local'), TEMP: join(root, 'app-data', 'process-temp'), TMP: join(root, 'app-data', 'process-temp') }
  for (const key of Object.keys(env)) if (/^(PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD|PGSERVICE|PGSSLMODE|PGOPTIONS|PGAPPNAME|PGTARGETSESSIONATTRS|PGDATA|PG_E2E_DATABASE_URL)$/i.test(key)) delete env[key]
  delete env.DATABASE_URL
  const cli = join(process.cwd(), 'packages', 'cli', 'dist', 'src', 'index.js')
  const run = spawnSync(process.execPath, [cli, 'recovery', 'inspect', '--job-id', jobId, '--json'], { cwd: process.cwd(), env, encoding: 'utf8', windowsHide: true, timeout: 30_000 })
  if (run.error || run.status !== 0) throw new Error(`Read-only recovery inspection failed: ${run.error?.message ?? run.stderr}`)
  const envelope = JSON.parse(run.stdout)
  if (envelope.ok !== true || !Array.isArray(envelope.data)) throw new Error(`Unexpected recovery response: ${run.stdout}`)
  return envelope.data
}
async function click(selector, text) {
  const result = await evaluate(`(() => { const e=[...document.querySelectorAll(${JSON.stringify(selector)})].find(x=>x.textContent.includes(${JSON.stringify(text)})); if(!e)return {error:'missing'}; if(e.disabled)return {error:'disabled',text:e.textContent}; e.click(); return {clicked:true,text:e.textContent} })()`)
  assert.equal(result.clicked, true, `Could not click ${selector} containing ${text}: ${JSON.stringify(result)}`)
  await delay(150)
}
async function fill(selector, value) {
  const result = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return {error:'missing'}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return {value:e.value} })()`)
  assert.deepEqual(result, { value }, `Could not fill ${selector}`)
}
async function check(selector) {
  const result = await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return {error:'missing'}; if(!e.checked)e.click(); return {checked:e.checked} })()`)
  assert.deepEqual(result, { checked: true }, `Could not check ${selector}`)
}
async function makeReview(name, fromResult = false, expectedDoctorState = 'READY') {
  if (fromResult) await click('.result-next .primary-button', 'Create another')
  else if (!(await evaluate("document.querySelector('#project-name') !== null"))) await click('.hero-actions .primary-button', 'Create project')
  await waitFor("document.querySelector('#project-name') !== null", `${name} details`)
  await fill('#project-name', name)
  await fill('#project-parent', parent)
  await click('.wizard-actions .primary-button', 'Choose framework')
  await click('.compact-choice', 'Backend')
  await click('.select-card', 'NestJS')
  await click('.wizard-actions .primary-button', 'Choose tools')
  await click('.compact-choice', 'PostgreSQL')
  await waitFor("[...document.querySelectorAll('.compact-choice')].some(x=>x.innerText.includes('Drizzle ORM · PostgreSQL')&&!x.disabled)", 'BE-09 PostgreSQL ORM option')
  await click('.compact-choice', 'Drizzle ORM · PostgreSQL')
  const tools = await evaluate(`JSON.stringify({manager:document.querySelector('#backend-manager')?.value, pg:[...document.querySelectorAll('.compact-choice')].find(x=>x.innerText.includes('PostgreSQL')&&x.innerText.startsWith('PostgreSQL'))?.getAttribute('aria-pressed'), drizzle:[...document.querySelectorAll('.compact-choice')].find(x=>x.innerText.includes('Drizzle ORM · PostgreSQL'))?.getAttribute('aria-pressed'),nest:document.body.innerText.includes('NestJS 11 · TypeScript · npm · Jest')})`)
  const toolState = JSON.parse(tools)
  assert.deepEqual(toolState, { manager: 'npm', pg: 'true', drizzle: 'true', nest: true })
  await click('.wizard-actions .primary-button', 'Documentation')
  await click('.docs-card', 'Standard')
  await click('.wizard-actions .primary-button', 'Review configuration')
  const doctorStatusExpression = `[...document.querySelectorAll('.review-section')].find(section => section.querySelector('h3')?.innerText === 'Environment checks')?.querySelector('.status-pill')?.innerText.trim()`
  await waitFor(`${doctorStatusExpression} === ${JSON.stringify(expectedDoctorState)}`, `${name} expected Doctor ${expectedDoctorState}`)
  const review = JSON.parse(await evaluate(`JSON.stringify({text:document.body.innerText,doctorStatus:${doctorStatusExpression},consent:document.querySelector('.consent-box input')?.checked,planned:document.querySelector('.internal-consent input')?.checked,hasConsent:!!document.querySelector('.consent-box input'),hasPlanned:!!document.querySelector('.internal-consent input'),createDisabled:[...document.querySelectorAll('.wizard-actions .primary-button')].find(x=>x.innerText.includes('Create project'))?.disabled})`))
  assert.equal(review.doctorStatus, expectedDoctorState, `${name} Doctor state mismatch`)
  return JSON.stringify(review)
}
async function approveAndStart() {
  const before = JSON.parse(await evaluate(`JSON.stringify({text:document.body.innerText,consent:document.querySelector('.consent-box input')?.checked,planned:document.querySelector('.internal-consent input')?.checked,disabled:[...document.querySelectorAll('.wizard-actions .primary-button')].find(x=>x.innerText.includes('Create project'))?.disabled})`))
  assert.match(before.text, /I understand and consent to this unsandboxed third-party dependency execution for this generation/i)
  assert.match(before.text, /Internal evidence run only: allow this planned recipe/i)
  assert.ok(before.text.includes('BE-09') && before.text.toLowerCase().includes('planned'))
  assert.equal(before.consent, false)
  assert.equal(before.planned, false)
  assert.equal(before.disabled, true)
  const consentText = before.text
  await check('.consent-box input')
  assert.equal(await evaluate("[...document.querySelectorAll('.wizard-actions .primary-button')].find(x=>x.innerText.includes('Create project'))?.disabled"), true, 'dependency consent alone must not authorize planned recipe')
  await check('.internal-consent input')
  await waitFor("[...document.querySelectorAll('.wizard-actions .primary-button')].some(x=>x.innerText.includes('Create project')&&!x.disabled)", 'explicit dependency and planned-recipe approvals')
  const previousJobIds = JSON.parse(await evaluate("JSON.stringify([...document.querySelectorAll('[data-event-type=\"job-started\"]')].map(e=>e.dataset.jobId))"))
  await click('.wizard-actions .primary-button', 'Create project')
  await waitFor("document.querySelector('#generation-title') !== null", 'native generation screen')
  await waitFor(`([...document.querySelectorAll('[data-event-type="job-started"]')].some(e=>!${JSON.stringify(previousJobIds)}.includes(e.dataset.jobId)))`, 'new native job-started event')
  const jobId = await evaluate(`([...document.querySelectorAll('[data-event-type="job-started"]')].map(e=>e.dataset.jobId).find(id=>!${JSON.stringify(previousJobIds)}.includes(id)))`)
  assert.ok(jobId, 'new native generation job ID missing')
  return { consentText, jobId }
}
async function startFlow(name, fromResult = false) {
  const text = await makeReview(name, fromResult)
  const details = JSON.parse(text)
  assert.equal(details.doctorStatus, 'READY', `${name} normal generation must be READY`)
  assert.ok(details.hasConsent && details.hasPlanned, 'both consent disclosures must be shown')
  assert.equal(details.consent, false)
  assert.equal(details.planned, false)
  assert.equal(details.createDisabled, true)
  const approval = await approveAndStart()
  return approval
}

let result
try {
  await waitFor("document.querySelector('#project-name') !== null || (document.querySelector('.hero-actions .primary-button') && !document.querySelector('.hero-actions .primary-button').disabled) || (document.querySelector('#result-title') && [...document.querySelectorAll('.result-next .primary-button')].some(e=>e.textContent.includes('Create another')&&!e.disabled))", 'initial native application surface and loaded catalog')
  if (!(await evaluate("document.querySelector('.hero-actions .primary-button') !== null"))) {
    if (await evaluate("document.querySelector('#result-title') !== null")) await click('.result-next .primary-button', 'Create another')
    else if (!(await evaluate("document.querySelector('#project-name') !== null"))) await click('button', 'Cancel')
    await waitFor("document.querySelector('.hero-actions .primary-button') !== null || document.querySelector('#project-name') !== null", 'isolated Tauri home or project details after leaving prior flow')
  }
  await waitFor("document.querySelector('.hero-actions .primary-button') !== null || document.querySelector('#project-name') !== null", 'isolated Tauri home or project details')
  const runtime = await evaluate('document.body.innerText')
  assert.ok(runtime.includes('LOCAL DEVELOPMENT'))
  assert.ok(runtime.includes('No release approval'))
  const cancelJob = await startFlow(cancelName)
  const stagePath = join(parent, `.project-generator-stage-${cancelJob.jobId}`)
  const { installingEvent, npmProcess: initialNpmProcess } = await waitForNativeNpmInstall(cancelJob.jobId, stagePath)
  let npmProcess = initialNpmProcess
  assert.deepEqual({ type: installingEvent.type, stageId: installingEvent.stageId, stageStatus: installingEvent.stageStatus }, { type: 'stage-started', stageId: 'installing', stageStatus: 'running' }, 'native UI must render exact active installing-stage event')
  assert.ok(Number.isInteger(Number(npmProcess.processId)) && Number(npmProcess.processId) > 0, `live npm install PID missing: ${JSON.stringify(npmProcess)}`)
  assert.match(npmProcess.CommandLine, /npm-cli\.js.*\binstall\b/i, 'observed process must be npm install')
  const cancelProgress = await evaluate("document.querySelector('.activity-list')?.innerText")
  await waitFor("document.querySelector('.cancel-row button') && !document.querySelector('.cancel-row button').disabled", 'active native cancellation button')
  assert.deepEqual(await currentInstallingEvent(cancelJob.jobId), installingEvent, 'UI must still report same job actively installing immediately before cancellation')
  npmProcess = (await npmInstallProcesses(stagePath)).find((process) => Number(process.processId) === Number(npmProcess.processId))
  assert.ok(npmProcess, 'same npm PID must remain live immediately before cancellation request')
  const npmPid = Number(npmProcess.processId)
  const liveNpmEvidence = { observedAt: new Date().toISOString(), jobId: cancelJob.jobId, stageId: installingEvent.stageId, npmPid, npmCommandLine: npmProcess.CommandLine, npmParentPid: npmProcess.parentProcessId, npmParentExecutablePath: npmProcess.parentExecutablePath, generatorPid: npmProcess.generatorPid, generatorCommandLine: npmProcess.generatorCommandLine, stagePath, activeImmediatelyBeforeCancel: true }
  await writeFile(join(root, 'native-cancellation-live.json'), `${JSON.stringify(liveNpmEvidence, null, 2)}\n`)
  await click('.cancel-row button', 'Cancel generation')
  await waitFor("document.querySelector('.result-hero.cancelled') !== null && document.querySelector('#result-title')?.textContent.trim() === 'Generation cancelled' && [...document.querySelectorAll('.result-tags span')].some(e=>e.innerText.trim().toLowerCase()==='cancelled')", 'native cancelled result status', 5 * 60 * 1000)
  const cancelledResult = await evaluate("(() => { const hero=document.querySelector('.result-hero'); const status=[...document.querySelectorAll('.result-tags span')].map(e=>e.innerText.trim()).find(x=>x.toLowerCase()==='cancelled'); return {status:hero?.classList.contains('cancelled')&&status?'cancelled':'unknown',displayedStatus:status?.toLowerCase()??null,title:document.querySelector('#result-title')?.textContent.trim()} })()")
  assert.deepEqual(cancelledResult, { status: 'cancelled', displayedStatus: 'cancelled', title: 'Generation cancelled' })
  const npmTerminated = await waitForProcessExit(npmPid)
  assert.equal(npmTerminated, true, `owned npm PID ${npmPid} remained alive after cancellation completed`)
  try { await access(join(parent, cancelName)); assert.fail('cancelled target unexpectedly exists') } catch (error) { if (error?.code !== 'ENOENT') throw error }
  const cancellationStages = (await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-'))
  const cancellationRecovery = inspectRecovery(installingEvent.jobId)
  let cancellationStaging
  if (cancellationStages.length === 0) {
    assert.deepEqual(cancellationRecovery, [], 'cleaned cancellation must have no pending recovery record')
    cancellationStaging = 'owned stage removed; no pending recovery record'
  } else {
    assert.deepEqual(cancellationStages, [`.project-generator-stage-${installingEvent.jobId}`], 'only cancelled job stage may remain')
    assert.equal(cancellationRecovery.length, 1)
    assert.equal(cancellationRecovery[0].jobId, installingEvent.jobId)
    assert.equal(cancellationRecovery[0].state, 'stagingPresent')
    assert.equal(cancellationRecovery[0].canCleanupStage, true)
    assert.equal(cancellationRecovery[0].canFinalize, false)
    cancellationStaging = 'owned stage retained; read-only recovery reports stagingPresent/canCleanupStage; target absent'
  }
  assert.deepEqual((await readdir(parent)).sort(), [collisionName, ...cancellationStages].sort(), 'cancellation must preserve collision and any policy-retained stage')
  const cancellationEvidence = {
    ...liveNpmEvidence,
    terminalResult: { ...cancelledResult, jobId: cancelJob.jobId },
    npmPidTerminatedAfterTerminalEvent: npmTerminated,
    destinationAbsent: true,
    staging: { entries: cancellationStages, disposition: cancellationStaging },
    recovery: cancellationRecovery,
  }
  await writeFile(join(root, 'native-cancellation-live.json'), `${JSON.stringify(cancellationEvidence, null, 2)}\n`)

  const successConsent = await startFlow(projectName, true)
  await waitFor("document.querySelector('#result-title') !== null", 'native BE-09 terminal result', 30 * 60 * 1000)
  const generationResult = await evaluate("JSON.stringify({title:document.querySelector('#result-title')?.textContent,text:document.body.innerText.slice(-3000)})")
  const generation = JSON.parse(generationResult)
  assert.match(generation.title ?? '', /Project checks passed/i, `Native generation failed: ${generation.text}`)
  const projectPath = join(parent, projectName)
  const manifest = JSON.parse(await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8'))
  assert.equal(manifest.recipeId, 'BE-09')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.packageManager, 'npm')
  assert.deepEqual(manifest.selectedAdapters.map(({ id }) => id), ['backend.nestjs', 'database.postgresql', 'data-access.drizzle-postgresql'])
  for (const id of ['scaffold-identity','dependency-install','dependency-integrity','lockfile-integrity','migration-generation','typecheck','lint','unit-tests','database-safety-tests','e2e-tests','build','http-smoke','graceful-shutdown']) {
    assert.equal(manifest.validation.find((item) => item.id === id)?.status, 'pass', id)
  }
  for (const path of ['README.md','docs/DATABASE-SAFETY.md','src/db/migrate.ts','src/items/items.controller.ts','drizzle/meta/_journal.json']) await access(join(projectPath, path))
  const lock = JSON.parse(await readFile(join(projectPath, 'package-lock.json'), 'utf8'))
  assert.equal(lock.packages['node_modules/@nestjs/common'].version, '11.2.10')
  assert.equal(lock.packages['node_modules/drizzle-orm'].version, '0.45.4')
  assert.equal(lock.packages['node_modules/pg'].version, '8.23.1')

  const collisionConsent = await makeReview(collisionName, true, 'BLOCKED')
  const collisionReview = JSON.parse(collisionConsent)
  assert.equal(collisionReview.doctorStatus, 'BLOCKED')
  assert.ok(collisionReview.text.includes('BLOCKED'))
  assert.match(collisionReview.text, /already exists/i)
  assert.equal(collisionReview.createDisabled, true)
  assert.equal(await readFile(sentinelPath, 'utf8'), 'preserve acceptance sentinel\n')
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')).sort(), cancellationStages.sort(), 'collision flow must not create another staging directory')
  assert.deepEqual((await readdir(parent)).sort(), [collisionName, projectName, ...cancellationStages].sort(), 'workspace must contain generated target, collision sentinel, and only any safely retained cancellation stage')

  const afterCancel = await evaluate("document.querySelector('#result-title')?.textContent")
  result = {
    status: 'PASS',
    allAssertionsPassed: true,
    assertions: { ...assertionCounts },
    phase: '06C',
    flow: 'Windows debug Tauri + isolated WebView profile + disposable workspace + development-profile CLI resources',
    host: `${process.platform}-${process.arch}`,
    node: process.version,
    recipe: manifest.recipeId,
    recipeStatus: manifest.recipeStatusAtCreation,
    runtime: 'LOCAL DEVELOPMENT; release approval absent; debug-only internal development mode exposed',
    reviewStates: { cancellation: 'READY', successfulGeneration: 'READY', collision: 'BLOCKED' },
    consent: 'dependency/lifecycle and planned-recipe controls both visible and unchecked by default; dependency approval alone leaves Create disabled; both explicit checks enabled generation',
    progress: { uiEvent: installingEvent, activityText: cancelProgress.slice(0, 1200) },
    cancellation: cancellationEvidence,
    generation: 'native project checks passed; manifest, exact NestJS/Drizzle/pg pins, lockfile, migration/docs files and required validation statuses verified',
    collision: 'Doctor blocked existing destination with actionable already-exists feedback; existing sentinel unchanged; collision created no staging directory',
    databaseSafety: 'Tauri launch environment had no PG*/DATABASE_URL variables; generator did not configure or provision a database; existing PostgreSQL listener was not targeted',
    releaseBypass: 'no release policy changed; debug-only authorization observed; separate targeted Rust authorization/profile tests passed; no gate change',
    projectPath,
  }
  await writeFile(join(root, 'native-acceptance-report.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  const failure = { status: 'FAIL', phase: '06C', assertions: { ...assertionCounts }, error: error instanceof Error ? error.message : String(error) }
  await writeFile(join(root, 'native-acceptance-report.json'), `${JSON.stringify(failure, null, 2)}\n`)
  console.error(JSON.stringify(failure, null, 2))
  throw error
} finally {
  if (socket.readyState === WebSocket.OPEN) socket.close()
}
