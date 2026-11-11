# DEC-014 — Windows Scoped Process Runner

| Field | Value |
|---|---|
| Status | Proposed; Phase 01 implementation uses this strategy, approval pending |
| Date | 2026-11-11 |
| Owner | Unassigned |
| Related | PRD-019, NFR-005, NFR-009, GEN-006, GEN-012, [DEC-015](DEC-015-windows-native-safety-boundary.md), [DEC-016](DEC-016-npm-lifecycle-script-policy.md) |
| Supersedes | None |
| Approval | Not approved |

## Context and problem

Phase 01 must run pinned npm/scaffold/project tools on Windows without passing user-controlled command text through `cmd.exe` or enabling `shell: true`. It must also cancel installer descendants.

## Constraints and non-negotiable rules

- Executable script and working directory must resolve under reviewed package and owned staging roots.
- Invoke Node scripts with structured argv and `shell: false`; do not launch arbitrary PATH binaries.
- Keep child environment bounded and redact output; lifecycle scripts still execute untrusted dependency code and are not sandboxed. See DEC-016 for interim consent/disclosure policy.
- Cancellation must stop the owned process tree without claiming OS-level containment. Current `taskkill /PID /T /F` does not provide process identity or job-membership guarantees.

## Real alternatives

| Option | Benefits | Costs/downsides | Risks | Reversibility |
|---|---|---|---|---|
| A: Invoke npm/scaffold `.cmd` shims through `cmd.exe` | Matches common Windows CLI use | Requires shell parsing/quoting | Argument injection and shell-metacharacter handling | High |
| B: Resolve reviewed JS entrypoints and invoke with active Node; use `taskkill /T /F` for cancellation | Structured argv, no command shell, small CLI-only implementation | Depends on Node install layout; forceful cancellation | `taskkill` PID/tree race; no Job Object containment | High |
| C: First-party native Windows process/filesystem bridge | Job Object membership can cover descendants; handle-based operations can reduce path races | Native code, toolchain, packaging and independent review required | Bridge correctness, ABI/deployment, nested-job constraints and handle-lifetime errors | Medium |

## Proposed direction and rationale

Use B for the Phase 01 CLI only. `core` resolves npm's CLI JS under the active Node installation, verifies scripts and cwd against allowed roots, then starts Node with argv and `shell: false`. Windows cancellation invokes the system `taskkill.exe` with the owned child PID and `/T /F`. This is a scoped implementation choice, not OS-level process containment, a sandbox, or final desktop architecture approval. Native alternatives and filesystem race limits are recorded in proposed DEC-015.

## Verification / evidence

Windows tests exercise cancellation of a child plus descendant, abort during runner path checks, and fail-closed behavior when `taskkill.exe` cannot be started. They do not close PID-reuse, detached-descendant, or full-job cancellation risks. See [QA matrix](../qa/acceptance-matrix.md), [Phase 01.5 baseline](../qa/evidence/phase-01.5-windows-security-review.md), [Phase 01.6 follow-up](../qa/evidence/phase-01.6-windows-safety-remediation.md), and per-recipe E2E reports. Junction-swap stress, locked-process behavior, clean-machine packaging, and external security review remain open.

## Security and second-order effects

No `.cmd` shell is used for reviewed JavaScript tools. Package lifecycle scripts may execute third-party code with the generator user's privileges; see DEC-016. `taskkill /T /F` is forceful and does not provide Job Object guarantees; failed/unconfirmed termination retains staging and reports failure, but PID-reuse, detached-descendant, and full-job cancellation risks remain. Path-based checks in `staging.ts` also do not close reparse-point swap races. No UI bridge exists yet.

## Migration / rollback

Do not expand this runner strategy to release or desktop use until DEC-015's native-vs-OS alternatives are reviewed and residual risks are accepted or closed. Any replacement must preserve argv, root checks, redaction, controlled cwd/environment, and the CLI event contract. Existing generated projects are unaffected.

## Approval record

Pending human engineering and security review.

## Revision history

2026-11-11: Drafted to record the Phase 01 implementation strategy; no approval claimed.
2026-11-12: Added Phase 01.6 process-identity, detached-child, filesystem-race, lifecycle-policy, and evidence references; status remains proposed.
