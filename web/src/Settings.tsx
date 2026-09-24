import { useEffect, useMemo, useState } from 'react'
import { useApp } from './AppContext.tsx'
import { api, ApiError, clearKey } from './api.ts'
import type { Account, ApiKey, CalendarEntry, Density, Me, Member, Passkey, RemoteCalendar, Settings, TextScale, ThemeMode, Webhook } from './types.ts'
import { ACCENT_PRESETS, BACKGROUND_DARK_PRESETS, BACKGROUND_LIGHT_PRESETS, MEMBER_EMOJI, MEMBER_PALETTE, nextPaletteColor } from './types.ts'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isValidAvatar } from './emoji.ts'
import { inkFor } from './color.ts'
import { KeyIcon, LinkIcon, MonitorIcon, PaletteIcon, PlusIcon, TrashIcon, WebhookIcon } from './icons.tsx'
import { useIsPhone } from './useIsPhone.ts'
import { useNavMode, setNavPref, type NavPref } from './useNavMode.ts'
import { passkeysSupported, registerPasskey } from './webauthn.ts'
import { QrCode } from './App.tsx'

const BUS_EVENTS = ['member.changed', 'calendar.changed', 'calendar.synced', 'events.changed', 'chore.changed', 'chore.completed', 'chore.uncompleted', 'settings.changed']

export function timezoneList() {
  // Intl.supportedValuesOf('timeZone') doesn't include 'UTC' itself (the server's default
  // settings.timezone), which left the <select> silently showing the wrong zone. Prepend it.
  try {
    return ['UTC', ...Intl.supportedValuesOf('timeZone')]
  } catch {
    return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin']
  }
}

export default function SettingsView() {
  const { settings, members, toast, reloadCore } = useApp()
  const [openAccountId, setOpenAccountId] = useState<string | null>(null)
  // Fails CLOSED to the display-only view until /api/me answers — a display key must never see
  // admin sections, even briefly, if the check is slow or fails.
  const [me, setMe] = useState<Me>({ scope: 'display', keyName: '', kind: 'api' })

  useEffect(() => {
    const q = new URLSearchParams(location.hash.split('?')[1] || '')
    const account = q.get('account')
    if (account) setOpenAccountId(account)
  }, [])

  useEffect(() => { api.meStrict().then(setMe).catch(() => setMe({ scope: 'display', keyName: '', kind: 'api' })) }, [])

  if (me.scope === 'display') {
    return (
      <div className="content scroll-y">
        <div className="settings-scroll">
          <ThisDisplaySection keyName={me.keyName} />
        </div>
      </div>
    )
  }

  return (
    <div className="content scroll-y">
      <div className="settings-scroll">
        <GeneralSection settings={settings} onSaved={reloadCore} toast={toast} />
        <AppearanceSection settings={settings} onSaved={reloadCore} toast={toast} />
        <ThisDisplaySection />
        <MembersSection members={members} onChanged={reloadCore} toast={toast} />
        <CalendarsSection openAccountId={openAccountId} onOpenedAccount={() => setOpenAccountId(null)} toast={toast} />
        <DisplaysSection toast={toast} />
        <PasskeysSection me={me} toast={toast} />
        <KeysSection toast={toast} />
        <WebhooksSection toast={toast} />
      </div>
    </div>
  )
}

function Section({ title, icon, children }: { title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <div className="settings-section-title">{icon}{title}</div>
      {children}
    </div>
  )
}

function GeneralSection({ settings, onSaved, toast }: { settings: ReturnType<typeof useApp>['settings']; onSaved: () => void; toast: (m: string) => void }) {
  const tzs = useMemo(timezoneList, [])
  const save = async (patch: Partial<typeof settings>) => {
    try { await api.updateSettings(patch); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings') }
  }
  return (
    <Section title="Household">
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Family name</div>
        </div>
        <input type="text" className="family-name-input" defaultValue={settings.familyName} onBlur={e => e.target.value !== settings.familyName && save({ familyName: e.target.value })} />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">Timezone</div>
        <select className="settings-select" value={settings.timezone ?? ''} onChange={e => save({ timezone: e.target.value })}>
          {tzs.map(tz => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">Week starts on</div>
        <select className="settings-select" value={settings.weekStart} onChange={e => save({ weekStart: Number(e.target.value) as 0 | 1 })}>
          <option value={0}>Sunday</option>
          <option value={1}>Monday</option>
        </select>
      </div>
    </Section>
  )
}

const THEME_MODES: { key: ThemeMode; label: string }[] = [
  { key: 'light', label: 'Light' }, { key: 'dark', label: 'Dark' }, { key: 'auto', label: 'Auto' }, { key: 'scheduled', label: 'Scheduled' },
]
const TEXT_SCALES: { key: TextScale; label: string }[] = [
  { key: 's', label: 'S' }, { key: 'm', label: 'M' }, { key: 'l', label: 'L' }, { key: 'xl', label: 'XL' },
]
const DENSITIES: { key: Density; label: string }[] = [
  { key: 'comfortable', label: 'Comfortable' }, { key: 'compact', label: 'Compact' },
]

function AppearanceSection({ settings, onSaved, toast }: { settings: Settings; onSaved: () => void; toast: (m: string) => void }) {
  const save = async (patch: Partial<Settings>) => {
    try { await api.updateSettings(patch); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings') }
  }
  return (
    <Section title="Appearance" icon={<PaletteIcon width={16} height={16} />}>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="settings-row-label">Mode</div>
        <div className="segmented">
          {THEME_MODES.map(o => <button key={o.key} className={settings.themeMode === o.key ? 'active' : ''} onClick={() => save({ themeMode: o.key })}>{o.label}</button>)}
        </div>
        {settings.themeMode === 'scheduled' && (
          <div className="row-2" style={{ marginTop: 4 }}>
            <div className="field" style={{ margin: 0 }}><label>Dark from</label><input type="time" value={settings.darkFrom} onChange={e => save({ darkFrom: e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}><label>Dark to</label><input type="time" value={settings.darkTo} onChange={e => save({ darkTo: e.target.value })} /></div>
          </div>
        )}
      </div>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="settings-row-label">Accent color</div>
        <div className="color-swatch-row">
          {ACCENT_PRESETS.map(c => <button key={c} className={`color-swatch ${settings.accent === c ? 'active' : ''}`} style={{ background: c }} onClick={() => save({ accent: c })} />)}
          <input type="color" className="color-swatch" value={/^#[0-9a-f]{6}$/i.test(settings.accent) ? settings.accent : '#888888'}
            onChange={e => save({ accent: e.target.value })} style={{ padding: 0, border: '2px solid var(--border)', cursor: 'pointer' }} aria-label="Custom accent color" />
        </div>
      </div>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="settings-row-label">Light background</div>
        <div className="chip-row">
          {BACKGROUND_LIGHT_PRESETS.map(o => (
            <button key={o.key} className={`chip ${settings.backgroundLight === o.key ? 'active' : ''}`} onClick={() => save({ backgroundLight: o.key })}>
              <span className="bg-preview-dot" style={{ background: o.preview }} />{o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="settings-row-label">Dark background</div>
        <div className="chip-row">
          {BACKGROUND_DARK_PRESETS.map(o => (
            <button key={o.key} className={`chip ${settings.backgroundDark === o.key ? 'active' : ''}`} onClick={() => save({ backgroundDark: o.key })}>
              <span className="bg-preview-dot" style={{ background: o.preview }} />{o.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">Text size</div>
        <div className="segmented">
          {TEXT_SCALES.map(o => <button key={o.key} className={settings.textScale === o.key ? 'active' : ''} onClick={() => save({ textScale: o.key })}>{o.label}</button>)}
        </div>
      </div>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="settings-row-label">Density</div>
        <div className="segmented">
          {DENSITIES.map(o => <button key={o.key} className={settings.density === o.key ? 'active' : ''} onClick={() => save({ density: o.key })}>{o.label}</button>)}
        </div>
        <div className="settings-row-sub">Compact tightens spacing and fits more on screen — handy for a smaller display.</div>
      </div>
    </Section>
  )
}

const NAV_PREF_OPTIONS: { key: NavPref; label: string }[] = [
  { key: 'auto', label: 'Auto' }, { key: 'bottom', label: 'Bottom' }, { key: 'left', label: 'Left' }, { key: 'right', label: 'Right' },
]

/** Per-device nav position (bottom tab bar vs. a side rail) — kept in localStorage, not synced
 * settings, so each wall display / phone / tablet can pick its own. When `keyName` is passed
 * (display-scoped key), this is the ONLY Settings section a display ever sees — it also shows
 * what this display is paired as and an unpair action. */
function ThisDisplaySection({ keyName }: { keyName?: string }) {
  const isPhone = useIsPhone()
  const { pref } = useNavMode()
  const unpair = () => {
    if (!confirm('Unpair this display? You\'ll need to pair it again from an admin device to use it here.')) return
    clearKey()
    location.reload()
  }
  return (
    <Section title="This display" icon={<MonitorIcon width={16} height={16} />}>
      {keyName !== undefined && (
        <div className="settings-row">
          <div className="settings-row-label">Paired as {keyName || 'this display'}</div>
        </div>
      )}
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="settings-row-label">Navigation position</div>
        <div className="segmented" style={isPhone ? { opacity: 0.5 } : undefined}>
          {NAV_PREF_OPTIONS.map(o => (
            <button key={o.key} className={pref === o.key ? 'active' : ''} disabled={isPhone} onClick={() => setNavPref(o.key)}>{o.label}</button>
          ))}
        </div>
        <div className="settings-row-sub">{isPhone ? 'Phones always use the bottom bar.' : 'Saved on this device only.'}</div>
      </div>
      {keyName !== undefined && (
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <button className="btn btn-danger" onClick={unpair}>Unpair this display</button>
          <div className="settings-row-sub">Clears the key stored on this device and returns to the pairing screen. This doesn't revoke the key — do that from an admin device under Settings → Displays.</div>
        </div>
      )}
    </Section>
  )
}

function MembersSection({ members, onChanged, toast }: { members: Member[]; onChanged: () => void; toast: (m: string) => void }) {
  const [edit, setEdit] = useState<Member | 'new' | null>(null)
  return (
    <Section title="Members">
      <div className="member-row-list">
        {members.map(m => (
          <div key={m.id} className="member-list-item" onClick={() => setEdit(m)}>
            <div className="member-avatar-sm" style={{ background: m.color, color: inkFor(m.color) }}>{m.avatar}</div>
            <div className="name">{m.name}</div>
          </div>
        ))}
        <button className="add-row-btn" onClick={() => setEdit('new')}><PlusIcon width={20} height={20} />Add member</button>
      </div>
      {edit && (
        <MemberEditSheet member={edit === 'new' ? null : edit} onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); onChanged() }} toast={toast} />
      )}
    </Section>
  )
}

function MemberEditSheet({ member, onClose, onSaved, toast }: { member: Member | null; onClose: () => void; onSaved: () => void; toast: (m: string) => void }) {
  const [name, setName] = useState(member?.name ?? '')
  const [color, setColor] = useState(member?.color ?? MEMBER_PALETTE[0])
  const [avatar, setAvatar] = useState(member?.avatar ?? MEMBER_EMOJI[0])
  const save = async () => {
    if (!name.trim() || !isValidAvatar(avatar)) return
    try {
      if (member) await api.updateMember(member.id, { name: name.trim(), color, avatar })
      else await api.createMember({ name: name.trim(), color, avatar })
      onSaved()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save member') }
  }
  const del = async () => {
    if (!member) return
    try { await api.deleteMember(member.id); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete member') }
  }
  return (
    <Sheet title={member ? 'Edit member' : 'Add member'} onClose={onClose}
      actions={<>{member && <button className="btn btn-danger" onClick={del}><TrashIcon width={18} height={18} /></button>}<button className="btn btn-primary" onClick={save} disabled={!name.trim() || !isValidAvatar(avatar)}>Save</button></>}>
      <div className="field"><label>Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
      <div className="field">
        <label>Color</label>
        <div className="color-swatch-row">
          {MEMBER_PALETTE.map(c => <button key={c} className={`color-swatch ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />)}
          <input type="color" className="color-swatch" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#888888'}
            onChange={e => setColor(e.target.value)} style={{ padding: 0, border: '2px solid var(--border)', cursor: 'pointer' }} aria-label="Custom member color" />
        </div>
      </div>
      <div className="field">
        <label>Avatar</label>
        <div className="emoji-swatch-row">
          {MEMBER_EMOJI.map(e => <button key={e} className={`emoji-swatch ${avatar === e ? 'active' : ''}`} onClick={() => setAvatar(e)}>{e}</button>)}
        </div>
        <AnyEmojiField value={avatar} onChange={setAvatar} allowInitials />
      </div>
    </Sheet>
  )
}

function CalendarsSection({ openAccountId, onOpenedAccount, toast }: { openAccountId: string | null; onOpenedAccount: () => void; toast: (m: string) => void }) {
  const [calendars, setCalendars] = useState<CalendarEntry[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [localSheet, setLocalSheet] = useState(false)
  const [icsSheet, setIcsSheet] = useState(false)
  const [caldavSheet, setCaldavSheet] = useState(false)
  const [pickerAccountId, setPickerAccountId] = useState<string | null>(null)

  const load = () => { api.getCalendars().then(setCalendars).catch(() => {}); api.getAccounts().then(setAccounts).catch(() => {}) }
  useEffect(load, [])
  useEffect(() => { if (openAccountId) { setPickerAccountId(openAccountId); onOpenedAccount() } }, [openAccountId, onOpenedAccount])

  const sync = async (id: string) => {
    try { await api.syncCalendar(id); load(); toast('Synced') } catch (e) { toast(e instanceof ApiError ? e.message : 'Sync failed') }
  }
  const remove = async (id: string) => {
    try { await api.deleteCalendar(id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not remove calendar') }
  }

  return (
    <Section title="Calendars" icon={<LinkIcon width={16} height={16} />}>
      {calendars.map(c => (
        <div key={c.id} className="cal-list-item">
          <div className="cal-list-top">
            <div className="cal-dot" style={{ background: c.color ?? '#888' }} />
            <div className="cal-name">{c.name}</div>
            <div className="cal-kind-badge">{c.kind}</div>
          </div>
          <div className={`cal-sub ${c.lastError ? 'error' : ''}`}>
            {c.lastError ? c.lastError : c.kind === 'local' ? 'Local calendar' : c.lastSyncedAt ? `Synced ${new Date(c.lastSyncedAt).toLocaleString()}` : 'Never synced'}
          </div>
          <div className="cal-actions">
            {c.kind !== 'local' && <button className="link-btn" onClick={() => sync(c.id)}>Sync now</button>}
            <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={() => remove(c.id)}>Remove</button>
          </div>
        </div>
      ))}
      <div className="connect-buttons" style={{ marginTop: 14 }}>
        <button className="connect-btn" onClick={() => setLocalSheet(true)}>+ Local calendar</button>
        <button className="connect-btn" onClick={() => setIcsSheet(true)}>+ ICS URL</button>
        <button className="connect-btn" onClick={() => location.href = api.oauthStartUrl('google')}>Connect Google</button>
        <button className="connect-btn" onClick={() => location.href = api.oauthStartUrl('microsoft')}>Connect Outlook</button>
        <button className="connect-btn" onClick={() => setCaldavSheet(true)}>+ CalDAV</button>
      </div>

      {localSheet && (
        <LocalCalendarSheet usedColors={calendars.map(c => c.color)} onClose={() => setLocalSheet(false)} onSaved={() => { setLocalSheet(false); load() }} toast={toast} />
      )}
      {icsSheet && (
        <IcsSheet usedColors={calendars.map(c => c.color)} onClose={() => setIcsSheet(false)} onSaved={() => { setIcsSheet(false); load() }} toast={toast} />
      )}
      {caldavSheet && (
        <CaldavSheet onClose={() => setCaldavSheet(false)}
          onAccountCreated={id => { setCaldavSheet(false); setPickerAccountId(id); load() }} toast={toast} />
      )}
      {pickerAccountId && (
        <RemoteCalendarPicker accountId={pickerAccountId} accountName={accounts.find(a => a.id === pickerAccountId)?.name ?? 'Account'}
          onClose={() => setPickerAccountId(null)} onAdded={load} toast={toast} />
      )}
    </Section>
  )
}

function LocalCalendarSheet({ usedColors, onClose, onSaved, toast }: { usedColors: (string | null | undefined)[]; onClose: () => void; onSaved: () => void; toast: (m: string) => void }) {
  const [name, setName] = useState('')
  const save = async () => {
    if (!name.trim()) return
    try { await api.createCalendar({ kind: 'local', name: name.trim(), color: nextPaletteColor(usedColors) }); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add calendar') }
  }
  return (
    <Sheet title="Add local calendar" onClose={onClose} actions={<button className="btn btn-primary btn-block" onClick={save}>Add</button>}>
      <div className="field"><label>Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Family" autoFocus /></div>
    </Sheet>
  )
}

function IcsSheet({ usedColors, onClose, onSaved, toast }: { usedColors: (string | null | undefined)[]; onClose: () => void; onSaved: () => void; toast: (m: string) => void }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const save = async () => {
    if (!name.trim() || !url.trim()) return
    try { await api.createCalendar({ kind: 'ics', name: name.trim(), url: url.trim(), color: nextPaletteColor(usedColors) }); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add calendar') }
  }
  return (
    <Sheet title="Add ICS calendar" onClose={onClose} actions={<button className="btn btn-primary btn-block" onClick={save}>Add</button>}>
      <div className="field"><label>Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
      <div className="field"><label>ICS URL</label><input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></div>
    </Sheet>
  )
}

function CaldavSheet({ onClose, onAccountCreated, toast }: { onClose: () => void; onAccountCreated: (id: string) => void; toast: (m: string) => void }) {
  const [name, setName] = useState('')
  const [serverUrl, setServerUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const save = async () => {
    if (!name.trim() || !serverUrl.trim() || !username.trim() || !password) return
    try {
      const acc = await api.createCaldavAccount({ name: name.trim(), serverUrl: serverUrl.trim(), username: username.trim(), password })
      onAccountCreated(acc.id)
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not connect CalDAV account') }
  }
  return (
    <Sheet title="Connect CalDAV" onClose={onClose} actions={<button className="btn btn-primary btn-block" onClick={save}>Connect</button>}>
      <div className="field"><label>Account name</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. iCloud" autoFocus /></div>
      <div className="field"><label>Server URL</label><input type="url" value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="https://caldav.icloud.com" /></div>
      <div className="field"><label>Username</label><input type="text" value={username} onChange={e => setUsername(e.target.value)} /></div>
      <div className="field"><label>App password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} /></div>
    </Sheet>
  )
}

function RemoteCalendarPicker({ accountId, accountName, onClose, onAdded, toast }: {
  accountId: string; accountName: string; onClose: () => void; onAdded: () => void; toast: (m: string) => void
}) {
  const { members } = useApp()
  const [remotes, setRemotes] = useState<RemoteCalendar[] | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [choice, setChoice] = useState<Record<string, { memberId: string | null; color: string }>>({})

  useEffect(() => {
    api.getRemoteCalendars(accountId).then(setRemotes).catch(() => { toast('Could not list remote calendars'); setRemotes([]) })
  }, [accountId, toast])

  const addOne = async (rc: RemoteCalendar) => {
    const c = choice[rc.remoteId] ?? { memberId: null, color: rc.color ?? MEMBER_PALETTE[0] }
    try {
      await api.createCalendar({ kind: 'caldav', accountId, remoteId: rc.remoteId, name: rc.name, color: c.color, memberId: c.memberId ?? undefined })
      setAdded(s => new Set(s).add(rc.remoteId))
      onAdded()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add calendar') }
  }

  return (
    <Sheet title={`Calendars for ${accountName}`} onClose={onClose}>
      {remotes === null ? <div className="state-card">Loading…</div> : remotes.length === 0 ? (
        <div className="empty-card">No remote calendars found.</div>
      ) : remotes.map(rc => {
        const c = choice[rc.remoteId] ?? { memberId: null, color: rc.color ?? MEMBER_PALETTE[0] }
        const isAdded = added.has(rc.remoteId)
        return (
          <div key={rc.remoteId} className="cal-list-item">
            <div className="cal-list-top">
              <div className="cal-dot" style={{ background: c.color }} />
              <div className="cal-name">{rc.name}</div>
              {!rc.writable && <div className="cal-kind-badge">read-only</div>}
            </div>
            <div className="chip-row" style={{ marginTop: 8 }}>
              <button className={`chip ${c.memberId === null ? 'active' : ''}`} onClick={() => setChoice(s => ({ ...s, [rc.remoteId]: { ...c, memberId: null } }))}>Unassigned</button>
              {members.map(m => (
                <button key={m.id} className={`chip ${c.memberId === m.id ? 'active' : ''}`} style={{ ['--chip-color' as string]: m.color }}
                  onClick={() => setChoice(s => ({ ...s, [rc.remoteId]: { ...c, memberId: m.id, color: m.color } }))}>{m.avatar} {m.name}</button>
              ))}
            </div>
            <div className="cal-actions">
              <button className="link-btn" disabled={isAdded} onClick={() => addOne(rc)}>{isAdded ? 'Added ✓' : 'Add calendar'}</button>
            </div>
          </div>
        )
      })}
    </Sheet>
  )
}

function PasskeysSection({ me, toast }: { me: Me; toast: (m: string) => void }) {
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('This device')
  const [qr, setQr] = useState<{ token: string; expiresAt: string } | null>(null)
  const [renaming, setRenaming] = useState<Passkey | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const load = () => { api.getPasskeys().then(setPasskeys).catch(() => {}) }
  useEffect(load, [])

  const create = async () => {
    if (!name.trim()) return
    try {
      await registerPasskey(name.trim()) // bearer flow: this device already has an admin key/session, so the returned session is ignored
      setCreating(false); setName('This device')
      load()
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not create passkey') }
  }
  const startAnotherDevice = async () => {
    try { setQr(await api.passkeyRegisterToken()) }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not start pairing') }
  }
  const rename = async () => {
    if (!renaming || !renameValue.trim()) return
    try { await api.renamePasskey(renaming.id, renameValue.trim()); setRenaming(null); load() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not rename passkey') }
  }
  const remove = async (p: Passkey) => {
    const msg = passkeys.length === 1
      ? `Remove "${p.name}"? This is your last passkey — you'll need an admin key to sign in until you add another.`
      : `Remove "${p.name}"?`
    if (!confirm(msg)) return
    try { await api.deletePasskey(p.id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not remove passkey') }
  }
  const signOut = async () => {
    try { await api.sessionLogout() } catch { /* ignore - clearing locally either way */ }
    clearKey()
    location.reload()
  }

  if (!passkeysSupported()) {
    return (
      <Section title="Passkeys" icon={<KeyIcon width={16} height={16} />}>
        <p className="settings-row-sub">Passkeys need HTTPS — using an admin key instead.</p>
      </Section>
    )
  }

  return (
    <Section title="Passkeys" icon={<KeyIcon width={16} height={16} />}>
      {me.kind === 'session' && (
        <div className="settings-row">
          <div className="settings-row-label">Signed in with a passkey</div>
          <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={signOut}>Sign out</button>
        </div>
      )}
      {passkeys.map(p => (
        <div key={p.id} className="key-item">
          {renaming?.id === p.id ? (
            <div style={{ display: 'flex', gap: 8, flex: 1 }}>
              <input type="text" value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus style={{ flex: 1 }} />
              <button className="btn btn-primary" onClick={rename}>Save</button>
            </div>
          ) : (
            <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => { setRenaming(p); setRenameValue(p.name) }}>
              <div className="settings-row-label">{p.name}</div>
              <div className="settings-row-sub">
                created {new Date(p.createdAt).toLocaleDateString()}
                {p.lastUsedAt ? ` · used ${new Date(p.lastUsedAt).toLocaleDateString()}` : ' · never used'}
              </div>
            </div>
          )}
          <button className="icon-btn" onClick={() => remove(p)}><TrashIcon width={16} height={16} /></button>
        </div>
      ))}
      {creating ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Passkey name" autoFocus style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={create}>Create</button>
        </div>
      ) : (
        <button className="add-row-btn" onClick={() => setCreating(true)}><PlusIcon width={20} height={20} />Add a passkey on this device</button>
      )}
      {qr ? (
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <QrCode value={new URL(`#/admin-setup?token=${qr.token}`, document.baseURI).href} size={168} />
          <div className="settings-row-sub">Scan with another phone or computer to add a passkey there.</div>
        </div>
      ) : (
        <button className="add-row-btn" onClick={startAnotherDevice}><PlusIcon width={20} height={20} />Add a passkey on another device</button>
      )}
    </Section>
  )
}

// Admin keys only — display keys are created exclusively through pairing (see DisplaysSection),
// so there's one place to mint each kind of key instead of two overlapping ones. Revoking a
// display key still works here-or-there since both call the same DELETE /api/keys/:id, but this
// list only shows admin keys to keep that one job in Displays.
function KeysSection({ toast }: { toast: (m: string) => void }) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const load = () => { api.getKeys().then(ks => setKeys(ks.filter(k => k.scope === 'admin'))).catch(() => {}) }
  useEffect(load, [])

  const create = async () => {
    if (!name.trim()) return
    try {
      const k = await api.createKey(name.trim(), 'admin')
      setNewKey({ name: k.name, key: k.key })
      setCreating(false); setName('')
      load()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not create key') }
  }
  const del = async (id: string) => { try { await api.deleteKey(id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete key') } }
  const copy = async (key: string) => { try { await navigator.clipboard.writeText(key); toast('Key copied') } catch { toast('Could not copy — select and copy manually') } }

  return (
    <Section title="API Keys" icon={<KeyIcon width={16} height={16} />}>
      {newKey && (
        <div className="new-key-banner">
          <div style={{ fontWeight: 800 }}>{newKey.name} — save this now, it won't be shown again</div>
          <div className="new-key-value">{newKey.key}</div>
          <button className="btn btn-secondary" onClick={() => copy(newKey.key)}>Copy key</button>
        </div>
      )}
      {keys.map(k => (
        <div key={k.id} className="key-item">
          <div>
            <div className="settings-row-label">{k.name} <span className="cal-kind-badge">{k.scope}</span></div>
            <div className="settings-row-sub">{k.prefix ? `${k.prefix}… ` : ''}{k.lastUsedAt ? `· used ${new Date(k.lastUsedAt).toLocaleDateString()}` : '· never used'}</div>
          </div>
          <button className="icon-btn" onClick={() => del(k.id)}><TrashIcon width={16} height={16} /></button>
        </div>
      ))}
      {creating ? (
        <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="Key name" autoFocus style={{ flex: 1 }} />
          <button className="btn btn-primary" onClick={create}>Create</button>
        </div>
      ) : (
        <button className="add-row-btn" onClick={() => setCreating(true)}><PlusIcon width={20} height={20} />New admin key</button>
      )}
    </Section>
  )
}

// Display keys are minted only via pairing (device-flow: a display shows a code, this form
// approves it) rather than a raw "create key" button — see the API Keys section comment above
// for why. Listing + Revoke reuse the same GET/DELETE /api/keys the API Keys section uses.
function DisplaysSection({ toast }: { toast: (m: string) => void }) {
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [code, setCode] = useState('')
  const [name, setName] = useState('Wall display')
  const [busy, setBusy] = useState(false)
  const load = () => { api.getKeys().then(ks => setKeys(ks.filter(k => k.scope === 'display'))).catch(() => {}) }
  useEffect(load, [])

  const pair = async () => {
    if (code.length !== 6 || !name.trim()) return
    setBusy(true)
    try {
      await api.pairApprove(code, name.trim())
      setCode('')
      toast('Display paired')
      load()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not pair display')
    } finally {
      setBusy(false)
    }
  }
  const revoke = async (id: string) => { try { await api.deleteKey(id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not revoke display') } }

  return (
    <Section title="Displays" icon={<MonitorIcon width={16} height={16} />}>
      <p className="settings-row-sub" style={{ marginBottom: 10 }}>Pair a display</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="field" style={{ margin: 0 }}>
          <label>Code</label>
          <input
            type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
            value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            style={{ fontSize: 22, fontWeight: 800, letterSpacing: '0.12em', width: 130, textAlign: 'center' }}
          />
        </div>
        <div className="field" style={{ margin: 0, flex: 1, minWidth: 140 }}>
          <label>Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)} />
        </div>
        <button className="btn btn-primary" onClick={pair} disabled={busy || code.length !== 6 || !name.trim()}>Pair</button>
      </div>

      {keys.map(k => (
        <div key={k.id} className="key-item">
          <div>
            <div className="settings-row-label">{k.name}</div>
            <div className="settings-row-sub">
              created {new Date(k.createdAt).toLocaleDateString()}
              {k.lastUsedAt ? ` · used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ' · never used'}
            </div>
          </div>
          <button className="icon-btn" onClick={() => revoke(k.id)}><TrashIcon width={16} height={16} /></button>
        </div>
      ))}
    </Section>
  )
}

function WebhooksSection({ toast }: { toast: (m: string) => void }) {
  const [hooks, setHooks] = useState<Webhook[]>([])
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const [evs, setEvs] = useState<string[]>([])
  const load = () => { api.getWebhooks().then(setHooks).catch(() => {}) }
  useEffect(load, [])

  const create = async () => {
    if (!url.trim() || evs.length === 0) return
    try { await api.createWebhook(url.trim(), evs); setAdding(false); setUrl(''); setEvs([]); load() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add webhook') }
  }
  const del = async (id: string) => { try { await api.deleteWebhook(id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete webhook') } }

  return (
    <Section title="Webhooks" icon={<WebhookIcon width={16} height={16} />}>
      {hooks.map(h => (
        <div key={h.id} className="webhook-item">
          <div style={{ minWidth: 0 }}>
            <div className="settings-row-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.url}</div>
            <div className="settings-row-sub">{h.events.join(', ')}</div>
          </div>
          <button className="icon-btn" onClick={() => del(h.id)}><TrashIcon width={16} height={16} /></button>
        </div>
      ))}
      {adding ? (
        <div style={{ marginTop: 10 }}>
          <div className="field"><label>URL</label><input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" autoFocus /></div>
          <div className="field">
            <label>Events</label>
            <div className="chip-row">
              {BUS_EVENTS.map(ev => (
                <button key={ev} className={`chip ${evs.includes(ev) ? 'active' : ''}`} onClick={() => setEvs(s => s.includes(ev) ? s.filter(x => x !== ev) : [...s, ev])}>{ev}</button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary btn-block" onClick={create}>Add webhook</button>
        </div>
      ) : (
        <button className="add-row-btn" onClick={() => setAdding(true)}><PlusIcon width={20} height={20} />New webhook</button>
      )}
    </Section>
  )
}
