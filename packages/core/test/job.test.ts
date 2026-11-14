import assert from 'node:assert/strict'
import { access, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, win32 } from 'node:path'
import test, { type TestContext } from 'node:test'
import { generateProject, redact } from '../src/job.js'
import { callSupervisor } from '../src/native-supervisor.js'
import { parseSelection } from '../src/schema.js'
import { FORMA_COMMIT_SHA } from '../src/forma-catalog.js'
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

test('production generation blocks planned Nuxt and Angular recipes before destination writes', async () => {
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-phase04b-planned-'))
  const cases = [
    { name: 'planned-nuxt', frontend: 'frontend.nuxt', style: 'styling.css' },
    { name: 'planned-angular', frontend: 'frontend.angular', style: 'styling.scss' },
  ] as const
  const logs: string[] = []
  try {
    for (const item of cases) {
      const selection = parseSelection({
        schemaVersion: 1,
        project: { name: item.name, type: 'frontend', parentDirectory: parent },
        frontend: { adapterId: item.frontend, language: 'ts', manager: 'npm' },
        styling: { adapterId: item.style },
        documentation: 'minimal',
        git: { initialize: false, initialCommit: false },
      })
      const result = await generateProject(selection)
      if (result.logFile) logs.push(result.logFile)
      assert.equal(result.status, 'failed')
      assert.equal(result.error?.code, 'GEN_RECIPE_UNTESTED')
      await assert.rejects(access(win32.join(parent, item.name)))
    }
    assert.deepEqual(await readdir(parent), [])
  } finally {
    await rm(parent, { recursive: true, force: true })
    for (const log of logs) await rm(dirname(log), { recursive: true, force: true })
  }
})

test('production generation blocks planned Forma integrations before fetch or staging', async () => {
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-forma-planned-'))
  const selection = parseSelection({
    schemaVersion: 1,
    project: { name: 'planned-forma', type: 'frontend', parentDirectory: parent },
    frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'npm' },
    template: { adapterId: 'template.forma', templateId: 'staywise-host-dashboard', commitSha: FORMA_COMMIT_SHA },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  })
  let logFile = ''
  try {
    const result = await generateProject(selection)
    logFile = result.logFile ?? ''
    assert.equal(result.status, 'failed')
    assert.equal(result.error?.code, 'GEN_RECIPE_UNTESTED')
    await assert.rejects(access(win32.join(parent, 'planned-forma')))
    assert.deepEqual(await readdir(parent), [])
  } finally {
    await rm(parent, { recursive: true, force: true })
    if (logFile) await rm(dirname(logFile), { recursive: true, force: true })
  }
})

test('elevated generation fails before staging', { skip: process.platform !== 'win32' }, async (t: TestContext) => {
  const elevation = await callSupervisor('--check-elevation', undefined, 15_000)
  assert.equal(elevation.exitCode, 0)
  assert.equal(typeof elevation.response.elevated, 'boolean')
  if (!elevation.response.elevated) {
    t.skip('current Windows caller is not elevated')
    return
  }
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-elevated-generation-'))
  const selection = parseSelection({
    schemaVersion: 1,
    project: { name: 'elevated-project', type: 'frontend', parentDirectory: parent },
    frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'npm' },
    styling: { adapterId: 'styling.css' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  })
  let logFile = ''
  try {
    const result = await generateProject(selection, { allowPlanned: true })
    logFile = result.logFile ?? ''
    assert.equal(result.error?.code, 'GEN_ELEVATED_CALLER')
    await assert.rejects(access(win32.join(parent, 'elevated-project')))
    assert.ok(!result.logFile || !result.error?.targetModified)
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
