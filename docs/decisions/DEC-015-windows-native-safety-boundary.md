# DEC-015 — Native Windows Process and Filesystem Safety Boundary

| Field | Value |
|---|---|
| Status | Proposed; architecture approval pending |
| Date | 2026-11-12 |
| Owner | Unassigned |
| Related | PRD-002, PRD-010, PRD-019, NFR-001, NFR-002, NFR-005, NFR-009, GEN-002, GEN-006, GEN-012, DEC-012, DEC-014 |
| Supersedes | None |
| Approval | Not approved |

## Context and problem

Phase 01.6 used Node `child_process` plus `taskkill /PID /T /F` and path-based cleanup. Phase 01.7 adds a Rust helper and replaces those Windows process and staging mutation paths. Non-elevated Windows runtime and adversarial tests have since run. Scoped DEC-017 review accepts bounded process-crash recovery for local development, but the finalize/junction anomaly remains unresolved and DEC-015 remains unapproved; FE-01/FE-02 remain NO-GO for public release.

These are shared safety controls for FE-01 and FE-02. Successful generation E2E runs do not resolve them. Native helper source and runtime integration evidence exist. DEC-017 adds identity-bound process-crash recovery with local tests; clean-machine packaging, historical anomaly containment evidence, cross-account ACL verification, and human approval remain open.

## Constraints

- A child must be assigned to its containment boundary before untrusted child code can run. Creating a process and assigning it to a Job Object afterward leaves a startup race; prototype suspended creation plus assignment/resume or `PROC_THREAD_ATTRIBUTE_JOB_LIST` and verify supported behavior.
- Use process handles and Job Object membership, not PID lookup, as cancellation authority. Configure and verify kill-on-job-close semantics, wait for the complete active job to drain, and do not enable breakaway without an explicit decision.
- Handle nested-job restrictions, inherited parent jobs, helper death, generator crash, stdout/stderr forwarding, and cancellation races.
- Never request higher integrity. A native boundary must preserve caller privilege; detect and reject elevated callers if least-privilege operation is a release requirement.
- Filesystem mutations and cleanup must remain rooted in owned staging, never follow reparse points, preserve no-replace finalization, and fail closed on identity/volume mismatch.
- Do not call path revalidation race-free. Do not claim sandboxing; Job Objects are process management, not security sandboxes.

## Alternatives

| Option | Benefits | Costs / downsides | Risks | Reversibility |
|---|---|---|---|---|
| A. Keep Node path operations and `taskkill` | No native toolchain or package change; simplest CLI | PID-based best-effort cancellation and pathname TOCTOU remain | Cannot close identified NO-GO blockers | High |
| B. First-party native Node addon | Can create suspended children, assign Job Objects before resume, and expose handle-based filesystem operations in one boundary | Native build, Node ABI/package distribution, signing/reproducible builds, and native-code review | Addon bugs run in-process; Node/runtime compatibility and handle lifetime are security-critical | Medium |
| C. First-party Windows supervisor/helper executable | Owns Job Object and child handles outside Node; generator communicates over bounded pipes/protocol | Extra binary, IPC, packaging/update/signing, and failure-recovery work; filesystem safety may need a separate module | Helper crash/EOF behavior and protocol become part of trusted computing base | Medium |
| D. OS isolation (for example, Windows container or AppContainer) | Can constrain untrusted code beyond process-tree ownership | Platform setup, permissions, network/package-cache behavior, artifact transfer, and compatibility work; does not automatically make host cleanup race-free | Deployment assumptions or escape/configuration mistakes can invalidate isolation | Medium-low |

## Filesystem design questions

The helper opens each local-drive path component relative to the previously opened directory handle with `NtCreateFile` and `FILE_OPEN_REPARSE_POINT`, rejects reparse points and volume changes, enumerates cleanup entries through `GetFileInformationByHandleEx`, and deletes by handle. Native scaffold identity validation opens the marker-bound project directory and reads `package.json` relative to that same directory handle. `SetFileInformationByHandle(FileRenameInfo)` for the relative directory rename returned `ERROR_INVALID_PARAMETER` (87) in this runtime. No-replace finalize therefore retains handle-relative `NtSetInformationFile`, checking both returned `NTSTATUS` and `IO_STATUS_BLOCK.Status`; pending completion is unconfirmed. The ownership marker binds scaffold directory volume/file identity; staging and finalized output receive protected current-user/SYSTEM ACLs; cleanup restores marker evidence when removal fails. DEC-017 adds sibling-journal recovery for tested process-crash windows; power-loss durability and cross-account denial are unverified. Node still writes ordinary staging contents through path-based APIs; native cleanup/finalize are not a sandbox or a claim that all staging writes are race-free. The original finalize/junction anomaly remains unexplained.

Existing non-elevated evidence covers junction/symlink swaps, destination collisions, and bounded process-crash recovery. Remaining verification includes cross-account ACL denial, the targeted historical-anomaly failure path, clean-machine packaging, and any power-loss claim. Static junction rejection remains useful but is not evidence against swaps.

## Proposed direction and rationale

Phase 01.7 implements option C as a local Rust helper at `native/windows-supervisor/`. It creates the workload suspended with `PROC_THREAD_ATTRIBUTE_JOB_LIST`, verifies Job Object membership before `ResumeThread`, verifies kill-on-close and absence of breakaway flags, and cancels by Job Object plus process handles. Cancellation, timeout, root-exit-with-descendants, EOF, and supervisor failures fail closed; if termination is unconfirmed, core retains staging. The helper also rejects elevated callers before generation and performs native stage creation, cleanup, and no-replace finalize. Node invokes it over bounded JSON/stdin/stdout; no Windows `taskkill` fallback remains.

`npm run build` compiles the helper and copies an ignored local sidecar to `packages/core/native/`; the executable is not committed or installer-packaged. Cargo exists under the current user's `.cargo/bin` but is not on inherited `PATH`. The recorded Phase 01.8 runtime session was non-elevated Medium Integrity; native integration tests ran there. These local tests do not establish clean-machine packaging or release readiness.

## Verification gates

1. **Runtime-tested locally:** suspended creation, Job Object assignment/membership, kill-on-close, cancellation, timeout, detached descendants, unrelated-process survival, and breakaway rejection. These results do not replace clean-machine acceptance.
2. **Runtime-tested locally:** handle-rooted stage create/write/cleanup/finalize, ACL inheritance resistance, identity substitution, cleanup retry, junction swaps, and outside sentinels. The original finalize anomaly is still unresolved; see [Phase 01.8 anomaly evidence](../qa/evidence/phase-01.8-finalize-junction-anomaly.md).
3. **Current code checks:** `npm test`, typecheck, lint, Cargo test/Clippy/format, and FE-01/FE-02 development E2Es passed; targeted results are recorded in [security-findings closure evidence](../qa/evidence/phase-01.8-security-findings-closure.md). One expected elevated-only test skip remains.
4. Reproduce on clean Windows 11 x64; verify packaging/signing and forced helper/generator termination; investigate original finalize interleaving.
5. DEC-017 recovery implementation received scoped read-only follow-up with no findings in reviewed controls; broader DEC-015 architecture/release approval remains pending. Validate cross-account ACL behavior, the targeted historical-anomaly failure path, clean-machine packaging, and residual path-based reads. Lifecycle scripts remain unsandboxed.

## Security and rollback

Job Objects constrain process membership/lifetime; they do not restrict filesystem, network, registry, or token access and are not a sandbox. DEC-016 lifecycle consent remains unchanged and is not isolation. If the native boundary fails or is unavailable, generation fails closed; do not silently fall back to PID cancellation or path-based destructive cleanup. A failed/unconfirmed process termination retains staging. No FE status or release approval changes here.

## References

- Microsoft, [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
- Microsoft, [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject), [CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw), and [UpdateProcThreadAttribute](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute) (`PROC_THREAD_ATTRIBUTE_JOB_LIST`).
- Microsoft, [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew) and [SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle).
- Microsoft, [GetFileInformationByHandleEx](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandleex); Windows Native API `NtCreateFile` is used for parent-handle-relative child opens.

These references establish OS primitives, not independent security approval or completed adversarial validation.

## Approval record

Pending human architecture, packaging, and security review. No implementation approval claimed.

## Revision history

2026-11-12: Drafted from Phase 01.5/01.6 findings and Microsoft Win32 API investigation; no native implementation or approval claimed.
2026-11-12: Phase 01.7 adds the Rust supervisor, handle-rooted staging operations, fail-closed CLI integration, and Windows adversarial tests. Phase 01.8 records non-elevated runtime execution, then adds protected ACLs, handle-bound scaffold identity validation, cleanup recovery, NTSTATUS checks, and finalize protocol validation. Follow-up review withheld approval; original anomaly and recovery gaps remain open. Proposal, FE planned status, and NO-GO status unchanged.
