import { useEffect, useState } from 'react'
import type { BoardLayout } from './boardLayout.ts'
import type { ClockPos } from './nightClock.ts'
import type { Appearance, ColorScheme, CustomColors, DeviceDensity, Settings, TextScale, TidbitSettings, Typeface } from './types.ts'
import { deviceTypeface, resolveTypeface } from './typeface.ts'
import { deviceTimeFormat } from './timeFormat.ts'
import { accentFill, logoHeads, readableOn } from './color.ts'
import { api, getKey } from './api.ts'
import { DEFAULT_SKIN_ID, findSkin, seasonalSkinId, tokensFor } from './skins.ts'
import { surfaces, tellAppAppearance } from './native.ts'
import { inTimeWindow } from './wallScreen.ts'
export { inTimeWindow } // callers import it from here

const SCALE: Record<TextScale, string> = { s: '0.9', m: '1', l: '1.15', xl: '1.3' }

// Per-device overrides of the household appearance (a wall iPad read from across the room and a
// phone in the hand want different sizes). Absent key = follow the household setting. Kept in
// localStorage like the nav position; a same-tab event re-applies, since 'storage' is cross-tab only.
import type { WarningRepeat } from './transitions.ts'

const DEVICE_KEY = 'kinwall.deviceAppearance'
/** The last light/dark this device showed, for the first paint before settings load (main.tsx). */
const LAST_THEME_KEY = 'kinwall.lastTheme' // read by main.tsx (not imported there: it would load api.ts early)
const LAST_LOOK_KEY = 'kinwall.lastLook' // the root's inline colors, also restored by main.tsx before the first render
const DEVICE_EVENT = 'kinwall:device-appearance'
// The same object also carries this device's other preferences (focus, warnings, locked view…),
// so every per-device choice lives in one place and one event re-renders whoever reads it.
export type FontChoice = Exclude<Typeface, 'default'>
export type LockedView = 'week' | 'day' | 'month' | 'schedule' | 'board' | 'newscast'
export type DeviceAppearance = Partial<Pick<Appearance, 'themeMode' | 'textScale'>> & {
  density?: DeviceDensity // 'icons' (icon-first) exists per device only
  lowStim?: boolean // flat, calm, no motion - see [data-lowstim] in styles.css
  font?: Typeface // this device's typeface ('default' = Nunito); absent = the family's
  timeFormat?: '12' | '24' // this device's clock times; absent = the family's (timeFormat.ts)
  clockZone?: 'device' // the clock and date show this device's own time zone; absent = the family's (timezone.ts clockTimeZone)
  nowNext?: boolean // Now / Next card on the calendar; absent = on
  keepAwake?: boolean // keep the screen on while Kinwall is showing; absent = on for wall screens and kids' devices, off for parent devices
  idleReset?: boolean // back to the calendar after 2 idle minutes; absent = on for wall screens and kids' devices, off for parent devices
  wallScreen?: boolean // act as a wall screen (Night screen at night, the two defaults above); paired displays always do
  warnings?: number[] // transition warnings, minutes before an event (or its leave-by)
  warningRepeat?: WarningRepeat // ...plus every N minutes during the last M (transitions.ts)
  warningSound?: boolean
  focusMemberId?: string // this display shows only one member's things
  focusHideShared?: boolean // ...and hides the ones assigned to nobody
  lockView?: LockedView // calendar stays on this view, no switcher
  tidbitCards?: TidbitSettings[] // the Board's quote / fact cards, 1-3 with their own sources (tidbits.ts); absent = the family's one card
  boardLists?: 'counts' | 'full' // the Board's Chores and Due soon: count tiles or full cards; absent = auto (full on a big screen)
  boardLayout?: string // the Board's layout (boardLayout.ts): a preset's id or 'custom' (boardCustom); absent = the default arrangement
  boardCustom?: BoardLayout // this screen's own layout
  nightOwn?: true // this screen's own Night screen (the saver fields below); absent = the family's (saverSources.ts ownsNight)
  saverSources?: SaverSource[] // Night screen slideshow, round-robin; absent/empty = the plain clock
  saverEvery?: number // minutes between pictures; absent = 5
  saverBright?: 'medium' // absent = low
  saverClock?: false // corner clock; absent = shown
  clockPos?: ClockPos // Night screen clock (big or corner) stays here; absent = moves around (burn-in guard)
  skin?: ColorScheme // this device's color scheme (a skins.ts id or 'seasonal'); absent = the household's
  custom?: CustomColors // hex, layered on the scheme; surfaces ignored in low-stim
}

/** The household accent's default: it means "use the color scheme's own accent". */
export const DEFAULT_ACCENT = '#FF9E7A'

/** The colors in effect, in one place for the theme and the Settings pickers. A device that picks
 * its own scheme starts from that scheme alone; a device that follows the household's scheme also
 * gets the household's custom colors, and its own custom colors go on top of those. */
export function resolveColors(household: Pick<Appearance, 'colorScheme' | 'customColors' | 'customSchemes' | 'accent'>, device: DeviceAppearance) {
  const scheme: ColorScheme = device.skin ?? household.colorScheme ?? DEFAULT_SKIN_ID
  const skinId = scheme === 'seasonal' ? seasonalSkinId() : scheme
  const householdCustom: CustomColors = {
    ...(household.customColors ?? {}),
    ...(household.accent && household.accent.toUpperCase() !== DEFAULT_ACCENT ? { accent: household.accent } : {}),
  }
  const custom: CustomColors = device.skin ? { ...(device.custom ?? {}) } : { ...householdCustom, ...(device.custom ?? {}) }
  return { scheme, skinId, skin: findSkin(skinId, household.customSchemes), custom, householdCustom }
}
export type SaverSource = 'drawings' | 'photos' | 'art' | 'nature' | 'google'

export function readDeviceAppearance(): DeviceAppearance {
  try {
    const v = JSON.parse(localStorage.getItem(DEVICE_KEY) || '{}')
    if (!v || typeof v !== 'object') return {}
    // Older builds: `seasonal: true` beside the skin, and accent / background overrides from before
    // color schemes. The accent carries over as a custom accent; the background presets had no
    // equivalent on a device and are dropped. The next save writes the new shape.
    if (v.seasonal) v.skin = 'seasonal'
    delete v.seasonal
    if (typeof v.accent === 'string') v.custom = { accent: v.accent, ...(v.custom ?? {}) }
    delete v.accent; delete v.backgroundLight; delete v.backgroundDark
    // Older builds stored one screensaver source as `saver`; the next save writes the new shape.
    if ('saver' in v) {
      if (!v.saverSources && ['drawings', 'art', 'nature'].includes(v.saver)) v.saverSources = [v.saver]
      delete v.saver
    }
    // Only a real pick is an override; Default used to be saved as nothing, so it follows the family.
    v.font = deviceTypeface(v.font)
    if (!v.font) delete v.font
    v.timeFormat = deviceTimeFormat(v.timeFormat)
    if (!v.timeFormat) delete v.timeFormat
    return v
  } catch { return {} }
}

/** Writes only a changed value: a write fires 'storage' in every other window of the app. */
function saveIfChanged(key: string, value: string) {
  if (localStorage.getItem(key) !== value) localStorage.setItem(key, value)
}

export function setDeviceAppearance(next: DeviceAppearance) {
  const clean = Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined))
  try { localStorage.setItem(DEVICE_KEY, JSON.stringify(clean)) } catch { /* private mode */ }
  window.dispatchEvent(new Event(DEVICE_EVENT))
}

export function useDeviceAppearance(): DeviceAppearance {
  const [v, setV] = useState(readDeviceAppearance)
  useEffect(() => {
    const on = () => setV(readDeviceAppearance())
    // Only this device's settings changing in another window: reacting to every key made two windows
    // (a tab and the installed app) re-apply and rewrite the saved look back and forth without end.
    const onStorage = (e: StorageEvent) => { if (e.key === DEVICE_KEY || e.key === null) on() }
    window.addEventListener(DEVICE_EVENT, on)
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener(DEVICE_EVENT, on); window.removeEventListener('storage', onStorage) }
  }, [])
  return v
}

/** Density actually in effect: low-stimulation mode never runs compact (it wants more room). */
export function effectiveDensity(household: Appearance['density'], device: DeviceAppearance): DeviceDensity {
  const d = device.density ?? household
  return device.lowStim && d === 'compact' ? 'comfortable' : d
}

// CSS families for the typeface choice. All are bundled (src/fonts/fonts.css); a browser fetches a
// face's files only once text uses it (it's picked, or the Typeface sheet shows them all).
export const FONT_FAMILIES: Record<FontChoice, string> = {
  hyperlegible: "'Atkinson Hyperlegible Next'",
  dyslexia: "'Lexend'",
  modern: "'Figtree'",
  playful: "'Fredoka'", // tops out at 700; 800 text renders at 700
  storybook: "'Literata'",
  handwritten: "'Kalam'", // 400 and 700 only; heavier weights use 700
}
/** A typeface's CSS family ('Nunito' for the default). */
export function loadFont(font: Typeface | undefined): string {
  return (font && font !== 'default' && FONT_FAMILIES[font]) || "'Nunito'"
}
function applyFont(font: Typeface) {
  if (font !== 'default') document.documentElement.style.setProperty('--font', loadFont(font))
  else document.documentElement.style.removeProperty('--font')
}

function applyAppearance(household: Appearance, device: DeviceAppearance) {
  const a = { ...household, ...device, density: effectiveDensity(household.density, device) }
  const root = document.documentElement
  root.toggleAttribute('data-lowstim', !!a.lowStim)
  applyFont(resolveTypeface(household.typeface, device.font))

  const apply = () => {
    let dark: boolean
    if (a.themeMode === 'dark') dark = true
    else if (a.themeMode === 'light') dark = false
    else if (a.themeMode === 'auto') dark = matchMedia('(prefers-color-scheme: dark)').matches
    else dark = inTimeWindow(a.darkFrom, a.darkTo)

    root.setAttribute('data-theme', dark ? 'dark' : 'light')
    root.removeAttribute('data-bg') // old background presets: replaced by color schemes (see Settings' earlier-version note)
    root.setAttribute('data-density', a.density)

    // Color scheme (skins.ts) and custom colors, household or this device's (resolveColors).
    // Every scheme sets its tokens, the default included, so a screen always looks like its chip. Custom
    // surfaces are skipped in low-stim mode, which wants a calm, pre-vetted palette; a custom
    // accent still applies.
    const { skin, custom: picked } = resolveColors(household, device)
    const t = tokensFor(skin, dark)
    const custom = a.lowStim ? { accent: picked.accent } : picked
    const setOrClear = (prop: string, val?: string) => { if (val) root.style.setProperty(prop, val); else root.style.removeProperty(prop) }
    setOrClear('--bg', custom.bg || t?.bg)
    setOrClear('--bg-alt', t?.bgAlt)
    setOrClear('--card', custom.card || t?.card)
    setOrClear('--card-soft', t || custom.bg || custom.card ? (CSS.supports('color', 'color-mix(in srgb, red, blue)') ? 'color-mix(in srgb, var(--card) 90%, var(--bg))' : 'var(--card)') : undefined) // Safari < 16.2: no color-mix
    setOrClear('--border', t?.border)
    setOrClear('--text', custom.text || t?.text)
    setOrClear('--text-dim', t?.textDim)
    setOrClear('--logo-heads', /^#[0-9a-f]{6}$/i.test(custom.bg || t.bg) ? logoHeads(skin.id, custom.accent || skin.dark.accent, custom.bg || t.bg) : undefined)

    const accent = custom.accent || t?.accent || DEFAULT_ACCENT
    root.style.setProperty('--accent', accent)
    root.style.setProperty('--accent-strong', accentFill(accent))
    root.style.setProperty('--accent-ink', '#ffffff')
    // Accent as text/focus ring: 4.5:1 on the theme's lowest-contrast surface (bg-alt in light,
    // card-soft in dark), so links, active tabs and focus outlines read in either mode.
    const surface = getComputedStyle(root).getPropertyValue(dark ? '--card-soft' : '--bg-alt').trim()
    if (/^#[0-9a-f]{6}$/i.test(surface)) root.style.setProperty('--accent-text', readableOn(accent, surface))
    root.style.setProperty('--text-scale', SCALE[a.textScale])

    try { saveIfChanged(LAST_THEME_KEY, dark ? 'dark' : 'light'); saveIfChanged(LAST_LOOK_KEY, root.style.cssText) } catch { /* private mode */ }
    // index.html has a light and a dark theme-color (by media) for before this runs; now both are the real background.
    const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')]
    if (!metas.length) { const m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); metas.push(m) }
    const bg = getComputedStyle(root).getPropertyValue('--bg').trim() || (dark ? '#0E1A1A' : '#EAF2EF')
    for (const m of metas) { m.dataset.day = bg; if (!document.documentElement.dataset.night) m.content = bg } // native.ts tellAppNight
    tellAppAppearance({ mode: a.themeMode, dark, colors: surfaces(skin, custom) })
  }

  apply()

  const cleanups: (() => void)[] = []
  if (a.themeMode === 'auto') {
    const mql = matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener('change', apply)
    cleanups.push(() => mql.removeEventListener('change', apply))
  }
  if (a.themeMode === 'scheduled') {
    const id = setInterval(apply, 60000)
    cleanups.push(() => clearInterval(id))
  }
  if (resolveColors(household, device).scheme === 'seasonal') {
    // The date-driven skin only needs to re-check once a day, not every minute like scheduled dark mode.
    const id = setInterval(apply, 60 * 60 * 1000)
    cleanups.push(() => clearInterval(id))
  }
  return cleanups.length ? () => cleanups.forEach(fn => fn()) : undefined
}

/** Applies the household look (mode -> data-theme, color scheme and custom colors, density, text
 * scale) with this device's overrides to <html> from ONE place, so the pairing screen, setup
 * wizard and app all render the same way. Re-evaluates every minute in 'scheduled' mode, hourly when the skin follows the
 * season, and on prefers-color-scheme change in 'auto' mode. Before `settings` is available (pairing gate / setup
 * wizard, no key stored yet) it falls back to GET /api/appearance, the same no-auth subset of
 * fields, so the wall doesn't show default colors until paired. Once a key exists (mid-wizard, or
 * a display key with no local settings yet), it no-ops and leaves styles.css's defaults. */
export function useTheme(settings: Settings | null) {
  const device = useDeviceAppearance()
  useEffect(() => {
    if (settings) return applyAppearance(settings, device)
    if (getKey()) return undefined

    let canceled = false
    api.getAppearance().then(a => { if (!canceled) applyAppearance(a, device) }).catch(() => {})
    return () => { canceled = true }
  }, [settings, device])
}
