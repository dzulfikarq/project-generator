# Phase 01.6 — Targeted Windows Safety Remediation

| Field | Result |
|---|---|
| Date | 2026-11-12 |
| Baseline | `113bed4cd93373bcda3f3a377148b95fb2688ab4` (`fix(core): fail closed on Windows process cancellation`) |
| Platform checked | Windows 11 Pro, build `26300`, AMD64; Node.js `22.22.1`; npm `10.9.4` |
| Status | **PARTIAL / NO-GO** — documentation and lifecycle policy recorded; native safety blockers remain unresolved |
| Recipe state | FE-01 and FE-02 remain `planned` |

## Findings

| ID | Finding | Phase 01.6 outcome |
|---|---|---|
| W-01 | `taskkill /PID /T /F` relies on a reusable PID; PID reuse can target the wrong process. | OPEN. Phase 01.5 now fails closed when taskkill fails or parent exit is unconfirmed, but this is not stable process identity or Job Object containment. |
| W-02 | Detached descendants and complete job cancellation are not proven by the current tree-kill strategy. | OPEN. Requires process creation assigned to a Windows Job Object before untrusted code can run, plus full-job completion tests. |
| W-03 | Path validation followed by path-based staging cleanup leaves a junction/symlink swap race. | OPEN. Static reparse-point rejection does not close TOCTOU. Requires handle-rooted traversal/mutation proof and swap stress tests. |
| W-04 | npm lifecycle scripts execute third-party code with caller-token privileges, elevated if caller launched CLI elevated. | Policy recorded in [DEC-016](../../decisions/DEC-016-npm-lifecycle-script-policy.md): explicit `generate` intent plus plan/CLI/job disclosure; no sandbox claim. Phase 01 does not detect elevated callers; underlying exposure remains a blocker. |
| W-05 | Native implementation choices affect process creation, filesystem operations, packaging, and runtime support. | Alternatives recorded in [DEC-015](../../decisions/DEC-015-windows-native-safety-boundary.md). No native code/dependency added; architecture approval still required. |

Phase 01.5 fixes remain: cancellation during runner path validation is rechecked before spawn; failed/unconfirmed Windows tree termination reports `GEN_PROCESS_TREE_UNCONFIRMED` and retains staging. These changes do not close W-01–W-03.

## Investigation and alternatives

Microsoft Job Objects support process-group management and kill-on-job-close; robust use requires assignment before the child can execute, controlled handle lifetime, and verification of nested-job behavior. A post-spawn PID assignment is not sufficient. Candidate implementations are a first-party native Node addon, a separate Windows supervisor, or OS isolation. Each has material build, packaging, review, and compatibility costs. Filesystem cleanup similarly needs retained handles and reparse-safe traversal; canonical path checks alone are insufficient. See DEC-015 for alternatives and proof gates.

Environment probes found PowerShell but no `cl`, Cargo/Rust, CMake, `node-gyp`, or .NET SDK in `PATH`. No native implementation was attempted.

## Verification and E2E

- `npm test`: PASS — build, 17 core tests and 3 CLI tests; zero failures/skips.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- FE-01 rerun: [report](FE-01/2026-11-11-phase-01.6-cli-e2e.md), job `192436da-ec03-4d94-bcb2-c31b0566dc49`, 23 events, CLI exit 0.
- FE-02 rerun: [report](FE-02/2026-11-11-phase-01.6-cli-e2e.md), job `b031bdec-b844-4bbb-b118-16c38670bd86`, 22 events, CLI exit 0.
- Both E2E runs completed scaffold, install, lint, typecheck/build, HTTP smoke, and finalize in a path containing spaces and `雪`. They are not cancellation, race, sandbox, independent acceptance, or release tests. External event/project/log artifacts remain in approved local temp storage; reports contain hashes and redacted paths.

## Status

- **FE-01 React + Vite: NO-GO** for promotion/release; keep `planned`.
- **FE-02 Next.js: NO-GO** for promotion/release; keep `planned`.
- No recipe status, release approval, or native architecture approval changed.

Required next work: obtain architecture approval; implement reviewed process containment and handle-safe staging operations; add regressions for PID reuse, detached/full-job cancellation, and reparse swaps; independently review; rerun Windows tests and E2E. Until then, shared blockers remain.
