# Phase 06A — Express + SQLite + Drizzle BE-07 local acceptance evidence

| Field | Value |
|---|---|
| Date | 2026-11-16 |
| Baseline | Remediation 3 HEAD `814978f552e0dd00008537efe5bd534962e99815`; 11 pre-existing modified files preserved |
| Host | Non-elevated Windows 11 Pro `10.0.26300`, x64 |
| Toolchain | Node.js `22.22.1`; npm `10.9.4`; Go `1.26.7`; Rust/Cargo `1.99.1`; Tauri `2.12.4` |
| Recipe | BE-07: standalone Express + npm + SQLite + Drizzle |
| Status | Final independent post-remediation runtime acceptance **PASS**, no new blockers; Phase 06A development closure **GO**; file-symlink cases **NOT VERIFIED** (`EPERM`); installer unvalidated; public release **NO-GO**; BE-01/BE-07 remain `planned` |

## Scope and pins

- BE-07 is a distinct tuple from BE-01, which remains standalone Express with no database. Unsupported backend/database/ORM/manager pairings fail resolution before staging.
- Direct pins: `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `better-sqlite3@13.2.0`, `tsx@4.21.0`. Catalog integrity pins were checked against installed lock entries; exactly one npm lockfile was accepted. CLI `package-lock.json` SHA-256: `02b215a3b8a3ca4a93ba2a32e7edc85f6da9d796a5be7e1d63f27d4bc3e53814`.
- Generated starter includes Drizzle schema/config, connection helper, CRUD routes/tests, and migration SQL. Startup does not apply migrations. No app SQLite file is created during generation. Generator-runner overrides permit `DB_FILE` only as `:memory:`; generated app paths must remain inside the project directory (or use `:memory:`).
- npm install can execute unsandboxed third-party lifecycle scripts. UI lifecycle consent and internal planned-recipe consent both default closed; either alone keeps generation disabled.

## F-01–F-04 remediation validation

| Field | Result |
|---|---|
| Remediation baseline | `814978f552e0dd00008537efe5bd534962e99815` (`Add Express SQLite Drizzle recipe`) |
| Pre-edit tree | Clean; HEAD matched baseline |
| Targeted CLI acceptance | Implementer-reported `npm run test:e2e:phase-06a:cli` — exit `0`; prior independent review did not rerun this historical result |
| Release policy | Implementer-reported `npm run test:policy:phase-06a` — exit `0`; prior independent review did not rerun this historical result |
| Focused checks | Implementer-reported core/CLI typecheck, schema tuple test, BE-07 release-block test, CLI help test, E2E syntax check, and `git diff --check`; Remediation 2 results recorded separately below |
| File symlink case | Generated test attempts a disposable file symlink; Windows returned `EPERM`, so test skipped without changing system settings. Actual file-symlink rejection remains source-reviewed, not runtime-demonstrated on this host. |

- Startup test checks missing `data/` and DB file after listener start plus health/info/404/malformed requests; first notes request creates the disposable DB, returns an unmigrated-table error, and SQLite inspection confirms no tables/migration ran.
- Generated project starts with no `data/` directory. Explicit migration command creates it; DB_FILE absolute and traversal inputs are rejected before external files appear. Drizzle Kit config rejects an absolute DB_FILE through the shared resolver.
- Historical Remediation 2 junction assertions rejected an external target and linked project root in Node before the helper branch; runtime reparse rejection was not demonstrated then. That PowerShell-based implementation is superseded by Remediation 3's Rust verifier.
- Filesystem validation/open is not race-proof. A concurrent process with write access could replace a checked path between validation and SQLite open; no claim of TOCTOU immunity.
- Full suite and native Tauri E2E were not rerun. Staging/supervisor code was unchanged; CLI cancellation/collision regressions passed. No commit, push, or release. `race-create` was not read or touched.

## Remediation 2 — superseded implementation record

- Historical Remediation 2 used PowerShell for its generated Windows path check; that implementation was superseded and is not current behavior. Its evidence did not demonstrate PowerShell rejecting a reparse point. The file-symlink case was skipped on Windows `EPERM`.

## Remediation 3 — implementation and implementer-run evidence

- Baseline verified before edits: HEAD `814978f552e0dd00008537efe5bd534962e99815`, branch `main`, staged diff empty, and exactly 11 pre-existing modified files. Their changes were preserved. The prohibited diagnostic log and `race-create` journal were not accessed, changed, or cleaned.
- Added minimal Windows Rust binary `pg-db-path-verifier.exe` to the existing supervisor crate. It accepts only protocol v1 JSON `{ projectRoot, databasePath }` via stdin and fixed `--verify` argv; output is versioned JSON; invalid input/API errors/reparse detection/nonzero exit fail closed. Path walk uses `CreateFileW`, handle-relative `NtCreateFile` with `FILE_OPEN_REPARSE_POINT`, and `GetFileInformationByHandleEx(FileAttributeTagInfo)`. Existing components are checked; missing DB suffix components are allowed. Every opened handle closes via RAII.
- Build script builds/stages supervisor and verifier side-by-side. Native supervisor copies the packaged sibling verifier into owned BE-07 staging through the existing handle-rooted mutation. Generated code resolves helper from its module `import.meta.url` to an absolute project-local path and uses fixed argv, JSON stdin, `shell: false`; no PowerShell fallback, PATH/current-directory selection, or `SystemRoot`/`WINDIR` location logic. Original Tauri system/bundled resource staging passed, but its packaged smoke did not attempt BE-07 generation; Remediation 4 adds that case. Bundled `node.exe` was staged. Installer build did not proceed because `PG_NSIS_DIR` was unset; no installer was produced.
- **Targeted CLI E2E: PASS**, `npm run test:e2e:phase-06a:cli`, Windows 11 Pro `10.0.26300`, non-elevated, Node `22.22.1`, npm `10.9.4`. Fresh BE-01 manifest selected exactly `['backend.express']`; generated project had no DB/ORM adapters, SQLite/Drizzle packages, migration commands, `data/`, or DB file. BE-07 copied the helper byte-for-byte from `packages/core/native`; generated dependency/lock integrity, SQL generation, typecheck, lint, tests, build, graceful shutdown, and HTTP smoke passed. Explicit migration and isolated SQLite CRUD passed. Cancellation cleaned owned staging; collision preserved sentinel.
- Generated BE-07 DB suite: **8 passed, 2 skipped, 0 failed**. Normal existing file and missing suffix paths passed. Native handle walk rejected project-root and parent-directory junctions. Fake-root test set `SystemRoot`/`WINDIR` only inside test process, placed a valid executable sentinel at fake `WindowsPowerShell/v1.0/powershell.exe`, and passed with the selected helper remaining absolute/project-local. Actual missing-helper rename/restore and directory-as-file API rejection failed closed. Injected runner responses covered EACCES, timeout, nonzero status, crash-like null status, malformed JSON, protocol mismatch, API-error response, and stderr; each asserted no DB file was created. File-symlink tests were skipped because Windows returned `EPERM`; file-symlink rejection remains **NOT VERIFIED**.
- Regression: full `npm test` **PASS** (core 68 passed / 1 expected elevated-only skip; CLI 11/11; desktop 16/16); Rust `cargo test --locked` **PASS** (2 verifier + 4 supervisor tests); verifier/supervisor Clippy (`--all-targets -- -D warnings`), Rust formatting, core typecheck, and lint passed. Existing DB path regression vectors include drive absolute, UNC/extended UNC, traversal, mixed separators, trailing dot/space, `:memory:` scope, `NUL`/`CON`; BE-01 remains database-free. Remediation 4 adds `CLOCK$` and malformed UTF-8 parser vectors.
- Remediation 3 review-time limits: helper is a first-party generated artifact, not protected against replacement by someone who can modify the generated project. Reparse points are rejected only when observed during handle walk; TOCTOU remains before SQLite opens the path. Hard-link aliases are not detected. npm lifecycle scripts and native addons remain unsandboxed. Independent source review then completed **PASS WITH FINDINGS**; runtime acceptance was still pending at that point. Final status appears below.

## Remediation 4 — findings closure and targeted implementation checks

- `CLOCK$` now fails closed in generated TypeScript path validation and the Rust verifier, matching the repository's Windows reserved-name policy. Generated BE-07 path vectors and Rust parser tests cover it; this is policy consistency, not a traversal exploit.
- Rust parser now compares drive-prefix bytes without slicing inside UTF-8. Malformed Unicode prefix returns structured `unsafe_path`; regression test confirms no panic.
- Generated `docs/DATABASE-SAFETY.md` now discloses hard-link aliases are not detected. TOCTOU, helper replaceability, and unsandboxed npm lifecycle/native-addon behavior remain disclosed.
- Rust verifier tests: **3 passed**; targeted Clippy (`-D warnings`) and Rust fmt check passed. `npm run test:e2e:phase-06a:cli`: **PASS**; BE-01 stayed DB-free and BE-07 path validation/generation/runtime checks passed. Core typecheck, focused ESLint, and packaged-smoke syntax check passed.
- `node scripts/desktop.mjs build system` and `node scripts/desktop.mjs build bundled`: packaged release-profile CLI smoke passed in both modes. For BE-07, normal generation and a `--development-allow-planned` attempt were both rejected as `GEN_RECIPE_UNTESTED`; assertions confirmed no staging event and no destination. Release help omits the development override.
- At the end of Remediation 4, packaging had stopped at the unset `PG_NSIS_DIR` prerequisite after smoke; no installer was built. File-symlink runtime rejection was **NOT VERIFIED** because Windows returned `EPERM`. Independent post-remediation runtime acceptance was still pending then; BE-01/BE-07 remained `planned`, and closure/release were then **NO-GO**. Final independent acceptance follows.

## Original Windows CLI and isolated SQLite acceptance (pre-remediation)

Command: `npm run test:e2e:phase-06a:cli` — exit `0` (includes development build and `scripts/phase-06a-cli-e2e.mjs`).

| Area | Result |
|---|---|
| Catalog and plan | BE-07 and all direct package integrity pins present; BE-01 remains no-DB. Read-only plans disclosed SQL writes, isolated test DB, no automatic migration, and no application DB file. Invalid ORM pairing returned `GEN_INCOMPATIBLE` before target writes. |
| Generation | Native Windows `better-sqlite3` dependency install and exact dependency/lock integrity passed. Drizzle generated a notes-table migration; generated manifest retained BE-07 `planned`. |
| Generated checks | Migration generation, typecheck, lint, unit tests, database integration tests, build, graceful shutdown, and HTTP smoke passed. |
| DB isolation | At that earlier baseline, generation produced only `data/.gitkeep`, not `data/notes.sqlite`; generator HTTP smoke used `DB_FILE=:memory:`. The disposable generated project explicitly migrated default `data/notes.sqlite`, then verified HTTP CRUD. F-01 remediation removed the generated `.gitkeep` so generation leaves `data/` absent. |
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

One earlier CLI acceptance attempt found that Drizzle Kit could not open the default DB path when `data/` did not exist. The pre-remediation starter added `data/.gitkeep`; the remediation replaces that workaround with an explicit migration entry point that validates `DB_FILE` and creates the parent only when `npm run db:migrate` runs.

The first repeat attached DevTools to a non-app document and failed before the wizard flow. The driver now selects the loopback app origin and waits for the loaded home/catalog before reading local storage. The rerun passed. The PowerShell `taskkill` cleanup reported already-exited child PIDs (`There is no running instance of the task.`); post-run process inspection found no matching Node/Tauri/Cargo processes. The failed preflight's owned temp directory was removed.

## Release policy and regressions

- `npm run test:policy:phase-06a` — exit `0`. Release build blocked planned BE-01 and BE-07 before staging despite development flags and environment overrides. Each generation rejection returned exit `3`; no stage or destination was created.
- BE-01 CLI regression: `npm run test:e2e:phase-05a:cli` — exit `0`; generation retained Express/npm pins and passed generated checks/HTTP smoke while asserting no database/data-access adapters, SQLite driver, migration script, or `data/` directory. Native Tauri regression (`node scripts/phase-05a-native-e2e.mjs` with desktop dev runtime) also exited `0`; wizard defaults were database None + ORM None, and generated project remained DB-free through result/history/open/collision flows.
- `npm test` — exit `0`: core 68 passed / 1 expected elevated-only skip; CLI 10/10; desktop 16/16.
- `npm run typecheck`, `npm run lint`, `cargo fmt --manifest-path packages/desktop/src-tauri/Cargo.toml -- --check`, and `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml --locked` — exit `0`; Rust tests 9/9.

## Limits

Final independent post-remediation runtime acceptance completed **PASS** with no new blockers; Phase 06A development closure is **GO**. BE-01/BE-07 remain `planned`, and recipe promotion, release approval, database service/provisioning, alternate database/ORM tuples, and fullstack work remain out of scope. Other DB recipes and broader database/none-mode acceptance remain open; public release remains **NO-GO**.

## Final Independent Acceptance — 2026-11-16

- **Verdict: PASS; no new blockers. Recommendation: GO for Phase 06A development closure.** Host: non-elevated Windows 11 Pro `10.0.26300`, x64; Node.js `22.22.1`; npm `10.9.4`; Rust verifier tests run with Cargo on this host. Acceptance used a disposable workspace. The copied CLI E2E harness changed only its temporary-folder prefix to keep nested Windows paths below `MAX_PATH`; assertions were unchanged and paths still contained spaces and `雪`.
- **CLI E2E: PASS.** BE-01 generation remained database-free: exactly `backend.express`, no SQLite/Drizzle packages, migration scripts, data directory, or DB file. BE-07 generation passed dependency/lock integrity, SQL generation, typecheck, lint, tests, build, graceful shutdown, and HTTP smoke. Application DB remained absent after generation. Explicit migration created only the isolated test database; CRUD passed. Cancellation and collision checks passed.
- **Generated BE-07 runtime suite: 11 passed, 0 failed, 2 skipped.** Project-root and parent-directory junction rejection, fake-Windows-root helper-selection check, and verifier/protocol-failure-before-SQLite checks passed. The two skipped cases attempted file symlink creation and are **NOT VERIFIED**: direct attempt returned Windows `EPERM`.
- **Native verifier:** normal missing DB suffix returned `clear`; outside-project path and `CLOCK$` returned `unsafe_path`; malformed Unicode drive prefix returned `unsafe_path` without panic; raw invalid UTF-8 returned `invalid_request`. Rust verifier tests: **3/3 passed**.
- **Packaged release gates:** system Node and bundled Node smokes passed. Both normal BE-07 generation and development-override attempts were rejected before staging. Packaged CLI/core/supervisor/verifier hashes matched release-build outputs. No installer was built or validated.
- **Residual limits:** handle walk only rejects reparse components observed during the check; TOCTOU remains before SQLite opens DB_FILE; hard-link aliases are not detected; generated helper is replaceable by someone able to modify project files; npm lifecycle scripts and native addons remain unsandboxed. These are disclosed, not newly discovered blockers.
- **Final status:** Phase 06A development closure **GO**. BE-01 and BE-07 remain `planned`; no production-readiness claim or recipe promotion. Public release remains **NO-GO**; installer validation, clean-machine proof, broader database matrix, and release approval remain open. No source/test, recipe registry, or release-gate changes; no commit or push.
