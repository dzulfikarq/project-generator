# Phase 05C.2 — BE-06 Toolchain & Native Acceptance

| Field | Value |
|---|---|
| Date | 2026-11-15 |
| Baseline | `4c1ec9022fc413ac96aad1d4a17b983c1282ee53` |
| Recipe | BE-06 — standalone FastAPI/Pydantic/Uvicorn + uv; no database/ORM/auth/fullstack |
| Result | **BLOCKED** — official release metadata/checksums matched, but available GitHub attestations could not be fully verified with trusted roots; no binary downloaded or executed |
| Host | Windows `10.0.26300.0`, x64; non-elevated user; Node.js `22.22.1`; npm `10.9.4`; Python `3.15.1`; Rust/Cargo `1.99.1` |

## Toolchain discovery

Prior read-only discovery covered `where.exe`, `py -0p`, known user Python/uv directories, Python Manager cache, uv cache candidates, and installed Python Appx packages. After explicit user authorization, setup created `%LOCALAPPDATA%\FormaForge\toolchains\{uv,python,cache,downloads,evidence}`. Only release metadata/checksum text and host snapshots are in `evidence`; `uv`, `python`, `cache`, and `downloads` remain empty.

- Python launcher registers only Python `3.15.1` at `LOCALAPPDATA\Python\pythoncore-3.15-64\python.exe`; this does not meet BE-06's `>=3.14,<3.15` requirement.
- Python Manager cache contains `pythoncore-3.11-64-3.11.9.zip` and `pythoncore-3.15-64-3.15.1.zip`; no 3.14 archive/runtime found. Python Manager Appx `26.4.240.0` is installed, but `py -0p` still lists only 3.15.1.
- `uv.exe` is absent from PATH, known user install directories, and checked uv caches. No approved `Temp\opencode\tool-cache`, Python, or uv subdirectory exists.
- Current `py -0p` still lists only `3.15.1`; `uv` remains absent. Python 3.15 was used only for a version probe, never for BE-06 generation.

## Authorized release preparation and integrity gate

The user authorized downloads from Astral's official projects. Official GitHub Releases API metadata identified these stable x64 Windows assets:

| Tool | Release / asset | Release API SHA-256 | Published checksum result |
|---|---|---|---|
| uv | [`0.13.8`](https://github.com/astral-sh/uv/releases/tag/0.13.8), `uv-x86_64-pc-windows-msvc.zip` (15,529,884 bytes) | `529e78a9cec6cd7e3e014f7ecd8bda0c113969d4ed0f2efeedb85c30943325b8` | Official `.sha256` asset digest matched GitHub release metadata; published line matched asset digest |
| CPython | [`python-build-standalone` `20261110`](https://github.com/astral-sh/python-build-standalone/releases/tag/20261110), `cpython-3.14.10+20261110-x86_64-pc-windows-msvc-install_only.tar.gz` (51,452,966 bytes) | `b9bee0a6f590914a495a8305701951e543b4475bb620d11661b49052b990456b` | Official `SHA256SUMS` asset digest matched GitHub release metadata; published line matched asset digest |

The text checksum assets were downloaded directly from those release pages to the local toolchain `evidence/` directory. Their SHA-256 values matched release API asset digests (`uv .sha256`: `531d6daee2142f3a2325a08fa0d5d0dd86365ea52b3aebaef2eb055a2d2a63e9`; Python `SHA256SUMS`: `72e29bd6b86194d64eca565416c3cd527c7d41260b445ed56e0f3e721e825e45`). This verifies checksum-file consistency against GitHub metadata, not a signature/trust chain for the binary assets.

Both releases expose GitHub Artifact Attestations. DSSE payload signatures matched embedded public-key certificates, and each attestation subject matched expected asset. Python provenance names official `astral-sh/python-build-standalone` release workflow and includes a Rekor entry. However, no trusted-root verifier (`gh` is absent) was available to verify certificate chains, timestamp material, or Rekor inclusion. The uv attestation uses GitHub's `dotcom.releases.github.com` identity and a GitHub Fulcio intermediate; its root could not be authenticated locally. **Attestation verification is incomplete, so provisioning stopped before downloading either binary, extracting archives, or executing tools.** No unauthenticated checksum was treated as sufficient provenance.

Local evidence files: `%LOCALAPPDATA%\FormaForge\toolchains\evidence\host-before.json`, `host-after.json`, `release-metadata.json`, `uv-x86_64-pc-windows-msvc.zip.sha256`, and `python-build-standalone-SHA256SUMS`. These are not committed.

## Isolation snapshots

- Host was non-elevated. Registry queries captured HKCU/HKLM `Software\Python` in both 32-bit and 64-bit views before and after. HKCU query results were identical; HKLM keys were absent in both views both times. Registry snapshots compared equal.
- User, System, and process PATH strings compared byte-for-byte equal. `py -0p`, `where.exe python`, and `where.exe py` outputs were unchanged; `py -0p` lists only Python 3.15.1.
- Existing Python 3.15.1 remained at `LOCALAPPDATA\Python\pythoncore-3.15-64\python.exe`; SHA-256 `ea34f2b17bafae58479d70d99d55cb01df65400ded3a9465ba7f1c6637adf8bc` and `python --version` output were unchanged.
- No registry, persistent PATH, security setting, Python 3.15 file, or global installation was changed. Requested uv process-scoped variables were **not set** because no uv executable was trusted or run.

## CLI/native status

| Acceptance item | Result |
|---|---|
| Isolated CLI BE-06 plan / Doctor | Prior attempt: plan passed read-only; Doctor correctly reported Python 3.15.1 unsupported and uv missing |
| CLI generation E2E | **BLOCKED** — attestations not fully verified; no toolchain binary downloaded |
| Tauri wizard/plan/consent/generation/result/history/open actions | **BLOCKED / NOT RUN** — no native recipe E2E attempted |
| `uv.lock` creation, hash verification, exact resolved versions | **NOT RUN** — no uv |
| Locked sync / project-local `.venv` / installed pins | **NOT RUN** — no uv or Python 3.14 |
| Invalid/tampered real lock rejection | **NOT RUN** — existing synthetic lock-fixture tests are not real-tool acceptance |
| Python syntax checks and pytest | **NOT RUN** |
| FastAPI server and `/health`, `/api/info`, `/openapi.json` smoke | **NOT RUN** |
| Graceful shutdown, cancellation, collision, rollback, cleanup | **NOT RUN** for BE-06 native generation |
| BE-01/BE-02 fresh native regression E2E | **NOT RUN** — prior recorded evidence unchanged |
| `race-create` journal | **Untouched** — not inspected, modified, or cleaned |

Earlier CLI plan/Doctor config used a unique path under `LOCALAPPDATA\Temp\opencode\phase-05c2-doctor-*`; the directory was removed. No generated project target was created. Release-policy test used its isolated temporary target. `race-create` journal was not inspected, changed, or cleaned.

## Regressions

- `npm test`: PASS — core 51 passed / 1 expected elevated-only skip; CLI 10/10; desktop 15/15. BE-01, BE-02, and BE-06 unit/policy regressions included.
- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm run build --workspace @project-generator/desktop`: PASS.
- Windows supervisor `cargo test --locked`: PASS, 4/4 Rust tests.
- Tauri `cargo test --locked`: PASS, 9/9 Rust tests, including release planned-recipe and consent policy.
- Tauri `cargo test --release --locked`: **BLOCKED before tests** — `build.rs` rejected the existing staged development CLI resource (`release desktop builds reject non-release CLI resources`). This is a fail-closed packaging precondition, not a BE-06 runtime result. The staged resource remained in development profile; no restaging performed.
- Supervisor and Tauri `cargo fmt -- --check`: PASS.
- Supervisor and Tauri Clippy with `-D warnings`: PASS.
- `npm run test:policy:phase-05c1`: PASS — release CLI blocks planned BE-02 and BE-06 before staging despite runtime override attempts. Tauri unit test separately confirms release authorization rejects planned recipes.
- BE-01/BE-02 fresh native generation E2Es were not rerun; prior evidence remains unchanged. No recipe promotion.

## Gate and next step

- **Phase 05C.2 remains BLOCKED.** User approval for Python/uv downloads is already recorded; no re-approval is needed for those assets. Resume only when a trusted GitHub/Sigstore attestation verifier and trust roots are available, then verify both attestations before binary download. Continue entirely under `%LOCALAPPDATA%\FormaForge\toolchains`, with process-only uv variables/PATH, fresh isolated generation targets, and before/after registry/PATH/launcher/Python 3.15 comparisons.
- Then run CLI and actual Tauri E2Es for lock/sync/tampering, pytest, Python validation, API smoke/shutdown, cancellation/collision/rollback/cleanup, and Result/History/Open Folder/VS Code. Retain BE-06 `planned`; independent review remains required. Release-profile Tauri cargo tests also need a reversible, explicit release-resource staging procedure; do not overwrite the staged development resource. Laravel remains separate scope.
