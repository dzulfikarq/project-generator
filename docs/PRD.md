# PRD — Universal Project Generator Desktop

| Field | Value |
|---|---|
| Product | Project Generator Desktop |
| Version | **V1 — Draft 0.1** |
| Date | 2026-11-13 |
| Status | Discovery draft, pending review and explicit implementation baseline approval |
| Platform | Windows 11 first; x64 primary |
| Owners/reviewers | Not assigned; do not fabricate approvals |
| Related contracts | `adapters/compatibility-matrix.md`, `adapters/adapter-contract.md`, `qa/acceptance-matrix.md` |

## 1. Summary and problem

Developers repeatedly set up framework scaffolds, package managers, code quality tools, database connections, UI systems and documentation. Cross-language combinations add configuration risk. Project Generator provides a visual, local-first wizard and CLI that produce reproducible, validated development repositories from a manifest and a set of versioned technology adapters. **A new project is created, not an existing project modified.**

### Vision

> Pick a project type, assemble compatible technologies, choose an optional visual template, and receive a transparently generated project with verifiable setup and working development commands.

### Goals

- P0: Generate functioning frontend-only and backend-only projects using official scaffolding or maintainable first-party starter adapters.
- P0: Assemble selected cross-language fullstack presets with a working local API connectivity sample where the recipe promises it.
- P0: Enforce compatibility and prerequisite checks *before* modifying the target folder.
- P0: Use **npm by default** for Node ecosystem projects; retain non-Node ecosystem-native package managers.
- P0: Create honest, stack-specific documentation rather than generic or invented technical claims.
- P0: Maintain traceability across requirements, adapters, tests, and release approvals.
- P1: Integrate the existing private Forma exporter/installer for independently verified template + React + Vite / Next.js combinations. Local CLI integration exists; release acceptance remains pending.
- P1: Offer saved presets, local project history, advanced diagnostics and optional Docker Compose.
- V1.1: Expo/React Native and Flutter workflows, followed by mobile-specific testing infrastructure.

### Non-goals for V1

AI-generated application features, source code editing of existing projects, full cloud deployment, automatic provisioning of production databases, automatic repo pushes, remote code execution from untrusted templates, live collaboration, iOS native builds on Windows, editing Forma's underlying templates.

## 2. Target users and project types

- Solo developer creating a starter from scratch.
- Frontend developer who needs UI scaffolding plus a familiar design system.
- Fullstack developer assembling an API and frontend across different runtimes.
- Team wanting repeatable, documented, version-pinned starter presets.

Project types: `frontend`, `backend`, `fullstack`, `mobile` (V1.1). Frontend framework may have its own server (Next.js/Nuxt) even when `separateBackend=none`.

## 3. Release language / visibility

| Status | Meaning | UI behavior |
|---|---|---|
| `cataloged` | Appears on roadmap, no adapter guarantee | Information only; cannot Generate |
| `planned` | Adapter work planned, no verification | Disabled with reason |
| `experimental` | Adapter implemented, incomplete matrix | Explicit opt-in; detail limitations |
| `tested` | Target platform, generation and checks passed | Enabled normally |
| `blocked` | Invalid combination or missing mandatory prerequisite | Disabled, show fix or alternative |
| `retired` | No longer maintained | Unavailable; historical only |

All V1 framework lists below are **targets**, not shipped or tested capabilities. First production release includes only the individual recipes that have earned `tested`.

## 4. V1 proposed catalog

### Frontend

- Web: React + Vite, Next.js App Router, Vue + Vite, Nuxt, Angular. SvelteKit is candidate if capacity allows; never silently swap plain Svelte/Vite for SvelteKit.
- Mobile V1.1: React Native via Expo, Flutter; OS-specific setup gates apply.
- Default language: TypeScript when framework supports it; offer JavaScript where the native scaffold supports it.

### Backend

- Node.js: Express, NestJS, Fastify.
- Go: Gin or standard `net/http` baseline; Go modules.
- PHP: Laravel; Composer.
- Python: FastAPI; uv.
- Later: Django, Spring Boot, ASP.NET Core.

### Storage

- V1 target: PostgreSQL, MySQL, MariaDB, SQLite, MongoDB. Database is optional.
- V1.1 candidates: Redis as auxiliary cache, SQL Server.
- Every recipe specifies its actual driver/ORM, migrations, seed behavior, and connectivity validation. `database=none` produces no fake DB setup.
- Database provisioning modes: `existing-service` or `docker-compose` **only if a verified adapter supports it**. Docker is not started by default.

### Packages, styling and components

- Node package manager default: **npm**. Choices Yarn, pnpm, Bun only where tested with selected framework/template. Exactly one lockfile.
- Go: Go Modules; PHP: Composer; Python: uv; Flutter: pub.
- Styling: recommended framework default, plain CSS, CSS Modules / Vue scoped styles where native, Sass/SCSS, Tailwind CSS, Bootstrap.
- UI component systems by framework: React/Next shadcn/ui, MUI, Ant Design; Vue/Nuxt PrimeVue, Vuetify; Angular Angular Material, PrimeNG; mobile uses its own UI systems.
- Component libraries are **independent from styling**, but compatibility rules can restrict combinations; never install several design systems by default.
- Forma: only enabled for catalog/template entries whose adapter + manifest + package manager are verified; use existing exporter, manifest, installer and SHA validation. Current CLI integrations remain planned pending independent acceptance.

## 5. Functional requirements

IDs are stable and used by QA, design and decision records. P0 must work for an individual recipe before calling it `tested`; P1 is not necessarily a release blocker unless explicitly selected.

| ID | Priority | Requirement | Observable acceptance |
|---|---|---|---|
| PRD-001 | P0 | Project type selection | Frontend, backend, fullstack; mobile shown future/disabled until V1.1 |
| PRD-002 | P0 | Project identity and target | Name, description, path validated; existing files never overwritten |
| PRD-003 | P0 | Versioned technology catalog | Each entry has capability, status, toolchain and known constraints |
| PRD-004 | P0 | Compatibility resolver | Unsupported combinations blocked with understandable reason before running |
| PRD-005 | P0 | Framework-aware package manager | npm preselected for Node; other runtimes use ecosystem manager; lockfile matches |
| PRD-006 | P0 | Styling/component selection | Only compatible styling and library choices presented as selectable |
| PRD-007 | P0 | Environment doctor | Detect required toolchains, executable versions, optional Docker, free disk and path constraints |
| PRD-008 | P0 | Review generation plan | Show exact steps, downloads, commands (sanitized), files to create, and prerequisites |
| PRD-009 | P0 | Deterministic scaffold | Native official CLI or pinned vetted starter; noninteractive and version-recorded |
| PRD-010 | P0 | Safe workspace behavior | Stage in generator-owned folder, never clobber pre-existing paths, safe cancellation/cleanup |
| PRD-011 | P0 | Observable generation job | Step statuses, live logs, cancel, retry policy, structured errors, summary report |
| PRD-012 | P0 | Dependency installation | Correct manager for each project part, correct lockfiles, no silent manager switching |
| PRD-013 | P0 | Basic validation | Adapter checks, lint/typecheck/build/test where applicable, truthful skips and reasons |
| PRD-014 | P0 | Generated project docs | README + setup; richer modes add architecture, agent rules, decision register and QA docs |
| PRD-015 | P0 | Local outputs | Open folder/editor; report run commands; do not automatically start an unknown service |
| PRD-016 | P0 | Reproducibility manifest | Pin adapter/tool versions, selected options, source/template commit and validation outcome; no secrets |
| PRD-017 | P0 | Backend/DB wiring | Real driver, environment samples, connection config, migration commands and smoke where recipe requires |
| PRD-018 | P0 | Fullstack workspace presets | Verified cross-language recipe can scaffold frontend/backend separately with API URL config |
| PRD-019 | P0 | Security and permissions | No arbitrary shell, no secret echo, scoped process execution, no remote push without action |
| PRD-020 | P0 | Offline/online distinction | Existing caches may work offline; downloads and installs explain network need |
| PRD-021 | P1 | Forma integration | Authenticated immutable private-source fetch; use existing exporter/installer and SHA/manifest checks; only verified template/framework combinations |
| PRD-022 | P1 | Save and reuse presets | Export/import user-selected options with schema/version migration |
| PRD-023 | P1 | Project history | Local list with generated path, stack, status and reopen option; no code indexing |
| PRD-024 | P1 | Docker Compose integration | Opt-in DB compose with healthcheck, ports and clear lifecycle responsibility |
| PRD-025 | P1 | Git bootstrap | Optional git init/initial commit; no automatic GitHub repo/push |
| PRD-026 | P1 | Advanced diagnostics | Copyable redacted logs, machine readiness report, retry guidance |
| PRD-027 | V1.1 | Mobile scaffolds | Expo/Flutter platform-aware prerequisite and device workflow |
| PRD-028 | Future | GitHub remote creation | Explicit credential scopes and confirmation, separated feature |

### Generator wizard

1. Home: create new, recent projects, environment health.
2. Project Information: name, description, parent directory, repository layout.
3. Project Type: frontend / backend / fullstack / mobile (when enabled).
4. Technology Stack: frontend, backend, DB, ORM/driver, package managers, recommended presets.
5. Styling & UI: framework-native options and optional Forma template catalog.
6. Developer Tools: lint/format, TS/JS, Git, docs mode (Minimal/Standard/Full), Docker opt-in.
7. Review: compatible recipe, exact plan and prerequisites, warnings, disk/network information.
8. Generating: step-by-step progress, logs, cancellation.
9. Complete/Partial/Failed: validation evidence, launch commands, Open Folder / Open in VS Code.

Wizard step numbering is not fixed; irrelevant steps are skipped for backend-only or simpler recipes.

### Documentation mode behavior

| Mode | Target generated files | Rule |
|---|---|---|
| Minimal | `README.md`, `docs/SETUP.md` | Only truthful install/dev commands |
| Standard (default) | Minimal + `AGENTS.md`, `docs/ARCHITECTURE.md`, `docs/TESTING.md` | Tailor sections to actual stack |
| Full | Standard + `CLAUDE.md`, `agent.md`, `decision.md`, `design.md`, `docs/PRD.md`, `docs/decisions/index.md`, `docs/qa/acceptance-matrix.md` | Mark unimplemented/future content clearly; never fabricate historical AI actions or approvals |

Full mode can initialize decisions such as `DEC-001 stack-selection` with status `Selected configuration` (a user's explicit choice), not claim an organizational review approval. Generate templates that are usable, not boilerplate fiction.

## 6. Nonfunctional and safety requirements

| ID | Requirement | Acceptance |
|---|---|---|
| NFR-001 | Windows filesystem safety | Reserved device names, UNC policy, relative traversal, case-insensitive collisions, symlink/junction and path length handled |
| NFR-002 | No destructive overwrite | Destination existing / nonempty => refuse; only delete generator-owned marked staging content |
| NFR-003 | Reproducibility | Persist resolved exact versions, adapter IDs, source/template hashes, manager lockfiles; avoid floating latest in final manifest |
| NFR-004 | Secrets | OS secure storage for Forma credentials; never embed auth token into repo, manifest, URL or logs |
| NFR-005 | Process isolation | Explicit allowlisted executables and argv; no concatenated shell commands; scopes minimal |
| NFR-006 | Error transparency | Errors have stage, stable code, remedial action and whether target changed |
| NFR-007 | Accessibility | Keyboard navigation, focus retention, readable text, live region for job progress, reduced motion |
| NFR-008 | Offline-first | Local generation possible only with cached prerequisites; no hidden cloud dependency |
| NFR-009 | Reliability | Cancellation terminates owned process tree, handles Windows locks, leaves existing content untouched |
| NFR-010 | No false readiness | `tested` requires evidence of independent builds and real smoke; no claims from install success alone |
| NFR-011 | Supply chain | Pin template commits/releases; verify checksums; restrict downloads; no unreviewed script injection |
| NFR-012 | Privacy | Telemetry off by default; logs local and redact secrets; user controls file retention |

## 7. Proposed technical approach (pending architecture sign-off)

- Desktop: Tauri 2 + React + TypeScript + Vite.
- Core engine: TypeScript CLI, invoked through the Phase 02.6 fixed-command Tauri bridge; system-Node and bundled-Node installers have same-host Windows 11 PoC evidence, but packaged runtime/Node prerequisite strategy **is not finalized** pending clean-machine proof and review.
- Config validation: strict schema versioning and explicit migrations.
- Adapters: built-in, reviewed, versioned manifests and implementations; no arbitrary third-party executable plugins in V1.
- Project jobs: `plan → preflight → stage → scaffold → configure → install → validate → finalize → report`.
- Storage: JSON files and local project history; choose SQLite only if durable concurrent history needs justify it.
- Forma: remain separate repo; private GitHub auth via secure store; install local project artifacts through existing vetted installer contract.

See [`ARCHITECTURE.md`](ARCHITECTURE.md) for component boundaries, Windows staging and process/runtime tradeoffs; see adapter contract for minimum TypeScript interfaces, job status semantics, storage isolation and failure behavior. Future UI behavior is specified in [`../design.md`](../design.md).

## 8. Key risks and mitigation

1. **Combinatorial explosion:** only specific published recipes get `tested`, not all cartesian products.
2. **Official CLIs evolve:** adapter pins versions and has nightly/periodic compatibility runs before upgrade.
3. **Mixed languages:** avoid pretending npm manages Composer/Go/uv; use root orchestrator only for convenience scripts.
4. **Forma framework lock-in:** no React templates on Vue/Angular/mobile until converted and tested.
5. **Untrusted installer scripts:** present command plan and respect explicit consent for code/network activity; official tooling can execute install hooks.
6. **Windows path/shell issues:** strict validation and independent Windows smoke per recipe.
7. **Dependencies not installed:** distinguish project generated from environment ready; display recovery steps.
8. **Repository docs drift:** trace requirements to acceptance tests and actual release evidence.

## 9. Example launch recipes (targets; not tested yet)

- FE-01 React + Vite + npm + plain CSS.
- FE-02 Next App Router + npm + Tailwind.
- FE-03 Vue + Vite + npm + plain CSS.
- FE-04 React + Vite + npm + Bootstrap 5 CSS.
- FE-05 Vue + Vite + npm + Bootstrap 5 CSS.
- FE-06 Nuxt + npm + CSS.
- FE-07 Angular + npm + SCSS.
- BE-01 proposed target: Express + npm + SQLite + Drizzle (verify selected driver). Phase 05A is narrower: standalone API with no database; it does not claim this tuple.
- BE-02 Go standard-library `net/http` + Go Modules, standalone with no database or third-party dependencies (Phase 05B implementation; remains planned pending independent acceptance).
- BE-03 NestJS + npm + PostgreSQL + Prisma.
- BE-04 standalone Go + Gin `v1.12.0` + Go Modules, Go `>=1.25.0`; no database, ORM, authentication, Docker, or frontend.
- BE-05 Laravel + MySQL + Eloquent (Composer + npm for assets as relevant).
- BE-06 target: FastAPI + PostgreSQL + SQLAlchemy (uv). Phase 05C.1 is narrower: standalone FastAPI API with no database/ORM; it does not implement or verify this database target.
- FS-01 Vue + Laravel + MySQL.
- FS-02 React + Go Gin + PostgreSQL.
- FS-03 Angular + NestJS + PostgreSQL.
- FS-04 Next + NestJS + PostgreSQL.
- FS-05 React + Express + MongoDB + Mongoose.
- FM-01 React + Vite + Forma; FM-02 Next.js App Router + Forma. Generator local development integration exists for the exact template/framework combinations in [Phase 02 evidence](qa/evidence/phase-02-forma-local-integration.md); all remain planned.

Each recipe requires a specific integration test and may be disabled until that evidence exists. All DB recipes must declare what is provisioned vs configured only.

**Recipe ID reconciliation (Phase 05B):** The earlier draft assigned BE-02 to NestJS. Scoped Phase 05B work assigns BE-02 to the standalone Go standard-library API; NestJS and subsequent backend candidates move down one ID as listed above. This corrects the planning registry to match the implemented catalog and does not imply support for any planned recipe.

**BE-04 scope decision (Phase 05D.2):** BE-04 is standalone Go + Gin + Go Modules with no database/authentication. PostgreSQL + pgx remains separate proposed database/fullstack scope; FS-02 remains React + Go Gin + PostgreSQL and is not implemented or verified by BE-04.

**Phase 06B implementation reconciliation:** BE-01 remains database-free and BE-07 remains Express + SQLite + Drizzle. BE-08 is a separate planned Express + npm + PostgreSQL 16+ + Drizzle recipe; it does not implement or verify other proposed PostgreSQL pairings or fullstack recipes. Its generation/startup/health paths are DB-free, and explicit guarded migration/live CRUD acceptance remains separately gated.

**Phase 06C implementation reconciliation:** BE-09 is separate planned NestJS 11 + npm + PostgreSQL 16+ + Drizzle. BE-03 remains database-free; BE-07 and BE-08 remain unchanged. Phase 06C CLI E2E passed against run-owned PostgreSQL 17.2 on loopback port `57573`, covering guarded migration and CRUD; BE-08 E2E ran separately in Phase 06B. Final native Desktop E2E r9 passed (exit `0`, 116/116 assertions) without PostgreSQL: dual consent, normal generation, live npm `stageId=installing`, cancellation while matching npm PID was active, PID exit, absent target/staging, empty recovery, and collision blocking with sentinel preserved. Generated manifest retains `recipeStatusAtCreation: planned`. r1 covered generation/collision only; r5 cancellation follow-up verified process exit and cleanup but its harness failed on a missing UI attribute; R6–R8 were harness/resource/readiness/status-selector failures corrected in r9 without weakening key assertions. BE-09 preflight conservatively rejects predicted staged `esbuild.exe` paths over 240 characters; regression rejects 261 and accepts 219. This does not prove Windows' maximum path length or the 261-character `ENOENT` root cause. Independent review: **PASS WITH FINDINGS, no product blocker; Phase 06C development closure: GO**. PostgreSQL 16 and clean-machine/installer acceptance remain untested; npm lifecycle scripts remain unsandboxed and direct Drizzle Kit migration can bypass the wrapper. BE-09 remains `planned`; public release remains **NO-GO**.

## 10. Release gates

- R0: Architecture, adapter interface, security boundaries, matrix and PRD approved; Windows CI bootstrapped.
- R1 CLI: A frontend and a backend sample independently generated with documented versions and no manual fixes.
- R2 Multi-stack: At least one end-to-end cross-language fullstack recipe builds, its API route responds, and docs match generated files.
- R3 Ecosystem breadth: Every recipe claimed in the shipped V1 product is verified individually on Windows; blocked/future options not presented as selectable.
- R4 Desktop: GUI controls all core flows without needing terminal, with cancellation and actionable errors.
- R5 Release: Installer signed or trust/unsigned warning disclosed; privacy/security checklist, rollback tests, accessibility and regression evidence.

**No numerical performance SLA or platform minimum version has been falsely certified at this planning stage**; benchmark and pin supported runtime versions during adapter implementation.

## 11. Open decisions

- OPEN-001: Node CLI runtime: require system Node in V1 or bundle engine as sidecar? Phase 02.6 measured both package modes on one Windows 11 host; clean-machine and independent review still required.
- OPEN-002: Stable public repo name/branding and licensing.
- OPEN-003: Public plugin SDK and sandbox, deliberately excluded from V1.
- OPEN-004: Review Git Credential Manager-based Forma access scope, cache protections, and entitlement policy; CLI does not store or accept credentials.
- OPEN-005: Whether V1 shipping minimum must include every named catalog framework, or only tested prioritized presets; recommendation: tested presets govern availability.
- OPEN-006: How to expose project-level validation for `existing-service` databases without mandatory local DB process.

## 12. Traceability

- `PRD-003–006` → compatibility matrix / adapter capability records.
- `PRD-007–020` → adapter contract / environment doctor / QA GEN tests.
- `PRD-021` → Forma integration tests / credential handling.
- `PRD-014` → docs-mode acceptance tests / generated content truthfulness.
- `NFR-001–012` → QA security and Windows filesystem tests.

Changes to project direction, runtime/security boundary, package defaults, plugin execution model and release scope require their own decision record.
