# Phase 04B — Nuxt and Angular CLI Verification

| Field | Value |
|---|---|
| Status | **PARTIAL — FE-06/FE-07 local CLI generation and recipe checks passed; native desktop acceptance, independent recipe review, and release approval remain open** |
| Date | 2026-11-14 |
| Host | Windows 11 Pro `10.0.26300`, x64, non-elevated |
| Tooling | Portable Node.js `22.22.3`; npm `10.9.8` |
| Scope | FE-06 Nuxt 4 + CSS + npm; FE-07 Angular 21 + SCSS + npm |
| Evidence roots | `E:\MyProjects\pg-phase04b-e2e-clean-20261114`; `E:\MyProjects\pg-phase04b-angular-final-20261114`; `E:\MyProjects\pg-phase04b-final-safety-20261114` |

## Result

Fresh CLI runs passed planning, Doctor, planned-recipe gating, incompatible-style rejection, generation using the development-only override, pinned dependency/integrity checks, recipe checks, Unicode/space-containing destinations, and destination-collision protection. Both jobs completed while recording recipe status `planned`. Collision tests returned `GEN_PATH_EXISTS` and preserved fixture sentinels; generated lockfile and manifest hashes remained unchanged. These are local CLI results only, not native Forge Studio or independent acceptance.

| Recipe | Pins and source | Job / lock SHA-256 | Observed checks |
|---|---|---|---|
| FE-06 | `create-nuxt@4.0.3`; `nuxt@4.6.4`; official `nuxt/starter` commit `db01806fcb37f2e369fb09443c72cac696b31548`; TypeScript `5.9.3`; `vue-tsc@3.3.14` | `ded5e0c1-91ce-4d47-b4f4-4c589b0cfaa2` / `18407296e50c7ed79d811dd369cdc86e79ca50ac7fed7f052c893074a82f1031` | Scaffold identity, dependency install/integrity, typecheck, build, HTTP-served HTML smoke, finalize |
| FE-07 | Local `@angular/cli@21.2.30`; `@angular/core@21.2.26`; SCSS | `15633e83-39d2-4904-9b48-d01fb81de930` / `f18edb818f8c93dd7681eac9f3275da3b21ddc1da9f23054f732b7ece494de2a` | Scaffold identity, dependency install/integrity, build, unit tests, HTTP-served HTML smoke, finalize |

For both recipes, plan reported `planned` and `executionAvailable: false`; Doctor was ready on Node `22.22.3` / npm `10.9.8`. Normal generation returned exit `3` / `GEN_RECIPE_UNTESTED` without creating target. An incompatible style plan returned exit `3` / `GEN_INCOMPATIBLE`, with target unmodified. Development-only generation completed. Lock SHA-256 matched generated provenance in each project. Collision generation returned exit `6` / `GEN_PATH_EXISTS`; each sentinel hash and target entry list stayed unchanged.

## Angular npm workaround

On the pinned Angular CLI scaffold, ordinary npm `10.9.8` install reproducibly failed with `Cannot read properties of null (reading 'edgesOut')`. FE-07 initial install now passes `--legacy-peer-deps`; generated project keeps no `.npmrc` override. The workaround allowed final install and all FE-07 checks above to pass.

In an isolated scaffold reproduction under `E:\MyProjects\pg-phase04b-angular-repro-20261114`, npm `10.9.8` then accepted the generated lock with ordinary `npm install --ignore-scripts`, `npm ci --ignore-scripts`, and `npm ci --dry-run --ignore-scripts`. These lock-compatibility runs did not execute lifecycle scripts; they do not diagnose the underlying npm Arborist failure or constitute a production support claim. Remove the workaround only after ordinary initial install succeeds with the pinned scaffold/toolchain.

The first workaround generation also exposed unsupported Angular CLI `ng serve --no-progress`; removing that flag fixed HTTP smoke. The initial ordinary-install and smoke failures remain recorded in external run logs. npm lifecycle scripts did execute during successful generation under existing explicit-consent policy, without sandboxing; the job emitted `GEN_LIFECYCLE_SCRIPTS` warning.

## Repository verification

- Parallel core test-file execution intermittently failed native stage creation; serial core execution passed. Core test command now uses `--test-concurrency=1`. Root `npm test` then passed: core **40 passed / 1 expected elevated-only skip**, CLI **10/10**, desktop **14/14**. Cancellation, recovery, no-replace finalization, planned gates, and recipe schema regressions included.
- `npm run typecheck`, `npm run lint`, and `npm run build --workspace @project-generator/desktop` passed.
- `cargo fmt --manifest-path native/windows-supervisor/Cargo.toml -- --check` and the equivalent Tauri manifest check passed.
- Native Windows supervisor Cargo tests passed **4/4**; Tauri tests passed **9/9**.
- Native supervisor Clippy and Tauri non-test-target Clippy with `-D warnings` passed. Tauri `--all-targets` exits with `clippy::items_after_test_module` because `main` follows the test module; strict `--all-targets -D warnings` therefore fails on that lint.

## Limits and disposition

- FE-06/FE-07 Forge Studio native UI generation flows were **not run**; Playwright and Edge WebDriver were unavailable. Desktop mapping/unit checks are not native acceptance.
- HTTP smoke verifies an HTML response, not browser rendering, responsive layout, accessibility, or application behavior.
- No backend/database, additional style/framework, manager variation, or recipe promotion was tested. FE-06/FE-07 remain `planned`; normal generation stays blocked.
- The earlier FE-01 `GEN_INSTALL_FAILED` remains unresolved and separate from the reproducible FE-07 npm error. No clean-machine acceptance, independent recipe review, or release approval is claimed.
