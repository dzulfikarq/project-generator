# Phase 05D.2 — Go Gin BE-04 local acceptance evidence

| Field | Value |
|---|---|
| Date | 2026-11-16 |
| Baseline | `2e9fb8143c768b4cfe527a6c54853a569d60eab6` |
| Host | Non-elevated Windows 11 Pro `10.0.26300`, x64 |
| Toolchain | Node.js `22.22.1`; npm `10.9.4`; Go `1.26.7`; Rust/Cargo `1.99.1`; Tauri `2.12.4`; WebView2 `157.0.4341.46` |
| Recipe | BE-04, standalone Go + Gin `1.12.0` + Go Modules; minimum Go `1.25.0` |
| Status | Local implementation and bounded Windows evidence **PASS**; BE-04 remains `planned`; independent review and release approval remain open |

## Scope and decisions

- BE-04 generates a standalone Gin API. No database/ORM, authentication, frontend, Docker, or fullstack files are generated. PostgreSQL/pgx remains separate proposed FS-02 scope; FS-02 is unchanged and unverified.
- `go.mod` pins Gin and all 55 resolved graph modules; `go.sum` SHA-256 is `31bf03d80449b3fbb593ffc5b8c1b81f5ee87f8e68ad3c66c1a92590a6319250`.
- The graph declares Go `1.25.0`; highest dependency `GoVersion` observed was `1.25.0`. Go `1.26.7` ran acceptance.
- CLI `--allow-module-downloads` and native module checkbox are separate from lifecycle-script consent. Denial happens before staging. BE-04 has no lifecycle consent because no scripts run. Module-download approval applied only to this acceptance run.
- Generator sets `GOTOOLCHAIN=local`, `GOENV=off`, pinned public `GOPROXY`, and `GOSUMDB=sum.golang.org` per child process. CLI acceptance compared `go env GOENV GOPROXY GOSUMDB GOTOOLCHAIN` before/after; global Go settings were unchanged.

## Windows CLI and native results

| Area | Result |
|---|---|
| Catalog/plan | BE-04 resolves as planned; Go minimum, module graph, proxy/checksum access, expected writes, and separate network consent disclosed. Invalid manager rejected. DB/fullstack choices rejected. |
| Consent gate | CLI generation without module-download consent returned `GEN_MODULE_DOWNLOAD_CONSENT_REQUIRED`, before staging or destination writes. Native Review showed module and planned-recipe approvals unchecked; either approval alone kept Generate disabled. Lifecycle consent was not requested. |
| Module integrity | Successful download used pinned graph; `go mod verify` passed; `go list -m` checked all 55 modules and maximum Go requirement; generated `go.mod` remained exact and `go.sum` hash matched pin. |
| Generated checks | `go-module`, `gofmt`, `go vet ./...`, `go test ./...`, `go build ./...`, HTTP smoke for `/health` and `/api/info`, and graceful-shutdown unit test passed in CLI and native runs. |
| Cancellation/cleanup | CLI cancellation during module download returned cancelled, removed owned staging, and left destination absent. Successful finalization removed stage/cache. |
| Collision | CLI and native Doctor blocked occupied destination; sentinel remained byte-identical; no stage remained. |
| Native result/history/actions | Result and Recent Projects retained BE-04 `planned`; Open Folder and Open in VS Code passed. |
| Release policy | `npm run test:policy:phase-05d2` built release CLI and blocked planned BE-02 and BE-04 before staging despite environment override and development-only flag; Gin module-download flag did not bypass policy. |

CLI run used `node scripts/phase-05d2-gin-cli-e2e.mjs`; native run used `node scripts/phase-05d2-gin-native-e2e.mjs`. Both reported `win32-x64`, Go `1.26.7`, Gin `1.12.0`, matching `go.sum` hash, and `recipeStatusAtCreation: planned`.

## BE-02 regression and project checks

- BE-02 CLI E2E: `npm run test:e2e:phase-05b:cli` — generation, Go checks, HTTP smoke, no `go.sum`, missing-Go/preflight behavior, cancellation, collision, and global Go environment unchanged passed.
- BE-02 native E2E: `node scripts/phase-05b-native-e2e.mjs` — Doctor/plan, no third-party downloads/lifecycle consent, generation, result/history/open, cancellation cleanup, and collision passed. Read-only recovery inspection still reports pre-existing `race-create` (`parentUnverifiable`); it was not changed.
- `npm test`: core 65 passed / 1 expected elevated-only skip; CLI 10/10; desktop 15/15.
- `npm run typecheck`, `npm run lint`, and Windows supervisor/Tauri `cargo fmt -- --check`, `cargo test --locked`, and `cargo clippy --locked --all-targets -- -D warnings` passed. Supervisor Rust tests 4/4; Tauri Rust tests 9/9.
- After tightening the read-only Go Doctor probe to set both `GOTOOLCHAIN=local` and `GOENV=off`, a CLI Doctor check confirmed Go `1.26.7` satisfies Gin's `>=1.25.0` minimum and left target absent; Doctor performed no module/network access.

## Cleanup finding

First Gin CLI run passed module, Go, HTTP, and shutdown validations but returned `partial` because Go's extracted module cache contained read-only files and Windows refused owned-stage deletion. Recovery inspection identified a committed wrapper eligible for explicit cleanup; first cleanup attempt also failed. The native supervisor now clears the read-only attribute through already-validated, handle-rooted staging handles before deleting owned entries. A focused Windows regression test passes, explicit recovery cleanup completed, and subsequent complete CLI/native Gin runs removed staging successfully. No generated target was overwritten or discarded.

## Limits

This is local Windows evidence, not independent recipe review. BE-04 remains `planned`; normal and release generation remain blocked. No database/auth support, recipe promotion, push, deployment, or release approval is claimed. The existing `race-create` recovery record remains untouched.
