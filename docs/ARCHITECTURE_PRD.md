# FFmpeg UI - Architecture Notes

## 1. Overview

FFmpeg UI is a monorepo that ships one media-conversion interface in three environments:

1. **Desktop (Tauri v2):** a native installable app. A Rust backend runs FFmpeg directly on the user's machine.
2. **WebAssembly web app:** a browser-only app that runs `@ffmpeg/ffmpeg` in a Web Worker. No server is involved.
3. **Local server:** a Python Flask server that runs FFmpeg for a React UI served from the same host. Meant for home servers and headless setups.

File I/O differs completely between these environments, so only two things are shared: the React UI (`packages/ui`) and the FFmpeg command planning logic (`packages/core`).

---

## 2. Repository layout

The repo uses **Turborepo v2** and **npm workspaces**. `apps/` holds the executables and `packages/` holds the shared libraries.

```text
FFmpeg-UI/
├── apps/
│   ├── desktop/            # Tauri v2 + Vite + React 19
│   │   └── src-tauri/      #   Rust: command_builder, jobs, process, progress, downloader
│   ├── wasm-web/           # Vite + React 19, FFmpeg in WebAssembly
│   ├── local-server/       # Flask API (server.py), scripts, pytest suite (tests/)
│   └── local-server-web/   # Vite + React 19 UI, built to dist/ and served by Flask
├── packages/
│   ├── core/               # @ffmpeg-ui/core: option types, platform capabilities, planner, Vitest suite
│   └── ui/                 # @ffmpeg-ui/ui: MediaEditor, SettingsModal, AboutModal, Slider, TerminalOutput
├── .github/                # CI, release workflow, Dependabot
├── docs/
│   ├── ARCHITECTURE_PRD.md # This file
│   └── screenshots/
├── package.json            # Workspace root
└── turbo.json              # Task pipeline (build, lint, typecheck, test, dev)
```

`packages/core` and `packages/ui` are consumed as TypeScript source (`main` points at `src/index.ts`). Their `build` script is a typecheck. Turbo's `build` task depends on `^build`, so `core` is checked before `ui`, and both before the apps.

---

## 3. Technology stack

* **Monorepo tooling:** Turborepo 2, npm workspaces (Node 20.19+ or 22.12+).
* **Frontend:** React 19, Vite 8, TypeScript 5.9.
* **Desktop backend:** Tauri v2, Rust.
* **WebAssembly engine:** `@ffmpeg/ffmpeg` 0.12 with the single-threaded `@ffmpeg/core` 0.12.6.
* **Server backend:** Python 3.11+, Flask 3, Flask-CORS, `subprocess`.
* **Styling:** plain CSS (variables, glassmorphism), no CSS framework.
* **Tests:** Vitest (`packages/core`), pytest (`apps/local-server/tests`), `cargo test` (`apps/desktop/src-tauri`).

---

## 4. Shared packages

### `@ffmpeg-ui/core`

* `types.ts`: `CommandOptions`, processing modes, `RuntimePlatform` (`'wasm' | 'desktop' | 'local-server'`).
* `capabilities.ts`: per-platform capability tables (supported modes, video and audio codecs, hardware acceleration, containers) with reasons for disabled options, plus helpers such as `getCompatibleCodecs`, `reconcileOptionsForFormat` and `validateOptions`.
* `command-builder.ts`: `planFFmpegJob(options, platform)` returns `{ args, outputName, outputExt, warnings, errors }`. `buildFFmpegArgs` is a thin wrapper that returns the argument array.
* Tests live in `src/__tests__/` and include integration tests that run the generated arguments against a real `ffmpeg` binary.

### `@ffmpeg-ui/ui`

React components shared by all three apps. The central component is `MediaEditor`, which owns the batch queue, per-item options, presets and the settings modal. Apps pass in an execute callback and platform-specific props (progress, logs, capabilities); they do not re-implement the editor.

---

## 5. Platform differences

| Concern | Desktop | WASM | Local server |
|---|---|---|---|
| FFmpeg | System binary, or a pinned download verified by SHA-256 | `@ffmpeg/core` 0.12.6 (FFmpeg 5.1.4), single thread | System binary |
| Execution | Rust spawns FFmpeg and emits progress events | `ffmpeg.exec()` in a worker, in-memory filesystem | Flask runs `subprocess`, streams progress over SSE |
| Video codecs | `libx264`, `libx265`, `libvpx-vp9`, `prores_ks`, copy | `libx264`, `prores_ks`, copy | Same as Desktop |
| Hardware acceleration | none, CUDA, QSV | none | none, CUDA, QSV |
| Merge | Planned | Planned | Supported |

The planner enforces these differences by taking the target platform as an argument and returning errors for unsupported combinations.

---

## 6. Security model

* **Local server:** listens on `127.0.0.1` only, restricts CORS to local origins, issues a per-boot token that API requests must present, and caps upload size.
* **Desktop:** strict Content Security Policy, least-privilege capabilities, no global asset-protocol scope (access is granted per selected file), FFmpeg arguments assembled by a typed Rust command builder rather than passed through from the frontend, and SHA-256 verification of downloaded FFmpeg archives.
* **WASM:** Content Security Policy, COOP/COEP/CORP headers (required for cross-origin isolation), `nosniff`, restrictive `Referrer-Policy` and `Permissions-Policy`, and cleanup of the virtual filesystem after jobs.

---

## 7. Architectural rules

1. **Separation of concerns.**
   * FFmpeg command generation belongs in `packages/core`. Apps must not build FFmpeg arguments themselves.
   * General UI belongs in `packages/ui`. Put a component in an app only when it is specific to that environment, such as a native file picker.
2. **TypeScript first.** Strict mode (`"strict": true`) is enabled across `packages/core`, `packages/ui`, and all three web/desktop apps.
3. **Abstracted file I/O.** `packages/core` assumes neither a native disk nor a browser sandbox. It returns argument arrays and an output name; each app handles execution.
4. **Platform checks live in core.** Do not hide or show codecs with ad hoc conditions in the UI or the apps. Add them to the capability tables.
5. **Declare what you import.** Every package lists the workspace packages and libraries it imports in its own `package.json` (for example, `@ffmpeg-ui/ui` depends on `@ffmpeg-ui/core`). Do not rely on hoisting.
6. **One tool version per workspace.** TypeScript, ESLint, `typescript-eslint`, `globals` and Vite are kept on the same versions in every workspace.

---

## 8. Quality gates

| Check | Command | Scope |
|---|---|---|
| Typecheck | `npm run typecheck` | All JS/TS workspaces |
| Lint | `npm run lint` | All JS/TS workspaces |
| Unit and integration tests | `npm run test` | `packages/core` (Vitest, needs `ffmpeg` on `PATH`) |
| Build | `npm run build` | All apps |
| Dependency audit | `npm audit --omit=dev --audit-level=high` | Root lockfile |
| Python lint and tests | `ruff check apps/local-server` and `pytest apps/local-server/tests` | Local server |
| Rust lint and tests | `cargo clippy ... -- -D warnings` and `cargo test` | `apps/desktop/src-tauri` |

GitHub Actions (`.github/workflows/ci.yml`) runs all of these on pushes and pull requests to `main`. `.github/workflows/release.yml` builds Tauri installers for Windows, macOS and Linux on `v*` tags. Dependabot opens weekly updates for npm, Cargo, pip and GitHub Actions.

Release checklist: keep `version` in every `package.json`, `apps/desktop/src-tauri/Cargo.toml` and `apps/desktop/src-tauri/tauri.conf.json` identical, then push a `v<version>` tag.

---

## 9. History

The project started as a standalone Python/Flask web wrapper around FFmpeg, then moved into this monorepo in five phases:

1. **Foundation:** Turborepo and npm workspaces, legacy app moved to `apps/local-server`, Vite + React scaffolds, empty shared packages.
2. **Core logic port:** the command generation moved from vanilla JS into TypeScript in `packages/core`.
3. **Shared UI:** React components in `packages/ui`, consumed by every app.
4. **Platform wiring:** WASM runtime, Tauri backend, and the React UI served by Flask replacing the vanilla HTML/JS frontend.
5. **Hardening:** validated planner and capability tables, tests across TypeScript, Python and Rust, CI/CD, Dependabot, and the security work described above.

Remaining work: merge/concatenate on Desktop and WASM.
