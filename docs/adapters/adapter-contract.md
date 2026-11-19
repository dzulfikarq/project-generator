# Adapter Contract — Project Generator Core

| Field | Value |
|---|---|
| Version | Draft 0.1, schema proposal 1 |
| Date | 2026-11-15 |
| Status | **Broader contract proposed; Phase 01/04A–07B implement bounded CLI/core subsets; BE-08 independent acceptance PASS WITH FINDINGS; BE-09 independent review PASS WITH FINDINGS (no product blocker), CLI and native r9 E2E passed, Phase 06C development closure GO; FS-06 independent acceptance PASS WITH FINDINGS and Phase 07A development closure GO; FS-07 independent acceptance PASS WITH FINDINGS and Phase 07B development closure GO; all recipes remain planned and public release NO-GO** |
| Applicable components | Generator Core CLI; bundled platform/framework/styling/database/template adapters |

## 1. Design principles

1. **CLI-first / UI-agnostic:** core runs without Tauri GUI; GUI subscribes to structured events and can cancel jobs.
2. **Deterministic inputs:** input config + pinned adapter versions + pinned official CLI/template versions → reproducible *plan*, and reproducible output as far as upstream package registries/OS allow.
3. **One recipe, one evidence set:** supported status comes from observed verification, not marketing status.
4. **Plan before execution:** no writes, installs, network access or process execution while only previewing.
5. **Explicit side effects:** identify downloads, process starts, Git operations and optional Docker actions.
6. **Safe by construction:** internal allowlisted adapters, no arbitrary plugin scripts, shells or user-provided shell fragments.
7. **Separation of concerns:** framework scaffolding, styling, database integration, project docs and Forma template installation are independent contract stages.
8. **No invented validation:** report `not_run`/`skipped` distinctly from `pass`.

## 2. Adapter families

| Family | Example | Responsibility |
|---|---|---|
| `frontend` | `frontend.react-vite` | Official scaffold invocation, frontend runtime and lifecycle |
| `backend` | `backend.go-gin` | Backend project layout, service and routes |
| `database` | `database.postgresql` | DB env, driver, health check, optional Docker artifacts |
| `data-access` | `data-access.prisma-postgres` | ORM/driver, schema, migration, seed and validation |
| `styling` | `styling.bootstrap` | CSS build system, component lifecycle, install |
| `ui-library` | `ui.shadcn` | Framework-aware UI dependency/configuration |
| `template` | `template.forma` | Authenticated registry resolution and version-pinned install |
| `tooling` | `tooling.eslint` | Lint, formatting, test setup and scripts |
| `documentation` | `docs.standard` | Generated project documentation from *actual* output manifest |
| `workspace` | `workspace.fullstack` | Fullstack root layout, cross-app config, API sample orchestration |

V1 does not execute unreviewed third-party adapters. New adapters are repository-controlled, reviewed and versioned; any future plugin SDK requires its own security/permission decision.

## 3. Proposed TypeScript-facing contract (illustrative; not identical to Phase 01 code)

**Phase 06A DB_FILE clarification:** Windows reserved device components include `CLOCK$` and are rejected. Hard-link aliases are not detected; handle checks do not remove TOCTOU before SQLite opens DB_FILE, and npm lifecycle/native-addon code remains unsandboxed.

Phase 01 implements FE-01/FE-02 selection; Phase 02 adds planned Forma FM-01/FM-02; Phase 04A–04B.3 add planned frontend recipes; Phase 05A adds planned standalone BE-01 Express + TypeScript + npm with no database; Phase 05B adds planned standalone BE-02 Go `net/http` + Go Modules with no external dependencies or database; Phase 05C.1 implements planned BE-06 FastAPI + uv with no database/ORM and Phase 05C.2 records bounded local toolchain/CLI/native evidence; Phase 05D.1 adds planned standalone BE-03 NestJS + npm and bounded CLI/native evidence; Phase 05D.2 adds planned standalone BE-04 Go + Gin + Go Modules with bounded Windows CLI/native evidence. Phase 06A adds planned BE-07 as a separate Express + npm + SQLite + Drizzle recipe; BE-01 remains database-free. BE-07 generates schema/migration SQL only, opens its application DB lazily on CRUD, and runs migration only through explicit `npm run db:migrate`. Runtime and migration config reject absolute/traversal paths and retain Node `lstat`/`realpath` checks. On Windows, a first-party Rust `pg-db-path-verifier.exe` checks the project root and existing DB path components through handles: `CreateFileW`, handle-relative `NtCreateFile` with `FILE_OPEN_REPARSE_POINT`, and `GetFileInformationByHandleEx(FileAttributeTagInfo)`. It rejects reparse components observed during the walk and permits missing DB suffix components. The generated module resolves the helper from its own `import.meta.url`, invokes its absolute path with fixed `--verify` argv, JSON stdin, and `shell: false`; no PowerShell fallback, PATH lookup, or `SystemRoot`/`WINDIR`/CWD-based executable selection exists. Missing, timeout, launch/API, protocol, malformed-output, nonzero, and reparse failures stop before SQLite opens. The supervisor copies the packaged sibling helper into owned staging; Tauri system/bundled resource staging includes it. The generated helper is not protected against replacement by someone able to modify project files. Checks cover only components observed during the handle walk and do not eliminate TOCTOU before SQLite opens the DB; hard-link aliases are not checked. npm lifecycle scripts and native addons remain unsandboxed. File-symlink runtime evidence is **NOT VERIFIED** because Windows returned `EPERM`. Remediation 3 has implementer-run local evidence only; independent acceptance and release approval remain pending. Broader interfaces below remain a target contract for future adapters and components.

Phase 06B adds BE-08 as separate planned Express + PostgreSQL 16+ + Drizzle recipe. Pinned generation writes schema/migration SQL without DB connection. Startup validates URL and creates lazy pool; `/health` remains process-only. Migration wrapper requires `--target host:port/database`, checks connected database/role/server address/port/version, and closes pool. Direct Drizzle Kit migration bypasses wrapper checks. Focused checks and release policy passed; a dedicated smoke helper synthesizes only loopback `DATABASE_URL` while generic runner allowlist remains closed. Targeted disposable PostgreSQL E2E passed generation, DB-free smoke, guarded migration, CRUD, rollback, cancellation and collision. BE-08 stays `planned`; independent acceptance pending.

Phase 06C adds BE-09 as separate planned NestJS 11 + PostgreSQL 16+ + Drizzle recipe. BE-03 remains database-free; BE-07 and BE-08 are unchanged. The injectable singleton DatabaseService parses `DATABASE_URL` and creates one pool only on first CRUD access; generation, Nest startup, and `/health` do not connect. Migration requires `--target host:port/database`, matches `DATABASE_URL`, verifies connected database/role/address/port/version, and migrates through the checked connection. `drizzle-kit migrate` can bypass the wrapper; npm lifecycle/build scripts remain unsandboxed after explicit consent. Phase 06C CLI E2E passed against PostgreSQL `17.2` with a run-owned loopback cluster; it covers database behavior. BE-08 E2E ran separately in Phase 06B. Native Desktop E2E r9 passed (exit `0`, 116/116 assertions) without PostgreSQL: dual consent, normal generation, active `stageId=installing`, cancellation with matching npm PID active, PID exit, absent target/staging, empty recovery, and collision `BLOCKED` with sentinel preserved. Manifest retains BE-09 `planned`. r1 covered generation/collision only; r5 follow-up verified cancellation and cleanup despite harness failure on a missing UI attribute; R6–R8 were harness/resource/readiness/status-selector issues corrected in r9 without weakening key checks. Preflight conservatively rejects predicted staged `esbuild.exe` paths over 240 characters; regression rejects 261 and accepts 219. Neither Windows' maximum path length nor the 261-character `ENOENT` root cause is proven. Independent review: **PASS WITH FINDINGS, no product blocker**; Phase 06C development closure **GO**. PostgreSQL `16` and clean-machine/installer acceptance remain untested. BE-09 remains `planned`; public release remains **NO-GO**.

Phase 07A FS-06 independent CLI E2E passed against PostgreSQL `17.2` at `127.0.0.1:58068`; Chrome browser E2E passed against a separate `17.2` instance at `127.0.0.1:55480`, including UI CRUD, loading/empty states, API/database outages, credential sanitization, and clean shutdown. Native Desktop E2E passed 66/66. PID `5172` was observed live before cancel and absent after the cancelled terminal result; cancellation causality is not established. Independent acceptance: **PASS WITH FINDINGS**; development closure: **GO**. FS-06 remains `planned`, PostgreSQL `16` remains **NOT VERIFIED**, and public release remains **NO-GO**. Clean-machine/installer, accessibility, and broader security review remain open; npm lifecycle scripts remain unsandboxed and direct Drizzle Kit migration can bypass wrapper checks. See [Phase 07A evidence](../qa/evidence/phase-07a-react-express-postgresql-drizzle.md).

Phase 07B adds FS-07 as an exact Vue 3/Vite + Express/PostgreSQL/Drizzle + npm workspace, separate from unchanged FS-06. Independent CLI/PostgreSQL `17.2`/Chrome E2E passed, including Vue SFC typechecking, DB-free smoke, guarded migration/CRUD/rollback, cancellation/collision, and browser UI flows. The prior native Desktop suite passed 68/68 for review/cancellation/collision, not successful generation. Its first separate success-wrapper attempt failed at a result-page activity-event assertion and is not counted as PASS; corrected targeted native success passed 40/40, with generated manifest checks 15/15. System/bundled packaged release-policy smokes passed and blocked planned recipes before staging. Independent acceptance is **PASS WITH FINDINGS**; Phase 07B development closure is **GO**. FS-07 remains `planned`; PostgreSQL `16`, clean-machine/installer, accessibility, and broader security review remain open. npm lifecycle scripts remain unsandboxed; direct Drizzle Kit migration can bypass wrapper checks. See [Phase 07B evidence](../qa/evidence/phase-07b-fullstack-vue-express-postgresql.md).

```ts
type SupportState =
  | 'cataloged' | 'planned' | 'experimental'
  | 'tested' | 'blocked' | 'retired';

type AdapterKind =
  | 'frontend' | 'backend' | 'database' | 'data-access'
  | 'styling' | 'ui-library' | 'template'
  | 'tooling' | 'documentation' | 'workspace';

type PackageManager =
  | 'npm' | 'yarn' | 'pnpm' | 'bun'
  | 'composer' | 'go' | 'uv' | 'pub'
  | 'maven' | 'gradle' | 'nuget';

type ValidationState = 'pass' | 'fail' | 'skipped' | 'not_run';

interface ToolRequirement {
  executableId: string;   // e.g. node, npm, php, composer, go
  versionRange: string;    // explicitly test resolved version
  optional: boolean;
  reason: string;
}

interface AdapterManifestV1 {
  schemaVersion: 1;
  id: string;                    // stable e.g. frontend.vue-vite
  adapterVersion: string;        // semver of adapter implementation
  kind: AdapterKind;
  displayName: string;
  supportState: SupportState;    // release metadata, never self-certified
  supportedOS: ('windows' | 'macos' | 'linux')[];
  versionConstraints: Record<string, string>;
  packageManagers: PackageManager[];
  prerequisites: ToolRequirement[];
  capabilities: string[];       // tested actions only
  compatibleWith: string[];     // stable adapter ids or recipe constraints
  incompatibleWith: string[];
  recipeEvidenceIds: string[];  // required for TEST state
}

interface ProjectSelectionV1 {
  schemaVersion: 1;
  project: {
    name: string;
    description?: string;
    parentDirectory: string;
    type: 'frontend' | 'backend' | 'fullstack' | 'mobile';
  };
  frontend?: { adapterId: string; language?: 'ts' | 'js'; manager?: PackageManager };
  backend?: { adapterId: string; manager?: PackageManager };
  database?: {
    adapterId: string;
    accessAdapterId?: string;
    mode: 'none' | 'existing-service' | 'docker-compose';
  };
  styling?: { adapterId: string; uiLibraryId?: string };
  template?: { adapterId: 'template.forma'; templateId: string; commitSha: string };
  documentation: 'minimal' | 'standard' | 'full';
  git: { initialize: boolean; initialCommit: boolean };
}

interface GeneratorAdapterV1 {
  manifest: AdapterManifestV1;
  inspect(selection: Readonly<ProjectSelectionV1>): Promise<AdapterInspection>;
  plan(selection: Readonly<ProjectSelectionV1>, environment: EnvironmentReport): Promise<PlannedStep[]>;
  validateOutput(context: Readonly<ValidationContext>): Promise<ValidationResult[]>;
}

interface PlannedStep {
  id: string;
  ownerAdapterId: string;
  phase: 'stage'|'scaffold'|'configure'|'install'|'validate'|'finalize';
  action: 'spawn-allowlisted'|'write-file'|'copy-reviewed-artifact'|'run-check'|'finalize';
  dependsOn: string[];
  readableSummary: string;
  sideEffects: string[];
  consentKind?: 'network'|'docker'|'git'|'external-tool';
}

interface ValidationResult {
  id: string;
  status: ValidationState;
  command?: string; // sanitized display only
  evidencePath?: string;
  message: string;
}
```

Phase 01 avoids `.cmd` aliases: it resolves npm's JavaScript CLI under active Node and launches reviewed JS entrypoints through Node with explicit argv and `shell: false`. Phase 01.7 delegates Windows workload lifetime to a Rust helper that assigns the suspended child to a Job Object before resume; there is no PID/`taskkill` fallback. See proposed [DEC-014](../decisions/DEC-014-windows-process-runner.md) and [DEC-015](../decisions/DEC-015-windows-native-safety-boundary.md). This does not cover Composer or other ecosystems, and remains pending non-elevated runtime tests, packaging, and independent security review. Never use user input as shell command text.

## 4. Recipe manifest — one selectable product output

A **recipe** is a tested composition, separate from individual adapters. Example:

```json
{
  "schemaVersion": 1,
  "id": "fs-vue-laravel-mysql-v1",
  "status": "planned",
  "platform": "windows",
  "front": "frontend.vue-vite",
  "back": "backend.laravel",
  "data": {
    "database": "database.mysql",
    "access": "data-access.eloquent-mysql"
  },
  "styling": "styling.bootstrap",
  "managers": { "frontend": "npm", "backend": "composer", "assets": "npm" },
  "checks": ["frontend-build", "backend-health", "api-connectivity", "docs-truthfulness"],
  "evidenceIds": []
}
```

A client may never change a recipe to `tested` by merely writing a manifest flag. Status promotion requires test report references, exact platform/versions, reviewer/CI policy and confirmation that outputs passed independently. A recipe is not a cartesian product.

## 5. Resolver rules

Order of operations (all read-only through the review stage):

1. Validate selection schema and normalize project name.
2. Canonicalize target parent path and verify destination non-existence.
3. Resolve selected adapters and exact version ranges.
4. Check OS/runtime requirements, manager compatibility and recipe availability.
5. Check framework/styling/UI combinations, separate backend and data mapper/DB pairing.
6. Check Forma template compatibility, pinned source identity and available auth/cache. The current integration pins a full Git commit and verifies SHA-256, but does not verify a publisher signature.
7. Compute dependency DAG, file ownership rules, expected lockfiles and validations.
8. Emit a stable sanitized plan and explicit side-effect list.
9. If unsupported, return typed explanation and alternatives; do not auto-change selection.

A plan is not an execution authorization. Executing requires an explicit user action after review, and any separate high-impact step (such as starting Docker) requires its declared consent. Where underlying installers run package lifecycle scripts, the UI must disclose this possibility.

## 6. Engine pipeline and job state

```text
Idle
  ↓ plan (READ-ONLY)
Planned ── invalid ──→ Blocked
  ↓ explicit Generate
Preflight → Staging → Scaffolding → Configuring
  → Installing → Validating → Finalizing → Complete
                   ↘ Failed / Cancelled / Partial
```

- `plan` and `preflight` **must not** modify the requested output directory. Preflight may inspect tool versions and network reachability without installing dependencies.
- `staging` creates an isolated, marked generator-owned directory on the target volume, when feasible.
- `scaffolding` invokes reviewed CLIs or copies vetted starters with version-pinned sources. Noninteractive mode required.
- `configuring` writes env **examples**, scripts, integration samples and template files; no hardcoded real passwords.
- `installing` uses the correct ecosystem manager and produces lockfiles as specified.
- `validating` records status/evidence of tests; optional unavailable service test is `skipped` with explanation, never `pass`.
- `finalizing` renames/moves staged output only after safety checks and against still-nonexistent destination. If a destination appeared after plan, fail without overwriting.
- `Complete` requires the advertised recipe acceptance checks to pass. If output exists but prerequisites prevent verification, report `Partial`/`Unverified` and don't claim ready.

### Cancellation and rollback

- Phase 01 invokes reviewed JavaScript entrypoints with `node` and explicit argv (`shell: false`). Phase 01.7 uses the native Windows helper and Job Objects for process-tree ownership; cancellation, timeout, detached-child, unrelated-process and breakaway integration tests exist but remain unexecuted under a non-elevated token. Handle-rooted staging mutations do not make ordinary Node writes race-free or isolate lifecycle scripts; independent review remains pending.
- Perform bounded cleanup only in a staging directory with an owner sentinel and exact canonical path match; never delete arbitrary paths from error logs or user input.
- A locked staging directory is retained as an explicit recoverable artifact with a cleanup recommendation, not forcibly erased.
- Once finalized, do not silently delete the user's output even if optional Git init or later actions fail. Report partial completion.
- Retrying creates a fresh staging path and cannot mutate or overwrite the existing destination.

## 7. File ownership and conflict policy

Each adapter must declare files it may create or transform, and any ordering dependency. A framework's native scaffold owns its base files; later adapters use reviewed transformations (AST/structured edits where practical) or version-aware patches. If two adapters claim incompatible ownership of one file, resolution fails during planning.

- Reject traversal (`..`), absolute path injection, reserved Windows names (`CON`, `NUL`, etc.), trailing spaces/dots where invalid, symlink/junction escapes, unexpected UNC/device paths, case-insensitive collisions and blocked extensions.
- Target destination cannot be a live repository root or nonempty directory unless a future explicit merge/import workflow is designed.
- Do not modify global user config (`npm config`, PowerShell ExecutionPolicy, global Git config) during generation.
- Windows drive-letter and spaces must be preserved; avoid assumptions that `/` paths or shell quoting are portable.
- Validate generated paths **after** native scaffolding and before finalize; include subdirectories created by tools.

## 8. Process execution boundary

The desktop frontend never receives a generic `execute(command: string)` primitive. It sends typed commands (`generate(planId)`, `cancel(jobId)`, `openProject(projectId)`). The native bridge only invokes an allowlisted CLI engine; the engine only spawns allowed binaries with vetted argument arrays and working directories under controlled staging.

Security requirements:

- Validate executable path, version and digital provenance where possible; reject unexpected binaries with same name on PATH for risky operations.
- Pass arguments as distinct argv elements; prohibit shell metacharacters as a control plane and never splice raw user strings into shell lines.
- Enforce Tauri 2 capability scopes; dangerous shell commands are denied by default until explicitly permitted.
- Stream stdout/stderr after redaction; avoid logging environment secrets, auth headers and private registry URLs containing tokens.
- No automatic elevated process/UAC; no command requiring administrator rights as a hidden prerequisite.
- Timeouts and cancellation rules per step, with clear retry/resume behavior.
- Third-party `postinstall`/build scripts can execute code; disclose this and prefer trusted package registries/locked dependencies.

## 9. Forma adapter requirements

**Not part of this contract:** creating/updating template definitions or hosting the registry. These belong to Forma.

Current local-development integration:

1. Catalog metadata is a reviewed source snapshot; on generation cache miss, fetch only the allowlisted private Git repository at a full immutable commit through configured Git Credential Manager.
2. Resolve exact `templateId`, version, commit, content hash, target adapter and npm manager before any fetch.
3. Export with Forma's existing exporter; key cache by commit/template/version/content SHA-256. Invoke Forma's existing installer, which validates the bundle manifest and paths.
4. Install only through the existing Forma installer, not arbitrary copying of React source into another framework.
5. Run npm install, template typecheck/build and HTTP smoke; run browser smoke separately for local evidence. Lint is skipped when Forma provides no lint tool.
6. Record template/source provenance without credentials or private repository URLs in Project Generator's generated user docs and `.project-generator/manifest.json`. No automatic template updates post-generation.

A Forma template being `tested` in Forma does **not** by itself mean its Project Generator integration is supported. Local evidence is recorded at [`phase-02-forma-local-integration.md`](../qa/evidence/phase-02-forma-local-integration.md); recipes remain `planned`. SHA-256 detects payload changes but is not a signed publisher attestation. Interrupted fetch/export can leave partial cache directories; ambiguous data is not removed automatically. Lifecycle scripts remain unsandboxed, second-account ACL denial is untested, and process-crash recovery does not claim power-loss durability.

## 10. Structured event contract

```ts
type JobStatus =
  | 'queued'|'running'|'completed'|'partial'|'failed'|'cancelled';

type StageStatus = 'pending'|'running'|'passed'|'failed'|'skipped';

interface JobEventV1 {
  schemaVersion: 1;
  jobId: string;
  sequence: number;    // monotonic per job
  timestamp: string;  // ISO 8601
  type: 'job-started'|'stage-started'|'stage-progress'|
        'stage-finished'|'validation'|'warning'|'error'|'job-finished';
  stageId?: string;
  stageStatus?: StageStatus;
  percent?: number;   // optional, not falsified when progress unknowable
  message: string;    // redacted user-safe text
  code?: string;
}
```

- Events append-only in bounded local job logs, sequence-ordered and resumable for UI reconnect.
- Progress may be indeterminate rather than a fabricated percentage.
- Error IDs include `GEN_PATH_EXISTS`, `GEN_PATH_UNSAFE`, `GEN_TOOL_MISSING`, `GEN_TOOL_UNSUPPORTED`, `GEN_RECIPE_UNTESTED`, `GEN_INCOMPATIBLE`, `GEN_INSTALL_FAILED`, `GEN_CANCELLED`, `GEN_FORMA_AUTH`, `GEN_FORMA_INTEGRITY`, `GEN_VALIDATE_FAILED`, `GEN_STAGING_LEFTOVER`.
- Every error maps to user-visible stage, cause, whether output was modified, and next action.

## 11. Reproducibility manifest

Proposed generated file: `.project-generator/manifest.json` (must not contain credentials):

```json
{
  "schemaVersion": 1,
  "generatorVersion": "<exact-version>",
  "recipeId": "fe-react-vite-v1",
  "recipeStatusAtCreation": "tested",
  "createdAt": "<ISO-8601>",
  "platform": "win32-x64",
  "selectedAdapters": [
    { "id": "frontend.react-vite", "version": "<exact-adapter-version>" }
  ],
  "toolVersions": { "node": "<resolved-version>", "npm": "<resolved-version>" },
  "upstreamSources": [{ "source": "create-vite", "resolvedVersion": "<exact>" }],
  "template": null,
  "validation": [{ "id": "frontend-build", "status": "pass" }]
}
```

For fully reproducible builds, also retain generated lockfiles and checksums for immutable template artifacts. A selected semver range alone is not sufficient. Do not leak local absolute paths if user exports a project report.

## 12. QA obligations per adapter

Mandatory for a `TEST` recipe:

1. Unit schema tests for valid/invalid combinations and manifest invariants.
2. Isolated plan snapshot tests (without network/filesystem writes).
3. Windows path tests: `C:\Users\Test User\...`, `E:\Projects\...`, Unicode segment, device name, dot, junction, long path.
4. Real independent scaffold and install in a clean directory.
5. Real check commands appropriate to output (lint/typecheck/build/test, `go test`, Composer/PHP checks, uv/Python checks).
6. Smoke test: frontend renders; backend endpoint responds; DB integration optionally requires a reachable test service and must not be reported as passed otherwise.
7. Cancel/rollback and destination collision tests; no destroyed user files.
8. Documentation assertions: commands work and referenced paths exist.
9. Log scrubbing checks and an offline/no-auth failure scenario where applicable.
10. Store pinned versions, exit codes, test artifacts and approved status change.

See `docs/qa/acceptance-matrix.md` for traceability.

The shared pipeline implements FE-01–FE-15. All still have `planned` status: the development-only CLI override permits local evidence gathering but does not enable normal generation or promote support status. Yarn and pnpm linker settings are recipe-pinned and written into generated projects; package-manager choice never silently changes. See per-recipe reports linked from the QA matrix.

## 13. Prohibited shortcuts

- Never set a feature to `tested` after merely running `npm install`.
- Never use a generic shell command string from a UI form or plugin manifest.
- Never silently change selected frameworks, package manager, database or template on failure.
- Never place passwords, private GitHub tokens, or `.env` credentials into generated docs/repository.
- Never call Docker or initialize GitHub remote without explicit user action.
- Never claim unsupported native iOS build capability on Windows.
- Never add dependencies to a different language ecosystem to fake package-manager uniformity.

## 14. Future evolution

- Adapter contract version bump requires compatibility migration with test vectors.
- Third-party adapter SDK needs signed packages, sandbox/process isolation, permission model and release governance; not part of V1.
- Remote creation/deploy and AI project generation require separate PRDs and permission boundaries.
