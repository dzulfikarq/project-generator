# DEC-026 — Phase 05B Standalone Go REST API

| Field | Value |
|---|---|
| Status | User-authorized implementation, bounded Windows CLI/native acceptance, and final regression complete; independent review pending |
| Date | 2026-11-15 |
| Scope | BE-02 standalone Go `net/http` REST API, Go Modules, no database or third-party dependencies |
| Evidence | [Phase 05B report](../qa/evidence/phase-05b-go-net-http.md) |

## Decision

- Add BE-02 through existing resolver, read-only plan/Doctor, owned staging, supervised execution, cancellation, manifest, and Forge Studio/Tauri path.
- Use a reviewed built-in starter, Go `>=1.22`, standard-library-only APIs, and generated `go.mod` with `go 1.22.0`. Do not run `go mod tidy`, install tools, fetch modules, generate `go.sum`, or change global Go configuration.
- Generate `/health` and `/api/info`, request logging, HTTP timeouts, graceful shutdown, tests, setup docs, and local `fmt`, `vet`, `test`, `build`, and HTTP smoke checks. The generated server does not start automatically after generation.
- Doctor checks Go itself and does not require Node/npm for BE-02. Review exposes validated module path and zero declared network operations; no dependency lifecycle consent is requested. The normal release profile continues to block BE-02; development override is evidence-only.
- Reconcile the draft recipe registry: BE-02 now denotes Go standard-library `net/http`; NestJS becomes BE-03, Go Gin BE-04, Laravel BE-05, and FastAPI BE-06. All remain planned until separately accepted.
- Exclude databases, ORM/driver setup, frontend/fullstack, authentication, deployment, third-party modules, tool installation, push, and release.

## Rationale and risks

Go's standard library provides the requested REST starter without dependency lifecycle scripts or a package registry. Module-path validation and native `go.mod` identity verification protect reviewed selection identity. Go commands run under the existing process supervisor; process supervision is not a filesystem/network sandbox. Local evidence is not independent acceptance, security approval, clean-machine proof, or release readiness.

## Phase gate

**GO for independent BE-02 review only.** Keep BE-02 `planned`; promotion and public release remain **NO-GO** pending independent review and existing security/clean-machine gates. The Phase 05B recommendation to evaluate FastAPI was later scoped by user authorization in [DEC-027](DEC-027-phase-05c1-fastapi.md); Laravel remains a separate recommendation, not authorized implementation scope.
