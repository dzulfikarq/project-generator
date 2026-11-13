# DEC-021 — Phase 04A Vue and Bootstrap Expansion

| Field | Value |
|---|---|
| Status | **Accepted Discovery; implementation and local evidence present; recipe approval pending** |
| Date | 2026-11-13 |
| Scope | FE-03 Vue/Vite/CSS, FE-04 React/Vite/Bootstrap 5 CSS, FE-05 Vue/Vite/Bootstrap 5 CSS |
| Evidence | [Phase 04A implementation evidence](../qa/evidence/phase-04a-vue-bootstrap-expansion.md); [native desktop acceptance](../qa/evidence/phase-04a-native-desktop-acceptance.md); [packaged CLI security gate](../qa/evidence/phase-04a-packaged-cli-security-gate.md) |

## Decision

- Use official `create-vue` with exact version and npm registry integrity for Vue 3 + Vite + TypeScript.
- Keep npm as the only Node manager. Use exact Bootstrap 5 package version and verify its npm lock integrity.
- Support only FE-03, FE-04, and FE-05 combinations listed above. Bootstrap JavaScript/Popper, Tailwind combinations, Nuxt, Angular, and other styles/managers are out of scope.
- Keep Forma compatible only with already cataloged React/Vite and Next.js frameworks. Vue does not inherit Forma compatibility.
- Reuse the existing core pipeline and desktop bridge. Preserve process supervision, journal/recovery, cancellation, explicit lifecycle consent, and no-replace finalization.
- Keep every recipe `planned`; local implementation, tests, and E2E evidence do not promote status.

## Follow-up

The packaged CLI planned-recipe bypass was remediated with release-profile core enforcement, CLI rejection, and release packaging checks; independent review of staged bundled CLI/core and compiled Tauri executable returned **SCOPED PASS**. Installer verification and independent recipe acceptance remain open. Phase 04B disposition remains **GO for independent review and evidence hardening only; NO-GO for another framework/component system or recipe promotion until review gates close.**
