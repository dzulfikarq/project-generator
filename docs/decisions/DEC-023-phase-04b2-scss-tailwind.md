# DEC-023 — Phase 04B.2 React/Vue Vite SCSS and Tailwind Recipes

| Field | Value |
|---|---|
| Status | Implementation and bounded local acceptance complete; independent recipe review pending |
| Date | 2026-11-14 |
| Scope | FE-08 React/Vite + SCSS; FE-09 Vue/Vite + SCSS; FE-10 React/Vite + Tailwind CSS 4; FE-11 Vue/Vite + Tailwind CSS 4; npm only |
| Evidence | [Phase 04B.2 report](../qa/evidence/phase-04b2-scss-tailwind.md) |

## Decision

- Add only FE-08–FE-11 to existing CLI/core and Forge Studio pipeline. Keep every recipe `planned`; normal generation and release builds remain blocked.
- Use official `create-vite@9.3.4` React TypeScript scaffold and official `create-vue@3.24.0` TypeScript/ESLint scaffold. Keep npm as package manager.
- Pin Dart Sass `sass@1.108.2` for FE-08/FE-09 and Tailwind CSS `tailwindcss@4.3.5` plus official `@tailwindcss/vite@4.3.5` for FE-10/FE-11. Preserve npm registry integrity in recipe manifests and generated lockfile validation.
- Import and use generated SCSS and Tailwind utilities. Verify SCSS selectors and Tailwind utility rules occur in production CSS before finalization.
- Preserve Plain CSS and Bootstrap recipes. Do not add Nuxt/Angular styling recipes, component libraries, package managers, backends, or full-stack combinations.
- Preserve exact compatibility rejection, read-only plans, planned-recipe gates, consent, Supervisor/recovery, no-replace finalization, cancellation, and provenance/check records.

## Rationale and risks

The official Tailwind Vite plugin peer range is `^5.2.0 || ^6 || ^7 || ^8`, compatible with the Vite 8 ranges declared by both pinned scaffolds. Tailwind v4 uses `@import "tailwindcss"` and automatic source detection; no legacy config or content globs are generated. Sass is official Dart Sass, implemented by the `sass` npm package.

Reference pins were verified against official [Sass documentation](https://sass-lang.com/documentation/), [Tailwind Vite installation docs](https://tailwindcss.com/docs/installation/using-vite), and npm registry package metadata for `create-vite`, `create-vue`, `sass`, `tailwindcss`, and `@tailwindcss/vite`.

npm lifecycle scripts remain unsandboxed under existing explicit-consent policy. HTTP smoke verifies served HTML, not browser rendering or accessibility. This decision authorizes implementation and local evidence gathering only. Local tests/E2E do not establish independent acceptance, support status, security approval, or release readiness. Recipe promotion and release approval are not authorized.

## Phase 04B.3 gate recommendation

**GO for independent recipe review and acceptance only.** Review FE-08–FE-11's exact recipe tuples, official scaffold/style pins, lock integrity, generated documentation, native UI flow, negative compatibility/pre-write tests, and release-policy evidence. Do not expand implementation scope or promote recipe status under this gate. Public release remains **NO-GO** pending independent review and existing security/clean-machine gates.
