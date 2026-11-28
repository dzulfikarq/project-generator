# FormaForge — Project Generator Desktop

| Field | Value |
|---|---|
| Status | **Phase 01 CLI + Phase 02 Forma + Phase 02.6 packaging PoC + Phase 03 internal UI MVP + Phase 03.5 UX polish + Phase 04A–04B.3 frontend evidence + Phase 05A–05D.2 / 06A evidence; Phase 06B independent acceptance PASS WITH FINDINGS and development closure GO; Phase 06C independent review PASS WITH FINDINGS, no product blocker, and development closure GO; Phase 07A/07B independent acceptance PASS WITH FINDINGS and development closure GO; Phase 08A BE-02 promotion NO-GO; Phase 08A.2/08A.7 native diagnostic generation PASS and 08A.7 cleanup PASS; Phase 08A.3 Go 1.22.0 compatibility PASS for tested scope; Phase 08A.5 focused checks PASS WITH FINDINGS but cleanup FAIL; Phase 08B.3 binary provenance and one native generation PASS; prior harness assertion FAIL, corrected regression 21/21 PASS but not native-retested; History/Open/VS Code NOT VERIFIED; historical supervisor/cleanup causes UNKNOWN; independent acceptance outstanding** — BE-02 remains planned, promotion and public release NO-GO |
| Version | 0.1.0 |
| Date | 2026-11-28 |
| Product | Universal Project Generator Desktop |
| Target OS | Windows 11 first |
| Documentation inspiration | EvoPilot (PRD ↔ design ↔ decision register ↔ QA evidence) |
| Scope | CLI kernel, internal Tauri desktop UI/runtime PoC, planned frontend, standalone Express, Express/SQLite/Drizzle, Express/PostgreSQL/Drizzle, NestJS/PostgreSQL/Drizzle, React/Vite and Vue/Vite + Express/PostgreSQL/Drizzle fullstack recipes, Go `net/http` and Gin, FastAPI, and Laravel API recipes, optional React/Next Forma templates; recipes remain planned |

Planning documents remain source for requirements and boundaries. Code and observed test evidence define implemented behavior. Phase 03 includes the FormaForge Forge Studio dashboard, catalog-driven wizard, metadata-only Forma gallery, review/Doctor, consent-gated job UI, results, local metadata history/settings, and fixed native open actions. Phase 03.5 fixes invalid typography declarations and a clipped dashboard empty-state action; native Windows UI runs completed FE-01/FE-02 generation, collision/error/retry, cancellation, history, and open actions using explicit internal consent. Phase 04A adds FE-03 Vue/Vite/CSS, FE-04 React/Vite/Bootstrap CSS, and FE-05 Vue/Vite/Bootstrap CSS through pinned official packages; fresh CLI and native desktop runs passed listed checks. Phase 04B adds planned Nuxt 4 and Angular 21 recipes through pinned official scaffolds; fresh non-elevated CLI and native Tauri runs passed listed checks, result/history open actions, and bounded safety checks. Phase 04B.2 adds React/Vue Vite SCSS via Sass 1.108.2 and Tailwind CSS 4 via the official Vite plugin 4.3.5. Phase 04B.3 adds FE-12–FE-15 React/Vue Vite + Plain CSS recipes with Yarn `4.18.1` or pnpm `11.28.11`; fresh CLI and native Tauri runs passed checks, while npm remains default. All FE recipes remain `planned` pending independent acceptance and review. Bootstrap JS/Popper and Forma outside React/Next remain excluded. Broader product acceptance remains partial. Desktop install/update/uninstall and both runtime package modes have same-host Windows 11 PoC evidence; no clean-machine proof or release approval exists. See [Phase 03.5 desktop acceptance](docs/qa/evidence/phase-03.5-final-desktop-acceptance.md), [Forge Studio verification](docs/qa/evidence/forge-studio-redesign.md), [Phase 04A acceptance](docs/qa/evidence/phase-04a-native-desktop-acceptance.md), [Phase 04B evidence](docs/qa/evidence/phase-04b-nuxt-angular.md), [Phase 04B.2 evidence](docs/qa/evidence/phase-04b2-scss-tailwind.md), and [Phase 04B.3 evidence](docs/qa/evidence/phase-04b3-yarn-pnpm.md).

## Vision

Create real, ready-to-develop projects with a guided wizard, official framework scaffolding, optional Forma templates, framework-aware styling and database integration, and truthful generated documentation. Use a secure, deterministic, testable CLI engine behind a Tauri desktop shell.

## Phase 05A status

BE-01 adds standalone Node.js `>=22.13.0` + TypeScript + Express `5.1.0` + npm, with no database or frontend. Windows CLI and Tauri evidence passed generated checks, consent, result/history/open, cancellation, and collision flows. BE-01 remains planned; independent review and release approval remain open. See [Phase 05A evidence](docs/qa/evidence/phase-05a-express-rest-api.md).

## Phase 05B status

BE-02 adds a standalone Go `net/http` REST API using Go Modules (Go `>=1.22`), standard library only. Phase 08A.2 and 08A.7 each recorded one diagnostic native generation PASS on Go `1.26.7`; Phase 08A.7 cleanup postconditions also passed. Phase 08A.3 verified the preserved output with Go `1.22.0`. Neither resolves historical supervisor or cleanup causes. BE-02 remains planned; promotion and public release remain NO-GO. See [Phase 05B evidence](docs/qa/evidence/phase-05b-go-net-http.md), [Phase 08A assessment](docs/qa/evidence/phase-08a-be02-promotion-readiness.md), and [Phase 08A.3 compatibility evidence](docs/qa/evidence/phase-08a3-be02-go122-compatibility.md).

## Phase 05C status

BE-06 is a standalone FastAPI/Pydantic/Uvicorn API using uv, with `/health`, `/api/info`, `/docs`, OpenAPI, pytest checks, and no database, ORM, authentication, frontend, or automatic server start. Phase 05C.1 implemented the recipe; Phase 05C.2 passed bounded local provenance, CLI, and native Tauri checks with isolated CPython `3.14.10` and uv `0.13.8`. Direct pins remain provisional pending independent review. BE-06 remains `planned`; normal/release generation stays blocked and no release is approved. See [DEC-027](docs/decisions/DEC-027-phase-05c1-fastapi.md), [Phase 05C.1 evidence](docs/qa/evidence/phase-05c1-fastapi.md), and [Phase 05C.2 evidence](docs/qa/evidence/phase-05c2-fastapi-toolchain-native.md).

BE-05 is a standalone Laravel 12 API using PHP/Composer, with MySQL/Eloquent configuration, API validation, PHPUnit tests, and no frontend assets. Phase 05C.3 bounded CLI/native and isolated MySQL 8.4.13/Eloquent acceptance passed on Windows using `127.0.0.1:3307`; explicit migration, CRUD, isolation, and negative checks passed, including PHPUnit integration (4 tests, 22 assertions). Generation created no `.env`, schema, or migration; test-owned database and run data were removed. Bounded independent evidence review passed and closes Phase 05C development scope. Composer scripts/plugins remain disabled; dependency execution and Artisan/PHPUnit package loading require explicit consent and remain unsandboxed. BE-05 remains `planned`; no recipe promotion or public release approval. See [DEC-028](docs/decisions/DEC-028-phase-05c3-laravel.md) and [Phase 05C.3 evidence](docs/qa/evidence/phase-05c3-laravel.md).

## Phase 05D.1 status

BE-03 adds a standalone NestJS 11 / TypeScript / npm API from integrity-pinned official Nest CLI `11.0.24`, preserving its CommonJS-compatible NodeNext/Jest scaffold. Windows CLI and native Tauri acceptance passed scaffold, dependency/lock integrity, typecheck, lint, Jest unit/e2e, build, HTTP, consent, history/open, and collision checks; CLI cancellation cleaned owned staging. No database, ORM, auth, Docker, or fullstack; HTTP smoke server is stopped before finalization; no Observe integration. BE-03 remains `planned`; normal/release generation stays blocked. See [DEC-029](docs/decisions/DEC-029-phase-05d1-nestjs.md) and [Phase 05D.1 evidence](docs/qa/evidence/phase-05d1-nestjs.md).

## Phase 05D.2 status

BE-04 adds a standalone Go + Gin `1.12.0` REST API using Go Modules (Go `>=1.25.0`), with pinned module graph and checksums. Windows CLI/native acceptance passed module integrity, Go formatting/vet/test/build, HTTP smoke, graceful shutdown, consent separation, cancellation cleanup, collision preservation, and UI result/history/open flows. No database, ORM, authentication, Docker, or fullstack. BE-04 remains `planned`; normal/release generation stays blocked. PostgreSQL/pgx remains separate proposed FS-02 scope. See [DEC-030](docs/decisions/DEC-030-phase-05d2-go-gin.md) and [Phase 05D.2 evidence](docs/qa/evidence/phase-05d2-go-gin.md).

## Phase 06A status

BE-07 adds separate Express + npm + SQLite + Drizzle starter, pinned `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `better-sqlite3@13.2.0`, and `tsx@4.21.0`. Remediation 3 replaces generated PowerShell path checks with a first-party Rust Windows handle verifier, packaged beside the supervisor and copied into BE-07 output. Independent source review completed **PASS WITH FINDINGS**; Remediation 4 addressed those findings. Final independent post-remediation runtime acceptance **PASS**, with no new blockers; **Phase 06A development closure: GO**. File-symlink rejection remains **NOT VERIFIED** because Windows returned `EPERM`; hard-link aliases are not detected. Handle checks do not eliminate TOCTOU before SQLite opens the path; the generated helper can be replaced by someone able to modify project files; npm lifecycle scripts/native addons remain unsandboxed. Installer validation remains open. BE-01 and BE-07 remain `planned` and are not production-ready; public release remains **NO-GO**. See [DEC-031](docs/decisions/DEC-031-phase-06a-express-sqlite-drizzle.md) and [Phase 06A evidence](docs/qa/evidence/phase-06a-express-sqlite-drizzle.md).

## Phase 06B status

BE-08 adds distinct Express + npm + PostgreSQL + Drizzle recipe. Independent acceptance is **PASS WITH FINDINGS**; **Phase 06B development closure: GO**. Fresh PostgreSQL 17.2 E2E passed on run-owned loopback port `62859`, including generation, DB-free smoke, guarded migration, CRUD, rollback, cancellation, collision, and BE-01/BE-07 regressions; port `5432` untouched. P3 harness descriptor leak was fixed and covered by targeted regression. PostgreSQL 16 was not independently tested. BE-01, BE-07, and BE-08 remain `planned`; public release remains **NO-GO**. npm lifecycle scripts remain unsandboxed; direct Drizzle Kit migration bypasses wrapper checks; target confirmation is not cryptographic server identity. See [DEC-032](docs/decisions/DEC-032-phase-06b-express-postgresql-drizzle.md) and [Phase 06B evidence](docs/qa/evidence/phase-06b-express-postgresql-drizzle.md).

## Phase 06C status

BE-09 is separate NestJS 11 + npm + PostgreSQL 16+ + Drizzle; BE-03 remains database-free, BE-07 remains Express/SQLite/Drizzle, and BE-08 remains Express/PostgreSQL/Drizzle. The Phase 06C Windows CLI E2E passed on Node `22.22.1` and PostgreSQL `17.2` using a run-owned loopback cluster on port `57573`; port `5432` was not selected. That CLI run verified PostgreSQL migration/CRUD. Its harness covers BE-01/BE-07 plan regressions; BE-08 E2E ran separately in Phase 06B. Native Desktop E2E did not use PostgreSQL. Final native rerun r9 exited `0` with **116 assertions passed / 0 failed**: dual consent, normal BE-09 generation, live `stageId=installing`, cancellation while matching npm PID was active, PID exit, absent target/staging, empty recovery, and collision `BLOCKED` with sentinel preserved. Generated manifest records BE-09 as `planned`. Earlier r1 covered generation/collision only; r5 cancellation follow-up proved active npm cancellation and cleanup, but its harness failed on a missing UI attribute. R6–R8 failures were harness/resource/readiness/status-selector issues; r9 corrected these without weakening the key checks. Long-path preflight conservatively rejects predicted staged `esbuild.exe` paths over 240 characters: regression rejected 261 and accepted 219; the 261-character `ENOENT` root cause and Windows maximum are not proven. `npm run test:policy:phase-06c` passed for system and bundled Node; release builds still block BE-09 before staging. Independent review: **PASS WITH FINDINGS, no product blocker; Phase 06C development closure: GO**. PostgreSQL 16 and clean-machine/installer acceptance remain untested. BE-09 remains `planned`; public release remains **NO-GO**. npm lifecycle scripts remain unsandboxed; direct Drizzle Kit migration can bypass wrapper checks; target confirmation is not cryptographic server identity. See [DEC-033](docs/decisions/DEC-033-phase-06c-nest-postgresql-drizzle.md) and [Phase 06C evidence](docs/qa/evidence/phase-06c-nest-postgresql-drizzle.md).

## Phase 07A status

FS-06 is a separate planned fullstack recipe: React/Vite + Express + PostgreSQL 16+ + Drizzle in one npm workspace and one root lockfile. The bounded local CLI E2E passed with run-owned PostgreSQL `17.2` at `127.0.0.1:64604` (port `5432` excluded), including generated checks, DB-free smoke, guarded migration/CRUD, rollback, cancellation, collision, and plan regressions. Independent CLI E2E passed against PostgreSQL `17.2` at `127.0.0.1:58068`. Independent Chrome browser E2E passed against a separate PostgreSQL `17.2` instance at `127.0.0.1:55480`: React → Express → PostgreSQL create/read/update/delete, loading and empty states, API and database outages, credential sanitization, and clean shutdown. Native Desktop E2E passed **66/66** for consent, generation flow, cancellation, collision, and recovery. It observed npm PID `5172` live before cancellation and absent after the cancelled terminal result; this does not prove cancellation caused process termination. System/bundled release-policy checks passed and blocked planned FS-06 before staging.

Independent acceptance: **PASS WITH FINDINGS**; Phase 07A development closure: **GO**. FS-06 remains `planned`; public release remains **NO-GO**. PostgreSQL `16` remains **NOT VERIFIED**. Clean-machine/installer acceptance, accessibility, and broader security review remain open. npm lifecycle scripts remain unsandboxed; direct Drizzle Kit migration can bypass wrapper checks. See [DEC-034](docs/decisions/DEC-034-phase-07a-fullstack-react-express-postgresql.md) and [Phase 07A evidence](docs/qa/evidence/phase-07a-react-express-postgresql-drizzle.md).

## Phase 07B status

FS-07 adds distinct Vue 3/Vite + Express/PostgreSQL/Drizzle npm workspace. Independent Windows CLI/PostgreSQL/Chrome E2E passed on Node `22.22.1`, npm `10.9.4`, and run-owned PostgreSQL `17.2` at `127.0.0.1:52457` (`5432` excluded). The earlier native **68/68** suite covers review, consent, install cancellation, recovery, and collision, not successful generation. A separate success-wrapper attempt first failed on an activity-event assertion unavailable on the result page; corrected `npm run test:e2e:phase-07b:native-success` then passed **40/40 assertions**, including the rendered success result and generated manifest **15/15**. System/bundled release-policy checks passed. Independent acceptance: **PASS WITH FINDINGS**; Phase 07B development closure: **GO**. FS-07 stays `planned`; public release remains **NO-GO**. PostgreSQL `16`, unsandboxed npm lifecycle scripts, direct Drizzle Kit migration bypass, clean-machine/installer, accessibility, and broader security review remain open. See [DEC-035](docs/decisions/DEC-035-phase-07b-fullstack-vue-express-postgresql.md) and [Phase 07B evidence](docs/qa/evidence/phase-07b-fullstack-vue-express-postgresql.md).

## Phase 08A–08B stabilization status

**BE-02 promotion remains NO-GO.** Phase 08B.3 supervisor build/stage/launch binary provenance and one native generation passed; all seven generated validations passed. The harness then failed because it required `exitCode` on non-process `scaffold-identity`. Corrected assertion and process-check regressions pass **21/21**, but were not rerun natively. History, Open Folder, and Open VS Code remain **NOT VERIFIED** because isolated WebView history state is unavailable. Historical supervisor and cleanup causes remain **UNKNOWN**. BE-02 and all recipes remain `planned`; normal generation stays blocked and public release remains **NO-GO**. See [DEC-036](docs/decisions/DEC-036-phase-08a-be02-promotion-readiness.md), [Phase 08A assessment](docs/qa/evidence/phase-08a-be02-promotion-readiness.md), [Go 1.22.0 compatibility](docs/qa/evidence/phase-08a3-be02-go122-compatibility.md), and [Phase 08B.3 evidence](docs/qa/evidence/phase-08b3-be02-supervisor-provenance.md).

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
- Forma's prior external tests alone do **not** establish Project Generator support. Local Phase 02/05A evidence does not promote FM-01/FM-02, FE recipes, or BE-01.

## Product and repo boundaries

- `dzulfikarq/design-templates`: Forma — template registry, dependency manifests, validated installer, templates/themes.
- This repository — core CLI, technology adapters, compatibility resolver, project documentation generator, and an internal Tauri desktop UI/runtime MVP.
- EvoPilot repository is used **only as documentation process inspiration**; there is no runtime dependency.

## Default decisions

- JavaScript and TypeScript package manager: **npm** by default. BE-01 is npm-only; Yarn/pnpm are limited to FE-12–FE-15 evidence runs. All recipes remain planned and normal generation stays blocked. Bun remains unimplemented.
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

`npm run build` builds the Rust Windows supervisor and a release-profile CLI/core by default; no binary is committed. `npm run build:development` explicitly builds an internal CLI/core that permits `--development-allow-planned` for evidence gathering. The capability is compiled into the core artifact, not enabled by runtime environment or CLI flags. Desktop debug builds use the development profile; packaged release builds use release profile and smoke-test the staged CLI. Planned recipes remain blocked by default and never change support status. Windows Job Objects manage owned process lifetime, not filesystem/network isolation. `generate` is explicit execution consent. npm installs can execute dependency lifecycle scripts and are not sandboxed. No automatic Git, Docker, remote push, or hidden installs. See [Phase 01 evidence](docs/qa/acceptance-matrix.md).

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
