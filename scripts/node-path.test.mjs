import assert from 'node:assert/strict'
import test from 'node:test'
import { withNodeOnPath } from './node-path.mjs'

test('runtime directory is prepended while preserving Windows PATH key casing', () => {
  const original = { Path: 'C:\\Windows\\System32', TEMP: 'C:\\Temp' }
  const env = withNodeOnPath(original, 'C:\\Program Files\\nodejs\\node.exe')
  assert.deepEqual(env, {
    Path: 'C:\\Program Files\\nodejs;C:\\Windows\\System32',
    TEMP: 'C:\\Temp',
  })
  assert.equal(Object.keys(env).filter((key) => key.toLowerCase() === 'path').length, 1)
  assert.deepEqual(original, { Path: 'C:\\Windows\\System32', TEMP: 'C:\\Temp' })
})
