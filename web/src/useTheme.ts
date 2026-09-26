import { useEffect, useState } from 'react'
import type { Appearance, DeviceDensity, Settings, TextScale } from './types.ts'
import { accentFill, readableOn } from './color.ts'
import { api, getKey } from './api.ts'

const SCALE: Record<TextScale, string> = { s: '0.9', m: '1', l: '1.15', xl: '1.3' }

// Per-device overrides of the household appearance (a wall iPad read from across the room and a
// phone in the hand want different sizes). Absent key = follow the household setting. Kept in
// localStorage like the nav position; a same-tab event re-applies, since 'storage' is cross-tab only.
const DEVICE_KEY = 'kinwall.deviceAppearance'
const DEVICE_EVENT = 'kinwall:device-appearance'
// The same object also carries this device's other preferences (focus, warnings, locked view…),
// so every per-device choice lives in one place and one event re-renders whoever reads it.
export type FontChoice = 'hyperlegible' | 'dyslexia'
export type LockedView = 'week' | 'day' | 'month' | 'schedule' | 'board'
export type DeviceAppearance = Partial<Pick<Appearance, 'themeMode' | 'textScale' | 'accent' | 'backgroundLight' | 'backgroundDark'>> & {
  density?: DeviceDensity // 'icons' (icon-first) exists per device only
  lowStim?: boolean // flat, calm, no motion - see [data-lowstim] in styles.css
  font?: FontChoice // absent = Nunito
  nowNext?: boolean // Now / Next card on the calendar; absent = on
  warnings?: number[] // transition warnings, minutes before an event (or its leave-by)
  warningSound?: boolean
  focusMemberId?: string // this display shows only one member's things
  focusHideShared?: boolean // ...and hides the ones assigned to nobody
  lockView?: LockedView // calendar stays on this view, no switcher
  saverSources?: SaverSource[] // quiet-hours screensaver, round-robin; absent/empty = the plain clock
  saverEvery?: number // minutes between pictures; absent = 5
  saverBright?: 'medium' // absent = low
  saverClock?: false // corner clock; absent = shown
}
export type SaverSource = 'drawings' | 'photos' | 'art' | 'nature'

export function readDeviceAppearance(): DeviceAppearance {
  try {
    const v = JSON.parse(localStorage.getItem(DEVICE_KEY) || '{}')
    if (!v || typeof v !== 'object') return {}
    // Older builds stored one screensaver source as `saver`; the next save writes the new shape.
    if ('saver' in v) {
      if (!v.saverSources && ['drawings', 'art', 'nature'].includes(v.saver)) v.saverSources = [v.saver]
      delete v.saver
    }
    return v
  } catch { return {} }
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
    window.addEventListener(DEVICE_EVENT, on)
    window.addEventListener('storage', on)
    return () => { window.removeEventListener(DEVICE_EVENT, on); window.removeEventListener('storage', on) }
  }, [])
  return v
}

/** Is `now` inside the [from, to) HH:MM window (device-local clock time)? Handles ranges that
 * cross midnight (e.g. 20:00 -> 07:00). Used by scheduled dark mode and display quiet hours. */
export function inTimeWindow(from: string, to: string, now = new Date()): boolean {
  const [fh, fm] = from.split(':').map(Number)
  const [th, tm] = to.split(':').map(Number)
  if ([fh, fm, th, tm].some(Number.isNaN)) return false
  const cur = now.getHours() * 60 + now.getMinutes()
  const start = fh * 60 + fm
  const end = th * 60 + tm
  if (start === end) return false
  return start < end ? cur >= start && cur < end : cur >= start || cur < end
}

/** Density actually in effect: low-stimulation mode never runs compact (it wants more room). */
export function effectiveDensity(household: Appearance['density'], device: DeviceAppearance): DeviceDensity {
  const d = device.density ?? household
  return device.lowStim && d === 'compact' ? 'comfortable' : d
}

// Google Fonts families for the typeface choice; the stylesheet is only requested once picked.
const FONTS: Record<FontChoice, { family: string; query: string }> = {
  hyperlegible: { family: "'Atkinson Hyperlegible Next'", query: 'Atkinson+Hyperlegible+Next:wght@400;600;700;800' },
  dyslexia: { family: "'Lexend'", query: 'Lexend:wght@400;600;700;800' },
}
function applyFont(font: FontChoice | undefined) {
  const root = document.documentElement
  const f = font && FONTS[font]
  if (!f) { root.style.removeProperty('--font'); return }
  const id = `kw-font-${font}`
  if (!document.getElementById(id)) {
    const link = document.createElement('link')
    link.id = id
    link.rel = 'stylesheet'
    link.href = `https://fonts.googleapis.com/css2?family=${f.query}&display=swap`
    document.head.appendChild(link)
  }
  root.style.setProperty('--font', f.family)
}

function applyAppearance(household: Appearance, device: DeviceAppearance) {
  const a = { ...household, ...device, density: effectiveDensity(household.density, device) }
  const root = document.documentElement
  root.toggleAttribute('data-lowstim', !!a.lowStim)
  applyFont(a.font)

  const apply = () => {
    let dark: boolean
    if (a.themeMode === 'dark') dark = true
    else if (a.themeMode === 'light') dark = false
    else if (a.themeMode === 'auto') dark = matchMedia('(prefers-color-scheme: dark)').matches
    else dark = inTimeWindow(a.darkFrom, a.darkTo)

    root.setAttribute('data-theme', dark ? 'dark' : 'light')
    root.setAttribute('data-bg', dark ? a.backgroundDark : a.backgroundLight)
    root.setAttribute('data-density', a.density)
    root.style.setProperty('--accent', a.accent)
    root.style.setProperty('--accent-strong', accentFill(a.accent))
    root.style.setProperty('--accent-ink', '#ffffff')
    // Accent as text/focus ring: 4.5:1 on the theme's lowest-contrast surface (bg-alt in light,
    // card-soft in dark), so links, active tabs and focus outlines read in either mode.
    const surface = getComputedStyle(root).getPropertyValue(dark ? '--card-soft' : '--bg-alt').trim()
    if (/^#[0-9a-f]{6}$/i.test(surface)) root.style.setProperty('--accent-text', readableOn(a.accent, surface))
    root.style.setProperty('--text-scale', SCALE[a.textScale])

    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'theme-color'
      document.head.appendChild(meta)
    }
    meta.content = getComputedStyle(root).getPropertyValue('--bg').trim() || (dark ? '#1C1712' : '#FFFBF5')
  }

  apply()

  if (a.themeMode === 'auto') {
    const mql = matchMedia('(prefers-color-scheme: dark)')
    mql.addEventListener('change', apply)
    return () => mql.removeEventListener('change', apply)
  }
  if (a.themeMode === 'scheduled') {
    const id = setInterval(apply, 60000)
    return () => clearInterval(id)
  }
  return undefined
}

/** Applies household theming (mode -> data-theme, background preset -> data-bg, density,
 * accent + its computed ink, text scale) to <html> from ONE place, so the pairing screen, setup
 * wizard and app all render the same way. Re-evaluates every minute in 'scheduled' mode and on
 * prefers-color-scheme change in 'auto' mode. Before `settings` is available (pairing gate / setup
 * wizard, no key stored yet) it falls back to GET /api/appearance, the same no-auth subset of
 * fields, so the wall doesn't show default colors until paired. Once a key exists (mid-wizard, or
 * a display key with no local settings yet), it no-ops and leaves styles.css's defaults. */
export function useTheme(settings: Settings | null) {
  const device = useDeviceAppearance()
  useEffect(() => {
    if (settings) return applyAppearance(settings, device)
    if (getKey()) return undefined

    let cancelled = false
    api.getAppearance().then(a => { if (!cancelled) applyAppearance(a, device) }).catch(() => {})
    return () => { cancelled = true }
  }, [settings, device])
}
