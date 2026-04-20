# Product Requirements Document
# FFmpeg UI — Desktop Application (Tauri)

**Version:** 1.0  
**Author:** Benny Pepper  
**Date:** 2026-04-20  
**Status:** Draft

---

## 1. Executive Summary

FFmpeg UI Desktop is the next evolution of the self-hosted FFmpeg Web UI project. The goal is to transform the proven browser-based tool into a native, cross-platform desktop application using the **Tauri** framework. The resulting product will be a single installable binary (`.exe`, `.dmg`, `.AppImage`) that requires zero technical setup from the end user — no Python, no Flask, no terminal commands.

The core UX, design language (glassmorphism/monochromatic/minimalist), and feature set of the existing web application will be preserved and significantly extended with native desktop capabilities.

---

## 2. Problem Statement

### Current Web App Limitations
- **High setup friction:** Users must manually install Python, Flask, and FFmpeg via terminal scripts before they can run the app. This is a dealbreaker for non-technical users.
- **Non-distributable:** There is no single downloadable file that "just works".
- **No native OS integration:** Cannot access system notifications, progress in the OS taskbar, or native file explorer dialogs.
- **Dependency rot:** If `flask` or `flask-cors` versions change, existing installs can break.

### Opportunity
By wrapping the existing polished frontend inside Tauri, we retain all the current capabilities (hardware acceleration, batch queuing, SSE progress) while eliminating every piece of setup friction. The application becomes something you can hand to any friend and they can use it immediately.

---

## 3. Goals & Non-Goals

### Goals
- ✅ Single-click installer for Windows, macOS, and Linux
- ✅ Bundle FFmpeg binaries inside the app — no external installation required
- ✅ Preserve 100% of the existing UI/UX without visual regression
- ✅ Replace the Python Flask backend with a native Rust backend via Tauri commands
- ✅ Add native OS hooks: system tray, notifications, file dialogs, and taskbar progress
- ✅ Support auto-update mechanism so users always have the latest version

### Non-Goals
- ❌ This is NOT a cloud-hosted SaaS. Processing remains 100% local.
- ❌ This is NOT a rewrite of the UI. The current HTML/CSS/JS is carried over directly.
- ❌ This does NOT include video streaming, playback previews (v1.0 scope).
- ❌ This does NOT add a subscription or monetization layer (v1.0 scope).

---

## 4. Target Users

| Persona | Description |
|---|---|
| **Creator** | YouTubers, Podcasters, and content creators who need to convert and compress media files regularly without paying for cloud tools. |
| **Privacy-Conscious User** | Anyone who refuses to upload sensitive video footage to external servers for processing. |
| **Power User** | Developers and media professionals who know FFmpeg but want a faster, visual way to generate complex commands. |
| **Non-Technical User** | Everyday consumers who have heard of "converting video" but are too intimidated by the terminal to use FFmpeg directly. |

---

## 5. Technical Architecture

### 5.1 Technology Stack

| Layer | Technology | Rationale |
|---|---|---|
| **UI / Frontend** | Existing HTML, Vanilla JS, Vanilla CSS | Zero migration cost. The entire `src-ui/` directory is used as-is. |
| **Desktop Shell** | **Tauri v2** (Rust) | Minimal binary size (~5-10MB overhead vs Electron's 80MB+). Uses OS native WebView. |
| **Backend / Native Logic** | **Rust** (`src-tauri/`) | Replaces `server.py`. Handles file I/O, spawning FFmpeg, streaming progress. |
| **Media Engine** | **FFmpeg** (bundled Sidecar) | `ffmpeg-sidecar` Rust crate manages the bundled binary cleanly. |
| **Auto-Updater** | Tauri Updater Plugin | Checks GitHub Releases for new versions on launch. |
| **Build / Package** | `npm run tauri build` | Outputs platform-specific installers via CI/CD (GitHub Actions). |

### 5.2 Project Directory Structure

```
ffmpeg_ui_desktop/
├── docs/
│   ├── PRD.md                   ← This document
│   └── server.py.reference      ← Original Python backend for migration reference
│
├── src-ui/                      ← Frontend (carried over verbatim)
│   ├── index.html
│   └── static/
│       ├── css/style.css
│       └── js/
│           ├── app.js
│           ├── queue.js
│           ├── command-builder.js
│           └── sse-client.js
│
├── src-tauri/                   ← Tauri / Rust backend (to be created)
│   ├── Cargo.toml               ← Rust dependencies
│   ├── tauri.conf.json          ← Tauri app config (name, icon, window, permissions)
│   ├── icons/                   ← App icons (generated from a single source PNG)
│   ├── binaries/                ← Bundled FFmpeg + FFprobe executables
│   └── src/
│       ├── main.rs              ← App entry point
│       └── commands/
│           ├── mod.rs
│           ├── convert.rs       ← Handles encode, remux, audio jobs
│           ├── probe.rs         ← ffprobe wrapper → returns media info JSON
│           ├── thumbnail.rs     ← Frame extraction command
│           ├── merge.rs         ← Concat / merge command
│           └── capabilities.rs  ← Detects GPU, FFmpeg version
│
├── package.json                 ← npm scripts to drive Tauri CLI
└── README.md
```

---

## 6. Migration Plan: Python → Rust

The existing Python `server.py` acts as a REST API. In the Tauri model, this is replaced by **Tauri Commands** — Rust functions that the JavaScript frontend can call directly via `window.__TAURI__.invoke()`.

### 6.1 API Mapping

| Python Route (old) | Tauri Command (new) | Notes |
|---|---|---|
| `POST /upload` | `invoke('upload_file', {path})` | File is read from native file dialog; no HTTP upload needed. |
| `GET /probe?file=` | `invoke('probe_file', {path})` | Calls bundled `ffprobe` sidecar. |
| `POST /convert` | `invoke('start_convert', {params})` | Spawns bundled `ffmpeg` sidecar. |
| `GET /progress/<job_id>` | Tauri Event `progress-update` | Uses `emit()` instead of SSE. Works natively. |
| `POST /cancel` | `invoke('cancel_job', {job_id})` | Kills the FFmpeg process by PID. |
| `GET /download/<job_id>` | `invoke('open_output_folder')` | Opens native OS file save dialog. |
| `POST /download-all` | `invoke('zip_and_save', {job_ids})` | Zips output files natively using Rust `zip` crate. |
| `POST /thumbnail` | `invoke('extract_thumbnail', {params})` | |
| `POST /merge` | `invoke('merge_files', {params})` | |
| `GET /capabilities` | `invoke('get_capabilities')` | Checks GPU support and FFmpeg version. |

### 6.2 Frontend Adaptation Strategy

The frontend JS will need a compatibility shim layer — a single file `tauri-bridge.js` that replaces HTTP `fetch()` calls with `window.__TAURI__.invoke()` calls. This approach means:
- `app.js`, `queue.js`, `command-builder.js` remain **unchanged**
- Only `sse-client.js` is refactored to use Tauri events instead of `EventSource`
- The shim file handles the translation transparently

---

## 7. Feature Requirements

### 7.1 Core (Must Have — v1.0)

| ID | Feature | Notes |
|---|---|---|
| F-01 | **Single installer binary** | `.exe` on Windows, `.dmg` on Mac, `.AppImage` on Linux |
| F-02 | **Bundled FFmpeg** | `ffmpeg` and `ffprobe` compiled for each target OS, bundled as Tauri sidecars. No external install needed. |
| F-03 | **Video/Audio Master Toggle** | Carry over as-is from web app. |
| F-04 | **Batch Queue with drag-to-reorder** | Carry over as-is. |
| F-05 | **Full Video Encoding** | All codec/preset/CRF/resolution/rotate/filter options. GPU acceleration (NVENC/QSV). |
| F-06 | **Audio Conversion** | Format, bitrate, channels, sample rate. |
| F-07 | **Remux** | Container change with stream copy (lossless-fast). |
| F-08 | **Thumbnail Extraction** | Frame at timestamp, format and quality control. |
| F-09 | **Merge / Concat** | Multi-file concat with optional re-encode. |
| F-10 | **Real-time Progress** | ETA, FPS, Frame, Size — driven by Tauri events instead of SSE. |
| F-11 | **Native File Dialogs** | Replace HTML file `<input>` with `dialog::open()` from Tauri. Supports multi-select. |
| F-12 | **Native Save Dialog** | After conversion, user can "Save to…" any folder using `dialog::save()`. |
| F-13 | **Auto-updater** | Checks GitHub Releases on launch; notifies user of updates. |

### 7.2 Enhanced Native (Should Have — v1.0)

| ID | Feature | Notes |
|---|---|---|
| F-14 | **System Tray** | App minimizes to tray. Shows "X jobs processing…" badge. |
| F-15 | **OS Notifications** | Push a native notification when a batch job completes. |
| F-16 | **Taskbar Progress Bar** | Show the FFmpeg % progress in the Windows/macOS taskbar while minimized. |
| F-17 | **Persistent Settings** | Remember last-used codec, format, output directory across sessions using `tauri-plugin-store`. |
| F-18 | **Output Directory Picker** | A dedicated "Output Folder" setting so files save somewhere consistent, not just the app temp folder. |

### 7.3 Backlog (Future — v1.1+)

| ID | Feature | Notes |
|---|---|---|
| F-19 | **In-app Video Trimmer** | HTML5 `<video>` player with start/end markers that pass `-ss` / `-to` to FFmpeg. |
| F-20 | **Social Media Presets** | "TikTok (9:16)", "Twitter <512MB", "Discord (<8MB)" smart presets. |
| F-21 | **Preset Save/Load** | Users can save custom encoding configurations as named presets. |
| F-22 | **Processing History** | Log of all past jobs with input name, output size, codec used, and timestamps. |
| F-23 | **Waveform Preview (Audio)** | Basic waveform visualization for audio files. |

---

## 8. UI/UX Requirements

- The **existing glassmorphism, monochromatic, minimalist** design language must be 100% preserved. No design regression.
- The **Video/Audio master toggle** must remain the top hierarchical element per current implementation.
- The app window default size shall be `1200 × 780px` minimum, resizable.
- The app must support both **light and dark themes** as currently implemented.
- All icons must remain as inline SVGs — no external CDN references.
- On first launch, a brief **onboarding tooltip sequence** should guide the user through the master toggle, drop zone, and queue panel.

---

## 9. Non-Functional Requirements

| Category | Requirement |
|---|---|
| **Performance** | FFmpeg must execute at native speed. The Rust layer must add <5ms overhead per command invocation. |
| **Binary Size** | Final installer must be under 80MB (including bundled FFmpeg). |
| **Memory** | App idle memory usage must be under 150MB RAM. |
| **Privacy** | Zero telemetry. Zero network calls at runtime except the optional auto-update check. |
| **Security** | Tauri's capability system must restrict `fs` access to a defined output directory. No shell injection possible via UI inputs — all FFmpeg args must be sanitized as positional arguments, never a raw string. |
| **Compatibility** | Windows 10+, macOS 12 (Monterey)+, Ubuntu 22.04+ |

---

## 10. Development Phases

### Phase 1 — Scaffolding & Boot (Week 1)
- Initialize Tauri v2 project with `npm create tauri-app`
- Configure `tauri.conf.json` (window size, app name, icons)
- Confirm `src-ui/index.html` renders correctly inside Tauri WebView
- Set up `ffmpeg-sidecar` crate and confirm bundled FFmpeg executes

### Phase 2 — Core Backend Migration (Weeks 2-3)
- Implement Rust commands: `probe_file`, `get_capabilities`
- Implement `start_convert` with real-time `emit()` progress events
- Implement `cancel_job`
- Write `tauri-bridge.js` shim to replace `fetch` calls

### Phase 3 — Native File Handling (Week 3)
- Replace HTML file input with `dialog::open()` multi-select
- Implement output folder picker and `invoke('save_output')`
- Implement `zip_and_save` for batch download

### Phase 4 — Remaining Commands (Week 4)
- `extract_thumbnail`, `merge_files`, `start_remux`
- Persistent settings store (`tauri-plugin-store`)

### Phase 5 — Native Enhancements (Week 5)
- System tray integration
- OS push notifications
- Taskbar progress (Windows `ITaskbarList3`, macOS Dock badge)

### Phase 6 — Build, Package & Release (Week 6)
- Set up GitHub Actions CI for multi-platform builds
- Configure auto-updater with GitHub Releases
- Test installers on Windows / macOS / Ubuntu
- Write final README with download links

---

## 11. Success Metrics (v1.0 Launch)

| Metric | Target |
|---|---|
| Install-to-first-conversion time | < 3 minutes (including download) |
| Installer binary size | < 80MB |
| Crash rate | < 0.1% of sessions |
| GPU utilization (when NVENC active) | Matching raw CLI FFmpeg baseline |

---

## 12. Open Questions

1. **Should output files default to the same folder as the input file, or a dedicated "FFmpeg UI Exports" folder in the user's home directory?**
2. **Auto-updater channel:** Stable only, or also a Beta/Nightly channel for early users?
3. **FFmpeg license:** FFmpeg uses LGPL/GPL. We should decide whether to bundle a GPL or LGPL build, as this affects whether our binary must be open source.
4. **Code signing:** macOS requires a paid Apple Developer account ($99/yr) to sign and notarize the app; otherwise users see a security warning. Budget for this?
