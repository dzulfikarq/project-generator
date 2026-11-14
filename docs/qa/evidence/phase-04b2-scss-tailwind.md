# Phase 04B.2 — React/Vue Vite SCSS and Tailwind Local Acceptance

| Field | Value |
|---|---|
| Status | **PARTIAL — FE-08–FE-11 bounded local CLI and native desktop acceptance passed; independent recipe review and release approval remain open** |
| Date | 2026-11-14 |
| Baseline | `8f7c2f34b54fefb824dd0e48f52c4ebf20cb9953` |
| Host | Windows 11 `10.0.26300.9974`, x64, non-elevated |
| Tooling | Node.js `22.22.1`; npm `10.9.4`; Rust/Cargo `1.99.1`; Tauri `2.12.4`; WebView2 `157.0.4341.46` |
| Scope | FE-08 React/Vite + SCSS; FE-09 Vue/Vite + SCSS; FE-10 React/Vite + Tailwind CSS 4; FE-11 Vue/Vite + Tailwind CSS 4; npm only |
| Evidence roots | CLI: `%TEMP%\phase-04b2-scss-tailwind-cli-e2e-20261114-run3 spaces-雪`; native: `%LOCALAPPDATA%\Temp\opencode\phase-04b2-scss-tailwind-native-e2e-20261114-run2 spaces-雪` |

## Result

Fresh non-elevated CLI and native Forge Studio runs passed for all four combinations. CLI and desktop catalogs/reviews retained `planned`; normal generation remained blocked. The debug-only evidence override was explicitly accepted in the native UI after separately accepting npm lifecycle-script execution. All successful manifests retain `recipeStatusAtCreation: planned`.

| Recipe | Official scaffold and direct style pins | CLI job ID | CLI / native `package-lock.json` SHA-256 |
|---|---|---|---|
| FE-08 — React + Vite + TypeScript + SCSS | `create-vite@9.3.4`; `sass@1.108.2` | `1e742c27-2e08-4956-b9dc-088bbf69f92e` | `81ae432e97856838ebf63718d83c0acb6917b0dfcb03c24511b36ad0ae5177ea` |
| FE-09 — Vue 3 + Vite + TypeScript + SCSS | `create-vue@3.24.0`; `sass@1.108.2` | `c732e227-ffb8-46fb-bbfb-31daf9d1bba9` | `c36b2dc8f9ae74ea954866565b6df3699da69fae8ec86f93f53d13250791dff1` |
| FE-10 — React + Vite + TypeScript + Tailwind CSS | `create-vite@9.3.4`; `tailwindcss@4.3.5`; `@tailwindcss/vite@4.3.5` | `d089da9e-f942-44dd-b02f-caee34af8fbe` | `6e25001f4cf0dfc875942870ce2cc2d8c169f25ef583335f8511d6234891abd1` |
| FE-11 — Vue 3 + Vite + TypeScript + Tailwind CSS | `create-vue@3.24.0`; `tailwindcss@4.3.5`; `@tailwindcss/vite@4.3.5` | `908bfeef-b7ea-4bf7-a6f7-4e3d1dafca3f` | `e144be2ecd2f23f16d26fe89e774c8706b80d3638274578c88a1b1f53dc1199b` |

Each CLI and native output passed scaffold identity, npm install, direct dependency version/integrity, lint, TypeScript check, production build, selected-style output, and local HTTP-served HTML smoke. Generated manifests record all check outcomes and the lockfile hash. SCSS outputs contain `.pg-starter` in production CSS. Tailwind outputs contain `.min-h-screen` and `.max-w-5xl`; both projects use Tailwind v4's official Vite plugin and `@import "tailwindcss"`, with automatic source detection and no legacy config/content globs.

CLI and native lockfile hashes matched for each recipe. Generated project names and parent paths included spaces and `雪`. The exact per-run configs, redacted logs, manifests, and output projects remain under the external evidence roots above; native screenshots cover dashboard, each review/result/history screen.

Summary JSON SHA-256: CLI `0518be79b9096ab035d0c1b369287adcea35b6529df28882bb47fc1ac8b8e5b6`; native `552e78bcc8409b3ac6b61d0cc75f5037c548a3ba371c75f5315bf88e1c764488`. A separate read-only assertion checked each generated README, setup guide, testing guide, manifest status, and documented style pin/validation command.

## Native desktop flow and regressions

- Native Tauri WebView used system runtime on the non-elevated host; runtime reported Node.js `22.22.1` and `internalDevelopmentMode: true`.
- Catalog, framework/style wizard, read-only plan, Doctor, and Review resolved all four recipes. Planned status and expected generated files were visible.
- Lifecycle-script and internal planned-run consents both defaulted unchecked. Generate stayed disabled after lifecycle consent alone and enabled only after both explicit checks.
- Each generation reached **Project checks passed**, preserved planned status, and appeared in Recent Projects history under the expected recipe.
- Framework-switch check: React + Tailwind → Angular removed Tailwind, left SCSS unselected, then switching back to React did not restore a style silently. FE-08 proceeded only after an explicit SCSS choice.
- Unsupported styling combinations were rejected before target writes: Bootstrap + Tailwind, Next.js + SCSS, Nuxt + Tailwind, and Angular + Tailwind. Production-policy tests also checked all FE-08–FE-11 recipes remain blocked before staging.

Initial CLI/native automation attempts exposed runner-only defects before complete acceptance (stale lockfile field and a sidebar click target). Fresh isolated run3/run2 executions corrected the harnesses; only those final runs are counted above. No generator defect was observed.

## Regression checks

| Command | Result |
|---|---|
| `npm test` | PASS — core 41 passed / 1 expected elevated-only skip; CLI 10/10; desktop 14/14 |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS |
| `npm run build --workspace @project-generator/desktop` | PASS |
| `cargo fmt --manifest-path packages/desktop/src-tauri/Cargo.toml -- --check` | PASS |
| `cargo test --locked --manifest-path packages/desktop/src-tauri/Cargo.toml` | PASS — 9/9 |
| `cargo clippy --locked --manifest-path packages/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS |

## Release policy and packaging

- System runtime: packaged CLI policy smoke passed. Catalog, plan, and Doctor stayed read-only; untrusted development environment/override could not enable generation; FE-01–FE-11 and FM-01/FM-02 were blocked before staging.
- System Tauri release tests passed 9/9 with `PG_RUNTIME_MODE=system`. `node scripts/desktop.mjs build system 0.1.0` passed using the cached portable NSIS 3.13 directory after the script's pinned executable/plugin hash checks; no tool installation/download occurred. Installer was built but not installed: `artifacts/phase-02.6/project-generator-system-0.1.0-x64-setup.exe`, 2,443,485 bytes, SHA-256 `be954e02d3b34fa0e3a4c36ff153a258beeea5767e0b0487a172f25088737598`.
- Bundled runtime: packaged CLI policy smoke passed with bundled Node/npm; planned FE/FM runs remained blocked before staging. Tauri release tests passed 9/9 with `PG_RUNTIME_MODE=bundled`; `node scripts/desktop.mjs build bundled 0.1.0` passed using the same hash-verified portable NSIS 3.13. Installer was built but not installed: `artifacts/phase-02.6/project-generator-bundled-0.1.0-x64-setup.exe`, 26,454,746 bytes, SHA-256 `507479cd2d4fb215b0c0cff34b436474dffe49927d9a8d8410eb7dcf5b3a8bd6`.

Recipes remain `planned`; local acceptance is not independent recipe acceptance, support promotion, security approval, or release approval. Lifecycle scripts remain unsandboxed; HTTP smoke verifies served HTML, not browser rendering. Clean-machine and full accessibility review remain open.

## Phase gate recommendation

**GO to Phase 04B.3 for independent review and acceptance only.** Review the four exact recipe tuples, official scaffold and style pins, npm lock integrity, generated docs, native flow, negative compatibility/pre-write tests, and release-policy evidence. Do not add styles/frameworks, modify FE-01–FE-07, promote recipe status, or approve a release in that phase without separate authorization and independent evidence. Public release remains **NO-GO**.
