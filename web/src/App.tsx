import { useCallback, useEffect, useMemo, useState } from 'react'
import { encode } from 'uqr'
import { api, clearKey, getKey, setAdminKey, setKey, usePoll, useSaveState, ApiError } from './api.ts'
import { AppContext } from './AppContext.tsx'
import type { Category, Member, Settings } from './types.ts'
import { CalendarIcon, ChoreIcon, ListIcon, SettingsIcon } from './icons.tsx'
import CalendarView from './Calendar.tsx'
import Chores from './Chores.tsx'
import Lists from './Lists.tsx'
import SettingsView from './Settings.tsx'
import Setup, { readSetupResume } from './Setup.tsx'
import { useIsPhone } from './useIsPhone.ts'
import { useNavMode, type NavMode } from './useNavMode.ts'
import { useTheme } from './useTheme.ts'
import { inkFor } from './color.ts'
import { loginWithPasskey, passkeysSupported, registerPasskey } from './webauthn.ts'

const NAV_ITEMS = [
  { key: 'calendar', href: '#/calendar', label: 'Calendar', Icon: CalendarIcon },
  { key: 'chores', href: '#/chores', label: 'Chores', Icon: ChoreIcon },
  { key: 'lists', href: '#/lists', label: 'Lists', Icon: ListIcon },
  { key: 'settings', href: '#/settings', label: 'Settings', Icon: SettingsIcon },
] as const

function Nav({ tab, mode }: { tab: string; mode: NavMode }) {
  if (mode === 'bottom') {
    return (
      <nav className="tab-bar">
        {NAV_ITEMS.map(item => (
          <a key={item.key} href={item.href} className={`tab-btn ${tab === item.key ? 'active' : ''}`}><item.Icon /> {item.label}</a>
        ))}
      </nav>
    )
  }
  return (
    <nav className={`nav-rail nav-rail-${mode}`}>
      {NAV_ITEMS.map(item => (
        <a key={item.key} href={item.href} className={`nav-rail-btn ${tab === item.key ? 'active' : ''}`}><item.Icon /><span>{item.label}</span></a>
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
      clearKey()
      setError(e instanceof ApiError && e.status === 401 ? 'That key was rejected.' : 'Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="gate-screen">
      <div className="gate-card">
        <h1>Welcome home 👋</h1>
        <p>Paste the Kinwall API key for this display to unlock it.</p>
        <div className="field" style={{ textAlign: 'left' }}>
          <input
            type="password"
            placeholder="API key"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
          />
        </div>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <button className="btn btn-primary btn-block" onClick={submit} disabled={busy}>{busy ? 'Checking…' : 'Unlock'}</button>
        <button className="link-btn" style={{ marginTop: 14 }} onClick={onBack}>Back to pairing code</button>
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
    <svg width={size} height={size} viewBox={`0 0 ${dim} ${dim}`} style={{ background: '#fff', borderRadius: 12, flexShrink: 0 }}>
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
function PairingGate({ onKey }: { onKey: () => void }) {
  const [mode, setMode] = useState<'choose' | 'pair' | 'manual'>(() => (passkeysSupported() ? 'choose' : 'pair'))
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

  if (mode === 'manual') return <ManualKeyGate onKey={onKey} onBack={() => setMode(passkeysSupported() ? 'choose' : 'pair')} />
  if (mode === 'pair') return <DisplayPairing onKey={onKey} onManual={() => setMode('manual')} onBack={passkeysSupported() ? () => setMode('choose') : undefined} />
  return (
    <div className="gate-screen">
      <div className="gate-card">
        <h1>Welcome home 👋</h1>
        <p>Sign in to manage your family's calendar, chores and lists.</p>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <button className="btn btn-primary btn-block" onClick={signInWithPasskey} disabled={passkeyBusy}>{passkeyBusy ? 'Checking…' : 'Sign in with passkey'}</button>
        <button className="btn btn-secondary btn-block" style={{ marginTop: 12 }} onClick={() => setMode('pair')}>Set up as a wall display</button>
        <button className="link-btn" style={{ marginTop: 8 }} onClick={() => setMode('manual')}>Enter a key manually</button>
      </div>
    </div>
  )
}

function DisplayPairing({ onKey, onManual, onBack }: { onKey: () => void; onManual: () => void; onBack?: () => void }) {
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
    let cancelled = false
    const tick = async () => {
      if (document.hidden) return
      try {
        const res = await api.pairPoll(pairing.pairingId, pairing.pollToken)
        if (cancelled || res.status !== 'approved' || !res.key) return
        setKey(res.key)
        setSuccess(true)
        setTimeout(onKey, 1200)
      } catch (e) {
        // Pairing gone (expired / already consumed) on the server — get a fresh code.
        if (!cancelled && e instanceof ApiError && e.status === 404) start()
      }
    }
    const id = setInterval(tick, PAIR_POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [pairing, success, onKey, start])

  if (success) {
    return (
      <div className="gate-screen">
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
    <div className="gate-screen">
      <div className="gate-card pairing-card">
        <h1>Set up this display</h1>
        <p>On your phone or computer, open Kinwall → Settings → Access → Add a display, and enter this code:</p>
        <div className="pairing-body">
          <div className="pairing-code" aria-label={digits ? digits.split('').join(' ') : undefined}>
            {digits ? `${digits.slice(0, 3)} ${digits.slice(3)}` : '⋯'}
          </div>
          {pairing && <QrCode value={qrValue} />}
        </div>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <p className="settings-row-sub">Scan with your phone, or enter the code in Settings → Access. This code refreshes on its own if it expires.</p>
        <div className="gate-links">
          {onBack && <button className="link-btn" onClick={onBack}>Back to sign in</button>}
          <button className="link-btn" onClick={onManual}>Enter a key manually</button>
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
  const [name, setName] = useState('Wall display')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState(false)

  useEffect(() => {
    api.meStrict().then(me => setIsAdmin(me.scope === 'admin')).catch(() => setIsAdmin(false)).finally(() => setCheckingAdmin(false))
  }, [])

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
      await api.pairApprove(code, name.trim())
      setDone(true)
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not pair display')
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="gate-screen">
        <div className="gate-card">
          <h1>Connected! 🎉</h1>
          <p>{name} is connected — you can close this page.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="gate-screen">
      <div className="gate-card">
        <h1>Pair a display</h1>
        <p>Approve this display so it can join your Kinwall.</p>
        <div className="field" style={{ textAlign: 'left' }}>
          <label>Code</label>
          <input type="text" value={code} readOnly
            style={{ fontWeight: 800, fontSize: 20, letterSpacing: '0.12em', textAlign: 'center' }} />
        </div>
        <div className="field" style={{ textAlign: 'left' }}>
          <label>Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Wall display" />
        </div>
        {!checkingAdmin && !isAdmin && (useAdminField || !passkeysSupported()) && (
          <div className="field" style={{ textAlign: 'left' }}>
            <label>Admin key</label>
            <input type="password" value={adminKeyValue} onChange={e => setAdminKeyValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && unlockAdmin()} placeholder="Admin API key" autoFocus />
          </div>
        )}
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        {checkingAdmin ? (
          <p className="settings-row-sub">Checking…</p>
        ) : isAdmin ? (
          <button className="btn btn-primary btn-block" onClick={approve} disabled={busy || code.length !== 6 || !name.trim()}>
            {busy ? 'Pairing…' : 'Approve'}
          </button>
        ) : passkeysSupported() && !useAdminField ? (
          <>
            <button className="btn btn-primary btn-block" onClick={unlockWithPasskey} disabled={busy}>
              {busy ? 'Checking…' : 'Approve with passkey'}
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
      <div className="gate-screen">
        <div className="gate-card">
          <h1>You're the admin on this device 🎉</h1>
          <button className="btn btn-primary btn-block" onClick={() => { location.hash = '#/calendar' }}>Continue</button>
        </div>
      </div>
    )
  }

  return (
    <div className="gate-screen">
      <div className="gate-card">
        <h1>Create your Kinwall passkey</h1>
        <p>Use Face ID, Touch ID, or your device's screen lock to become the admin for this Kinwall.</p>
        <div className="field" style={{ textAlign: 'left' }}>
          <label>Name this passkey</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="My phone" autoFocus />
        </div>
        {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
        <button className="btn btn-primary btn-block" onClick={create} disabled={busy || !name.trim()}>
          {busy ? 'Creating…' : 'Create passkey'}
        </button>
      </div>
    </div>
  )
}

function MemberAvatars({ members, selectedMemberId, setSelectedMemberId }: {
  members: Member[]; selectedMemberId: string | null; setSelectedMemberId: (id: string | null) => void
}) {
  return (
    <div className="member-filter-row">
      {members.map(m => (
        <button
          key={m.id}
          className={`member-avatar ${selectedMemberId && selectedMemberId !== m.id ? 'dim' : ''} ${selectedMemberId === m.id ? 'selected' : ''}`}
          style={{ background: m.color, color: inkFor(m.color) }}
          onClick={() => setSelectedMemberId(selectedMemberId === m.id ? null : m.id)}
          aria-label={m.name}
        >
          {m.avatar || m.name[0]}
        </button>
      ))}
    </div>
  )
}

function Header({ settings, members, selectedMemberId, setSelectedMemberId }: {
  settings: Settings
  members: Member[]
  selectedMemberId: string | null
  setSelectedMemberId: (id: string | null) => void
}) {
  const isPhone = useIsPhone()
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15000)
    return () => clearInterval(id)
  }, [])
  const timeStr = useMemo(() => new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: settings.timezone ?? undefined }).format(now), [now, settings.timezone])
  const dateStr = useMemo(() => new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: settings.timezone ?? undefined }).format(now), [now, settings.timezone])

  // Phones get a compact one-row-plus-date layout instead of desktop's side-by-side blocks
  // (see SPEC.md "Touch UI" + the phone plan) — kept as a fully separate render path so the
  // ≥768px wall-iPad markup below is untouched.
  if (isPhone) {
    return (
      <div className="header header-phone">
        <div className="header-phone-row">
          <div className="header-phone-left">
            <span className="family-name-sm">{settings.familyName || 'Our Family'}</span>
            <span className="clock-sm">{timeStr}</span>
          </div>
          <MemberAvatars members={members} selectedMemberId={selectedMemberId} setSelectedMemberId={setSelectedMemberId} />
        </div>
        <div className="date-text-sm">{dateStr}</div>
      </div>
    )
  }

  return (
    <div className="header">
      <div className="header-left">
        <div className="family-name">{settings.familyName || 'Our Family'}</div>
        <div className="clock-row">
          <div className="clock">{timeStr}</div>
          <div className="date-text">{dateStr}</div>
        </div>
      </div>
      <MemberAvatars members={members} selectedMemberId={selectedMemberId} setSelectedMemberId={setSelectedMemberId} />
    </div>
  )
}

// Store ?key=... and strip it from the URL. Must run before any effect fires an API call
// (usePoll's first /api/rev would otherwise 401 without the key and clear it again).
function captureKeyFromUrl() {
  const url = new URL(location.href)
  const k = url.searchParams.get('key')
  if (!k) return
  setKey(k)
  url.searchParams.delete('key')
  history.replaceState(null, '', url.pathname + url.search + url.hash)
}

/** Small pill while a change is being saved, then a brief "Saved". Also marks <html> so primary
 * buttons can't be tapped again mid-save (no double submits on a slow connection). */
function SaveIndicator() {
  const state = useSaveState()
  useEffect(() => { document.documentElement.toggleAttribute('data-saving', state === 'saving') }, [state])
  if (state === 'idle') return null
  return (
    <div className={`save-indicator ${state}`} role="status" aria-live="polite">
      {state === 'saving' ? <><span className="spinner" aria-hidden="true" />Saving…</> : <>✓ Saved</>}
    </div>
  )
}

export default function App() {
  const [hasKey, setHasKey] = useState(() => { captureKeyFromUrl(); return !!getKey() })
  // First-run setup wizard: checked once on mount (not re-checked as hasKey flips mid-wizard,
  // since the wizard itself sets a device key partway through display-role setup but still has
  // steps 3-6 left to run) - only Setup's onDone exits it. null = still checking.
  const [wizardActive, setWizardActive] = useState<boolean | null>(null)
  const [oauthFlags, setOauthFlags] = useState({ google: false, microsoft: false })
  useEffect(() => {
    const resume = readSetupResume()
    if (hasKey && resume) { setWizardActive(true); return } // mid-wizard OAuth round trip landed us back here
    if (hasKey) { setWizardActive(false); return }
    api.getSetup().then(s => { setOauthFlags(s.oauth); setWizardActive(!s.claimed) }).catch(() => setWizardActive(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [selectedMemberId, setSelectedMemberId] = useState<string | null>(null)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const tab = useHashTab()
  const { mode: navMode } = useNavMode()
  const { tick: pollTick, unauthorized } = usePoll()
  const [manualTick, setManualTick] = useState(0)

  const loadCore = useCallback(async () => {
    if (!hasKey) return
    try {
      const [s, m, cats] = await Promise.all([api.getSettings(), api.getMembers(), api.getCategories()])
      // First-run default for a fresh household: no timezone set yet, so adopt this display's.
      const settings = s.timezone ? s : await api.updateSettings({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }).catch(() => s)
      setSettings(settings)
      setMembers(m)
      setCategories(cats)
      setLoadError(false)
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { clearKey(); setHasKey(false); return }
      setLoadError(true)
    }
  }, [hasKey])

  useEffect(() => { loadCore() }, [loadCore, pollTick, manualTick])

  // Key revoked elsewhere (e.g. Settings → Access → Displays) — the poll's own 401 catches it
  // even when nothing else is calling the API right now.
  useEffect(() => {
    if (!unauthorized) return
    clearKey()
    setHasKey(false)
  }, [unauthorized])

  useTheme(settings)

  // idle reset: 2 min of no touch/pointer activity -> back to today's calendar, close sheets
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent(IDLE_RESET_EVENT))
        if (location.hash !== '#/calendar' && location.hash !== '') location.hash = '#/calendar'
      }, IDLE_MS)
    }
    reset()
    const events = ['pointerdown', 'touchstart', 'keydown']
    events.forEach(ev => window.addEventListener(ev, reset))
    return () => { clearTimeout(timer); events.forEach(ev => window.removeEventListener(ev, reset)) }
  }, [])

  useEffect(() => {
    if (!toastMsg) return
    const id = setTimeout(() => setToastMsg(null), 3200)
    return () => clearTimeout(id)
  }, [toastMsg])

  if (wizardActive === null) {
    return (
      <div className="gate-screen">
        <div className="state-card">Loading…</div>
      </div>
    )
  }
  if (wizardActive) {
    return <Setup oauth={oauthFlags} onDone={() => { setWizardActive(false); setHasKey(!!getKey()) }} />
  }

  // #/pair?code=XXXXXX is reached by scanning the QR code from another (usually keyless) device,
  // so it must be handled before the key gate below.
  if (tab === 'pair') {
    const code = new URLSearchParams(location.hash.split('?')[1] || '').get('code')?.replace(/\D/g, '').slice(0, 6) ?? ''
    return <PairPhoneScreen code={code} />
  }

  // #/admin-setup?token=… is reached by scanning the QR code from the wall display's setup
  // wizard ("finish on your phone") — also handled before the key gate, this device has no key.
  if (tab === 'admin-setup') {
    const token = new URLSearchParams(location.hash.split('?')[1] || '').get('token') ?? ''
    return <AdminSetupScreen token={token} />
  }

  if (!hasKey) return <PairingGate onKey={() => setHasKey(true)} />
  if (!settings) {
    return (
      <div className="gate-screen">
        <div className="state-card">{loadError ? 'Could not reach the server. Retrying…' : 'Loading…'}</div>
      </div>
    )
  }

  return (
    <AppContext.Provider value={{
      settings, members, categories, selectedMemberId, setSelectedMemberId,
      refreshTick: pollTick + manualTick,
      reloadCore: () => setManualTick(t => t + 1),
      toast: setToastMsg,
    }}>
      <div className={`app-shell ${navMode !== 'bottom' ? `app-shell-rail app-shell-rail-${navMode}` : ''}`}>
        {navMode === 'left' && <Nav tab={tab} mode={navMode} />}
        <div className="main-col">
          <Header settings={settings} members={members} selectedMemberId={selectedMemberId} setSelectedMemberId={setSelectedMemberId} />
          <div className="content">
            {tab === 'chores' ? <Chores /> : tab === 'lists' ? <Lists /> : tab === 'settings' ? <SettingsView /> : <CalendarView />}
          </div>
          {navMode === 'bottom' && <Nav tab={tab} mode={navMode} />}
        </div>
        {navMode === 'right' && <Nav tab={tab} mode={navMode} />}
        <SaveIndicator />
        {toastMsg && <div className="toast">{toastMsg}</div>}
      </div>
    </AppContext.Provider>
  )
}
