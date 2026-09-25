import { useEffect, useState } from 'react'
import type { Appearance, Settings, TextScale } from './types.ts'
import { accentFill } from './color.ts'
import { api, getKey } from './api.ts'

const SCALE: Record<TextScale, string> = { s: '0.9', m: '1', l: '1.15', xl: '1.3' }

// Per-device overrides of the household appearance (a wall iPad read from across the room and a
// phone in the hand want different sizes). Absent key = follow the household setting. Kept in
// localStorage like the nav position; a same-tab event re-applies, since 'storage' is cross-tab only.
const DEVICE_KEY = 'kinwall.deviceAppearance'
const DEVICE_EVENT = 'kinwall:device-appearance'
export type DeviceAppearance = Partial<Pick<Appearance, 'themeMode' | 'textScale' | 'density'>>

export function readDeviceAppearance(): DeviceAppearance {
  try {
    const v = JSON.parse(localStorage.getItem(DEVICE_KEY) || '{}')
    return v && typeof v === 'object' ? v : {}
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

/** Is `now` inside the [from, to) HH:MM window (household-local clock time)? Handles ranges that
 * cross midnight (e.g. 20:00 -> 07:00). */
function inScheduledDarkWindow(from: string, to: string, now = new Date()): boolean {
  const [fh, fm] = from.split(':').map(Number)
  const [th, tm] = to.split(':').map(Number)
  if ([fh, fm, th, tm].some(Number.isNaN)) return false
  const cur = now.getHours() * 60 + now.getMinutes()
  const start = fh * 60 + fm
  const end = th * 60 + tm
  if (start === end) return false
  return start < end ? cur >= start && cur < end : cur >= start || cur < end
}

function applyAppearance(a: Appearance) {
  const root = document.documentElement

  const apply = () => {
    let dark: boolean
    if (a.themeMode === 'dark') dark = true
    else if (a.themeMode === 'light') dark = false
    else if (a.themeMode === 'auto') dark = matchMedia('(prefers-color-scheme: dark)').matches
    else dark = inScheduledDarkWindow(a.darkFrom, a.darkTo)

    root.setAttribute('data-theme', dark ? 'dark' : 'light')
    root.setAttribute('data-bg', dark ? a.backgroundDark : a.backgroundLight)
    root.setAttribute('data-density', a.density)
    root.style.setProperty('--accent', a.accent)
    root.style.setProperty('--accent-strong', accentFill(a.accent))
    root.style.setProperty('--accent-ink', '#ffffff')
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
    if (settings) return applyAppearance({ ...settings, ...device })
    if (getKey()) return undefined

    let cancelled = false
    api.getAppearance().then(a => { if (!cancelled) applyAppearance({ ...a, ...device }) }).catch(() => {})
    return () => { cancelled = true }
  }, [settings, device])
}
