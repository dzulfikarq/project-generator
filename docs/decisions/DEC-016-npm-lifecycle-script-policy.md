# DEC-016 — npm Lifecycle Script Execution Policy

| Field | Value |
|---|---|
| Status | Accepted Discovery — interim Phase 01 CLI policy |
| Date | 2026-11-12 |
| Owner | Unassigned |
| Related | PRD-019, NFR-004, NFR-005, GEN-012, DEC-014 |
| Supersedes | None |
| Approval | User requested a Phase 01.6 lifecycle-script policy; no release approval implied |

## Context and problem

`npm install` can execute arbitrary package lifecycle code, including transitive dependencies. Phase 01 installs generated project dependencies with lifecycle scripts enabled. The pinned scaffold-tool installation uses `--ignore-scripts`; that does not disable scripts during the generated project's dependency install. No OS sandbox exists.

## Policy

For Phase 01 CLI only, an explicit `generate` invocation is consent to the selected recipe's declared network/install work, including npm lifecycle scripts. The plan identifies lifecycle execution; CLI usage warns; each job emits `GEN_LIFECYCLE_SCRIPTS` before scaffolding/install begins; installation records that scripts were allowed. `plan` and `doctor` do not run package scripts. The generator does not request elevation. Child processes inherit the caller's token. Phase 01.7 checks the Windows caller token during preflight and again in the native helper; elevated generation and native staging mutations fail closed. This check does not reduce the privileges of non-elevated callers or isolate child code.

This is disclosure plus explicit job intent, not isolation or per-script approval. Third-party scripts can access anything available to the caller's token and can start processes. Do not describe them as sandboxed or trusted. `--ignore-scripts` is not the generated-project default because upstream dependencies can require install hooks; an install without hooks is not equivalent evidence and must not be reported as a successful usable recipe without separate validation.

## Alternatives

| Option | Benefits | Costs / downsides | Risks | Reversibility |
|---|---|---|---|---|
| A. Run lifecycle scripts as part of explicit `generate`, with prior disclosure | Preserves upstream npm behavior and dependency install compatibility; matches current CLI warning/plan | Executes third-party code with caller-token privileges; no per-package approval | Malicious/compromised dependency can read caller-accessible data or spawn processes | High |
| B. Disable scripts by default (`--ignore-scripts`) | Prevents npm lifecycle hooks during installation | Native/bundled dependency setup may fail; package is not necessarily usable; separate build scripts still execute | False readiness if hooks are needed or validation incomplete | High |
| C. Require a separate explicit script opt-in | Stronger user awareness and future UI affordance | Requires CLI/API behavior change and consent UX; still no isolation after opt-in | Users may mistake consent for sandboxing | High |
| D. Run installs in OS isolation | Limits some effects if correctly configured | Requires a separate native/OS architecture, packaging, network and artifact design | Isolation misconfiguration/escape; not solved by Job Objects alone | Medium-low |

## Rationale and conditions

Use A only as an interim Phase 01 development policy: `generate` is the execution choice, with disclosure before any install hook. Keep FE-01/FE-02 `planned` and NO-GO; this policy does not certify dependency safety or release readiness. A future desktop UI must obtain affirmative consent in the review flow before starting downloads or scripts, with consent unselected by default and a plain statement that code runs unsandboxed as the user. Revisit this policy before adding package managers, arbitrary plugins, or release support.

If the warning or plan disclosure is missing, fail the applicable test and block generation rather than silently treating scripts as safe. The elevated-token guard is implemented, but non-elevated process/filesystem integration and clean-machine packaging evidence remain release blockers. Consent remains disclosure plus explicit job intent, never sandboxing or per-script isolation.

## Evidence

The Phase 01.6 Windows E2E event streams contain `GEN_LIFECYCLE_SCRIPTS` before the `installing` stage, followed by `package lifecycle scripts were allowed` validation. These runs prove disclosure/order for those executions only; they do not prove script safety or sandboxing. See [FE-01](../qa/evidence/FE-01/2026-11-11-phase-01.6-cli-e2e.md) and [FE-02](../qa/evidence/FE-02/2026-11-11-phase-01.6-cli-e2e.md).

## Revision history

2026-11-12: Recorded interim policy at user's request; execution remains unsandboxed and no release approval is implied.
2026-11-12: Phase 01.7 adds elevated-token detection/rejection; lifecycle-script consent and unsandboxed execution policy remain unchanged.
