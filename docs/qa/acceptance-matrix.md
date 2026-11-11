# V1 Acceptance & Evidence Matrix

| Field | Value |
|---|---|
| Status | **PARTIAL** — Phase 01 local evidence exists; full acceptance/release review remains incomplete |
| Date | 2026-11-12 |
| Target | Windows 11, clean target dirs; independent generation and install |
| Rule | No PASS claims without executable evidence |

Each GEN/UX test has PRD/NFR traceability. `NOT RUN`, `BLOCKED`, `PARTIAL`, `PASS`, `FAIL` are not interchangeable. A **PASS** records the tested scope, exact recipe/tool versions, commands, exit codes and artifacts. A pass for FE-01/FE-02 does not promote either recipe or approve a release. Failure logs must be redacted.

| Test ID | Requirement | Acceptance procedure / expected evidence | Current status |
|---|---|---|---|
| GEN-001 | PRD-001–004 | Invalid framework/database/ORM/style rejected at plan stage; target untouched | PARTIAL — FE-01/FE-02 schema/resolver only |
| GEN-002 | PRD-002,NFR-001–002 | Existing directory, path traversal, Windows reserved names, junction escape rejected | PARTIAL — native handle-relative create/cleanup/finalize implemented; swap tests added but skipped under elevated token; Node staging writes remain path-based |
| GEN-003 | PRD-005,PRD-012 | npm default for Node; unsupported managers rejected; correct lockfile | PASS — FE-01/FE-02 npm only |
| GEN-004 | PRD-007 | Missing Node/Go/PHP/Composer/Python/uv reported with fix action, no hidden install | PARTIAL — Node/npm positive detection; missing-tool scenarios incomplete |
| GEN-005 | PRD-008–009 | Review shows accurate steps; scaffold is deterministic and noninteractive | PARTIAL — read-only plan tests and pinned FE scaffolds; plan-preview audit incomplete |
| GEN-006 | PRD-010–011,NFR-009 | Cancelling running scaffold stops owned process tree and cleans only owned staging | PARTIAL — Job Object helper and cancellation/timeout/detached/breakaway tests added; runtime tests skipped under elevated token; termination-failure and forced-helper-death proof remain open |
| GEN-007 | PRD-013,NFR-010 | Generate from pinned scaffold; compile/build/typecheck/smoke selected recipe; record independent review separately | PASS — latest FE-01/FE-02 local Windows E2E only; reports linked below; no promotion |
| GEN-008 | PRD-014 | Minimal, Standard, Full docs contain working actual commands and truthful status | PARTIAL — Standard/Full observed; Minimal and broader doc assertions remain |
| GEN-009 | PRD-016,NFR-003 | Exact tool versions, adapter IDs, source integrity and lock hash persisted where applicable; no secrets | PASS — FE-01/FE-02 manifests; no Forma template selected |
| GEN-010 | PRD-017 | SQL migration and DB driver work against test service; none mode has no DB artifacts | NOT RUN — no database adapters in Phase 01 |
| GEN-011 | PRD-018 | Fullstack UI can call actual API endpoint; root scripts work on Windows | NOT RUN |
| GEN-012 | PRD-019,NFR-004–005 | No arbitrary commands/token logging; file ownership and consent controls enforced | PARTIAL — elevated caller blocked; native filesystem tests not executed here; DEC-016 consent unchanged; lifecycle scripts remain unsandboxed |
| GEN-013 | PRD-020,NFR-008 | Offline caches work if complete; otherwise transparent network/prerequisite error | NOT RUN |
| GEN-014 | PRD-021 | Private Forma auth; SHA/manifest verified; React Vite/Next templates build and smoke | NOT RUN |
| GEN-015 | PRD-024 | Optional Docker Compose generated correctly; services never started without action | NOT RUN |
| GEN-016 | PRD-025 | Optional Git init and commit; without Git generation succeeds, no remote push | PARTIAL — no-Git FE-01/FE-02 generation only; Git bootstrap unsupported |
| GEN-017 | PRD-026,NFR-006 | Error includes stage, stable code, next action, and target-modification status | PARTIAL — selected CLI/core errors tested; full taxonomy incomplete |
| GEN-018 | NFR-001 | Paths with spaces/Unicode, drive letters, long path/junction handling | PASS — targeted Windows path tests and FE E2E path with spaces/`雪` |
| GEN-019 | NFR-011 | Tampered template/manifest rejected before installation | NOT RUN |
| GEN-020 | NFR-012 | Local redacted logs and user-controlled retention, telemetry off by default | NOT RUN |
| UX-001 | PRD-001–006 | Wizard keyboard navigable; disabled options explain why | NOT RUN |
| UX-002 | PRD-007–008 | Doctor and plan distinguish missing required vs optional tools | NOT RUN |
| UX-003 | PRD-011 | Live job updates, indeterminate progress, cancel and retry errors visible | NOT RUN |
| UX-004 | PRD-015 | Completion screen opens valid folder/editor and shows truthful commands | NOT RUN |
| UX-005 | NFR-007 | Focus visible, meaningful labels, reduced motion, accessible status announcements | NOT RUN |
| UX-006 | PRD-002, NFR-001 | Path picker previews valid Windows destination, explains reserved/occupied path errors | NOT RUN |
| UX-007 | PRD-004, PRD-006 | Changing framework invalidates incompatible styling/template selection without silent substitution | NOT RUN |
| UX-008 | PRD-014 | Docs modes preview actual file inventory, no fictional history or approvals | NOT RUN |
| UX-009 | PRD-008, PRD-019 | Review reveals sanitized commands, writes, network/install hooks, blocks unsupported or stale plan | NOT RUN |
| UX-010 | PRD-011, NFR-009 | Cancel transitions through stopping/cleanup before Cancelled result; cleanup failure actionable | NOT RUN |
| UX-011 | PRD-013, NFR-010 | Result distinguishes Ready vs generated-but-unverified vs failed/cancelled | NOT RUN |
| UX-012 | PRD-015, PRD-023 | Open folder/editor is explicit, unavailable target shown as missing, no hidden project execution | NOT RUN |
| MOB-001 | PRD-027 | Expo scaffold/Android device workflow on Windows; iOS native limitation clear | FUTURE |
| MOB-002 | PRD-027 | Flutter SDK, pub, Android build and emulator preflight | FUTURE |

## Phase 01 execution snapshot

- Windows 11 Pro build `26300` x64; Node.js `22.22.1`; npm `10.9.4`.
- After Phase 01.5 fixes and Phase 01.6 lifecycle-disclosure regression, `npm test`, `npm run typecheck`, and `npm run lint`: exit `0`. Test suite: 17 core tests and 3 CLI tests passed; zero failed or skipped.
- Windows unit coverage includes junction rejection, case-insensitive collision, forged-stage ownership rejection, no-replace collision/success, process-tree cancellation, abort during runner path checks, and fail-closed taskkill errors (`packages/core/test/safety.test.ts`, `runner.test.ts`). Schema tests cover traversal, reserved names, long paths, spaces and Unicode (`schema.test.ts`).
- FE-01 and FE-02 were rerun through the CLI's explicit `--development-allow-planned` flag. Per-run job IDs, scaffold integrity, manifest/lockfile hashes, and limits: [FE-01](evidence/FE-01/2026-11-11-phase-01.6-cli-e2e.md), [FE-02](evidence/FE-02/2026-11-11-phase-01.6-cli-e2e.md). Earlier reports remain available: [FE-01](evidence/FE-01/2026-11-11-cli-e2e.md), [FE-02](evidence/FE-02/2026-11-11-cli-e2e.md).
- In each generated project, `npm run lint` and `npm run build` also exited `0`.
- `PASS` above means only the stated test scope passed. FE-01/FE-02 remain `planned` and NO-GO. Runtime proof for detached/full-job cancellation and junction-swap safety, clean-machine packaging, and desktop QA remain open. See [Phase 01.5 baseline](evidence/phase-01.5-windows-security-review.md), [Phase 01.6 follow-up](evidence/phase-01.6-windows-safety-remediation.md), and [Phase 01.7 native-hardening evidence](evidence/phase-01.7-windows-native-hardening.md).

## Phase 01.7 Windows-native hardening

- Implementation: Rust sidecar creates workload suspended and assigns it to a Job Object before resume; verifies membership and kill-on-close; rejects elevated callers; routes staging create/cleanup/finalize through handle-rooted native operations. No PID/taskkill fallback. This is process management, **not** a sandbox; see [DEC-015](../decisions/DEC-015-windows-native-safety-boundary.md).
- Build/checks on Windows: `npm test` PASS (15 core + 3 CLI passed; 10 Windows process/filesystem integration tests skipped; 0 failed), `npm run lint` PASS, `npm run typecheck` PASS, `cargo test --locked` PASS (both helper test targets compile; 0 Rust unit tests), `cargo clippy --locked -- -D warnings` PASS, `cargo fmt --check` PASS. Native release sidecar build PASS.
- Native `--check-elevation` returned `{"elevated":true}` for this High Integrity administrator session. Elevated-generation rejection test passed; generation did not create staging or start a workload.
- Cancellation, timeout, detached-descendant, unrelated-process, explicit breakaway, no-replace-finalize, parent-junction race, cleanup-junction race, and finalize-junction race tests were **SKIPPED**, because running them would require bypassing the elevated-mode guard. They are implementation tests, not passing evidence yet.
- DEC-016 remains unchanged: explicit `generate` is consent to lifecycle scripts, not isolation. FE-01 and FE-02 remain `planned` and **NO-GO**. Required next step: run skipped tests from a non-elevated Windows 11 session; review remaining path-based Node staging writes, termination-failure/helper-death cases, packaging, then independent security review.

## Phase 01.8 Windows native runtime verification

- Baseline `53d71068ecb93a959cf31809559fdd9a170143a2`; native `--check-elevation` returned `{"elevated":true}` (exit 0), and token carried High Mandatory Level.
- `npm test` exit 0: core 15 passed, 10 intentionally skipped by the elevation guard, 0 failed; CLI 3 passed, 0 skipped. All ten skips are listed in [Phase 01.8 evidence](evidence/phase-01.8-windows-native-runtime-verification.md); no integration test is counted as a pass.
- Typecheck, lint, Cargo test/Clippy/format checks passed. Real npm cancellation, forced-helper-death/cleanup-failure tests, FE-01/FE-02 native E2E, and independent security review remain **NOT RUN** because no non-elevated session was available.
- FE-01 and FE-02 remain `planned` and **NO-GO for promotion**. See report and raw test log: [Phase 01.8 evidence](evidence/phase-01.8-windows-native-runtime-verification.md).

## Evidence protocol

For any recipe marked `tested`, store a report under future `docs/qa/evidence/<recipe-id>/<test-run-id>.md` with:

- OS build/arch, exact tools and adapter/source versions, command outputs and exit codes.
- Generated files/lockfiles and SHA of source inputs; no credentials or secret content.
- Explicit `PASS`/`FAIL` for environment checks, scaffold, dependency install, lint/typecheck/build and smoke.
- Browser/server smoke when relevant, including responsive check for UI templates.
- DB service status and migration connectivity if claimed; no assumption from config file creation.
- Negative tests for target collision, cancellation and corrupt download.
- Reviewer or CI approval link for promotion from `planned`/`experimental` to `tested`.

**A test being listed here is not evidence it was executed.**
