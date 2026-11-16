import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, win32 } from 'node:path'
import test, { type TestContext } from 'node:test'
import { callSupervisor, readSupervisorResponse, sendSupervisorRequest, spawnSupervisor } from '../src/native-supervisor.js'
import { runNodeProcess } from '../src/runner.js'
import { resolveNpmTool } from '../src/toolchain.js'
import { cleanupOwnedStage, createOwnedStage, mutateOwnedStage } from '../src/staging.js'

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

async function stopFixtureDescendant(stopFile: string, pid?: number): Promise<void> {
  await writeFile(stopFile, 'stop').catch(() => undefined)
  for (let attempt = 0; pid !== undefined && attempt < 50 && processAlive(pid); attempt += 1) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
}

async function skipElevatedWorkload(t: TestContext): Promise<boolean> {
  const { response, exitCode } = await callSupervisor('--check-elevation', undefined, 15_000)
  assert.equal(exitCode, 0)
  assert.equal(typeof response.elevated, 'boolean')
  if (response.elevated) {
    t.skip('owned-process integration requires a non-elevated caller')
    return true
  }
  return false
}

test('cancellation during runner path checks is not lost', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-abort-race-'))
  const script = win32.join(root, 'must-not-start.cjs')
  const marker = win32.join(root, 'started')
  await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started'); setInterval(() => {}, 1000)`)
  const controller = new AbortController()
  try {
    const execution = runNodeProcess({
      scriptPath: script,
      allowedScriptRoot: root,
      cwd: root,
      allowedCwdRoot: root,
      args: [],
      homeDirectory: root,
      tempDirectory: root,
      timeoutMs: 1000,
      signal: controller.signal,
    })
    controller.abort()
    await assert.rejects(execution, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'GEN_CANCELLED')
    await assert.rejects(access(marker))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('runner rejects unreviewed environment overrides before process start', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-runner-env-'))
  const script = win32.join(root, 'must-not-start.cjs')
  const marker = win32.join(root, 'started')
  await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`)
  try {
    for (const environment of [{ PATH: 'unreviewed' }, { DB_FILE: '../outside.sqlite' }, { DB_FILE: win32.join(root, 'app.sqlite') }]) {
      await assert.rejects(runNodeProcess({
        scriptPath: script,
        allowedScriptRoot: root,
        cwd: root,
        allowedCwdRoot: root,
        args: [],
        homeDirectory: root,
        tempDirectory: root,
        environment,
      }), (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'GEN_RUNNER_BLOCKED')
    }
    await assert.rejects(access(marker))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('native preflight blocks workload when caller token is elevated', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-elevation-block-'))
  const script = win32.join(root, 'must-not-start.cjs')
  const marker = win32.join(root, 'started')
  await writeFile(script, `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'started')`)
  try {
    const { response, exitCode } = await callSupervisor('--check-elevation', undefined, 15_000)
    assert.equal(exitCode, 0)
    assert.equal(typeof response.elevated, 'boolean')
    const execution = runNodeProcess({
      scriptPath: script,
      allowedScriptRoot: root,
      cwd: root,
      allowedCwdRoot: root,
      args: [],
      homeDirectory: root,
      tempDirectory: root,
    })
    if (response.elevated) {
      await assert.rejects(execution, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'GEN_ELEVATED_CALLER')
      await assert.rejects(access(marker))
    } else {
      assert.equal((await execution).exitCode, 0)
      assert.equal(await readFile(marker, 'utf8'), 'started')
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('cancellation terminates owned Node process tree on Windows', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedWorkload(t)) return
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-process-tree-'))
  const script = win32.join(root, 'parent.cjs')
  const pidFile = win32.join(root, 'child.pid')
  const stopFile = win32.join(root, 'stop-child')
  const childCode = `const fs = require('node:fs'); setInterval(() => { if (fs.existsSync(${JSON.stringify(stopFile)})) process.exit(0) }, 25)`
  const parentCode = `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childCode)}], { detached: true, stdio: 'ignore', windowsHide: true }); child.unref(); writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); setInterval(() => {}, 1000);`
  await writeFile(script, parentCode)
  const controller = new AbortController()
  let childPid: number | undefined
  let execution: ReturnType<typeof runNodeProcess> | undefined
  try {
    execution = runNodeProcess({
      scriptPath: script,
      allowedScriptRoot: root,
      cwd: root,
      allowedCwdRoot: root,
      args: [],
      homeDirectory: root,
      tempDirectory: root,
      signal: controller.signal,
    })
    for (let attempt = 0; attempt < 50 && childPid === undefined; attempt += 1) {
      try {
        childPid = Number(await readFile(pidFile, 'utf8'))
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50))
      }
    }
    assert.ok(childPid && Number.isInteger(childPid), 'child process should start')
    controller.abort()
    await assert.rejects(execution, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'GEN_CANCELLED')
    for (let attempt = 0; attempt < 30 && processAlive(childPid); attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    assert.equal(processAlive(childPid), false, 'owned descendant should be terminated')
  } finally {
    controller.abort()
    await execution?.catch(() => undefined)
    await stopFixtureDescendant(stopFile, childPid)
    await rm(root, { recursive: true, force: true })
  }
})

test('cancelling real npm install kills lifecycle descendants and permits stage cleanup', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedWorkload(t)) return
  const npm = await resolveNpmTool()
  assert.ok(npm, 'supported npm CLI must be installed beside Node')
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-npm-cancel-'))
  const stage = await createOwnedStage(parent, win32.join(parent, 'project'), 'project', 'npm-cancel')
  const projectPath = stage.childPath
  const home = win32.join(stage.path, '.home')
  const temp = win32.join(stage.path, '.tmp')
  const cache = win32.join(stage.path, '.npm-cache')
  const marker = win32.join(stage.path, 'install-pids.json')
  const stopFile = win32.join(stage.path, 'stop-install-child')
  const childCode = `const fs = require('node:fs'); setInterval(() => { if (fs.existsSync(${JSON.stringify(stopFile)})) process.exit(0) }, 25)`
  const installCode = `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childCode)}], { detached: true, stdio: 'ignore', windowsHide: true }); child.unref(); writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ parent: process.pid, child: child.pid })); setInterval(() => {}, 1000);`
  await mutateOwnedStage(stage, ['project', 'slow-package', '.home', '.tmp', '.npm-cache'], [
    { path: 'project/package.json', content: JSON.stringify({ name: 'npm-cancel-fixture', version: '1.0.0', private: true, dependencies: { 'slow-install-fixture': 'file:../slow-package' } }) },
    { path: 'slow-package/package.json', content: JSON.stringify({ name: 'slow-install-fixture', version: '1.0.0', scripts: { install: 'node install.cjs' } }) },
    { path: 'slow-package/install.cjs', content: installCode },
  ])
  const controller = new AbortController()
  let execution: ReturnType<typeof runNodeProcess> | undefined
  let lifecyclePid: number | undefined
  let childPid: number | undefined
  try {
    execution = runNodeProcess({
      scriptPath: npm.cliPath,
      allowedScriptRoot: dirname(dirname(npm.cliPath)),
      cwd: projectPath,
      allowedCwdRoot: stage.path,
      args: ['install', '--offline', '--no-audit', '--no-fund', '--cache', cache],
      homeDirectory: home,
      tempDirectory: temp,
      timeoutMs: 60_000,
      signal: controller.signal,
    })
    for (let attempt = 0; attempt < 400 && lifecyclePid === undefined; attempt += 1) {
      try {
        const pids = JSON.parse(await readFile(marker, 'utf8')) as { parent?: number; child?: number }
        lifecyclePid = pids.parent
        childPid = pids.child
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50))
      }
    }
    assert.ok(lifecyclePid && childPid, 'npm lifecycle script and detached child should start')
    controller.abort()
    await assert.rejects(execution, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'GEN_CANCELLED')
    for (let attempt = 0; attempt < 50 && (processAlive(lifecyclePid) || processAlive(childPid)); attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
    assert.equal(processAlive(lifecyclePid), false, 'cancellation must terminate npm lifecycle process')
    assert.equal(processAlive(childPid), false, 'cancellation must terminate detached lifecycle descendant')
    await cleanupOwnedStage(stage)
    await assert.rejects(access(stage.path))
  } finally {
    controller.abort()
    await execution?.catch(() => undefined)
    await writeFile(stopFile, 'stop').catch(() => undefined)
    await stopFixtureDescendant(stopFile, childPid)
    await cleanupOwnedStage(stage).catch(() => undefined)
    await rm(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('forced supervisor death closes Job Object and kills owned descendants', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedWorkload(t)) return
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-supervisor-death-'))
  const script = win32.join(root, 'parent.cjs')
  const parentPidFile = win32.join(root, 'parent.pid')
  const childPidFile = win32.join(root, 'child.pid')
  const stopFile = win32.join(root, 'stop-child')
  const childCode = `const fs = require('node:fs'); setInterval(() => { if (fs.existsSync(${JSON.stringify(stopFile)})) process.exit(0) }, 25)`
  const parentCode = `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childCode)}], { detached: true, stdio: 'ignore', windowsHide: true }); child.unref(); writeFileSync(${JSON.stringify(parentPidFile)}, String(process.pid)); writeFileSync(${JSON.stringify(childPidFile)}, String(child.pid)); setInterval(() => {}, 1000);`
  await writeFile(script, parentCode)
  const supervisor = spawnSupervisor('--run')
  const completion = readSupervisorResponse(supervisor, 30_000)
  let parentPid: number | undefined
  let childPid: number | undefined
  try {
    await new Promise<void>((resolveSpawn, rejectSpawn) => {
      supervisor.once('spawn', () => resolveSpawn())
      supervisor.once('error', rejectSpawn)
    })
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
    sendSupervisorRequest(supervisor, {
      executable: process.execPath,
      args: [script],
      cwd: root,
      env: { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: win32.join(systemRoot, 'System32') },
      timeoutMs: 20_000,
    })
    for (let attempt = 0; attempt < 100 && (parentPid === undefined || childPid === undefined); attempt += 1) {
      try {
        parentPid = Number(await readFile(parentPidFile, 'utf8'))
        childPid = Number(await readFile(childPidFile, 'utf8'))
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50))
      }
    }
    assert.ok(parentPid && childPid, 'owned parent and descendant should start')
    assert.equal(supervisor.kill(), true, 'test must terminate supervisor process')
    await completion.catch(() => undefined)
    for (let attempt = 0; attempt < 100 && (processAlive(parentPid) || processAlive(childPid)); attempt += 1) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
    assert.equal(processAlive(parentPid), false, 'supervisor death must terminate owned root')
    assert.equal(processAlive(childPid), false, 'supervisor death must terminate owned descendant')
  } finally {
    if (supervisor.exitCode === null && supervisor.signalCode === null) supervisor.kill()
    await completion.catch(() => undefined)
    await stopFixtureDescendant(stopFile, childPid)
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

test('timeout terminates detached descendants in the owned Job Object', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedWorkload(t)) return
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-process-timeout-'))
  const script = win32.join(root, 'parent.cjs')
  const pidFile = win32.join(root, 'child.pid')
  const stopFile = win32.join(root, 'stop-child')
  const childCode = `const fs = require('node:fs'); setInterval(() => { if (fs.existsSync(${JSON.stringify(stopFile)})) process.exit(0) }, 25)`
  const parentCode = `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childCode)}], { detached: true, stdio: 'ignore', windowsHide: true }); child.unref(); writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); setInterval(() => {}, 1000);`
  await writeFile(script, parentCode)
  let childPid: number | undefined
  try {
    const execution = runNodeProcess({
      scriptPath: script,
      allowedScriptRoot: root,
      cwd: root,
      allowedCwdRoot: root,
      args: [],
      homeDirectory: root,
      tempDirectory: root,
      timeoutMs: 1500,
    })
    for (let attempt = 0; attempt < 50 && childPid === undefined; attempt += 1) {
      try {
        childPid = Number(await readFile(pidFile, 'utf8'))
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50))
      }
    }
    assert.ok(childPid && Number.isInteger(childPid), 'detached descendant should start')
    await assert.rejects(execution, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'GEN_PROCESS_TIMEOUT')
    for (let attempt = 0; attempt < 30 && processAlive(childPid); attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    assert.equal(processAlive(childPid), false, 'timeout must terminate detached descendant')
  } finally {
    await stopFixtureDescendant(stopFile, childPid)
    await rm(root, { recursive: true, force: true })
  }
})

test('natural root exit detects and terminates remaining detached descendants', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedWorkload(t)) return
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-orphan-descendant-'))
  const script = win32.join(root, 'parent.cjs')
  const pidFile = win32.join(root, 'child.pid')
  const stopFile = win32.join(root, 'stop-child')
  const childCode = `const fs = require('node:fs'); setInterval(() => { if (fs.existsSync(${JSON.stringify(stopFile)})) process.exit(0) }, 25)`
  const parentCode = `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childCode)}], { detached: true, stdio: 'ignore', windowsHide: true }); child.unref(); writeFileSync(${JSON.stringify(pidFile)}, String(child.pid));`
  await writeFile(script, parentCode)
  let childPid: number | undefined
  try {
    const execution = runNodeProcess({
      scriptPath: script,
      allowedScriptRoot: root,
      cwd: root,
      allowedCwdRoot: root,
      args: [],
      homeDirectory: root,
      tempDirectory: root,
    })
    for (let attempt = 0; attempt < 50 && childPid === undefined; attempt += 1) {
      try {
        childPid = Number(await readFile(pidFile, 'utf8'))
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50))
      }
    }
    assert.ok(childPid && Number.isInteger(childPid), 'detached descendant should start')
    await assert.rejects(execution, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'GEN_PROCESS_SUPERVISOR_FAILED')
    for (let attempt = 0; attempt < 30 && processAlive(childPid); attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    assert.equal(processAlive(childPid), false, 'orphan descendant must be terminated')
  } finally {
    await stopFixtureDescendant(stopFile, childPid)
    await rm(root, { recursive: true, force: true })
  }
})

test('cancelling generator does not terminate an unrelated process', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedWorkload(t)) return
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-unrelated-process-'))
  const script = win32.join(root, 'parent.cjs')
  await writeFile(script, 'setInterval(() => {}, 1000)')
  const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true })
  const controller = new AbortController()
  try {
    await new Promise<void>((resolveStarted, rejectStarted) => {
      unrelated.once('spawn', () => resolveStarted())
      unrelated.once('error', rejectStarted)
    })
    const pid = unrelated.pid
    assert.ok(pid)
    const execution = runNodeProcess({
      scriptPath: script,
      allowedScriptRoot: root,
      cwd: root,
      allowedCwdRoot: root,
      args: [],
      homeDirectory: root,
      tempDirectory: root,
      signal: controller.signal,
    })
    await new Promise((resolveStarted) => setTimeout(resolveStarted, 250))
    controller.abort()
    await assert.rejects(execution, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'GEN_CANCELLED')
    assert.equal(processAlive(pid), true, 'unrelated process must remain alive')
  } finally {
    if (unrelated.pid && unrelated.exitCode === null) unrelated.kill()
    await rm(root, { recursive: true, force: true })
  }
})

test('Job Object rejects explicit CREATE_BREAKAWAY_FROM_JOB descendants', { skip: process.platform !== 'win32' }, async (t) => {
  if (await skipElevatedWorkload(t)) return
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-breakaway-probe-'))
  const probe = resolve(import.meta.dirname, '../../../../native/windows-supervisor/target/release/breakaway-probe.exe')
  const marker = win32.join(root, 'breakaway-result')
  const stopFile = win32.join(root, 'stop-escaped-child')
  const supervisor = spawnSupervisor('--run')
  const completion = readSupervisorResponse(supervisor, 30_000)
  let escapedPid: number | undefined
  try {
    const systemRoot = process.env.SystemRoot ?? process.env.WINDIR ?? 'C:\\Windows'
    supervisor.once('spawn', () => sendSupervisorRequest(supervisor, {
      executable: probe,
      args: [marker, stopFile],
      cwd: root,
      env: { SystemRoot: systemRoot, WINDIR: systemRoot, PATH: win32.join(systemRoot, 'System32') },
      timeoutMs: 20_000,
    }))
    let result: string | undefined
    for (let attempt = 0; attempt < 100 && result === undefined; attempt += 1) {
      try {
        result = await readFile(marker, 'utf8')
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50))
      }
    }
    supervisor.stdin?.write('{"kind":"cancel"}\n')
    const completed = await completion
    assert.ok(result, `breakaway probe should attempt child creation; supervisor=${JSON.stringify(completed.response)} exit=${completed.exitCode}`)
    if (result.startsWith('escaped:')) escapedPid = Number(result.slice('escaped:'.length))
    assert.equal(completed.response.terminationConfirmed, true)
    assert.equal(completed.response.cancelled, true)
    assert.match(result, /^blocked:/, 'owned Job Object must reject breakaway without opt-in')
  } finally {
    if (supervisor.exitCode === null && supervisor.signalCode === null) {
      supervisor.stdin?.write('{"kind":"cancel"}\n')
      supervisor.kill()
    }
    await completion.catch(() => undefined)
    await stopFixtureDescendant(stopFile, escapedPid)
    await rm(root, { recursive: true, force: true })
  }
})
