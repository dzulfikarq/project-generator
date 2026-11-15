import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, lstat, mkdtemp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'

if (process.platform !== 'win32') throw new Error('Phase 05C.2 native acceptance requires Windows.')

const debugPort = Number(process.env.PG_WEBVIEW_DEBUG_PORT ?? 9339)
const debugBase = `http://127.0.0.1:${debugPort}`
const local = process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local')
const tempBase = join(local, 'Temp', 'opencode')
const python = process.env.PG_PYTHON_EXE
const uv = process.env.PG_UV_EXE
assert.ok(python && win32.isAbsolute(python), 'Set PG_PYTHON_EXE to the verified portable Python executable.')
assert.ok(uv && win32.isAbsolute(uv), 'Set PG_UV_EXE to the verified portable uv executable.')

function toolVersion(executable, expected) {
  const result = spawnSync(executable, ['--version'], { encoding: 'utf8', windowsHide: true })
  assert.equal(result.status, 0, result.stderr)
  assert.match(`${result.stdout}\n${result.stderr}`, expected)
  return `${result.stdout}${result.stderr}`.trim()
}

const pythonVersion = toolVersion(python, /Python 3\.14\.10\b/)
const uvVersion = toolVersion(uv, /uv 0\.13\.8\b/)
await access(tempBase)
assert.ok((await stat(tempBase)).isDirectory())

const parent = await mkdtemp(join(tempBase, 'phase-05c2-native-e2e-20261115 spaces-雪-'))
const generatedName = 'ff-be06-native-e2e'
const cancelledName = 'ff-be06-native-cancel'
const collisionName = 'ff-be06-native-collision'
const targetPath = join(parent, generatedName)
const cancelledPath = join(parent, cancelledName)
const collisionPath = join(parent, collisionName)
await mkdir(collisionPath)
const sentinelPath = join(collisionPath, 'keep.txt')
await writeFile(sentinelPath, 'preserve this file\n')
const sentinelHash = createHash('sha256').update(await readFile(sentinelPath)).digest('hex')

let socket
let nextCommandId = 0
const pending = new Map()
let localStorageSnapshot
let allChecksComplete = false

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))

async function waitForDevTools() {
  const deadline = Date.now() + 120_000
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${debugBase}/json/list`)
      assert.equal(response.status, 200)
      const target = (await response.json()).find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
      if (target) return target
    } catch (error) {
      lastError = error
    }
    await delay(500)
  }
  throw new Error(`WebView2 DevTools endpoint unavailable at ${debugBase}: ${lastError ?? 'timeout'}`)
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

async function evaluate(expression, timeoutMs = 30_000) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, timeoutMs)
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result?.value
}

async function waitFor(expression, description, timeoutMs = 30_000, pollMs = 150) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await evaluate(`(() => { return ${expression} })()`)
    if (value) return value
    await delay(pollMs)
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

async function configureFastApi(name) {
  await waitFor("document.querySelector('#project-name') !== null", `${name} project details`)
  await fill('#project-name', name)
  await fill('#project-parent', parent)
  await click('.wizard-actions .primary-button', 'Choose framework')
  await waitFor("[...document.querySelectorAll('.compact-choice')].some((button) => button.textContent.includes('Backend'))", `${name} project types`)
  await click('.compact-choice', 'Backend')
  await click('.select-card', 'FastAPI')
  await click('.wizard-actions .primary-button', 'Choose tools')
  await waitFor("document.body.innerText.includes('Python · FastAPI · Pydantic · Uvicorn · uv')", `${name} FastAPI tools`)
  await click('.wizard-actions .primary-button', 'Documentation')
  await click('.docs-card', 'Standard')
  await click('.wizard-actions .primary-button', 'Review configuration')
  await waitFor("document.querySelector('#review-title') && document.body.innerText.includes('BE-06') && !document.querySelector('.inline-loading')", `${name} plan and Doctor`)
  return evaluate(`({
    text: document.body.innerText,
    doctor: [...document.querySelectorAll('.doctor-row')].map((row) => row.innerText),
    lifecycleConsent: document.querySelector('.consent-box input')?.checked ?? null,
    lifecycleConsentPresent: document.querySelector('.consent-box') !== null,
    plannedConsent: document.querySelector('.internal-consent input')?.checked ?? null,
    createDisabled: [...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && button.disabled),
  })`)
}

async function assertConsentGates() {
  const review = await evaluate(`({
    text: document.body.innerText,
    lifecycleConsentPresent: document.querySelector('.consent-box') !== null,
    lifecycleConsent: document.querySelector('.consent-box input')?.checked ?? null,
    plannedConsent: document.querySelector('.internal-consent input')?.checked ?? null,
    createDisabled: [...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && button.disabled),
  })`)
  assert.equal(review.lifecycleConsentPresent, true)
  assert.equal(review.lifecycleConsent, false)
  assert.equal(review.plannedConsent, false)
  assert.equal(review.createDisabled, true)
  await setCheckbox('.consent-box input')
  assert.equal(await evaluate("[...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && button.disabled)"), true, 'planned consent must remain closed')
  await setCheckbox('.internal-consent input')
  await waitFor("[...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && !button.disabled)", 'both explicit consent gates')
}

async function startWizardFromHome() {
  await waitFor("document.querySelector('.hero-actions .primary-button') && !document.querySelector('.hero-actions .primary-button').disabled", 'Forge Studio home and catalog')
  await click('.hero-actions .primary-button', 'Create project')
}

let target
try {
  target = await waitForDevTools()
  await connectDevTools(target)
  localStorageSnapshot = await evaluate('Array.from({length: localStorage.length}, (_, i) => { const key = localStorage.key(i); return [key, localStorage.getItem(key)] })')

  await waitFor("document.querySelector('.nav-item') !== null", 'Forge Studio navigation')
  await startWizardFromHome()
  const initialReview = await configureFastApi(generatedName)
  assert.ok(initialReview.text.includes('BE-06') && initialReview.text.includes('planned'))
  assert.ok(initialReview.text.includes('Python · uv'))
  assert.ok(initialReview.text.includes('uv.lock'))
  assert.ok(initialReview.doctor.some((row) => /python/i.test(row) && row.includes('3.14.10') && row.includes('Ready')), `Python Doctor missing: ${JSON.stringify(initialReview.doctor)}`)
  assert.ok(initialReview.doctor.some((row) => /uv/i.test(row) && row.includes('0.13.8') && row.includes('Ready')), `uv Doctor missing: ${JSON.stringify(initialReview.doctor)}`)
  assert.equal(initialReview.lifecycleConsentPresent, true)
  assert.equal(initialReview.lifecycleConsent, false)
  assert.equal(initialReview.plannedConsent, false)
  assert.equal(initialReview.createDisabled, true)
  await assertConsentGates()
  await click('.wizard-actions .primary-button', 'Create project')
  await waitFor("document.querySelector('#generation-title') !== null", 'Tauri BE-06 generation start')
  await waitFor("document.querySelector('#result-title')?.textContent.includes('Project checks passed')", 'BE-06 generated project result', 20 * 60 * 1000)

  const project = await lstat(targetPath)
  assert.ok(project.isDirectory() && !project.isSymbolicLink())
  const manifest = JSON.parse(await readFile(join(targetPath, '.project-generator', 'manifest.json'), 'utf8'))
  assert.equal(manifest.recipeId, 'BE-06')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.projectType, 'backend')
  assert.equal(manifest.packageManager, 'uv')
  assert.deepEqual(manifest.toolVersions, { python: '3.14.10', uv: '0.13.8' })
  assert.deepEqual(manifest.lockfiles.map(({ name }) => name), ['uv.lock'])
  const lockPath = join(targetPath, 'uv.lock')
  const lockBytes = await readFile(lockPath)
  const lockHash = createHash('sha256').update(lockBytes).digest('hex')
  assert.equal(manifest.lockfiles[0].sha256, lockHash)
  const lockText = lockBytes.toString('utf8')
  assert.match(lockText, /name = "fastapi"[\s\S]*?version = "0\.163\.0"/)
  assert.match(lockText, /name = "pydantic"[\s\S]*?version = "2\.14\.3"/)
  assert.match(lockText, /name = "uvicorn"[\s\S]*?version = "0\.54\.0"/)
  assert.match(lockText, /name = "pytest"[\s\S]*?version = "9\.2\.0"/)
  assert.match(lockText, /name = "httpx"[\s\S]*?version = "0\.28\.1"/)
  const pyproject = await readFile(join(targetPath, 'pyproject.toml'), 'utf8')
  assert.match(pyproject, /requires-python = ">=3\.14,<3\.15"/)
  assert.match(pyproject, /pythonpath = \["\."\]/)
  assert.equal((await readFile(join(targetPath, '.python-version'), 'utf8')).trim(), '3.14.0')
  const venv = await lstat(join(targetPath, '.venv'))
  assert.ok(venv.isDirectory() && !venv.isSymbolicLink())
  await access(join(targetPath, '.venv', 'Scripts', 'python.exe'))
  for (const check of ['uv-lock', 'dependency-install', 'dependency-integrity', 'lockfile-integrity', 'python-syntax', 'pytest', 'graceful-shutdown', 'http-smoke', 'openapi']) {
    assert.equal(manifest.validation.find((item) => item.id === check)?.status, 'pass', check)
  }
  const generatedFiles = await readdir(targetPath)
  for (const unwanted of ['package-lock.json', 'requirements.txt', 'poetry.lock', 'go.mod']) assert.ok(!generatedFiles.includes(unwanted), `unexpected file ${unwanted}`)
  const validationEvents = await evaluate("[...document.querySelectorAll('.validation-list li')].map((item) => item.textContent.trim())")
  assert.ok(validationEvents.some((line) => line.includes('http-smoke')))
  assert.ok(validationEvents.some((line) => line.includes('openapi')))
  assert.ok((await evaluate('document.body.innerText')).includes('Recipe remains planned.'))

  await click('.result-actions button', 'Open folder')
  await delay(250)
  assert.equal(await evaluate("document.querySelector('.notice-error') === null"), true, 'Open folder returned an error')
  const canOpenCode = await evaluate("[...document.querySelectorAll('.result-actions button')].some((button) => button.textContent.includes('Open in VS Code'))")
  if (canOpenCode) {
    await click('.result-actions button', 'Open in VS Code')
    await delay(250)
    assert.equal(await evaluate("document.querySelector('.notice-error') === null"), true, 'Open in VS Code returned an error')
  }
  await click('.nav-item', 'Recent projects')
  await waitFor("document.querySelector('#projects-title') !== null", 'BE-06 history entry')
  const history = await evaluate('document.body.innerText')
  assert.ok(history.includes(generatedName) && history.includes('BE-06') && history.includes('Checks passed'))

  await click('.page-heading .primary-button', 'Create project')
  const cancelReview = await configureFastApi(cancelledName)
  assert.ok(cancelReview.text.includes('BE-06'))
  await assertConsentGates()
  await click('.wizard-actions .primary-button', 'Create project')
  await waitFor("document.querySelector('#generation-title') !== null", 'Tauri cancellation run start')
  const cancelStage = await waitFor(`(() => {
    const messages = [...document.querySelectorAll('.activity-event p')].map((item) => item.textContent ?? '');
    return messages.find((message) => message === 'installing started.' || message === 'validating started.') ?? null;
  })()`, 'BE-06 install or validation stage before cancellation', 10 * 60 * 1000, 25)
  await click('.cancel-row .danger-button', 'Cancel generation')
  await waitFor("document.querySelector('#result-title')?.textContent.includes('Generation cancelled')", 'Tauri BE-06 cancellation result', 3 * 60 * 1000)
  await assert.rejects(access(cancelledPath))
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])
  await click('.result-next button', 'Inspect recovery')
  await waitFor("document.querySelector('.recovery-details pre') !== null", 'read-only cancellation recovery inspection')
  const recoveryReports = JSON.parse(await evaluate("document.querySelector('.recovery-details pre')?.textContent ?? 'null'"))
  assert.ok(Array.isArray(recoveryReports))
  const cancellationReports = recoveryReports.filter((report) => JSON.stringify(report).toLowerCase().includes(cancelledName.toLowerCase()))
  assert.deepEqual(cancellationReports, [], `BE-06 cancellation left recovery state: ${JSON.stringify(cancellationReports)}`)

  await click('.result-next .primary-button', 'Create another')
  const collisionReview = await configureFastApi(collisionName)
  assert.ok(collisionReview.text.includes('BLOCKED') && collisionReview.text.toLowerCase().includes('already exists'))
  assert.equal(collisionReview.createDisabled, true)
  assert.equal(createHash('sha256').update(await readFile(sentinelPath)).digest('hex'), sentinelHash)
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])

  allChecksComplete = true
  console.log(JSON.stringify({
    phase: '05C.2',
    flow: 'Windows Forge Studio + Tauri + development CLI',
    host: `${process.platform}-${process.arch}`,
    python: pythonVersion,
    uv: uvVersion,
    recipe: manifest.recipeId,
    statusAtCreation: manifest.recipeStatusAtCreation,
    lockSha256: lockHash,
    validations: manifest.validation.map(({ id, status }) => ({ id, status })),
    consentGates: 'lifecycle/build-code and planned-recipe gates both closed by default; each explicitly affirmed',
    resultAndHistory: 'passed; status remains planned',
    openFolder: 'pass',
    openVsCode: canOpenCode ? 'pass' : 'skipped; VS Code unavailable',
    cancellation: `reached ${cancelStage}; target absent; owned staging removed; no matching recovery record`,
    collision: 'Doctor blocked generation; sentinel hash unchanged; no staging',
    unrelatedRecoveryReports: recoveryReports.map(({ jobId, state, phase }) => ({ jobId, state, phase })),
    projectManifestSha256: createHash('sha256').update(await readFile(join(targetPath, '.project-generator', 'manifest.json'))).digest('hex'),
    releaseApproved: false,
  }, null, 2))
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    if (localStorageSnapshot) {
      await evaluate(`(() => {
        localStorage.clear();
        for (const [key, value] of ${JSON.stringify(localStorageSnapshot)}) localStorage.setItem(key, value);
        return true;
      })()`).catch(() => undefined)
      await command('Page.reload', { ignoreCache: true }).catch(() => undefined)
    }
    socket.close()
  }
  if (allChecksComplete) await rm(parent, { recursive: true, force: true })
  else console.error(`Incomplete native BE-06 E2E artifacts retained for diagnosis: ${parent}`)
}
