# DEC-014 — Windows Scoped Process Runner

| Field | Value |
|---|---|
| Status | Proposed; implementation uses this strategy, approval pending |
| Date | 2026-11-11 |
| Owner | Unassigned |
| Related | PRD-019, NFR-005, NFR-009, GEN-006, GEN-012 |
| Supersedes | None |
| Approval | Not approved |

## Context and problem

Phase 01 must run pinned npm/scaffold/project tools on Windows without passing user-controlled command text through `cmd.exe` or enabling `shell: true`. It must also cancel installer descendants.

## Constraints and non-negotiable rules

- Executable script and working directory must resolve under reviewed package and owned staging roots.
- Invoke Node scripts with structured argv and `shell: false`; do not launch arbitrary PATH binaries.
- Keep child environment bounded and redact output; lifecycle scripts still execute untrusted dependency code and are not sandboxed.
- Cancellation must stop the owned process tree without claiming OS-level containment.

## Real alternatives

| Option | Benefits | Costs/downsides | Risks | Reversibility |
|---|---|---|---|---|
| A: Invoke npm/scaffold `.cmd` shims through `cmd.exe` | Matches common Windows CLI use | Requires shell parsing/quoting | Argument injection and shell-metacharacter handling | High |
| B: Resolve reviewed JS entrypoints and invoke with active Node; use `taskkill /T /F` for cancellation | Structured argv, no command shell, small CLI-only implementation | Depends on Node install layout; forceful cancellation | `taskkill` PID/tree race; no Job Object containment | High |
| C: Native Windows Job Object runner | Stronger process-tree ownership and lifecycle control | Requires a native bridge and packaging work | Bridge correctness and deployment complexity | Medium |

## Proposed direction and rationale

Use B for the Phase 01 CLI only. `core` resolves npm's CLI JS under the active Node installation, verifies scripts and cwd against allowed roots, then starts Node with argv and `shell: false`. Windows cancellation invokes the system `taskkill.exe` with the owned child PID and `/T /F`. This is a scoped implementation choice, not a claim of sandboxing or a final desktop architecture approval.

## Verification / evidence

Unit tests exercise cancellation of a child plus descendant on Windows. FE-01 and FE-02 generation logs show pinned scaffolds, npm installs, validation, and finalize completion. See [QA matrix](../qa/acceptance-matrix.md) and per-recipe evidence reports. Broader adversarial PID-race, nested-installer, locked-process, clean-machine, and independent security tests remain open.

## Security and second-order effects

No `.cmd` shell is used for reviewed JavaScript tools. Package lifecycle scripts may execute third-party code with the generator user's privileges. `taskkill /T /F` is forceful and does not provide Job Object guarantees; report cancellation only after termination/cleanup handling completes. No UI bridge exists yet.

## Migration / rollback

Replace process startup/cancellation behind the core runner with a reviewed native Job Object bridge if evidence or desktop lifecycle requirements demand it. Preserve argv, root checks, redaction, controlled cwd/environment, and current CLI event contract. Existing generated projects are unaffected.

## Approval record

Pending human engineering and security review.

## Revision history

2026-11-11: Drafted to record the Phase 01 implementation strategy; no approval claimed.
