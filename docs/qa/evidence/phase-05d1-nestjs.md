# Phase 05D.1 — Standalone NestJS BE-03 Evidence

| Field | Value |
|---|---|
| Date | 2026-11-16 |
| Host | Windows 11 Pro `10.0.26300`, x64; non-elevated |
| Tools | Node.js `22.22.1`; npm `10.9.4`; Go `1.26.7`; Rust/Cargo `1.99.1`; Tauri `2.12.4`; WebView2 `157.0.4341.46` |
| Recipe | BE-03 standalone NestJS 11 / TypeScript / npm REST API |
| Status | **Bounded local CLI/native acceptance passed; BE-03 remains `planned`; no release approved** |
| Decision | [DEC-029](../../decisions/DEC-029-phase-05d1-nestjs.md) |

## Scope and pins

- Official `@nestjs/cli@11.0.24`, npm SHA-512 integrity verified; framework `@nestjs/common`, `@nestjs/core`, `@nestjs/platform-express`, and `@nestjs/testing` pinned to `11.2.10`; Schematics `11.1.0`.
- Generated runtime dependencies: `reflect-metadata@0.2.2`, `rxjs@7.8.1`.
- Generated development dependencies: `@nestjs/cli@11.0.24`, `@nestjs/schematics@11.1.0`, `@nestjs/testing@11.2.10`, `@types/express@5.0.3`, `@types/jest@30.0.0`, `@types/node@22.20.5`, `@types/supertest@7.2.1`, `@eslint/js@9.18.0`, `eslint@9.18.0`, `globals@17.0.0`, `typescript-eslint@8.72.2`, `jest@30.0.0`, `ts-jest@29.4.15`, `supertest@7.0.0`, `typescript@5.9.3`, and `prettier@3.4.2`.
- All direct package versions and npm integrity metadata are pinned in the catalog and verified against generated `package-lock.json`. Generated Node engine is `>=22.13.0`; npm remains the sole manager.
- The generated package retains the official scaffold's `format` script backed by pinned Prettier `3.4.2`.
- Nest CLI runs with `--skip-install --skip-git --strict --package-manager npm` in owned staging. Observed scaffold uses CommonJS-compatible NodeNext TypeScript and Jest 30. `--no-observe` is unsupported; no Observe module/integration is generated.
- No global installs, Git initialization, `.env`, frontend, DB/ORM, authentication, Docker, fullstack, or deployment. The generator starts the built API only for HTTP smoke and stops it before finalization; no server remains running after generation.

## CLI and native acceptance

| Command / flow | Result |
|---|---|
| `npm run test:e2e:phase-05d1:cli` | Exit 0: catalog/plan/invalid-manager checks; explicit consent; pinned official scaffold; dependency and lock integrity; typecheck, lint, Jest unit/e2e, shutdown, build, HTTP/API error smoke; cancellation during npm install; collision sentinel preservation. |
| `node scripts/phase-05d1-nest-native-e2e.mjs` | Exit 0: actual Tauri Forge Studio plan/Doctor/review, both consent defaults closed, one-consent block, generation, validations, result/history, Explorer/VS Code opens, and collision preservation. |
| `npm run test:policy:phase-05d1` | Exit 0: release-profile policy blocked planned BE-02/BE-03/BE-05/BE-06 before staging despite runtime override attempts. Development profile restored after the check. |

CLI generated `package-lock.json` SHA-256: `f6cd170ead4cfde0119fbebc39bb08f358668bcdba535d12b5e9f5ac0ff3eb46`.

Native generated `package-lock.json` SHA-256: `9526756ab08879b30549e1fc88bd23bf714e653e5c7f076c629d68a8893e96d2`.

Hashes are run-specific; no cross-run byte-identity claim is made. Both acceptance scripts assert each manifest hash against its generated lockfile and verify pinned package versions/integrity.

Both native consent boxes started unchecked. Lifecycle consent alone left Generate disabled; planned-recipe consent alone also does not authorize install. Native generation began only after both were explicitly affirmed. Results, history and generated manifest retained recipe status `planned`.

Generated API exposes `GET /health` and `GET /api/info`. Jest checks configuration validation, successful JSON routes, stable 404 and malformed-JSON responses, and listener shutdown. The generator's own HTTP smoke verified both routes. Generated Standard docs describe the Nest scaffold, validation commands, error handling, and limitations.

CLI cancellation was sent after `installing` began; job exited cancelled, target remained absent, and owned staging was cleaned. Native collision Doctor blocked occupied destination; sentinel content remained unchanged and no generator staging remained. Native Open Folder and Open in VS Code actions passed.

## Regression and project checks

| Command | Result |
|---|---|
| `npm test` | Exit 0: core 60 passed / 1 expected elevated-only skip; CLI 10/10; desktop 15/15. |
| `npm run typecheck` | Exit 0: core, CLI, desktop. |
| `npm run lint` | Exit 0. |
| `npm run build --workspace @project-generator/desktop` | Exit 0: TypeScript + Vite production build. |
| Tauri `cargo test --locked` | Exit 0: 9 passed. |
| Windows supervisor `cargo test --locked` | Exit 0: 4 passed. |
| Tauri and supervisor `cargo fmt -- --check` | Exit 0. |
| Tauri and supervisor `cargo clippy --all-targets --locked -- -D warnings` | Exit 0. |
| `npm run test:e2e:phase-05a:cli` | Exit 0: BE-01 Express install, integrity, typecheck/tests/build/HTTP, cancellation, and collision regressions. |
| `npm run test:e2e:phase-05b:cli` | Exit 0: BE-02 Go `1.26.7` checks, HTTP, missing-tool block, cancellation, collision, and unchanged Go environment. |
| `npm run test:e2e:phase-05c3:cli` | Exit 0: BE-05 Laravel/Composer checks and API smoke; isolated MySQL integration was blocked/not attempted in this regression run. |

## BE-04 Go Gin recommendation

**NO-GO for full BE-04 implementation as currently proposed; GO for a separate bounded design/evaluation only.** The current codebase implements BE-02 with standard-library `net/http`; no Go Gin adapter, PostgreSQL driver, DB validation, schema/migration contract, or isolated PostgreSQL acceptance harness exists. The proposed BE-04 tuple couples Gin + PostgreSQL + pgx and needs separate decisions for existing-service-only versus provisioning, data model/migrations, connection error behavior, dependency/module integrity, test isolation and cleanup. BE-02 tests do not cover those requirements. Authorize implementation only after that scope and acceptance plan are approved.

**Historical recommendation superseded:** User authorized Phase 05D.2 with a narrower BE-04 scope—standalone Gin, no DB/auth. See [DEC-030](../../decisions/DEC-030-phase-05d2-go-gin.md); FS-02 PostgreSQL/pgx scope remains separate.

## Remaining gates

- Independent review of exact pins, generated output, cancellation/safety evidence, and CLI/native report remains pending.
- BE-03 remains `planned`; normal/release generation is blocked. No recipe promotion, public release approval, push, or deployment occurred.
- Lifecycle scripts execute unsandboxed after explicit consent. Process supervision is not a filesystem/network sandbox.
- This evidence does not test database integration, a clean machine, cross-account ACL denial, or broader product accessibility/release gates.
