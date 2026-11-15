import { resolveSelection } from './resolver.js'
import { packageManager } from './catalog.js'
import { expectedDocumentationFiles } from './project-docs.js'
import type { GenerationPlan, ProjectSelectionV1 } from './types.js'

export function createPlan(selection: ProjectSelectionV1): GenerationPlan {
  const resolved = resolveSelection(selection)
  const recipe = resolved.recipe
  const manager = packageManager(recipe.manager)
  const isForma = Boolean(resolved.selection.template)
  const isBackend = recipe.projectType === 'backend'
  const isGo = recipe.id === 'BE-02'
  const isNest = recipe.id === 'BE-03'
  const isLaravel = recipe.id === 'BE-05'
  const isPython = recipe.id === 'BE-06'
  const bootstrap = recipe.styling === 'styling.bootstrap'
  const viteScss = recipe.styling === 'styling.scss'
    && (recipe.frontend === 'frontend.react-vite' || recipe.frontend === 'frontend.vue-vite')
  const viteTailwind = recipe.styling === 'styling.tailwind'
    && (recipe.frontend === 'frontend.react-vite' || recipe.frontend === 'frontend.vue-vite')
  const isNuxt = recipe.frontend === 'frontend.nuxt'
  const isAngular = recipe.frontend === 'frontend.angular'
  const pinnedDependencies = recipe.dependencies?.map(({ packageName, version }) => `${packageName}@${version}`).join(', ')
  const scaffoldOutput = isForma ? `<Forma template ${resolved.selection.template!.templateId} files>`
    : isNest ? 'Official Nest CLI project files (CommonJS-compatible NodeNext + Jest)'
    : isGo ? 'Reviewed standalone Go REST API starter files'
    : isLaravel ? 'Official Laravel 12 API-only Composer scaffold files'
    : isPython ? 'Reviewed standalone FastAPI starter files'
    : isBackend ? 'Reviewed BE-01 starter files'
      : isNuxt ? '<pinned official Nuxt starter files>'
      : isAngular ? '<pinned Angular CLI workspace files>' : '<pinned official framework scaffold files>'
  const validationSummary = isNest
    ? 'Run Nest TypeScript typecheck, ESLint, Jest unit/e2e tests, production build, HTTP smoke for /health and /api/info, and Nest application shutdown checks.'
    : isLaravel
    ? 'Validate Composer lock/install without scripts or plugins, list Artisan routes, run PHPUnit, and smoke-test /health and /api/info. MySQL integration is not attempted without an approved isolated test database.'
    : isPython
    ? 'Verify uv.lock and locked sync, compile Python sources, run pytest, then smoke-test /health, /api/info, /docs, OpenAPI, and graceful shutdown.'
    : isGo
    ? 'Validate Go Modules, run go fmt, go vet, go test, go build, HTTP smoke for /health and /api/info, and graceful-shutdown tests.'
    : isBackend
    ? 'Run TypeScript typecheck, Node unit/integration tests, production build, HTTP smoke for /health and /api/info, and graceful-shutdown checks.'
    : isForma
    ? 'Run template typecheck, production build, and HTTP smoke; lint is unavailable in the pinned Forma installer.'
    : isNuxt ? 'Run Nuxt typecheck with pinned TypeScript/vue-tsc, production build, and HTTP preview smoke; the official starter has no lint or unit-test script.'
      : isAngular ? 'Run Angular production build, unit tests, and HTTP server smoke; the official scaffold has no lint script.'
        : 'Run lint/typecheck/build and HTTP served-page smoke checks.'
  const scaffoldSummary = isNest
    ? 'Run integrity-pinned Nest CLI 11.0.24 with --skip-install, --skip-git, --strict, and npm; retain its CommonJS-compatible NodeNext/Jest scaffold and no Observe integration.'
    : isLaravel
    ? 'Fetch laravel/laravel 12.12.2 with Composer scripts/plugins disabled; retain only API/backend files and pin Laravel framework 12.72.0.'
    : isPython
    ? 'Write the reviewed FastAPI/Pydantic starter into owned staging; dependency resolution runs during install only after explicit consent.'
    : isGo
    ? 'Write a standard-library net/http REST API and Go Modules manifest into owned staging; no external dependencies.'
    : isBackend
    ? 'Write the reviewed TypeScript Express starter into owned staging; install only integrity-pinned npm dependencies.'
    : isForma
    ? `Fetch Forma at ${resolved.selection.template!.commitSha}, verify its package, and install ${resolved.selection.template!.templateId} with the existing Forma exporter/installer.`
    : `Install and run integrity-pinned ${recipe.scaffold!.packageName}@${recipe.scaffold!.version}${recipe.scaffold!.source ? ` with ${recipe.scaffold!.source.repository}@${recipe.scaffold!.source.commitSha}` : ''} using fixed arguments.`
  return {
    schemaVersion: 1,
    recipeId: recipe.id,
    recipeStatus: recipe.status,
    targetPath: resolved.outputPath,
    steps: [
      { id: 'preflight', ownerAdapterId: 'core', phase: 'preflight', action: 'inspect', readableSummary: isLaravel ? 'Check PHP 8.2+, required Laravel extensions including pdo_mysql, Composer 2.2+, and destination safety; no toolchain is installed.' : isPython ? 'Check Python 3.14, uv 0.8+, and destination safety; automatic runtime downloads are disabled.' : isGo ? 'Check Go 1.22+ and destination safety.' : `Check Node.js, npm bootstrap, pinned ${recipe.manager}${recipe.manager === 'npm' ? '' : ` ${manager.version}`}, and destination safety.`, sideEffects: [] },
      { id: 'staging', ownerAdapterId: 'core', phase: 'stage', action: 'create-owned-stage', readableSummary: 'Create generator-owned staging beside the destination.', sideEffects: ['Create temporary directory in destination parent.'] },
      { id: 'scaffold', ownerAdapterId: isForma ? 'template.forma' : recipe.backend ?? recipe.frontend ?? 'core', phase: 'scaffold', action: isBackend && !isLaravel && !isNest ? 'write-declared-files' : 'run-pinned-cli', readableSummary: scaffoldSummary, sideEffects: isForma
         ? ['Authenticated read-only fetch from the pinned private Forma repository when cache misses.', 'Export and verify the SHA-256 package manifest.', 'Install reviewed template files into owned staging.']
         : isNest ? ['Download the exact Nest CLI package into generator-owned staging and verify npm integrity.', 'Run the CLI in owned staging with dependency installation and Git initialization disabled.', 'No Observe prompt, module, or integration is generated by the selected CLI version.']
         : isLaravel ? ['Download the exact official Laravel skeleton release into generator-owned staging.', 'Run Composer with --no-scripts --no-plugins --no-install; no post-create scripts, database setup, migrations, or npm/Vite commands run.', 'Remove default frontend/auth/database scaffolding and write the reviewed API/Eloquent files.']
          : isBackend ? ['Write reviewed starter files under owned staging.']
          : [
            'Download pinned official scaffold package.',
            ...(recipe.scaffold?.source ? [`Download the immutable ${recipe.scaffold.source.repository} starter commit.`] : []),
            'Run reviewed scaffold code.',
          ], ...(isBackend && !isLaravel && !isNest ? {} : { consentKind: 'network' as const }) },
      { id: 'configure', ownerAdapterId: 'documentation', phase: 'configure', action: 'write-declared-files', readableSummary: `Configure ${isNest ? `NestJS REST API, validated environment, JSON errors, graceful shutdown, and pinned dependencies ${pinnedDependencies}` : isLaravel ? 'Laravel API routes, MySQL/Eloquent settings, validated JSON errors, and no automatic DB actions' : isPython ? 'Python FastAPI with Pydantic configuration and pinned dependencies' : isGo ? 'Go net/http REST API with Go Modules and no third-party dependencies' : isBackend ? `Express REST API with pinned dependencies ${pinnedDependencies}` : bootstrap ? `pinned Bootstrap ${pinnedDependencies?.replace(/^bootstrap@/, '')} CSS only` : viteScss ? `Dart Sass ${pinnedDependencies?.replace(/^sass@/, '')} with an imported SCSS starter` : viteTailwind ? `Tailwind CSS 4.3.5 with its official Vite plugin, automatic source detection, and utility-class starter` : `selected framework styling${pinnedDependencies ? ` and pinned dependencies ${pinnedDependencies}` : ''}`} and write truthful ${resolved.selection.documentation} documentation.`, sideEffects: ['Write declared files under staged project.'] },
      { id: 'install', ownerAdapterId: recipe.manager, phase: 'install', action: isGo ? 'inspect' : 'install-dependencies', readableSummary: isLaravel ? 'Resolve Laravel 12 dependencies into composer.lock, then install the locked set with --no-scripts --no-plugins; no database or npm commands run.' : isPython ? 'Resolve exact Python pins into uv.lock, then run uv sync --locked --extra test in the project .venv; Python downloads are disabled.' : isGo ? 'Use Go Modules with standard-library packages only; no download, go.sum, or install script.' : `Install project dependencies with ${recipe.manager}${recipe.manager === 'npm' ? '' : ` ${manager.version}`}${manager.nodeLinker ? ` using the ${manager.nodeLinker} node_modules linker` : ''}${bootstrap ? ' using legacy peer handling to omit unused Bootstrap Popper' : isAngular ? ' using legacy peer handling for the Angular 21 dependency tree' : ''} and write ${manager.lockfile}.`, sideEffects: isGo ? ['No third-party dependency installation or network access.'] : isLaravel ? ['Download PHP packages from Packagist/GitHub and create composer.lock/vendor under owned staging.', 'Composer plugins and all root scripts are disabled for both update and install.', 'Artisan/PHPUnit checks load Composer packages under the current user; this is not a sandbox.'] : isPython ? ['Download packages from PyPI and pythonhosted.org.', 'Create project-local .venv and uv.lock.', 'Execute third-party wheel/build code only after explicit consent.'] : ['Download project dependencies.', ...(manager.configFile ? [`Write ${manager.configFile} to keep the selected ${manager.nodeLinker} linker for later installs.`] : []), `Run ${recipe.manager} package lifecycle scripts only after explicit consent.`], ...(isGo ? {} : { consentKind: 'network' as const }) },
      { id: 'validate', ownerAdapterId: recipe.backend ?? recipe.frontend ?? 'core', phase: 'validate', action: 'run-check', readableSummary: validationSummary, sideEffects: ['Execute generated project checks in staging.', 'Write reproducibility manifest with observed check outcomes.'] },
      { id: 'finalize', ownerAdapterId: 'core', phase: 'finalize', action: 'commit-no-replace', readableSummary: 'Move validated project to destination only if destination remains absent.', sideEffects: ['Create final destination with Windows fail-if-exists rename.'] },
    ],
    expectedWrites: [scaffoldOutput,
      ...(isNest ? ['.prettierrc', 'eslint.config.mjs', 'nest-cli.json', 'package.json', 'tsconfig.json', 'tsconfig.build.json', 'src/app.module.ts', 'src/app.controller.ts', 'src/app.service.ts', 'src/main.ts', 'src/config.ts', 'src/api-exception.filter.ts', 'src/app.controller.spec.ts', 'test/jest-e2e.json', 'test/app.e2e-spec.ts', 'test/shutdown.e2e-spec.ts'] : []),
      ...(isGo ? ['go.mod', '.gitignore', '.env.example', 'cmd/server/main.go', 'internal/handlers/health.go', 'internal/handlers/info.go', 'internal/server/server.go', 'internal/server/server_test.go'] : isLaravel ? ['composer.json', 'artisan', '.gitignore', '.env.example', 'bootstrap/app.php', 'config/database.php', 'config/filesystems.php', 'routes/api.php', 'app/Models/ProjectNote.php', 'database/migrations/*_create_project_notes_table.php', 'tests/Feature/ApiTest.php', 'phpunit.xml'] : isPython ? ['app/__init__.py', 'app/__main__.py', 'app/main.py', 'app/api/__init__.py', 'app/api/routes/__init__.py', 'app/api/routes/health.py', 'app/api/routes/info.py', 'app/core/__init__.py', 'app/core/config.py', 'tests/test_health.py', 'tests/test_info.py', 'tests/test_shutdown.py', 'pyproject.toml', '.python-version', '.env.example', '.gitignore'] : isBackend && !isNest ? ['package.json', 'tsconfig.json', '.gitignore', '.env.example', 'src/config.ts', 'src/app.ts', 'src/server.ts', 'test/backend.test.ts', 'test/shutdown.test.ts'] : []),
      ...(bootstrap ? ['package.json', 'index.html', 'src/project-generator-bootstrap.css', '.npmrc'] : []),
      ...(viteScss ? ['package.json', recipe.frontend === 'frontend.react-vite' ? 'src/main.tsx' : 'src/main.ts', recipe.frontend === 'frontend.react-vite' ? 'src/App.tsx' : 'src/App.vue', 'src/project-generator.scss'] : []),
      ...(viteTailwind ? ['package.json', 'vite.config.ts', recipe.frontend === 'frontend.react-vite' ? 'src/main.tsx' : 'src/main.ts', recipe.frontend === 'frontend.react-vite' ? 'src/App.tsx' : 'src/App.vue', 'src/project-generator-tailwind.css'] : []),
      ...(isForma ? ['FORMA-INSTALL.md', 'forma.install.json', 'forma-install-report.json', 'INSTALL.md'] : []),
      ...expectedDocumentationFiles(resolved.selection.documentation), ...(manager.configFile ? [manager.configFile] : []), ...(manager.lockfile ? [manager.lockfile] : []), '.project-generator/manifest.json'],
    networkAccess: [
      ...(isForma ? ['https://github.com (authenticated private Forma source; pinned commit)'] : []),
      ...(isLaravel ? ['https://repo.packagist.org/', 'https://api.github.com/', 'https://codeload.github.com/'] : []),
      ...(!isBackend && recipe.scaffold?.source ? ['https://api.github.com', 'https://codeload.github.com'] : []),
      ...(isLaravel ? [] : isPython ? ['https://pypi.org/', 'https://files.pythonhosted.org/'] : !isGo ? ['https://registry.npmjs.org/'] : []),
    ],
    executesDependencyLifecycleScripts: !isGo && !isLaravel,
    requiresDependencyConsent: !isGo,
    executionAvailable: recipe.status === 'tested',
    warnings: [
      'Recipe remains planned until independent Windows evidence and review promote its status.',
      ...(isLaravel ? ['Composer root scripts and plugins are disabled; downloaded PHP packages are still loaded by Artisan/PHPUnit checks without sandboxing.', 'Generation does not create a .env file, provision a MySQL database, run migrations, or invoke npm/Vite.', 'MySQL/Eloquent connectivity is not validated during generation; configure a database only after reviewing the generated example and migration.'] : isPython ? ['Python dependency pins are provisional until Python 3.14 Windows lock/sync and HTTP acceptance pass.', 'uv installs may execute third-party package build code after consent; execution is not sandboxed.', 'Generation does not start the API after creating the project.'] : !isGo ? [`${recipe.manager} package lifecycle scripts may execute third-party code after consent; generation is not sandboxed.`, 'Generation installs dependencies from npm and needs network access unless package caches are available.'] : ['Generated API uses Go standard library only; generation runs no dependency installation and requests no network access.']),
      ...(isForma ? ['Forma source is read through the configured Git credential helper; no token is stored or copied to the project.', 'Forma templates own their styling; source integrity is verified but does not constitute a publisher signature.'] : []),
    ],
    ...(resolved.selection.template ? { template: { ...resolved.selection.template } } : {}),
  }
}
