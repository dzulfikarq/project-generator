import { win32 } from 'node:path'
import { configError, incompatibleError } from './errors.js'
import { RECIPES } from './catalog.js'
import { FORMA_COMMIT_SHA, formaTemplate, isFormaCommit } from './forma-catalog.js'
import { defaultGoModulePath, isValidGoModulePath } from './go-module.js'
import { resolveOutputPath } from './paths.js'
import type { ProjectSelectionV1, RecipeManifestV1, ResolvedSelection } from './types.js'

export function resolveSelection(selection: ProjectSelectionV1): ResolvedSelection {
  const { project } = selection
  const outputPath = resolveOutputPath(project.parentDirectory, project.name)
  if (project.type === 'backend') {
    const adapterId = selection.backend?.adapterId
    const isGo = adapterId === 'backend.go-net-http'
    const isLaravel = adapterId === 'backend.laravel'
    const isPython = adapterId === 'backend.fastapi'
    const manager = selection.backend?.manager ?? (isGo ? 'go-modules' : isLaravel ? 'composer' : isPython ? 'uv' : 'npm')
    const recipeId = isGo ? 'BE-02' : isLaravel ? 'BE-05' : isPython ? 'BE-06' : 'BE-01'
    if (!selection.backend || !['backend.express', 'backend.go-net-http', 'backend.laravel', 'backend.fastapi'].includes(adapterId ?? '') || manager !== (isGo ? 'go-modules' : isLaravel ? 'composer' : isPython ? 'uv' : 'npm')
      || selection.frontend || selection.database || selection.styling || selection.template) {
      throw incompatibleError('Backend recipes support only standalone Express + npm, Go net/http + Go Modules, Laravel + Composer, or FastAPI + uv; frontend, separate database selections, and fullstack choices are unavailable.')
    }
    if (isGo) {
      const modulePath = selection.backend.modulePath ?? defaultGoModulePath(project.name)
      if (!isValidGoModulePath(modulePath)) throw configError('backend.modulePath must be a valid lowercase Go module path such as github.com/user/project or example.com/project.')
      const normalized = { ...selection, backend: { ...selection.backend, modulePath } }
      const recipe = RECIPES.find((candidate) => candidate.id === recipeId)
      if (!recipe) throw incompatibleError('Selection does not match a cataloged backend recipe.')
      return { selection: Object.freeze(normalized), recipe, outputPath: win32.normalize(outputPath) }
    }
    if (selection.backend.modulePath !== undefined) throw incompatibleError('backend.modulePath is supported only by the Go recipe.')
    const recipe = RECIPES.find((candidate) => candidate.id === recipeId)
    if (!recipe) throw incompatibleError('Selection does not match a cataloged backend recipe.')
    return { selection: Object.freeze(selection), recipe, outputPath: win32.normalize(outputPath) }
  }
  if (project.type !== 'frontend' || !selection.frontend || selection.backend) {
    throw incompatibleError('Phase 01 supports frontend recipes and standalone BE-01 only; fullstack and mobile choices are unavailable.')
  }
  const manager = selection.frontend.manager ?? 'npm'
  if (selection.frontend.language !== 'ts' || !['npm', 'yarn', 'pnpm'].includes(manager)) {
    throw incompatibleError('Recipes require TypeScript and a supported package manager.')
  }
  if ((selection.styling?.adapterId === 'styling.bootstrap' && selection.styling.uiLibraryId === 'styling.tailwind')
    || (selection.styling?.adapterId === 'styling.tailwind' && selection.styling.uiLibraryId === 'styling.bootstrap')) {
    throw incompatibleError('Bootstrap and Tailwind cannot be selected together.')
  }
  if (selection.backend || selection.database || selection.styling?.uiLibraryId) {
    throw incompatibleError('Phase 01 recipes do not support separate backends, databases, or UI libraries.')
  }
  if (selection.git.initialize || selection.git.initialCommit) {
    throw incompatibleError('Git initialization is not implemented in Phase 01; both git options must be false.')
  }

  const frameworkRecipe = RECIPES.find((candidate) => candidate.frontend === selection.frontend?.adapterId)
  if (!frameworkRecipe) throw incompatibleError('Selection does not match a cataloged frontend recipe.')

  let recipe = frameworkRecipe
  if (selection.template) {
    if (manager !== 'npm') throw incompatibleError('Forma integrations remain npm-only; select npm or omit the template.')
    const template = formaTemplate(selection.template.templateId)
    if (!template) throw incompatibleError('Forma template is not in the pinned, reviewed catalog.')
    if (!isFormaCommit(selection.template.commitSha) || template.commitSha !== FORMA_COMMIT_SHA) {
      throw incompatibleError('Forma template commit does not match the immutable catalog pin.')
    }
    if (!template.testedFrameworks.includes(frameworkRecipe.frontend!)) {
      throw incompatibleError(`${template.name} is not verified for the selected framework adapter.`)
    }
    if (selection.template.variantId && !template.variants.some((variant) => variant.id === selection.template?.variantId)) {
      throw incompatibleError(`Theme variant is not available for Forma template ${template.id}.`)
    }
    if (selection.styling) throw incompatibleError('Forma templates provide their own styling; omit the separate styling selection.')
    const { styling, ...templateRecipe } = frameworkRecipe
    void styling
    recipe = {
      ...templateRecipe,
      id: frameworkRecipe.frontend === 'frontend.react-vite' ? 'FM-01' : 'FM-02',
      status: 'planned',
      limitations: [...frameworkRecipe.limitations, `Forma template ${template.id}@${template.version}; generator integration remains planned.`],
      checks: ['dependency-install', 'typecheck', 'build', 'http-smoke'],
      evidenceIds: [],
    }
  } else {
    if (!selection.styling) throw incompatibleError('Select a compatible styling adapter.')
    const selectedRecipe = RECIPES.find((candidate) => candidate.frontend === frameworkRecipe.frontend
      && candidate.styling === selection.styling?.adapterId && candidate.manager === manager)
     if (!selectedRecipe) throw incompatibleError('Selection does not match a cataloged framework and styling recipe.')
    recipe = selectedRecipe
  }

  return {
    selection: Object.freeze(selection),
    recipe: recipe as RecipeManifestV1,
    outputPath: win32.normalize(outputPath),
  }
}
