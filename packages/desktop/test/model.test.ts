import assert from 'node:assert/strict'
import test from 'node:test'
import {
  emptyPreferences,
  canStartGeneration,
  documentationFiles,
  findFrameworkRecipe,
  findRecipe,
  filterFormaTemplates,
  formaMetadataCompatible,
  loadPreferences,
  savePreferences,
  STORAGE_KEY,
  validateParentDirectory,
  validateProjectName,
  type Catalog,
} from '../src/model.ts'

test('project validation matches npm-safe and Windows-reserved name boundaries', () => {
  assert.equal(validateProjectName('weather-board_2'), null)
  assert.match(validateProjectName('Uppercase') ?? '', /lowercase/)
  assert.match(validateProjectName('con') ?? '', /reserved/)
  assert.match(validateProjectName('name.') ?? '', /reserved/)
})

test('parent path validation rejects relative, traversal, and overlong paths', () => {
  assert.equal(validateParentDirectory('C:\\Users\\Dev\\Projects'), null)
  assert.match(validateParentDirectory('Projects') ?? '', /absolute/)
  assert.match(validateParentDirectory('C:\\Users\\..\\Projects') ?? '', /traversal/)
  assert.match(validateParentDirectory('C:\\CON') ?? '', /reserved/)
  assert.ok(validateParentDirectory(`C:\\${'x'.repeat(220)}`))
})

test('recipe selection requires exact framework, styling, and manager catalog match', () => {
  const catalog = {
    adapters: [{ id: 'template.forma', compatibleWith: ['react', 'next'] }],
    recipes: [
      { id: 'FE-01', frontend: 'react', styling: 'css', manager: 'npm' },
      { id: 'FE-02', frontend: 'next', styling: 'tailwind', manager: 'npm' },
      { id: 'FE-03', frontend: 'vue', styling: 'css', manager: 'npm' },
      { id: 'FE-04', frontend: 'react', styling: 'bootstrap', manager: 'npm' },
      { id: 'FE-05', frontend: 'vue', styling: 'bootstrap', manager: 'npm' },
    ],
  } as Catalog
  assert.equal(findRecipe(catalog, 'react', 'css', 'npm')?.id, 'FE-01')
  assert.equal(findRecipe(catalog, 'react', 'tailwind', 'npm'), undefined)
  assert.equal(findRecipe(catalog, 'react', 'css', 'yarn'), undefined)
  assert.equal(findFrameworkRecipe(catalog, 'react', 'npm')?.id, 'FE-01')
  assert.equal(findRecipe(catalog, 'react', 'bootstrap', 'npm')?.id, 'FE-04')
  assert.equal(findRecipe(catalog, 'vue', 'css', 'npm')?.id, 'FE-03')
  assert.equal(findRecipe(catalog, 'vue', 'bootstrap', 'npm')?.id, 'FE-05')
  assert.equal(findFrameworkRecipe(catalog, 'vue', 'npm'), undefined)
})

test('Forma compatibility exposes catalog metadata only', () => {
  const catalog = { adapters: [{ id: 'template.forma', compatibleWith: ['react'] }] } as Catalog
  const template = { testedFrameworks: ['react'] } as Catalog['forma']['templates'][number]
  assert.equal(formaMetadataCompatible(template, 'react', catalog), true)
  assert.equal(formaMetadataCompatible(template, 'next', catalog), false)
})

test('Forma gallery search and filters use pinned catalog metadata', () => {
  const templates: Catalog['forma']['templates'] = [
    {
      id: 'focus-planner', name: 'Focus Planner', description: 'A calm daily planning board', version: '0.1.0',
      contentHash: 'a'.repeat(64), category: 'productivity', tags: ['focus', 'planner'], license: 'MIT',
      variants: [], testedFrameworks: ['frontend.react-vite'], commitSha: 'a'.repeat(40),
    },
    {
      id: 'modern-admin', name: 'Modern Admin', description: 'An operations dashboard', version: '1.0.0',
      contentHash: 'b'.repeat(64), category: 'admin-cms', tags: ['dashboard', 'analytics'], license: 'MIT',
      variants: [], testedFrameworks: ['frontend.react-vite', 'frontend.nextjs-app'], commitSha: 'a'.repeat(40),
    },
  ]

  assert.deepEqual(filterFormaTemplates(templates, '  FOCUS ', 'all', 'all').map(({ id }) => id), ['focus-planner'])
  assert.deepEqual(filterFormaTemplates(templates, '', 'admin-cms', 'all').map(({ id }) => id), ['modern-admin'])
  assert.deepEqual(filterFormaTemplates(templates, '', 'all', 'frontend.nextjs-app').map(({ id }) => id), ['modern-admin'])
  assert.deepEqual(filterFormaTemplates(templates, 'react-vite', 'productivity', 'all').map(({ id }) => id), ['focus-planner'])
  assert.deepEqual(filterFormaTemplates(templates, 'missing', 'all', 'all'), [])
})

test('documentation preview matches each supported output mode', () => {
  assert.deepEqual(documentationFiles('minimal'), ['README.md', 'docs/SETUP.md'])
  assert.equal(documentationFiles('standard').length, 5)
  assert.equal(documentationFiles('full').length, 12)
})

test('generation requires consent, ready doctor, and internal planned override', () => {
  const base = {
    busy: false,
    invocationActive: false,
    hasSelection: true,
    planAvailable: true,
    doctorReady: true,
    lifecycleConsent: true,
    executionAvailable: false,
    internalDevelopmentMode: true,
    allowPlanned: true,
  }
  assert.equal(canStartGeneration(base), true)
  assert.equal(canStartGeneration({ ...base, lifecycleConsent: false }), false)
  assert.equal(canStartGeneration({ ...base, doctorReady: false }), false)
  assert.equal(canStartGeneration({ ...base, internalDevelopmentMode: false }), false)
  assert.equal(canStartGeneration({ ...base, executionAvailable: true, internalDevelopmentMode: false, allowPlanned: false }), true)
})

test('local persistence keeps only bounded settings and generated-project metadata', () => {
  const values = new Map<string, string>()
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
  const preferences = {
    ...emptyPreferences('C:\\Projects'),
    theme: 'dark' as const,
    projects: [{ name: 'demo', path: 'C:\\Projects\\demo', recipeId: 'FE-01', status: 'completed' as const, createdAt: '2026-11-13T00:00:00.000Z' }],
  }
  assert.equal(savePreferences(storage, preferences), true)
  assert.deepEqual(loadPreferences(storage), preferences)
  const serialized = values.get(STORAGE_KEY) ?? ''
  assert.doesNotMatch(serialized, /logs|credentials|token/i)
  values.set(STORAGE_KEY, '{bad json')
  assert.deepEqual(loadPreferences(storage), emptyPreferences())
})

test('local persistence reports storage failures', () => {
  const storage = { setItem: () => { throw new Error('storage unavailable') } }
  assert.equal(savePreferences(storage, emptyPreferences()), false)
})
