# FFmpeg UI Desktop

Native desktop app for FFmpeg UI, built with Tauri v2 (Rust) and React 19.

## Run

From the repo root, after `npm install`:

```bash
npm run tauri dev --workspace=desktop     # development
npm run tauri build --workspace=desktop   # installer in src-tauri/target/release/bundle/
```

Prerequisites: Node.js 20.19+ or 22.12+, a stable Rust toolchain, and the [Tauri v2 system dependencies](https://v2.tauri.app/start/prerequisites/).

## Layout

| Path | Contents |
|---|---|
| `src/` | React app wrapping `@ffmpeg-ui/ui` and `@ffmpeg-ui/core` |
| `src-tauri/src/command_builder.rs` | Typed FFmpeg argument builder |
| `src-tauri/src/jobs.rs`, `process.rs`, `progress.rs` | Job lifecycle, process handling, progress parsing |
| `src-tauri/src/downloader.rs` | FFmpeg download with SHA-256 verification |
| `src-tauri/tauri.conf.json` | Window, CSP and bundle config |
| `src-tauri/capabilities/` | Tauri permission set for the main window |

## Checks

```bash
npm run typecheck --workspace=desktop
npm run lint --workspace=desktop
npm run build --workspace=desktop                           # builds ../dist, which the Rust crate embeds
cargo test --manifest-path src-tauri/Cargo.toml
```

See the [root README](../../README.md) for the full project overview.
