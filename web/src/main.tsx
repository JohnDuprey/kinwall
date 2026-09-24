import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import './styles.css'

// Keep a wall display awake (Auto-Lock "Never" on the iPad is the primary guard). The lock drops
// whenever the page is hidden, so re-request it on every return to visible.
const keepAwake = () => { if (document.visibilityState === 'visible') navigator.wakeLock?.request('screen').catch(() => {}) }
keepAwake()
document.addEventListener('visibilitychange', keepAwake)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
