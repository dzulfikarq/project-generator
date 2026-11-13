# V1 Acceptance & Evidence Matrix

| Field | Value |
|---|---|
| Status | **PARTIAL** — Phase 01 local evidence and Phase 03 UI implementation checks exist; full acceptance/release review remains incomplete |
| Date | 2026-11-13 |
| Target | Windows 11 first; record actual host and use clean target dirs for each run |
| Rule | No PASS claims without executable evidence |

Each GEN/UX test has PRD/NFR traceability. `NOT RUN`, `BLOCKED`, `PARTIAL`, `PASS`, `FAIL` are not interchangeable. A **PASS** records the tested scope, exact recipe/tool versions, commands, exit codes and artifacts. A pass for FE-01/FE-02 does not promote either recipe or approve a release. Failure logs must be redacted.

| Test ID | Requirement | Acceptance procedure / expected evidence | Current status |
|---|---|---|---|
| GEN-001 | PRD-001–004 | Invalid framework/database/ORM/style rejected at plan stage; target untouched | PARTIAL — FE-01/FE-02 schema/resolver only |
| GEN-002 | PRD-002,NFR-001–002 | Existing directory, path traversal, Windows reserved names, junction escape rejected | PARTIAL — non-elevated native create/write/cleanup/finalize and bounded process-crash recovery exercised; journal/marker identity rebind, pre-marker preservation, post-rename ACL failure, cleanup interruption, and outside sentinels covered; cross-account ACL denial remains untested and historical finalize anomaly unexplained; see [Phase 01.10 recovery evidence](evidence/phase-01.10-windows-recovery-implementation.md) |
| GEN-003 | PRD-005,PRD-012 | npm default for Node; unsupported managers rejected; correct lockfile | PASS — FE-01/FE-02 npm only |
| GEN-004 | PRD-007 | Missing Node/Go/PHP/Composer/Python/uv reported with fix action, no hidden install | PARTIAL — Node/npm positive detection; missing-tool scenarios incomplete |
| GEN-005 | PRD-008–009 | Review shows accurate steps; scaffold is deterministic and noninteractive | PARTIAL — read-only plan tests and pinned FE scaffolds; plan-preview audit incomplete |
| GEN-006 | PRD-010–011,NFR-009 | Cancelling running scaffold stops owned process tree and cleans only owned staging | PARTIAL — non-elevated cancellation, timeout, detached descendants, breakaway rejection, forced helper death, and real npm lifecycle-install cancellation passed; one expected elevated-only skip; broader independent acceptance remains open |
| GEN-007 | PRD-013,NFR-010 | Generate from pinned scaffold; compile/build/typecheck/smoke selected recipe; record independent review separately | PASS — latest local FE-01/FE-02 native Windows E2Es passed their listed checks; finalize anomaly and independent acceptance remain separate blockers; [FE-01 Phase 01.10](evidence/FE-01/2026-11-12-phase-01.10-native-e2e.md), [FE-02 Phase 01.10](evidence/FE-02/2026-11-12-phase-01.10-native-e2e.md) |
| GEN-008 | PRD-014 | Minimal, Standard, Full docs contain working actual commands and truthful status | PARTIAL — Standard/Full observed; Minimal and broader doc assertions remain |
| GEN-009 | PRD-016,NFR-003 | Exact tool versions, adapter IDs, source integrity and lock hash persisted where applicable; no secrets | PASS — FE-01/FE-02 manifests; no Forma template selected |
| GEN-010 | PRD-017 | SQL migration and DB driver work against test service; none mode has no DB artifacts | NOT RUN — no database adapters in Phase 01 |
| GEN-011 | PRD-018 | Fullstack UI can call actual API endpoint; root scripts work on Windows | NOT RUN |
| GEN-012 | PRD-019,NFR-004–005 | No arbitrary commands/token logging; file ownership and consent controls enforced | PARTIAL — lifecycle scripts remain unsandboxed; no outside-write isolation is claimed. Journal ACL cross-account denial remains untested; same-user code remains outside this boundary. Path-based reads and independent acceptance remain open; see [DEC-017](../decisions/DEC-017-windows-staging-crash-recovery.md) |
| GEN-013 | PRD-020,NFR-008 | Offline caches work if complete; otherwise transparent network/prerequisite error | NOT RUN |
| GEN-014 | PRD-021 | Private Forma auth; SHA/manifest verified; React Vite/Next templates build and smoke | PARTIAL — Phase 02 local Windows integration E2Es pass for five exact template/framework pairs; not independently reviewed or promoted; see [evidence](evidence/phase-02-forma-local-integration.md) |
| GEN-015 | PRD-024 | Optional Docker Compose generated correctly; services never started without action | NOT RUN |
| GEN-016 | PRD-025 | Optional Git init and commit; without Git generation succeeds, no remote push | PARTIAL — no-Git FE-01/FE-02 generation only; Git bootstrap unsupported |
| GEN-017 | PRD-026,NFR-006 | Error includes stage, stable code, next action, and target-modification status | PARTIAL — selected CLI/core errors tested; full taxonomy incomplete |
| GEN-018 | NFR-001 | Paths with spaces/Unicode, drive letters, long path/junction handling | PARTIAL — path tests and FE E2E paths with spaces/`雪` passed; finalize/junction anomaly remains unexplained despite added identity-bound fail-closed checks |
| GEN-019 | NFR-011 | Tampered template/manifest rejected before installation | NOT RUN |
| GEN-020 | NFR-012 | Local redacted logs and user-controlled retention, telemetry off by default | NOT RUN |
| UX-001 | PRD-001–006 | Wizard keyboard navigable; disabled options explain why | PARTIAL — browser mock checked field validation and disabled catalog/compatibility choices; keyboard traversal and full project-type flow not tested |
| UX-002 | PRD-007–008 | Doctor and plan distinguish missing required vs optional tools | PARTIAL — actual Tauri catalog/runtime/plan/doctor smoke passed on this host; missing-tool and optional-tool cases not exercised |
| UX-003 | PRD-011 | Live job updates, indeterminate progress, cancel and retry errors visible | PARTIAL — browser-mock events, cancellation and failure states passed; no native generation job executed |
| UX-004 | PRD-015 | Completion screen opens valid folder/editor and shows truthful commands | PARTIAL — mocked result UI reviewed; actual Explorer/VS Code actions and generated-project command reporting not tested |
| UX-005 | NFR-007 | Focus visible, meaningful labels, reduced motion, accessible status announcements | PARTIAL — browser smoke checked accessible names/labels, reduced motion, focus styling, and 760px overflow; keyboard, screen reader, contrast, scaling, and live-region audit not run |
| UX-006 | PRD-002, NFR-001 | Path picker previews valid Windows destination, explains reserved/occupied path errors | PARTIAL — input/path preview, reserved-name and traversal validation tested; no native picker, occupied-target UI run, or scaling test |
| UX-007 | PRD-004, PRD-006 | Changing framework invalidates incompatible styling/template selection without silent substitution | PARTIAL — catalog exact-match unit test and mocked Next/Tailwind compatibility states passed; framework-switch invalidation not fully exercised |
| UX-008 | PRD-014 | Docs modes preview actual file inventory, no fictional history or approvals | PARTIAL — all three browser previews checked against desktop model; generated docs not run from desktop UI |
| UX-009 | PRD-008, PRD-019 | Review reveals sanitized commands, writes, network/install hooks, blocks unsupported or stale plan | PARTIAL — actual native read-only plan/doctor and mocked consent gate reviewed; no stale-plan race or generation execution tested |
| UX-010 | PRD-011, NFR-009 | Cancel transitions through stopping/cleanup before Cancelled result; cleanup failure actionable | PARTIAL — mocked UI cancellation transitions through stopping/result; native process cancellation and cleanup failure not run |
| UX-011 | PRD-013, NFR-010 | Result distinguishes Ready vs generated-but-unverified vs failed/cancelled | PARTIAL — mocked cancelled/failed states and event rendering checked; no native result or generated output observed |
| UX-012 | PRD-015, PRD-023 | Open folder/editor is explicit, unavailable target shown as missing, no hidden project execution | PARTIAL — fixed commands and local metadata model tested; actual open actions/history for a generated project not run |
| PKG-001 | OPEN-001, PRD-009, NFR-005 | Build and inspect system-Node and bundled-Node installers; verify packaged CLI/resources and runtime separation | PARTIAL — both x64 NSIS modes built; bundled CLI catalog/doctor passed with system Node removed from PATH; clean-machine proof unavailable |
| PKG-002 | PRD R5, NFR-002 | Per-user install, launch, update runtime/version, uninstall, and preserve separate user project | PASS — same-host Windows 11 system 0.1.0 → bundled 0.1.1; app launched; uninstall removed app/registry entry; external sentinel remained unchanged |
| PKG-003 | PRD-011, NFR-009, DEC-013 | Desktop cancellation sends only versioned cancel intent and terminal status follows process exit | PARTIAL — CLI cancel parser and Rust event/auth tests pass; browser-mock UI cancellation passed; native UI-driven cancellation not run |
| PKG-004 | NFR-010, OPEN-001 | Install and launch on clean Windows 11 x64 machine without preinstalled developer tools | BLOCKED — no clean Windows 11 environment available |
| MOB-001 | PRD-027 | Expo scaffold/Android device workflow on Windows; iOS native limitation clear | FUTURE |
| MOB-002 | PRD-027 | Flutter SDK, pub, Android build and emulator preflight | FUTURE |

## Phase 01 execution snapshot

- Phase 01 host/tool details are in linked Phase 01 evidence. Phase 02.6 host observed Windows 11 Pro `10.0.26300`, x64; Node.js `22.22.1`; npm `10.9.4`. It is a development host, not a clean-machine result.
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

- Native `--check-elevation` returned `{"elevated":false}`; token carried Medium Mandatory Level (`S-1-16-8192`).
- Final `npm test`: exit 0; core 30 passed / 1 expected elevated-only skip / 0 failed; CLI 3 passed / 0 skipped/failed. Raw output and SHA-256 are linked in [Phase 01.8 evidence](evidence/phase-01.8-windows-native-runtime-verification.md). Typecheck, lint, Cargo test/Clippy/format checks passed.
- Runtime tests passed for cancellation, detached descendants, helper death, real npm lifecycle cancellation, rooted staging writes, cleanup retry and junction swaps. One full-suite run and one standalone race observed missing/empty finalized output; root cause remains unknown. Follow-up changes bind source identity, protect staging/output ACLs, check NTSTATUS completion, and retain ownership evidence on failed cleanup. Do not mark original anomaly resolved. See [anomaly record](evidence/phase-01.8-finalize-junction-anomaly.md) and [security-findings closure evidence](evidence/phase-01.8-security-findings-closure.md).
- Latest FE-01 and FE-02 native E2Es passed install/check/smoke/finalize against identity guard; reports: [FE-01](evidence/FE-01/2026-11-12-phase-01.8-native-e2e.md), [FE-02](evidence/FE-02/2026-11-12-phase-01.8-native-e2e.md). They used `--development-allow-planned` and do not promote recipes.
- Historical separate read-only review withheld approval. Follow-up read-only review also withheld approval after confirming targeted ACL, handle-bound identity, NTSTATUS, and finalize-protocol controls. Cleanup crash atomicity, uncertain stage-create recovery, original anomaly, human/release approval, and clean-machine packaging remain open. FE-01 and FE-02 remain `planned` and **NO-GO for promotion**. See [historical review](evidence/phase-01.8-independent-security-review.md), [closure evidence](evidence/phase-01.8-security-findings-closure.md), and [runtime evidence](evidence/phase-01.8-windows-native-runtime-verification.md).

## Phase 01.9 recovery architecture checkpoint

- At this checkpoint, read-only source/evidence analysis recommended a protected sibling transaction journal and identity-based recovery while retaining the existing wrapped staging layout and handle-relative no-replace rename. See [DEC-017](../decisions/DEC-017-windows-staging-crash-recovery.md) and [analysis evidence](evidence/phase-01.9-windows-recovery-architecture.md).
- At that checkpoint, no implementation or crash-recovery tests had run, architecture approval was pending, and automatic recovery was unavailable; unverified stages remained untouched.
- Only one enabled local Windows account was available; second-standard-account ACL denial was not tested. Existing ACL descriptor tests do not substitute for that runtime check.
- Absolute prevention of writes outside owned staging is not supported while lifecycle scripts remain unsandboxed. Resolve isolation scope before any per-recipe GO decision. FE-01/FE-02 remain `planned` / NO-GO.

## Phase 01.10 bounded crash-recovery implementation

- DEC-017 bounded scope was approved and implemented: write-ahead sibling journal, stage/project identity binding, explicit inspect/apply recovery, and process-crash regression hooks. Existing Rust supervisor and handle-relative no-replace finalize operation remain in place.
- Windows verification: `npm test` PASS (core 36 passed, 1 expected elevated-only skip; CLI 6 passed); `npm run typecheck`, `npm run lint`, Cargo check/test/Clippy, and format check PASS. Details and crash cases: [implementation evidence](evidence/phase-01.10-windows-recovery-implementation.md).
- Recovery inspection after FE-01/FE-02 reruns returned no pending transactions. Latest local E2Es passed listed checks: [FE-01](evidence/FE-01/2026-11-12-phase-01.10-native-e2e.md), [FE-02](evidence/FE-02/2026-11-12-phase-01.10-native-e2e.md). They used the development-only override; recipes remain `planned` / NO-GO.
- **Unverified/blocked:** cross-account ACL denial (only one enabled account available); lifecycle-script filesystem isolation; power-loss durability; historical finalize anomaly diagnosis. These are not claimed as solved. No release approval.

## Phase 01.9 final acceptance review

- Read-only review of commit `04fcab4` accepts DEC-017's bounded process-crash behavior for controlled local development; power-loss, cross-account ACL, and lifecycle isolation claims remain explicitly unsupported.
- Historical finalize anomaly root cause remains unresolved. Current postconditions contain missing/wrong-identity targets, but direct fault injection at the finalizer success boundary remains a public-release gate. See [final acceptance review](evidence/phase-01.9-final-acceptance.md).
- FE-01 and FE-02: **GO for development-only evidence runs; NO-GO for public support/release**. No promotion performed.

## Phase 02 Forma local integration

- Five pinned Forma combinations completed local generation, npm install, TypeScript check, production build, HTTP smoke, and the template's separate browser smoke. Standalone FE-01 also passed its existing checks after integration; evidence: [Phase 02 report](evidence/phase-02-forma-local-integration.md).
- All runs used the development-only planned-recipe override where applicable. FM-01/FM-02 and FE-01/FE-02 remain `planned`; no independent acceptance or release approval.
- The SHA-256 manifest detected/validated package integrity in these runs; no adversarial cache-corruption test or signed-publisher verification was performed. Interrupted cache directories, lifecycle isolation, second-account ACL denial, and power-loss durability remain unverified/not claimed.

## Phase 02.6 desktop/runtime packaging PoC

- Scope/evidence: [runtime and packaging report](evidence/phase-02.6-desktop-runtime-packaging.md). React/Vite + Tauri 2 fixed-command shell; system and bundled Node installer variants; no recipe promotion or release approval.
- Same-version 0.1.1 artifact sizes: system Node `2,258,037` bytes; bundled Node + npm `26,259,213` bytes, delta `24,001,176` bytes (`22.89 MiB`). Bundled runtime: Node `22.22.1`, npm `10.9.4`. Artifact SHA-256 values are in the evidence report.
- NSIS scripts retained `resources/pg-runtime/{cli,runtime,catalog}` paths and packaged the Windows supervisor. Installed system 0.1.0 catalog invocation passed with Node on PATH; bundled 0.1.1 plan/doctor passed with system Node removed from PATH. Bundled doctor reported Node/npm versions and ready target; an existing target was blocked without overwrite.
- Per-user install → visible launch → bundled-version update → visible launch → uninstall all exited `0`; uninstaller removed install directory and HKCU uninstall entry. Separate test project sentinel remained unchanged.
- `npm test`: core 38 passed, 1 expected elevated-only skip; CLI 8 passed. `npm run typecheck`, `npm run lint`, `cargo test --locked` (5 Rust tests), `cargo clippy --locked -- -D warnings`, `cargo fmt --check`, both runtime installer builds, and production-only npm audit passed.
- Not run: clean-machine install; Windows 11 machines without Node/WebView2 prerequisites; UI-driven generation/cancellation; full accessibility/scaling review; independent security review; recipe acceptance. Both Node strategies remain PoC options; public release remains NO-GO.

## Phase 03 desktop UI MVP implementation checks

- Host: Windows 11 Pro `10.0.26300`; Node.js `22.22.1`; npm `10.9.4`; Rust `1.99.1`; Edge `157.0.4341.46`. Debug Tauri app used system runtime.
- Native, read-only Tauri WebView smoke: actual `get_catalog`, `get_runtime_status`, `resolve_plan`, and `run_environment_doctor` commands passed. Catalog returned FE-01/FE-02 as `planned` and three Forma metadata entries. Doctor reported Node/npm/target ready. Lifecycle consent was unchecked and Generate remained disabled. Unique smoke destination remained absent before/after. No generation, network fetch, folder-open, or editor-open command ran.
- Browser mock smoke: 10 assertions passed for dashboard/gallery, invalid-name gate, framework/style compatibility, full-doc inventory, consent and planned-recipe gates, mocked cancel/failure, abandoned wizard, local theme/path persistence, labels/reduced motion, and 760px overflow. Catalog came from the built CLI; plan/doctor/job responses were mocked. This is UI behavior evidence, not native generation evidence.
- Screenshots: [`phase-03-desktop-ui/`](evidence/phase-03-desktop-ui/) contains six browser-mock screens and actual Tauri dashboard/read-only review captures. The dark screenshot was recaptured after the background-color fix.
- Native open actions, UI-driven CLI generation/cancellation/failure, FE-01/FE-02 or Forma generation, full keyboard/screen-reader/contrast checks, 125–200% scaling, clean-machine install, independent security review, and release review remain NOT RUN/BLOCKED. Lifecycle scripts remain unsandboxed; all recipes remain planned.
- Final checks: `npm test` exit 0 (core 38 passed / 1 expected skip; CLI 8; desktop 8), `npm run typecheck`, `npm run lint`, desktop build, `cargo test --locked` (7), `cargo clippy --locked -- -D warnings`, and `cargo fmt --check` all passed. These checks do not promote recipes or approve release. Detailed evidence: [Phase 03 report](evidence/phase-03-desktop-ui-mvp.md).

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
