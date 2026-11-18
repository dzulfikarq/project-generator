# Phase 07A — React/Vite + Express + PostgreSQL + Drizzle (FS-06)

| Field | Value |
|---|---|
| Date | 2026-11-18 |
| Status | Independent acceptance **PASS WITH FINDINGS**; Phase 07A development closure **GO**; FS-06 remains `planned`; public release **NO-GO** |
| Host | Windows x64, non-elevated; Node.js `22.22.1`; npm `10.9.4` |
| Database | Run-owned PostgreSQL `17.2`, loopback `127.0.0.1:64604`; port `5432` excluded |
| Decision | [DEC-034](../../decisions/DEC-034-phase-07a-fullstack-react-express-postgresql.md) |

## Scope and implementation

FS-06 is one React/Vite web app and Express/PostgreSQL/Drizzle API in one npm workspace, not two projects. It remains separate from FS-02, BE-08, and BE-09. PostgreSQL 16+ is user-provided; generation, API startup/health, and SQL generation do not provision, connect to, or migrate it. Migration requires explicit target confirmation through the generated wrapper. Lifecycle scripts run unsandboxed only after dependency consent; direct Drizzle Kit migration remains callable outside wrapper checks.

Workspace direct pins are checked in every root/workspace manifest declaration and against that declaration's resolved npm lock entry/integrity. Root TypeScript is pinned because generator typechecks invoke root `node_modules/typescript/bin/tsc`; web keeps Node/Vite types for CSS imports and tests. Generated web config proxies same-origin API paths to the reviewed `API_PORT`/port settings.

## CLI + PostgreSQL E2E — PASS

Command: `npm run test:e2e:phase-07a:cli` — exit `0`.

- Fresh PostgreSQL 17.2 cluster was created by the harness and bound to run-owned loopback port `64604`; no existing service or port `5432` was used. Harness confirmed clean shutdown.
- Catalog and plan retained `recipeStatus: planned`; plan listed one root lockfile and unique expected writes. FS-06 exact pins and workspace-resolved lock integrity passed.
- Generation passed SQL generation, API/web typecheck, lint, unit/database-safety/client/shutdown tests, API/web production builds, and Vite/Express HTTP smoke. A trap listener observed zero PostgreSQL connections during generation, startup, health, and info smoke.
- Target mismatch was rejected before migration. Explicit guarded migration and CRUD passed against the run-owned database. Conflicting migration failed while preserving the pre-existing table schema.
- Cancellation during npm installation removed owned staging and left destination absent. Collision preserved the pre-existing sentinel. Long-path preflight rejected the tested over-limit workspace path before execution.
- FE-01, BE-01, BE-07, and BE-08 plan regressions passed; BE-01 remained database-free and existing recipes stayed distinct.

## Native Desktop E2E — PASS

Command: `npm run test:e2e:phase-07a:native` — exit `0`; **66 assertions passed, 0 failed**. Report files `native-acceptance-report.json` and `native-cancellation-live.json` remain under the isolated approved temp run root.

- Debug Tauri used isolated app-data, WebView2 profile, Cargo target, workspace, and job temp. No PostgreSQL service or `DATABASE_URL` was provided.
- Native review showed React/Vite + Express/PostgreSQL/Drizzle, planned status, one workspace/root lockfile, and PostgreSQL/migration safety disclosures. Dependency and planned-run consents started unchecked; dependency consent alone kept Create disabled.
- Cancellation observed matching active `stageId=installing` and npm install PID `5172` live before cancel. The PID was absent after the cancelled terminal result; this establishes observed exit by that result, not that cancellation caused process termination. Requested destination was absent, owned staging was removed, and read-only recovery was empty.
- Existing collision was Doctor `BLOCKED`; Create remained disabled and sentinel content unchanged. No extra owned stage remained.
- Post-run Windows process inspection found no Tauri/Cargo/Node process associated with the run root.

## Release policy and regressions — PASS

- `npm run test:policy:phase-07a` — exit `0`; system-Node and bundled-Node policy checks blocked planned FS-06 before staging.
- `npm run typecheck` — exit `0`.
- `npm run lint` — exit `0`.
- `npm test` — exit `0`: Core 82 passed / 1 expected elevated-only skip; CLI 11/11; Desktop 16/16.
- `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml` — exit `0`, 9/9.
- `cargo fmt --manifest-path packages/desktop/src-tauri/Cargo.toml -- --check` — exit `0`.
- `node --check` passed for Phase 07A CLI/native E2E, release-policy script, and packaged CLI policy smoke.

## Independent acceptance — PASS WITH FINDINGS

- Independent CLI E2E passed against run-owned PostgreSQL `17.2` at `127.0.0.1:58068`.
- Independent Chrome browser E2E passed against a separate run-owned PostgreSQL `17.2` instance at `127.0.0.1:55480`. Browser exercised React → Express → PostgreSQL create, read, update, and delete; loading and empty states; API outage; database outage; credential sanitization; and clean shutdown.
- Native Desktop E2E passed 66/66, including consent defaults, generation flow, cancellation, collision preservation, and recovery. PID `5172` evidence is observational; it does not establish that cancellation caused process termination.

## Limits and disposition

PostgreSQL `16` remains **NOT VERIFIED**; observed servers were `17.2`. Clean-machine/installer acceptance, accessibility, and broader security review remain open. npm lifecycle scripts remain unsandboxed after consent; direct Drizzle Kit migration can bypass wrapper checks.

**Independent acceptance: PASS WITH FINDINGS. Phase 07A development closure: GO. FS-06 remains `planned`; public release remains NO-GO.** No recipe promotion, commit, push, deployment, or release occurred.
