import type { ResolvedSelection } from './types.js'

export function postgresProjectDocs(resolved: ResolvedSelection, nodeVersion: string, npmVersion: string): Map<string, string> {
  const name = resolved.selection.project.name
  const pins = resolved.recipe.dependencies?.map(({ packageName, version }) => `- ${packageName}@${version}`).join('\n') ?? ''
  const safety = `# PostgreSQL safety

- Generation installs pinned npm dependencies and generates Drizzle SQL; it never connects to PostgreSQL or applies migrations.
- Startup validates DATABASE_URL syntax and creates a lazy pool; it does not connect or migrate. GET /health is process-only.
- PostgreSQL 16+ is user-provided and needed only for CRUD and explicit migration. No database is automatically created, reset, or dropped.
- CRUD uses Drizzle parameterized queries. Database failures return generic HTTP 503; credentials and driver errors are not returned or logged.
- .env is ignored; .env.example contains placeholders only. Never commit credentials.
- Migration requires npm run db:migrate -- --target host:port/database. The wrapper matches DATABASE_URL host/port/database, verifies active database, role, server address, port, and PostgreSQL version with a read-only query, then migrates on that checked connection. Pool closes on success and failure.
- DATABASE_URL currently requires explicit host and port; query strings and fragments are rejected, including URL-based SSL parameters.
- Target confirmation cannot prevent operator misconfirmation, DNS/server changes, or hostile endpoints.
- Drizzle Kit generates SQL only. Do not invoke drizzle-kit migrate directly; installed tools remain manually callable outside wrapper enforcement.
- npm lifecycle/build scripts run unsandboxed after explicit consent.
`
  const readme = `# ${name}

BE-08 planned starter: standalone Express 5 + TypeScript + PostgreSQL + Drizzle ORM. No independent acceptance or production readiness is implied.

## Prerequisites

- Node.js 22.13+ and npm 10+.
- PostgreSQL 16+ only for CRUD and migration. Generation, install, build, startup, and /health do not need a database.
- User-created database and least-privilege login role.

## Setup

Copy .env.example to .env and replace the placeholder DATABASE_URL. Keep .env private; it is git-ignored.

~~~powershell
Copy-Item .env.example .env
~~~

Install dependencies and generate SQL:

~~~sh
npm ci
npm run db:generate
~~~

Review SQL, then confirm matching target explicitly:

~~~sh
npm run db:migrate -- --target host:port/database
npm run dev
~~~

See [PostgreSQL safety](docs/DATABASE-SAFETY.md). Confirmation is an operator guard, not proof of intent.

## API

- GET /health — process-only health; no database query.
- GET /api/items and GET /api/items/:id
- POST /api/items, PATCH /api/items/:id, DELETE /api/items/:id

CRUD uses parameterized Drizzle queries. Unavailable PostgreSQL returns generic HTTP 503.

## Checks

~~~sh
npm run typecheck
npm run lint
npm test
npm run build
~~~

PostgreSQL integration is opt-in through PG_E2E_DATABASE_URL and requires an isolated, pre-migrated database.

### Direct dependency pins

${pins}

npm lifecycle code is unsandboxed.
`
  const files = new Map<string, string>([
    ['README.md', readme],
    ['docs/SETUP.md', `# Setup

Generated with Node.js ${nodeVersion} and npm ${npmVersion}. PostgreSQL 16+ is user-provided and required only for CRUD/migration.

Copy .env.example to .env and replace DATABASE_URL. .env is git-ignored.

~~~sh
npm ci
npm run db:generate
npm run db:migrate -- --target host:port/database
npm run dev
~~~

Review drizzle/ SQL first. Target host, port, and database must match DATABASE_URL. The wrapper checks connected database, role, address, port, and PostgreSQL 16+ version before applying migrations on the same connection. DATABASE_URL query strings/fragments (including URL-based SSL options) are unsupported. Confirmation cannot prevent operator error, DNS changes, or a hostile endpoint. Do not invoke drizzle-kit migrate directly.

Generation, startup, and /health do not connect or migrate. No database is created, reset, or dropped automatically.

~~~sh
npm run typecheck
npm run lint
npm test
npm run build
~~~

Optional CRUD integration requires PG_E2E_DATABASE_URL for an isolated database already migrated explicitly.
`],
    ['docs/DATABASE-SAFETY.md', safety],
  ])
  if (resolved.selection.documentation === 'minimal') return files

  files.set('AGENTS.md', `# Agent instructions

- BE-08 remains planned; no independent acceptance or release approval is implied.
- Keep exact npm pins and lockfile. Run typecheck, lint, tests, and build.
- Never expose DATABASE_URL. Apply migrations only through guarded wrapper.
`)
  files.set('docs/ARCHITECTURE.md', `# Architecture

Express routes live in src/routes; Drizzle schema and CRUD helpers live in src/db. src/db/client.ts owns the lazy pg.Pool. Startup and /health do not query PostgreSQL. src/db/migrate.ts verifies explicit target and active identity read-only, then invokes Drizzle migrator on the checked connection. Drizzle Kit config supports SQL generation only.
`)
  files.set('docs/TESTING.md', `# Testing

- npm run typecheck, npm run lint, npm test, npm run build.
- Unit tests cover URL/target validation, target mismatch, DB-free startup/health, sanitized 503, and pool shutdown.
- Optional CRUD integration requires PG_E2E_DATABASE_URL for an isolated, pre-migrated database; test does not migrate it.
- Migration E2E must use only a run-owned temporary PostgreSQL cluster/database/role.
`)
  if (resolved.selection.documentation === 'full') {
    files.set('CLAUDE.md', 'Read AGENTS.md and docs before editing. Never share .env or DATABASE_URL.\n')
    files.set('agent.md', '# Agent notes\n\nGenerated baseline only; no review approval is implied.\n')
    files.set('decision.md', '# Decision policy\n\nRecord future decisions; generated baseline is not approval.\n')
    files.set('design.md', '# Design notes\n\nNo custom UI scope supplied.\n')
    files.set('docs/PRD.md', `# Project brief\n\n- Project: ${name}\n- Stack: Express + TypeScript + PostgreSQL + Drizzle.\n- Status: BE-08 planned; independent acceptance pending.\n- Scope: standalone CRUD API; no authentication or Docker.\n`)
    files.set('docs/decisions/index.md', '# Decision register\n\nNo project-specific approvals recorded.\n')
    files.set('docs/qa/acceptance-matrix.md', '# Verification status\n\nGenerated tests are local evidence only; no independent acceptance or release approval is implied.\n')
  }
  return files
}
