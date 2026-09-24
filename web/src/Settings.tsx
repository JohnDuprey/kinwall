import { useEffect, useMemo, useState } from 'react'
import { useApp } from './AppContext.tsx'
import { api, ApiError, clearKey } from './api.ts'
import type { Account, ApiKey, CalendarEntry, Category, Density, Me, Member, Passkey, Providers, RemoteCalendar, Settings, TextScale, ThemeMode, Webhook } from './types.ts'
import { ProviderForm, PublicUrlRow } from './ProviderConfig.tsx'
import { ACCENT_PRESETS, BACKGROUND_DARK_PRESETS, BACKGROUND_LIGHT_PRESETS, CATEGORY_EMOJI, CATEGORY_PRESETS, MEMBER_EMOJI, MEMBER_PALETTE, nextPaletteColor } from './types.ts'
import Sheet from './Sheet.tsx'
import { MemberPicker } from './MemberPicker.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isValidAvatar } from './emoji.ts'
import { inkFor } from './color.ts'
import { KeyIcon, LinkIcon, MonitorIcon, PaletteIcon, PlusIcon, TrashIcon, WebhookIcon } from './icons.tsx'
import { useIsPhone } from './useIsPhone.ts'
import { useNavMode, setNavPref, type NavPref } from './useNavMode.ts'
import { passkeysSupported, registerPasskey } from './webauthn.ts'
import { QrCode } from './App.tsx'

const BUS_EVENTS = ['member.changed', 'calendar.changed', 'calendar.synced', 'events.changed', 'chore.changed', 'chore.completed', 'chore.uncompleted', 'category.changed', 'settings.changed']

export function timezoneList() {
  // Intl.supportedValuesOf('timeZone') doesn't include 'UTC' itself (the server's default
  // settings.timezone), which left the <select> silently showing the wrong zone. Prepend it.
  try {
    return ['UTC', ...Intl.supportedValuesOf('timeZone')]
  } catch {
    return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin']
  }
}

type SettingsTab = 'general' | 'family' | 'calendars' | 'access'
const SETTINGS_TABS: { key: SettingsTab; label: string; admin?: boolean }[] = [
  { key: 'general', label: 'General' },
  { key: 'family', label: 'Family' },
  { key: 'calendars', label: 'Calendars', admin: true },
  { key: 'access', label: 'Access', admin: true },
]

export default function SettingsView() {
  const { settings, members, categories, toast, reloadCore } = useApp()
  const [openAccountId, setOpenAccountId] = useState<string | null>(null)
  // The tab rides in the hash query (#/settings?tab=family) so reloads and links keep it; an OAuth
  // return (?account=...) lands on Calendars, where the new account's calendar picker opens.
  const [tab, setTab] = useState<SettingsTab>(() => {
    const q = new URLSearchParams(location.hash.split('?')[1] || '')
    if (q.get('account')) return 'calendars'
    const t = q.get('tab')
    return SETTINGS_TABS.some(x => x.key === t) ? (t as SettingsTab) : 'general'
  })
  const pickTab = (t: SettingsTab) => { setTab(t); history.replaceState(null, '', `#/settings?tab=${t}`) }
  // Fails CLOSED to the display-only view until /api/me answers — a display key must never see
  // admin sections, even briefly, if the check is slow or fails.
  const [me, setMe] = useState<Me>({ scope: 'display', keyName: '', kind: 'api' })

  useEffect(() => {
    const q = new URLSearchParams(location.hash.split('?')[1] || '')
    const account = q.get('account')
    if (account) setOpenAccountId(account)
  }, [])

  useEffect(() => { api.meStrict().then(setMe).catch(() => setMe({ scope: 'display', keyName: '', kind: 'api' })) }, [])

  // Display keys get the everyday settings; admin-only sections (calendar accounts, displays,
  // passkeys, API keys, webhooks) aren't rendered at all.
  // Display keys get the everyday tabs; the admin-only ones (calendar accounts, displays,
  // passkeys, API keys, webhooks) aren't rendered at all.
  const isDisplay = me.scope === 'display'
  const tabs = SETTINGS_TABS.filter(t => !t.admin || !isDisplay)
  const current = tabs.some(t => t.key === tab) ? tab : 'general'

  return (
    <div className="content scroll-y">
      <div className="settings-scroll">
        <div className="settings-tabs">
          <div className="segmented">
            {tabs.map(t => <button key={t.key} className={current === t.key ? 'active' : ''} onClick={() => pickTab(t.key)}>{t.label}</button>)}
          </div>
        </div>
        {current === 'general' && <>
          <GeneralSection settings={settings} onSaved={reloadCore} toast={toast} />
          <AppearanceSection settings={settings} onSaved={reloadCore} toast={toast} />
          {isDisplay ? <ThisDisplaySection keyName={me.keyName} /> : <ThisDisplaySection />}
        </>}
        {current === 'family' && <>
          <MembersSection members={members} onChanged={reloadCore} toast={toast} canManage={!isDisplay} />
          <CategoriesSection categories={categories} onChanged={reloadCore} toast={toast} />
        </>}
        {current === 'calendars' && <>
          <CalendarsSection openAccountId={openAccountId} onOpenedAccount={() => setOpenAccountId(null)} toast={toast} />
          <CalendarProvidersSection toast={toast} />
        </>}
        {current === 'access' && <>
          <DisplaysSection toast={toast} />
          <PasskeysSection me={me} toast={toast} />
          <KeysSection toast={toast} />
          <WebhooksSection toast={toast} />
        </>}
        {me.version && current === 'general' && <div className="settings-version">Kinwall v{me.version}</div>}
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
          <div className="settings-row-sub">Clears the key stored on this device and returns to the pairing screen. This doesn't revoke the key — do that from an admin device under Settings → Access → Displays.</div>
        </div>
      )}
    </Section>
  )
}

function MembersSection({ members, onChanged, toast, canManage = true }: { members: Member[]; onChanged: () => void; toast: (m: string) => void; canManage?: boolean }) {
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
        {canManage && <button className="add-row-btn" onClick={() => setEdit('new')}><PlusIcon width={20} height={20} />Add member</button>}
      </div>
      {edit && (
        <MemberEditSheet member={edit === 'new' ? null : edit} canDelete={canManage} onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); onChanged() }} toast={toast} />
      )}
    </Section>
  )
}

function MemberEditSheet({ member, canDelete, onClose, onSaved, toast }: { member: Member | null; canDelete: boolean; onClose: () => void; onSaved: () => void; toast: (m: string) => void }) {
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
    if (!confirm(`Remove ${member.name}? Their chores and tags are unassigned.`)) return
    try { await api.deleteMember(member.id); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete member') }
  }
  return (
    <Sheet title={member ? 'Edit member' : 'Add member'} onClose={onClose}
      actions={<>{member && canDelete && <button className="btn btn-danger" onClick={del}><TrashIcon width={18} height={18} /></button>}<button className="btn btn-primary" onClick={save} disabled={!name.trim() || !isValidAvatar(avatar)}>Save</button></>}>
      <div className="field"><label>Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus={!member} /></div>
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

function CategoriesSection({ categories, onChanged, toast }: { categories: Category[]; onChanged: () => void; toast: (m: string) => void }) {
  const [edit, setEdit] = useState<Category | null>(null)
  const [draft, setDraft] = useState<Partial<Category> | null>(null) // non-null while creating (blank, or preset-prefilled)
  const [showPresets, setShowPresets] = useState(false)
  const sorted = [...categories].sort((a, b) => a.sort - b.sort)

  const move = async (id: string, dir: -1 | 1) => {
    const idx = sorted.findIndex(c => c.id === id)
    const swapWith = idx + dir
    if (swapWith < 0 || swapWith >= sorted.length) return
    const ids = sorted.map(c => c.id)
    const tmp = ids[idx]; ids[idx] = ids[swapWith]; ids[swapWith] = tmp
    try { await api.reorderCategories(ids); onChanged() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not reorder categories') }
  }

  return (
    <Section title="Categories">
      <div className="member-row-list">
        {sorted.map((c, i) => (
          <div key={c.id} className="member-list-item" onClick={() => setEdit(c)}>
            <div className="member-avatar-sm" style={{ background: c.color, color: inkFor(c.color) }}>{c.emoji ?? '🏷️'}</div>
            <div className="name">
              {c.name}
              {c.keywords.length > 0 && <div className="settings-row-sub">{c.keywords.join(', ')}</div>}
            </div>
            <div className="cal-actions" onClick={e => e.stopPropagation()}>
              <button className="icon-btn" disabled={i === 0} onClick={() => move(c.id, -1)} aria-label="Move up">↑</button>
              <button className="icon-btn" disabled={i === sorted.length - 1} onClick={() => move(c.id, 1)} aria-label="Move down">↓</button>
            </div>
          </div>
        ))}
        {!showPresets && <button className="add-row-btn" onClick={() => setShowPresets(true)}><PlusIcon width={20} height={20} />Add category</button>}
        {showPresets && (
          <div className="chip-row" style={{ marginTop: 8 }}>
            {CATEGORY_PRESETS.map(p => (
              <button key={p.name} className="chip" onClick={() => { setShowPresets(false); setDraft({ name: p.name, emoji: p.emoji, keywords: p.keywords }) }}>
                {p.emoji} {p.name}
              </button>
            ))}
            <button className="chip" onClick={() => { setShowPresets(false); setDraft({}) }}>Custom</button>
          </div>
        )}
      </div>
      {(edit || draft) && (
        <CategoryEditSheet category={edit} initial={draft ?? undefined}
          onClose={() => { setEdit(null); setDraft(null) }}
          onSaved={() => { setEdit(null); setDraft(null); onChanged() }} toast={toast} />
      )}
    </Section>
  )
}

function CategoryEditSheet({ category, initial, onClose, onSaved, toast }: {
  category: Category | null; initial?: Partial<Category>; onClose: () => void; onSaved: () => void; toast: (m: string) => void
}) {
  const base = category ?? initial ?? {}
  const [name, setName] = useState(base.name ?? '')
  const [emoji, setEmoji] = useState(base.emoji ?? CATEGORY_EMOJI[0])
  const [color, setColor] = useState(base.color ?? MEMBER_PALETTE[0])
  const [keywordsText, setKeywordsText] = useState((base.keywords ?? []).join(', '))

  const save = async () => {
    if (!name.trim()) return
    const keywords = keywordsText.split(',').map(k => k.trim()).filter(Boolean)
    try {
      if (category) await api.updateCategory(category.id, { name: name.trim(), emoji, color, keywords })
      else await api.createCategory({ name: name.trim(), emoji, color, keywords })
      onSaved()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save category') }
  }
  const del = async () => {
    if (!category) return
    if (!confirm(`Delete the ${category.name} category? Events fall back to their automatic colour.`)) return
    try { await api.deleteCategory(category.id); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete category') }
  }

  return (
    <Sheet title={category ? 'Edit category' : 'Add category'} onClose={onClose}
      actions={<>{category && <button className="btn btn-danger" onClick={del}><TrashIcon width={18} height={18} /></button>}<button className="btn btn-primary" onClick={save} disabled={!name.trim()}>Save</button></>}>
      <div className="field"><label>Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus={!category} /></div>
      <div className="field">
        <label>Emoji</label>
        <div className="emoji-swatch-row">
          {CATEGORY_EMOJI.map(e => <button key={e} className={`emoji-swatch ${emoji === e ? 'active' : ''}`} onClick={() => setEmoji(e)}>{e}</button>)}
        </div>
        <AnyEmojiField value={emoji} onChange={setEmoji} />
      </div>
      <div className="field">
        <label>Color</label>
        <div className="color-swatch-row">
          {MEMBER_PALETTE.map(c => <button key={c} className={`color-swatch ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />)}
          <input type="color" className="color-swatch" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#888888'}
            onChange={e => setColor(e.target.value)} style={{ padding: 0, border: '2px solid var(--border)', cursor: 'pointer' }} aria-label="Custom category color" />
        </div>
        <div className="settings-row-sub">This color overrides the member color on the calendar.</div>
      </div>
      <div className="field">
        <label>Keywords</label>
        <input type="text" value={keywordsText} onChange={e => setKeywordsText(e.target.value)} placeholder="e.g. birthday, bday, b-day" />
        <div className="settings-row-sub">Comma-separated. Matches whole words/phrases in an event's title, case-insensitive.</div>
      </div>
    </Sheet>
  )
}

function CalendarProvidersSection({ toast }: { toast: (m: string) => void }) {
  const [providers, setProviders] = useState<Providers | null>(null)
  const load = () => { api.getProviders().then(setProviders).catch(() => {}) }
  useEffect(load, [])
  if (!providers) return null
  return (
    <Section title="Calendar providers" icon={<LinkIcon width={16} height={16} />}>
      <PublicUrlRow providers={providers} toast={toast} onChanged={load} />
      <ProviderForm kind="google" providers={providers} toast={toast} onChanged={load} />
      <ProviderForm kind="microsoft" providers={providers} toast={toast} onChanged={load} />
    </Section>
  )
}

function CalendarsSection({ openAccountId, onOpenedAccount, toast }: { openAccountId: string | null; onOpenedAccount: () => void; toast: (m: string) => void }) {
  const [calendars, setCalendars] = useState<CalendarEntry[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [localSheet, setLocalSheet] = useState(false)
  const [icsSheet, setIcsSheet] = useState(false)
  const [caldavSheet, setCaldavSheet] = useState(false)
  const [pickerAccountId, setPickerAccountId] = useState<string | null>(null)
  const [editCal, setEditCal] = useState<CalendarEntry | null>(null)
  const [oauth, setOauth] = useState({ google: false, microsoft: false })

  const load = () => {
    api.getCalendars().then(setCalendars).catch(() => {})
    api.getAccounts().then(setAccounts).catch(() => {})
    api.getProviders().then(p => setOauth({ google: p.google.configured, microsoft: p.microsoft.configured })).catch(() => {})
  }
  useEffect(load, [])
  useEffect(() => { if (openAccountId) { setPickerAccountId(openAccountId); onOpenedAccount() } }, [openAccountId, onOpenedAccount])

  const sync = async (id: string) => {
    try { await api.syncCalendar(id); load(); toast('Synced') } catch (e) { toast(e instanceof ApiError ? e.message : 'Sync failed') }
  }
  const remove = async (id: string) => {
    if (!confirm('Remove this calendar and its events from Kinwall? Nothing is deleted from the original calendar.')) return
    try { await api.deleteCalendar(id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not remove calendar') }
  }

  return (
    <Section title="Calendars" icon={<LinkIcon width={16} height={16} />}>
      {calendars.map(c => (
        <div key={c.id} className="cal-list-item" onClick={() => setEditCal(c)} style={{ cursor: 'pointer' }}>
          <div className="cal-list-top">
            <div className="cal-dot" style={{ background: c.color ?? '#888' }} />
            <div className="cal-name">{c.name}</div>
            <div className="cal-kind-badge">{c.kind}</div>
          </div>
          <div className={`cal-sub ${c.lastError ? 'error' : ''}`}>
            {c.lastError ? c.lastError : c.kind === 'local' ? 'Local calendar' : c.lastSyncedAt ? `Synced ${new Date(c.lastSyncedAt).toLocaleString()}` : 'Never synced'}
          </div>
          <div className="cal-actions" onClick={e => e.stopPropagation()}>
            {c.kind !== 'local' && <button className="link-btn" onClick={() => sync(c.id)}>Sync now</button>}
            <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={() => remove(c.id)}>Remove</button>
          </div>
        </div>
      ))}
      <div className="connect-buttons" style={{ marginTop: 14 }}>
        <button className="connect-btn" onClick={() => setLocalSheet(true)}>+ Local calendar</button>
        <button className="connect-btn" onClick={() => setIcsSheet(true)}>+ ICS URL</button>
        <button className="connect-btn" onClick={() => setCaldavSheet(true)}>+ CalDAV</button>
        <button className="connect-btn" disabled={!oauth.google} onClick={() => location.href = api.oauthStartUrl('google')}>Connect Google</button>
        <button className="connect-btn" disabled={!oauth.microsoft} onClick={() => location.href = api.oauthStartUrl('microsoft')}>Connect Outlook</button>
      </div>
      {(!oauth.google || !oauth.microsoft) && (
        <p className="settings-row-sub" style={{ marginTop: 8 }}>Google/Outlook greyed out? Set them up in Calendar providers below.</p>
      )}

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
        <RemoteCalendarPicker accountId={pickerAccountId} accountKind={accounts.find(a => a.id === pickerAccountId)?.kind ?? 'caldav'} accountName={accounts.find(a => a.id === pickerAccountId)?.name ?? 'Account'}
          onClose={() => setPickerAccountId(null)} onAdded={load} toast={toast} />
      )}
      {editCal && (
        <EditCalendarSheet calendar={editCal} onClose={() => setEditCal(null)}
          onSaved={() => { setEditCal(null); load() }}
          onSync={() => sync(editCal.id)}
          onRemove={() => { setEditCal(null); remove(editCal.id) }}
          toast={toast} />
      )}
    </Section>
  )
}

function EditCalendarSheet({ calendar, onClose, onSaved, onSync, onRemove, toast }: {
  calendar: CalendarEntry; onClose: () => void; onSaved: () => void; onSync: () => void; onRemove: () => void; toast: (m: string) => void
}) {
  const { members, categories } = useApp()
  const [name, setName] = useState(calendar.name)
  const [color, setColor] = useState(calendar.color ?? MEMBER_PALETTE[0])
  const [memberIds, setMemberIds] = useState(calendar.memberIds)
  const [categoryId, setCategoryId] = useState(calendar.categoryId)
  const [enabled, setEnabled] = useState(calendar.enabled)

  const save = async () => {
    if (!name.trim()) return
    try {
      await api.updateCalendar(calendar.id, { name: name.trim(), color, memberIds, categoryId, enabled })
      onSaved()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save calendar') }
  }

  return (
    <Sheet title="Edit calendar" onClose={onClose} actions={<button className="btn btn-primary btn-block" onClick={save}>Save</button>}>
      <div className="field"><label>Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="field">
        <label>Color</label>
        <div className="color-swatch-row">
          {MEMBER_PALETTE.map(c => <button key={c} className={`color-swatch ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} />)}
          <input type="color" className="color-swatch" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#888888'}
            onChange={e => setColor(e.target.value)} style={{ padding: 0, border: '2px solid var(--border)', cursor: 'pointer' }} aria-label="Custom calendar color" />
        </div>
      </div>
      <MemberPicker members={members} selected={memberIds} onChange={setMemberIds} />
      <div className="field">
        <label>Default category</label>
        <select value={categoryId ?? ''} onChange={e => setCategoryId(e.target.value || null)}>
          <option value="">None</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.emoji ? `${c.emoji} ` : ''}{c.name}</option>)}
        </select>
        <div className="settings-row-sub">Applied to events here with no keyword match or their own category.</div>
      </div>
      <div className="settings-row" style={{ paddingLeft: 0, paddingRight: 0 }}>
        <div className="settings-row-label">Enabled</div>
        <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} />
      </div>
      <div className="cal-actions" style={{ marginTop: 4 }}>
        {calendar.kind !== 'local' && <button className="link-btn" onClick={onSync}>Sync now</button>}
        <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={onRemove}>Remove</button>
      </div>
    </Sheet>
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
  const { members } = useApp()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const save = async () => {
    if (!name.trim() || !url.trim()) return
    try { await api.createCalendar({ kind: 'ics', name: name.trim(), url: url.trim(), color: nextPaletteColor(usedColors), memberIds }); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add calendar') }
  }
  return (
    <Sheet title="Add ICS calendar" onClose={onClose} actions={<button className="btn btn-primary btn-block" onClick={save}>Add</button>}>
      <div className="field"><label>Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
      <div className="field"><label>ICS URL</label><input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></div>
      <MemberPicker members={members} selected={memberIds} onChange={setMemberIds} />
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

function RemoteCalendarPicker({ accountId, accountKind, accountName, onClose, onAdded, toast }: {
  accountId: string; accountKind: Account['kind']; accountName: string; onClose: () => void; onAdded: () => void; toast: (m: string) => void
}) {
  const { members } = useApp()
  const [remotes, setRemotes] = useState<RemoteCalendar[] | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [choice, setChoice] = useState<Record<string, { memberIds: string[]; color: string }>>({})

  useEffect(() => {
    api.getRemoteCalendars(accountId).then(setRemotes).catch(() => { toast('Could not list remote calendars'); setRemotes([]) })
  }, [accountId, toast])

  const addOne = async (rc: RemoteCalendar) => {
    const c = choice[rc.remoteId] ?? { memberIds: [], color: rc.color ?? MEMBER_PALETTE[0] }
    try {
      await api.createCalendar({ kind: accountKind, accountId, remoteId: rc.remoteId, name: rc.name, color: c.color, memberIds: c.memberIds })
      setAdded(s => new Set(s).add(rc.remoteId))
      onAdded()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add calendar') }
  }

  return (
    <Sheet title={`Calendars for ${accountName}`} onClose={onClose}>
      {remotes === null ? <div className="state-card">Loading…</div> : remotes.length === 0 ? (
        <div className="empty-card">No remote calendars found.</div>
      ) : remotes.map(rc => {
        const c = choice[rc.remoteId] ?? { memberIds: [], color: rc.color ?? MEMBER_PALETTE[0] }
        const isAdded = added.has(rc.remoteId)
        return (
          <div key={rc.remoteId} className="cal-list-item">
            <div className="cal-list-top">
              <div className="cal-dot" style={{ background: c.color }} />
              <div className="cal-name">{rc.name}</div>
              {!rc.writable && <div className="cal-kind-badge">read-only</div>}
            </div>
            <MemberPicker members={members} selected={c.memberIds} onChange={ids => setChoice(s => ({ ...s, [rc.remoteId]: { ...c, memberIds: ids } }))} />
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
  const del = async (id: string) => { if (!confirm('Delete this API key? Anything using it stops working immediately.')) return; try { await api.deleteKey(id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete key') } }
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
            <div className="settings-row-sub">{[k.prefix && `${k.prefix}…`, k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'never used'].filter(Boolean).join(' · ')}</div>
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
  const [adding, setAdding] = useState(false)
  const load = () => { api.getKeys().then(ks => setKeys(ks.filter(k => k.scope === 'display'))).catch(() => {}) }
  useEffect(load, [])

  const pair = async () => {
    if (code.length !== 6 || !name.trim()) return
    setBusy(true)
    try {
      await api.pairApprove(code, name.trim())
      setCode('')
      setAdding(false)
      toast('Display paired')
      load()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not pair display')
    } finally {
      setBusy(false)
    }
  }
  const revoke = async (k: ApiKey) => {
    if (!confirm(`Remove "${k.name}"? It will be signed out and need pairing again.`)) return
    try { await api.deleteKey(k.id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not revoke display') }
  }

  return (
    <Section title="Displays" icon={<MonitorIcon width={16} height={16} />}>
      {keys.length === 0 && <p className="settings-row-sub">No displays yet. Open Kinwall on the wall screen and choose "Set up as a wall display" to get a code.</p>}
      {keys.map(k => (
        <div key={k.id} className="key-item">
          <div>
            <div className="settings-row-label">{k.name}</div>
            <div className="settings-row-sub">
              created {new Date(k.createdAt).toLocaleDateString()}
              {k.lastUsedAt ? ` · used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ' · never used'}
            </div>
          </div>
          <button className="icon-btn" onClick={() => revoke(k)} aria-label={`Remove ${k.name}`}><TrashIcon width={16} height={16} /></button>
        </div>
      ))}
      <button className="add-row-btn" onClick={() => setAdding(true)}><PlusIcon width={20} height={20} />Add a display</button>

      {adding && (
        <Sheet title="Add a display" onClose={() => setAdding(false)}
          actions={<button className="btn btn-primary btn-block" onClick={pair} disabled={busy || code.length !== 6 || !name.trim()}>{busy ? 'Pairing…' : 'Pair display'}</button>}>
          <p className="settings-row-sub" style={{ marginBottom: 14 }}>On the wall screen, choose "Set up as a wall display", then enter the 6-digit code it shows. Scanning its QR code with your phone works too.</p>
          <div className="row-2">
            <div className="field">
              <label>Code</label>
              <input
                type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="123456"
                autoFocus
                style={{ letterSpacing: '0.2em', fontVariantNumeric: 'tabular-nums' }}
              />
            </div>
            <div className="field">
              <label>Name</label>
              <input type="text" value={name} onChange={e => setName(e.target.value)} />
            </div>
          </div>
        </Sheet>
      )}
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
  const del = async (id: string) => { if (!confirm('Delete this webhook?')) return; try { await api.deleteWebhook(id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete webhook') } }

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
