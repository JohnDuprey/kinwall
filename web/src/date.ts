// Small helpers for displaying UTC-ISO timed events in the household timezone (Intl-based, no date-fns-tz).

export function zonedParts(iso: string, tz: string) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  })
  const parts = Object.fromEntries(dtf.formatToParts(new Date(iso)).map(p => [p.type, p.value])) as Record<string, string>
  return { year: +parts.year, month: +parts.month, day: +parts.day, hour: parts.hour === '24' ? 0 : +parts.hour, minute: +parts.minute }
}

/** 'YYYY-MM-DD' of a timed (UTC ISO) instant, as seen in `tz`. For all-day events the stored value is already a date string — use as-is. */
export function zonedDayKey(iso: string, tz: string) {
  const p = zonedParts(iso, tz)
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`
}

export function minutesSinceMidnight(iso: string, tz: string) {
  const p = zonedParts(iso, tz)
  return p.hour * 60 + p.minute
}

export function formatTime(iso: string, tz: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(new Date(iso))
}

/** A stored HH:MM as the device shows times elsewhere ("3:40 PM", or "15:40" where that's the norm). */
export function clockTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function todayKeyInTz(tz: string) {
  return zonedDayKey(new Date().toISOString(), tz)
}
