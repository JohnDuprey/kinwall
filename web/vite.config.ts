import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './', // app may be served under a sub-path (e.g. Home Assistant ingress)
  plugins: [
    react(),
    // The demo build is a throwaway copy of the app: keep it out of search results.
    { name: 'demo-noindex', transformIndexHtml: (html) => (process.env.VITE_MOCK ? html.replace('<head>', '<head>\n    <meta name="robots" content="noindex" />') : html) },
  ],
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8080',
      '/docs': 'http://localhost:8080',
      '/openapi.json': 'http://localhost:8080',
    },
  },
})
