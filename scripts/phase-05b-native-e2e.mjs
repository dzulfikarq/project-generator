import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'
import { resolveGoTool, supportsGo } from '../packages/core/dist/src/index.js'

if (process.platform !== 'win32') throw new Error('Phase 05B native acceptance requires Windows.')
const debugPort = Number(process.env.PG_WEBVIEW_DEBUG_PORT ?? 9339)
const debugBase = `http://localhost:${debugPort}`
const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
const go = await resolveGoTool()
if (!go) throw new Error('Go SDK not found on PATH or GOROOT.')
const goVersionResult = spawnSync(go.executablePath, ['version'], { encoding: 'utf8', windowsHide: true })
assert.equal(goVersionResult.status, 0, goVersionResult.stderr)
const goVersion = /^go version go(\d+\.\d+(?:\.\d+)?)/.exec(goVersionResult.stdout)?.[1]
assert.ok(goVersion && supportsGo(goVersion), `unsupported Go toolchain: ${goVersionResult.stdout}`)
await access(tempBase)
assert.ok((await stat(tempBase)).isDirectory())
const parent = await mkdtemp(join(tempBase, 'phase-05b-native-e2e-20261115 spaces-雪-'))
const generatedName = 'pg-be-02-go'
const generatedModule = 'github.com/example/pg-be-02-go'
const cancelledName = 'pg-be-02-cancel'
const collisionName = 'pg-be-02-collision'
const collisionPath = join(parent, collisionName)
await mkdir(collisionPath)
const sentinelPath = join(collisionPath, 'keep.txt')
await writeFile(sentinelPath, 'preserve this file\n')
const sentinelHash = createHash('sha256').update(await readFile(sentinelPath)).digest('hex')

let socket
let nextCommandId = 0
const pending = new Map()
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
  throw new Error(`WebView2 DevTools endpoint unavailable at ${debugBase}; set WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=${debugPort}. ${lastError ?? ''}`)
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
    await fill('#go-module-path', 'github.com/../escape')
    const invalidState = await evaluate(`({
      invalid: document.querySelector('#go-module-path').getAttribute('aria-invalid') === 'true',
      nextDisabled: [...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Documentation') && button.disabled),
      error: document.querySelector('#go-module-path-error')?.textContent,
    })`)
    assert.equal(invalidState.invalid, true)
    assert.equal(invalidState.nextDisabled, true)
    assert.match(invalidState.error ?? '', /lowercase Go module path/)
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

const target = await waitForDevTools()
await connectDevTools(target)
const localStorageSnapshot = await evaluate('Array.from({length: localStorage.length}, (_, i) => { const key = localStorage.key(i); return [key, localStorage.getItem(key)] })')

try {
  await waitFor("document.querySelector('.nav-item') !== null", 'Forge Studio navigation')
  await click('.nav-item', 'Overview')
  await waitFor("document.querySelector('.hero-actions .primary-button') && !document.querySelector('.hero-actions .primary-button').disabled", 'Forge Studio home and packaged catalog')
  await click('.hero-actions .primary-button', 'Create project')
  const initialReview = await reviewGo(generatedName, generatedModule, true)
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
  await click('.wizard-actions .primary-button', 'Create project')
  await waitFor("document.querySelector('#generation-title') !== null", 'Tauri Go CLI generation start')
  await waitFor("document.querySelector('#result-title')?.textContent.includes('Project checks passed')", 'BE-02 generated project result', 20 * 60 * 1000)

  const projectPath = join(parent, generatedName)
  const manifest = JSON.parse(await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8'))
  assert.equal(manifest.recipeId, 'BE-02')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.projectType, 'backend')
  assert.equal(manifest.packageManager, 'go-modules')
  assert.equal(manifest.modulePath, generatedModule)
  assert.deepEqual(manifest.dependencyFiles, ['go.mod'])
  assert.equal(manifest.lockfiles, undefined)
  for (const check of ['go-module', 'go-fmt', 'go-vet', 'go-test', 'go-build', 'http-smoke']) {
    assert.equal(manifest.validation.find((item) => item.id === check)?.status, 'pass', check)
  }
  assert.equal(await readFile(join(projectPath, 'go.mod'), 'utf8'), `module ${generatedModule}\n\ngo 1.22.0\n`)
  await assert.rejects(access(join(projectPath, 'go.sum')))
  assert.equal((await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8')).includes('npm'), false)
  const validations = await evaluate("[...document.querySelectorAll('.validation-list li')].map((item) => item.textContent.trim())")
  assert.ok(validations.some((line) => line.includes('http-smoke')))
  assert.ok((await evaluate('document.body.innerText')).includes('Recipe remains planned.'))

  await click('.result-actions button', 'Open folder')
  const canOpenCode = await evaluate("[...document.querySelectorAll('.result-actions button')].some((button) => button.textContent.includes('Open in VS Code'))")
  if (canOpenCode) await click('.result-actions button', 'Open in VS Code')
  await click('.nav-item', 'Recent projects')
  await waitFor("document.querySelector('#projects-title') !== null", 'BE-02 history record')
  const history = await evaluate('document.body.innerText')
  assert.ok(history.includes(generatedName))
  assert.ok(history.includes('BE-02'))

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
    openVsCode: canOpenCode ? 'pass' : 'skipped; VS Code unavailable',
    cancellation: 'reached Go validation; target absent; owned staging cleaned; no BE-02 recovery record',
    unrelatedRecoveryReports: recoveryReports.map(({ jobId, state, phase }) => ({ jobId, state, phase })),
    collision: 'blocked in Doctor; sentinel preserved; no staging',
    releaseApproved: false,
  }, null, 2))
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    await evaluate(`(() => {
      localStorage.clear();
      for (const [key, value] of ${JSON.stringify(localStorageSnapshot)}) localStorage.setItem(key, value);
      return true;
    })()`).catch(() => undefined)
    await command('Page.reload', { ignoreCache: true }).catch(() => undefined)
    socket.close()
  }
  if (allChecksComplete) await rm(parent, { recursive: true, force: true })
  else console.error(`Incomplete native BE-02 E2E artifacts retained for diagnosis: ${parent}`)
}
