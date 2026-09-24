// Read-only ICS URL subscription provider (Google "secret address", Outlook "published
// calendar", iCloud public calendar, or any plain .ics URL).
import ICAL from 'ical.js';
import { zonedTimeToUtc } from '../recurrence.ts';
import type { NormalizedEvent, Provider, ProviderCtx } from './types.ts';

// Floating times (no TZID, no Z) must be interpreted in the household timezone, not UTC (and
// not the host machine's timezone - ICAL.Time#toJSDate() resolves a floating time against
// whatever Intl/system timezone the process happens to be running in, which is neither of
// those, so we read the wall-clock components straight off the ICAL.Time instead).
function isFloating(t: ICAL.Time): boolean {
  return t.zone === ICAL.Timezone.localTimezone;
}

function resolveDate(t: ICAL.Time, tz: string): Date {
  if (t.isDate || !isFloating(t)) return t.toJSDate();
  return zonedTimeToUtc({ y: t.year, mo: t.month - 1, d: t.day, h: t.hour, mi: t.minute, s: t.second }, tz);
}

// Cheap pre-filter run on the raw ICS text before ical.js ever parses it, so a large feed
// doesn't cost a full parse + recurrence expansion for events far outside the sync window.
// Drops: non-recurring VEVENTs whose DTSTART is clearly before `from` - 1 day, and recurring
// VEVENTs whose RRULE UNTIL is before `from`. Never drops a RECURRENCE-ID override (it has no
// RRULE of its own but must survive alongside its kept master), any VTIMEZONE, or the header.
// ponytail: text-scan heuristic (UTC/local date digits only, ignores TZID offset on DTSTART) -
// upgrade to a value-aware scan if a feed's TZID makes the day-level slop matter.
export function prefilterIcs(icsText: string, from: Date): string {
  const chunks = icsText.split('BEGIN:VEVENT');
  if (chunks.length <= 1) return icsText;
  const header = chunks[0];
  const cutoffMs = from.getTime() - 24 * 60 * 60 * 1000;
  const kept: string[] = [];

  for (let i = 1; i < chunks.length; i++) {
    // Each chunk is everything between this 'BEGIN:VEVENT' and the next one (or EOF for the
    // last) - keeping the whole chunk (not just up to 'END:VEVENT') preserves exact formatting
    // when reassembled, since chunks are contiguous slices of the original text.
    const chunk = chunks[i];
    const endIdx = chunk.indexOf('END:VEVENT');
    const scanRegion = endIdx === -1 ? chunk : chunk.slice(0, endIdx + 'END:VEVENT'.length);

    if (/[\r\n]RECURRENCE-ID[:;]/i.test(`\n${scanRegion}`)) {
      kept.push(chunk);
      continue;
    }
    const rruleMatch = scanRegion.match(/[\r\n]RRULE[:;]([^\r\n]*)/i);
    if (!rruleMatch) {
      const dtstartMatch = scanRegion.match(/[\r\n]DTSTART[^:\r\n]*:(\d{8})/i);
      if (dtstartMatch) {
        const d = dtstartMatch[1];
        const dtstartMs = Date.UTC(Number(d.slice(0, 4)), Number(d.slice(4, 6)) - 1, Number(d.slice(6, 8)));
        if (dtstartMs < cutoffMs) continue; // clearly old, no recurrence to bring it forward
      }
      kept.push(chunk);
      continue;
    }
    const untilMatch = rruleMatch[1].match(/UNTIL=(\d{8})/i);
    if (untilMatch) {
      const u = untilMatch[1];
      const untilMs = Date.UTC(Number(u.slice(0, 4)), Number(u.slice(4, 6)) - 1, Number(u.slice(6, 8)));
      if (untilMs < from.getTime()) continue; // series ended before the window opens
    }
    kept.push(chunk);
  }
  return header + kept.map((b) => 'BEGIN:VEVENT' + b).join('');
}

async function sha256Hex(data: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Some ICS generators (observed: a Thrillshare/icalendar-ruby feed) regenerate UID and DTSTAMP
// on every single fetch for the same underlying events, which would otherwise make every sync
// look like a brand new set of events. Since ICS calendars are read-only (externalId is never
// sent back to the source - contrast CalDAV, which needs the real UID for writes), replace it
// with a hash of the fields that actually describe the instance, so it's stable across fetches.
// Exact duplicates (rare, but possible) get '#1', '#2', ... appended to stay unique.
async function withStableExternalIds(events: NormalizedEvent[]): Promise<NormalizedEvent[]> {
  const seen = new Map<string, number>();
  const out: NormalizedEvent[] = [];
  for (const ev of events) {
    const base = await sha256Hex(`${ev.title}|${ev.start}|${ev.end}|${ev.allDay}`);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    out.push({ ...ev, externalId: n === 0 ? base : `${base}#${n}` });
  }
  return out;
}

// Shared by provider.listEvents (full sync) and sync.ts's chunked tick (conditional sync), so
// the prefilter + expand + stable-id pipeline only lives in one place.
export async function parseIcsEvents(icsText: string, from: Date, to: Date, tz = 'UTC'): Promise<NormalizedEvent[]> {
  const raw = expandICS(prefilterIcs(icsText, from), from, to, tz);
  return withStableExternalIds(raw);
}

// Content fingerprint used by sync.ts to skip a parse + DB replace when a feed's *content*
// hasn't changed even though ETag/If-Modified-Since didn't help (observed: a feed that ignores
// If-None-Match and hands back a fresh weak ETag on every request). Strips DTSTAMP/UID lines
// first since those are exactly the fields such a feed rewrites on every fetch.
export async function icsFingerprint(icsText: string): Promise<string> {
  const stripped = icsText.replace(/^(?:DTSTAMP|UID)[:;][^\r\n]*\r?\n/gim, '');
  return sha256Hex(stripped);
}

// Shared by caldav.ts so recurrence expansion isn't duplicated: CalDAV objects are plain
// iCalendar text (one VEVENT series per object, but a full VCALENDAR can also contain many).
export function expandICS(icsText: string, from: Date, to: Date, tz = 'UTC'): NormalizedEvent[] {
  let root: ICAL.Component;
  try {
    root = new ICAL.Component(ICAL.parse(icsText));
  } catch {
    return []; // malformed feed / object -> no events rather than a hard failure
  }

  // Register any VTIMEZONE definitions so ICAL.Time resolves TZID offsets (incl. DST).
  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try {
      const timezone = new ICAL.Timezone(tz);
      if (timezone.tzid) ICAL.TimezoneService.register(timezone);
    } catch {
      // ignore malformed VTIMEZONE
    }
  }

  const veventComps = root.getAllSubcomponents('vevent');
  const byUid = new Map<string, { master?: ICAL.Component; overrides: ICAL.Component[] }>();
  for (const comp of veventComps) {
    const uid = comp.getFirstPropertyValue('uid') as string | null;
    if (!uid) continue;
    const entry = byUid.get(uid) ?? { overrides: [] };
    if (comp.getFirstProperty('recurrence-id')) entry.overrides.push(comp);
    else entry.master = comp;
    byUid.set(uid, entry);
  }

  const results: NormalizedEvent[] = [];

  for (const [uid, { master, overrides }] of byUid) {
    if (!master) {
      // Orphan overrides with no master (feed only sent the exception) - treat each as a
      // standalone one-off instance.
      for (const comp of overrides) pushSingle(uid, new ICAL.Event(comp), results, from, to, tz);
      continue;
    }

    const event = new ICAL.Event(master, { exceptions: overrides.map((c) => new ICAL.Event(c)) });

    if (!event.isRecurring()) {
      pushSingle(uid, event, results, from, to, tz);
      continue;
    }

    let iterator: ICAL.RecurExpansion;
    try {
      iterator = event.iterator();
    } catch {
      continue;
    }
    let next: ICAL.Time | null;
    let guard = 0;
    // ponytail: hard iteration cap, upgrade to CPU-time based cutoff if a feed abuses this
    while (guard++ < 5000 && (next = iterator.next())) {
      if (next.toJSDate().getTime() >= to.getTime()) break;
      const details = event.getOccurrenceDetails(next);
      const item = details.item;
      if (isCancelled(item.component)) continue;
      const startD = resolveDate(details.startDate, tz);
      const endD = resolveDate(details.endDate, tz);
      if (endD <= from) continue;
      const allDay = details.startDate.isDate;
      results.push({
        externalId: `${uid}::${details.recurrenceId.toICALString()}`,
        title: item.summary || '(untitled)',
        start: allDay ? isoDate(startD) : startD.toISOString(),
        end: allDay ? isoDate(endD) : endD.toISOString(),
        allDay,
        location: item.location || undefined,
        description: item.description || undefined,
      });
    }
  }

  return results;
}

function pushSingle(
  uid: string,
  event: ICAL.Event,
  results: NormalizedEvent[],
  from: Date,
  to: Date,
  tz: string,
) {
  if (isCancelled(event.component)) return;
  const startD = resolveDate(event.startDate, tz);
  const endD = resolveDate(event.endDate, tz);
  if (endD <= from || startD >= to) return;
  const allDay = event.startDate.isDate;
  results.push({
    externalId: `${uid}::${event.startDate.toICALString()}`,
    title: event.summary || '(untitled)',
    start: allDay ? isoDate(startD) : startD.toISOString(),
    end: allDay ? isoDate(endD) : endD.toISOString(),
    allDay,
    location: event.location || undefined,
    description: event.description || undefined,
  });
}

function isCancelled(component: ICAL.Component): boolean {
  const status = component.getFirstPropertyValue('status') as string | null;
  return typeof status === 'string' && status.toUpperCase() === 'CANCELLED';
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function fetchIcs(url: string): Promise<string> {
  const httpUrl = url.replace(/^webcal:\/\//i, 'https://');
  const res = await fetch(httpUrl);
  if (!res.ok) throw new Error(`ICS feed fetch failed (HTTP ${res.status})`);
  return res.text();
}

export type ConditionalFetchResult =
  | { notModified: true }
  | { notModified: false; text: string; etag: string | null; lastModified: string | null };

// Used by sync.ts's chunked sync tick: If-None-Match / If-Modified-Since so an unchanged feed
// costs one cheap round trip instead of a full fetch + parse + event replace.
export async function fetchIcsConditional(url: string, etag: string | null, lastModified: string | null): Promise<ConditionalFetchResult> {
  const httpUrl = url.replace(/^webcal:\/\//i, 'https://');
  const headers: Record<string, string> = {};
  if (etag) headers['If-None-Match'] = etag;
  if (lastModified) headers['If-Modified-Since'] = lastModified;
  const res = await fetch(httpUrl, { headers });
  if (res.status === 304) return { notModified: true };
  if (!res.ok) throw new Error(`ICS feed fetch failed (HTTP ${res.status})`);
  return { notModified: false, text: await res.text(), etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') };
}

export const provider: Provider = {
  async listEvents(ctx: ProviderCtx, from: Date, to: Date): Promise<NormalizedEvent[]> {
    const url = ctx.calendar.config?.url;
    if (!url) throw new Error('ICS calendar is missing a url');
    const text = await fetchIcs(url);
    return parseIcsEvents(text, from, to, ctx.env.TIMEZONE ?? 'UTC');
  },
};
