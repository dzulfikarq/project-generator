# Technology Compatibility Matrix — Project Generator

| Field | Value |
|---|---|
| Version | Draft 0.1 — 2026-11-17 |
| Status | **FE-03–FE-15 and standalone BE-01/BE-02/BE-03/BE-04/BE-05/BE-06/BE-07 bounded local evidence recorded; BE-08 independent acceptance PASS WITH FINDINGS; BE-09 independent review PASS WITH FINDINGS (no product blocker), CLI/native r9 E2E passed and Phase 06C development closure GO; FS-06 independent acceptance PASS WITH FINDINGS and Phase 07A development closure GO; all FE/BE/FS/FM recipes remain PLAN; no recipe promoted or release-approved** |
| Main platform | Windows 11 |
| Source of truth | This matrix + machine-readable adapter manifests + QA results |

> **DO NOT equate framework popularity, upstream Forma checks, or local acceptance evidence with Project Generator readiness.** FE-01–FE-15, BE-01–BE-04, BE-06–BE-09, FS-06, and FM-01/FM-02 have local implementation/evidence only, except independently reviewed BE-05/BE-08/BE-09 and FS-06 evidence. BE-08's bounded PostgreSQL E2E passed and its independent acceptance is PASS WITH FINDINGS. BE-09's independent review is PASS WITH FINDINGS with no product blocker; its CLI PostgreSQL E2E and native Desktop r9 E2E are separate evidence. FS-06 independent acceptance is PASS WITH FINDINGS and Phase 07A development closure is GO. No result here promotes a recipe. Every recipe remains unavailable in normal generation.

## 1. Status and test gates

- `CAT`: cataloged / roadmap — may be displayed only in informational lists.
- `PLAN`: planned recipe; **disabled in normal generation** until acceptance and review. A development-only evidence run does not change status.
- `FUT`: future or V1.1; not selectable.
- `BLK`: unsupported/incompatible; cannot generate.
- `EXP`: experimental; adapter implemented but incomplete checks; opt-in with warning.
- `TEST`: tested by the Project Generator's independent Windows build/install/typecheck/smoke acceptance pipeline.

The catalog can mention `PLAN`, but normal generation is enabled only for `TEST`, or `EXP` with an explicit experimental toggle. The CLI's `--development-allow-planned` flag exists only to gather evidence and is not a product support toggle. A fully supported recipe is a **specific tuple** of framework, version family, language, styling, UI library, backend, database, data mapper, manager, template, OS and validation plan—not a single green check next to a framework.

## 2. Frontend (web)

| ID | Framework | Project target | JS manager default | Native scaffold / baseline | Typical styling | Forma | State |
|---|---|---|---|---|---|---|---|
| FW-REACT | React + Vite | V1 | npm | `create-vite` (React/TS) | Plain CSS, Bootstrap 5 CSS, SCSS, Tailwind CSS 4 | Forma templates below | PLAN |
| FW-NEXT | Next.js App Router | V1 | npm | `create-next-app` | Tailwind | Forma templates below | PLAN |
| FW-VUE | Vue 3 + Vite | V1 | npm | Official `create-vue` (TypeScript; Vite) | Plain CSS, Bootstrap 5 CSS, SCSS, Tailwind CSS 4 | No | PLAN |
| FW-NUXT | Nuxt 4 | V1 | npm | `create-nuxt@4.0.3` + immutable `nuxt/starter` commit; Nuxt `4.6.4` | Plain CSS (FE-06 only) | No | PLAN |
| FW-ANGULAR | Angular 21 | V1 | npm | Local `@angular/cli@21.2.30 ng new`; Angular core `21.2.26` | SCSS (FE-07 only) | No | PLAN |
| FW-SVELTE | SvelteKit | Later V1 candidate | npm | Svelte CLI | CSS, Tailwind, SCSS | No | CAT |
| FW-RN | React Native / Expo | V1.1 | npm | `create-expo-app` | NativeWind, StyleSheet | No | FUT |
| FW-FLUTTER | Flutter | V1.1 | pub | Flutter SDK | Material, Cupertino | No | FUT |

**Nuance:** Next/Nuxt already include server/runtime capabilities; selecting no **separate** backend is valid. Angular/React/Vue frontend-only projects still run a dev server, which is not a separately generated API backend.

## 3. Backend

| ID | Backend | Runtime and manager | Scaffolding strategy | Example data integration | State |
|---|---|---|---|---|---|
| BE-EXPRESS | Express | Node.js / npm | Reviewed minimal TS scaffold + official dependencies | None in bounded BE-01; database integrations remain separate proposed recipes | PLAN |
| BE-NEST | NestJS | Node.js `>=22.13` / npm `>=10` | Official Nest CLI `11.0.24`; Nest framework `11.2.10`; CommonJS-compatible NodeNext + Jest scaffold | BE-03 is database-free; BE-09 is separate PostgreSQL + Drizzle recipe, still PLAN | PLAN |
| BE-FASTIFY | Fastify | Node.js / npm | Official starter or reviewed minimal TS scaffold | Drizzle or Prisma for compatible SQL | PLAN |
| BE-GO | Go standard-library `net/http` (BE-02); Go + Gin (BE-04) | Go >=1.22 for BE-02; Go >=1.25 for BE-04 / Go Modules | Reviewed standalone REST starters; no scaffold CLI | None in BE-02/BE-04; database integrations remain separate proposed recipes | PLAN |
| BE-GIN | Go + Gin `v1.12.0` (BE-04) | Go >=1.25 / Go Modules | Reviewed standalone Gin starter; exact module graph and checksums | None in BE-04; pgx/PostgreSQL and other DB pairings require separate recipe scope and evidence | PLAN |
| BE-LARAVEL | Laravel 12 (BE-05) | PHP >=8.2 / Composer >=2.2 | Official `laravel/laravel@12.12.2`; frontend assets omitted | Eloquent + MySQL 8.4.13; bounded isolated acceptance PASS at `127.0.0.1:3307` (migration, CRUD, PHPUnit 4 tests/22 assertions, negative checks, isolation, cleanup) | PLAN |
| BE-FASTAPI | FastAPI | Python 3.14.x / uv | Reviewed standalone FastAPI/Pydantic application skeleton; resolve `uv.lock` and verify artifact hashes | None in bounded BE-06; SQLAlchemy/database integration is separate unimplemented scope | PLAN |
| BE-DJANGO | Django | Python / uv/pip | Official django-admin | Django ORM | FUT |
| BE-SPRING | Spring Boot | Java / Maven or Gradle | Spring Initializr | JPA / Hibernate | FUT |
| BE-ASPNET | ASP.NET Core | .NET / NuGet | `dotnet new` | EF Core | FUT |

These scaffolding references are directions, not proof that the exact generated API/data access works. Version IDs and CLI flags must be verified during implementation.

## 4. Database + ORM / driver

| Database | Kind | Example supported-by-design combinations | Constraints | State |
|---|---|---|---|---|
| PostgreSQL | SQL | React/Vite + Express + Drizzle (FS-06); Nest+Drizzle (BE-09); Nest+Prisma; Express+Drizzle (BE-08); Go+pgx; Laravel+Eloquent; FastAPI+SQLAlchemy | FS-06/BE-08/BE-09 require PostgreSQL 16+; generation/startup/health remain DB-free; explicit guarded migration and CRUD require a user-provided service | PLAN |
| MySQL | SQL | Laravel+Eloquent; Nest+Prisma; Go+MySQL driver; FastAPI+SQLAlchemy | Must respect MySQL vs MariaDB driver/version differences | PLAN |
| MariaDB | SQL | Laravel+Eloquent; Go+driver; Python+SQLAlchemy | Separate smoke checks; do not assume identical to MySQL | PLAN |
| SQLite | Embedded SQL | Express+Drizzle; Laravel+Eloquent; FastAPI+SQLAlchemy | No network server needed; file path, journal mode and migrations matter | PLAN |
| MongoDB | Document | Express+Mongoose; Nest+Mongoose with verified module | No SQL ORM/migrations assumptions; MongoDB connectivity explicit | PLAN |
| Redis | Auxiliary cache | Express / Nest / Laravel cache | Cache, not universal primary DB | FUT |
| SQL Server | SQL | ASP.NET Core / EF Core | Later runtime/provider matrix | FUT |
| None | N/A | Frontend-only or backend with no persistence | No fake DB driver, schema, seed or DB env | PLAN |

### ORM guardrails

- Prisma or Drizzle only where their **exact** runtime + DB + driver combination is supported and tested.
- Eloquent belongs to Laravel; SQLAlchemy to Python; Mongoose to Mongo/Node; Go can use `database/sql`, pgx or GORM according to the specific preset.
- Do **not** offer Prisma as a universal ORM for Go, PHP, Python or Mongo without an intentionally reviewed integration.
- Laravel + MongoDB, Go + MongoDB and FastAPI + MongoDB are not automatically V1 combinations merely because a driver exists.
- DB provisioning differs from configuration. Each `existing-service` recipe defines when it may connect; BE-08 generation/startup/health never connect and migration requires an explicit guarded target. For `docker-compose`, generator may create Compose files, and may start services only after explicit consent.

## 5. Package managers

| Ecosystem | Preselected manager | Alternatives | Compatibility / audit rule |
|---|---|---|---|
| Node web/backend/Expo | **npm** | Yarn `4.18.1` (FE-12/13); pnpm `11.28.11` (FE-14/15); Bun not implemented | Only listed React/Vue Vite + Plain CSS recipes use Yarn/pnpm; declare exact manager pin/config, install invocation, and one relevant lockfile |
| PHP/Laravel | Composer | N/A for PHP packages | Laravel may *also* have npm for frontend asset pipeline |
| Go | Go Modules (`go`) | N/A in V1 | Go >=1.22 for BE-02; Go >=1.25 for Gin BE-04. Validate module path. BE-02 has no third-party modules and generates only `go.mod`; BE-04 pins Gin and its module graph in `go.mod`/`go.sum`. |
| Python/FastAPI | uv | pip later if tested | `pyproject.toml` and uv lock; no npm substitute |
| Flutter | pub | N/A | Dart SDK / Flutter checks |
| Java | Maven | Gradle | Future only |
| .NET | NuGet | — | Future only |

Phase 04B.3 pins Yarn's `node-modules` linker in `.yarnrc.yml` and pnpm's `hoisted` linker in `pnpm-workspace.yaml`; pnpm isolated layout failed Vite `8.3.8` module-import resolution in the observed Node `22.22.1` run. These settings apply only to FE-12–FE-15. Do not treat either layout as universally compatible with other stacks. Any Node package manager used with Forma must be explicitly supported by the Forma manifest/installer and tested independently; Forma remains npm-only.

## 6. Styling & components

Legend: `PLAN` = design-compatible candidate awaiting generator tests; `FUT` = not planned for that release; `BLK` = not applicable/invalid; `COND` = needs independent compatibility gate.

| Framework | Plain CSS / Modules | Tailwind | Bootstrap | SCSS | Component library candidates |
|---|---|---|---|---|---|
| React + Vite | PLAN (FE-01) | PLAN (FE-10; Tailwind 4 / official Vite plugin) | PLAN (FE-04; CSS only) | PLAN (FE-08; Sass 1.108.2) | shadcn/ui (COND), MUI (COND), Ant Design (COND) |
| Next.js | BLK | PLAN (FE-02) | BLK | FUT | shadcn/ui (COND), MUI (COND) |
| Vue + Vite | PLAN (FE-03) | PLAN (FE-11; Tailwind 4 / official Vite plugin) | PLAN (FE-05; CSS only) | PLAN (FE-09; Sass 1.108.2) | PrimeVue (COND), Vuetify (COND) |
| Nuxt 4 | PLAN (FE-06) | FUT | FUT | FUT | Nuxt UI (COND), PrimeVue (COND), Vuetify (COND) |
| Angular 21 | FUT | FUT | FUT | PLAN (FE-07 only; Phase 04B.2 does not change Angular) | Angular Material (COND), PrimeNG (COND) |
| SvelteKit | FUT | FUT | FUT | FUT | Future only |
| Expo / React Native | Native StyleSheet | NativeWind FUT | **BLK** (web CSS) | **BLK** (web SCSS) | React Native Paper FUT |
| Flutter | **BLK** (web CSS) | **BLK** | **BLK** | **BLK** | Material/Cupertino FUT |

- Bootstrap can be a separate styling option. Interactive Bootstrap JS must respect the framework lifecycle; `bootstrap.css` alone does not install behavior.
- Phase 04A adds only FE-04/FE-05 Bootstrap CSS integration; Bootstrap JavaScript and Popper are excluded. Bootstrap + Tailwind is blocked, not combined or substituted.
- Phase 04B.2 adds FE-08/FE-09 with official Dart Sass `sass@1.108.2`, and FE-10/FE-11 with Tailwind CSS `4.3.5` plus official `@tailwindcss/vite@4.3.5`. The plugin peer range accepts Vite `^5.2.0 || ^6 || ^7 || ^8`; pinned `create-vite@9.3.4` and `create-vue@3.24.0` templates declare Vite 8 ranges. Tailwind v4 auto-detects source files; no legacy config/content glob is generated.
- SCSS is a CSS preprocessor, not a replacement for a component library. React/Vue Vite combinations only; Nuxt/Angular styling remains unchanged in this phase.
- Recommended default = framework-native CSS or verified Tailwind recipe, not a blanket styling default for all languages.
- `Forma` is separate from generic component libraries: template renderer requires a matching framework adapter, component schema and dependency manifest.

## 7. Cross-stack recipe registry (unit of release)

**Every row below remains `PLAN`.** FE-01–FE-15 and FM-01/FM-02 have local implementations and development evidence; FE-06/FE-07 verification is recorded in [Phase 04B evidence](../qa/evidence/phase-04b-nuxt-angular.md), FE-08–FE-11 in [Phase 04B.2 evidence](../qa/evidence/phase-04b2-scss-tailwind.md), and FE-12–FE-15 in [Phase 04B.3 evidence](../qa/evidence/phase-04b3-yarn-pnpm.md). No recipe can be selected for normal generation until independent acceptance evidence is reviewed and status is explicitly promoted.

| Recipe ID | Type | Frontend | Backend | DB / data access | Styling | Manager(s) | Launch target |
|---|---|---|---|---|---|---|---|
| FE-01 | Frontend | React Vite | None | None | CSS | npm | First CLI slice |
| FE-02 | Frontend | Next App Router | None separate | None | Tailwind | npm | First CLI slice |
| FE-03 | Frontend | Vue 3 + Vite | None | None | Plain CSS | npm | Phase 04A |
| FE-04 | Frontend | React + Vite | None | None | Bootstrap 5 CSS | npm | Phase 04A |
| FE-05 | Frontend | Vue 3 + Vite | None | None | Bootstrap 5 CSS | npm | Phase 04A |
| FE-06 | Frontend | Nuxt 4 | None separate | None | CSS | npm | Phase 04B |
| FE-07 | Frontend | Angular 21 | None | None | SCSS | npm | Phase 04B |
| FE-08 | Frontend | React + Vite | None | None | SCSS (`sass@1.108.2`) | npm | Phase 04B.2 |
| FE-09 | Frontend | Vue 3 + Vite | None | None | SCSS (`sass@1.108.2`) | npm | Phase 04B.2 |
| FE-10 | Frontend | React + Vite | None | None | Tailwind CSS 4.3.5 (`@tailwindcss/vite@4.3.5`) | npm | Phase 04B.2 |
| FE-11 | Frontend | Vue 3 + Vite | None | None | Tailwind CSS 4.3.5 (`@tailwindcss/vite@4.3.5`) | npm | Phase 04B.2 |
| FE-12 | Frontend | React + Vite | None | None | Plain CSS | Yarn `4.18.1` (`node-modules`) | Phase 04B.3 |
| FE-13 | Frontend | Vue 3 + Vite | None | None | Plain CSS | Yarn `4.18.1` (`node-modules`) | Phase 04B.3 |
| FE-14 | Frontend | React + Vite | None | None | Plain CSS | pnpm `11.28.11` (`hoisted`) | Phase 04B.3 |
| FE-15 | Frontend | Vue 3 + Vite | None | None | Plain CSS | pnpm `11.28.11` (`hoisted`) | Phase 04B.3 |
| BE-01 | Backend | None | Express | None | N/A | npm | Phase 05A standalone API; DB excluded |
| BE-02 | Backend | None | Go standard-library `net/http` | None | N/A | Go Modules | Phase 05B standalone API; no external modules |
| BE-03 | Backend | None | NestJS | None in Phase 05D.1; PostgreSQL + Prisma remains a separate proposed recipe | N/A | npm | Phase 05D.1 standalone API |
| BE-04 | Backend | None | Go + Gin `v1.12.0` | None | N/A | Go Modules | Phase 05D.2 standalone API; Go >=1.25 |
| BE-05 | Backend | None | Laravel | MySQL + Eloquent | N/A | Composer only; npm assets omitted | Phase 05C.3 |
| BE-06 | Backend | None | FastAPI | None in Phase 05C.1; SQLAlchemy/database remains separate proposal | N/A | uv | Phase 05C.1 implementation; Phase 05C.2 bounded local CLI/native evidence; independent acceptance pending |
| BE-07 | Backend | None | Express | SQLite + Drizzle | N/A | npm | Phase 06A standalone API; SQL generated, never auto-applied |
| BE-08 | Backend | None | Express | PostgreSQL 16+ + Drizzle | N/A | npm | Phase 06B standalone API; DB-free generation/startup/health; explicit guarded migration |
| BE-09 | Backend | None | NestJS 11 | PostgreSQL 16+ + Drizzle | N/A | npm | Phase 06C standalone API; DB-free generation/startup/health; explicit guarded migration |
| FS-06 | Fullstack | React + Vite | Express | PostgreSQL 16+ + Drizzle | Plain CSS | npm workspace | Phase 07A; one workspace/root lockfile; explicit guarded migration |
| FS-01 | Fullstack | Vue Vite | Laravel | MySQL + Eloquent | Bootstrap | npm + Composer | V1 |
| FS-02 | Fullstack | React Vite | Go Gin | PostgreSQL + pgx | Tailwind | npm + go | V1 |
| FS-03 | Fullstack | Angular | NestJS | PostgreSQL + Prisma | Angular Material | npm | V1 |
| FS-04 | Fullstack | Next App Router | NestJS | PostgreSQL + Prisma | Tailwind | npm | V1 |
| FS-05 | Fullstack | React Vite | Express | MongoDB + Mongoose | Bootstrap | npm | V1 |
| FM-01 | Template | React Vite | None | None | Selected Forma template | npm + Forma installer | V1 integration |
| FM-02 | Template | Next App Router | None separate | None | Selected Forma template | npm + Forma installer | V1 integration |
| MOB-01 | Mobile | Expo | Optional backend later | None | NativeWind / Native default | npm | V1.1 |
| MOB-02 | Mobile | Flutter | Optional backend later | None | Material | pub | V1.1 |

BE-04 does not imply PostgreSQL/pgx support. FS-02 remains a separate proposed fullstack recipe with PostgreSQL/pgx; it is unchanged and unverified by Phase 05D.2.

FS-06 is separately scoped from the PRD-reserved FS-01, FS-02, BE-08, and BE-09. Its bounded local Windows CLI E2E passed against run-owned PostgreSQL `17.2` at `127.0.0.1:64604`. Independent CLI E2E passed against PostgreSQL `17.2` at `127.0.0.1:58068`; independent Chrome browser E2E passed against a separate PostgreSQL `17.2` instance at `127.0.0.1:55480`, including React → Express → PostgreSQL CRUD, loading/empty states, API/database outages, credential sanitization, and clean shutdown. Native Desktop E2E passed 66/66; PID `5172` was observed live before cancel and absent after the cancelled result, which does not prove cancellation caused termination. Independent acceptance is PASS WITH FINDINGS; Phase 07A development closure is GO. PostgreSQL `16` remains NOT VERIFIED; clean-machine/installer, accessibility, and broader security review remain open. FS-06 stays `PLAN`; public release stays NO-GO. Details: [Phase 07A evidence](../qa/evidence/phase-07a-react-express-postgresql-drizzle.md).

FE-01 evidence: [Windows React + Vite run](../qa/evidence/FE-01/2026-11-11-cli-e2e.md). FE-02 evidence: [Windows Next.js run](../qa/evidence/FE-02/2026-11-11-cli-e2e.md). Both were invoked with `--development-allow-planned`; remain `PLAN` pending the full independent acceptance/review gates.

Phase 04A pins and implementation evidence: [FE-03–FE-05 report](../qa/evidence/phase-04a-vue-bootstrap-expansion.md). Fresh CLI/native desktop acceptance and negative Vue/Forma plan evidence: [acceptance report](../qa/evidence/phase-04a-native-desktop-acceptance.md). Vue uses official `create-vue@3.24.0`; Bootstrap CSS uses `bootstrap@5.3.9`. All three recipes remain `PLAN`; no Forma/Vue compatibility is asserted.

Phase 04B uses official `create-nuxt@4.0.3`, Nuxt `4.6.4`, and immutable `nuxt/starter` commit `db01806fcb37f2e369fb09443c72cac696b31548` for FE-06; FE-07 uses local `@angular/cli@21.2.30` and Angular core `21.2.26`. Fresh CLI and native Tauri acceptance, package/source pins, Angular npm workaround, release planned-gate checks, and bounded limitations: [Phase 04B report](../qa/evidence/phase-04b-nuxt-angular.md). Both recipes remain `PLAN`; no Forma support is asserted.

Phase 04B.3 uses official `create-vite@9.3.4` / `create-vue@3.24.0` scaffolds for FE-12–FE-15. Fresh CLI and native Tauri evidence covers Yarn `4.18.1` with persistent `node-modules` config and pnpm `11.28.11` with persistent `hoisted` config, exactly one manager lockfile, generated docs/manifest, lint/typecheck/build/HTTP smoke, explicit lifecycle/planned consent, and planned status retention. All four remain `PLAN`; npm stays default and Forma remains npm-only. See [DEC-024](../decisions/DEC-024-phase-04b3-yarn-pnpm.md) and [Phase 04B.3 evidence](../qa/evidence/phase-04b3-yarn-pnpm.md).

Phase 05C.1 adds BE-06 as standalone FastAPI/Pydantic/Uvicorn + uv with Python 3.14.x baseline, isolated `.venv`, `uv.lock`, API/docs/tests, and explicit unsandboxed build-code consent. Phase 05C.2 recorded bounded local provenance and passed CLI/native checks using isolated CPython 3.14.10 and uv 0.13.8, including lock integrity, install, Python checks, HTTP/OpenAPI/shutdown, cancellation, and collision checks. Direct package pins still need independent review; local evidence does not promote the recipe. See [DEC-027](../decisions/DEC-027-phase-05c1-fastapi.md), [Phase 05C.1 evidence](../qa/evidence/phase-05c1-fastapi.md), and [Phase 05C.2 evidence](../qa/evidence/phase-05c2-fastapi-toolchain-native.md). BE-06 remains PLAN and release-blocked.

Phase 05C.3 adds BE-05 as standalone Laravel 12/PHP/Composer with MySQL/Eloquent configuration. Bounded Windows CLI/native and isolated database acceptance passed using vendor-verified portable MySQL 8.4.13 bound only to `127.0.0.1:3307`: explicit migration passed; temporary PHPUnit integration passed 4 tests/22 assertions, including Eloquent create/read/update/delete; invalid-credential and unavailable-DB checks, schema isolation, and cleanup passed. Generation created no `.env`, schema, or migration. Composer scripts/plugins are disabled; package code remains unsandboxed and requires explicit consent. Bounded independent review of this evidence: **PASS**; Phase 05C development scope is closed. Acceptance/review does not promote the recipe or approve release: BE-05 remains `PLAN` and blocked in normal/release generation. See [DEC-028](../decisions/DEC-028-phase-05c3-laravel.md) and [Phase 05C.3 evidence](../qa/evidence/phase-05c3-laravel.md).

Phase 05D.1 adds BE-03 as standalone NestJS 11/TypeScript/npm using integrity-pinned Nest CLI `11.0.24`, framework packages `11.2.10`, Node `>=22.13`, Jest 30 + ts-jest `29.4.15`, and CommonJS-compatible NodeNext output. Windows CLI/native acceptance passed scaffold, dependency/lock integrity, typecheck, lint, unit/e2e, build, HTTP, cancellation (CLI), consent, history/open, and collision checks. No DB/ORM/auth/Docker/fullstack/Observe integration. Evidence is local and pending independent review; BE-03 remains `PLAN`, normal/release generation remains blocked. See [DEC-029](../decisions/DEC-029-phase-05d1-nestjs.md) and [Phase 05D.1 evidence](../qa/evidence/phase-05d1-nestjs.md).

Phase 05D.2 adds BE-04 as standalone Go + Gin `1.12.0` + Go Modules with Go `>=1.25.0`; bounded Windows CLI/native acceptance passed pinned module integrity, Go checks, HTTP/shutdown, separate module-download consent, cancellation, cleanup, collision, and native result/history/open. The generated graph hash and test details are recorded in [Phase 05D.2 evidence](../qa/evidence/phase-05d2-go-gin.md). Independent evidence review remains pending; BE-04 stays `PLAN` and normal/release generation remains blocked. This does not implement or verify database/fullstack scope; FS-02 PostgreSQL/pgx remains separate and unverified.

Phase 06A adds BE-07 as a distinct Express + npm + SQLite + Drizzle recipe, with pinned `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `better-sqlite3@13.2.0`, and `tsx@4.21.0`. Windows CLI/native acceptance passed dependency/lock integrity, generated SQL, typecheck/lint/tests/build, HTTP smoke, and CRUD against a separately created test database after explicit migration. Generation never creates or migrates the configured application database; generator smoke uses `:memory:` and `DB_FILE` overrides accept only `:memory:`. Windows DB path validation rejects reserved device names including `CLOCK$`; the helper does not detect hard-link aliases. Cancellation and collision preservation passed; release policy blocks planned BE-01 and BE-07 before staging. BE-01 remains the no-database Express recipe. Final independent post-remediation runtime acceptance passed; **Phase 06A development closure is GO**. BE-01/BE-07 remain `PLAN`; public release remains **NO-GO**. Evidence: [DEC-031](../decisions/DEC-031-phase-06a-express-sqlite-drizzle.md) and [Phase 06A report](../qa/evidence/phase-06a-express-sqlite-drizzle.md).

Phase 06B adds BE-08 Express + npm + PostgreSQL + Drizzle with pinned dependencies and registry integrity. Focused tests and packaged release policy passed. Smoke-only runner helper synthesizes loopback `DATABASE_URL`; generic allowlist remains unchanged. Targeted disposable PostgreSQL E2E passed identity, generation, HTTP smoke, target mismatch, guarded migration, CRUD, rollback, cancellation and collision. Existing service was untouched. BE-08 remains `PLAN`; Phase 06B **NO-GO pending independent acceptance**. See [DEC-032](../decisions/DEC-032-phase-06b-express-postgresql-drizzle.md) and [Phase 06B evidence](../qa/evidence/phase-06b-express-postgresql-drizzle.md).

Phase 06C adds BE-09 NestJS 11 + npm + PostgreSQL 16+ + Drizzle. BE-03 remains database-free; BE-07 and BE-08 remain their separate Express recipes. Generation/startup/`/health` remain DB-free; the generated Nest DatabaseService creates its pool on first CRUD request. The Phase 06C CLI E2E passed on PostgreSQL `17.2` at run-owned loopback port `57573`, including guarded migration/CRUD; BE-08 E2E ran separately in Phase 06B and is not part of the Phase 06C harness. Native Desktop E2E r9 passed (exit `0`, 116/116 assertions) without PostgreSQL: dual consent, normal generation, live `stageId=installing`, cancellation with matching npm PID active, PID exit, absent target/staging, empty recovery, and collision `BLOCKED` with sentinel preserved. BE-09 remains `planned`. Earlier r1 covered generation/collision only; r5 follow-up verified native cancellation/cleanup although its harness failed on a missing UI attribute; R6–R8 were harness/resource/readiness/status-selector issues corrected in r9 without weakening key checks. Preflight conservatively rejects predicted staged `esbuild.exe` paths over 240 characters; regression rejects 261 and accepts 219. This proves neither Windows' maximum path length nor the observed 261-character `ENOENT` root cause. Independent review: **PASS WITH FINDINGS, no product blocker**; Phase 06C development closure **GO**. PostgreSQL `16` and clean-machine/installer acceptance remain untested. npm lifecycle scripts are unsandboxed; direct Drizzle Kit migration bypasses wrapper checks; target identity is not cryptographic. See [DEC-033](../decisions/DEC-033-phase-06c-nest-postgresql-drizzle.md) and [Phase 06C evidence](../qa/evidence/phase-06c-nest-postgresql-drizzle.md).

**Important:** the fullstack recipe must produce a real, reachable example API endpoint and frontend call when that is part of its advertised output. Generating two unrelated folder trees is insufficient.

## 8. Forma integration matrix

| Template | Forma-level compatibility at pinned source | Project Generator local integration | Allowed target |
|---|---|---|---|
| Staywise Host Dashboard 0.1.0 | React + Vite; Next.js App Router | **PLAN** — generation, npm install, typecheck, build, HTTP and browser smokes passed | React + Vite, Next.js App Router |
| Modern Admin 1.0.0 | React + Vite; Next.js App Router | **PLAN** — generation, npm install, typecheck, build, HTTP and browser smokes passed | React + Vite, Next.js App Router |
| Focus Planner 0.1.0 | React + Vite; Next.js untested | **PLAN** — React + Vite generation, npm install, typecheck, build, HTTP and browser smokes passed | React + Vite only |
| Any other Forma template | Require manifest and independent evidence | Not in pinned Project Generator catalog | Do not offer |
| Forma React on Vue/Nuxt/Angular/Expo | No native adapter, wrong component contract | **BLK** | Do not offer |

Phase 04A native UI disabled the React/Next Forma template cards when Vue was selected. CLI plans for Vue with React-only `modern-admin` and `staywise-host-dashboard` returned `GEN_INCOMPATIBLE` without creating a target; see [native acceptance evidence](../qa/evidence/phase-04a-native-desktop-acceptance.md).

The catalog is pinned to `5cf3c4e5b7b0bc454a653f58d12237c56f2548e2`. On an explicit generation with cache miss: configured Git Credential Manager fetches only that commit; existing Forma exporter creates a portable bundle; Project Generator checks catalog metadata/content hash; existing installer validates and installs into owned staging. Cache key includes source commit, template ID/version, and package content hash. Credentials are not accepted in config or copied by Project Generator into its own docs/manifest/logs. SHA-256 is integrity checking, not publisher signature. Interrupted fetch/export can leave partial cache directories; no automatic cache deletion or overwrite is attempted. See [Phase 02 evidence](../qa/evidence/phase-02-forma-local-integration.md).

## 9. Runtime / machine prerequisites

- Windows 11 target, PowerShell and Windows path validation; Phase 01 CLI requires installed system Node.js and npm. Phase 02.6 built system-Node and bundled-Node desktop installers on one Windows 11 host; OPEN-001 remains open pending clean-machine proof and runtime decision ([evidence](../qa/evidence/phase-02.6-desktop-runtime-packaging.md)).
- Node/npm (and optionally Yarn/pnpm/Bun) for JavaScript stacks.
- Go SDK for Go backend.
- PHP, Composer and required PHP extensions for Laravel.
- Python and uv for FastAPI.
- Docker Engine/Desktop optional for `docker-compose` mode.
- Git optional for repository bootstrap; code generation without Git must still work.
- Android SDK/JDK etc. for Android mobile flows; native iOS builds require macOS, not promised on Windows.
- Correct network access for downloading uncached packages and Forma registry. No claim of offline install with empty caches.

## 10. Resolver behavior and practical rules

1. Select project type, then identify framework(s) and generated components.
2. Determine exact adapter/version/OS matrix and prerequisite list.
3. Query styling/component/plugin compatibility with framework adapter.
4. Check DB/driver/ORM pairing and connection/provisioning mode.
5. Check package manager(s) and generated lockfile expectations.
6. If a Forma template selected, check pinned catalog framework mapping, commit and content hash before generation; do not fetch during plan.
7. Resolve exact recipe and status. If no tested recipe, offer the closest tested preset *without modifying selections silently*.
8. Produce a complete plan and estimated actions; require explicit user Generate action.
9. Run post-gen checks; do not promote a recipe based on a single successful invocation.

### Examples of invalid combinations

- `Flutter + Bootstrap` → blocked: CSS framework not applicable to Flutter widgets.
- `Angular + Forma Staywise React` → blocked: React component schema incompatible.
- `Go Gin + Prisma` → blocked: Prisma adapter not established for Go.
- `React Native + CSS Modules / Bootstrap` → blocked for native output.
- `MongoDB + SQL-only migration driver` → blocked unless a specific Mongo integration adapter exists.
- `PHP Laravel + Yarn as PHP package manager` → blocked; Yarn can be used only for JS asset pipeline if supported.
- `Vite + npm + package-lock.json + yarn.lock` → invalid build output; exactly one Node lockfile per package boundary.

## 11. Independent acceptance per recipe

For each recipe, verify: preflight on clean Windows test fixture; generate into path with spaces and a non-ASCII segment; dependency install; framework-specific compile/lint/typecheck; smoke on relevant services; config and docs truthful; cancellation recovery; repeated generation into same target blocked; version pin persisted; logs redacted; clean working tree if Git optional selected. Repo CI must retain commands, exit codes and evidence links. A matrix entry must name its evidence file/test ID before switching `PLAN` to `TEST`.

## 12. Reference docs

- Vite: https://vite.dev/guide/
- Next.js: https://nextjs.org/docs/app/api-reference/cli/create-next-app
- Angular: https://angular.dev/cli/new
- Nuxt: https://nuxt.com/docs/4.x/api/commands/init
- Go modules: https://go.dev/ref/mod
- Expo: https://docs.expo.dev/more/create-expo/
- React Native environment: https://reactnative.dev/docs/set-up-your-environment
- FastAPI: https://fastapi.tiangolo.com/tutorial/

This file records **proposed compatibility**, not user hardware readiness, runtime support guarantee, or deployed application state.
