# Phase 04A — Packaged CLI Security Gate

| Field | Value |
|---|---|
| Status | **PARTIAL — release-profile enforcement and same-host bundled 0.1.2 installer/CLI/IPC acceptance passed; Phase 04B development has independent SCOPED GO; clean-machine and broader release acceptance remain open** |
| Date | 2026-11-14 |
| Baseline | `2cf4e084` |
| Host | Windows 11 `10.0.26300`, x64; Node.js `22.22.1`; npm `10.9.4`; Rust/Cargo `1.99.1` |
| Scope | Planned-recipe CLI override only; no adapter or recipe status changes |

## Finding and fix

The CLI previously accepted `--development-allow-planned` in every build, then passed a runtime boolean to core. Core trusted that boolean, allowing direct use of the packaged CLI to bypass the desktop release check.

- Core build policy is an emitted artifact capability. `npm run build` defaults to `release`; `npm run build:development` explicitly emits internal-development capability. No runtime environment variable controls it.
- CLI registers the override only in development artifacts; a release CLI rejects the flag before reading config. Core independently requires the compiled development capability, even when called directly with `allowPlanned: true`.
- `desktop:dev` explicitly builds development profile. Release packaging rebuilds release profile; Rust `build.rs` rejects missing or non-release staged CLI resources. Tauri IPC still uses `cfg!(debug_assertions)` and rejects release override before writing config or spawning CLI.
- Catalog, plan, and doctor remain read-only and unchanged.

## Verification

- Internal development CLI: controlled FE-01 run completed with recipe status `planned`; scaffold, npm install, lint, typecheck, build, HTTP smoke, and finalize passed. First attempt had `GEN_INSTALL_FAILED`; immediate retry passed. Available npm logs contain no failed install trace, so cause remains unknown; cannot classify as transient or reproducible, and no failure-focused reproduction was run.
- Core tests: 38 passed, 1 expected elevated-only skip. CLI tests: 10 passed, including development override reaching preflight while default generation stays blocked. Desktop tests: 14 passed.
- `npm run typecheck`, `npm run lint`, `cargo test --locked` (9), `cargo test --release --locked` (9), debug/release `cargo clippy --locked -- -D warnings`, `cargo fmt --check`, desktop frontend build, and bundled-mode `cargo build --release --locked`: passed.
- Staged system and bundled release-runtime smoke passed. Direct packaged CLI rejected the override despite `NODE_ENV=development` and attempted `PG_*` profile variables. Without the flag, FE-01–FE-05 and FM-01/FM-02 returned `GEN_RECIPE_UNTESTED`; direct packaged-core invocation with `allowPlanned: true` did likewise. Smoke confirmed no staging/scaffold/install stages, no destination creation, and no extra parent entries.
- Release Rust test confirmed compiled `INTERNAL_DEVELOPMENT_MODE` follows `cfg!(debug_assertions)` and rejects planned override in release profile.

## Limitations

- At the original 04A run, both installer builds stopped because approved portable NSIS 3.13 was unavailable (`PG_NSIS_DIR` unset); no installer was produced at that baseline. The later targeted follow-up below closes same-host bundled-installer acceptance only.
- Independent reviewer verdict: **SCOPED PASS**. The reviewer inspected the staged bundled CLI/core and compiled release Tauri executable, ran the bundled packaged-policy smoke, and found no planned-recipe bypass. No recipe was promoted; public release remains unapproved.

### Independent artifact review

| Artifact | SHA-256 | Reviewer observation |
|---|---|---|
| Staged CLI `dist/src/index.js` | `54D8D3DF512152FE786D52D81207D71110FC6BC7258CD6306341393DF92A7432` | Release flag rejected |
| Staged core `dist/src/build-policy.js` | `EE67E62066F575F74F08D334E70889D6FF3212CC989319BFE194DDA1F665A18D` | `BUILD_PROFILE='release'`; capability `false` |
| Bundled Node `runtime/node.exe` | `923A41F268AB49EDE2E3363FBDD9E790609E385C6F3CA880B4EE9A56A8133E5A` | Node `v22.22.1`; npm `10.9.4` in runtime manifest |
| Compiled Tauri release executable | `DA52F852765DC61DAF250B059265A07E1C8552881B630F3A2A6B11147D36EE5C` | Version `0.1.0`; bundled runtime mode; release denial strings present |

Reviewer reran `node scripts/packaged-cli-policy-smoke.mjs bundled` with harness exit 0. Direct flag and no-flag FE-01–FE-05/FM-01/FM-02 probes returned exit 3 / `GEN_RECIPE_UNTESTED`; direct core call with `allowPlanned: true` also blocked. Probes confirmed no destination/staging writes and cleaned their temporary data. Tauri IPC protection was source-verified (`cfg!(debug_assertions)`), not GUI/IPC-executed.

**Historical limit:** `PG_NSIS_DIR` was unset during the original 04A review; no installer containing that build was produced then. The follow-up below records a fresh 0.1.2 installer test. Clean-machine proof and public release approval remain open.

## Phase 04B targeted acceptance follow-up

| Field | Value |
|---|---|
| Date / baseline | 2026-11-14 / `e66494062002b87382cd4d558356371acb7bcf8c` |
| Host | Windows 11 `10.0.26300`, x64; same developer host, not clean-machine evidence |
| Scope | Actual bundled 0.1.2 installer, installed CLI, release Tauri IPC, planned-recipe denial, same-host uninstall/data preservation; no recipe promotion |

- Approved portable NSIS 3.13 was found under the approved OpenCode temp directory. Archive SHA-256 `BA63DFFC4410EE89193E1CB5A41989991BD77C61068DA17E3156D136B7B0B3D8`; `makensis /VERSION` returned `v3.13`; NSIS executable SHA-1 `6D45D4E8CCF18FE1FDAC9164058F356102A2ECF2`; Tauri utility plugin SHA-1 `75197FEE3C6A814FE035788D1C34EAD39349B860`. No tool was downloaded or installed.
- Built bundled x64 installer `artifacts/phase-02.6/project-generator-bundled-0.1.2-x64-setup.exe` (26,438,740 bytes; SHA-256 `27E2C0D31541FE29A69B5D78DE0BEDC522F87AF9F3E331B465652D37018824A7`).
- Installed CLI smoke against the installed resource tree passed: catalog, plan, and doctor were read-only; release override was rejected; generation for FE-01–FE-05 and FM-01/FM-02 was denied; no staging or target files appeared.
- Launched the installed release Tauri app and exercised its actual WebView IPC. Runtime reported `mode=bundled`, `internalDevelopmentMode=false`, Node `v22.22.1`, and the installed bundled executable path. Catalog/plan/doctor worked read-only. `start_generation` with `allowPlanned=true` returned `DESKTOP_INTERNAL_MODE_REQUIRED`; with `false`, it returned `GEN_RECIPE_UNTESTED`; IPC target remained empty.
- Silent install and uninstall both exited `0`. Bundled Node/npm reported `v22.22.1` / `10.9.4`. Uninstall removed `%LOCALAPPDATA%\\Project Generator` and its HKCU uninstall entry. External project sentinel SHA-256 remained `457970420BFDE1126B3CE53E90540F58EEBA54C3BDDE644E4848237CD5764F8E` before and after.
- Same-host acceptance only. Clean Windows 11 x64 install remains blocked/unavailable. The earlier `GEN_INSTALL_FAILED` remains unexplained; successful retry is not proof of a transient cause.
- Independent Phase 04B development decision: **SCOPED GO** from read-only independent OpenCode review (`ses_e29faff76ffeVKaTE7O3gIzvwT`). Reviewer accepted bounded development despite unresolved `GEN_INSTALL_FAILED`, with failure cause left open and no transient classification. This is agent review, not human/external acceptance. No recipe promotion or Nuxt/Angular/SCSS/Yarn/pnpm implementation authorized by this scoped decision. Public release remains **NO-GO**.
