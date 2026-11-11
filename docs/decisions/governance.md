# Material Decision Governance — Project Generator

| Field | Value |
|---|---|
| Status | Proposed operating rules |
| Purpose | Maintain traceability across product, design, security, engineering and QA |
| Registry | `docs/decisions/index.md` |
| Record naming | `docs/decisions/DEC-NNN-short-slug.md` |

## 1. Authority and source of truth

1. Current legitimate user instruction and higher-priority security requirements.
2. Current approved PRD for scope, constraints and acceptance.
3. Current accepted decision records for irreversible or material choices.
4. Design specs and adapter/architecture contracts for behavior.
5. Observed code and executable test evidence for any claim that a feature works.

Documents describing a future feature are not authorization to implement it automatically. An AI coding agent may draft alternatives but must not invent acceptance, sign-offs or completed tests.

## 2. Record thresholds

Create a material decision record for: project type/scope changes, framework support/release policy, bundled vs system toolchain, exec permissions, plugin trust, credential access, Forma boundary, template provenance, data deletion, auto-install scripts, DB provisioning, privacy, release blockers and major architectural changes. Do not generate decision files for purely cosmetic edits, minor refactors and typo fixes.

## 3. Decision lifecycle

- `Proposed`: recommendation exists; unresolved.
- `In Review`: stakeholders evaluating evidence.
- `Accepted Discovery`: user selected product direction; still requires technical validation and appropriate release review.
- `Accepted`: authorized approval recorded, with evidence/conditions.
- `Rejected`: alternative declined, reason retained.
- `Superseded`: newer record explicitly replaces it; historical file remains.
- `Withdrawn`: proposal closed without implementation.

## 4. Required decision fields

Each record must contain stable ID and title, context, impacted PRD/NFR IDs, alternatives (at least two genuine choices), constraints, costs/risks, selected proposal, conditions for success, reversibility/rollback, security effects, evidence references, record owner, status, and actual approval detail (if any). No fabricated signatures or dates.

## 5. Workflow for coding agents

1. Read `README.md`, relevant PRD IDs, compatibility matrix and adapter contract.
2. Inspect git branch, working tree, in-progress work and file ownership before edits.
3. Identify task boundaries and risk category (docs/design/code/test/release).
4. Read applicable accepted decisions; if conflicting, report conflict before irreversible steps.
5. Draft a new decision when a material choice is necessary.
6. Implement only the approved scope, with tests and migration/rollback where necessary.
7. Report what was verified, what was skipped, what changed, and what remains blocked.
8. Update decision register and QA evidence without reclassifying unrun tests as passes.

## 6. Generated-project documentation

Full documentation mode produces **initial templates based on chosen stack**, not fictional project development history. A generated `DEC-001` may state “user selected PostgreSQL”, but must not claim security/QA sign-off or retrospectively narrate conversations that did not occur.
