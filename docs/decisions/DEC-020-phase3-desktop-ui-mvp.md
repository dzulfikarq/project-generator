# DEC-020 — Phase 03 Desktop UI MVP Scope

| Field | Value |
|---|---|
| Status | **Proposed — implementation requested; product/security approval pending** |
| Date | 2026-11-13 |
| Owner | Unassigned |
| Related | PRD-001–015, PRD-021, PRD-023, NFR-002, NFR-005–010, UX-001–012, OPEN-001 |
| Supersedes | None |
| Approval | User requested Phase 03 implementation; no release approval |

## Context

Phase 02.6 provides a minimal Tauri shell and fixed CLI bridge. Phase 03 asks for a usable desktop flow, while runtime catalog contains only FE-01/FE-02, two styling adapters, and pinned Forma metadata. Every generator recipe remains `planned`; no backend/database adapters or tested recipe exist.

## Alternatives

| Option | Benefit | Cost / risk |
|---|---|---|
| A. Build catalog-driven UI; disable absent/unsupported capabilities | Honest UI, reuses current engine, preserves release gate | Generation remains internal/debug-only until recipe promotion |
| B. Add placeholder adapters to make wizard appear complete | Broader-looking wizard | Falsifies support and violates explicit no-adapter scope |
| C. Defer desktop UI until recipes are tested | Avoids UI over planned recipes | Delays the explicitly requested local UI MVP |

## Proposed direction

Implement A. Derive framework, style, manager and Forma choices from packaged catalog/recipe metadata. Backend/database and catalog-missing frameworks appear as disabled roadmap items with reasons. Forma gallery may display pinned catalog metadata and metadata-backed palette swatches, but must distinguish Forma-declared framework compatibility from Project Generator recipe support. No private fetch occurs during browsing or planning.

Keep FE-01/FE-02/FM-01/FM-02 `planned`. Normal/release builds may inspect plans but cannot generate planned recipes. Debug-only override requires explicit opt-in and lifecycle-script consent. Do not modify core adapters, recipe status, supervisor, or recovery semantics.

Persist only settings and generated-project metadata (name, path, recipe, status, timestamp) in local app storage. Do not persist event logs, credentials, or project contents. Open Folder/VS Code must use fixed typed native actions; no generic shell command.

## Limits / approval

The UI is a local-development MVP, not release approval. Clean-machine runtime proof, independent security review, UI-driven generation/cancellation, full accessibility/scaling, and recipe acceptance remain separate evidence gates. Job Objects supervise process lifetime; they do not sandbox lifecycle scripts.

## Implementation evidence

The requested local UI MVP is implemented within Option A. Current scope and verification limits are recorded in [Phase 03 evidence](../qa/evidence/phase-03-desktop-ui-mvp.md). Native read-only catalog/runtime/plan/doctor smoke passed; UI cancellation and failure transitions were exercised only with a mocked Tauri bridge. No generator job ran. This record remains **Proposed** pending product/security review; implementation and local checks do not authorize recipe promotion or public release.
