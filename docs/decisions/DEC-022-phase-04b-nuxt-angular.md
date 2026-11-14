# DEC-022 — Phase 04B Nuxt and Angular Recipes

| Field | Value |
|---|---|
| Status | User-authorized scoped implementation; independent recipe review pending |
| Date | 2026-11-14 |
| Scope | FE-06 Nuxt 4 + npm + CSS; FE-07 Angular 21 + npm + SCSS |
| Evidence | [Phase 04B report](../qa/evidence/phase-04b-nuxt-angular.md) |

## Decision

- Add only FE-06 and FE-07 to existing CLI/core and Forge Studio pipeline. Keep both recipes `planned`; normal generation and release builds remain blocked.
- FE-06 uses integrity-pinned `create-nuxt@4.0.3`, Nuxt `4.6.4`, and official `nuxt/starter` commit `db01806fcb37f2e369fb09443c72cac696b31548`. Require Node `^22.22.3 || ^24.15.0 || >=26.0.0`; keep npm as manager.
- FE-07 invokes local, integrity-pinned `@angular/cli@21.2.30`—never a global CLI—pins Angular core `21.2.26`, and generates SCSS with npm.
- Preserve read-only planning, exact compatibility checks, planned-recipe gates, Supervisor/recovery, no-replace finalize, cancellation, lifecycle-script disclosure/consent, and generated provenance/check records.
- Keep Forma incompatible with Nuxt and Angular. Add no other framework, styling, component library, package manager, backend, or fullstack recipe.

## Rationale and risks

Nuxt `4.0.3` matches the existing Node `22.22.1` host but is stale. Nuxt `4.6.4` is the selected maintained pin; it requires a compatible Node runtime for generation and E2E. Local verification uses a separate portable Node `22.22.3`; installed Node remains unchanged. Nuxt starter source is pinned to an immutable commit; npm scaffold/package metadata is integrity-checked.

Angular CLI and core use independently pinned patch versions. The CLI stays project-local; no global install or manager substitution occurs. npm lifecycle scripts run unsandboxed under the existing explicit-consent policy.

Local Windows reproduction found npm `10.9.8` fails ordinary install on the Angular CLI scaffold with `Cannot read properties of null (reading 'edgesOut')`. The scoped FE-07 install uses `--legacy-peer-deps`; a generated lock then passed ordinary `npm install` and `npm ci --dry-run`. This bypasses peer resolution for the initial install and remains a workaround, not a support or security claim; remove it when ordinary install succeeds on the pinned scaffold/toolchain.

This decision authorizes implementation and local evidence gathering only. Local tests/E2E do not establish independent acceptance, support status, security approval, or release readiness. Recipe promotion and release approval are not authorized.
