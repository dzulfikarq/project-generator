# Technology Compatibility Matrix — Project Generator

| Field | Value |
|---|---|
| Version | Draft 0.1 — 2026-11-14 |
| Status | **FE-03–FE-07 local native acceptance recorded; FE-01–FE-07/FM-01/FM-02 remain PLAN pending independent review; no recipe promoted or release-approved** |
| Main platform | Windows 11 |
| Source of truth | This matrix + machine-readable adapter manifests + QA results |

> **DO NOT equate framework popularity, upstream Forma checks, or local acceptance evidence with Project Generator readiness.** FE-01–FE-07 and FM-01/FM-02 have local implementation/evidence only, not independent acceptance or release approval; every recipe remains unavailable in normal generation.

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
| FW-REACT | React + Vite | V1 | npm | `create-vite` (React/TS) | Plain CSS, Bootstrap 5 CSS | Forma templates below | PLAN |
| FW-NEXT | Next.js App Router | V1 | npm | `create-next-app` | Tailwind | Forma templates below | PLAN |
| FW-VUE | Vue 3 + Vite | V1 | npm | Official `create-vue` (TypeScript; Vite) | Plain CSS, Bootstrap 5 CSS | No | PLAN |
| FW-NUXT | Nuxt 4 | V1 | npm | `create-nuxt@4.0.3` + immutable `nuxt/starter` commit; Nuxt `4.6.4` | Plain CSS (FE-06 only) | No | PLAN |
| FW-ANGULAR | Angular 21 | V1 | npm | Local `@angular/cli@21.2.30 ng new`; Angular core `21.2.26` | SCSS (FE-07 only) | No | PLAN |
| FW-SVELTE | SvelteKit | Later V1 candidate | npm | Svelte CLI | CSS, Tailwind, SCSS | No | CAT |
| FW-RN | React Native / Expo | V1.1 | npm | `create-expo-app` | NativeWind, StyleSheet | No | FUT |
| FW-FLUTTER | Flutter | V1.1 | pub | Flutter SDK | Material, Cupertino | No | FUT |

**Nuance:** Next/Nuxt already include server/runtime capabilities; selecting no **separate** backend is valid. Angular/React/Vue frontend-only projects still run a dev server, which is not a separately generated API backend.

## 3. Backend

| ID | Backend | Runtime and manager | Scaffolding strategy | Example data integration | State |
|---|---|---|---|---|---|
| BE-EXPRESS | Express | Node.js / npm | Reviewed minimal TS scaffold + official dependencies | Drizzle + SQLite / PostgreSQL; Mongoose + MongoDB | PLAN |
| BE-NEST | NestJS | Node.js / npm | Nest CLI `new` (pinned) | Prisma/PostgreSQL or MySQL; Mongo requires separate verified driver | PLAN |
| BE-FASTIFY | Fastify | Node.js / npm | Official starter or reviewed minimal TS scaffold | Drizzle or Prisma for compatible SQL | PLAN |
| BE-GO | Go standard library | Go / Go Modules | `go mod init` + reviewed starter | `database/sql` + verified SQL driver | PLAN |
| BE-GIN | Go + Gin | Go / Go Modules | `go mod init` + versioned starter | pgx/PostgreSQL, MySQL driver/GORM if specifically tested | PLAN |
| BE-LARAVEL | Laravel | PHP / Composer; npm for frontend assets only | Composer/Laravel official scaffold | Eloquent + MySQL/PostgreSQL/SQLite | PLAN |
| BE-FASTAPI | FastAPI | Python / uv | `uv init` + `uv add` + reviewed application skeleton | SQLAlchemy + SQLite/PostgreSQL/MySQL; Mongo only via separate verified adapter | PLAN |
| BE-DJANGO | Django | Python / uv/pip | Official django-admin | Django ORM | FUT |
| BE-SPRING | Spring Boot | Java / Maven or Gradle | Spring Initializr | JPA / Hibernate | FUT |
| BE-ASPNET | ASP.NET Core | .NET / NuGet | `dotnet new` | EF Core | FUT |

These scaffolding references are directions, not proof that the exact generated API/data access works. Version IDs and CLI flags must be verified during implementation.

## 4. Database + ORM / driver

| Database | Kind | Example supported-by-design combinations | Constraints | State |
|---|---|---|---|---|
| PostgreSQL | SQL | Nest+Prisma; Express+Drizzle; Go+pgx; Laravel+Eloquent; FastAPI+SQLAlchemy | Connection, migrations and service availability validated separately | PLAN |
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
- DB provisioning differs from configuration. For `existing-service`, generator sets connection and validates if reachable; for `docker-compose`, generator may create Compose files, and may start services only after explicit consent.

## 5. Package managers

| Ecosystem | Preselected manager | Alternatives | Compatibility / audit rule |
|---|---|---|---|
| Node web/backend/Expo | **npm** | Yarn, pnpm, Bun | Adapter must declare supported managers and install invocation; write exactly one relevant lockfile |
| PHP/Laravel | Composer | N/A for PHP packages | Laravel may *also* have npm for frontend asset pipeline |
| Go | Go Modules (`go`) | N/A in V1 | `go.mod`, `go.sum`; validate module path |
| Python/FastAPI | uv | pip later if tested | `pyproject.toml` and uv lock; no npm substitute |
| Flutter | pub | N/A | Dart SDK / Flutter checks |
| Java | Maven | Gradle | Future only |
| .NET | NuGet | — | Future only |

Yarn Berry/Modern may need node_modules linker mode for Expo. Do not treat its plug-and-play mode as universally compatible with React Native. Any Node package manager used with Forma must be explicitly supported by the Forma manifest/installer and tested independently.

## 6. Styling & components

Legend: `PLAN` = design-compatible candidate awaiting generator tests; `FUT` = not planned for that release; `BLK` = not applicable/invalid; `COND` = needs independent compatibility gate.

| Framework | Plain CSS / Modules | Tailwind | Bootstrap | SCSS | Component library candidates |
|---|---|---|---|---|---|
| React + Vite | PLAN (FE-01) | BLK | PLAN (FE-04; CSS only) | FUT | shadcn/ui (COND), MUI (COND), Ant Design (COND) |
| Next.js | BLK | PLAN (FE-02) | BLK | FUT | shadcn/ui (COND), MUI (COND) |
| Vue + Vite | PLAN (FE-03) | BLK | PLAN (FE-05; CSS only) | FUT | PrimeVue (COND), Vuetify (COND) |
| Nuxt 4 | PLAN (FE-06) | FUT | FUT | FUT | Nuxt UI (COND), PrimeVue (COND), Vuetify (COND) |
| Angular 21 | FUT | FUT | FUT | PLAN (FE-07) | Angular Material (COND), PrimeNG (COND) |
| SvelteKit | FUT | FUT | FUT | FUT | Future only |
| Expo / React Native | Native StyleSheet | NativeWind FUT | **BLK** (web CSS) | **BLK** (web SCSS) | React Native Paper FUT |
| Flutter | **BLK** (web CSS) | **BLK** | **BLK** | **BLK** | Material/Cupertino FUT |

- Bootstrap can be a separate styling option. Interactive Bootstrap JS must respect the framework lifecycle; `bootstrap.css` alone does not install behavior.
- Phase 04A adds only FE-04/FE-05 Bootstrap CSS integration; Bootstrap JavaScript and Popper are excluded. Bootstrap + Tailwind is blocked, not combined or substituted.
- SCSS is a CSS preprocessor, not a replacement for a component library. Combo choices must be intentionally tested.
- Recommended default = framework-native CSS or verified Tailwind recipe, not a blanket styling default for all languages.
- `Forma` is separate from generic component libraries: template renderer requires a matching framework adapter, component schema and dependency manifest.

## 7. Cross-stack recipe registry (unit of release)

**Every row below remains `PLAN`.** FE-01–FE-07 and FM-01/FM-02 have local implementations and development evidence; FE-06/FE-07 local verification scope and limits are recorded in [Phase 04B evidence](../qa/evidence/phase-04b-nuxt-angular.md). No recipe can be selected for normal generation until independent acceptance evidence is reviewed and status is explicitly promoted.

| Recipe ID | Type | Frontend | Backend | DB / data access | Styling | Manager(s) | Launch target |
|---|---|---|---|---|---|---|---|
| FE-01 | Frontend | React Vite | None | None | CSS | npm | First CLI slice |
| FE-02 | Frontend | Next App Router | None separate | None | Tailwind | npm | First CLI slice |
| FE-03 | Frontend | Vue 3 + Vite | None | None | Plain CSS | npm | Phase 04A |
| FE-04 | Frontend | React + Vite | None | None | Bootstrap 5 CSS | npm | Phase 04A |
| FE-05 | Frontend | Vue 3 + Vite | None | None | Bootstrap 5 CSS | npm | Phase 04A |
| FE-06 | Frontend | Nuxt 4 | None separate | None | CSS | npm | Phase 04B |
| FE-07 | Frontend | Angular 21 | None | None | SCSS | npm | Phase 04B |
| BE-01 | Backend | None | Express | SQLite + Drizzle | N/A | npm | First backend slice |
| BE-02 | Backend | None | NestJS | PostgreSQL + Prisma | N/A | npm | V1 |
| BE-03 | Backend | None | Go + Gin | PostgreSQL + pgx | N/A | go | V1 |
| BE-04 | Backend | None | Laravel | MySQL + Eloquent | N/A | Composer (+ npm assets) | V1 |
| BE-05 | Backend | None | FastAPI | PostgreSQL + SQLAlchemy | N/A | uv | V1 |
| FS-01 | Fullstack | Vue Vite | Laravel | MySQL + Eloquent | Bootstrap | npm + Composer | V1 |
| FS-02 | Fullstack | React Vite | Go Gin | PostgreSQL + pgx | Tailwind | npm + go | V1 |
| FS-03 | Fullstack | Angular | NestJS | PostgreSQL + Prisma | Angular Material | npm | V1 |
| FS-04 | Fullstack | Next App Router | NestJS | PostgreSQL + Prisma | Tailwind | npm | V1 |
| FS-05 | Fullstack | React Vite | Express | MongoDB + Mongoose | Bootstrap | npm | V1 |
| FM-01 | Template | React Vite | None | None | Selected Forma template | npm + Forma installer | V1 integration |
| FM-02 | Template | Next App Router | None separate | None | Selected Forma template | npm + Forma installer | V1 integration |
| MOB-01 | Mobile | Expo | Optional backend later | None | NativeWind / Native default | npm | V1.1 |
| MOB-02 | Mobile | Flutter | Optional backend later | None | Material | pub | V1.1 |

FE-01 evidence: [Windows React + Vite run](../qa/evidence/FE-01/2026-11-11-cli-e2e.md). FE-02 evidence: [Windows Next.js run](../qa/evidence/FE-02/2026-11-11-cli-e2e.md). Both were invoked with `--development-allow-planned`; remain `PLAN` pending the full independent acceptance/review gates.

Phase 04A pins and implementation evidence: [FE-03–FE-05 report](../qa/evidence/phase-04a-vue-bootstrap-expansion.md). Fresh CLI/native desktop acceptance and negative Vue/Forma plan evidence: [acceptance report](../qa/evidence/phase-04a-native-desktop-acceptance.md). Vue uses official `create-vue@3.24.0`; Bootstrap CSS uses `bootstrap@5.3.9`. All three recipes remain `PLAN`; no Forma/Vue compatibility is asserted.

Phase 04B uses official `create-nuxt@4.0.3`, Nuxt `4.6.4`, and immutable `nuxt/starter` commit `db01806fcb37f2e369fb09443c72cac696b31548` for FE-06; FE-07 uses local `@angular/cli@21.2.30` and Angular core `21.2.26`. Fresh CLI and native Tauri acceptance, package/source pins, Angular npm workaround, release planned-gate checks, and bounded limitations: [Phase 04B report](../qa/evidence/phase-04b-nuxt-angular.md). Both recipes remain `PLAN`; no Forma support is asserted.

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
