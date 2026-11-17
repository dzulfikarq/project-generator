# DEC-033 — Phase 06C NestJS + PostgreSQL + Drizzle

| Field | Value |
|---|---|
| Status | User-authorized implementation and local E2E complete; independent review **PASS WITH FINDINGS, no product blocker**; Phase 06C development closure **GO**; BE-09 remains `planned`; public release **NO-GO** |
| Date | 2026-11-17 |
| Scope | Separate BE-09 NestJS 11 + npm + PostgreSQL 16+ + Drizzle API; no frontend, authentication, fullstack, or database provisioning |
| Evidence | [Phase 06C evidence](../qa/evidence/phase-06c-nest-postgresql-drizzle.md) |

## Recorded direction

- Keep BE-03 database-free, BE-07 Express + SQLite + Drizzle, and BE-08 Express + PostgreSQL + Drizzle unchanged. Add BE-09 as distinct NestJS + PostgreSQL + Drizzle tuple.
- Use official Nest CLI `11.0.24` and pinned NestJS `11.2.10` packages with Node `>=22.13.0` and npm `>=10`. Pin Drizzle ORM `0.45.4`, Drizzle Kit `0.31.11`, PostgreSQL driver `pg@8.23.1`, and associated catalog dependencies/integrity metadata.
- Generation emits starter files and SQL only. It does not connect to PostgreSQL or apply migrations. Nest starts without `DATABASE_URL`; `/health` is process-only. A singleton DatabaseService creates its pool on first CRUD access.
- Require explicit `npm run db:migrate -- --target host:port/database`. Wrapper must match the target to `DATABASE_URL`, verify connected database/role/address/port/version, and apply on that checked connection. Direct Drizzle Kit migration remains outside wrapper enforcement.
- Keep BE-09 `planned`. Independent review and verified documentation support Phase 06C development closure **GO**; neither constitutes recipe promotion or public release approval.

## Alternatives rejected

- Adding PostgreSQL to BE-03 would break its database-free contract.
- Merging BE-09 into BE-07 or BE-08 would erase the framework and database pairing boundaries.
- Automatic database provisioning, connection, or migration during generation/startup would create unapproved effects against user-controlled services.
- Using an installed PostgreSQL service for E2E would violate run ownership and isolation requirements.

## Verification and disposition

- Targeted Windows 11 Pro `10.0.26300`, x64, non-elevated CLI E2E passed on Node `22.22.1` with a run-owned PostgreSQL `17.2` cluster bound only to `127.0.0.1:57573`. PostgreSQL `16` was not tested; port `5432` was not selected.
- Exact dependency pins and generated npm lock integrity passed. Nest scaffold identity, migration SQL generation, typecheck, lint, unit/safety/Jest API/shutdown tests, build, and DB-free HTTP smoke passed; the owned TCP trap observed zero connections during generation/smoke.
- Migration target mismatch was rejected before connection. Valid guarded migration and CRUD integration passed against the owned cluster. Conflicting migration failed while preserving pre-existing table schema. CLI E2E cancellation during npm install removed owned staging; destination collision preserved the sentinel and left no staging directory.
- `npm run test:policy:phase-06c` passed for system and bundled Node; release-profile builds block BE-09 before staging. Core tests passed (76 passed, 1 expected elevated-only skip); Desktop tests passed (16/16); core/Desktop typechecks, lint, Rust formatting, and Tauri tests (9/9) passed.
- Cluster shutdown exited `0`; follow-up `pg_ctl status` reported no server (exit `3`). Failed-run task-owned temp roots were status-checked as stopped before cleanup. No commit or push was made.
- **CLI evidence:** Phase 06C CLI E2E passed on PostgreSQL `17.2` at run-owned loopback port `57573`, covering guarded migration/CRUD and related checks. It did not use the existing PostgreSQL service or port `5432`. BE-08 E2E ran separately in Phase 06B; do not attribute its result to the Phase 06C harness.
- **Native evidence:** Final native Desktop E2E r9 passed (exit `0`, 116 passed / 0 failed) with isolated app-data, WebView2, resources, Cargo target, and workspace; it used no PostgreSQL. It verified dual consent, successful normal BE-09 generation, manifest `recipeStatusAtCreation=planned`, active UI `stageId=installing`, matching live npm PID immediately before cancel, cancelled result, PID termination, absent destination/stage, empty read-only recovery, and collision `BLOCKED` with sentinel preserved.
- **Earlier native attempts:** r1 passed generation/collision only (108 assertions); its activity text did not establish npm-install cancellation. r5 follow-up established live npm cancellation and cleanup, but its harness reported FAIL on a missing UI result attribute; it was not a full native E2E pass. R6–R8 failures were harness/resource/readiness/status-selector issues, corrected in r9 without weakening the active-stage, process, terminal-result, or filesystem assertions.
- **Long paths:** BE-09 preflight conservatively rejects predicted staged `esbuild.exe` paths over 240 characters. Regression rejects 261 and accepts 219; a short-root install also completed at 219. This does not establish Windows' maximum supported path length or prove the observed 261-character `ENOENT` root cause.
- PostgreSQL `16` and clean-machine/installer acceptance remain untested and outside the agreed Phase 06C development-closure blocker set. npm lifecycle scripts remain unsandboxed after consent; direct Drizzle Kit migration can bypass the wrapper; target confirmation is not cryptographic server identity. The Phase 06C harness covers BE-01/BE-07 plan regressions, not BE-08 E2E; Phase 06B evidence is separate.

## Independent review — 2026-11-18

**Verdict: PASS WITH FINDINGS; no product blocker.** Review confirmed r9 evidence and cancellation assertions, the 240-character conservative preflight behavior, and unchanged planned-recipe/release gates. Finding was documentation drift: several summaries still presented r5 as latest and `design.md` still said native npm cancellation was unverified. This documentation sync records r9 and passed directed consistency verification. Based on that review and completed sync, Phase 06C development closure is **GO**. Review does not promote BE-09 or approve release.

**Disposition:** Phase 06C independent review is **PASS WITH FINDINGS, no product blocker**; development closure is **GO**. PostgreSQL `16` and clean-machine/installer acceptance remain unverified but are not development-closure blockers for agreed scope. BE-09 remains `planned`; public release remains **NO-GO**.
