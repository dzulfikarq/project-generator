# Phase 01.9 — Final Acceptance Review

| Field | Result |
|---|---|
| Review date | 2026-11-13 |
| Baseline | `04fcab4a17e24b333a96f72e1f6084ca98860a20` |
| Scope | Read-only review of DEC-017 journal durability contract, identity-bound recovery, crash evidence, fail-closed behavior, and historical finalize anomaly |
| Tests/E2E rerun | None; reviewed committed evidence, source, and prior results only |
| Verdict | **Accept bounded DEC-017 behavior for controlled local development. No recipe or public-release approval.** |

## Review findings

- **Journal contract:** `createOwnedStage` creates and syncs `createIntent` before stage creation. Each bounded JSONL append validates sequence, phase transition, and monotonic identities; truncates an incomplete trailing record before retry; and calls `sync_all` before reporting success. This supports tested process termination/restart. Directory-entry durability across power loss is not established or claimed.
- **Recovery identity:** journal binds job/nonce and parent identity; stage marker binds stage identity; project/target identities persist monotonically. Recovery reopens paths relative to verified handles, verifies marker/DACL, checks committed-target ACL, and requires exact job-ID confirmation for cleanup/finalize. Invalid or ambiguous states disable mutation.
- **Crash evidence:** committed tests cover pre-marker orphan preservation, stage/project marker rebinding, interrupted generation/finalize, post-rename/pre-ACL preservation, stage/root/journal cleanup boundaries, and outside sentinel. Tests establish tested process-crash cases, not every filesystem interleaving.
- **Fail-closed:** no-replace handle-relative finalize verifies target identity and protected DACL before success. Missing/wrong-identity target and inconsistent helper response map to unconfirmed failure; core marks target as possibly modified and directs inspection rather than cleanup. Recovery refuses cleanup for an identity-matching target with unverified ACL.
- **Historical anomaly:** root cause remains unknown. Current code provides containment for the observed missing/wrong-target identity class, and the post-rename/pre-ACL test proves an unprotected committed target is preserved. No test directly injects the historical missing/empty-target result at the finalizer postcondition. Root cause is **not** a local-development blocker; that narrow failure-path test remains a public-release gate. No redesign indicated.

## Blockers by scope

| Scope | Verdict / blockers |
|---|---|
| Controlled local development | **No DEC-017 blocker found.** Use non-elevated session, explicit generation consent, and development-only recipe override. Normal generation correctly blocks planned recipes. Do not infer power-loss or isolation guarantees. |
| Public release | **NO-GO.** FE recipes remain planned; DEC-015/release review and clean-machine packaging are open. Cross-account ACL denial has no runtime evidence. Lifecycle scripts execute unsandboxed. Historical anomaly needs the targeted failure-path regression before release acceptance. |

## Recipe verdicts

| Recipe | Local development | Public support/release |
|---|---|---|
| FE-01 React + Vite | **GO**, development-only evidence runs | **NO-GO**; remains `planned` |
| FE-02 Next.js App Router | **GO**, development-only evidence runs | **NO-GO**; remains `planned` |

Prior local E2E reports show exit `0` and listed checks passed; this review does not promote either recipe or repeat those runs.

## Limitations requiring user approval

1. **Crash model:** accept process/generator-crash recovery only; do not imply power-loss durability. If product requires power-loss recovery, add separate requirements and verification.
2. **ACL boundary:** second-account denial test was unavailable (one enabled local account). Before public release, either obtain that evidence or explicitly approve a narrower claim; do not claim verified cross-account isolation.
3. **Lifecycle scripts:** DEC-016 is interim explicit-intent policy, not sandboxing. Decide before public release whether unsandboxed execution is acceptable with affirmative disclosure/consent or OS isolation is required.
4. **Historical anomaly:** root cause may remain unresolved if targeted postcondition-failure test proves missing/wrong output cannot report success and recovery preserves uncertain objects. User direction permits this bounded acceptance; test evidence still needed before public release.

## Next product step

Add/run only targeted finalizer fault injection for absent and wrong-identity target between rename and success check; assert unconfirmed/modified result and retained recovery evidence. Run second-account ACL check when test account is available. Then obtain explicit release/limitation approvals and review each recipe separately. No broad E2E rerun unless generator code changes.

References: [DEC-017](../../decisions/DEC-017-windows-staging-crash-recovery.md), [DEC-015](../../decisions/DEC-015-windows-native-safety-boundary.md), [Phase 01.10 implementation evidence](phase-01.10-windows-recovery-implementation.md), [historical anomaly](phase-01.8-finalize-junction-anomaly.md), [acceptance matrix](../acceptance-matrix.md).
