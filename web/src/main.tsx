import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { markNativeApp } from './native.ts'
markNativeApp()

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

// Demo build only: ?theme=dark|light, ?skin=<id>, ?view=board|week|day|month|schedule and ?clean=1
// (no demo bar) preset a fresh copy - for screenshots and shareable links; never in real builds.
if (MOCK) {
  const q = new URLSearchParams(location.search)
  if (q.size) {
    try {
      const prefs = JSON.parse(localStorage.getItem('kinwall.deviceAppearance') || '{}')
      if (q.get('theme')) prefs.themeMode = q.get('theme')
      if (q.get('skin')) prefs.skin = q.get('skin')
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

if (import.meta.env.DEV) import('./skins.ts').then(({ assertSkinsAA }) => assertSkinsAA())

// Keep a wall display awake (Auto-Lock "Never" on the iPad is the primary guard). The lock drops
// whenever the page is hidden, so re-request it on every return to visible.
const keepAwake = () => { if (document.visibilityState === 'visible') navigator.wakeLock?.request('screen').catch(() => {}) }
keepAwake()
document.addEventListener('visibilitychange', keepAwake)

// Push notifications need the SW registered before Settings can call pushManager.subscribe().
// Scope '/' (not sw.js's own directory) so it can control the whole app.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register(new URL('sw.js', document.baseURI), { scope: new URL('.', document.baseURI).pathname }).catch(() => {})
}

// Imported after the demo presets above so the mock's relative sample data sees the shifted clock.
const { default: App } = await import('./App.tsx')
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
