# DEC-017 — Windows Staging Crash Recovery

| Field | Value |
|---|---|
| Status | **Proposed; implementation and architecture approval pending** |
| Date | 2026-11-12 |
| Owner | Unassigned |
| Related | PRD-002, PRD-019, NFR-001, NFR-002, NFR-005, GEN-002, GEN-006, GEN-012, DEC-015, DEC-016 |
| Supersedes | None |
| Approval | None recorded |

## Context

The current Windows supervisor creates a protected wrapper directory containing `.ownership.json`, generated project, and temporary support files. Finalize opens the marker-bound project directory, then uses handle-relative `NtSetInformationFile` with no replacement to move that directory to the target. It verifies target identity and ACL. Core rejects inconsistent helper response/exit status and retains staging on an unconfirmed finalize.

This is fail-closed within a live process, not crash-recoverable:

- A process can lose the create response after native stage creation. `createOwnedStage` then has no `OwnedStage` instance in its in-memory `WeakSet`; no restart recovery path exists.
- A process can die after stage-directory creation but before marker completion. The remaining object has no ownership proof and must not be deleted automatically.
- Cleanup removes the in-stage ownership marker before removing the wrapper directory. A process crash in that interval can leave a markerless stage. Returned-error restoration does not cover process death.
- A process can die after the project rename but before response handling or wrapper cleanup. Current state has no durable transaction record to classify the target.
- The historical finalize/junction anomaly (success with missing/empty target while populated source remained) remains unexplained. Existing postconditions contain failures but do not explain the interleaving.
- Job Objects control process lifetime, not filesystem access. npm lifecycle scripts remain unsandboxed. Therefore an absolute guarantee that generated commands cannot modify paths outside staging is not provided by the current architecture.

## Constraints

1. Never replace an existing destination; retain handle-relative no-replace finalization unless a tested equivalent is approved.
2. Bind recovery authority to verified parent, stage, project, and destination identities plus protected ACLs. Names or marker text alone do not authorize deletion.
3. On ambiguous state, preserve objects and report manual recovery. Never automatically clean unverified staging or a destination with mismatched identity.
4. Keep the historical anomaly visible; passing retries do not clear it.
5. Distinguish process/generator termination from power loss. Directory-entry durability across power loss is not established.
6. Do not claim filesystem confinement while third-party lifecycle scripts execute unsandboxed. If literal outside-write prevention is required, decide on and validate an OS isolation boundary.

## Alternatives

| Option | Benefits | Costs / risks | Disposition |
|---|---|---|---|
| A. Keep current protocol; preserve leftovers for manual inspection | No code change; current no-replace and identity checks remain | Does not resolve lost-create recovery, markerless cleanup, or restart reconciliation; fails crash-recovery acceptance | Reject as closure; retain as safe fallback for unknown state |
| B. Keep wrapper layout and handle-relative rename; add protected durable transaction journal and recovery reconciler | Smallest change to current staging and finalize boundary; journal can outlive marker removal and classify source/target by recorded file identity; recovery can be idempotent | Adds journal format, locking, atomic updates, startup/explicit recovery flow, and crash-point tests; pre-marker or mismatched states still require manual preservation | **Recommended for approval** |
| C. Make staging directory itself the final output and rename it once | One directory rename commits all project files; removes post-commit wrapper cleanup | Changes staging paths and support-file layout; still needs external journal, create recovery, ACL transfer, and anomaly diagnosis | Defer unless option B proves too complex |
| D. Replace handle-relative rename with path-based `MoveFileExW` | Simpler API surface | Reopens names and drops retained-parent-relative operation; does not solve journal/recovery gaps | Reject |
| E. Sandbox all scaffold/install/check processes | Can address literal outside-write requirement beyond staging operations | AppContainer or equivalent changes package/network/tool access and process model; separate major architecture and compatibility work | Separate decision required if outside-write prevention is literal |

## Recommendation

Approve option B for detailed implementation planning; do not implement until the user approves this material architecture change. Keep the Rust supervisor and current no-replace `NtSetInformationFile` path; do not rewrite process containment or switch to path-based rename.

The journal should be a protected sibling transaction record, retained until both stage cleanup and finalize reconciliation finish. Persist and verify a `create-intent` journal before attempting stage creation; if that record cannot be confirmed, do not create staging. Record a fresh random nonce with parent identity, stage identity when known, project identity when bound, target name, and operation phase. The stage marker must bind to the journal's job/nonce. Flush bounded journal updates before reporting a durable phase transition. If the process dies before a valid marker and stage identity can be bound, preserve the stage for manual inspection; do not infer ownership from its name.

Recovery must compare identities, not infer outcomes from names or response codes:

| Observed state | Recovery action |
|---|---|
| Verified project identity at stage; target absent | Report uncommitted; allow explicit retry or verified cleanup |
| Verified project identity at target; source absent | Report committed; verify output ACL, then finish journal/wrapper cleanup |
| Stage and target both exist, neither exists, or identity differs | Preserve all objects; report uncertain/manual recovery; never replace or delete target |
| Stage exists but marker/journal cannot bind it to recorded identity | Preserve staging; no automatic cleanup |
| Target exists with unrelated identity | Preserve target; report collision; never replace it |

Create recovery must distinguish a verified lost response from an unverified pre-marker partial directory. A journal-bound marker plus protected ACL and parent/stage identity can authorize rebinding after a lost response. A missing, partial, invalid, or mismatched marker remains preserved for manual inspection. Cleanup keeps the external journal until the stage root is confirmed absent; this closes the current marker-removal crash window without treating an unverified path as owned.

This recommendation does **not** establish absolute write confinement for lifecycle scripts or power-loss durability. Resolve those claims separately before any recipe GO decision.

## Required verification before acceptance

1. Add one-shot, test-only interruption points at create, journal update, rename, response, and each cleanup boundary. Kill the helper/generator and restart recovery; do not use repeated stress runs as a substitute.
2. Exercise lost create response after marker persistence; verify recovery rebinds identity and never deletes an unverified partial directory.
3. Exercise interruption before rename, during/uncertain rename, after rename before response, and after rename before cleanup. Assert target is never replaced and unknown/mismatched state is preserved.
4. Exercise interruption before marker removal and after marker removal before root removal; verify journal-backed retry is identity-bound and idempotent.
5. Retain destination-collision, junction-swap, outside-sentinel, ACL inheritance, and source/destination identity regressions.
6. Run ACL denial test as a second standard Windows account if one is available; ACL descriptor inspection alone is not cross-account runtime evidence.
7. Rerun both FE-01 and FE-02 native E2Es after any generation/finalization implementation change.
8. Obtain independent per-recipe review. FE-01 and FE-02 remain `planned` / NO-GO until all shared blockers and recipe-specific acceptance pass.

## Security effects and rollback

The journal adds durable recovery authority and must receive the same protected-DACL and identity checks as staging. That DACL blocks other accounts, not processes running with the same user token. While lifecycle scripts remain unsandboxed, they can modify the parent, stage, and journal; option B cannot defend recovery authority from hostile same-token code. Invalid, stale, conflicting, or partially written records fail closed. Rollback means disabling automatic recovery and preserving all ambiguous stage/target objects for manual inspection; never fall back to path-based destructive cleanup.

## Independent review

Separate read-only review session `ses_e31cc9ab7ffeNxk47GBNjo1jLn` made no edits and ran no tests. Reviewer judged option B the smallest defensible crash-recovery design conditionally, required write-ahead journal intent before stage creation, and identified a **high conditional limitation**: it does not provide filesystem confinement for lifecycle scripts or protect the journal from hostile same-token code. Recipe verdicts: **FE-01 NO-GO; FE-02 NO-GO**. Review does not approve architecture implementation or release.

## Evidence

- [Phase 01.9 recovery architecture analysis](../qa/evidence/phase-01.9-windows-recovery-architecture.md)
- [DEC-015 native Windows safety boundary](DEC-015-windows-native-safety-boundary.md)
- [Phase 01.8 anomaly evidence](../qa/evidence/phase-01.8-finalize-junction-anomaly.md)
- [Phase 01.8 targeted closure evidence](../qa/evidence/phase-01.8-security-findings-closure.md)
