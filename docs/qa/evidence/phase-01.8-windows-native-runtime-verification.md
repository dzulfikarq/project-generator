# Phase 01.8 — Windows Native Runtime Verification

| Field | Result |
|---|---|
| Date | 2026-11-12 |
| Code baseline | `53d71068ecb93a959cf31809559fdd9a170143a2` (`origin/main`) |
| Platform | Windows 11 Pro, version `10.0.26300`, build `26300`; registry `ProductName` reports Windows 10 Pro, conflicting with CIM caption |
| Toolchain | Node.js `22.22.1`; npm `10.9.4`; rustc `1.99.1 (58cf8f9c3 2026-10-13)`; Cargo `1.99.1 (5f94df478 2026-08-27)` |
| Caller | **Elevated** — native probe says true; `whoami /groups` shows High Mandatory Level and enabled Administrators group |
| Status | **BLOCKED / NO-GO** — this session cannot execute native workload/filesystem integration or generation without violating elevation guard |
| Recipe state | FE-01 and FE-02 remain `planned`; no promotion |

## Evidence artifacts

- Raw `npm test` output: [`phase-01.8-windows-native-runtime-verification.log`](phase-01.8-windows-native-runtime-verification.log), SHA-256 `B7A6DBC95053A3F8B6F65FDFCC297C2A02131F6DD6CB4C05C8BD84702CB5777B`.
- Built ignored supervisor `packages/core/native/pg-windows-supervisor.exe`, SHA-256 `ED04477B6591A86020C2141BD050EBE0065270B7E905D09CF74C7A66B60B69B5`.

## Commands and results

| Command | Exit | Observed result |
|---|---:|---|
| `packages/core/native/pg-windows-supervisor.exe --check-elevation` | 0 | `{"elevated":true}`; independent `whoami /groups` shows `High Mandatory Level` |
| `npm test` | 0 | Sidecar release build and TS builds passed; core 15 passed / 10 skipped / 0 failed; CLI 3 passed / 0 skipped / 0 failed |
| `npm run typecheck` | 0 | Core and CLI typechecks passed |
| `npm run lint` | 0 | ESLint passed |
| `cargo test --locked --manifest-path native/windows-supervisor/Cargo.toml` | 0 | Both Rust targets built; 0 Rust unit tests defined |
| `cargo clippy --locked --manifest-path native/windows-supervisor/Cargo.toml -- -D warnings` | 0 | Passed |
| `cargo fmt --manifest-path native/windows-supervisor/Cargo.toml -- --check` | 0 | Passed |

The 10 skips were exactly the elevated-guarded integration cases below; no other skips occurred:

1. Owned process cancellation.
2. Timeout termination of detached descendants.
3. Root exit with remaining detached descendants.
4. Unrelated process survival during cancellation.
5. Explicit `CREATE_BREAKAWAY_FROM_JOB` attempt.
6. No-replace finalize preserves occupied target.
7. Successful no-replace finalize.
8. Parent junction swap during stage creation.
9. Junction swap during support cleanup.
10. Project junction swap during finalize.

Elevated-caller rejection tests passed. They verify generation stops before staging/workload creation; they do not verify normal non-elevated operation. Static junction rejection, case-insensitive collision, forged in-process ownership rejection, schema tests, and plan tests passed.

## Not run

- All 10 process/filesystem integration cases above: **SKIPPED**, not passed.
- Real npm install cancellation; forced supervisor death; injected cleanup/marker-write failure; outside-sentinel runtime races.
- FE-01 React + Vite and FE-02 Next.js generation through the native supervisor, including install, typecheck/lint/build, and HTTP/browser smoke.
- Clean-machine packaging and independent human security review.

The current process token is elevated. No elevation guard was bypassed and no workload or scaffold was started. Prior Phase 01.6 E2E reports predate the native supervisor and are not Phase 01.8 runtime evidence.

## Targeted source review (not independent)

Review inspected Job Object setup/termination, elevation checks, native stage operations, TS response handling, and cleanup paths in `native/windows-supervisor/src/main.rs`, `packages/core/src/native-supervisor.ts`, `packages/core/src/runner.ts`, `packages/core/src/staging.ts`, and `packages/core/src/job.ts`.

- Positive source-level checks: workload is created suspended with Job Object assignment in process attributes; helper verifies membership and kill-on-close/no-breakaway configuration; elevated query errors fail closed; TS preserves staging when process termination or finalize outcome is unconfirmed; no PID/`taskkill` fallback exists.
- Open filesystem risk: normal Node staging writes and checks remain path-based (`job.ts`, `project-docs.ts`). Handle-rooted native create/cleanup/finalize does not protect these writes from concurrent reparse-point replacement and does not sandbox lifecycle scripts.
- Failure-recovery observation, not fault-injection evidence: native stage creation creates the directory before creating/writing `.ownership.json`. If marker creation/write fails, helper returns an error while core has not registered a live `OwnedStage`; an unmarked partial stage may remain without automatic cleanup. This appears fail-closed for user data but leaves recovery/visibility unresolved.
- This review was performed by the implementation session and is **not an independent security review**. DEC-014/015 approval gates remain open.

## Reproduction gate

Run from a standard-user Windows session or a terminal whose native probe reports not elevated. Do not alter or bypass the helper guard.

1. Build with `npm run build`; require `pg-windows-supervisor.exe --check-elevation` to return exit `0` and `{"elevated":false}`.
2. Run `npm test`; require all 10 guarded integrations to execute with no skips among those cases and 0 failures. The elevated-only rejection test is expected to skip under a non-elevated token; treat any other skip as unexplained. Preserve full output and SHA-256.
3. Add/run dedicated non-elevated fixtures for real npm install cancellation, forced helper termination, and cleanup failure injection; verify owned descendants terminate and uncertain staging is retained.
4. Run FE-01 and FE-02 separately with fresh temporary destinations and `--development-allow-planned`; record install, lint, typecheck/build, HTTP smoke, output hashes, and job logs. Do not promote either recipe from test success alone.
5. Obtain independent security review of remaining path-based writes, marker-failure recovery, process/helper failure behavior, and packaging.

## Recommendation

- **FE-01 React + Vite: NO-GO for promotion.** Keep `planned`; no Phase 01.8 native E2E or required runtime proof.
- **FE-02 Next.js: NO-GO for promotion.** Keep `planned`; no Phase 01.8 native E2E or required runtime proof.

No recipe status, release approval, or deployment changed.
