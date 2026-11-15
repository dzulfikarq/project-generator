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
  const scaffold = plan.steps.find((step) => step.id === 'scaffold')
  assert.equal(plan.recipeId, 'BE-06')
  assert.equal(plan.recipeStatus, 'planned')
  assert.equal(plan.executionAvailable, false)
  assert.equal(plan.executesDependencyLifecycleScripts, true)
  assert.ok(plan.expectedWrites.includes('uv.lock'))
  assert.ok(plan.networkAccess.includes('https://pypi.org/'))
  assert.ok(scaffold?.readableSummary.includes('during install only after explicit consent'))
  assert.ok(install?.readableSummary.includes('uv sync --locked'))
  assert.ok(install?.sideEffects.some((effect) => effect.includes('explicit consent')))
  assert.ok(plan.warnings.some((warning) => warning.includes('provisional')))
  assert.ok(plan.warnings.some((warning) => warning.includes('does not start the API')))
})

test('BE-03 plan discloses pinned Nest scaffold, npm network, lifecycle consent, and Jest checks', () => {
  const plan = createPlan(parseSelection({
    schemaVersion: 1,
    project: { name: 'nest-plan', type: 'backend', parentDirectory: 'C:\\Projects' },
    backend: { adapterId: 'backend.nestjs', manager: 'npm' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }))
  const scaffold = plan.steps.find((step) => step.id === 'scaffold')
  const install = plan.steps.find((step) => step.id === 'install')
  assert.equal(plan.recipeId, 'BE-03')
  assert.equal(plan.recipeStatus, 'planned')
  assert.equal(plan.executionAvailable, false)
  assert.equal(plan.executesDependencyLifecycleScripts, true)
  assert.equal(plan.requiresDependencyConsent, true)
  assert.equal(scaffold?.action, 'run-pinned-cli')
  assert.equal(scaffold?.consentKind, 'network')
  assert.ok(scaffold?.readableSummary.includes('Nest CLI 11.0.24'))
  assert.equal(install?.ownerAdapterId, 'npm')
  assert.ok(install?.sideEffects.some((effect) => effect.includes('only after explicit consent')))
  assert.ok(plan.expectedWrites.includes('package-lock.json'))
  assert.ok(plan.expectedWrites.includes('test/app.e2e-spec.ts'))
  assert.ok(plan.networkAccess.includes('https://registry.npmjs.org/'))
  assert.ok(plan.warnings.some((warning) => warning.includes('lifecycle scripts') && warning.includes('not sandboxed')))
})

test('BE-05 plan separates Composer script suppression from explicit unsandboxed dependency consent', () => {
  const plan = createPlan(parseSelection({
    schemaVersion: 1,
    project: { name: 'laravel-plan', type: 'backend', parentDirectory: 'C:\\Projects' },
    backend: { adapterId: 'backend.laravel', manager: 'composer' },
    documentation: 'minimal',
    git: { initialize: false, initialCommit: false },
  }))
  const scaffold = plan.steps.find((step) => step.id === 'scaffold')
  const install = plan.steps.find((step) => step.id === 'install')
  assert.equal(plan.recipeId, 'BE-05')
  assert.equal(plan.recipeStatus, 'planned')
  assert.equal(plan.executionAvailable, false)
  assert.equal(plan.executesDependencyLifecycleScripts, false)
  assert.equal(plan.requiresDependencyConsent, true)
  assert.ok(scaffold?.sideEffects.some((effect) => effect.includes('--no-scripts --no-plugins --no-install')))
  assert.ok(install?.sideEffects.some((effect) => effect.includes('disabled for both update and install')))
  assert.ok(plan.networkAccess.includes('https://repo.packagist.org/'))
  assert.ok(plan.warnings.some((warning) => warning.includes('without sandboxing')))
  assert.ok(plan.warnings.some((warning) => warning.includes('does not create a .env file')))
})
