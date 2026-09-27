// Demo build, last step: bakes Kinwall's reviewed activity plugins into dist-demo, so the demo can
// list and play them with no server. Downloads each catalog entry's pinned release, checks its
// SHA-256 like a real install, unpacks it to dist-demo/plugins/<id>/, and gives those files the
// same sandbox CSP the server sends (routes/plugins.ts pluginCsp). Offline, the demo just has none.
import { createHash } from 'node:crypto'
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readZip } from '../../server/src/zip.ts'

const CATALOG = process.env.PLUGIN_CATALOG_URL || 'https://app.kinwall.family/plugins/catalog.json'
const OUT = fileURLToPath(new URL('../dist-demo/', import.meta.url))
// Where the demo is served; the plugin CSP needs real origins (in the sandbox, 'self' is opaque).
const ORIGINS = ['https://demo.kinwall.family', 'https://kinwall-demo.pages.dev', 'https://*.kinwall-demo.pages.dev', 'http://localhost:*']

const csp = id => {
  const own = ORIGINS.map(o => `${o}/plugins/${id}/`).join(' ')
  return [
    'sandbox allow-scripts', "default-src 'none'", `script-src ${own} 'unsafe-inline'`, `style-src ${own} 'unsafe-inline'`,
    `img-src ${own} data: blob:`, `media-src ${own} data: blob:`, `font-src ${own} data:`,
    "connect-src 'none'", "form-action 'none'", "base-uri 'none'", `frame-ancestors ${ORIGINS.join(' ')}`,
  ].join('; ')
}

const baked = []
try {
  const { plugins } = await (await fetch(CATALOG, { signal: AbortSignal.timeout(15000) })).json()
  for (const e of plugins) {
    try {
      const res = await fetch(`https://github.com/${e.repo}/releases/download/v${e.version}/kinwall-plugin.zip`, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) throw new Error(`download ${res.status}`)
      const zip = new Uint8Array(await res.arrayBuffer())
      if (createHash('sha256').update(zip).digest('hex') !== e.sha256) throw new Error("doesn't match the reviewed package")
      let entry = 'index.html'
      for (const f of readZip(zip, 2 * 1024 * 1024)) {
        if (f.name.endsWith('/') || f.name.split('/').some(p => p === '..' || p.startsWith('.'))) continue
        const data = await f.read()
        if (!data) throw new Error(`${f.name} is too big`)
        if (f.name === 'kinwall-plugin.json') entry = JSON.parse(new TextDecoder().decode(data)).entry || entry
        const path = `${OUT}plugins/${e.id}/${f.name}`
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, data)
      }
      baked.push({ ...e, entry })
      appendFileSync(`${OUT}_headers`, `\n/plugins/${e.id}/*\n  ! Content-Security-Policy\n  Content-Security-Policy: ${csp(e.id)}\n`)
      console.log(`demo plugin: ${e.name} v${e.version}`)
    } catch (err) {
      console.warn(`demo plugin ${e.id} skipped: ${err.message}`)
    }
  }
} catch (err) {
  console.warn(`demo plugins skipped (catalog: ${err.message})`)
}
mkdirSync(`${OUT}plugins`, { recursive: true })
writeFileSync(`${OUT}plugins/catalog.json`, JSON.stringify({ plugins: baked }))
