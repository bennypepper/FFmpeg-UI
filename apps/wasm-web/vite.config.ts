import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],

  server: {
    headers: {
      // Cross-origin isolation — required for SharedArrayBuffer (used by
      // FFmpeg's multi-threaded WASM mode and Atomics).
      'Cross-Origin-Opener-Policy':   'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      // Allow same-origin assets (including /public/ffmpeg/) to be loaded
      // by the worker without CORP violations.
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },

  optimizeDeps: {
    // Keep all @ffmpeg/* packages out of Vite's pre-bundler.
    // Pre-bundling these causes Vite to re-wrap their ESM worker in an IIFE
    // chunk, breaking the global scope that Emscripten's startup code expects.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core'],
  },

  // Treat .wasm files as assets — do not attempt to inline or transform them.
  assetsInclude: ['**/*.wasm'],

  build: {
    rollupOptions: {
      // Nothing needs to be external here; the WASM files live in /public/
      // and are fetched at runtime, never imported as modules.
      external: [],
    },
  },
})
