# Phase 03 Desktop UI MVP — Verification Evidence

| Field | Value |
|---|---|
| Status | **PARTIAL — internal implementation checks; no recipe or release approval** |
| Date | 2026-11-13 |
| Host | Windows 11 Pro `10.0.26300` |
| Tooling | Node.js `22.22.1`; npm `10.9.4`; Rust/Cargo `1.99.1`; Edge `157.0.4341.46`; Tauri `2.12.4` |
| Related | [DEC-020](../../decisions/DEC-020-phase3-desktop-ui-mvp.md), [acceptance matrix](../acceptance-matrix.md) |

## Implemented scope

Dashboard; catalog-backed project wizard; disabled unsupported choices; Forma metadata gallery; plan/doctor review; unchecked lifecycle consent; JSONL job, cancellation, and result surfaces; bounded local settings/history; fixed typed Folder and VS Code actions. No adapter or recipe status changed. Destination path remains user-entered; no native folder picker or live template preview exists.

## Checks run

### Native Tauri read-only smoke

Ran local debug app with system runtime. Actual WebView-to-Rust-to-CLI commands `get_catalog`, `get_runtime_status`, `resolve_plan`, and `run_environment_doctor` succeeded. Catalog exposed FE-01/FE-02 as `planned` and three pinned Forma metadata entries. Node/npm and absent destination passed Doctor. Lifecycle consent remained unchecked; Generate remained disabled. A unique destination under `E:\MyProjects` was absent both before and after the smoke. No generation, package install, network fetch, or native folder/editor action ran.

Initial native plan call exposed a real path interoperability bug: Tauri returned a Windows verbatim resource path (`\\?\E:\...`), which Node resolved as drive root `E:` and exited without JSON. The bridge now strips the verbatim prefix for the CLI entry point and working directory, preserving UNC form. A Rust unit test covers drive and UNC normalization; the native read-only smoke passed after the fix.

### Browser mock smoke

Ten assertions passed against a local Vite browser session. It used the built CLI catalog, but mocked Tauri runtime, plan, doctor, generation, and cancellation responses. Covered dashboard/gallery, invalid-name gate, Next.js/Tailwind compatibility, docs preview, default consent and planned-recipe gates, mocked cancel/failure results, abandoned navigation, local theme/path persistence, accessible names/labels, reduced motion, and no horizontal overflow at 760px. This validates UI transitions only; it is **not** native generation evidence. Temporary smoke harness was kept outside the repository.

### Automated checks

| Command | Result |
|---|---|
| `npm test` | Exit 0 — core 38 passed / 1 expected elevated-only skip; CLI 8 passed; desktop model 8 passed |
| `npm run typecheck` | Exit 0 |
| `npm run lint` | Exit 0 |
| `npm run build --workspace @project-generator/desktop` | Exit 0 |
| `cargo test --locked` | Exit 0 — 7 Rust tests passed |
| `cargo clippy --locked -- -D warnings` | Exit 0 |
| `cargo fmt --check` | Exit 0 |

## Screenshots

[`phase-03-desktop-ui/`](phase-03-desktop-ui/) contains six browser-mock captures and two actual Tauri WebView captures: dashboard and read-only plan/doctor review. Dark-mode capture reflects the corrected dark page background.

## Not verified / still blocked

- Desktop-driven CLI generation, real UI cancellation/failure, and FE-01/FE-02/FM-01/FM-02 generation.
- Lifecycle scripts execute without a sandbox; no authorization to run them was provided for this UI smoke.
- Explorer/VS Code open actions against a generated project.
- Full keyboard, screen-reader, contrast, and Windows 125–200% scaling review.
- Clean-machine install, independent security/product review, recipe promotion, and public release.

All recipes remain `planned`; public release remains **NO-GO**.
