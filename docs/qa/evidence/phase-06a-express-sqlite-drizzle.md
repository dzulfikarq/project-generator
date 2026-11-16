# Phase 06A — Express + SQLite + Drizzle BE-07 local acceptance evidence

| Field | Value |
|---|---|
| Date | 2026-11-16 |
| Baseline | `c7d6be0d0106ea531b84e46f4e1f3ba9cf9b539b` (worktree implementation changes were under test) |
| Host | Non-elevated Windows 11 Pro `10.0.26300`, x64 |
| Toolchain | Node.js `22.22.1`; npm `10.9.4`; Go `1.26.7`; Rust/Cargo `1.99.1`; Tauri `2.12.4` |
| Recipe | BE-07: standalone Express + npm + SQLite + Drizzle |
| Status | Bounded local implementation/acceptance **PASS**; BE-07 remains `planned`; independent review and release approval remain open |

## Scope and pins

- BE-07 is a distinct tuple from BE-01, which remains standalone Express with no database. Unsupported backend/database/ORM/manager pairings fail resolution before staging.
- Direct pins: `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `better-sqlite3@13.2.0`, `tsx@4.21.0`. Catalog integrity pins were checked against installed lock entries; exactly one npm lockfile was accepted. CLI `package-lock.json` SHA-256: `02b215a3b8a3ca4a93ba2a32e7edc85f6da9d796a5be7e1d63f27d4bc3e53814`.
- Generated starter includes Drizzle schema/config, connection helper, CRUD routes/tests, and migration SQL. Startup does not apply migrations. No app SQLite file is created during generation. Generator-runner overrides permit `DB_FILE` only as `:memory:`; generated app paths must remain inside the project directory (or use `:memory:`).
- npm install can execute unsandboxed third-party lifecycle scripts. UI lifecycle consent and internal planned-recipe consent both default closed; either alone keeps generation disabled.

## Windows CLI and isolated SQLite acceptance

Command: `npm run test:e2e:phase-06a:cli` — exit `0` (includes development build and `scripts/phase-06a-cli-e2e.mjs`).

| Area | Result |
|---|---|
| Catalog and plan | BE-07 and all direct package integrity pins present; BE-01 remains no-DB. Read-only plans disclosed SQL writes, isolated test DB, no automatic migration, and no application DB file. Invalid ORM pairing returned `GEN_INCOMPATIBLE` before target writes. |
| Generation | Native Windows `better-sqlite3` dependency install and exact dependency/lock integrity passed. Drizzle generated a notes-table migration; generated manifest retained BE-07 `planned`. |
| Generated checks | Migration generation, typecheck, lint, unit tests, database integration tests, build, graceful shutdown, and HTTP smoke passed. |
| DB isolation | Generation produced only `data/.gitkeep`, not `data/notes.sqlite`; generator HTTP smoke used `DB_FILE=:memory:`. In the disposable generated project, the harness ran `npm run db:migrate` against default `data/notes.sqlite` without precreating `data/`, then verified the SQLite file and HTTP create/read/update/delete/not-found operations. The disposable project was removed afterward. Application startup itself does not migrate. |
| Cancellation | Cancellation during npm install returned cancelled, left target absent, and cleaned owned staging. |
| Collision | Existing destination returned `GEN_PATH_EXISTS`; sentinel contents were unchanged and no owned stage remained. |
| BE-01 regression | Catalog and plan still resolve no-database BE-01; plan contains no database-file write. |

## Native desktop acceptance

Native run used `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9340`, `node scripts/desktop.mjs dev system`, and `node scripts/phase-06a-native-e2e.mjs` — E2E exit `0`.

- Forge Studio exposed Express + npm + SQLite + Drizzle. Review showed migration SQL writes and application DB safety disclosures.
- Lifecycle and planned-recipe consent defaulted unchecked; each was required separately. Generation passed dependency/lock integrity, migration generation, typecheck, lint, unit/integration tests, shutdown, build, and HTTP smoke.
- Native cancellation during npm installation left target absent and owned staging cleaned. Result and Recent Projects retained BE-07 planned status; Open Folder succeeded.
- Occupied target was blocked by Doctor before generation; existing sentinel was preserved and no staging remained.
- E2E used a temporary path containing spaces and Unicode. Test-generated project/temp data was removed after successful verification.

One CLI acceptance attempt found that Drizzle Kit could not open the default DB path when the `data/` directory did not exist. Starter now writes `data/.gitkeep`, never a SQLite DB; migration against default `data/notes.sqlite` then passed in the disposable acceptance project.

The first repeat attached DevTools to a non-app document and failed before the wizard flow. The driver now selects the loopback app origin and waits for the loaded home/catalog before reading local storage. The rerun passed. The PowerShell `taskkill` cleanup reported already-exited child PIDs (`There is no running instance of the task.`); post-run process inspection found no matching Node/Tauri/Cargo processes. The failed preflight's owned temp directory was removed.

## Release policy and regressions

- `npm run test:policy:phase-06a` — exit `0`. Release build blocked planned BE-01 and BE-07 before staging despite development flags and environment overrides. Each generation rejection returned exit `3`; no stage or destination was created.
- BE-01 CLI regression: `npm run test:e2e:phase-05a:cli` — exit `0`; generation retained Express/npm pins and passed generated checks/HTTP smoke while asserting no database/data-access adapters, SQLite driver, migration script, or `data/` directory. Native Tauri regression (`node scripts/phase-05a-native-e2e.mjs` with desktop dev runtime) also exited `0`; wizard defaults were database None + ORM None, and generated project remained DB-free through result/history/open/collision flows.
- `npm test` — exit `0`: core 68 passed / 1 expected elevated-only skip; CLI 10/10; desktop 16/16.
- `npm run typecheck`, `npm run lint`, `cargo fmt --manifest-path packages/desktop/src-tauri/Cargo.toml -- --check`, and `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml --locked` — exit `0`; Rust tests 9/9.

## Limits

Local bounded evidence only; no independent evidence review, recipe promotion, or release approval. No database service/provisioning, alternate database/ORM tuples, fullstack work, push, or deployment is claimed. Other DB recipes and broader database/none-mode acceptance remain open.
