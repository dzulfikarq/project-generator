# DEC-035 — Phase 07B Vue/Vite + Express + PostgreSQL + Drizzle

| Field | Value |
|---|---|
| Status | User-authorized implementation; independent Phase 07B acceptance **PASS WITH FINDINGS**; development closure **GO**; system/bundled packaged release-policy checks **PASS**; FS-07 remains `planned`; public release **NO-GO** |
| Date | 2026-11-19 |
| Scope | Separate FS-07 Vue 3 + Vite web app and Express + PostgreSQL + Drizzle API in one npm workspace |
| Requirements | PRD-008–009, PRD-017–019; adapter and filesystem safety contracts |
| Evidence | [Phase 07B evidence](../qa/evidence/phase-07b-fullstack-vue-express-postgresql.md) |

## Recorded direction

- Add FS-07 as exact Vue 3/Vite + Express + PostgreSQL/Drizzle + npm tuple. Keep FS-06 React/Vite implementation and behavior unchanged; preserve the PRD's FS-01 reservation and separation from FS-02, BE-08, and BE-09.
- Generate one owned project, one npm workspace, and one root `package-lock.json`. Keep frontend, API, docs, dependency pins, and validation inside one transaction.
- Pin Vue `3.5.45`, `@vitejs/plugin-vue` `6.0.11`, Vite `8.3.8`, and `vue-tsc` `3.3.14`; resolved package integrity is checked against registry metadata and root lock entries. Supported Node intersection is `22.18+` or `24.12+`; npm `10+` remains required.
- PostgreSQL `16+` is user-provided. Generation, API startup, `/health`, and SQL generation do not provision, connect to, or migrate PostgreSQL. Migration requires explicit guarded `npm run db:migrate -- --target host:port/database`; direct Drizzle Kit migration remains outside wrapper checks.
- Use same-origin Vite proxy and Vue Composition API UI; keep DB credentials in root `.env`, never frontend source or `VITE_*` values. API failures must not reveal credentials.
- Require explicit dependency-execution consent. Keep planned-recipe override internal to development builds. Do not promote FS-07 or approve a release based on local E2E.

## Alternatives rejected

- Extend FS-06 with selectable Vue: would alter the existing React recipe rather than add a distinct, exact tuple.
- Add Vue to BE-08 or BE-09: would change their standalone API contracts and blur fullstack scope.
- Generate nested independent web/API projects or lockfiles: conflicts with the selected single-workspace output and duplicates dependency resolution.
- Provision or migrate PostgreSQL during generation/startup: creates unapproved effects on user-managed services.
- Enable planned recipes in normal/release builds based on local tests: independent acceptance and security/release gates remain outstanding.

## Verification and disposition

- Final bounded local Windows CLI E2E passed on Node.js `22.22.1`, npm `10.9.4`, and run-owned PostgreSQL `17.2` at `127.0.0.1:58945`; port `5432` was excluded. It covered one workspace/root lockfile, dependency and lock integrity, generated SQL, API/Vue typecheck, lint/tests/build, DB-free smoke, explicit migration/CRUD, mismatch rejection, rollback, cancellation, collision, and FE-01/FE-03/BE-01/BE-07/BE-08/BE-09/FS-06 plan regressions.
- Chrome CDP E2E passed Vue → Vite → Express → PostgreSQL loading/empty states, invalid-form validation, create/read/update/delete, direct database row assertions, API/database outages, and credential non-disclosure.
- Independent CLI/PostgreSQL/Chrome acceptance passed on Node.js `22.22.1`, npm `10.9.4`, and a fresh run-owned PostgreSQL `17.2` cluster at `127.0.0.1:52457`; port `5432` was excluded. Generation/checks, guarded migration/CRUD/rollback, cancellation, collision, browser CRUD/outages, and credential checks passed.
- The earlier native Tauri/WebView2 suite passed **68/68 assertions** without PostgreSQL. It covered review/consent, npm-install cancellation, recovery, and collision, but not successful generation. Its npm PID observation does not independently prove cancellation causality. Prior suite evidence root: `C:\Users\Augie Winanda F\AppData\Local\Temp\opencode\phase-07b-native-e2e-CoEonY`.
- A separate success-wrapper attempt failed after generation at an activity-event assertion that queried the result page. That attempt is **not** counted as PASS. The corrected wrapper asserts the rendered `.result-hero.completed`, exact `#result-title`, completed status tag, visible passed validations, and generated manifest rather than generation-page activity events. Targeted command `npm run test:e2e:phase-07b:native-success` passed **40/40 assertions**; generated manifest records **15/15 validations passed** and retains FS-07 `planned`. Evidence root: `C:\Users\Augie Winanda F\AppData\Local\Temp\opencode\phase-07b-native-e2e-mMStSU`.
- Final regressions passed: root `npm test` (Core 84 passed / 1 expected elevated-only skip; CLI 11/11; Desktop 16/16), `npm run typecheck`, `npm run lint`, Rust format check, Tauri Rust tests 9/9, and Clippy with `-D warnings`. Phase 07B scripts passed `node --check`; `git diff --check` passed.
- `npm run test:policy:phase-07b` passed for system and bundled Node. Release-profile policy blocked planned FS-06/FS-07 and BE-08/BE-09 before staging. Policy evidence alone does not promote a recipe or approve release.
- PostgreSQL `16` remains **NOT VERIFIED**. Clean-machine/installer behavior, accessibility, and broader security review remain open. npm lifecycle scripts remain unsandboxed after consent; direct Drizzle Kit migration can bypass wrapper checks.

**Disposition:** Independent Phase 07B acceptance is **PASS WITH FINDINGS**; development closure is **GO** for stated scope. FS-07 remains `planned`; no recipe promotion or public-release approval. Public release remains **NO-GO** pending PostgreSQL `16`, clean-machine/installer, accessibility, broader security, and other release gates.
