import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'

const debugPort = Number(process.env.PG_WEBVIEW_DEBUG_PORT ?? 9338)
const debugBase = `http://127.0.0.1:${debugPort}`
const tempBase = join(process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local'), 'Temp', 'opencode')
await access(tempBase)
assert.ok((await stat(tempBase)).isDirectory(), 'approved temp root must be a directory')

const parent = await mkdtemp(join(tempBase, 'phase-04b3-native-e2e-20261114 spaces-雪-'))
const cases = [
  ['FE-12', 'react-yarn', 'React + Vite', 'yarn', '4.18.1', 'yarn.lock'],
  ['FE-13', 'vue-yarn', 'Vue', 'yarn', '4.18.1', 'yarn.lock'],
  ['FE-14', 'react-pnpm', 'React + Vite', 'pnpm', '11.28.11', 'pnpm-lock.yaml'],
  ['FE-15', 'vue-pnpm', 'Vue', 'pnpm', '11.28.11', 'pnpm-lock.yaml'],
]

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
let socket
let nextCommandId = 0
const pending = new Map()

async function waitForDevTools() {
  const deadline = Date.now() + 120_000
  let lastError
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${debugBase}/json/list`)
      assert.equal(response.status, 200)
      const targets = await response.json()
      const target = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl)
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
    const command = pending.get(message.id)
    if (!command) return
    pending.delete(message.id)
    clearTimeout(command.timer)
    if (message.error) command.reject(new Error(message.error.message))
    else command.resolve(message.result)
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
  const response = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  }, timeoutMs)
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
  }
  return response.result?.value
}

async function waitFor(predicate, description, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await evaluate(`(() => { return ${predicate} })()`)
    if (result) return result
    await delay(250)
  }
  const pageText = await evaluate('document.body.innerText.slice(-5000)')
  throw new Error(`Timed out waiting for ${description}. Current page text:\n${pageText}`)
}

async function click(selector, text) {
  const result = await evaluate(`(() => {
    const element = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find((candidate) => candidate.textContent.includes(${JSON.stringify(text)}));
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
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, ${JSON.stringify(value)});
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

async function readManifest(projectPath, expected) {
  const manifest = JSON.parse(await readFile(join(projectPath, '.project-generator', 'manifest.json'), 'utf8'))
  assert.equal(manifest.recipeId, expected[0])
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.packageManager, expected[3])
  assert.equal(manifest.toolVersions[expected[3]], expected[4])
  const nodeLinker = expected[3] === 'yarn' ? 'node-modules' : 'hoisted'
  const configFile = expected[3] === 'yarn' ? '.yarnrc.yml' : 'pnpm-workspace.yaml'
  assert.deepEqual(manifest.packageManagerConfig, { nodeLinker, file: configFile })
  assert.ok(manifest.generatedFiles.includes(configFile))
  assert.equal(await readFile(join(projectPath, configFile), 'utf8'), `nodeLinker: ${nodeLinker}\n`)
  assert.deepEqual(manifest.lockfiles.map(({ name }) => name), [expected[5]])
  const lockBytes = await readFile(join(projectPath, expected[5]))
  const lockHash = createHash('sha256').update(lockBytes).digest('hex')
  assert.equal(manifest.lockfiles[0].sha256, lockHash)
  const lockfiles = (await readdir(projectPath)).filter((name) => ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml'].includes(name))
  assert.deepEqual(lockfiles, [expected[5]])
  for (const id of ['package-manager-integrity', 'dependency-install', 'lockfile-integrity', 'lint', 'typecheck', 'build', 'http-smoke']) {
    assert.equal(manifest.validation.find((item) => item.id === id)?.status, 'pass', `${expected[0]} ${id}`)
  }
  const readme = await readFile(join(projectPath, 'README.md'), 'utf8')
  assert.match(readme, new RegExp(`${expected[3]} install`))
  const agents = await readFile(join(projectPath, 'AGENTS.md'), 'utf8')
  assert.match(agents, new RegExp(`${expected[3]}.*${expected[5]}`))
  return { recipeId: manifest.recipeId, manager: manifest.packageManager, lockfile: expected[5], lockSha256: lockHash }
}

const localStorageSnapshot = await (async () => {
  const target = await waitForDevTools()
  await connectDevTools(target)
  return evaluate('Array.from({length: localStorage.length}, (_, i) => { const key = localStorage.key(i); return [key, localStorage.getItem(key)] })')
})()
const results = []
let allRunsComplete = false

try {
  await waitFor("document.querySelector('.hero-actions .primary-button') && !document.querySelector('.hero-actions .primary-button').disabled", 'native home and packaged catalog')
  for (const [recipeId, name, framework, manager, version, lockfile] of cases) {
    const projectName = `pg-${recipeId.toLowerCase()}-${name}`
    if (results.length === 0) await click('.hero-actions .primary-button', 'Create project')
    else await click('.result-next .primary-button', 'Create another')
    await waitFor("document.querySelector('#project-name') !== null", `${recipeId} project details`)
    await fill('#project-name', projectName)
    await fill('#project-parent', parent)
    await click('.wizard-actions .primary-button', 'Choose framework')
    await waitFor("document.querySelector('.select-card') !== null", `${recipeId} framework choices`)
    await click('.select-card', framework)
    await click('.wizard-actions .primary-button', 'Choose tools')
    await waitFor("document.querySelector('.manager-choice') !== null", `${recipeId} package-manager choices`)
    await click('.manager-choice', manager === 'yarn' ? 'Yarn' : 'pnpm')
    await click('.wizard-actions .primary-button', 'Documentation')
    await waitFor("document.querySelector('.docs-card') !== null", `${recipeId} documentation choices`)
    await click('.docs-card', 'Standard')
    await click('.wizard-actions .primary-button', 'Review configuration')
    await waitFor(`document.body.innerText.includes('${recipeId}') && document.body.innerText.toLowerCase().includes('${manager} · ${version}')`, `${recipeId} plan, Doctor and pinned manager`)

    const review = await evaluate(`({
      text: document.body.innerText,
      consentUnchecked: document.querySelector('.consent-box input')?.checked === false,
      plannedUnchecked: document.querySelector('.internal-consent input')?.checked === false,
      createDisabled: [...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && button.disabled),
    })`)
    assert.ok(review.text.includes(recipeId) && review.text.includes('planned'))
    assert.ok(review.text.includes(lockfile), `${recipeId}: plan omitted selected lockfile`)
    assert.ok(review.text.includes(manager === 'yarn' ? '.yarnrc.yml' : 'pnpm-workspace.yaml'), `${recipeId}: plan omitted persistent manager configuration`)
    assert.ok(review.text.includes('READY'), `${recipeId}: Doctor not ready`)
    assert.equal(review.consentUnchecked, true, `${recipeId}: lifecycle consent must default closed`)
    assert.equal(review.plannedUnchecked, true, `${recipeId}: planned override must default closed`)
    assert.equal(review.createDisabled, true, `${recipeId}: Generate enabled before both consents`)

    await setCheckbox('.consent-box input')
    const lifecycleOnlyDisabled = await evaluate('[...document.querySelectorAll(\'.wizard-actions .primary-button\')].some((button) => button.textContent.includes(\'Create project\') && button.disabled)')
    assert.equal(lifecycleOnlyDisabled, true, `${recipeId}: lifecycle consent alone must not enable generation`)
    await setCheckbox('.internal-consent input')
    await waitFor("[...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && !button.disabled)", `${recipeId} dual-consent enablement`)
    await click('.wizard-actions .primary-button', 'Create project')
    await waitFor("document.querySelector('#generation-title') !== null", `${recipeId} native generation start`)
    await waitFor("document.querySelector('#result-title')?.textContent.includes('Project checks passed')", `${recipeId} completed result`, 20 * 60 * 1000)

    const artifact = await readManifest(join(parent, projectName), [recipeId, name, framework, manager, version, lockfile])
    const uiValidations = await evaluate("[...document.querySelectorAll('.validation-list li')].map((item) => item.textContent.trim())")
    assert.ok(uiValidations.length >= 7, `${recipeId}: native result omitted validation events`)
    assert.ok(uiValidations.some((text) => text.includes(lockfile)), `${recipeId}: native result omitted lockfile integrity event`)
    assert.ok((await evaluate('document.body.innerText')).includes('Recipe remains planned.'))
    results.push({ ...artifact, uiValidationCount: uiValidations.length })
    console.log(`${recipeId} ${manager}@${version} native UI + Tauri generation: PASS (${lockfile}, dual consent, checks, planned retained)`)
  }

  await click('.nav-item', 'Recent projects')
  await waitFor("document.querySelector('#projects-title') !== null", 'generated project history')
  const historyText = await evaluate('document.body.innerText')
  for (const [, name] of cases) assert.ok(historyText.includes(`pg-${cases.find((item) => item[1] === name)[0].toLowerCase()}-${name}`), `${name}: missing native project history record`)
  allRunsComplete = true
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
  if (allRunsComplete) await rm(parent, { recursive: true, force: true })
  else console.error(`Incomplete native E2E artifacts retained for diagnosis: ${parent}`)
}

console.log(JSON.stringify({
  phase: '04B.3',
  flow: 'native Tauri UI',
  host: `${process.platform}-${process.arch}`,
  node: process.version,
  runDirectory: parent.split(/[\\/]/).at(-1),
  parentPathIncludedSpacesAndUnicode: true,
  generatedProjectsCleaned: true,
  recipes: results,
  releaseApproved: false,
  recipesRemainPlanned: true,
}, null, 2))
