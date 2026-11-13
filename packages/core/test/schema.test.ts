import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSelection } from '../src/schema.js'
import { createPlan } from '../src/plan.js'
import { resolveSelection } from '../src/resolver.js'
import { normalizeWindowsParent, resolveOutputPath } from '../src/paths.js'
import { GeneratorError } from '../src/errors.js'
import { supportsNodeForNext, supportsNodeForVite, supportsNodeForVue, supportsNpm } from '../src/toolchain.js'
import { FORMA_COMMIT_SHA, isFormaCommit } from '../src/forma-catalog.js'

const reactConfig = {
  schemaVersion: 1,
  project: { name: 'sample-web', type: 'frontend', parentDirectory: 'E:\\Projects' },
  frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'npm' },
  styling: { adapterId: 'styling.css' },
  documentation: 'minimal',
  git: { initialize: false, initialCommit: false },
}

const nextConfig = {
  ...reactConfig,
  frontend: { adapterId: 'frontend.nextjs-app', language: 'ts', manager: 'npm' },
  styling: { adapterId: 'styling.tailwind' },
}

const vueConfig = {
  ...reactConfig,
  frontend: { adapterId: 'frontend.vue-vite', language: 'ts', manager: 'npm' },
}

const reactBootstrapConfig = {
  ...reactConfig,
  styling: { adapterId: 'styling.bootstrap' },
}

const vueBootstrapConfig = {
  ...vueConfig,
  styling: { adapterId: 'styling.bootstrap' },
}

test('accepts exact FE-01 through FE-05 combinations without filesystem access', () => {
  assert.equal(resolveSelection(parseSelection(reactConfig)).recipe.id, 'FE-01')
  assert.equal(resolveSelection(parseSelection(nextConfig)).recipe.id, 'FE-02')
  assert.equal(resolveSelection(parseSelection(vueConfig)).recipe.id, 'FE-03')
  assert.equal(resolveSelection(parseSelection(reactBootstrapConfig)).recipe.id, 'FE-04')
  assert.equal(resolveSelection(parseSelection(vueBootstrapConfig)).recipe.id, 'FE-05')
  const plan = createPlan(parseSelection(reactConfig))
  assert.equal(plan.recipeStatus, 'planned')
  assert.equal(plan.executionAvailable, false)
  assert.equal(plan.targetPath, 'E:\\Projects\\sample-web')
  const bootstrapPlan = createPlan(parseSelection(vueBootstrapConfig))
  assert.ok(bootstrapPlan.expectedWrites.includes('src/project-generator-bootstrap.css'))
  assert.ok(bootstrapPlan.expectedWrites.includes('.npmrc'))
  assert.match(bootstrapPlan.steps.find((step) => step.id === 'install')?.readableSummary ?? '', /omit unused Bootstrap Popper/)
  assert.match(bootstrapPlan.steps.find((step) => step.id === 'configure')?.readableSummary ?? '', /Bootstrap 5/)
})

test('resolves only pinned Forma template/framework pairs without network access during planning', () => {
  assert.equal(isFormaCommit(FORMA_COMMIT_SHA.toUpperCase()), true)
  const staywiseVite = parseSelection({
    ...reactConfig,
    styling: undefined,
    template: { adapterId: 'template.forma', templateId: 'staywise-host-dashboard', commitSha: FORMA_COMMIT_SHA.toUpperCase(), variantId: 'coral' },
  })
  const plan = createPlan(staywiseVite)
  assert.equal(plan.recipeId, 'FM-01')
  assert.equal(plan.recipeStatus, 'planned')
  assert.equal(plan.template?.commitSha.toLowerCase(), FORMA_COMMIT_SHA)
  assert.ok(plan.networkAccess.some((entry) => entry.includes('github.com')))
  assert.equal(resolveSelection(parseSelection({
    ...nextConfig,
    styling: undefined,
    template: { adapterId: 'template.forma', templateId: 'modern-admin', commitSha: FORMA_COMMIT_SHA },
  })).recipe.id, 'FM-02')
  assert.throws(() => resolveSelection(parseSelection({
    ...nextConfig,
    styling: undefined,
    template: { adapterId: 'template.forma', templateId: 'focus-planner', commitSha: FORMA_COMMIT_SHA },
  })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  assert.throws(() => resolveSelection(parseSelection({
    ...vueConfig,
    styling: undefined,
    template: { adapterId: 'template.forma', templateId: 'modern-admin', commitSha: FORMA_COMMIT_SHA },
  })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  assert.throws(() => parseSelection({
    ...reactConfig,
    styling: undefined,
    template: { adapterId: 'template.forma', templateId: 'staywise-host-dashboard', commitSha: 'main' },
  }), GeneratorError)
})

test('rejects malformed types, unknown fields, unsupported managers and bad enums', () => {
  const cases = [
    { ...reactConfig, schemaVersion: '1' },
    { ...reactConfig, surprise: true },
    { ...reactConfig, frontend: { ...reactConfig.frontend, manager: 1 } },
    { ...reactConfig, styling: { ...reactConfig.styling, extra: 1 } },
    { ...reactConfig, project: { ...reactConfig.project, type: 'desktop' } },
  ]
  for (const config of cases) assert.throws(() => parseSelection(config), GeneratorError)
})

test('blocks incompatible stacks and contradictory choices with structured errors', () => {
  const parsed = parseSelection({
    ...reactConfig,
    styling: { adapterId: 'styling.tailwind' },
  })
  assert.throws(() => resolveSelection(parsed), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  const contradictory = parseSelection({ ...reactConfig, git: { initialize: false, initialCommit: true } })
  assert.throws(() => resolveSelection(contradictory), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  const unsupportedManager = parseSelection({
    ...reactConfig,
    frontend: { ...reactConfig.frontend, manager: 'pnpm' },
  })
  assert.throws(() => resolveSelection(unsupportedManager), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  assert.throws(() => resolveSelection(parseSelection({ ...vueConfig, styling: { adapterId: 'styling.tailwind' } })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  assert.throws(() => resolveSelection(parseSelection({ ...nextConfig, styling: { adapterId: 'styling.bootstrap' } })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  assert.throws(() => resolveSelection(parseSelection({ ...reactBootstrapConfig, styling: { adapterId: 'styling.bootstrap', uiLibraryId: 'styling.tailwind' } })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE' && error.message.includes('Bootstrap and Tailwind'))
})

test('validates Windows path forms, spaces, Unicode, traversal, reserved names, and length', () => {
  assert.equal(normalizeWindowsParent('E:\\Projects\\My Workspace'), 'E:\\Projects\\My Workspace')
  assert.equal(resolveOutputPath('E:\\Projects\\Málaga', 'sample-web'), 'E:\\Projects\\Málaga\\sample-web')
  for (const path of ['C:\\Projects\\..\\escape', 'C:\\Projects\\NUL', '\\\\server\\share', '\\\\?\\C:\\temp']) {
    assert.throws(() => normalizeWindowsParent(path), GeneratorError)
  }
  assert.throws(() => normalizeWindowsParent('C:\\Projects\\trailing.'), GeneratorError)
  assert.throws(() => normalizeWindowsParent('C:\\Projects\\trailing '), GeneratorError)
  assert.throws(() => resolveOutputPath('C:\\Projects', 'CON'), GeneratorError)
  assert.throws(() => resolveOutputPath('C:\\Projects', 'nul.txt'), GeneratorError)
  assert.throws(() => resolveOutputPath(`C:\\${'x'.repeat(220)}`, 'sample-web'), GeneratorError)
})

test('plan is read-only even when parent path does not exist', () => {
  const config = parseSelection({
    ...reactConfig,
    project: { ...reactConfig.project, parentDirectory: 'Z:\\not-created\\unicode-雪' },
  })
  const before = JSON.stringify(config)
  const plan = createPlan(config)
  assert.equal(JSON.stringify(config), before)
  assert.equal(plan.targetPath, 'Z:\\not-created\\unicode-雪\\sample-web')
})

test('toolchain version checks follow pinned scaffold engine ranges', () => {
  assert.equal(supportsNodeForVite('20.18.1'), false)
  assert.equal(supportsNodeForVite('20.19.0'), true)
  assert.equal(supportsNodeForVite('21.7.0'), false)
  assert.equal(supportsNodeForVite('22.12.0'), true)
  assert.equal(supportsNodeForNext('20.9.0'), true)
  assert.equal(supportsNodeForVue('22.17.9'), false)
  assert.equal(supportsNodeForVue('22.18.0'), true)
  assert.equal(supportsNodeForVue('24.11.9'), false)
  assert.equal(supportsNodeForVue('24.12.0'), true)
  assert.equal(supportsNpm('9.9.9'), false)
  assert.equal(supportsNpm('10.0.0'), true)
})
