import { createContext, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useApp } from './AppContext.tsx'
import { api, ApiError, clearKey } from './api.ts'
import type { Account, ApiKey, CalendarEntry, Category, ColorScheme, CustomColors, Density, DeviceDensity, GeocodeResult, HostEvent, Me, Member, Passkey, Providers, PushSubscription, RemoteCalendar, Settings, TextScale, ThemeMode, Webhook } from './types.ts'
import { ProviderForm, PublicUrlRow } from './ProviderConfig.tsx'
import { CATEGORY_EMOJI, CATEGORY_PRESETS, MEMBER_EMOJI, MEMBER_PALETTE, nextPaletteColor, REMINDER_OPTIONS } from './types.ts'
import Sheet from './Sheet.tsx'
import { MemberPicker } from './MemberPicker.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isValidAvatar } from './emoji.ts'
import { accentFill, colorName, inkFor } from './color.ts'
import { BellIcon, KeyIcon, LinkIcon, LockIcon, MonitorIcon, PaletteIcon, PlusIcon, TrashIcon, WebhookIcon } from './icons.tsx'
import { CustomColorSwatch } from './ColorSwatch.tsx'
import { useIsPhone } from './useIsPhone.ts'
import { useNavMode, setNavPref, type NavPref } from './useNavMode.ts'
import { DEFAULT_ACCENT, resolveColors, setDeviceAppearance, useDeviceAppearance, type DeviceAppearance, type FontChoice, type LockedView, type SaverSource } from './useTheme.ts'
import { baseFromPalette, findSkin, getSkin, paletteChecks, paletteOf, seasonalSkinId, SKINS, tokensFor, type CustomScheme, type Palette } from './skins.ts'
import { SAVER_PREVIEW_EVENT } from './Screensaver.tsx'
import { countDrawings } from './drawings-db.ts'
import { passkeysSupported, registerPasskey } from './webauthn.ts'
import { QrCode } from './App.tsx'
import { useDialog } from './dialog.tsx'
import { announce, pressable, reducedMotion, Segmented } from './a11y.tsx'

// Mirrors BusEventType in server/src/bus.ts.
const BUS_EVENTS = ['member.changed', 'calendar.changed', 'calendar.synced', 'events.changed', 'chore.changed', 'chore.completed', 'chore.uncompleted', 'list.changed', 'list.item.changed', 'category.changed', 'settings.changed', 'sticker.changed', 'photo.changed', 'display.paired']

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
  const tabFromHash = (): SettingsTab => {
    const q = new URLSearchParams(location.hash.split('?')[1] || '')
    if (q.get('account') || q.get('oauthError')) return 'calendars'
    const t = q.get('tab')
    return SETTINGS_TABS.some(x => x.key === t) ? (t as SettingsTab) : 'general'
  }
  const [tab, setTab] = useState<SettingsTab>(tabFromHash)
  useEffect(() => {
    const onHash = () => { if (location.hash.startsWith('#/settings')) setTab(tabFromHash()) }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const pickTab = (t: SettingsTab) => { setTab(t); history.replaceState(null, '', `#/settings?tab=${t}`) }
  // Fails CLOSED to the display-only view until /api/me answers — a display key must never see
  // admin sections, even briefly, if the check is slow or fails.
  const [me, setMe] = useState<Me>({ scope: 'display', keyName: '', kind: 'api' })
  // Bumped when passkeys or recovery codes change, so the "second way in" nudge re-checks.
  const [accessTick, setAccessTick] = useState(0)
  const bumpAccess = () => setAccessTick(t => t + 1)

  useEffect(() => {
    const q = new URLSearchParams(location.hash.split('?')[1] || '')
    const account = q.get('account')
    if (account) setOpenAccountId(account)
    // Provider sign-in that didn't finish (routes/oauth.ts sends "<kind>:<reason>"). Say so once
    // and drop it from the hash so a reload doesn't repeat it.
    const oauthError = q.get('oauthError')
    if (oauthError) {
      const [kind, ...rest] = oauthError.split(':')
      const reason = rest.join(':').trim()
      const who = kind === 'google' ? 'Google' : 'Microsoft'
      toast(reason === 'canceled' ? `${who} sign-in canceled — nothing was connected` : `${who} connection failed: ${reason}`, true)
      q.delete('oauthError')
      history.replaceState(null, '', `#/settings${q.toString() ? `?${q}` : ''}`)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

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
          <Segmented tabs idBase="settings-tab" label="Settings sections" value={current} onChange={pickTab} options={tabs} />
        </div>
        <div className="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${current}`}>
        {current === 'general' && <>
          <SettingsGroup title="For the whole family" sub="Every screen and phone in the household uses these.">
            <GeneralSection settings={settings} onSaved={reloadCore} toast={toast} isDisplay={isDisplay} />
            <WeatherSection settings={settings} onSaved={reloadCore} toast={toast} />
            <AppearanceSection settings={settings} onSaved={reloadCore} toast={toast} />
            <QuietHoursSection settings={settings} onSaved={reloadCore} toast={toast} />
          </SettingsGroup>
          <SettingsGroup title="Only on this device" sub="Saved on this screen or phone. Other devices aren't affected.">
            {isDisplay ? <ThisDisplaySection keyName={me.keyName} /> : <ThisDisplaySection />}
            <Section title="Appearance on this device" icon={<PaletteIcon width={16} height={16} />}><DeviceAppearanceRows /></Section>
            <Section title="Time cues"><TimeCueRows /></Section>
            <Section title="Night screen"><ScreensaverRows /></Section>
            <NotificationsSection toast={toast} />
            <TroubleshootSection keyName={isDisplay ? me.keyName : undefined} />
          </SettingsGroup>
        </>}
        {current === 'family' && <>
          <MembersSection members={members} onChanged={reloadCore} toast={toast} canManage={!isDisplay} />
          <CategoriesSection categories={categories} onChanged={reloadCore} toast={toast} />
          <ChoreSettingsSection settings={settings} onSaved={reloadCore} toast={toast} />
        </>}
        {current === 'calendars' && <>
          <CalendarsSection openAccountId={openAccountId} onOpenedAccount={() => setOpenAccountId(null)} toast={toast} />
          <CalendarProvidersSection toast={toast} />
        </>}
        {current === 'access' && <>
          <SecondWayInNudge tick={accessTick} />
          <DisplaysSection toast={toast} />
          <NotificationDevicesSection toast={toast} />
          <PasskeysSection me={me} toast={toast} onChanged={bumpAccess} />
          <RecoveryCodesSection toast={toast} onChanged={bumpAccess} />
          <ConnectedAppsSection toast={toast} />
          <KeysSection toast={toast} />
          <WebhooksSection toast={toast} />
          <YourDataSection hostPortalUrl={me.hostPortalUrl} toast={toast} onImported={reloadCore} />
          <HostingActivitySection />
        </>}
        </div>
        <div className="settings-version">
          <a className="text-link" href="https://docs.kinwall.family" target="_blank" rel="noopener">Help &amp; docs</a>
          {me.version && <> · Kinwall v{me.version}</>}
        </div>
      </div>
    </div>
  )
}

// Cards under a group heading (General tab) drop a heading level, so the outline reads group > card.
const HeadingLevel = createContext<2 | 3>(2)
function SettingsGroup({ title, sub: note, children }: { title: string; sub: string; children: ReactNode }) {
  return (
    <>
      <div className="settings-group-head"><h2 className="settings-group-title">{title}</h2><p className="settings-group-sub">{note}</p></div>
      <HeadingLevel.Provider value={3}>{children}</HeadingLevel.Provider>
    </>
  )
}

function Section({ id, title, icon, children }: { id?: string; title: string; icon?: React.ReactNode; children: React.ReactNode }) {
  const headingId = (id ?? title).toLowerCase().replace(/[^a-z0-9]+/g, '-') // an IDREF can't contain spaces
  const H = useContext(HeadingLevel) === 3 ? 'h3' : 'h2'
  return (
    <section className="settings-section" id={id} aria-labelledby={`${headingId}-title`}>
      <H className="settings-section-title" id={`${headingId}-title`} tabIndex={-1}>{icon}{title}</H>
      {children}
    </section>
  )
}

function GeneralSection({ settings, onSaved, toast, isDisplay }: { settings: ReturnType<typeof useApp>['settings']; onSaved: () => void; toast: (m: string, persist?: boolean) => void; isDisplay: boolean }) {
  const tzs = useMemo(timezoneList, [])
  const save = async (patch: Partial<typeof settings>) => {
    try { await api.updateSettings(patch); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings', true) }
  }
  return (
    <Section title="Household">
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Family name</div>
        </div>
        <input type="text" className="family-name-input" aria-label="Family name" defaultValue={settings.familyName} onBlur={e => e.target.value !== settings.familyName && save({ familyName: e.target.value })} />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">Timezone</div>
        <select className="settings-select" aria-label="Timezone" value={settings.timezone ?? ''} onChange={e => save({ timezone: e.target.value })}>
          {tzs.map(tz => <option key={tz} value={tz}>{tz}</option>)}
        </select>
      </div>
      <div className="settings-row">
        <div className="settings-row-label">Week starts on</div>
        <select className="settings-select" aria-label="Week starts on" value={settings.weekStart} onChange={e => save({ weekStart: Number(e.target.value) as 0 | 1 })}>
          <option value={0}>Sunday</option>
          <option value={1}>Monday</option>
        </select>
      </div>
      {!isDisplay && (
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Default reminder</div>
            <div className="settings-row-sub">Used for events with no reminder of their own.</div>
          </div>
          <select className="settings-select" aria-label="Default reminder" value={settings.defaultReminderMinutes[0] !== undefined ? String(settings.defaultReminderMinutes[0]) : 'none'}
            onChange={e => save({ defaultReminderMinutes: e.target.value === 'none' ? [] : [Number(e.target.value)] })}>
            {REMINDER_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      )}
    </Section>
  )
}

function WeatherSection({ settings, onSaved, toast }: { settings: Settings; onSaved: () => void; toast: (m: string, persist?: boolean) => void }) {
  const save = async (patch: Partial<Settings>) => {
    try { await api.updateSettings(patch); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings', true) }
  }
  return <Section title="Weather"><WeatherLocationRows settings={settings} save={save} toast={toast} /></Section>
}

/** Weather location for the snapshots. The server does the lookup (GET /api/geocode), so this
 * device never talks to the geocoder. */
function WeatherLocationRows({ settings, save, toast }: { settings: Settings; save: (p: Partial<Settings>) => Promise<void>; toast: (m: string, persist?: boolean) => void }) {
  const [editing, setEditing] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<GeocodeResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const search = async () => {
    if (q.trim().length < 2) return
    setBusy(true)
    try {
      const r = await api.geocode(q.trim())
      setResults(r)
      announce(r.length ? `${r.length} place${r.length === 1 ? '' : 's'} found` : 'No places found')
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not search for places', true) } finally { setBusy(false) }
  }
  const pick = async ({ label: _label, ...loc }: GeocodeResult) => {
    await save({ location: loc })
    setEditing(false); setResults(null); setQ('')
    announce(`Weather location set to ${_label}`)
  }
  return (
    <>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Weather location</div>
          <div className="settings-row-sub">{settings.location ? `${settings.location.name} — for the forecast in each person's day.` : 'Set a town to add the forecast to each person\'s day.'}</div>
        </div>
        <div className="settings-inline-btns">
          {settings.location && !editing && <button className="btn btn-secondary" onClick={() => save({ location: null })}>Remove</button>}
          <button className="btn btn-secondary" onClick={() => setEditing(v => !v)} aria-expanded={editing}>{editing ? 'Cancel' : settings.location ? 'Change' : 'Set'}</button>
        </div>
      </div>
      {editing && (
        <div className="weather-search">
          <div className="weather-search-row">
            <input type="search" aria-label="Town or city" placeholder="Town or city" value={q} autoFocus
              onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && search()} />
            <button className="btn btn-primary" onClick={search} disabled={busy || q.trim().length < 2}>{busy ? 'Searching…' : 'Search'}</button>
          </div>
          {results && (results.length === 0
            ? <p className="settings-row-sub">No places match — try the nearest larger town.</p>
            : <ul className="weather-results">{results.map(r => <li key={`${r.lat},${r.lon}`}><button className="btn btn-secondary btn-block" onClick={() => pick(r)}>{r.label}</button></li>)}</ul>)}
          <p className="settings-row-sub">Looked up and fetched by your Kinwall server from Open-Meteo; only the place name and its coordinates are sent.</p>
        </div>
      )}
      {settings.location && (
        <div className="settings-row">
          <div className="settings-row-label">Temperature</div>
          <select className="settings-select" aria-label="Temperature unit" value={settings.temperatureUnit} onChange={e => save({ temperatureUnit: e.target.value as Settings['temperatureUnit'] })}>
            <option value="fahrenheit">°F Fahrenheit</option>
            <option value="celsius">°C Celsius</option>
          </select>
        </div>
      )}
    </>
  )
}

const THEME_MODES: { key: ThemeMode; label: string }[] = [
  { key: 'light', label: 'Light' }, { key: 'dark', label: 'Dark' }, { key: 'auto', label: 'Auto' }, { key: 'scheduled', label: 'Scheduled' },
]
const TEXT_SCALES: { key: TextScale; label: string }[] = [
  { key: 's', label: 'S' }, { key: 'm', label: 'M' }, { key: 'l', label: 'L' }, { key: 'xl', label: 'XL' },
]
const TEXT_SCALE_NAMES: Record<TextScale, string> = { s: 'Small', m: 'Medium', l: 'Large', xl: 'Extra large' }
const DENSITIES: { key: Density; label: string }[] = [
  { key: 'comfortable', label: 'Comfortable' }, { key: 'compact', label: 'Compact' },
]
// Icon-first is per device: the household setting (server) only knows comfortable/compact.
const DEVICE_DENSITIES: { key: DeviceDensity; label: string }[] = [...DENSITIES, { key: 'icons', label: 'Icon-first' }]
const FONTS: { key: FontChoice | ''; label: string }[] = [
  { key: '', label: 'Default (Nunito)' }, { key: 'hyperlegible', label: 'Hyperlegible' }, { key: 'dyslexia', label: 'Dyslexia-friendly (Lexend)' },
]

function AppearanceSection({ settings, onSaved, toast }: { settings: Settings; onSaved: () => void; toast: (m: string, persist?: boolean) => void }) {
  const device = useDeviceAppearance()
  const overridden = [device.themeMode && 'mode', device.skin && 'color scheme', device.custom && 'custom colors', device.textScale && 'text size', device.density && 'density', device.font && 'typeface', device.lowStim && 'stimulation level'].filter(Boolean)
  const save = async (patch: Partial<Settings>) => {
    try { await api.updateSettings(patch); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings', true) }
  }
  return (
    <Section title="Appearance" icon={<PaletteIcon width={16} height={16} />}>
      <p className="settings-row-sub" style={{ margin: '10px 2px 0' }}>
        For the whole family.{overridden.length > 0 && <> This device overrides its {overridden.join(', ')}. See Appearance on this device, below.</>}
      </p>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="settings-row-label" aria-hidden="true">Mode</div>
        <Segmented label="Mode" value={settings.themeMode} onChange={v => save({ themeMode: v })} options={THEME_MODES} />
        {settings.themeMode === 'scheduled' && (
          <div className="row-2" style={{ marginTop: 4 }}>
            <div className="field" style={{ margin: 0 }}><label>Dark from</label><input type="time" value={settings.darkFrom} onChange={e => save({ darkFrom: e.target.value })} /></div>
            <div className="field" style={{ margin: 0 }}><label>Dark to</label><input type="time" value={settings.darkTo} onChange={e => save({ darkTo: e.target.value })} /></div>
          </div>
        )}
      </div>
      <ColorControls
        scheme={settings.colorScheme}
        onScheme={id => { if (id) save({ colorScheme: id }) }}
        household={settings} device={{}} saveSettings={save}
        legacy={{ ...(settings.customColors ?? {}), ...(settings.accent.toUpperCase() !== DEFAULT_ACCENT ? { accent: settings.accent } : {}) }}
        legacyClear={{ customColors: null, accent: DEFAULT_ACCENT }}
        resetLabel="Reset to Meadow"
        onReset={() => save({ colorScheme: 'meadow', customColors: null, accent: DEFAULT_ACCENT, backgroundLight: 'warm', backgroundDark: 'cocoa' })}
      />
      <div className="settings-row">
        <div className="settings-row-label" aria-hidden="true">Text size</div>
        <Segmented label="Text size" value={settings.textScale} onChange={v => save({ textScale: v })}
          options={TEXT_SCALES.map(o => ({ key: o.key, label: <span aria-label={TEXT_SCALE_NAMES[o.key]}>{o.label}</span> }))} />
      </div>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="settings-row-label" aria-hidden="true">Density</div>
        <Segmented label="Density" value={settings.density} onChange={v => save({ density: v })} options={DENSITIES} />
        <div className="settings-row-sub">Compact tightens spacing and fits more on screen, handy for a smaller display. Icon-first is set per device, under Appearance on this device.</div>
      </div>
    </Section>
  )
}

function QuietHoursSection({ settings, onSaved, toast }: { settings: Settings; onSaved: () => void; toast: (m: string, persist?: boolean) => void }) {
  const save = async (patch: Partial<Settings>) => {
    try { await api.updateSettings(patch); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings', true) }
  }
  const quietOn = !!settings.quietFrom && !!settings.quietTo
  return (
    <Section title="Quiet hours">
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="settings-row-label" aria-hidden="true">Quiet hours</div>
        <Segmented label="Quiet hours" value={quietOn ? 'on' : 'off'}
          onChange={v => { if (v === 'off') save({ quietFrom: null, quietTo: null }); else if (!quietOn) save({ quietFrom: '22:00', quietTo: '06:00' }) }}
          options={[{ key: 'off', label: 'Off' }, { key: 'on', label: 'On' }]} />
        {quietOn && (
          <div className="row-2" style={{ marginTop: 4 }}>
            <div className="field" style={{ margin: 0 }}><label>Quiet from</label><input type="time" value={settings.quietFrom ?? ''} onChange={e => e.target.value && save({ quietFrom: e.target.value, quietTo: settings.quietTo })} /></div>
            <div className="field" style={{ margin: 0 }}><label>Quiet to</label><input type="time" value={settings.quietTo ?? ''} onChange={e => e.target.value && save({ quietFrom: settings.quietFrom, quietTo: e.target.value })} /></div>
          </div>
        )}
        <div className="settings-row-sub">Paired wall displays show only a dim clock between these times (or a dim slideshow, set per display under Night screen). Tap the screen to wake it for five minutes. Phones are never affected.</div>
      </div>
    </Section>
  )
}

/** Household chore rules: late credit, streak grace and whether the leaderboard shows at all. */
function ChoreSettingsSection({ settings, onSaved, toast }: { settings: Settings; onSaved: () => void; toast: (m: string, persist?: boolean) => void }) {
  const save = async (patch: Partial<Settings>) => {
    try { await api.updateSettings(patch); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings', true) }
  }
  return (
    <Section title="Chores">
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Late completion credit</div>
          <div className="settings-row-sub">Chores ticked off for a past day earn this share of their points.</div>
        </div>
        <select className="settings-select" aria-label="Late completion credit" value={settings.lateCompletionCredit} onChange={e => save({ lateCompletionCredit: Number(e.target.value) })}>
          {[0, 25, 50, 75, 100].map(p => <option key={p} value={p}>{p}%</option>)}
        </select>
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Streak grace days</div>
          <div className="settings-row-sub">A streak survives this many missed days in any week.</div>
        </div>
        <select className="settings-select" aria-label="Streak grace days" value={settings.streakGraceDays} onChange={e => save({ streakGraceDays: Number(e.target.value) })}>
          {[0, 1, 2, 3].map(n => <option key={n} value={n}>{n === 0 ? 'None' : `${n} day${n === 1 ? '' : 's'}`}</option>)}
        </select>
      </div>
      <div className="toggle-row">
        <label id="leaderboard-label">Show leaderboard</label>
        <button className={`switch ${settings.leaderboardEnabled ? 'on' : ''}`} role="switch" aria-checked={settings.leaderboardEnabled} aria-labelledby="leaderboard-label"
          onClick={() => save({ leaderboardEnabled: !settings.leaderboardEnabled })}><span className="knob" /></button>
      </div>
      <div className="toggle-row">
        <label id="sticker-shop-label">Sticker shop</label>
        <button className={`switch ${settings.stickersEnabled ? 'on' : ''}`} role="switch" aria-checked={settings.stickersEnabled} aria-labelledby="sticker-shop-label"
          onClick={() => save({ stickersEnabled: !settings.stickersEnabled })}><span className="knob" /></button>
      </div>
      {settings.stickersEnabled && (
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Sticker prices</div>
            <div className="settings-row-sub">Kids spend chore points on sticker packs in Activities → Sticker book.</div>
          </div>
          <select className="settings-select" aria-label="Sticker prices" value={settings.stickerPriceScale} onChange={e => save({ stickerPriceScale: Number(e.target.value) })}>
            {[...new Set([0, 50, 100, 150, settings.stickerPriceScale])].sort((a, b) => a - b).map(p => <option key={p} value={p}>{p === 0 ? 'Free' : `${p}%`}</option>)}
          </select>
        </div>
      )}
    </Section>
  )
}

const PUSH_SUB_ID_KEY = 'kinwall.pushSubId'

function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

// iOS Safari (not yet added to the Home Screen) can't do push at all - detect that specifically
// so the message tells the user the actual fix instead of a generic "not supported".
function iosNeedsHomeScreen(): boolean {
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent) && !(window as any).MSStream
  const isStandalone = (navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches
  return isIos && !isStandalone
}

function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const padded = base64url + '='.repeat((4 - (base64url.length % 4)) % 4)
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

const DEFAULT_PUSH_PREFS = { eventReminders: true, dailySummary: false, summaryTime: '07:30', choreNudge: false, choreNudgeTime: '08:00', listUpdates: false }

/** "This display" → Notifications: subscribe/unsubscribe this device, and its own reminder/
 * summary/nudge/list-update preferences. Works for any key scope (display or admin) - it's
 * per-device, not a household setting. */
function NotificationsSection({ toast }: { toast: (m: string, persist?: boolean) => void }) {
  const { members } = useApp()
  const [sub, setSub] = useState<PushSubscription | null | undefined>(undefined) // undefined = still checking
  const [busy, setBusy] = useState(false)

  const reconcile = async () => {
    let storedId: string | null = null
    try { storedId = localStorage.getItem(PUSH_SUB_ID_KEY) } catch { /* storage blocked */ }
    if (!storedId) { setSub(null); return }
    try {
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      if (!existing) { localStorage.removeItem(PUSH_SUB_ID_KEY); setSub(null); return }
      const mine = await api.getPushSubscriptions()
      setSub(mine.find(s => s.id === storedId) ?? null)
    } catch {
      setSub(null)
    }
  }
  useEffect(() => { if (pushSupported()) reconcile() }, [])

  const turnOn = async () => {
    setBusy(true)
    try {
      const perm = await Notification.requestPermission() // must run from this tap
      if (perm !== 'granted') { toast('Notifications permission was not granted', true); return }
      const { publicKey } = await api.getVapidPublicKey()
      const reg = await navigator.serviceWorker.ready
      const pushSub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) as BufferSource })
      const created = await api.subscribePush({ subscription: pushSub.toJSON() as PushSubscriptionJSON, deviceName: navigator.platform || 'This device' })
      localStorage.setItem(PUSH_SUB_ID_KEY, created.id)
      setSub(created)
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not turn on notifications', true)
    } finally {
      setBusy(false)
    }
  }

  const turnOff = async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.ready
      const existing = await reg.pushManager.getSubscription()
      if (existing) await existing.unsubscribe()
      if (sub) await api.deletePushSubscription(sub.id)
    } catch { /* best effort - clear locally regardless */ } finally {
      try { localStorage.removeItem(PUSH_SUB_ID_KEY) } catch { /* storage blocked */ }
      setSub(null)
      setBusy(false)
    }
  }

  const savePrefs = async (patch: Partial<PushSubscription['prefs']>) => {
    if (!sub) return
    try {
      const updated = await api.updatePushSubscription(sub.id, { prefs: patch })
      setSub(updated)
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save', true) }
  }
  const saveMembers = async (memberIds: string[]) => {
    if (!sub) return
    try { setSub(await api.updatePushSubscription(sub.id, { memberIds })) } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save', true) }
  }
  const sendTest = async () => {
    if (!sub) return
    try { await api.testPush(sub.id); toast('Test notification sent') } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not send test', true) }
  }

  if (!pushSupported()) {
    return (
      <Section title="Notifications" icon={<BellIcon width={16} height={16} />}>
        <p className="settings-row-sub">
          {iosNeedsHomeScreen()
            ? 'Add Kinwall to your Home Screen first (Share → Add to Home Screen) — iPhone only supports notifications for installed apps, on iOS 16.4 or later.'
            : 'This browser doesn\'t support push notifications.'}
        </p>
      </Section>
    )
  }

  const prefs = sub?.prefs ?? DEFAULT_PUSH_PREFS

  return (
    <Section title="Notifications" icon={<BellIcon width={16} height={16} />}>
      {sub === undefined ? (
        <div className="settings-row-sub">Checking…</div>
      ) : !sub ? (
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <button className="btn btn-primary" onClick={turnOn} disabled={busy}>Turn on notifications</button>
        </div>
      ) : (
        <>
          <div className="toggle-row">
            <label>Event reminders</label>
            <button className={`switch ${prefs.eventReminders ? 'on' : ''}`} role="switch" aria-checked={prefs.eventReminders} aria-label="Event reminders" onClick={() => savePrefs({ eventReminders: !prefs.eventReminders })}><span className="knob" /></button>
          </div>
          <div className="settings-row">
            <div className="toggle-row" style={{ flex: 1 }}>
              <label>Daily summary</label>
              <button className={`switch ${prefs.dailySummary ? 'on' : ''}`} role="switch" aria-checked={prefs.dailySummary} aria-label="Daily summary" onClick={() => savePrefs({ dailySummary: !prefs.dailySummary })}><span className="knob" /></button>
            </div>
            {prefs.dailySummary && <input type="time" aria-label="Daily summary time" value={prefs.summaryTime} onChange={e => savePrefs({ summaryTime: e.target.value })} />}
          </div>
          <div className="settings-row">
            <div className="toggle-row" style={{ flex: 1 }}>
              <label>Chore reminder</label>
              <button className={`switch ${prefs.choreNudge ? 'on' : ''}`} role="switch" aria-checked={prefs.choreNudge} aria-label="Chore reminder" onClick={() => savePrefs({ choreNudge: !prefs.choreNudge })}><span className="knob" /></button>
            </div>
            {prefs.choreNudge && <input type="time" aria-label="Chore reminder time" value={prefs.choreNudgeTime} onChange={e => savePrefs({ choreNudgeTime: e.target.value })} />}
          </div>
          <div className="toggle-row">
            <label>List updates</label>
            <button className={`switch ${prefs.listUpdates ? 'on' : ''}`} role="switch" aria-checked={prefs.listUpdates} aria-label="List updates" onClick={() => savePrefs({ listUpdates: !prefs.listUpdates })}><span className="knob" /></button>
          </div>
          <MemberPicker members={members} selected={sub.memberIds} onChange={saveMembers} label="Which family members?" noneLabel="Everyone" />
          <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
            <button className="btn btn-secondary" onClick={sendTest}>Send test</button>
            <button className="btn btn-danger" onClick={turnOff} disabled={busy}>Turn off</button>
          </div>
        </>
      )}
    </Section>
  )
}

// Admin Access tab: subscribed devices (read-only list + remove) and a "send a message now" form.
function NotificationDevicesSection({ toast }: { toast: (m: string, persist?: boolean) => void }) {
  const dialog = useDialog()
  const [subs, setSubs] = useState<PushSubscription[]>([])
  const load = () => { api.getPushSubscriptions().then(setSubs).catch(() => {}) }
  useEffect(load, [])

  const remove = async (s: PushSubscription) => {
    if (!await dialog.confirm({ title: `Remove "${s.deviceName}"?`, body: 'That device stops getting notifications.', confirmLabel: 'Remove', danger: true })) return
    try { await api.deletePushSubscription(s.id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not remove device', true) }
  }

  return (
    <Section title="Notifications" icon={<BellIcon width={16} height={16} />}>
      {subs.length === 0 ? (
        <p className="settings-row-sub">No devices have turned on notifications yet. Each phone turns them on in <a className="text-link" href="#/settings?tab=general">Settings → General</a>.</p>
      ) : subs.map(s => (
        <div key={s.id} className="key-item">
          <div>
            <div className="settings-row-label">{s.deviceName}</div>
            <div className="settings-row-sub">
              added {new Date(s.createdAt).toLocaleDateString()}{s.lastSuccessAt ? ` · delivered ${new Date(s.lastSuccessAt).toLocaleDateString()}` : ' · never delivered'}
            </div>
          </div>
          <button className="icon-btn" onClick={() => remove(s)} aria-label={`Remove ${s.deviceName}`}><TrashIcon width={16} height={16} /></button>
        </div>
      ))}
      <SendMessageForm />
    </Section>
  )
}

/** "Send a message now": pushes to devices following the picked members and lands in everyone's
 * notification feed. Also opened from the header bell's sheet (Notifications.tsx). */
export function SendMessageForm({ onSent }: { onSent?: () => void }) {
  const { members, toast } = useApp()
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const [sending, setSending] = useState(false)
  const send = async () => {
    if (!title.trim() || !body.trim()) return
    setSending(true)
    try {
      const result = await api.sendNotification({ title: title.trim(), body: body.trim(), memberIds: memberIds.length ? memberIds : undefined })
      toast(`Sent to ${result.sent} device${result.sent === 1 ? '' : 's'}`)
      setTitle(''); setBody('')
      onSent?.()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not send', true) } finally { setSending(false) }
  }
  return (
    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8, marginTop: 10 }}>
      <div className="settings-row-label">Send a message</div>
      <div className="field" style={{ margin: 0 }}>
        <label>Title</label>
        <input type="text" aria-label="Title" value={title} onChange={e => setTitle(e.target.value)} placeholder="Dinner's ready" />
      </div>
      <div className="field" style={{ margin: 0 }}>
        <label>Message</label>
        <input type="text" aria-label="Message" value={body} onChange={e => setBody(e.target.value)} placeholder="Come to the kitchen 🍝" />
      </div>
      <MemberPicker members={members} selected={memberIds} onChange={setMemberIds} label="To" noneLabel="Everyone" />
      <button className="btn btn-primary" onClick={send} disabled={sending || !title.trim() || !body.trim()}>Send now</button>
    </div>
  )
}

const NAV_PREF_OPTIONS: { key: NavPref; label: string }[] = [
  { key: 'auto', label: 'Auto' }, { key: 'bottom', label: 'Bottom' }, { key: 'left', label: 'Left' }, { key: 'right', label: 'Right' },
]

/** Per-device nav position (bottom tab bar vs. a side rail) — kept in localStorage, not synced
 * settings, so each wall display / phone / tablet can pick its own. When `keyName` is passed
 * (display-scoped key), this is the ONLY Settings section a display ever sees — it also shows
 * what this display is paired as and an unpair action. */
const newSchemeId = () => `custom-${Math.random().toString(36).slice(2, 10)}` as const

/** Color scheme chips (built-in, Seasonal and the family's saved schemes), the same for the
 * household and for one device, plus Customize / Edit, which open the scheme editor sheet. On a
 * device, `scheme` undefined means "follow the household" and the first chip says so. Saved
 * schemes belong to the household, so a device's editor saves through `saveSettings` too. */
function ColorControls({ scheme, householdScheme, onScheme, household, device, saveSettings, legacy, legacyClear, onClearLegacy, resetLabel, onReset }: {
  scheme: ColorScheme | undefined
  householdScheme?: ColorScheme // set on a device: shows the Household chip
  onScheme: (id: ColorScheme | undefined) => void
  household: Settings; device: DeviceAppearance
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  legacy: CustomColors // loose custom colors from before saved schemes, at this level
  legacyClear?: Partial<Settings> // household: the patch that clears them
  onClearLegacy?: () => void // device: clears them locally
  resetLabel: string; onReset: () => void
}) {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
  const customs = household.customSchemes ?? []
  const { skin } = resolveColors(household, device)
  const [editing, setEditing] = useState<{ draft: CustomScheme; isNew: boolean; fromLegacy?: boolean } | null>(null)
  const nameOf = (id: ColorScheme) => id === 'seasonal' ? `Seasonal (${getSkin(seasonalSkinId()).name})` : findSkin(id, customs).name
  const dotsFor = (id: ColorScheme) => { const k = tokensFor(id === 'seasonal' ? getSkin(seasonalSkinId()) : findSkin(id, customs), dark); return [k.bg, k.card, k.accent] }
  const chip = (id: ColorScheme | undefined, label: ReactNode, ariaName: string) => {
    const active = scheme === id
    const dots = dotsFor(id ?? householdScheme ?? 'meadow')
    return (
      <button key={id ?? 'household'} className={`chip ${active ? 'active' : ''}`} aria-pressed={active}
        style={{ '--chip-color': dots[2] } as CSSProperties}
        onClick={() => { onScheme(id); announce(`${ariaName} color scheme`) }}>
        <span className="skin-dots" aria-hidden="true">{dots.map((c, i) => <span key={i} style={{ background: c }} />)}</span>
        {label}
      </button>
    )
  }
  const activeCustom = customs.find(c => c.id === skin.id)
  const startFrom = (base: typeof skin, name: string): CustomScheme =>
    ({ id: newSchemeId(), name: name.slice(0, 30), emoji: base.emoji, light: paletteOf(base, false), dark: paletteOf(base, true) })
  const hasLegacy = Object.keys(legacy).length > 0
  const saveScheme = async (c: CustomScheme, isNew: boolean, fromLegacy?: boolean) => {
    const list = isNew ? [...customs, c] : customs.map(x => x.id === c.id ? c : x)
    const selectHere = isNew && !householdScheme // household editor: a new scheme becomes the family's
    await saveSettings({ customSchemes: list, ...(selectHere ? { colorScheme: c.id } : {}), ...(fromLegacy && legacyClear ? legacyClear : {}) })
    if (isNew && householdScheme) onScheme(c.id) // device editor: this device switches to it
    if (fromLegacy) onClearLegacy?.()
    announce(isNew ? `${c.name} saved and selected` : `${c.name} saved`)
    setEditing(null)
  }
  const deleteScheme = async (c: CustomScheme) => {
    await saveSettings({ customSchemes: customs.filter(x => x.id !== c.id), ...(household.colorScheme === c.id ? { colorScheme: 'meadow' } : {}) })
    if (device.skin === c.id || scheme === c.id) onScheme(householdScheme ? undefined : 'meadow')
    announce(`${c.name} deleted`)
    setEditing(null)
  }
  return (
    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div className="settings-row-label" aria-hidden="true">Color scheme</div>
      <div className="chip-row" role="group" aria-label="Color scheme">
        {householdScheme && chip(undefined, <>Household · {nameOf(householdScheme)}</>, 'Household')}
        {chip('seasonal', <><span aria-hidden="true">🗓️</span>Seasonal</>, 'Seasonal')}
        {SKINS.map(k => chip(k.id as ColorScheme, <><span aria-hidden="true">{k.emoji}</span>{k.name}</>, k.name))}
        {customs.map(c => chip(c.id as ColorScheme, <><span aria-hidden="true">{c.emoji || '🎨'}</span>{c.name}</>, c.name))}
      </div>
      {scheme === 'seasonal' && <div className="settings-row-sub">Switches on its own through the year: Winter, Spring, Summer and Autumn, plus Harvest and Festive around the holidays.</div>}
      <div className="scheme-actions">
        {activeCustom && <button className="btn btn-secondary" onClick={() => setEditing({ draft: activeCustom, isNew: false })}>Edit {activeCustom.name}</button>}
        {customs.length < 10
          ? <button className="btn btn-secondary" onClick={() => setEditing({ draft: startFrom(skin, activeCustom ? `${skin.name} copy` : `My ${skin.name}`), isNew: true })}>{activeCustom ? 'Duplicate' : 'Customize'}</button>
          : <span className="settings-row-sub">The family has 10 saved schemes, the most it can keep. Delete one to make another.</span>}
      </div>
      {hasLegacy && (
        <div className="scheme-legacy" role="note">
          <span>Custom colors from an earlier version are applied on top of this scheme{householdScheme ? ' on this device' : ''}.</span>
          <div className="scheme-actions">
            <button className="btn btn-secondary" onClick={() => {
              const light = { ...paletteOf(skin, false), ...legacy } as Palette
              const darkP = { ...paletteOf(skin, true), ...(legacy.accent ? { accent: legacy.accent } : {}) }
              setEditing({ draft: { id: newSchemeId(), name: 'Custom', emoji: '🎨', light, dark: darkP }, isNew: true, fromLegacy: true })
            }}>Save as a scheme</button>
            <button className="btn btn-secondary" onClick={() => { if (legacyClear) void saveSettings(legacyClear); onClearLegacy?.(); announce('Custom colors removed') }}>Remove them</button>
          </div>
        </div>
      )}
      <button className="btn btn-secondary" onClick={onReset}>{resetLabel}</button>
      {editing && <SchemeSheet draft={editing.draft} isNew={editing.isNew} onClose={() => setEditing(null)}
        onSave={c => saveScheme(c, editing.isNew, editing.fromLegacy)} onDelete={editing.isNew ? undefined : () => deleteScheme(editing.draft)} />}
    </div>
  )
}

const PALETTE_FIELDS: { key: keyof Palette; label: string }[] = [
  { key: 'bg', label: 'Background' }, { key: 'card', label: 'Cards' }, { key: 'text', label: 'Text' }, { key: 'accent', label: 'Accent' },
]

/** One saved scheme: both modes side by side, each with a live preview and its contrast checks.
 * Save stays off until every check passes in both modes. */
function SchemeSheet({ draft, isNew, onClose, onSave, onDelete }: {
  draft: CustomScheme; isNew: boolean; onClose: () => void; onSave: (c: CustomScheme) => Promise<void>; onDelete?: () => Promise<void>
}) {
  const [c, setC] = useState(draft)
  const [busy, setBusy] = useState(false)
  const dialog = useDialog()
  const setColor = (mode: 'light' | 'dark', key: keyof Palette, v: string) => setC(x => ({ ...x, [mode]: { ...x[mode], [key]: v } }))
  const checks = { light: paletteChecks(c.light, false), dark: paletteChecks(c.dark, true) }
  const failing = [...checks.light, ...checks.dark].filter(k => k.ratio < 4.5).length
  const canSave = !!c.name.trim() && failing === 0 && !busy
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn() } finally { setBusy(false) } }
  return (
    <Sheet title={isNew ? 'New color scheme' : `Edit ${draft.name}`} onClose={onClose}
      actions={<>
        {onDelete && <button className="btn btn-danger" disabled={busy} onClick={async () => {
          if (await dialog.confirm({ title: `Delete ${draft.name}?`, body: 'Screens using it go back to Meadow.', confirmLabel: 'Delete', danger: true })) run(onDelete)
        }}>Delete</button>}
        <button className="btn btn-primary" disabled={!canSave} onClick={() => run(() => onSave({ ...c, name: c.name.trim() }))}>{isNew ? 'Save and use' : 'Save'}</button>
      </>}>
      <div className="row-2">
        <div className="field"><label htmlFor="scheme-name">Name</label><input id="scheme-name" type="text" maxLength={30} value={c.name} onChange={e => setC({ ...c, name: e.target.value })} /></div>
        <div className="field scheme-emoji"><label htmlFor="scheme-emoji">Emoji</label><input id="scheme-emoji" type="text" maxLength={8} value={c.emoji} onChange={e => setC({ ...c, emoji: e.target.value })} /></div>
      </div>
      <div className="scheme-modes">
        {(['light', 'dark'] as const).map(mode => {
          const b = baseFromPalette(c[mode], mode === 'dark')
          return (
            <section key={mode} className="scheme-mode" aria-label={`${mode === 'light' ? 'Light' : 'Dark'} mode`}>
              <h3 className="scheme-mode-title">{mode === 'light' ? '☀️ Light mode' : '🌙 Dark mode'}</h3>
              <div className="scheme-preview" style={{ background: b.bg, borderColor: b.border }} aria-hidden="true">
                <div className="scheme-preview-card" style={{ background: b.card, color: b.text, borderColor: b.border }}>
                  <strong>Soccer practice</strong>
                  <span style={{ color: b.textDim }}>4:00 PM · Park field</span>
                  <span className="scheme-preview-btn" style={{ background: accentFill(b.accent) }}>Done</span>
                </div>
              </div>
              {PALETTE_FIELDS.map(f => (
                <div key={f.key} className="device-pref-row">
                  <span>{f.label}</span>
                  <input type="color" value={c[mode][f.key]} aria-label={`${f.label}, ${mode} mode`} onChange={e => setColor(mode, f.key, e.target.value)} />
                </div>
              ))}
              <ul className="scheme-checks">
                {checks[mode].map(k => (
                  <li key={k.label}><span>{k.label}</span><span className={`contrast-badge ${k.ratio >= 4.5 ? 'ok' : 'bad'}`}>{k.ratio >= 4.5 ? '✓' : 'Too low'} {k.ratio.toFixed(1)}:1</span></li>
                ))}
              </ul>
            </section>
          )
        })}
      </div>
      <p className="settings-row-sub">{failing ? `${failing} check${failing === 1 ? '' : 's'} below 4.5:1. Adjust the colors until every check passes to save.` : 'Readable in both modes. Accent buttons adjust themselves so their labels stay readable.'}</p>
    </Sheet>
  )
}

/** "On this device" overrides of the household appearance - each defaults to the household value. */
function DeviceAppearanceRows() {
  const { settings, reloadCore, toast } = useApp()
  const saveHousehold = async (patch: Partial<Settings>) => {
    try { await api.updateSettings(patch); reloadCore() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings', true) }
  }
  const device = useDeviceAppearance()
  const set = (patch: DeviceAppearance) => setDeviceAppearance({ ...device, ...patch })
  const rows = [
    { key: 'themeMode' as const, label: 'Mode', options: THEME_MODES },
    { key: 'textScale' as const, label: 'Text size', options: TEXT_SCALES.map(o => ({ ...o, label: TEXT_SCALE_NAMES[o.key] })) },
    { key: 'density' as const, label: 'Density', options: DEVICE_DENSITIES },
  ]
  return (
    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div className="settings-row-sub">Leave a setting on Household to follow the family's. Pick anything else to change it on this device only.</div>

      {rows.slice(0, 1).map(r => {
        const household = r.options.find(o => o.key === settings[r.key])?.label ?? ''
        return (
          <div key={r.key} className="device-pref-row">
            <span>{r.label}</span>
            <select className="settings-select" aria-label={`${r.label} on this device`} value={device[r.key] ?? ''} onChange={e => set({ [r.key]: e.target.value || undefined })}>
              <option value="">Household ({household})</option>
              {r.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
        )
      })}
      <ColorControls
        scheme={device.skin} householdScheme={settings.colorScheme}
        onScheme={id => set({ skin: id })}
        household={settings} device={device} saveSettings={saveHousehold}
        legacy={device.custom ?? {}} onClearLegacy={() => set({ custom: undefined })}
        resetLabel="Use household colors"
        onReset={() => { set({ skin: undefined, custom: undefined }); announce('This device uses the household colors') }}
      />

      {rows.slice(1).map(r => {
        const household = r.options.find(o => o.key === settings[r.key])?.label ?? ''
        return (
          <div key={r.key} className="device-pref-row">
            <span>{r.label}</span>
            <select className="settings-select" aria-label={`${r.label} on this device`} value={device[r.key] ?? ''} onChange={e => set({ [r.key]: e.target.value || undefined })}>
              <option value="">Household ({household})</option>
              {r.options.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
            </select>
          </div>
        )
      })}
      <div className="device-pref-row">
        <span>Typeface</span>
        <select className="settings-select" aria-label="Typeface on this device" value={device.font ?? ''} onChange={e => set({ font: (e.target.value || undefined) as FontChoice | undefined })}>
          {FONTS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </div>
      <div className="toggle-row">
        <label id="lowstim-label">Low-stimulation mode</label>
        <button className={`switch ${device.lowStim ? 'on' : ''}`} role="switch" aria-checked={!!device.lowStim} aria-labelledby="lowstim-label" aria-describedby="lowstim-sub"
          onClick={() => { set({ lowStim: !device.lowStim || undefined }); announce(device.lowStim ? 'Low-stimulation mode off' : 'Low-stimulation mode on') }}><span className="knob" /></button>
      </div>
      <div className="settings-row-sub" id="lowstim-sub" style={{ marginTop: -8 }}>Flat, calm colors, no motion and more room. Colors become a thin bar beside each event.</div>
    </div>
  )
}

/** Device-only behavior for this screen: member focus, locked calendar view, Now / Next card and
 * transition warnings. Stored alongside the device appearance. */
function ScreenFocusRows() {
  const { members } = useApp()
  const isPhone = useIsPhone()
  const device = useDeviceAppearance()
  const set = (patch: DeviceAppearance) => setDeviceAppearance({ ...device, ...patch })
  const focus = members.find(m => m.id === device.focusMemberId)
  const views: { key: LockedView | ''; label: string }[] = [
    { key: '', label: 'Off' }, { key: 'week', label: isPhone ? '3 Day' : 'Week' }, { key: 'day', label: 'Day' }, { key: 'month', label: 'Month' }, { key: 'schedule', label: 'Schedule' }, { key: 'board', label: 'Board' },
  ]
  return (
    <>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <div className="device-pref-row">
          <span>Show only</span>
          <select className="settings-select" aria-label="Show only" value={focus?.id ?? ''}
            onChange={e => { set({ focusMemberId: e.target.value || undefined }); announce(e.target.value ? `Showing only ${members.find(m => m.id === e.target.value)?.name}` : 'Showing everyone') }}>
            <option value="">Everyone</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}
          </select>
        </div>
        {focus && (
          <div className="toggle-row">
            <label id="focus-shared-label">Also show things for everyone</label>
            <button className={`switch ${!device.focusHideShared ? 'on' : ''}`} role="switch" aria-checked={!device.focusHideShared} aria-labelledby="focus-shared-label"
              onClick={() => set({ focusHideShared: !device.focusHideShared || undefined })}><span className="knob" /></button>
          </div>
        )}
        <div className="settings-row-sub">{focus ? `Only ${focus.name}'s events, chores and lists show here${device.focusHideShared ? '' : ', plus ones with nobody assigned'}.` : 'Pin this screen to one person — handy for a display in a bedroom.'}</div>
        <div className="device-pref-row">
          <span>Lock view</span>
          <select className="settings-select" aria-label="Lock calendar view" value={device.lockView ?? ''} onChange={e => set({ lockView: (e.target.value || undefined) as LockedView | undefined })}>
            {views.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
        </div>
      </div>
    </>
  )
}

/** Now / Next and transition warnings on this device. */
function TimeCueRows() {
  const device = useDeviceAppearance()
  const set = (patch: DeviceAppearance) => setDeviceAppearance({ ...device, ...patch })
  const warnings = device.warnings ?? []
  const toggleWarning = (m: number) => {
    const next = warnings.includes(m) ? warnings.filter(x => x !== m) : [...warnings, m].sort((a, b) => b - a)
    set({ warnings: next.length ? next : undefined })
  }
  const nowNext = device.nowNext ?? true
  return (
    <>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="toggle-row">
          <label id="nownext-label">Now / Next</label>
          <button className={`switch ${nowNext ? 'on' : ''}`} role="switch" aria-checked={nowNext} aria-labelledby="nownext-label" onClick={() => set({ nowNext: !nowNext })}><span className="knob" /></button>
        </div>
        <div className="settings-row-sub">What's on now and what's next today, with a countdown, above the calendar.</div>
      </div>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="settings-row-label" aria-hidden="true">Transition warnings</div>
        <div className="chip-row" role="group" aria-label="Transition warnings">
          <button className={`chip ${warnings.length === 0 ? 'active' : ''}`} aria-pressed={warnings.length === 0} onClick={() => set({ warnings: undefined })}>Off</button>
          {[10, 5, 1].map(m => (
            <button key={m} className={`chip ${warnings.includes(m) ? 'active' : ''}`} aria-pressed={warnings.includes(m)} onClick={() => toggleWarning(m)}>{m} min</button>
          ))}
        </div>
        {warnings.length > 0 && (
          <div className="toggle-row">
            <label id="warning-sound-label">Sound</label>
            <button className={`switch ${device.warningSound ? 'on' : ''}`} role="switch" aria-checked={!!device.warningSound} aria-labelledby="warning-sound-label"
              onClick={() => set({ warningSound: !device.warningSound || undefined })}><span className="knob" /></button>
          </div>
        )}
        <div className="settings-row-sub">A calm banner before the next event (or its leave-by time). Pick one or more. Never during quiet hours.</div>
      </div>
    </>
  )
}

/** Quiet hours on this display: the plain clock, or a dim slideshow cycling through the picked
 * sources (Screensaver.tsx). */
const SAVER_OPTIONS: { key: SaverSource; label: string }[] = [
  { key: 'drawings', label: 'Drawings' }, { key: 'photos', label: 'Family photos' }, { key: 'art', label: 'Art (The Met)' }, { key: 'nature', label: 'Nature' },
]
function ScreensaverRows() {
  const device = useDeviceAppearance()
  const set = (patch: DeviceAppearance) => setDeviceAppearance({ ...device, ...patch })
  const sources = device.saverSources ?? []
  const toggle = (k: SaverSource) => {
    const next = sources.includes(k) ? sources.filter(x => x !== k) : SAVER_OPTIONS.map(o => o.key).filter(x => x === k || sources.includes(x))
    set({ saverSources: next.length ? next : undefined })
  }
  const hasDrawings = sources.includes('drawings')
  const [noDrawings, setNoDrawings] = useState(false)
  useEffect(() => {
    if (hasDrawings) countDrawings().then(n => setNoDrawings(n === 0)).catch(() => setNoDrawings(true))
  }, [hasDrawings])
  const services = [sources.includes('art') && 'The Metropolitan Museum of Art (public-domain works)', sources.includes('nature') && 'Lorem Picsum (free Unsplash photos)'].filter(Boolean).join(' and ')
  return (
    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div className="settings-row-label" aria-hidden="true">During quiet hours show</div>
      <div className="chip-row" role="group" aria-label="During quiet hours show">
        <button className={`chip ${sources.length === 0 ? 'active' : ''}`} aria-pressed={sources.length === 0} onClick={() => set({ saverSources: undefined })}>Clock only</button>
        {SAVER_OPTIONS.map(o => (
          <button key={o.key} className={`chip ${sources.includes(o.key) ? 'active' : ''}`} aria-pressed={sources.includes(o.key)} onClick={() => toggle(o.key)}>{o.label}</button>
        ))}
      </div>
      {sources.length > 1 && <div className="settings-row-sub">Takes turns between the ones you pick.</div>}
      {hasDrawings && noDrawings && <div className="settings-row-sub">No drawings on this display yet — open Activities → Paint.{sources.length === 1 && ' Until then it shows the clock.'}</div>}
      {services && <div className="settings-row-sub">Pictures are fetched by this display directly from {services}; {services.includes(' and ') ? 'they' : 'it'} will see this device's address.</div>}
      {sources.length > 0 && <>
        <div className="settings-row-label" aria-hidden="true">Change picture every</div>
        <Segmented label="Change picture every" value={String(device.saverEvery ?? 5)} onChange={v => set({ saverEvery: v === '5' ? undefined : Number(v) })}
          options={[2, 5, 10, 20].map(m => ({ key: String(m), label: `${m} min` }))} />
        <div className="settings-row-label" aria-hidden="true">Brightness</div>
        <Segmented label="Brightness" value={device.saverBright ?? 'low'} onChange={v => set({ saverBright: v === 'medium' ? 'medium' : undefined })}
          options={[{ key: 'low', label: 'Low' }, { key: 'medium', label: 'Medium' }]} />
        <div className="toggle-row">
          <label id="saver-clock-label">Show clock</label>
          <button className={`switch ${device.saverClock !== false ? 'on' : ''}`} role="switch" aria-checked={device.saverClock !== false} aria-labelledby="saver-clock-label"
            onClick={() => set({ saverClock: device.saverClock === false ? undefined : false })}><span className="knob" /></button>
        </div>
      </>}
      <button className="btn btn-secondary" onClick={() => window.dispatchEvent(new Event(SAVER_PREVIEW_EVENT))}>Preview screensaver</button>
      <div className="settings-row-sub">Shows what this screen does overnight for 20 seconds. Tap or press Escape to end it. Only paired wall displays dim on their own.</div>
    </div>
  )
}

function ThisDisplaySection({ keyName }: { keyName?: string }) {
  const isPhone = useIsPhone()
  const { pref } = useNavMode()
  return (
    <Section title="This display" icon={<MonitorIcon width={16} height={16} />}>
      {keyName !== undefined && (
        <div className="settings-row">
          <div className="settings-row-label">Paired as {keyName || 'this display'}</div>
        </div>
      )}
      <ScreenFocusRows />
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="settings-row-label" aria-hidden="true">Navigation position</div>
        <Segmented label="Navigation position" value={pref} onChange={setNavPref} options={NAV_PREF_OPTIONS} disabled={isPhone} style={isPhone ? { opacity: 0.5 } : undefined} />
        <div className="settings-row-sub">{isPhone ? 'Phones always use the bottom bar.' : 'Where the Calendar, Chores and Lists buttons sit.'}</div>
      </div>
    </Section>
  )
}

/** Stuck-build reload, and unpairing for a display key. */
function TroubleshootSection({ keyName }: { keyName?: string }) {
  const dialog = useDialog()
  const unpair = async () => {
    if (!await dialog.confirm({ title: 'Unpair this display?', body: 'You\'ll need to pair it again from an admin device to use it here.', confirmLabel: 'Unpair', danger: true })) return
    clearKey()
    location.reload()
  }
  // For a Home Screen app stuck on an old build: iOS can keep the page alive in memory, and a plain
  // reload may be served from HTTP cache. Drop any Cache Storage / service workers, re-fetch the page
  // bypassing the cache, then load it under a fresh URL. Keeps the stored key and preferences.
  const [refreshing, setRefreshing] = useState(false)
  const hardReload = async () => {
    setRefreshing(true)
    try {
      if ('caches' in window) await Promise.all((await caches.keys()).map(k => caches.delete(k)))
      // Don't unregister the service worker - it's what push notifications run through. Just make
      // sure it's re-checked for an update instead.
      if ('serviceWorker' in navigator) await Promise.all((await navigator.serviceWorker.getRegistrations()).map(r => r.update().catch(() => {})))
      await fetch(location.pathname, { cache: 'reload' })
    } catch { /* best effort - reload regardless */ }
    const url = new URL(location.href)
    url.searchParams.set('v', Date.now().toString(36))
    location.replace(url.toString())
  }
  return (
    <Section title="Troubleshooting">
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <button className="btn btn-secondary" onClick={hardReload} disabled={refreshing}>{refreshing ? 'Reloading…' : 'Clear cache and reload'}</button>
        <div className="settings-row-sub">Loads the latest version of Kinwall if this device seems stuck on an old one. You stay signed in.</div>
      </div>
      {keyName !== undefined && (
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <button className="btn btn-danger" onClick={unpair}>Unpair this display</button>
          <div className="settings-row-sub">Clears the key stored on this device and returns to the pairing screen. This doesn't revoke the key. Do that from an admin device under Settings → Access → Displays.</div>
        </div>
      )}
    </Section>
  )
}

function MembersSection({ members, onChanged, toast, canManage = true }: { members: Member[]; onChanged: () => void; toast: (m: string, persist?: boolean) => void; canManage?: boolean }) {
  const [edit, setEdit] = useState<Member | 'new' | null>(null)
  return (
    <Section title="Members">
      <div className="member-row-list">
        {members.map(m => (
          <div key={m.id} className="member-list-item" {...pressable(() => setEdit(m))} aria-label={`Edit ${m.name}`}>
            <div className="member-avatar-sm" aria-hidden="true" style={{ background: m.color, color: inkFor(m.color) }}>{m.avatar}</div>
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

function MemberEditSheet({ member, canDelete, onClose, onSaved, toast }: { member: Member | null; canDelete: boolean; onClose: () => void; onSaved: () => void; toast: (m: string, persist?: boolean) => void }) {
  const dialog = useDialog()
  const [name, setName] = useState(member?.name ?? '')
  const [color, setColor] = useState(member?.color ?? MEMBER_PALETTE[0])
  const [avatar, setAvatar] = useState(member?.avatar ?? MEMBER_EMOJI[0])
  // Birthday: a date input always needs a year, so "don't know the year" keeps a placeholder one
  // (2000, a leap year: Feb 29 still fits) and saves --MM-DD.
  const [bday, setBday] = useState(member?.birthday?.replace(/^--/, '2000-') ?? '')
  const [noYear, setNoYear] = useState(!!member?.birthday?.startsWith('--'))
  const birthday = !bday ? null : noYear ? `--${bday.slice(5)}` : bday
  const save = async () => {
    if (!name.trim() || !isValidAvatar(avatar)) return
    try {
      if (member) await api.updateMember(member.id, { name: name.trim(), color, avatar, birthday })
      else await api.createMember({ name: name.trim(), color, avatar, birthday })
      onSaved()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save member', true) }
  }
  const del = async () => {
    if (!member) return
    if (!await dialog.confirm({ title: `Remove ${member.name}?`, body: 'Their chores and tags are unassigned.', confirmLabel: 'Remove', danger: true })) return
    try { await api.deleteMember(member.id); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete member', true) }
  }
  return (
    <Sheet title={member ? 'Edit member' : 'Add member'} onClose={onClose}
      actions={<>{member && canDelete && <button className="btn btn-danger" onClick={del} aria-label="Delete"><TrashIcon width={18} height={18} /></button>}<button className="btn btn-primary" onClick={save} disabled={!name.trim() || !isValidAvatar(avatar)}>Save</button></>}>
      <div className="field"><label>Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus={!member} /></div>
      <div className="field">
        <label>Color</label>
        <div className="color-swatch-row">
          {MEMBER_PALETTE.map(c => <button key={c} className={`color-swatch ${color === c ? 'active' : ''}`} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} aria-label={colorName(c)} />)}
          <CustomColorSwatch value={color} presets={MEMBER_PALETTE} onChange={hex => setColor(hex)} label="Custom member color" />
        </div>
      </div>
      <div className="field">
        <label>Avatar</label>
        <div className="emoji-swatch-row">
          {MEMBER_EMOJI.map(e => <button key={e} className={`emoji-swatch ${avatar === e ? 'active' : ''}`} aria-pressed={avatar === e} onClick={() => setAvatar(e)}>{e}</button>)}
        </div>
        <AnyEmojiField value={avatar} onChange={setAvatar} allowInitials />
      </div>
      <div className="field">
        <label htmlFor="member-birthday">Birthday <span className="settings-row-sub">(optional — shows 🎂 in snapshots)</span></label>
        <input id="member-birthday" type="date" value={bday} max={noYear ? undefined : new Date().toISOString().slice(0, 10)} onChange={e => setBday(e.target.value)} />
      </div>
      {bday && (
        <div className="toggle-row">
          <label id="member-birthday-noyear">I don't know the year</label>
          <button className={`switch ${noYear ? 'on' : ''}`} role="switch" aria-checked={noYear} aria-labelledby="member-birthday-noyear" onClick={() => setNoYear(v => !v)}><span className="knob" /></button>
        </div>
      )}
    </Sheet>
  )
}

function CategoriesSection({ categories, onChanged, toast }: { categories: Category[]; onChanged: () => void; toast: (m: string, persist?: boolean) => void }) {
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
    try { await api.reorderCategories(ids); onChanged() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not reorder categories', true) }
  }

  return (
    <Section title="Categories">
      <div className="member-row-list">
        {sorted.map((c, i) => (
          <div key={c.id} className="member-list-item" onClick={() => setEdit(c)}>
            <div className="member-avatar-sm" aria-hidden="true" style={{ background: c.color, color: inkFor(c.color) }}>{c.emoji ?? '🏷️'}</div>
            {/* The name is the keyboard/screen-reader button; the row stays tappable around it. */}
            <button type="button" className="name plain-btn" onClick={e => { e.stopPropagation(); setEdit(c) }} aria-label={`Edit ${c.name}${c.keywords.length ? `, keywords ${c.keywords.join(', ')}` : ''}`}>
              {c.name}
              {c.keywords.length > 0 && <div className="settings-row-sub">{c.keywords.join(', ')}</div>}
            </button>
            <div className="cal-actions" onClick={e => e.stopPropagation()}>
              <button className="icon-btn" disabled={i === 0} onClick={() => move(c.id, -1)} aria-label={`Move ${c.name} up`}>↑</button>
              <button className="icon-btn" disabled={i === sorted.length - 1} onClick={() => move(c.id, 1)} aria-label={`Move ${c.name} down`}>↓</button>
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
  category: Category | null; initial?: Partial<Category>; onClose: () => void; onSaved: () => void; toast: (m: string, persist?: boolean) => void
}) {
  const dialog = useDialog()
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
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save category', true) }
  }
  const del = async () => {
    if (!category) return
    if (!await dialog.confirm({ title: `Delete the ${category.name} category?`, body: 'Events fall back to their automatic color.', confirmLabel: 'Delete', danger: true })) return
    try { await api.deleteCategory(category.id); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete category', true) }
  }

  return (
    <Sheet title={category ? 'Edit category' : 'Add category'} onClose={onClose}
      actions={<>{category && <button className="btn btn-danger" onClick={del} aria-label="Delete"><TrashIcon width={18} height={18} /></button>}<button className="btn btn-primary" onClick={save} disabled={!name.trim()}>Save</button></>}>
      <div className="field"><label>Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus={!category} /></div>
      <div className="field">
        <label>Emoji</label>
        <div className="emoji-swatch-row">
          {CATEGORY_EMOJI.map(e => <button key={e} className={`emoji-swatch ${emoji === e ? 'active' : ''}`} aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>)}
        </div>
        <AnyEmojiField value={emoji} onChange={setEmoji} />
      </div>
      <div className="field">
        <label>Color</label>
        <div className="color-swatch-row">
          {MEMBER_PALETTE.map(c => <button key={c} className={`color-swatch ${color === c ? 'active' : ''}`} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} aria-label={colorName(c)} />)}
          <CustomColorSwatch value={color} presets={MEMBER_PALETTE} onChange={hex => setColor(hex)} label="Custom category color" />
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

function CalendarProvidersSection({ toast }: { toast: (m: string, persist?: boolean) => void }) {
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

function CalendarsSection({ openAccountId, onOpenedAccount, toast }: { openAccountId: string | null; onOpenedAccount: () => void; toast: (m: string, persist?: boolean) => void }) {
  const dialog = useDialog()
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
    try { await api.syncCalendar(id); load(); toast('Synced') } catch (e) { toast(e instanceof ApiError ? e.message : 'Sync failed', true) }
  }
  const reconnectIcs = async (c: CalendarEntry) => {
    const url = await dialog.prompt({
      title: `Reconnect ${c.name}`, label: `Feed URL for ${c.name}`, body: 'Its color, members and event tags are kept.',
      type: 'url', placeholder: 'https://…', confirmLabel: 'Reconnect',
      validate: v => (/^(https?|webcal):\/\/\S+$/i.test(v) ? null : 'Enter the full feed address, starting with https:// or webcal://'),
    })
    if (!url) return
    try { await api.updateCalendar(c.id, { url }); load(); toast('Reconnected, syncing…') } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not reconnect', true) }
  }
  const remove = async (id: string) => {
    if (!await dialog.confirm({ title: 'Remove this calendar and its events from Kinwall?', body: 'Nothing is deleted from the original calendar.', confirmLabel: 'Remove', danger: true })) return
    try { await api.deleteCalendar(id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not remove calendar', true) }
  }

  return (
    <Section title="Calendars" icon={<LinkIcon width={16} height={16} />}>
      {calendars.map(c => (
        <div key={c.id} className="cal-list-item" onClick={() => setEditCal(c)} style={{ cursor: 'pointer' }}>
          <div className="cal-list-top">
            <div className="cal-dot" style={{ background: c.color ?? '#888' }} />
            <button type="button" className="cal-name plain-btn" onClick={e => { e.stopPropagation(); setEditCal(c) }} aria-label={`Edit ${c.name}, ${c.kind} calendar`}>{c.name}</button>
            <div className="cal-kind-badge" aria-hidden="true">{c.kind}</div>
          </div>
          <div className={`cal-sub ${c.lastError ? 'error' : ''}`}>
            {c.lastError ? c.lastError : c.kind === 'local' ? 'Local calendar' : c.lastSyncedAt ? `Synced ${new Date(c.lastSyncedAt).toLocaleString()}` : 'Never synced'}
          </div>
          {c.needsReconnect && c.kind !== 'ics' && (
            <div className="settings-row-sub">Reconnect via {PROVIDER_LABEL[c.kind]}: connect the account below and add this calendar again. Its settings are kept.</div>
          )}
          <div className="cal-actions" onClick={e => e.stopPropagation()}>
            {c.needsReconnect && c.kind === 'ics' && <button className="link-btn" onClick={() => reconnectIcs(c)}>Reconnect</button>}
            {c.kind !== 'local' && !c.needsReconnect && <button className="link-btn" onClick={() => sync(c.id)}>Sync now</button>}
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
        <p className="settings-row-sub" style={{ marginTop: 8 }}>Google/Outlook grayed out? Set them up in Calendar providers below.</p>
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
          calendars={calendars}
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
  calendar: CalendarEntry; onClose: () => void; onSaved: () => void; onSync: () => void; onRemove: () => void; toast: (m: string, persist?: boolean) => void
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
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save calendar', true) }
  }

  return (
    <Sheet title="Edit calendar" onClose={onClose} actions={<button className="btn btn-primary btn-block" onClick={save}>Save</button>}>
      <div className="field"><label>Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="field">
        <label>Color</label>
        <div className="color-swatch-row">
          {MEMBER_PALETTE.map(c => <button key={c} className={`color-swatch ${color === c ? 'active' : ''}`} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} aria-label={colorName(c)} />)}
          <CustomColorSwatch value={color} presets={MEMBER_PALETTE} onChange={hex => setColor(hex)} label="Custom calendar color" />
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
      <div className="toggle-row">
        <label id="calendar-enabled-label">Enabled</label>
        <button className={`switch ${enabled ? 'on' : ''}`} role="switch" aria-checked={enabled} aria-labelledby="calendar-enabled-label" onClick={() => setEnabled(v => !v)}><span className="knob" /></button>
      </div>
      <div className="cal-actions" style={{ marginTop: 4 }}>
        {calendar.kind !== 'local' && <button className="link-btn" onClick={onSync}>Sync now</button>}
        <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={onRemove}>Remove</button>
      </div>
    </Sheet>
  )
}

function LocalCalendarSheet({ usedColors, onClose, onSaved, toast }: { usedColors: (string | null | undefined)[]; onClose: () => void; onSaved: () => void; toast: (m: string, persist?: boolean) => void }) {
  const [name, setName] = useState('')
  const save = async () => {
    if (!name.trim()) return
    try { await api.createCalendar({ kind: 'local', name: name.trim(), color: nextPaletteColor(usedColors) }); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add calendar', true) }
  }
  return (
    <Sheet title="Add local calendar" onClose={onClose} actions={<button className="btn btn-primary btn-block" onClick={save} disabled={!name.trim()}>Add</button>}>
      <div className="field"><label>Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Family" autoFocus /></div>
    </Sheet>
  )
}

function IcsSheet({ usedColors, onClose, onSaved, toast }: { usedColors: (string | null | undefined)[]; onClose: () => void; onSaved: () => void; toast: (m: string, persist?: boolean) => void }) {
  const { members } = useApp()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [memberIds, setMemberIds] = useState<string[]>([])
  const save = async () => {
    if (!name.trim() || !url.trim()) return
    try { await api.createCalendar({ kind: 'ics', name: name.trim(), url: url.trim(), color: nextPaletteColor(usedColors), memberIds }); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add calendar', true) }
  }
  return (
    <Sheet title="Add ICS calendar" onClose={onClose} actions={<button className="btn btn-primary btn-block" onClick={save} disabled={!name.trim() || !url.trim()}>Add</button>}>
      <div className="field"><label>Name</label><input type="text" value={name} onChange={e => setName(e.target.value)} autoFocus /></div>
      <div className="field"><label>ICS URL</label><input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" /></div>
      <MemberPicker members={members} selected={memberIds} onChange={setMemberIds} />
    </Sheet>
  )
}

function CaldavSheet({ onClose, onAccountCreated, toast }: { onClose: () => void; onAccountCreated: (id: string) => void; toast: (m: string, persist?: boolean) => void }) {
  const [name, setName] = useState('')
  const [serverUrl, setServerUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const save = async () => {
    if (!name.trim() || !serverUrl.trim() || !username.trim() || !password) return
    try {
      const acc = await api.createCaldavAccount({ name: name.trim(), serverUrl: serverUrl.trim(), username: username.trim(), password })
      onAccountCreated(acc.id)
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not connect CalDAV account', true) }
  }
  return (
    <Sheet title="Connect CalDAV" onClose={onClose} actions={<button className="btn btn-primary btn-block" onClick={save} disabled={!name.trim() || !serverUrl.trim() || !username.trim()}>Connect</button>}>
      <div className="field"><label>Account name</label><input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. iCloud" autoFocus /></div>
      <div className="field"><label>Server URL</label><input type="url" value={serverUrl} onChange={e => setServerUrl(e.target.value)} placeholder="https://caldav.icloud.com" /></div>
      <div className="field"><label>Username</label><input type="text" value={username} onChange={e => setUsername(e.target.value)} /></div>
      <div className="field"><label>App password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} /></div>
    </Sheet>
  )
}

const PROVIDER_LABEL: Record<string, string> = { google: 'Google', microsoft: 'Outlook', caldav: 'CalDAV' }

/** One row of an account's calendar picker (Settings and the setup wizard): a 44px checkbox row
 * with the calendar's color, name and badges. `added` rows are shown checked and locked. */
export function CalendarCheckRow({ name, color, checked, added, badge, readOnly, onChange }: {
  name: string; color: string; checked: boolean; added?: boolean; badge?: string; readOnly?: boolean; onChange: (v: boolean) => void
}) {
  return (
    <label className={`cal-check-row ${added ? 'disabled' : ''}`}>
      <input type="checkbox" checked={checked || !!added} disabled={added} onChange={e => onChange(e.target.checked)} />
      <span className="cal-dot" style={{ background: color }} aria-hidden="true" />
      <span className="cal-name">{name}</span>
      {added && <span className="cal-kind-badge">Added</span>}
      {!added && badge && <span className="cal-kind-badge">{badge}</span>}
      {readOnly && <span className="cal-kind-badge">read-only</span>}
    </label>
  )
}

/** What to tick when an account's calendars load: reconnect matches, or the only choice there is. */
export function initialPicks(selectable: string[], reconnect: string[] = []): Set<string> {
  return new Set(selectable.length === 1 ? selectable : reconnect.filter(id => selectable.includes(id)))
}

const plural = (n: number) => `${n} calendar${n === 1 ? '' : 's'}`

function RemoteCalendarPicker({ accountId, accountKind, accountName, calendars, onClose, onAdded, toast }: {
  accountId: string; accountKind: Account['kind']; accountName: string; calendars: CalendarEntry[]; onClose: () => void; onAdded: () => void; toast: (m: string, persist?: boolean) => void
}) {
  const { members } = useApp()
  const [remotes, setRemotes] = useState<RemoteCalendar[] | null>(null)
  const [added, setAdded] = useState<Set<string>>(new Set())
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [choice, setChoice] = useState<Record<string, { memberIds: string[]; color: string }>>({})
  const [progress, setProgress] = useState<string | null>(null)

  // An imported calendar with this remoteId: adding re-attaches it with its own settings.
  const placeholderFor = (rc: RemoteCalendar) => calendars.find(p => p.needsReconnect && p.kind === accountKind && p.remoteId === rc.remoteId)
  const isAdded = (rc: RemoteCalendar) => added.has(rc.remoteId) || calendars.some(c => !c.needsReconnect && c.accountId === accountId && c.remoteId === rc.remoteId)

  useEffect(() => {
    api.getRemoteCalendars(accountId).then(rs => {
      setRemotes(rs)
      const selectable = rs.filter(rc => !isAdded(rc)).map(rc => rc.remoteId)
      setChecked(initialPicks(selectable, rs.filter(placeholderFor).map(rc => rc.remoteId)))
    }).catch(() => { toast('Could not list remote calendars', true); setRemotes([]) })
  }, [accountId, toast]) // eslint-disable-line react-hooks/exhaustive-deps -- picks are seeded once per account

  const todo = (remotes ?? []).filter(rc => checked.has(rc.remoteId) && !isAdded(rc))
  const addChecked = async () => {
    let done = 0
    for (const rc of todo) {
      setProgress(`Adding ${done + 1} of ${todo.length}…`)
      const c = choice[rc.remoteId] ?? { memberIds: [], color: rc.color ?? MEMBER_PALETTE[0] }
      try {
        await api.createCalendar({ kind: accountKind, accountId, remoteId: rc.remoteId, name: rc.name, color: c.color, memberIds: c.memberIds, writable: rc.writable })
        done++
        setAdded(s => new Set(s).add(rc.remoteId))
      } catch (e) {
        // Stop here and keep the sheet open: what was added shows as Added, the rest stay ticked.
        const msg = `${done ? `Added ${plural(done)}, then: ` : ''}${e instanceof ApiError ? e.message : 'Could not add calendar'}`
        toast(msg, true); announce(msg, true); setProgress(null); onAdded()
        return
      }
    }
    setProgress(null)
    onAdded()
    toast(`Added ${plural(done)}`); announce(`Added ${plural(done)}`)
    onClose()
  }

  const busy = progress !== null
  return (
    <Sheet title={`Calendars for ${accountName}`} onClose={onClose} onCancel={onClose} dismissable={false}
      actions={<>
        <button className="btn btn-secondary" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" style={{ flex: 1 }} onClick={addChecked} disabled={busy || todo.length === 0}>
          {progress ?? `Add ${plural(todo.length)}`}
        </button>
      </>}>
      <p className="settings-row-sub" style={{ marginTop: 0 }}>Pick the calendars to show on the wall. You can change this any time under Calendars.</p>
      {busy && <span className="sr-only" role="status">{progress}</span>}
      {remotes === null ? <div className="state-card">Loading…</div> : remotes.length === 0 ? (
        <div className="empty-card">No remote calendars found.</div>
      ) : remotes.map(rc => {
        const c = choice[rc.remoteId] ?? { memberIds: [], color: rc.color ?? MEMBER_PALETTE[0] }
        const existing = placeholderFor(rc)
        const done = isAdded(rc)
        const on = checked.has(rc.remoteId)
        return (
          <div key={rc.remoteId} className="cal-list-item">
            <CalendarCheckRow name={existing?.name ?? rc.name} color={existing?.color ?? c.color} checked={on} added={done}
              badge={existing ? 'will reconnect' : undefined} readOnly={!rc.writable}
              onChange={v => setChecked(s => { const n = new Set(s); if (v) n.add(rc.remoteId); else n.delete(rc.remoteId); return n })} />
            {on && !done && !existing && <MemberPicker members={members} selected={c.memberIds} onChange={ids => setChoice(s => ({ ...s, [rc.remoteId]: { ...c, memberIds: ids } }))} />}
          </div>
        )
      })}
    </Sheet>
  )
}

/** What kind of authenticator a passkey lives on, from the transports it reported at
 * registration. iCloud Keychain / Google Password Manager passkeys report ['internal', 'hybrid']
 * (they can also be used from a nearby phone), so 'hybrid' only counts without 'internal'. */
function passkeyKind(transports: string[] = []): string | null {
  if (transports.includes('usb') || transports.includes('nfc') || transports.includes('ble')) return 'Security key'
  if (transports.includes('hybrid') && !transports.includes('internal')) return 'Phone / other device'
  return null
}

function PasskeysSection({ me, toast, onChanged }: { me: Me; toast: (m: string, persist?: boolean) => void; onChanged: () => void }) {
  const dialog = useDialog()
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  // false = closed; 'default' = this device (browser's choice, usually Face ID / Touch ID);
  // 'cross-platform' = a hardware security key or a phone via QR.
  const [creating, setCreating] = useState<false | 'default' | 'cross-platform'>(false)
  const [name, setName] = useState('This device')
  const [qr, setQr] = useState<{ token: string; expiresAt: string } | null>(null)
  const [renaming, setRenaming] = useState<Passkey | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const load = () => { api.getPasskeys().then(setPasskeys).catch(() => {}) }
  useEffect(load, [])

  const create = async () => {
    if (!name.trim()) return
    try {
      // bearer flow: this device already has an admin key/session, so the returned session is ignored
      await registerPasskey(name.trim(), undefined, undefined, creating === 'cross-platform' ? 'cross-platform' : undefined)
      setCreating(false); setName('This device')
      load(); onChanged()
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not create passkey', true) }
  }
  const startAnotherDevice = async () => {
    try { setQr(await api.passkeyRegisterToken()) }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not start pairing', true) }
  }
  const rename = async () => {
    if (!renaming || !renameValue.trim()) return
    try { await api.renamePasskey(renaming.id, renameValue.trim()); setRenaming(null); load() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not rename passkey', true) }
  }
  const remove = async (p: Passkey) => {
    const body = passkeys.length === 1 ? 'This is your last passkey — you\'ll need an admin key to sign in until you add another.' : undefined
    if (!await dialog.confirm({ title: `Remove "${p.name}"?`, body, confirmLabel: 'Remove', danger: true })) return
    try { await api.deletePasskey(p.id); load(); onChanged() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not remove passkey', true) }
  }
  const signOut = async () => {
    try { await api.sessionLogout() } catch { /* ignore - clearing locally either way */ }
    clearKey()
    location.reload()
  }

  if (!passkeysSupported()) {
    return (
      <Section id="passkeys" title="Passkeys" icon={<KeyIcon width={16} height={16} />}>
        <p className="settings-row-sub">Passkeys need HTTPS — using an admin key instead.</p>
      </Section>
    )
  }

  return (
    <Section id="passkeys" title="Passkeys" icon={<KeyIcon width={16} height={16} />}>
      {me.kind === 'session' && (
        <div className="settings-row">
          <div className="settings-row-label">{me.keyName === 'Recovery code' ? 'Signed in with a recovery code' : 'Signed in with a passkey'}</div>
          <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={signOut}>Sign out</button>
        </div>
      )}
      {passkeys.map(p => (
        <div key={p.id} className="key-item">
          {renaming?.id === p.id ? (
            <div className="inline-form" style={{ flex: 1 }}>
              <input type="text" value={renameValue} onChange={e => setRenameValue(e.target.value)} autoFocus aria-label="Passkey name" />
              <button className="btn btn-primary" onClick={rename}>Save</button>
              <button className="link-btn" onClick={() => setRenaming(null)}>Cancel</button>
            </div>
          ) : (
            <button type="button" className="plain-btn" style={{ flex: 1 }} onClick={() => { setRenaming(p); setRenameValue(p.name) }} aria-label={`Rename passkey ${p.name}`}>
              <div className="settings-row-label">{p.name}</div>
              <div className="settings-row-sub">
                created {new Date(p.createdAt).toLocaleDateString()}
                {p.lastUsedAt ? ` · used ${new Date(p.lastUsedAt).toLocaleDateString()}` : ' · never used'}
                {passkeyKind(p.transports) && ` · ${passkeyKind(p.transports)}`}
              </div>
            </button>
          )}
          <button className="icon-btn" onClick={() => remove(p)} aria-label={`Remove passkey ${p.name}`}><TrashIcon width={16} height={16} /></button>
        </div>
      ))}
      {creating ? (
        <div className="field" style={{ margin: '10px 0 0' }}>
          <label>Passkey name</label>
          <div className="inline-form" style={{ marginTop: 0 }}>
            <input type="text" value={name} onChange={e => setName(e.target.value)} autoComplete="off" autoFocus />
            <button className="btn btn-primary" onClick={create} disabled={!name.trim()}>Create</button>
            <button className="link-btn" onClick={() => setCreating(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <button className="add-row-btn" onClick={() => { setName('This device'); setCreating('default') }}><PlusIcon width={20} height={20} />Add a passkey on this device</button>
          <button className="link-btn" style={{ minHeight: 44 }} onClick={() => { setName('Security key'); setCreating('cross-platform') }}>Use a security key or another device</button>
        </>
      )}
      {qr ? (
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <QrCode value={new URL(`#/admin-setup?token=${qr.token}`, document.baseURI).href} size={168} />
          <div className="settings-row-sub">Scan with another phone or computer to add a passkey there.</div>
          <button className="link-btn" onClick={() => setQr(null)}>Done</button>
        </div>
      ) : (
        <button className="add-row-btn" onClick={startAnotherDevice}><PlusIcon width={20} height={20} />Add a passkey on another device</button>
      )}
    </Section>
  )
}

const NUDGE_DISMISSED_KEY = 'kinwall.secondWayInDismissedAt'
const NUDGE_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

/** Top of Access: shown while there's only one way in (≤1 passkey, or no unused recovery codes).
 * Dismissing snoozes it on this device for 30 days. */
function SecondWayInNudge({ tick }: { tick: number }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    try { if (Date.now() - Number(localStorage.getItem(NUDGE_DISMISSED_KEY) ?? 0) < NUDGE_SNOOZE_MS) return } catch { /* storage blocked */ }
    Promise.all([api.getPasskeys(), api.getRecoveryCodes()])
      .then(([passkeys, codes]) => setShow(passkeys.length <= 1 || codes.remaining === 0))
      .catch(() => {})
  }, [tick])
  if (!show) return null
  // Moves focus too, so keyboard and screen-reader users land where the page scrolled to.
  const jump = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
    document.getElementById(`${id}-title`)?.focus({ preventScroll: true })
  }
  const dismiss = () => {
    try { localStorage.setItem(NUDGE_DISMISSED_KEY, String(Date.now())) } catch { /* storage blocked */ }
    setShow(false)
  }
  return (
    <div className="new-key-banner">
      <div className="settings-row-label">Add a second way in — a second passkey or recovery codes — so losing one device doesn't lock the family out.</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <button className="link-btn" onClick={() => jump('passkeys')}>Passkeys</button>
        <button className="link-btn" onClick={() => jump('recovery-codes')}>Recovery codes</button>
        <button className="link-btn" style={{ marginLeft: 'auto' }} onClick={dismiss}>Not now</button>
      </div>
    </div>
  )
}

/** A freshly generated set, shown once (setup wizard and Settings → Access): grid, copy, .txt. */
export function RecoveryCodesView({ codes }: { codes: string[] }) {
  const [copied, setCopied] = useState(false)
  const text = `Kinwall recovery codes for ${location.host}\nEach code signs in once. Generated ${new Date().toLocaleDateString()}.\n\n${codes.join('\n')}\n`
  const copy = () => { navigator.clipboard?.writeText(text).then(() => setCopied(true)).catch(() => {}) }
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'kinwall-recovery-codes.txt'
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <div className="new-key-banner">
      <ul className="recovery-grid">{codes.map(c => <li key={c}>{c}</li>)}</ul>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={copy}>{copied ? 'Copied' : 'Copy all'}</button>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={download}>Download .txt</button>
      </div>
    </div>
  )
}

function RecoveryCodesSection({ toast, onChanged }: { toast: (m: string, persist?: boolean) => void; onChanged: () => void }) {
  const dialog = useDialog()
  const [status, setStatus] = useState<{ total: number; remaining: number; createdAt: string | null } | null>(null)
  const [codes, setCodes] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const load = () => { api.getRecoveryCodes().then(setStatus).catch(() => {}) }
  useEffect(load, [])
  const generate = async () => {
    if (status?.total && !await dialog.confirm({ title: 'Generate new recovery codes?', body: 'The old ones stop working immediately.', confirmLabel: 'Generate new codes', danger: true })) return
    setBusy(true)
    try { setCodes((await api.generateRecoveryCodes()).codes); load(); onChanged() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not generate recovery codes', true) }
    finally { setBusy(false) }
  }
  return (
    <Section id="recovery-codes" title="Recovery codes" icon={<LockIcon width={16} height={16} />}>
      <p className="settings-row-sub">One-time codes that sign you in if every passkey device is lost. Keep them somewhere safe, like a password manager or printed with your important papers.</p>
      {codes ? <>
        <p className="settings-row-sub">Save these now — they won't be shown again.</p>
        <RecoveryCodesView codes={codes} />
        <button className="link-btn" onClick={() => setCodes(null)}>Done</button>
      </> : <>
        {status && (
          <div className="settings-row">
            <div>
              <div className="settings-row-label">{status.total ? `${status.remaining} of ${status.total} left` : 'No recovery codes yet'}</div>
              {status.createdAt && <div className="settings-row-sub">created {new Date(status.createdAt).toLocaleDateString()}</div>}
            </div>
          </div>
        )}
        <button className="add-row-btn" onClick={generate} disabled={busy}><PlusIcon width={20} height={20} />{status?.total ? 'Generate new codes' : 'Generate recovery codes'}</button>
      </>}
    </Section>
  )
}

// Admin keys only — display keys are created exclusively through pairing (see DisplaysSection),
// so there's one place to mint each kind of key instead of two overlapping ones. Revoking a
// display key still works here-or-there since both call the same DELETE /api/keys/:id, but this
// list only shows admin keys to keep that one job in Displays.
/** OAuth connections (e.g. a Claude connector) - approved on the consent screen, revoked here. */
function ConnectedAppsSection({ toast }: { toast: (m: string, persist?: boolean) => void }) {
  const dialog = useDialog()
  const [apps, setApps] = useState<Awaited<ReturnType<typeof api.getAuthorizations>>>([])
  const load = () => { api.getAuthorizations().then(setApps).catch(() => {}) }
  useEffect(load, [])
  const revoke = async (id: string, name: string) => {
    if (!await dialog.confirm({ title: `Disconnect ${name}?`, body: 'It will need to be approved again to use Kinwall.', confirmLabel: 'Disconnect', danger: true })) return
    try { await api.revokeAuthorization(id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not disconnect', true) }
  }
  return (
    <Section title="Connected apps" icon={<LinkIcon width={16} height={16} />}>
      {apps.length === 0 && <p className="settings-row-sub">Apps you connect with sign-in (like a Claude connector) appear here. Point them at {location.origin}/mcp.</p>}
      {apps.map(a => (
        <div key={a.id} className="key-item">
          <div>
            <div className="settings-row-label">{a.clientName}</div>
            <div className="settings-row-sub">
              {a.scope === 'admin' ? 'Full access' : 'Everyday access'} · connected {new Date(a.createdAt).toLocaleDateString()}
              {a.lastUsedAt ? ` · used ${new Date(a.lastUsedAt).toLocaleDateString()}` : ''}
            </div>
          </div>
          <button className="icon-btn" onClick={() => revoke(a.id, a.clientName)} aria-label={`Disconnect ${a.clientName}`}><TrashIcon width={16} height={16} /></button>
        </div>
      ))}
    </Section>
  )
}

function KeysSection({ toast }: { toast: (m: string, persist?: boolean) => void }) {
  const dialog = useDialog()
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
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not create key', true) }
  }
  const del = async (id: string) => { if (!await dialog.confirm({ title: 'Delete this API key?', body: 'Anything using it stops working immediately.', confirmLabel: 'Delete', danger: true })) return; try { await api.deleteKey(id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete key', true) } }
  const copy = async (key: string) => { try { await navigator.clipboard.writeText(key); toast('Key copied') } catch { toast('Could not copy — select and copy manually', true) } }

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
          <button className="icon-btn" onClick={() => del(k.id)} aria-label={`Delete ${k.name}`}><TrashIcon width={16} height={16} /></button>
        </div>
      ))}
      {creating ? (
        <div className="field" style={{ margin: '10px 0 0' }}>
          <label>Key name</label>
          <div className="inline-form" style={{ marginTop: 0 }}>
            <input type="text" value={name} onChange={e => setName(e.target.value)} autoComplete="off" autoFocus />
            <button className="btn btn-primary" onClick={create} disabled={!name.trim()}>Create</button>
            <button className="link-btn" onClick={() => setCreating(false)}>Cancel</button>
          </div>
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
function DisplaysSection({ toast }: { toast: (m: string, persist?: boolean) => void }) {
  const dialog = useDialog()
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
      toast(e instanceof ApiError ? e.message : 'Could not pair display', true)
    } finally {
      setBusy(false)
    }
  }
  const revoke = async (k: ApiKey) => {
    if (!await dialog.confirm({ title: `Remove "${k.name}"?`, body: 'It will be signed out and need pairing again.', confirmLabel: 'Remove', danger: true })) return
    try { await api.deleteKey(k.id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not revoke display', true) }
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

function WebhooksSection({ toast }: { toast: (m: string, persist?: boolean) => void }) {
  const dialog = useDialog()
  const [hooks, setHooks] = useState<Webhook[]>([])
  const [adding, setAdding] = useState(false)
  const [url, setUrl] = useState('')
  const [evs, setEvs] = useState<string[]>([])
  const [shown, setShown] = useState<{ url: string; secret: string } | null>(null)
  const load = () => { api.getWebhooks().then(setHooks).catch(() => {}) }
  useEffect(load, [])

  const create = async () => {
    if (!url.trim() || evs.length === 0) return
    try { const h = await api.createWebhook(url.trim(), evs); setShown({ url: h.url, secret: h.secret }); setAdding(false); setUrl(''); setEvs([]); load(); announce('Webhook added. Its secret is shown once.') }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add webhook', true) }
  }
  const rotate = async (h: Webhook) => {
    if (!await dialog.confirm({ title: 'Rotate this secret?', body: 'The old secret stops working immediately. Update the receiver with the new one.', confirmLabel: 'Rotate' })) return
    try { const r = await api.rotateWebhookSecret(h.id); setShown({ url: r.url, secret: r.secret }); announce('New secret created. It is shown once.') }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not rotate secret', true) }
  }
  const copy = async (secret: string) => { try { await navigator.clipboard.writeText(secret); toast('Secret copied') } catch { toast('Could not copy — select and copy manually', true) } }
  const del = async (id: string) => { if (!await dialog.confirm({ title: 'Delete this webhook?', confirmLabel: 'Delete', danger: true })) return; try { await api.deleteWebhook(id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete webhook', true) } }

  return (
    <Section title="Webhooks" icon={<WebhookIcon width={16} height={16} />}>
      {shown && (
        <div className="new-key-banner">
          <div style={{ fontWeight: 800, overflowWrap: 'anywhere' }}>Signing secret for {shown.url}</div>
          <input className="new-key-value" readOnly value={shown.secret} aria-label="Webhook signing secret" onFocus={e => e.currentTarget.select()} />
          <div className="settings-row-sub">Shown once. Use it to verify the X-Kinwall-Signature header.</div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-secondary" style={{ flex: 1 }} onClick={() => copy(shown.secret)}>Copy</button>
            <button className="btn btn-secondary" onClick={() => setShown(null)}>Done</button>
          </div>
        </div>
      )}
      {hooks.map(h => (
        <div key={h.id} className="webhook-item">
          <div style={{ minWidth: 0 }}>
            <div className="settings-row-label" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.url}</div>
            <div className="settings-row-sub">{h.events.join(', ')}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            <button className="link-btn" onClick={() => rotate(h)} aria-label={`Rotate secret for ${h.url}`}>Rotate secret</button>
            <button className="icon-btn" onClick={() => del(h.id)} aria-label={`Delete webhook ${h.url}`}><TrashIcon width={16} height={16} /></button>
          </div>
        </div>
      ))}
      {adding ? (
        <div style={{ marginTop: 10 }}>
          <div className="field"><label>URL</label><input type="url" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://…" autoFocus /></div>
          <div className="field">
            <label>Events</label>
            <div className="chip-row">
              {BUS_EVENTS.map(ev => (
                <button key={ev} className={`chip ${evs.includes(ev) ? 'active' : ''}`} aria-pressed={evs.includes(ev)} onClick={() => setEvs(s => s.includes(ev) ? s.filter(x => x !== ev) : [...s, ev])}>{ev}</button>
              ))}
            </div>
          </div>
          <button className="btn btn-primary btn-block" onClick={create} disabled={!url.trim()}>Add webhook</button>
        </div>
      ) : (
        <button className="add-row-btn" onClick={() => setAdding(true)}><PlusIcon width={20} height={20} />New webhook</button>
      )}
    </Section>
  )
}

const EXPORT_VERSION = 1 // matches server/src/routes/data.ts
const MAX_IMPORT_BYTES = 10 * 1024 * 1024
const countOf = (n: number, noun: string, plural = `${noun}s`) => `${n} ${n === 1 ? noun : plural}`

function YourDataSection({ hostPortalUrl, toast, onImported }: { hostPortalUrl?: string; toast: (m: string, persist?: boolean) => void; onImported: () => void }) {
  const dialog = useDialog()
  const [busy, setBusy] = useState(false)
  const [importing, setImporting] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const download = async () => {
    setBusy(true)
    try {
      const url = URL.createObjectURL(await api.exportData())
      const a = document.createElement('a')
      a.href = url
      a.download = `kinwall-export-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not export', true) } finally { setBusy(false) }
  }
  const importFile = async (file: File) => {
    if (file.size > MAX_IMPORT_BYTES) { toast('That file is larger than 10 MB, too big to import', true); return }
    let data: any
    try { data = JSON.parse(await file.text()) } catch { toast("That file isn't a Kinwall export (it isn't valid JSON)", true); return }
    if (!data || typeof data !== 'object' || !Array.isArray(data.members) || !Array.isArray(data.calendars)) { toast("That file isn't a Kinwall export", true); return }
    if (data.version !== EXPORT_VERSION) { toast(`This export is version ${data.version}; this Kinwall can only import version ${EXPORT_VERSION}`, true); return }
    const list = (k: string) => (Array.isArray(data[k]) ? data[k] : []) as { kind?: string; id?: string; calendarId?: string; items?: unknown[] }[]
    const localIds = new Set(list('calendars').filter(c => c.kind === 'local').map(c => c.id))
    const parts = [
      countOf(list('members').length, 'member'),
      countOf(list('events').filter(e => localIds.has(e.calendarId)).length, 'event'),
      countOf(list('chores').length, 'chore'),
      countOf(list('lists').length, 'list'),
      countOf(list('categories').length, 'category', 'categories'),
    ]
    if (!await dialog.confirm({ title: 'Import this export?', body: `Merges ${parts.join(', ')} into this family. Existing items with the same ids are updated.`, confirmLabel: 'Import' })) return
    setImporting(true)
    try {
      const { imported: i, needsReconnect } = await api.importData(data)
      const reconnect = needsReconnect.length ? ` Reconnect these in Calendars (their settings are kept): ${needsReconnect.map(c => `${c.name} (${c.kind})`).join(', ')}.` : ''
      toast(`Imported ${countOf(i.members, 'member')}, ${countOf(i.events, 'event')}, ${countOf(i.chores, 'chore')}, ${countOf(i.lists, 'list')} (${countOf(i.listItems, 'item')}).${reconnect}`, true)
      onImported()
    } catch (e) { toast(e instanceof ApiError ? `Import failed: ${e.message}` : 'Could not import', true) } finally { setImporting(false) }
  }
  return (
    <Section title="Your data" icon={<LockIcon width={16} height={16} />}>
      <p className="settings-row-sub">Everything your family entered (members, chores, lists, your own calendars' events and settings) as one JSON file. Passwords and calendar logins aren't included. Importing merges a file back in: synced calendars keep their colors, members and event tags but need reconnecting once; passkeys and webhooks need setting up again.</p>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <button className="btn btn-secondary" onClick={download} disabled={busy}>{busy ? 'Preparing…' : 'Download export'}</button>
        <button className="btn btn-secondary" onClick={() => fileInput.current?.click()} disabled={importing}>{importing ? 'Importing…' : 'Import from a Kinwall export'}</button>
        <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Kinwall export file"
          onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) importFile(f) }} />
        {hostPortalUrl && <a className="text-link" href={hostPortalUrl} target="_blank" rel="noreferrer">Manage or delete this family</a>}
      </div>
    </Section>
  )
}

const relativeTime = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
function timeAgo(iso: string): string {
  const s = (new Date(iso).getTime() - Date.now()) / 1000
  for (const [unit, secs] of [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]] as const) {
    if (Math.abs(s) >= secs) return relativeTime.format(Math.round(s / secs), unit)
  }
  return relativeTime.format(0, 'minute')
}

// Actions taken by whoever hosts this instance. Self-hosters never have any, so it stays hidden.
function HostingActivitySection() {
  const [events, setEvents] = useState<HostEvent[]>([])
  useEffect(() => { api.getHostEvents().then(setEvents).catch(() => {}) }, [])
  if (events.length === 0) return null
  return (
    <Section title="Hosting activity" icon={<MonitorIcon width={16} height={16} />}>
      {events.map(e => (
        <div key={e.id} className="key-item">
          <div>
            <div className="settings-row-label">{e.action}</div>
            <div className="settings-row-sub">{[timeAgo(e.at), e.detail].filter(Boolean).join(' · ')}</div>
          </div>
        </div>
      ))}
    </Section>
  )
}
