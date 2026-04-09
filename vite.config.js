import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'static/dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api':            'http://localhost:5000',
      '/login':          'http://localhost:5000',
      '/logout':         'http://localhost:5000',
      '/logs/stream':    'http://localhost:5000',
      '/upload/revolut': 'http://localhost:5000',
      '/upload/wise':    'http://localhost:5000',
      '/db/reset':       'http://localhost:5000',
      '/db/table':       'http://localhost:5000',
      '/db/download':    'http://localhost:5000',
      '/manifest.json':  'http://localhost:5000',
      '/static':         'http://localhost:5000',
    },
  },
})
