# DEC-031 — Phase 06A Express + SQLite + Drizzle

| Field | Value |
|---|---|
| Status | User-authorized bounded implementation and Windows CLI/native acceptance complete; independent evidence review pending; BE-07 remains planned |
| Date | 2026-11-16 |
| Scope | BE-07 standalone Express + npm + SQLite + Drizzle API; no frontend, authentication, fullstack, or database provisioning |
| Evidence | [Phase 06A evidence](../qa/evidence/phase-06a-express-sqlite-drizzle.md) |

## Decision

- Keep BE-01 as standalone Express with no database. Add BE-07 as a distinct exact tuple: Express + npm + embedded SQLite + Drizzle.
- Pin `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `better-sqlite3@13.2.0`, and `tsx@4.21.0`; retain npm as the Node default and validate direct dependency integrity plus the generated lockfile.
- Generate schema, connection/CRUD example, Drizzle configuration, and migration SQL. Generation never applies migrations or creates the configured application DB; app startup never migrates. Smoke checks use `:memory:`; CRUD acceptance explicitly applies SQL only to an isolated temporary database.
- Keep database-path test overrides restricted to `DB_FILE=:memory:` in the generator process runner. CRUD acceptance uses its own test-owned process and isolated path.
- Expose database/ORM choices and migration/consent disclosures in desktop UI. Require lifecycle-script consent and separate development-only planned-recipe consent; normal/release generation remains blocked.
- Do not expand other database/ORM tuples, alter BE-01, promote BE-07, or claim release readiness.

## Acceptance gate

Bounded local Windows CLI and native Tauri acceptance passed for the scope in the linked report. Release-profile policy verification blocked planned BE-01 and BE-07 before staging despite override attempts. Project regression checks passed. These results are not independent review or recipe promotion; BE-07 remains `planned`.
