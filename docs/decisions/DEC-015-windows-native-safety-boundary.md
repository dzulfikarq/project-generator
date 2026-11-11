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

Phase 01 uses Node `child_process` plus `taskkill /PID /T /F` and path-based Node filesystem calls. The current cancellation failure path is fail-closed, but `taskkill` still identifies the root by a reusable PID and does not prove that detached descendants are gone. `lstat`/`realpath`/reparse checks followed by path-based cleanup also leave a check-to-use window if a directory is replaced with a junction or symlink.

These are shared safety blockers for FE-01 and FE-02. They are not resolved by successful generation E2E runs. No native implementation or native dependency has been started.

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

Node's public path-based filesystem APIs do not provide the required handle-relative traversal and mutation contract. A native proof of concept should open and retain directory handles, inspect reparse attributes and stable file identity, enumerate/delete through verified handles, and test no-replace rename/finalization. Win32 `CreateFileW` with `FILE_FLAG_OPEN_REPARSE_POINT` and handle-based information/deletion APIs are candidate primitives. If safe child opens cannot be anchored to a retained parent handle using supported Win32 APIs, document and assess any NT Native API dependency rather than assuming canonical path checks eliminate races.

The proof must test junction/symlink swaps at each operation boundary, cross-volume substitution, locked files, cleanup after crashes, and a destination race on supported Windows 11 builds. Static junction rejection remains useful but is not evidence against swaps.

## Proposed direction and rationale

Keep the existing Phase 01 implementation unchanged for this remediation. Before native code or dependency work, select and prototype B, C, or D with a threat model, packaging plan, ABI/support matrix, and independent review. No option is approved here. A PoC must prove pre-execution Job Object assignment, PID-reuse resistance, detached-child containment, full-job drain/cancel, handle-rooted cleanup, and no-replace finalize before replacing DEC-014/DEC-012 behavior.

Native tool probes on the current Windows environment found PowerShell but no `cl`, Cargo/Rust, CMake, `node-gyp`, or .NET SDK in `PATH`; this is an environment observation, not proof those toolchains are unavailable elsewhere.

## Verification gates

1. Native unit/integration tests prove assignment-before-resume, kill-on-close, process-handle identity, and complete-job cancellation; include detached/nested children and forced supervisor/generator termination.
2. Windows adversarial tests race junction/symlink replacement against staging writes, cleanup, and finalize; assert outside sentinel data is unchanged.
3. Repeat tests on clean Windows 11 x64 machines and document build/runtime dependencies.
4. Rerun full test/typecheck/lint and FE-01/FE-02 E2E; separately cancel a real npm install and verify no descendants or staging writes remain.
5. Independent security review closes or explicitly accepts every residual finding before recipe promotion or release review.

## Security and rollback

Job Objects constrain process membership/lifetime; they do not restrict filesystem, network, registry, or token access and are not a sandbox. If the native boundary fails or is unavailable, keep generation blocked for release; do not silently fall back to path-based deletion or PID cancellation as equivalent protection. A failed cleanup retains staging for manual recovery.

## References

- Microsoft, [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
- Microsoft, [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject), [CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw), and [UpdateProcThreadAttribute](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute) (`PROC_THREAD_ATTRIBUTE_JOB_LIST`).
- Microsoft, [CreateFileW](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilew) and [SetFileInformationByHandle](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-setfileinformationbyhandle).

These references establish candidate OS primitives, not a validated Project Generator implementation.

## Approval record

Pending human architecture, packaging, and security review. No implementation approval claimed.

## Revision history

2026-11-12: Drafted from Phase 01.5/01.6 findings and Microsoft Win32 API investigation; no native implementation or approval claimed.
