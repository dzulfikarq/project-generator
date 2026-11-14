import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { win32 } from 'node:path'
import test from 'node:test'
import { parseSelection } from '../src/schema.js'
import { createPlan } from '../src/plan.js'
import { resolveSelection } from '../src/resolver.js'
import { normalizeWindowsParent, resolveOutputPath } from '../src/paths.js'
import { GeneratorError } from '../src/errors.js'
import { supportsNodeForAngular, supportsNodeForNext, supportsNodeForNuxt, supportsNodeForVite, supportsNodeForVue, supportsNpm } from '../src/toolchain.js'
import { FORMA_COMMIT_SHA, isFormaCommit } from '../src/forma-catalog.js'
import { runDoctor } from '../src/doctor.js'

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

const nuxtConfig = {
  ...reactConfig,
  frontend: { adapterId: 'frontend.nuxt', language: 'ts', manager: 'npm' },
}

const angularConfig = {
  ...reactConfig,
  frontend: { adapterId: 'frontend.angular', language: 'ts', manager: 'npm' },
  styling: { adapterId: 'styling.scss' },
}

test('accepts exact FE-01 through FE-07 combinations without filesystem access', () => {
  assert.equal(resolveSelection(parseSelection(reactConfig)).recipe.id, 'FE-01')
  assert.equal(resolveSelection(parseSelection(nextConfig)).recipe.id, 'FE-02')
  assert.equal(resolveSelection(parseSelection(vueConfig)).recipe.id, 'FE-03')
  assert.equal(resolveSelection(parseSelection(reactBootstrapConfig)).recipe.id, 'FE-04')
  assert.equal(resolveSelection(parseSelection(vueBootstrapConfig)).recipe.id, 'FE-05')
  const nuxt = resolveSelection(parseSelection(nuxtConfig)).recipe
  assert.equal(nuxt.id, 'FE-06')
  assert.equal(nuxt.status, 'planned')
  assert.equal(nuxt.scaffold.source?.commitSha, 'db01806fcb37f2e369fb09443c72cac696b31548')
  assert.ok(nuxt.dependencies?.every(({ integrity }) => integrity.startsWith('sha512-')))
  assert.deepEqual(nuxt.dependencies?.map(({ packageName, version, scope }) => [packageName, version, scope]), [
    ['nuxt', '4.6.4', undefined],
    ['typescript', '5.9.3', 'devDependencies'],
    ['vue-tsc', '3.3.14', 'devDependencies'],
  ])
  const angular = resolveSelection(parseSelection(angularConfig)).recipe
  assert.equal(angular.id, 'FE-07')
  assert.equal(angular.status, 'planned')
  assert.equal(angular.scaffold.packageName, '@angular/cli')
  assert.deepEqual(angular.dependencies?.map(({ packageName, version }) => [packageName, version]), [['@angular/core', '21.2.26'], ['@angular/cli', '21.2.30']])
  const plan = createPlan(parseSelection(reactConfig))
  assert.equal(plan.recipeStatus, 'planned')
  assert.equal(plan.executionAvailable, false)
  assert.equal(plan.targetPath, 'E:\\Projects\\sample-web')
  const bootstrapPlan = createPlan(parseSelection(vueBootstrapConfig))
  assert.ok(bootstrapPlan.expectedWrites.includes('src/project-generator-bootstrap.css'))
  assert.ok(bootstrapPlan.expectedWrites.includes('.npmrc'))
  assert.match(bootstrapPlan.steps.find((step) => step.id === 'install')?.readableSummary ?? '', /omit unused Bootstrap Popper/)
  assert.match(bootstrapPlan.steps.find((step) => step.id === 'configure')?.readableSummary ?? '', /Bootstrap 5/)
  const nuxtPlan = createPlan(parseSelection(nuxtConfig))
  assert.equal(nuxtPlan.recipeId, 'FE-06')
  assert.equal(nuxtPlan.executionAvailable, false)
  assert.ok(nuxtPlan.networkAccess.includes('https://api.github.com'))
  assert.ok(nuxtPlan.networkAccess.includes('https://codeload.github.com'))
  assert.match(nuxtPlan.steps.find((step) => step.id === 'scaffold')?.readableSummary ?? '', /nuxt\/starter@db01806fcb37f2e369fb09443c72cac696b31548/)
  assert.match(nuxtPlan.steps.find((step) => step.id === 'configure')?.readableSummary ?? '', /typescript@5\.9\.3, vue-tsc@3\.3\.14/)
  const angularPlan = createPlan(parseSelection(angularConfig))
  assert.equal(angularPlan.recipeId, 'FE-07')
  assert.equal(angularPlan.executionAvailable, false)
  assert.ok(angularPlan.expectedWrites.includes('<pinned Angular CLI workspace files>'))
  assert.match(angularPlan.steps.find((step) => step.id === 'install')?.readableSummary ?? '', /legacy peer handling/)
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
  assert.throws(() => resolveSelection(parseSelection({
    ...nuxtConfig,
    template: { adapterId: 'template.forma', templateId: 'modern-admin', commitSha: FORMA_COMMIT_SHA },
  })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  assert.throws(() => resolveSelection(parseSelection({ ...nuxtConfig, styling: { adapterId: 'styling.scss' } })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  assert.throws(() => resolveSelection(parseSelection({ ...angularConfig, styling: { adapterId: 'styling.css' } })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
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
  assert.equal(supportsNodeForNuxt('22.22.2'), false)
  assert.equal(supportsNodeForNuxt('22.22.3'), true)
  assert.equal(supportsNodeForNuxt('24.14.9'), false)
  assert.equal(supportsNodeForNuxt('24.15.0'), true)
  assert.equal(supportsNodeForNuxt('25.0.0'), false)
  assert.equal(supportsNodeForNuxt('26.0.0'), true)
  assert.equal(supportsNodeForAngular('20.18.9'), false)
  assert.equal(supportsNodeForAngular('20.19.0'), true)
  assert.equal(supportsNodeForAngular('22.11.9'), false)
  assert.equal(supportsNodeForAngular('22.12.0'), true)
  assert.equal(supportsNodeForAngular('23.0.0'), false)
  assert.equal(supportsNodeForAngular('24.0.0'), true)
  assert.equal(supportsNpm('9.9.9'), false)
  assert.equal(supportsNpm('10.0.0'), true)
})

test('doctor applies framework-specific Nuxt and Angular Node requirements', { skip: process.platform !== 'win32' }, async () => {
  const parent = await mkdtemp(win32.join(tmpdir(), 'pg-phase04b-doctor-'))
  try {
    for (const [config, supported] of [[nuxtConfig, supportsNodeForNuxt], [angularConfig, supportsNodeForAngular]] as const) {
      const selection = parseSelection({ ...config, project: { ...config.project, parentDirectory: parent } })
      const report = await runDoctor(selection)
      assert.equal(report.tools.find(({ id }) => id === 'node')?.available, supported(process.version))
      assert.equal(report.tools.find(({ id }) => id === 'target')?.available, true)
    }
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
