# V1 Acceptance & Evidence Matrix

| Field | Value |
|---|---|
| Status | **PARTIAL** — Phase 01 local evidence, Phase 03 UI implementation checks, and Phase 04A recipe/UI evidence exist; full acceptance/release review remains incomplete |
| Date | 2026-11-13 |
| Target | Windows 11 first; record actual host and use clean target dirs for each run |
| Rule | No PASS claims without executable evidence |

Each GEN/UX test has PRD/NFR traceability. `NOT RUN`, `BLOCKED`, `PARTIAL`, `PASS`, `FAIL` are not interchangeable. A **PASS** records the tested scope, exact recipe/tool versions, commands, exit codes and artifacts. A pass for FE-01/FE-02 does not promote either recipe or approve a release. Failure logs must be redacted.

| Test ID | Requirement | Acceptance procedure / expected evidence | Current status |
|---|---|---|---|
| GEN-001 | PRD-001–004 | Invalid framework/database/ORM/style rejected at plan stage; target untouched | PARTIAL — exact FE-01–FE-05 combinations and incompatible Bootstrap/Tailwind pairs tested; React-only Forma templates rejected with `GEN_INCOMPATIBLE` for Vue and target untouched; backend/database remain unavailable |
| GEN-002 | PRD-002,NFR-001–002 | Existing directory, path traversal, Windows reserved names, junction escape rejected | PARTIAL — non-elevated native create/write/cleanup/finalize and bounded process-crash recovery exercised; journal/marker identity rebind, pre-marker preservation, post-rename ACL failure, cleanup interruption, and outside sentinels covered; cross-account ACL denial remains untested and historical finalize anomaly unexplained; see [Phase 01.10 recovery evidence](evidence/phase-01.10-windows-recovery-implementation.md) |
| GEN-003 | PRD-005,PRD-012 | npm default for Node; unsupported managers rejected; correct lockfile | PASS — FE-01–FE-05 npm-only local runs; Bootstrap CSS peer handling and lock integrity checked |
| GEN-004 | PRD-007 | Missing Node/Go/PHP/Composer/Python/uv reported with fix action, no hidden install | PARTIAL — Node/npm positive detection; missing-tool scenarios incomplete |
| GEN-005 | PRD-008–009 | Review shows accurate steps; scaffold is deterministic and noninteractive | PARTIAL — FE-03–FE-05 read-only plans, Doctor checks, and pinned CLI/native scaffolds passed; native Bootstrap reviews exposed `.npmrc` and Popper exclusion; broader plan-preview audit remains |
| GEN-006 | PRD-010–011,NFR-009 | Cancelling running scaffold stops owned process tree and cleans only owned staging | PARTIAL — non-elevated cancellation, timeout, detached descendants, breakaway rejection, forced helper death, and real npm lifecycle-install cancellation passed; one expected elevated-only skip; broader independent acceptance remains open |
| GEN-007 | PRD-013,NFR-010 | Generate from pinned scaffold; compile/build/typecheck/smoke selected recipe; record independent review separately | PASS — FE-01/FE-02 regression plus fresh FE-03–FE-05 CLI and native Windows runs passed listed checks; independent review, lifecycle isolation, and release approval remain blockers; see [Phase 04A native acceptance](evidence/phase-04a-native-desktop-acceptance.md) |
| GEN-008 | PRD-014 | Minimal, Standard, Full docs contain working actual commands and truthful status | PARTIAL — FE-03–FE-05 Standard docs generated and observed; Minimal, Full, and broader doc assertions remain |
| GEN-009 | PRD-016,NFR-003 | Exact tool versions, adapter IDs, source integrity and lock hash persisted where applicable; no secrets | PASS — FE-01–FE-05 manifests record exact tool/source versions, integrity, and lock hashes; no Forma template selected |
| GEN-010 | PRD-017 | SQL migration and DB driver work against test service; none mode has no DB artifacts | NOT RUN — no database adapters in Phase 01 |
| GEN-011 | PRD-018 | Fullstack UI can call actual API endpoint; root scripts work on Windows | NOT RUN |
| GEN-012 | PRD-019,NFR-004–005 | No arbitrary commands/token logging; file ownership and consent controls enforced | PARTIAL — lifecycle scripts remain unsandboxed; no outside-write isolation is claimed. Journal ACL cross-account denial remains untested; same-user code remains outside this boundary. Path-based reads and independent acceptance remain open; see [DEC-017](../decisions/DEC-017-windows-staging-crash-recovery.md) |
| GEN-013 | PRD-020,NFR-008 | Offline caches work if complete; otherwise transparent network/prerequisite error | NOT RUN |
| GEN-014 | PRD-021 | Private Forma auth; SHA/manifest verified; React Vite/Next templates build and smoke | PARTIAL — Phase 02 local Windows integration E2Es pass for five exact template/framework pairs; FE-03–FE-05 desktop wizard and CLI plan reject React-only Forma + Vue; Forma integration remains unreviewed and unpromoted; see [Phase 02 evidence](evidence/phase-02-forma-local-integration.md) |
| GEN-015 | PRD-024 | Optional Docker Compose generated correctly; services never started without action | NOT RUN |
| GEN-016 | PRD-025 | Optional Git init and commit; without Git generation succeeds, no remote push | PARTIAL — no-Git FE-01–FE-05 generation only; Git bootstrap unsupported |
| GEN-017 | PRD-026,NFR-006 | Error includes stage, stable code, next action, and target-modification status | PARTIAL — selected CLI/core errors tested; full taxonomy incomplete |
| GEN-018 | NFR-001 | Paths with spaces/Unicode, drive letters, long path/junction handling | PARTIAL — FE-01–FE-05 CLI E2E paths with spaces/`雪` passed; finalize/junction anomaly remains unexplained despite added identity-bound fail-closed checks |
| GEN-019 | NFR-011 | Tampered template/manifest rejected before installation | NOT RUN |
| GEN-020 | NFR-012 | Local redacted logs and user-controlled retention, telemetry off by default | NOT RUN |
| UX-001 | PRD-001–006 | Wizard keyboard navigable; disabled options explain why | PARTIAL — native FE-03–FE-05 selection and plans observed; Vue/Tailwind and all React/Next Forma cards disabled for Vue; wizard-wide traversal and all project types remain untested |
| UX-002 | PRD-007–008 | Doctor and plan distinguish missing required vs optional tools | PARTIAL — native FE-03–FE-05 plans/Doctor reported supported Node/npm and available targets; missing-tool and optional-tool cases not exercised |
| UX-003 | PRD-011 | Live job updates, indeterminate progress, cancel and retry errors visible | PARTIAL — native FE-03–FE-05 completed with live stage/check events; earlier FE-01/FE-02 collision, retry, and cancellation observed; cleanup-failure and broader error taxonomy remain open |
| UX-004 | PRD-015 | Completion screen opens valid folder/editor and shows truthful commands | PARTIAL — native FE-03–FE-05 results and validation manifests observed; Explorer/VS Code opened from earlier FE-01/FE-02 result/history; broader command-reporting review remains |
| UX-005 | NFR-007 | Focus visible, meaningful labels, reduced motion, accessible status announcements | PARTIAL — native six-item Tab sequence, Space activation, 3px focus, zero unnamed buttons, reduced motion, theme persistence, contrast tokens, and 760×640 overflow checked; emulated DPR 1.25/1.5 passed. Actual Windows 125%/150% scaling and screen reader/live-region audit remain open |
| UX-006 | PRD-002, NFR-001 | Path picker previews valid Windows destination, explains reserved/occupied path errors | PARTIAL — path preview plus native occupied-target Doctor `BLOCKED` state tested without modifying sentinel; native picker and broader invalid-path cases remain untested; emulated DPR is not actual Windows scaling evidence |
| UX-007 | PRD-004, PRD-006 | Changing framework invalidates incompatible styling/template selection without silent substitution | PARTIAL — exact-match tests, native disabled Vue/Tailwind and React/Next Forma cards, selectable Vue/Bootstrap, and CLI `GEN_INCOMPATIBLE` plan rejection passed; framework-switch invalidation not fully exercised |
| UX-008 | PRD-014 | Docs modes preview actual file inventory, no fictional history or approvals | PARTIAL — FE-03–FE-05 native Standard review and generated docs observed; Minimal/Full and broader preview assertions remain |
| UX-009 | PRD-008, PRD-019 | Review reveals sanitized commands, writes, network/install hooks, blocks unsupported or stale plan | PARTIAL — FE-03–FE-05 native reviews disclosed lifecycle/network effects; Bootstrap reviews exposed `.npmrc` and unused Popper exclusion. Both consent gates defaulted closed and were explicitly affirmed for isolated runs. Other stale-plan races remain open |
| UX-010 | PRD-011, NFR-009 | Cancel transitions through stopping/cleanup before Cancelled result; cleanup failure actionable | PARTIAL — native UI cancellation reached Cancelled, absent target, and empty recovery inspection; cleanup-failure behavior not exercised |
| UX-011 | PRD-013, NFR-010 | Result distinguishes Ready vs generated-but-unverified vs failed/cancelled | PARTIAL — native FE-03–FE-05 results showed checks passed while recipes remained planned; earlier FE-01/FE-02 failure and cancellation results observed; broader status taxonomy remains unverified |
| UX-012 | PRD-015, PRD-023 | Open folder/editor is explicit, unavailable target shown as missing, no hidden project execution | PARTIAL — fixed native folder/VS Code actions opened generated FE-01/FE-02 targets from result/history; missing-target behavior and full no-hidden-execution review remain open |
| PKG-001 | OPEN-001, PRD-009, NFR-005 | Build and inspect system-Node and bundled-Node installers; verify packaged CLI/resources and runtime separation | PARTIAL — both x64 NSIS modes built; bundled CLI catalog/doctor passed with system Node removed from PATH; clean-machine proof unavailable |
| PKG-002 | PRD R5, NFR-002 | Per-user install, launch, update runtime/version, uninstall, and preserve separate user project | PASS — same-host Windows 11 system 0.1.0 → bundled 0.1.1; app launched; uninstall removed app/registry entry; external sentinel remained unchanged |
| PKG-003 | PRD-011, NFR-009, DEC-013 | Desktop cancellation sends only versioned cancel intent and terminal status follows process exit | PARTIAL — CLI/Rust cancellation tests and native UI-driven cancellation passed; broader cancellation/cleanup failure review remains open |
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

- Baseline evidence: [Phase 03 report](evidence/phase-03-desktop-ui-mvp.md) and its browser-mock/native read-only captures. Follow-up Forge Studio redesign checks are recorded separately below; they supersede the baseline's UI-scope gaps only where explicitly tested.
- Latest UI evidence: [Forge Studio redesign report](evidence/forge-studio-redesign.md), including actual Tauri WebView screenshots and UI-driven cancellation. All recipes remain `planned`; release review remains incomplete.

## Forge Studio redesign verification

- Host: Windows 11 Pro `10.0.26300`; Node.js `22.22.1`; npm `10.9.4`; Rust/Cargo `1.99.1`; Edge WebView2 `157.0.4341.46`. Native debug Tauri app used system runtime.
- Native smoke covered grouped sidebar navigation/runtime status, overview, wizard/review, Forma catalog search/category filters, framework catalog, Doctor refresh, theme persistence, and settings. Geist fonts loaded locally. FE-01 plan/Doctor returned ready; default lifecycle and internal planned-override consent remained unchecked and Generate disabled.
- Internal-only cancellation run explicitly checked both gates, observed real JSONL CLI events through Tauri, cancelled during staging, and reached Cancelled. Target under `E:\MyProjects` remained absent; no history entry or finalized project. This is not a completed generation or recipe acceptance.
- Keyboard focus and reduced-motion checks ran in native WebView; button-name scan found no unlabeled buttons. At 1500×820 and 760×640, seven pages shared content gutters without horizontal overflow. Host Windows scaling was 100% (`devicePixelRatio=1`); emulated DPR 1.25/1.5 passed overflow checks. Actual Windows 125%/150% scaling, screen readers, full live-region review, and rendered-control contrast audit remain open; token-level contrast tests passed.
- Latest checks: `npm test` (core 38 passed / 1 expected skip; CLI 8; desktop 12), `npm run typecheck`, `npm run lint`, desktop production build, `cargo test --locked` (8), `cargo clippy --locked -- -D warnings`, and `cargo fmt --check` passed. No recipe status or release approval changed.

## Phase 03.5 final desktop UX and functional acceptance

- Detailed report and native screenshots: [Phase 03.5 evidence](evidence/phase-03.5-final-desktop-acceptance.md). Baseline `3ce0cb531a552bd1551758888883c54e7dad110e`; no generation guard, adapter, or recipe status changes.
- Fixed ten malformed `line-height` values to use existing typography tokens. Native 1500×820 screenshot exposed clipped dashboard empty-state CTA; reduced only empty-state padding. Branding, color tokens, and Geist typography remain unchanged.
- Actual Tauri debug WebView, non-elevated Windows 11 Pro `10.0.26300`, system Node.js `22.22.1`, npm `10.9.4`, WebView2 `157.0.4341.46`. New isolated test root: `E:\MyProjects\pg-phase35-acceptance-20261113`.
- UI-driven FE-01 (`create-vite@9.3.4`) and FE-02 (`create-next-app@16.4.6`) runs used debug-only `--development-allow-planned`; both review gates were unchecked by default and explicitly affirmed. Both completed with all reported validation exit codes `0`; manifests record lockfile SHA-256. Recipes remain `planned`.
- Occupying FE-01 destination after review produced `GEN_PATH_EXISTS`; no overwrite, sentinel SHA-256 unchanged. Retrying to a fresh FE-01 destination completed. Separate occupied-destination review showed Doctor `BLOCKED` and Generate disabled. UI cancellation reached `Cancelled`, target stayed absent, and read-only recovery inspection returned no pending work.
- Folder/VS Code commands succeeded from generated result/history; both projects appeared in local history. Keyboard traversed six sidebar items with visible 3px focus and activated Settings with Space; zero unnamed buttons. Reduced-motion and light/dark persistence checks passed.
- Seven pages had no horizontal overflow at 760×640; emulated DPR 1.25/1.5 passed at 1500×820. Actual host was 100% (`devicePixelRatio=1`, AppliedDPI 96); actual 125%/150%, screen-reader/live-region audit, and cleanup-failure UX remain unverified.
- Checks: desktop tests 14/14; root `npm run typecheck`; `npm run lint`; `npm run build --workspace @project-generator/desktop` all passed. Full workspace `npm test` and packaged Tauri installer build were not rerun in this phase. Public release remains **NO-GO**.

## Phase 04A Vue and Bootstrap recipe expansion

- Recipe pins and initial expansion records: [Phase 04A implementation evidence](evidence/phase-04a-vue-bootstrap-expansion.md). Fresh CLI + native desktop acceptance, hashes, job IDs, and Phase 04B disposition: [Phase 04A native acceptance](evidence/phase-04a-native-desktop-acceptance.md). Host: Windows 11 Pro `10.0.26300`, x64, non-elevated; Node.js `22.22.1`; npm `10.9.4`; Tauri debug app with WebView2 `157.0.4341.46`.
- FE-01/FE-02 regression and FE-03–FE-05 CLI generation ran in clean destinations under paths containing spaces and `雪`. Plan/Doctor/generation checks passed; all remain `planned` and normal generation stays blocked.
- Forge Studio completed catalog → wizard → review/Doctor → closed-consent check → generation → result for FE-03, FE-04, and FE-05. Vue + Tailwind and all React/Next Forma template cards were disabled for Vue. All three native results passed listed recipe checks and retained `planned` status; exact targets/job IDs/hashes are in the acceptance report.
- First Bootstrap install revealed npm's automatic `@popperjs/core` peer install. Bootstrap integration now writes `.npmrc` with `legacy-peer-deps=true`, passes `--legacy-peer-deps`, and rejects Popper in the lock. Fresh FE-04/FE-05 CLI and desktop outputs verified Bootstrap `5.3.9` integrity, no Popper package, and matching manifest lock hashes.
- Targeted regressions: `npm test` PASS (core 38 passed / 1 expected elevated-only skip; CLI 9; desktop 14), including cancellation, collision, and recovery/rollback coverage; `npm run typecheck` and `npm run lint` PASS. These local runs do not provide independent acceptance, recipe promotion, or release approval; lifecycle scripts remain unsandboxed.

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
