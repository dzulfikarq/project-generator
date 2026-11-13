import { win32 } from 'node:path'
import { incompatibleError } from './errors.js'
import { RECIPES } from './catalog.js'
import { FORMA_COMMIT_SHA, formaTemplate, isFormaCommit } from './forma-catalog.js'
import { resolveOutputPath } from './paths.js'
import type { ProjectSelectionV1, RecipeManifestV1, ResolvedSelection } from './types.js'

export function resolveSelection(selection: ProjectSelectionV1): ResolvedSelection {
  const { project } = selection
  const outputPath = resolveOutputPath(project.parentDirectory, project.name)
  if (project.type !== 'frontend' || !selection.frontend) {
    throw incompatibleError('Phase 01 supports frontend projects only; backend, database, and mobile choices are unavailable.')
  }
  if (selection.frontend.language !== 'ts' || selection.frontend.manager !== 'npm') {
    throw incompatibleError('Phase 01 recipes require TypeScript and npm.')
  }
  if (selection.backend || selection.database || selection.styling?.uiLibraryId) {
    throw incompatibleError('Phase 01 recipes do not support separate backends, databases, or UI libraries.')
  }
  if (selection.git.initialize || selection.git.initialCommit) {
    throw incompatibleError('Git initialization is not implemented in Phase 01; both git options must be false.')
  }

  const frameworkRecipe = RECIPES.find((candidate) => candidate.frontend === selection.frontend?.adapterId)
  if (!frameworkRecipe) throw incompatibleError('Selection does not match FE-01 React + Vite or FE-02 Next.js App Router.')

  let recipe = frameworkRecipe
  if (selection.template) {
    const template = formaTemplate(selection.template.templateId)
    if (!template) throw incompatibleError('Forma template is not in the pinned, reviewed catalog.')
    if (!isFormaCommit(selection.template.commitSha) || template.commitSha !== FORMA_COMMIT_SHA) {
      throw incompatibleError('Forma template commit does not match the immutable catalog pin.')
    }
    if (!template.testedFrameworks.includes(frameworkRecipe.frontend)) {
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
    const selectedRecipe = RECIPES.find((candidate) => candidate.frontend === frameworkRecipe.frontend && candidate.styling === selection.styling?.adapterId)
    if (!selectedRecipe) throw incompatibleError('Selection does not match FE-01 React + Vite + CSS or FE-02 Next.js + Tailwind.')
    recipe = selectedRecipe
  }

  return {
    selection: Object.freeze(selection),
    recipe: recipe as RecipeManifestV1,
    outputPath: win32.normalize(outputPath),
  }
}
