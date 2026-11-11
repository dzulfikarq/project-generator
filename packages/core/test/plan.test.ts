import assert from 'node:assert/strict'
import test from 'node:test'
import { createPlan } from '../src/plan.js'
import { parseSelection } from '../src/schema.js'

test('generation plan discloses unsandboxed npm lifecycle script execution', () => {
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
  assert.ok(install?.sideEffects.includes('Run npm package lifecycle scripts.'))
  assert.ok(plan.warnings.some((warning) => warning.includes('lifecycle scripts') && warning.includes('not sandboxed')))
})
