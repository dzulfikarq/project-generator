# Phase 06B — Express + PostgreSQL + Drizzle evidence

| Field | Value |
|---|---|
| Status | **Independent acceptance PASS WITH FINDINGS; Phase 06B development closure GO; BE-08 remains planned; public release NO-GO** |
| Date | 2026-11-17 |
| Host | Windows 11 Pro `10.0.26300`, x64; non-elevated session |
| Toolchain | Node.js `22.22.1`; npm `10.9.4`; Rust `1.99.1`; PostgreSQL 17 binaries detected |
| Recipe | BE-08, still `planned` |
| Decision | [DEC-032](../../decisions/DEC-032-phase-06b-express-postgresql-drizzle.md) |

## Scope and implementation

BE-08 is separate from BE-01 database-free Express and BE-07 SQLite/Drizzle. It adds catalog/resolver/plan wiring, generated Express + PostgreSQL + Drizzle starter and docs, database safety tests, desktop selectors, Tauri selection mapping, and release-policy coverage.

Direct dependency pins and npm registry integrity values:

| Package | Version | Registry integrity |
|---|---:|---|
| `drizzle-orm` | `0.45.4` | `sha512-NiM1YZpJ2UxyeE67DpDDZ+Tsw4YLX3trSlkNT7Tm9eKoUNb1LvaAaQzXgYQsWs+AQ9TUmmwMmBOCXuqqxUWKKQ==` |
| `drizzle-kit` | `0.31.11` | `sha512-YCYqxTLIB2OCqf6w9/Vef13baBVbwQIPcbT4Y56AfO6B9ajZhDhD8Jkveg/hJvT/iuMloKD/IYYkyMMNhr7Kqg==` |
| `pg` | `8.23.1` | `sha512-aL96AHANtWjPLDOLqnhx+ngp9+UK7ETEU8VJrDCGvsSSi/mGLcWYsS6Herg7lmaBJe4uwrfqsa7gTEFaSizDoQ==` |
| `@types/pg` | `8.23.1` | `sha512-fKVHpikPdg4GKks3JuLEhvwSyvwzF23hnabPy6DD8ljVbC7+6J5dQzdv4arV6jqq57djnMgs1HKBxX4P8aBI3A==` |

Generated behavior is intended to enforce these boundaries:

- Generation creates migration SQL and never applies it or connects to PostgreSQL.
- Startup checks URL syntax and creates a lazy pool; `/health` is process-only.
- PostgreSQL 16+ is user-provided and required only for CRUD or explicit migration.
- Migration requires `npm run db:migrate -- --target host:port/database`, exact URL/target match, connected database/role/address/port/version preflight, and pool closure on success/failure.
- `DATABASE_URL` rejects query strings and fragments, including URL-based SSL parameters.
- Direct `drizzle-kit migrate` remains outside wrapper enforcement. npm lifecycle/build code remains unsandboxed after explicit consent.

## Checks passed

Commands run on this host:

| Command | Result |
|---|---|
| `npm test` | PASS after fixes — core 72 passed / 1 expected elevated-only skip; CLI 11/11; desktop 16/16 |
| `npm run typecheck` | PASS — core, CLI, desktop |
| `npm run lint` | PASS |
| `cargo fmt --manifest-path packages/desktop/src-tauri/Cargo.toml -- --check` | PASS |
| `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml --offline` | PASS — 9/9 |
| `node --check` for Phase 06B E2E, release-policy, and packaged smoke scripts | PASS |
| `npm run test:policy:phase-06b` | PASS after runner fix — system Node and bundled Node; planned BE-08 blocked before staging |
| `npm view <package>@<pin> dist.integrity` for each direct dependency | PASS — values above matched catalog |

These checks plus targeted E2E verify bounded same-host behavior only; they do not establish independent acceptance, recipe promotion, or release readiness.

## Prior implementation runtime E2E — PASS for stated local scope

`npm run test:e2e:phase-06b` first encountered a PostgreSQL-reserved `pg_` role name; the harness changed it to `e2e_admin`. Instrumentation fixed a false `pg_ctl` timeout (file-backed output) and a harness identity comparison (`host(inet_server_addr())`). A focused core fix added `startPostgresSmokeProcess`, which synthesizes only a loopback probe `DATABASE_URL`; generic runner allowlist remains unchanged and still rejects caller-supplied `DATABASE_URL`. Regression tests cover generic rejection, normal-process isolation, and smoke-only URL injection.

After the smoke and address fixes, `npm run test:e2e:phase-06b` exited `0`. Host `win32-x64`, Node `v22.22.1`, PostgreSQL `17.2`, run-owned loopback port `61279`. BE-08 remained `planned`. Generation verified pinned dependencies/lock integrity, migration SQL, typecheck, lint, tests, build, and DB-free HTTP health/info; owned TCP trap observed zero connections. Guarded migration rejected a mismatched target, then applied migration only to run-owned `pg_e2e_app`. Generated PostgreSQL tests passed CRUD, invalid requests, generic unavailable-DB responses, and shutdown. Conflicting migration failed without changing pre-existing schema. Cancellation during npm install removed owned staging; collision preserved existing sentinel and left no stage. BE-01 remained database-free and BE-07 SQLite/Drizzle plan regressions passed.

The installed `postgresql-x64-17` service on port `5432` was not selected, contacted, stopped, or modified. E2E reserved no fixed service port; dynamic port `61279` passed loopback bind preflight. PostgreSQL log/status confirmed run-owned data directory and `127.0.0.1` binding. `pg_ctl` start exited `0` in 439 ms. Cleanup stopped the cluster (exit `0`) and confirmed `no server running` (status exit `3`). Passing harness removed its run-owned temp root. `race-create`, protected diagnostic logs, global configuration, and elevation were untouched.

### Instrumented startup diagnosis — 2026-11-17

Earlier retained diagnostic artifacts include `%LOCALAPPDATA%\Temp\opencode\phase-06b-postgres-e2e-Teikyx` (`startup-evidence.json`, `postgres.log`). On that startup attempt, port `62706` passed loopback bind preflight, disposable data directory passed create/read/delete permission checks, and `initdb` exited `0`. Generated `postgresql.conf` had no active relevant overrides; `pg_ctl` supplied loopback-only host/port overrides.

`pg_ctl.exe` stdout was `waiting for server to start.... done` / `server started`; stderr was empty. `spawnSync` returned `exitCode: 0` **and** `error.code: ETIMEDOUT` exactly 90 seconds after invocation. PostgreSQL's log says it listened on `127.0.0.1:62706` and was ready about 0.35 seconds after start. `pg_ctl status` confirmed run-owned data directory and postmaster PID. Harness then stopped only that cluster: stop exited `0`, follow-up status exited `3` with `pg_ctl: no server running`, and PostgreSQL logged clean shutdown. No `psql` or database connection ran; generation/migration remained unreached. The existing service/database on 5432 was not used.

**Startup root cause:** harness false timeout, not PostgreSQL startup, permissions, port, or config failure. Pipe-backed `spawnSync` did not return despite successful `pg_ctl` output and exit code; the still-running PostgreSQL child held inherited stdout/stderr pipes open, preventing EOF before the harness's 90-second timeout. Startup capture now redirects stdout/stderr to run-owned files. Fix confirmed repeatedly: `pg_ctl` exited `0` in under one second and PostgreSQL logged `database system is ready to accept connections` on selected loopback port.

**Identity-check root cause:** PostgreSQL rendered `inet_server_addr()::text` as `127.0.0.1/32`, while the harness expected `127.0.0.1`; database, role, port, and normalized data directory matched. The harness query now uses `host(inet_server_addr())`. This was a harness-only correction; later run identity check passed.

**Runner root cause and bounded fix:** BE-08 HTTP smoke needs a syntactically valid URL while proving health and info routes do not connect to a database. It supplies a URL for a generator-owned TCP trap, but the generic runner correctly rejects all unreviewed `DATABASE_URL` overrides. Rather than widen the generic allowlist, a dedicated PostgreSQL smoke helper now synthesizes a fixed `postgresql://probe:probe@127.0.0.1:<owned-port>/probe_db` URL and rejects caller-provided URLs. Only `servedBackendSmoke` uses it for BE-08. Runner regressions verify other processes receive no URL and generic caller URL remains blocked. This let E2E pass generation and HTTP smoke without contacting PostgreSQL from the generated server.

**Migration guard root cause and fix:** Generated `src/db/migrate.ts` originally queried `inet_server_addr()::text`. PostgreSQL formats `inet` with CIDR suffix (`127.0.0.1/32`), while DNS lookup returns bare `127.0.0.1`; correct target was rejected. Query now uses `host(inet_server_addr())`; generated identity test asserts this expression. Subsequent E2E passed valid guarded migration and all listed database checks.

| Required runtime evidence | Status |
|---|---|
| Generate/finalize project, exact lockfile integrity, migration SQL and app checks | PASS — exact pins/lock integrity, migration SQL, typecheck/lint/tests/build and DB-free HTTP smoke passed |
| DB-free `/health` probe | PASS — owned loopback trap observed zero connection; `/health` and `/api/info` returned expected JSON |
| Guarded migration target mismatch and identity preflight against run-owned cluster | PASS — mismatch blocked; valid migration applied only to confirmed disposable target |
| Real PostgreSQL CRUD, invalid requests, generic database failure, graceful shutdown | PASS — generated integration tests against run-owned PostgreSQL |
| Migration conflict/rollback preservation | PASS — pre-existing table schema remained unchanged |
| Runtime cancellation cleanup and destination collision preservation | PASS — owned stage removed; sentinel preserved; no stage left |
| BE-01 / BE-07 regression | PASS — BE-01 database-free and BE-07 SQLite/Drizzle plan assertions retained |

## Final independent acceptance — PASS WITH FINDINGS

- Date: 2026-11-17. Host: Windows 11 Pro `10.0.26300`, x64, non-elevated; Node `22.22.1`; npm `10.9.4`; PostgreSQL `17.2`.
- After fixing the P3 harness finding, `npm run test:e2e:phase-06b` passed against a fresh run-owned cluster on `127.0.0.1:62859`. Pre-connect identity matched the run-owned data directory, database, role, address, and port. Existing PostgreSQL service on `5432` was not selected or contacted.
- Generation verified exact dependency/lock integrity and migration SQL; generated typecheck, lint, tests, build, and DB-free HTTP smoke passed. The TCP probe observed zero connections during generation/smoke. Guarded migration rejected target mismatch, then migrated only the owned DB. CRUD, invalid URL/request handling, sanitized unavailable-DB response, graceful shutdown, rollback preservation, cancellation cleanup, collision preservation, and BE-01/BE-07 regressions passed.
- `pg_ctl` start exited `0` in about 420 ms; stop exited `0`; follow-up status confirmed `no server running` (exit `3`). Harness removed its run-owned temp root.
- **Finding fixed:** `executeCapturedToFiles` opened stdout before stderr outside `try/finally`; stderr-open failure could leak stdout FD until harness exit. Both opens now occur inside `try`; nested `finally` closes every descriptor successfully acquired. `node scripts/phase-06b-postgres-e2e.mjs --test-capture-cleanup` injects stderr-open failure and asserts stdout descriptor closure. Targeted regression passed; `node --check scripts/phase-06b-postgres-e2e.mjs` passed; full E2E passed after the fix.
- Packaged release-policy evidence remains PASS for system and bundled Node; planned BE-08 stays blocked before staging, including development-override attempts. Release gate was not changed.
- PostgreSQL `16` was **not independently tested**; observed runtime was `17.2`. Clean-machine and installer acceptance remain open.
- Residual disclosures remain: npm lifecycle/build scripts run unsandboxed after consent; direct `drizzle-kit migrate` can bypass the generated wrapper; target confirmation is not cryptographic server identity and cannot prevent operator misconfirmation, DNS/server changes, or hostile endpoints.

## Disposition

**Phase 06B development closure: GO** based on independent acceptance **PASS WITH FINDINGS**; P3 harness finding is fixed and regression-covered. BE-01, BE-07, and BE-08 remain `planned`; no recipe promotion. Public release remains **NO-GO**. PostgreSQL 16, clean-machine, and installer acceptance remain outstanding.

No commit or push was made.
