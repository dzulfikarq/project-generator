# Roadmap — Project Generator Desktop V1

Status: **Phase 01 bounded acceptance, Phase 02 local Forma integration/evidence, Phase 03 internal UI implementation, Phase 04A–04B.3 frontend evidence, Phase 05A–05D.2 and Phase 06A evidence present; Phase 06A and Phase 06B development closures GO; Phase 06B independent acceptance PASS WITH FINDINGS; Phase 06C independent review PASS WITH FINDINGS, no product blocker, and development closure GO; Phase 07A independent acceptance PASS WITH FINDINGS and development closure GO; Phase 07B independent acceptance PASS WITH FINDINGS and development closure GO; broader acceptance remains partial, no recipe release-approved.** Date: 2026-11-19.

## Phase 0 — Specification and governance

- Finalize PRD, adapter interface, matrix, selected first recipes, decision governance and Windows security acceptance.
- Decide system Node vs bundled sidecar through an executable packaging PoC.
- Output: approved baseline; no scope drift from unsanctioned agent implementation.

Architecture specification: [`ARCHITECTURE.md`](ARCHITECTURE.md). UX specification: [`../design.md`](../design.md). Scoped first-coding-agent handoff: [`implementation/PHASE-01-AGENT-PROMPT.md`](implementation/PHASE-01-AGENT-PROMPT.md). These are **drafts**, not completed implementation.

## Phase 1 — CLI kernel and first vertical slice

- Implemented: strict config/resolver, read-only plan, doctor, owned staging/finalize, scoped process runner, JSONL jobs, cancellation, generated docs/manifest, FE-01 and FE-02 adapters.
- Local Windows E2E evidence exists for FE-01 and FE-02, using the explicit development-only planned-recipe override; see [QA evidence](qa/acceptance-matrix.md).
- **Phase gate remains open:** broader security acceptance, independent review, and recipe promotion have not occurred. Both recipes stay `planned` and blocked in normal generation.

## Phase 2 — Forma integration (local development; implementation present)

- Integrate private `dzulfikarq/design-templates` catalog through its existing portable exporter and installer; do not duplicate either implementation or modify Forma.
- Fetch with authenticated Git access, pin full immutable commit SHA, verify exported SHA-256 manifest, and cache by source commit/template/version/integrity. Never persist credentials in config, cache metadata, logs, or generated projects.
- Add opt-in template selection to config, resolver, plan, and CLI. Initially allow only Forma entries marked `tested` for the selected React + Vite or Next.js adapter; reject every incompatible pair before writes or network access.
- Run Forma installation inside Project Generator's owned staging transaction; preserve cancellation, journal recovery, no-overwrite, and existing non-Forma generation. npm remains generated-project default; disclose and require explicit `generate` consent for lifecycle scripts.
- Local Windows E2E covers Staywise and Modern Admin on both frameworks, Focus Planner on React + Vite, plus standalone FE-01 regression. npm install, typecheck/build, HTTP smoke, and supported browser smokes passed; lint is unavailable in Forma installs. Use the development-only planned-recipe override; keep FE-01/FE-02/FM-01/FM-02 `planned` and do not promote recipes. See [Phase 02 evidence](qa/evidence/phase-02-forma-local-integration.md).
- Process-crash recovery is the accepted local-development model; power-loss durability is not claimed. Second-account ACL denial remains a public-release gate.
- Output: evidence-backed local FM-01/FM-02 integrations using the FE-01/FE-02 framework adapters; no desktop UI, framework expansion, or public-release approval.

## Phase 3 — Desktop UI MVP (internal)

- Build dashboard, catalog-driven multi-step wizard, Forma metadata gallery, read-only plan/doctor review, consent-gated generation, event/result surface, local recent-project metadata, and basic appearance/destination settings.
- Show only adapters actually present in the runtime catalog as real choices. Backend, database, unverified package managers, and future frameworks remain visibly unavailable; do not add adapters or promote FE/FM recipes.
- Validate UI state, forms, compatibility, consent, accessibility semantics, CLI-backed plan/doctor/generation, cancellation, and failure/recovery behavior. Preserve no-overwrite and journal recovery boundaries. Track unrun native generation and accessibility gates explicitly.
- Output: internal UI MVP implementation; phase gate remains open until independent evidence and review. Clean-machine and public-release gates remain open.

## Phase 4 — Web/frontend breadth and styling

- **Phase 04A local acceptance complete:** Vue 3 + Vite + TypeScript via integrity-pinned official `create-vue`; React/Vue Bootstrap 5 CSS pins; npm-only FE-03–FE-05; native desktop flows passed; incompatible combinations blocked. Local E2E does not promote recipes. See [DEC-021](decisions/DEC-021-phase-04a-vue-bootstrap.md) and [Phase 04A acceptance evidence](qa/evidence/phase-04a-native-desktop-acceptance.md).
- **Phase 04B scope:** [DEC-022](decisions/DEC-022-phase-04b-nuxt-angular.md) authorizes only FE-06 Nuxt 4/CSS and FE-07 Angular 21/SCSS implementation plus local evidence gathering. Both remain `planned`; normal generation remains blocked. DEC-023 separately authorizes FE-08–FE-11 only. DEC-024 separately authorizes FE-12–FE-15 only; no other frameworks, component libraries, package managers, recipe promotion, or release are in scope.
- Phase 04B CLI/native desktop verification, release-gate evidence, and limitations: [FE-06/FE-07 report](qa/evidence/phase-04b-nuxt-angular.md). Local runs do not establish independent acceptance or promote recipes.
- **Phase 04B.2 local acceptance passed:** FE-08 React/Vite + SCSS, FE-09 Vue/Vite + SCSS, FE-10 React/Vite + Tailwind CSS 4, and FE-11 Vue/Vite + Tailwind CSS 4 passed bounded CLI/native checks with npm. All remain `planned`; see [DEC-023](decisions/DEC-023-phase-04b2-scss-tailwind.md) and [acceptance evidence](qa/evidence/phase-04b2-scss-tailwind.md).
- **Phase 04B.3 local acceptance passed:** FE-12 React/Vite + Yarn, FE-13 Vue/Vite + Yarn, FE-14 React/Vite + pnpm, and FE-15 Vue/Vite + pnpm passed bounded CLI/native checks with Plain CSS. All remain `planned`; npm remains default. See [DEC-024](decisions/DEC-024-phase-04b3-yarn-pnpm.md) and [acceptance evidence](qa/evidence/phase-04b3-yarn-pnpm.md).
- **Phase 04B.3 gate: GO for independent recipe review/acceptance only.** Do not expand scope, promote FE-12–FE-15, or approve release without separate authorization and independent evidence. Existing clean-machine and security gates remain open.
- Output: independently accepted recipes only; block invalid styling/manager choices.

## Phase 5 — Backend and DB breadth

- **Phase 05A local acceptance passed for BE-01 standalone Express + TypeScript + npm, no database.** CLI and Tauri flows passed pinned dependency integrity, tests/typecheck/build/HTTP/shutdown checks, consent, result/history/open actions, cancellation, and collision controls. BE-01 remains `planned`; see [DEC-025](decisions/DEC-025-phase-05a-express-rest-api.md) and [Phase 05A evidence](qa/evidence/phase-05a-express-rest-api.md).
- **Phase 05B bounded local CLI/native acceptance and final regressions complete for BE-02 standalone Go `net/http` + Go Modules.** BE-02 remains planned.
- **Phase 05C.1 implemented BE-06; Phase 05C.2 bounded local evidence passed.** This slice is standalone FastAPI/Pydantic/Uvicorn + uv, no database/ORM/auth/fullstack. Isolated CPython 3.14.10 and uv 0.13.8 passed local CLI/native generation, lock/install, Python/API checks, cancellation, and collision checks. Pins remain provisional and independent review is pending; BE-06 stays planned and release-blocked. See [DEC-027](decisions/DEC-027-phase-05c1-fastapi.md), [Phase 05C.1 evidence](qa/evidence/phase-05c1-fastapi.md), and [Phase 05C.2 evidence](qa/evidence/phase-05c2-fastapi-toolchain-native.md).
- Phase 05C.3 implemented BE-05 standalone Laravel 12/PHP/Composer + MySQL/Eloquent. Bounded acceptance passed against isolated portable MySQL 8.4.13 at `127.0.0.1:3307`, including explicit migration, Eloquent CRUD, PHPUnit integration (4 tests/22 assertions), negative checks, isolation, and cleanup. Bounded independent evidence review passed; Phase 05C development scope is closed. BE-05 remains `planned`, with no promotion or release approval; see [DEC-028](decisions/DEC-028-phase-05c3-laravel.md) and [evidence](qa/evidence/phase-05c3-laravel.md).
- Phase 05D.1 implemented standalone BE-03 NestJS 11/TypeScript/npm with pinned official CLI, API config/error/shutdown behavior, and bounded Windows CLI/native acceptance. Independent evidence review remains pending; BE-03 stays `planned` and release-blocked; see [DEC-029](decisions/DEC-029-phase-05d1-nestjs.md) and [evidence](qa/evidence/phase-05d1-nestjs.md).
- **Phase 05D.2 bounded local Windows CLI/native acceptance passed** for standalone BE-04 Go + Gin `v1.12.0` + Go Modules (Go `>=1.25.0`), no database/auth. Independent evidence review remains pending; BE-04 stays `planned`, and normal/release generation stays blocked. See [DEC-030](decisions/DEC-030-phase-05d2-go-gin.md) and [evidence](qa/evidence/phase-05d2-go-gin.md). FS-02 PostgreSQL/pgx remains separate future fullstack scope.
- Remaining backend breadth: Fastify. Phase 05B reconciles the draft IDs: NestJS is BE-03, Go Gin BE-04, Laravel BE-05, and FastAPI BE-06.
- DB drivers: PostgreSQL, MySQL/MariaDB, SQLite, MongoDB, with verified ORM pairings and real service checks.
- **Phase 05A/05B gate: GO for independent BE-01/BE-02 review; NO-GO for promotion/release. Phase 05C.2 gate: GO for independent BE-06 review only; NO-GO for promotion/release. Phase 05C.3: GO for development closure after bounded independent BE-05 evidence review; NO-GO for promotion/release. Phase 05D.1: GO for independent BE-03 evidence review only; NO-GO for promotion/release. Phase 05D.2: GO for bounded BE-04 implementation/evidence only; NO-GO for recipe promotion/release.** No fullstack expansion; FS-02 remains separate proposed PostgreSQL/pgx scope.
- Output: distinct backend-only recipes earning tested status; no DB readiness claims without available DB.

## Phase 06A — Standalone Express + SQLite + Drizzle

- Implemented BE-07 as a distinct Express/npm/SQLite/Drizzle recipe with pinned dependencies, generated schema/config/CRUD starter, and migration SQL. BE-01 remains Express with no database.
- Bounded Windows CLI/native acceptance and release-policy verification passed. Migrations are never applied during generation or app startup; generator smoke uses `:memory:`, while migration/CRUD acceptance uses a disposable isolated database.
- Final independent post-remediation runtime acceptance passed; **Phase 06A development closure: GO**. BE-01 and BE-07 remain `planned`; public release remains NO-GO. Phase 06A did not approve another database pairing or fullstack composition. See [DEC-031](decisions/DEC-031-phase-06a-express-sqlite-drizzle.md) and [evidence](qa/evidence/phase-06a-express-sqlite-drizzle.md).

## Phase 06B — Standalone Express + PostgreSQL + Drizzle

- Implemented BE-08 as a separate planned Express/npm/PostgreSQL 16+/Drizzle recipe. Exact direct pins and npm integrity metadata, desktop/Tauri mapping, focused tests, and system/bundled packaged release policy passed.
- Generation, startup, and `/health` are designed to remain DB-free. Explicit migration requires the guarded `--target host:port/database` wrapper and connected-identity checks.
- Initial timeout was harness false failure: pipe-backed `spawnSync` timed out after `pg_ctl` reported success and PostgreSQL was ready. File-backed capture fixed startup. Final independent acceptance reran the full E2E on PostgreSQL `17.2`, run-owned loopback port `62859`; generation, DB-free smoke, guarded migration, CRUD, rollback, cancellation, collision, and BE-01/BE-07 regressions passed. P3 stdout-FD leak on stderr-open failure was fixed and targeted regression passed. Port `5432` remained untouched. PostgreSQL `16` was not independently tested.
- **Phase 06B independent acceptance: PASS WITH FINDINGS; development closure: GO.** BE-01, BE-07, and BE-08 remain `planned`; no promotion. Unsandboxed lifecycle scripts, direct Drizzle Kit migration bypass, and non-cryptographic target identity checks remain disclosed. Clean-machine/installer acceptance remains open; public release remains NO-GO. See [DEC-032](decisions/DEC-032-phase-06b-express-postgresql-drizzle.md) and [evidence](qa/evidence/phase-06b-express-postgresql-drizzle.md).

## Phase 06C — Standalone NestJS + PostgreSQL + Drizzle

- Implemented BE-09 as a distinct NestJS 11/npm/PostgreSQL 16+/Drizzle recipe. BE-03 remains database-free; BE-07 remains Express/SQLite/Drizzle; BE-08 remains Express/PostgreSQL/Drizzle.
- Phase 06C CLI E2E passed with Node `22.22.1`, PostgreSQL `17.2`, and a run-owned loopback cluster on port `57573`, including migration and CRUD. Port `5432` was not selected; the cluster stopped cleanly. BE-08 E2E ran separately in Phase 06B; it is not part of the Phase 06C harness.
- Final native Desktop E2E r9 passed (exit `0`, 116/116 assertions) without PostgreSQL. It verified dual consent, normal BE-09 generation, live `stageId=installing`, cancellation while matching npm PID was active, PID exit, absent target/staging, empty recovery, and collision `BLOCKED` with sentinel preserved. Manifest kept BE-09 `planned`. r1 covered generation/collision only; r5 follow-up verified npm cancellation/cleanup although its harness failed on a missing UI attribute. R6–R8 failures were harness/resource/readiness/status-selector issues corrected in r9 without weakening key assertions.
- System and bundled Node release-policy checks passed; BE-09 remains blocked before staging in release builds. Long-path preflight conservatively rejects predicted staged `esbuild.exe` paths over 240 characters; regression rejects 261 and accepts 219. This does not prove a Windows maximum or the observed 261-character `ENOENT` root cause. PostgreSQL `16` and clean-machine/installer acceptance remain untested. Independent review: **PASS WITH FINDINGS, no product blocker**; **Phase 06C development closure: GO**. BE-09 remains `planned`, with no recipe promotion or public release approval. Unsandboxed npm lifecycle code and direct Drizzle Kit migration bypass remain disclosed. See [DEC-033](decisions/DEC-033-phase-06c-nest-postgresql-drizzle.md) and [evidence](qa/evidence/phase-06c-nest-postgresql-drizzle.md).

## Phase 6 — Fullstack composition

- Implement workspace builder, frontend→backend API sample, environment templates, root dev commands, optional Docker Compose.
- Prove Vue+Laravel+MySQL and React+Go+PostgreSQL before expanding; then Angular+Nest and Next+Nest.
- Output: individually tested cross-language fullstack recipes.

## Phase 07A — React/Vite + Express + PostgreSQL + Drizzle (FS-06)

- Implemented FS-06 as one npm workspace/root lockfile, distinct from FS-02 and standalone BE-08/BE-09. PostgreSQL 16+ remains user-provided; generation/startup/health do not connect or migrate; migration requires explicit guarded target confirmation.
- Bounded Windows CLI E2E passed against run-owned PostgreSQL `17.2` at `127.0.0.1:64604`. Independent CLI E2E passed against PostgreSQL `17.2` at `127.0.0.1:58068`; independent Chrome browser E2E passed against a separate PostgreSQL `17.2` instance at `127.0.0.1:55480`, covering React → Express → PostgreSQL CRUD, loading/empty states, API/database outages, credential sanitization, and clean shutdown. Native Desktop E2E passed 66/66 assertions for review, consent, generation flow, cancellation, collision, and recovery. PID `5172` was observed live before cancel and absent after the cancelled terminal result; this does not prove cancellation caused process termination. System/bundled release-policy checks blocked planned FS-06 before staging. See [DEC-034](decisions/DEC-034-phase-07a-fullstack-react-express-postgresql.md) and [evidence](qa/evidence/phase-07a-react-express-postgresql-drizzle.md).
- Independent acceptance: **PASS WITH FINDINGS**; Phase 07A development closure: **GO**. FS-06 remains `planned`; public release remains **NO-GO**. PostgreSQL `16` is **NOT VERIFIED**. Clean-machine/installer acceptance, accessibility, and broader security review remain open; npm lifecycle scripts remain unsandboxed and direct Drizzle Kit migration can bypass wrapper checks. This slice does not complete all Phase 6 fullstack combinations or approve release.

## Phase 07B — Vue/Vite + Express + PostgreSQL + Drizzle (FS-07)

- Implemented FS-07 as a distinct one-workspace/root-lockfile Vue 3/Vite + Express/PostgreSQL/Drizzle recipe; FS-06 remains unchanged. Node intersection is `22.18+` or `24.12+`; PostgreSQL `16+` remains user-provided.
- Bounded local Windows CLI/PostgreSQL/Chrome E2E passed on Node `22.22.1`, npm `10.9.4`, and run-owned PostgreSQL `17.2` at `127.0.0.1:58945`; port `5432` excluded. Independent CLI/PostgreSQL/Chrome acceptance also passed on PostgreSQL `17.2` at `127.0.0.1:52457`; port `5432` remained untouched. Vue SFC checks, lock integrity, DB-free startup/health, guarded migration/CRUD/rollback, cancellation, collision, plan regressions, browser CRUD/outages, and credential checks passed.
- The earlier native Tauri/WebView2 suite passed **68/68 assertions** without PostgreSQL for review, consent, npm-install cancellation, recovery, and collision; it did not verify successful generation. A separate native success-wrapper attempt failed only at its activity-event assertion on the result page and is not counted as PASS. After replacing it with result-page hero/status/validation and manifest assertions, `npm run test:e2e:phase-07b:native-success` passed **40/40**; the generated FS-07 manifest records **15/15 validations passed**. The observation does not extend cancellation causality evidence.
- `npm run test:policy:phase-07b` passed for system and bundled Node; release-profile policy blocked planned FS-06/FS-07 (and BE-08/BE-09) before staging. **Independent acceptance: PASS WITH FINDINGS; Phase 07B development closure: GO.** FS-07 remains `planned`; public release remains **NO-GO**. PostgreSQL `16`, unsandboxed npm lifecycle scripts, direct Drizzle Kit migration bypass, clean-machine/installer, accessibility, and broader security review remain open. See [DEC-035](decisions/DEC-035-phase-07b-fullstack-vue-express-postgresql.md) and [evidence](qa/evidence/phase-07b-fullstack-vue-express-postgresql.md).

## Phase 7 — Windows release

- Complete clean-machine packaging, security and accessibility review; run path collision/cancel tests and Windows installer smoke.
- Output: Windows first release containing **only tested recipes**.

## V1.1 — Mobile support

- Expo / React Native, Flutter, SDK and emulator checks, mobile-oriented styling and build limits.
- Native iOS builds on Windows remain unsupported; do not imply otherwise.

## Phase gate rules

- A phase is done when its stated measurable checks pass, not when source code is merged.
- A failed or untested adapter does not block release of unrelated *tested* recipes; it remains cataloged/disabled.
- No release date promised at this stage. Scope may be split into incremental V1 minor releases instead of a single large batch.
