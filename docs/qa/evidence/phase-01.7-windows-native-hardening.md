# Phase 01.7 — Windows-Native Hardening

| Field | Result |
|---|---|
| Date | 2026-11-12 |
| Baseline | `7bd9c57bfb6e76f6f7b515e4a21260d25bb713f5` (`docs(security): document Phase 01.6 Windows safety status`) |
| Platform | Windows x64, kernel version `10.0.26300`, build `26300`; CIM reports Windows 11 Pro. `WindowsProductName` separately reports Windows 10 Pro, so OS product labels conflict in this environment. |
| Toolchain | Node.js `22.22.1`; npm `10.9.4`; rustc `1.99.1 (58cf8f9c3 2026-10-13)`; Cargo `1.99.1 (5f94df478 2026-08-27)`; stable MSVC target |
| Caller token | High mandatory integrity; native `--check-elevation` returned `{"elevated":true}` |
| Status | **PARTIAL / NO-GO** — implementation and build checks pass; all native workload/filesystem integration cases requiring a non-elevated token were skipped |
| Recipe state | FE-01 and FE-02 remain `planned`; neither promoted or approved |

## Implementation checked

- Rust sidecar builds locally and is copied to ignored `packages/core/native/`; no binary or installer packaging is committed.
- Workload creation is suspended and assigned atomically to a Job Object before resume; membership, kill-on-close, and breakaway flags are checked.
- Windows process termination and staging create/cleanup/finalize use native handles. Generation rejects elevated callers and has no PID/`taskkill` fallback.
- Job Objects are process-lifetime management, **not a sandbox**. Node's ordinary staging writes remain path-based; see [DEC-015](../../decisions/DEC-015-windows-native-safety-boundary.md). DEC-016 lifecycle-script consent policy is unchanged.

## Checks and observed results

| Command | Result |
|---|---|
| `npm test` | PASS — build and native release sidecar build succeeded; core: 15 passed, 10 skipped, 0 failed; CLI: 3 passed, 0 skipped, 0 failed |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `cargo test --locked --manifest-path native/windows-supervisor/Cargo.toml` | PASS — both Rust targets compiled and ran; 0 Rust unit tests defined |
| `cargo clippy --locked --manifest-path native/windows-supervisor/Cargo.toml -- -D warnings` | PASS |
| `cargo fmt --manifest-path native/windows-supervisor/Cargo.toml -- --check` | PASS |
| `git diff --check` | PASS |
| `packages/core/native/pg-windows-supervisor.exe --check-elevation` | `{"elevated":true}`; confirms elevation probe works and generation must be blocked in this session |

Cargo was invoked from `%USERPROFILE%\.cargo\bin\cargo.exe`; Rust tools were not on inherited `PATH`.

## Runtime evidence still missing

These 10 Windows integration tests were skipped by the explicit elevation guard:

- Owned process cancellation, timeout, detached descendants after root exit, unrelated-process survival, and explicit breakaway attempt.
- Native no-replace finalize, successful finalize, parent-junction create race, support-cleanup junction race, and finalize junction race.

No workload or generation E2E was run; no real npm install cancellation, forced helper-death test, clean-machine packaging test, or independent security review was performed. The elevated-generation rejection test passed and verified no destination staging was created. Test skip is not runtime proof.

## Gate

Run the skipped suite in a non-elevated Windows 11 x64 session. Review termination-failure/helper-death handling, residual path-based Node staging writes, packaging, and independent security findings before phase acceptance. FE-01/FE-02 remain **NO-GO**.
