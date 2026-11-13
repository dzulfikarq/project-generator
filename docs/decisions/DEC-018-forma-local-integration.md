# DEC-018 — Forma Local CLI Integration

| Field | Value |
|---|---|
| Status | **Proposed; local-development implementation exists, release approval pending** |
| Date | 2026-11-13 |
| Owner | Unassigned |
| Related | PRD-021, NFR-003–005, NFR-011, GEN-014, GEN-019, DEC-004, DEC-016, DEC-017 |
| Approval | No architecture, recipe-promotion, or release approval recorded |

## Context

Forma is maintained in private repository `dzulfikarq/design-templates`. Project Generator must use its existing portable exporter and installer without editing or copying their implementation. Phase 02 adds CLI-only selection for pinned FM-01 (React + Vite + Forma) and FM-02 (Next.js App Router + Forma). Both are distinct from standalone FE-01/FE-02 and remain planned.

The source pin is `5cf3c4e5b7b0bc454a653f58d12237c56f2548e2`. The reviewed catalog contains Staywise Host Dashboard and Modern Admin for both frameworks, plus Focus Planner for React + Vite. Forma manifests carry SHA-256 integrity, not signed publisher attestation.

## Decision proposal

- Keep Forma separate; fetch only the allowlisted private Git repository at the pinned full commit, only during explicit generation and only on cache miss.
- Use Git for Windows' Credential Manager; accept no CLI/config token and store no app-owned credential. Suppress private repository paths and credentials in plans, logs, generated user docs, and Project Generator's `.project-generator/manifest.json`.
- Keep a local cache under `%LOCALAPPDATA%`, keyed by commit/template/version/content hash. Verify source commit, bundle metadata and SHA-256; install only through Forma's existing exporter/installer.
- Run installation inside owned staging and preserve Project Generator cancellation, no-replace finalization, and journal recovery. Do not clean or overwrite ambiguous cache state automatically; interrupted fetch/export may leave partial directories.
- Expose only cataloged, independently upstream-tested template/framework pairs. Keep every FM recipe `planned`; normal generation blocks them. The development-only override is evidence gathering, not promotion.

## Alternatives

| Option | Benefits | Costs / risks | Disposition |
|---|---|---|---|
| A. Reimplement Forma export/install in Project Generator | Tighter local code ownership | Duplicates security-critical path, dependency and integrity logic; drifts from Forma | Reject |
| B. Invoke Forma's existing exporter/installer from an immutable checkout | Small integration; preserves Forma contract; no Forma changes | Runs pinned upstream scripts; requires Git, private access and lifecycle disclosure | **Proposed** |
| C. Accept a user-supplied repository, branch, URL, or token | Flexible | Expands trust boundary, injection/credential risk and support matrix | Reject |
| D. Add app-managed token storage or a new auth flow | UX may be more explicit | New credential lifecycle, UI and Windows secure-store scope | Defer; use Git Credential Manager for local CLI |

## Consequences and limits

- `plan` remains read-only and shows host/network, template, pin, writes, and lifecycle-script warning; it does not inspect credentials or fetch.
- Catalog snapshots and cache hashes are integrity/provenance checks, not proof of publisher identity. Same-account malicious code is not isolated; npm lifecycle scripts remain unsandboxed.
- A partial cache directory may remain after interruption; Project Generator does not delete it without separately reviewed ownership-safe cleanup.
- Existing exports/install reports are rewritten only inside owned staging to name the npm manager and remove transient staging paths. The Forma repository itself remains untouched.
- Local E2E and browser smoke evidence proves only the listed Windows development runs. FM-01/FM-02 remain blocked in normal generation.
- Process-crash journal recovery is retained; no power-loss durability claim. Second-account ACL denial remains a release gate.

## Required follow-up

Review credential scope, cache tampering, cancellation/recovery and Windows path behavior independently. Add corruption/fault-injection and cross-account ACL evidence before any recipe promotion or release. See [Phase 02 local evidence](../qa/evidence/phase-02-forma-local-integration.md).
