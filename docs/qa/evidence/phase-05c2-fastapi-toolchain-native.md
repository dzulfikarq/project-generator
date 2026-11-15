# Phase 05C.2 — BE-06 Portable Toolchain and Native Acceptance

| Field | Value |
|---|---|
| Date | 2026-11-15 |
| Baseline | `57816b0e53c865f0be910b1d3f3b14705110a326` |
| Recipe | BE-06 — standalone FastAPI/Pydantic/Uvicorn + uv; no database, ORM, auth, frontend, or fullstack |
| Result | **Bounded local CLI and native Tauri evidence PASS.** Independent acceptance, recipe promotion, and public release remain **NO-GO**. |
| Host | Windows `10.0.26300.0`, x64, non-elevated; Node.js `22.22.1`; npm `10.9.4`; Rust/Cargo `1.99.1`; WebView2 `157.0.4341.46` |

This report records observed local behavior only. BE-06 remains `planned`; passed local checks do not establish independent acceptance or release readiness.

## Portable toolchain provenance

Tools and caches stayed under `%LOCALAPPDATA%\FormaForge\toolchains`. No binaries, Python environment, uv cache, or provenance bundles were added to the repository.

| Tool | Artifact | SHA-256 | Verification / observed version |
|---|---|---|---|
| GitHub CLI | `gh 2.104.0`, Windows x64 | Extracted `gh.exe`: `E01056748FF8900323ABA76D4E0E0295934A95B2819D34E310F511A3A8E31E39` | Official release metadata/checksum matched; extracted binary Authenticode status `Valid`, signer GitHub, Inc. |
| CPython | `python-build-standalone` release `20261110`, `3.14.10` Windows x64 | `b9bee0a6f590914a495a8305701951e543b4475bb620d11661b49052b990456b` | Offline `gh attestation verify` exit `0`; subject and exact `astral-sh/python-build-standalone/.github/workflows/release.yml` identity matched. Repository ID `162334160` cross-checked online. |
| uv | `0.13.8` Windows x64 | `529e78a9cec6cd7e3e014f7ecd8bda0c113969d4ed0f2efeedb85c30943325b8` | Offline `gh attestation verify` exit `0`; subject and exact `astral-sh/uv/.github/workflows/release.yml` identity matched. Repository ID `699532645` cross-checked online. |

GitHub CLI bootstrap checksum and release API digest share GitHub's trust boundary; extracted `gh.exe` Authenticode verification adds a separate signer check. Python and uv attestations were verified against the local GitHub/Sigstore verifier trust roots and exact repository/workflow identities. This does not claim an independent publisher or registry review.

Observed binaries: `Python 3.14.10`; `uv 0.13.8 (3d97a6aad 2026-11-12 x86_64-pc-windows-msvc)`. Provenance bundles, checksums, and detailed verifier output remain local under `toolchains/evidence/`.

## Isolation checks

- The host remained non-elevated. Before/after snapshots matched for User, System, and process PATH; Python registry views; `py -0p`; Python launcher resolution; and Python `3.15.1` version and SHA-256 (`ea34f2b17bafae58479d70d99d55cb01df65400ded3a9465ba7f1c6637adf8bc`).
- `py -0p` still lists only system-managed Python `3.15.1`; it was not used for BE-06 generation. Process PATH in generation runs prepended only the approved portable Python/uv directories. User/System PATH and registry were not changed.
- uv ran with process-scoped isolation: `UV_PYTHON_NO_REGISTRY=1`, `UV_PYTHON_DOWNLOADS=never`, `UV_NO_MANAGED_PYTHON=1`, and a cache under the approved toolchain root. No global install, registry, security setting, or `race-create` recovery action occurred.

## CLI acceptance

Harnesses and logs are under `%LOCALAPPDATA%\FormaForge\toolchains\evidence\phase-05c2-cli-*`. CLI target was a fresh directory under `%LOCALAPPDATA%\Temp\opencode\phase-05c2-cli-e2e-20261115 spaces-雪`.

| Check | Observed result |
|---|---|
| Plan / Doctor | Read-only plan passed; Doctor found Python `3.14.10`, uv `0.13.8`, and absent target. Recipe and manifest status remained `planned`. |
| Generation | Exit `0`, job `569c2d20-025d-4d0c-a492-e16038deaee8`; generated `uv.lock`, project-local `.venv`, docs, and manifest. |
| Lock / install | `uv.lock` SHA-256 and manifest lock hash both `4d29a564706dc7663de49730ccaf2f53193ad3899d6a6d1fcfca2fb25f94ded2`. Locked sync and clean-venv reinstall exited `0`; exact direct pins and artifact hashes verified. |
| Python checks | `compileall` passed; pytest `4 passed` with one upstream Starlette/httpx deprecation warning; installed direct versions matched pins. |
| API / shutdown | `/health`, `/api/info`, `/docs`, `/openapi.json`, and graceful shutdown checks passed. |
| Tampered lock | uv rejected altered wheel/version metadata, exit `2`; no silent lock regeneration. |
| Collision | Exit `6`, `GEN_PATH_EXISTS`; sentinel SHA-256 `5efe793f1bdbfadcd8f0005754f335fb8bfb410155ffd3c844e08ceba75c7fb6` unchanged; no owned staging left. |
| Cancellation | Job `694b7ddf-dd5a-4551-bd6e-bd9a5d5b5bcd` cancelled during validation, exit `5`; target absent and owned staging removed. |

## Native Tauri acceptance

Harness: `node scripts/phase-05c2-native-e2e.mjs`, exit `0`. Tauri used a unique app identifier and WebView2 profile, Vite `127.0.0.1:1427`, DevTools `127.0.0.1:9357`, and Cargo target under `%LOCALAPPDATA%\FormaForge\toolchains\cache\cargo-phase-05c2-native`. The existing port `1420` app was not stopped or reused. Staged CLI build-policy SHA-256 stayed `F6F81AD2C96FBFC3AE8ADDC9D500623E32FDA43939696B58A9184402E32A350F` before/after; staged profile remained development-only.

- Wizard plan/Doctor showed Python `3.14.10`, uv `0.13.8`, Python/uv prerequisites, `uv.lock`, and BE-06 `planned` status.
- Lifecycle/build-code and planned-recipe consent both started unchecked. Lifecycle consent alone kept Create disabled; generation proceeded only after both were explicitly checked.
- Generation result and History reported passing checks while retaining `planned`. Open Folder and Open in VS Code actions succeeded.
- Native manifest SHA-256: `88dfc89cea3b31f2f28b2ce3dc03a2ecfda03793f79fcd82aad3ae9e29987483`. Native `uv.lock` SHA-256: `b960bd9912c3e9513f0d614550f43fcc7b16cc624d605dc14f48fa1857036627`.
- All required manifest validations passed: `scaffold-identity`, `uv-lock`, `dependency-install`, `dependency-integrity`, `lockfile-integrity`, `python-syntax`, `pytest`, `graceful-shutdown`, `http-smoke`, and `openapi`.
- Cancellation was requested after `installing started.`; target stayed absent, owned staging was removed, and recovery inspection found no record for that cancelled target.
- Collision Doctor blocked the pre-existing target before generation; sentinel stayed unchanged and no staging appeared. Native E2E removed its successful-run temp root after checks.
- Read-only recovery inspection also surfaced an unrelated pre-existing `race-create` / `parentUnverifiable` / `createIntent` record. It was left untouched.

The detailed native run record and JSON output remain under `%LOCALAPPDATA%\FormaForge\toolchains\evidence\phase-05c2-20261115-161623-*`; generated projects and the isolated WebView profile are not committed.

## Regressions and limits

- `npm run test:policy:phase-05b`: PASS; release CLI blocked planned BE-02 before staging despite override attempts.
- `npm run test:policy:phase-05c1`: PASS; release CLI blocked planned BE-02 and BE-06 before staging despite override attempts.
- `npm test`: PASS — core 51 passed / 1 expected elevated-only skip; CLI 10/10; desktop 15/15. Includes BE-01/BE-02 resolver, model, consent, and planned-policy regressions.
- `npm run typecheck`, `npm run lint`, and desktop production build: PASS.
- Windows supervisor `cargo test --locked`: 4/4; Tauri `cargo test --locked`: 9/9. Both `cargo fmt -- --check` and Clippy `--all-targets -- -D warnings`: PASS. Rust checks used the isolated toolchain Cargo target.
- Fresh BE-01/BE-02 native generation E2Es were not rerun in this phase; prior evidence remains unchanged. `race-create` was not modified or cleaned.
- Tauri release-profile tests remain blocked by the existing development-profile staged CLI resource. No release resource was restaged or overwritten.
- No database/ORM/auth/fullstack, Laravel, push, deploy, or server auto-start was implemented or tested. Direct pins remain provisional pending independent review.

## Gate

**Phase 05C.2 bounded local evidence: PASS. BE-06 remains `planned`; promotion and public release remain NO-GO.** Independent review, pin review, and existing security/clean-machine gates remain open. Portable tools, caches, and evidence stay outside the repository.
