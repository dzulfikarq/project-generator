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
  const isGin = recipe.id === 'BE-04'
  const isNestPostgres = recipe.id === 'BE-09'
  const isNest = recipe.id === 'BE-03' || isNestPostgres
  const isLaravel = recipe.id === 'BE-05'
  const isPython = recipe.id === 'BE-06'
  const isDatabaseBackend = recipe.id === 'BE-07'
  const isPostgresBackend = recipe.id === 'BE-08'
  const bootstrap = recipe.styling === 'styling.bootstrap'
  const viteScss = recipe.styling === 'styling.scss'
    && (recipe.frontend === 'frontend.react-vite' || recipe.frontend === 'frontend.vue-vite')
  const viteTailwind = recipe.styling === 'styling.tailwind'
    && (recipe.frontend === 'frontend.react-vite' || recipe.frontend === 'frontend.vue-vite')
  const isNuxt = recipe.frontend === 'frontend.nuxt'
  const isAngular = recipe.frontend === 'frontend.angular'
  const pinnedDependencies = recipe.dependencies?.map(({ packageName, version }) => `${packageName}@${version}`).join(', ')
  const scaffoldOutput = isNestPostgres ? 'Official Nest CLI scaffold plus reviewed NestJS + PostgreSQL + Drizzle modules'
    : isPostgresBackend ? 'Reviewed BE-08 Express + PostgreSQL + Drizzle starter files'
    : isDatabaseBackend ? 'Reviewed BE-07 Express + SQLite + Drizzle starter files'
    : isGin ? 'Reviewed standalone Go + Gin starter and pinned module graph'
    : isForma ? `<Forma template ${resolved.selection.template!.templateId} files>`
    : isNest ? 'Official Nest CLI project files (CommonJS-compatible NodeNext + Jest)'
    : isGo ? 'Reviewed standalone Go REST API starter files'
    : isLaravel ? 'Official Laravel 12 API-only Composer scaffold files'
    : isPython ? 'Reviewed standalone FastAPI starter files'
    : isBackend ? 'Reviewed BE-01 starter files'
      : isNuxt ? '<pinned official Nuxt starter files>'
      : isAngular ? '<pinned Angular CLI workspace files>' : '<pinned official framework scaffold files>'
  const validationSummary = isNestPostgres
    ? 'Verify pinned NestJS and Drizzle dependencies, generate migration SQL without a PostgreSQL connection, run DTO/database safety and Jest API/shutdown tests, typecheck/lint/build, then smoke-test DB-free health while observing zero database connections.'
    : isPostgresBackend
    ? 'Verify npm pins and lock integrity, generate Drizzle SQL without a PostgreSQL connection, run URL/target safety and HTTP tests, typecheck/lint/build, and smoke-test health while observing zero database connections.'
    : isDatabaseBackend
    ? 'Verify npm pins and lock integrity, generate Drizzle migration files without applying them, run ESLint/typecheck/CRUD integration tests against an isolated temporary SQLite database, build the API, and smoke-test HTTP health/info and graceful shutdown.'
    : isGin
    ? 'Verify pinned Go modules and checksums, check transitive Go requirements, run gofmt, go vet, go test, go build, local HTTP smoke for /health and /api/info, and graceful-shutdown tests.'
    : isNest
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
  const scaffoldSummary = isNestPostgres
    ? 'Run pinned Nest CLI 11.0.24, then configure NestJS modules/controllers/DTO validation, lazy pooled PostgreSQL DI, Drizzle schema, and guarded explicit migrations; no database is contacted.'
    : isPostgresBackend
    ? 'Write reviewed Express + PostgreSQL/Drizzle schema, pooled connection, guarded explicit migration wrapper, CRUD API, and tests into owned staging; no database is contacted.'
    : isDatabaseBackend
    ? 'Write reviewed Express + SQLite schema, Drizzle migration config, local connection helper, example model, and CRUD API into owned staging; migrations are never applied.'
    : isGin
    ? 'Write reviewed standalone Gin API starter and exact Go module pins into owned staging; module downloads require separate affirmative consent.'
    : isNest
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
        { id: 'preflight', ownerAdapterId: 'core', phase: 'preflight', action: 'inspect', readableSummary: isLaravel ? 'Check PHP 8.2+, required Laravel extensions including pdo_mysql, Composer 2.2+, and destination safety; no toolchain is installed.' : isPython ? 'Check Python 3.14, uv 0.8+, and destination safety; automatic runtime downloads are disabled.' : isGin ? 'Check Go 1.25+ and destination safety; planning and Doctor do not download modules.' : isGo ? 'Check Go 1.22+ and destination safety.' : isDatabaseBackend ? 'Check Node.js 22.13+, npm 10+, and destination safety; SQLite is embedded and needs no service.' : isNestPostgres || isPostgresBackend ? 'Check Node.js 22.13+, npm 10+, and destination safety; PostgreSQL is not required for generation.' : `Check Node.js, npm bootstrap, pinned ${recipe.manager}${recipe.manager === 'npm' ? '' : ` ${manager.version}`}, and destination safety.`, sideEffects: [] },
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
         { id: 'configure', ownerAdapterId: 'documentation', phase: 'configure', action: 'write-declared-files', readableSummary: `Configure ${isNestPostgres ? `NestJS modules, validated DTOs, lazy PostgreSQL pool DI, Drizzle CRUD, guarded explicit migration, and pinned dependencies ${pinnedDependencies}` : isNest ? `NestJS REST API, validated environment, JSON errors, graceful shutdown, and pinned dependencies ${pinnedDependencies}` : isLaravel ? 'Laravel API routes, MySQL/Eloquent settings, validated JSON errors, and no automatic DB actions' : isPython ? 'Python FastAPI with Pydantic configuration and pinned dependencies' : isGin ? 'Gin REST API with a pinned Go module graph and graceful shutdown' : isGo ? 'Go net/http REST API with Go Modules and no third-party dependencies' : isPostgresBackend ? `Express REST API, PostgreSQL pool, Drizzle schema, guarded explicit migration, CRUD, and pinned dependencies ${pinnedDependencies}` : isDatabaseBackend ? `Express REST API, SQLite schema/model, Drizzle migration config and explicit migration commands; pinned dependencies ${pinnedDependencies}` : isBackend ? `Express REST API with pinned dependencies ${pinnedDependencies}` : bootstrap ? `pinned Bootstrap ${pinnedDependencies?.replace(/^bootstrap@/, '')} CSS only` : viteScss ? `Dart Sass ${pinnedDependencies?.replace(/^sass@/, '')} with an imported SCSS starter` : viteTailwind ? `Tailwind CSS 4.3.5 with its official Vite plugin, automatic source detection, and utility-class starter` : `selected framework styling${pinnedDependencies ? ` and pinned dependencies ${pinnedDependencies}` : ''}`} and write truthful ${resolved.selection.documentation} documentation.`, sideEffects: ['Write declared files under staged project.'] },
      { id: 'install', ownerAdapterId: recipe.manager, phase: 'install', action: isGo ? 'inspect' : 'install-dependencies', readableSummary: isGin ? 'Download and verify the pinned Gin module graph, then run generated checks offline.' : isLaravel ? 'Resolve Laravel 12 dependencies into composer.lock, then install the locked set with --no-scripts --no-plugins; no database or npm commands run.' : isPython ? 'Resolve exact Python pins into uv.lock, then run uv sync --locked --extra test in the project .venv; Python downloads are disabled.' : isGo ? 'Use Go Modules with standard-library packages only; no download, go.sum, or install script.' : `Install project dependencies with ${recipe.manager}${recipe.manager === 'npm' ? '' : ` ${manager.version}`}${manager.nodeLinker ? ` using the ${manager.nodeLinker} node_modules linker` : ''}${bootstrap ? ' using legacy peer handling to omit unused Bootstrap Popper' : isAngular ? ' using legacy peer handling for the Angular 21 dependency tree' : ''} and write ${manager.lockfile}.`, sideEffects: isGin ? ['Download pinned Go modules from proxy.golang.org and verify go.sum through sum.golang.org.', 'No lifecycle scripts or unpinned dependency upgrades run.'] : isGo ? ['No third-party dependency installation or network access.'] : isLaravel ? ['Download PHP packages from Packagist/GitHub and create composer.lock/vendor under owned staging.', 'Composer plugins and all root scripts are disabled for both update and install.', 'Artisan/PHPUnit checks load Composer packages under the current user; this is not a sandbox.'] : isPython ? ['Download packages from PyPI and pythonhosted.org.', 'Create project-local .venv and uv.lock.', 'Execute third-party wheel/build code only after explicit consent.'] : ['Download project dependencies.', ...(manager.configFile ? [`Write ${manager.configFile} to keep the selected ${manager.nodeLinker} linker for later installs.`] : []), `Run ${recipe.manager} package lifecycle scripts only after explicit consent.`], ...(isGo ? {} : { consentKind: 'network' as const }) },
      { id: 'validate', ownerAdapterId: recipe.backend ?? recipe.frontend ?? 'core', phase: 'validate', action: 'run-check', readableSummary: validationSummary, sideEffects: ['Execute generated project checks in staging.', 'Write reproducibility manifest with observed check outcomes.'] },
      { id: 'finalize', ownerAdapterId: 'core', phase: 'finalize', action: 'commit-no-replace', readableSummary: 'Move validated project to destination only if destination remains absent.', sideEffects: ['Create final destination with Windows fail-if-exists rename.'] },
    ],
     expectedWrites: [scaffoldOutput,
          ...(isDatabaseBackend ? ['package.json', 'tsconfig.json', 'eslint.config.mjs', 'drizzle.config.ts', '.gitignore', '.env.example', 'docs/DATABASE-SAFETY.md', 'src/config.ts', 'src/app.ts', 'src/server.ts', 'src/db/schema.ts', 'src/db/path.ts', 'src/db/client.ts', 'src/db/migrate.ts', 'src/db/notes.ts', 'src/routes/notes.ts', 'native/pg-db-path-verifier.exe', 'test/backend.test.ts', 'test/database.test.ts', 'test/shutdown.test.ts', 'drizzle/*.sql', 'drizzle/meta/_journal.json', 'drizzle/meta/*_snapshot.json'] : []),
          ...(isPostgresBackend ? ['package.json', 'tsconfig.json', 'eslint.config.mjs', 'drizzle.config.ts', '.gitignore', '.env.example', 'docs/DATABASE-SAFETY.md', 'src/config.ts', 'src/app.ts', 'src/server.ts', 'src/db/schema.ts', 'src/db/target.ts', 'src/db/client.ts', 'src/db/items.ts', 'src/db/migrate.ts', 'src/routes/items.ts', 'test/backend.test.ts', 'test/database.test.ts', 'test/shutdown.test.ts', 'drizzle/*.sql', 'drizzle/meta/_journal.json', 'drizzle/meta/*_snapshot.json'] : []),
       ...(isNest ? ['.prettierrc', 'eslint.config.mjs', 'nest-cli.json', 'package.json', 'tsconfig.json', 'tsconfig.build.json', 'src/app.module.ts', 'src/app.controller.ts', 'src/app.service.ts', 'src/main.ts', 'src/config.ts', 'src/api-exception.filter.ts', 'src/app.controller.spec.ts', 'test/jest-e2e.json', 'test/app.e2e-spec.ts', 'test/shutdown.e2e-spec.ts'] : []),
       ...(isNestPostgres ? ['.env.example', '.gitignore', 'drizzle.config.ts', 'docs/DATABASE-SAFETY.md', 'src/db/schema.ts', 'src/db/target.ts', 'src/db/migrate.ts', 'src/database/database.module.ts', 'src/database/database.service.ts', 'src/items/items.module.ts', 'src/items/items.controller.ts', 'src/items/items.service.ts', 'src/items/dto/create-item.dto.ts', 'src/items/dto/update-item.dto.ts', 'test/postgres.integration.e2e-spec.ts', 'drizzle/*.sql', 'drizzle/meta/_journal.json', 'drizzle/meta/*_snapshot.json'] : []),
         ...(isGin ? ['go.mod', 'go.sum', '.gitignore', 'cmd/server/main.go', 'internal/server/server.go', 'internal/server/server_test.go'] : isGo ? ['go.mod', '.gitignore', '.env.example', 'cmd/server/main.go', 'internal/handlers/health.go', 'internal/handlers/info.go', 'internal/server/server.go', 'internal/server/server_test.go'] : isLaravel ? ['composer.json', 'artisan', '.gitignore', '.env.example', 'bootstrap/app.php', 'config/database.php', 'config/filesystems.php', 'routes/api.php', 'app/Models/ProjectNote.php', 'database/migrations/*_create_project_notes_table.php', 'tests/Feature/ApiTest.php', 'phpunit.xml'] : isPython ? ['app/__init__.py', 'app/__main__.py', 'app/main.py', 'app/api/__init__.py', 'app/api/routes/__init__.py', 'app/api/routes/health.py', 'app/core/__init__.py', 'app/core/config.py', 'tests/test_health.py', 'tests/test_info.py', 'tests/test_shutdown.py', 'pyproject.toml', '.python-version', '.env.example', '.gitignore'] : isBackend && !isNest && !isDatabaseBackend && !isPostgresBackend ? ['package.json', 'tsconfig.json', '.gitignore', '.env.example', 'src/config.ts', 'src/app.ts', 'src/server.ts', 'test/backend.test.ts', 'test/shutdown.test.ts'] : []),
      ...(bootstrap ? ['package.json', 'index.html', 'src/project-generator-bootstrap.css', '.npmrc'] : []),
      ...(viteScss ? ['package.json', recipe.frontend === 'frontend.react-vite' ? 'src/main.tsx' : 'src/main.ts', recipe.frontend === 'frontend.react-vite' ? 'src/App.tsx' : 'src/App.vue', 'src/project-generator.scss'] : []),
      ...(viteTailwind ? ['package.json', 'vite.config.ts', recipe.frontend === 'frontend.react-vite' ? 'src/main.tsx' : 'src/main.ts', recipe.frontend === 'frontend.react-vite' ? 'src/App.tsx' : 'src/App.vue', 'src/project-generator-tailwind.css'] : []),
      ...(isForma ? ['FORMA-INSTALL.md', 'forma.install.json', 'forma-install-report.json', 'INSTALL.md'] : []),
      ...expectedDocumentationFiles(resolved.selection.documentation), ...(manager.configFile ? [manager.configFile] : []), ...(manager.lockfile ? [manager.lockfile] : []), '.project-generator/manifest.json'],
    networkAccess: [
      ...(isForma ? ['https://github.com (authenticated private Forma source; pinned commit)'] : []),
      ...(isLaravel ? ['https://repo.packagist.org/', 'https://api.github.com/', 'https://codeload.github.com/'] : []),
      ...(isGin ? ['https://proxy.golang.org/', 'https://sum.golang.org/ (Go checksum database)'] : []),
      ...(!isBackend && recipe.scaffold?.source ? ['https://api.github.com', 'https://codeload.github.com'] : []),
      ...(isLaravel ? [] : isPython ? ['https://pypi.org/', 'https://files.pythonhosted.org/'] : !isGo && !isGin ? ['https://registry.npmjs.org/'] : []),
    ],
    executesDependencyLifecycleScripts: !isGo && !isGin && !isLaravel,
    requiresDependencyConsent: !isGo && !isGin,
    requiresNetworkConsent: isGin,
    executionAvailable: recipe.status === 'tested',
    warnings: [
      'Recipe remains planned until independent Windows evidence and review promote its status.',
      ...(isDatabaseBackend ? ['Windows DB path checks use the project-local first-party Rust verifier via native handles. Replacing the verifier or generated project files is outside its trust boundary.'] : []),
      ...(isNestPostgres ? ['Generation installs pinned dependencies and generates migration SQL without PostgreSQL access; Nest startup and /health do not create a pool or connect. The first CRUD request validates DATABASE_URL and lazily creates one pooled Nest DI service.', 'PostgreSQL 16+ is user-provided and needed only for CRUD or explicit migration. Database request failures return generic HTTP 503 responses; DTO validation rejects unknown and malformed fields.', 'Migration is exposed through npm run db:migrate -- --target host:port/database. The wrapper strictly parses DATABASE_URL, matches host/port/database, checks active server identity with a read-only query, then migrates using the checked connection. Confirmation cannot prevent operator error or hostile/DNS-changing endpoints.', 'Do not invoke drizzle-kit migrate directly; manual invocation of installed tools remains outside wrapper enforcement. npm lifecycle/build code runs unsandboxed after explicit consent.'] : isPostgresBackend ? ['Generation installs dependencies and generates migration SQL without PostgreSQL access; startup validates DATABASE_URL syntax but does not connect, and /health is process-only.', 'A user-provided PostgreSQL 16+ service is needed only for CRUD or explicit migration. Database request failures return generic HTTP 503 responses.', 'Migration is exposed through npm run db:migrate -- --target host:port/database. The wrapper strictly parses DATABASE_URL, matches host/port/database, checks active server identity with a read-only query, then migrates using the checked connection. Confirmation cannot prevent operator error or hostile/DNS-changing endpoints.', 'Do not invoke drizzle-kit migrate directly; manual invocation of installed tools remains outside wrapper enforcement. npm lifecycle/build code runs unsandboxed after explicit consent.'] : []),
      ...(isDatabaseBackend ? ['Generation creates schema and migration files but never applies migrations or opens the application database; it does not create the configured data directory.', 'Server startup and health routes do not open SQLite. A database file is opened lazily on the first CRUD operation; startup never migrates.', 'DB_FILE must be a project-relative path. Node rejects existing symlink/junction components, and native verification rejects reparse-point components it observes; TOCTOU remains before SQLite opens the path.', 'Run npm run db:migrate explicitly after reviewing DB_FILE and generated SQL. CRUD integration tests migrate only isolated temporary SQLite databases. Native addon and npm lifecycle/build code run unsandboxed after consent.'] : isLaravel ? ['Composer root scripts and plugins are disabled; downloaded PHP packages are still loaded by Artisan/PHPUnit checks without sandboxing.', 'Generation does not create a .env file, provision a MySQL database, run migrations, or invoke npm/Vite.', 'MySQL/Eloquent connectivity is not validated during generation; configure a database only after reviewing the generated example and migration.'] : isPython ? ['Python dependency pins are provisional until Python 3.14 Windows lock/sync and HTTP acceptance pass.', 'uv installs may execute third-party package build code after consent; execution is not sandboxed.', 'Generation does not start the API after creating the project.'] : isGin ? ['Go Modules download needs separate affirmative network consent; planning and Doctor stay read-only.', 'Only pinned modules download; Go toolchain auto-download is disabled and generated checks run offline afterward.'] : !isGo ? [`${recipe.manager} package lifecycle scripts may execute third-party code after consent; generation is not sandboxed.`, 'Generation installs dependencies from npm and needs network access unless package caches are available.'] : ['Generated API uses Go standard library only; generation runs no dependency installation and requests no network access.']),
      ...(isForma ? ['Forma source is read through the configured Git credential helper; no token is stored or copied to the project.', 'Forma templates own their styling; source integrity is verified but does not constitute a publisher signature.'] : []),
    ],
    ...(resolved.selection.template ? { template: { ...resolved.selection.template } } : {}),
  }
}
