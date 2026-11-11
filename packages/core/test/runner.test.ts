import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
