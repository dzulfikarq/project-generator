# Phase 04A — Vue and Bootstrap Recipe Expansion

| Field | Value |
|---|---|
| Status | **PARTIAL — local CLI and native UI evidence passed; independent recipe acceptance and release approval remain open** |
| Date | 2026-11-13 |
| Host | Windows 11 Pro `10.0.26300`, x64; non-elevated generation |
| Tooling | Node.js `22.22.1`; npm `10.9.4`; Rust/Cargo `1.99.1`; Tauri `2.12.4`; Edge WebView2 `157.0.4341.46` |
| Test target root | `E:\MyProjects\pg-phase04a-acceptance-20261113` (isolated and retained) |

## Scope and result

Implemented and exercised these exact npm recipes:

- FE-03 — Vue 3 + Vite + TypeScript + plain CSS.
- FE-04 — React + Vite + TypeScript + Bootstrap 5 CSS.
- FE-05 — Vue 3 + Vite + TypeScript + Bootstrap 5 CSS.

Vue uses integrity-pinned official `create-vue@3.24.0`. Bootstrap is pinned to `5.3.9` and verified from the generated npm lockfile. Tailwind/Bootstrap combinations, Bootstrap JavaScript, Popper use, Nuxt, and Vue/Forma are excluded. All FE-01–FE-05 recipes remain `planned`; debug-only evidence runs do not enable normal generation or promote status.

The first Bootstrap desktop run exposed npm 10's automatic installation of Bootstrap's `@popperjs/core` peer despite CSS-only configuration. That run is superseded. Bootstrap generation now writes project `.npmrc` containing `legacy-peer-deps=true`, uses `npm install --legacy-peer-deps`, and fails dependency-integrity validation if Popper appears in the lock. Fresh FE-04/FE-05 CLI runs and a fresh native FE-05 run then passed with Popper absent from both lock and `node_modules`. `npm config get legacy-peer-deps` returned `true` in all three generated projects.

CLI runs used the compiled local CLI and per-recipe JSON configs. Plan, Doctor, and generation commands returned exit `0`; generation used the development-only planned override and emitted terminal `completed`:

```powershell
node packages/cli/dist/src/index.js plan --config <recipe-config.json> --json
node packages/cli/dist/src/index.js doctor --config <recipe-config.json> --json
node packages/cli/dist/src/index.js generate --config <recipe-config.json> --jsonl --development-allow-planned
```

FE-04/FE-05 configs: `FE-04-peerfix.json`, `FE-05-peerfix.json`. The desktop run used the isolated Tauri debug app, refreshed packaged CLI/core resources, and Forge Studio's Review → Generate flow. The generator's npm command was `npm install --legacy-peer-deps --package-lock=true` for Bootstrap recipes.

## CLI recipe runs

Each recipe was planned and generated using the development-only `--development-allow-planned` flag. Plan retained `recipeStatus: planned` and `executionAvailable: false`; Doctor reported ready. FE-01/FE-02 were rerun as regressions. Destinations were new and used a parent path containing spaces and `雪`.

| Recipe | Generated destination | Pinned upstream package(s) | Checks | `package-lock.json` SHA-256 |
|---|---|---|---|---|
| FE-01 | `Projects with spaces 雪/react-css-regression` | `create-vite@9.3.4` | identity, install, lint, typecheck, build, HTTP smoke — all pass; command checks exit `0` | `6291fa207b55304fa406f53599f6e9d944d4a307ad856c6c96f8739a5c19b229` |
| FE-02 | `Projects with spaces 雪/next-tailwind-regression` | `create-next-app@16.4.6` | identity, install, lint, build/typecheck, HTTP smoke — all pass; command checks exit `0` | `d7b835e2c8501528ff57af364248c1e98c0af8b0874bef3802e4f6cdd051b66a` |
| FE-03 | `Projects with spaces 雪/vue-css` | `create-vue@3.24.0` | identity, install, lint, typecheck, build, HTTP smoke — all pass; command checks exit `0` | `572cfc29573e7deb767af59200803934ac97738a677e630ed532f0613a89db86` |
| FE-04 | `Projects with spaces 雪/react-bootstrap-peerfix` | `create-vite@9.3.4`; `bootstrap@5.3.9` | identity, install, dependency integrity, lint, typecheck, build, HTTP smoke — all pass; command checks exit `0` | `5681c4b947d856f2a6900ba67fcd6c0c12947e044e8118a062426201b06fc46a` |
| FE-05 | `Projects with spaces 雪/vue-bootstrap-peerfix` | `create-vue@3.24.0`; `bootstrap@5.3.9` | identity, install, dependency integrity, lint, typecheck, build, HTTP smoke — all pass; command checks exit `0` | `b6a346394eaa18db307f5f35201a41b6d0a6559122f57c09d75fcbcef6077673` |

Pinned registry integrity values:

- `create-vue@3.24.0`: `sha512-QuVvwZ213B8ZC5u3rshPRg8Q2y6jK0zlxhujTx2AL1Cv3437Yn8GhpVipZTRQam27210uP8Xic5gxh5Sl08skw==`
- `create-vite@9.3.4`: `sha512-L02vtfSVndf0I65g0axXCjrFbhyjmN5K7szeaLRd0mMx0duW2BpzNvps5q4zHHCWexOrWrPgAx17hRz88I3bHw==`
- `bootstrap@5.3.9`: `sha512-20cU0rcfw8WdxtVbmfU+xT2EjvVTw9Ror/h1Qvd7DXCujRg8OO9mdBCsmTHdJFf3BuadmBNJtgIuUXsBqSkk/w==`
- `create-next-app@16.4.6`: `sha512-Y4TvDShkVp+66MaPXRGEGl4xMf962voeA1eEuu7Hw4S5TodM9e4suXoZASwgCCVHi7444J0sHTr3bHNvvLWb3w==`

For FE-04/FE-05, Bootstrap resolved to `5.3.9`; the lock integrity matched the reviewed value, `.npmrc` persisted the peer behavior, and neither lock nor installed tree contained `@popperjs/core`. The generated CSS entry imports only `bootstrap/dist/css/bootstrap.min.css`.

## Forge Studio FE-05 run

The isolated Tauri debug app used a private Vite port and refreshed debug runtime resources containing the current CLI/core build. The native wizard selected Vue 3 + Vite, Bootstrap 5 CSS, npm, and Standard docs. Vue + Tailwind was visibly disabled. Doctor reported supported Node/npm and destination `Available`; the review showed 12 expected writes, including `.npmrc`, and disclosed that the unused Bootstrap Popper peer would be omitted.

Both lifecycle-script consent and internal planned-recipe consent were off by default. The destination was confirmed absent and the Windows supervisor reported `elevated: false`. Generation started only after both controls were explicitly enabled. Tauri job ID: `9f189dd7-535f-4836-b05e-d94eee20f4ab`.

| Result | Evidence |
|---|---|
| Target | `E:\MyProjects\pg-phase04a-acceptance-20261113\desktop-parent\desktop-vue-bootstrap-peerfix` |
| Terminal | Native UI showed `Project checks passed`, `Completed`, and `Recipe remains planned.` |
| Validation | scaffold identity, dependency install, Bootstrap integrity, lint, typecheck, build, HTTP smoke — all pass; process checks exit `0` |
| Manifest status | `recipeId: FE-05`; `recipeStatusAtCreation: planned`; selected adapters `frontend.vue-vite` and `styling.bootstrap` |
| Lock hash | `f1280842ef5a77adfc9efd4a8c1aee20f5fe6a7e5019384d104aa3dfea3b9932` — manifest value matched independently recomputed SHA-256 |
| Bootstrap | `5.3.9`; expected npm integrity matched; Popper absent from lock and `node_modules` |

The HTTP smoke check verifies a local HTML response. It is not browser automation or a visual rendering check. npm lifecycle scripts ran unsandboxed after explicit consent.

## Automated checks

| Command | Result |
|---|---|
| `npm test` | Exit `0` — core 38 passed / 1 expected elevated-only skip; CLI 9 passed; desktop 14 passed |
| `npm run typecheck` | Exit `0` — core, CLI, desktop |
| `npm run lint` | Exit `0` |
| `npm run build --workspace @project-generator/desktop` | Exit `0` — TypeScript and Vite production build |
| `cargo test --locked` | Exit `0` — 8 Rust tests passed |
| `cargo clippy --locked -- -D warnings` | Exit `0` |
| `cargo fmt --check` | Exit `0` |
| `git diff --check` | Exit `0` |

## Remaining limits

- FE-01–FE-05 remain `planned`; release-profile generation still blocks them. No independent recipe review, support promotion, or release approval occurred.
- One Windows 11 development host was used. No clean-machine test, actual scaled-DPI acceptance, or screen-reader audit was performed in this phase.
- Lifecycle scripts remain unsandboxed; explicit consent is not isolation. No browser automation or visual rendering check was performed for generated projects.
- This evidence does not resolve the historical finalize anomaly, cross-account ACL testing, power-loss durability, or broader independent security review gates.
