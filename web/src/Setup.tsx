import { useEffect, useMemo, useRef, useState } from 'react'
import { HelpButton } from './Help.tsx'
import { api, ApiError, getAdminKey, setAdminKey, clearAdminKey, setKey } from './api.ts'
import { QrCode } from './App.tsx'
import { CalendarCheckRow, initialPicks, RecoveryCodesView, timezoneList } from './Settings.tsx'
import { announce } from './a11y.tsx'
import { MEMBER_EMOJI, MEMBER_PALETTE, nextPaletteColor } from './types.ts'
import type { Member, Settings } from './types.ts'
import { CheckIcon, PlusIcon, TrashIcon } from './icons.tsx'
import { useTheme } from './useTheme.ts'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isValidAvatar } from './emoji.ts'
import { colorName, inkFor } from './color.ts'
import { passkeysSupported, registerPasskey } from './webauthn.ts'
import { ProviderForm } from './ProviderConfig.tsx'
import type { Providers } from './types.ts'
import { MemberPicker } from './MemberPicker.tsx'
import './setup.css'

type Step = 'welcome' | 'role' | 'passkey' | 'recovery' | 'household' | 'members' | 'calendars' | 'chores' | 'done'
type DeviceRole = 'admin' | 'display'
const PROGRESS_STEPS: Step[] = ['household', 'members', 'calendars', 'chores', 'done']

// Persisted across the OAuth start->callback round trip (Google/Outlook connect from the
// Calendars step), which reloads the page. Only the step + role are stored — never a key.
const RESUME_KEY = 'kinwall.setupResume'
export interface SetupResume { step: Step; deviceRole: DeviceRole }
export function readSetupResume(): SetupResume | null {
  try {
    const raw = sessionStorage.getItem(RESUME_KEY)
    return raw ? JSON.parse(raw) as SetupResume : null
  } catch { return null }
}
function saveResume(r: SetupResume | null) {
  try { r ? sessionStorage.setItem(RESUME_KEY, JSON.stringify(r)) : sessionStorage.removeItem(RESUME_KEY) } catch { /* ignore */ }
}
/** Claimed but no passkey yet on a host that requires one (see App.tsx): reopen at that step. */
export const resumeAtPasskey = () => saveResume({ step: 'passkey', deviceRole: 'admin' })

const CHORE_TEMPLATES = [
  { emoji: '🛏️', title: 'Make bed', points: 1, rrule: 'FREQ=DAILY' },
  { emoji: '🐶', title: 'Feed the pet', points: 2, rrule: 'FREQ=DAILY' },
  { emoji: '🍽️', title: 'Dishes', points: 2, rrule: 'FREQ=DAILY' },
  { emoji: '🗑️', title: 'Take out trash', points: 3, rrule: 'FREQ=WEEKLY' },
  { emoji: '📚', title: 'Homework', points: 3, rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' },
  { emoji: '🧺', title: 'Put away laundry', points: 2, rrule: 'FREQ=WEEKLY' },
  { emoji: '🪴', title: 'Water plants', points: 1, rrule: 'FREQ=WEEKLY;BYDAY=MO,TH' },
]

function Progress({ step }: { step: Step }) {
  const at = PROGRESS_STEPS.indexOf(step)
  if (at < 0) return null
  return (
    <div className="setup-progress" role="img" aria-label={`Step ${at + 1} of ${PROGRESS_STEPS.length}`}>
      {PROGRESS_STEPS.map((s, i) => <div key={s} className={`setup-dot ${i < at ? 'done' : ''} ${i === at ? 'active' : ''}`} />)}
    </div>
  )
}

function StepNav({ onBack, onNext, nextLabel = 'Next', nextDisabled, onSkip }: {
  onBack?: () => void; onNext?: () => void; nextLabel?: string; nextDisabled?: boolean; onSkip?: () => void
}) {
  return (
    <div className="setup-nav">
      <div>{onBack && <button className="btn btn-secondary setup-btn" onClick={onBack}>Back</button>}</div>
      <div className="setup-nav-right">
        {onSkip && <button className="link-btn" onClick={onSkip}>Skip</button>}
        {onNext && <button className="btn btn-primary setup-btn" onClick={onNext} disabled={nextDisabled}>{nextLabel}</button>}
      </div>
    </div>
  )
}

/** Inline admin-key prompt for a display-scope device whose in-memory admin key (sessionStorage,
 * 5 min TTL — see api.ts) expired, e.g. after the wizard sat mid-flow. Only shown where it's
 * actually needed (calendar creation), same pattern as Settings.tsx's AdminGate. */
function AdminUnlockInline({ onUnlocked }: { onUnlocked: () => void }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const unlock = async () => {
    if (!value.trim()) return
    setBusy(true); setError('')
    setAdminKey(value.trim())
    try {
      const me = await api.checkAdminKey()
      if (me.scope !== 'admin') throw new ApiError(403, 'That key is not admin-scoped')
      onUnlocked()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Admin key rejected')
    } finally { setBusy(false) }
  }
  return (
    <div className="setup-admin-unlock">
      <p>This step needs your admin key (it's only kept in memory during setup).</p>
      <label htmlFor="setup-admin-unlock" className="setup-input-label">Admin API key</label>
      <div className="setup-admin-unlock-row">
        <input id="setup-admin-unlock" type="password" value={value} onChange={e => setValue(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && unlock()} />
        <button className="btn btn-primary" onClick={unlock} disabled={busy}>Unlock</button>
      </div>
      {error && <p className="setup-error" role="alert">{error}</p>}
    </div>
  )
}

function WelcomeStep({ code, setCode, onNext }: { code: string; setCode: (v: string) => void; onNext: () => void }) {
  const [hint, setHint] = useState(false)
  // The setup code is 6 digits; the server also accepts the ADMIN_API_KEY secret, which is long.
  const [useKey, setUseKey] = useState(false)
  const ready = useKey ? code.length >= 6 : code.length === 6
  const switchMode = () => { setUseKey(k => !k); setCode('') }
  return (
    <div className="setup-step">
      <h1>Welcome to Kinwall 👋</h1>
      <p className="setup-sub">
        {useKey ? 'Enter the ADMIN_API_KEY you set on the server.' : "Let's get your family wall set up. Enter the setup code from your server log to begin."}
      </p>
      <label className="setup-input-label" htmlFor="setup-code">{useKey ? 'Admin API key' : 'Setup code'}</label>
      {useKey ? (
        <input
          id="setup-code"
          className="setup-key-input"
          type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus
          value={code} onChange={e => setCode(e.target.value.trim())}
          onKeyDown={e => e.key === 'Enter' && ready && onNext()}
          placeholder="ADMIN_API_KEY"
        />
      ) : (
        <input
          id="setup-code"
          className="setup-code-input"
          type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6} autoFocus
          value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={e => e.key === 'Enter' && ready && onNext()}
          placeholder="000 000"
        />
      )}
      <button className="link-btn setup-hint-toggle" onClick={switchMode}>
        {useKey ? 'Use a 6-digit setup code instead' : 'Use your ADMIN_API_KEY instead'}
      </button>
      {!useKey && <button className="link-btn setup-hint-toggle" onClick={() => setHint(h => !h)} aria-expanded={hint}>Where do I find this?</button>}
      {hint && !useKey && (
        <div className="setup-hint-box">
          <p><strong>Docker:</strong> <code>docker logs kinwall</code></p>
          <p><strong>Home Assistant add-on:</strong> Settings → Add-ons → Kinwall → Log</p>
          <p><strong>Cloudflare Workers:</strong> the Worker's logs, or use your <code>ADMIN_API_KEY</code> secret instead</p>
        </div>
      )}
      <StepNav onNext={onNext} nextDisabled={!ready} nextLabel="Continue" />
    </div>
  )
}

function RoleStep({ busy, error, onChoose }: { busy: boolean; error: string; onChoose: (role: DeviceRole) => void }) {
  return (
    <div className="setup-step">
      <h1>What is this device?</h1>
      <p className="setup-sub">This decides which key gets stored here.</p>
      <div className="setup-role-cards">
        <button className="setup-role-card" disabled={busy} onClick={() => onChoose('display')}>
          <div className="setup-role-emoji">🖼️</div>
          <div className="setup-role-title">This is the wall display</div>
          <div className="setup-role-sub">The iPad or screen mounted on the wall</div>
        </button>
        <button className="setup-role-card" disabled={busy} onClick={() => onChoose('admin')}>
          <div className="setup-role-emoji">📱</div>
          <div className="setup-role-title">This is my phone or computer</div>
          <div className="setup-role-sub">You'll manage Kinwall from here</div>
        </button>
      </div>
      {busy && <p className="setup-sub">Claiming…</p>}
      {error && <p className="setup-error" role="alert">{error}</p>}
    </div>
  )
}

/** Admin device role, right after claim: swap the just-issued admin key for a passkey + session,
 * so no long-lived admin key is left stored on this device. Registers using the device's current
 * key (the raw admin key from claim), then on success deletes that claim key server-side. */
function PasskeyStep({ adminKeyId, onDone, onSkip }: { adminKeyId: string | null; onDone: () => void; onSkip?: () => void }) {
  const [name, setName] = useState('My phone')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const create = async (authenticator?: 'cross-platform') => {
    if (!name.trim()) return
    setBusy(true); setError('')
    try {
      const result = await registerPasskey(name.trim(), undefined, undefined, authenticator)
      if (result.session) {
        setKey(result.session.key)
        if (adminKeyId) await api.deleteKey(adminKeyId).catch(() => {}) // best-effort - the passkey itself is already saved
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not create passkey')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setup-step">
      <h1>Create a passkey for this device</h1>
      <p className="setup-sub">{onSkip ? "Use Face ID, Touch ID, or your device's screen lock instead of saving a key."
        : "Kinwall signs you in with a passkey. Without one there's no way back into this family."}</p>
      <div className="field"><label>Name this passkey</label><input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
      {error && <p className="setup-error" role="alert">{error}</p>}
      <StepNav onNext={() => create()} nextDisabled={busy || !name.trim()} nextLabel={busy ? 'Creating…' : 'Create passkey'} onSkip={onSkip} />
      <button className="link-btn" style={{ minHeight: 44, display: 'block', marginLeft: 'auto' }} disabled={busy || !name.trim()} onClick={() => create('cross-platform')}>
        Use a security key or another device
      </button>
    </div>
  )
}

/** Right after the passkey step: a set of one-time recovery codes, the way back in if that
 * device is lost. Skippable - Settings → Access nudges until there's a second way in. */
function RecoveryStep({ onNext }: { onNext: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const generated = useRef(false)
  useEffect(() => {
    if (generated.current) return // StrictMode double-mount would otherwise replace the set
    generated.current = true
    api.generateRecoveryCodes().then(r => setCodes(r.codes)).catch(e => setError(e instanceof ApiError ? e.message : 'Could not create recovery codes'))
  }, [])
  return (
    <div className="setup-step">
      <h1>Save your recovery codes</h1>
      <p className="setup-sub">If this device is ever lost, one of these signs you back in. Each works once. Keep them in a password manager or printed with your important papers.</p>
      {codes ? <RecoveryCodesView codes={codes} /> : !error && <p className="setup-sub">Creating…</p>}
      {error && <p className="setup-error" role="alert">{error}</p>}
      {codes && (
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0', minHeight: 44 }}>
          <input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} />
          I've saved these somewhere safe
        </label>
      )}
      <StepNav onNext={onNext} nextDisabled={!saved} />
      <button className="link-btn" style={{ minHeight: 44, display: 'block', marginLeft: 'auto' }} onClick={onNext}>Skip for now</button>
    </div>
  )
}

function HouseholdStep({ useAdmin, onNext, onBack }: { useAdmin: boolean; onNext: () => void; onBack: () => void }) {
  const tzs = useMemo(timezoneList, [])
  const [familyName, setFamilyName] = useState('Our Family')
  // A host may have set the name before the wizard runs (hosted signup asks for it); keep it.
  useEffect(() => { api.getSettings(useAdmin).then(s => { if (s.familyName && s.familyName !== 'Our Family') setFamilyName(s.familyName) }).catch(() => {}) }, [])
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [weekStart, setWeekStart] = useState<0 | 1>(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setBusy(true); setError('')
    try {
      await api.updateSettings({ familyName: familyName.trim() || 'Our Family', timezone, weekStart }, useAdmin)
      onNext()
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not save') } finally { setBusy(false) }
  }

  return (
    <div className="setup-step">
      <h1>Your household</h1>
      <div className="field"><label>Family name</label><input type="text" value={familyName} onChange={e => setFamilyName(e.target.value)} autoFocus /></div>
      <div className="field">
        <label>Timezone</label>
        <select className="settings-select setup-select" value={timezone} onChange={e => setTimezone(e.target.value)}>
          {tzs.map(tz => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </div>
      <div className="field">
        <label>Week starts on</label>
        <div className="setup-choice-row">
          <button className={`setup-choice ${weekStart === 0 ? 'active' : ''}`} aria-pressed={weekStart === 0} onClick={() => setWeekStart(0)}>Sunday</button>
          <button className={`setup-choice ${weekStart === 1 ? 'active' : ''}`} aria-pressed={weekStart === 1} onClick={() => setWeekStart(1)}>Monday</button>
        </div>
      </div>
      {error && <p className="setup-error" role="alert">{error}</p>}
      <StepNav onBack={onBack} onNext={save} nextDisabled={busy} nextLabel={busy ? 'Saving…' : 'Next'} />
    </div>
  )
}

function MembersStep({ useAdmin, onNext, onBack }: { useAdmin: boolean; onNext: () => void; onBack: () => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [name, setName] = useState('')
  const [color, setColor] = useState(MEMBER_PALETTE[0])
  const [avatar, setAvatar] = useState(MEMBER_EMOJI[0])
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)

  /** Adds the typed member; resolves whether it was added. */
  const add = async (): Promise<boolean> => {
    if (!name.trim()) return false
    if (!isValidAvatar(avatar)) { setError('Pick an avatar first.'); return false }
    setError('')
    try {
      const m = await api.createMember({ name: name.trim(), color, avatar }, useAdmin)
      const list = [...members, m]
      setMembers(list)
      setName('')
      setColor(nextPaletteColor(list.map(x => x.color)))
      setAvatar(MEMBER_EMOJI[list.length % MEMBER_EMOJI.length])
      nameRef.current?.focus()
      return true
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not add member'); return false }
  }
  // A typed-but-not-added name is added on Next rather than dropped.
  const next = async () => { if (!name.trim() || await add()) onNext() }
  const remove = async (id: string) => {
    try { await api.deleteMember(id, useAdmin); setMembers(ms => ms.filter(m => m.id !== id)) }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not remove member') }
  }

  return (
    <div className="setup-step">
      <h1>Who's in the family?</h1>
      <p className="setup-sub">Add everyone who'll show up on the wall.</p>
      <div className="field"><label>Name</label>
        <input ref={nameRef} type="text" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()} placeholder="e.g. Sam" autoFocus />
      </div>
      <div className="field">
        <label>Color</label>
        <div className="color-swatch-row">
          {MEMBER_PALETTE.map(c => <button key={c} className={`color-swatch ${color === c ? 'active' : ''}`} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} aria-label={colorName(c)} />)}
        </div>
      </div>
      <div className="field">
        <label>Avatar</label>
        <div className="emoji-swatch-row">
          {MEMBER_EMOJI.map(e => <button key={e} className={`emoji-swatch ${avatar === e ? 'active' : ''}`} aria-pressed={avatar === e} onClick={() => setAvatar(e)}>{e}</button>)}
        </div>
        <AnyEmojiField value={avatar} onChange={setAvatar} allowInitials />
      </div>
      <button className="add-row-btn setup-add-btn" onClick={add} disabled={!name.trim() || !isValidAvatar(avatar)}><PlusIcon width={20} height={20} />{members.length ? 'Add another' : 'Add'}</button>
      {error && <p className="setup-error" role="alert">{error}</p>}
      {members.length > 0 && (
        <div className="member-row-list setup-member-list">
          {members.map(m => (
            <div key={m.id} className="member-list-item">
              <div className="member-avatar-sm" style={{ background: m.color, color: inkFor(m.color) }}>{m.avatar}</div>
              <div className="name">{m.name}</div>
              <button className="icon-btn" onClick={() => remove(m.id)} aria-label={`Remove ${m.name}`}><TrashIcon width={16} height={16} /></button>
            </div>
          ))}
        </div>
      )}
      <StepNav onBack={onBack} onNext={next} nextDisabled={members.length === 0} />
    </div>
  )
}

function IcsForm({ members, onDone }: { members: Member[]; onDone: () => void }) {
  const [url, setUrl] = useState('')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState('')
  const [error, setError] = useState('')

  const save = async () => {
    if (!url.trim()) return
    setBusy(true); setError(''); setResult('')
    try {
      const cal = await api.createCalendar({ kind: 'ics', name: 'Subscribed calendar', url: url.trim(), color: nextPaletteColor([]), memberIds })
      const sync = await api.syncCalendar(cal.id, true)
      setResult(`Added — ${sync.count} events synced`)
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not add calendar') } finally { setBusy(false) }
  }

  return (
    <div className="setup-provider-form">
      <div className="field"><label>ICS URL</label><input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" autoFocus /></div>
      <MemberPicker members={members} selected={memberIds} onChange={setMemberIds} label="Who is this for?" />
      {result && <p className="setup-success">{result}</p>}
      {error && <p className="setup-error" role="alert">{error}</p>}
      <button className={`btn ${result ? '' : 'btn-primary'} setup-btn`} onClick={result ? onDone : save} disabled={busy || !url.trim()}>
        {busy ? 'Adding…' : result ? 'Close' : 'Add & sync'}
      </button>
    </div>
  )
}

/** What the calendars step's Next button does while an account's calendars are listed. */
type PendingAdd = { label: string; busy: boolean; commit: () => Promise<boolean> }

function CaldavForm({ onPending }: { onPending: (p: PendingAdd | null) => void }) {
  const [name, setName] = useState('')
  const [serverUrl, setServerUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [accountId, setAccountId] = useState<string | null>(null)
  const [remotes, setRemotes] = useState<Awaited<ReturnType<typeof api.getRemoteCalendars>> | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [progress, setProgress] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const connect = async () => {
    if (!name.trim() || !serverUrl.trim() || !username.trim() || !password) return
    setBusy(true); setError('')
    try {
      const acc = await api.createCaldavAccount({ name: name.trim(), serverUrl: serverUrl.trim(), username: username.trim(), password })
      setAccountId(acc.id)
      const rs = await api.getRemoteCalendars(acc.id)
      setRemotes(rs)
      setChecked(initialPicks(rs.map(rc => rc.remoteId)))
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not connect') } finally { setBusy(false) }
  }

  // The step's Next button adds the ticked calendars one by one, then moves on (false = stay).
  const todo = (remotes ?? []).filter(rc => checked.has(rc.remoteId) && !added.has(rc.remoteId))
  const commit = async () => {
    if (!accountId) return true
    let done = 0
    for (const rc of todo) {
      setProgress(`Adding ${done + 1} of ${todo.length}…`)
      try {
        await api.createCalendar({ kind: 'caldav', accountId, remoteId: rc.remoteId, name: rc.name, color: rc.color ?? nextPaletteColor([]), writable: rc.writable })
        done++
        setAdded(s => new Set(s).add(rc.remoteId))
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : 'Could not add calendar'
        setError(msg); announce(msg, true); setProgress(null)
        return false
      }
    }
    setProgress(null)
    if (done) announce(`Added ${done} calendar${done === 1 ? '' : 's'}`)
    return true
  }
  const onPendingRef = useRef(onPending)
  onPendingRef.current = onPending
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => {
    onPendingRef.current(remotes?.length ? {
      label: progress ?? (todo.length ? `Add ${todo.length} and continue` : 'Skip'),
      busy: progress !== null,
      commit: () => commitRef.current(),
    } : null)
  }, [remotes, todo.length, progress])
  useEffect(() => () => onPendingRef.current(null), [])

  if (!accountId) {
    return (
      <div className="setup-provider-form">
        <div className="field"><label>Account name</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. iCloud" autoFocus /></div>
        <div className="field"><label>Server URL</label><input type="url" value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="https://caldav.icloud.com" /></div>
        <div className="field"><label>Username</label><input type="text" value={username} onChange={e => setUsername(e.target.value)} /></div>
        <div className="field"><label>App password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} /></div>
        {error && <p className="setup-error" role="alert">{error}</p>}
        <button className="btn btn-primary setup-btn" onClick={connect} disabled={busy}>{busy ? 'Connecting…' : 'Connect'}</button>
      </div>
    )
  }
  return (
    <div className="setup-provider-form">
      {remotes === null ? <p className="setup-sub">Loading calendars…</p> : remotes.length === 0 ? <p className="setup-sub">No calendars found.</p> : <>
        <p className="setup-sub">Pick the calendars to show on the wall. You can change this any time under Calendars.</p>
        {remotes.map(rc => (
          <div key={rc.remoteId} className="cal-list-item">
            <CalendarCheckRow name={rc.name} color={rc.color ?? '#888'} checked={checked.has(rc.remoteId)} added={added.has(rc.remoteId)} readOnly={!rc.writable}
              onChange={v => setChecked(s => { const n = new Set(s); if (v) n.add(rc.remoteId); else n.delete(rc.remoteId); return n })} />
          </div>
        ))}
      </>}
      {progress && <span className="sr-only" role="status">{progress}</span>}
      {error && <p className="setup-error" role="alert">{error}</p>}
    </div>
  )
}

function CalendarsStep({ members, oauth, deviceRole, onNext, onBack, onOAuthStart }: {
  members: Member[]; oauth: { google: boolean; microsoft: boolean }; deviceRole: DeviceRole
  onNext: () => void; onBack: () => void; onOAuthStart: (kind: 'google' | 'microsoft') => void
}) {
  const [open, setOpen] = useState<'google' | 'microsoft' | 'icloud' | 'ics' | null>(null)
  const [unlocked, setUnlocked] = useState(() => deviceRole === 'admin' || !!getAdminKey())
  const [providers, setProviders] = useState<Providers | null>(null)
  const [providerMsg, setProviderMsg] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAdd | null>(null)
  const next = async () => { if (!pending || await pending.commit()) onNext() }
  const loadProviders = () => { api.getProviders().then(setProviders).catch(() => {}) }
  useEffect(() => { if (unlocked) loadProviders() }, [unlocked])

  if (!unlocked) {
    return (
      <div className="setup-step">
        <h1>Calendars</h1>
        <AdminUnlockInline onUnlocked={() => setUnlocked(true)} />
        <StepNav onBack={onBack} onNext={onNext} onSkip={onNext} nextLabel="Continue without calendars" />
      </div>
    )
  }

  return (
    <div className="setup-step">
      <h1>Connect a calendar</h1>
      <p className="setup-sub">Optional — you can always add these later in Settings.</p>
      <div className="setup-provider-grid">
        <button className="setup-provider-card" onClick={() => setOpen(open === 'google' ? null : 'google')} aria-expanded={open === 'google'}>📆 Google</button>
        <button className="setup-provider-card" onClick={() => setOpen(open === 'microsoft' ? null : 'microsoft')} aria-expanded={open === 'microsoft'}>📧 Outlook</button>
        <button className="setup-provider-card" onClick={() => setOpen(open === 'icloud' ? null : 'icloud')} aria-expanded={open === 'icloud'}>🍎 iCloud (CalDAV)</button>
        <button className="setup-provider-card" onClick={() => setOpen(open === 'ics' ? null : 'ics')} aria-expanded={open === 'ics'}>🔗 Subscribe to a link</button>
      </div>

      {providerMsg && <p className="setup-note">{providerMsg}</p>}

      {open === 'google' && (oauth.google ? (
        <div className="setup-provider-form"><button className="btn btn-primary setup-btn" onClick={() => onOAuthStart('google')}>Connect Google</button></div>
      ) : providers && <ProviderForm kind="google" providers={providers} toast={setProviderMsg} onChanged={loadProviders} />)}

      {open === 'microsoft' && (oauth.microsoft ? (
        <div className="setup-provider-form"><button className="btn btn-primary setup-btn" onClick={() => onOAuthStart('microsoft')}>Connect Outlook</button></div>
      ) : providers && <ProviderForm kind="microsoft" providers={providers} toast={setProviderMsg} onChanged={loadProviders} />)}

      {open === 'icloud' && <CaldavForm onPending={setPending} />}
      {open === 'ics' && <IcsForm members={members} onDone={() => setOpen(null)} />}

      <StepNav onBack={onBack} onNext={next} onSkip={pending ? undefined : onNext}
        nextLabel={pending?.label} nextDisabled={pending?.busy} />
    </div>
  )
}

function ChoresStep({ members, onNext, onBack }: { members: Member[]; onNext: () => void; onBack: () => void }) {
  const [selected, setSelected] = useState<Record<number, string | null>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const toggle = (i: number) => setSelected(s => {
    const next = { ...s }
    if (i in next) delete next[i]; else next[i] = null
    return next
  })

  const create = async () => {
    setBusy(true); setError('')
    try {
      await Promise.all(Object.entries(selected).map(([i, memberId]) => {
        const t = CHORE_TEMPLATES[Number(i)]
        return api.createChore({ title: t.title, emoji: t.emoji, points: t.points, rrule: t.rrule, memberId: memberId ?? undefined, active: true })
      }))
      onNext()
    } catch (e) { setError(e instanceof ApiError ? e.message : 'Could not create chores') } finally { setBusy(false) }
  }

  return (
    <div className="setup-step">
      <h1>Set up some chores</h1>
      <p className="setup-sub">Tap to pick a few starter chores, then choose who does each one.</p>
      <div className="setup-chore-grid">
        {CHORE_TEMPLATES.map((t, i) => (
          <div key={t.title} className={`setup-chore-card ${i in selected ? 'active' : ''}`}>
            <button className="setup-chore-tap" onClick={() => toggle(i)} aria-pressed={i in selected}>
              <span className="setup-chore-emoji" aria-hidden="true">{t.emoji}</span>
              <span>{t.title}</span>
              {i in selected && <CheckIcon width={16} height={16} />}
            </button>
            {i in selected && (
              <div className="chip-row setup-chore-assign" role="group" aria-label={`Who does ${t.title}?`}>
                <button className={`chip ${selected[i] === null ? 'active' : ''}`} aria-pressed={selected[i] === null} onClick={() => setSelected(s => ({ ...s, [i]: null }))}>Anyone</button>
                {members.map(m => (
                  <button key={m.id} className={`chip ${selected[i] === m.id ? 'active' : ''}`} aria-pressed={selected[i] === m.id} onClick={() => setSelected(s => ({ ...s, [i]: m.id }))}>{m.avatar} {m.name}</button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {error && <p className="setup-error" role="alert">{error}</p>}
      <StepNav onBack={onBack} onSkip={onNext}
        onNext={create} nextDisabled={busy || Object.keys(selected).length === 0}
        nextLabel={busy ? 'Creating…' : `Create ${Object.keys(selected).length || ''} chore${Object.keys(selected).length === 1 ? '' : 's'}`} />
    </div>
  )
}

const SETUP_PASSKEY_POLL_MS = 3000

/** Wall-display role's final screen: offers "finish on your phone" (a QR code carrying a
 * one-time register-token — see `#/admin-setup` in App.tsx) instead of showing the raw admin
 * key. Polls GET /api/setup for its `passkeys` flag to notice when the phone finishes, then
 * drops this display's temporary in-memory admin key and deletes the claim key server-side. The
 * "Show admin key instead" fallback keeps today's reveal-the-key screen verbatim. */
function DisplayDoneStep({ adminKey, adminKeyId, onGoToCalendar }: { adminKey: string | null; adminKeyId: string | null; onGoToCalendar: () => void }) {
  const [fallback, setFallback] = useState(!passkeysSupported())
  const [reg, setReg] = useState<{ token: string; expiresAt: string } | null>(null)
  const [phoneDone, setPhoneDone] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (fallback || reg) return
    api.passkeyRegisterToken().then(setReg).catch(() => setError('Could not start "finish on your phone" — try the admin key instead.'))
  }, [fallback, reg])

  useEffect(() => {
    if (fallback || !reg || phoneDone) return
    let cancelled = false
    const tick = async () => {
      try {
        const s = await api.getSetup()
        if (cancelled || !s.passkeys) return
        setPhoneDone(true)
        if (adminKeyId) await api.deleteKey(adminKeyId).catch(() => {}) // temp admin key still valid (sessionStorage, 5 min TTL)
        clearAdminKey()
      } catch { /* offline / transient - next tick retries */ }
    }
    const id = setInterval(tick, SETUP_PASSKEY_POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [fallback, reg, phoneDone, adminKeyId])

  const copy = async () => {
    if (!adminKey) return
    try { await navigator.clipboard.writeText(adminKey); setCopied(true) } catch { /* ignore */ }
  }

  if (phoneDone) {
    return (
      <div className="setup-step">
        <h1>Passkey created on your phone! 🎉</h1>
        <p className="setup-sub">This display no longer holds an admin key — manage Kinwall from your phone's Settings.</p>
        <StepNav onNext={onGoToCalendar} nextLabel="Continue to calendar" />
      </div>
    )
  }

  if (!fallback) {
    const qrValue = reg ? new URL(`#/admin-setup?token=${reg.token}`, document.baseURI).href : ''
    return (
      <div className="setup-step">
        <h1>Finish on your phone</h1>
        <p className="setup-sub">Scan this with your phone to create your admin passkey (Face ID / Touch ID).</p>
        <div className="setup-key-row">
          {reg ? <QrCode value={qrValue} size={168} /> : <p className="setup-sub">Preparing…</p>}
        </div>
        {error && <p className="setup-error" role="alert">{error}</p>}
        <p className="settings-row-sub">Waiting for the passkey to be created…</p>
        <button className="link-btn" onClick={() => setFallback(true)}>Show admin key instead</button>
      </div>
    )
  }

  return (
    <div className="setup-step">
      <h1>All set! 🎉</h1>
      {adminKey ? (
        <>
          <div className="setup-admin-reveal">
            <p className="setup-warning">Save this admin key now — it won't be shown again. You'll need it to manage Kinwall and pair more displays.</p>
            <div className="setup-key-row">
              <QrCode value={adminKey} size={140} />
              <div className="setup-key-value">{adminKey}</div>
            </div>
            <button className="btn btn-secondary setup-btn" onClick={copy}>{copied ? 'Copied ✓' : 'Copy key'}</button>
          </div>
        </>
      ) : <p className="setup-sub">Your admin key was shown earlier in this session — if you missed it, create a new admin key from Settings → Access → API Keys once you're in.</p>}
      <StepNav onNext={onGoToCalendar} nextLabel="Continue to calendar" />
    </div>
  )
}

function DoneStep({ deviceRole, adminKey, adminKeyId, onGoToCalendar }: { deviceRole: DeviceRole; adminKey: string | null; adminKeyId: string | null; onGoToCalendar: () => void }) {
  if (deviceRole === 'display') {
    return <DisplayDoneStep adminKey={adminKey} adminKeyId={adminKeyId} onGoToCalendar={onGoToCalendar} />
  }

  return (
    <div className="setup-step">
      <h1>All set! 🎉</h1>
      <p className="setup-sub">Now put Kinwall on your wall:</p>
      <ol className="setup-steps-list">
        <li>Open <strong>{location.origin}{location.pathname}</strong> in Safari on the wall iPad</li>
        <li>Tap Share → <strong>Add to Home Screen</strong></li>
        <li>Open it from the home screen — it'll show a pairing code / QR</li>
        <li>Scan that code with this phone, or enter it in Settings → Access → Add a display</li>
      </ol>
      <StepNav onNext={onGoToCalendar} nextLabel="Go to calendar" />
    </div>
  )
}

/** `setupCode` (e.g. handed over as `#key=…` by a hosting provider) skips the code-entry step. */
export default function Setup({ oauth, setupCode, passkeyRequired, onDone }: { oauth: { google: boolean; microsoft: boolean }; setupCode?: string; passkeyRequired?: boolean; onDone: () => void }) {
  const resume = useMemo(readSetupResume, [])
  const [step, setStep] = useState<Step>(resume?.step ?? (setupCode ? 'role' : 'welcome'))
  const [deviceRole, setDeviceRole] = useState<DeviceRole | null>(resume?.deviceRole ?? null)
  const [adminKey, setAdminKeyMem] = useState<string | null>(() => (resume ? getAdminKey() : null))
  const [adminKeyId, setAdminKeyId] = useState<string | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [code, setCode] = useState(setupCode ?? '')
  const [claimBusy, setClaimBusy] = useState(false)
  const [claimError, setClaimError] = useState('')

  // Once this device has a key (just claimed, or mid-wizard resume), pick up household theming
  // so the rest of the wizard - and the app it hands off to - looks consistent from the start.
  const [themeSettings, setThemeSettings] = useState<Settings | null>(null)
  useTheme(themeSettings)
  useEffect(() => { if (deviceRole) api.getSettings().then(setThemeSettings).catch(() => {}) }, [deviceRole, step])

  useEffect(() => {
    saveResume(deviceRole && step !== 'welcome' && step !== 'role' && step !== 'done' ? { step, deviceRole } : null)
  }, [step, deviceRole])

  // Resuming after an OAuth round trip: members created earlier this session are gone from local
  // state (page reloaded), so re-fetch them for the calendars/chores steps' member pickers.
  useEffect(() => { if (resume) api.getMembers().then(setMembers).catch(() => {}) }, [resume])

  const claim = async (role: DeviceRole) => {
    setClaimBusy(true); setClaimError('')
    try {
      const deviceName = role === 'display' ? 'Wall display' : 'My device'
      const res = await api.claimSetup(code, role, deviceName)
      setDeviceRole(role)
      setAdminKeyId(res.adminKeyId)
      if (role === 'display') {
        setKey(res.displayKey!)
        setAdminKey(res.adminKey)
        setAdminKeyMem(res.adminKey)
        setStep('household')
      } else {
        setKey(res.adminKey)
        setAdminKeyMem(res.adminKey)
        setStep(passkeysSupported() ? 'passkey' : 'household')
      }
    } catch (e) {
      setClaimError(e instanceof ApiError ? e.message : 'Could not claim this instance')
    } finally { setClaimBusy(false) }
  }

  // Each step's heading takes focus when the step changes (unless a field auto-focused), so a
  // screen reader announces the new step instead of silence after the old Next button vanished.
  const cardRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const card = cardRef.current
    if (!card || card.contains(document.activeElement)) return
    const h1 = card.querySelector<HTMLElement>('h1')
    if (h1) { h1.tabIndex = -1; h1.focus({ preventScroll: true }) }
  }, [step])

  const startOAuth = (kind: 'google' | 'microsoft') => {
    saveResume({ step: 'calendars', deviceRole: deviceRole ?? 'admin' })
    location.href = api.oauthStartUrl(kind)
  }

  return (
    <main className="setup-screen">
      <div className="setup-card" ref={cardRef}>
        <HelpButton className="help-float" />
        <Progress step={step} />
        {step === 'welcome' && <WelcomeStep code={code} setCode={setCode} onNext={() => setStep('role')} />}
        {step === 'role' && <RoleStep busy={claimBusy} error={claimError} onChoose={claim} />}
        {step === 'passkey' && <PasskeyStep adminKeyId={adminKeyId} onDone={() => setStep('recovery')} onSkip={passkeyRequired ? undefined : () => setStep('household')} />}
        {step === 'recovery' && <RecoveryStep onNext={() => setStep('household')} />}
        {step === 'household' && <HouseholdStep useAdmin={deviceRole === 'display'} onBack={() => setStep('role')} onNext={() => setStep('members')} />}
        {step === 'members' && (
          <MembersStep useAdmin={deviceRole === 'display'} onBack={() => setStep('household')} onNext={async () => { setMembers(await api.getMembers().catch(() => members)); setStep('calendars') }} />
        )}
        {step === 'calendars' && (
          <CalendarsStep members={members} oauth={oauth} deviceRole={deviceRole ?? 'admin'}
            onBack={() => setStep('members')} onNext={() => setStep('chores')}
            onOAuthStart={startOAuth} />
        )}
        {step === 'chores' && <ChoresStep members={members} onBack={() => setStep('calendars')} onNext={() => setStep('done')} />}
        {step === 'done' && <DoneStep deviceRole={deviceRole ?? 'admin'} adminKey={adminKey} adminKeyId={adminKeyId} onGoToCalendar={() => { saveResume(null); onDone() }} />}
      </div>
    </main>
  )
}
