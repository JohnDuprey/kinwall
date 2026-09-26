import legacy from '@vitejs/plugin-legacy'
import react from '@vitejs/plugin-react'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { defineConfig, type Plugin } from 'vite'

// plugin-legacy guards the modern build with `import 'data:text/javascript,...'` modules, which our
// CSP (script-src 'self') blocks - and a blocked guard is a blank page in every browser. Serve the
// same code from a same-origin file instead; the ?query keeps each import a distinct module
// (Safari <= 15 only throws for the first import of a given module). Then fail the build if an
// inline script's hash is missing from either CSP, so a plugin upgrade can't silently blank the app.
const DATA_GUARD = /import'data:text\/javascript,[^']*'/g
function selfHostedLegacyGuard(): Plugin {
  return {
    name: 'kinwall-legacy-guard',
    enforce: 'post',
    generateBundle(_, bundle) {
      this.emitFile({ type: 'asset', fileName: 'assets/legacy-guard.js', source: 'if(!import.meta.resolve)throw Error("import.meta.resolve not supported")' })
      for (const f of Object.values(bundle)) if (f.type === 'chunk') f.code = f.code.replace(DATA_GUARD, `import'./legacy-guard.js?${f.name}'`)
    },
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        html = html.replace(DATA_GUARD, "import'./assets/legacy-guard.js?detect'")
        const csps = ['public/_headers', '../server/src/app.ts'].map(f => readFileSync(new URL(f, import.meta.url), 'utf8'))
        const hashes = [...html.matchAll(/<script\b[^>]*>([^<]+)<\/script>/g)].map(([, code]) => `'sha256-${createHash('sha256').update(code).digest('base64')}'`)
        if (!csps.every(c => hashes.every(h => c.includes(h)))) throw new Error(`script-src in web/public/_headers and server/src/app.ts must allow the inline scripts: 'self' ${hashes.join(' ')}`)
        return html
      },
    },
  }
}

export default defineConfig({
  base: './', // app may be served under a sub-path (e.g. Home Assistant ingress)
  plugins: [
    react(),
    // Browsers without the modern build's baseline (Safari/iOS < 16.4, e.g. an old iPad mini on a
    // wall) get a transpiled SystemJS build plus core-js polyfills. Modern browsers are unaffected.
    // Its inline loader scripts need the cspHashes in public/_headers and server/src/app.ts.
    legacy({ targets: ['defaults', 'iOS >= 12', 'Safari >= 12'], additionalLegacyPolyfills: ['core-js/proposals/global-this'] }),
    selfHostedLegacyGuard(),
    // The demo build is a throwaway copy of the app: keep it out of search results.
    { name: 'demo-noindex', transformIndexHtml: (html) => (process.env.VITE_MOCK ? html.replace('<head>', '<head>\n    <meta name="robots" content="noindex" />') : html) },
  ],
  // One stylesheet serves both builds: let the CSS minifier add fallbacks old Safari needs
  // (inset -> top/right/bottom/left, -webkit- prefixes, ...). Modern browsers ignore the extras.
  build: { cssTarget: ['safari12', 'chrome111', 'firefox114', 'edge111'] },
  server: {
    host: true,
    proxy: {
      '/api': 'http://localhost:8080',
      '/docs': 'http://localhost:8080',
      '/openapi.json': 'http://localhost:8080',
    },
  },
})
