import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { win32 } from 'node:path'
import { packageManager } from './catalog.js'
import { mutateOwnedStage, type OwnedStage } from './staging.js'
import type { FormaInstallEvidence } from './forma.js'
import type { NpmTool } from './toolchain.js'
import { postgresProjectDocs } from './postgres-project-docs.js'
import type { ResolvedSelection, ValidationOutcome } from './types.js'

const lockfiles = ['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb']

function managerCommands(managerId: ResolvedSelection['recipe']['manager']) {
  return {
    name: managerId,
    install: `${managerId} install`,
    run: (script: string) => managerId === 'npm' ? `npm run ${script}` : `${managerId} ${script}`,
  }
}

export function expectedDocumentationFiles(mode: ResolvedSelection['selection']['documentation']): string[] {
  const minimal = ['README.md', 'docs/SETUP.md']
  if (mode === 'minimal') return minimal
  const standard = [...minimal, 'AGENTS.md', 'docs/ARCHITECTURE.md', 'docs/TESTING.md']
  if (mode === 'standard') return standard
  return [...standard, 'CLAUDE.md', 'agent.md', 'decision.md', 'design.md', 'docs/PRD.md', 'docs/decisions/index.md', 'docs/qa/acceptance-matrix.md']
}

function recipeText(resolved: ResolvedSelection): { title: string; scaffold: string; nodeRange: string; devCommand: string; smokeCommand: string } {
  const commands = managerCommands(resolved.recipe.manager)
  if (resolved.recipe.projectType === 'backend' && resolved.recipe.id === 'BE-07') return {
    title: 'Node.js + TypeScript + Express + SQLite + Drizzle ORM',
    scaffold: 'Reviewed BE-07 Express + SQLite + Drizzle starter',
    nodeRange: 'Node.js 22.13+',
    devCommand: commands.run('dev'),
    smokeCommand: commands.run('start'),
  }
  if (resolved.recipe.projectType === 'backend' && resolved.recipe.id === 'BE-03') return {
    title: 'Node.js + TypeScript + NestJS REST API',
    scaffold: 'Nest CLI 11.0.24 (official NestJS scaffold; CommonJS-compatible NodeNext + Jest)',
    nodeRange: 'Node.js 22.13+',
    devCommand: commands.run('start:dev'),
    smokeCommand: commands.run('start:prod'),
  }
  if (resolved.recipe.projectType === 'backend') return {
    title: 'Node.js + TypeScript + Express REST API',
    scaffold: 'BE-01 TypeScript starter',
    nodeRange: 'Node.js 22.13+',
    devCommand: commands.run('dev'),
    smokeCommand: commands.run('start'),
  }
  if (resolved.selection.template) {
    const reactVite = resolved.recipe.frontend === 'frontend.react-vite'
    return {
      title: reactVite ? 'React + Vite + TypeScript' : 'Next.js App Router + TypeScript',
      scaffold: `Forma template ${resolved.selection.template.templateId} at ${resolved.selection.template.commitSha}`,
      nodeRange: reactVite ? 'Node.js 20.19+ or 22.12+' : 'Node.js 20.9+',
      devCommand: commands.run('dev'),
      smokeCommand: commands.run('build'),
    }
  }
  if (resolved.recipe.frontend === 'frontend.react-vite') {
    const styleSuffix = resolved.recipe.styling === 'styling.bootstrap' ? ' + Bootstrap 5 CSS'
      : resolved.recipe.styling === 'styling.scss' ? ' + SCSS'
        : resolved.recipe.styling === 'styling.tailwind' ? ' + Tailwind CSS' : ''
    return {
      title: `React + Vite + TypeScript${styleSuffix}`,
      scaffold: 'create-vite 9.3.4 (`react-ts` template)',
      nodeRange: 'Node.js 20.19+ or 22.12+',
      devCommand: commands.run('dev'),
      smokeCommand: commands.run('preview'),
    }
  }
  if (resolved.recipe.frontend === 'frontend.nuxt') {
    return {
      title: 'Nuxt 4 + TypeScript',
      scaffold: `create-nuxt 4.0.3 with nuxt/starter@${resolved.recipe.scaffold!.source!.commitSha} (Nuxt 4.6.4)`,
      nodeRange: 'Node.js 22.22.3+, 24.15.0+, or 26+',
      devCommand: commands.run('dev'),
      smokeCommand: commands.run('preview'),
    }
  }
  if (resolved.recipe.frontend === 'frontend.angular') {
    return {
      title: 'Angular 21 + TypeScript + SCSS',
      scaffold: 'Angular CLI 21.2.30 (`ng new --routing --style scss`); Angular core 21.2.26',
      nodeRange: 'Node.js 20.19+, 22.12+, or 24+',
      devCommand: commands.run('start'),
      smokeCommand: 'ng serve',
    }
  }
  if (resolved.recipe.frontend === 'frontend.vue-vite') {
    const styleSuffix = resolved.recipe.styling === 'styling.bootstrap' ? ' + Bootstrap 5 CSS'
      : resolved.recipe.styling === 'styling.scss' ? ' + SCSS'
        : resolved.recipe.styling === 'styling.tailwind' ? ' + Tailwind CSS' : ''
    return {
      title: `Vue 3 + Vite + TypeScript${styleSuffix}`,
      scaffold: 'create-vue 3.24.0 (`--typescript --eslint`)',
      nodeRange: 'Node.js 22.18+ or 24.12+',
      devCommand: commands.run('dev'),
      smokeCommand: commands.run('preview'),
    }
  }
  return {
    title: 'Next.js App Router + TypeScript + Tailwind CSS',
    scaffold: 'create-next-app 16.4.6',
    nodeRange: 'Node.js 20.9+',
    devCommand: commands.run('dev'),
    smokeCommand: commands.run('start'),
  }
}

export function fullstackProjectDocs(resolved: ResolvedSelection, nodeVersion: string, npmVersion: string): Map<string, string> {
  const name = resolved.selection.project.name
  const minimal = new Map<string, string>([
    ['README.md', `# ${name}\n\nReact + Vite frontend and Express + PostgreSQL + Drizzle API in one npm workspace (FS-06, planned).\n\n## Run locally\n\n1. Copy \`.env.example\` to \`.env\` and set user-managed PostgreSQL credentials.\n2. Run \`npm run dev\`; Vite serves the web app and proxies \`/api\` and \`/health\` to the API.\n3. Review generated SQL under \`apps/api/drizzle/\`; migrations are never applied automatically.\n\nSee [docs/SETUP.md](docs/SETUP.md) and [docs/DATABASE-SAFETY.md](docs/DATABASE-SAFETY.md). Dependency lifecycle/build code is unsandboxed.\n`],
    ['docs/SETUP.md', `# Setup\n\nGenerated with React, Vite, Express, PostgreSQL, Drizzle ORM, Node.js ${nodeVersion}, npm ${npmVersion}. Node.js 22.13+ and npm 10+ required. PostgreSQL 16+ is user-provided and required only for CRUD and explicit migration.\n\n## Install and run\n\nGeneration installed the pinned npm workspace dependencies and created one root \`package-lock.json\`. To install later:\n\n\`\`\`powershell\nCopy-Item .env.example .env\nnpm install\nnpm run dev\n\`\`\`\n\nSet \`DATABASE_URL\` in the root \`.env\`. The API validates URL syntax at startup but does not connect until a CRUD request. GET \`/health\` is process-only; database-free startup and health do not require a running PostgreSQL service.\n\n## Schema and migration\n\nGenerate SQL only with \`npm run db:generate\`, then review \`apps/api/drizzle/\`. Generation, startup, health, and SQL generation never migrate or provision PostgreSQL. Apply migrations only after explicit target review:\n\n\`\`\`powershell\nnpm run db:migrate -- --target host:port/database\n\`\`\`\n\nRead [DATABASE-SAFETY.md](DATABASE-SAFETY.md) before using migration commands. Direct Drizzle Kit migration remains callable outside the wrapper guard.\n\n## Checks\n\n\`\`\`powershell\nnpm run typecheck\nnpm run lint\nnpm test\nnpm run build\n\`\`\`\n\nThe workspace contains one frontend and one API, not two independently committed projects. npm lifecycle/build scripts are unsandboxed.\n`],
  ])
  if (resolved.selection.documentation === 'minimal') return minimal
  minimal.set('AGENTS.md', '# Agent instructions\n\n- Keep React/Vite under `apps/web` and Express/PostgreSQL/Drizzle under `apps/api`.\n- Keep the single root npm workspace and `package-lock.json`.\n- Never provision, reset, or migrate PostgreSQL automatically. Review SQL and use the guarded explicit migration wrapper.\n- Check `docs/DATABASE-SAFETY.md` before changing connection or migration behavior.\n- FS-06 remains planned; generation does not imply acceptance or release approval.\n')
  minimal.set('docs/ARCHITECTURE.md', '# Architecture\n\nOne npm workspace contains a React/Vite browser application in `apps/web` and an Express API in `apps/api`. Vite proxies same-origin `/api` and `/health` requests to the API; no browser-side database credentials or cross-origin configuration are generated.\n\nThe API uses a lazy `pg` pool and Drizzle schema for item CRUD. Startup validates configuration and creates a pool without opening a database connection. Health and info routes are process-only. Drizzle Kit writes reviewed SQL under `apps/api/drizzle/`; only an explicit guarded migration command applies it.\n\nGeneration and startup never provision PostgreSQL. The frontend and backend share one owned generation transaction, one root manifest, and one root lockfile.\n')
  minimal.set('docs/TESTING.md', '# Testing\n\n- `npm run typecheck` checks both workspace applications.\n- `npm run lint` checks API and frontend source/tests.\n- `npm test` runs API health/database-safety/shutdown tests and frontend API-client tests. Database tests use loopback probes or an optional disposable `PG_E2E_DATABASE_URL`; never point that variable at a shared or production database.\n- `npm run build` builds the API and Vite frontend.\n- Generator smoke serves the built React page, routes `/health` and `/api/info` through the Vite proxy, and asserts zero PostgreSQL probe connections.\n- CRUD integration requires an explicitly isolated PostgreSQL 16+ database and a reviewed migration.\n')
  if (resolved.selection.documentation === 'standard') return minimal
  minimal.set('CLAUDE.md', 'Read AGENTS.md and docs/ before changing this generated project. Do not claim checks passed unless you ran them.\n')
  minimal.set('agent.md', '# Agent notes\n\nInitial generated instructions only. No agent history or approval is asserted.\n')
  minimal.set('decision.md', '# Decision policy\n\nRecord future material decisions in docs/decisions/index.md. Generated baseline is not an approval.\n')
  minimal.set('design.md', '# Design notes\n\nReact/Vite frontend is a CRUD UI for the Express/PostgreSQL/Drizzle item API. No custom product requirements were supplied.\n')
  minimal.set('docs/PRD.md', `# Project brief\n\n- Project: ${name}\n- Stack: React + Vite, Express, PostgreSQL, Drizzle ORM\n- Recipe: FS-06 (planned)\n- Scope: one generated workspace with frontend/API connectivity; no automatic database provisioning or migration.\n- Status: generated starter; no acceptance or release approval is implied.\n`)
  minimal.set('docs/decisions/index.md', '# Decision register\n\nNo material project decisions or approvals have been recorded.\n')
  minimal.set('docs/qa/acceptance-matrix.md', '# Verification status\n\nSee `.project-generator/manifest.json` for generator checks. No recipe promotion or release approval is implied.\n')
  return minimal
}

function generatedContent(resolved: ResolvedSelection, nodeVersion: string, npmVersion: string, forma?: FormaInstallEvidence): Map<string, string> {
  if (resolved.recipe.id === 'FS-06') return fullstackProjectDocs(resolved, nodeVersion, npmVersion)
  if (resolved.recipe.id === 'BE-08' || resolved.recipe.id === 'BE-09') return postgresProjectDocs(resolved, nodeVersion, npmVersion)
  const details = recipeText(resolved)
  const isNest = resolved.recipe.id === 'BE-03'
  const isDatabaseBackend = resolved.recipe.id === 'BE-07'
  const commands = managerCommands(resolved.recipe.manager)
  const manager = packageManager(resolved.recipe.manager)
  const managerRequirement = resolved.recipe.manager === 'npm'
    ? `npm ${npmVersion}`
    : `${manager.id} ${manager.version}${manager.nodeLinker ? ` (${manager.nodeLinker} node_modules layout)` : ''}`
  const nodeRange = resolved.recipe.manager === 'pnpm'
    ? resolved.recipe.frontend === 'frontend.vue-vite' ? 'Node.js 22.18+ or 24.12+ (pnpm 11 also requires 22.13+)' : 'Node.js 22.13+ for pnpm 11; the scaffold also supports 20.19+ or 22.12+'
    : details.nodeRange
  const managerToolchain = resolved.recipe.manager === 'npm'
    ? `npm ${npmVersion}`
    : `npm bootstrap ${npmVersion} and ${manager.id} ${manager.version}${manager.nodeLinker ? ` with ${manager.nodeLinker} node_modules layout` : ''}`
  const managerConfigNote = manager.configFile && manager.nodeLinker
    ? `\n${manager.id} uses the ${manager.nodeLinker} node_modules linker, pinned in \`${manager.configFile}\` for later installs.\n`
    : ''
  const name = resolved.selection.project.name
  const styling = forma ? 'Forma-managed template styling and theme'
    : resolved.recipe.projectType === 'backend' ? 'Not applicable'
    : resolved.recipe.styling === 'styling.bootstrap' ? 'Bootstrap 5 CSS'
      : resolved.recipe.styling === 'styling.tailwind' ? 'Tailwind CSS'
        : resolved.recipe.styling === 'styling.scss' ? 'SCSS' : 'Plain CSS'
  const origin = forma
    ? `Generated from the Forma template ${forma.id}@${forma.version} at immutable commit ${forma.commitSha}. Portable package SHA-256: ${forma.contentHash}.\n\n`
    : resolved.recipe.projectType === 'backend'
      ? `Generated from the ${isNest ? 'official ' : 'reviewed '}${details.scaffold}.\n\n`
      : `Generated from the official ${details.scaffold} scaffold.\n\n`
  const bootstrapNote = resolved.recipe.styling === 'styling.bootstrap'
    ? '\nBootstrap is configured as CSS only. Project `.npmrc` disables automatic installation of its unused `@popperjs/core` peer; no Bootstrap JavaScript is configured.\n'
    : ''
  const stylingNote = resolved.recipe.styling === 'styling.scss'
    && (resolved.recipe.frontend === 'frontend.react-vite' || resolved.recipe.frontend === 'frontend.vue-vite')
    ? 'Vite imports `src/project-generator.scss`; pinned `sass@1.108.2` compiles it during development and production builds.\n'
    : resolved.recipe.styling === 'styling.tailwind'
      && (resolved.recipe.frontend === 'frontend.react-vite' || resolved.recipe.frontend === 'frontend.vue-vite')
      ? 'Tailwind CSS `4.3.5` uses the official `@tailwindcss/vite` plugin `4.3.5`. Tailwind v4 auto-detects source files; no legacy `tailwind.config.js` or content globs are generated.\n'
      : ''
  const checks = resolved.recipe.projectType === 'backend' && isDatabaseBackend
      ? `## Checks\n\n\`\`\`sh\n${commands.run('typecheck')}\n${commands.run('lint')}\n${commands.run('test')}\n${commands.run('build')}\n\`\`\`\n\nThe CRUD integration test applies generated migrations only to an isolated temporary SQLite database. Generation never migrates the configured application database.\n`
      : resolved.recipe.projectType === 'backend' && isNest
      ? `## Checks\n\n\`\`\`sh\n${commands.run('typecheck')}\n${commands.run('lint')}\n${commands.run('test')}\n${commands.run('test:e2e')}\n${commands.run('build')}\n\`\`\`\n\nThe Jest e2e suite covers JSON API errors and application shutdown. The generator also starts the built server in isolated local smoke test and checks GET /health and /api/info.\n`
      : resolved.recipe.projectType === 'backend'
      ? `## Checks\n\n\`\`\`sh\n${commands.run('typecheck')}\n${commands.run('test')}\n${commands.run('build')}\n\`\`\`\n\nThe generator also starts the built server in an isolated local smoke test and checks GET /health and /api/info.\n`
      : forma
      ? `## Checks\n\n\`\`\`sh\n${commands.run('typecheck')}\n${commands.run('build')}\n\`\`\`\n\nThe Forma installer does not define a lint script; lint was not run. The generator HTTP smoke check is recorded in .project-generator/manifest.json.\n`
      : resolved.recipe.frontend === 'frontend.nuxt'
      ? `## Checks\n\n\`\`\`sh\n${commands.run('typecheck')}\n${commands.run('build')}\n\`\`\`\n\nThe recipe adds integrity-pinned TypeScript and vue-tsc dev dependencies because the official starter does not bundle a type checker. The starter does not define lint or unit-test scripts. The generator HTTP preview smoke check is recorded in .project-generator/manifest.json.\n`
      : resolved.recipe.frontend === 'frontend.angular'
        ? `## Checks\n\n\`\`\`sh\nnpm run build\nnpm test -- --watch=false\n\`\`\`\n\nThe Angular production build includes compiler/type validation. The official scaffold does not define a lint script. The generator HTTP server smoke check is recorded in .project-generator/manifest.json.\n`
      : resolved.recipe.frontend === 'frontend.vue-vite'
        ? `## Checks\n\n\`\`\`sh\n${commands.run('lint')}\n${commands.run('type-check')}\n${commands.run('build')}\n\`\`\`\n`
      : `## Checks\n\n\`\`\`sh\n${commands.run('lint')}\n${commands.run('build')}\n\`\`\`\n`
  const backendApi = resolved.recipe.projectType === 'backend'
     ? `## API\n\n- \`GET /health\` — process health status.\n- \`GET /api/info\` — service and runtime details.\n${isDatabaseBackend ? '- `GET /api/notes`, `GET /api/notes/:id`, `POST /api/notes`, `PATCH /api/notes/:id`, `DELETE /api/notes/:id` — SQLite/Drizzle CRUD example.\n' : ''}\n${isNest ? 'NestJS controllers and services provide the API; a global exception filter returns stable JSON errors.' : 'The Express application provides the API.'} Server reads \`HOST\`, \`PORT\`, and \`NODE_ENV\` from environment variables; \`.env.example\` lists local defaults. ${isDatabaseBackend ? 'It reads DB_FILE for a local SQLite file and never applies migrations automatically.' : ''} SIGINT and SIGTERM close the HTTP listener gracefully.\n\n`
    : ''
  const scopeNote = resolved.recipe.projectType === 'backend'
     ? isDatabaseBackend ? 'This standalone API uses local SQLite and Drizzle; it has no frontend, authentication, Docker, or fullstack composition.' : 'This standalone REST API has no frontend, database, ORM, authentication, or deployment configuration.'
    : 'This is a frontend-only project. No separate backend, database, or deployment is included.'
  const envInstruction = resolved.recipe.projectType === 'backend' ? 'Copy `.env.example` to `.env` if you want to override local defaults.\n\n' : ''
  const migrationInstructions = isDatabaseBackend
    ? `## SQLite and migrations\n\nThe notes routes require the generated schema. Before using them, review \`DB_FILE\` in \`.env.example\`; default is project-local \`data/notes.sqlite\`. Do not point it at another project's database. Review generated schema and SQL under \`drizzle/\`, then apply migrations only when you explicitly choose to: \`${commands.run('db:migrate')}\`.\n\nGeneration and app startup never apply migrations. No SQLite service is created or started.\n\n`
    : ''
   const readmeCommands = isDatabaseBackend ? `${commands.install}\n${commands.run('db:migrate')}\n${details.devCommand}` : `${commands.install}\n${details.devCommand}`
   const readme = `# ${name}\n\n${origin}${details.title} project.\n${bootstrapNote}${stylingNote}${managerConfigNote}\n## Prerequisites\n\n- ${nodeRange}\n- ${managerRequirement}\n\n## Run locally\n\n${envInstruction}\`\`\`sh\n${readmeCommands}\n\`\`\`\n\n${backendApi}${migrationInstructions}${checks}\nSee [docs/SETUP.md](docs/SETUP.md) for setup and verification details.\n\n${scopeNote} ${resolved.recipe.manager} installation may run dependency lifecycle scripts; dependencies are not sandboxed.\n`
  const setupChecks = resolved.recipe.projectType === 'backend' && isDatabaseBackend ? `${commands.run('typecheck')}\n${commands.run('lint')}\n${commands.run('test')}\n${commands.run('build')}`
    : resolved.recipe.projectType === 'backend' && isNest ? `${commands.run('typecheck')}\n${commands.run('lint')}\n${commands.run('test')}\n${commands.run('test:e2e')}\n${commands.run('build')}`
    : resolved.recipe.projectType === 'backend' ? `${commands.run('typecheck')}\n${commands.run('test')}\n${commands.run('build')}`
    : forma || resolved.recipe.frontend === 'frontend.nuxt' ? `${commands.run('typecheck')}\n${commands.run('build')}`
    : resolved.recipe.frontend === 'frontend.angular' ? `${commands.run('build')}\nnpm test -- --watch=false`
      : resolved.recipe.frontend === 'frontend.vue-vite' ? `${commands.run('lint')}\n${commands.run('type-check')}\n${commands.run('build')}` : `${commands.run('lint')}\n${commands.run('build')}`
   const envSetup = resolved.recipe.projectType === 'backend' ? `Optional local configuration: copy \`.env.example\` to \`.env\` in PowerShell with \`Copy-Item .env.example .env\`; edit \`HOST\`, \`PORT\`, or \`NODE_ENV\`${isDatabaseBackend ? ' and review \`DB_FILE\` so it points only to this project’s own local SQLite file' : ''}. The server reads \`.env\` through Node.js built-in env-file support.\n\n` : ''
   const setup = `# Setup\n\n## Toolchain\n\nGenerated with ${details.scaffold}, Node.js ${nodeVersion}, ${managerToolchain}.\n${managerConfigNote}${forma ? `Forma source: private GitHub repository, commit ${forma.commitSha}. Template ${forma.id}@${forma.version}; portable SHA-256 ${forma.contentHash}; theme ${forma.variantName}.\n` : ''}${bootstrapNote}${stylingNote}\n## Install and run\n\n${envSetup}\`\`\`sh\n${commands.install}\n${isDatabaseBackend ? `${commands.run('db:migrate')}\n` : ''}${details.devCommand}\n\`\`\`\n\n${migrationInstructions}## Validate\n\n\`\`\`sh\n${setupChecks}\n\`\`\`\n\n${resolved.recipe.projectType === 'backend' ? `${isDatabaseBackend ? 'CRUD tests apply generated migrations only to an isolated temporary SQLite database. ' : isNest ? 'Nest Jest e2e tests cover JSON API errors and clean application shutdown. ' : 'Generated tests cover 404/error handling and graceful shutdown. ' }The API exposes GET \`/health\` and GET \`/api/info\`; the generator starts the built server only for its HTTP smoke check and stops it before finalization.\n` : "The generator's HTTP smoke check verifies an HTML response from the local server. It does not launch a browser or verify visual rendering.\n"}`
  const files = new Map<string, string>([['README.md', readme], ['docs/SETUP.md', setup]])
  if (resolved.selection.documentation === 'minimal') return files

  const checkCommands = resolved.recipe.projectType === 'backend' && isDatabaseBackend ? `\`${commands.run('typecheck')}\`, \`${commands.run('lint')}\`, \`${commands.run('test')}\`, and \`${commands.run('build')}\``
    : resolved.recipe.projectType === 'backend' && isNest ? `\`${commands.run('typecheck')}\`, \`${commands.run('lint')}\`, \`${commands.run('test')}\`, \`${commands.run('test:e2e')}\`, and \`${commands.run('build')}\``
    : resolved.recipe.projectType === 'backend' ? `\`${commands.run('typecheck')}\`, \`${commands.run('test')}\`, and \`${commands.run('build')}\``
    : forma ? `\`${commands.run('typecheck')}\` and \`${commands.run('build')}\``
    : resolved.recipe.frontend === 'frontend.nuxt' ? `\`${commands.run('typecheck')}\` and \`${commands.run('build')}\``
      : resolved.recipe.frontend === 'frontend.angular' ? `\`${commands.run('build')}\` and \`npm test -- --watch=false\``
        : resolved.recipe.frontend === 'frontend.vue-vite' ? `\`${commands.run('lint')}\`, \`${commands.run('type-check')}\`, and \`${commands.run('build')}\`` : `\`${commands.run('lint')}\` and \`${commands.run('build')}\``
  files.set('AGENTS.md', `# Agent instructions\n\n- Project: ${details.title}.\n- Package manager: ${manager.id}; retain ${manager.lockfile}${manager.configFile ? ` and ${manager.configFile}` : ''}.\n- Run ${checkCommands} before reporting changes.\n- ${scopeNote}\n- Generated by FormaForge; no approval or project history is implied.\n`)
  files.set('docs/ARCHITECTURE.md', resolved.recipe.projectType === 'backend' && isDatabaseBackend
    ? `# Architecture\n\nStandalone Node.js + TypeScript + Express + SQLite + Drizzle API. \`src/db/schema.ts\` defines the notes table; \`src/db/client.ts\` opens a project-local SQLite file; \`src/db/notes.ts\` contains Drizzle CRUD operations; and \`src/routes/notes.ts\` exposes them. \`drizzle.config.ts\` and \`drizzle/\` hold migration config and generated SQL. No global database service is created. App startup never applies migrations; run the documented migration command explicitly against this project's own DB_FILE.\n\nFormaForge owns the reviewed starter files and generated setup/manifest documentation.\n`
    : resolved.recipe.projectType === 'backend' && isNest
    ? `# Architecture\n\nStandalone Node.js + TypeScript + NestJS REST API. \`src/app.module.ts\` wires the controller, service, and global JSON exception filter. \`src/main.ts\` loads optional environment configuration, validates host/port, starts the HTTP listener, and enables SIGINT/SIGTERM shutdown hooks. The Nest CLI scaffold uses CommonJS-compatible NodeNext TypeScript and Jest. No frontend, database, ORM, authentication, Docker, or fullstack workspace is included.\n\nFormaForge owns the API/configuration files and generated setup/manifest documentation; Nest CLI owns the build/test configuration.\n`
    : resolved.recipe.projectType === 'backend'
    ? `# Architecture\n\nStandalone Node.js + TypeScript + Express REST API. Express application and middleware live in \`src/app.ts\`; \`src/server.ts\` loads environment configuration and owns the HTTP listener and graceful shutdown. No frontend, database, ORM, authentication, or fullstack workspace is included.\n\nFormaForge owns the reviewed starter files and generated setup/manifest documentation.\n`
    : `# Architecture\n\nThis repository is a ${details.title} frontend application generated from ${details.scaffold}. Styling: ${styling}. It uses ${manager.id} and has no separate backend or database.\n\nThe framework/template owns application source and build configuration. FormaForge owns this document and the setup/manifest files.\n`)
  files.set('docs/TESTING.md', resolved.recipe.projectType === 'backend' && isDatabaseBackend
    ? `# Testing\n\n- Typecheck: \`${commands.run('typecheck')}\`.\n- Lint: \`${commands.run('lint')}\`.\n- CRUD integration tests: \`${commands.run('test')}\`; migrations apply only to a temporary isolated SQLite file.\n- Production build: \`${commands.run('build')}\`.\n- Explicit project migration: review DB_FILE and generated SQL, then run \`${commands.run('db:migrate')}\` yourself.\n- Generation and app startup never apply project migrations.\n`
    : resolved.recipe.projectType === 'backend' && isNest
    ? `# Testing\n\n- Typecheck: \`${commands.run('typecheck')}\`.\n- Lint: \`${commands.run('lint')}\` (no autofix).\n- Unit tests: \`${commands.run('test')}\` (Jest 30 + ts-jest).\n- E2E tests: \`${commands.run('test:e2e')}\` (Nest testing module + Supertest).\n- Production build: \`${commands.run('build')}\` (Nest CLI).\n- Generator smoke: starts the built API in isolated staging and checks GET \`/health\` and \`/api/info\`.\n- E2E checks cover stable 404/malformed-JSON responses and application shutdown.\n\nNo database or external service is required.\n`
    : resolved.recipe.projectType === 'backend'
    ? `# Testing\n\n- Typecheck: \`${commands.run('typecheck')}\`.\n- Unit and integration tests: \`${commands.run('test')}\` (Node.js built-in test runner).\n- Production build: \`${commands.run('build')}\`.\n- Generator smoke: starts the built API in isolated staging and checks GET \`/health\` and \`/api/info\`.\n- Tests cover 404/error handling and graceful shutdown.\n\nNo database or external service is required.\n`
    : forma
    ? `# Testing\n\n- TypeScript: \`${commands.run('typecheck')}\`.\n- Production build: \`${commands.run('build')}\`.\n- Local server: \`${details.devCommand}\`.\n- Lint: not installed by the pinned Forma installer; no lint command is provided.\n\nThe generator performed only checks recorded in .project-generator/manifest.json. Its HTTP smoke check is not browser automation.\n`
    : resolved.recipe.frontend === 'frontend.nuxt'
        ? `# Testing\n\n- TypeScript: \`${commands.run('typecheck')}\` (pinned TypeScript and vue-tsc dev dependencies).\n- Production build: \`${commands.run('build')}\`.\n- Local server: \`${details.devCommand}\`.\n- The official starter does not define lint or unit-test scripts.\n\nThe generator performed only checks recorded in .project-generator/manifest.json. Its HTTP smoke check is not browser automation.\n`
      : resolved.recipe.frontend === 'frontend.angular'
         ? `# Testing\n\n- Production build and Angular compiler/type validation: \`${commands.run('build')}\`.\n- Unit tests: \`npm test -- --watch=false\`.\n- Local server: \`${details.smokeCommand}\`.\n- The official scaffold does not define a lint script.\n\nThe generator performed only checks recorded in .project-generator/manifest.json. Its HTTP smoke check is not browser automation.\n`
       : `# Testing\n\n- Lint: \`${commands.run('lint')}\`.\n${resolved.recipe.frontend === 'frontend.vue-vite' ? `- TypeScript validation: \`${commands.run('type-check')}\`.\n` : ''}- Production build${resolved.recipe.frontend === 'frontend.vue-vite' ? '' : ' and scaffold TypeScript validation'}: \`${commands.run('build')}\`.\n- Local server: \`${details.devCommand}\`.\n\nThe generator performed only checks recorded in .project-generator/manifest.json. No browser automation is included.\n`)
  if (resolved.selection.documentation === 'standard') return files

  files.set('CLAUDE.md', 'Read AGENTS.md and docs/ before changing this generated project. Do not claim checks passed unless you ran them.\n')
  files.set('agent.md', '# Agent notes\n\nInitial generated instructions only. No AI agent history or approval is asserted.\n')
  files.set('decision.md', '# Decision policy\n\nRecord future material decisions in docs/decisions/index.md. Generated baseline is not an approval.\n')
  files.set('design.md', `# Design notes\n\nFramework: ${details.title}. Styling: ${styling}. No custom product UI requirements were supplied.\n`)
  files.set('docs/PRD.md', `# Project brief\n\n- Project: ${name}\n- Stack: ${details.title}\n- Scope: ${scopeNote}\n- Status: initial generated project; no product approvals are implied.\n`)
  files.set('docs/decisions/index.md', '# Decision register\n\nNo material decisions or approvals have been recorded. Add entries only when decisions occur.\n')
  files.set('docs/qa/acceptance-matrix.md', '# Verification status\n\nSee `.project-generator/manifest.json` for checks executed during generation. No release approval is implied.\n')
  return files
}

export async function writeProjectDocs(stage: OwnedStage, resolved: ResolvedSelection, nodeVersion: string, npm: NpmTool, forma?: FormaInstallEvidence): Promise<string[]> {
  const files = generatedContent(resolved, nodeVersion, npm.version, forma)
  const projectName = win32.basename(stage.childPath)
  const prefix = `${projectName}/`
  const written = await mutateOwnedStage(stage, [], [...files].map(([path, content]) => ({
    path: `${prefix}${path}`,
    content,
    replace: path === 'README.md',
    skipExisting: path !== 'README.md',
  })))
  return written.map((path) => path.slice(prefix.length))
}

export async function writeProjectManifest(
  stage: OwnedStage,
  resolved: ResolvedSelection,
  nodeVersion: string,
  npm: NpmTool,
  outcomes: readonly ValidationOutcome[],
  generatedFiles: readonly string[],
  forma?: FormaInstallEvidence,
): Promise<void> {
  const projectPath = stage.childPath
  const manager = packageManager(resolved.recipe.manager)
  const entries = await readdir(projectPath)
  const presentLocks = entries.filter((entry) => lockfiles.includes(entry))
  if (!manager.lockfile || presentLocks.length !== 1 || presentLocks[0] !== manager.lockfile) throw new Error(`Expected exactly one ${resolved.recipe.manager} lockfile, ${manager.lockfile}.`)
  const lockfile = manager.lockfile
  const lockBytes = await readFile(win32.join(projectPath, lockfile))
  const lockHash = createHash('sha256').update(lockBytes).digest('hex')
  const manifest = {
    schemaVersion: 1,
    generatorVersion: '0.1.0',
    recipeId: resolved.recipe.id,
    recipeVersion: 1,
    recipeStatusAtCreation: resolved.recipe.status,
    createdAt: new Date().toISOString(),
    platform: `${process.platform}-${process.arch}`,
    projectName: resolved.selection.project.name,
    projectType: resolved.recipe.projectType ?? 'frontend',
    documentationMode: resolved.selection.documentation,
    selectedAdapters: [
      ...(resolved.recipe.frontend ? [{ id: resolved.recipe.frontend, version: '0.1.0' }] : []),
      ...(resolved.recipe.backend ? [{ id: resolved.recipe.backend, version: '0.1.0' }] : []),
      ...(resolved.recipe.database ? [{ id: resolved.recipe.database, version: '0.1.0' }] : []),
      ...(resolved.recipe.dataAccess ? [{ id: resolved.recipe.dataAccess, version: '0.1.0' }] : []),
      ...(forma ? [{ id: 'template.forma', version: '0.1.0' }] : resolved.recipe.styling ? [{ id: resolved.recipe.styling, version: '0.1.0' }] : []),
    ],
    packageManager: resolved.recipe.manager,
    ...(manager.nodeLinker && manager.configFile ? { packageManagerConfig: { nodeLinker: manager.nodeLinker, file: manager.configFile } } : {}),
    toolVersions: {
      node: nodeVersion,
      npm: npm.version,
      ...(resolved.recipe.manager === 'npm' ? {} : { [resolved.recipe.manager]: manager.version }),
    },
    upstreamSources: forma
      ? [{ repository: 'private Forma repository', commitSha: forma.commitSha, templateId: forma.id, resolvedVersion: forma.version, integrity: { algorithm: 'sha256', contentHash: forma.contentHash } }]
      : [
        ...(resolved.recipe.scaffold ? [{
          package: resolved.recipe.scaffold.packageName,
          resolvedVersion: resolved.recipe.scaffold.version,
          integrity: resolved.recipe.scaffold.integrity,
          ...(resolved.recipe.scaffold.source ? { repository: resolved.recipe.scaffold.source.repository, commitSha: resolved.recipe.scaffold.source.commitSha } : {}),
        }] : []),
        ...(resolved.recipe.dependencies ?? []).map((dependency) => ({ package: dependency.packageName, resolvedVersion: dependency.version, integrity: dependency.integrity })),
        ...(manager.packageName && manager.integrity ? [{ package: manager.packageName, resolvedVersion: manager.version, integrity: manager.integrity, role: 'package-manager' }] : []),
      ],
    ...(forma ? { template: { adapterId: 'template.forma', id: forma.id, version: forma.version, variantId: forma.variantId, variantName: forma.variantName, license: forma.license, commitSha: forma.commitSha, sourceRepository: 'private Forma repository', integrity: { algorithm: 'sha256', contentHash: forma.contentHash } } } : {}),
    lockfiles: [{ name: manager.lockfile, sha256: lockHash }],
    generatedFiles: [...generatedFiles, '.project-generator/manifest.json'],
    validation: outcomes,
  }
  await mutateOwnedStage(stage, [], [{
    path: `${win32.basename(stage.childPath)}/.project-generator/manifest.json`,
    content: `${JSON.stringify(manifest, null, 2)}\n`,
  }])
}
