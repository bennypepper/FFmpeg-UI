# FFmpeg UI — The Next Generation

> **A beautifully designed, self-hosted frontend for FFmpeg that handles complex media encoding visually. No CLI memorization required.**

*This project is currently migrating from a simple Python script to a Monorepo Architecture.*

## Ecosystem / Platforms

The project is structured to deploy to three distinct environments, all sharing the same visual UI, but relying on uniquely suited backend engines:

1. **Desktop Native (Tauri):** Fast, installable `.exe` / `.dmg` applications that bundle FFmpeg directly. Accesses your file system natively. *(Under active development).*
2. **WebAssembly (WASM):** Client-side `.mp4` and `.gif` conversions run entirely inside your browser tab without uploading files to a server. Zero computational cost.
3. **Local Server (Python Legacy):** The original self-hosted Python (Flask) API for remote conversion on NAS systems and home servers.

## Monorepo Architecture

This project is managed via **Turborepo** and npm workspaces.

```text
FFmpeg-UI/
├── apps/
│   ├── desktop/            # Tauri + React (Native app wrapper)
│   ├── wasm-web/           # Vite + React (WebAssembly browser app)
│   └── local-server/       # Legacy Python APIs + Original Implementation
├── docs/                   
│   ├── ARCHITECTURE_PRD.md # Detailed migration plan and engineering notes
│   └── reference/          # Old PRDs
├── packages/
│   ├── core/               # Pure logic: Typescript FFmpeg Command Builders 
│   └── ui/                 # Beautiful, Reusable React Components (CSS Modules)
```

## Getting Started (Development Environment)

*Ensure you have `Node.js 18+` and `npm` installed.*

```bash
# 1. Install all dependencies across the workspace
npm install

# 2. Run the development environment across all applications
npm run dev
```

> ⚠️ Note: The Desktop `Tauri` app requires Rust and system-specific build tools. See the [Tauri Prerequisites Guide](https://v2.tauri.app/start/prerequisites/).

## Development Rules

1. **Strict Typescript:** All internal package logic is typed.
2. **Separation of Concerns:** `packages/core` handles logic string building. `packages/ui` handles exclusively the React styling. The Apps glue them together.
3. **No External CSS Frameworks:** We rely on premium Vanilla CSS Modules mapped with bespoke CSS variables to ensure strict styling uniqueness and zero-friction packaging.

## License

MIT
