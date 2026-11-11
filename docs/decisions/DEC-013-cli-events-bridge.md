# DEC-013 — Typed CLI Commands and Versioned JSONL Job Events

| Field | Value |
|---|---|
| Status | **Proposed — not formally accepted** |
| Date | 2026-11-11 |
| Owner | Unassigned |
| Related | PRD-008, PRD-011, PRD-019, NFR-005, NFR-006, UX-003 |
| Supersedes | None |
| Approval | Pending |

## Context and problem

CLI and future Tauri desktop need one reliable job state machine and progress model without exposing a generic shell execution primitive to the frontend.

## Constraints and non-negotiable rules

Typed intents, schema validation on the privileged side, no secret-bearing JSON logs, monotonic job event sequences, terminal states and interrupt-safe cancellation.

## Real alternatives

| Option | Benefits | Costs/downsides | Risks | Reversibility |
|---|---|---|---|---|
| A: Parse stdout text heuristically | Small initial code | Fragile; not accessible/testable | Ambiguous statuses | High |
| B: JSON/JSONL versioned CLI events + typed host bridge | Testable, reusable, explicit | Requires schema/version discipline | Cross-version compatibility | High |
| C: Desktop owns all generation logic | Fewer adapters initially | Tightly coupled UI/backend | Hard to test or reuse | Low |

## Proposed direction and rationale

Use B. CLI offers read-only `catalog/plan/doctor` and explicit `generate` with `job-started`, stage progress and terminal event. Later Tauri bridge accepts typed actions only (`resolvePlan`, `startJob`, `cancelJob`, etc.).

## Verification / evidence

Not run. Verify schema consumer tests, invalid/stale events, ordered sequences, disconnect/reconnect behavior and log redaction.

## Security and second-order effects

Never permit UI to specify arbitrary executable, args or workspace path for a shell bridge. Privileged layer revalidates every action.

## Migration / rollback

Schema version and backward-compatible event envelope permit desktop evolution; breaking changes require explicit adapter/IPC migration decision.

## Approval record

Pending real review.

## Revision history

2026-11-11: Initial proposal.
