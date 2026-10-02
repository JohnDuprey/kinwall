// Remakes the demo's Paint drawings (web/demo-drawings/*.webp) with Paint's own brushes: loads
// scripts/demo-drawings.html from a running dev server in headless Chrome and saves what it drew.
//   VITE_MOCK=1 npx vite --port 5081 &   then   node scripts/demo-drawings.mjs [http://localhost:5081]
// CHROME=/path/to/chrome overrides where Chrome is. Only the demo build ships these pictures.
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const base = process.argv[2] ?? 'http://localhost:5081'
const chrome = process.env.CHROME ?? (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome')
const dom = execFileSync(chrome, ['--headless', '--disable-gpu', '--virtual-time-budget=20000', '--dump-dom', `${base}/scripts/demo-drawings.html`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
const json = dom.match(/<pre id="out"[^>]*>(.*?)<\/pre>/s)?.[1]
if (!json) throw new Error('No drawings in the page: is the dev server running, and did the page finish?')
const out = fileURLToPath(new URL('../demo-drawings/', import.meta.url))
mkdirSync(out, { recursive: true })
for (const [name, url] of Object.entries(JSON.parse(json.replaceAll('&quot;', '"').replaceAll('&amp;', '&')))) {
  const bytes = Buffer.from(url.slice(url.indexOf(',') + 1), 'base64')
  writeFileSync(`${out}${name}.webp`, bytes)
  console.log(`${name}.webp  ${(bytes.length / 1024).toFixed(0)} KB`)
}
