# Phase 01.8 — Targeted Security-Findings Closure

| Field | Result |
|---|---|
| Baseline | `35afd94` |
| Date | 2026-11-12 |
| Status | **Implementation and local regression checks complete; follow-up independent review withheld approval; NO-GO** |
| Recipe state | FE-01 and FE-02 remain `planned`; no promotion |

## Scope and changes

This work addresses the recorded conditional ACL, cleanup ownership-marker, finalize identity, and NTSTATUS findings. It does not claim to identify or resolve the original finalize/junction anomaly.

1. **ACLs:** Create staging with protected DACL granting Full Control only to current user and Local System, then verify protection. Final output receives and verifies same protected DACL before finalize reports success. Regression test uses a parent granting Everyone inherited Modify and inspects stage, child, and output ACLs.
2. **Project identity:** Native ownership marker records scaffold directory volume serial and file index. Native scaffold validation opens that bound directory, reads `package.json` relative to the same handle, and checks requested package name; native stage mutations and cleanup support verify identity, and finalize checks it before rename and confirms same identity at destination. Ordinary-directory replacement test verifies mismatch preserves stage and marker; cleanup refuses changed identity.
3. **Cleanup recovery:** Cleanup checks for concurrent entries, preserves marker until contents are removed, and attempts to restore ownership evidence if marker/root removal returns failure. Concurrent-writer and retry coverage pass. After successful finalize, cleanup confirms bound identity at protected destination before deleting remaining stage metadata. This is returned-error recovery, not crash-atomic cleanup; a helper/process crash between marker removal and root removal can leave markerless staging.
4. **NTSTATUS and finalize protocol:** `NtCreateFile` and `NtSetInformationFile` paths check both returned status and `IO_STATUS_BLOCK.Status`. Pending status maps to unconfirmed; TypeScript fails closed and preserves staging. Finalize now also requires matching helper response and exit status; contradictory or missing exit status maps to `GEN_FINALIZE_UNCONFIRMED`. Win32 `SetFileInformationByHandle(FileRenameInfo)` relative directory rename returned `ERROR_INVALID_PARAMETER` (87) here, so handle-relative `NtSetInformationFile` remains. Path-based rename alternative would lose retained-parent-relative operation.

The failed finalize's exact interleaving remains unknown. Current checks are mitigations, not proof that anomaly cannot recur. Historical evidence remains unchanged in [the original independent review](phase-01.8-independent-security-review.md).

## Verification

Final checks on non-elevated Windows 11 Pro build `26300`, AMD64; Node.js `22.22.1`, npm `10.9.4`, rustc/Cargo `1.99.1`:

| Command | Result |
|---|---|
| `npm test` | PASS — core 35 passed, 1 expected elevated-only skip; CLI 3 passed; 0 failed |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `cargo test --locked --manifest-path native/windows-supervisor/Cargo.toml` | PASS — 2 supervisor unit tests; breakaway probe target has 0 tests |
| `cargo clippy --locked --manifest-path native/windows-supervisor/Cargo.toml -- -D warnings` | PASS |
| `cargo fmt --manifest-path native/windows-supervisor/Cargo.toml --check` | PASS |
| Safety regression tests within `npm test` | PASS — 17/17 |

One full-suite attempt failed once in the unrelated detached-descendant runner test with Windows `EBUSY` while removing its temporary directory, after the test observed the child process had exited. The exact test passed in isolation, then one full `npm test` rerun passed. No repeated stress loop was run.

Two development-only E2Es also completed under `--development-allow-planned`:

| Recipe | Job ID | Observed result |
|---|---|---|
| FE-01 React + Vite | `068c2600-02ea-41a9-af5e-16803c53a8a2` | CLI completed; install, checks, HTTP smoke, identity-bound finalize and staging cleanup passed |
| FE-02 Next.js | `a0de1f29-4422-40dd-ac14-74367419a929` | CLI completed; install, checks, HTTP smoke, identity-bound finalize and staging cleanup passed |

Configs and generated outputs remain under `C:\Users\Augie Winanda F\AppData\Local\Temp\opencode\phase018-security-closure-20261112`; machine-specific logs are not committed. These E2Es are local development evidence only and do not promote either recipe.

The E2Es preceded final handle-relative scaffold-manifest validation, cleanup-after-finalize identity checks, and finalize response/exit consistency validation. Final-tree `npm test` covered those targeted paths; no extra scaffold/install rerun was made.

## Follow-up independent review and remaining blockers

- Review: separate read-only agent session `ses_e31f4d6e4ffex0OYgaCnjIDJ1i`; no files edited and no tests run by reviewer. **Approval withheld.** Reviewer confirmed finalize response/exit mismatch maps to `GEN_FINALIZE_UNCONFIRMED`, `targetModified: true`, with staging preserved. Historical review result remains unchanged.
- ACL: inherited-parent condition addressed for tested ACL pattern; second-account access-denial test absent.
- Identity: package name is checked through same native directory handle as marker-bound identity. Other path-based runner/lockfile checks remain.
- NTSTATUS and finalize response/exit consistency: addressed in implementation; reviewer found no high-priority issue.
- Cleanup is not crash-atomic; helper/process loss between marker deletion and stage deletion can leave markerless staging. A lost create-stage response can also leave marked staging without an in-process live-stage record. Safe automated recovery for these windows remains open.
- Original finalize/junction anomaly root cause: **unresolved**; mitigations do not prove recurrence impossible.
- Human/release approval, clean-machine package/signing evidence, browser automation, path-based scaffold/runner reads, and lifecycle-script sandboxing: **not provided by this work**.
- FE-01 and FE-02 remain `planned` and **NO-GO for promotion**. No release approval.
