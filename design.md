# Design Specification — Project Generator Desktop

| Field | Value |
|---|---|
| Version | V1 UX draft 0.2 |
| Date | 2026-11-13 |
| Status | **UX proposal; Phase 03 internal UI MVP implemented; accessibility, scaling, and overall native generation acceptance remain partial** |
| Target | Windows 11 desktop, keyboard/mouse first, Windows scaling aware |
| References | [`docs/PRD.md`](docs/PRD.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/qa/acceptance-matrix.md`](docs/qa/acceptance-matrix.md) |

## 1. Design intent

**A professional developer tool, not a large form.** Developers should confidently choose a stack, see compatibility before running, understand what the generator will do, and get a reproducible project or a clear failure. Forge Studio uses charcoal `#2B2D31`, off-white `#F7F5EF`, yellow `#FFC93C`, and silver `#D9DADC` through semantic CSS tokens; Geist Sans for UI and Geist Mono for technical text; system/light/dark themes. Prioritize workflow transparency, not ornamental effects.

### UX principles

1. **Progressive disclosure:** pick project type before showing irrelevant frameworks, databases and tools.
2. **Guide without locking:** offer *Recommended* presets; preserve intentional manual choice.
3. **Prevent bad combinations:** incompatible selections are disabled with a specific reason and an alternative (not silently replaced).
4. **Review before execution:** list commands and expected writes/downloads before Generate.
5. **No fake readiness:** completion distinguishes generated project, installed dependencies and passing checks.
6. **Error recovery:** failure screen explains stage, affected files, job ID, suggested next action; preserve redacted log.
7. **Keyboard-first navigation:** accessible wizard, standard tab/focus behavior, no custom canvas control requirement.
8. **Offline clarity:** badge or hint indicates when dependencies are cached versus network required.

## 2. Information architecture

```text
Application
├── Home / Recent Projects
├── New Project
│   ├── Project Details
│   ├── Project Type
│   ├── Technology Stack
│   ├── Styling & UI
│   ├── Developer Tools & Docs
│   ├── Review & Doctor
│   ├── Generating (dedicated job surface)
│   └── Result (success / partial / failed / cancelled)
├── Templates (Forma, optional P1)
├── Projects (local history, optional P1)
└── Settings
    ├── General & paths
    ├── Appearance
    ├── Environment Doctor
    ├── Optional Forma connection (P1)
    └── Privacy & Logs
```

Phase 03 implements dashboard, catalog-driven project wizard, pinned Forma metadata gallery, read-only plan/doctor review, lifecycle consent, JSONL generation/cancellation/result surfaces, local generated-project metadata, theme/default-location settings, and fixed Folder/VS Code native actions. Phase 05A/05B add planned standalone Express/TypeScript/npm and Go `net/http`/Go Modules backend choices. Phase 05C.1 adds planned standalone FastAPI/Pydantic/Uvicorn + uv, Python/uv Doctor checks, and explicit dependency-build consent. BE-02 includes reviewed module-path validation; BE-06 uses Python 3.14.x and has no database/ORM/auth/fullstack. Phase 05C.2 passed bounded local CLI and native Tauri generation evidence with isolated Python 3.14.10/uv 0.13.8; independent acceptance remains open, so implementation and local evidence do not promote BE-06. Other backend/database/fullstack adapters remain absent, and FE/BE/FM recipes remain planned. Browser/UI and native acceptance evidence is tracked separately.

## 3. Layout and visual foundation

- Sidebar: 216–240 logical px; brand at top; navigation grouped into Workspace, Create, Catalog, Tools, and Preferences; runtime status and internal-use notice at bottom. Collapse to icon rail below 900px and horizontal navigation below 470px.
- Content: max width around 1080–1160 logical px, responsive to screen; wizard body around 720–860 px with optional preview panel on sufficiently wide windows.
- Top bar: page name, system health, light/dark toggle, optionally current project context.
- Window: adaptive down to a tested minimum; no horizontal overflow at 125%, 150% and 200% Windows display scaling. Verify, do not assume.
- Typography: locally bundled Geist Sans for UI and Geist Mono for commands/logs/paths; centralized sizes, line heights, and weights; body 14px and secondary text at least 12px. Do not rely on a tiny technical UI.
- Surface hierarchy: charcoal/off-white/silver surfaces, yellow accent, semantic status colors, visible selection and focus; warning/success/error cannot depend on color alone. Centralize colors in semantic tokens.
- Spacing: 4/8/12/16/24px grid; forms and cards share radius/height standards; clear screen titles and concise help text.
- Components: buttons, select/combobox, searchable technology cards, radios, checkboxes, input path picker, code/log panel, toast, confirm dialog, stepper, status chips, skeleton, empty states.
- Theme: light/dark/system preference. Honor reduced-motion system setting, and do not animate long operations merely to fill time.

### Responsive behavior

At narrow widths, sidebar collapses; selection cards stack; Review commands and step list become vertical; optional right-side preview relocates below wizard fields. All controls remain keyboard reachable. Standard desktop experience first; no requirement for a mobile-device app UI in V1.

## 4. User journeys

### FLOW-001 — Generate from a recommended preset

Home → New Project → type Frontend → name/location → choose React+Vite *Recommended* → npm preselected → CSS default → docs Standard → Review → Doctor → Generate → Show progress → Result. After the job: optional Open Folder, Open VS Code (only if installed), Copy Run Command. No GitHub push.

### FLOW-002 — Manual stack and incompatibility

Choose Fullstack → Vue → Laravel → MySQL → Bootstrap. Each relevant step shows supported combinations from recipe manifest. If no tested recipe exists, **Generate disabled** and an explanation plus tested alternative is offered. Editing a previously selected field must revalidate dependent choices; incompatible previous selections are highlighted for explicit user correction, never silently replaced.

### FLOW-003 — Environment missing

Choose a recipe requiring Node/npm; Doctor reports Node missing or unsupported version, explains version requirement and shows Copy Install Instructions / Recheck Environment. User may return to selection; generating remains blocked. No silent Node download.

### FLOW-004 — Failure/cancellation

Generation running → Cancel → explicit confirmation explaining owned temporary work removal → stop owned process tree → safe cleanup → Cancelled result with job ID and cleanup status. For a failed install/compile: show failed stage, exit code, redacted logs, what was and was not written, and retry-from-start. Never show a successful Ready screen for partial generation.

### FLOW-005 — Optional Forma template (P1)

Future desktop flow: choose compatible React/Next recipe → authenticated catalog (no private URLs/tokens in UI/logs) → template/version/theme → Review with Forma install/network steps → Generate with existing exporter/installer → validation. Current CLI accepts a pinned `config.template`, fetches through configured Git Credential Manager only during explicit generation, and blocks unverified combinations. No token-entry or template-gallery UI exists.

## 5. Screen specifications

All screen IDs are design references that QA can map to test IDs. These are not implementation claims.

### UX-S01 — Home

- Main CTA **Create Project**; compact Recent Projects if history feature exists; Popular Presets sourced from tested recipes only.
- Environment status: Ready / Attention needed / Not checked, with actual preflight timestamp.
- Empty state for first run: single CTA, description of local project creation; don't show nonexistent sample projects.
- If no adapters tested: show explanation and development-mode entry, not fictional templates.

### UX-S02 — Project Details

- Fields: project name (required), description optional, parent directory picker, resolved full destination read-only preview.
- Validate Windows filename and npm package name separately; show resulting valid name or explicit error. Never silently rename project.
- Detect existing path, reserved names, prohibited roots and junction risk. Inline error blocks Continue.
- Path preview must preserve drive letter, Unicode and spaces. Warn if target volume accessibility changes between steps.

### UX-S03 — Project Type

- Cards: Frontend, Backend, Fullstack; Mobile (future/disabled until V1.1).
- Each card has short description, examples, and availability status.
- Choosing type narrows framework and recipe lists. No duplicate backend fields for Next/Nuxt without a separate API service.

### UX-S04 — Technology Stack

- Stack cards filtered by type, with searchable list and 3 states: tested & selectable, experimental opt-in, disabled (reason).
- First choose framework(s), then data layer where relevant, then package manager(s).
- JS default npm; display Composer, Go Modules, uv as fixed ecosystem managers, not as replacement JS choices.
- Inspector shows compatible recipes and plain-language explanation of choices. Unsupported combos are not 'soft warnings'.
- Manual selections must have a stable, explicit recipe ID when ready to generate.

### UX-S05 — Styling and UI Components

- Styling single-select: Recommended, Plain CSS, CSS Modules/scoped styles if supported, Tailwind CSS, Bootstrap, Sass/SCSS.
- Component library separate select: None / verified framework-specific libraries (e.g. React shadcn/ui, Angular Material).
- Display info: Bootstrap JS interactions may need framework-aware integration; do not imply SCSS is component library.
- Mobile targets must not offer web-only Bootstrap/CSS Modules options.
- Forma gallery appears only for supported recipes and authenticated provider in P1; template detail includes compatibility, version and permission needs.

### UX-S06 — Developer Tools and Documentation

- Language TypeScript default where supported; JavaScript where compatible; lint/format choice from recipe.
- Git init opt-in and no auto push; optional Compose opt-in (requires explicit consent to start, separately).
- Docs mode radio: Minimal / Standard (default) / Full with expandable list of generated documents. Explain that generated history is not a real project development history.
- Hide impossible settings rather than showing nonfunctional toggles.

### UX-S07 — Review and Environment Doctor

- Summary: project name/path, type, exact frameworks, managers, selected styling/UI, template ID/version (if present), docs mode, warnings and status.
- Preflight: Required prerequisites vs Optional; versions, disk check, connectivity requirement, whether missing items block Generate.
- Plan: ordered steps with code block for **sanitized command previews**, expected destination creation, install hook/third-party code warning, network and estimated work only if evidence-backed. Never show user secrets.
- Mandatory explicit **Generate Project** button; disable with reason while blocked. Plan fingerprint invalidated if selection changes.
- Confirm dangerous optional actions separately (Docker start, if later supported). No blanket unbounded consent.

### UX-S08 — Generation Progress

- Stable headline `Generating <project>` and current stage. Stepper: Preparing → Scaffolding → Configuring → Installing → Validating → Finalizing.
- Each step `pending/running/passed/failed/skipped`; command logs in expandable terminal-like panel with timestamp and severity. Avoid misleading percentage if time unknown; use indeterminate progress.
- Cancel button available until safe final commit boundary, with clear behavior; on cancel, acknowledge process termination and cleanup status rather than instantly claiming cancellation.
- Prevent accidental duplicate Generate clicks; on close, explain job policy (V1 prefer cancelling safely after confirmation).
- Error details: code, failed stage, sanitized command, exit code, redacted log and Copy Error Report (no absolute private token URLs).

### UX-S09 — Result

Result statuses:

| Result | Meaning | Actions |
|---|---|---|
| Ready | Required generation checks passed and target committed | Open Folder, Open in VS Code (if installed), Copy Run Command |
| Generated / checks skipped | Output committed only if recipe policy explicitly allows optional checks; **not Ready** | Open Folder, Show Missing Checks |
| Failed | Generation / required validation failed; target not committed in Phase 1 | View Logs, Fix Prerequisite, Retry from Start |
| Cancelled | User cancelled; owned staging cleanup attempted | View Report, New Project |
| Cleanup issue | Cleanup could not complete; existing user folder untouched | Copy Safe Cleanup Instructions, View Owned Staging Path |

If backend requires an external DB which was not contacted, result cannot say **Database Ready** even if source generation succeeded.

### UX-S10 — Settings / Environment

- General: default destination parent and appearance.
- Doctor: toolchain versions, detection timestamp, per-manager status, manual recheck.
- Privacy: log retention, redaction explanation, telemetry off by default.
- Forma P1: connect private registry via secure credential flow, disconnect; never display bearer token in full.
- Runtime/packaging diagnostics: distinguish system Node vs bundled sidecar, once selected and verified.

### UX-S11 — Templates (P1)

- Catalog list with thumbnails if manifest explicitly supplies safe visual assets; otherwise a semantic neutral preview, no fabricated screenshots.
- Filters by compatible framework, version, style; unsupported entries informational only.
- Show source/version pin and privacy boundary for private registry. Never automatically fetch private template just from highlighting its card.

### UX-S12 — Project History (P1)

- Local metadata only: name, path, recipe, created timestamp, last observed availability, and last job status.
- 'Open Folder' is not 'Run Project'. Missing directories shown as missing; no automatic deletion from file system.
- No indexing code or opening all repositories without user action.

## 6. State model and validation behavior

| UI state | Trigger | User sees | Primary action |
|---|---|---|---|
| `idle` | First open | Presets + CTA | Create Project |
| `editing` | Wizard change | Current options / dependency warnings | Continue |
| `unavailable_recipe` | Unsupported combination | Reason and suggested tested recipe | Change Selection |
| `doctor_running` | Explicit preflight | Versions/checks, spinner | Wait / Cancel doctor if supported |
| `doctor_blocked` | Required tool/path unavailable | Exact missing requirement | Recheck |
| `review_ready` | Valid plan and preflight | Exact read-only step plan | Generate Project |
| `generating` | Job started | Live step/log state | Cancel |
| `cancelling` | Cancel requested | Termination/cleanup in progress | No second cancel spam |
| `ready` | All required checks pass and final commit succeeds | Verified check outcomes | Open Folder |
| `failed` | Process/check fails | Error code + next step | Retry from start |
| `cancelled` | Owned job halted | Cleanup outcome | New Project |

Cross-screen constraints: state survives wizard navigation without triggering generation; changing selections invalidates old compatibility and plan; progress must be associated with exact job ID; a stale event from another job cannot overwrite current status.

## 7. Interaction details and accessibility

- Use native HTML form semantics in React, real labels, accessible name/description, correct `aria-invalid` and error association; no fake clickable divs for options.
- Keyboard: tab/shift+tab; arrows for radio groups; Enter to activate; Escape closes dialogs; focus trap in modal; focus restoration after close.
- On step navigation, move focus to screen heading (not reset to app sidebar), announce step position and errors.
- Progress events use a polite ARIA live region with throttled summaries; don't announce every log line.
- Color is supplemental; states also include icon and text. Contrast target WCAG AA and visible focus ring.
- Respect OS high-contrast and reduced-motion; do not truncate command error messages without copy/expand option.
- Confirm Cancel with clear scope and distinguish Cancel job from Delete project. No deletion controls on existing output in V1.

## 8. Wireframe sketches (conceptual)

### Wizard desktop

```text
+----------------------+---------------------------------------------------+
| PROJECT GENERATOR    | New Project                        Doctor: Ready    |
| Home                 |---------------------------------------------------|
| New Project *        |  Step 3/6 — Technology Stack                     |
| Projects (P1)        |  [Project] [Type] [Stack*] [Style] [Tools] [Review]|
| Templates (P1)       |                                                   |
| Settings             |  Frontend                                         |
|                      |  [React + Vite] [Next.js] [Vue + Vite] [Angular]  |
|                      |                                                   |
|                      |  Package manager: [npm v]  Default               |
|                      |  Database: [None v]                              |
|                      |                                                   |
|                      |  Recipe FE-01 / Planned until validated          |
|                      |                                                   |
|                      |  [Back]                            [Continue]    |
+----------------------+---------------------------------------------------+
```

### Review & progress

```text
REVIEW                                           GENERATING
Output     E:\Projects\my-app                   Preparing             PASS
Recipe     FE-01 / React + Vite                  Scaffolding           RUNNING
Manager    npm                                  Configuring           PENDING
Style      CSS                                  Installing           PENDING
Docs       Standard                             Validating           PENDING
Checks     Node version, path, disk             Finalizing           PENDING

Expected steps:                                 [Show logs]
  1. Create owned temp staging                   > create-vite ...
  2. Run pinned official scaffold                [Cancel job]
  3. Install packages
  4. Validate and commit
[Back] [Generate Project]
```

These examples are sketches, **not screenshots** and not a promise that the planned recipe is currently selectable. During initial Phase 1, only CLI exists.

## 9. Acceptance and revision protocol

Every UX-S reference maps to `UX-001`–`UX-005` in `docs/qa/acceptance-matrix.md`, plus additional UX tests to be created before desktop implementation. No screen may be claimed complete without keyboard accessibility, loading/empty/error state, real data binding and narrow Windows viewport testing. Product, Design and QA approval remain pending. Record material navigation/permission changes in a decision record.

## 10. Future UX, explicitly out of Phase 1

- Drag-drop visual project architecture graph.
- AI-generated architecture or application features.
- Third-party executable adapter marketplace.
- Repository hosting/deployment wizard.
- Auto-upgrade projects created previously.
- Background daemon / cloud synchronization.
- Full mobile IDE and iOS native build on Windows.
