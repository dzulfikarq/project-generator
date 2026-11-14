# DEC-025 — Phase 05A Standalone Express REST API

| Field | Value |
|---|---|
| Status | User-authorized scoped implementation and bounded local CLI/native acceptance complete; independent recipe review pending |
| Date | 2026-11-14 |
| Scope | BE-01 Node.js + TypeScript + Express + npm standalone REST API; no DB/fullstack |
| Evidence | [Phase 05A report](../qa/evidence/phase-05a-express-rest-api.md) |

## Decision

- Add BE-01 through the existing resolver, read-only plan/Doctor, owned staging, supervisor, cancellation, consent, manifest, and Forge Studio/Tauri flow.
- Write a reviewed built-in starter into owned staging; do not add a scaffold engine or execute an external scaffold CLI.
- Pin Express `5.1.0`, `@types/express` `5.0.3`, `@types/node` `22.20.5`, `tsx` `4.20.5`, and TypeScript `5.9.3`, including npm integrity metadata. Require Node.js `>=22.13.0`; use npm.
- Generate `/health`, `/api/info`, JSON middleware, JSON 404/error handling, `.env.example`, setup docs, typecheck/tests/build, HTTP smoke, and graceful SIGINT/SIGTERM shutdown.
- Exclude frontend, database, ORM, authentication, fullstack composition, push, and deployment. Proposed SQLite/Drizzle work remains separate and unimplemented.
- Keep BE-01 `planned`. Release CLI/Tauri builds must reject it before staging; internal debug override is evidence-only.

## Rationale and risks

Reviewed starter keeps scaffold execution smaller while retaining pinned dependencies. npm install can execute dependency lifecycle scripts unsandboxed after explicit consent; Windows Job Objects supervise process lifetime, not filesystem/network access. Local E2E is not independent acceptance, security approval, clean-machine evidence, or release readiness.

## Phase gate

**GO for independent BE-01 review/acceptance only.** BE-01 promotion and public release remain **NO-GO** pending independent review and existing security/clean-machine gates. Recommend Phase 05B evaluate a separate Go standard-library `net/http` + Go Modules recipe before database/fullstack expansion.
