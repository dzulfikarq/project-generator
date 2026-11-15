import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlan } from '../src/plan.js'
import { parseSelection } from '../src/schema.js'

test('generation plan discloses selected-manager lifecycle execution after consent', () => {
  const plan = createPlan(parseSelection({
    schemaVersion: 1,
    project: { name: 'lifecycle-policy', type: 'frontend', parentDirectory: 'C:\\Projects' },
    frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'npm' },
    styling: { adapterId: 'styling.css' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }))

  const install = plan.steps.find((step) => step.id === 'install')
  assert.equal(plan.executesDependencyLifecycleScripts, true)
  assert.ok(install?.sideEffects.includes('Run npm package lifecycle scripts only after explicit consent.'))
  assert.ok(plan.warnings.some((warning) => warning.includes('lifecycle scripts') && warning.includes('not sandboxed')))

  for (const [manager, recipeId, lockfile, configFile] of [['yarn', 'FE-12', 'yarn.lock', '.yarnrc.yml'], ['pnpm', 'FE-14', 'pnpm-lock.yaml', 'pnpm-workspace.yaml']] as const) {
    const alternate = createPlan(parseSelection({
      schemaVersion: 1,
      project: { name: `lifecycle-${manager}`, type: 'frontend', parentDirectory: 'C:\\Projects' },
      frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager },
      styling: { adapterId: 'styling.css' },
      documentation: 'minimal',
      git: { initialize: false, initialCommit: false },
    }))
    assert.equal(alternate.recipeId, recipeId)
    assert.equal(alternate.recipeStatus, 'planned')
    assert.equal(alternate.executionAvailable, false)
    assert.ok(alternate.expectedWrites.includes(lockfile))
    assert.ok(alternate.expectedWrites.includes(configFile))
    assert.equal(alternate.steps.find((step) => step.id === 'install')?.ownerAdapterId, manager)
    assert.ok(alternate.steps.find((step) => step.id === 'install')?.sideEffects.some((effect) => effect.includes('only after explicit consent')))
  }
})

test('BE-06 plan discloses uv lock resolution, isolated sync, network, and build-code consent', () => {
  const plan = createPlan(parseSelection({
    schemaVersion: 1,
    project: { name: 'fastapi-plan', type: 'backend', parentDirectory: 'C:\\Projects' },
    backend: { adapterId: 'backend.fastapi', manager: 'uv' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }))
  const install = plan.steps.find((step) => step.id === 'install')
  assert.equal(plan.recipeId, 'BE-06')
  assert.equal(plan.recipeStatus, 'planned')
  assert.equal(plan.executionAvailable, false)
  assert.equal(plan.executesDependencyLifecycleScripts, true)
  assert.ok(plan.expectedWrites.includes('uv.lock'))
  assert.ok(plan.networkAccess.includes('https://pypi.org/'))
  assert.ok(install?.readableSummary.includes('uv sync --locked'))
  assert.ok(install?.sideEffects.some((effect) => effect.includes('explicit consent')))
  assert.ok(plan.warnings.some((warning) => warning.includes('provisional')))
  assert.ok(plan.warnings.some((warning) => warning.includes('does not start the API')))
})
