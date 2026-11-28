# Phase 05B — BE-02 Go `net/http` Local Evidence

| Field | Value |
|---|---|
| Date | 2026-11-15 |
| Recipe | BE-02 — standalone Go standard-library `net/http` + Go Modules; no database |
| Status | Bounded Windows CLI/native evidence and final regressions complete; independent acceptance and release approval pending |
| Host | Windows 11 Pro `10.0.26300`, x64; Node.js `22.22.1`; npm `10.9.4`; Go `1.26.7 windows/amd64`; Rust/Cargo `1.99.1`; Tauri CLI `2.12.4`; WebView2 `157.0.4341.46` |

> Historical evidence from 2026-11-15. A fresh Phase 08A native run on 2026-11-19 failed during validation with `GEN_PROCESS_SUPERVISOR_FAILED`; see the [current promotion-readiness assessment](phase-08a-be02-promotion-readiness.md). This earlier native pass remains evidence for its own run, not a reproduced pass or promotion verdict.

## Scope and limits

Reviewed starter uses Go `>=1.22`, writes `go.mod` with `go 1.22.0`, and has no third-party dependencies, `go.sum`, npm, network fetch, database, frontend, or automatic server startup. It generates `/health`, `/api/info`, request logging, HTTP timeouts, graceful shutdown, tests, and standard Go documentation. BE-02 remains `planned`; internal evidence override does not promote it.

The earlier draft assigned BE-02 to NestJS. Phase 05B reconciles recipe IDs: Go `net/http` is BE-02, NestJS BE-03, Go Gin BE-04, Laravel BE-05, and FastAPI BE-06. This registry correction changes no recipe status.

## Windows CLI

- Harness: `node scripts/phase-05b-cli-e2e.mjs`; host: `win32-x64`; Go `1.26.7`.
- **PASS:** Canonical Go module-path validator lives in `packages/core/src/go-module.ts`; desktop imports the same implementation through `@project-generator/core/go-module`. It follows `golang.org/x/mod/module.CheckPath` rules, retaining the app's 512-character input limit.
- **PASS:** Core schema and desktop model regressions cover `github.com/con/api`, `github.com/acme/pkg~1`, `/v02`, `/v2.1`, reserved Windows device names, invalid leading/trailing-dot and character cases, and `gopkg.in` suffixes. Valid `/v2`, `/v3`, uppercase non-domain components, and `gopkg.in` paths remain accepted. `github.com/acme/pkg..name` also remains accepted, matching the executable `CheckPath` behavior.
- **PASS:** `node --test --test-concurrency=1 packages/core/dist/test/schema.test.js` and `node --experimental-strip-types --test packages/desktop/test/model.test.ts` exited `0` (10/10 each). CLI E2E rejected `con`, short-name, malformed-major and reserved-device paths at plan/generate, with no target or staging writes.
- **PASS:** Doctor reports supported Go; simulated missing-Go Doctor and generation fail actionably before staging. No tool install or global Go configuration change.
- **PASS:** Generated module identity, `go.mod`, standard-library-only files and manifest verified. `go fmt ./...`, `go vet ./...`, `go test ./...`, `go build ./...`, `/health`, and `/api/info` pass.
- **PASS:** cancellation during Go validation exits cancelled, removes owned staging, leaves target absent; occupied-target sentinel is preserved and no stage remains.
- **PASS:** `GOROOT`, `GOTOOLCHAIN`, and `GOPROXY` are unchanged across generation. Go operations use local/offline settings for acceptance.

## Forge Studio and Tauri

- **PASS:** `node scripts/phase-05b-native-e2e.mjs` exited `0` on `win32-x64`, Go `1.26.7`. It reused Forge Studio on `1420` and WebView DevTools on `9339`; no second app was launched. Harness restored local storage and removed its successful-run temp root.
- **PASS:** Wizard rejected `github.com/con/api`, `github.com/acme/pkg~1`, `github.com/acme/pkg/v02`, `github.com/acme/pkg/v2.1`, and `github.com/acme/COM1/api` before Review/generation. Go Doctor reported Go `1.26.7` and ready destination. Review showed BE-02 planned, the requested module path, `go.mod`, zero network operations, and no dependency lifecycle scripts; planned-run consent started closed and was explicitly affirmed for evidence generation.
- **PASS:** Native generation returned successful `scaffold-identity`, `go-module`, `go-fmt`, `go-vet`, `go-test`, `go-build`, and `http-smoke` validations. Generated manifest and `go.mod` matched module `github.com/example/pg-be-02-go`; no `go.sum` was created. Recipe status remained `planned`.
- **PASS:** Result and history contained the generated BE-02 project. Open Folder and VS Code actions succeeded.
- **PASS:** Cancellation after Go validation began returned Cancelled, left target absent, and cleaned owned staging. Read-only recovery inspection had no record referring to the cancelled BE-02 target.
- **PASS:** Existing-target Doctor blocked collision; sentinel hash stayed unchanged and no staging directory remained.
- **Observed unrelated recovery state:** inspection also returned pre-existing `race-create` / `parentUnverifiable` / `createIntent` transaction from a Windows junction-swap test. Report marked cleanup, journal discard, and finalize unavailable. It was not BE-02-owned and was left untouched. Fixed `safety.test.ts` to use a unique ID and remove its own journal even when stage creation fails; full regression passed. Existing stale journal, created Nov 13, remains preserved.

## Regression and governance

- **PASS:** `npm run test:e2e:phase-05a:cli` exited `0`; BE-01 lock/dependency integrity, typecheck, tests, graceful shutdown, build, HTTP smoke, cancellation cleanup, and collision preservation passed.
- **PASS:** `npm run test:e2e:phase-05b:cli` exited `0`; BE-02 module identity, `fmt`, `vet`, `test`, `build`, HTTP smoke, missing-Go block, cancellation cleanup, collision preservation, and unchanged Go environment passed.
- **PASS:** `npm run test:policy:phase-05b` exited `0`; release-profile CLI blocked BE-02 despite development environment/flag overrides, before staging.
- **PASS:** `npm test` exited `0`: core 46 total (45 passed / 1 expected elevated-only skip), CLI 10/10, desktop 15/15. `npm run typecheck` and `npm run lint` exited `0`.
- **PASS:** `npm run build --workspace @project-generator/desktop` exited `0`; `cargo fmt --check` passed for both Rust crates.
- **PASS:** Cargo tests: Tauri desktop 9/9; Windows supervisor 4/4 (breakaway-probe target compiled with 0 tests).
- **PASS:** `cargo clippy --locked --all-targets -- -D warnings` for both Rust crates.
- **PASS:** `npm run test:policy:phase-05b` exited `0`; release CLI blocked BE-02 before staging despite environment override and development-only flag.
- No recipe promotion, push, deploy, installer build, or release approval.

## Recommendation

**GO for independent BE-02 review.** Keep BE-02 planned; promotion and public release remain **NO-GO**. Recommend Phase 05C evaluate Laravel and FastAPI as separate backend-only recipes; no database/fullstack scope or implementation is approved here.
