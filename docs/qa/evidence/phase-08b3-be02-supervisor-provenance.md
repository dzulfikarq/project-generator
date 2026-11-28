# Phase 08B.3 — BE-02 supervisor provenance and native acceptance

| Field | Value |
|---|---|
| Date | 2026-11-26 |
| Scope | Build → isolated stage → Tauri launch identity before at most one BE-02 generation; then bounded result/History/Open checks |
| Outcome | **Generation PASS; overall Phase 08B.3 FAIL / incomplete** — prior harness assertion stopped follow-up UI checks |
| Host | Non-elevated Windows x64; Node `22.22.1`; Go `1.26.7` |
| Source revision | `8ce36f8a7ff20d394e67ed1948ef6ecd89d4e249` |
| Run source fingerprint | `7f837cc9f3cecf7b840453a5ffbf194a9a90dcab0c81d4088a82e11c57314606` (94 files) |
| Retained run root | `C:\Users\Augie Winanda F\AppData\Local\Temp\opencode\phase-08b3-be02-05v7S1` |

## Scope and limits

- Cap: at most one generation. Actual: one generation, zero automatic retries. Earlier harness starts stopped before generation with `generationAttempts: 0`; they did not create another project.
- No additional cancellation, collision, full-E2E, or repository-wide audit was run. Protected diagnostics and prior historical artifacts were not accessed or changed.
- WMI process-start observation was unavailable. Runtime identity evidence uses the development-only Node spawn hook: PID, `spawnfile`, and SHA-256 at successful child spawn. This proves which image Node asked Windows to launch; it is not independent OS process-start telemetry.

## Provenance gate — PASS

Preflight passed on a non-elevated token. The repository baseline was release profile with planned generation disabled; the explicitly authorized evidence run staged a development-profile core in the isolated Tauri runtime to expose the internal planned-recipe consent. Cleanup restored the release profile. The isolated Cargo supervisor build used `--locked --release --offline` and exited `0`.

| Identity point | Evidence | SHA-256 |
|---|---|---|
| Isolated supervisor build | `cargo-supervisor-target/release/pg-windows-supervisor.exe` | `cc710524a2a8f5f21f98d0c77ecd462a6355f0dea3b9815e8ef4ff208c042b19` |
| Staged runtime image | Isolated Tauri resource `.../core/native/pg-windows-supervisor.exe` | `cc710524a2a8f5f21f98d0c77ecd462a6355f0dea3b9815e8ef4ff208c042b19` |
| Pre-generation Tauri invocation | `--recovery-inspect`, observed at spawn before generation | `cc710524a2a8f5f21f98d0c77ecd462a6355f0dea3b9815e8ef4ff208c042b19` |
| Generation invocations | Retained JSONL contains `--run` spawn observations from the single generation | `cc710524a2a8f5f21f98d0c77ecd462a6355f0dea3b9815e8ef4ff208c042b19` |

All recorded launch paths resolve to the isolated staged image. The retained supervisor-launch JSONL has one `--recovery-inspect` record before generation and subsequent `--run` records; every observed executable hash matches the built and staged hash. Repository supervisor/path-verifier binaries and the repository-staged supervisor remained unchanged.

The captured run report recorded `runtimeLaunchIdentity` as `PRE-GENERATION PASS; generation NOT VERIFIED`, because the harness did not complete its post-generation evidence processing. The retained JSONL independently records the `--run` launches and matching image hash. A later harness change moves the post-generation launch-evidence check immediately after the generation terminal event; that change was not exercised natively.

## Single generation — PASS

- Job `ec851072-a633-48e9-813e-9e7ca142ec0a` reached terminal status `completed`, stage `finalizing`. The manifest records recipe `BE-02`, status `planned`, module `github.com/example/pg-be-02-go`, and all seven validation statuses as `pass`.
- Six command-backed validations (`go-module`, `go-fmt`, `go-vet`, `go-test`, `go-build`, `http-smoke`) each record exit code `0`. `scaffold-identity` is an in-process identity check and correctly has no command exit code.
- A post-run read-only check verified the retained manifest, exact generated-file inventory, canonical non-symlink destination, expected `go.mod`, absent `go.sum`, no extra workspace entries, no owned staging directory, and empty recovery inspection. Generated tree SHA-256: `2eba91c5115a501b216b99b7013e4f811f1d7bc06a9732ce5465d95eace1dd4b`; manifest SHA-256: `3d86d3c4641b8b053bb40bfc6462bf0f651791f053c9dc4caba4a02a5795885f`.

## Prior harness verification — FAIL

- The harness asserted every validation had both `status === 'pass'` and `exitCode === 0`. That assertion failed on `scaffold-identity`, before folder/editor open and History checks. The Result page had rendered; completion of overall bounded UI acceptance was not established.
- This was a harness assertion failure, not evidence that a recipe validation failed. No retry or second generation was permitted or run.

### Supervisor diagnostic

The job log reports child exit `-1073741510`, supervisor exit `0`, `terminationConfirmed: true`, and no active child processes. It classifies this as `process_nonzero_exit`; HTTP-smoke validation is `pass`. The process termination cause is **UNKNOWN**. This observation does not resolve the historical supervisor failure or establish a product defect.

## Cleanup and retained evidence

Current-run cleanup **PASS**: desktop process exited `0`; zero acceptance processes remained; ports `1420` and `9339` were free; release build profile was restored; `cleanupFailures` was empty. Generated output and evidence remain retained under the run root. The pre-existing failure artifacts and protected diagnostics were not read.

Run report and raw spawn evidence:

- `phase-08b3-report.json`
- `app-data/temp/phase-08b3-supervisor-launches.jsonl`
- `workspace/pg-be-02-go/.project-generator/manifest.json`
- `app-data/temp/project-generator-job-tPkrGj/ec851072-a633-48e9-813e-9e7ca142ec0a.log`
- `desktop-dev.log`

## Post-run harness correction and verification

After the single generation, initial harness correction required `scaffold-identity.status === 'pass'` separately and exit code `0` only for command-backed validations. The 2026-11-26 focused support suite passed **19/19**; no native rerun was made.

### 2026-11-27 final closure checks

- `assertGoValidationResults` now checks exact validation IDs/order; `scaffold-identity` must have `status: pass` and exact expected identity message, but needs no `exitCode`. Six command-backed validations must each have `status: pass` and `exitCode: 0`.
- Added regressions: identity evidence passes without `exitCode`; incorrect identity message fails; process result without exit code or with failed status fails.
- `node --check` for the harness, support module, and support test: PASS. `node --test scripts/phase-05b-native-e2e-support.test.mjs`: **21/21 PASS**. Root `npm run typecheck` (core, CLI, desktop): PASS. Scoped `git diff --check`: PASS.
- Current source fingerprint, same 94-file scope: `b8604dc7338c08b2ba8daac3167a5e7e1d682cbaa6d428ac0184b04790fc66ca`; HEAD remains `8ce36f8a7ff20d394e67ed1948ef6ecd89d4e249`. Fingerprint differs from run because harness/test fixes followed it. Corrected assertion has **not** been exercised in a native run.
- State check: generated project remains on disk, but isolated `webview-profile` and `app-data/roaming` are empty; isolated `app-data/local` has only transaction/cache/temp entries, no UI history store. Desktop stores History metadata in WebView `localStorage`; the isolated profile has no saved History record. Result page/current-project state is not persisted. No desktop UI was relaunched, and no project was recreated. History, Open Folder, and Open VS Code remain **NOT VERIFIED**.

## Disposition

Generation and supervisor build/stage/launch identity are **PASS for the observed run**. The previous harness assertion is **FAIL**; corrected assertion is **PASS in targeted unit tests, not native-verified**. Overall Phase 08B.3 remains **FAIL / incomplete** because History, Open Folder, and VS Code remain **NOT VERIFIED**. Evidence is ready for bounded independent review only. Keep BE-02 `planned`, promotion **NO-GO**, public release **NO-GO**, and historical supervisor/cleanup causes **UNKNOWN**.
