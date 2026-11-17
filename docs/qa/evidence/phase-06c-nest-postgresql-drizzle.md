# Phase 06C — NestJS + PostgreSQL + Drizzle evidence

| Field | Value |
|---|---|
| Status | **CLI E2E PASS; final full native Desktop E2E PASS (r9, exit 0, 116 passed / 0 failed); independent review PASS WITH FINDINGS, no product blocker; Phase 06C development closure GO; BE-09 remains planned; public release NO-GO** |
| Date | 2026-11-18 |
| Host | Windows 11 Pro `10.0.26300`, x64; non-elevated generation session |
| Toolchain | Node.js `22.22.1`; npm `10.9.4`; PostgreSQL `17.2` |
| Recipe | BE-09, still `planned` |
| Decision | [DEC-033](../../decisions/DEC-033-phase-06c-nest-postgresql-drizzle.md) |

## Scope

BE-09 is a distinct NestJS 11 + npm + PostgreSQL 16+ + Drizzle recipe. It does not change BE-03 (database-free NestJS), BE-07 (Express + SQLite + Drizzle), or BE-08 (Express + PostgreSQL + Drizzle). The BE-09 CLI harness runs BE-01 and BE-07 plan regressions; it does **not** run BE-08 regression E2E. BE-08 E2E was run separately with `npm run test:e2e:phase-06b` (see [Phase 06B evidence](phase-06b-express-postgresql-drizzle.md)). Native debug Tauri generation is recorded below.

The generated starter uses the official Nest CLI `11.0.24`, NestJS `11.2.10`, Node `>=22.13.0`, and npm `>=10`. Catalog pins include `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `pg@8.23.1`, `class-validator@0.15.1`, and `class-transformer@0.5.1`; catalog registry integrity metadata and generated package-lock entries were verified.

## Runtime E2E — PASS

Command: `npm run test:e2e:phase-06c`

| Check | Result |
|---|---|
| BE-09 catalog/plan and regression scope | PASS — BE-09 resolves as `planned`, execution unavailable; BE-01 database-free and BE-07 SQLite/Drizzle plan regressions pass. BE-08 regression is not part of this harness; separate Phase 06B E2E covers it. |
| Official Nest scaffold, pins, npm lock integrity | PASS |
| Migration SQL generation, generated docs, typecheck, lint, unit/safety/Jest API/shutdown tests, build | PASS |
| Generation and `/health` + `/api/info` smoke | PASS — owned TCP probe observed zero DB connections |
| Mismatched migration target | PASS — rejected before connecting or changing other DB |
| Guarded migration and CRUD integration | PASS — applied only to run-owned test database; Jest integration passed |
| Migration conflict/rollback | PASS — migration failed and pre-existing table schema remained unchanged |
| Cancellation during npm install | PASS — owned staging removed |
| Destination collision | PASS — existing sentinel preserved; no staging left |

## Prior Native Desktop E2E — PASS for generation/collision only

- Prior corrected rerun launched real Windows debug Tauri against Vite/WebView2 CDP. Disposable root `C:\Users\Augie Winanda F\AppData\Local\Temp\opencode\p6c-r1` held `appDirectoriesOverride`, process `LOCALAPPDATA`/`TEMP`/`TMP`, WebView2 profile, Cargo target, resource copy, and workspace. User profile was not used. Harness exit **0**; **108 assertions passed, 0 failed** for the recorded native flow (`native-acceptance-report.json`).
- Packaged development CLI catalog showed BE-09 `planned`. Runtime showed `LOCAL DEVELOPMENT` and `No release approval`. Dependency-execution consent and internal planned-recipe consent both started unchecked; dependency consent alone kept Create disabled. Both explicit consents enabled debug generation.
- Successful BE-09 generation passed all 13 validations with `recipeStatusAtCreation: planned`. Collision required `BLOCKED`; Create stayed disabled, sentinel stayed unchanged, and retry workspace ended with only generated target plus collision directory. No PostgreSQL service/database was used.
- The earlier accepted harness treated activity text containing “install” as proof of npm installation. It did not assert exact UI `stageId=installing`, identify a live npm PID at cancellation, or confirm that PID exited; job evidence places that cancellation during **scaffolding**. A stricter r4 attempt later matched active `stageId=installing` and a live npm PID, then showed the cancelled result. It failed after result navigation while looking for an event no longer rendered, so PID exit and recovery evidence were not recorded. Native npm-install cancellation remained unverified at that point. The separate CLI E2E does verify npm-install cancellation.
- Failure observations for prior disposable job `f06509ab-d9b9-42eb-bbf3-50313939bc9e`: initial Nest scaffold npm install exited `0`; project dependency install exited `1`. Captured stderr shows esbuild install validation failed with `ENOENT` spawning `@esbuild/win32-x64/esbuild.exe`; its full path was **261 characters**. Previous native pass used same `@esbuild-kit/core-utils@3.3.2` / optional `@esbuild/win32-x64@0.18.20` lock entries and had that binary present at **255 characters**. Short-root rerun reduced equivalent staged path to **219 characters**; project npm install exited `0`, same lock entries/binary present, job completed. These observations correlate failure with path length but do not establish root cause; no dependency, consent, release-policy, or product change. npm also emitted `EPERM` cleanup warnings after the install failure.
- Failed job emitted `GEN_STAGING_LEFTOVER`; read-only native recovery inspection reports `phase=cleanupStage`, `state=stagingPresent`, `canCleanupStage=true`, `canFinalize=false`, target absent. Left this owned stage untouched. Successful retry recovery inspection returned no pending records and its workspace had no staging.
- `DESKTOP_CLI_EXIT_FAILED` was the desktop bridge reporting the CLI's nonzero exit after terminal `GEN_INSTALL_FAILED` (see `main.rs`); it was downstream of npm failure. Initial success-only harness wait was stopped after failed terminal result; corrected harness now fails fast on any non-success result and records assertion totals. Normal Doctor predicate is `READY`; collision predicate is `BLOCKED`.
- The Tauri child environment remained isolated and lifecycle scripts remained enabled only after explicit dual consent. Core safe-process setup supplies stage-owned `TEMP`/`TMP`/home and isolated npm config/cache; successful retry changed workspace depth, not consent or release policy. No `DATABASE_URL`/`PG*` values were passed; no PostgreSQL service/database was used.

## BE-09 Windows long-path preflight

- Added a BE-09-only preflight before staging. It measures the predicted staged nested `node_modules/@esbuild-kit/core-utils/node_modules/@esbuild/win32-x64/esbuild.exe` path and rejects paths over the conservative 240-character cap.
- Synthetic Windows-path regression: 261-character path rejected; 219-character path accepted. Generation regression confirmed `GEN_PATH_UNSAFE` in `preflight`, absent destination, and empty workspace (no stage created).
- This blocks the observed long staged-path risk; it does not prove the 261-character `ENOENT` root cause.

## Native npm-install cancellation — local verification

- r5 captured job `b1ef675b-f999-4344-b2f6-80960ed5a087`, exact UI `stageId=installing`, npm PID `4056`, its `npm-cli.js install` command line, native supervisor parent, and generator PID immediately before cancel in `C:\Users\Augie Winanda F\AppData\Local\Temp\opencode\phase-06c-remediation-r5\native-cancellation-live.json`.
- The generation result showed **Generation cancelled**, status **Cancelled**, and `GEN_CANCELLED`. Read-only follow-up confirmed npm PID `4056` exited; cancelled target and owned stage were absent; workspace contained only the pre-existing collision-test directory with sentinel unchanged; recovery inspection for the job returned no records. Full details: `native-cancellation-verification.json` in the same isolated root.
- The r5 harness report remains **FAIL** because it waited for `data-job-status`, which the running Vite UI did not expose. The captured result page nevertheless showed terminal cancellation; the follow-up independently verified PID exit and cleanup/recovery. Harness selector now uses existing result markup. No full native harness PASS is claimed for r5.

## Final full Native Desktop E2E rerun — PASS

- Final run root: `C:\Users\Augie Winanda F\AppData\Local\Temp\opencode\phase-06c-remediation-r9`. Tauri debug + WebView2 used isolated `appDirectoriesOverride`, `LOCALAPPDATA`, `TEMP`/`TMP`, WebView profile, Cargo target, runtime resources, and workspace. Test-only relative resource junction was removed after the Tauri app exited; run root and generated output remain preserved.
- Harness: `node scripts/phase-06c-native-e2e.mjs`; **exit 0**, **116 assertions passed, 0 failed**. Full report: `native-acceptance-report.json` in r9 root. Observed at `2026-11-17T21:37:39.792Z` (UTC); Node `22.22.1`; Windows x64.
- Consent: dependency/lifecycle and planned-recipe controls were visible and unchecked by default; dependency consent alone kept Create disabled; both explicit consents enabled the debug evidence run. Runtime showed `LOCAL DEVELOPMENT` and no release approval.
- Normal BE-09 generation completed with all harness-required validation statuses passing. Output manifest retained `recipeId=BE-09`, `recipeStatusAtCreation=planned`, npm, and NestJS/PostgreSQL/Drizzle adapters; exact dependency pins, lockfile, generated docs/migration files, and checks were verified at `r9\w\pg-be09-native`.
- Cancellation job `1f9e90da-767e-474d-8ccb-7890d89ce3c5`: UI reported active `stageId=installing`; matching live npm install PID `14880` and native supervisor parent were captured immediately before cancel. UI then reported `Generation cancelled` / `cancelled`; PID `14880` exited after terminal status; cancelled destination and owned stage were absent; read-only recovery returned `[]`.
- Collision flow returned `BLOCKED` for existing destination; Create stayed disabled; sentinel remained unchanged; no extra stage appeared. Launch environment had no `PG*` or `DATABASE_URL` variables; no database was provisioned or contacted.
- Earlier r6–r8 attempts and reports remain preserved. They exposed harness/setup issues only: absolute Windows resource mapping lost drive prefix during Cargo build; subsequent harness starts raced React/catalog readiness; r8 compared lowercase DOM token `cancelled` against title-case `Cancelled`. Resource mapping and harness readiness/status checks were corrected in test setup; no product source was changed for these retries. The final harness still requires exact active `installing` state, the same live npm PID before cancellation, the cancelled terminal result, PID exit, and filesystem/recovery checks. r9 is final full E2E result; no key assertion was weakened.

Disposable PostgreSQL cluster evidence:

- `pg_ctl (PostgreSQL) 17.2`, host `127.0.0.1`, dynamically allocated port `57573`; loopback bind preflight passed.
- `pg_ctl` start exited `0`; PostgreSQL log confirmed readiness on the owned loopback port. Port `5432` was not selected or contacted.
- `pg_ctl` stop exited `0`; follow-up status reported `no server running` (exit `3`). Successful-run temporary data was removed by the harness.
- Failed-run Phase 06C temporary roots were checked individually with `pg_ctl status`; all reported no server running before task-owned artifacts were removed.

## Policy and regressions — PASS

| Command | Result |
|---|---|
| `npm run test:policy:phase-06c` | PASS — system and bundled Node policy; BE-09 blocked before staging in release builds |
| `npm test --workspace @project-generator/core` | PASS — 76 passed, 1 expected elevated-only skip |
| `npm test --workspace @project-generator/desktop` | PASS — 16/16 |
| `npm run typecheck --workspace @project-generator/core` | PASS |
| `npm run typecheck --workspace @project-generator/desktop` | PASS |
| `npm run lint` | PASS |
| `npm test` | PASS — core 76 passed / 1 expected elevated-only skip; CLI 11/11; Desktop 16/16 |
| `npm run typecheck` | PASS — core, CLI, Desktop |
| Tauri authorization/profile tests (`generation_requires_explicit_consent_and_release_build_cannot_override_planned`; `compiled_build_profile_controls_planned_recipe_override`) | PASS — 1/1 each; release authorization remains unchanged |
| `cargo fmt --manifest-path packages/desktop/src-tauri/Cargo.toml -- --check` | PASS |
| `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml --offline` | PASS — 9/9 |

## Limits and disposition

- PostgreSQL `16` was not tested; CLI runtime evidence is PostgreSQL `17.2` only. Native Tauri flow used no PostgreSQL service/database and did not test DB CRUD.
- Native debug Tauri E2E is local evidence, not installer or clean-machine acceptance. Earlier failed disposable attempts and their diagnostic roots remain preserved; the unrelated prior owned recovery stage remains available for explicit recovery and was not removed.
- BE-08 E2E is not in the Phase 06C harness; it ran separately in Phase 06B. Phase 06C's PostgreSQL CLI E2E and native Desktop E2E are distinct: the former used a run-owned PostgreSQL `17.2` cluster; native r9 used no PostgreSQL service/database. PostgreSQL `16` and clean-machine/installer acceptance remain unverified and are not automatic development-closure blockers under the agreed scope.
- **Independent review (2026-11-18): PASS WITH FINDINGS; no product blocker.** Finding was documentation drift: several summaries still presented r5 as latest and `design.md` still marked native npm cancellation unverified. This sync updated those records; directed consistency verification passed. Phase 06C development closure is **GO**; recipe and release status remain unchanged.
- npm lifecycle scripts execute unsandboxed after explicit consent. Direct `drizzle-kit migrate` can bypass the generated wrapper. Target confirmation is not cryptographic server identity.
- No production/user database, PostgreSQL Service, port `5432`, elevation, global Windows configuration, `race-create`, or protected Phase 06A logs were used or modified. Existing user app-data and PostgreSQL listener were left untouched. No commit or push was made.

**Disposition:** CLI E2E and final native Desktop E2E r9 passed for their distinct stated scopes. Independent review is **PASS WITH FINDINGS, no product blocker**; documentation consistency passed directed verification. Phase 06C development closure is **GO**. PostgreSQL `16` and clean-machine/installer acceptance remain unverified but are not development-closure blockers. npm lifecycle scripts remain unsandboxed; direct Drizzle Kit migration can bypass the wrapper; target confirmation is not cryptographic server identity. The prior failed job's recoverable staging remains untouched. BE-09 remains `planned`; public release remains **NO-GO**.
