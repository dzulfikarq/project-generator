# DEC-034 — Phase 07A React/Vite + Express + PostgreSQL + Drizzle

| Field | Value |
|---|---|
| Status | Independent acceptance **PASS WITH FINDINGS**; Phase 07A development closure **GO**; FS-06 remains `planned`; public release **NO-GO** |
| Date | 2026-11-18 |
| Scope | Separate FS-06 React + Vite web app and Express + PostgreSQL + Drizzle API in one npm workspace |
| Requirements | PRD-008–009, PRD-017–019; adapter and filesystem safety contracts |
| Evidence | [Phase 07A evidence](../qa/evidence/phase-07a-react-express-postgresql-drizzle.md) |

## Recorded direction

- Use FS-06; preserve PRD's separate FS-01 reservation. Keep FS-06 distinct from FS-02 (React/Vite + Go/Gin + PostgreSQL/pgx), BE-08 (Express/PostgreSQL/Drizzle API), and BE-09 (NestJS/PostgreSQL/Drizzle API).
- Generate exactly one owned project, one npm workspace root, and one root `package-lock.json`. Pin direct dependencies at every root/workspace declaration and verify their resolved lock entries and npm integrity; pin root TypeScript because Core runs root `node_modules/typescript/bin/tsc`.
- Use npm. PostgreSQL 16+ is user-provided. Generation, API startup, `/health`, and SQL generation must not provision, connect to, or migrate PostgreSQL.
- Apply migrations only through explicit guarded `npm run db:migrate -- --target host:port/database`; direct Drizzle Kit invocation remains outside wrapper checks.
- Require explicit dependency-execution consent. Keep planned-recipe override internal to development builds. Do not promote FS-06 or approve a release based on local E2E.

## Alternatives rejected

- Add a frontend to BE-08 or BE-09: would change their standalone API contracts and blur fullstack scope.
- Reuse FS-02: its Go/Gin + pgx API is a distinct tuple.
- Generate nested independent web/API projects or lockfiles: conflicts with the selected one-workspace output and adds duplicate dependency resolution.
- Provision or migrate PostgreSQL during generation/startup: would cause unapproved effects on user-managed services.
- Enable planned recipes in normal/release builds based on local tests: independent acceptance and security/release gates remain outstanding.

## Verification and disposition

- Windows CLI E2E passed on Node.js `22.22.1`, npm `10.9.4`, and run-owned PostgreSQL `17.2` at `127.0.0.1:64604`; `5432` was excluded. It covered dependency/lock integrity, generated SQL, app checks/builds, DB-free smoke, guarded migration/CRUD, mismatch rejection, rollback, cancellation, collision, long-path rejection, and FE-01/BE-01/BE-07/BE-08 plan regressions.
- Independent CLI E2E passed against run-owned PostgreSQL `17.2` at `127.0.0.1:58068`. Independent Chrome browser E2E passed against a separate PostgreSQL `17.2` instance at `127.0.0.1:55480`, covering React → Express → PostgreSQL create/read/update/delete, loading and empty states, API outage, database outage, credential sanitization, and clean shutdown.
- Native Desktop E2E passed **66/66 assertions** without PostgreSQL. It covered FS-06 review, planned status, both closed-by-default consents, one-consent blocking, generation flow, cancellation, collision, and recovery. PID `5172` was observed live before cancellation and absent after the cancelled terminal result; this confirms observed exit by that result, not that cancellation caused process termination. Destination/staging were absent, recovery was empty, and collision sentinel was preserved. Native report files remain in the isolated run root; post-run process inspection found no Tauri/Cargo/Node process from that root.
- System and bundled Node release-policy checks passed and blocked planned FS-06 before staging. Final checks passed: typecheck, lint, full npm tests (core 82 passed / 1 expected elevated-only skip; CLI 11/11; Desktop 16/16), Tauri Rust tests 9/9, Rust format, and script syntax checks.
- PostgreSQL `16` remains **NOT VERIFIED**. Clean-machine/installer behavior, accessibility, and broader security review remain open. npm lifecycle scripts remain unsandboxed after consent; direct Drizzle Kit migration can bypass wrapper checks.

**Disposition:** Independent acceptance is **PASS WITH FINDINGS**; Phase 07A development closure is **GO**. FS-06 remains `planned`; no recipe promotion or public-release approval is recorded. Public release remains **NO-GO**.
