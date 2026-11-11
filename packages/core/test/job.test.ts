import assert from 'node:assert/strict'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, win32 } from 'node:path'
import test from 'node:test'
import { generateProject, redact } from '../src/job.js'
import { parseSelection } from '../src/schema.js'
import type { JobEventV1 } from '../src/types.js'

test('production generation blocks planned recipes before destination writes', async () => {
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-planned-'))
  const selection = parseSelection({
    schemaVersion: 1,
    project: { name: 'planned-project', type: 'frontend', parentDirectory: parent },
    frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'npm' },
    styling: { adapterId: 'styling.css' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  })
  const events: JobEventV1[] = []
  let logFile = ''
  try {
    const result = await generateProject(selection, { onEvent: (event) => events.push(event) })
    logFile = result.logFile ?? ''
    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'GEN_RECIPE_UNTESTED')
    await assert.rejects(access(win32.join(parent, 'planned-project')))
    assert.deepEqual(events.map((event) => event.sequence), events.map((_, index) => index + 1))
    assert.ok(events.some((event) => event.code === 'GEN_RECIPE_UNTESTED'))
  } finally {
    await rm(parent, { recursive: true, force: true })
    if (logFile) await rm(dirname(logFile), { recursive: true, force: true })
  }
})

test('redacts fake credentials and private paths from process output', () => {
  const source = 'Authorization: Bearer top-secret-token npm token=npm_abcdefghijklmnopqrstuvwxyz0123456789 C:\\Users\\Private User\\project'
  const output = redact(source, ['C:\\Users\\Private User\\project'])
  assert.equal(output.includes('top-secret-token'), false)
  assert.equal(output.includes('npm_abcdefghijklmnopqrstuvwxyz0123456789'), false)
  assert.equal(output.includes('C:\\Users\\Private User\\project'), false)
  assert.ok(output.includes('<private-path>'))
})
