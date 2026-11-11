# Decision Register — Project Generator V1

| Field | Value |
|---|---|
| Date | 2026-11-11 |
| State | Discovery baseline; formal implementation/release review not yet complete |
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

## Open items

- OPEN-001: Node runtime packaging strategy and Windows executable shim security.
- OPEN-002: Public project naming, organization, license and repo setup.
- OPEN-003: Exact first shipping recipes and release milestone scope.
- OPEN-004: Forma private GitHub authentication and permission policy.
- OPEN-005: Optional Docker Compose start behavior and DB readiness semantics.

No decision in this draft is evidence of an implemented feature. To approve an individual material decision, create a record using the template and document real authorization.
