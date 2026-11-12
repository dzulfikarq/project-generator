# Phase 01.10 — Windows Staging Crash-Recovery Implementation

| Field | Result |
|---|---|
| Date | 2026-11-12 |
| Baseline | `9a86284` (`docs(windows): propose crash recovery architecture`) |
| Scope | Bounded DEC-017 journal, identity-bound recovery, CLI actions, crash tests, and Windows validation |
| Platform | Windows 11 Pro build `26300`, AMD64; non-elevated, Medium Integrity |
| Runtime | Node.js `22.22.1`; npm `10.9.4`; Rust stable/MSVC toolchain |
| Status | **Implementation verification passed for tested process-crash cases; residual security/release gates remain open** |
| Recipe state | FE-01 and FE-02 remain `planned` / NO-GO |

## Implemented boundary

- Protected sibling journal under `%LOCALAPPDATA%\.project-generator-transactions`; write-ahead create intent, transaction nonce, parent/stage/project identities, append-only phases, and protected marker binding.
- Explicit `recovery inspect` and confirmed `recovery apply --job-id <id> --action <cleanup|finalize> --confirm-job <id>`; no automatic destructive recovery.
- Recovery verifies journal/stage/marker identities and ACLs, reconciles persisted marker identity, checks committed-target ACL before cleanup, and retains ambiguous objects. Finalize keeps existing handle-relative no-replace `NtSetInformationFile` operation.
- Test-only process-crash hooks cover journal intent, stage creation/marker, project marker and recovery identity rebind, generation mutation, finalize before and after rename (including before target ACL verification), stage-marker removal, stage-root removal, and journal removal.

## Verification

| Check | Result |
|---|---|
| `npm test` | PASS — core 36 passed, 1 expected elevated-only skip; CLI 6 passed; 0 failed |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `cargo check --locked --manifest-path native/windows-supervisor/Cargo.toml` | PASS |
| `cargo test --locked --manifest-path native/windows-supervisor/Cargo.toml` | PASS — 4 Rust unit tests |
| `cargo clippy --locked --manifest-path native/windows-supervisor/Cargo.toml -- -D warnings` | PASS |
| `cargo fmt --manifest-path native/windows-supervisor/Cargo.toml -- --check` | PASS |
| Non-elevated crash/restart integration | PASS — journal rebind after `afterStageMarker` and `afterProjectMarker` is verified at persisted `projectBound` phase; unmarked stage preserved; pre/post-rename recovery; unprotected committed target preserved; occupied destination untouched; marker/root/journal cleanup interruptions; outside sentinel preserved; completed cleanup asserts `ENOENT` |
| Recovery CLI hint | PASS — test executes `inspect` and checks complete command includes required job ID and confirmation |
| Recovery inspection after latest FE E2Es | PASS — no pending transactions |

The crash tests validate process termination/restart cases on this host. They do not establish directory-entry durability under power loss or prove every possible Windows filesystem interleaving. ACL tests inspect the current-user/SYSTEM descriptor; **cross-account access denial was not tested** because only one enabled local account was available.

## Independent review and residuals

Independent read-only review found and prompted fixes for committed-target ACL revalidation, persisted-marker identity recovery, and complete CLI action hints. Follow-up identified missing coverage for project-marker recovery and stage removal; tests now force a crash after journal identity rebind, verify persisted `projectBound` state, and require `ENOENT` after cleanup. Final read-only follow-up verified these corrections with no findings in reviewed scope; it does not approve recipes or release.

- Lifecycle scripts execute unsandboxed; no outside-write isolation or same-user hostile-process protection is claimed.
- Cross-account ACL denial remains unverified.
- Power-loss durability is not established.
- Historical finalize anomaly (success with missing/empty target while populated source remained) remains unexplained.
- FE-01/FE-02 remain `planned` and NO-GO; E2Es are local development evidence only. No release approval.

Related: [DEC-017](../../decisions/DEC-017-windows-staging-crash-recovery.md), [acceptance matrix](../acceptance-matrix.md), [FE-01 E2E](FE-01/2026-11-12-phase-01.10-native-e2e.md), [FE-02 E2E](FE-02/2026-11-12-phase-01.10-native-e2e.md).
