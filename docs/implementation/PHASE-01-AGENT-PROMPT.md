# Master Prompt — Phase 01: CLI Kernel and First Vertical Slice

> **For the coding agent.** This is an implementation handoff, **not** evidence of implemented functionality. Scope: CLI-first foundation + React/Vite and Next.js vertical slices. Do not start the Tauri GUI yet.
>
> Apply this prompt only after the human explicitly authorizes implementation in the target repository. The planning package itself contains documentation, not an existing working codebase.

---

You are the lead software engineer working on **Project Generator Desktop**, a Windows-first universal project scaffolding tool. Implement **Phase 01: Generator CLI foundation** in the target repository, following the existing documentation as the source of truth.

## Read first (mandatory)

Read in this order, before editing any code:

1. `README.md`
2. `AGENTS.md`
3. `agent.md`
4. `decision.md` and `docs/decisions/index.md`
5. `docs/PRD.md` — especially PRD-001–020, NFR-001–012
6. `docs/ARCHITECTURE.md`
7. `docs/adapters/adapter-contract.md`
8. `docs/adapters/compatibility-matrix.md`
9. `docs/qa/acceptance-matrix.md`
10. `docs/ROADMAP.md`
11. `design.md` (future desktop UX contract; **not** a request to implement UI)

Treat these documents as a **draft planning baseline** until the user authorizes implementation. If you find a conflict, present a concise conflict + selected proposed resolution, update the relevant decision record, and do not pretend an unapproved change was approved.

## Implementation scope (strict)

**In scope:**

- TypeScript monorepo/workspace structure suitable for core CLI and later Tauri UI; prefer npm workspaces, npm as internal default unless justified otherwise.
- Versioned strict JSON config schema and validation, typed errors and normalized selections.
- Built-in versioned manifest catalog and **explicit** recipes; future frameworks listed as `planned/cataloged`, not falsely enabled.
- Pure read-only resolver and deterministic plan: no filesystem write, no subprocess, no network or credential access during `plan`.
- Read-only environment doctor that checks required toolchain executable versions and target directory safety; it may use allowlisted `--version` probes, but no dependency installs.
- Job orchestrator with owned temporary staging, framework adapter delegation, controlled file writes, structured event streaming, cancellation, cleanup and safe final commit.
- Safe process runner for Windows (argv, controlled cwd/env, allowlisted binaries, no user-provided shell command strings, no unreviewed runtime plugins).
- `FE-01`: React + Vite + TypeScript + npm + plain CSS, no backend/DB.
- `FE-02`: Next.js App Router + TypeScript + npm + Tailwind, no separate backend/DB.
- Minimum truthful generated docs: README and SETUP with commands for the actual generated project, plus `.project-generator/manifest.json` without secrets.
- Unit/integration tests and independent Windows actual scaffold/install/build/smoke evidence **when the environment permits**. Report blockers honestly when network/toolchain/Windows access is not available.
- Readable CLI help, JSON/JSONL mode, error codes, and developer setup instructions.
- Documentation updates for factual implementation changes, QA evidence and decisions.

**Out of scope:** Tauri desktop UI, React/Vue/Angular breadth beyond FE-01/FE-02, Go/Laravel/Python backends, databases, Bootstrap integration, Forma integration, React Native, Flutter, cloud hosting, AI generation, remote GitHub repository creation/push, Docker auto-start, external plugin marketplace, arbitrary dynamic shell commands. **Do not implement these as 'quick extras'.** Keep their extension points documented.

## Technology/architectural constraints

- System Node.js is the provisional **Phase 1** execution prerequisite. Do not assert that the future Windows installer is self-contained; retain OPEN-001 for sidecar packaging PoC.
- Use framework **official/maintained** scaffolds with **resolved pinned versions**, noninteractive mode and exact recorded invocation. Do not execute floating `@latest` versions as a release claim.
- `npm` is the package manager for both initial recipes, with `package-lock.json`; no other Node lockfiles.
- Reuse a single canonical schema and compatibility resolver across CLI and later UI; no duplicate business rules in presentation layer.
- No public executable third-party plugin support in V1. Built-in adapters are reviewed code with versioned manifests.
- Keep official scaffold `base` files owned by framework adapter. Other steps use declared, safe paths; no unsafe text replacement based on changing upstream file layouts.
- No automatic git init/commit unless explicitly selected in future supported option; if Phase 1 schema includes `git.initialize=false`, respect it. No GitHub remote/push.
- Keep path handling native Windows-aware: spaces, Unicode, drive letters, trailing dots/spaces, reserved names, case-insensitive collisions, junction/symlink escapes and target race conditions.
- Never overwrite an existing project or user file, including when destination appears during execution.

### Windows command execution trap

Do **not** solve `npm.cmd`/`npx.cmd` launching by blindly using `shell: true` with untrusted text. Explore and document a reviewed strategy for a trusted npm CLI entrypoint invoked via `node` + explicit argv, or a safely bounded Windows runner. Test on actual Windows. Installer lifecycle scripts can execute package-defined code and must be disclosed; do not call this fully sandboxed.

## Proposed CLI contract

Implement names consistently or document a justified compatible alternative:

```text
project-generator --help
project-generator catalog --json
project-generator plan --config <file> --json
project-generator doctor --config <file> --json
project-generator generate --config <file> --jsonl
project-generator inspect --output <folder> --json
```

At a minimum, include example configs for FE-01 and FE-02 using the **real schema in `adapter-contract.md`**. Generated configs must not invent unsupported nested fields.

`catalog` is local-only. `plan` loads config and computes pure resolved steps without launching a process, downloading anything, creating target/staging, or reading secure tokens. `doctor` is non-mutating. `generate` performs real work only on explicit CLI invocation after validating the config; report precise writes, dependencies, checks, errors, and cleanup.

For noninteractive CLI generation, document that invoking `generate` is explicit execution consent, and report any network/install scripts in the plan. If a future UI adds separate scoped consent, enforce it there too.

## Implement the generation engine as a state machine

```text
queued → preflight → staging → scaffolding → configuring
       → installing → validating → finalizing → completed
                                 ↘ failed / cancelled
```

Each stage has an immutable ID, owner and event status. Emit versioned JSONL events with job ID, monotonic `sequence`, UTC timestamp, stage, message and redacted error code. For phases without measurable progress, report indeterminate status; never synthesize fake percentages.

Ensure `generate` refuses unsupported/unverified recipes for normal production mode. For local development, you may add a clearly named *development-only* way to run initial `planned` recipes to earn evidence; this must not relabel a recipe `tested` by itself or ship enabled by default. Document the flow and avoid creating a backdoor that skips safety checks.

## Staging / rollback policy (critical)

- New target must not exist when generation starts.
- Create a **generator-owned staging directory within the destination parent on the same volume** with a unique ID, and scaffold under a child folder that uses the intended real project name.
- Write ownership information and keep a live in-process record; do not treat a user-created marker alone as cleanup permission.
- On failure/cancel before final commit, stop owned descendants, remove only verified-owned staging when safe, preserve redacted logs outside, and leave destination untouched.
- On successful required validations, commit staged child directory to the still-absent target with a Windows-specific fail-if-exists operation; do not overwrite on target creation race.
- Retry creates a fresh staging directory. Never delete or overwrite an existing target on retry.
- If cleanup cannot safely complete due to open handles/junction uncertainty, report retained staging and manual recovery; never recursively delete an unverified path.

## FE-01 implementation acceptance

- Config selects frontend React + Vite + TypeScript + npm + CSS, no backend or DB.
- Scaffold uses a **specific pinned** create-vite version, noninteractive template `react-ts`; separate installation if scaffold supports it.
- `package.json` identity matches intended project name, and generated project starts from a supported official baseline.
- `npm install`, appropriate lint/typecheck/build commands, and a true served-page smoke test (where test environment permits) succeed.
- Output includes one Node lockfile `package-lock.json`, truthful README/SETUP, and `.project-generator/manifest.json` with exact versions and check outcomes.

## FE-02 implementation acceptance

- Config selects Next.js App Router + TypeScript + npm + Tailwind; no separate backend/DB.
- Use a **specific pinned** `create-next-app` version and explicit flags (e.g., `--typescript --app --tailwind --eslint --use-npm --skip-install --disable-git` plus deterministic prompt handling appropriate to pinned CLI). Validate supported flags for that exact version, and don't rely on saved global preferences.
- `npm install`, appropriate lint/typecheck/build commands and real served-page smoke test (where possible) succeed. Do not assume `next lint` exists; inspect scripts in the generated version.
- Output has the correct npm lockfile and reproducibility metadata; no fake database or API integration claims.

## Tests required before calling anything `tested`

1. Schema rejects malformed types, extra fields, unsupported managers/styles and contradictory selections with structured errors.
2. `plan` is demonstrably read-only even when it fails; inspect network/process/fs spies and destination snapshots.
3. Environment doctor reports unavailable toolchains and versions without installing.
4. Path tests on Windows: `E:\Projects\my-app`, path with spaces, Unicode, reserved Windows names (`CON`, `NUL`), dot/trailing-dot segments, junction escape, same-target race, target occupied.
5. Runner permits only controlled executable identities and argument arrays, and redacts sample fake secrets.
6. Cancellation terminates **owned process tree**, prevents commit and never touches an existing user directory; include test of child-process descendants on real Windows.
7. FE-01 and FE-02 each generate independently in a clean Windows directory, install dependencies, run framework-specific checks and smoke test.
8. Generated docs reference real existing paths and runnable commands; no invented test/approval history.
9. Manifest captures exact versions, file/lock metadata and check states, no token or private absolute user path.
10. Job events sequence correctly, errors report stage and target impact, and interrupted cleanup leaves a recoverable report.

Do not flip any recipe to `tested` if real native Windows end-to-end evidence is missing. If tests are blocked, keep `planned` or `experimental` with explicit reason and exact not-run checklist. Store evidence under `docs/qa/evidence/<recipe-id>/...`.

## Work sequence and meaningful commits

1. **Preflight:** Inspect actual repository (if present), Git status and branch, available Node/npm/Windows tools, and document baseline; never overwrite user changes.
2. **Repo foundation:** npm workspaces, TypeScript config, CLI entrypoint, standardized build/test/lint tasks.
3. **Contracts:** schema, manifest/catalog, pure resolver, plan, error/event types, fake adapters and tests.
4. **Safe engine:** doctor, runner, staging, cancellation, commit/no-overwrite semantics, event logs, fault-injection tests.
5. **Real adapters:** FE-01, FE-02 pinned official CLI integration and generated docs.
6. **Verification:** unit tests, typecheck, lint, build; then actual Windows generation/build/smoke if environment permits.
7. **Documentation:** reconcile implemented behavior with PRD/architecture, update QA evidence and decision register; do not overstate readiness.

Use **multiple meaningful English commit messages**, one coherent milestone per commit (e.g. `feat(core): add pure recipe resolver`). Do not manufacture empty commits, rewrite history, push, publish releases, deploy, or create remote repositories without explicit request. If the starting tree is dirty, preserve it.

## Expected final report (must be honest and concise)

- Implemented scope and what remains out of scope.
- Changed/created significant files and new CLI commands.
- Exact results for build/lint/typecheck/unit and Windows real E2E, with PASS/FAIL/BLOCKED; distinguish tests not run.
- FE-01 and FE-02 recipe status with evidence path or blockers.
- Any open security/runtime/Windows issues (especially Node sidecar decision and process-tree kill).
- Commit hashes if actually created; do not claim commits/push otherwise.
- **One** actionable next step, preferably real Windows E2E acceptance before extending to Vue/Angular.

Do not ask the user to approve an unrelated architecture rewrite. Make a best-effort implementation within this explicit Phase 01 scope, and flag only genuinely blocking, irreversible decisions. Keep future phases unchanged in the docs unless specific follow-up work requires a recorded decision.
