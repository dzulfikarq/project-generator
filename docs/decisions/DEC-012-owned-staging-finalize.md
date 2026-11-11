# DEC-012 — Owned Same-Volume Staging with No-Replace Finalize

| Field | Value |
|---|---|
| Status | **Proposed — not formally accepted** |
| Date | 2026-11-11 |
| Owner | Unassigned |
| Related | PRD-002, PRD-010, NFR-001, NFR-002, NFR-009, GEN-002, GEN-006, GEN-018 |
| Supersedes | None |
| Approval | Pending |

## Context and problem

Official scaffold/install processes can fail or be cancelled after creating many files. Direct creation in the user's chosen final directory risks leaving broken output and can collide with preexisting data.

## Constraints and non-negotiable rules

Never overwrite an existing target. Cleanup touches only verifiably owned staged paths, not arbitrary user-selected directories. Reparse points/junctions and destination races must be tested on real Windows.

## Real alternatives

| Option | Benefits | Costs/downsides | Risks | Reversibility |
|---|---|---|---|---|
| A: Generate directly in destination | Simple | Broken partial user projects | Overwrite/race and cleanup hazards | Low |
| B: Owned staging under chosen parent + safe rename | Isolates failures; consistent volumes | Complex ownership/cleanup tests | Junction/rename race if implemented incorrectly | High |
| C: System temp staging then copy | Easy temp location | Cross-volume copy/partial destination | Inconsistent atomicity, cleanup risks | Medium |

## Proposed direction and rationale

Use B. Stage at `<parent>/.project-generator-stage-<uuid>/<project-name>`, with ownership marker and in-memory identity. Finalize only via platform-native *fail if destination exists* semantics after required validation. A directory appearing between plan and finalize must cause a safe failure without overwrite.

## Verification / evidence

Partial Windows evidence: unit tests cover forged ownership markers, static junction rejection, case-insensitive collisions, target-creation race/no-replace behavior, and successful staged move; FE-01/FE-02 E2E runs finalized new outputs from owned staging. The E2E parent path included spaces and `雪`. Path-based validation/cleanup still has a junction/symlink swap TOCTOU window; static rejection does not cover swaps. See [DEC-015](DEC-015-windows-native-safety-boundary.md), [QA matrix](../qa/acceptance-matrix.md), and per-recipe reports. Locked-file behavior, swap stress, crash/power-loss recovery, and independent security review remain unverified.

## Security and second-order effects

Never trust a user-editable marker alone for recursive deletion. Recheck canonical paths, ownership, target absence, and source location before filesystem operations.

## Migration / rollback

If native no-replace commit cannot be proven safe, block finalization and reevaluate OS-specific mechanism; do not fall back to unsafe overwrite/copy.

## Approval record

Pending real review.

## Revision history

2026-11-11: Initial proposal.
