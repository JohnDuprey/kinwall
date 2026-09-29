import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

// The CSP inline-script check is for built output; the dev server's own inline scripts
// (React Refresh preamble) must not trip it, or `VITE_MOCK=1 npm run dev` serves an error page.
test('dev server serves index.html', async () => {
  const server = await createServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), server: { middlewareMode: true }, logLevel: 'silent' })
  try {
    const html = await server.transformIndexHtml('/', '<!doctype html><html><head></head><body><script type="module" src="/src/main.tsx"></script></body></html>')
    assert.match(html, /@react-refresh/)
  } finally {
    await server.close()
  }
})
