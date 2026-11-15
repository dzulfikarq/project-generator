# DEC-028 — Phase 05C.3 Standalone Laravel Backend

| Field | Value |
|---|---|
| Status | Scoped implementation, bounded CLI/native plus isolated MySQL/Eloquent acceptance, and bounded independent evidence review complete; Phase 05C development scope closed; BE-05 remains planned |
| Date | 2026-11-15 |
| Scope | BE-05 standalone Laravel 12 / PHP / Composer / MySQL / Eloquent; no frontend, fullstack, auth, Docker, or database provisioning |
| Evidence | [Phase 05C.3 evidence](../qa/evidence/phase-05c3-laravel.md) |

## Decision

- Preserve BE-03 NestJS, BE-04 Go Gin, and BE-06 FastAPI IDs. Add BE-05 only as standalone Laravel + MySQL/Eloquent.
- Target Laravel 12, whose official requirements include PHP `>=8.2` and documented core extensions. Record exact scaffold and resolved package versions in generated lock/manifest; keep recipe `planned`.
- Use maintained `laravel/laravel` Composer scaffold. Suppress Composer plugins/scripts during generation and dependency resolution; inspect and remove frontend tooling and automatic post-create/database actions. No npm/Vite build, database creation, or migration.
- Generate MySQL configuration, Eloquent example, API endpoints, tests, and truthful Artisan/setup docs. Connect only to an explicitly approved isolated test database; never alter a user's MySQL service.
- Require explicit generation/lifecycle consent for dependency installation. Do not install PHP/Composer or mutate global PATH, registry, or security settings.
- Missing/incompatible tools or an unapproved/unavailable isolated DB block only their acceptance checks; they do not expand scope or imply recipe readiness. Bounded MySQL/Eloquent acceptance passed against a fresh, test-owned portable MySQL instance; this does not promote BE-05 or approve release.
- Bounded independent read-only review of BE-05 evidence: **PASS**. Close Phase 05C development scope. Keep BE-05 `planned`; this review does not approve recipe promotion or public release.

## Rationale

The compatibility matrix already assigns BE-05 to Laravel + PHP/Composer + MySQL/Eloquent. Laravel 12's official server requirements match observed PHP 8.2. Local scaffold/dependency execution stays in owned staging with Composer scripts/plugins disabled; database setup remains user-directed.
