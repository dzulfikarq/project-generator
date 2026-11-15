# Roadmap — Project Generator Desktop V1

Status: **Phase 01 bounded acceptance, Phase 02 local Forma integration/evidence, Phase 03 internal UI implementation, Phase 04A–04B.3 frontend evidence, Phase 05A BE-01 evidence, Phase 05B BE-02 evidence, and Phase 05C.2/05C.3 BE-06/BE-05 bounded evidence present; Phase 05C development scope closed after bounded independent BE-05 review; broader acceptance remains partial, no recipe release-approved.** Date: 2026-11-15.

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
- Remaining backend breadth: NestJS (BE-03), Fastify, and Go Gin (BE-04). Phase 05B reconciles the draft IDs: NestJS is BE-03, Go Gin BE-04, Laravel BE-05, and FastAPI BE-06.
- DB drivers: PostgreSQL, MySQL/MariaDB, SQLite, MongoDB, with verified ORM pairings and real service checks.
- **Phase 05A/05B gate: GO for independent BE-01/BE-02 review; NO-GO for promotion/release. Phase 05C.2 gate: GO for independent BE-06 review only; NO-GO for promotion/release. Phase 05C.3: GO for development closure after bounded independent BE-05 evidence review; NO-GO for promotion/release.** Next scoped backend work: BE-03 NestJS and BE-04 Go Gin only; no fullstack expansion or recipe promotion.
- Output: distinct backend-only recipes earning tested status; no DB readiness claims without available DB.

## Phase 6 — Fullstack composition

- Implement workspace builder, frontend→backend API sample, environment templates, root dev commands, optional Docker Compose.
- Prove Vue+Laravel+MySQL and React+Go+PostgreSQL before expanding; then Angular+Nest and Next+Nest.
- Output: individually tested cross-language fullstack recipes.

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
