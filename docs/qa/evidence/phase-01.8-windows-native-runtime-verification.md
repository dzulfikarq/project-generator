# Phase 01.8 — Windows Native Runtime Verification

| Field | Result |
|---|---|
| Date | 2026-11-12 |
| Code baseline | `eaf1a72` plus changes recorded in this evidence set |
| Platform | Windows 11 Pro, version `10.0.26300`, build `26300`, AMD64; registry `ProductName` conflicts with CIM caption |
| Toolchain | Node.js `22.22.1`; npm `10.9.4`; rustc `1.99.1 (58cf8f9c3 2026-10-13)`; Cargo `1.99.1 (5f94df478 2026-08-27)` |
| Caller | **Non-elevated** — native probe `{"elevated":false}`; Medium Integrity (`S-1-16-8192`) |
| Status | **PARTIAL / NO-GO** — runtime tests and both local E2Es ran; finalize/junction root cause and independent review findings remain open; no release approval |
| Recipe state | FE-01 and FE-02 remain `planned`; no promotion |

## Evidence artifacts

- Final passing raw `npm test` output: [`phase-01.8-windows-native-runtime-verification-non-elevated-final.txt`](phase-01.8-windows-native-runtime-verification-non-elevated-final.txt), SHA-256 `93BB8A2C29B436D3D87995578C211DB3B375CDB20F970083018ADA4ADB4D91B3`.
- Built ignored supervisor: `packages/core/native/pg-windows-supervisor.exe`, SHA-256 `BAFFA9F2825DB0B8AAD1751BB2BE25BFE5D3503EE628C2C73935E9D72836BFC6`.
- Per-recipe E2E reports: [FE-01](FE-01/2026-11-12-phase-01.8-native-e2e.md), [FE-02](FE-02/2026-11-12-phase-01.8-native-e2e.md).
- Transient finalize anomaly record: [`phase-01.8-finalize-junction-anomaly.md`](phase-01.8-finalize-junction-anomaly.md).
- Separate security review findings: [`phase-01.8-independent-security-review.md`](phase-01.8-independent-security-review.md); review withheld approval.

## Commands and results

| Command / check | Exit | Observed result |
|---|---:|---|
| `pg-windows-supervisor.exe --check-elevation` | 0 | `{"elevated":false}`; `whoami /groups` confirms Medium Mandatory Level |
| `npm test` (final recorded run) | 0 | Core: 30 passed, 1 expected elevated-only skip, 0 failed; CLI: 3 passed, 0 skipped/failed |
| `npm run typecheck` | 0 | Core and CLI passed |
| `npm run lint` | 0 | ESLint passed |
| `cargo test --locked --manifest-path native/windows-supervisor/Cargo.toml` | 0 | Both Rust targets built; no Rust unit tests defined |
| `cargo clippy --locked --manifest-path native/windows-supervisor/Cargo.toml -- -D warnings` | 0 | Passed |
| `cargo fmt --manifest-path native/windows-supervisor/Cargo.toml -- --check` | 0 | Passed |
| Focused finalize/junction test | 0 | 100 consecutive reruns passed with post-rename file-identity verification; original cause remains unknown |
| FE-01 native E2E | 0 | 23 events; npm install, lint, typecheck, build, HTTP smoke and verified finalize passed; no stage leftovers |
| FE-02 native E2E | 0 | 22 events; npm install, lint, build/typecheck, HTTP smoke and verified finalize passed; no stage leftovers |

The single expected skip is the elevated-caller rejection case, which skips when the current caller is not elevated. No other integration skip occurred in the final run. A separate full-suite run failed once in `no-replace finalize contains concurrent project junction replacement`; later full-suite and focused reruns passed. See anomaly record. Do not count reruns as erasing the failure.

## Native runtime coverage

Non-elevated execution exercised process cancellation, timeout, detached descendants, natural root exit, unrelated-process survival, explicit breakaway rejection, forced supervisor death, real npm lifecycle-install cancellation, stage creation rollback after marker failure, handle-rooted writes, cleanup failure/retry, junction swaps, no-replace finalization, and outside sentinels. The npm cancellation test confirmed lifecycle and detached descendants terminated and owned staging could then be removed. The forced-supervisor-death test confirmed Job Object closure terminated owned processes.

The directory enumeration defect was confirmed and fixed: code passed `size_of_val(&Vec)` (the Vec header, 24 bytes) as native query-buffer length instead of backing-buffer length, producing Windows `ERROR_BAD_LENGTH` (`24`). The native operation now passes `storage.len() * size_of::<usize>()`. Marker rollback, marker cleanup ordering, and timeout-race handling were also corrected and covered by focused tests.

After the anomaly, native finalize gained a post-rename target check: destination must be a non-reparse directory with the same volume/file identity as the opened staging source. Failure returns `GEN_FINALIZE_UNCONFIRMED`, causing core to retain staging. This is a fail-closed guard, not a root-cause fix; separate review notes the identity is captured only when finalize opens the staged path and does not prove it is the previously validated directory.

## Finalize/junction anomaly — unresolved

One full-suite run returned `ENOENT` while reading finalized `project/generated.txt`. A separate stress run also observed native finalize report success with an empty target while the populated source directory remained under staging. Outside sentinel stayed unchanged. Root cause is unknown; treat this as a correctness/safety defect, not a cleared flake.

Follow-up: a full suite passed after adding the identity postcondition; the focused race test passed 100 consecutive runs; both FE E2Es passed against the patched supervisor. Later isolated handle/file-identity stress attempts did not reproduce the issue. None establishes the original failing interleaving's cause or proves it cannot recur. See linked anomaly record and separate review findings. **Do not approve recipe promotion or release on this evidence.**

## Remaining limits and review gates

- Separate read-only security review agent: **OBTAINED; NO APPROVAL**. Findings and limits are in the linked review report. Human/release sign-off remains unestablished; implementing-session review does not count.
- Open review findings: inherited staging ACL can permit cross-principal tampering when parent ACL allows it; cleanup can lose marker if a concurrent writer adds an entry after enumeration; finalize identity is not bound to the previously validated project object; NTSTATUS/IO_STATUS_BLOCK completion handling needs review.
- Clean-machine packaging and sidecar distribution: **NOT RUN**.
- Ordinary filesystem reads such as generated lockfile inspection remain path-based; native handle-rooted mutations do not sandbox npm lifecycle scripts.
- No browser automation; HTTP smoke only.
- FE-01 and FE-02 are development-only runs using `--development-allow-planned`; normal generation still blocks both.

## Recommendation

- **FE-01 React + Vite: NO-GO for promotion.** Keep `planned` pending resolution of independent-review findings, finalize anomaly investigation, required external acceptance, and full recipe acceptance.
- **FE-02 Next.js: NO-GO for promotion.** Same gates; local E2E does not establish product support.
- Preserve failure evidence and repeat race investigation before any release-readiness claim. No recipe state or release approval changed.
