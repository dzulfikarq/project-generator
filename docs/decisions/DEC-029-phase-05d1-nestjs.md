# DEC-029 — Phase 05D.1 Standalone NestJS Backend

| Field | Value |
|---|---|
| Status | User-authorized scoped implementation and bounded Windows CLI/native acceptance complete; independent review pending; BE-03 remains planned |
| Date | 2026-11-16 |
| Scope | BE-03 standalone NestJS 11 / TypeScript / npm API; no database/ORM, auth, Docker, fullstack, or Observe integration |
| Evidence | [Phase 05D.1 evidence](../qa/evidence/phase-05d1-nestjs.md) |

## Decision

- Implement BE-03 as standalone NestJS REST API from official Nest CLI `11.0.24`; pin every direct generated dependency and verify npm integrity.
- Require Node `>=22.13.0` and npm `>=10.0.0`; preserve Nest CLI's observed CommonJS-compatible NodeNext/Jest structure. Use Jest `30.0.0` with `ts-jest@29.4.15`.
- Run scaffold with `--skip-install --skip-git --strict --package-manager npm`; no global install, hidden install, Git initialization, or post-create command.
- Require explicit lifecycle-script consent for npm project install and separate development-only planned-recipe consent. Keep both UI controls unchecked by default.
- Include `/health`, `/api/info`, validated environment config, stable JSON exceptions, and SIGINT/SIGTERM shutdown handling. Start the built server only for bounded HTTP smoke and stop it before finalization; leave no server running after generation.
- Exclude database/ORM, auth, Docker, frontend/fullstack, Observe, and deployment. PostgreSQL/Prisma remains separate unimplemented scope.
- Keep BE-03 `planned`; normal/release generation remains blocked. Local acceptance does not promote recipe or approve release.

## Rationale

Pinned Nest CLI output is a maintained official scaffold and includes a usable Jest setup. Observed v11 output is CommonJS-compatible NodeNext and Jest 30; `--no-observe` is unsupported and no Observe integration is generated. Bounded CLI/native acceptance passed the configured standalone API checks while preserving explicit consent and release policy.

## BE-04 Go Gin recommendation

**NO-GO for full BE-04 implementation as currently proposed; GO for a separate bounded design/evaluation only.** BE-04 currently couples Gin with PostgreSQL/pgx, while code supports only standalone Go `net/http` BE-02 and contains no Gin adapter, PostgreSQL driver, DB validation, or isolated database acceptance harness. Before implementation, authorize scope for the DB contract, schema/migration behavior, dependency integrity, service ownership, failure/isolation checks, and cleanup. Do not treat BE-02 evidence as Gin or PostgreSQL evidence.
