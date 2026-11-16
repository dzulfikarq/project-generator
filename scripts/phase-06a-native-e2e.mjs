import assert from 'node:assert/strict'
import { access, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'

if (process.platform !== 'win32') throw new Error('Phase 06A native acceptance requires Windows.')
const debugPort = Number(process.env.PG_WEBVIEW_DEBUG_PORT ?? 9340)
const debugBase = `http://127.0.0.1:${debugPort}`
const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
await access(tempBase)
assert.ok((await stat(tempBase)).isDirectory())
const parent = await mkdtemp(join(tempBase, 'phase-06a-native-e2e-20261116 spaces-雪-'))
const cancelName = 'pg-be07-cancel'
const generatedName = 'pg-be07-notes'
const collisionName = 'pg-be07-collision'
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
  const deadline = Date.now() + 300_000
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${debugBase}/json/list`)
      assert.equal(response.status, 200)
      const target = (await response.json()).find((item) => item.type === 'page'
        && (item.url ?? '').startsWith('http://127.0.0.1:1420/') && item.webSocketDebuggerUrl)
      if (target) return target
    } catch (error) {
      lastError = error
    }
    await delay(500)
  }
  throw new Error(`WebView2 DevTools endpoint unavailable at ${debugBase}; launch desktop:dev with WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=${debugPort}. ${lastError ?? ''}`)
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
  await click('.compact-choice', 'Backend')
  await click('.select-card', 'Express')
  await click('.wizard-actions .primary-button', 'Choose tools')
  await click('.compact-choice', 'SQLite')
  await click('.compact-choice', 'Drizzle ORM')
  const selections = await evaluate(`({
    manager: document.querySelector('#backend-manager')?.value,
    sqlite: [...document.querySelectorAll('.compact-choice')].find((button) => button.textContent.includes('SQLite'))?.getAttribute('aria-pressed'),
    drizzle: [...document.querySelectorAll('.compact-choice')].find((button) => button.textContent.includes('Drizzle ORM'))?.getAttribute('aria-pressed'),
    be01StillOffered: document.body.innerText.includes('BE-01') && document.body.innerText.includes('BE-07'),
  })`)
  assert.deepEqual(selections, { manager: 'npm', sqlite: 'true', drizzle: 'true', be01StillOffered: true })
  await click('.wizard-actions .primary-button', 'Documentation')
  await click('.docs-card', 'Standard')
  await click('.wizard-actions .primary-button', 'Review configuration')
}

async function approvePlannedRecipe() {
  await waitFor("document.body.innerText.includes('BE-07') && document.body.innerText.includes('Drizzle')", 'BE-07 plan')
  await click('summary', 'Expected project files')
  const review = await evaluate(`({
    text: document.body.innerText,
    lifecycleUnchecked: document.querySelector('.consent-box input')?.checked === false,
    plannedUnchecked: document.querySelector('.internal-consent input')?.checked === false,
    createDisabled: [...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && button.disabled),
  })`)
  assert.ok(review.text.includes('never applies migrations'))
  assert.ok(review.text.includes('isolated temporary SQLite database'))
  assert.ok(review.text.includes('drizzle/*.sql'))
  assert.ok(review.text.includes('READY'))
  assert.equal(review.lifecycleUnchecked, true)
  assert.equal(review.plannedUnchecked, true)
  assert.equal(review.createDisabled, true)
  await setCheckbox('.consent-box input')
  assert.equal(await evaluate("[...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && !button.disabled)"), false, 'lifecycle consent alone must not enable planned recipe')
  await setCheckbox('.internal-consent input')
  await waitFor("[...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && !button.disabled)", 'both explicit approvals')
}

const target = await waitForDevTools()
await connectDevTools(target)
let localStorageSnapshot = []
let storageCaptured = false

try {
  await waitFor("document.querySelector('.hero-actions .primary-button') && !document.querySelector('.hero-actions .primary-button').disabled", 'Forge Studio home and packaged catalog')
  localStorageSnapshot = await evaluate('Array.from({length: localStorage.length}, (_, i) => { const key = localStorage.key(i); return [key, localStorage.getItem(key)] })')
  storageCaptured = true

  await click('.hero-actions .primary-button', 'Create project')
  await chooseBackend(cancelName)
  await approvePlannedRecipe()
  await click('.wizard-actions .primary-button', 'Create project')
  await waitFor("document.querySelector('#generation-title') !== null", 'native BE-07 cancellation run')
  await waitFor("document.querySelector('.activity-list')?.innerText.toLowerCase().includes('installing')", 'BE-07 npm installation', 10 * 60 * 1000)
  await waitFor("document.querySelector('.cancel-row button') && !document.querySelector('.cancel-row button').disabled", 'native cancellation control')
  await click('.cancel-row button', 'Cancel generation')
  await waitFor("document.querySelector('#result-title')?.textContent.includes('Generation cancelled')", 'cancelled result', 5 * 60 * 1000)
  await assert.rejects(access(join(parent, cancelName)))
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])

  await click('.result-next .primary-button', 'Create another')
  await chooseBackend(generatedName)
  await approvePlannedRecipe()
  await click('.wizard-actions .primary-button', 'Create project')
  await waitFor("document.querySelector('#result-title')?.textContent.includes('Project checks passed')", 'BE-07 generated project result', 25 * 60 * 1000)

  const projectPath = join(parent, generatedName)
  const manifest = JSON.parse(await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8'))
  assert.equal(manifest.recipeId, 'BE-07')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.projectType, 'backend')
  assert.equal(manifest.packageManager, 'npm')
  assert.ok(manifest.selectedAdapters.some(({ id }) => id === 'database.sqlite'))
  assert.ok(manifest.selectedAdapters.some(({ id }) => id === 'data-access.drizzle-sqlite'))
  for (const check of ['dependency-install', 'dependency-integrity', 'lockfile-integrity', 'migration-generation', 'typecheck', 'lint', 'unit-tests', 'database-integration-tests', 'graceful-shutdown', 'build', 'http-smoke']) {
    assert.equal(manifest.validation.find((item) => item.id === check)?.status, 'pass', check)
  }
  await assert.rejects(access(join(projectPath, 'data', 'notes.sqlite')))
  await assert.rejects(access(join(projectPath, '.tmp')))
  assert.ok((await readdir(join(projectPath, 'drizzle'))).some((file) => /^\d{4}_.+\.sql$/.test(file)))
  assert.match(await readFile(join(projectPath, 'README.md'), 'utf8'), /never applies migrations|never.*migrations/i)

  await click('.result-actions button', 'Open folder')
  await click('.nav-item', 'Recent projects')
  await waitFor("document.querySelector('#projects-title') !== null", 'BE-07 history record')
  const history = await evaluate('document.body.innerText')
  assert.ok(history.includes(generatedName))
  assert.ok(history.includes('BE-07'))

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
    phase: '06A',
    flow: 'Windows Forge Studio + native Tauri + packaged development CLI',
    host: `${process.platform}-${process.arch}`,
    node: process.version,
    recipe: manifest.recipeId,
    recipeStatus: manifest.recipeStatusAtCreation,
    compatibility: 'Express + npm + SQLite + Drizzle selected; BE-01 no-database remains available',
    lifecycleAndPlannedConsent: 'both explicitly affirmed; defaults closed; each gate required',
    validations: manifest.validation.map(({ id, status }) => ({ id, status })),
    applicationDatabase: 'not created or migrated during generation; HTTP smoke used :memory:',
    cancellation: 'cancelled during npm install; target absent and owned staging cleaned',
    resultAndHistory: 'pass',
    openFolder: 'pass',
    collision: 'blocked; existing sentinel preserved; no staging',
    releaseApproved: false,
  }, null, 2))
} finally {
  if (socket?.readyState === WebSocket.OPEN) {
    if (storageCaptured) await evaluate(`(() => {
        localStorage.clear();
        for (const [key, value] of ${JSON.stringify(localStorageSnapshot)}) localStorage.setItem(key, value);
        return true;
      })()`).catch(() => undefined)
    await command('Page.reload', { ignoreCache: true }).catch(() => undefined)
    socket.close()
  }
  if (allChecksComplete) await rm(parent, { recursive: true, force: true })
  else console.error(`Incomplete native BE-07 E2E artifacts retained for diagnosis: ${parent}`)
}
