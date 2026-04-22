import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    },
  },
  optimizeDeps: {
    // Exclude ffmpeg packages from pre-bundling so Vite doesn't try
    // to inline their worker code into the main chunk.
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util'],
  },
  build: {
    rollupOptions: {
      // Keep ffmpeg out of the main bundle entirely.
      // The worker (814.ffmpeg.js) is served from /public/ffmpeg/ and loaded
      // at runtime via classWorkerURL — Rollup must not process it.
      external: [],
    },
  },
})
