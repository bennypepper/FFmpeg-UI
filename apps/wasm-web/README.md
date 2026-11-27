# FFmpeg UI — WebAssembly

> **FFmpeg 5.1.4 running entirely inside your browser tab.** No server. No upload. Your files never leave your device.

🌐 **Live:** [ffmpeg-ui.vercel.app](https://ffmpeg-ui.vercel.app)

---

## What Is This?

This is the browser-native deployment of FFmpeg UI. It uses [`@ffmpeg/ffmpeg`](https://github.com/ffmpegwasm/ffmpeg.wasm) with single-threaded [`@ffmpeg/core@0.12.6`](https://www.npmjs.com/package/@ffmpeg/core) (**FFmpeg 5.1.4**) to process media files **client-side**, inside a Web Worker thread, with zero server involvement.

### Supported Capabilities (WASM Sandbox)

| Capability | Supported in Browser WASM |
|---|---|
| **Modes** | `convert`, `audio`, `remux`, `thumbnail` (JPG/PNG/WebP), `gif` (palettegen/paletteuse) |
| **Video Containers** | MP4, MKV, AVI, MOV, GIF |
| **Video Codecs** | H.264 (`libx264`), ProRes (`prores_ks`), Stream Copy (`copy`) |
| **Audio Containers** | MP3, M4A, OGG, WAV, FLAC |
| **Audio Codecs** | AAC (`aac`), MP3 (`libmp3lame`), Opus (`libopus`), FLAC (`flac`), PCM WAV (`pcm_s16le`), Stream Copy (`copy`) |
| **Batch Queue** | Per-file independent format & encoding settings (`Convert Selected` / `Convert All`) |

**Gated to Desktop / Local Server:** `libx265` (deadlocks single-threaded WASM), `libvpx-vp9` / WebM encoding (WASM OOB trap), CUDA / Intel QSV hardware acceleration, and multi-file `merge`.

---

## How It Works

```text
Browser Tab
├── Main Thread (React 19 UI)
│   ├── src/App.tsx            ← UI shell, validated job planning, file probing & downloads
│   ├── src/useFFmpeg.ts       ← Single-fetch WASM worker lifecycle, MEMFS cleanup, crash recycling
│   ├── @ffmpeg-ui/ui          ← Shared React component library (MediaEditor, SettingsModal, AboutModal)
│   └── @ffmpeg-ui/core        ← Validated FFmpeg planner (planFFmpegJob, platform capabilities)
│
└── Web Worker Thread (spawned by @ffmpeg/ffmpeg)
    └── /public/ffmpeg/ (copied on predev/prebuild from @ffmpeg/core)
        ├── ffmpeg-core.js     ← Emscripten-compiled FFmpeg 5.1.4 JS (~115 KB)
        └── ffmpeg-core.wasm   ← Single-threaded FFmpeg 5.1.4 WASM binary (~32 MB)
```

### Load & Conversion Lifecycle

1. **Asset Provisioning (`predev` / `prebuild`)**: `scripts/copy-ffmpeg-core.mjs` copies `ffmpeg-core.js` and `ffmpeg-core.wasm` from `node_modules/@ffmpeg/core/dist/esm` into `public/ffmpeg/` automatically before `dev` and `build` (these large build artifacts are not tracked in git).
2. **Single-Fetch Load**: `useFFmpeg` calls `ffmpeg.load()` directly with same-origin `/ffmpeg/ffmpeg-core.js` and `/ffmpeg/ffmpeg-core.wasm` paths (no `toBlobURL()` wrapper and no redundant double-fetch preloader).
3. **Isolated Per-Job Execution**: Each job validates options through `planFFmpegJob(..., 'wasm')`, writes to a unique safe MEMFS input name (`in_<jobId>.<ext>`), encodes to `out_<jobId>.<ext>`, checks `exitCode !== 0`, streams the output `Blob` without extra RAM copies, and removes both MEMFS files in `finally`.
4. **Automatic Worker Recovery**: If FFmpeg exits non-zero or triggers a WebAssembly `RuntimeError` trap, `useFFmpeg` surfaces stderr details in the UI error banner and recycles the Web Worker so subsequent jobs start on a clean Emscripten heap.

### Security & Isolation Headers

`vercel.json` and `vite.config.ts` configure `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Embedder-Policy: require-corp`, `Cross-Origin-Resource-Policy: cross-origin`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, and a strict `Content-Security-Policy` allowing `'wasm-unsafe-eval'` and `blob:` workers/media.

> Note: Single-threaded `@ffmpeg/core@0.12.6` does not require `SharedArrayBuffer`, so it remains functional even in browsers without cross-origin isolation, while COOP/COEP headers keep the page isolated and ready for future multi-threaded builds.

---

## Local Development

Requires **Node.js 20.19+ / 22+**.

```bash
# From monorepo root
npm install

# Start WASM dev server (predev automatically copies @ffmpeg/core assets)
npm run dev --workspace=wasm-web

# Typecheck, lint, and production build
npm run typecheck --workspace=wasm-web
npm run lint --workspace=wasm-web
npm run build --workspace=wasm-web

# Preview production build with full security & isolation headers
npm run preview --workspace=wasm-web
```

---

## Tech Stack

| Tool | Version | Purpose |
|---|---|---|
| React | 19 | UI framework |
| Vite | 8 | Dev server and bundler |
| TypeScript | 5.9 | Strict type checking (`strict: true`) |
| `@ffmpeg/ffmpeg` | 0.12.15 | Web Worker orchestration |
| `@ffmpeg/core` | 0.12.6 | Single-threaded FFmpeg 5.1.4 WASM core |
| `@ffmpeg/util` | 0.12.2 | Browser `File` → `Uint8Array` helper |

---

## Known Constraints

- **First load (~32 MB)**: `ffmpeg-core.wasm` downloads once and is cached by the browser (`Cache-Control` configured in `vercel.json`).
- **Single-threaded CPU**: Conversions run on a single Web Worker CPU thread without GPU hardware acceleration.
- **Browser RAM limits**: Files are loaded into Emscripten MEMFS in tab memory; files over **500 MB** trigger a warning and are better handled by the Native Desktop App.
