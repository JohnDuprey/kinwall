import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './styles.css'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
