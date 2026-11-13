# Phase 02.6 — Desktop Runtime and Packaging PoC

| Field | Value |
|---|---|
| Date | 2026-11-13 |
| Status | **PARTIAL PoC evidence; no clean-machine proof, no runtime decision approval, no release approval** |
| Host | Windows 11 Pro `10.0.26300`, x64 |
| Scope | Internal Tauri 2 shell; system-Node vs bundled-Node NSIS packaging |

## Result

Both x64 NSIS variants built from the same 0.1.1 source. The system package omits Node; the bundled package contains Node.js and its matching npm. Bundled CLI `catalog` and `doctor` worked with `PATH` reduced to `%SystemRoot%\System32`, proving this CLI path does not depend on system Node being discoverable. This was a developer-host test, not a clean-machine acceptance run.

| Same-version artifact | Bytes | MiB | SHA-256 |
|---|---:|---:|---|
| `project-generator-system-0.1.1-x64-setup.exe` | 2,258,037 | 2.153 | `5C3969E96842D652B8B2FF0256AF485E4C6AEC84F15021E56723BF65D15F6FFC` |
| `project-generator-bundled-0.1.1-x64-setup.exe` | 26,259,213 | 25.043 | `08B39C05C0928539726370E32FE916F60BFD959CDAD676C0EDDBBA0EF28564BC` |

Bundled delta: 24,001,176 bytes / 22.889 MiB / 11.63× system installer size. This measures these PoC artifacts only; it is not an installed-footprint or performance benchmark.

Install-sequence system 0.1.0 artifact: 2,260,602 bytes; SHA-256 `9E114FC88824160AB7BA50DBA61A38DF83E88434C8A850AAB0A35D9755284702`.

## Build inputs and commands

- Node.js `22.22.1`; npm `10.9.4`; Rust/Cargo `1.99.1`.
- `@tauri-apps/api` and `@tauri-apps/cli` `2.12.4`; React `19.3.1`; Vite `8.3.8`; locked Rust Tauri resolved to `2.12.5`.
- NSIS `3.13`, used from approved user-temp; no machine-wide NSIS installation.
  - Archive SHA-256: `BA63DFFC4410EE89193E1CB5A41989991BD77C61068DA17E3156D136B7B0B3D8`.
  - Tauri-pinned archive SHA-1: `EF7FF767E5CBD9EDD22ADD3A32C9B8F4500BB10D`.
  - `NSIS.exe` SHA-1: `6D45D4E8CCF18FE1FDAC9164058F356102A2ECF2`.
  - `nsis_tauri_utils.dll` SHA-1: `75197FEE3C6A814FE035788D1C34EAD39349B860`.
- Build commands:

```powershell
$env:PG_NSIS_DIR = '<approved portable NSIS 3.13 directory>'
node scripts/desktop.mjs build system 0.1.1
node scripts/desktop.mjs build bundled 0.1.1
```

- NSIS script and installed files retained `resources/pg-runtime/cli`, `resources/pg-runtime/runtime`, and `resources/pg-runtime/catalog.json`; packaged CLI included the native Windows supervisor.
- Bundled runtime manifest recorded Node `22.22.1` and npm `10.9.4`. `node.exe --version`, bundled `npm-cli.js --version`, and packaged CLI catalog passed.
- Build artifacts are ignored local files under `artifacts/phase-02.6/`; installers are not committed or distributed.

## Install/update/uninstall checks

Performed under one standard user on the same Windows 11 host, using the NSIS per-user install mode and silent install/uninstall switches:

1. Installed system-Node 0.1.0; installer exit `0`. Install location was `%LOCALAPPDATA%\Project Generator`; registry entry was HKCU only. Runtime manifest said `system`; no `runtime/node.exe` was present. Packaged CLI catalog returned schema 1 and two planned recipes.
2. Launched system app; visible window title was `Project Generator - Internal PoC`.
3. Updated in place with bundled-Node 0.1.1; installer exit `0`. Executable reported product version `0.1.1`; runtime manifest said `bundled`. Packaged Node/npm reported `v22.22.1` / `10.9.4`; packaged CLI catalog passed.
4. Packaged system and bundled CLI plan/doctor passed against an empty target under a temporary test parent. Doctor reported Node/npm `22.22.1` / `10.9.4`, ready `true`; plan retained recipe status `planned` and `executionAvailable: false`. No output project was created.
5. With `PATH` set only to `%SystemRoot%\System32`, installed bundled CLI catalog and doctor still passed; doctor reported ready `true`.
6. Existing-target doctor check exited `3`, reported `Destination already exists`, and left the separate test project's `user-data.txt` content unchanged.
7. Launched updated 0.1.1 app; visible PoC window appeared.
8. Uninstalled 0.1.1; uninstaller exit `0`, install directory and HKCU uninstall entry were removed. Separate project sentinel remained `preserve-this-project`.

The release-profile installers correctly kept planned-recipe override unavailable. No generation job or third-party lifecycle script ran during packaging checks. Full UI-driven cancellation and generation were not exercised.

## Checks

| Check | Result |
|---|---|
| `npm test` | PASS — core 38 passed, 1 expected elevated-only skip; CLI 8 passed |
| `npm run typecheck` | PASS — core, CLI, desktop |
| `npm run lint` | PASS |
| `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml --locked` | PASS — 5 Rust tests |
| `cargo clippy --manifest-path packages/desktop/src-tauri/Cargo.toml --locked -- -D warnings` | PASS |
| `cargo fmt --manifest-path packages/desktop/src-tauri/Cargo.toml --all -- --check` | PASS |
| System and bundled release installer builds | PASS — x64 NSIS |
| `npm audit --omit=dev --audit-level=moderate` | PASS — 0 production dependency findings |

Full `npm install` audit reported 9 moderate development-dependency findings; they were not auto-fixed as that would require a breaking ESLint change.

## Limits and decisions

- Host was Windows 11 but not clean: Node, npm, Git/GCM, Rust and developer tooling were installed. No clean Windows 11 environment was available; **PKG-004 remains BLOCKED**.
- No second-user ACL test, GUI launch with Node removed from PATH, independent security review, digital signing, WebView2 clean-install prerequisite test, UI scaling/accessibility review, window-close cancellation test, or UI-driven cancellation test.
- System runtime is discovered from `PATH`; executable provenance is not independently verified. Bundling removes the external Node prerequisite in the tested CLI path but adds about 22.89 MiB and does not sandbox generated code.
- Windows Job Objects supervise child lifetime; npm lifecycle scripts remain unsandboxed and run with current-user permissions. The consent checkbox is unchecked by default.
- FE-01/FE-02/FM-01/FM-02 remain `planned`; no recipe promotion. OPEN-001 remains open. DEC-011 and DEC-013 remain proposed; DEC-019 records this comparison without choosing a release strategy.
- Public release remains **NO-GO**. No push or deployment performed.
