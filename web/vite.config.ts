import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './', // app may be served under a sub-path (e.g. Home Assistant ingress)
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8080',
      '/docs': 'http://localhost:8080',
      '/openapi.json': 'http://localhost:8080',
    },
  },
})
