# Phase 05C.3 — Standalone Laravel BE-05 Evidence

| Field | Value |
|---|---|
| Date | 2026-11-15 |
| Host | Windows 11 Pro `10.0.26300`, x64; non-elevated |
| Recipe | BE-05 standalone Laravel / PHP / Composer / MySQL + Eloquent configuration |
| Status | **Bounded local CLI/native and isolated MySQL/Eloquent acceptance passed; BE-05 remains `planned`; no release approved** |
| Decision | [DEC-028](../../decisions/DEC-028-phase-05c3-laravel.md) |

## Scope and pins

- Official `laravel/laravel` scaffold `12.12.2`, source commit `945f4e5a9fd3695dc0ee512f497c650fb82cfbb8`; resolved framework `12.72.0`; PHP `8.2.6`; Composer `2.8.11`; PHPUnit `11.5.58`.
- Node `v22.22.1` / npm `10.9.4`; Rust/Cargo `1.99.1`; Go `1.26.7` for bounded BE-02 regression.
- MySQL Community Server `8.4.13` LTS, Windows x64 ZIP. Official vendor MD5 `7b94489d5524dea9b27097068bea25a8`; archive SHA-256 `e9cd98b1d23f122987b1afca26ad942efec5891481103d48ae3cde237fa3ea54`; detached GPG signature verified with Git-bundled GPG `2.2.29` against documented MySQL key fingerprint `BCA43417C3B485DD128EC6D4B7B3B788A8D3785C` (`Good signature`; web-of-trust warning remains; GPG executable is not Authenticode-signed). `mysqld.exe` SHA-256 `7a976874ef3974d612081960b1c193c663b4434692b6257382352c587e367ad6`; `mysql.exe` SHA-256 `4617a66bf7509891d3a7be522d78a141b1d4dc16936c5077ddf119f7dd264b88`.
- Portable MySQL binaries retained at `%LOCALAPPDATA%\FormaForge\toolchains\mysql\mysql-8.4.13-winx64`; no MSI, Windows service, PATH/registry/security change, or global install.
- Generated output is standalone API only: JSON health/info endpoints, validated notes endpoint, Eloquent model, manual migration, PHPUnit tests, Composer lock, manifest, and setup docs. Composer scripts/plugins are disabled. No frontend/npm/Vite, generated `.env`, auth, Docker, database provisioning, or automatic migration.
- The generator never installed PHP/Composer or changed global PATH, registry, PHP, Composer, or security settings.

## CLI and native acceptance

| Command / flow | Result |
|---|---|
| `npm run test:e2e:phase-05c3:cli` | Exit 0: read-only plan, Doctor, explicitly consented generation, scaffold/package/lock identity, PHP lint, Artisan routes, PHPUnit, local HTTP smoke, manifest, and forbidden-file checks passed. |
| `npm run test:e2e:phase-05c3:native` | Exit 0: Tauri Forge Studio plan/Doctor, generation/result/history, folder and VS Code open, cancellation, recovery inspection, and occupied-target collision passed. |

CLI generated-lock SHA-256: `e04ff8c19f4b8ab5e9d2a3d6d8b21531ba261c0e5f3e27f841e3ddfcc4b97121`.

Native generated-lock SHA-256: `7e9a6cb1009ab225f143856355716d31e9a18e49e33473b2aa03329a0bc0063d`.

Each run recorded its own Composer resolution and manifest hash; no cross-run lockfile byte-identity claim is made.

Both native consent controls started unchecked. Dependency-execution consent alone kept generation disabled; generation began only after explicit dependency consent and internal planned-recipe consent. UI disclosed disabled Composer scripts/plugins and unsandboxed Artisan/PHPUnit package loading. BE-05 and result/history stayed `planned`.

Generated README and `docs/SETUP.md` now show guarded, explicit `php artisan migrate` setup for an existing schema owned by the user. CLI E2E asserts both instructions and the no-auto-database/migration boundary.

The native cancellation test reached `installing started.`; requested target stayed absent, owned staging was removed, and inspection found no matching recovery record. Existing `race-create` transaction was reported as `parentUnverifiable` / `createIntent`; it was not modified or repaired. Collision Doctor blocked generation; existing sentinel content was unchanged and no staging remained.

## Isolated MySQL/Eloquent acceptance

**Bounded local acceptance: PASS. BE-05 remains `planned`; this is not independent recipe acceptance or release approval.** Run ID: `phase05c3-mysql-e2e-20261115-00799f53`.

- Used the vendor-verified portable MySQL 8.4.13 LTS ZIP above. Fresh data/temp directories lived under the unique approved OpenCode temp run. MySQL was initialized with `mysqld --defaults-file=<unique-my.ini> --initialize` (not `--initialize-insecure`), bound only to `127.0.0.1:3307`, and started as a process; no service or existing MySQL/MariaDB database was used or changed. Initial random root password was rotated. Root/app/wrong-password values stayed in process environment and were not recorded.
- Exact test schema: `ff_be05_20261115_00799f53`; app account: `ffbe05_00799f53@localhost`. App connection used TCP `127.0.0.1:3307`. `SHOW GRANTS` contained only global `USAGE` plus `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES, DROP` on that schema. MySQL listed metadata schemas (`information_schema`, `performance_schema`) as visible names; this did not grant application access to `mysql.user` (read denied) or permission to create another database (denied).

| Check | Result |
|---|---|
| Fresh generation boundary | PASS — schema and Laravel default `laravel_test` were absent before and after generation; generated project had no `.env`; no automatic schema or migration. README and setup migration instructions were present. |
| Explicit migration | PASS — `php artisan migrate --force` from generated project exited 0 using the schema-scoped account; `migrations` and `project_notes` tables and expected migration record appeared. |
| Default tests | PASS — `php artisan test`, 3 generated API tests. Harness created an empty, credential-free `.env` only after asserting generator left it absent, to avoid PHPUnit's missing-file warning; removed it immediately and rechecked absence. These tests did not connect to the database. |
| MySQL/PHPUnit integration | PASS — a temporary test-only `MySqlAcceptanceTest.php` validated connection host/port/schema/server version and Eloquent create/read/update/delete. Ran `vendor\bin\phpunit --no-configuration --bootstrap vendor\autoload.php tests` with DB values only in process environment, because generated `phpunit.xml` hardcodes ordinary test defaults to port `3306`, schema `laravel_test`, and user `root`. Four tests passed (22 assertions); no credentials were written to `.env` or PHPUnit config. |
| Invalid credentials | PASS — process-scoped random wrong password; Laravel `migrate:status` returned access denied with nonzero exit. Secret absent from output/logs. |
| Schema isolation | PASS — exact schema-only grants; `mysql.user` read and `CREATE DATABASE` outside grant denied; no forbidden schema created. |
| Unavailable DB | PASS — after stopping only the verified test-owned MySQL process tree, Laravel `migrate:status` returned connection-refused/SQLSTATE `2002` with nonzero exit. |
| Cleanup | PASS — test schema and account dropped and absence verified; owned server stopped; no listener on `3307`, MySQL process, or service remained; unique test data/project/log run directory removed. Portable binaries retained. |

The generated project and integration test were temporary acceptance artifacts, not committed. No existing database, `race-create` journal, global environment, PATH, registry, or security setting was changed.

Harness bring-up retries exposed and corrected local test-driver issues (MySQL hostname matching, expired initial root credential handling, selected schema/working directory, PHPUnit's hardcoded DB defaults, and metadata-schema visibility). They were not treated as passes. Each failed instance was stopped by verified process identity; its test schema/account and unique data directory were cleaned. The final run above is the only completed acceptance result.

## Regression checks

| Command | Result |
|---|---|
| `npm test` | Exit 0: core 56 passed / 1 expected elevated-only skip; CLI 10/10; desktop 15/15. |
| `npm run typecheck` | Exit 0: core, CLI, and desktop. |
| `npm run lint` | Exit 0. |
| `node scripts/phase-05c3-cli-e2e.mjs` | Exit 0 after generated README/SETUP explicit migration-command assertions were added. |
| Supervisor `cargo test --locked` | Exit 0: 4 passed. |
| Tauri `cargo test --locked` | Exit 0: 9 passed. |
| Supervisor and Tauri `cargo fmt -- --check` | Exit 0. |
| Supervisor and Tauri `cargo clippy --all-targets --locked -- -D warnings` | Exit 0. |
| `node scripts/phase-05a-cli-e2e.mjs` | Exit 0: BE-01 Express generation, checks, cancellation, collision preservation, and shutdown regression. BE-01 remains planned. |
| `node scripts/phase-05b-cli-e2e.mjs` | Exit 0: BE-02 Go `1.26.7` plan/Doctor, checks, HTTP smoke, missing-tool block, cancellation, collision, and unchanged Go environment. BE-02 remains planned. |
| `npm run test:policy:phase-05c3` | Exit 0: release-profile policy blocked planned BE-02, BE-05, and BE-06 before staging, despite runtime override attempts. Development build profile restored afterward; no release artifact or promotion. |

## Remaining gates

- Independent BE-05 review and promotion remain open; bounded local MySQL evidence does not change planned status.
- Broader product acceptance, clean-machine packaging, security review, and release approval remain open. No push, deployment, or release occurred.
