import { resolveSelection } from './resolver.js'
import { packageManager } from './catalog.js'
import { expectedDocumentationFiles } from './project-docs.js'
import type { GenerationPlan, ProjectSelectionV1 } from './types.js'

export function createPlan(selection: ProjectSelectionV1): GenerationPlan {
  const resolved = resolveSelection(selection)
  const recipe = resolved.recipe
  const manager = packageManager(recipe.manager)
  const isForma = Boolean(resolved.selection.template)
  const bootstrap = recipe.styling === 'styling.bootstrap'
  const viteScss = recipe.styling === 'styling.scss'
    && (recipe.frontend === 'frontend.react-vite' || recipe.frontend === 'frontend.vue-vite')
  const viteTailwind = recipe.styling === 'styling.tailwind'
    && (recipe.frontend === 'frontend.react-vite' || recipe.frontend === 'frontend.vue-vite')
  const isNuxt = recipe.frontend === 'frontend.nuxt'
  const isAngular = recipe.frontend === 'frontend.angular'
  const pinnedDependencies = recipe.dependencies?.map(({ packageName, version }) => `${packageName}@${version}`).join(', ')
  const scaffoldOutput = isForma ? `<Forma template ${resolved.selection.template!.templateId} files>`
    : isNuxt ? '<pinned official Nuxt starter files>'
      : isAngular ? '<pinned Angular CLI workspace files>' : '<pinned official framework scaffold files>'
  const validationSummary = isForma
    ? 'Run template typecheck, production build, and HTTP smoke; lint is unavailable in the pinned Forma installer.'
    : isNuxt ? 'Run Nuxt typecheck with pinned TypeScript/vue-tsc, production build, and HTTP preview smoke; the official starter has no lint or unit-test script.'
      : isAngular ? 'Run Angular production build, unit tests, and HTTP server smoke; the official scaffold has no lint script.'
        : 'Run lint/typecheck/build and HTTP served-page smoke checks.'
  const scaffoldSummary = isForma
    ? `Fetch Forma at ${resolved.selection.template!.commitSha}, verify its package, and install ${resolved.selection.template!.templateId} with the existing Forma exporter/installer.`
    : `Install and run integrity-pinned ${recipe.scaffold.packageName}@${recipe.scaffold.version}${recipe.scaffold.source ? ` with ${recipe.scaffold.source.repository}@${recipe.scaffold.source.commitSha}` : ''} using fixed arguments.`
  return {
    schemaVersion: 1,
    recipeId: recipe.id,
    recipeStatus: recipe.status,
    targetPath: resolved.outputPath,
    steps: [
      { id: 'preflight', ownerAdapterId: 'core', phase: 'preflight', action: 'inspect', readableSummary: `Check Node.js, npm bootstrap, pinned ${recipe.manager}${recipe.manager === 'npm' ? '' : ` ${manager.version}`}, and destination safety.`, sideEffects: [] },
      { id: 'staging', ownerAdapterId: 'core', phase: 'stage', action: 'create-owned-stage', readableSummary: 'Create generator-owned staging beside the destination.', sideEffects: ['Create temporary directory in destination parent.'] },
      { id: 'scaffold', ownerAdapterId: isForma ? 'template.forma' : recipe.frontend, phase: 'scaffold', action: 'run-pinned-cli', readableSummary: scaffoldSummary, sideEffects: isForma
        ? ['Authenticated read-only fetch from the pinned private Forma repository when cache misses.', 'Export and verify the SHA-256 package manifest.', 'Install reviewed template files into owned staging.']
        : [
          'Download pinned official scaffold package.',
          ...(recipe.scaffold.source ? [`Download the immutable ${recipe.scaffold.source.repository} starter commit.`] : []),
          'Run reviewed scaffold code.',
        ], consentKind: 'network' },
      { id: 'configure', ownerAdapterId: 'documentation', phase: 'configure', action: 'write-declared-files', readableSummary: `Configure ${bootstrap ? `pinned Bootstrap ${pinnedDependencies?.replace(/^bootstrap@/, '')} CSS only` : viteScss ? `Dart Sass ${pinnedDependencies?.replace(/^sass@/, '')} with an imported SCSS starter` : viteTailwind ? `Tailwind CSS 4.3.5 with its official Vite plugin, automatic source detection, and utility-class starter` : 'selected framework styling'}${pinnedDependencies && !bootstrap && !viteScss && !viteTailwind ? ` and pinned dependencies ${pinnedDependencies}` : ''} and write truthful ${resolved.selection.documentation} documentation.`, sideEffects: ['Write declared files under staged project.'] },
      { id: 'install', ownerAdapterId: recipe.manager, phase: 'install', action: 'install-dependencies', readableSummary: `Install project dependencies with ${recipe.manager}${recipe.manager === 'npm' ? '' : ` ${manager.version}`}${manager.nodeLinker ? ` using the ${manager.nodeLinker} node_modules linker` : ''}${bootstrap ? ' using legacy peer handling to omit unused Bootstrap Popper' : isAngular ? ' using legacy peer handling for the Angular 21 dependency tree' : ''} and write ${manager.lockfile}.`, sideEffects: ['Download project dependencies.', ...(manager.configFile ? [`Write ${manager.configFile} to keep the selected ${manager.nodeLinker} linker for future installs.`] : []), `Run ${recipe.manager} package lifecycle scripts only after explicit consent.`], consentKind: 'network' },
      { id: 'validate', ownerAdapterId: recipe.frontend, phase: 'validate', action: 'run-check', readableSummary: validationSummary, sideEffects: ['Execute generated framework tools in staging.', 'Write reproducibility manifest with observed check outcomes.'] },
      { id: 'finalize', ownerAdapterId: 'core', phase: 'finalize', action: 'commit-no-replace', readableSummary: 'Move validated project to destination only if destination remains absent.', sideEffects: ['Create final destination with Windows fail-if-exists rename.'] },
    ],
    expectedWrites: [scaffoldOutput,
      ...(bootstrap ? ['package.json', 'index.html', 'src/project-generator-bootstrap.css', '.npmrc'] : []),
      ...(viteScss ? ['package.json', recipe.frontend === 'frontend.react-vite' ? 'src/main.tsx' : 'src/main.ts', recipe.frontend === 'frontend.react-vite' ? 'src/App.tsx' : 'src/App.vue', 'src/project-generator.scss'] : []),
      ...(viteTailwind ? ['package.json', 'vite.config.ts', recipe.frontend === 'frontend.react-vite' ? 'src/main.tsx' : 'src/main.ts', recipe.frontend === 'frontend.react-vite' ? 'src/App.tsx' : 'src/App.vue', 'src/project-generator-tailwind.css'] : []),
      ...(isForma ? ['FORMA-INSTALL.md', 'forma.install.json', 'forma-install-report.json', 'INSTALL.md'] : []),
       ...expectedDocumentationFiles(resolved.selection.documentation), ...(manager.configFile ? [manager.configFile] : []), manager.lockfile, '.project-generator/manifest.json'],
    networkAccess: [
      ...(isForma ? ['https://github.com (authenticated private Forma source; pinned commit)'] : []),
      ...(recipe.scaffold.source ? ['https://api.github.com', 'https://codeload.github.com'] : []),
      'https://registry.npmjs.org/',
    ],
    executesDependencyLifecycleScripts: true,
    executionAvailable: recipe.status === 'tested',
    warnings: [
      'Recipe remains planned until independent Windows evidence and review promote its status.',
      `${recipe.manager} package lifecycle scripts may execute third-party code after consent; generation is not sandboxed.`,
      'Generation installs dependencies from npm and needs network access unless package caches are available.',
      ...(isForma ? ['Forma source is read through the configured Git credential helper; no token is stored or copied to the project.', 'Forma templates own their styling; source integrity is verified but does not constitute a publisher signature.'] : []),
    ],
    ...(resolved.selection.template ? { template: { ...resolved.selection.template } } : {}),
  }
}
