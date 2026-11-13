# Roadmap — Project Generator Desktop V1

Status: **Phase 01 bounded acceptance, Phase 02 local Forma integration/evidence, Phase 03 internal UI implementation, and Phase 04A Vue/Bootstrap expansion present; UI acceptance partial, no recipe release-approved.** Date: 2026-11-13.

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

- **Phase 04A implemented locally:** Vue 3 + Vite + TypeScript via integrity-pinned official `create-vue`; React/Vue Bootstrap 5 CSS pins; npm-only FE-03–FE-05; desktop catalog/wizard; invalid combinations blocked. Local E2E does not promote recipes. See [DEC-021](decisions/DEC-021-phase-04a-vue-bootstrap.md) and [QA evidence](qa/evidence/phase-04a-vue-bootstrap-expansion.md).
- **Phase 04B recommendation:** independent acceptance/review of FE-01–FE-05 and closure of per-recipe gaps before framework expansion. Keep Nuxt, Angular, extra styles, and non-npm managers deferred until separately scoped and verified.
- Remaining breadth: Nuxt, Angular, framework-specific components after checks. npm remains Node default; native package managers remain required for non-Node ecosystems.
- Output: independently accepted recipes only; block invalid styling/manager choices.

## Phase 5 — Backend and DB breadth

- Express, NestJS, Fastify, Go Gin, Laravel, FastAPI adapters.
- DB drivers: PostgreSQL, MySQL/MariaDB, SQLite, MongoDB, with verified ORM pairings and real service checks.
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
