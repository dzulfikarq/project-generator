import assert from 'node:assert/strict'
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { win32 } from 'node:path'
import test from 'node:test'
import { runNodeProcess } from '../src/runner.js'

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

test('cancellation during runner path checks is not lost', async () => {
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

test('failed Windows tree kill is not reported as safe cancellation', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-tree-kill-failure-'))
  const script = win32.join(root, 'parent.cjs')
  const pidFile = win32.join(root, 'child.pid')
  const childCode = 'setInterval(() => {}, 1000)'
  const parentCode = `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childCode)}], { stdio: 'ignore', windowsHide: true }); writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); setInterval(() => {}, 1000);`
  await writeFile(script, parentCode)
  const previousSystemRoot = process.env.SystemRoot
  const controller = new AbortController()
  let childPid: number | undefined
  let execution: Promise<Awaited<ReturnType<typeof runNodeProcess>>> | undefined
  try {
    execution = runNodeProcess({
      scriptPath: script,
      allowedScriptRoot: root,
      cwd: root,
      allowedCwdRoot: root,
      args: [],
      homeDirectory: root,
      tempDirectory: root,
      timeoutMs: 15_000,
      signal: controller.signal,
    })
    for (let attempt = 0; attempt < 50 && childPid === undefined; attempt += 1) {
      try {
        childPid = Number(await readFile(pidFile, 'utf8'))
      } catch {
        await new Promise((resolveWait) => setTimeout(resolveWait, 50))
      }
    }
    assert.ok(childPid && Number.isInteger(childPid), 'descendant process should start')
    process.env.SystemRoot = win32.join(root, 'missing-windows-root')
    controller.abort()
    await assert.rejects(execution, (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && error.code === 'GEN_PROCESS_TREE_UNCONFIRMED')
  } finally {
    controller.abort()
    await execution?.catch(() => undefined)
    if (previousSystemRoot === undefined) delete process.env.SystemRoot
    else process.env.SystemRoot = previousSystemRoot
    if (childPid && processAlive(childPid)) {
      try { process.kill(childPid) } catch { /* The child may have exited during recovery. */ }
      for (let attempt = 0; attempt < 30 && processAlive(childPid); attempt += 1) await new Promise((resolveWait) => setTimeout(resolveWait, 100))
    }
    await rm(root, { recursive: true, force: true })
  }
})

test('cancellation terminates owned Node process tree on Windows', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(win32.join(tmpdir(), 'pg-process-tree-'))
  const script = win32.join(root, 'parent.cjs')
  const pidFile = win32.join(root, 'child.pid')
  const childCode = 'setInterval(() => {}, 1000)'
  const parentCode = `const { spawn } = require('node:child_process'); const { writeFileSync } = require('node:fs'); const child = spawn(${JSON.stringify(process.execPath)}, ['-e', ${JSON.stringify(childCode)}], { stdio: 'ignore', windowsHide: true }); writeFileSync(${JSON.stringify(pidFile)}, String(child.pid)); setInterval(() => {}, 1000);`
  await writeFile(script, parentCode)
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
      signal: controller.signal,
    })
    let childPid: number | undefined
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
    await rm(root, { recursive: true, force: true })
  }
})
