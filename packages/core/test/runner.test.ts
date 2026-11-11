import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, win32 } from 'node:path'
import test, { type TestContext } from 'node:test'
import { callSupervisor, readSupervisorResponse, sendSupervisorRequest, spawnSupervisor } from '../src/native-supervisor.js'
import { runNodeProcess } from '../src/runner.js'

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
  const probe = resolve('native/windows-supervisor/target/release/breakaway-probe.exe')
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
    assert.ok(result, 'breakaway probe should attempt child creation')
    if (result.startsWith('escaped:')) escapedPid = Number(result.slice('escaped:'.length))
    supervisor.stdin?.write('{"kind":"cancel"}\n')
    const completed = await completion
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
