# Phase 02 — Forma Local Integration Evidence

| Field | Value |
|---|---|
| Status | **Local development E2E passed for listed cases; independent acceptance/release approval pending** |
| Date | 2026-11-13 |
| Source | `dzulfikarq/design-templates` commit `5cf3c4e5b7b0bc454a653f58d12237c56f2548e2` |
| Host | Windows 10 Pro, build `26300`, x64; Node.js `22.22.1`; npm `10.9.4` |
| Scope | CLI generation only; no Tauri UI, recipe promotion, or release claim |

All Forma runs used `--development-allow-planned`. Generated targets/configs and JSONL outputs were under the approved local temp `opencode/phase 02 forma` directory, outside this repository. Git Credential Manager authenticated the private source fetch; later runs reused the verified pinned-source cache. The Forma working tree remained clean at the pinned commit.

After final source changes, the built `forma-worker.js fetch` path also completed a cold authenticated fetch into a separate approved temp directory with Git redirect following disabled; it returned `{ "ok": true, "commitSha": "5cf3c4e5b7b0bc454a653f58d12237c56f2548e2" }` and a clean worktree.

## Forma integration runs

Each row passed scaffold identity, npm dependency install, TypeScript check, production build, and Project Generator HTTP smoke. Lint was recorded `skipped`: Forma's installer does not provide a lint script/tool. Browser checks used Forma's existing smoke scripts against the generated production app.

| Job ID | Template / version | Framework / selected theme | Portable SHA-256 | Browser smoke |
|---|---|---|---|---|
| `00b5bb48-5a79-4840-a6d4-17495c757182` | Staywise Host Dashboard `0.1.0` | React + Vite / Coral | `b84213bb8c0950ee7297ea423338eae2d2ac577023444d0893b7d31d36b331cd` | Pass — font, accent, navigation, dialogs, theme, typography, 820/375px layouts |
| `6134cefb-063d-4fe5-939e-d64340043e0a` | Staywise Host Dashboard `0.1.0` | Next.js App Router / Coral | `b84213bb8c0950ee7297ea423338eae2d2ac577023444d0893b7d31d36b331cd` | Pass — same checks on production server |
| `873cb3b1-d0da-4c70-bda0-d8272e198ffd` | Modern Admin `1.0.0` | React + Vite / Ember | `1b5b7525e8c418eb6ec9b12d98b4fd6ed9e1863e1a4cfe96fcf2bcab29ea1eb0` | Pass — font, accent, navigation, confirm/create dialogs, 375px layout |
| `95e4ee9e-ab5b-46ad-b7e2-6673edabe777` | Modern Admin `1.0.0` | Next.js App Router / Ember | `1b5b7525e8c418eb6ec9b12d98b4fd6ed9e1863e1a4cfe96fcf2bcab29ea1eb0` | Pass — same checks on production server |
| `557a7e56-e243-460a-8162-fcbf8461b667` | Focus Planner `0.1.0` | React + Vite / Moss | `cbe3dacea2ba9ce64a8d619d9f699875cf1549be88f143a5519ca326c048e779` | Pass — font, accent, task dialog/filter, typography, 375px layout |

The generated `.project-generator/manifest.json` records recipe `FM-01` or `FM-02`, planned status, selected template/version/variant, commit, SHA-256 and validation outcomes. Package and lockfile names match requested project name. Forma's copied install report was rewritten to use npm and a relative target; generated setup/agent docs do not claim lint exists or prescribe pnpm.

After tightening success policy so only the known unsupported Forma lint check may be skipped, Staywise + React/Vite was regenerated as job `8336baa8-67e6-4693-b1e2-702e3ee18e53`; npm install, typecheck, build, explicit lint skip, HTTP smoke, and finalization passed again. Browser smoke above ran on the preceding five outputs.

Uppercase catalog SHA regression: job `406ee6d4-6e68-41c3-9035-80b3aab07698` generated Staywise + React/Vite using `5CF3C4E5B7B0BC454A653F58D12237C56F2548E2`; source pin resolved to canonical lowercase in provenance, and install/typecheck/build/HTTP smoke passed. Lint was explicitly skipped.

## Standalone regression

Job `2ec78681-e2aa-4ffb-add8-b3e02f3ac3cb` generated standalone FE-01 React + Vite with no Forma template. Dependency install, lint, typecheck, build and HTTP smoke all passed. Recipe remains `planned`.

## Repository checks

After final source changes:

- `npm test` — exit `0`; core 38 passed, 1 expected elevated-only skip; CLI 6 passed; 0 failed.
- `npm run lint` — exit `0`.
- `npm run typecheck` — exit `0`.
- `npm test` rebuilt release/debug Windows supervisors and TypeScript workspaces before tests.

## Limits and release gates

- FE-01/FE-02/FM-01/FM-02 remain `planned`; normal generation refuses them. This is one local host's evidence, not independent acceptance or a promotion decision.
- The cache bundle hash was verified on successful installs. No adversarial cache-corruption/fault-injection test, publisher signature, or second-account ACL denial test was run.
- Git source cache/export interruptions can leave partial cache directories; ambiguous cache data is not automatically deleted or overwritten.
- npm lifecycle scripts remain unsandboxed; no same-account filesystem isolation is claimed. Existing core process-cancellation and process-crash journal recovery tests passed, but no Forma-specific interrupted network/export recovery test was run.
- Process-crash recovery does not imply power-loss durability. The historical finalize anomaly, independent security review, clean-machine packaging, and public-release approval remain open.
- Forma's upstream `forma.install.json` remains part of installed template output; it is upstream provenance metadata, not a signed publisher attestation. Project Generator's own plan/log/manifest contains no credential.
