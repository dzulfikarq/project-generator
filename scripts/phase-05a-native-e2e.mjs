import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'

if (process.platform !== 'win32') throw new Error('Phase 05A native acceptance requires Windows.')
const debugPort = Number(process.env.PG_WEBVIEW_DEBUG_PORT ?? 9339)
const debugBase = `http://127.0.0.1:${debugPort}`
const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
await access(tempBase)
assert.ok((await stat(tempBase)).isDirectory())
const parent = await mkdtemp(join(tempBase, 'phase-05a-native-e2e-20261114 spaces-雪-'))
const generatedName = 'pg-be-01-express'
const collisionName = 'pg-be-01-collision'
const collisionPath = join(parent, collisionName)
await mkdir(collisionPath)
const sentinelPath = join(collisionPath, 'keep.txt')
await writeFile(sentinelPath, 'preserve this file\n')

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

async function chooseBackend(name) {
  await waitFor("document.querySelector('#project-name') !== null", `${name} details`)
  await fill('#project-name', name)
  await fill('#project-parent', parent)
  await click('.wizard-actions .primary-button', 'Choose framework')
  await waitFor("[...document.querySelectorAll('.compact-choice')].some((button) => button.textContent.includes('Backend'))", `${name} project types`)
  await click('.compact-choice', 'Backend')
  await click('.select-card', 'Express')
  await click('.wizard-actions .primary-button', 'Choose tools')
  await waitFor("document.body.innerText.includes('BE-01 uses TypeScript and npm')", `${name} backend tools`)
  await click('.wizard-actions .primary-button', 'Documentation')
  await click('.docs-card', 'Standard')
  await click('.wizard-actions .primary-button', 'Review configuration')
}

const target = await waitForDevTools()
await connectDevTools(target)
const localStorageSnapshot = await evaluate('Array.from({length: localStorage.length}, (_, i) => { const key = localStorage.key(i); return [key, localStorage.getItem(key)] })')

try {
  await waitFor("document.querySelector('.hero-actions .primary-button') && !document.querySelector('.hero-actions .primary-button').disabled", 'Forge Studio home and packaged catalog')
  await click('.hero-actions .primary-button', 'Create project')
  await chooseBackend(generatedName)
  await waitFor("document.body.innerText.includes('BE-01') && document.body.innerText.includes('Express REST API')", 'BE-01 review plan')
  await click('summary', 'Expected project files')
  const initialReview = await evaluate(`({
    text: document.body.innerText,
    lifecycleUnchecked: document.querySelector('.consent-box input')?.checked === false,
    plannedUnchecked: document.querySelector('.internal-consent input')?.checked === false,
    createDisabled: [...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && button.disabled),
  })`)
  assert.ok(initialReview.text.includes('planned'))
  assert.ok(initialReview.text.includes('package-lock.json'))
  assert.ok(initialReview.text.includes('.env.example'))
  assert.ok(initialReview.text.includes('READY'))
  assert.equal(initialReview.lifecycleUnchecked, true)
  assert.equal(initialReview.plannedUnchecked, true)
  assert.equal(initialReview.createDisabled, true)

  await setCheckbox('.consent-box input')
  assert.equal(await evaluate("[...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && !button.disabled)"), false, 'lifecycle consent alone must not enable planned recipe')
  await setCheckbox('.internal-consent input')
  await waitFor("[...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && !button.disabled)", 'explicit lifecycle and planned-recipe consent')
  await click('.wizard-actions .primary-button', 'Create project')
  await waitFor("document.querySelector('#generation-title') !== null", 'Tauri CLI generation start')
  await waitFor("document.querySelector('#result-title')?.textContent.includes('Project checks passed')", 'BE-01 generated project result', 20 * 60 * 1000)

  const projectPath = join(parent, generatedName)
  const manifest = JSON.parse(await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8'))
  assert.equal(manifest.recipeId, 'BE-01')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.projectType, 'backend')
  assert.equal(manifest.packageManager, 'npm')
  for (const check of ['dependency-install', 'dependency-integrity', 'lockfile-integrity', 'typecheck', 'unit-tests', 'graceful-shutdown', 'build', 'http-smoke']) {
    assert.equal(manifest.validation.find((item) => item.id === check)?.status, 'pass', check)
  }
  const lock = JSON.parse(await readFile(join(projectPath, 'package-lock.json'), 'utf8'))
  for (const dependency of manifest.upstreamSources.filter(({ package: packageName }) => packageName && packageName !== 'npm')) {
    if (!dependency.integrity?.startsWith('sha512-')) continue
    const locked = lock.packages[`node_modules/${dependency.package}`]
    if (locked) assert.equal(locked.integrity, dependency.integrity)
  }
  const lockBytes = await readFile(join(projectPath, 'package-lock.json'))
  assert.equal(manifest.lockfiles[0].sha256, createHash('sha256').update(lockBytes).digest('hex'))

  const validationEvents = await evaluate("[...document.querySelectorAll('.validation-list li')].map((item) => item.textContent.trim())")
  assert.ok(validationEvents.some((line) => line.includes('http-smoke')))
  assert.ok(validationEvents.some((line) => line.includes('graceful-shutdown')))
  assert.ok((await evaluate('document.body.innerText')).includes('Recipe remains planned.'))

  await click('.result-actions button', 'Open folder')
  const canOpenCode = await evaluate("[...document.querySelectorAll('.result-actions button')].some((button) => button.textContent.includes('Open in VS Code'))")
  if (canOpenCode) await click('.result-actions button', 'Open in VS Code')
  await click('.nav-item', 'Recent projects')
  await waitFor("document.querySelector('#projects-title') !== null", 'BE-01 history record')
  const history = await evaluate('document.body.innerText')
  assert.ok(history.includes(generatedName))
  assert.ok(history.includes('BE-01'))

  await click('.page-heading .primary-button', 'Create project')
  await chooseBackend(collisionName)
  await waitFor("document.body.innerText.includes('BLOCKED')", 'collision Doctor rejection')
  const collisionReview = await evaluate(`({
    text: document.body.innerText,
    createDisabled: [...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && button.disabled),
  })`)
  assert.ok(collisionReview.text.includes('already exists'))
  assert.equal(collisionReview.createDisabled, true)
  assert.equal(await readFile(sentinelPath, 'utf8'), 'preserve this file\n')
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])
  allChecksComplete = true
  console.log(JSON.stringify({
    phase: '05A',
    flow: 'Windows Forge Studio + Tauri + packaged development CLI',
    host: `${process.platform}-${process.arch}`,
    node: process.version,
    recipe: manifest.recipeId,
    lifecycleAndPlannedConsent: 'both explicitly affirmed; defaults closed',
    validations: manifest.validation.map(({ id, status }) => ({ id, status })),
    resultAndHistory: 'pass',
    openFolder: 'pass',
    openVsCode: canOpenCode ? 'pass' : 'skipped; VS Code unavailable',
    collision: 'blocked; sentinel preserved; no staging',
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
  else console.error(`Incomplete native BE-01 E2E artifacts retained for diagnosis: ${parent}`)
}
