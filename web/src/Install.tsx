// "Add Kinwall to your Home Screen": a one-time card on phones running Kinwall in the browser,
// the how-to sheet for iPhone/iPad (no install API there), and the Settings row.
// Android / Chrome / Edge fire `beforeinstallprompt`; we keep it and open the real install dialog.
import { useEffect, useState } from 'react'
import Sheet from './Sheet.tsx'
import { MOCK } from './api.ts'

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

// The event can fire before this chunk loads, so main.tsx (the entry script) catches it into
// window.__kinwallInstall and announces 'kinwall:install-changed'; this module just reads it.
const CHANGED = 'kinwall:install-changed'
type W = Window & { __kinwallInstall?: InstallEvent | null }
const getDeferred = () => (window as W).__kinwallInstall ?? null
const clearDeferred = () => { (window as W).__kinwallInstall = null }

export const isStandalone = () =>
  (navigator as Navigator & { standalone?: boolean }).standalone === true || matchMedia('(display-mode: standalone)').matches
/** iPhone, iPad (iPadOS reports a Mac with touch), or iPod. */
export const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export function useInstall() {
  const [, force] = useState(0)
  useEffect(() => {
    const on = () => force(n => n + 1)
    window.addEventListener(CHANGED, on)
    return () => window.removeEventListener(CHANGED, on)
  }, [])
  return {
    installed: isStandalone(),
    canPrompt: !!getDeferred(), // Android / Chrome / Edge: we can open the real dialog
    ios: isIOS(),
    prompt: async () => {
      const e = getDeferred()
      if (!e) return false
      await e.prompt()
      const { outcome } = await e.userChoice
      clearDeferred()
      window.dispatchEvent(new Event(CHANGED))
      return outcome === 'accepted'
    },
  }
}

// Visits and the "Not now" snooze live on this device.
const VISITS_KEY = 'kinwall.visits'
const SNOOZE_KEY = 'kinwall.installSnoozedUntil'
const SNOOZE_DAYS = 30
function countVisit(): number {
  try {
    let n = Number(localStorage.getItem(VISITS_KEY) || '0')
    if (!sessionStorage.getItem(VISITS_KEY)) { n += 1; localStorage.setItem(VISITS_KEY, String(n)); sessionStorage.setItem(VISITS_KEY, '1') }
    return n
  } catch { return 0 }
}
const snoozed = () => { try { return Date.now() < Number(localStorage.getItem(SNOOZE_KEY) || '0') } catch { return true } }
const snooze = () => { try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000)) } catch { /* private mode */ } }

/** How to add Kinwall on iPhone / iPad, where no install prompt exists. */
export function InstallHowToSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="Add Kinwall to your Home Screen" onClose={onClose}
      actions={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <ol className="install-steps">
        <li><span className="install-step-icon" aria-hidden="true"><ShareIcon /></span><span>Tap <strong>Share</strong>. In Safari it's in the toolbar; in Chrome it's next to the address.</span></li>
        <li><span className="install-step-icon" aria-hidden="true">＋</span><span>Scroll down and tap <strong>Add to Home Screen</strong>.</span></li>
        <li><span className="install-step-icon" aria-hidden="true">✓</span><span>Tap <strong>Add</strong>, then open Kinwall from its icon.</span></li>
      </ol>
      <p className="settings-row-sub">From the Home Screen, Kinwall opens full screen, and on iPhone it's the only way to get notifications.</p>
    </Sheet>
  )
}

function ShareIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M8 7l4-4 4 4" /><path d="M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" />
    </svg>
  )
}

/** The one-time card on phones (App shows it only on phones). From the second visit, until
 * installed, dismissed for 30 days, or on a device that can't install (no API and not iOS). */
export function InstallNudge() {
  const install = useInstall()
  const [visits] = useState(countVisit)
  const [hidden, setHidden] = useState(snoozed)
  const [howTo, setHowTo] = useState(false)
  const clean = MOCK && !!sessionStorage.getItem('kinwall.demoClean') // demo screenshots
  if (install.installed || hidden || visits < 2 || clean || (!install.canPrompt && !install.ios)) return howTo ? <InstallHowToSheet onClose={() => setHowTo(false)} /> : null
  const dismiss = () => { snooze(); setHidden(true) }
  return (
    <>
      <div className="install-card" role="region" aria-label="Add Kinwall to your Home Screen">
        <img src={`${import.meta.env.BASE_URL}icon-192.png`} alt="" width="40" height="40" />
        <div className="install-card-text">
          <strong>Add Kinwall to your Home Screen</strong>
          <span>Full screen, one tap away{install.ios ? ', and notifications on iPhone' : ''}.</span>
        </div>
        <div className="install-card-actions">
          {install.canPrompt
            ? <button className="btn btn-primary" onClick={async () => { if (await install.prompt()) setHidden(true) }}>Install</button>
            : <button className="btn btn-primary" onClick={() => setHowTo(true)}>Show me how</button>}
          <button className="link-btn" onClick={dismiss}>Not now</button>
        </div>
      </div>
      {howTo && <InstallHowToSheet onClose={() => { setHowTo(false); dismiss() }} />}
    </>
  )
}

/** Settings → This display: always available until installed. */
export function InstallRow() {
  const install = useInstall()
  const [howTo, setHowTo] = useState(false)
  if (install.installed) return null
  return (
    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div className="settings-row-label">Add to Home Screen</div>
      {install.canPrompt
        ? <button className="btn btn-secondary" onClick={() => install.prompt()}>Install Kinwall</button>
        : install.ios
          ? <button className="btn btn-secondary" onClick={() => setHowTo(true)}>Show me how</button>
          : <div className="settings-row-sub">Use your browser's menu to install Kinwall or add it to your Home Screen.</div>}
      <div className="settings-row-sub">Kinwall opens full screen from its own icon{install.ios ? ', and iPhone only sends notifications to the Home Screen app' : ''}.</div>
      {howTo && <InstallHowToSheet onClose={() => setHowTo(false)} />}
    </div>
  )
}
