import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { isDesktopCancelMessage, listenForDesktopCancel } from '../src/desktop-control.js'

test('desktop control accepts only versioned cancel intent', () => {
  assert.equal(isDesktopCancelMessage('{"schemaVersion":1,"kind":"cancel"}'), true)
  assert.equal(isDesktopCancelMessage('{"schemaVersion":2,"kind":"cancel"}'), false)
  assert.equal(isDesktopCancelMessage('{"schemaVersion":1,"kind":"run","command":"whoami"}'), false)
  assert.equal(isDesktopCancelMessage('not json'), false)
})

test('desktop cancellation control aborts once complete JSONL line arrives', () => {
  const input = new PassThrough()
  const controller = new AbortController()
  const dispose = listenForDesktopCancel(controller, input)
  input.write('{"schemaVersion":1,')
  assert.equal(controller.signal.aborted, false)
  input.write('"kind":"cancel"}\n')
  assert.equal(controller.signal.aborted, true)
  dispose()
  input.destroy()
})
