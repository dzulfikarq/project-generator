# DEC-014 — Windows Scoped Process Runner

| Field | Value |
|---|---|
| Status | Proposed; Phase 01.7 native implementation present, approval pending |
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
- Windows cancellation must use owned process/Job Object handles, confirm complete job drain, and retain staging if termination is unconfirmed. Job Objects are not a sandbox.

## Real alternatives

| Option | Benefits | Costs/downsides | Risks | Reversibility |
|---|---|---|---|---|
| A: Invoke npm/scaffold `.cmd` shims through `cmd.exe` | Matches common Windows CLI use | Requires shell parsing/quoting | Argument injection and shell-metacharacter handling | High |
| B: Resolve reviewed JS entrypoints and invoke with active Node; use `taskkill /T /F` for cancellation | Structured argv, no command shell, small CLI-only implementation | Depends on Node install layout; forceful cancellation | `taskkill` PID/tree race; no Job Object containment | High |
| C: First-party native Windows process/filesystem bridge | Job Object membership can cover descendants; handle-based operations can reduce path races | Native code, toolchain, packaging and independent review required | Bridge correctness, deployment, nested-job constraints and handle-lifetime errors | Medium |

## Proposed direction and rationale

Phase 01.7 implements C as a separate Rust helper. It creates reviewed Node workloads suspended, assigns them atomically through `PROC_THREAD_ATTRIBUTE_JOB_LIST`, verifies membership, then resumes. Cancellation/timeout terminates the Job Object and checks active-process count; helper/native failure blocks generation. It also blocks elevated callers. No PID/taskkill fallback remains. C is still proposed, not architecture/security approval; see DEC-015 for filesystem scope and residuals.

## Verification / evidence

Phase 01.7 adds Windows tests for cancellation, timeout, detached descendants, unrelated process survival, breakaway attempts, and filesystem swap races. Elevated-caller rejection passed. Process and filesystem integration tests were skipped because current test token is High Integrity; they require execution from a non-elevated Windows session. See [Phase 01.7 evidence](../qa/evidence/phase-01.7-windows-native-hardening.md) and [QA matrix](../qa/acceptance-matrix.md). Runtime proof, forced helper-death behavior, clean-machine packaging, and independent review remain open.

## Security and second-order effects

No `.cmd` shell is used for reviewed JavaScript workloads. Package lifecycle scripts may execute third-party code with generator user's privileges; see DEC-016. Job Objects constrain process membership/lifetime only. Handle-rooted native stage creation, cleanup and finalize do not make ordinary Node staging writes or untrusted lifecycle scripts a sandbox. Failed/unconfirmed termination retains staging. No UI bridge exists yet.

## Migration / rollback

Do not approve this runner for recipe promotion or release until skipped non-elevated integration tests, residual path-write risks, packaging, and independent DEC-015 review are resolved. If the helper is absent or fails, generation stays blocked; no legacy PID/path fallback. Existing generated projects are unaffected.

## Approval record

Pending human engineering and security review.

## Revision history

2026-11-11: Drafted to record the Phase 01 implementation strategy; no approval claimed.
2026-11-12: Added Phase 01.6 process-identity, detached-child, filesystem-race, lifecycle-policy, and evidence references; status remains proposed.
2026-11-12: Phase 01.7 replaces the Windows taskkill runner with a Rust Job Object helper; integration tests remain unexecuted in the elevated environment and status remains proposed.
