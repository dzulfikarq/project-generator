import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, win32 } from 'node:path'

if (process.platform !== 'win32') throw new Error('Phase 05C.3 native acceptance requires Windows.')

const debugPort = Number(process.env.PG_WEBVIEW_DEBUG_PORT ?? 9339)
const debugBase = `http://127.0.0.1:${debugPort}`
const local = process.env.LOCALAPPDATA ?? win32.join(homedir(), 'AppData', 'Local')
const tempBase = join(local, 'Temp', 'opencode')
await access(tempBase)
assert.ok((await stat(tempBase)).isDirectory())

const parent = await mkdtemp(join(tempBase, 'phase-05c3-laravel-native-20261115 spaces-雪-'))
const generatedName = 'ff-be05-laravel-native'
const cancelledName = 'ff-be05-laravel-cancel'
const collisionName = 'ff-be05-laravel-collision'
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

async function configureLaravel(name) {
  await waitFor("document.querySelector('#project-name') !== null", `${name} project details`)
  await fill('#project-name', name)
  await fill('#project-parent', parent)
  await click('.wizard-actions .primary-button', 'Choose framework')
  await waitFor("[...document.querySelectorAll('.compact-choice')].some((button) => button.textContent.includes('Backend'))", `${name} project types`)
  await click('.compact-choice', 'Backend')
  await click('.select-card', 'Laravel')
  await click('.wizard-actions .primary-button', 'Choose tools')
  await waitFor("document.body.innerText.includes('PHP · Laravel 12 · Composer · MySQL/Eloquent')", `${name} Laravel tools`)
  await click('.wizard-actions .primary-button', 'Documentation')
  await click('.docs-card', 'Standard')
  await click('.wizard-actions .primary-button', 'Review configuration')
  await waitFor("document.querySelector('#review-title') && document.body.innerText.includes('BE-05') && !document.querySelector('.inline-loading')", `${name} plan and Doctor`)
  await click('summary', 'Expected project files')
  return evaluate(`({
    text: document.body.innerText,
    doctor: [...document.querySelectorAll('.doctor-row')].map((row) => row.innerText),
    dependencyConsent: document.querySelector('.consent-box input')?.checked ?? null,
    plannedConsent: document.querySelector('.internal-consent input')?.checked ?? null,
    createDisabled: [...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && button.disabled),
  })`)
}

async function assertConsentGates() {
  const review = await evaluate(`({
    text: document.body.innerText,
    dependencyConsent: document.querySelector('.consent-box input')?.checked ?? null,
    plannedConsent: document.querySelector('.internal-consent input')?.checked ?? null,
    createDisabled: [...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && button.disabled),
  })`)
  assert.equal(review.dependencyConsent, false)
  assert.equal(review.plannedConsent, false)
  assert.equal(review.createDisabled, true)
  assert.ok(review.text.includes('scripts and plugins are disabled'))
  assert.ok(review.text.includes('without a sandbox'))
  assert.ok(review.text.includes('does not create a .env file'))
  const expectedFiles = await evaluate("[...document.querySelectorAll('.disclosure-details .compact-list code')].map((item) => item.textContent)")
  assert.ok(expectedFiles.includes('composer.lock'))
  assert.ok(expectedFiles.includes('.env.example'))
  assert.ok(!expectedFiles.includes('.env'))
  await setCheckbox('.consent-box input')
  assert.equal(await evaluate("[...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && button.disabled)"), true, 'planned consent must remain closed')
  await setCheckbox('.internal-consent input')
  await waitFor("[...document.querySelectorAll('.wizard-actions .primary-button')].some((button) => button.textContent.includes('Create project') && !button.disabled)", 'both explicit consent gates')
}

async function startWizardFromHome() {
  await waitFor("document.querySelector('.hero-actions .primary-button') && !document.querySelector('.hero-actions .primary-button').disabled", 'Forge Studio home and catalog')
  await click('.hero-actions .primary-button', 'Create project')
}

let devtoolsTarget
try {
  devtoolsTarget = await waitForDevTools()
  await connectDevTools(devtoolsTarget)
  localStorageSnapshot = await evaluate('Array.from({length: localStorage.length}, (_, i) => { const key = localStorage.key(i); return [key, localStorage.getItem(key)] })')

  await waitFor("document.querySelector('.nav-item') !== null", 'Forge Studio navigation')
  await startWizardFromHome()
  const initialReview = await configureLaravel(generatedName)
  assert.ok(initialReview.text.includes('BE-05') && initialReview.text.includes('planned'))
  assert.ok(initialReview.text.toLowerCase().includes('php · composer'))
  assert.ok(initialReview.text.includes('MySQL/Eloquent'))
  assert.ok(initialReview.text.includes('MySQL integration'))
  assert.ok(initialReview.text.includes('Network operations'))
  assert.ok(initialReview.text.includes('composer.lock'))
  assert.ok(!initialReview.text.includes('package-lock.json'))
  assert.ok(initialReview.doctor.some((row) => /php/i.test(row) && row.includes('8.2.6') && row.includes('Ready')), `PHP Doctor missing: ${JSON.stringify(initialReview.doctor)}`)
  assert.ok(initialReview.doctor.some((row) => /composer/i.test(row) && row.includes('2.8.11') && row.includes('Ready')), `Composer Doctor missing: ${JSON.stringify(initialReview.doctor)}`)
  assert.equal(initialReview.dependencyConsent, false)
  assert.equal(initialReview.plannedConsent, false)
  assert.equal(initialReview.createDisabled, true)
  await assertConsentGates()
  await click('.wizard-actions .primary-button', 'Create project')
  await waitFor("document.querySelector('#generation-title') !== null", 'Tauri BE-05 generation start')
  await waitFor("document.querySelector('#result-title')?.textContent.includes('Project checks passed')", 'BE-05 generated project result', 30 * 60 * 1000)

  const project = await lstat(targetPath)
  assert.ok(project.isDirectory() && !project.isSymbolicLink())
  const manifestPath = join(targetPath, '.project-generator', 'manifest.json')
  const manifestBytes = await readFile(manifestPath)
  const manifest = JSON.parse(manifestBytes.toString('utf8'))
  assert.equal(manifest.recipeId, 'BE-05')
  assert.equal(manifest.recipeStatusAtCreation, 'planned')
  assert.equal(manifest.projectType, 'backend')
  assert.equal(manifest.packageManager, 'composer')
  assert.equal(manifest.toolVersions.php, '8.2.6')
  assert.equal(manifest.toolVersions.composer, '2.8.11')
  assert.equal(manifest.toolVersions.laravel, '12.72.0')
  assert.match(manifest.toolVersions.phpunit, /^11\./)
  assert.deepEqual(manifest.lockfiles.map(({ name }) => name), ['composer.lock'])
  const lockBytes = await readFile(join(targetPath, 'composer.lock'))
  const lockHash = createHash('sha256').update(lockBytes).digest('hex')
  assert.equal(manifest.lockfiles[0].sha256, lockHash)
  const lock = JSON.parse(lockBytes.toString('utf8'))
  assert.equal(lock.packages.find(({ name }) => name === 'laravel/framework')?.version.replace(/^v/, ''), '12.72.0')
  assert.equal(lock['packages-dev'].find(({ name }) => name === 'phpunit/phpunit')?.version.replace(/^v/, ''), manifest.toolVersions.phpunit)
  const composer = JSON.parse(await readFile(join(targetPath, 'composer.json'), 'utf8'))
  assert.equal(composer.name, `forma/${generatedName}`)
  assert.equal(composer.scripts, undefined)
  assert.equal(composer.config['allow-plugins'], false)
  assert.equal(composer.require['laravel/framework'], '12.72.0')
  assert.equal(composer.require['ext-pdo_mysql'], '*')
  assert.ok(await lstat(join(targetPath, 'vendor', 'autoload.php')))

  const generatedFiles = await readdir(targetPath)
  for (const forbidden of [
    '.env', 'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml',
    'bun.lock', 'bun.lockb', 'uv.lock', 'routes/web.php', 'config/auth.php', 'vite.config.js',
  ]) assert.ok(!generatedFiles.includes(forbidden), `Unexpected generated file ${forbidden}`)
  assert.ok(!generatedFiles.includes('resources'), 'Frontend resources directory was included.')
  assert.ok(!generatedFiles.includes('node_modules'))
  assert.ok(generatedFiles.includes('.env.example'))
  const migrations = await readdir(join(targetPath, 'database', 'migrations'))
  assert.deepEqual(migrations, ['2026_11_15_000000_create_project_notes_table.php'])
  assert.match(await readFile(join(targetPath, 'config/database.php'), 'utf8'), /env\('DB_CONNECTION', 'mysql'\)/)
  assert.match(await readFile(join(targetPath, 'config/filesystems.php'), 'utf8'), /'local'[\s\S]*?'serve'\s*=>\s*false/)
  await access(join(targetPath, 'docs', 'SETUP.md'))

  const requiredChecks = [
    'laravel-scaffold', 'composer-lock', 'composer-install', 'lockfile-integrity', 'php-lint-bootstrap',
    'php-lint-database', 'php-lint-filesystems', 'php-lint-routes', 'php-lint-model', 'php-lint-migration',
    'php-lint-tests', 'artisan-version', 'artisan-route-list', 'phpunit', 'http-smoke',
  ]
  for (const check of requiredChecks) assert.equal(manifest.validation.find((item) => item.id === check)?.status, 'pass', check)
  const validations = await evaluate("[...document.querySelectorAll('.validation-list li')].map((item) => item.textContent.trim())")
  assert.ok(validations.some((line) => line.includes('artisan-route-list')))
  assert.ok(validations.some((line) => line.includes('phpunit')))
  assert.ok(validations.some((line) => line.includes('http-smoke')))
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
  await waitFor("document.querySelector('#projects-title') !== null", 'BE-05 history entry')
  const history = await evaluate('document.body.innerText')
  assert.ok(history.includes(generatedName) && history.includes('BE-05') && history.includes('Checks passed'))

  await click('.page-heading .primary-button', 'Create project')
  const cancelReview = await configureLaravel(cancelledName)
  assert.ok(cancelReview.text.includes('BE-05'))
  await assertConsentGates()
  await click('.wizard-actions .primary-button', 'Create project')
  await waitFor("document.querySelector('#generation-title') !== null", 'Tauri cancellation run start')
  const cancelStage = await waitFor(`(() => {
    const messages = [...document.querySelectorAll('.activity-event p')].map((item) => item.textContent ?? '');
    return messages.find((message) => message === 'installing started.' || message === 'validating started.') ?? null;
  })()`, 'BE-05 install or validation stage before cancellation', 10 * 60 * 1000, 25)
  await click('.cancel-row .danger-button', 'Cancel generation')
  await waitFor("document.querySelector('#result-title')?.textContent.includes('Generation cancelled')", 'Tauri BE-05 cancellation result', 3 * 60 * 1000)
  await assert.rejects(access(cancelledPath))
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])
  await click('.result-next button', 'Inspect recovery')
  await waitFor("document.querySelector('.recovery-details pre') !== null", 'read-only cancellation recovery inspection')
  const recoveryReports = JSON.parse(await evaluate("document.querySelector('.recovery-details pre')?.textContent ?? 'null'"))
  assert.ok(Array.isArray(recoveryReports))
  const cancellationReports = recoveryReports.filter((report) => JSON.stringify(report).toLowerCase().includes(cancelledName.toLowerCase()))
  assert.deepEqual(cancellationReports, [], `BE-05 cancellation left recovery state: ${JSON.stringify(cancellationReports)}`)

  await click('.result-next .primary-button', 'Create another')
  const collisionReview = await configureLaravel(collisionName)
  assert.ok(collisionReview.text.includes('BE-05'))
  assert.ok(collisionReview.text.includes('BLOCKED') && collisionReview.text.toLowerCase().includes('already exists'))
  assert.equal(collisionReview.createDisabled, true)
  assert.equal(createHash('sha256').update(await readFile(sentinelPath)).digest('hex'), sentinelHash)
  assert.deepEqual((await readdir(parent)).filter((entry) => entry.startsWith('.project-generator-stage-')), [])

  allChecksComplete = true
  console.log(JSON.stringify({
    phase: '05C.3',
    flow: 'Windows Forge Studio + Tauri + development CLI',
    host: `${process.platform}-${process.arch}`,
    php: manifest.toolVersions.php,
    composer: manifest.toolVersions.composer,
    laravel: manifest.toolVersions.laravel,
    phpunit: manifest.toolVersions.phpunit,
    recipe: manifest.recipeId,
    statusAtCreation: manifest.recipeStatusAtCreation,
    lockSha256: lockHash,
    validations: manifest.validation.map(({ id, status }) => ({ id, status })),
    consent: 'Composer dependency execution and planned-recipe gates both closed by default; each explicitly affirmed',
    resultAndHistory: 'passed; status remains planned',
    openFolder: 'pass',
    openVsCode: canOpenCode ? 'pass' : 'skipped; VS Code unavailable',
    cancellation: `reached ${cancelStage}; target absent; owned staging removed; no matching recovery record`,
    collision: 'Doctor blocked generation; sentinel hash unchanged; no staging',
    unrelatedRecoveryReports: recoveryReports.map(({ jobId, state, phase }) => ({ jobId, state, phase })),
    mysqlIntegration: 'BLOCKED: no approved isolated MySQL database; no database connection or migration attempted',
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
  else console.error(`Incomplete native BE-05 E2E artifacts retained for diagnosis: ${parent}`)
}
