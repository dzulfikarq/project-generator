# Phase 08A.3 — BE-02 Go 1.22.0 Minimum Compatibility

| Field | Value |
|---|---|
| Date | 2026-11-20 |
| Disposition | **PASS for tested Go 1.22.0 compatibility scope; no promotion** |
| Recipe | BE-02 — standalone Go `net/http`, Go Modules, standard library only |
| Toolchain | Go `1.22.0`, Windows x64; portable official archive |
| Generated source | Phase 08A.2 successful output, copied into a fresh disposable workspace |

## Toolchain and isolation

- Retrieved `go1.22.0.windows-amd64.zip` from `https://go.dev/dl/go1.22.0.windows-amd64.zip`.
- Trusted checksum source: official Go metadata at `https://go.dev/dl/?mode=json&include=all`; metadata SHA-256 `78b3158fe3aa358e0b6c9f26ecd338f9a11441e88bc434ae2e9f0ca2b0cc4dd3`, archive size `76,265,016` bytes. Downloaded archive matched both before extraction.
- No installer, global PATH, registry, or Go configuration change. Run was non-elevated. Each Go command was preceded by a version guard requiring `go version go1.22.0 windows/amd64`.
- `GOROOT`, `GOCACHE`, `GOPATH`, `GOMODCACHE`, `GOTMPDIR`, `TEMP`, `TMP`, `HOME`, and user app-data were isolated under the run-owned temp root. `GOENV=off`, `GOTOOLCHAIN=local`, `GOWORK=off`, `GOPROXY=off`, `GOSUMDB=off`, `CGO_ENABLED=0`. Module cache started and ended empty.

## Generated artifact identity

Copied from the preserved Phase 08A.2 output; original remained unchanged.

- Module: `github.com/example/pg-be-02-go`; `go.mod` declares `go 1.22.0`.
- Generated file count: 13, excluding manifest.
- Generated-tree SHA-256, excluding manifest: `3f5038b092001db61f725ef8ffdf3e497885527eb201b0808ae3a769234f985f`.
- Manifest SHA-256: `b402b4d6c78e2989e598bc253a49f923308ae5b66658bccc16cba5dc5ce5121f`; manifest records generation with Go `1.26.7`.

## Checks

All listed commands exited `0`; Go version guard returned exactly `go version go1.22.0 windows/amd64` before each Go command and `gofmt` check.

| Command/check | Result |
|---|---|
| `go mod edit -json` | PASS — module path and `Go: 1.22.0` matched; no toolchain directive or requirements |
| `go list -m all` | PASS — only generated module; `GOPROXY=off` |
| `go fmt ./...` | PASS — no source changes |
| `gofmt -l <generated Go files>` | PASS — no unformatted files |
| `go vet ./...` | PASS |
| `go test ./...` | PASS |
| `go test -v -run '^TestGracefulShutdownClosesListener$' ./internal/server` | PASS — generated `http.Server.Shutdown` test passed |
| `go build ./...` | PASS |
| `go build -o <isolated binary> ./cmd/server` | PASS |
| `GET /health` | PASS — HTTP 200, JSON `status: ok` |
| `GET /api/info` | PASS — HTTP 200, expected service name/version |
| `GET /missing` | PASS — HTTP 404 |

No `go.sum` was created; `go.mod` remained unchanged. `go list -m all` showed only the project module, and the isolated module cache remained empty, so no third-party module or network fetch was needed. The live HTTP smoke process was stopped after endpoint checks; graceful `http.Server.Shutdown` behavior was verified by the generated test above. Windows console-signal delivery to `main`'s `signal.NotifyContext` was not separately exercised.

## Assessment and remaining gates

The generated code formats, vets, tests, and builds with the exact declared minimum Go `1.22.0`; its method-aware `net/http.ServeMux` routes compile and run. The catalog declares `>=1.22.0`, `supportsGo` accepts that minimum, and BE-02 module validation checks the requested module path and exact `go 1.22.0` directive. No later standard-library API requirement or toolchain auto-upgrade was observed in this generated scope.

**Go 1.22.0 minimum compatibility: PASS for scope tested.** This is not recipe promotion evidence by itself. BE-02 remains `planned`; historical supervisor failure root cause remains **UNKNOWN**; independent acceptance remains outstanding; promotion and public release remain **NO-GO**.

Two initial harness assertions were corrected before final PASS: Go 1.22 reports disabled `GOENV` as an empty `go env` value, and Node represents Windows process termination through `signalCode`. Neither was a generated-code or toolchain failure. Attempt logs and final machine-readable results remain in the isolated run root.
