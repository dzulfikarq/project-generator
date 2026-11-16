# DEC-031 — Phase 06A Express + SQLite + Drizzle

| Field | Value |
|---|---|
| Status | Final independent post-remediation runtime acceptance **PASS** with no new blockers; Phase 06A development closure **GO**; BE-01/BE-07 remain `planned`; public release **NO-GO** |
| Date | 2026-11-16 |
| Scope | BE-07 standalone Express + npm + SQLite + Drizzle API; no frontend, authentication, fullstack, or database provisioning |
| Evidence | [Phase 06A evidence](../qa/evidence/phase-06a-express-sqlite-drizzle.md) |

## Decision

- Keep BE-01 as standalone Express with no database. Add BE-07 as a distinct exact tuple: Express + npm + embedded SQLite + Drizzle.
- Pin `drizzle-orm@0.45.4`, `drizzle-kit@0.31.11`, `better-sqlite3@13.2.0`, and `tsx@4.21.0`; retain npm as the Node default and validate direct dependency integrity plus the generated lockfile.
- Generate schema, connection/CRUD example, Drizzle configuration, migration SQL, and a first-party Windows `pg-db-path-verifier.exe`. Generation and server startup do not open/create the configured DB or parent directory; first CRUD use opens it lazily. Migration remains explicit via `npm run db:migrate`, which shares DB_FILE validation with Drizzle config. `:memory:` is runtime/test-only; migration and Drizzle config reject it. Windows path assertions cover drive absolute, UNC/extended UNC, traversal, mixed separators, spaces, trailing-dot/space aliases, and reserved device names including `CLOCK$`.
- On Windows, generated `src/db/path.ts` resolves verifier from its own `import.meta.url` to absolute `native/pg-db-path-verifier.exe`, invokes fixed `--verify` argv with JSON stdin and `shell: false`, and accepts only protocol v1 success. No PowerShell fallback; `SystemRoot`, `WINDIR`, PATH, and CWD do not select helper. The supervisor copies the packaged sibling verifier into owned BE-07 staging using existing handle-rooted writes. System/bundled Tauri resource staging also carries the binary. Name/location/existence do not prove publisher identity: someone able to replace generated project files/helper is outside this trust boundary.
- Rust verifier walks the project root and DB path component-by-component using `CreateFileW` for the drive root, handle-relative `NtCreateFile` with `FILE_OPEN_REPARSE_POINT`, and `GetFileInformationByHandleEx(FileAttributeTagInfo)`. It rejects reparse components observed during the walk and permits missing DB suffix components. Node `lstat`/`realpath` remains defense-in-depth. Checks do not eliminate TOCTOU before SQLite opens the path; npm lifecycle/native-addon code remains unsandboxed. File-symlink runtime test is blocked by Windows `EPERM`.
- Keep database-path test overrides restricted to `DB_FILE=:memory:` in the generator process runner. CRUD acceptance uses its own test-owned process and isolated path.
- Expose database/ORM choices and migration/consent disclosures in desktop UI. Require lifecycle-script consent and separate development-only planned-recipe consent; normal/release generation remains blocked.
- Do not expand other database/ORM tuples, alter BE-01, promote BE-07, or claim release readiness.

## Acceptance gate

Original bounded local Windows CLI/native acceptance and Remediation 3 implementer-run checks passed for their recorded scopes. Independent Remediation 3 source review completed **PASS WITH FINDINGS**; Remediation 4 addressed those findings. Final independent post-remediation runtime acceptance now **PASS** with no new blockers. The packaged release gate still blocks planned recipes before staging. Development closure is **GO**; BE-01/BE-07 remain `planned`; public release remains **NO-GO**. No recipe promotion or release authorization occurred.

## Remediation 2 — superseded implementation record

- Remediation 2 used a generated PowerShell path check and did not demonstrate runtime reparse rejection. Remediation 3 replaces that implementation; PowerShell is not used for BE-07 path validation.

## Remediation 3 — implementation and implementer-run evidence

- Baseline HEAD: `814978f552e0dd00008537efe5bd534962e99815`; branch `main`; staged diff empty; the 11 pre-existing modified files were preserved. No `race-create` journal or prohibited diagnostic log was accessed.
- `npm run test:e2e:phase-06a:cli` — **PASS**, Windows 11 Pro `10.0.26300`, non-elevated, Node `22.22.1`, npm `10.9.4`. Fresh BE-01 manifest selected exactly `['backend.express']`; no DB/ORM packages, migration commands, `data/`, or DB file. BE-07 generation copied the verifier byte-for-byte from the packaged first-party artifact; generated install/check/build/HTTP smoke, explicit isolated migration/CRUD, cancellation, and collision checks passed. Recipe statuses stayed `planned`.
- Generated BE-07 database suite: **8 passed, 2 skipped, 0 failed**. Native helper accepted normal and incomplete paths; rejected project-root and parent junctions. Missing-helper rename/restore and directory-as-file API rejection ran against the actual helper; injected runner responses covered EACCES, timeout, nonzero, crash-like null status, malformed/version-mismatched output, and API error before DB creation. The fake-root test set `SystemRoot`/`WINDIR` only in the test process, kept a `powershell.exe` sentinel, and passed while the selected command remained the absolute generated-module-relative Rust helper. File-symlink tests were skipped because Windows returned `EPERM`; file-symlink rejection remains **NOT VERIFIED**.
- Rust `cargo test --locked` — **6 passed** (2 verifier parser tests, 4 supervisor tests); Clippy `--all-targets -- -D warnings`, `cargo fmt --check`, core typecheck/lint, and full `npm test` passed (core 68 passed/1 expected elevated-only skip; CLI 11/11; desktop 16/16).
- Tauri system and bundled resource preparation plus packaged CLI policy smoke passed; staged verifier bytes matched the first-party build artifact in both modes, and bundled `node.exe` was present. Installer build stopped at the existing prerequisite because `PG_NSIS_DIR` is unset; no installer was produced. Generated portable CLI output did contain the helper.
- Remediation 3 review-time limits: reparse detection covers components observed during handle walk only; TOCTOU remains between inspection and SQLite open; hard-link aliases are not detected; npm lifecycle scripts/native addons remain unsandboxed. The independent source review then completed **PASS WITH FINDINGS**, but runtime acceptance was still pending at that point. Final status appears below.

## Remediation 4 — findings closure and targeted implementation checks

- `CLOCK$` is rejected by both generated TypeScript DB_FILE validation and the Rust verifier, matching shared Windows reserved-name policy. Generated path-vector and Rust parser tests cover it; this is policy consistency, not a traversal finding.
- Rust drive-prefix parsing uses byte-range comparison, returning `unsafe_path` for malformed Unicode prefixes instead of panicking. Targeted verifier test covers regression.
- Generated `docs/DATABASE-SAFETY.md` discloses undetected hard-link aliases while retaining TOCTOU, helper replacement, and unsandboxed npm lifecycle/native-addon disclosures.
- Packaged release CLI smoke passed under system Node and bundled Node. BE-07 normal generation and `--development-allow-planned` attempts both returned `GEN_RECIPE_UNTESTED` before staging; smoke also verified no destination was created and release help does not expose the override.
- Rust verifier tests: 3 passed; targeted Clippy (`-D warnings`) passed. Phase 06A BE-01/BE-07 CLI E2E, core typecheck, focused ESLint, smoke-script syntax check, and Rust formatting check passed. These are implementer-run checks, not independent runtime acceptance.
- At the end of Remediation 4, both packaging workflows had stopped at the unset `PG_NSIS_DIR` prerequisite; no installer was built. File-symlink runtime rejection was **NOT VERIFIED** due Windows `EPERM`. BE-01/BE-07 remained `planned`; Phase 06A closure and public release were then **NO-GO**. Final independent acceptance follows.

## Final Independent Acceptance — 2026-11-16

- **Result: PASS; no new blockers. Recommendation: GO for Phase 06A development closure.** Acceptance ran non-elevated on Windows 11 Pro `10.0.26300`, x64, Node.js `22.22.1`, npm `10.9.4` in a disposable workspace. The copied CLI E2E harness changed only its temporary-folder prefix to keep nested Windows paths below `MAX_PATH`; its assertions and spaces/Unicode path coverage remained unchanged.
- CLI E2E passed: BE-01 generated with no DB adapters, packages, migration commands, data directory, or DB file. BE-07 generated with dependencies and SQL; typecheck, lint, tests, build, shutdown, and HTTP smoke passed. Explicit migration and isolated SQLite CRUD passed. Cancellation and collision checks passed.
- Generated BE-07 tests: **11 passed, 0 failed, 2 skipped**. Fake-Windows-root helper selection, fail-closed-before-SQLite, and project-root/parent-junction rejection passed. Both skipped file-symlink checks are **NOT VERIFIED**: direct creation returned `EPERM`.
- Native verifier runtime accepted a normal missing DB suffix and rejected an outside path, `CLOCK$`, and malformed Unicode drive prefix (`unsafe_path`). Raw invalid UTF-8 returned `invalid_request`; Rust verifier tests passed **3/3**.
- Packaged release CLI smoke passed for system Node and bundled Node. Both BE-07 normal and development-override attempts were blocked before staging; packaged CLI/core/supervisor/verifier hashes matched release-build outputs.
- Residual limits remain: TOCTOU between handle check and SQLite open; hard-link aliases undetected; generated helper replaceable by someone able to modify project files; npm lifecycle scripts/native addons unsandboxed. Installer was not built or validated. These do not block development closure; public release remains **NO-GO**. BE-01/BE-07 remain `planned`; no production-readiness claim or status promotion.
