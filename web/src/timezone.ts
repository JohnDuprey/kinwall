// The household timezone picker (Settings → General, setup wizard): names, local times and offsets.

export function timezoneList() {
  // Intl.supportedValuesOf('timeZone') doesn't include 'UTC' itself (the server's default
  // settings.timezone), which left the picker silently showing the wrong zone. Prepend it.
  try {
    return ['UTC', ...Intl.supportedValuesOf('timeZone')]
  } catch {
    return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Europe/London', 'Europe/Berlin']
  }
}

/** "GMT-4" → "UTC−4" (a real minus sign), "GMT" → "UTC". */
export const offsetLabel = (gmt: string) => gmt.replace('GMT', 'UTC').replace('-', '−')

/** The local time and UTC offset in a zone at `now`: { time: '8:04 PM', offset: 'UTC−4' }. */
const formats = new Map<string, Intl.DateTimeFormat>() // making one is the slow part, and the picker lists ~400
export function tzInfo(tz: string, now: Date): { time: string; offset: string } {
  try {
    let format = formats.get(tz)
    if (!format) formats.set(tz, format = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', timeZoneName: 'shortOffset' }))
    const parts = format.formatToParts(now)
    const offset = parts.find(p => p.type === 'timeZoneName')?.value ?? ''
    return { time: parts.filter(p => p.type !== 'timeZoneName').map(p => p.value).join('').replace(/\s+/g, ' ').trim(), offset: offsetLabel(offset) }
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
