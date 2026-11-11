import { resolveSelection } from './resolver.js'
import { expectedDocumentationFiles } from './project-docs.js'
import type { GenerationPlan, ProjectSelectionV1 } from './types.js'

export function createPlan(selection: ProjectSelectionV1): GenerationPlan {
  const resolved = resolveSelection(selection)
  const recipe = resolved.recipe
  return {
    schemaVersion: 1,
    recipeId: recipe.id,
    recipeStatus: recipe.status,
    targetPath: resolved.outputPath,
    steps: [
      { id: 'preflight', ownerAdapterId: 'core', phase: 'preflight', action: 'inspect', readableSummary: 'Check Node/npm versions and destination safety.', sideEffects: [] },
      { id: 'staging', ownerAdapterId: 'core', phase: 'stage', action: 'create-owned-stage', readableSummary: 'Create generator-owned staging beside the destination.', sideEffects: ['Create temporary directory in destination parent.'] },
      { id: 'scaffold', ownerAdapterId: recipe.frontend, phase: 'scaffold', action: 'run-pinned-cli', readableSummary: `Install and run ${recipe.scaffold.packageName}@${recipe.scaffold.version} with fixed arguments.`, sideEffects: ['Download pinned official scaffold package.', 'Run reviewed scaffold code.'], consentKind: 'network' },
      { id: 'configure', ownerAdapterId: 'documentation', phase: 'configure', action: 'write-declared-files', readableSummary: `Write truthful README, setup guide, and ${resolved.selection.documentation} documentation.`, sideEffects: ['Write declared files under staged project.'] },
      { id: 'install', ownerAdapterId: 'npm', phase: 'install', action: 'install-dependencies', readableSummary: 'Install project dependencies with npm and write package-lock.json.', sideEffects: ['Download project dependencies.', 'Run npm package lifecycle scripts.'], consentKind: 'network' },
      { id: 'validate', ownerAdapterId: recipe.frontend, phase: 'validate', action: 'run-check', readableSummary: 'Run lint/typecheck/build and HTTP served-page smoke checks.', sideEffects: ['Execute generated framework tools in staging.', 'Write reproducibility manifest with observed check outcomes.'] },
      { id: 'finalize', ownerAdapterId: 'core', phase: 'finalize', action: 'commit-no-replace', readableSummary: 'Move validated project to destination only if destination remains absent.', sideEffects: ['Create final destination with Windows fail-if-exists rename.'] },
    ],
    expectedWrites: ['<pinned official framework scaffold files>', ...expectedDocumentationFiles(resolved.selection.documentation), 'package-lock.json', '.project-generator/manifest.json'],
    networkAccess: ['https://registry.npmjs.org/'],
    executesDependencyLifecycleScripts: true,
    executionAvailable: recipe.status === 'tested',
    warnings: [
      'Recipe remains planned until independent Windows evidence and review promote its status.',
      'npm package lifecycle scripts may execute third-party code; generation is not sandboxed.',
      'Generation installs dependencies from npm and needs network access unless package caches are available.',
    ],
  }
}
