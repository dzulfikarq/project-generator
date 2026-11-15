# Phase 05C.2 — BE-06 Toolchain & Native Acceptance

| Field | Value |
|---|---|
| Date | 2026-11-15 |
| Baseline | `ff50865531294c8a52927b1b2a8779ed777c3c35` |
| Recipe | BE-06 — standalone FastAPI/Pydantic/Uvicorn + uv; no database/ORM/auth/fullstack |
| Result | **BLOCKED** — no compatible Python 3.14 + uv toolchain; no download/install approval |
| Host | Windows `10.0.26300.0`; non-elevated user; Node.js `22.22.1`; npm `10.9.4`; Python `3.15.1`; Rust/Cargo `1.99.1` |

## Toolchain discovery

Read-only checks covered `where.exe`, `py -0p`, known user Python/uv directories, Python Manager cache, uv cache candidates, the approved `LOCALAPPDATA\Temp\opencode` root, and installed Python Appx packages.

- Python launcher registers only Python `3.15.1` at `LOCALAPPDATA\Python\pythoncore-3.15-64\python.exe`; this does not meet BE-06's `>=3.14,<3.15` requirement.
- Python Manager cache contains `pythoncore-3.11-64-3.11.9.zip` and `pythoncore-3.15-64-3.15.1.zip`; no 3.14 archive/runtime found. Python Manager Appx `26.4.240.0` is installed, but `py -0p` still lists only 3.15.1.
- `uv.exe` is absent from PATH, known user install directories, and checked uv caches. No approved `Temp\opencode\tool-cache`, Python, or uv subdirectory exists.
- No compatible Python/uv candidate was available for source or integrity verification. Existing Python 3.15.1 was not used for BE-06 acceptance. No download, install, PATH/registry/security change, or modification of Python 3.15 occurred.

## CLI/native status

| Acceptance item | Result |
|---|---|
| Isolated CLI BE-06 plan | **PASS** — reports planned status and dependencies/network/consent; no project generated |
| Isolated CLI Doctor | **BLOCKED, expected** — correctly reports Python 3.15.1 unsupported and uv missing; test target absent |
| CLI generation E2E | **BLOCKED** — requires Python 3.14.x and uv before staging/install |
| Tauri generation/result/history/open actions | **BLOCKED / NOT RUN** — no native recipe E2E attempted without toolchain |
| `uv.lock` creation, hash verification, exact resolved versions | **NOT RUN** — no uv |
| Locked sync / project-local `.venv` / installed pins | **NOT RUN** — no uv or Python 3.14 |
| Invalid/tampered real lock rejection | **NOT RUN** — existing synthetic lock-fixture tests are not real-tool acceptance |
| Python syntax checks and pytest | **NOT RUN** |
| FastAPI server and `/health`, `/api/info`, `/openapi.json` smoke | **NOT RUN** |
| Graceful shutdown, cancellation, collision, rollback, cleanup | **NOT RUN** for BE-06 native generation |
| BE-01/BE-02 fresh native regression E2E | **NOT RUN** — prior recorded evidence unchanged |
| `race-create` journal | **Untouched** — not inspected, modified, or cleaned |

CLI plan/Doctor config used a unique path under `LOCALAPPDATA\Temp\opencode\phase-05c2-doctor-*`; the directory was removed. No generated project target was created. Release-policy test used its isolated temporary target.

## Regressions

- `npm test`: PASS — core 51 passed / 1 expected elevated-only skip; CLI 10/10; desktop 15/15.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run build --workspace @project-generator/desktop`: PASS.
- Windows supervisor `cargo test --locked`: PASS, 4/4 Rust tests.
- Tauri `cargo test --locked`: PASS, 9/9 Rust tests, including release planned-recipe and consent policy.
- Tauri `cargo test --release --locked`: **BLOCKED before tests** — `build.rs` rejected the already-staged development CLI resource (`release desktop builds reject non-release CLI resources`). This is a fail-closed packaging precondition, not a BE-06 runtime result. Existing staged resource tree was left unchanged.
- Supervisor and Tauri `cargo fmt -- --check`: PASS.
- Supervisor and Tauri Clippy with `-D warnings`: PASS.
- `npm run test:policy:phase-05c1`: PASS — release CLI blocks planned BE-02 and BE-06 before staging despite runtime override attempts.
- BE-06 read-only plan exposed a stale scaffold-stage summary that implied lock resolution before consent. Corrected it to state resolution occurs during install after explicit consent; added regression assertion. npm suite, typecheck/lint, desktop build, and release CLI policy reran after fix. Rust checks used unchanged Rust sources.

## Provisioning plan — approval required

No provisioning is authorized by this evidence. After explicit approval of source and network download:

1. Create unique user-owned root under `%LOCALAPPDATA%\Temp\opencode\phase-05c2-toolchain-*`.
2. Obtain Astral `uv` Windows x64 release; verify published checksum/signature material before extracting the standalone executable.
3. Set `UV_PYTHON_INSTALL_DIR` and `UV_CACHE_DIR` only in the provisioning process. Use uv to install an exact Python 3.14.x managed build; record upstream `python-build-standalone` source, exact version, and published artifact digest.
4. Add those paths to PATH only for isolated CLI/Tauri E2E processes. Do not change persistent PATH, registry, Python 3.15, or Windows security settings.
5. If Astral's managed Python source is not approved, stop and choose another verified Python 3.14 distribution before installing anything.

After provisioning, run CLI and Tauri E2E only under fresh isolated target roots. Keep BE-06 `planned`; independent review remains required. Laravel is separate next-phase scope.
