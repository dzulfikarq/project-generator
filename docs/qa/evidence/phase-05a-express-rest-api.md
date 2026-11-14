# Phase 05A — BE-01 Express REST API Local Evidence

| Field | Value |
|---|---|
| Date | 2026-11-14 |
| Host | Windows 11 Pro `10.0.26300`, x64; non-elevated local developer host |
| Runtime | Node.js `22.22.1`; npm `10.9.4`; Rust/Cargo `1.99.1` |
| Recipe | BE-01 — standalone Express + TypeScript + npm; database excluded |
| Status | Local acceptance passed for listed scope; recipe remains `planned`; no release approved |

## Pins and implementation scope

- Node.js `>=22.13.0`; npm.
- `express@5.1.0`, `@types/express@5.0.3`, `@types/node@22.20.5`, `tsx@4.20.5`, `typescript@5.9.3`.
- Catalog SHA-512 integrity pins were compared with installed package-lock entries. Generated lockfiles were checked for one npm lockfile and registry integrity metadata.
- Built-in starter writes only into owned staging. It includes `/health`, `/api/info`, Express JSON middleware, centralized JSON 404/error responses, `.env.example`, scripts, tests, README/setup docs, and graceful shutdown. No frontend, database, ORM, authentication, fullstack, or deployment files are generated.

## Windows CLI E2E

Command: `npm run test:e2e:phase-05a:cli` — exit `0`.

- Path included spaces and Unicode (`雪`) under the approved OpenCode temp root.
- Catalog and plan returned BE-01 as `planned`; plan stayed read-only. An invalid backend + frontend selection returned `GEN_INCOMPATIBLE` before writes.
- Development-only generation passed staging identity, dependency install, direct dependency integrity, lockfile integrity, typecheck, API/error-handler tests, graceful-shutdown test, TypeScript build, and HTTP smoke for `/health` and `/api/info`.
- Generated package scripts, `.env.example`, README/setup files, pinned direct dependencies, and lockfile package metadata were checked. Manual `npm run typecheck`, `npm run test`, and `npm run build` in the generated project each exited `0`.
- Built server returned expected JSON over HTTP. Generated SIGTERM handler closed its listener; shutdown test also verified repeat safety.
- Cancellation during npm installation ended with cancelled status/exit `5`; owned staging was cleaned and destination stayed absent.
- Incompatible selection stayed absent. Existing-destination collision returned `GEN_PATH_EXISTS`; sentinel content stayed unchanged and no staging residue remained.

## Forge Studio / Tauri E2E

Command: `node scripts/phase-05a-native-e2e.mjs` against Windows WebView2 DevTools port `9339` — exit `0`.

- Backend wizard selected Express and BE-01; read-only plan/Doctor showed planned status, expected writes, npm, and available destination.
- Lifecycle-script consent and internal planned-recipe consent both defaulted unchecked. Lifecycle consent alone did not enable Generate; both were explicitly affirmed for this internal run.
- Generated project passed scaffold identity, dependency install/integrity, lockfile integrity, typecheck, unit tests, graceful shutdown, build, and HTTP smoke. Manifest lockfile SHA-256 matched generated `package-lock.json` bytes.
- Result retained planned status; project appeared in local history. Explorer and VS Code open actions succeeded.
- Existing destination was blocked by Doctor; sentinel remained unchanged and no staging residue remained.
- The generated project and test preference changes were cleaned after evidence capture. No project content was retained in the repository.

## Release-policy and regression checks

- System and bundled staged-runtime release CLI policy smokes both printed PASS: catalog/plan/Doctor stayed read-only; BE-01 and other planned recipes were blocked before staging, including planned-override attempts for BE-01.
- The `desktop.mjs build system` and `desktop.mjs build bundled` wrappers stopped after their policy smoke because approved portable NSIS 3.13 was not configured. No Tauri installer was built or installed; this does not negate the completed policy smoke.
- `npm test`: exit `0`; core 43 passed / 1 expected elevated-only skip, CLI 10 passed, desktop 14 passed.
- One intermediate rerun hit transient `EBUSY` removing the temp folder in the pre-existing orphan-descendant runner test; no child remained, test temp was cleaned, and the next full rerun passed.
- `npm run lint`: exit `0`; `npm run typecheck`: exit `0`.
- `cargo test --manifest-path packages/desktop/src-tauri/Cargo.toml`: 9 passed; Cargo fmt and Clippy with `-D warnings`: exit `0`.
- `git diff --check`: exit `0` (Git reported configured LF-to-CRLF normalization warnings only).

## Limits and disposition

These are local developer-host results, not independent acceptance. Lifecycle scripts remain unsandboxed. Cross-account ACL denial, clean-machine install, full accessibility review, installer build/install, database integration, and security/release review remain open. No recipe status changed; BE-01 remains `planned` and blocked in normal/release generation.

**Recommendation:** GO for independent BE-01 review/acceptance only; NO-GO for promotion or release. For Phase 05B, evaluate a separate Go standard-library `net/http` + Go Modules recipe before expanding into database or fullstack work.
