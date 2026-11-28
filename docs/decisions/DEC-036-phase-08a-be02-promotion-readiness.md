# DEC-036 — Phase 08A BE-02 Promotion Readiness

| Field | Value |
|---|---|
| Status | **Assessment recorded: NO-GO for promotion; BE-02 remains `planned`; public release NO-GO** |
| Date | 2026-11-19 |
| Scope | Focused promotion-readiness assessment for standalone Go `net/http` + Go Modules |
| Evidence | [Phase 08A assessment](../qa/evidence/phase-08a-be02-promotion-readiness.md) |

## Assessment

The exact BE-02 tuple remains unchanged: `backend.go-net-http`, Go Modules, standalone/no database, Go `>=1.22.0`, standard library only. Local CLI checks, two-run generated-tree reproducibility, and system/bundled release-policy checks passed on Go `1.26.7`.

A fresh isolated native Tauri generation failed during `validating` with `GEN_PROCESS_SUPERVISOR_FAILED` before the first Go validation result. Read-only recovery inspection returned no record for the job; post-run inspection found no target or owned stage and confirmed the collision sentinel remained unchanged. That run's redacted job log does not retain the underlying supervisor/Win32 error. Phase 08A.1 adds sanitized diagnostics for future separately authorized observations; it does not classify the preserved failure. A separate shell-launched `go mod edit -json` supervisor probe passed, so the failure remains unclassified and was not retried.

Go `1.22` was unavailable, and no independent acceptance/reviewer verdict was obtained. The earlier Phase 05B native pass remains historical evidence and was not reproduced by this assessment.

## Recorded direction

- **Do not promote BE-02.** Keep BE-02 and every other recipe `planned`; keep normal generation blocked and public release **NO-GO**.
- Treat native supervisor failure as an unresolved promotion-readiness blocker. Preserve failed-run diagnostics; do not retry until the app-context failure is diagnosed.
- Do not treat later Go releases, CLI acceptance, output reproducibility, or packaged release-policy checks as substitutes for Go `1.22` and native acceptance.
- Require a separate independent reviewer verdict before any promotion decision.

## Minimum follow-up

1. Use the Phase 08A.1 sanitized diagnostic capture in a separately authorized reproduction; diagnose the app-context failure and add a cause-specific regression.
2. Verify the generated project and checks on Go `1.22` in an isolated toolchain without changing global Go configuration.
3. Rerun isolated native success, result/history, open-folder, cancellation, collision, and recovery checks only after the cause is understood.
4. Obtain independent acceptance and a separate explicit promotion decision.

No recipe status change, normal-generation enablement, installer build, commit, push, or release approval is authorized by this assessment.

## Phase 08A.1 follow-up (2026-11-20)

Sanitized supervisor diagnostics, opaque event references/coarse process-state propagation, and terminal-aware Phase 05B harness waiting are implemented. Focused checks passed for runner failure classification/redaction (1/1), harness terminal failure/nonterminal wait/timeout (3/3), native response shape (1/1), and Tauri safe-field forwarding (1/1), with typecheck, lint, Rust formatting, and harness syntax checks. No full suite or native generation ran.

At the Phase 08A.1 checkpoint, the original supervisor cause remained UNKNOWN, Go `1.22` and independent acceptance were unverified, and no native retry had yet been authorized. The later Phase 08A.2/08A.3 follow-up below supersedes those verification statuses; overall promotion remains NO-GO.

## Phase 08A.2/08A.3 follow-up (2026-11-20)

Phase 08A.2's single diagnostic-only native generation passed on Go `1.26.7`, with all seven generated validations passing. It did not explain or repair the earlier supervisor failure; its root cause remains **UNKNOWN**.

Phase 08A.3 verified the preserved generated project on portable Go `1.22.0` from the official Windows archive after SHA-256 verification. Module identity, formatting, vet, tests, graceful `http.Server.Shutdown` test, build, and loopback HTTP checks passed with toolchain auto-upgrade disabled and module network access off. Full commands, checksum, and artifact hashes: [Phase 08A.3 evidence](../qa/evidence/phase-08a3-be02-go122-compatibility.md).

The Go minimum compatibility gate is **PASS for tested scope**. This does not change recipe or release status: BE-02 remains `planned`; independent acceptance remains outstanding; promotion and public release remain **NO-GO**.

## Phase 08A.5 focused test-only follow-up (2026-11-20)

Four isolated native checks passed: test-only supervisor start-failure propagation/redaction, successful finalization and manifest consistency, cancellation rollback, and collision-sentinel preservation. This validates current response/cleanup behavior only; it does not identify the historical supervisor cause, which remains **UNKNOWN**. The run's cleanup postcondition reported **FAIL** with process/port state unknown; a separate follow-up found no matching app/harness/supervisor process, confirmed ports `1420` and `9339` free, and rebuilt core/CLI release outputs without rebuilding repository supervisor binaries. Release CLI policy still blocked planned generation and test-fault overrides. See [Phase 08A evidence](../qa/evidence/phase-08a-be02-promotion-readiness.md).

Disposition unchanged: BE-02 remains `planned`; independent acceptance remains outstanding; promotion and public release remain **NO-GO**.

## Phase 08A.6 cleanup investigation (2026-11-23)

The Phase 08A.5 report retained only `cleanup: FAIL`; exact failing operation and error code were not recorded. Its historical run root/report are now unavailable. Follow-up/current probes found no matching process and ports free, but do not establish state at original failure time. Root cause remains **UNKNOWN**; do not call this a false positive or product defect.

Harness now records safe per-operation cleanup codes and no longer labels a pre-run release check as post-run restoration. Deterministic reporting tests pass; no native rerun occurred. BE-02 stays `planned`; independent acceptance, promotion, and public release remain **NO-GO**.

## Phase 08A.7 focused native cleanup verification (2026-11-23)

One separately authorized `--diagnostic-only` current-tree generation completed with all seven validations and cleanup postconditions passing. This was not a historical-failure reproduction: the original supervisor failure and Phase 08A.5 cleanup failure both remain **UNKNOWN**. BE-02 remains `planned`; promotion and public release remain **NO-GO**. Recommendation is **GO to freeze the complete current worktree as an immutable independent-review snapshot only**; no snapshot, commit, or push was created. See the detailed run evidence and residual-risk list in [Phase 08A evidence](../qa/evidence/phase-08a-be02-promotion-readiness.md).

## Phase 08B.3 stabilization follow-up (2026-11-26–28)

The isolated supervisor build, staged resource, and observed Tauri launch hashes matched. One native BE-02 generation completed with all seven validations passing; BE-02 remained `planned`. Overall Phase 08B.3 harness acceptance remains **FAIL/incomplete**: its assertion incorrectly required an `exitCode` for in-process `scaffold-identity`, so History/Open Folder/Open VS Code checks did not run. Corrected assertion regressions passed **21/21**, but were not native-retested. History/Open remain **NOT VERIFIED**; historical supervisor and Phase 08A.5 cleanup causes remain **UNKNOWN**. This development stabilization checkpoint does not authorize independent acceptance, promotion, or release. Keep BE-02 `planned`; promotion and public release **NO-GO**. See [Phase 08B.3 evidence](../qa/evidence/phase-08b3-be02-supervisor-provenance.md).
