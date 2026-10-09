import { useEffect, useMemo, useRef, useState } from 'react'
import { HelpButton } from './Help.tsx'
import { api, ApiError, setKey } from './api.ts'
import { clearOffline } from './outbox.ts'
import { QrCode } from './App.tsx'
import { CalendarCheckRow, initialPicks, RecoveryCodesView } from './Settings.tsx'
import TimezoneField from './TimezoneField.tsx'
import { announce } from './a11y.tsx'
import { MEMBER_EMOJI, MEMBER_PALETTE, nextPaletteColor } from './types.ts'
import type { Member, Settings } from './types.ts'
import { CheckIcon, PlusIcon, TrashIcon } from './icons.tsx'
import { setDeviceAppearance, useTheme } from './useTheme.ts'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isValidAvatar } from './emoji.ts'
import { colorName, inkFor } from './color.ts'
import { inFrame, passkeysSupported, registerPasskey } from './webauthn.ts'
import { connectCalendar, ProviderForm } from './ProviderConfig.tsx'
import type { Providers } from './types.ts'
import { MemberPicker } from './MemberPicker.tsx'
import { defaultGrownUp, freshHandoff, ownerChoices, resumeFor, setupErrorText } from './setupSteps.ts'
import type { SetupResume, Step } from './setupSteps.ts'
import './setup.css'
import { Brand } from './Brand.tsx'
import { ChipFace } from './Face'

const PROGRESS_STEPS: Step[] = ['household', 'members', 'calendars', 'chores', 'done']

// Persisted across the OAuth start->callback round trip (Google/Outlook connect from the
// Calendars step), which reloads the page. Only the step and role are stored, never a key.
const RESUME_KEY = 'kinwall.setupResume'
/** Wizard error copy: friendly words for the status, never the server's own text. */
const oops = (e: unknown, fallback: string) => setupErrorText(e instanceof ApiError ? e.status : undefined, fallback)
/** Calendar forms keep the reason a feed or provider was refused (a bad link, a rejected login). */
const calendarOops = (e: unknown, fallback: string) => e instanceof ApiError && (e.status === 400 || e.status === 502) ? e.message : oops(e, fallback)
// A new tab doesn't share sessionStorage, so the passkey step's "open in its own tab" hands its
// place over through localStorage once; the new tab picks it up and clears it. Never a key.
const HANDOFF_KEY = 'kinwall.setupHandoff'
export function readSetupResume(): SetupResume | null {
  try {
    const handoff = freshHandoff(localStorage.getItem(HANDOFF_KEY), Date.now())
    localStorage.removeItem(HANDOFF_KEY) // used once, or stale: either way gone
    if (handoff) sessionStorage.setItem(RESUME_KEY, JSON.stringify(handoff))
    const raw = sessionStorage.getItem(RESUME_KEY)
    return raw ? JSON.parse(raw) as SetupResume : null
  } catch { return null }
}
const handOffPasskeyStep = () => { try { localStorage.setItem(HANDOFF_KEY, JSON.stringify({ step: 'passkey', deviceRole: 'admin', at: Date.now() })) } catch { /* ignore */ } }
function saveResume(r: SetupResume | null) {
  try {
    if (r) sessionStorage.setItem(RESUME_KEY, JSON.stringify(r))
    else { sessionStorage.removeItem(RESUME_KEY); localStorage.removeItem(HANDOFF_KEY) } // setup done here: drop an unused handoff too
  } catch { /* ignore */ }
}
/** A new family claimed from this browser: drop everything it kept (all `kinwall.` keys) for an
 * earlier family at the same address, e.g. a reinstalled server. Otherwise its board layout,
 * "show only" member, locked view and filters carry over, some pointing at members that no longer
 * exist. Its offline cache and queued changes go too: a rejected key keeps the queue for the same
 * family, and the new key would otherwise send it to this one. Then tell open hooks the device's
 * settings are back to defaults. */
async function forgetEarlierFamily() {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith('kinwall.')) localStorage.removeItem(k) } catch { /* private mode */ }
  await clearOffline().catch(() => {})
  setDeviceAppearance({})
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
  const at = PROGRESS_STEPS.indexOf(step === 'owner' ? 'members' : step)
  if (at < 0) return null
  return (
    <div className="setup-progress" role="img" aria-label={`Step ${at + 1} of ${PROGRESS_STEPS.length}`}>
      {PROGRESS_STEPS.map((s, i) => <div key={s} className={`setup-dot ${i < at ? 'done' : ''} ${i === at ? 'active' : ''}`} />)}
    </div>
  )
}

function StepNav({ onBack, onNext, nextLabel = 'Next', nextDisabled, onSkip, sticky }: {
  onBack?: () => void; onNext?: () => void; nextLabel?: string; nextDisabled?: boolean; onSkip?: () => void
  sticky?: boolean // stays at the bottom of the card while a long step scrolls
}) {
  return (
    <div className={`setup-nav ${sticky ? 'setup-nav-sticky' : ''}`}>
      <div>{onBack && <button className="btn btn-secondary setup-btn" onClick={onBack}>Back</button>}</div>
      <div className="setup-nav-right">
        {onSkip && <button className="link-btn" onClick={onSkip}>Skip</button>}
        {onNext && <button className="btn btn-primary setup-btn" onClick={onNext} disabled={nextDisabled}>{nextLabel}</button>}
      </div>
    </div>
  )
}

/** Continue claims the instance for this device, which then makes the passkey: the device you
 * manage Kinwall from. Someone starting on the wall screen gets "start on your phone" instead: a QR
 * that opens setup there (with this code filled in, once typed: `#key=…`, see App.tsx
 * KeyLinkGate, which asks on the phone first). Once the phone claims, this screen reloads into the pairing screen. */
function WelcomeStep({ code, setCode, busy, error, onNext }: { code: string; setCode: (v: string) => void; busy: boolean; error: string; onNext: () => void }) {
  const [hint, setHint] = useState(false)
  const [wallFirst, setWallFirst] = useState(false)
  // The setup code is 6 digits; the server also accepts the ADMIN_API_KEY secret, which is long.
  const [useKey, setUseKey] = useState(false)
  // A hosting provider's setup link (#key=kw_…) fills in a key, not 6 digits: it's ready as it is.
  const linked = /\D/.test(code)
  const ready = useKey || linked ? code.length >= 6 : code.length === 6
  const switchMode = () => { setUseKey(k => !k); setCode('') }
  useEffect(() => {
    if (!wallFirst) return
    const id = setInterval(() => { api.getSetup().then(s => { if (s.claimed) location.reload() }).catch(() => {}) }, SETUP_PASSKEY_POLL_MS)
    return () => clearInterval(id)
  }, [wallFirst])

  if (wallFirst) {
    const withCode = !useKey && code.length === 6
    const qrValue = new URL(withCode ? `#key=${code}` : '', document.baseURI).href
    return (
      <div className="setup-step">
        <h1>Start on your phone</h1>
        <p className="setup-sub">Your phone holds the passkey that manages Kinwall, so set it up first. Scan this with your phone's camera to open Kinwall{withCode ? ' with the code already filled in' : ''}.</p>
        <div className="setup-key-row setup-qr-center"><QrCode value={qrValue} size={168} /></div>
        <p className="settings-row-sub">No camera? Go to <strong>{new URL(document.baseURI).host}</strong> on your phone{withCode ? <> and enter <strong>{code.slice(0, 3)} {code.slice(3)}</strong></> : ' and enter the setup code'}.</p>
        <ol className="setup-steps-list">
          <li>On your phone, finish setup and create your passkey.</li>
          <li>This screen then shows a pairing code. On your phone, open Settings → Access → Add a wall screen or kid's device and enter it.</li>
        </ol>
        <p className="settings-row-sub">Waiting for your phone…</p>
        <button className="link-btn" onClick={() => setWallFirst(false)}>Back</button>
      </div>
    )
  }

  return (
    <div className="setup-step">
      <h1>Welcome to Kinwall 👋</h1>
      <p className="setup-sub">
        {useKey ? 'Enter the ADMIN_API_KEY you set on the server.' : linked ? "Let's get your family wall set up. Your setup link filled in the code, so tap Continue to begin." : "Let's get your family wall set up. Enter the setup code from your server log to begin."}
      </p>
      <label className="setup-input-label" htmlFor="setup-code">{useKey ? 'Admin API key' : 'Setup code'}</label>
      {useKey ? (
        <input
          id="setup-code"
          className="setup-key-input"
          type="password" autoComplete="off" autoCapitalize="off" spellCheck={false} autoFocus
          value={code} onChange={e => setCode(e.target.value.trim())}
          onKeyDown={e => e.key === 'Enter' && ready && !busy && onNext()}
          placeholder="ADMIN_API_KEY"
        />
      ) : (
        <input
          id="setup-code"
          className="setup-code-input"
          type="text" inputMode="numeric" pattern="[0-9]*" autoFocus
          value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          onKeyDown={e => e.key === 'Enter' && ready && !busy && onNext()}
          placeholder="000 000"
        />
      )}
      <button className="link-btn setup-hint-toggle" onClick={switchMode}>
        {useKey ? 'Use a 6-digit setup code instead' : 'Use your ADMIN_API_KEY instead'}
      </button>
      {!useKey && !linked && <button className="link-btn setup-hint-toggle" onClick={() => setHint(h => !h)} aria-expanded={hint}>Where do I find this?</button>}
      {hint && !useKey && (
        <div className="setup-hint-box">
          <p><strong>Docker:</strong> <code>docker logs kinwall</code></p>
          <p><strong>Home Assistant:</strong> Settings → Apps → Kinwall → Log (Add-ons in older versions)</p>
          <p><strong>Cloudflare Workers:</strong> the Worker's logs, or use your <code>ADMIN_API_KEY</code> secret instead</p>
        </div>
      )}
      {error && <p className="setup-error" role="alert">{error}</p>}
      <StepNav onNext={onNext} nextDisabled={!ready || busy} nextLabel={busy ? 'Starting…' : 'Continue'} />
      <button className="link-btn setup-hint-toggle" onClick={() => setWallFirst(true)}>Setting up the wall screen? Start on your phone</button>
    </div>
  )
}

/** No Skip: without a passkey this device's admin key is the only way back in. A browser that
 * can't make one gets `onNoPasskey` after a failed try (recovery codes instead), unless the host
 * requires a passkey. */
function PasskeyStep({ adminKeyId, onDone, onNoPasskey }: { adminKeyId: string | null; onDone: () => void; onNoPasskey?: () => void }) {
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
      setError(e instanceof ApiError ? oops(e, 'Could not create the passkey. Try again.') : e instanceof Error ? e.message : 'Could not create the passkey. Try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setup-step">
      <h1>Create a passkey for this device</h1>
      <p className="setup-sub">Kinwall signs you in with Face ID, Touch ID or your device's screen lock. It's how you get back into your family.</p>
      <div className="field"><label>Name this passkey</label><input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
      {inFrame() && <p className="setup-sub">Inside Home Assistant's panel, some browsers won't make a passkey. <a className="text-link" href={location.href} target="_blank" rel="noopener" onClick={handOffPasskeyStep}>Open Kinwall in its own tab</a> and finish setup there.</p>}
      {error && <p className="setup-error" role="alert">{error}</p>}
      <StepNav onNext={() => create()} nextDisabled={busy || !name.trim()} nextLabel={busy ? 'Creating…' : 'Create passkey'} />
      <button className="link-btn" style={{ minHeight: 44, display: 'block', marginLeft: 'auto' }} disabled={busy || !name.trim()} onClick={() => create('cross-platform')}>
        Use a security key or another device
      </button>
      {error && onNoPasskey && (
        <button className="link-btn" style={{ minHeight: 44, display: 'block', marginLeft: 'auto' }} disabled={busy} onClick={onNoPasskey}>
          Can't make a passkey here? Use recovery codes instead
        </button>
      )}
    </div>
  )
}

/** Right after the passkey step: a set of one-time recovery codes, the way back in if that
 * device is lost. Skippable - Settings → Access nudges until there's a second way in. */
/** `required`: this device has no passkey, so the codes are the only way back in: no Skip, unless
 * they couldn't be made. */
function RecoveryStep({ required, onNext }: { required?: boolean; onNext: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const generated = useRef(false)
  useEffect(() => {
    if (generated.current) return // StrictMode double-mount would otherwise replace the set
    generated.current = true
    api.generateRecoveryCodes().then(r => setCodes(r.codes)).catch(e => setError(oops(e, 'Could not create recovery codes. You can make them later in Settings → Access.')))
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
      {(!required || error) && <button className="link-btn" style={{ minHeight: 44, display: 'block', marginLeft: 'auto' }} onClick={onNext}>Skip for now</button>}
    </div>
  )
}

function HouseholdStep({ onNext }: { onNext: () => void }) {
  const [familyName, setFamilyName] = useState('Our Family')
  // A host may have set the name before the wizard runs (hosted signup asks for it); keep it.
  useEffect(() => { api.getSettings().then(s => { if (s.familyName && s.familyName !== 'Our Family') setFamilyName(s.familyName) }).catch(() => {}) }, [])
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [weekStart, setWeekStart] = useState<0 | 1>(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setBusy(true); setError('')
    try {
      await api.updateSettings({ familyName: familyName.trim() || 'Our Family', timezone, weekStart })
      onNext()
    } catch (e) { setError(oops(e, 'Could not save. Try again.')) } finally { setBusy(false) }
  }

  return (
    <div className="setup-step">
      <h1>Your household</h1>
      <div className="field"><label>Family name</label><input type="text" value={familyName} onChange={e => setFamilyName(e.target.value)} autoFocus /></div>
      <div className="field">
        <label htmlFor="setup-timezone">Timezone</label>
        <TimezoneField id="setup-timezone" value={timezone} onChange={setTimezone} />
      </div>
      <div className="field">
        <label>Week starts on</label>
        <div className="setup-choice-row">
          <button className={`setup-choice ${weekStart === 0 ? 'active' : ''}`} aria-pressed={weekStart === 0} onClick={() => setWeekStart(0)}>Sunday</button>
          <button className={`setup-choice ${weekStart === 1 ? 'active' : ''}`} aria-pressed={weekStart === 1} onClick={() => setWeekStart(1)}>Monday</button>
        </div>
      </div>
      {error && <p className="setup-error" role="alert">{error}</p>}
      {/* No Back: the device is claimed now, and the role step can't be done twice. */}
      <StepNav onNext={save} nextDisabled={busy} nextLabel={busy ? 'Saving…' : 'Next'} />
    </div>
  )
}

function MembersStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [members, setMembers] = useState<Member[]>([])
  const [name, setName] = useState('')
  const [color, setColor] = useState(MEMBER_PALETTE[0])
  const [avatar, setAvatar] = useState(MEMBER_EMOJI[0])
  const [grownUp, setGrownUp] = useState(defaultGrownUp(0))
  const [error, setError] = useState('')
  const nameRef = useRef<HTMLInputElement>(null)
  // Ready for the next person: their color, avatar and grown-up/kid default.
  const resetFor = (list: Member[]) => {
    setColor(nextPaletteColor(list.map(x => x.color)))
    setAvatar(MEMBER_EMOJI[list.length % MEMBER_EMOJI.length])
    setGrownUp(defaultGrownUp(list.length))
  }
  // Coming back to this step (Back from calendars, or a resumed setup): show who's already been added,
  // so they aren't lost from view or added twice.
  useEffect(() => {
    let live = true
    api.getMembers().then(list => {
      if (!live || !list.length) return
      // Merge, in case someone was added while this loaded.
      setMembers(cur => [...list, ...cur.filter(m => !list.some(x => x.id === m.id))])
      if (!name.trim()) resetFor(list)
    }).catch(() => {})
    return () => { live = false }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /** Adds the typed member; resolves whether it was added. */
  const add = async (): Promise<boolean> => {
    if (!name.trim()) return false
    if (!isValidAvatar(avatar)) { setError('Pick an avatar first.'); return false }
    setError('')
    try {
      const m = await api.createMember({ name: name.trim(), color, avatar, grownUp })
      const list = [...members, m]
      setMembers(list)
      setName('')
      resetFor(list)
      nameRef.current?.focus()
      return true
    } catch (e) { setError(oops(e, `Could not add ${name.trim()}. Try again.`)); return false }
  }
  // A typed-but-not-added name is added on Next rather than dropped.
  const next = async () => { if (!name.trim() || await add()) onNext() }
  const remove = async (id: string) => {
    try { await api.deleteMember(id); setMembers(ms => ms.filter(m => m.id !== id)) }
    catch (e) { setError(oops(e, 'Could not remove them. Try again.')) }
  }
  const setKind = async (m: Member, grown: boolean) => {
    try { const u = await api.updateMember(m.id, { grownUp: grown }); setMembers(ms => ms.map(x => x.id === m.id ? { ...x, grownUp: u.grownUp } : x)) }
    catch (e) { setError(oops(e, `Could not change ${m.name}. Try again.`)) }
  }

  return (
    <div className="setup-step">
      <h1>Who's in the family?</h1>
      <p className="setup-sub">Add everyone who'll show up on the wall.</p>
      {/* Above the form, so everyone added stays in view as the list grows. */}
      {members.length > 0 && (
        <div className="member-row-list setup-member-list">
          {members.map(m => (
            <div key={m.id} className="member-list-item">
              <div className="member-avatar-sm" style={{ background: m.color, color: inkFor(m.color) }}>{m.avatar}</div>
              <div className="name">{m.name}</div>
              <select className="settings-select setup-kind-select" value={m.grownUp ? 'grown' : 'kid'} aria-label={`${m.name}: grown-up or kid`}
                onChange={e => setKind(m, e.target.value === 'grown')}>
                <option value="grown">🧑 Grown-up</option>
                <option value="kid">🧒 Kid</option>
              </select>
              <button className="icon-btn" onClick={() => remove(m.id)} aria-label={`Remove ${m.name}`}><TrashIcon width={16} height={16} /></button>
            </div>
          ))}
        </div>
      )}
      <div className="field"><label>{members.length ? 'Next person' : 'Name'}</label>
        <input ref={nameRef} type="text" value={name} onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && add()} placeholder="e.g. Sam" autoFocus />
      </div>
      <div className="field">
        <label id="setup-grown-label">Grown-up or kid?</label>
        <div className="setup-choice-row" role="group" aria-labelledby="setup-grown-label">
          <button className={`setup-choice ${grownUp ? 'active' : ''}`} aria-pressed={grownUp} onClick={() => setGrownUp(true)}>🧑 Grown-up</button>
          <button className={`setup-choice ${grownUp ? '' : 'active'}`} aria-pressed={!grownUp} onClick={() => setGrownUp(false)}>🧒 Kid</button>
        </div>
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
      <StepNav sticky onBack={onBack} onNext={next} nextDisabled={members.length === 0 && !name.trim()} />
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
    } catch (e) { setError(calendarOops(e, 'Could not add the calendar. Try again.')) } finally { setBusy(false) }
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
    } catch (e) { setError(calendarOops(e, 'Could not connect. Try again.')) } finally { setBusy(false) }
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
        const msg = calendarOops(e, 'Could not add the calendar. Try again.')
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

function CalendarsStep({ members, oauth, onNext, onBack, onOAuthStart }: {
  members: Member[]; oauth: { google: boolean; microsoft: boolean }
  onNext: () => void; onBack: () => void; onOAuthStart: (kind: 'google' | 'microsoft', say: (m: string) => void) => void
}) {
  const [open, setOpen] = useState<'google' | 'microsoft' | 'icloud' | 'ics' | null>(null)
  const [providers, setProviders] = useState<Providers | null>(null)
  const [providerMsg, setProviderMsg] = useState<string | null>(null)
  const [pending, setPending] = useState<PendingAdd | null>(null)
  const next = async () => { if (!pending || await pending.commit()) onNext() }
  const loadProviders = () => { api.getProviders().then(setProviders).catch(() => {}) }
  useEffect(loadProviders, [])

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
        <div className="setup-provider-form"><button className="btn btn-primary setup-btn" onClick={() => onOAuthStart('google', setProviderMsg)}>Connect Google</button></div>
      ) : providers && <ProviderForm kind="google" providers={providers} toast={setProviderMsg} onChanged={loadProviders} />)}

      {open === 'microsoft' && (oauth.microsoft ? (
        <div className="setup-provider-form"><button className="btn btn-primary setup-btn" onClick={() => onOAuthStart('microsoft', setProviderMsg)}>Connect Outlook</button></div>
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
    } catch (e) { setError(oops(e, 'Could not create the chores. Try again, or skip and add them later in Chores.')) } finally { setBusy(false) }
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
                  <button key={m.id} className={`chip ${selected[i] === m.id ? 'active' : ''}`} aria-pressed={selected[i] === m.id} onClick={() => setSelected(s => ({ ...s, [i]: m.id }))}><ChipFace m={m} /> {m.name}</button>
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
const SHARED = '__shared' // the owner step's "Shared (the whole family)": no owner

/** A parent's device, once the family's in: whose it is (PUT /api/me/owner, on its passkey or key),
 * so it reads their private journal right away. Only a grown-up owns one, so only grown-ups (marked
 * on the members step) are offered, and no kid is ever turned into one. Shared leaves it unowned. */
function OwnerStep({ members, onNext, onBack }: { members: Member[]; onNext: () => void; onBack: () => void }) {
  const grownUps = ownerChoices(members)
  const [pick, setPick] = useState<string | null>(null) // a grown-up's id, or SHARED
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const save = async () => {
    if (!pick) return
    if (pick === SHARED) { onNext(); return }
    setBusy(true); setError('')
    try {
      await api.setMyOwner(pick)
      onNext()
    } catch (e) { setError(oops(e, 'Could not save. Try again, or pick Shared and set it later in Settings → Access.')) } finally { setBusy(false) }
  }
  return (
    <div className="setup-step">
      <h1>Whose device is this?</h1>
      <p className="setup-sub">{grownUps.length ? 'Pick yourself if this is your own phone or tablet, so it opens your private journal. Pick Shared for a wall screen or a family tablet.'
        : 'Only a grown-up can own this device, and no one is marked a grown-up yet. Go Back to mark yourself, or pick Shared.'}</p>
      <div className="setup-choice-row setup-choice-wrap" role="group" aria-label="Whose device this is">
        {grownUps.map(m => (
          <button key={m.id} className={`setup-choice ${pick === m.id ? 'active' : ''}`} aria-pressed={pick === m.id} onClick={() => setPick(m.id)}><ChipFace m={m} /> {m.name}</button>
        ))}
        <button className={`setup-choice ${pick === SHARED ? 'active' : ''}`} aria-pressed={pick === SHARED} onClick={() => setPick(SHARED)}><span aria-hidden="true">🏠</span> Shared (the whole family)</button>
      </div>
      {error && <p className="setup-error" role="alert">{error}</p>}
      <StepNav onBack={onBack} onNext={save} nextDisabled={busy || !pick} nextLabel={busy ? 'Saving…' : 'Next'} />
    </div>
  )
}

function DoneStep({ onGoToCalendar }: { onGoToCalendar: () => void }) {
  return (
    <div className="setup-step">
      <h1>All set! 🎉</h1>
      <p className="setup-sub">Now put Kinwall on your wall:</p>
      <ol className="setup-steps-list">
        <li>Open <strong>{location.origin}{location.pathname}</strong> in the browser on the wall tablet or screen</li>
        <li>Add it to the home screen (on an iPad: Share → <strong>Add to Home Screen</strong>)</li>
        <li>Open it from the home screen — it'll show a pairing code / QR</li>
        <li>Scan that code with this phone, or enter it in Settings → Access → Add a wall screen or kid's device</li>
      </ol>
      <StepNav onNext={onGoToCalendar} nextLabel="Go to calendar" />
    </div>
  )
}

/** `setupCode` (handed over as `#key=…` by a hosting provider, or the wall screen's QR) fills in the code. */
export default function Setup({ oauth, setupCode, passkeyRequired, onDone }: { oauth: { google: boolean; microsoft: boolean }; setupCode?: string; passkeyRequired?: boolean; onDone: () => void }) {
  const resume = useMemo(readSetupResume, [])
  const [step, setStep] = useState<Step>(resume?.step ?? 'welcome')
  const [claimed, setClaimed] = useState(!!resume)
  const [adminKeyId, setAdminKeyId] = useState<string | null>(null)
  // No passkey on this device (none possible, or the browser couldn't make one): recovery codes required.
  const [noPasskey, setNoPasskey] = useState(false)
  const [members, setMembers] = useState<Member[]>([])
  const [code, setCode] = useState(setupCode ?? '')
  const [claimBusy, setClaimBusy] = useState(false)
  const [claimError, setClaimError] = useState('')

  // Once this device has a key (just claimed, or mid-wizard resume), pick up household theming
  // so the rest of the wizard - and the app it hands off to - looks consistent from the start.
  const [themeSettings, setThemeSettings] = useState<Settings | null>(null)
  useTheme(themeSettings)
  useEffect(() => { if (claimed) api.getSettings().then(setThemeSettings).catch(() => {}) }, [claimed, step])

  useEffect(() => { saveResume(resumeFor(step, claimed ? 'admin' : null)) }, [step, claimed])

  // Resuming after an OAuth round trip: members created earlier this session are gone from local
  // state (page reloaded), so re-fetch them for the calendars/chores steps' member pickers.
  useEffect(() => { if (resume) api.getMembers().then(setMembers).catch(() => {}) }, [resume])

  const claim = async () => {
    setClaimBusy(true); setClaimError('')
    try {
      const res = await api.claimSetup(code, 'admin', 'My device')
      await forgetEarlierFamily()
      setClaimed(true)
      setAdminKeyId(res.adminKeyId)
      setKey(res.adminKey)
      if (passkeysSupported()) setStep('passkey')
      else { setNoPasskey(true); setStep('recovery') }
    } catch (e) {
      // A wrong code goes back to the code; anything else stays here with friendly words.
      if (e instanceof ApiError && e.status === 401) { setClaimError("That code didn't work. Check it and try again."); setStep('welcome') }
      else setClaimError(oops(e, 'Could not start setup. Try again.'))
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

  const startOAuth = (kind: 'google' | 'microsoft', say: (m: string) => void) => {
    saveResume({ step: 'calendars', deviceRole: 'admin' })
    connectCalendar(kind, say)
  }

  return (
    <main className="setup-screen">
      <div className="setup-card" ref={cardRef}>
        <HelpButton className="help-float" />
        <Brand />
        <Progress step={step} />
        {step === 'welcome' && <WelcomeStep code={code} setCode={v => { setCode(v); setClaimError('') }} busy={claimBusy} error={claimError} onNext={claim} />}
        {step === 'passkey' && <PasskeyStep adminKeyId={adminKeyId} onDone={() => setStep('recovery')} onNoPasskey={passkeyRequired ? undefined : () => { setNoPasskey(true); setStep('recovery') }} />}
        {step === 'recovery' && <RecoveryStep required={noPasskey} onNext={() => setStep('household')} />}
        {step === 'household' && <HouseholdStep onNext={() => setStep('members')} />}
        {step === 'members' && (
          <MembersStep onBack={() => setStep('household')} onNext={async () => { setMembers(await api.getMembers().catch(() => members)); setStep('owner') }} />
        )}
        {step === 'owner' && <OwnerStep members={members} onBack={() => setStep('members')} onNext={async () => { setMembers(await api.getMembers().catch(() => members)); setStep('calendars') }} />}
        {step === 'calendars' && (
          <CalendarsStep members={members} oauth={oauth} onBack={() => setStep('owner')} onNext={() => setStep('chores')} onOAuthStart={startOAuth} />
        )}
        {step === 'chores' && <ChoresStep members={members} onBack={() => setStep('calendars')} onNext={() => setStep('done')} />}
        {step === 'done' && <DoneStep onGoToCalendar={() => { saveResume(null); onDone() }} />}
      </div>
    </main>
  )
}
