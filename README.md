# Project Generator Desktop

| Field | Value |
|---|---|
| Status | **Phase 01 CLI implementation present** — FE-01/FE-02 remain planned; no recipe release-approved |
| Version | 0.1.0 |
| Date | 2026-11-11 |
| Product | Universal Project Generator Desktop |
| Target OS | Windows 11 first |
| Documentation inspiration | EvoPilot (PRD ↔ design ↔ decision register ↔ QA evidence) |
| Scope | CLI kernel and React + Vite / Next.js generators only; no desktop UI |

Planning documents remain source for requirements and boundaries. Code and observed test evidence define implemented behavior. FE-01/FE-02 have local Windows generation evidence, but remain `planned` pending full independent acceptance and review.

## Vision

Create real, ready-to-develop projects with a guided wizard, official framework scaffolding, optional Forma templates, framework-aware styling and database integration, and truthful generated documentation. Use a secure, deterministic, testable CLI engine behind a Tauri desktop shell.

## Developer setup

Requirements: Windows 11, Node.js `>=22.13.0`, npm `>=10`. Node is a system prerequisite for Phase 01; desktop runtime packaging remains unresolved.

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
- Current Forma *external* testing for Staywise / React-Vite and Next App Router does **not** establish Project Generator integration.

## Product and repo boundaries

- `dzulfikarq/design-templates`: Forma — template registry, dependency manifests, validated installer, templates/themes.
- Proposed separate `project-generator` repository — desktop shell, core CLI, technology adapters, compatibility resolver, local project registry, project documentation generator.
- EvoPilot repository is used **only as documentation process inspiration**; there is no runtime dependency.

## Default decisions

- JavaScript and TypeScript package manager: **npm**, with Yarn/pnpm/Bun as available options when a recipe is verified.
- Go: Go modules. PHP: Composer. Python: uv (pip is a future/conditional adapter). Flutter: pub.
- Default styling: framework-recommended CSS approach; user can choose Bootstrap, Tailwind, Sass/SCSS, etc. if compatible.
- Output location selected by user; never overwrite existing project content.
- No hidden downloads, Docker launch, credential access, remote push, or destructive operations.

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

`generate` is explicit execution consent. Planned recipes are blocked by default; `--development-allow-planned` is development-only and does not change recipe status. npm installs can execute dependency lifecycle scripts and are not sandboxed. No automatic Git, Docker, remote push, or hidden installs. See [Phase 01 evidence](docs/qa/acceptance-matrix.md).
