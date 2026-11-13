# DEC-019 — Phase 02.6 Desktop Runtime and Packaging PoC

| Field | Value |
|---|---|
| Status | **Proposed — evidence only; not formally accepted** |
| Date | 2026-11-13 |
| Owner | Unassigned |
| Related | OPEN-001, PRD-007, PRD-009, PRD-011, PRD R5, NFR-005, NFR-009, NFR-010 |
| Supersedes | None |
| Approval | Pending |

## Context

The Tauri desktop needs Node to run the TypeScript CLI. Phase 1 uses system Node; packaging adds a choice between requiring it on user machines or bundling Node and npm.

## Alternatives

| Option | Benefit | Cost / risk | Reversibility |
|---|---|---|---|
| A. Require system Node/npm | Small installer; aligns app and user toolchain | User prerequisite; PATH/runtime drift; clean install can fail | High |
| B. Bundle Node + npm | CLI can run when system Node is absent; fixed engine version | About 22.89 MiB larger in this PoC; patching/provenance/update burden | Medium |
| C. Defer desktop packaging | Avoids premature runtime choice | No installable desktop PoC | High |

## PoC observation

On one Windows 11 Pro `10.0.26300` x64 development host, same-version 0.1.1 NSIS artifacts measured 2,258,037 bytes (system) and 26,259,213 bytes (bundled), a 24,001,176-byte delta. Bundled Node `22.22.1` + npm `10.9.4` ran installed packaged CLI catalog/doctor with system Node removed from `PATH`. Per-user system 0.1.0 install, bundled 0.1.1 update, app launch and uninstall passed; a separate test project remained unchanged. Details and SHA-256 hashes: [Phase 02.6 evidence](../qa/evidence/phase-02.6-desktop-runtime-packaging.md).

## Proposed direction

Keep both build variants available for internal PoC comparison. Do not select a shipping runtime from installer size or same-host smoke alone. Keep normal generation blocked for all planned recipes; debug-only override remains evidence-only.

## Limits / approval

No clean Windows 11 machine, independent security review, signed artifact, second-account ACL test, UI-driven cancellation test, or cross-version runtime acceptance was available. System executable provenance is not independently verified. Bundled runtime does not sandbox generated code or npm lifecycle scripts. OPEN-001 stays open; no recipe or release approval follows from this PoC.

Pending user/engineering review.
