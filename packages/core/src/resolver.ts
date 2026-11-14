import { win32 } from 'node:path'
import { incompatibleError } from './errors.js'
import { RECIPES } from './catalog.js'
import { FORMA_COMMIT_SHA, formaTemplate, isFormaCommit } from './forma-catalog.js'
import { resolveOutputPath } from './paths.js'
import type { ProjectSelectionV1, RecipeManifestV1, ResolvedSelection } from './types.js'

export function resolveSelection(selection: ProjectSelectionV1): ResolvedSelection {
  const { project } = selection
  const outputPath = resolveOutputPath(project.parentDirectory, project.name)
  if (project.type === 'backend') {
    const manager = selection.backend?.manager ?? 'npm'
    if (!selection.backend || selection.backend.adapterId !== 'backend.express' || manager !== 'npm'
      || selection.frontend || selection.database || selection.styling || selection.template) {
      throw incompatibleError('BE-01 supports standalone Express + TypeScript + npm only; frontend, database, and fullstack choices are unavailable.')
    }
    const recipe = RECIPES.find((candidate) => candidate.id === 'BE-01')
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
