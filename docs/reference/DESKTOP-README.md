# FFmpeg UI Desktop

> A native, cross-platform desktop application built with Tauri for offline media conversion. No cloud. No setup. Just drop a file and convert.

## Project Origin

This is the desktop successor to the [FFmpeg Web UI](https://github.com/bennypepper/FFmpeg-UI) project. The UI is preserved 100% — only the Python Flask backend is replaced with a native Rust/Tauri layer, enabling a single distributable installer.

## Status

🚧 **In Development** — See [docs/PRD.md](docs/PRD.md) for full product requirements and roadmap.

## Planned Tech Stack

| Layer | Technology |
|---|---|
| UI / Frontend | Carried over from web app (Vanilla HTML/CSS/JS) |
| Desktop Shell | Tauri v2 (Rust) |
| Media Engine | FFmpeg (bundled as Tauri sidecar binary) |
| Native Logic | Rust commands replacing Python/Flask |

## Directory Structure

```
ffmpeg_ui_desktop/
├── docs/
│   ├── PRD.md                 ← Full product requirements document
│   └── server.py.reference    ← Python backend (migration reference)
├── src-ui/                    ← Frontend source (HTML/CSS/JS)
├── src-tauri/                 ← Tauri/Rust backend (initialized in Phase 1)
├── package.json
└── README.md
```

## Getting Started (Development)

> Prerequisites: [Rust](https://rustup.rs), [Node.js 18+](https://nodejs.org), [Tauri CLI prerequisites](https://v2.tauri.app/start/prerequisites/)

```bash
# Install Tauri CLI and JS dependencies
npm install

# Start development server (hot reload)
npm run tauri dev

# Build production installer
npm run tauri build
```

## License

MIT
