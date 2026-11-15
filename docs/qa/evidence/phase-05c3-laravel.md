# Phase 05C.3 — Standalone Laravel BE-05 Evidence

| Field | Value |
|---|---|
| Date | 2026-11-15 |
| Host | Windows 11 Pro `10.0.26300`, x64; non-elevated |
| Recipe | BE-05 standalone Laravel / PHP / Composer / MySQL + Eloquent configuration |
| Status | **Bounded local CLI/native acceptance passed; BE-05 remains `planned`; no release approved** |
| Decision | [DEC-028](../../decisions/DEC-028-phase-05c3-laravel.md) |

## Scope and pins

- Official `laravel/laravel` scaffold `12.12.2`, source commit `945f4e5a9fd3695dc0ee512f497c650fb82cfbb8`; resolved framework `12.72.0`; PHP `8.2.6`; Composer `2.8.11`; PHPUnit `11.5.58`.
- Node `v22.22.1` / npm `10.9.4`; Rust/Cargo `1.99.1`; Go `1.26.7` for bounded BE-02 regression.
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

The native cancellation test reached `installing started.`; requested target stayed absent, owned staging was removed, and inspection found no matching recovery record. Existing `race-create` transaction was reported as `parentUnverifiable` / `createIntent`; it was not modified or repaired. Collision Doctor blocked generation; existing sentinel content was unchanged and no staging remained.

## Database boundary

**BLOCKED — MySQL/Eloquent integration was not tested.** Follow-up read-only preflight found no Docker CLI; no `mysql`/`mysqld` executable on PATH; the existing Laragon MySQL candidate contained only `my.ini`, without `bin/mysqld.exe`; no MySQL/MariaDB process or service; and no listener on ports `3306`/`3307`. No approved isolated database endpoint/configuration was documented.

No database connection, server startup, data-directory initialization, schema creation, or migration was attempted. Generated config/model/migration and non-DB API smoke do not establish connectivity.

**Single provisioning option for approval:** provide one dedicated MySQL 8 test endpoint bound to `127.0.0.1:3307`, with a pre-created run-specific schema (for example `ff_be05_test_<run-id>`) and a dedicated user granted only that schema's required DDL/CRUD permissions. Supply temporary credentials through process-scoped environment variables. Do not reuse Laragon/application databases, grant global schema access, or install Docker/MySQL as part of this run.

## Regression checks

| Command | Result |
|---|---|
| `npm test` | Exit 0: core 56 passed / 1 expected elevated-only skip; CLI 10/10; desktop 15/15. |
| `npm run typecheck` | Exit 0: core, CLI, and desktop. |
| `npm run lint` | Exit 0. |
| Supervisor `cargo test --locked` | Exit 0: 4 passed. |
| Tauri `cargo test --locked` | Exit 0: 9 passed. |
| Supervisor and Tauri `cargo fmt -- --check` | Exit 0. |
| Supervisor and Tauri `cargo clippy --all-targets --locked -- -D warnings` | Exit 0. |
| `node scripts/phase-05a-cli-e2e.mjs` | Exit 0: BE-01 Express generation, checks, cancellation, collision preservation, and shutdown regression. BE-01 remains planned. |
| `node scripts/phase-05b-cli-e2e.mjs` | Exit 0: BE-02 Go `1.26.7` plan/Doctor, checks, HTTP smoke, missing-tool block, cancellation, collision, and unchanged Go environment. BE-02 remains planned. |
| `npm run test:policy:phase-05c3` | Exit 0: release-profile policy blocked planned BE-02, BE-05, and BE-06 before staging, despite runtime override attempts. |

## Remaining gates

- BE-05 independent review and promotion remain pending; no recipe status changed.
- MySQL/Eloquent integration remains blocked until an explicitly approved isolated database is available.
- Broader product acceptance, clean-machine packaging, security review, and release approval remain open. No push, deployment, or release occurred.
