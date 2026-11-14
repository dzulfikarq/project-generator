# Phase 04B.3 — React/Vue Vite Yarn and pnpm Local Acceptance

| Field | Value |
|---|---|
| Status | **PARTIAL — FE-12–FE-15 bounded local CLI and native desktop acceptance passed; independent recipe review and release approval remain open** |
| Date | 2026-11-14 |
| Baseline | `d8338a1ed4efb3dd52eecaa92497eb17ff41d82b` |
| Host | Windows 11 `10.0.26300.9974`, x64, non-elevated |
| Tooling | Node.js `22.22.1`; npm `10.9.4`; Rust/Cargo `1.99.1`; Tauri `2.12.4`; WebView2 `157.0.4341.46` |
| Scope | FE-12 React/Vite + Yarn; FE-13 Vue/Vite + Yarn; FE-14 React/Vite + pnpm; FE-15 Vue/Vite + pnpm; TypeScript + Plain CSS |
| Evidence runs | CLI: `%TEMP%\pg-phase-04b3-cli-qSg0RO`; native: `%LOCALAPPDATA%\Temp\opencode\phase-04b3-native-e2e-20261114 spaces-雪-n9gYZ2` |

## Result

Fresh CLI and native Tauri runs passed all four recipes. Every catalog, plan, manifest, and UI result retained `planned`; normal generation remained blocked. Native runs used the development-only planned-recipe override only after explicit UI consent. Lifecycle-script and planned-run consents defaulted unchecked; lifecycle consent alone kept Generate disabled. No recipe promotion, independent acceptance, security approval, or release approval is claimed.

| Recipe | Manager pin and persisted linker | CLI lock SHA-256 | Native lock SHA-256 |
|---|---|---|---|
| FE-12 — React + Vite + TypeScript + Plain CSS | Yarn `4.18.1`; `nodeLinker: node-modules` in `.yarnrc.yml` | `06e925404ad35a8bef96936b9cffbcb9802a277d15484f9f2fd25d3f66157451` | `462a65815e798a937d0856c5e0b9b889a794e5846893d854a00f40b5ff045718` |
| FE-13 — Vue 3 + Vite + TypeScript + Plain CSS | Yarn `4.18.1`; `nodeLinker: node-modules` in `.yarnrc.yml` | `20750481edde23a42d77944b3c98a75391abd17092579db5b974dbe91734139e` | `2d93726d8ad68b678e8a8d57283eea117dbbde33934307c49efc2cef6aebc57e` |
| FE-14 — React + Vite + TypeScript + Plain CSS | pnpm `11.28.11`; `nodeLinker: hoisted` in `pnpm-workspace.yaml` | `e5f1a0a1e4e0416024d78aca643e3a9fadd01307d6b48e95b55b56d569aaafaf` | `e5f1a0a1e4e0416024d78aca643e3a9fadd01307d6b48e95b55b56d569aaafaf` |
| FE-15 — Vue 3 + Vite + TypeScript + Plain CSS | pnpm `11.28.11`; `nodeLinker: hoisted` in `pnpm-workspace.yaml` | `6b9d653faf1b596c4c90895bff78e0148a8f85add662b374b8c2f7e83498ff9e` | `6b9d653faf1b596c4c90895bff78e0148a8f85add662b374b8c2f7e83498ff9e` |

For each run, the generated manifest's selected-manager version, linker config, and single expected lockfile were checked. The lockfile SHA-256 was recomputed from its bytes and matched the manifest. Both runners passed package-manager integrity, scaffold identity, dependency install, lockfile integrity, ESLint, TypeScript, production build, and HTTP-served-page smoke. CLI reported all eight validation IDs; native result UI showed eight validation events per recipe. README/AGENTS manager commands and linker/lockfile references were checked. Hashes are per-run evidence, not a cross-run determinism guarantee; Yarn lock hashes differed between fresh CLI and native runs.

Native Review/Doctor displayed the selected manager/version, linker config, expected lockfile, and `READY`. Both consent controls were initially closed; one consent alone did not enable generation. Explicit dual consent completed every generation. Four successful native results retained `planned` status and appeared in Recent Projects history. The native destination path included `spaces-雪`; the CLI generated directories under `%TEMP%` without that Unicode-path assertion. Project output directories were removed by each successful harness after recording checksums.

## pnpm linker observation

The first native FE-14 run using pnpm's default isolated layout failed Vite `8.3.8` production build on Node.js `22.22.1` with `ERR_PACKAGE_IMPORT_NOT_DEFINED` for `#module-sync-enabled`. Persisting `nodeLinker: hoisted` in `pnpm-workspace.yaml` and passing `--node-linker=hoisted` to the pinned install resolved the observed failure. FE-14 and FE-15 then passed CLI and native runs. This is a bounded workaround for tested combinations, not a general pnpm/Vite compatibility claim.

## Commands and policy

| Command | Result |
|---|---|
| `npm run test:e2e:phase-04b3:cli` | PASS — four recipes; all listed checks passed; temporary projects and redacted run logs cleaned |
| `npm run test:e2e:phase-04b3:native` | PASS — four native generations, dual-consent gates, results, history, and planned status; temporary projects cleaned |
| `npm test` | PASS — core 42 passed / 1 expected elevated-only skip; CLI 10/10; desktop 14/14 |
| `npm run typecheck` / `npm run lint` | PASS |
| `npm run build --workspace @project-generator/desktop` | PASS |
| `cargo fmt --manifest-path packages/desktop/src-tauri/Cargo.toml -- --check` | PASS |
| `cargo test --locked --manifest-path packages/desktop/src-tauri/Cargo.toml` | PASS — 9/9 |
| `cargo clippy --locked --manifest-path packages/desktop/src-tauri/Cargo.toml --all-targets -- -D warnings` | PASS |
| `npm run build:release` | PASS |
| `scripts/packaged-cli-policy-smoke.mjs system <temporary-release-resources>` | PASS — catalog/plan/Doctor read-only; untrusted environment and planned override rejected; FE-01–FE-15 and FM-01/FM-02 blocked before staging; temporary staged resources cleaned |

Both runners use official `create-vite@9.3.4` / `create-vue@3.24.0`, pinned Yarn `4.18.1` via `@yarnpkg/cli-dist`, and pinned pnpm `11.28.11` via integrity-checked npm package. npm remains the staging/bootstrap manager and Node default; generated project dependencies are installed by the selected manager. Forma remains npm-only. Yarn/pnpm lifecycle scripts are unsandboxed and run only after explicit consent in the native UI.

These checks do not constitute installer, clean-machine, security, or release acceptance. Local evidence does not meet independent review or release gates. All recipes remain `planned`.

## Phase gate

**GO for independent recipe review and acceptance only.** Do not promote FE-12–FE-15 or approve public release. Existing security and clean-machine gates remain open.
