// The household timezone picker (Settings → General, setup wizard): names, local times and offsets.
import { formatTime } from './timeFormat.ts'

export function timezoneList() {
  // Intl.supportedValuesOf('timeZone') doesn't include 'UTC' itself (the server's default
  // settings.timezone), which left the picker silently showing the wrong zone. Prepend it.
  try {
    return ['UTC', ...Intl.supportedValuesOf('timeZone')]
  } catch {
    return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin']
  }
}

/** "GMT-4" → "UTC−4" (a real minus sign), "GMT" (or newer ICU's "GMT+0") → "UTC". */
export const offsetLabel = (gmt: string) => gmt.replace(/^GMT\+0$/, 'GMT').replace('GMT', 'UTC').replace('-', '−')

/** The local time and UTC offset in a zone at `now`: { time: '8:04 PM', offset: 'UTC−4' }. */
const formats = new Map<string, Intl.DateTimeFormat>() // making one is the slow part, and the picker lists ~400
export function tzInfo(tz: string, now: Date): { time: string; offset: string } {
  try {
    let format = formats.get(tz)
    if (!format) formats.set(tz, format = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }))
    const offset = format.formatToParts(now).find(p => p.type === 'timeZoneName')?.value ?? ''
    return { time: formatTime(now, tz), offset: offsetLabel(offset) }
  } catch { return { time: '', offset: '' } } // a saved zone this browser doesn't know
}

/** "America/New_York" → "New York". */
export const tzCity = (tz: string) => tz.slice(tz.lastIndexOf('/') + 1).replace(/_/g, ' ')

/** "New York (Eastern)" where the browser has a common name for it, else "New York". */
export function tzName(tz: string, now = new Date()): string {
  const city = tzCity(tz)
  try {
    const generic = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longGeneric' }).formatToParts(now).find(p => p.type === 'timeZoneName')?.value.replace(/ Time$/, '')
    return generic && !generic.startsWith('GMT') && generic !== city ? `${city} (${generic})` : city
  } catch { return city }
}

/** This device's zone and the current one first (once each), then the rest in list order. */
export function tzOrder(all: string[], device: string | null, current: string | null): string[] {
  const top = [...new Set([device, current].filter((z): z is string => !!z))]
  return [...top, ...all.filter(z => !top.includes(z))]
}

/** The zone this device's clock and date show: the family's, or with "This device's" picked
 * (Appearance on this device) the device's own. Only the clock: chores, reminders and "today"
 * stay on the family's zone. */
export function clockTimeZone(family: string | null | undefined, device: { clockZone?: 'device' }, own = Intl.DateTimeFormat().resolvedOptions().timeZone): string | undefined {
  return device.clockZone === 'device' ? own : family ?? undefined
}
