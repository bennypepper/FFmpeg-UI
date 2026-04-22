import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/capabilities': 'http://127.0.0.1:5000',
      '/upload': 'http://127.0.0.1:5000',
      '/convert': 'http://127.0.0.1:5000',
      '/merge': 'http://127.0.0.1:5000',
      '/progress': 'http://127.0.0.1:5000',
      '/cancel': 'http://127.0.0.1:5000',
      '/download': 'http://127.0.0.1:5000',
      '/download-all': 'http://127.0.0.1:5000',
      '/probe': 'http://127.0.0.1:5000'
    }
  }
})
