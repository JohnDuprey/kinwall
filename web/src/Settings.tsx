import { createContext, Fragment, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AppContext, useApp } from './AppContext.tsx'
import { DOCS_URL } from './Help.tsx'
import { api, ApiError, clearKey, MOCK, PUSH_SUB_ID_KEY } from './api.ts'
import type { Account, ApiKey, CalendarEntry, Category, HiddenEvent, ColorScheme, CustomColors, Density, DeviceDensity, Features, GeocodeResult, GooglePhotos, HostEvent, Me, Member, Passkey, Providers, PushSubscription, RemoteCalendar, Settings, TempCheckSettings, TextScale, ThemeMode, TimeFormat, Typeface, Webhook } from './types.ts'
import { ProviderForm, PublicUrlRow } from './ProviderConfig.tsx'
import { CATEGORY_EMOJI, CATEGORY_PRESETS, MEMBER_EMOJI, MEMBER_PALETTE, nextPaletteColor, REMINDER_OPTIONS } from './types.ts'
import Sheet from './Sheet.tsx'
import { SchemePickerSheet, TypefaceRow } from './SchemePicker.tsx'
import TidbitsSheet, { DeviceTidbitRows } from './TidbitsSheet.tsx'
import { tidbitSummary } from './tidbits.ts'
import { appearanceChips, featuresSummary, nightHoursChips, nightSummary, timeCuesSummary, transitionRemindersSummary, type Chip } from './settingsSummary.ts'
import { MAX_WARNING_TIMES, REPEAT_EVERY, REPEAT_WITHIN, warningTimes, type TransitionReminders, type WarningRepeat } from './transitions.ts'
import { MemberPicker } from './MemberPicker.tsx'
import CalendarFilterSheet, { HiddenEventsSheet } from './CalendarFilterSheet.tsx'
import { filterSummary } from './calendarFilter.ts'
import TimezoneField from './TimezoneField.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isValidAvatar } from './emoji.ts'
import { accentFill, colorName, inkFor } from './color.ts'
import { BellIcon, ChevronRight, KeyIcon, LinkIcon, LockIcon, MonitorIcon, PaletteIcon, PlusIcon, TrashIcon, WebhookIcon } from './icons.tsx'
import { CustomColorSwatch } from './ColorSwatch.tsx'
import { ColorClashHint, ColorClashNote } from './ColorClash.tsx'
import { useIsPhone } from './useIsPhone.ts'
import { useNavMode, setNavPref, type NavPref } from './useNavMode.ts'
import { familyNightFields, nightFieldsFor, ownsNight, toNightLook, type NightFields } from './saverSources.ts'
import { DEFAULT_ACCENT, resolveColors, setDeviceAppearance, useDeviceAppearance, type DeviceAppearance, type LockedView, type SaverSource } from './useTheme.ts'
import { deviceKindOf, deviceKindValue, parseDeviceKind, wallDefaultsOn, widgetParent, type DeviceKind } from './wallScreen.ts'
import { PIN_RE } from './quietPin.ts'
import { baseFromPalette, findSkin, getSkin, OLD_BACKGROUNDS, paletteChecks, paletteOf, seasonalSkinId, tokensFor, type CustomScheme, type Palette } from './skins.ts'
import { SAVER_PREVIEW_EVENT } from './Screensaver.tsx'
import type { ClockPos } from './nightClock.ts'
import { countDrawings } from './drawings-db.ts'
import { passkeysSupported, registerPasskey } from './webauthn.ts'
import { QrCode } from './App.tsx'
import { InstallRow } from './Install.tsx'
import { addAppTile, appLiveActivities, appMedicineNames, appNotificationSettings, appPlatform, appQuickSettingsTiles, inNativeApp, liveActivitiesLine, openAppNotificationSettings, setAppMedicineNames } from './native.ts'
import { useDialog } from './dialog.tsx'
import { BoardPresetRows, DeviceBoardLayoutRows } from './BoardEditor.tsx'
import { TEMP_CHECK_OFF } from './tempCheck.ts'
import { EVENING_TIMES } from './journal.ts'
import { deviceTimeFormat, formatTime, resolveHour12 } from './timeFormat.ts'
import { MedicationsToggle } from './MedicationSettings.tsx'
import { announce, pressable, reducedMotion, Segmented } from './a11y.tsx'
import { FEATURE_ROWS } from './featureConfig.ts'

// Mirrors BusEventType in server/src/bus.ts.
const BUS_EVENTS = ['member.changed', 'calendar.changed', 'calendar.synced', 'events.changed', 'chore.changed', 'chore.completed', 'chore.uncompleted', 'chore.pending', 'chore.rejected', 'checkin.completed', 'tempcheck.changed', 'list.changed', 'list.item.changed', 'category.changed', 'settings.changed', 'sticker.changed', 'reward.changed', 'reward.redeemed', 'reward.approved', 'reward.declined', 'reward.given', 'recipe.changed', 'meal.changed', 'photo.changed', 'tracker.changed', 'contact.changed', 'contact.category.changed', 'display.paired', 'display.night_screen']

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

  const [meReady, setMeReady] = useState(false)
  useEffect(() => { api.meStrict().then(setMe).catch(() => setMe({ scope: 'display', keyName: '', kind: 'api' })).finally(() => setMeReady(true)) }, [])
  // A link to one spot in a tab (#/settings?tab=general&section=board-layout, from the Board's
  // Manage layouts): scroll to it once /api/me has answered, so the parent-only sections above it
  // are already in place and don't push it back down.
  useEffect(() => {
    if (!meReady) return
    const q = new URLSearchParams(location.hash.split('?')[1] || '')
    const el = document.getElementById(q.get('section') ?? '')
    if (!el) return
    el.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })
    q.delete('section')
    history.replaceState(null, '', `#/settings?${q}`)
  }, [meReady])

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
          {/* Family settings are for parent devices; a wall screen or kid's device only has its own. */}
          {!isDisplay && (
            <SettingsGroup title="For the whole family" sub="Every screen and phone in the household uses these.">
              <GeneralSection settings={settings} onSaved={reloadCore} toast={toast} isDisplay={false} />
              <WeatherSection settings={settings} onSaved={reloadCore} toast={toast} />
              <TidbitsSection settings={settings} onSaved={reloadCore} toast={toast} />
              <Section id="board-presets" title="Board presets"><div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}><BoardPresetRows toast={toast} /></div></Section>
              <FeaturesSection settings={settings} onSaved={reloadCore} toast={toast} />
              <AppearanceSection settings={settings} onSaved={reloadCore} toast={toast} />
              <NightSection settings={settings} onSaved={reloadCore} toast={toast} />
            </SettingsGroup>
          )}
          <SettingsGroup title="Only on this device" sub="Saved on this screen or phone. Other devices aren't affected.">
            {isDisplay ? <ThisDisplaySection keyName={me.keyName} /> : <ThisDisplaySection />}
            <DeviceAppearanceSection />
            <TimeCuesSection />
            <NightScreenSection />
            <NotificationsSection toast={toast} />
            <TroubleshootSection keyName={isDisplay ? me.keyName : undefined} />
          </SettingsGroup>
        </>}
        {current === 'family' && <>
          <MembersSection members={members} onChanged={reloadCore} toast={toast} canManage={!isDisplay} />
          <CategoriesSection categories={categories} onChanged={reloadCore} toast={toast} />
          {/* Chore rules are family settings a display key can't save (auth.ts), like General's family group. */}
          {!isDisplay && settings.features.chores && <ChoreSettingsSection settings={settings} onSaved={reloadCore} toast={toast} />}
          {settings.features.meals && <MealSettingsSection settings={settings} onSaved={reloadCore} toast={toast} readOnly={isDisplay} />}
        </>}
        {current === 'calendars' && <>
          <CalendarsSection openAccountId={openAccountId} onOpenedAccount={() => setOpenAccountId(null)} toast={toast} />
          <CalendarProvidersSection toast={toast} />
        </>}
        {current === 'access' && <>
          <SecondWayInNudge tick={accessTick} />
          <ThisDeviceOwnerSection me={me} toast={toast} />
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
        <TimezoneField value={settings.timezone ?? null} onChange={timezone => save({ timezone })} />
      </div>
      <div className="settings-row">
        <div className="settings-row-label">Week starts on</div>
        <select className="settings-select" aria-label="Week starts on" value={settings.weekStart} onChange={e => save({ weekStart: Number(e.target.value) as 0 | 1 })}>
          <option value={0}>Sunday</option>
          <option value={1}>Monday</option>
        </select>
      </div>
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Time format</div>
          <div className="settings-row-sub">Automatic follows each device's language and region. A device can pick its own.</div>
        </div>
        <select className="settings-select" aria-label="Time format" value={settings.timeFormat ?? 'auto'} onChange={e => save({ timeFormat: e.target.value as TimeFormat })}>
          {TIME_FORMATS.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
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

/** Household feature switches (admin only: a display key can't change them). */
function FeaturesSection({ settings, onSaved, toast }: { settings: Settings; onSaved: () => void; toast: (m: string, persist?: boolean) => void }) {
  const set = async (key: keyof Features) => {
    try { await api.updateSettings({ features: { ...settings.features, [key]: !settings.features[key] } }); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings', true) }
  }
  const { summary, detail } = featuresSummary(FEATURE_ROWS.map(f => ({ label: f.group ? `${f.label} tracker` : f.label, on: settings.features[f.key] })))
  return (
    <SummarySection title="Features" summary={summary} detail={detail ?? 'Turn off what your family doesn\'t use.'}>
      <p className="settings-row-sub">Turn off what your family doesn't use. It's hidden on every screen; nothing is deleted.</p>
      {FEATURE_ROWS.map((f, i) => (<Fragment key={f.key}>
        {f.group && FEATURE_ROWS[i - 1]?.group !== f.group && <h3 className="features-group">{f.group}</h3>}
        <div className={`toggle-row ${f.group ? 'features-grouped' : ''}`}>
          <div>
            <label id={`feature-${f.key}-label`}>{f.group && <span className="sr-only">{f.group}: </span>}{f.label}</label>
            <div className="settings-row-sub" id={`feature-${f.key}-sub`}>{f.sub}</div>
          </div>
          <button className={`switch ${settings.features[f.key] ? 'on' : ''}`} role="switch" aria-checked={settings.features[f.key]}
            aria-labelledby={`feature-${f.key}-label`} aria-describedby={`feature-${f.key}-sub`} onClick={() => set(f.key)}><span className="knob" /></button>
        </div>
        {f.key === 'trackersHealth' && settings.features.trackersHealth && <MedicationsToggle />}
      </Fragment>))}
    </SummarySection>
  )
}

/** A long section folded into a sheet, like Quotes & facts: a one-line summary here, the controls
 * in a sheet. The controls save as they change, so the sheet only needs Done. */
/** Selected settings as small read-only chips; one following the family is marked 🏠. */
function SummaryChips({ chips }: { chips: Chip[] }) {
  return (
    <ul className="chip-row summary-chips">
      {chips.map(c => (
        <li key={c.label} className={`chip chip-static${c.family ? ' chip-family' : ''}`}>
          {c.family && <span aria-label="Household:" role="img">🏠</span>}
          {c.icon && <span aria-hidden="true">{c.icon}</span>}
          {c.label}
        </li>
      ))}
    </ul>
  )
}

function SummarySection({ id, title, icon, summary, detail, children, startOpen = false }: { id?: string; title: string; icon?: ReactNode; summary: string | Chip[]; detail?: string; children: ReactNode | ((close: () => void) => ReactNode); startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen)
  return (
    <Section id={id} title={title} icon={icon}>
      <div className="settings-row">
        <div className="summary-body">
          {typeof summary === 'string' ? <div className="settings-row-label">{summary}</div> : <SummaryChips chips={summary} />}
          {detail && <div className="settings-row-sub">{detail}</div>}
        </div>
        <div className="settings-inline-btns">
          <button className="btn btn-secondary" aria-label={`Change ${title.toLowerCase()}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>Change</button>
        </div>
      </div>
      {open && (
        <Sheet title={title} onClose={() => setOpen(false)} actions={<button className="btn btn-primary btn-block" onClick={() => setOpen(false)}>Done</button>}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </Sheet>
      )}
    </Section>
  )
}

/** The Board's quote card sources: a summary here, the choices in their own sheet. */
function TidbitsSection({ settings, onSaved, toast }: { settings: Settings; onSaved: () => void; toast: (m: string, persist?: boolean) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Section title="Quotes & facts">
      <div className="settings-row">
        <div>
          <div className="settings-row-label">On the Board</div>
          <div className="settings-row-sub">{tidbitSummary(settings.tidbits)}</div>
        </div>
        <div className="settings-inline-btns">
          <button className="btn btn-secondary" onClick={() => setOpen(true)}>Change</button>
        </div>
      </div>
      {open && <TidbitsSheet value={settings.tidbits} onClose={() => setOpen(false)} onSave={async tidbits => {
        try { await api.updateSettings({ tidbits }); onSaved(); setOpen(false) } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings', true) }
      }} />}
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
const FONTS: { key: Typeface; label: string; desc: string }[] = [
  { key: 'default', label: 'Default (Nunito)', desc: "Rounded and friendly, Kinwall's own" },
  { key: 'hyperlegible', label: 'Hyperlegible (Atkinson)', desc: 'Clear, distinct letters for low vision' },
  { key: 'dyslexia', label: 'Dyslexia-friendly (Lexend)', desc: 'Wide, even spacing for easier reading' },
  { key: 'modern', label: 'Modern (Figtree)', desc: 'Clean and geometric' },
  { key: 'playful', label: 'Playful (Fredoka)', desc: 'Round and bubbly, fun for kids' },
  { key: 'storybook', label: 'Storybook (Literata)', desc: 'A bookish serif, calm to read' },
  { key: 'handwritten', label: 'Handwritten (Kalam)', desc: 'Like a note on the fridge' },
]
const fontName = (k: Typeface) => FONTS.find(f => f.key === k)?.label.split(' (')[0]
const TIME_FORMATS: { key: TimeFormat; label: string }[] = [
  { key: 'auto', label: 'Automatic' },
  { key: '12', label: '12-hour (3:40 PM)' },
  { key: '24', label: '24-hour (15:40)' },
]

/** This device's look as chips: its own choices, and the family's (marked) for the rest. */
function deviceChips(settings: Settings, d: DeviceAppearance): Chip[] {
  const scheme = d.skin ?? settings.colorScheme
  const skin = scheme === 'seasonal' ? { emoji: '🗓️', name: 'Seasonal' } : findSkin(scheme, settings.customSchemes ?? [])
  return appearanceChips({
    scheme: { emoji: skin.emoji, name: skin.name },
    custom: !!d.custom && Object.keys(d.custom).length > 0,
    mode: d.themeMode,
    textScale: TEXT_SCALE_NAMES[d.textScale ?? settings.textScale],
    density: DEVICE_DENSITIES.find(o => o.key === (d.density ?? settings.density))?.label ?? '',
    typeface: fontName(d.font ?? settings.typeface ?? 'default') ?? 'Default',
    timeFormat: resolveHour12(settings.timeFormat, d.timeFormat) ? '12-hour' : '24-hour',
    lowStim: d.lowStim,
  }, { scheme: !!d.skin, mode: !!d.themeMode, textScale: !!d.textScale, density: !!d.density, typeface: !!d.font, timeFormat: !!d.timeFormat })
}

function AppearanceSection({ settings, onSaved, toast }: { settings: Settings; onSaved: () => void; toast: (m: string, persist?: boolean) => void }) {
  const device = useDeviceAppearance()
  const overridden = deviceChips(settings, device).filter(c => !c.family)
  const save = async (patch: Partial<Settings>) => {
    try { await api.updateSettings(patch); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings', true) }
  }
  return (
    <Section title="Appearance" icon={<PaletteIcon width={16} height={16} />}>
      <p className="settings-row-sub" style={{ margin: '10px 2px 0' }}>
        For the whole family.{overridden.length > 0 && <> This device uses its own, under Appearance on this device:</>}
      </p>
      {overridden.length > 0 && <div className="summary-chips-block"><SummaryChips chips={overridden} /></div>}
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="device-pref-row">
          <span>Mode</span>
          <select className="settings-select" aria-label="Mode" value={settings.themeMode} onChange={e => save({ themeMode: e.target.value as ThemeMode })}>
            {THEME_MODES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        {settings.themeMode === 'scheduled' && <>
          <div className="device-pref-row">
            <span>Dark hours</span>
            <select className="settings-select" aria-label="Dark hours" value={settings.darkWithNight ? 'night' : ''} onChange={e => save({ darkWithNight: !!e.target.value })}>
              <option value="night">Same as night</option>
              <option value="">Their own times</option>
            </select>
          </div>
          {settings.darkWithNight
            ? <div className="settings-row-sub">{settings.quietFrom && settings.quietTo ? `Dark ${formatTime(settings.darkFrom)}–${formatTime(settings.darkTo)}, the night hours set under Night.` : `Night hours are off, so it's dark ${formatTime(settings.darkFrom)}–${formatTime(settings.darkTo)}.`}</div>
            : <div className="row-2" style={{ marginTop: 4 }}>
              <div className="field" style={{ margin: 0 }}><label>Dark from</label><input type="time" value={settings.darkFrom} onChange={e => save({ darkFrom: e.target.value })} /></div>
              <div className="field" style={{ margin: 0 }}><label>Dark to</label><input type="time" value={settings.darkTo} onChange={e => save({ darkTo: e.target.value })} /></div>
            </div>}
        </>}
      </div>
      <ColorControls
        scheme={settings.colorScheme}
        onScheme={id => { if (id) save({ colorScheme: id }) }}
        household={settings} device={{}} saveSettings={save}
        legacy={{ ...(settings.customColors ?? {}), ...(settings.accent.toUpperCase() !== DEFAULT_ACCENT ? { accent: settings.accent } : {}) }}
        legacyBackgrounds={{ light: settings.backgroundLight, dark: settings.backgroundDark }}
        legacyClear={{ customColors: null, accent: DEFAULT_ACCENT, backgroundLight: 'warm', backgroundDark: 'cocoa' }}
        resetLabel="Reset colors to Peach"
        onReset={() => save({ colorScheme: 'meadow', customColors: null, accent: DEFAULT_ACCENT, backgroundLight: 'warm', backgroundDark: 'cocoa' })}
      />
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <TypefaceRow options={FONTS} value={settings.typeface ?? 'default'} onPick={key => { if (key) { save({ typeface: key }); announce(`${fontName(key)} typeface`) } }} />
        <div className="device-pref-row">
          <span>Text size</span>
          <select className="settings-select" aria-label="Text size" value={settings.textScale} onChange={e => save({ textScale: e.target.value as TextScale })}>
            {TEXT_SCALES.map(o => <option key={o.key} value={o.key}>{TEXT_SCALE_NAMES[o.key]}</option>)}
          </select>
        </div>
        <div className="device-pref-row">
          <span>Density</span>
          <select className="settings-select" aria-label="Density" value={settings.density} onChange={e => save({ density: e.target.value as Density })}>
            {DENSITIES.map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div className="settings-row-sub">Compact tightens spacing and fits more on screen, handy for a smaller display. Icon-first is set per device, under Appearance on this device.</div>
      </div>
    </Section>
  )
}

/** "PIN to wake at night": set or changed here (asked twice), removed under More…, which
 * is also the way out of a forgotten PIN. Only ever sent to the server, never stored here. */
function QuietPinRow({ settings, onSaved, toast }: { settings: Settings; onSaved: () => void; toast: (m: string, persist?: boolean) => void }) {
  const dialog = useDialog()
  const setPin = async () => {
    const pin = await dialog.prompt({ title: settings.quietPin ? 'Change PIN' : 'Set a PIN', label: 'New PIN (4 to 8 digits)', type: 'pin', confirmLabel: 'Next', validate: v => PIN_RE.test(v) ? null : 'Use 4 to 8 digits.' })
    if (!pin) return
    const again = await dialog.prompt({ title: settings.quietPin ? 'Change PIN' : 'Set a PIN', label: 'Enter it again', type: 'pin', confirmLabel: 'Save', validate: v => v === pin ? null : "The PINs don't match." })
    if (!again) return
    try { await api.setQuietPin(pin); onSaved(); toast('PIN saved') } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save the PIN', true) }
  }
  const more = async (v: string) => {
    if (v !== 'remove' || !await dialog.confirm({ title: 'Remove the PIN?', body: 'A tap will wake wall screens at night again.', confirmLabel: 'Remove', danger: true })) return
    try { await api.removeQuietPin(); onSaved(); toast('PIN removed') } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not remove the PIN', true) }
  }
  return (
    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
      <div className="settings-row-label">PIN to wake at night{settings.quietPin ? ': on' : ''}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-secondary" style={{ flex: 1 }} onClick={setPin}>{settings.quietPin ? 'Change PIN' : 'Set PIN'}</button>
        {settings.quietPin && (
          <select className="settings-select" style={{ width: 'auto' }} aria-label="More" value="" onChange={e => more(e.target.value)}>
            <option value="" disabled hidden>More…</option>
            <option value="remove">Remove PIN</option>
          </select>
        )}
      </div>
      <div className="settings-row-sub">A wall screen asks for it before waking during night hours, so little ones can't turn the wall on at night. Forgot it? Remove it here on any parent device.</div>
    </div>
  )
}

/** Household chore rules: late credit, streak grace and whether the leaderboard shows at all. */
/** When each meal usually is: a meal without its own time goes on the calendar then. */
function MealSettingsSection({ settings, onSaved, toast, readOnly = false }: { settings: Settings; onSaved: () => void; toast: (m: string, persist?: boolean) => void; readOnly?: boolean }) {
  const save = async (slot: keyof Settings['mealTimes'], value: string) => {
    if (!value || value === settings.mealTimes[slot]) return
    if (readOnly) return
    try { await api.updateSettings({ mealTimes: { ...settings.mealTimes, [slot]: value } }); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings', true) }
  }
  return (
    <Section title="Meals">
      <p className="settings-row-sub">Usual meal times. A meal without its own time goes on the calendar at these.</p>
      {readOnly && <p className="settings-row-sub">Only a parent device can change these times.</p>}
      {(['breakfast', 'lunch', 'dinner', 'snack'] as const).map(slot => (
        <div className="settings-row" key={slot}>
          <div className="settings-row-label">{slot[0].toUpperCase() + slot.slice(1)}</div>
          <input type="time" className="settings-select" aria-label={`Usual ${slot} time`} defaultValue={settings.mealTimes[slot]} disabled={readOnly} onBlur={e => void save(slot, e.target.value)} />
        </div>
      ))}
    </Section>
  )
}

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
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Daily check-in points</div>
          <div className="settings-row-sub">Reading your day to the end and tapping "I'm all caught up" earns these, once a day.</div>
        </div>
        <select className="settings-select" aria-label="Daily check-in points" value={settings.checkInPoints} onChange={e => save({ checkInPoints: Number(e.target.value) })}>
          {[0, 1, 2, 3, 5, 10].map(n => <option key={n} value={n}>{n === 0 ? 'Off' : `${n} point${n === 1 ? '' : 's'}`}</option>)}
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

const DEFAULT_PUSH_PREFS = { eventReminders: true, dailySummary: false, summaryTime: '07:30', choreNudge: false, choreNudgeTime: '08:00', listUpdates: false, medicationNames: false }

/** "This display" → Notifications: subscribe/unsubscribe this device, and its own reminder/
 * summary/nudge/list-update preferences. Works for any key scope (display or admin) - it's
 * per-device, not a household setting. */
function NotificationsSection({ toast }: { toast: (m: string, persist?: boolean) => void }) {
  // iPhone app: whether Live Activities are on (the app updates window.kinwallNative when it comes back).
  const [liveActivities, setLiveActivities] = useState(appLiveActivities)
  useEffect(() => {
    const on = () => setLiveActivities(appLiveActivities())
    window.addEventListener('kinwallnative', on)
    return () => window.removeEventListener('kinwallnative', on)
  }, [])
  const { members, settings } = useApp()
  const [appNames, setAppNames] = useState(appMedicineNames) // in the app: this device's own choice (no push subscription)
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

  if (inNativeApp()) {
    const liveLine = liveActivitiesLine(liveActivities, appPlatform() ?? 'ios')
    return (
      <Section title="Notifications" icon={<BellIcon width={16} height={16} />}>
        {nightHoldNote(settings) && <p className="settings-row-sub">{nightHoldNote(settings)}</p>}
        <p className="settings-row-sub">The Kinwall app reminds you about events on this device, at each event's reminder times. To turn them off, go to the device's Settings → Notifications → Kinwall. Daily summaries, chore nudges and list updates aren't sent to the app yet; they still arrive in the bell at the top.</p>
        {liveLine && <p className="settings-row-sub">{liveLine}</p>}
        {settings.medications && <div className="toggle-row">
          <div>
            <label id="app-med-names-label">Show medicine names on this device</label>
            <div className="settings-row-sub" id="app-med-names-sub">Off: a due dose says “Leo’s medicine”. It shows on the lock screen.</div>
          </div>
          <button className={`switch ${appNames ? 'on' : ''}`} role="switch" aria-checked={appNames} aria-labelledby="app-med-names-label" aria-describedby="app-med-names-sub" onClick={() => { setAppMedicineNames(!appNames); setAppNames(!appNames) }}><span className="knob" /></button>
        </div>}
        {settings.medications && appNotificationSettings() && <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <button className="btn btn-secondary" onClick={() => openAppNotificationSettings('medicine')}>Let medicine reminders through Do Not Disturb</button>
          <div className="settings-row-sub">Opens Android's settings for Kinwall's Medicine notifications. Turn on Override Do Not Disturb.</div>
        </div>}
      </Section>
    )
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
      {sub && nightHoldNote(settings) && <p className="settings-row-sub" style={{ margin: '10px 2px 0' }}>{nightHoldNote(settings)}</p>}
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
          {settings.features.chores && <div className="settings-row">
            <div className="toggle-row" style={{ flex: 1 }}>
              <label>Chore reminder</label>
              <button className={`switch ${prefs.choreNudge ? 'on' : ''}`} role="switch" aria-checked={prefs.choreNudge} aria-label="Chore reminder" onClick={() => savePrefs({ choreNudge: !prefs.choreNudge })}><span className="knob" /></button>
            </div>
            {prefs.choreNudge && <input type="time" aria-label="Chore reminder time" value={prefs.choreNudgeTime} onChange={e => savePrefs({ choreNudgeTime: e.target.value })} />}
          </div>}
          {settings.features.lists && <div className="toggle-row">
            <label>List updates</label>
            <button className={`switch ${prefs.listUpdates ? 'on' : ''}`} role="switch" aria-checked={prefs.listUpdates} aria-label="List updates" onClick={() => savePrefs({ listUpdates: !prefs.listUpdates })}><span className="knob" /></button>
          </div>}
          {settings.medications && <div className="toggle-row">
            <div>
              <label id="push-med-names-label">Show medicine names in notifications on this device</label>
              <div className="settings-row-sub" id="push-med-names-sub">Off: “Time for Leo’s medicine”. Notification text passes through Apple or Google and shows on the lock screen.</div>
            </div>
            <button className={`switch ${prefs.medicationNames ? 'on' : ''}`} role="switch" aria-checked={prefs.medicationNames} aria-labelledby="push-med-names-label" aria-describedby="push-med-names-sub" onClick={() => savePrefs({ medicationNames: !prefs.medicationNames })}><span className="knob" /></button>
          </div>}
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
  const { settings } = useApp()
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
      {settings.features.messages && <SendMessageForm />}
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
function ColorControls({ scheme, householdScheme, onScheme, household, device, saveSettings, legacy, legacyBackgrounds, legacyClear, onClearLegacy, resetLabel, onReset, resetConfirm }: {
  scheme: ColorScheme | undefined
  householdScheme?: ColorScheme // set on a device: shows the Household chip
  onScheme: (id: ColorScheme | undefined) => void
  household: Settings; device: DeviceAppearance
  saveSettings: (patch: Partial<Settings>) => Promise<void>
  legacy: CustomColors // loose custom colors from before saved schemes, at this level
  legacyBackgrounds?: { light: string; dark: string } // household: the old background presets
  legacyClear?: Partial<Settings> // household: the patch that clears them
  onClearLegacy?: () => void // device: clears them locally
  resetLabel: string; onReset: () => void
  resetConfirm?: string // asked first when the reset covers more than the scheme
}) {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
  // The family's schemes are edited on parent devices; any device can add one (saved for the family)
  // and switch itself to it.
  const { parentDevice, reloadCore } = useApp()
  const dialog = useDialog()
  const [manage, setManage] = useState(false)
  const [picking, setPicking] = useState(false)
  const valueId = useId()
  const customs = household.customSchemes ?? []
  const { skin } = resolveColors(household, device)
  const [editing, setEditing] = useState<{ draft: CustomScheme; isNew: boolean; fromLegacy?: boolean } | null>(null)
  const nameOf = (id: ColorScheme) => id === 'seasonal' ? `Seasonal (${getSkin(seasonalSkinId()).name})` : findSkin(id, customs).name
  const skinOf = (id: ColorScheme) => id === 'seasonal' ? getSkin(seasonalSkinId()) : findSkin(id, customs)
  const dotsFor = (id: ColorScheme) => { const k = tokensFor(skinOf(id), dark); return [k.bg, k.card, k.accent] }
  // The row: the scheme in effect here, with a light+dark swatch ringed in its accent.
  const current = scheme ?? householdScheme ?? 'meadow'
  const [lightT, darkT] = [tokensFor(skinOf(current), false), tokensFor(skinOf(current), true)]
  const emojiOf = (id: ColorScheme) => id === 'seasonal' ? '🗓️' : skinOf(id).emoji
  const rowValue = scheme || !householdScheme ? `${emojiOf(current)} ${nameOf(current)}` : `🏠 Household (${nameOf(householdScheme)})`
  const pick = (id: ColorScheme | undefined) => {
    onScheme(id)
    announce(`${id ? nameOf(id) : 'Household'} color scheme`)
  }
  const activeCustom = customs.find(c => c.id === skin.id)
  const startFrom = (base: typeof skin, name: string): CustomScheme =>
    ({ id: newSchemeId(), name: name.slice(0, 30), emoji: base.emoji, light: paletteOf(base, false), dark: paletteOf(base, true) })
  const newScheme = () => setEditing({ draft: startFrom(skin, activeCustom ? `${skin.name} copy` : `My ${skin.name}`), isNew: true })
  const oldLight = legacyBackgrounds && legacyBackgrounds.light !== 'warm' ? OLD_BACKGROUNDS[legacyBackgrounds.light] : undefined
  const oldDark = legacyBackgrounds && legacyBackgrounds.dark !== 'cocoa' ? OLD_BACKGROUNDS[legacyBackgrounds.dark] : undefined
  const hasLegacy = Object.keys(legacy).length > 0 || !!oldLight || !!oldDark
  const oldNames = [oldLight && `${oldLight.name} (light)`, oldDark && `${oldDark.name} (dark)`].filter(Boolean).join(' and ')
  const saveScheme = async (c: CustomScheme, isNew: boolean, fromLegacy?: boolean) => {
    if (!parentDevice) { // a wall screen or kid's device: add it to the family's list, use it here
      await api.addColorScheme(c)
      reloadCore()
      onScheme(c.id)
      if (fromLegacy) onClearLegacy?.()
      announce(`${c.name} saved and selected on this device`)
      setEditing(null)
      return
    }
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
      <div className="device-pref-row">
        <span aria-hidden="true">Color scheme</span>
        <button type="button" className="settings-select scheme-row" aria-label="Color scheme" aria-describedby={valueId} aria-haspopup="dialog" onClick={() => setPicking(true)}>
          <span className="scheme-swatch scheme-swatch-lg" aria-hidden="true" style={{ background: `linear-gradient(135deg, ${lightT.bg} 50%, ${darkT.bg} 50%)`, borderColor: lightT.accentStrong }} />
          <span id={valueId} className="scheme-row-name">{rowValue}</span>
        </button>
      </div>
      {picking && (
        <SchemePickerSheet value={scheme} customs={customs} familyScheme={household.colorScheme}
          family={householdScheme ? { name: nameOf(householdScheme), skin: skinOf(householdScheme) } : undefined}
          onPick={id => pick(id as ColorScheme | undefined)} onClose={() => setPicking(false)}
          customActions={<>
            {customs.length > 0 && <button className="btn btn-secondary" aria-haspopup="dialog" onClick={() => { setPicking(false); setManage(true) }}>Manage</button>}
            {customs.length < 10 && <button className="btn btn-secondary" onClick={() => { setPicking(false); newScheme() }}>＋ New scheme</button>}
          </>}
          footer={<button className="btn btn-secondary" onClick={async () => {
            const body = resetConfirm ?? (hasLegacy ? 'This also removes the custom colors from an earlier version.' : undefined)
            if (body && !await dialog.confirm({ title: `${resetLabel}?`, body, confirmLabel: 'Reset' })) return
            onReset()
          }}>{resetLabel}</button>}
        />
      )}
      {manage && (
        <Sheet title="Your schemes" onClose={() => setManage(false)}>
          {customs.length === 0 && <p className="settings-row-sub">The family hasn't saved any schemes yet. Start one from the scheme you're on.</p>}
          {customs.length > 0 && (
            <ul className="scheme-list" aria-label="Your schemes">
              {customs.map(c => {
                const [bg, , accent] = dotsFor(c.id as ColorScheme)
                return (
                  <li key={c.id} className="scheme-list-row">
                    <span className="scheme-swatch" aria-hidden="true" style={{ background: `linear-gradient(135deg, ${bg} 50%, ${accent} 50%)` }} />
                    <span className="scheme-list-name">{c.emoji || '🎨'} {c.name}{household.colorScheme === c.id && <span className="scheme-list-note"> · the family's</span>}</span>
                    {parentDevice && <>
                      <button className="btn btn-secondary" onClick={() => { setManage(false); setEditing({ draft: c, isNew: false }) }} aria-label={`Edit ${c.name}`}>Edit</button>
                      <button className="btn btn-danger" aria-label={`Delete ${c.name}`} onClick={async () => {
                        if (await dialog.confirm({ title: `Delete ${c.name}?`, body: 'Screens using it go back to Peach.', confirmLabel: 'Delete', danger: true })) deleteScheme(c)
                      }}>Delete</button>
                    </>}
                  </li>
                )
              })}
            </ul>
          )}
          {!parentDevice && customs.length > 0 && <p className="settings-row-sub">Editing and deleting the family's schemes is done on a parent's device.</p>}
          {customs.length < 10
            ? <button className="btn btn-primary btn-block scheme-new-btn" onClick={() => { setManage(false); newScheme() }}>＋ New scheme</button>
            : <p className="settings-row-sub">The family has 10 saved schemes, the most it can keep.{parentDevice ? ' Delete one to make another.' : ''}</p>}
        </Sheet>
      )}
      {hasLegacy && (
        <div className="scheme-legacy" role="note">
          {Object.keys(legacy).length > 0 && <span>Custom colors from an earlier version are applied on top of this scheme{householdScheme ? ' on this device' : ''}.</span>}
          {oldNames && <span>The family also chose the {oldNames} background in an earlier version. It no longer shows; save it as a scheme to keep that look.</span>}
          <div className="scheme-actions">
            <button className="btn btn-secondary" onClick={() => {
              const meadow = getSkin('meadow')
              const light = { ...(oldLight ? { ...paletteOf(meadow, false), bg: oldLight.bg, card: oldLight.card, text: oldLight.text } : paletteOf(skin, false)), ...legacy } as Palette
              const darkBase = oldDark ? { ...paletteOf(meadow, true), bg: oldDark.bg, card: oldDark.card, text: oldDark.text } : paletteOf(oldLight ? meadow : skin, true)
              const darkP = { ...darkBase, ...(legacy.accent ? { accent: legacy.accent } : {}) }
              const name = oldLight?.name ?? oldDark?.name ?? 'Custom'
              setEditing({ draft: { id: newSchemeId(), name, emoji: oldLight?.name === 'Sage' ? '🌿' : '🎨', light, dark: darkP }, isNew: true, fromLegacy: true })
            }}>Save as a scheme</button>
            <button className="btn btn-secondary" onClick={() => { if (legacyClear) void saveSettings(legacyClear); onClearLegacy?.(); announce('Old colors removed') }}>Remove them</button>
          </div>
        </div>
      )}
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
          if (await dialog.confirm({ title: `Delete ${draft.name}?`, body: 'Screens using it go back to Peach.', confirmLabel: 'Delete', danger: true })) run(onDelete)
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
                  <span style={{ color: b.textDim }}>{formatTime('16:00')} · Park field</span>
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

function DeviceAppearanceSection() {
  const { settings } = useApp()
  const summary = deviceChips(settings, useDeviceAppearance())
  return (
    <SummarySection title="Appearance on this device" icon={<PaletteIcon width={16} height={16} />} summary={summary}>
      <DeviceAppearanceRows />
    </SummarySection>
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
        resetLabel="Reset this device's appearance"
        resetConfirm="Mode, color scheme, text size, density, typeface, time format and low-stimulation mode go back to the family's settings on this device."
        onReset={() => { set({ themeMode: undefined, skin: undefined, custom: undefined, textScale: undefined, density: undefined, font: undefined, timeFormat: undefined, lowStim: undefined }); announce("This device follows the family's appearance") }}
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
      <TypefaceRow options={FONTS} value={device.font} family={settings.typeface ?? 'default'} onPick={key => { set({ font: key }); announce(key ? `${fontName(key)} typeface` : 'Household typeface') }} />
      <div className="device-pref-row">
        <span>Time format</span>
        <select className="settings-select" aria-label="Time format on this device" value={device.timeFormat ?? ''} onChange={e => set({ timeFormat: deviceTimeFormat(e.target.value) })}>
          <option value="">🏠 Use the family's ({TIME_FORMATS.find(o => o.key === (settings.timeFormat ?? 'auto'))?.label.split(' (')[0]})</option>
          {TIME_FORMATS.slice(1).map(o => <option key={o.key} value={o.key}>{o.label}</option>)}
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

/** Device-only behavior for this screen: member focus, locked calendar view, the Board's lists,
 * acting as a wall screen, keeping the screen on and going back to the calendar when idle. Stored
 * alongside the device appearance. `display`: a paired wall screen or kid's device, always a wall screen (no switch). */
function ScreenFocusRows({ display }: { display: boolean }) {
  const { members, focusMemberId, focusLocked, parentDevice } = useApp()
  const isPhone = useIsPhone()
  const device = useDeviceAppearance()
  const set = (patch: DeviceAppearance) => setDeviceAppearance({ ...device, ...patch })
  const focus = members.find(m => m.id === focusMemberId)
  const idleReset = device.idleReset ?? wallDefaultsOn(parentDevice, device)
  const keepOn = device.keepAwake ?? wallDefaultsOn(parentDevice, device)
  const views: { key: LockedView | ''; label: string }[] = [
    { key: '', label: 'Off' }, { key: 'week', label: isPhone ? '3 Day' : 'Week' }, { key: 'day', label: 'Day' }, { key: 'month', label: 'Month' }, { key: 'schedule', label: 'Schedule' }, { key: 'board', label: 'Board' },
  ]
  return (
    <>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
        <div className="device-pref-row">
          <span>Show only</span>
          {focusLocked ? <span className="settings-row-sub" style={{ margin: 0 }}>{focus ? `${focus.avatar} ${focus.name}` : 'Everyone'} · Set by a parent</span> : (
          <select className="settings-select" aria-label="Show only" value={focus?.id ?? ''}
            onChange={e => { set({ focusMemberId: e.target.value || undefined }); announce(e.target.value ? `Showing only ${members.find(m => m.id === e.target.value)?.name}` : 'Showing everyone') }}>
            <option value="">Everyone</option>
            {members.map(m => <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}
          </select>
          )}
        </div>
        {focus && (
          <div className="toggle-row">
            <label id="focus-shared-label">Also show things for everyone</label>
            <button className={`switch ${!device.focusHideShared ? 'on' : ''}`} role="switch" aria-checked={!device.focusHideShared} aria-labelledby="focus-shared-label"
              onClick={() => set({ focusHideShared: !device.focusHideShared || undefined })}><span className="knob" /></button>
          </div>
        )}
        <div className="settings-row-sub">{focus ? `Only ${focus.name}'s events, chores and lists show here${device.focusHideShared ? '' : ', plus ones with nobody assigned'}.` : focusLocked ? 'This display is shared by the whole family. A parent can change who it belongs to under Settings → Access.' : 'Pin this screen to one person — handy for a display in a bedroom.'}</div>
        <div className="device-pref-row">
          <span>Lock view</span>
          <select className="settings-select" aria-label="Lock calendar view" value={device.lockView ?? ''} onChange={e => set({ lockView: (e.target.value || undefined) as LockedView | undefined })}>
            {views.map(v => <option key={v.key} value={v.key}>{v.label}</option>)}
          </select>
        </div>
        <DeviceBoardLayoutRows />
        {!device.boardLayout && <div className="device-pref-row">
          <span>Board chores &amp; to-dos</span>
          <select className="settings-select" aria-label="Board chores and to-dos" value={device.boardLists ?? ''} onChange={e => set({ boardLists: (e.target.value || undefined) as DeviceAppearance['boardLists'] })}>
            <option value="">Auto</option>
            <option value="counts">Counts</option>
            <option value="full">Full lists</option>
          </select>
        </div>}
      </div>
      <DeviceTidbitRows />
      {!display && (
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div className="toggle-row">
            <label id="wall-screen-label">Use as a wall screen</label>
            <button className={`switch ${device.wallScreen ? 'on' : ''}`} role="switch" aria-checked={!!device.wallScreen} aria-labelledby="wall-screen-label" aria-describedby="wall-screen-sub"
              onClick={() => { set({ wallScreen: !device.wallScreen || undefined }); announce(device.wallScreen ? 'Wall screen off' : 'Wall screen on') }}><span className="knob" /></button>
          </div>
          <div className="settings-row-sub" id="wall-screen-sub">Acts like a wall screen: stays awake, returns to the calendar when idle, and rests on the Night screen at night. Your access doesn't change.</div>
        </div>
      )}
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="toggle-row">
          <label id="keep-awake-label">Keep the screen on</label>
          <button className={`switch ${keepOn ? 'on' : ''}`} role="switch" aria-checked={keepOn} aria-labelledby="keep-awake-label" onClick={() => set({ keepAwake: !keepOn })}><span className="knob" /></button>
        </div>
        <div className="settings-row-sub">Stops this screen from dimming and locking while Kinwall is open. On by default for wall screens and kids' devices, off on parents' phones and computers. Shopping mode and an open recipe keep the screen on either way.</div>
      </div>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="toggle-row">
          <label id="idle-reset-label">Back to the calendar when idle</label>
          <button className={`switch ${idleReset ? 'on' : ''}`} role="switch" aria-checked={idleReset} aria-labelledby="idle-reset-label" onClick={() => set({ idleReset: !idleReset })}><span className="knob" /></button>
        </div>
        <div className="settings-row-sub">After 2 minutes without a tap, this screen closes what's open and shows today's calendar, but never while an activity is open. Handy on the wall; on by default there, off on parents' phones and computers.</div>
      </div>
    </>
  )
}

function TimeCuesSection() {
  const d = useDeviceAppearance()
  const summary = timeCuesSummary({ nowNext: d.nowNext ?? true, warnings: d.warnings ?? [], repeat: d.warningRepeat, sound: !!d.warningSound })
  return <SummarySection title="Time cues" summary={summary}><TimeCueRows /></SummarySection>
}

/** Now / Next and transition warnings on this device. */
function TimeCueRows() {
  const device = useDeviceAppearance()
  const set = (patch: DeviceAppearance) => setDeviceAppearance({ ...device, ...patch })
  const warnings = device.warnings ?? []
  const anyWarnings = warningTimes(warnings, device.warningRepeat).length > 0
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
        <div className="settings-row-sub">A calm banner before the next event, or before it's time to leave. Pick one or more times, add your own, or repeat them as the event gets close. Held at night, unless the family turns that off under Night.</div>
        <MinutesPicker idBase="warn" label="Transition warnings" presets={[10, 5, 1]} minutes={warnings} repeat={device.warningRepeat ?? null} repeatDefault={{ every: 1, within: 5 }}
          onOff={() => set({ warnings: undefined, warningRepeat: undefined })}
          onChange={(minutes, repeat) => set({ warnings: minutes.length ? minutes : undefined, warningRepeat: repeat ?? undefined })} />
        {anyWarnings && (
          <div className="toggle-row">
            <label id="warning-sound-label">Sound</label>
            <button className={`switch ${device.warningSound ? 'on' : ''}`} role="switch" aria-checked={!!device.warningSound} aria-labelledby="warning-sound-label"
              onClick={() => set({ warningSound: !device.warningSound || undefined })}><span className="knob" /></button>
          </div>
        )}
        {anyWarnings && <div className="settings-row-sub">A soft chime with each warning.</div>}
      </div>
    </>
  )
}

/** Minutes-before picker shared by this device's transition warnings and a member's transition
 * reminders: preset chips, your own times (1-120, up to 8 in all), and "every N min during the
 * last M". `onOff` adds an Off chip that clears everything. */
function MinutesPicker({ idBase, label, presets, minutes, repeat, onChange: save, onOff, minEvery = 1, repeatDefault }: {
  idBase: string; label: string; presets: number[]; minutes: number[]; repeat: WarningRepeat | null; minEvery?: number; repeatDefault: WarningRepeat
  onChange: (minutes: number[], repeat: WarningRepeat | null) => void; onOff?: () => void
}) {
  // A picked time the repeat already reaches (10 with "every 5 in the last 30") does nothing: grey it out and drop it.
  const covered = (m: number, r: WarningRepeat | null) => !!r && m <= r.within && m % r.every === 0
  const onChange = (ms: number[], r: WarningRepeat | null) => save(ms.filter(m => !covered(m, r)), r)
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const sorted = (xs: number[]) => [...new Set(xs)].sort((a, b) => b - a)
  const toggle = (m: number) => onChange(minutes.includes(m) ? minutes.filter(x => x !== m) : sorted([...minutes, m]), repeat)
  const custom = minutes.filter(m => !presets.includes(m))
  const full = minutes.length >= MAX_WARNING_TIMES
  const n = Number(draft)
  const valid = Number.isInteger(n) && n >= 1 && n <= 120
  const add = () => {
    if (!valid || full) return
    onChange(sorted([...minutes, n]), repeat)
    announce(`${n} minutes added`)
    setDraft(''); setAdding(false)
  }
  const none = minutes.length === 0 && !repeat
  return (
    <>
      <div className="chip-row" role="group" aria-label={label}>
        {onOff && <button className={`chip ${none ? 'active' : ''}`} aria-pressed={none} onClick={onOff}>Off</button>}
        {presets.map(m => covered(m, repeat)
          ? <button key={m} className="chip" disabled aria-label={`${m} min, covered by the repeat`}>{m} min</button>
          : <button key={m} className={`chip ${minutes.includes(m) ? 'active' : ''}`} aria-pressed={minutes.includes(m)} disabled={full && !minutes.includes(m)} onClick={() => toggle(m)}>{m} min</button>
        )}
        {custom.filter(m => !covered(m, repeat)).map(m => (
          <button key={m} className="chip active" aria-label={`Remove ${m} min`} onClick={() => toggle(m)}>{m} min ✕</button>
        ))}
        {!adding && <button className="chip" disabled={full} onClick={() => setAdding(true)}>Add…</button>}
      </div>
      {adding && (
        <div className="minutes-row">
          <input id={`${idBase}-add`} type="number" inputMode="numeric" min={1} max={120} step={1} value={draft} autoFocus aria-label="Minutes before (1 to 120)"
            onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false) }} />
          <span>min before</span>
          <button className="btn btn-primary" disabled={!valid} onClick={add}>Add</button>
          <button className="btn btn-secondary" onClick={() => { setDraft(''); setAdding(false) }}>Cancel</button>
        </div>
      )}
      {full && <div className="settings-row-sub">That's {MAX_WARNING_TIMES} times, the most there can be. Tap one to remove it.</div>}
      <div className="toggle-row">
        <label id={`${idBase}-repeat-label`}>Repeat as it gets close</label>
        <button className={`switch ${repeat ? 'on' : ''}`} role="switch" aria-checked={!!repeat} aria-labelledby={`${idBase}-repeat-label`}
          onClick={() => onChange(minutes, repeat ? null : repeatDefault)}><span className="knob" /></button>
      </div>
      {repeat && presets.some(m => covered(m, repeat)) && <div className="settings-row-sub">Grayed-out times are already covered by the repeat.</div>}
      {repeat && (
        <div className="minutes-row">
          <span>Every</span>
          <select className="settings-select" aria-label="Repeat every" value={repeat.every}
            onChange={e => { const every = Number(e.target.value); onChange(minutes, { every, within: Math.max(every, repeat.within) }) }}>
            {REPEAT_EVERY.filter(v => v >= minEvery).map(v => <option key={v} value={v}>{v} min</option>)}
          </select>
          <span>during the last</span>
          <select className="settings-select" aria-label="During the last" value={repeat.within} onChange={e => onChange(minutes, { ...repeat, within: Number(e.target.value) })}>
            {REPEAT_WITHIN.filter(v => v >= repeat.every).map(v => <option key={v} value={v}>{v} min</option>)}
          </select>
        </div>
      )}
    </>
  )
}

/** The Night screen's pictures: the plain clock, or a dim slideshow cycling through the picked
 * sources (Screensaver.tsx). The family picks for every wall screen; a screen can pick its own. */
const SAVER_OPTIONS: { key: SaverSource; label: string }[] = [
  { key: 'drawings', label: 'Drawings' }, { key: 'photos', label: 'Family photos' }, { key: 'google', label: 'Google Photos' }, { key: 'art', label: 'Art (The Met)' }, { key: 'nature', label: 'Nature' },
]
/** A source the family can show: family photos on, Google Photos connected with albums picked. */
const saverOffered = (key: SaverSource, settings: Settings) => (key !== 'photos' || settings.features.photos) && (key !== 'google' || settings.googlePhotos === 'ready')
const CLOCK_POSITIONS: { key: ClockPos | ''; label: string }[] = [
  { key: '', label: 'Moves around' }, { key: 'center', label: 'Center' }, { key: 'top-left', label: 'Top left' }, { key: 'top-right', label: 'Top right' }, { key: 'bottom-left', label: 'Bottom left' }, { key: 'bottom-right', label: 'Bottom right' },
]
/** Back from Google Photos' sign-in (routes/oauth.ts → #/settings?googlePhotos=…): reopen the family's Night screen. */
const googlePhotosReturn = () => new URLSearchParams(location.hash.split('?')[1] || '').get('googlePhotos')

/** Summary chips for a Night screen's choices; `family`: marked as the family's (🏠). */
function nightChips(n: NightFields, settings: Settings, family = false): Chip[] {
  const sources = SAVER_OPTIONS.filter(o => n.saverSources?.includes(o.key) && saverOffered(o.key, settings)).map(o => o.label)
  const pos = n.clockPos && CLOCK_POSITIONS.find(p => p.key === n.clockPos)?.label
  const chips = nightSummary({ sources, every: n.saverEvery ?? 5, bright: n.saverBright ?? 'low', clock: n.saverClock !== false, pos })
  return family ? chips.map(c => ({ ...c, family: true })) : chips
}

/** For the whole family: Night. One schedule (the night hours, quietFrom / quietTo) and what it
 * does: wall screens rest (showing the Night screen, with what they show and the wake PIN) and
 * reminders are held (notify.ts, wallScreen.ts remindersHeld). Each effect can be turned off. */
function NightSection({ settings, onSaved, toast }: { settings: Settings; onSaved: () => void; toast: (m: string, persist?: boolean) => void }) {
  const [returned] = useState(googlePhotosReturn)
  useEffect(() => {
    if (!returned) return
    if (returned === 'canceled') toast('Google sign-in canceled — nothing was connected', true)
    if (returned === 'failed') toast("Google Photos didn't connect. Try again.", true)
    const q = new URLSearchParams(location.hash.split('?')[1] || '')
    q.delete('googlePhotos')
    history.replaceState(null, '', `#/settings${q.toString() ? `?${q}` : ''}`)
  }, [returned]) // eslint-disable-line react-hooks/exhaustive-deps
  const saveSettings = async (patch: Partial<Settings>) => {
    try { await api.updateSettings(patch); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings', true) }
  }
  const look = familyNightFields(settings.nightLook)
  const saveLook = (patch: NightFields) => saveSettings({ nightLook: toNightLook({ ...look, ...patch }) })
  const on = !!settings.quietFrom && !!settings.quietTo
  const rest = settings.nightRest !== false
  const hold = settings.nightHoldReminders !== false
  const summary = nightHoursChips(on ? { hours: nightHoursLabel(settings), rest, hold, pin: settings.quietPin } : null)
  return (
    <SummarySection id="night" title="Night" summary={summary} startOpen={!!returned}>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="settings-row-label" aria-hidden="true">Night hours</div>
        <Segmented label="Night hours" value={on ? 'on' : 'off'}
          onChange={v => { if (v === 'off') saveSettings({ quietFrom: null, quietTo: null }); else if (!on) saveSettings({ quietFrom: '22:00', quietTo: '06:00' }) }}
          options={[{ key: 'off', label: 'Off' }, { key: 'on', label: 'On' }]} />
        {on && (
          <div className="row-2" style={{ marginTop: 4 }}>
            <div className="field" style={{ margin: 0 }}><label>Night from</label><input type="time" value={settings.quietFrom ?? ''} onChange={e => e.target.value && saveSettings({ quietFrom: e.target.value, quietTo: settings.quietTo })} /></div>
            <div className="field" style={{ margin: 0 }}><label>Night to</label><input type="time" value={settings.quietTo ?? ''} onChange={e => e.target.value && saveSettings({ quietFrom: settings.quietFrom, quietTo: e.target.value })} /></div>
          </div>
        )}
        <div className="settings-row-sub">{on ? 'One schedule for the whole family. What it does is below.' : 'Set night hours to rest wall screens and hold reminders overnight.'}</div>
      </div>
      <h3 className="settings-subhead">Wall screens</h3>
      {on && <div className="settings-row">
        <div className="toggle-row" style={{ flex: 1 }}>
          <div>
            <label id="night-rest-label">Rest at night</label>
            <div className="settings-row-sub" id="night-rest-sub">Wall screens show the Night screen during night hours. A tap wakes one for five minutes.</div>
          </div>
          <button className={`switch ${rest ? 'on' : ''}`} role="switch" aria-checked={rest} aria-labelledby="night-rest-label" aria-describedby="night-rest-sub" onClick={() => saveSettings({ nightRest: !rest })}><span className="knob" /></button>
        </div>
      </div>}
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <NightRows value={look} onChange={saveLook} label="What they show" />
        <div className="settings-row-sub">{on && rest ? 'At night, and whenever' : 'Whenever'} the Night screen is started from the moon button or Home Assistant. A screen can pick its own under Night screen on this device.</div>
        <GooglePhotosRows />
      </div>
      {on && rest && <QuietPinRow settings={settings} onSaved={onSaved} toast={toast} />}
      {on && <>
        <h3 className="settings-subhead">Notifications</h3>
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <div className="toggle-row">
            <label id="night-hold-label">Hold reminders at night</label>
            <button className={`switch ${hold ? 'on' : ''}`} role="switch" aria-checked={hold} aria-labelledby="night-hold-label" onClick={() => saveSettings({ nightHoldReminders: !hold })}><span className="knob" /></button>
          </div>
          <div className="settings-row-sub">{hold ? 'Wait until morning' : 'Come through at night too'}: transition reminders, time cues, Live Activities, low battery alerts and the morning check-in reminder.</div>
          <div className="settings-row-sub">Always come through: event reminders, medicine reminders, the evening goal check, daily summaries and messages.</div>
        </div>
      </>}
    </SummarySection>
  )
}

/** "10:00 PM–6:00 AM" in this device's time format. */
const nightHoursLabel = (s: Settings) => `${formatTime(s.quietFrom!)}–${formatTime(s.quietTo!)}`

/** For a device's Notifications card: that some reminders wait out the night, when they do. */
function nightHoldNote(s: Settings): string | null {
  return s.quietFrom && s.quietTo && s.nightHoldReminders !== false ? `At night (${nightHoursLabel(s)}) some reminders wait until morning: see Hold reminders at night, under Night.` : null
}

/** Only on this device: the family's Night screen (default) or this screen's own, and a preview. */
function NightScreenSection() {
  const { settings } = useApp()
  const device = useDeviceAppearance()
  const own = ownsNight(device)
  const summary = own ? nightChips(nightFieldsFor(device, settings.nightLook), settings) : nightChips(familyNightFields(settings.nightLook), settings, true)
  const clear = { nightOwn: undefined, saverSources: undefined, saverEvery: undefined, saverBright: undefined, saverClock: undefined, clockPos: undefined }
  return (
    <SummarySection title="Night screen on this device" summary={summary}>
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="device-pref-row">
          <span>Night screen</span>
          <select className="settings-select" aria-label="Night screen" value={own ? 'own' : ''}
            onChange={e => {
              if (e.target.value) { setDeviceAppearance({ ...device, ...clear, nightOwn: true, ...familyNightFields(settings.nightLook) }); announce('This screen picks its own Night screen') }
              else { setDeviceAppearance({ ...device, ...clear }); announce("This screen follows the family's Night screen") }
            }}>
            <option value="">Family’s choice</option>
            <option value="own">This screen’s own</option>
          </select>
        </div>
        {own
          ? <NightRows value={nightFieldsFor(device, settings.nightLook)} onChange={patch => setDeviceAppearance({ ...device, ...patch })} here />
          : <div className="settings-row-sub">This screen shows what the family picked for wall screens. Parents change it under For the whole family → Night.</div>}
        <button className="btn btn-secondary saver-preview-btn" onClick={() => window.dispatchEvent(new Event(SAVER_PREVIEW_EVENT))}>Preview screensaver</button>
        <div className="settings-row-sub">Shows what this screen does overnight for 20 seconds. Tap or press Escape to end it. Only wall screens dim on their own: paired displays, and devices with Use as a wall screen on under This display.</div>
      </div>
    </SummarySection>
  )
}

/** A Night screen's choices (the family's or one screen's). `here`: this screen's own, so the
 * notes can speak about this display. */
function NightRows({ value, onChange, here = false, label = 'Show' }: { value: NightFields; onChange: (patch: NightFields) => void; here?: boolean; label?: string }) {
  const { settings } = useApp()
  const sources = value.saverSources ?? []
  const toggle = (k: SaverSource) => {
    const next = sources.includes(k) ? sources.filter(x => x !== k) : SAVER_OPTIONS.map(o => o.key).filter(x => x === k || sources.includes(x))
    onChange({ saverSources: next.length ? next : undefined })
  }
  const hasDrawings = here && sources.includes('drawings')
  const [noDrawings, setNoDrawings] = useState(false)
  useEffect(() => {
    if (hasDrawings) countDrawings().then(n => setNoDrawings(n === 0)).catch(() => setNoDrawings(true))
  }, [hasDrawings])
  const services = [sources.includes('art') && 'The Metropolitan Museum of Art (public-domain works)', sources.includes('nature') && 'Lorem Picsum (free Unsplash photos)'].filter(Boolean).join(' and ')
  return <>
    <div className="settings-row-label" aria-hidden="true">{label}</div>
    <div className="chip-row" role="group" aria-label={label}>
      <button className={`chip ${sources.length === 0 ? 'active' : ''}`} aria-pressed={sources.length === 0} onClick={() => onChange({ saverSources: undefined })}>Clock only</button>
      {SAVER_OPTIONS.filter(o => saverOffered(o.key, settings) || (o.key === 'google' && sources.includes('google'))).map(o => ( // photos off: nature pictures stand in (saverSources.ts)
        <button key={o.key} className={`chip ${sources.includes(o.key) ? 'active' : ''}`} aria-pressed={sources.includes(o.key)} onClick={() => toggle(o.key)}>{o.label}</button>
      ))}
    </div>
    {sources.length > 1 && <div className="settings-row-sub">Takes turns between the ones you pick.</div>}
    {sources.includes('drawings') && !here && <div className="settings-row-sub">Each screen shows the drawings made on it (Activities → Paint).</div>}
    {hasDrawings && noDrawings && <div className="settings-row-sub">No drawings on this display yet — open Activities → Paint.{sources.length === 1 && ' Until then it shows the clock.'}</div>}
    {services && <div className="settings-row-sub">Pictures are fetched by {here ? 'this display' : 'each screen'} directly from {services}; {services.includes(' and ') ? 'they' : 'it'} will see {here ? "this device's" : "the screen's"} address.</div>}
    {sources.includes('google') && <div className="settings-row-sub">Google Photos pictures come through your Kinwall server, which keeps only which photos to show, never the photos.</div>}
    {sources.length > 0 && <>
      <div className="settings-row-label" aria-hidden="true">Change picture every</div>
      <Segmented label="Change picture every" value={String(value.saverEvery ?? 5)} onChange={v => onChange({ saverEvery: v === '5' ? undefined : Number(v) })}
        options={[2, 5, 10, 20].map(m => ({ key: String(m), label: `${m} min` }))} />
      <div className="settings-row-label" aria-hidden="true">Brightness</div>
      <Segmented label="Brightness" value={value.saverBright ?? 'low'} onChange={v => onChange({ saverBright: v === 'medium' ? 'medium' : undefined })}
        options={[{ key: 'low', label: 'Low' }, { key: 'medium', label: 'Medium' }]} />
      <div className="toggle-row">
        <label id={`saver-clock-label${here ? '-here' : ''}`}>Show clock</label>
        <button className={`switch ${value.saverClock !== false ? 'on' : ''}`} role="switch" aria-checked={value.saverClock !== false} aria-labelledby={`saver-clock-label${here ? '-here' : ''}`}
          onClick={() => onChange({ saverClock: value.saverClock === false ? undefined : false })}><span className="knob" /></button>
      </div>
    </>}
    {(sources.length === 0 || value.saverClock !== false) && <>
      <div className="device-pref-row">
        <span>Clock position</span>
        <select className="settings-select" aria-label="Clock position" value={value.clockPos ?? ''} onChange={e => onChange({ clockPos: (e.target.value || undefined) as ClockPos | undefined })}>
          {CLOCK_POSITIONS.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      </div>
      <div className="settings-row-sub">{value.clockPos ? 'The clock stays put. Moves around protects the screen from burn-in.' : 'Every few minutes the clock fades to a new spot, so no pixels stay lit in one place.'}</div>
    </>}
  </>
}

/** Connecting Google Photos for the whole family (parent devices): Google's own sign-in, with a
 * code, then picking albums in Google Photos. Kept apart from Google Calendar. */
function GooglePhotosRows() {
  const { parentDevice, reloadCore, toast, settings } = useApp()
  const dialog = useDialog()
  const isPhone = useIsPhone()
  const [gp, setGp] = useState<GooglePhotos | null>(null)
  const [busy, setBusy] = useState(false)
  const device = useDeviceAppearance()
  const picked = !!settings.nightLook?.sources.includes('google')
  const state = gp?.state
  const lastState = useRef(settings.googlePhotos)
  useEffect(() => {
    if (!parentDevice) return
    let stop = false
    const load = () => api.getGooglePhotos(true).then(g => { if (!stop) setGp(g) }).catch(() => {})
    load()
    // While connecting, keep checking: the server asks Google no more often than Google allows.
    const id = state === 'signing-in' || state === 'choosing' ? setInterval(load, 3000) : undefined
    return () => { stop = true; clearInterval(id) }
  }, [parentDevice, state])
  useEffect(() => { if (state && state !== lastState.current) { lastState.current = state; reloadCore() } }, [state, reloadCore])
  if (!parentDevice || !gp || (!gp.available && state === 'off')) return null

  const run = async (f: () => Promise<GooglePhotos>) => {
    setBusy(true)
    try { setGp(await f()) } catch (e) { toast(e instanceof Error ? e.message : "Couldn't reach Google Photos", true) } finally { setBusy(false) }
  }
  // The web sign-in goes to Google's page in this tab, like Connect Google for Calendar. A wall screen
  // stays on the sheet instead, with a QR code to finish on a phone (or Continue to Google).
  const wall = !!device.wallScreen
  const connect = () => run(async () => {
    const g = await api.connectGooglePhotos()
    if (g.authUrl && !wall && !MOCK) location.href = g.authUrl
    return g
  })
  const disconnect = async () => {
    if (!await dialog.confirm({ title: 'Disconnect Google Photos?', body: 'Google Photos stops showing on every screen. Kinwall removes its device from your Google Photos, cancels its access to your Google account and forgets which photos to show. Your photos stay in Google Photos. Google Calendar isn\'t affected.', confirmLabel: 'Disconnect', danger: true })) return
    run(api.disconnectGooglePhotos)
  }
  // Reconnecting an older connection, to show its account: start over (albums are picked again).
  const reconnect = async () => {
    if (!await dialog.confirm({ title: 'Reconnect Google Photos?', body: "You'll sign in to Google again and choose albums again. Until then, screens show your other picks.", confirmLabel: 'Reconnect' })) return
    run(async () => { await api.disconnectGooglePhotos(); const g = await api.connectGooglePhotos(); if (g.authUrl && !wall && !MOCK) location.href = g.authUrl; return g })
  }
  const qr = (value: string) => !isPhone && <div className="google-photos-qr"><QrCode value={value} size={value.length > 200 ? 220 : 148} /><div className="settings-row-sub">Scan with your phone.</div></div>
  // Which Google account: the name and email on a parent's phone or computer; on a wall screen (a
  // shared, public spot) only an avatar, per Google's guidelines.
  const account = gp.account
  const who = account && (
    <div className="google-photos-account">
      <span className="google-photos-avatar" aria-hidden="true">{(account.name || account.email).charAt(0).toUpperCase()}</span>
      <span>
        <span className="settings-row-label">Connected to Google Photos</span>
        {!wall && <span className="settings-row-sub">{account.name ? `${account.name} · ` : ''}{account.email}</span>}
      </span>
    </div>
  )
  return (
    <div className="google-photos">
      <div className="settings-row-label">Google Photos</div>
      {MOCK && <div className="settings-row-sub">Demo: this only pretends to connect. Nothing goes to Google.</div>}
      {(state === 'off' || state === 'reconnect' || state === 'refused') && <>
        {state === 'reconnect' && <div className="settings-row-sub google-photos-note" role="status">⚠️ Google Photos stopped sharing with Kinwall, so screens show your other picks for now. Reconnect to bring it back.</div>}
        {state === 'refused' && <div className="settings-row-sub google-photos-note" role="alert">⚠️ Google didn't allow Photos with this app; see the <a className="text-link" href={`${DOCS_URL}/self-hosting/configuration#google-photos`} target="_blank" rel="noopener">docs for the TV-client option</a>.</div>}
        {state === 'off' && <>
          <div className="settings-row-sub">Show photos from albums you choose in Google Photos on the family's screens. When you connect, Google asks you to let Kinwall:</div>
          <ul className="google-photos-scopes settings-row-sub">
            <li><b>See the photos in albums you choose</b> for Kinwall, to show them on the Night screen and the Board.</li>
            <li><b>See your name and email</b>, to show here which Google account is connected.</li>
          </ul>
          <div className="settings-row-sub">Kinwall never changes, uploads or shares your photos, and keeps only which ones to show. This is separate from Google Calendar.</div>
        </>}
        <button className="btn btn-primary" disabled={busy} onClick={connect}>{state === 'off' ? 'Connect Google Photos' : state === 'reconnect' ? 'Reconnect Google Photos' : 'Try again'}</button>
      </>}
      {state === 'signing-in' && gp.authUrl && <>
        {/* Like Connect Google for Calendar: Google's page in this tab, back to this sheet after. */}
        <div className="settings-row-sub">Sign in with the Google account that has your photos, then choose albums for Kinwall.</div>
        <a className="btn btn-primary" href={gp.authUrl} onClick={e => { if (!MOCK) return; e.preventDefault() }}>Continue to Google</a>
        {!isPhone && <div className="settings-row-sub">Or connect from a phone or computer:</div>}
        {qr(gp.authUrl)}
        <div className="settings-row-sub" role="status">Waiting for you to sign in…</div>
      </>}
      {state === 'signing-in' && gp.userCode && gp.verificationUrl && <>
        <div className="settings-row-sub">On a phone or computer, go to <a className="text-link" href={gp.verificationUrl} target="_blank" rel="noreferrer">{gp.verificationUrl.replace(/^https:\/\/(www\.)?/, '')}</a> and enter this code:</div>
        <div className="google-photos-code" aria-label={`Code ${gp.userCode.split('').join(' ')}`}>{gp.userCode}</div>
        {qr(gp.verificationUrl)}
        <div className="settings-row-sub" role="status">Waiting for you to sign in…</div>
      </>}
      {(state === 'choosing' || state === 'ready') && (who || <div className="settings-row-label">Connected to Google Photos</div>)}
      {state === 'choosing' && <div className="settings-row-sub" role="status">Waiting for you to choose albums in Google Photos…</div>}
      {state === 'ready' && <div className="settings-row-sub">{gp.photos !== undefined && `${gp.photos} ${gp.photos === 1 ? 'photo' : 'photos'} to show. `}{!picked && 'Pick Google Photos above to show them on wall screens. '}Google Photos leaves out screenshots, blurry shots and very personal photos, and Kinwall shows photos only, not videos.</div>}
      {(state === 'choosing' || state === 'ready') && gp.settingsUri && <>
        <a className="btn btn-secondary" href={gp.settingsUri} target="_blank" rel="noreferrer">{state === 'choosing' ? 'Choose albums in Google Photos' : 'Change albums in Google Photos'}</a>
        {state === 'choosing' && qr(gp.settingsUri)}
      </>}
      {state === 'ready' && !account && <>
        <div className="settings-row-sub">Connected before Kinwall showed the account. Reconnect to see which Google account it uses; you'll choose albums again.</div>
        <button className="link-btn google-photos-disconnect" disabled={busy} onClick={reconnect}>Reconnect to show the account</button>
      </>}
      {state === 'signing-in' && <button className="link-btn google-photos-disconnect" disabled={busy} onClick={() => run(api.disconnectGooglePhotos)}>Cancel</button>}
      {state !== 'off' && state !== 'signing-in' && <button className="btn btn-secondary google-photos-disconnect" disabled={busy} onClick={disconnect}>Disconnect Google Photos</button>}
    </div>
  )
}

function ThisDisplaySection({ keyName }: { keyName?: string }) {
  const isPhone = useIsPhone()
  const { pref } = useNavMode()
  const { settings } = useApp()
  return (
    <Section title="This display" icon={<MonitorIcon width={16} height={16} />}>
      {keyName !== undefined && (
        <div className="settings-row">
          <div className="settings-row-label">Paired as {keyName || 'this display'}</div>
        </div>
      )}
      <ScreenFocusRows display={keyName !== undefined} />
      <InstallRow />
      <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="settings-row-label" aria-hidden="true">Navigation position</div>
        <Segmented label="Navigation position" value={pref} onChange={setNavPref} options={NAV_PREF_OPTIONS} disabled={isPhone} style={isPhone ? { opacity: 0.5 } : undefined} />
        <div className="settings-row-sub">{isPhone ? 'Phones use the bottom bar, or a side rail when turned sideways.' : 'Where the Calendar, Chores and Lists buttons sit.'}</div>
      </div>
      {appQuickSettingsTiles() && <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
        <div className="settings-row-label">Add a Quick Settings tile</div>
        <div className="settings-row-sub">A tile is a button in the panel you swipe down from the top of the screen, so you can use Kinwall without opening it. Android asks before adding it.</div>
        {settings.features.lists && <button className="btn btn-secondary" onClick={() => addAppTile('groceries')}>Add to Groceries</button>}
        <button className="btn btn-secondary" onClick={() => addAppTile('night')}>Night screen</button>
      </div>}
    </Section>
  )
}

/** Stuck-build reload, and unpairing for a display key. */
function TroubleshootSection({ keyName }: { keyName?: string }) {
  const dialog = useDialog()
  const unpair = async () => {
    if (!await dialog.confirm({ title: 'Unpair this display?', body: 'You\'ll need to pair it again from an admin device to use it here.', confirmLabel: 'Unpair', danger: true })) return
    await clearKey()
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
      {inNativeApp() ? (
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <button className="btn btn-danger" onClick={async () => {
            if (!await dialog.confirm({ title: 'Sign out of the app?', body: 'You can sign in again with your passkey, or pair with a code.', confirmLabel: 'Sign out', danger: true })) return
            clearKey() // the app ends its sign-in and shows its own sign-in screen
          }}>Sign out</button>
          <div className="settings-row-sub">Signs this app out of Kinwall. An app signed in with a passkey is also removed from Connected apps.</div>
        </div>
      ) : keyName !== undefined && (
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 8 }}>
          <button className="btn btn-danger" onClick={unpair}>Unpair this display</button>
          <div className="settings-row-sub">Clears the key stored on this device and returns to the pairing screen. This doesn't revoke the key. A parent can do that under Settings → Access → Paired devices.</div>
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
      <ColorClashNote members={members} canManage={canManage} onChanged={onChanged} toast={toast} />
      {edit && (
        <MemberEditSheet member={edit === 'new' ? null : edit} canDelete={canManage} onClose={() => setEdit(null)}
          onSaved={() => { setEdit(null); onChanged() }} toast={toast} />
      )}
    </Section>
  )
}

function MemberEditSheet({ member, canDelete, onClose, onSaved, toast }: { member: Member | null; canDelete: boolean; onClose: () => void; onSaved: () => void; toast: (m: string, persist?: boolean) => void }) {
  const dialog = useDialog()
  const [transitions, setTransitions] = useState<TransitionReminders>(member?.transitionReminders ?? { on: false, minutes: [], repeat: null, leaveBy: true })
  const [name, setName] = useState(member?.name ?? '')
  const [color, setColor] = useState(member?.color ?? MEMBER_PALETTE[0])
  const [avatar, setAvatar] = useState(member?.avatar ?? MEMBER_EMOJI[0])
  // Birthday: a date input always needs a year, so "don't know the year" keeps a placeholder one
  // (2000, a leap year: Feb 29 still fits) and saves --MM-DD.
  const [bday, setBday] = useState(member?.birthday?.replace(/^--/, '2000-') ?? '')
  const [noYear, setNoYear] = useState(!!member?.birthday?.startsWith('--'))
  const birthday = !bday ? null : noYear ? `--${bday.slice(5)}` : bday
  const [grownUp, setGrownUp] = useState(!!member?.grownUp)
  const [needsApproval, setNeedsApproval] = useState(!!member?.needsApproval)
  const [tempCheck, setTempCheck] = useState<TempCheckSettings>({ ...TEMP_CHECK_OFF, ...member?.tempCheck })
  const save = async () => {
    if (!name.trim() || !isValidAvatar(avatar)) return
    try {
      // Transition reminders are a parent's setting: only sent from a device that may manage members.
      const extra = canDelete ? { transitionReminders: transitions, grownUp, needsApproval: needsApproval && !grownUp, tempCheck } : {}
      if (member) await api.updateMember(member.id, { name: name.trim(), color, avatar, birthday, ...extra })
      else await api.createMember({ name: name.trim(), color, avatar, birthday, ...extra })
      onSaved()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save member', true) }
  }
  const del = async () => {
    if (!member) return
    if (!await dialog.confirm({ title: `Remove ${member.name}?`, body: 'Their chores and tags are unassigned. Their books, memories and health visits are kept under their name.', confirmLabel: 'Remove', danger: true })) return
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
        <ColorClashHint color={color} memberId={member?.id ?? null} onPick={setColor} />
      </div>
      <div className="field">
        <label>Avatar</label>
        <div className="emoji-swatch-row">
          {MEMBER_EMOJI.map(e => <button key={e} className={`emoji-swatch ${avatar === e ? 'active' : ''}`} aria-pressed={avatar === e} onClick={() => setAvatar(e)}>{e}</button>)}
        </div>
        <AnyEmojiField value={avatar} onChange={setAvatar} allowInitials />
      </div>
      {canDelete && (
        <div className="field">
          <div className="toggle-row">
            <label id="member-grown-up">Grown-up</label>
            <button className={`switch ${grownUp ? 'on' : ''}`} role="switch" aria-checked={grownUp} aria-labelledby="member-grown-up" onClick={() => setGrownUp(v => !v)}><span className="knob" /></button>
          </div>
          <p className="field-hint">Parents and other adults: their chores never wait for an OK.</p>
        </div>
      )}
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
      {canDelete && !grownUp && <>
      <div className="toggle-row">
        <label id="member-needs-approval">Their chores need a parent's OK</label>
        <button className={`switch ${needsApproval ? 'on' : ''}`} role="switch" aria-checked={needsApproval} aria-labelledby="member-needs-approval" onClick={() => setNeedsApproval(v => !v)}><span className="knob" /></button>
      </div>
      <p className="field-hint">Chores they tick on a wall screen or their own device wait for a parent to approve before the points count. A chore's own setting wins.</p>
      </>}
      {canDelete && <TransitionRemindersField name={name.trim() || 'this person'} value={transitions} onChange={setTransitions} />}
      {canDelete && <TempCheckField member={member} name={name.trim() || 'this person'} value={tempCheck} onChange={setTempCheck} toast={toast} />}
      {canDelete && member && !member.grownUp && <PrivateJournalField member={member} toast={toast} />}
    </Sheet>
  )
}

/** A parent lets a kid keep a private journal (saved right away, and noted in the family's notifications).
 * Grown-ups' journals are private by default and they decide on their own device. */
function PrivateJournalField({ member, toast }: { member: Member; toast: (m: string, persist?: boolean) => void }) {
  const { reloadCore } = useApp()
  const [allowed, setAllowed] = useState(!!member.privateJournal?.allowed)
  const change = async (next: boolean) => {
    try { setAllowed((await api.setJournalPrivacy(member.id, { allowed: next })).allowed); reloadCore(); toast('Saved') }
    catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't change that", true) }
  }
  return (
    <div className="field">
      <div className="toggle-row">
        <label id="member-private-journal">Let {member.name} keep a private journal</label>
        <button className={`switch ${allowed ? 'on' : ''}`} role="switch" aria-checked={allowed} aria-labelledby="member-private-journal" onClick={() => change(!allowed)}><span className="knob" /></button>
      </div>
      <div className="settings-row-sub">{allowed
        ? `${member.name} can turn it on from their own device. Then you see their mood, not what they write.${member.privateJournal?.on ? ` It's on now.` : ''}`
        : `Off: parent devices can read ${member.name}'s journal. Turning this off later keeps entries already private.`}</div>
    </div>
  )
}

/** A member's Temp check: daily questions at the end of their day, and their own feelings (to remove one). */
function TempCheckField({ member, name, value, onChange, toast }: { member: Member | null; name: string; value: TempCheckSettings; onChange: (t: TempCheckSettings) => void; toast: (m: string, persist?: boolean) => void }) {
  const set = (patch: Partial<TempCheckSettings>) => onChange({ ...value, ...patch })
  const [custom, setCustom] = useState<string[]>([])
  const savedOn = !!member?.tempCheck?.on // their list can change once Temp check is saved on
  useEffect(() => {
    if (member && savedOn) api.getTempCheck(member.id).then(t => setCustom(t.custom ?? [])).catch(() => {})
  }, [member, savedOn])
  const remove = async (f: string) => {
    if (!member) return
    try { setCustom((await api.putTempCheck(member.id, { custom: custom.filter(x => x !== f) })).custom ?? []); toast(`Removed: ${f}`) }
    catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't remove that", true) }
  }
  const row = (key: 'sleep' | 'feelings' | 'goal' | 'showGoal' | 'evening' | 'journal' | 'battery', label: string) => (
    <div className="toggle-row" key={key}>
      <label id={`member-tc-${key}`}>{label}</label>
      <button className={`switch ${value[key] ? 'on' : ''}`} role="switch" aria-checked={!!value[key]} aria-labelledby={`member-tc-${key}`} onClick={() => set({ [key]: !value[key] })}><span className="knob" /></button>
    </div>
  )
  return (
    <div className="field">
      <div className="toggle-row">
        <label id="member-tc-label">Temp check</label>
        <button className={`switch ${value.on ? 'on' : ''}`} role="switch" aria-checked={value.on} aria-labelledby="member-tc-label" onClick={() => set({ on: !value.on })}><span className="knob" /></button>
      </div>
      <div className="settings-row-sub">A few quick questions at the end of {name}'s day. Sleep and feelings are kept private and encrypted; a shared wall shows only that they answered.</div>
      {value.on && <>
        {row('sleep', 'How did you sleep?')}
        {row('feelings', 'How are you feeling?')}
        {row('goal', 'Goal for today')}
        {value.goal && row('showGoal', 'Show the goal on the Board')}
        {value.goal && row('evening', 'Evening goal check')}
        {value.goal && value.evening && <>
          <div className="settings-row">
            <div>
              <div className="settings-row-label" id="member-tc-time">Ask at</div>
              <div className="settings-row-sub">"Did you finish your goal?" on {name}'s devices and their day, until midnight.</div>
            </div>
            <select className="settings-select" aria-labelledby="member-tc-time" value={value.eveningTime} onChange={e => set({ eveningTime: e.target.value })}>
              {EVENING_TIMES.map(t => <option key={t} value={t}>{formatTime(t)}</option>)}
            </select>
          </div>
          {row('journal', 'Keep answers in the journal')}
          <div className="settings-row-sub">{value.journal ? `What helped, what got in the way and next time go in ${name}'s journal.` : 'Only yes, partly or not today is kept, never the notes.'}</div>
        </>}
        {row('battery', 'Energy battery')}
        <div className="settings-row-sub">A rough daily guess at {name}'s energy from sleep, feelings and how full the day is, with a heads-up before heavy days on {name}'s devices, and a "How drained do you feel?" each evening that tunes it. Private to {name} and parents.</div>
        {custom.length > 0 && (
          <div className="settings-row">
            <div>
              <div className="settings-row-label">{name}'s own feelings</div>
              <div className="settings-row-sub">{custom.join(', ')}</div>
            </div>
            <select className="settings-select" aria-label={`Remove one of ${name}'s feelings`} value="" onChange={e => e.target.value && remove(e.target.value)}>
              <option value="">Remove…</option>
              {custom.map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        )}
        {member && savedOn && (
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Insights</div>
              <div className="settings-row-sub">Patterns in {name}'s check-ins, next to chores and busy days. Private to {name} and parents.</div>
            </div>
            <a className="btn btn-secondary profile-link" href={`#/insights/${member.id}`}>Open insights</a>
          </div>
        )}
      </>}
    </div>
  )
}

/** A member's transition reminders: pushes to their own phone or tablet before their events. */
function TransitionRemindersField({ name, value, onChange }: { name: string; value: TransitionReminders; onChange: (t: TransitionReminders) => void }) {
  const set = (patch: Partial<TransitionReminders>) => onChange({ ...value, ...patch })
  return (
    <div className="field">
      <div className="toggle-row">
        <label id="member-transitions-label">Transition reminders</label>
        <button className={`switch ${value.on ? 'on' : ''}`} role="switch" aria-checked={value.on} aria-labelledby="member-transitions-label"
          onClick={() => set(value.on ? { on: false } : { on: true, ...(value.minutes.length || value.repeat ? {} : { minutes: [30], repeat: { every: 5, within: 15 } }) })}><span className="knob" /></button>
      </div>
      <div className="settings-row-sub">{value.on ? transitionRemindersSummary(value) : `Extra heads-ups before ${name}'s events, sent to devices that belong to ${name}. Helpful when switching activities is hard.`}</div>
      {value.on && (
        <>
          <MinutesPicker idBase="member-transitions" label="Transition reminder times" presets={[60, 30, 15, 10, 5]} minutes={value.minutes} repeat={value.repeat} minEvery={5} repeatDefault={{ every: 5, within: 15 }}
            onChange={(minutes, repeat) => set({ minutes, repeat })} />
          <div className="toggle-row">
            <label id="member-transitions-leave-label">Count down to leaving</label>
            <button className={`switch ${value.leaveBy ? 'on' : ''}`} role="switch" aria-checked={value.leaveBy} aria-labelledby="member-transitions-leave-label"
              onClick={() => set({ leaveBy: !value.leaveBy })}><span className="knob" /></button>
          </div>
          <div className="settings-row-sub">When an event has travel time, reminders count to the time to leave ("Leave for Soccer in 5 minutes"). They go to phones and tablets set up as {name}'s under Settings → Access, with notifications on. Held at night, unless the family turns that off under Night.</div>
        </>
      )}
    </div>
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
  const [displayEdit, setDisplayEdit] = useState(calendar.displayEdit !== false)
  const [filter, setFilter] = useState(calendar.filter)
  const [filterOpen, setFilterOpen] = useState(false)
  const [hidden, setHidden] = useState<HiddenEvent[] | null>(null)
  const [hiddenOpen, setHiddenOpen] = useState(false)
  useEffect(() => { api.getHiddenEvents(calendar.id).then(setHidden).catch(() => setHidden([])) }, [calendar.id])

  const save = async () => {
    if (!name.trim()) return
    try {
      await api.updateCalendar(calendar.id, { name: name.trim(), color, memberIds, categoryId, enabled, displayEdit })
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
      <div className="field">
        <label htmlFor="calendar-filter">Filter</label>
        <button id="calendar-filter" type="button" className="sheet-link" aria-haspopup="dialog" aria-label={`Filter: ${filterSummary(filter)}`} onClick={() => setFilterOpen(true)}>
          <span>{filterSummary(filter)}<small>Which events the family sees</small></span><ChevronRight />
        </button>
      </div>
      {filterOpen && <CalendarFilterSheet calendar={{ ...calendar, filter }} onClose={() => setFilterOpen(false)} onSaved={f => { setFilter(f); setFilterOpen(false) }} />}
      <div className="field">
        <label htmlFor="calendar-hidden">Hidden events</label>
        <button id="calendar-hidden" type="button" className="sheet-link" aria-haspopup="dialog" onClick={() => setHiddenOpen(true)}
          aria-label={`Hidden events: ${hidden === null ? 'loading' : hidden.length || 'none'}`}>
          <span>{hidden === null ? '…' : hidden.length ? `${hidden.length} hidden` : 'None'}<small>Hidden one by one, to show again</small></span><ChevronRight />
        </button>
      </div>
      {hiddenOpen && hidden && <HiddenEventsSheet calendar={calendar} hidden={hidden} onChanged={setHidden} onClose={() => setHiddenOpen(false)} />}
      <div className="toggle-row">
        <label id="calendar-enabled-label">Enabled</label>
        <button className={`switch ${enabled ? 'on' : ''}`} role="switch" aria-checked={enabled} aria-labelledby="calendar-enabled-label" onClick={() => setEnabled(v => !v)}><span className="knob" /></button>
      </div>
      {/* Read-only feeds (ICS links, read-only shared calendars): nobody edits their events, so no switch. */}
      {!calendar.writable ? <p className="settings-row-sub">Read-only: this calendar's events come from {calendar.kind === 'ics' ? 'a feed link' : 'its account'} and can't be added to or changed in Kinwall. You can still hide events or filter it.</p> : <div className="toggle-row">
        <div>
          <label id="calendar-display-edit-label">Wall screens and kids' devices can edit</label>
          <div className="settings-row-sub" id="calendar-display-edit-sub">Off: only parents' devices add, change or delete its events. A kid's device can only ever change calendars that are for them.</div>
        </div>
        <button className={`switch ${displayEdit ? 'on' : ''}`} role="switch" aria-checked={displayEdit} aria-labelledby="calendar-display-edit-label" aria-describedby="calendar-display-edit-sub" onClick={() => setDisplayEdit(v => !v)}><span className="knob" /></button>
      </div>}
      <div className="cal-actions" style={{ marginTop: 4 }}>
        {calendar.kind !== 'local' && <button className="link-btn" onClick={onSync}>Sync now</button>}
        <button className="link-btn" style={{ color: 'var(--danger)' }} onClick={onRemove}>Remove</button>
      </div>
      {/* For automations that name a calendar, like the meal kit blueprint's "Add dinners to calendar". */}
      <p className="settings-row-sub">Calendar ID: <code style={{ userSelect: 'all', wordBreak: 'break-all' }}>{calendar.id}</code></p>
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
    await clearKey()
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
    <Section id="passkeys" title="Parent devices" icon={<KeyIcon width={16} height={16} />}>
      <p className="settings-row-sub">Phones and computers that sign in with a passkey. Parents (admins) can change everything.</p>
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
          <button className="add-row-btn" onClick={() => { setName('This device'); setCreating('default') }}><PlusIcon width={20} height={20} />Add a passkey on this phone or computer</button>
          <button className="link-btn" style={{ minHeight: 44 }} onClick={() => { setName('Security key'); setCreating('cross-platform') }}>Use a security key or another device</button>
        </>
      )}
      {qr ? (
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'center', gap: 10 }}>
          <QrCode value={new URL(`#/admin-setup?token=${qr.token}`, document.baseURI).href} size={168} />
          <div className="settings-row-sub">Scan with the other parent's phone or computer to make it a parent device.</div>
          <button className="link-btn" onClick={() => setQr(null)}>Done</button>
        </div>
      ) : (
        <button className="add-row-btn" onClick={startAnotherDevice}><PlusIcon width={20} height={20} />Add another parent's phone or computer</button>
      )}
    </Section>
  )
}

const NUDGE_DISMISSED_KEY = 'kinwall.secondWayInDismissedAt'
const NUDGE_SNOOZE_MS = 30 * 24 * 60 * 60 * 1000

/** Top of Access: shown while there's only one way in (≤1 passkey and no unused recovery codes).
 * Dismissing snoozes it on this device for 30 days. */
function SecondWayInNudge({ tick }: { tick: number }) {
  const [show, setShow] = useState(false)
  useEffect(() => {
    try { if (Date.now() - Number(localStorage.getItem(NUDGE_DISMISSED_KEY) ?? 0) < NUDGE_SNOOZE_MS) return } catch { /* storage blocked */ }
    Promise.all([api.getPasskeys(), api.getRecoveryCodes()])
      .then(([passkeys, codes]) => setShow(passkeys.length <= 1 && codes.remaining === 0))
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
      <div className="settings-row-label">Add a second way in, like another parent's phone or recovery codes, so losing one device doesn't lock the family out.</div>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <button className="link-btn" onClick={() => jump('passkeys')}>Parent devices</button>
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
/** OAuth connections (e.g. a Claude connector) - approved on the consent screen, revoked here.
 * Kinwall's own app also has an owner ("Whose device is this?"), changeable here. */
/** The Kinwall app's widgets and Watch keys under `parent` (the device or app sign-in that made them,
 * wallScreen.ts widgetParent), or, with `parent` null, the ones Kinwall can't place. */
const widgetsUnder = (all: ApiKey[], parent: { keyId: string } | { grantId: string } | null) =>
  all.filter(k => k.kind === 'widgets' && JSON.stringify(widgetParent(k, all)) === JSON.stringify(parent))

/** A line under a phone for its widgets and Watch, each removable (say the phone was lost). They go
 * with the phone anyway: removing or disconnecting it signs them out too. */
function WidgetKeys({ keys, onChanged, toast }: { keys: ApiKey[]; onChanged: () => void; toast: (m: string, persist?: boolean) => void }) {
  const dialog = useDialog()
  if (keys.length === 0) return null
  const remove = async (k: ApiKey) => {
    if (!await dialog.confirm({ title: `Remove "${k.name}"?`, body: 'They stop updating until the phone signs in again.', confirmLabel: 'Remove', danger: true })) return
    try { await api.deleteKey(k.id); onChanged() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not remove it', true) }
  }
  return (
    <div className="widget-keys" role="group" aria-label="Widgets and Watch">
      {keys.map(k => (
        <div key={k.id} className="widget-key">
          <div className="key-item-info">
            <div className="settings-row-label">{/watch/i.test(k.name) ? '⌚' : '🧩'} {k.name}</div>
            <div className="settings-row-sub">{k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'never used'}</div>
          </div>
          <button className="icon-btn" onClick={() => remove(k)} aria-label={`Remove ${k.name}`}><TrashIcon width={16} height={16} /></button>
        </div>
      ))}
    </div>
  )
}

function ConnectedAppsSection({ toast }: { toast: (m: string, persist?: boolean) => void }) {
  const dialog = useDialog()
  const { reloadCore, members, settings } = useApp()
  const setHealth = async (on: boolean) => {
    try { await api.updateSettings({ aiHealthAccess: on }); reloadCore() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings', true) }
  }
  const ownerName = (o: string | null) => { const m = o && o !== 'shared' ? members.find(x => x.id === o) : undefined; return m ? `${m.avatar} ${m.name}'s device` : 'Anyone can use it' }
  const [apps, setApps] = useState<Awaited<ReturnType<typeof api.getAuthorizations>>>([])
  const [keys, setKeys] = useState<ApiKey[]>([])
  const load = () => { api.getAuthorizations().then(setApps).catch(() => {}); api.getKeys().then(setKeys).catch(() => {}) }
  useEffect(load, [])
  const revoke = async (id: string, name: string) => {
    const widgets = widgetsUnder(keys, { grantId: id }).length > 0
    if (!await dialog.confirm({ title: `Disconnect ${name}?`, body: `It will need to be approved again to use Kinwall.${widgets ? ' Its widgets and Watch are signed out too.' : ''}`, confirmLabel: 'Disconnect', danger: true })) return
    try { await api.revokeAuthorization(id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not disconnect', true) }
  }
  const changeOwner = async (id: string, owner: string) => {
    try { await api.setAuthorizationOwner(id, owner); load(); reloadCore() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not change whose device it is', true) }
  }
  return (
    <Section title="Connected apps" icon={<LinkIcon width={16} height={16} />}>
      {apps.length === 0 && <p className="settings-row-sub">Apps you connect with sign-in (like a Claude connector) appear here. Point them at {location.origin}/mcp.</p>}
      {apps.map(a => (
        <Fragment key={a.id}>
          <div className={a.deviceApp && !a.current ? 'key-item key-item-owned' : 'key-item'}>
            <div className="key-item-info">
              <div className="settings-row-label">{a.clientName}{a.current && <> <span className="cal-kind-badge">This device</span></>}</div>
              <div className="settings-row-sub">
                {a.scope === 'admin' ? 'Full access' : 'Everyday access'}
                {a.current && ` · ${ownerName(a.owner)}`}
                {' · '}connected {new Date(a.createdAt).toLocaleDateString()}
                {a.lastUsedAt ? ` · used ${new Date(a.lastUsedAt).toLocaleDateString()}` : ''}
              </div>
            </div>
            {/* Everyday access is a kid's or shared, never a grown-up's (it would open their journal). */}
            {a.deviceApp && !a.current && <OwnerSelect value={a.owner ?? 'shared'} members={a.scope === 'display' ? members.filter(m => !m.grownUp || m.id === a.owner) : undefined} onChange={v => changeOwner(a.id, v)} label={`Whose device ${a.clientName} is`} />}
            {!a.current && <button className="icon-btn" onClick={() => revoke(a.id, a.clientName)} aria-label={`Disconnect ${a.clientName}`}><TrashIcon width={16} height={16} /></button>}
          </div>
          <WidgetKeys keys={widgetsUnder(keys, { grantId: a.id })} onChanged={load} toast={toast} />
        </Fragment>
      ))}
      <div className="toggle-row">
        <div>
          <label id="ai-health-label">Let connected apps see health entries</label>
          <div className="settings-row-sub" id="ai-health-sub">Off: Claude and other connected apps can't read or change the Health tracker.</div>
        </div>
        <button className={`switch ${settings.aiHealthAccess ? 'on' : ''}`} role="switch" aria-checked={settings.aiHealthAccess} aria-labelledby="ai-health-label" aria-describedby="ai-health-sub"
          onClick={() => setHealth(!settings.aiHealthAccess)}><span className="knob" /></button>
      </div>
    </Section>
  )
}

/** Whose device this parent's device is (PUT /api/me/owner): a grown-up, so it reads their private
 * journal. The admin key, a recovery sign-in and connected apps can't belong to anyone (the server says so). */
function ThisDeviceOwnerSection({ me, toast }: { me: Me; toast: (m: string, persist?: boolean) => void }) {
  const { members, meMemberId, reloadCore } = useApp()
  const grownUps = members.filter(m => m.grownUp)
  if (me.scope !== 'admin' || grownUps.length === 0) return null
  const change = async (owner: string) => {
    try { await api.setMyOwner(owner); reloadCore(); toast('Saved') } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't change that", true) }
  }
  return (
    <Section title="This device">
      <div className="settings-row">
        <div>
          <div className="settings-row-label" id="this-device-owner">Whose device is this?</div>
          <div className="settings-row-sub">It opens that person's private journal. The family sees a note when this changes.</div>
        </div>
        <select className="settings-select" aria-labelledby="this-device-owner" value={meMemberId ?? 'shared'} onChange={e => change(e.target.value)}>
          <option value="shared">No one in particular</option>
          {grownUps.map(m => <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}
        </select>
      </div>
    </Section>
  )
}

function KeysSection({ toast }: { toast: (m: string, persist?: boolean) => void }) {
  const dialog = useDialog()
  const { members, reloadCore } = useApp()
  const [all, setAll] = useState<ApiKey[]>([])
  const keys = all.filter(k => k.scope === 'admin')
  const [newKey, setNewKey] = useState<{ name: string; key: string } | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const load = () => { api.getKeys().then(setAll).catch(() => {}) }
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
  const del = async (id: string) => { if (!await dialog.confirm({ title: 'Delete this API key?', body: `Anything using it stops working immediately.${widgetsUnder(all, { keyId: id }).length ? ' So do the widgets and Watch it made.' : ''}`, confirmLabel: 'Delete', danger: true })) return; try { await api.deleteKey(id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete key', true) } }
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
        <Fragment key={k.id}>
          <div className="key-item key-item-owned">
            <div className="key-item-info">
              <div className="settings-row-label">{k.name} <span className="cal-kind-badge">{k.scope}</span></div>
              <div className="settings-row-sub">{[k.prefix && `${k.prefix}…`, k.lastUsedAt ? `used ${new Date(k.lastUsedAt).toLocaleDateString()}` : 'never used'].filter(Boolean).join(' · ')}</div>
            </div>
            {/* A full-access key can belong to a grown-up: then it reads their private journal. */}
            <OwnerSelect value={k.owner ?? 'shared'} members={members.filter(m => m.grownUp)} onChange={v => api.setKeyOwner(k.id, v).then(() => { load(); reloadCore() }, e => toast(e instanceof ApiError ? e.message : 'Could not change who it belongs to', true))} label={`Who ${k.name} belongs to`} />
            <button className="icon-btn" onClick={() => del(k.id)} aria-label={`Delete ${k.name}`}><TrashIcon width={16} height={16} /></button>
          </div>
          <WidgetKeys keys={widgetsUnder(all, { keyId: k.id })} onChanged={load} toast={toast} />
        </Fragment>
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
/** Who a full-access device (a parent's key, the Kinwall app's sign-in) belongs to: the whole family, or one grown-up. */
export function OwnerSelect({ value, onChange, members, id, label }: { value: string; onChange: (v: string) => void; members?: Member[]; id?: string; label?: string }) {
  const ctx = useContext(AppContext)
  const list = members ?? ctx?.members ?? []
  return (
    <select className="settings-select" id={id} aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
      <option value="shared">Anyone (whole family)</option>
      {list.map(m => <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}
    </select>
  )
}

/** "What is this device?" for a paired device: the family's wall screen or a kid's device (which
 * kid), in one picker. Never a grown-up's: whoever approves a code mustn't get a key that opens a
 * grown-up's private journal. Value: 'wall' or kid:memberId (wallScreen.ts deviceKindValue); ''
 * (only with `legacy`) for one paired before anyone said, or as a grown-up's (needs a fix). */
export function DeviceKindSelect({ value, onChange, members, id, label, legacy }: { value: string; onChange: (v: string) => void; members?: Member[]; id?: string; label?: string; legacy?: boolean }) {
  const ctx = useContext(AppContext)
  const list = members ?? ctx?.members ?? []
  const kids = list.filter(m => !m.grownUp)
  return (
    <select className="settings-select" id={id} aria-label={label} value={value} onChange={e => onChange(e.target.value)}>
      {legacy && <option value="" disabled>Pick one</option>}
      <option value="wall">🖼️ Wall screen (whole family)</option>
      {kids.length > 0 && <optgroup label="A kid's device">{kids.map(m => <option key={m.id} value={`kid:${m.id}`}>{m.avatar} {m.name}'s device</option>)}</optgroup>}
    </select>
  )
}

// 'grownup': paired as a grown-up's before that was refused. It no longer opens their journal.
const KIND_GROUPS: { kind: DeviceKind | null; title: string; sub?: string }[] = [
  { kind: 'grownup', title: 'Needs a fix', sub: "Paired as a grown-up's device, which isn't allowed any more: it no longer opens their journal. Make it a wall screen or a kid's device, or remove it and sign in there with a passkey." },
  { kind: 'wall', title: 'Wall screens' }, { kind: 'kid', title: "Kids' devices" }, { kind: null, title: 'Not set yet' },
]

function DisplaysSection({ toast }: { toast: (m: string, persist?: boolean) => void }) {
  const dialog = useDialog()
  const { reloadCore, members } = useApp()
  const [all, setAll] = useState<ApiKey[]>([])
  // The app's widgets and Watch show under the device that made them, not as paired devices.
  const keys = all.filter((k): k is ApiKey & { kind?: DeviceKind | null } => k.scope === 'display' && k.kind !== 'widgets')
  const unplaced = widgetsUnder(all, null)
  const [code, setCode] = useState('')
  const [name, setName] = useState('Wall screen')
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const load = () => { api.getKeys().then(setAll).catch(() => {}) }
  useEffect(load, [])

  const [what, setWhat] = useState('wall')
  const pair = async () => {
    if (code.length !== 6 || !name.trim()) return
    setBusy(true)
    try {
      await api.pairApprove(code, name.trim(), parseDeviceKind(what))
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
  const changeKind = async (k: ApiKey, next: string) => {
    try { await api.setKeyKind(k.id, parseDeviceKind(next)); load(); reloadCore() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not change what it is', true) }
  }
  const revoke = async (k: ApiKey) => {
    if (!await dialog.confirm({ title: `Remove "${k.name}"?`, body: `It will be signed out and need pairing again.${widgetsUnder(all, { keyId: k.id }).length ? ' So will its widgets and Watch.' : ''}`, confirmLabel: 'Remove', danger: true })) return
    try { await api.deleteKey(k.id); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not revoke display', true) }
  }

  return (
    <Section title="Paired devices" icon={<MonitorIcon width={16} height={16} />}>
      <p className="settings-row-sub">Paired with a code. They get the calendar, chores and lists, but not settings. A kid's device shows only their things. Grown-ups sign in on their own phone with a passkey instead.</p>
      {keys.length === 0 && <p className="settings-row-sub">None yet. Open Kinwall on the screen and choose "Set up a wall screen or kid's device" to get a code.</p>}
      {KIND_GROUPS.map(g => ({ ...g, keys: keys.filter(k => deviceKindOf(k, members) === g.kind) })).filter(g => g.keys.length > 0).map(g => (
        <div key={g.title} role="group" aria-labelledby={`device-kind-${g.kind ?? 'none'}`}>
          <div className="settings-row-label device-kind-title" id={`device-kind-${g.kind ?? 'none'}`}>{g.kind === 'grownup' ? '⚠️ ' : ''}{g.title}</div>
          {g.sub && <p className="settings-row-sub">{g.sub}</p>}
          {g.keys.map(k => (
            <Fragment key={k.id}>
              <div className="key-item key-item-owned">
                <div className="key-item-info">
                  <div className="settings-row-label">{k.name}</div>
                  <div className="settings-row-sub">
                    created {new Date(k.createdAt).toLocaleDateString()}
                    {k.lastUsedAt ? ` · used ${new Date(k.lastUsedAt).toLocaleDateString()}` : ' · never used'}
                  </div>
                </div>
                <DeviceKindSelect value={deviceKindValue(k, members)} onChange={v => changeKind(k, v)} label={`What ${k.name} is`} legacy={!deviceKindValue(k, members)} />
                <button className="icon-btn" onClick={() => revoke(k)} aria-label={`Remove ${k.name}`}><TrashIcon width={16} height={16} /></button>
              </div>
              <WidgetKeys keys={widgetsUnder(all, { keyId: k.id })} onChanged={load} toast={toast} />
            </Fragment>
          ))}
        </div>
      ))}
      {unplaced.length > 0 && <div role="group" aria-labelledby="device-kind-widgets">
        <div className="settings-row-label device-kind-title" id="device-kind-widgets">Widgets and Watch</div>
        <p className="settings-row-sub">From the Kinwall app on a phone that isn't listed here, most made before Kinwall kept track of which phone. Remove any you don't recognize; the phone makes new ones when it signs in again.</p>
        <WidgetKeys keys={unplaced} onChanged={load} toast={toast} />
      </div>}
      <button className="add-row-btn" onClick={() => setAdding(true)}><PlusIcon width={20} height={20} />Add a wall screen or kid's device</button>

      {adding && (
        <Sheet title="Add a wall screen or kid's device" onClose={() => setAdding(false)}
          actions={<button className="btn btn-primary btn-block" onClick={pair} disabled={busy || code.length !== 6 || !name.trim()}>{busy ? 'Pairing…' : 'Add it'}</button>}>
          <p className="settings-row-sub" style={{ marginBottom: 14 }}>On that screen, open Kinwall, choose "Set up a wall screen or kid's device", then enter the 6-digit code it shows. Scanning its QR code with your phone works too.</p>
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
          <div className="field">
            <label htmlFor="pair-kind">What is this device?</label>
            <DeviceKindSelect id="pair-kind" value={what} onChange={setWhat} />
            <p className="settings-row-sub">A wall screen is the whole family's. A kid's device shows only their events, chores and lists. Only a parent can change this later. Grown-ups sign in on their own phone with a passkey instead.</p>
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
  const { parentDevice } = useApp()
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
      {/* Self-hosted: nothing in the app deletes the family; it goes with wherever Kinwall runs. */}
      {!hostPortalUrl && parentDevice && (
        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
          <div className="settings-row-label">Deleting your family's data</div>
          <p className="settings-row-sub">Download an export first if you might want any of it back. Then delete it where Kinwall runs:</p>
          <ul className="settings-row-sub" style={{ margin: 0, paddingLeft: 20 }}>
            <li>Docker: remove the container and its data folder (and any backups of it).</li>
            <li>Cloudflare: delete the Worker and its D1 database.</li>
            <li>Home Assistant: uninstall the add-on and remove its data.</li>
          </ul>
          <a className="text-link" href={`${DOCS_URL}/your-data/deleting-everything`} target="_blank" rel="noopener">How to delete everything</a>
        </div>
      )}
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
