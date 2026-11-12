# Phase 01.8 — Finalize/Junction Anomaly

| Field | Result |
|---|---|
| Status | **ROOT CAUSE UNRESOLVED; additional fail-closed controls implemented; follow-up review withheld approval** |
| First recorded failure | `npm test`, exit 1; temporary raw output SHA-256 `5D9E9ADEFEAAB300D1C656C792686062B114696B4F29576B9F85C0D6BCB1561` |
| Failed test | `no-replace finalize contains concurrent project junction replacement` |

## Observation

The full-suite failure occurred after native finalize returned success. The test then could not read `project/generated.txt` (`ENOENT`). An isolated stress run separately observed a successful finalize with an empty target directory while the staged `project/generated.txt` still contained the expected data. The outside sentinel remained unchanged. These observations mean successful finalize did not always imply expected output was present in the target under the tested race; cause is unknown.

The implementation now binds the scaffold directory's volume/file identity into the native ownership marker after scaffold execution, validates `package.json` relative to that same native directory handle, checks identity before finalization, performs handle-relative no-replace rename, then verifies destination identity and protected ACL before success. NTSTATUS and `IO_STATUS_BLOCK.Status` are both checked; pending completion is unconfirmed. Finalize also requires consistent helper response and process exit status; mismatch returns `GEN_FINALIZE_UNCONFIRMED` and core retains staging. Cleanup verifies bound identity before deleting and attempts to restore ownership evidence if stage removal fails.

This is defense-in-depth, not a root-cause explanation. The exact failing interleaving remains unknown. Win32 `SetFileInformationByHandle(FileRenameInfo)` was tested for the relative directory rename and returned `ERROR_INVALID_PARAMETER` (87) in this runtime. The implementation therefore retains `NtSetInformationFile` with the retained parent handle and checked completion status. A path-based `MoveFileExW` alternative would be simpler but would reopen names rather than preserve this handle-relative boundary; it was not adopted.

The original full-suite failure output remains in local temporary storage and was not committed because it contains machine-specific paths. Sanitized failure details are recorded here. The failure was not reproduced in subsequent runs.

## Follow-up evidence

- A later full `npm test` passed with the identity postcondition: core 30 passed, 1 expected elevated-only skip; CLI 3 passed.
- Focused finalize/junction test passed 100 consecutive runs against the postcondition build.
- FE-01 and FE-02 native E2Es passed against the postcondition build.
- Later isolated handle/file-identity stress attempts did not reproduce the anomaly.
- Follow-up ACL, cleanup-marker, identity-binding, NTSTATUS, and finalize-protocol fixes passed current regression coverage; see [security-findings closure evidence](phase-01.8-security-findings-closure.md). Follow-up read-only review withheld approval; cleanup crash atomicity and create-response recovery remain open.
- Additional full-suite passing output is linked from [Phase 01.8 verification](phase-01.8-windows-native-runtime-verification.md).

These passes do not explain or invalidate the original failure. Continue diagnosis; do not weaken the assertion or mark finalize race handling resolved. Separate review also identified unbound source identity, inherited staging ACL, cleanup marker-race, and NTSTATUS handling concerns; see [review report](phase-01.8-independent-security-review.md). Keep FE-01/FE-02 `planned` and NO-GO.
