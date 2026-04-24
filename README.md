<p align="center">
  <img src="docs/screenshots/wasm.png" alt="FFmpeg UI — WebAssembly" width="49%" />
  <img src="docs/screenshots/desktop.png" alt="FFmpeg UI — Desktop Native" width="49%" />
</p>

<h1 align="center">FFmpeg UI</h1>

<p align="center">
  A visual interface for FFmpeg. Convert, remux, trim, and process media without touching the terminal.
</p>

<p align="center">
  <a href="https://ffmpeg-ui.vercel.app"><strong>Live web app</strong></a> ·
  <a href="https://github.com/bennypepper/FFmpeg-UI/releases/latest"><strong>Download desktop</strong></a> ·
  <a href="https://github.com/bennypepper/FFmpeg-UI"><strong>Source code</strong></a>
</p>

---

## What is it?

FFmpeg UI is a frontend for [FFmpeg](https://ffmpeg.org), the open-source media processing tool. Instead of writing command-line flags, you get a UI that builds and runs the commands for you.

It runs in three different environments, each suited to a different use case, but all sharing the same React component library and FFmpeg command-building logic.

---

## Platforms

### Desktop (Tauri)

An installable native app (`.msi` / `.dmg` / `.AppImage`) built with [Tauri v2](https://v2.tauri.app) and Rust.

- Direct access to your file system — no uploads, no file size limits
- Bundles FFmpeg via ffmpeg-sidecar; auto-downloads the binary if not already installed
- Native OS notifications on job completion
- Settings saved across sessions
- Hardware acceleration selector (NVENC, VAAPI, VideoToolbox, etc.)
- Batch queue for processing multiple files

Source: [`apps/desktop/`](./apps/desktop/)
Download: [GitHub Releases](https://github.com/bennypepper/FFmpeg-UI/releases/latest)

---

### Browser (WebAssembly)

FFmpeg compiled to WASM, running inside your browser tab. No server involved. Files stay on your device.

- Works in Chrome, Firefox, Edge, and Safari
- Uses [`@ffmpeg/ffmpeg`](https://github.com/ffmpegwasm/ffmpeg.wasm) v0.12
- Requires a one-time ~30 MB WASM download on first load, with a visible progress bar
- Requires `Cross-Origin-Embedder-Policy: require-corp` for `SharedArrayBuffer` support
- Deployed to Vercel with the required isolation headers

Source: [`apps/wasm-web/`](./apps/wasm-web/)
Live: [ffmpeg-ui.vercel.app](https://ffmpeg-ui.vercel.app)

---

### Local server (Python, legacy)

The original version. A Python Flask server processes media on the machine running it. Useful for home servers or headless setups.

Two sub-versions:

| Version | Path | Description |
|---|---|---|
| Legacy | [`apps/local-server/`](./apps/local-server/) | Flask API + plain HTML/CSS/JS frontend. No build step. |
| Modern web UI | [`apps/local-server-web/`](./apps/local-server-web/) | Same Flask API, served with the shared React UI package. |

Requirements: Python 3.8+, FFmpeg on system PATH.

```bash
# Windows
install_dependencies.bat
start_converter.bat

# macOS / Linux
./install_dependencies.sh
./start_converter.sh
```

---

## Features

| Feature | Desktop | WASM | Local server |
|---|:---:|:---:|:---:|
| Video conversion | ✅ | ✅ | ✅ |
| Audio conversion | ✅ | ✅ | ✅ |
| Remux (no re-encode) | ✅ | ✅ | ✅ |
| Thumbnail extraction | ✅ | ✅ | ✅ |
| Merge / concatenate | ✅ | ✅ | ✅ |
| Batch queue | ✅ | ✅ | ✅ |
| Quick presets (TikTok, YouTube, Discord...) | ✅ | ✅ | ✅ |
| Media info + preview | ✅ | ✅ | ✅ |
| Hardware acceleration | ✅ | ❌ | Depends |
| Native file system access | ✅ | ❌ | ✅ |
| No internet required | ✅ | ❌¹ | ✅ |
| No installation needed | ❌ | ✅ | ❌ |
| Files stay on your device | ✅ | ✅ | ✅ |

> ¹ WASM needs an internet connection on first load to download the ~30 MB core. After that it uses the browser cache.

---

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│                    packages/core                            │
│         TypeScript FFmpeg command builder                   │
│   buildFFmpegArgs({ mode, fmt, vc, crf, input, ... })      │
└───────────────────────┬─────────────────────────────────────┘
                        │ produces string[]
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
   Desktop (Tauri)   WASM (Browser)  Local server
   Rust sidecar      ffmpeg.exec()   Python subprocess
   spawns FFmpeg     runs in WASM    runs FFmpeg
   natively          worker thread   server-side
          │             │             │
          └─────────────┼─────────────┘
                        │
                        ▼
               packages/ui
         Shared React components
         (MediaEditor, DropZone,
          BatchQueue, Terminal,
          SettingsPanel, Presets...)
```

The command logic lives in `@ffmpeg-ui/core`, a framework-agnostic TypeScript package. The UI lives in `@ffmpeg-ui/ui`, a React component library using CSS Modules with a glassmorphism design system. Each platform app (`desktop`, `wasm-web`, `local-server-web`) consumes both packages and handles its own backend.

---

## Repository structure

```
FFmpeg-UI/
├── apps/
│   ├── desktop/              # Tauri v2 + React 19 (native desktop)
│   │   └── src-tauri/        #   Rust backend — commands, sidecar, plugins
│   ├── wasm-web/             # Vite + React 19 (WebAssembly browser app)
│   ├── local-server/         # Legacy: Flask API + plain HTML/CSS/JS
│   └── local-server-web/     # Modern: Flask API + React 19 UI
│
├── packages/
│   ├── core/                 # @ffmpeg-ui/core — FFmpeg command builders (TypeScript)
│   └── ui/                   # @ffmpeg-ui/ui  — shared React components + CSS Modules
│
├── docs/
│   ├── ARCHITECTURE_PRD.md   # Engineering notes and migration plan
│   └── screenshots/          # UI screenshots
│
├── turbo.json                # Turborepo pipeline config
├── vercel.json               # COEP/COOP headers for Vercel deployment
└── package.json              # Workspace root (npm workspaces + Turborepo)
```

---

## Getting started

### Prerequisites

| Tool | Version | Required for |
|---|---|---|
| Node.js | 18+ | All apps |
| npm | 9+ | All apps |
| Rust + Cargo | stable | Desktop only |
| Python | 3.8+ | Local server only |
| FFmpeg | any | Local server only |

> Desktop (Tauri) requires additional setup depending on your OS. See the [Tauri v2 prerequisites guide](https://v2.tauri.app/start/prerequisites/). On Windows that means the Visual Studio C++ Build Tools and WebView2.

---

### 1. Clone

```bash
git clone https://github.com/bennypepper/FFmpeg-UI.git
cd FFmpeg-UI
```

### 2. Install dependencies

```bash
npm install
```

This installs dependencies for all workspace packages in one go via npm workspaces.

---

### Running the WASM app

```bash
cd apps/wasm-web
npm run dev
```

Open `http://localhost:5173`. The WASM core (~30 MB) downloads on first load. Once the titlebar shows "Ready", you can start converting files.

> The WASM core requires cross-origin isolation headers. The dev server in `vite.config.ts` already sets them. For production, `vercel.json` handles it.

---

### Running the desktop app

```bash
cd apps/desktop
npm run tauri dev
```

On a machine without FFmpeg installed, the app will offer to download the required binaries (~80 MB) on first launch.

**Building an installer:**

```bash
npm run tauri build
```

Output goes to `apps/desktop/src-tauri/target/release/bundle/`.

---

### Running the local server

```bash
cd apps/local-server

# Windows
install_dependencies.bat   # installs Python deps
start_converter.bat        # starts Flask on http://localhost:5000

# macOS / Linux
./install_dependencies.sh
./start_converter.sh
```

---

### Running everything

```bash
# From repo root — starts all apps in parallel via Turborepo
npm run dev
```

> This will also try to start the Tauri desktop app, which requires Rust. Skip it if you haven't set that up.

---

## Tech stack

### Desktop
- [Tauri v2](https://v2.tauri.app) — Rust-based native app shell
- [React 19](https://react.dev) + TypeScript
- [ffmpeg-sidecar](https://crates.io/crates/ffmpeg-sidecar) — FFmpeg binary management in Rust
- `tauri-plugin-store`, `tauri-plugin-notification`, `tauri-plugin-dialog`

### WebAssembly
- [Vite 8](https://vite.dev) + React 19 + TypeScript
- [`@ffmpeg/ffmpeg`](https://github.com/ffmpegwasm/ffmpeg.wasm) v0.12 — FFmpeg compiled to WASM
- [`@ffmpeg/util`](https://github.com/ffmpegwasm/ffmpeg.wasm) — `fetchFile` helper

### Shared packages
- `@ffmpeg-ui/core` — pure TypeScript, no runtime dependencies. Builds FFmpeg argument arrays from structured options objects.
- `@ffmpeg-ui/ui` — React 19 + CSS Modules. No external CSS frameworks. Glassmorphism design system with dark/light mode.

### Monorepo tooling
- [Turborepo](https://turbo.build) — parallel task runner with caching
- npm workspaces — dependency hoisting and cross-package linking

---

## Design system

The UI uses a custom CSS variable system with no Tailwind or external component libraries.

- Glassmorphism: `backdrop-filter: blur()`, translucent panels
- Monochromatic palette with dark and light modes via `[data-theme="dark"]`
- CSS Modules for scoped styles across packages
- Micro-animations in vanilla CSS

---

## License

MIT © [bennypepper](https://github.com/bennypepper)

---

## Contributing

Pull requests are welcome. For major changes, open an issue first.
The architecture is documented in [`docs/ARCHITECTURE_PRD.md`](./docs/ARCHITECTURE_PRD.md).
