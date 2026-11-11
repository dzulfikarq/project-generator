# Phase 01.8 — Finalize/Junction Anomaly

| Field | Result |
|---|---|
| Status | **ROOT CAUSE UNRESOLVED; fail-closed postcondition added** |
| First recorded failure | `npm test`, exit 1; temporary raw output SHA-256 `5D9E9ADEFEAAB300D1C656C792686062B114696B4F29576B9F85C0D6BCB1561` |
| Failed test | `no-replace finalize contains concurrent project junction replacement` |

## Observation

The full-suite failure occurred after native finalize returned success. The test then could not read `project/generated.txt` (`ENOENT`). An isolated stress run separately observed a successful finalize with an empty target directory while the staged `project/generated.txt` still contained the expected data. The outside sentinel remained unchanged. These observations mean successful finalize did not always imply expected output was present in the target under the tested race; cause is unknown.

Following separate code review, finalize now opens the destination relative to the retained parent handle and verifies it is not a reparse point and has the same volume/file identity as the source handle. Mismatch or inability to verify returns `GEN_FINALIZE_UNCONFIRMED`; core preserves staging rather than reporting success and cleaning it. This reduces false-success/data-loss risk but does not identify the original cause or bind the source identity to the directory validated before the race.

The original full-suite failure output remains in local temporary storage and was not committed because it contains machine-specific paths. Sanitized failure details are recorded here. The failure was not reproduced in subsequent runs.

## Follow-up evidence

- A later full `npm test` passed with the identity postcondition: core 30 passed, 1 expected elevated-only skip; CLI 3 passed.
- Focused finalize/junction test passed 100 consecutive runs against the postcondition build.
- FE-01 and FE-02 native E2Es passed against the postcondition build.
- Later isolated handle/file-identity stress attempts did not reproduce the anomaly.
- Additional full-suite passing output is linked from [Phase 01.8 verification](phase-01.8-windows-native-runtime-verification.md).

These passes do not explain or invalidate the original failure. Continue diagnosis; do not weaken the assertion or mark finalize race handling resolved. Separate review also identified unbound source identity, inherited staging ACL, cleanup marker-race, and NTSTATUS handling concerns; see [review report](phase-01.8-independent-security-review.md). Keep FE-01/FE-02 `planned` and NO-GO.
