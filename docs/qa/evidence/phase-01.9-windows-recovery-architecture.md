# Phase 01.9 — Windows Recovery Architecture Analysis

| Field | Result |
|---|---|
| Date | 2026-11-12 |
| Baseline | `2ef1d64` |
| Scope | Read-only analysis of create, finalize, cleanup recovery and recorded anomaly |
| Code changes | None |
| Tests run | None; documentation-only decision checkpoint |
| Status | **Architecture change recommended; implementation stopped pending approval; independent review obtained** |
| Recipe state | FE-01 and FE-02 remain `planned` / NO-GO |

## Findings

1. `create_stage` creates a protected stage, then creates and flushes `.ownership.json`. If helper response is lost, TypeScript never registers the `OwnedStage` in its process-local `WeakSet`; no restart discovery/recovery exists. A crash before marker completion leaves an unverified directory that must remain untouched.
2. `cleanup_stage` removes all contents except `.ownership.json`, then deletes that marker, then deletes the stage root. It restores the marker on returned errors, but process death after marker deletion and before root deletion leaves a markerless directory.
3. `finalize_stage` checks the marker-bound source identity, performs handle-relative no-replace rename, verifies target identity and protected ACL, and returns a structured result. Core maps inconsistent/missing response or exit status to `GEN_FINALIZE_UNCONFIRMED` and retains staging. There is no durable state to classify operations after process restart.
4. Existing code preserves the destination on ordinary collision (`target_exists`). It does not overwrite; this property must remain in any recovery design.
5. Existing evidence records one full-suite failure to read finalized output and a separate observation of successful finalize with empty target while populated source remained. Root cause remains unknown. No retry result invalidates this evidence.
6. Staging/output ACLs are protected for the current user and Local System in code and existing regression tests inspect those descriptors under an inherited Everyone-Modify parent. `Get-LocalUser` showed only one enabled local account, so cross-account access denial could not be tested here. No second account was created.
7. Process runner and Job Objects do not sandbox npm lifecycle scripts. Current guarantees apply to native generator-owned staging operations, not all filesystem writes made by untrusted scripts.

## Architecture choice

Compared current fail-closed/manual preservation, a durable journal over the existing wrapper layout, flattening staging into the final output directory, and path-based rename. Recommend keeping current wrapper and handle-relative no-replace rename while adding a protected sibling transaction journal and identity-based restart reconciler. This minimizes code churn while making create/finalize/cleanup state explicit. Detailed alternatives and required state classification are in [DEC-017](../../decisions/DEC-017-windows-staging-crash-recovery.md).

This is a recommendation, not an approved decision or implemented design. Independent read-only review judged option B the smallest defensible design conditionally, and required write-ahead journal intent before stage creation. If journal intent cannot be confirmed, stage creation must not run. A valid journal-bound marker can support recovery after a lost create response; pre-marker, partial, or identity-mismatched staging must remain manual. Journal recovery, interruption tests, and any process isolation for literal outside-write prevention require explicit approval before code changes.

## Recovery expectations

| Interruption | Current implementation | Required approved design |
|---|---|---|
| Before stage marker/response | May leave unverified stage; no restart recovery | Preserve unverified stage; surface manual recovery; never auto-delete |
| Create succeeded, response lost | Marked stage exists but no live in-process owner | Rebind only after validating journal, ACL, parent/stage identity and marker |
| Before finalize rename | Stage likely remains; no durable status | Verify source identity and absent target; offer explicit retry/cleanup |
| Rename may have completed, response lost | Core retains stage in current process; restart cannot classify | Compare recorded project identity at source and target; ambiguous states preserved |
| Rename complete, wrapper cleanup interrupted | Destination may be committed; stale wrapper may remain | Verify target identity/ACL, finish cleanup and remove journal idempotently |
| Cleanup after marker removal | Markerless root may remain | External journal remains until verified stage root removal |

No crash-recovery scenario was exercised because design and implementation remain unapproved. Power-loss durability also remains unverified.

## Verification and gates

- No code or test suite changed; FE-01/FE-02 E2Es were not rerun. Existing Phase 01.8 E2Es preceded final manifest-handle, post-finalize cleanup identity, and finalize response/exit checks; they are not fresh evidence for latest source.
- Existing E2Es remain useful historical evidence only. Any future generation/finalization implementation change requires both native E2Es to be rerun.
- Independent review: separate read-only agent session `ses_e31cc9ab7ffeNxk47GBNjo1jLn`; no files edited and no tests run. Reviewer judged option B the smallest defensible design conditionally, required explicit write-ahead ordering, and identified a **high conditional limitation**: option B cannot confine lifecycle-script filesystem writes or protect the journal from hostile same-token code.
- Independent recipe verdicts: **FE-01 NO-GO**; **FE-02 NO-GO**. Shared recovery and outside-write-confinement blockers remain. No implementation exists, and historical E2Es do not change these verdicts.
- No push, deploy, recipe promotion, or status change occurred.
