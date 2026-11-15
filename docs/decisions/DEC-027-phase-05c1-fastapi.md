# DEC-027 — Phase 05C.1 Standalone FastAPI REST API

| Field | Value |
|---|---|
| Status | User-authorized scoped implementation present; Phase 05C.2 bounded local CLI/native evidence passed; independent review and recipe acceptance pending |
| Date | 2026-11-15 |
| Scope | BE-06 standalone FastAPI/Pydantic/Uvicorn API; no database, ORM, authentication, frontend, or fullstack |
| Evidence | [Phase 05C.1 implementation evidence](../qa/evidence/phase-05c1-fastapi.md); [Phase 05C.2 toolchain and native evidence](../qa/evidence/phase-05c2-fastapi-toolchain-native.md) |

## Decision

- Integrate BE-06 through the existing catalog, strict resolver, read-only plan/Doctor, owned staging, supervised CLI job, generated docs/manifest, and Forge Studio/Tauri path.
- Use Python `>=3.14,<3.15` as the acceptance baseline and uv `>=0.8.0`. Require user-managed tools; automatic Python downloads are disabled.
- Use a reviewed built-in application skeleton with FastAPI `0.163.0`, Pydantic `2.14.3`, Uvicorn `0.54.0`, pytest `9.2.0`, and httpx `0.28.1`. These direct pins are provisional until locked resolution, Python 3.14 Windows installation, and recipe checks pass.
- Resolve `uv.lock` from the pinned `pyproject.toml`, require exact direct package versions and SHA-256 artifact hashes, then install only with `uv sync --locked --extra test` into project-local `.venv`. Use PyPI explicitly, isolate uv cache under owned staging, and reject stale/missing locks.
- Require explicit `--allow-dependency-scripts` consent before CLI/Tauri generation because package build code runs unsandboxed. Do not run a server after generation.
- Generate `/health`, `/api/info`, `/docs`, OpenAPI, pytest API coverage, and a Uvicorn graceful-shutdown test. Keep `/health` and `/api/info` HTTP smoke checks within the owned staging job.
- Keep BE-06 `planned`. Normal/release generation remains blocked; development override gathers evidence only. Do not add DB, ORM, authentication, Docker, deployment, Laravel, or fullstack scope.

## Rationale and limits

FastAPI has no suitable official project generator for this bounded output, so use a small reviewed first-party starter rather than execute a third-party scaffold. uv remains the native Python package/lock manager. Phase 05C.2 provisioned isolated CPython 3.14.10 and uv 0.13.8 after bounded release/attestation verification, then passed local CLI and native Tauri checks, including generated lock, locked installation, Python checks, HTTP/OpenAPI smoke, shutdown, cancellation, and collision checks. Direct pins and independent acceptance remain open; process supervision is not a sandbox.

## Phase gate

**GO for bounded local evidence only. NO-GO for recipe promotion or public release.** Keep BE-06 `planned`; next: independently review direct pins, trust/provenance boundary, and local acceptance evidence. Evaluate Laravel separately; no Laravel implementation is authorized here.
