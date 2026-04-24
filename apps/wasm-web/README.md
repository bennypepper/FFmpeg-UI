# FFmpeg UI — WebAssembly

> **FFmpeg running entirely inside your browser tab.** No server. No upload. Your files never leave your device.

🌐 **Live:** [ffmpeg-ui.vercel.app](https://ffmpeg-ui.vercel.app)

---

## What Is This?

This is the browser-native deployment of FFmpeg UI. It uses [ffmpeg.wasm](https://github.com/ffmpegwasm/ffmpeg.wasm) — FFmpeg compiled to WebAssembly — to process media files **client-side**, inside a Web Worker thread, with zero server involvement.

**What you can do:**
- Convert between video and audio formats (MP4, WebM, MKV, MOV, MP3, AAC, OGG, FLAC, WAV…)
- Remux containers without re-encoding
- Extract thumbnail images
- Merge/concatenate files
- Apply quick presets (TikTok/IG, YouTube, Discord <8MB, Archival MKV)
- Process batch queues of multiple files

---

## How It Works

```
Browser Tab
│
├── Main Thread (React UI)
│   ├── App.tsx              ← state, load orchestration, file handling
│   ├── @ffmpeg-ui/ui        ← shared React component library
│   └── @ffmpeg-ui/core      ← FFmpeg command builder (buildFFmpegArgs)
│
└── Web Worker Thread (spawned by @ffmpeg/ffmpeg)
    ├── worker-[hash].js     ← Vite-bundled orchestration worker (IIFE)
    │   └── importScripts() or import() → ffmpeg-core.js
    │
    └── /public/ffmpeg/
        ├── ffmpeg-core.js   ← Emscripten-compiled FFmpeg JS (~300 KB)
        └── ffmpeg-core.wasm ← FFmpeg compiled to WASM (~30 MB)
```

### Load Sequence

When the page opens, `ffmpeg.load()` runs automatically:

1. **`ffmpeg-core.js`** — fetched from `/ffmpeg/ffmpeg-core.js` (same-origin), converted to a blob URL with correct MIME type
2. **`ffmpeg-core.wasm`** — fetched from `/ffmpeg/ffmpeg-core.wasm` (~30 MB), converted to a blob URL with `application/wasm` MIME type
3. **Worker spawned** — `@ffmpeg/ffmpeg` creates a `{ type: "module" }` Web Worker from Vite's bundled `worker.js`
4. **Core initialized** — the worker imports `ffmpeg-core.js`, which loads the WASM binary and compiles it via `WebAssembly.instantiateStreaming()`
5. **Ready** — titlebar shows 🟢 Ready, Convert button activates

The UI shows a yellow progress banner with percentage during load. The terminal panel logs each step.

### Convert Sequence

When the user clicks Convert:

```
User clicks Convert
→ handleExecute() in App.tsx
→ ffmpeg.writeFile(inputName, fileBytes)   // writes to in-memory WASM filesystem
→ ffmpeg.exec([...ffmpegArgs])             // runs FFmpeg inside the worker
   ← ffmpeg 'log' events → terminal panel
   ← ffmpeg 'progress' events → progress bar
→ ffmpeg.readFile(outputName)              // reads result from WASM filesystem
→ Blob → createObjectURL → <a>.click()    // triggers browser download
```

### Why Local `/public/ffmpeg/` Files?

Early versions fetched `ffmpeg-core.js` from unpkg CDN and converted it to a blob URL. This caused a `ReferenceError: WebAssembly is not defined` in production because:

- Vite bundles the `@ffmpeg/ffmpeg` worker as an **IIFE** chunk, which runs inside a `{ type: "module" }` Web Worker
- In module workers, `importScripts()` is unavailable, so the worker falls through to `dynamic import()`
- The ESM `ffmpeg-core.js`, when dynamically imported from a `blob:` URL inside this IIFE-in-module-worker context, loses its proper global scope
- Emscripten's startup check `typeof WebAssembly !== "object"` fails and throws

**Serving the files from the same origin** (as static assets under `/public/ffmpeg/`) gives the Emscripten module a proper execution context — `WebAssembly` is correctly available in the global scope.

### Cross-Origin Isolation (COEP/COOP)

FFmpeg WASM requires `SharedArrayBuffer`, which browsers only allow in **cross-origin isolated** contexts. The `vercel.json` in this directory sets the required HTTP headers on every response:

```json
{
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "cross-origin"
}
```

You can verify isolation is active in the browser console:
```js
self.crossOriginIsolated // must be true
```

---

## Directory Structure

```
apps/wasm-web/
│
├── public/
│   ├── ffmpeg/
│   │   ├── ffmpeg-core.js     # Emscripten-compiled FFmpeg (~300 KB) — @ffmpeg/core@0.12.6 ESM
│   │   └── ffmpeg-core.wasm   # FFmpeg WASM binary (~30 MB)
│   ├── favicon.svg
│   └── icons.svg
│
├── src/
│   ├── App.tsx                # Main component — load orchestration, convert logic, UI
│   ├── App.css                # App-level styles
│   ├── index.css              # Global CSS variables and resets
│   └── main.tsx               # React entry point
│
├── vite.config.ts             # COEP headers (dev) + optimizeDeps.exclude for @ffmpeg/*
├── vercel.json                # COEP/COOP headers for production (Vercel)
├── tsconfig.app.json
└── package.json
```

### Key Files

| File | Purpose |
|------|---------|
| `src/App.tsx` | All application logic: FFmpeg load state machine, progress tracking, convert pipeline, cancel/retry handling |
| `public/ffmpeg/ffmpeg-core.js` | The actual FFmpeg binary compiled to JavaScript via Emscripten. Do **not** edit. Regenerated by updating `@ffmpeg/core`. |
| `public/ffmpeg/ffmpeg-core.wasm` | The WebAssembly binary. ~30 MB. Loaded once per session, cached by the browser. |
| `vite.config.ts` | Sets COEP headers for dev server; excludes `@ffmpeg/ffmpeg` and `@ffmpeg/util` from Vite's pre-bundler |
| `vercel.json` | Production COEP/COOP/CORP headers — **required** for SharedArrayBuffer and WASM to work |

---

## Shared Packages Used

| Package | Role |
|---------|------|
| `@ffmpeg-ui/ui` | All React components — `MediaEditor`, `DropZone`, `BatchQueue`, `TerminalOutput`, `SettingsPanel`, presets |
| `@ffmpeg-ui/core` | `buildFFmpegArgs()` — converts UI options into an FFmpeg argument array |
| `@ffmpeg/ffmpeg` | JS wrapper around the WASM worker — `FFmpeg` class, `ffmpeg.load()`, `ffmpeg.exec()` |
| `@ffmpeg/util` | `fetchFile()`, `toBlobURL()` — file ingestion and blob URL helpers |

---

## Local Development

```bash
# From monorepo root
npm install

# Start WASM dev server (with COEP headers)
cd apps/wasm-web
npm run dev
```

Open `http://localhost:5173`. The WASM core loads from `/ffmpeg/ffmpeg-core.wasm` (~30 MB) on first load. Subsequent visits use the browser cache.

> **Important:** The dev server sets COEP headers via `vite.config.ts`. Without these headers, `SharedArrayBuffer` is unavailable and `ffmpeg.load()` will fail silently.

### Updating the Core Version

If you need to update `@ffmpeg/core`:

```bash
# 1. Update the package
npm install @ffmpeg/core@<version> -D

# 2. Re-copy the built files to public/
cp node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js apps/wasm-web/public/ffmpeg/
cp node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm apps/wasm-web/public/ffmpeg/

# 3. Update CORE_VERSION in src/App.tsx
```

> ⚠️ `@ffmpeg/core` is in root `node_modules` (hoisted by npm workspaces). Run the copy from the repo root.

### Build for Production

```bash
npm run build
# Output: dist/
```

Vercel automatically builds on push to `main` using the `vercel.json` configuration in this directory.

---

## Tech Stack

| Tool | Version | Purpose |
|------|---------|---------|
| React | 19 | UI framework |
| Vite | 8 | Dev server and bundler |
| TypeScript | 6 | Type safety |
| `@ffmpeg/ffmpeg` | 0.12.15 | Worker and message protocol |
| `@ffmpeg/core` | 0.12.6 | FFmpeg compiled to WASM |
| `@ffmpeg/util` | 0.12.2 | File and blob helpers |

---

## Known Constraints

| Constraint | Details |
|------------|---------|
| **First load ~30 MB** | The WASM binary downloads once per browser cache. Subsequent visits are instant. |
| **Single-threaded** | Uses `@ffmpeg/core` (not `@ffmpeg/core-mt`). No `SharedArrayBuffer` multi-threading. Processing is slower than native FFmpeg. |
| **No hardware acceleration** | WASM runs on CPU only. |
| **File size limits** | Browser memory limits apply. Large files (>500 MB) may cause tab crashes. |
| **Cross-origin isolation required** | COEP headers must be set on the server. Without them, the app won't load in production. |
| **Firefox module worker support** | Requires Firefox 114+. Older Firefox doesn't support `{ type: "module" }` workers. |
