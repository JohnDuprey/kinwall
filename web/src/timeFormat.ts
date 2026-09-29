// Every clock time the app shows goes through formatTime: "3:40 PM" or "15:40". Which one is this
// device's pick (Appearance on this device), then the family's (Settings → Household), then the
// device's locale. App.tsx calls setHour12 on each render, so a change re-renders with the new
// format. Native <input type="time"> fields follow the OS locale and can't be told otherwise.
// The server has its own copy for the text it writes (server/src/timeFormat.ts).
import type { TimeFormat } from './types.ts'

/** Does this locale (the device's when omitted) use a 12-hour clock? */
export function localeHour12(locale?: string): boolean {
  const o = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions()
  return o.hourCycle ? o.hourCycle === 'h12' || o.hourCycle === 'h11' : o.hour12 ?? true
}

/** A device's saved time format: only '12' or '24' is an override; anything else follows the family. */
export function deviceTimeFormat(raw: unknown): '12' | '24' | undefined {
  return raw === '12' || raw === '24' ? raw : undefined
}

/** 12-hour or not: this device's override, then the family setting, then the locale. */
export function resolveHour12(family: TimeFormat | undefined, device: '12' | '24' | undefined, locale?: string): boolean {
  const f = device ?? family
  return f === '12' || f === '24' ? f === '12' : localeHour12(locale)
}

let hour12 = localeHour12()
/** Set by App.tsx from resolveHour12 before its children render. */
export function setHour12(v: boolean) { hour12 = v }
export const isHour12 = () => hour12

const HHMM_RE = /^(\d{1,2}):(\d{2})$/
const zoned = new Map<string, Intl.DateTimeFormat>() // making one is the slow part

/** A stored "HH:MM", or an instant (Date or ISO) seen in `tz` (the device's zone when omitted),
 * as "3:40 PM" / "15:40". `hourOnly` (the calendar's hour labels): "3 PM" / "15:00". */
export function formatTime(value: string | Date, tz?: string, opts?: { hourOnly?: boolean }): string {
  let h: number, m: number
  const hm = typeof value === 'string' ? HHMM_RE.exec(value) : null
  if (hm) [h, m] = [Number(hm[1]), Number(hm[2])]
  else if (!tz) { const d = new Date(value); [h, m] = [d.getHours(), d.getMinutes()] }
  else {
    let f = zoned.get(tz)
    if (!f) zoned.set(tz, f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }))
    const parts = f.formatToParts(new Date(value))
    h = Number(parts.find(p => p.type === 'hour')!.value) % 24
    m = Number(parts.find(p => p.type === 'minute')!.value)
  }
  const mm = String(m).padStart(2, '0')
  if (!hour12) return `${String(h).padStart(2, '0')}:${mm}`
  return `${h % 12 || 12}${opts?.hourOnly ? '' : `:${mm}`} ${h < 12 ? 'AM' : 'PM'}`
}
