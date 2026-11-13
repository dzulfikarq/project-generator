# Phase 04A — Native and Desktop Acceptance

| Field | Value |
|---|---|
| Status | **PARTIAL — FE-03–FE-05 local CLI and native desktop procedures passed; recipes remain planned; independent acceptance and release approval remain open** |
| Date | 2026-11-13 |
| Baseline | `68b3501` |
| Host | Windows 11 Pro `10.0.26300`, x64; native supervisor reported `elevated: false` |
| Tooling | Node.js `22.22.1`; npm `10.9.4`; Rust/Cargo `1.99.1`; Tauri `2.12.4`; WebView2 `157.0.4341.46` |
| Retained run root | `E:\MyProjects\pg-phase04a-native-desktop-20261113` |

## Result

Fresh non-elevated CLI and Forge Studio runs passed for all three requested combinations. Each plan remained `planned` with normal execution unavailable; Doctor reported ready. Desktop review showed closed consent gates and disabled Generate before consent. Generation used the development-only planned-recipe override after both lifecycle-script and internal-evidence consents were explicitly enabled. All result screens reported completed checks while retaining planned status.

| Recipe | CLI destination | CLI result checks | CLI lock SHA-256 | Native desktop destination | Native job | Desktop lock SHA-256 |
|---|---|---|---|---|---|---|
| FE-03 — Vue 3 + Vite + TypeScript + plain CSS + npm | `Projects with spaces 雪\cli-vue-css` | Identity, install, lint, typecheck, production build, HTTP smoke — pass | `a7f6abc1c4c61d5f5bf27bea73a933081959601ec2a1b6f99bac6f73742c1ecc` | `desktop-parent\forge-vue-css` | `bc336b88-364b-4a83-bb5c-f1390f6f3ee0` | `7fcf5f01e34ba578b9d9e1465186bbdf5dfc55597e509e1b7a8263b9d3bc7b2c` |
| FE-04 — React + Vite + TypeScript + Bootstrap 5 CSS + npm | `Projects with spaces 雪\cli-react-bootstrap` | Identity, install, dependency integrity, lint, typecheck, production build, HTTP smoke — pass | `c4edb4ac8386aef20b8ee736d5dd7622ebe86602bd4a696b646791851d633fb6` | `desktop-parent\forge-react-bootstrap` | `83bc065e-c82e-48c1-a553-4366fe248a76` | `716a1de31540e9fc0776b43ac1281ee5cf4c8a2b357a3473bcbca50003c59bf8` |
| FE-05 — Vue 3 + Vite + TypeScript + Bootstrap 5 CSS + npm | `Projects with spaces 雪\cli-vue-bootstrap` | Identity, install, dependency integrity, lint, typecheck, production build, HTTP smoke — pass | `6868941ef7595a0dc2e3f37c9148a8b78bc886d7beaf25aa42ee6d544f8fd01e` | `desktop-parent\forge-vue-bootstrap` | `2f667a04-0639-411f-8747-0bc176df8045` | `2ecdc54ef34eca60794bb4194dfb247e638a9d4fca06d181d263188927b8998c` |

CLI commands used the compiled local CLI; each generation used `--development-allow-planned`:

```powershell
node packages/cli/dist/src/index.js plan --config <recipe-config.json> --json
node packages/cli/dist/src/index.js doctor --config <recipe-config.json> --json
node packages/cli/dist/src/index.js generate --config <recipe-config.json> --jsonl --development-allow-planned
```

All three native results showed `Project checks passed`, `Completed`, and `Recipe remains planned.` FE-04 and FE-05 additionally showed passing Bootstrap dependency-integrity validation. Manifest lock hashes were independently recomputed from each generated `package-lock.json` and matched.

## Bootstrap and compatibility checks

- FE-04/FE-05 resolved `bootstrap@5.3.9`; npm lock integrity matched `sha512-20cU0rcfw8WdxtVbmfU+xT2EjvVTw9Ror/h1Qvd7DXCujRg8OO9mdBCsmTHdJFf3BuadmBNJtgIuUXsBqSkk/w==`.
- Both Bootstrap outputs contain `.npmrc` with `legacy-peer-deps=true`; `npm config get legacy-peer-deps` returned `true` in each project.
- Bootstrap was linked and imported through `src/project-generator-bootstrap.css`. Production CSS contained Bootstrap selectors/tokens (`.btn`, `--bs-primary`). No Bootstrap JavaScript was configured.
- `@popperjs/core` was absent from both lockfiles and installed trees. The planned install note explained unused Popper omission.
- FE-03 plain-CSS output contained no Bootstrap dependency or Bootstrap entry file.
- Vue wizard disabled Tailwind and all three React/Next Forma template cards. CLI plan also rejected React-only `modern-admin` and `staywise-host-dashboard` with Vue: exit `3`, `GEN_INCOMPATIBLE`, `targetModified: false`; no target directory was created.

## Desktop flow and regression checks

For each recipe, native catalog/wizard selection, read-only plan, Doctor, review, consent defaults, generation progress, and result were observed. Lifecycle-script and planned-run consent both defaulted off; Generate was disabled until both were explicitly enabled. The supervisor verified a non-elevated caller. FE-04/FE-05 review disclosed `.npmrc` and Popper peer handling. Native transcripts, CLI JSONL, configs, and outputs are retained under the run root above.

`npm test` passed: core 38 passed / 1 expected elevated-only skip, CLI 9 passed, desktop 14 passed. `npm run typecheck` and `npm run lint` also exited `0`. Cancellation (including real npm-install cancellation), target-collision, recovery/rollback regressions passed. No generator defect was found in this acceptance; no source implementation changes were needed.

## Limits and Phase 04B disposition

- This is one local Windows host run, not independent recipe acceptance. FE-01–FE-05 and FM-01/FM-02 remain `planned`; normal generation remains blocked. No release approval or push/deploy occurred.
- HTTP smoke confirms a local HTML response, not browser automation or visual rendering. Lifecycle scripts remain unsandboxed; explicit consent is not isolation. Clean-machine, actual scaled-DPI, screen-reader, and broader security review remain open.
- **GO to Phase 04B review/evidence-hardening only. NO-GO to add another framework/component system or promote recipes until independent review closes the acceptance gate.**
