// rrule expansion in a given IANA timezone. Workers-compatible (Intl + rrule only).
// rrule's package resolves to different builds depending on the loader: esbuild (Workers/
// wrangler) picks the real ESM build with a named `RRule` export, while Node's native ESM
// loader resolves the CJS build via cjs-module-lexer, which only synthesizes a `default`
// export for it. A namespace import with a fallback works under both.
import * as RRuleNS from 'rrule';
const RRule = ((RRuleNS as unknown as { RRule?: typeof import('rrule').RRule }).RRule ??
  (RRuleNS as unknown as { default: { RRule: typeof import('rrule').RRule } }).default.RRule)!;

export type DateParts = { y: number; mo: number; d: number; h: number; mi: number; s: number };

// One formatter per timezone: building an Intl.DateTimeFormat costs far more than using one, and
// expanding a week of repeating events asks for thousands of these.
const formatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(utcDate: Date, tz: string): DateParts {
  let dtf = formatters.get(tz);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(tz, dtf);
  }
  const map: Record<string, string> = {};
  for (const p of dtf.formatToParts(utcDate)) map[p.type] = p.value;
  return {
    y: Number(map.year),
    mo: Number(map.month) - 1,
    d: Number(map.day),
    h: Number(map.hour) === 24 ? 0 : Number(map.hour),
    mi: Number(map.minute),
    s: Number(map.second),
  };
}

function tzOffsetMinutes(tz: string, utcDate: Date): number {
  const p = zonedParts(utcDate, tz);
  const asUtc = Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s);
  return (asUtc - utcDate.getTime()) / 60000;
}

// Wall-clock time in tz -> real UTC instant. Iterates once to handle DST boundaries.
// Exported for reuse by providers/ics.ts to interpret floating (no TZID, no Z) ICS times in
// the household timezone instead of UTC.
export function zonedTimeToUtc(p: DateParts, tz: string): Date {
  const guess = new Date(Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s));
  const offset1 = tzOffsetMinutes(tz, guess);
  const ts1 = guess.getTime() - offset1 * 60000;
  const offset2 = tzOffsetMinutes(tz, new Date(ts1));
  const ts = offset2 !== offset1 ? guess.getTime() - offset2 * 60000 : ts1;
  return new Date(ts);
}

function floatingDate(p: DateParts): Date {
  // A Date whose UTC getters return the wall-clock time, for use as rrule's own clock.
  return new Date(Date.UTC(p.y, p.mo, p.d, p.h, p.mi, p.s));
}

function partsFromFloating(d: Date): DateParts {
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

export type Instance = { start: string; end: string };

/** The most instances one series gives per expansion: a stored rule can't make a read unbounded. */
export const MAX_SERIES_INSTANCES = 1000;

/**
 * Expand an RRULE string between [from, to) for a series, in household timezone `tz`.
 * `start`/`end` are the series' first occurrence, in stored format (UTC ISO for timed, YYYY-MM-DD for all-day).
 * A stored series that can't be expanded (a rule isValidRrule refuses, a start or end that isn't a
 * date) has no instances, rather than failing the read of everything around it.
 */
export function expand(rruleString: string, start: string, end: string, allDay: boolean, tz: string, from: Date, to: Date): Instance[] {
  // Looser than isEventTime: whatever an older server stored and Date can read still expands.
  const readable = (s: string) => !Number.isNaN(Date.parse(s)) && (!allDay || /^\d{4}-\d{2}-\d{2}$/.test(s));
  if (!isValidRrule(rruleString) || !readable(start) || !readable(end)) return [];
  const startParts = allDay ? dateOnlyParts(start) : zonedParts(new Date(start), tz);
  const dtstart = floatingDate(startParts);
  const durationMs = allDay
    ? (dateOnlyToUtcMs(dateOnlyParts(end)) - dateOnlyToUtcMs(startParts)) || 24 * 60 * 60 * 1000
    : new Date(end).getTime() - new Date(start).getTime();

  // Widen the floating window by a day on each side to be safe across offset shifts, then filter precisely after conversion.
  const floatFrom = allDay ? floatingDate(dateOnlyParts(toDateOnlyString(from))) : floatingDate(zonedParts(from, tz));
  const floatTo = allDay ? floatingDate(dateOnlyParts(toDateOnlyString(to))) : floatingDate(zonedParts(to, tz));
  floatFrom.setUTCDate(floatFrom.getUTCDate() - 1);
  floatTo.setUTCDate(floatTo.getUTCDate() + 1);

  const opts = RRule.parseString(rruleString);
  const rule = new RRule({ ...opts, dtstart });

  const occurrences = rule.between(floatFrom, floatTo, true, (_, n) => n < MAX_SERIES_INSTANCES);

  const out: Instance[] = [];
  for (const occ of occurrences) {
    const p = partsFromFloating(occ);
    if (allDay) {
      const startMs = dateOnlyToUtcMs(p);
      const endMs = startMs + durationMs;
      if (endMs > from.getTime() && startMs < to.getTime()) {
        out.push({ start: dateOnlyString(p), end: dateOnlyString(msToDateOnlyParts(endMs)) });
      }
    } else {
      const instStart = zonedTimeToUtc(p, tz);
      const instEnd = new Date(instStart.getTime() + durationMs);
      if (instEnd > from && instStart < to) {
        out.push({ start: instStart.toISOString(), end: instEnd.toISOString() });
      }
    }
  }
  return out;
}

function dateOnlyParts(s: string): DateParts {
  const [y, mo, d] = s.split('-').map(Number);
  return { y, mo: mo - 1, d, h: 0, mi: 0, s: 0 };
}

function dateOnlyToUtcMs(p: DateParts): number {
  return Date.UTC(p.y, p.mo, p.d);
}

function msToDateOnlyParts(ms: number): DateParts {
  const d = new Date(ms);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth(), d: d.getUTCDate(), h: 0, mi: 0, s: 0 };
}

function dateOnlyString(p: DateParts): string {
  return `${p.y}-${String(p.mo + 1).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

function toDateOnlyString(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** True if rrule's parser accepts the string with a valid FREQ (it throws on garbage), daily or
 * slower: nothing in Kinwall repeats within a day, and FREQ=SECONDLY is 86,400 instances a day. */
export function isValidRrule(s: string): boolean {
  try {
    const opts = RRule.parseString(s);
    new RRule(opts);
    if (opts.freq == null) return false; // rrule silently defaults a missing FREQ to YEARLY
    if (opts.freq > RRule.DAILY || opts.byhour != null || opts.byminute != null || opts.bysecond != null) return false;
    const list = (v: unknown) => (v == null ? [] : Array.isArray(v) ? v : [v]);
    if (list(opts.bymonth).some((m) => !(Number(m) >= 1 && Number(m) <= 12))) return false;
    // A daily or weekly rule narrowed to days that may never come (the 30th of February, the 3rd
    // Monday of a day) is scanned day by day to the year 9999 on every read; weekdays and months
    // are all such a rule needs. Monthly and yearly rules scan in far bigger steps.
    const byNth = list(opts.byweekday).some((d) => typeof d === 'object' && !!(d as { n?: number }).n);
    if (opts.freq >= RRule.WEEKLY && (opts.bymonthday != null || opts.byyearday != null || opts.byweekno != null || opts.bysetpos != null || opts.byeaster != null || byNth)) return false;
    return true;
  } catch {
    return false;
  }
}

/** True for a time in the stored format (providers/types.ts): a real YYYY-MM-DD for all-day, else an
 * ISO date-time with a UTC offset ('2026-09-24T14:00:00.000Z', seconds optional, 'Z' or '+02:00'). */
export function isEventTime(s: string, allDay: boolean): boolean {
  const m = (allDay ? /^(\d{4}-\d{2}-\d{2})$/ : /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/).exec(s);
  if (!m || Number.isNaN(Date.parse(s))) return false;
  return new Date(`${m[1]}T00:00:00Z`).toISOString().slice(0, 10) === m[1]; // Date.parse rolls February 30 over to March
}
