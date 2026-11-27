import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const LOCAL_SERVER_TARGET = 'http://127.0.0.1:5000'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/auth': LOCAL_SERVER_TARGET,
      '/capabilities': LOCAL_SERVER_TARGET,
      '/upload': LOCAL_SERVER_TARGET,
      '/uploads': LOCAL_SERVER_TARGET,
      '/probe': LOCAL_SERVER_TARGET,
      '/merge-probe': LOCAL_SERVER_TARGET,
      '/convert': LOCAL_SERVER_TARGET,
      '/merge': LOCAL_SERVER_TARGET,
      '/progress': LOCAL_SERVER_TARGET,
      '/cancel': LOCAL_SERVER_TARGET,
      '/download': LOCAL_SERVER_TARGET,
      '/download-all': LOCAL_SERVER_TARGET,
      '/job': LOCAL_SERVER_TARGET,
    },
  },
})
