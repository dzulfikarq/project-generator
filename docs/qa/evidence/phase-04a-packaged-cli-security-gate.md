# Phase 04A — Packaged CLI Security Gate

| Field | Value |
|---|---|
| Status | **PARTIAL — release-profile enforcement implemented; staged bundled runtime and compiled Tauri release executable independently reviewed (scoped PASS); NSIS installer and broader release acceptance remain open** |
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

- Internal development CLI: controlled FE-01 run completed with recipe status `planned`; scaffold, npm install, lint, typecheck, build, HTTP smoke, and finalize passed. First attempt had `GEN_INSTALL_FAILED`; immediate retry passed. Cause of first failure was not established.
- Core tests: 38 passed, 1 expected elevated-only skip. CLI tests: 10 passed, including development override reaching preflight while default generation stays blocked. Desktop tests: 14 passed.
- `npm run typecheck`, `npm run lint`, `cargo test --locked` (9), `cargo test --release --locked` (9), debug/release `cargo clippy --locked -- -D warnings`, `cargo fmt --check`, desktop frontend build, and bundled-mode `cargo build --release --locked`: passed.
- Staged system and bundled release-runtime smoke passed. Direct packaged CLI rejected the override despite `NODE_ENV=development` and attempted `PG_*` profile variables. Without the flag, FE-01–FE-05 and FM-01/FM-02 returned `GEN_RECIPE_UNTESTED`; direct packaged-core invocation with `allowPlanned: true` did likewise. Smoke confirmed no staging/scaffold/install stages, no destination creation, and no extra parent entries.
- Release Rust test confirmed compiled `INTERNAL_DEVELOPMENT_MODE` follows `cfg!(debug_assertions)` and rejects planned override in release profile.

## Limitations

- Both `desktop:build:system` and `desktop:build:bundled` staged and passed packaged-runtime smoke, then stopped because approved portable NSIS 3.13 was unavailable (`PG_NSIS_DIR` unset). No NSIS installer artifact was produced. Bundled release Tauri executable and staged resources were built and remain available for independent inspection.
- Independent reviewer verdict: **SCOPED PASS**. The reviewer inspected the staged bundled CLI/core and compiled release Tauri executable, ran the bundled packaged-policy smoke, and found no planned-recipe bypass. No recipe was promoted; public release remains unapproved.

### Independent artifact review

| Artifact | SHA-256 | Reviewer observation |
|---|---|---|
| Staged CLI `dist/src/index.js` | `54D8D3DF512152FE786D52D81207D71110FC6BC7258CD6306341393DF92A7432` | Release flag rejected |
| Staged core `dist/src/build-policy.js` | `EE67E62066F575F74F08D334E70889D6FF3212CC989319BFE194DDA1F665A18D` | `BUILD_PROFILE='release'`; capability `false` |
| Bundled Node `runtime/node.exe` | `923A41F268AB49EDE2E3363FBDD9E790609E385C6F3CA880B4EE9A56A8133E5A` | Node `v22.22.1`; npm `10.9.4` in runtime manifest |
| Compiled Tauri release executable | `DA52F852765DC61DAF250B059265A07E1C8552881B630F3A2A6B11147D36EE5C` | Version `0.1.0`; bundled runtime mode; release denial strings present |

Reviewer reran `node scripts/packaged-cli-policy-smoke.mjs bundled` with harness exit 0. Direct flag and no-flag FE-01–FE-05/FM-01/FM-02 probes returned exit 3 / `GEN_RECIPE_UNTESTED`; direct core call with `allowPlanned: true` also blocked. Probes confirmed no destination/staging writes and cleaned their temporary data. Tauri IPC protection was source-verified (`cfg!(debug_assertions)`), not GUI/IPC-executed.

**Limit:** `PG_NSIS_DIR` was unset. No installer containing this executable was produced or reviewed; older installers predate this fix. Installer verification and release approval remain open.
