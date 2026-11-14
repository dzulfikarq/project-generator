# DEC-024 — Phase 04B.3 Yarn and pnpm Recipes

| Field | Value |
|---|---|
| Status | User-authorized implementation and bounded local CLI/native acceptance complete; independent recipe review pending |
| Date | 2026-11-14 |
| Scope | FE-12 React/Vite + Yarn; FE-13 Vue/Vite + Yarn; FE-14 React/Vite + pnpm; FE-15 Vue/Vite + pnpm; Plain CSS only |
| Evidence | [Phase 04B.3 report](../qa/evidence/phase-04b3-yarn-pnpm.md) |

## Decision

- Add only FE-12–FE-15 to existing CLI/core and Forge Studio pipeline. Keep all FE recipes `planned`; normal generation and release builds remain blocked.
- Keep npm as Node's default and preserve all existing npm recipes and Forma npm-only behavior.
- Pin Yarn `4.18.1` via `@yarnpkg/cli-dist` and pnpm `11.28.11` via integrity-checked npm packages. Continue using npm only to stage these manager CLIs and the integrity-pinned official scaffold; install generated-project dependencies with the selected manager.
- Use official `create-vite@9.3.4` React TypeScript and `create-vue@3.24.0` TypeScript/ESLint scaffolds. Add no additional styling, frameworks, backends, or package managers.
- Persist Yarn's `node-modules` linker in `.yarnrc.yml`; persist pnpm's `hoisted` linker in `pnpm-workspace.yaml`. Validate exactly one selected lockfile and record its SHA-256 in the generated manifest.
- Preserve read-only planning, exact compatibility checks, planned-recipe gates, lifecycle-script disclosure/consent, Supervisor/recovery, no-replace finalization, cancellation, and provenance/check records.

## Rationale and risks

Native FE-14 generation with pnpm's isolated layout failed Vite `8.3.8` build on Node `22.22.1` with `ERR_PACKAGE_IMPORT_NOT_DEFINED` for `#module-sync-enabled`. pnpm's hoisted layout passed the same CLI recipe checks. The generated workspace config keeps the workaround stable for later installs; it does not establish compatibility with every pnpm layout or Node version.

Yarn and pnpm lifecycle scripts remain unsandboxed and run only after explicit consent. Local E2E does not establish independent acceptance, support status, security approval, or release readiness. Recipe promotion and release approval are not authorized.

## Phase gate

**GO for independent recipe review and acceptance only.** FE-12–FE-15 remain planned; public release remains **NO-GO** pending independent review and existing security/clean-machine gates.
