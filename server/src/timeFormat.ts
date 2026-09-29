// Clock times in the text the server writes (push notifications, reminders, the in-app feed,
// insights): "3:40 PM" or "15:40". The web app has its own copy (web/src/timeFormat.ts), which
// also honors a device's override and its locale.

// Countries where the 12-hour clock is the everyday one, for settings.timeFormat 'auto'. Everyone
// else gets 24-hour; a family with no location keeps 12-hour, as before the setting existed.
export const TWELVE_HOUR_COUNTRIES = ['US', 'CA', 'AU', 'NZ', 'PH', 'IN', 'PK', 'BD', 'EG', 'SA', 'MY'];

/** 12-hour or not: the family's setting, then (on 'auto') the location's country, then 12-hour. */
export function hour12For(timeFormat: string | undefined, countryCode: string | undefined): boolean {
  if (timeFormat === '12' || timeFormat === '24') return timeFormat === '12';
  return countryCode ? TWELVE_HOUR_COUNTRIES.includes(countryCode.toUpperCase()) : true;
}

const HHMM_RE = /^(\d{1,2}):(\d{2})$/;
const zoned = new Map<string, Intl.DateTimeFormat>(); // making one is the slow part

/** A stored "HH:MM", or an instant (Date or ISO) as seen in `tz`, as "3:40 PM" / "15:40".
 * `hourOnly`: "8 PM" / "20:00". */
export function formatTime(value: string | Date, o: { h12: boolean; tz?: string; hourOnly?: boolean }): string {
  let h: number, m: number;
  const hm = typeof value === 'string' ? HHMM_RE.exec(value) : null;
  if (hm) [h, m] = [Number(hm[1]), Number(hm[2])];
  else {
    const tz = o.tz ?? 'UTC';
    let f = zoned.get(tz);
    if (!f) zoned.set(tz, (f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })));
    const parts = f.formatToParts(new Date(value));
    h = Number(parts.find((p) => p.type === 'hour')!.value) % 24;
    m = Number(parts.find((p) => p.type === 'minute')!.value);
  }
  const mm = String(m).padStart(2, '0');
  if (!o.h12) return `${String(h).padStart(2, '0')}:${mm}`;
  return `${h % 12 || 12}${o.hourOnly ? '' : `:${mm}`} ${h < 12 ? 'AM' : 'PM'}`;
}
