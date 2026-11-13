# FormaForge — Project Generator Desktop

| Field | Value |
|---|---|
| Status | **Phase 01 CLI + Phase 02 Forma + Phase 02.6 packaging PoC + Phase 03 internal UI MVP + Phase 03.5 UX polish + Phase 04A Vue/Bootstrap implementation and local Windows evidence present** — full desktop acceptance remains partial; FE-01–FE-05/FM-01/FM-02 remain planned; no release approved |
| Version | 0.1.0 |
| Date | 2026-11-13 |
| Product | Universal Project Generator Desktop |
| Target OS | Windows 11 first |
| Documentation inspiration | EvoPilot (PRD ↔ design ↔ decision register ↔ QA evidence) |
| Scope | CLI kernel, internal Tauri desktop UI/runtime PoC, planned React/Vite, Next.js, Vue/Vite and Bootstrap CSS recipes, optional React/Next Forma templates |

Planning documents remain source for requirements and boundaries. Code and observed test evidence define implemented behavior. Phase 03 includes the FormaForge Forge Studio dashboard, catalog-driven wizard, metadata-only Forma gallery, review/Doctor, consent-gated job UI, results, local metadata history/settings, and fixed native open actions. Phase 03.5 fixes invalid typography declarations and a clipped dashboard empty-state action; native Windows UI runs completed FE-01/FE-02 generation, collision/error/retry, cancellation, history, and open actions using explicit internal consent. Phase 04A adds FE-03 Vue/Vite/CSS, FE-04 React/Vite/Bootstrap CSS, and FE-05 Vue/Vite/Bootstrap CSS through pinned official packages; local CLI generation passed listed checks. Bootstrap JS/Popper and Vue/Forma are excluded. Full desktop acceptance remains partial. FE-01–FE-05 and separate Forma combinations FM-01/FM-02 remain `planned` pending independent recipe acceptance and review. Desktop install/update/uninstall and both runtime package modes have same-host Windows 11 PoC evidence; no clean-machine proof or release approval exists. See [Phase 03.5 desktop acceptance](docs/qa/evidence/phase-03.5-final-desktop-acceptance.md), [Forge Studio verification](docs/qa/evidence/forge-studio-redesign.md), and [Phase 04A evidence](docs/qa/evidence/phase-04a-vue-bootstrap-expansion.md).

## Vision

Create real, ready-to-develop projects with a guided wizard, official framework scaffolding, optional Forma templates, framework-aware styling and database integration, and truthful generated documentation. Use a secure, deterministic, testable CLI engine behind a Tauri desktop shell.

## Developer setup

Requirements: Windows 11 x64, Node.js `>=22.13.0`, npm `>=10`, and Rust stable with the MSVC linker/Windows SDK. Run build and generation from a **non-elevated** terminal. Generation fails closed if the native supervisor is missing or caller token is elevated. Desktop packaging remains an internal PoC; clean-machine and release acceptance remain open.

```powershell
npm install
npm run build
npm test
npm run lint
```

Run the CLI from source with `node packages/cli/dist/src/index.js`. Example configs live in `examples/`.

## Read in this order

1. [`docs/PRD.md`](docs/PRD.md) — product requirements, priorities, UX flows, boundaries, release gates.
2. [`docs/adapters/compatibility-matrix.md`](docs/adapters/compatibility-matrix.md) — target frameworks, validated configurations, gating rules.
3. [`docs/adapters/adapter-contract.md`](docs/adapters/adapter-contract.md) — extensible adapters, plan/execution protocol, errors and rollback.
4. [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — components, process boundaries, staging and failure model.
5. [`design.md`](design.md) — desktop wizard, UX states, accessible interaction design.
6. [`docs/implementation/PHASE-01-AGENT-PROMPT.md`](docs/implementation/PHASE-01-AGENT-PROMPT.md) — scoped handoff for CLI-only first slice.
7. [`docs/decisions/index.md`](docs/decisions/index.md) — accepted discovery direction vs proposals and open questions.
8. [`docs/qa/acceptance-matrix.md`](docs/qa/acceptance-matrix.md) — traceability and evidence required to claim support.
9. [`docs/ROADMAP.md`](docs/ROADMAP.md) — phased delivery and checkpoints.
10. [`AGENTS.md`](AGENTS.md), [`agent.md`](agent.md), [`decision.md`](decision.md) — EvoPilot-inspired agent entry points and decision rules.

## Important distinctions

- **Cataloged** means shown as a future technology choice; it does not mean users can generate it.
- **Planned** means a target; do not imply it works.
- **Experimental** requires opt-in and explicitly documented incomplete tests.
- **Tested** is earned by independent generation, install, checks and smoke tests on target Windows machines.
- Forma's prior external tests alone do **not** establish Project Generator support. Phase 02 local integration evidence is recorded separately; it does not promote FM-01/FM-02 or standalone FE recipes.

## Product and repo boundaries

- `dzulfikarq/design-templates`: Forma — template registry, dependency manifests, validated installer, templates/themes.
- This repository — core CLI, technology adapters, compatibility resolver, project documentation generator, and an internal Tauri desktop UI/runtime MVP.
- EvoPilot repository is used **only as documentation process inspiration**; there is no runtime dependency.

## Default decisions

- JavaScript and TypeScript package manager: **npm**, with Yarn/pnpm/Bun as available options when a recipe is verified.
- Go: Go modules. PHP: Composer. Python: uv (pip is a future/conditional adapter). Flutter: pub.
- Default styling: framework-recommended CSS approach; user can choose Bootstrap, Tailwind, Sass/SCSS, etc. if compatible.
- Output location selected by user; never overwrite existing project content.
- No hidden downloads, Docker launch, remote push, or destructive operations. Forma fetch occurs only during explicit generation and uses the configured Git Credential Manager; config accepts no tokens.

## Source references verified during planning

- [Vite getting started](https://vite.dev/guide/)
- [Next.js create-next-app](https://nextjs.org/docs/app/api-reference/cli/create-next-app)
- [Angular ng new](https://angular.dev/cli/new)
- [Nuxt create command](https://nuxt.com/docs/4.x/api/commands/init)
- [Expo create-expo-app](https://docs.expo.dev/more/create-expo/)
- [Go Modules reference](https://go.dev/ref/mod)
- [FastAPI official tutorial](https://fastapi.tiangolo.com/tutorial/)
- [Tauri 2 shell permissions](https://v2.tauri.app/plugin/shell/)
- [React Native environment setup](https://reactnative.dev/docs/set-up-your-environment)
- [EvoPilot documentation reference](https://github.com/Aurevon-Technology/EvoPilot)

Document note: references are technical grounding, not evidence that adapters exist. Pin and retest exact toolchain versions when implementing each adapter.

## Phase 01 CLI

```text
project-generator --help
project-generator catalog --json
project-generator plan --config <file> --json
project-generator doctor --config <file> --json
project-generator generate --config <file> --jsonl
project-generator inspect --output <folder> --json
```

`npm run build` builds the Rust Windows supervisor and copies local sidecar into ignored `packages/core/native/`; no binary is committed. Phase 02.6 internal installers stage that sidecar with the CLI, but are not release artifacts. Windows Job Objects manage owned process lifetime, not filesystem/network isolation. `generate` is explicit execution consent. Planned recipes are blocked by default; `--development-allow-planned` is development-only and does not change recipe status. npm installs can execute dependency lifecycle scripts and are not sandboxed. No automatic Git, Docker, remote push, or hidden installs. See [Phase 01 evidence](docs/qa/acceptance-matrix.md).

## Internal desktop UI and runtime PoC (Phases 02.6–03)

The React/Vite + Tauri 2 app exposes a dashboard, multi-step project wizard, catalog-backed framework/style/manager choices, Forma metadata gallery, read-only plan/doctor review, explicit lifecycle consent, JSONL job progress/cancel/results, and local metadata history/settings. Native folder and VS Code actions are fixed typed commands; no generic command API exists. Run `npm run desktop:dev` for a local system-runtime debug build. The UI does not add adapters or promote recipes. Build either Node installer strategy on Windows with NSIS 3.13 available through `PG_NSIS_DIR`:

```powershell
$env:PG_NSIS_DIR = 'C:\path\to\portable\nsis-3.13'
node scripts/desktop.mjs build system 0.1.0
node scripts/desktop.mjs build bundled 0.1.1
```

System mode packages CLI/core/supervisor but expects Node.js and npm on `PATH`. Bundled mode packages Node.js and its matching npm. Internal debug builds alone expose planned-recipe override; release-profile installers keep planned recipes disabled. Lifecycle-script consent is unchecked by default; npm scripts run unsandboxed. Runtime comparison and same-host install/update/uninstall evidence: [Phase 02.6 report](docs/qa/evidence/phase-02.6-desktop-runtime-packaging.md). Phase 03 verification status: [acceptance matrix](docs/qa/acceptance-matrix.md) and [UI evidence](docs/qa/evidence/phase-03-desktop-ui-mvp.md). Artifacts are local/ignored; Windows 11 clean-machine proof and release approval remain blocked.

## Optional Forma templates (CLI only)

`catalog --json` lists the pinned templates. Add `template` to a config with `adapterId: "template.forma"`, a catalog `templateId`, the catalog commit SHA, and optional `variantId`; omit standalone `styling`. Supported local combinations are Staywise and Modern Admin on React + Vite and Next.js App Router, plus Focus Planner on React + Vite. See [compatibility evidence](docs/qa/evidence/phase-02-forma-local-integration.md).

```json
"template": {
  "adapterId": "template.forma",
  "templateId": "staywise-host-dashboard",
  "commitSha": "5cf3c4e5b7b0bc454a653f58d12237c56f2548e2",
  "variantId": "coral"
}
```

Forma recipes FM-01/FM-02 remain `planned` and blocked in normal generation. Local verification requires `--development-allow-planned`; this does not grant support status. On cache miss, generation fetches the pinned private Git commit through configured Git Credential Manager, then invokes Forma's existing exporter and installer. SHA-256 detects bundle changes but is not a signed publisher attestation. Interrupted fetch/export can leave partial cache directories; generator does not delete or overwrite ambiguous cache data. Second-account ACL denial and lifecycle-script isolation remain release gates.
