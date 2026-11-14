# Phase 04B — Nuxt and Angular Local Acceptance

| Field | Value |
|---|---|
| Status | **PARTIAL — FE-06/FE-07 local CLI and native Tauri generation acceptance passed; independent recipe review, clean-machine/package acceptance, and release approval remain open** |
| Date | 2026-11-14 |
| Host | Windows 11 Pro `10.0.26300`, x64, non-elevated |
| Tooling | System Node.js `22.22.1` / npm `10.9.4`; portable Node.js `22.22.3` / npm `10.9.8`; Rust/Cargo `1.99.1`; Tauri `2.12.4`; WebView2 `157.0.4341.46` |
| Baseline | `68bfc90e24f291f611647de45249063e940a66f5` |
| Scope | FE-06 Nuxt 4 + CSS + npm; FE-07 Angular 21 + SCSS + npm |
| Evidence roots | Prior runs: `E:\MyProjects\pg-phase04b-e2e-clean-20261114`, `E:\MyProjects\pg-phase04b-angular-final-20261114`, `E:\MyProjects\pg-phase04b-final-safety-20261114`; native acceptance: `E:\MyProjects\pg-phase04b-native-acceptance-20261114` |

## Result

Earlier CLI runs passed planning, Doctor, planned-recipe gating, incompatible-style rejection, generation using the development-only override, pinned dependency/integrity checks, recipe checks, Unicode/space-containing destinations, and destination-collision protection. Fresh CLI plus native Tauri acceptance is recorded below. All evidence remains local; it does not promote recipes or replace independent review.

| Recipe | Pins and source | Job / lock SHA-256 | Observed checks |
|---|---|---|---|
| FE-06 | `create-nuxt@4.0.3`; `nuxt@4.6.4`; official `nuxt/starter` commit `db01806fcb37f2e369fb09443c72cac696b31548`; TypeScript `5.9.3`; `vue-tsc@3.3.14` | `ded5e0c1-91ce-4d47-b4f4-4c589b0cfaa2` / `18407296e50c7ed79d811dd369cdc86e79ca50ac7fed7f052c893074a82f1031` | Scaffold identity, dependency install/integrity, typecheck, build, HTTP-served HTML smoke, finalize |
| FE-07 | Local `@angular/cli@21.2.30`; `@angular/core@21.2.26`; SCSS | `15633e83-39d2-4904-9b48-d01fb81de930` / `f18edb818f8c93dd7681eac9f3275da3b21ddc1da9f23054f732b7ece494de2a` | Scaffold identity, dependency install/integrity, build, unit tests, HTTP-served HTML smoke, finalize |

For both recipes, plan reported `planned` and `executionAvailable: false`; Doctor was ready on Node `22.22.3` / npm `10.9.8`. Normal generation returned exit `3` / `GEN_RECIPE_UNTESTED` without creating target. An incompatible style plan returned exit `3` / `GEN_INCOMPATIBLE`, with target unmodified. Development-only generation completed. Lock SHA-256 matched generated provenance in each project. Collision generation returned exit `6` / `GEN_PATH_EXISTS`; each sentinel hash and target entry list stayed unchanged.

## Angular npm workaround

On the pinned Angular CLI scaffold, ordinary npm `10.9.8` install reproducibly failed with `Cannot read properties of null (reading 'edgesOut')`. FE-07 initial install now passes `--legacy-peer-deps`; generated project keeps no `.npmrc` override. The workaround allowed final install and all FE-07 checks above to pass.

In an isolated scaffold reproduction under `E:\MyProjects\pg-phase04b-angular-repro-20261114`, npm `10.9.8` then accepted the generated lock with ordinary `npm install --ignore-scripts`, `npm ci --ignore-scripts`, and `npm ci --dry-run --ignore-scripts`. These lock-compatibility runs did not execute lifecycle scripts; they do not diagnose the underlying npm Arborist failure or constitute a production support claim. Remove the workaround only after ordinary initial install succeeds with the pinned scaffold/toolchain.

The first workaround generation also exposed unsupported Angular CLI `ng serve --no-progress`; removing that flag fixed HTTP smoke. The initial ordinary-install and smoke failures remain recorded in external run logs. npm lifecycle scripts did execute during successful generation under existing explicit-consent policy, without sandboxing; the job emitted `GEN_LIFECYCLE_SCRIPTS` warning.

## Native Windows acceptance follow-up

Fresh non-elevated CLI and actual Tauri/WebView2 runs used clean targets below paths containing spaces and `雪`, Node `22.22.3`, npm `10.9.8`, and the existing internal development-only planned-recipe override. Plan and Doctor remained read-only; both plans reported `planned`, normal generation returned `GEN_RECIPE_UNTESTED` without staging or target creation, and Doctor reported Node/npm versions plus ready destination.

| Recipe | CLI job / lock SHA-256 | Native Tauri job / lock SHA-256 | Passed generated checks |
|---|---|---|---|
| FE-06 | `31d4e4b8-af89-4425-8af4-9c8ebee48f9d` / `5fdee0acaba8dc7e9b0b47ed54cf1b8e97fdee2989729ff455c119609a07f748` | `cb503427-393f-4920-a4f6-f9504f939508` / `8ce337fb9240c1f2366ec72d199363a472be465e22859ecdcffb987519a0ba94` | Scaffold identity, install, integrity, Nuxt typecheck, production build, HTTP HTML smoke |
| FE-07 | `be636879-de4a-42fd-802c-546847f758ff` / `a3fca8782ef4cb8b7a7b1ab84386a356932b38879be4963c3f6eaa4b985c9e95` | `723f14b2-7b51-4535-ba01-e281cded450a` / `0fc70b93a5ed9fc7d63b2276f80920ad236ca2c372497be194110504660d44a6` | Scaffold identity, install, integrity, Angular production build/compiler checks, unit tests, HTTP HTML smoke |

Native catalog listed Nuxt 4 and Angular 21 as planned. Wizard compatibility was exact: Nuxt Plain CSS only; Angular SCSS only; unsupported styles, non-npm managers, and all Forma templates were disabled. Changing to Angular did not silently replace the initial styling choice: npm stayed disabled until SCSS was explicitly selected. Both plans displayed `READY`, Node `22.22.3`, npm `10.9.8`, and a safe absent target. Lifecycle and internal-evidence consents started unchecked; Generate stayed disabled until both were explicitly checked. Live progress showed real CLI job/stage/check events and `GEN_LIFECYCLE_SCRIPTS`; both result pages said checks passed while retaining planned status.

Explorer and VS Code opened each generated target from both Result and History. The FE-06 native activity log contains 23 sequenced JSONL events; FE-07 rendered 21 activity events. Standard documentation and package scripts matched actual support. Neither official starter defines a lint script; Nuxt supplies `typecheck`, build, dev/preview scripts, while Angular uses `ng build` (including Angular compiler/type validation) and `ng test`. Nuxt's generated `package.json` has no `packageManager` field; npm was observed through the lockfile, generator manifest, and successful npm execution. Angular does include `npm@10.9.8` in its package metadata.

Both CLI targets rejected collisions with `GEN_PATH_EXISTS` and unchanged target inventories. CLI plans rejected incompatible styling and Forma combinations with `GEN_INCOMPATIBLE`. The native parent retained the pre-run sibling sentinel with SHA-256 `9b351018bcaa5a8c278abc02dadc84e17cfc3200e7914d91d266cd28e1c6559d`; final parent contained only the two owned project targets and sentinel, with no staging/journal residue. This is a bounded observed-write check, **not** proof of filesystem isolation: npm lifecycle scripts remain unsandboxed.

Detailed JSON summaries, logs, and screenshots are retained under the native acceptance evidence root, including `cli-e2e-summary.json`, `desktop-e2e-summary.json`, `FE-06-desktop-actions.json`, `FE-06-desktop-result.png`, `FE-07-desktop-result.png`, catalog/review captures, and release-policy smoke output.

## Repository verification

- `npm test` — exit `0`: core **40 passed / 1 expected elevated-only skip**, CLI **10/10**, desktop **14/14**. Cancellation, recovery, no-replace finalization, planned gates, and FE-01–FE-07 schema regressions included.
- `npm run typecheck`, `npm run lint`, and `npm run build --workspace @project-generator/desktop` — each exit `0`.
- `cargo fmt --manifest-path packages/desktop/src-tauri/Cargo.toml -- --check`, `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml`, and `cargo clippy --manifest-path packages/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` — each exit `0`; Tauri tests **9/9**. Clippy fix moved `main()` above the trailing test module; no lint suppression added.
- With `PG_RUNTIME_MODE=system`, `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml --release` (**9/9**) and `cargo build --manifest-path packages/desktop/src-tauri/Cargo.toml --release` — each exit `0` against staged release-profile CLI resources.
- `node scripts/packaged-cli-policy-smoke.mjs system` — exit `0` for FE-01–FE-07 and FM-01/FM-02. FE-06/FE-07 override attempts returned `GEN_RECIPE_UNTESTED` before execution; normal help omitted the development switch. Release Tauri authorization test confirmed planned override rejected when `internalDevelopmentMode=false`.
- `npm run desktop:build:system` — exit `1` only after release CLI smoke passed and before installer bundling: approved portable NSIS unavailable (`PG_NSIS_DIR` unset). No installer was produced or deployed.

## Limits and disposition

- HTTP smoke verifies an HTML response, not browser rendering, responsive layout, accessibility, or application behavior. The native acceptance drove the Tauri WebView through local CDP; it was not browser-rendering acceptance.
- No backend/database, additional style/framework, manager variation, or recipe promotion was tested. FE-06/FE-07 remain `planned`; normal generation stays blocked.
- Lifecycle scripts remain unsandboxed; no absolute outside-write guarantee is claimed. Cancellation/rollback behavior was not rerun per recipe because this change only reorders Rust declarations; existing regression suite passed.
- Release installer packaging remains blocked on approved NSIS tooling. The earlier FE-01 `GEN_INSTALL_FAILED` remains unresolved and separate from the reproducible FE-07 npm error. No clean-machine acceptance, independent recipe review, or release approval is claimed.
