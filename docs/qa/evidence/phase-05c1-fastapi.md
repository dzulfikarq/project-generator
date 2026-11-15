# Phase 05C.1 — BE-06 FastAPI Implementation Evidence

| Field | Value |
|---|---|
| Date | 2026-11-15 |
| Recipe | BE-06 — standalone FastAPI/Pydantic/Uvicorn + uv; no database/ORM/auth/fullstack |
| Status | Implementation and local regressions present; recipe acceptance **BLOCKED**; no promotion/release approval |
| Host | Windows `10.0.26300.9974`; Node.js `22.22.1`; npm `10.9.4`; Python `3.15.1` (unsupported); uv unavailable; Rust/Cargo `1.99.1` |

## Scope and pins

BE-06 is cataloged as `planned` and normal/release generation remains blocked. The reviewed starter defines `/health`, `/api/info`, `/docs`, OpenAPI, Pydantic HOST/PORT configuration, pytest API and shutdown tests, and an explicit `python -m app` Uvicorn start command. It creates a project-local `.venv`, resolves `uv.lock`, and does not start the service after generation. No database, ORM, authentication, frontend, fullstack, or deployment setup is included.

Python `>=3.14,<3.15` is the acceptance range; uv `>=0.8.0` is required. Current provisional direct pins are FastAPI `0.163.0`, Pydantic `2.14.3`, Uvicorn `0.54.0`, pytest `9.2.0`, and httpx `0.28.1`. PyPI metadata was queried, but these pins have not been resolved/installed together under Python 3.14 and are not acceptance-verified.

Generation explicitly pins PyPI, disables uv configuration and uv-managed Python downloads, scopes uv cache under owned staging, requires `uv lock --check` plus `uv sync --locked --extra test`, validates exact direct lock entries and SHA-256 artifacts, and checks the lock hash did not change during sync. Third-party build code runs unsandboxed; CLI requires `--allow-dependency-scripts` and Tauri forwards affirmative consent. The recipe remains planned even during internal evidence runs.

## Checks run

| Check | Result |
|---|---|
| `npm test` | PASS — core 51 passed / 1 expected elevated-only skip; CLI 10/10; desktop 15/15 |
| `npm run typecheck` | PASS — core, CLI, desktop |
| `npm run lint` | PASS |
| Native supervisor `cargo test --locked` | PASS — 4 Rust tests |
| Native supervisor `cargo fmt -- --check` | PASS after formatting the changed Rust source |
| Native supervisor `cargo clippy -- -D warnings` | PASS |
| Tauri `cargo test --locked` | PASS — 9 Rust tests, including BE-06 selection mapping and planned/consent policy |
| Tauri `cargo fmt -- --check` | PASS |
| Tauri `cargo clippy --all-targets -- -D warnings` | PASS |
| `npm run test:policy:phase-05c1` | PASS — release build denied planned BE-02 and BE-06 before staging despite runtime override attempts |
| BE-06 CLI `plan --json` | PASS — read-only plan reports `planned`, Python/uv requirements, expected files, PyPI network, consent, and execution unavailable |
| BE-06 CLI `doctor --json` | BLOCKED — reports Python `3.15.1` unsupported and uv missing; destination parent valid and target absent |
| Resolver/plan/lock-fixture/consent/native pyproject identity unit coverage | PASS — included in local suites; fixture does not substitute for a real uv lock |

## Acceptance not run / blocked

- No Python 3.14 runtime or uv was provisioned. No global install or unapproved installer was used.
- Real `uv lock`, generated `uv.lock` verification, `uv sync --locked`, package artifact installation, `.venv` validation, Python compile, pytest, and graceful-shutdown test were **NOT RUN**.
- FastAPI `/health`, `/api/info`, `/docs`, OpenAPI, and HTTP shutdown smoke were **NOT RUN**.
- Fresh CLI development generation and Forge Studio/Tauri generation/result/history/Open Folder/VS Code E2E were **NOT RUN**. Tauri Rust unit tests only verify mapping/policy, not native UI execution.
- Python 3.14 Windows wheel availability, package compatibility together, exact lock hashes, generated docs-mode contents, cancellation during uv build, and package integrity after real install remain unverified.
- No independent acceptance, security review, recipe promotion, packaging, push, deployment, or release approval is claimed.

## Recommendation

Keep BE-06 `planned` and release-blocked. Next use approved isolated Python 3.14 + uv provisioning, verify/finalize pins, then run real locked CLI and native Windows E2E plus independent review. Evaluate Laravel separately; no Laravel or database/fullstack work is included here.
