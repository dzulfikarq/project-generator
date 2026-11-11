import { win32 } from 'node:path'
import { incompatibleError } from './errors.js'
import { RECIPES } from './catalog.js'
import { resolveOutputPath } from './paths.js'
import type { ProjectSelectionV1, RecipeManifestV1, ResolvedSelection } from './types.js'

export function resolveSelection(selection: ProjectSelectionV1): ResolvedSelection {
  const { project } = selection
  const outputPath = resolveOutputPath(project.parentDirectory, project.name)
  if (project.type !== 'frontend' || !selection.frontend || !selection.styling) {
    throw incompatibleError('Phase 01 supports frontend projects only; backend, database, and mobile choices are unavailable.')
  }
  if (selection.frontend.language !== 'ts' || selection.frontend.manager !== 'npm') {
    throw incompatibleError('Phase 01 recipes require TypeScript and npm.')
  }
  if (selection.backend || selection.database || selection.template || selection.styling.uiLibraryId) {
    throw incompatibleError('Phase 01 recipes do not support separate backends, databases, Forma templates, or UI libraries.')
  }
  if (selection.git.initialize || selection.git.initialCommit) {
    throw incompatibleError('Git initialization is not implemented in Phase 01; both git options must be false.')
  }

  const recipe = RECIPES.find((candidate) => candidate.frontend === selection.frontend?.adapterId && candidate.styling === selection.styling?.adapterId)
  if (!recipe) throw incompatibleError('Selection does not match FE-01 React + Vite + CSS or FE-02 Next.js + Tailwind.')

  return {
    selection: Object.freeze(selection),
    recipe: recipe as RecipeManifestV1,
    outputPath: win32.normalize(outputPath),
  }
}
