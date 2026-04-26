# FFmpeg UI - Monorepo Architecture & Migration PRD

## 1. Project Overview & Objective
The FFmpeg UI project has evolved from a standalone Python/Flask web wrapper into a unified **Monorepo**. The objective is to deploy the exact same intuitive user interface across three radically different computing environments:
1. **Local Server (The Legacy Model):** Using the existing Python/Flask backend for self-hosted instances.
2. **Desktop Application (Tauri):** A native, installable cross-platform app using Rust to execute system-level FFmpeg binaries.
3. **WebAssembly Web App (WASM):** A purely client-side browser application utilizing `@ffmpeg/ffmpeg` to process media locally in-browser with zero server computing costs.

Because the file-system I/O models are completely different for all three, **only the User Interface and the FFmpeg Command Generation logic can be shared**. 

---

## 2. Monorepo Architecture

We are utilizing **Turborepo** with **npm workspaces**. The repository is divided into `apps/` (the executables) and `packages/` (the reusable libraries).

```text
FFmpeg-UI/
├── apps/
│   ├── desktop/            # Tauri + Vite + React (Native app wrapper for Windows/Mac/Linux)
│   ├── local-server/       # The Legacy Python backend. Acts as an API/File host.
│   └── wasm-web/           # Vite + React. Browser-only execution via WebAssembly.
├── docs/                   
│   ├── reference/          # Legacy PRDs and documentation dumps.
│   └── MIGRATION_PRD.md    # This file.
├── packages/
│   ├── core/               # Pure TypeScript: Core command builder and logic state.
│   └── ui/                 # Shared React Components (Buttons, Modals, Sliders).
├── package.json            # Root workspace definitions.
└── turbo.json              # Turborepo task pipeline configuration.
```

---

## 3. Technology Stack

*   **Monorepo Tooling:** Turborepo, npm workspaces.
*   **Frontend Framework:** React 18, Vite, TypeScript.
*   **Desktop Backend:** Tauri v2 (Rust).
*   **WebAssembly Engine:** `@ffmpeg/ffmpeg` (WASM).
*   **Server Backend:** Python (Flask), `subprocess`.
*   **Styling:** Modern, responsive CSS / potential UI component libraries.

---

## 4. Architectural Rules for Future Development / Agents

1. **Strict Separation of Concerns:** 
   * NEVER put FFmpeg command generation logic inside `apps/`. It must go in `packages/core`.
   * NEVER put React components directly in `apps/` unless they are extremely specific to that environment (like a Native File Picker for Desktop). General UI belongs in `packages/ui`.
2. **TypeScript First:** All logic in `packages/core` must be strictly typed. Interfaces for Media, Presets, and Command Outputs must be unified.
3. **Vanilla JS Phase Out:** The legacy Vanilla Javascript in `apps/local-server/static/js` must eventually be phased out and replaced by building the React code from `apps/` and serving it statically.
4. **Abstracted File I/O:** The `packages/core` logic must not assume the existence of a native hard drive or a browser sandbox. It should merely return the expected `string[]` of FFmpeg arguments. The actual execution is handled independently by each App.

---

## 5. Execution Roadmap (Migration Phases)

### ✅ Phase 1: Foundation (Completed)
- [x] Initialized Turborepo and npm workspaces root.
- [x] Sandboxed legacy Python application into `apps/local-server`.
- [x] Scaffolded Vite + React frameworks for `desktop` and `wasm-web`.
- [x] Scaffolded empty shared libraries `packages/core` and `packages/ui`.

### ✅ Phase 2: Core Logic Port (Completed)
- [x] Analyze legacy `command-builder.js` and `features.js`.
- [x] Re-write the FFmpeg argument generation logic into pure, testable TypeScript inside `packages/core`.
- [x] Define global interfaces (`MediaFile`, `EncodingOptions`, `CommandResult`).

### ✅ Phase 3: Shared UI Implementation (Completed)
- [x] Initialize CSS/Styling strategy in `packages/ui`.
- [x] Build shared React components: File Uploader/Dropper, Format Selectors, Progress Bars, Output Logs, and the central Media Editor.
- [x] Ensure the UI consumes the logic from `packages/core`.

### 🔄 Phase 4: Platform Wiring & App Builds (Completed)
- [x] **WASM Web:** Wire up the UI to `@ffmpeg/ffmpeg` to handle in-browser virtual file mapping and execution.
- [x] **Desktop (Tauri):** Initialize Tauri, bundle standard FFmpeg binaries for Windows/Mac/Linux, map Rust `Command` APIs to the React frontend.
- [x] **Local Server:** Swap out the Vanilla HTML/JS with a production build of the React UI. Wire up the Python `subprocess` backend.

### ⏳ Phase 5: Polish & Final Deployment
- [x] Unify error handling (dealing with specific WebAssembly memory limits vs. Desktop disk space limits).
- [x] Configure CI/CD actions for compiling the Tauri installers.
- [x] Final UI/UX review for "wow" factor aesthetics.
