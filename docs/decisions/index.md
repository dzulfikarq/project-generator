# Decision Register — Project Generator V1

| Field | Value |
|---|---|
| Date | 2026-11-13 |
| State | Phase 01 CLI, Phase 02 local Forma integration, bounded DEC-017 recovery, Phase 02.6 runtime PoC, Phase 03 internal UI MVP, Phase 04B.3 frontend evidence, Phase 05A–05D.2 backend work; Phase 05C development scope closed after bounded independent BE-05 review; formal release review not complete |
| Governance | See [`governance.md`](governance.md) |

This project adopts EvoPilot's **decision accountability** pattern but uses standard English spelling (`decision`, `decisions`). A user-selected direction can be recorded as **Accepted Discovery** without implying implementation completion, test passage or formal release approval.

| ID | Topic | Status | Evidence / rationale | Follow-up |
|---|---|---|---|---|
| DEC-001 | Universal local-first desktop scope | Accepted Discovery | User requested multi-ecosystem generator for desktop | Confirm installer/runtime implementation |
| DEC-002 | npm default for Node ecosystem | Accepted Discovery | User explicitly requested npm default and Yarn support | Test package managers per recipe |
| DEC-003 | Plugin-based, internal reviewed adapters | Proposed | Avoid combinatorial stack explosion and unsafe third-party code | Architecture approval and PoC |
| DEC-004 | Forma as separate template provider | Accepted Discovery | Existing Forma repo/installer; no fork or reimplementation | Confirm authenticated fetch contract |
| DEC-005 | EvoPilot-style docs and decision governance | Accepted Discovery | User explicitly requests documentation similarity | Implement truthful template generator |
| DEC-006 | Tauri 2 + React UI + TS core CLI | Proposed | Small native shell and reusable CLI; packaging needs PoC | Choose runtime sidecar vs system Node |
| DEC-007 | `tested` status earned only by QA evidence | Proposed | Avoid false support claims | Adopt release criteria and CI |
| DEC-008 | Windows-first, V1 mobile support deferred | Proposed | Mobile build prerequisites differ substantially | Confirm priorities and V1.1 scope |
| DEC-009 | No overloading npm across languages | Proposed | Composer / Go Modules / uv must remain native | Verify UI terminology |
| DEC-010 | Docs modes Minimal/Standard/Full | Proposed | Offer EvoPilot-style traceability without excessive boilerplate for all projects | Validate document templates |

| DEC-011 | Phase 1 system Node; defer desktop runtime packaging | Proposed | [DEC-011](DEC-011-phase1-runtime.md) | PoC before Windows installer; OPEN-001 remains open |
| DEC-012 | Owned staging and no-replace finalization | Proposed | [DEC-012](DEC-012-owned-staging-finalize.md) | Windows race/cleanup tests needed |
| DEC-013 | Typed CLI + versioned JSONL progress bridge | Proposed | [DEC-013](DEC-013-cli-events-bridge.md) | Verify schema and consumer tests |
| DEC-014 | Windows scoped process runner | Proposed | [DEC-014](DEC-014-windows-process-runner.md) | Run native process integration on non-elevated Windows and complete security review; see DEC-015 |
| DEC-015 | Native Windows process/filesystem safety boundary | Proposed | [DEC-015](DEC-015-windows-native-safety-boundary.md) | Validate cross-account ACL behavior, targeted anomaly failure path, packaging, residual path-based writes, and broader architecture/release approval |
| DEC-016 | npm lifecycle script execution policy | Accepted Discovery | [DEC-016](DEC-016-npm-lifecycle-script-policy.md) | Interim explicit-generate disclosure policy; review before desktop UI/release |
| DEC-017 | Windows staging crash recovery | Accepted — bounded implementation | [DEC-017](DEC-017-windows-staging-crash-recovery.md), [Phase 01.10 evidence](../qa/evidence/phase-01.10-windows-recovery-implementation.md) | Review residual ACL boundary; keep lifecycle isolation, power-loss durability, anomaly diagnosis and recipe/release approval open |
| DEC-018 | Forma local CLI integration | Proposed; local implementation exists | [DEC-018](DEC-018-forma-local-integration.md), [Phase 02 evidence](../qa/evidence/phase-02-forma-local-integration.md) | Independently review credentials/cache/cancellation; no FM promotion or release approval |
| DEC-019 | Phase 02.6 desktop runtime/package comparison | Proposed; PoC evidence only | [DEC-019](DEC-019-phase2.6-desktop-runtime-packaging.md), [Phase 02.6 evidence](../qa/evidence/phase-02.6-desktop-runtime-packaging.md) | Choose runtime strategy only after clean-machine and independent security review |
| DEC-020 | Phase 03 desktop UI MVP scope | Proposed; implementation present | [DEC-020](DEC-020-phase3-desktop-ui-mvp.md), [Phase 03 evidence](../qa/evidence/phase-03-desktop-ui-mvp.md) | Review partial UI evidence; no recipe promotion or release approval |
| DEC-021 | Phase 04A Vue and Bootstrap recipe expansion | Accepted Discovery; implementation/evidence present | [DEC-021](DEC-021-phase-04a-vue-bootstrap.md), [Phase 04A evidence](../qa/evidence/phase-04a-vue-bootstrap-expansion.md) | Keep FE-03–FE-05 planned; independent acceptance and review required; Forma remains React/Next only |
| DEC-022 | Phase 04B Nuxt and Angular recipe expansion | User-authorized scoped implementation; review pending | [DEC-022](DEC-022-phase-04b-nuxt-angular.md), [Phase 04B evidence](../qa/evidence/phase-04b-nuxt-angular.md) | Keep FE-06/FE-07 planned; local evidence only; no Forma, recipe promotion, or release approval |
| DEC-023 | Phase 04B.2 React/Vue Vite SCSS and Tailwind recipes | Implementation and bounded local acceptance complete; independent review pending | [DEC-023](DEC-023-phase-04b2-scss-tailwind.md), [Phase 04B.2 evidence](../qa/evidence/phase-04b2-scss-tailwind.md) | Phase 04B.3 GO for independent review only; keep FE-08–FE-11 planned; no scope expansion or release approval |
| DEC-024 | Phase 04B.3 React/Vue Vite Yarn and pnpm recipes | Implementation and bounded local CLI/native acceptance complete; independent review pending | [DEC-024](DEC-024-phase-04b3-yarn-pnpm.md), [Phase 04B.3 evidence](../qa/evidence/phase-04b3-yarn-pnpm.md) | Keep FE-12–FE-15 planned; independent review only; npm remains default; no release approval |
| DEC-025 | Phase 05A standalone Express REST API | User-authorized implementation and bounded local CLI/native acceptance complete; independent review pending | [DEC-025](DEC-025-phase-05a-express-rest-api.md), [Phase 05A evidence](../qa/evidence/phase-05a-express-rest-api.md) | Keep BE-01 planned; no DB/fullstack expansion or release approval |
| DEC-026 | Phase 05B standalone Go REST API | User-authorized implementation, bounded Windows CLI/native acceptance, and final regressions complete; independent review pending | [DEC-026](DEC-026-phase-05b-go-net-http.md), [Phase 05B evidence](../qa/evidence/phase-05b-go-net-http.md) | Keep BE-02 planned; DEC-027 covers FastAPI as a separate blocked slice; evaluate Laravel separately; no release approval |
| DEC-027 | Phase 05C standalone FastAPI REST API | User-authorized implementation and bounded local CLI/native evidence complete; independent review pending | [DEC-027](DEC-027-phase-05c1-fastapi.md), [Phase 05C.1 evidence](../qa/evidence/phase-05c1-fastapi.md), [Phase 05C.2 evidence](../qa/evidence/phase-05c2-fastapi-toolchain-native.md) | Keep BE-06 planned; independently review pins, provenance boundary, and evidence; Laravel remains separate; no release approval |

| DEC-028 | Phase 05C.3 standalone Laravel backend | Implementation and bounded CLI/native plus isolated MySQL/Eloquent acceptance complete; bounded independent evidence review PASS; Phase 05C development scope closed | [DEC-028](DEC-028-phase-05c3-laravel.md), [Phase 05C.3 evidence](../qa/evidence/phase-05c3-laravel.md) | Keep BE-05 planned; no automatic DB provisioning/migration, frontend build, recipe promotion, or release approval |
| DEC-029 | Phase 05D.1 standalone NestJS backend | User-authorized implementation and bounded Windows CLI/native acceptance complete; independent review pending | [DEC-029](DEC-029-phase-05d1-nestjs.md), [Phase 05D.1 evidence](../qa/evidence/phase-05d1-nestjs.md) | Keep BE-03 planned; no database/ORM/auth/Docker/fullstack/Observe, recipe promotion, or release approval; see DEC-030 for BE-04 scope |
| DEC-030 | Phase 05D.2 standalone Go Gin backend | User-authorized bounded implementation and Windows CLI/native acceptance complete; independent evidence review pending | [DEC-030](DEC-030-phase-05d2-go-gin.md), [Phase 05D.2 evidence](../qa/evidence/phase-05d2-go-gin.md) | BE-04 is Gin `v1.12.0` + Go Modules, Go >=1.25, no DB/auth; keep planned, no FS-02 scope change, promotion, or release approval |

## Open items

- OPEN-001: Complete clean-machine/runtime security review and decide system Node vs bundled Node; Phase 02.6 same-host PoC does not close this item.
- OPEN-002: Public project naming, organization, license and repo setup.
- OPEN-003: Exact first shipping recipes and release milestone scope.
- OPEN-004: Review Git for Windows Credential Manager scope, cache protections, and Forma entitlement policy; CLI accepts/stores no credentials.
- OPEN-005: Optional Docker Compose start behavior and DB readiness semantics.
- OPEN-006: Approve and validate native process containment and handle-safe staging operations before closing Windows safety blockers.
- OPEN-007: Run second-account ACL denial test when another standard account is available; decide whether lifecycle scripts require OS filesystem isolation.

Proposed decisions remain unapproved even where Phase 01 code now uses that approach. Implementation or passing tests do not substitute for decision approval. Record real authorization before changing status.
