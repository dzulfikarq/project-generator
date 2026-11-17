# DEC-032 — Phase 06B Express + PostgreSQL + Drizzle

| Field | Value |
|---|---|
| Status | Independent acceptance **PASS WITH FINDINGS**; Phase 06B development closure **GO**; BE-08 remains `planned`; public release **NO-GO** |
| Date | 2026-11-17 |
| Scope | Distinct BE-08 Express + npm + PostgreSQL 16+ + Drizzle API; no frontend, authentication, fullstack, or service provisioning |
| Evidence | [Phase 06B evidence](../qa/evidence/phase-06b-express-postgresql-drizzle.md) |

## Decision

- Keep BE-01 database-free and BE-07 SQLite/Drizzle. Add BE-08 as a separate Express + PostgreSQL + Drizzle recipe and adapter tuple.
- Pin `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `pg@8.23.1`, and `@types/pg@8.23.1`; recorded npm registry integrity values match the catalog pins.
- Generation writes starter files and migration SQL, but must not connect to PostgreSQL or apply migrations. Startup validates URL syntax and creates a lazy pool; `/health` remains process-only.
- CRUD requires a user-provided PostgreSQL 16+ service. Migration must use the guarded wrapper and explicit `--target host:port/database`, match target to `DATABASE_URL`, verify connected database/role/address/port/version, and close the pool on every outcome. Direct Drizzle Kit migration remains outside wrapper enforcement.
- Keep BE-08 `planned`; normal/release generation stays blocked. Independent acceptance and development closure do not authorize recipe promotion or public release.

## Alternatives rejected

- Folding PostgreSQL into BE-07 would erase materially different service, connectivity, target-confirmation, and migration risks.
- Automatic migration or database provisioning during generation/startup would contact or mutate a user-controlled service without a separately confirmed target.
- Reusing an installed host database for runtime E2E would violate run ownership and isolation requirements.

## Verification and disposition

- Exact npm integrity metadata was checked for all four direct pins.
- Core, CLI, desktop, and Tauri focused tests passed; system-Node and bundled-Node packaged release-policy smoke passed after the scoped runner fix. See evidence report for commands and final regressions.
- Instrumented startup proved original `pg_ctl.exe` timeout was a pipe-backed `spawnSync` false timeout. Run-owned file capture fixed startup; harness identity uses `host(inet_server_addr())` to avoid PostgreSQL's `/32` formatting.
- Core runner fix stayed narrow: `DATABASE_URL` remains absent from generic allowlist. Dedicated BE-08 smoke helper synthesizes only a loopback probe URL and rejects caller overrides; regression tests prove normal processes remain isolated.
- A generated migration identity check initially compared CIDR-suffixed `inet_server_addr()::text` with bare DNS address. Changed generated query to `host(inet_server_addr())` and added generated test assertion.
- `npm run test:e2e:phase-06b` then **PASS** on Windows 11 Pro `10.0.26300`, Node `22.22.1`, PostgreSQL `17.2`, run-owned loopback port `61279`. Generation/lock integrity, HTTP smoke/no DB connection, migration target mismatch, guarded migration, CRUD/invalid/unavailable DB/shutdown, conflict rollback, cancellation cleanup, collision preservation, and BE-01/BE-07 plan regressions passed. Disposable cluster stopped cleanly; port 5432 was not selected or contacted.
- Final independent acceptance reran `npm run test:e2e:phase-06b` on 2026-11-17 with PostgreSQL `17.2`, run-owned loopback port `62859`. Generation, app checks, DB-free smoke, guarded migration, CRUD, mismatch/invalid-URL/error handling, credential-safe failures, shutdown, rollback, cancellation, collision, and BE-01/BE-07 regressions passed. The cluster stopped cleanly and its temp root was removed; port `5432` was not selected or contacted.
- The independent review found P3 harness cleanup flaw: stdout FD could remain open if stderr-file open failed. `scripts/phase-06b-postgres-e2e.mjs` now acquires both descriptors inside `try` and closes each acquired descriptor through nested `finally`. `node scripts/phase-06b-postgres-e2e.mjs --test-capture-cleanup` injects stderr-open failure and asserts stdout close; targeted regression and `node --check` passed. Full E2E passed after fix.
- PostgreSQL `16` has not been independently tested; observed runtime version was `17.2`. Clean-machine and installer acceptance remain outstanding. npm lifecycle/build scripts remain unsandboxed after consent; direct `drizzle-kit migrate` can bypass generated wrapper; target identity confirmation is not cryptographic and cannot prevent misconfirmation, DNS/server changes, or hostile endpoints.
- **Phase 06B development closure: GO.** Acceptance verdict: **PASS WITH FINDINGS**, with P3 finding fixed and regression-covered. BE-01, BE-07, and BE-08 remain `planned`; no recipe promotion. Public release remains **NO-GO**.
