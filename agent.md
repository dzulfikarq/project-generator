# Agent Operating Rules — Project Generator Desktop

Version: Draft 0.2; 2026-11-11. Scope: documentation, design, architecture, implementation, QA and release agents working on this project.

## 1. Rules of authority

- Follow user-approved project scope and higher-priority safety requirements.
- PRD = requirements; decisions = why a choice was made; design = UX behavior; adapter contracts = technical interface; QA = evidence; actual code = implemented behavior.
- The starting files are **draft plans**, not implementation approval or evidence.
- If documents conflict, identify and record the conflict; do not silently choose a convenient interpretation.

## 2. Mandatory preflight per task

1. Read `AGENTS.md`, relevant `PRD` IDs, `docs/ARCHITECTURE.md`, `design.md` when UX-relevant, adapter/compatibility contract, decision register and QA entries.
2. Inspect repo tree, current branch, uncommitted changes and work in progress. Never reset or overwrite another contributor's work.
3. Classify task as docs/design/architecture/code/test/release; identify concrete files and acceptance criteria.
4. Check for security risks: process execution, arbitrary third-party code, secrets, private Forma registry, file paths, staging deletion, Docker or Git.
5. For material choices, draft one DEC record with alternatives/risks. Agent cannot self-approve.
6. Implement only the explicitly requested phase; separate changes for review.
7. Verify actual behavior and record exit codes/OS versions and pass/fail; no invented successes.

## 3. Non-negotiable architectural constraints

- CLI-first; UI does not contain framework-specific scaffolding logic.
- Built-in reviewed adapter whitelist; no arbitrary third-party adapter code execution in V1.
- Resolver works read-only and blocks invalid combinations before output changes.
- npm is default for JS/TS. Never pretend it replaces Go Modules, Composer, uv or pub.
- Forma local CLI integration uses a pinned private Git commit, configured Git Credential Manager, existing exporter/installer, and content SHA-256 validation; no token input, signed-publisher claim, recipe promotion, or Forma-repo edits.
- Windows safety: reject clobbering existing destination; stage into owned temp; cancel and rollback only owned files; no generic shell commands, unsafe path interpolation or hidden elevation.
- Source code, logs, screenshots, generated `.env.example` and manifests must not contain real credentials.

## 4. Status and verification

- `planned`/`cataloged` is not `tested`; only promote after independent Windows setup/build/smoke evidence.
- Any test not run must be marked `NOT RUN`; if blocked, document why. A successful package install alone is not a successful project.
- For Forma, prior standalone template tests are not generator integration evidence.
- Generated docs must name actual framework, scripts, path structure, dependency manager and optional prerequisites; do not invent user/project history.

## 5. Report format per meaningful task

Report in concise form: objective, files changed, relevant requirement IDs, tests executed with pass/fail/skip, risks/limitations, decision records affected, commit status, and precise next step. Never claim push/release/deploy when not done. For a docs-only task, do not modify executable source or run unnecessary installs.
