# DEC-030 — Phase 05D.2 Standalone Go Gin Backend

| Field | Value |
|---|---|
| Status | User-authorized bounded implementation and Windows CLI/native acceptance complete; independent evidence review pending; BE-04 remains planned |
| Date | 2026-11-16 |
| Scope | BE-04 standalone Go + Gin `v1.12.0` + Go Modules, Go `>=1.25.0`; no database/ORM, authentication, Docker, frontend, or fullstack |
| Evidence | [Phase 05D.2 evidence](../qa/evidence/phase-05d2-go-gin.md) |

## Decision

- Replace BE-04's former Gin + PostgreSQL/pgx scope with standalone Gin API. Preserve PostgreSQL/pgx as separate proposed database/fullstack scope; FS-02 remains unchanged and unverified.
- Pin Gin `v1.12.0`; generated `go.mod` declares Go `1.25.0` and an exact Gin module requirement. Pin the resolved transitive module graph and checksums in generated `go.mod`/`go.sum`.
- Use Go Modules checksum verification and `go mod verify`. Generation downloads modules only after explicit, separate network/module-download consent. No `go get -u`, silent upgrades, global Go configuration, or automatic toolchain download; set `GOTOOLCHAIN=local` per process.
- Add the recipe through existing catalog, resolver, plan, Doctor, CLI, job supervisor/staging/recovery, and Tauri UI. Keep BE-04 `planned`; normal/release generation remains blocked until independent acceptance and review.
- Preserve BE-02 Go `net/http` behavior, its Go `1.22.0` module baseline, no-dependency/no-`go.sum` output, and existing evidence.

## Acceptance gate

**Bounded local Windows acceptance passed** on Go `1.26.7`, Node `22.22.1`, npm `10.9.4`, Windows 11 Pro `10.0.26300`, x64. CLI and non-elevated native Tauri runs passed separate network/planned consent, pinned module integrity, `gofmt`, `go vet`, `go test`, `go build`, `/health` and `/api/info` smoke, graceful shutdown, cancellation cleanup, collision preservation, native result/history/open, release-policy rejection before staging, and BE-02 CLI/native regressions. Full test, typecheck, lint, Rust fmt/test/Clippy checks passed; precise commands, hashes, and limits are in the linked evidence. This is local evidence, not independent review. Do not promote BE-04 or approve release.
