import './compat.ts' // first: shims for old Safari
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts/fonts.css'
import './styles.css'
import { IMPORT_CONTACTS_EVENT, markNativeApp, receiveSharedContacts } from './native.ts'
import { resumeShoppingHash } from './trip.ts'
import { homeAlias } from './hashQuery.ts'
markNativeApp()
window.addEventListener(IMPORT_CONTACTS_EVENT, e => { receiveSharedContacts((e as CustomEvent).detail) })

// Android / Chrome / Edge offer to install once the page qualifies, often before the App chunk
// has loaded, so keep the event here for Install.tsx's "Install" button.
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault()
  ;(window as Window & { __kinwallInstall?: Event | null }).__kinwallInstall = e
  window.dispatchEvent(new Event('kinwall:install-changed'))
})
window.addEventListener('appinstalled', () => {
  ;(window as Window & { __kinwallInstall?: Event | null }).__kinwallInstall = null
  window.dispatchEvent(new Event('kinwall:install-changed'))
})

// Not imported from api.ts: that would load the mock data before the demo clock below is in place.
const MOCK = import.meta.env.VITE_MOCK === '1'

// Demo build only: ?theme=dark|light, ?skin=<id>, ?lowstim=1, ?view=board|week|day|month|schedule|newscast and ?clean=1
// (no demo bar) preset a fresh copy - for screenshots and shareable links; never in real builds.
if (MOCK) {
  const q = new URLSearchParams(location.search)
  if (location.search) { // not q.size: Safari < 17 lacks URLSearchParams.size
    try {
      const prefs = JSON.parse(localStorage.getItem('kinwall.deviceAppearance') || '{}')
      if (q.get('theme')) prefs.themeMode = q.get('theme')
      if (q.get('skin')) prefs.skin = q.get('skin')
      if (q.get('lowstim')) prefs.lowStim = true
      localStorage.setItem('kinwall.deviceAppearance', JSON.stringify(prefs))
      if (q.get('view')) sessionStorage.setItem('kinwall.demoView', q.get('view')!)
      if (q.get('clean')) sessionStorage.setItem('kinwall.demoClean', '1')
      if (q.get('go')) location.hash = '#' + q.get('go')!.replace(/^#/, '')
    } catch { /* storage blocked: fine */ }
    // ?still=1: no animations or transitions (screenshots). ?now=2026-09-30T15:40: the demo's
    // clock starts there and keeps ticking, so the sample data lands at sensible times of day.
    if (q.get('still')) { const st = document.createElement('style'); st.textContent = '*, *::before, *::after { animation: none !important; transition: none !important; }'; document.head.appendChild(st) }
    const at = q.get('now') ? Date.parse(q.get('now')!) : NaN
    if (!Number.isNaN(at)) {
      const RealDate = Date
      const started = RealDate.now()
      const shifted = () => at + (RealDate.now() - started)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const FakeDate: any = function (this: unknown, ...args: unknown[]) {
        if (!new.target) return new RealDate(shifted()).toString()
        return args.length ? new (RealDate as any)(...args) : new RealDate(shifted())
      }
      FakeDate.prototype = RealDate.prototype
      FakeDate.now = shifted
      FakeDate.parse = RealDate.parse
      FakeDate.UTC = RealDate.UTC
      ;(globalThis as any).Date = FakeDate
    }
  }
}

// Until useTheme applies the family's look, paint the last look this device showed (mode and the
// color scheme's colors), else the system's (the default mode is Auto), so a refresh doesn't flash
// the default colors, or light on a dark screen.
try {
  document.documentElement.setAttribute('data-theme', localStorage.getItem('kinwall.lastTheme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'))
  const look = localStorage.getItem('kinwall.lastLook')
  if (look) document.documentElement.style.cssText = look
} catch { /* storage blocked: styles.css follows the system */ }

if (import.meta.env.DEV) import('./skins.ts').then(({ assertSkinsAA }) => assertSkinsAA())

// #/home is Home's own name for #/calendar: swapped in place, before App (and its hashchange
// listeners, registered later) reads the link.
const toHome = () => { const h = homeAlias(location.hash); if (h) history.replaceState(null, '', h) }
toHome()
window.addEventListener('hashchange', toHome)

// Relaunched mid-shop (the app or tab was closed in the store): straight back into shopping mode.
const shopHash = resumeShoppingHash(location.hash)
if (shopHash) history.replaceState(null, '', shopHash)

// Keeping the screen awake: see wakeLock.ts (held only for wall screens, the device switch,
// shopping mode and cooking).

// Push notifications need the SW registered before Settings can call pushManager.subscribe().
// Scope '/' (not sw.js's own directory) so it can control the whole app.
// It also keeps the app shell for opening offline: hand it what this page loaded before it was in
// control (the first visit), once things settle.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { scope: new URL('.', document.baseURI).pathname }).catch(() => {})
  window.addEventListener('load', () => setTimeout(() => {
    const cacheUrls = performance.getEntriesByType('resource').map(e => e.name)
    navigator.serviceWorker.ready.then(reg => reg.active?.postMessage({ cacheUrls })).catch(() => {})
  }, 3000))
}

// Imported after the demo presets above so the mock's relative sample data sees the shifted clock.
// .then(), not top-level await: the legacy (SystemJS) build for old Safari can't do top-level await.
import('./App.tsx').then(({ default: App }) => createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
))
