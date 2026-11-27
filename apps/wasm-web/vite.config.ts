import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ISOLATION_HEADERS: Record<string, string> = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

const PREVIEW_SECURITY_HEADERS: Record<string, string> = {
  ...ISOLATION_HEADERS,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; media-src 'self' blob:; connect-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
};

export default defineConfig({
  plugins: [react()],

  server: {
    headers: ISOLATION_HEADERS,
  },

  preview: {
    headers: PREVIEW_SECURITY_HEADERS,
  },

  optimizeDeps: {
    exclude: ['@ffmpeg/ffmpeg', '@ffmpeg/util', '@ffmpeg/core'],
  },

  assetsInclude: ['**/*.wasm'],

  build: {
    rollupOptions: {
      external: [],
    },
  },
});
