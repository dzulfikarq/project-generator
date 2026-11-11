# AGENTS — Project Generator Desktop

> **Phase 01 CLI implementation.** FE-01 and FE-02 remain planned, unverified recipes; no release is approved.

Before any meaningful design, engineering or testing task, read:

1. [`README.md`](README.md) — product boundary and current status.
2. [`docs/PRD.md`](docs/PRD.md) — requirements and non-goals.
3. [`docs/adapters/compatibility-matrix.md`](docs/adapters/compatibility-matrix.md) — per-recipe scope; none tested yet.
4. [`docs/adapters/adapter-contract.md`](docs/adapters/adapter-contract.md) — security, execution and cancellation rules.
5. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — architecture proposals and security boundaries.
6. [`design.md`](design.md) — future desktop UX specification.
7. [`docs/decisions/index.md`](docs/decisions/index.md) — material decisions and approval status.
8. [`docs/qa/acceptance-matrix.md`](docs/qa/acceptance-matrix.md) — verification evidence.
9. [`agent.md`](agent.md) — operating rules for AI coding/design/QA agents.

**Do not implement the generator from these planning docs unless the user explicitly requests implementation.** Do not conflate a proposed recipe, an upstream framework feature, or prior Forma external test with working Project Generator support.

Use an official/maintained scaffold where suitable, keep npm as the Node-default, preserve native package managers for Go/PHP/Python, prevent dangerous filesystem changes and unapproved execution, and never claim test/release readiness without independent evidence. Documentation must reflect actual code, observed behavior and approval status.
