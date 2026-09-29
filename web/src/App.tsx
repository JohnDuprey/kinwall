import { holdAwake } from './wakeLock.ts'
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { encode } from 'uqr'
import { api, clearKey, getKey, onSynced, setAdminKey, setKey, useOffline, usePoll, useSaveState, ApiError, MOCK } from './api.ts'
import { AppContext, useApp } from './AppContext.tsx'
import type { Category, Member, Settings } from './types.ts'
import { trackerKinds } from './types.ts'
import { BookIcon, MoreIcon, BrushIcon, CalendarIcon, ChoreIcon, CloudOffIcon, GiftIcon, ListIcon, MealIcon, MoonIcon, PersonIcon, SettingsIcon } from './icons.tsx'
import CalendarView from './Calendar.tsx'
import Chores from './Chores.tsx'
import Lists from './Lists.tsx'
import Contacts from './Contacts.tsx'
import Meals from './Meals.tsx'
import Trackers from './Trackers.tsx'
import Activities, { shownActivities } from './Activities.tsx'
import Rewards from './Rewards.tsx'
import SettingsView, { OwnerSelect } from './Settings.tsx'
import AuthorizeScreen from './Authorize.tsx'
import Setup, { readSetupResume, resumeAtPasskey } from './Setup.tsx'
import { useIsPhone } from './useIsPhone.ts'
import { useNavMode, type NavMode } from './useNavMode.ts'
import { useDeviceAppearance, useTheme } from './useTheme.ts'
import { isWallScreen, nightScreenDue, wallDefaultsOn } from './wallScreen.ts'
import { PIN_RE, pinWaitMs, pressPinKey } from './quietPin.ts'
import { inkFor } from './color.ts'
import { loginWithPasskey, passkeysSupported, registerPasskey } from './webauthn.ts'
import { announce } from './a11y.tsx'
import { DialogProvider } from './dialog.tsx'
import NotificationBell from './Notifications.tsx'
import { InstallNudge } from './Install.tsx'
import { inNativeApp, tellAppLeaveDemo } from './native.ts'
import { HelpButton } from './Help.tsx'
import Slideshow, { SAVER_PREVIEW_EVENT, SAVER_START_EVENT } from './Screensaver.tsx'
import { CLOCK_SPOTS, nextSpot, spotStyle, type Spot } from './nightClock.ts'
import SnapshotSheet from './Snapshot.tsx'
import Profile from './Profile.tsx'
import Journal from './Journal.tsx'
import Insights from './Insights.tsx'
import Medications from './Medications.tsx'
import Sheet from './Sheet.tsx'
import { LeaveByLiveActivity } from './NowNext.tsx'
import { formatTime, resolveHour12, setHour12 } from './timeFormat.ts'

const NAV_ITEMS = [
  { key: 'calendar', href: '#/calendar', label: 'Calendar', Icon: CalendarIcon },
  { key: 'chores', href: '#/chores', label: 'Chores', Icon: ChoreIcon },
  { key: 'lists', href: '#/lists', label: 'Lists', Icon: ListIcon },
  { key: 'contacts', href: '#/contacts', label: 'Contacts', Icon: PersonIcon },
  { key: 'meals', href: '#/meals', label: 'Meals', Icon: MealIcon },
  { key: 'trackers', href: '#/trackers', label: 'Trackers', Icon: BookIcon },
  { key: 'activities', href: '#/activities', label: 'Activities', Icon: BrushIcon },
  // After the everyday views, so a phone's bottom bar keeps its four and Rewards sits under More.
  { key: 'rewards', href: '#/rewards', label: 'Rewards', Icon: GiftIcon },
  { key: 'settings', href: '#/settings', label: 'Settings', Icon: SettingsIcon },
] as const

type NavItem = { key: string; href: string; label: string; Icon: (p: object) => ReactNode }

/** The nav items this family has on (Settings → Features); Activities goes when every activity is
 * off, and Rewards goes with chores and points. A member's own device gets "Me" (their profile)
 * after Chores, so it stays on a phone's bottom bar. */
function navItems(s: Settings, me?: Member | null): NavItem[] {
  const items: NavItem[] = NAV_ITEMS.filter(i => i.key === 'chores' || i.key === 'rewards' ? s.features.chores : i.key === 'lists' ? s.features.lists : i.key === 'contacts' ? s.features.contacts : i.key === 'meals' ? s.features.meals : i.key === 'trackers' ? trackerKinds(s).length > 0 : i.key === 'activities' ? shownActivities(s).length > 0 : true)
  if (me) items.splice((items.findIndex(i => i.key === 'chores') + 1) || 1, 0, { key: 'profile', href: `#/profile/${me.id}`, label: 'Me', Icon: () => <span className="nav-me" aria-hidden="true">{me.avatar || me.name[0]}</span> })
  // Their journal, just before Settings: on a phone it sits under More, so the everyday tabs keep their place.
  if (me) items.splice(items.findIndex(i => i.key === 'settings'), 0, { key: 'journal', href: `#/journal/${me.id}`, label: 'Journal', Icon: () => <span className="nav-me" aria-hidden="true">📓</span> })
  return items
}

/** Where to send a link to a screen whose feature is off (a bookmark, a push, an old tab), or one
 * that moved, or null. */
function featureRedirect(s: Settings, section: string, sub: string | undefined): string | null {
  if (section === 'activities' && sub === 'rewards') return '#/rewards' // rewards used to be an activity
  if (section === 'medications' && !s.medications) return '#/calendar'
  if (section === 'chores' || section === 'rewards' || section === 'lists' || section === 'contacts' || section === 'meals' || section === 'trackers' || section === 'activities') {
    if (!navItems(s).some(i => i.key === section)) return '#/calendar'
    if (section === 'trackers') { const on = trackerKinds(s); return sub && !on.includes(sub) ? `#/trackers/${on[0]}` : null }
    if (sub && section === 'activities' && sub !== 'plugin' && !shownActivities(s).some(a => a.key === sub)) return '#/activities'
  }
  return null
}

/** A phone's bottom bar fits five tabs: past that, the first four plus More, which lists the rest. */
const MAX_TABS = 5

function Nav({ tab, mode, items, toApprove = 0, rewardRequests = 0 }: { tab: string; mode: NavMode; items: NavItem[]; toApprove?: number; rewardRequests?: number }) {
  const [more, setMore] = useState(false)
  // Parent devices: everything waiting for an OK on Chores (its To approve holds reward requests
  // too), and the reward requests alone on Rewards.
  const count = (key: string) => key === 'chores' ? toApprove : key === 'rewards' ? rewardRequests : 0
  const badgeFor = (n: number) => n > 0
    ? <><span className="nav-badge" aria-hidden="true">{n > 9 ? '9+' : n}</span><span className="sr-only">, {n} to approve</span></>
    : null
  const badge = (key: string) => badgeFor(count(key))
  if (mode === 'bottom') {
    const overflow = items.length > MAX_TABS
    const shown = overflow ? items.slice(0, MAX_TABS - 1) : items
    const rest = overflow ? items.slice(MAX_TABS - 1) : []
    const inRest = rest.some(i => i.key === tab)
    return (
      <nav className="tab-bar" aria-label="Main">
        {shown.map(item => (
          <a key={item.key} href={item.href} className={`tab-btn ${tab === item.key ? 'active' : ''}`} aria-current={tab === item.key ? 'page' : undefined}><item.Icon /> {item.label}{badge(item.key)}</a>
        ))}
        {overflow && (
          <button className={`tab-btn ${inRest ? 'active' : ''}`} aria-haspopup="dialog" aria-expanded={more} onClick={() => setMore(true)}
            aria-label={inRest ? `More, showing ${rest.find(i => i.key === tab)!.label}` : 'More'}>
            <MoreIcon /> More{badgeFor(Math.max(0, ...rest.map(i => count(i.key))))}
          </button>
        )}
        {more && (
          <Sheet title="More" onClose={() => setMore(false)}>
            <div className="more-list">
              {rest.map(item => (
                <a key={item.key} href={item.href} className={`more-row ${tab === item.key ? 'active' : ''}`} aria-current={tab === item.key ? 'page' : undefined}
                  onClick={() => setMore(false)}>
                  <item.Icon /> <span>{item.label}</span>{badge(item.key)}
                </a>
              ))}
            </div>
          </Sheet>
        )}
      </nav>
    )
  }
  return (
    <nav className={`nav-rail nav-rail-${mode}`} aria-label="Main">
      {items.map(item => (
        <a key={item.key} href={item.href} className={`nav-rail-btn ${tab === item.key ? 'active' : ''}`} aria-current={tab === item.key ? 'page' : undefined}><item.Icon /><span>{item.label}</span>{badge(item.key)}</a>
      ))}
    </nav>
  )
}

const IDLE_MS = 2 * 60 * 1000
export const IDLE_RESET_EVENT = 'kinwall:idle-reset'

function useHashTab() {
  const [tab, setTab] = useState(() => (location.hash.replace('#/', '').split('?')[0] || 'calendar'))
  useEffect(() => {
    const onHash = () => setTab(location.hash.replace('#/', '').split('?')[0] || 'calendar')
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  return tab
}

/** A new build deployed while this tab stayed open (sw.js caches nothing, so a reload is all it
 * takes). Refetches the app shell and checks it still references the script this page loaded — the
 * server's package.json version rarely changes between deploys, so that's no signal. A wall
 * display reloads itself on its next idle reset; everyone else gets a "tap to reload" banner. */
function useUpdateAvailable(enabled: boolean) {
  const [stale, setStale] = useState(false)
  const [scope, setScope] = useState('')
  useEffect(() => {
    if (!enabled) return
    api.meStrict().then(me => setScope(me.scope)).catch(() => {})
    const mine = (document.querySelector('script[src*="/assets/"]') as HTMLScriptElement | null)?.src.split('/').pop()
    if (!mine) return
    const check = () => fetch('/', { cache: 'no-store' }).then(r => r.ok ? r.text() : '')
      .then(html => { if (html && !html.includes(mine)) setStale(true) })
      .catch(() => { /* offline: try again later */ })
    const onVis = () => { if (document.visibilityState === 'visible') check() }
    check()
    const id = setInterval(check, 10 * 60 * 1000)
    document.addEventListener('visibilitychange', onVis)
    return () => { clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [enabled])
  useEffect(() => {
    if (!stale) return
    const onIdle = () => { if (scope === 'display' && !document.querySelector('.sheet')) location.reload() }
    window.addEventListener(IDLE_RESET_EVENT, onIdle)
    return () => window.removeEventListener(IDLE_RESET_EVENT, onIdle)
  }, [stale, scope])
  return { stale, scope }
}

const PREVIEW_MS = 20 * 1000
const CLOCK_MOVE_MS = 3 * 60 * 1000

/** Quiet hours: a wall screen (wallScreen.ts) shows only a dim clock that moves around (or, per device,
 * a dim slideshow - see Screensaver.tsx) between settings.quietFrom and quietTo. Any touch keeps it
 * awake for WAKE_MS. SAVER_PREVIEW_EVENT shows it for 20 s on any device so an admin can see what the
 * wall will do; SAVER_START_EVENT (the header's Night screen button) shows it until a tap or key.
 * With the family's quiet-hours PIN set, a tap during quiet hours shows PinKeypad instead of waking;
 * the preview and the Night screen button never ask for it (outside quiet hours). */
function QuietOverlay({ settings, wall }: { settings: Settings; wall: boolean }) {
  const device = useDeviceAppearance()
  const [now, setNow] = useState(new Date())
  const lastActive = useRef(0) // 0 = asleep from the start if loaded mid-window
  const [drift, setDrift] = useState<Spot>(CLOCK_SPOTS.center)
  const [manual, setManual] = useState<'' | 'preview' | 'hold'>('')
  const preview = manual === 'preview'
  const [keypad, setKeypad] = useState(false)
  const pinLocked = useRef(false) // mirrors `locked` below for the listeners
  const showing = useRef(false) // mirrors `asleep` below
  useEffect(() => {
    const touch = (e: Event) => {
      // While the night screen shows, a pointer wakes it on the overlay's own click (below), so the
      // whole tap lands on the overlay and never on what's underneath (a chore, an event). Keys
      // reach the overlay too: it takes focus when it shows (below).
      if (showing.current && e.type === 'pointerdown') return
      setManual('')
      if (pinLocked.current) { setKeypad(true); return }
      lastActive.current = Date.now(); setNow(new Date())
    }
    const events = ['pointerdown', 'keydown']
    events.forEach(ev => window.addEventListener(ev, touch))
    const id = setInterval(() => setNow(new Date()), 15000)
    const onPreview = () => { setManual('preview'); announce('Previewing the quiet-hours screen for 20 seconds. Tap or press Escape to end.') }
    const onStart = () => { setManual('hold'); location.hash = '#/calendar'; announce('Night screen on. Tap or press any key to end.') }
    window.addEventListener(SAVER_PREVIEW_EVENT, onPreview)
    window.addEventListener(SAVER_START_EVENT, onStart)
    return () => { clearInterval(id); events.forEach(ev => window.removeEventListener(ev, touch)); window.removeEventListener(SAVER_PREVIEW_EVENT, onPreview); window.removeEventListener(SAVER_START_EVENT, onStart) }
  }, [])
  useEffect(() => {
    if (!preview) return
    const id = setTimeout(() => setManual(''), PREVIEW_MS)
    return () => clearTimeout(id)
  }, [preview])
  useEffect(() => { holdAwake('night-screen', manual === 'hold') }, [manual])
  const due = nightScreenDue({ wall, quietFrom: settings.quietFrom, quietTo: settings.quietTo, now, lastActive: lastActive.current })
  const locked = settings.quietPin && due
  useEffect(() => { pinLocked.current = locked }, [locked])
  const wake = useCallback(() => { lastActive.current = Date.now(); setNow(new Date()); setKeypad(false) }, [])
  const hideKeypad = useCallback(() => setKeypad(false), [])
  const asleep = !!manual || due
  const overlay = useRef<HTMLDivElement>(null)
  useEffect(() => { showing.current = asleep; if (asleep) overlay.current?.focus({ preventScroll: true }) }, [asleep])
  const activate = () => { setManual(''); if (pinLocked.current) setKeypad(true); else wake() }
  // Photos turned off (Settings → Features): a display that picked them shows nature pictures instead.
  const sources = [...new Set((device.saverSources ?? []).map(src => src === 'photos' && !settings.features.photos ? 'nature' : src))]
  const fixed = device.clockPos && CLOCK_SPOTS[device.clockPos]
  const corners = sources.length > 0 // over a slideshow the small clock keeps to the corners
  useEffect(() => {
    // "Moves around" (the default burn-in guard): a new spot every few minutes, faded in (.night-spot).
    if (!asleep || fixed) return
    setDrift(corners ? nextSpot(undefined, true) : CLOCK_SPOTS.center)
    const id = setInterval(() => setDrift(d => nextSpot(d, corners)), CLOCK_MOVE_MS)
    return () => clearInterval(id)
  }, [asleep, fixed, corners])
  if (!asleep) return null
  const spot = fixed || drift
  const { time, date } = clockStrings(now, settings.timezone)
  const clock = (small: boolean) => small
    ? <div className="saver-clock"><div className="saver-time">{time}</div><div className="saver-date">{date}</div></div>
    : (
      <div className="quiet-clock night-spot" key={`${spot.x},${spot.y}`} style={spotStyle(spot)}>
        <div className="quiet-time">{time}</div>
        <div className="quiet-date">{date}</div>
      </div>
    )
  return (
    <div ref={overlay} className="quiet-overlay" role="button" tabIndex={0} aria-label="Wake display" onClick={activate}
      onKeyDown={e => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); activate() } }}>
      {locked && keypad ? <PinKeypad onWake={wake} onIdle={hideKeypad} />
        : sources.length ? <Slideshow sources={sources} device={device} clock={clock} spot={spot} /> : clock(false)}
    </div>
  )
}

// Wrong tries in a row, and when the keypad may be used again (quietPin.ts). Per page load: the
// server keeps its own count per key, so a reload doesn't reset the real limit.
let pinFailures = 0
let pinWaitUntil = 0
const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'back', '0', 'ok']

/** The quiet-hours PIN pad on the night screen: big buttons, no hint, no on-screen keyboard. The
 * server checks the PIN; if it can't be reached the screen stays asleep. Hides after 30 s idle. */
function PinKeypad({ onWake, onIdle }: { onWake: () => void; onIdle: () => void }) {
  const [entry, setEntry] = useState('')
  const [msg, setMsg] = useState('')
  const [shake, setShake] = useState(0)
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const waitLeft = Math.max(0, pinWaitUntil - now)
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  useEffect(() => { const id = setTimeout(onIdle, 30_000); return () => clearTimeout(id) }, [entry, msg, onIdle])
  const submit = async () => {
    if (busy || waitLeft || !PIN_RE.test(entry)) return
    setBusy(true)
    try {
      if ((await api.verifyQuietPin(entry)).ok) { pinFailures = 0; onWake(); return }
      pinFailures++
      pinWaitUntil = Date.now() + pinWaitMs(pinFailures)
      setMsg('Try again'); setShake(s => s + 1)
    } catch (e) {
      setMsg(e instanceof ApiError && e.status === 429 ? 'Wait a few minutes' : "Can't check right now")
    } finally {
      setBusy(false); setEntry(''); setNow(Date.now())
    }
  }
  const press = (k: string) => { if (k === 'ok') submit(); else { setEntry(e => pressPinKey(e, k)); setMsg('') } }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onIdle()
      else if (e.key === 'Enter') { if (!(e.target instanceof HTMLButtonElement)) press('ok') } // a focused key clicks itself
      else if (e.key === 'Backspace') press('back')
      else if (/^\d$/.test(e.key)) press(e.key)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const wait = waitLeft >= 60_000 ? `Wait ${Math.ceil(waitLeft / 60_000)} min` : waitLeft ? `Wait ${Math.ceil(waitLeft / 1000)} s` : ''
  return (
    <div className="quiet-keypad" role="group" aria-label="PIN" onClick={e => e.stopPropagation()}>
      <div className={`quiet-keypad-dots ${shake ? 'quiet-keypad-shake' : ''}`} key={shake} aria-label={`${entry.length} digits`}>
        {[...entry].map((_, i) => <span key={i} />)}
      </div>
      <div className="quiet-keypad-msg" role="status">{wait || msg}</div>
      <div className="quiet-keypad-grid">
        {PIN_KEYS.map(k => (
          <button key={k} type="button" className="quiet-key" disabled={busy || !!waitLeft} aria-label={k === 'back' ? 'Delete' : k === 'ok' ? 'Done' : undefined} onClick={() => press(k)}>
            {k === 'back' ? '⌫' : k === 'ok' ? '✓' : k}
          </button>
        ))}
      </div>
    </div>
  )
}

function clockStrings(now: Date, timeZone: string | null) {
  const tz = timeZone ?? undefined
  return {
    time: formatTime(now, tz),
    date: new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }).format(now),
  }
}

function ManualKeyGate({ onKey, onBack }: { onKey: () => void; onBack: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!value.trim()) return
    setBusy(true); setError('')
    setKey(value.trim())
    try {
      await api.getSettings()
      onKey()
    } catch (e) {
      clearKey('rejected')
      setError(e instanceof ApiError && e.status === 401 ? 'That key was rejected.' : 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="gate-screen" role="main">
      <div className="gate-card">
        <HelpButton className="help-float" />
        <h1>Welcome home 👋</h1>
        <p>Paste the Kinwall API key for this display to unlock it.</p>
        <div className="field" style={{ textAlign: 'left' }}>
          <label>API key</label>
          <input
            type="password"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
        </div>
        {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
        <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>{busy ? 'Checking…' : 'Unlock'}</button>
        <button className="link-btn" style={{ marginTop: 14 }} onClick={onBack}>Back</button>
      </div>
    </div>
  )
}

/** Signs in with a one-time recovery code, then lands on Settings → Access to add a new passkey. */
function RecoveryCodeGate({ onKey, onBack }: { onKey: (banner?: string) => void; onBack: () => void }) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!value.trim()) return
    setBusy(true); setError('')
    try {
      const res = await api.recoveryLogin(value.trim())
      setKey(res.key)
      location.hash = '#/settings?tab=access'
      const left = res.remaining <= 2 ? ` (${res.remaining} recovery code${res.remaining === 1 ? '' : 's'} left)` : ''
      onKey(`Signed in with a recovery code — add a new passkey now${left}`)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="gate-screen" role="main">
      <div className="gate-card">
        <h1>Use a recovery code</h1>
        <p>Enter one of the codes you saved when you set up Kinwall. Each code works once.</p>
        <div className="field" style={{ textAlign: 'left' }}>
          <label>Recovery code</label>
          <input
            type="text" autoComplete="off" autoCapitalize="characters" spellCheck={false} autoFocus
            placeholder="XXXX-XXXX-XXXX"
            style={{ fontFamily: 'ui-monospace, monospace' }}
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
        </div>
        {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
        <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>{busy ? 'Checking…' : 'Sign in'}</button>
        <button className="link-btn" style={{ marginTop: 14 }} onClick={onBack}>Back</button>
      </div>
    </div>
  )
}

/** Renders a QR code as a single SVG `<path>` from uqr's boolean matrix — never via
 * renderSVG + dangerouslySetInnerHTML (innerHTML is banned in this app). Always dark-on-white
 * with a 4-module quiet zone, even in dark theme, so a phone camera can scan it either way. */
export function QrCode({ value, size = 168 }: { value: string; size?: number }) {
  const { path, dim } = useMemo(() => {
    const quiet = 4
    const { data } = encode(value, { border: 0, ecc: 'M' })
    let d = ''
    for (let y = 0; y < data.length; y++) {
      for (let x = 0; x < data[y].length; x++) {
        if (data[y][x]) d += `M${x + quiet} ${y + quiet}h1v1h-1z`
      }
    }
    return { path: d, dim: data.length + quiet * 2 }
  }, [value])
  return (
    <svg role="img" aria-label="QR code" width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} style={{ background: '#fff', borderRadius: 12, flexShrink: 0 }}>
      <path d={path} fill="#000" />
    </svg>
  )
}

const PAIR_POLL_MS = 3000

/** Device-flow pairing screen (like pairing a TV app): shows a 6-digit code, polls
 * /api/pair/poll every 3s (paused while the tab is hidden) until an admin approves it from
 * Settings → Access elsewhere, then stores the new display key. Falls back to a manual
 * "paste an API key" form via a small link, for automation/advanced setup. */
/** First screen for a signed-out device. Admins (usually on a phone) sign in with a passkey;
 * a wall display is set up from here via a pairing code. Without passkey support (plain HTTP),
 * pairing is the only way in, so it opens straight to that. */
function PairingGate({ onKey }: { onKey: (banner?: string) => void }) {
  // The app's own "Pair with a code" opens the page with ?start=pair: straight to the code, no second tap.
  const [mode, setMode] = useState<'choose' | 'pair' | 'manual' | 'recovery'>(() => (inNativeApp() && new URLSearchParams(location.search).get('start') === 'pair') || !passkeysSupported() ? 'pair' : 'choose')
  const [error, setError] = useState('')
  const [passkeyBusy, setPasskeyBusy] = useState(false)

  const signInWithPasskey = async () => {
    setPasskeyBusy(true); setError('')
    try {
      const session = await loginWithPasskey()
      setKey(session.key)
      onKey()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Passkey sign-in failed')
    } finally {
      setPasskeyBusy(false)
    }
  }

  if (mode === 'recovery') return <RecoveryCodeGate onKey={onKey} onBack={() => setMode(passkeysSupported() ? 'choose' : 'pair')} />
  if (mode === 'manual') return <ManualKeyGate onKey={onKey} onBack={() => setMode(passkeysSupported() ? 'choose' : 'pair')} />
  if (mode === 'pair') return <DisplayPairing onKey={onKey} onManual={() => setMode('manual')} onBack={passkeysSupported() ? () => setMode('choose') : undefined}
    onRecovery={passkeysSupported() ? undefined : () => setMode('recovery')} />
  return (
    <div className="gate-screen" role="main">
      <div className="gate-card">
        <h1>Welcome home 👋</h1>
        <p>Sign in to manage your family's calendar, chores and lists.</p>
        {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
        {inNativeApp() ? <>
          {/* Passkeys need the app to be tied to this server's domain, which a self-hosted server can't be. */}
          <button className="btn btn-primary btn-block" onClick={() => setMode('pair')}>Pair this app</button>
          <p className="gate-note">Parents sign in with a passkey in Safari. Here, pair with a code a parent approves under Settings → Access.</p>
        </> : <>
          <button className="btn btn-primary btn-block" onClick={signInWithPasskey} disabled={passkeyBusy}>{passkeyBusy ? 'Checking…' : 'Sign in as a parent'}</button>
          <p className="gate-note">With your passkey. Parents can change everything.</p>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 12 }} onClick={() => setMode('pair')}>Set up a wall screen or kid's device</button>
          <p className="gate-note">A parent approves it with a code. It gets the calendar, chores and lists, but not settings.</p>
        </>}
        <div className="gate-links">
          <button className="link-btn" onClick={() => setMode('manual')}>Enter a key manually</button>
          <button className="link-btn" onClick={() => setMode('recovery')}>Use a recovery code</button>
        </div>
      </div>
    </div>
  )
}

// onRecovery: set only when this is the landing screen (no passkey support, so no choose screen).
function DisplayPairing({ onKey, onManual, onBack, onRecovery }: { onKey: () => void; onManual: () => void; onBack?: () => void; onRecovery?: () => void }) {
  const [pairing, setPairing] = useState<{ pairingId: string; code: string; pollToken: string; expiresAt: string } | null>(null)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const start = useCallback(async () => {
    setError('')
    try {
      setPairing(await api.pairStart())
    } catch {
      setError('Could not reach the server.')
    }
  }, [])

  useEffect(() => { start() }, [start])

  // Auto-refresh to a new code once this one's 10-minute TTL is up.
  useEffect(() => {
    if (!pairing || success) return
    const ms = new Date(pairing.expiresAt).getTime() - Date.now()
    const id = setTimeout(start, Math.max(ms, 0))
    return () => clearTimeout(id)
  }, [pairing, success, start])

  useEffect(() => {
    if (!pairing || success) return
    let canceled = false
    const tick = async () => {
      if (document.hidden) return
      try {
        const res = await api.pairPoll(pairing.pairingId, pairing.pollToken)
        if (canceled || res.status !== 'approved' || !res.key) return
        setKey(res.key)
        setSuccess(true)
        setTimeout(onKey, 1200)
      } catch (e) {
        // Pairing gone (expired / already consumed) on the server — get a fresh code.
        if (!canceled && e instanceof ApiError && e.status === 404) start()
      }
    }
    const id = setInterval(tick, PAIR_POLL_MS)
    return () => { canceled = true; clearInterval(id) }
  }, [pairing, success, onKey, start])

  if (success) {
    return (
      <div className="gate-screen" role="main">
        <div className="gate-card">
          <h1>You're connected! 🎉</h1>
          <p>Loading your family calendar…</p>
        </div>
      </div>
    )
  }

  const digits = pairing?.code ?? ''
  // No secrets in here — the code alone can't mint a key, approval still needs an admin key.
  const qrValue = pairing ? new URL(`#/pair?code=${pairing.code}`, document.baseURI).href : ''
  return (
    <div className="gate-screen" role="main">
      <div className="gate-card pairing-card">
        <h1>Set up this screen</h1>
        <p>On a parent's phone or computer, open Kinwall → Settings → Access → Add a wall screen or kid's device, and enter this code:</p>
        <div className="pairing-body">
          <div className="pairing-code">
            <span aria-hidden="true">{digits ? `${digits.slice(0, 3)} ${digits.slice(3)}` : '⋯'}</span>
            <span className="sr-only">{digits ? `Code: ${digits.split('').join(' ')}` : 'Getting a code…'}</span>
          </div>
          {pairing && <QrCode value={qrValue} />}
        </div>
        {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
        <p className="settings-row-sub">Or scan it with a parent's phone. The code refreshes on its own if it expires.</p>
        <div className="gate-links">
          {onBack && <button className="link-btn" onClick={onBack}>Back to sign in</button>}
          <button className="link-btn" onClick={onManual}>Enter a key manually</button>
          {onRecovery && <button className="link-btn" onClick={onRecovery}>Use a recovery code</button>}
        </div>
      </div>
    </div>
  )
}

/** Landing screen for `#/pair?code=XXXXXX` — reached by scanning the QR code above, usually from
 * a phone that has no key (or only a display key), so this must be handled BEFORE the key gate.
 * Confirms the code, asks for a name, and — if the current key isn't admin — an admin key, then
 * approves the pairing. Never stores the admin key outside sessionStorage (see api.ts) and never
 * calls setKey(): the phone confirming the pair does not itself become a paired display. */
function PairPhoneScreen({ code }: { code: string }) {
  const [checkingAdmin, setCheckingAdmin] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [useAdminField, setUseAdminField] = useState(false)
  const [adminKeyValue, setAdminKeyValue] = useState('')
  const [name, setName] = useState('Wall screen')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)
  const [owner, setOwner] = useState('shared')
  const [members, setMembers] = useState<Member[]>([])

  useEffect(() => {
    api.meStrict().then(me => setIsAdmin(me.scope === 'admin')).catch(() => setIsAdmin(false)).finally(() => setCheckingAdmin(false))
  }, [])
  // Who it belongs to needs the family's members, readable once this phone is signed in as an admin.
  useEffect(() => { if (isAdmin) api.getMembers(true).then(setMembers).catch(() => {}) }, [isAdmin])

  const unlockAdmin = async () => {
    if (!adminKeyValue.trim()) return
    setBusy(true); setError('')
    setAdminKey(adminKeyValue.trim())
    try {
      const me = await api.checkAdminKey()
      if (me.scope !== 'admin') throw new ApiError(403, 'That key is not admin-scoped')
      setIsAdmin(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Admin key rejected')
    } finally {
      setBusy(false)
    }
  }

  const unlockWithPasskey = async () => {
    setBusy(true); setError('')
    try {
      const session = await loginWithPasskey()
      setAdminKey(session.key)
      setIsAdmin(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Passkey sign-in failed')
    } finally {
      setBusy(false)
    }
  }

  const approve = async () => {
    if (code.length !== 6 || !name.trim()) return
    setBusy(true); setError('')
    try {
      await api.pairApprove(code, name.trim(), owner)
      setDone(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not pair display')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="gate-screen" role="main">
        <div className="gate-card">
          <h1>Connected! 🎉</h1>
          <p>{name} is connected — you can close this page.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="gate-screen" role="main">
      <div className="gate-card">
        <h1>Add a wall screen or kid's device</h1>
        <p>Approve it to join your family's Kinwall. It gets the calendar, chores and lists, but not settings.</p>
        <div className="field" style={{ textAlign: 'left' }}>
          <label>Code</label>
          <input type="text" value={code} readOnly
            style={{ fontWeight: 800, fontSize: '1.25rem', letterSpacing: '0.12em', textAlign: 'center' }} />
        </div>
        <div className="field" style={{ textAlign: 'left' }}>
          <label>Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Kitchen wall, Maya's tablet…" />
        </div>
        {isAdmin && (
          <div className="field" style={{ textAlign: 'left' }}>
            <label htmlFor="pair-owner">Who uses it</label>
            <OwnerSelect id="pair-owner" value={owner} onChange={setOwner} members={members} />
            <p className="settings-row-sub">A kid's device shows only their events, chores and lists. Only a parent can change this later.</p>
          </div>
        )}
        {!checkingAdmin && !isAdmin && (useAdminField || !passkeysSupported()) && (
          <div className="field" style={{ textAlign: 'left' }}>
            <label>Admin key</label>
            <input type="password" value={adminKeyValue} onChange={e => setAdminKeyValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && unlockAdmin()} placeholder="Admin API key" autoFocus />
          </div>
        )}
        {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
        {checkingAdmin ? (
          <p className="settings-row-sub">Checking…</p>
        ) : isAdmin ? (
          <button className="btn btn-primary btn-block" onClick={approve} disabled={busy || code.length !== 6 || !name.trim()}>
            {busy ? 'Pairing…' : 'Approve'}
          </button>
        ) : passkeysSupported() && !useAdminField ? (
          <>
            <button className="btn btn-primary btn-block" onClick={unlockWithPasskey} disabled={busy}>
              {busy ? 'Checking…' : 'Approve as a parent'}
            </button>
            <button className="link-btn" style={{ marginTop: 10 }} onClick={() => setUseAdminField(true)}>Use an admin key</button>
          </>
        ) : (
          <button className="btn btn-primary btn-block" onClick={unlockAdmin} disabled={busy || !adminKeyValue.trim()}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        )}
      </div>
    </div>
  )
}

/** Landing screen for `#/admin-setup?token=…` — reached by scanning the QR code from the wall
 * display's setup wizard ("finish on your phone"). Registers a passkey using the one-time
 * register-token (this device has no key at all yet), then stores the session key it gets back
 * and becomes the admin device. Must be handled before the key gate, like `#/pair`. */
function AdminSetupScreen({ token }: { token: string }) {
  const [name, setName] = useState('My phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  const create = async () => {
    if (!name.trim()) return
    setBusy(true); setError('')
    try {
      const result = await registerPasskey(name.trim(), token)
      if (!result.session) throw new Error('No session was issued — try again')
      setKey(result.session.key)
      setDone(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create your passkey')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="gate-screen" role="main">
        <div className="gate-card">
          <h1>You're the admin on this device 🎉</h1>
          <button className="btn btn-primary btn-block" onClick={() => { location.hash = '#/calendar' }}>Continue</button>
        </div>
      </div>
    )
  }

  return (
    <div className="gate-screen" role="main">
      <div className="gate-card">
        <h1>Create your Kinwall passkey</h1>
        <p>Use Face ID, Touch ID, or your device's screen lock to become the admin for this Kinwall.</p>
        <div className="field" style={{ textAlign: 'left' }}>
          <label>Name this passkey</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="My phone" autoFocus />
        </div>
        {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
        <button className="btn btn-primary btn-block" onClick={create} disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create passkey'}
        </button>
      </div>
    </div>
  )
}

/** Header avatars: a tap opens that member's snapshot (their day / week). "Show only them on the
 * calendar" lives inside it now; the avatar keeps its ring while the calendar is filtered to them. */
function MemberAvatars({ members, selectedMemberId }: { members: Member[]; selectedMemberId: string | null }) {
  const [open, setOpen] = useState<Member | null>(null)
  useEffect(() => {
    const close = () => setOpen(null) // an idle wall goes back to the plain calendar
    window.addEventListener(IDLE_RESET_EVENT, close)
    return () => window.removeEventListener(IDLE_RESET_EVENT, close)
  }, [])
  return (
    <div className={`member-filter-row ${members.length >= 4 ? 'many' : ''}`} role="group" aria-label="Family members">
      {members.map(m => (
        <button
          key={m.id}
          aria-haspopup="dialog"
          className={`member-avatar ${selectedMemberId && selectedMemberId !== m.id ? 'dim' : ''} ${selectedMemberId === m.id ? 'selected' : ''}`}
          style={{ background: m.color, color: inkFor(m.color) }}
          onClick={() => setOpen(m)}
          aria-label={`${m.name}'s day${selectedMemberId === m.id ? ' (calendar shows only them)' : ''}`}
        >
          {m.avatar || m.name[0]}
        </button>
      ))}
      {open && <SnapshotSheet member={members.find(m => m.id === open.id) ?? open} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** Phone header: the family name and a pile of faces as one button. It opens the family sheet:
 * tap a person for their day (their snapshot, where chores tick off); the round button on the right shows only them on the calendar. Same size for a family of three or nine, and the name is never squeezed. */
function FamilyButton({ name, members, selectedMemberId }: { name: string; members: Member[]; selectedMemberId: string | null }) {
  const { setSelectedMemberId } = useApp()
  const [open, setOpen] = useState(false)
  const [snap, setSnap] = useState<Member | null>(null)
  useEffect(() => {
    const close = () => { setOpen(false); setSnap(null) }
    window.addEventListener(IDLE_RESET_EVENT, close)
    return () => window.removeEventListener(IDLE_RESET_EVENT, close)
  }, [])
  const selected = members.find(m => m.id === selectedMemberId)
  // The filtered person always shows in the pile, then the others in order. Four slots: four faces
  // when that's everyone, otherwise three faces and a "+N" (never "+1", which takes a face's room).
  const ordered = [...(selected ? [selected] : []), ...members.filter(m => m.id !== selectedMemberId)]
  const shown = ordered.slice(0, ordered.length <= 4 ? 4 : 3)
  const more = members.length - shown.length
  return (
    <>
      <button className="family-btn" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}
        aria-label={`${name}: ${members.length} people${selected ? `, calendar shows only ${selected.name}` : ''}`}>
        <span className="family-pile" aria-hidden="true">
          {shown.map(m => <span key={m.id} className={`member-avatar-sm ${m.id === selectedMemberId ? 'selected' : ''}`} style={{ background: m.color, color: inkFor(m.color) }}>{m.avatar || m.name[0]}</span>)}
          {more > 0 && <span className="member-avatar-sm family-more">+{more}</span>}
        </span>
        <span className="family-name-sm">{name}</span>
      </button>
      {open && <FamilySheet name={name} members={members} selectedMemberId={selectedMemberId} onClose={() => setOpen(false)}
        onFilter={id => setSelectedMemberId(id)} onSnapshot={m => { setOpen(false); setSnap(m) }} />}
      {snap && <SnapshotSheet member={members.find(m => m.id === snap.id) ?? snap} onClose={() => setSnap(null)} />}
    </>
  )
}

function FamilySheet({ name, members, selectedMemberId, onClose, onFilter, onSnapshot }: {
  name: string; members: Member[]; selectedMemberId: string | null
  onClose: () => void; onFilter: (id: string | null) => void; onSnapshot: (m: Member) => void
}) {
  const { settings } = useApp()
  return (
    <Sheet title={name} onClose={onClose}>
      <div className="family-list">
        {members.map(m => (
          <div key={m.id} className="family-row-wrap">
            <button className={`family-row ${m.id === selectedMemberId ? 'on' : ''}`} aria-haspopup="dialog" onClick={() => onSnapshot(m)}>
              <span className={`member-avatar-sm ${m.id === selectedMemberId ? 'selected' : ''}`} style={{ background: m.color, color: inkFor(m.color) }} aria-hidden="true">{m.avatar || m.name[0]}</span>
              <span className="family-row-name">{m.name}</span>
              {(m.id === selectedMemberId || settings.features.chores) && <span className="family-row-sub">{m.id === selectedMemberId ? 'Calendar shows only them' : `${m.pointsToday} pts today`}</span>}
            </button>
            <button className={`family-pick ${m.id === selectedMemberId ? 'on' : ''}`} aria-pressed={m.id === selectedMemberId}
              aria-label={`Show only ${m.name} on the calendar`} onClick={() => onFilter(m.id === selectedMemberId ? null : m.id)}><span aria-hidden="true" /></button>
          </div>
        ))}
      </div>
    </Sheet>
  )
}

function Header({ settings, members, selectedMemberId, isAdmin, wall }: {
  settings: Settings
  members: Member[]
  selectedMemberId: string | null
  isAdmin: boolean
  wall: boolean
}) {
  const isPhone = useIsPhone()
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(id)
  }, [])
  const { time: timeStr, date: dateStr } = useMemo(() => clockStrings(now, settings.timezone), [now, settings.timezone])

  // Phones get one row: family name, people, bell, help. No clock or date: the phone's status bar
  // shows the time and every view names its date. Kept as a separate render path so the
  // ≥768px wall-iPad markup below is untouched.
  if (isPhone) {
    return (
      <header className="header header-phone">
        <FamilyButton name={settings.familyName || 'Our Family'} members={members} selectedMemberId={selectedMemberId} />
        <div className="header-right">
          <OfflineIcon />
          <NotificationBell isAdmin={isAdmin} />
          {wall && <NightScreenButton />}
          <HelpButton />
        </div>
      </header>
    )
  }

  return (
    <header className="header">
      <div className="header-left">
        <div className="family-name">{settings.familyName || 'Our Family'}</div>
        {/* Board view only (CSS): the name, big, over the space the hidden clock row keeps. */}
        <div className="family-name-big" aria-hidden="true"><span>{settings.familyName || 'Our Family'}</span></div>
        <div className="clock-row">
          <div className="clock">{timeStr}</div>
          <div className="date-text">{dateStr}</div>
        </div>
      </div>
      <div className="header-right">
        <MemberAvatars members={members} selectedMemberId={selectedMemberId} />
        <OfflineIcon />
        <NotificationBell isAdmin={isAdmin} />
        {wall && <NightScreenButton />}
        <HelpButton />
      </div>
    </header>
  )
}

// Store a key handed over in the URL and strip it. `#key=…` is preferred: browsers never send the
// fragment, so the key can't reach server/proxy logs; `?key=…` still works for older links. Must
// run before any effect fires an API call (usePoll's first /api/rev would otherwise 401 without
// the key and clear it again). Returns the captured key, if any.
function captureKeyFromUrl(): string | null {
  const url = new URL(location.href)
  const fromHash = new URLSearchParams(url.hash.slice(1)).get('key')
  const k = fromHash ?? url.searchParams.get('key')
  if (!k) return null
  setKey(k)
  url.searchParams.delete('key')
  if (fromHash) url.hash = ''
  history.replaceState(null, '', url.pathname + url.search + url.hash)
  return k
}

/** Header icon on wall screens: the Night screen now, until a tap or key (QuietOverlay). */
function NightScreenButton() {
  return (
    <button className="icon-btn header-bell" title="Night screen" aria-label="Night screen" onClick={() => window.dispatchEvent(new Event(SAVER_START_EVENT))}>
      <MoonIcon width={22} height={22} />
    </button>
  )
}

/** Header icon, only while offline; a count of changes waiting to sync. Tap says what that means. */
function OfflineIcon() {
  const { offline, pending } = useOffline()
  const { toast } = useApp()
  if (!offline) return null
  const label = pending ? `Offline: ${pending} change${pending === 1 ? '' : 's'} will sync` : 'Offline: changes will sync'
  return (
    <button className="icon-btn header-bell header-offline" title={label} aria-label={label}
      onClick={() => toast(`You're offline. ${pending ? `${pending} change${pending === 1 ? '' : 's'} will sync` : 'List and chore changes sync'} when you're back online.`)}>
      <CloudOffIcon width={22} height={22} />
      {pending > 0 && <span className="bell-badge" aria-hidden="true">{pending > 9 ? '9+' : pending}</span>}
    </button>
  )
}

/** Small pill while a change is being saved, then a brief "Saved". Also marks <html> so primary
 * buttons can't be tapped again mid-save (no double submits on a slow connection). */
function SaveIndicator() {
  const state = useSaveState()
  useEffect(() => { document.documentElement.toggleAttribute('data-saving', state === 'saving') }, [state])
  // Always mounted: a live region is only read reliably when it exists before its text changes.
  return (
    <div className={state === 'idle' ? 'sr-only' : `save-indicator ${state}`} role="status" aria-live="polite">
      {state === 'saving' ? <><span className="spinner" aria-hidden="true" />Saving…</> : state === 'saved' ? <>✓ Saved</> : null}
    </div>
  )
}

// Demo build: a slim strip across the very top; everything that pads against --safe-t moves down.
if (MOCK) document.documentElement.style.setProperty('--safe-t', 'calc(env(safe-area-inset-top, 0px) + 28px)')

// Dialogs (confirm/prompt/alert) are available everywhere, the setup wizard and gates included.
export default function App() {
  return <DialogProvider><AppRoutes /></DialogProvider>
}

function AppRoutes() {
  const [urlKey] = useState(captureKeyFromUrl)
  const [hasKey, setHasKey] = useState(() => MOCK || !!getKey()) // demo build: no sign-in
  // First-run setup wizard: checked once on mount (not re-checked as hasKey flips mid-wizard,
  // since the wizard itself sets a device key partway through display-role setup but still has
  // steps 3-6 left to run) - only Setup's onDone exits it. null = still checking.
  const [wizardActive, setWizardActive] = useState<boolean | null>(null)
  const [oauthFlags, setOauthFlags] = useState({ google: false, microsoft: false })
  const [passkeyRequired, setPasskeyRequired] = useState(false)
  useEffect(() => {
    const resume = readSetupResume()
    api.getSetup().then(async s => {
      setOauthFlags(s.oauth)
      setPasskeyRequired(s.passkeyRequired)
      if (hasKey && resume) return setWizardActive(true) // mid-wizard reload (OAuth round trip, locked phone)
      // Claimed but the passkey step never finished on a host that requires one (reload before
      // it, or a support re-issued link): an admin key here reopens the wizard at that step.
      if (hasKey && s.claimed && s.passkeyRequired && !s.hasPasskey && passkeysSupported() && (await api.meStrict().catch(() => null))?.scope === 'admin') {
        resumeAtPasskey()
        return setWizardActive(true)
      }
      // A key handed over in the URL may be the setup code of an unclaimed instance (e.g. a host
      // that provisions it with ADMIN_API_KEY): still check, and run the wizard with it if so.
      setWizardActive(hasKey && !urlKey ? false : !s.claimed)
    }).catch(() => setWizardActive(hasKey && !!resume))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [owner, setOwner] = useState<string | null>(null) // who an admin says this device belongs to (GET /api/me)
  const [ownerLocks, setOwnerLocks] = useState(false) // ...and whether that locks the family filter (everyday access only)
  const [parentDevice, setParentDevice] = useState(false) // until /api/me says otherwise, act as a device
  const [toApprove, setToApprove] = useState(0) // chores and rewards waiting for a parent's OK (parent devices)
  const [rewardRequests, setRewardRequests] = useState(0) // ...of which rewards
  // `persist`: errors and results worth reading stay until tapped; confirmations fade after 4s.
  const [toastMsg, setToastMsg] = useState<{ msg: string; persist: boolean } | null>(null)
  // Sticky banner-style toast (tap to dismiss), e.g. after a recovery-code sign-in.
  const [bannerMsg, setBannerMsg] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  // The key stopped working (revoked, or the app's sign-in lapsed while it slept). Inside the app,
  // the app takes it from here: it refreshes and reloads, or shows its own sign-in screen.
  const [rejected, setRejected] = useState(false)
  const tab = useHashTab()
  const [route, sub, ...more] = tab.split('/') // #/activities/paint -> nav item 'activities', sub-page 'paint'
  const section = route === 'recipes' ? 'meals' : route // #/recipes/import?url=… (a shared link) opens in Meals
  const rest = more.join('/') // #/activities/plugin/sight-words -> 'sight-words'
  const { mode: navMode } = useNavMode()
  const isPhone = useIsPhone()
  const { tick: pollTick, unauthorized } = usePoll()
  const [manualTick, setManualTick] = useState(0)
  const { stale: updateAvailable, scope } = useUpdateAvailable(hasKey)
  // Wall displays can't be zoomed: a pinch from a small hand leaves the wall stuck zoomed in, and
  // the text-size setting covers legibility there. Phones keep pinch-zoom for accessibility.
  useEffect(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]')
    if (!meta) return
    meta.content = scope === 'display'
      ? 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover'
      : 'width=device-width, initial-scale=1.0, viewport-fit=cover'
  }, [scope])

  const loadCore = useCallback(async () => {
    if (!hasKey) return
    try {
      const [s, m, cats, me] = await Promise.all([api.getSettings(), api.getMembers(), api.getCategories(), api.meStrict().catch(() => null)])
      // First-run default for a fresh household: no timezone set yet, so adopt this display's.
      const settings = s.timezone ? s : await api.updateSettings({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).catch(() => s)
      setSettings(settings)
      setMembers(m)
      setCategories(cats)
      if (me) { setOwner(me.owner ?? null); setOwnerLocks(!!me.locked); setParentDevice(me.scope === 'admin') }
      setLoadError(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { clearKey('rejected'); setRejected(true); setHasKey(false); return }
      setLoadError(true)
    }
  }, [hasKey])

  useEffect(() => { loadCore() }, [loadCore, pollTick, manualTick])

  // Queued (offline) changes reached the server: refresh every view so pending marks clear, and
  // say which ones the server refused (e.g. an item deleted on another device meanwhile).
  useEffect(() => onSynced(({ dropped }) => {
    setManualTick(t => t + 1)
    if (dropped.length) {
      const gone = dropped.every(d => d.status === 404)
      setToastMsg({ msg: gone ? `${dropped.length === 1 ? 'A change' : `${dropped.length} changes`} made offline didn't sync: the item was deleted on another device.`
        : `${dropped.length === 1 ? 'A change' : `${dropped.length} changes`} made offline didn't sync: ${dropped[0].message}`, persist: true })
    }
  }), [])

  // Key revoked elsewhere (e.g. Settings → Access → Displays) — the poll's own 401 catches it
  // even when nothing else is calling the API right now.
  useEffect(() => {
    if (!unauthorized) return
    clearKey('rejected')
    setRejected(true)
    setHasKey(false)
  }, [unauthorized])

  useTheme(settings)

  // A display pinned to one member: that member is always the selected one and the header shows
  // only them. On an everyday-access device an admin-set owner wins and locks it ('shared' =
  // nobody); devices paired before owners existed (owner null) pick their own under This display →
  // Show only. A parent's device (full access) is never locked by its owner: the owner is only for
  // personal defaults (meMemberId), and the family filter works as on any unowned device. A member
  // deleted since falls back to everyone.
  const device = useDeviceAppearance()
  setHour12(resolveHour12(settings?.timeFormat, device.timeFormat)) // before anything below formats a time
  const focusMember = members.find(m => m.id === (ownerLocks ? owner : device.focusMemberId))
  const meMemberId = members.some(m => m.id === owner) ? owner : null
  const effectiveMemberId = focusMember?.id ?? selectedMemberId
  const setMemberId = focusMember ? () => {} : setSelectedMemberId

  // idle reset: 2 min of no touch/pointer/keyboard activity -> back to today's calendar, close sheets.
  // Never while someone is in a text field: a slow typist or a screen-reader user reading a form
  // mustn't lose it. Tabbing, typing and wheel-scrolling all count as activity.
  // It's for the wall: on by default for wall screens and kids' devices, off for a parent's
  // phone or computer (Settings → This device can change either).
  const idleReset = device.idleReset ?? wallDefaultsOn(parentDevice, device)
  // Wall screens and kids' devices stay on; a parent's phone locks as usual unless its own switch says otherwise.
  const keepOn = device.keepAwake ?? wallDefaultsOn(parentDevice, device)
  const wall = isWallScreen(scope, device)
  useEffect(() => { holdAwake('device', keepOn) }, [keepOn])
  useEffect(() => {
    if (!idleReset) return
    let timer: ReturnType<typeof setTimeout>
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        if (document.activeElement?.matches('input:not([type="checkbox"]), textarea, select, [contenteditable]')) { reset(); return }
        // Never out of an open activity (Paint, the sticker book, an added game): a kid mid-picture
        // pauses, and taps inside an added activity's frame never reach this window anyway.
        // Nor out of shopping mode: the list is on screen in a store aisle, not on the wall.
        if (location.hash.startsWith('#/activities/') || /^#\/lists\/[^/]+\/shop/.test(location.hash)) { reset(); return }
        window.dispatchEvent(new CustomEvent(IDLE_RESET_EVENT))
        // Idle wall display drifts back to the calendar - but never away from an OAuth consent screen.
        if (location.hash !== '#/calendar' && location.hash !== '' && !location.hash.startsWith('#/authorize')) location.hash = '#/calendar'
      }, IDLE_MS)
    }
    reset()
    const events = ['pointerdown', 'touchstart', 'keydown', 'focusin', 'wheel']
    events.forEach(ev => window.addEventListener(ev, reset, { passive: true }))
    return () => { clearTimeout(timer); events.forEach(ev => window.removeEventListener(ev, reset)) }
  }, [idleReset])

  useEffect(() => {
    if (!toastMsg) return
    announce(toastMsg.msg, toastMsg.persist)
    if (toastMsg.persist) return
    const id = setTimeout(() => setToastMsg(null), 4000)
    return () => clearTimeout(id)
  }, [toastMsg])
  useEffect(() => { if (bannerMsg) announce(bannerMsg) }, [bannerMsg])
  const choresOn = !!settings?.features.chores
  useEffect(() => {
    if (!parentDevice || !choresOn) { setToApprove(0); setRewardRequests(0); return }
    // Chores and rewards waiting for an OK (approved rewards not given yet don't count: nothing to decide).
    Promise.all([api.getPendingApprovals(), api.getRedemptions({ status: 'pending' })])
      .then(([c, r]) => { setToApprove(c.length + r.length); setRewardRequests(r.length) }).catch(() => { /* keep the last count */ })
  }, [parentDevice, choresOn, pollTick, manualTick])
  const redirect = settings && featureRedirect(settings, section, sub)
  useEffect(() => { if (redirect) location.replace(redirect) }, [redirect])
  const tabLabel = section === 'profile' ? 'Profile' : section === 'journal' ? 'Journal' : section === 'insights' ? 'Insights' : section === 'medications' ? 'Medicines' : section === 'activities' && sub === 'paint' ? 'Paint' : section === 'activities' && sub === 'stickers' ? 'Sticker book' : section === 'activities' && sub === 'photos' ? 'Photos' : NAV_ITEMS.find(i => i.key === section)?.label ?? 'Calendar'
  const inApp = hasKey && !!settings && !wizardActive && (section === 'profile' || section === 'journal' || section === 'insights' || section === 'medications' || NAV_ITEMS.some(i => i.key === section))
  // "Chores · Duprey Family": the family, not the product, is what tells tabs and home-screen icons apart.
  const familyName = settings?.familyName?.trim()
  useEffect(() => { document.title = inApp ? `${tabLabel} · ${familyName || 'Kinwall'}` : 'Kinwall' }, [tabLabel, inApp, familyName])

  if (wizardActive === null) {
    return (
      <div className="gate-screen" role="main">
        <div className="state-card">Loading…</div>
      </div>
    )
  }
  if (wizardActive) {
    return <Setup oauth={oauthFlags} setupCode={urlKey ?? undefined} passkeyRequired={passkeyRequired} onDone={() => { setWizardActive(false); setHasKey(!!getKey()) }} />
  }

  // #/pair?code=XXXXXX is reached by scanning the QR code from another (usually keyless) device,
  // so it must be handled before the key gate below.
  if (tab === 'pair') {
    const code = new URLSearchParams(location.hash.split('?')[1] || '').get('code')?.replace(/\D/g, '').slice(0, 6) ?? ''
    return <PairPhoneScreen code={code} />
  }

  // #/authorize?… is an MCP client's OAuth consent (via /oauth/authorize) - handled before the key
  // gate too, since it signs in on its own and must not be sent to pairing.
  if (tab === 'authorize') return <AuthorizeScreen />

  // #/admin-setup?token=… is reached by scanning the QR code from the wall display's setup
  // wizard ("finish on your phone") — also handled before the key gate, this device has no key.
  if (tab === 'admin-setup') {
    const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token') ?? ''
    return <AdminSetupScreen token={token} />
  }

  // Blank, not the pairing screen, so a signed-in phone never flashes "Pair this app".
  if (!hasKey && rejected && inNativeApp()) return <div className="gate-screen" role="main" />
  if (!hasKey) return <PairingGate onKey={banner => { if (banner) setBannerMsg(banner); setHasKey(true) }} />
  if (!settings) {
    return (
      <div className="gate-screen" role="main">
        <div className="state-card">{loadError ? 'Could not reach the server. Retrying…' : 'Loading…'}</div>
      </div>
    )
  }

  const nav = navItems(settings, members.find(m => m.id === meMemberId))
  // "Me" is lit on their own profile only, not while looking at someone else's.
  const navTab = (section === 'profile' || section === 'journal') && sub !== meMemberId ? '' : section === 'medications' || section === 'insights' ? '' : section
  return (
    <AppContext.Provider value={{
      settings, members, categories, selectedMemberId: effectiveMemberId, setSelectedMemberId: setMemberId,
      focusMemberId: focusMember?.id ?? null, focusShowsShared: !device.focusHideShared, focusLocked: ownerLocks, meMemberId, parentDevice,
      refreshTick: pollTick + manualTick,
      reloadCore: () => setManualTick(t => t + 1),
      toast: (msg, persist = false) => setToastMsg({ msg, persist }),
    }}>
      <div className={`app-shell ${navMode !== 'bottom' ? `app-shell-rail app-shell-rail-${navMode}` : ''}`}>
        {/* A button, not href="#main": the hash is the router. */}
        <button className="skip-link" onClick={() => document.getElementById('main')?.focus()}>Skip to content</button>
        {navMode === 'left' && <Nav tab={navTab} mode={navMode} items={nav} toApprove={toApprove} rewardRequests={rewardRequests} />}
        <div className="main-col">
          <Header settings={settings} members={focusMember ? [focusMember] : members} selectedMemberId={effectiveMemberId} isAdmin={scope === 'admin'} wall={wall} />
          <main className="content" id="main" tabIndex={-1}>
            <h1 className="sr-only">{tabLabel}</h1>
            {redirect ? null : section === 'profile' ? <Profile memberId={sub} /> : section === 'journal' ? <Journal memberId={sub} /> : section === 'insights' ? <Insights memberId={sub} /> : section === 'medications' ? <Medications memberId={sub} /> : section === 'activities' ? <Activities sub={sub} rest={rest} /> : section === 'rewards' ? <Rewards memberId={sub} /> : section === 'meals' ? <Meals /> : tab === 'chores' ? <Chores /> : section === 'lists' ? <Lists /> : section === 'contacts' ? <Contacts /> : section === 'trackers' ? <Trackers sub={sub} /> : tab === 'settings' ? <SettingsView /> : <CalendarView />}
          </main>
          {navMode === 'bottom' && <Nav tab={navTab} mode={navMode} items={nav} toApprove={toApprove} rewardRequests={rewardRequests} />}
        </div>
        {navMode === 'right' && <Nav tab={navTab} mode={navMode} items={nav} toApprove={toApprove} rewardRequests={rewardRequests} />}
        <SaveIndicator />
        {toastMsg && (toastMsg.persist
          ? <button className="toast" onClick={() => setToastMsg(null)} aria-label={`${toastMsg.msg} (dismiss)`}>{toastMsg.msg} <span aria-hidden="true">✕</span></button>
          : <div className="toast">{toastMsg.msg}</div>)}
        {MOCK && inNativeApp() && <div className="demo-bar" role="status">Demo — nothing is saved.<button type="button" className="demo-bar-leave" onClick={tellAppLeaveDemo}>Leave demo</button></div>}
        {MOCK && !inNativeApp() && !sessionStorage.getItem('kinwall.demoClean') && <div className="demo-bar" role="status">Demo — nothing is saved. Reload for a fresh copy.</div>}
        {bannerMsg && <button className="toast update-banner" onClick={() => setBannerMsg(null)}>{bannerMsg}</button>}
        {updateAvailable && <button className="toast update-banner" onClick={() => location.reload()}>Kinwall updated — tap to reload</button>}
        {isPhone && <InstallNudge />}
        <QuietOverlay settings={settings} wall={wall} />
        {inNativeApp() && <LeaveByLiveActivity />}
      </div>
    </AppContext.Provider>
  )
}
