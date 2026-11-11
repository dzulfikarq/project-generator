# Roadmap — Project Generator Desktop V1

Status: **Proposed.** No implementation claimed. Date: 2026-11-11.

## Phase 0 — Specification and governance

- Finalize PRD, adapter interface, matrix, selected first recipes, decision governance and Windows security acceptance.
- Decide system Node vs bundled sidecar through an executable packaging PoC.
- Output: approved baseline; no scope drift from unsanctioned agent implementation.

Architecture specification: [`ARCHITECTURE.md`](ARCHITECTURE.md). UX specification: [`../design.md`](../design.md). Scoped first-coding-agent handoff: [`implementation/PHASE-01-AGENT-PROMPT.md`](implementation/PHASE-01-AGENT-PROMPT.md). These are **drafts**, not completed implementation.

## Phase 1 — CLI kernel and first vertical slice

- Implement typed config, capability resolver, read-only plan, Windows preflight, staging, safe subprocess bridge, structured events and cancellation.
- Prove FE-01 React+Vite (npm/CSS) and FE-02 Next (npm/Tailwind) in clean folders; testing status earned independently.
- Output: fully usable CLI independent of desktop.

## Phase 2 — Web/frontend breadth and styling

- Add Vue+Vite, Nuxt, Angular adapters; CSS/SCSS, Tailwind, Bootstrap; framework-specific components after checks.
- Implement npm default with Yarn/pnpm/Bun per-recipe support checks; pin CLI versions.
- Output: tested frontend recipes; blocked invalid styling/manager choices.

## Phase 3 — Backend and DB breadth

- Express, NestJS, Fastify, Go Gin, Laravel, FastAPI adapters.
- DB drivers: PostgreSQL, MySQL/MariaDB, SQLite, MongoDB, with verified ORM pairings and real service checks.
- Output: distinct backend-only recipes earning tested status; no DB readiness claims without available DB.

## Phase 4 — Fullstack composition

- Implement workspace builder, frontend→backend API sample, environment templates, root dev commands, optional Docker Compose.
- Prove Vue+Laravel+MySQL and React+Go+PostgreSQL before expanding; then Angular+Nest and Next+Nest.
- Output: individually tested cross-language fullstack recipes.

## Phase 5 — Forma integration and documentation generator

- Integrate authenticated private registry, safe local cache, SHA/manifest checks, supported React/Next installer.
- Implement Minimal/Standard/Full truthful document templates and decision register scaffolding.
- Output: FM-01/FM-02 independent generator end-to-end validation.

## Phase 6 — Desktop UI / Windows release

- Tauri 2 desktop wizard, template catalogue, configuration preview, project history, settings/credentials in secure storage, progress logs, cancel/open project.
- Run security review, accessibility checks, path collision/cancel tests and Windows installer smoke.
- Output: Windows first release containing **only tested recipes**.

## V1.1 — Mobile support

- Expo / React Native, Flutter, SDK and emulator checks, mobile-oriented styling and build limits.
- Native iOS builds on Windows remain unsupported; do not imply otherwise.

## Phase gate rules

- A phase is done when its stated measurable checks pass, not when source code is merged.
- A failed or untested adapter does not block release of unrelated *tested* recipes; it remains cataloged/disabled.
- No release date promised at this stage. Scope may be split into incremental V1 minor releases instead of a single large batch.
