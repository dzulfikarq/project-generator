# DEC-011 — Phase 1 System Node and Deferred Desktop Runtime Packaging

| Field | Value |
|---|---|
| Status | **Proposed — not formally accepted** |
| Date | 2026-11-11 |
| Owner | Unassigned |
| Related | PRD-007, PRD-009, NFR-005, OPEN-001, GEN-004 |
| Supersedes | None |
| Approval | Pending |

## Context and problem

CLI development must start before the desktop distribution strategy is finalized. TypeScript generator code needs Node.js; bundling a runtime in Tauri may simplify end-user onboarding but creates installer and security questions.

## Constraints and non-negotiable rules

Windows 11 x64 is first target. UI cannot expose arbitrary process invocation. Runtime version must satisfy pinned scaffold requirements. No false claim that a clean desktop can generate a project without existing Node before a clean-machine PoC.

## Real alternatives

| Option | Benefits | Costs/downsides | Risks | Reversibility |
|---|---|---|---|---|
| A: Require system Node for CLI Phase 1 | Simplest to test and debug; official tooling aligned | User must install Node | Toolchain drift | High |
| B: Bundle Node as Tauri sidecar immediately | Easier end-user onboarding later | Packaging, binaries and signing complexity before engine proven | Runtime/environment mismatch | Medium |
| C: Rewrite engine in Rust | Native packaging | Duplicates JS tooling integration; much larger scope | Delivery delay | Low |

## Proposed direction and rationale

Use **A for Phase 1 only**. Keep CLI process and event contracts stable so B can be evaluated before packaged desktop release. A is **not** a permanent release decision.

## Verification / evidence

Not run. Test CLI on clean Windows machine with Node/npm versions recorded. Before desktop release, compare Node sidecar vs system Node on clean-machine install, process permissions, child cancellation, package-manager interoperability and updates.

## Security and second-order effects

Never launch arbitrary PATH commands from UI; resolve trusted tools and use structured argv. Node version unsupported/missing must be blocked by Doctor, not silently installed.

## Migration / rollback

If B chosen later, retain CLI JSON/JSONL and adapter contracts; replace process bootstrapping only. Existing generated projects remain ordinary repositories.

## Approval record

Pending real user/engineering review.

## Revision history

2026-11-11: Initial proposal.
