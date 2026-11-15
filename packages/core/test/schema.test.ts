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
import { supportsGo, supportsNodeForAngular, supportsNodeForBackend, supportsNodeForNext, supportsNodeForNuxt, supportsNodeForPnpm, supportsNodeForVite, supportsNodeForVue, supportsNpm, supportsPython, supportsUv } from '../src/toolchain.js'
import { defaultGoModulePath, isValidGoModulePath } from '../src/go-module.js'
import { FORMA_COMMIT_SHA, isFormaCommit } from '../src/forma-catalog.js'
import { runDoctor } from '../src/doctor.js'
import { ADAPTERS, PACKAGE_MANAGERS } from '../src/catalog.js'

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

const reactScssConfig = {
  ...reactConfig,
  styling: { adapterId: 'styling.scss' },
}

const vueScssConfig = {
  ...vueConfig,
  styling: { adapterId: 'styling.scss' },
}

const reactTailwindConfig = {
  ...reactConfig,
  styling: { adapterId: 'styling.tailwind' },
}

const vueTailwindConfig = {
  ...vueConfig,
  styling: { adapterId: 'styling.tailwind' },
}

test('accepts exact FE-01 through FE-15 combinations without filesystem access', () => {
  assert.equal(resolveSelection(parseSelection(reactConfig)).recipe.id, 'FE-01')
  assert.equal(resolveSelection(parseSelection(nextConfig)).recipe.id, 'FE-02')
  assert.equal(resolveSelection(parseSelection(vueConfig)).recipe.id, 'FE-03')
  assert.equal(resolveSelection(parseSelection(reactBootstrapConfig)).recipe.id, 'FE-04')
  assert.equal(resolveSelection(parseSelection(vueBootstrapConfig)).recipe.id, 'FE-05')
  const nuxt = resolveSelection(parseSelection(nuxtConfig)).recipe
  assert.equal(nuxt.id, 'FE-06')
  assert.equal(nuxt.status, 'planned')
  assert.equal(nuxt.scaffold!.source?.commitSha, 'db01806fcb37f2e369fb09443c72cac696b31548')
  assert.ok(nuxt.dependencies?.every(({ integrity }) => integrity.startsWith('sha512-')))
  assert.deepEqual(nuxt.dependencies?.map(({ packageName, version, scope }) => [packageName, version, scope]), [
    ['nuxt', '4.6.4', undefined],
    ['typescript', '5.9.3', 'devDependencies'],
    ['vue-tsc', '3.3.14', 'devDependencies'],
  ])
  const angular = resolveSelection(parseSelection(angularConfig)).recipe
  assert.equal(angular.id, 'FE-07')
  assert.equal(angular.status, 'planned')
  assert.equal(angular.scaffold!.packageName, '@angular/cli')
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

  for (const [config, id, dependencies, styleFile] of [
    [reactScssConfig, 'FE-08', [['sass', '1.108.2']], 'src/project-generator.scss'],
    [vueScssConfig, 'FE-09', [['sass', '1.108.2']], 'src/project-generator.scss'],
    [reactTailwindConfig, 'FE-10', [['tailwindcss', '4.3.5'], ['@tailwindcss/vite', '4.3.5']], 'src/project-generator-tailwind.css'],
    [vueTailwindConfig, 'FE-11', [['tailwindcss', '4.3.5'], ['@tailwindcss/vite', '4.3.5']], 'src/project-generator-tailwind.css'],
  ] as const) {
    const recipe = resolveSelection(parseSelection(config)).recipe
    assert.equal(recipe.id, id)
    assert.equal(recipe.status, 'planned')
    assert.deepEqual(recipe.dependencies?.map(({ packageName, version }) => [packageName, version]), dependencies)
    assert.ok(recipe.dependencies?.every(({ integrity }) => integrity.startsWith('sha512-')))
    const stylePlan = createPlan(parseSelection(config))
    assert.equal(stylePlan.executionAvailable, false)
    assert.ok(stylePlan.expectedWrites.includes(styleFile))
    assert.match(stylePlan.steps.find((step) => step.id === 'configure')?.readableSummary ?? '', id === 'FE-08' || id === 'FE-09' ? /Dart Sass 1\.108\.2/ : /Tailwind CSS 4\.3\.5.*official Vite plugin/)
  }

  for (const [manager, frontend, id, lockfile, configFile] of [
    ['yarn', 'frontend.react-vite', 'FE-12', 'yarn.lock', '.yarnrc.yml'],
    ['yarn', 'frontend.vue-vite', 'FE-13', 'yarn.lock', '.yarnrc.yml'],
    ['pnpm', 'frontend.react-vite', 'FE-14', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'],
    ['pnpm', 'frontend.vue-vite', 'FE-15', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'],
  ] as const) {
    const selection = parseSelection({
      ...reactConfig,
      project: { ...reactConfig.project, name: `${manager}-${frontend.includes('vue') ? 'vue' : 'react'}` },
      frontend: { adapterId: frontend, language: 'ts', manager },
    })
    const recipe = resolveSelection(selection).recipe
    const plan = createPlan(selection)
    assert.equal(recipe.id, id)
    assert.equal(recipe.status, 'planned')
    assert.equal(recipe.manager, manager)
    assert.equal(plan.recipeStatus, 'planned')
    assert.equal(plan.executionAvailable, false)
    assert.ok(plan.expectedWrites.includes(lockfile))
    assert.ok(plan.expectedWrites.includes(configFile))
    assert.match(plan.steps.find((step) => step.id === 'install')?.readableSummary ?? '', new RegExp(`${manager}.*${lockfile}`))
  }
  assert.deepEqual(PACKAGE_MANAGERS.map(({ id, version }) => [id, version]), [
    ['npm', '>=10.0.0'], ['yarn', '4.18.1'], ['pnpm', '11.28.11'], ['go-modules', 'Go 1.22+'], ['uv', '>=0.8.0'],
  ])
  assert.ok(ADAPTERS.find(({ id }) => id === 'frontend.react-vite')?.packageManagers.includes('pnpm'))
  assert.ok(ADAPTERS.find(({ id }) => id === 'frontend.vue-vite')?.packageManagers.includes('yarn'))
})

test('BE-01 resolves standalone Express and pins every direct dependency', () => {
  const selection = parseSelection({
    schemaVersion: 1,
    project: { name: 'sample-api', type: 'backend', parentDirectory: 'E:\\Projects' },
    backend: { adapterId: 'backend.express', manager: 'npm' },
    documentation: 'standard',
    git: { initialize: false, initialCommit: false },
  })
  const recipe = resolveSelection(selection).recipe
  const plan = createPlan(selection)
  assert.equal(recipe.id, 'BE-01')
  assert.equal(recipe.status, 'planned')
  assert.equal(recipe.projectType, 'backend')
  assert.equal(recipe.backend, 'backend.express')
  assert.equal(recipe.scaffold, undefined)
  assert.deepEqual(recipe.dependencies?.map(({ packageName, version, scope }) => [packageName, version, scope]), [
    ['express', '5.1.0', undefined],
    ['@types/express', '5.0.3', 'devDependencies'],
    ['@types/node', '22.20.5', 'devDependencies'],
    ['tsx', '4.20.5', 'devDependencies'],
    ['typescript', '5.9.3', 'devDependencies'],
  ])
  assert.ok(recipe.dependencies?.every(({ integrity }) => integrity.startsWith('sha512-')))
  assert.equal(plan.executionAvailable, false)
  assert.ok(plan.expectedWrites.includes('.env.example'))
  assert.ok(plan.expectedWrites.includes('src/server.ts'))
  assert.ok(plan.expectedWrites.includes('test/backend.test.ts'))
  assert.ok(plan.expectedWrites.includes('test/shutdown.test.ts'))
  assert.ok(!plan.expectedWrites.includes('src/shutdown.ts'))
  assert.ok(plan.expectedWrites.includes('package-lock.json'))
  assert.ok(plan.networkAccess.includes('https://registry.npmjs.org/'))
  assert.equal(plan.steps.find((step) => step.id === 'scaffold')?.action, 'write-declared-files')
  assert.equal(plan.steps.find((step) => step.id === 'scaffold')?.consentKind, undefined)
  assert.match(plan.steps.find((step) => step.id === 'validate')?.readableSummary ?? '', /graceful-shutdown/)
  assert.equal(supportsNodeForBackend('22.12.0'), false)
  assert.equal(supportsNodeForBackend('22.13.0'), true)
  assert.equal(supportsNodeForBackend('24.0.0'), true)

  for (const invalid of [
    { ...selection, project: { ...selection.project, type: 'fullstack' } },
    { ...selection, backend: { adapterId: 'backend.express', manager: 'yarn' } },
    { ...selection, frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'npm' } },
    { ...selection, styling: { adapterId: 'styling.css' } },
    { ...selection, database: { adapterId: 'database.postgresql', mode: 'existing-service' } },
  ]) {
    assert.throws(() => createPlan(parseSelection(invalid)), (error: unknown) => error instanceof GeneratorError
      && error.code === 'GEN_INCOMPATIBLE'
      && error.nextAction === 'Choose an explicitly cataloged recipe and remove unsupported choices.')
  }
})

test('BE-02 resolves standalone Go net/http with Go Modules and validates module paths', () => {
  const selection = parseSelection({
    schemaVersion: 1,
    project: { name: 'sample-api', type: 'backend', parentDirectory: 'E:\\Projects' },
    backend: { adapterId: 'backend.go-net-http', manager: 'go-modules', modulePath: 'github.com/example/sample-api' },
    documentation: 'standard',
    git: { initialize: false, initialCommit: false },
  })
  const resolved = resolveSelection(selection)
  const plan = createPlan(selection)
  assert.equal(resolved.recipe.id, 'BE-02')
  assert.equal(resolved.recipe.status, 'planned')
  assert.equal(resolved.recipe.language, 'go')
  assert.equal(resolved.recipe.manager, 'go-modules')
  assert.deepEqual(resolved.recipe.dependencies, undefined)
  assert.equal(resolved.selection.backend?.modulePath, 'github.com/example/sample-api')
  assert.equal(plan.executionAvailable, false)
  assert.equal(plan.executesDependencyLifecycleScripts, false)
  assert.deepEqual(plan.networkAccess, [])
  assert.ok(plan.expectedWrites.includes('go.mod'))
  assert.ok(plan.expectedWrites.includes('internal/server/server_test.go'))
  assert.ok(!plan.expectedWrites.includes('go.sum'))
  assert.match(plan.steps.find((step) => step.id === 'validate')?.readableSummary ?? '', /go fmt.*go vet.*go test.*go build/s)
  assert.match(plan.steps.find((step) => step.id === 'install')?.readableSummary ?? '', /no download, go\.sum, or install script/)

  assert.equal(defaultGoModulePath('sample-api'), 'example.com/sample-api')
  assert.equal(isValidGoModulePath('github.com/example/sample-api'), true)
  assert.equal(isValidGoModulePath('example.com/sample-api/v2'), true)
  assert.equal(isValidGoModulePath('github.com/acme/pkg/v2'), true)
  assert.equal(isValidGoModulePath('github.com/acme/pkg/v3'), true)
  assert.equal(isValidGoModulePath('github.com/acme/pkg..name'), true)
  assert.equal(isValidGoModulePath('github.com/GoogleCloudPlatform/cloudsql-proxy'), true)
  assert.equal(isValidGoModulePath('gopkg.in/yaml.v2'), true)
  assert.equal(isValidGoModulePath('gopkg.in/check.v1'), true)
  assert.equal(isValidGoModulePath('gopkg.in/check.v2-unstable'), true)
  assert.equal(supportsGo('1.22.0'), true)
  assert.equal(supportsGo('1.21.13'), false)
  assert.equal(supportsGo('go1.26.7'), false)
  const invalidModulePaths = [
    'bad path/name', 'github.com/../escape', 'github.com/name/v1', 'Example.com/project',
    'github.com/name\\project', 'single-segment', 'localhost/api', '-example.com/api',
    'example_com/api', 'github.com/con/api', 'github.com/PRN/api', 'github.com/acme/AUX/api',
    'github.com/acme/NUL/api', ...Array.from({ length: 9 }, (_, index) => `github.com/acme/COM${index + 1}/api`),
    ...Array.from({ length: 9 }, (_, index) => `github.com/acme/LPT${index + 1}/api`),
    'github.com/acme/con.txt/api', 'github.com/acme/pkg~1', 'github.com/acme/pkg~12.txt',
    'github.com/acme/pkg/v02', 'github.com/acme/pkg/v2.1', 'github.com/acme/pkg/v.2',
    'github.com/acme/.hidden', 'github.com/acme/name.',
    'github.com/acme/name//child', 'github.com/acme/+name', 'github.com/acme/名前',
    'gopkg.in/yaml', 'gopkg.in/yaml.v01', 'gopkg.in/yaml.v0-unstable', 'gopkg.in/yaml.v2/child',
  ]
  for (const modulePath of invalidModulePaths) {
    assert.equal(isValidGoModulePath(modulePath), false, modulePath)
    assert.throws(() => createPlan(parseSelection({
      ...selection,
      backend: { ...selection.backend!, modulePath },
    })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_CONFIG_INVALID')
  }
  assert.throws(() => createPlan(parseSelection({
    ...selection,
    backend: { adapterId: 'backend.go-net-http', manager: 'npm', modulePath: 'github.com/example/sample-api' },
  })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  assert.throws(() => createPlan(parseSelection({
    ...selection,
    frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'npm' },
  })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
})

test('BE-06 resolves standalone planned FastAPI with uv, Python 3.14, and locked dependencies', () => {
  const selection = parseSelection({
    schemaVersion: 1,
    project: { name: 'sample-api', type: 'backend', parentDirectory: 'E:\\Projects' },
    backend: { adapterId: 'backend.fastapi' },
    documentation: 'standard',
    git: { initialize: false, initialCommit: false },
  })
  const resolved = resolveSelection(selection)
  const plan = createPlan(selection)
  assert.equal(resolved.recipe.id, 'BE-06')
  assert.equal(resolved.recipe.status, 'planned')
  assert.equal(resolved.recipe.backend, 'backend.fastapi')
  assert.equal(resolved.recipe.language, 'python')
  assert.equal(resolved.recipe.manager, 'uv')
  assert.equal(resolved.recipe.manager, 'uv')
  assert.equal(plan.executionAvailable, false)
  assert.equal(plan.executesDependencyLifecycleScripts, true)
  assert.deepEqual(plan.networkAccess, ['https://pypi.org/', 'https://files.pythonhosted.org/'])
  assert.ok(plan.expectedWrites.includes('pyproject.toml'))
  assert.ok(plan.expectedWrites.includes('.python-version'))
  assert.ok(plan.expectedWrites.includes('uv.lock'))
  assert.ok(plan.expectedWrites.includes('app/api/routes/health.py'))
  assert.ok(plan.expectedWrites.includes('tests/test_shutdown.py'))
  assert.equal(plan.expectedWrites.includes('package.json'), false)
  assert.equal(plan.steps.find((step) => step.id === 'install')?.ownerAdapterId, 'uv')
  assert.match(plan.steps.find((step) => step.id === 'install')?.readableSummary ?? '', /uv sync --locked/)
  assert.ok(ADAPTERS.find((adapter) => adapter.id === 'backend.fastapi')?.prerequisites.some((tool) => tool.executableId === 'python' && tool.versionRange === '>=3.14,<3.15'))
  assert.equal(PACKAGE_MANAGERS.find((manager) => manager.id === 'uv')?.lockfile, 'uv.lock')
  assert.equal(supportsPython('3.14.0'), true)
  assert.equal(supportsPython('3.15.1'), false)
  assert.equal(supportsPython('3.14.0rc1'), false)
  assert.equal(supportsUv('0.8.0'), true)
  assert.equal(supportsUv('0.7.9'), false)

  for (const backend of [
    { adapterId: 'backend.fastapi', manager: 'npm' },
    { adapterId: 'backend.fastapi', manager: 'uv', modulePath: 'github.com/example/project' },
  ]) {
    assert.throws(() => createPlan(parseSelection({ ...selection, backend })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  }
  assert.throws(() => createPlan(parseSelection({
    ...selection,
    frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'npm' },
  })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
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
  assert.throws(() => resolveSelection(parseSelection({ ...angularConfig, styling: { adapterId: 'styling.tailwind' } })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  assert.throws(() => resolveSelection(parseSelection({ ...nextConfig, styling: { adapterId: 'styling.scss' } })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
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
  const parsed = parseSelection({ ...angularConfig, styling: { adapterId: 'styling.tailwind' } })
  assert.throws(() => resolveSelection(parsed), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  const contradictory = parseSelection({ ...reactConfig, git: { initialize: false, initialCommit: true } })
  assert.throws(() => resolveSelection(contradictory), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  const unsupportedManager = parseSelection({
    ...reactConfig,
    frontend: { ...reactConfig.frontend, manager: 'bun' },
  })
  assert.throws(() => resolveSelection(unsupportedManager), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  assert.throws(() => resolveSelection(parseSelection({
    ...reactConfig,
    frontend: { ...reactConfig.frontend, manager: 'yarn' },
    styling: undefined,
    template: { adapterId: 'template.forma', templateId: 'staywise-host-dashboard', commitSha: FORMA_COMMIT_SHA },
  })), (error: unknown) => error instanceof GeneratorError && error.code === 'GEN_INCOMPATIBLE')
  assert.equal(resolveSelection(parseSelection(vueTailwindConfig)).recipe.id, 'FE-11')
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
  assert.equal(supportsNodeForPnpm('22.12.9'), false)
  assert.equal(supportsNodeForPnpm('22.13.0'), true)
  assert.equal(supportsNodeForPnpm('24.0.0'), true)
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
    const pnpm = parseSelection({
      ...reactConfig,
      project: { ...reactConfig.project, parentDirectory: parent, name: 'pnpm-react' },
      frontend: { adapterId: 'frontend.react-vite', language: 'ts', manager: 'pnpm' },
    })
    const pnpmReport = await runDoctor(pnpm)
    assert.equal(pnpmReport.tools.find(({ id }) => id === 'node')?.available, supportsNodeForPnpm(process.version))
    assert.equal(pnpmReport.tools.find(({ id }) => id === 'pnpm')?.version, '11.28.11')
  } finally {
    await rm(parent, { recursive: true, force: true })
  }
})
