// CalDAV provider (iCloud, Fastmail, Nextcloud, ...) via tsdav + Basic auth (app-specific
// password for iCloud). Recurrence expansion reuses ics.ts's parser so it isn't duplicated.
import { DAVClient } from 'tsdav';
import { expandICS } from './ics.ts';
import type {
  EventInput,
  NormalizedEvent,
  Provider,
  ProviderCtx,
  RemoteCalendar,
} from './types.ts';

type CaldavConfig = { serverUrl: string; username: string; password: string };

// v1 limitation: updateEvent/deleteEvent operate on the whole calendar object (the VEVENT
// series at the given href), not a single recurring instance - CalDAV has no single-instance
// PATCH primitive without read-modify-write of the whole ICS object, which is out of scope for
// v1. externalId therefore encodes "<href>::<instanceKey>" so listEvents can still produce a
// unique id per instance while writes fall back to the series.
function splitExternalId(externalId: string): { href: string; instanceKey: string } {
  const i = externalId.indexOf('::');
  return i === -1 ? { href: externalId, instanceKey: '' } : { href: externalId.slice(0, i), instanceKey: externalId.slice(i + 2) };
}

function client(config: CaldavConfig): DAVClient {
  return new DAVClient({
    serverUrl: config.serverUrl,
    credentials: { username: config.username, password: config.password },
    authMethod: 'Basic',
    defaultAccountType: 'caldav',
  });
}

function humanError(err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  if (/401|403/.test(msg)) return new Error('CalDAV login rejected — check username/password');
  return new Error(`CalDAV error: ${msg}`);
}

export async function verifyAccount(
  serverUrl: string,
  username: string,
  password: string,
): Promise<{ name: string; config: CaldavConfig }> {
  const c = client({ serverUrl, username, password });
  try {
    await c.login();
  } catch (err) {
    throw humanError(err);
  }
  return { name: username, config: { serverUrl, username, password } };
}

function buildVevent(uid: string, ev: EventInput): string {
  const dt = (v: string, allDay: boolean) =>
    allDay ? `;VALUE=DATE:${v.replace(/-/g, '')}` : `:${v.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Kinwall//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`,
    `DTSTART${dt(ev.start, ev.allDay)}`,
    `DTEND${dt(ev.end, ev.allDay)}`,
    `SUMMARY:${escapeText(ev.title)}`,
  ];
  if (ev.location) lines.push(`LOCATION:${escapeText(ev.location)}`);
  if (ev.description) lines.push(`DESCRIPTION:${escapeText(ev.description)}`);
  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function escapeText(v: string): string {
  return v.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;').replace(/\n/g, '\\n');
}

export const provider: Provider = {
  async listCalendars(ctx): Promise<RemoteCalendar[]> {
    const config = ctx.account?.config as CaldavConfig | undefined;
    if (!config) throw new Error('CalDAV account is not connected');
    const c = client(config);
    try {
      await c.login();
      const calendars = await c.fetchCalendars();
      return calendars
        .filter((cal) => !cal.components || cal.components.includes('VEVENT'))
        .map((cal) => ({
          remoteId: cal.url,
          name: typeof cal.displayName === 'string' ? cal.displayName : cal.url,
          color: cal.calendarColor,
          // tsdav doesn't surface the DAV privilege set, so assume writable unless the
          // collection explicitly excludes VEVENT.
          writable: true,
        }));
    } catch (err) {
      throw humanError(err);
    }
  },

  async listEvents(ctx: ProviderCtx, from: Date, to: Date): Promise<NormalizedEvent[]> {
    const config = ctx.account?.config as CaldavConfig | undefined;
    if (!config) throw new Error('CalDAV account is not connected');
    const c = client(config);
    try {
      await c.login();
      const objects = await c.fetchCalendarObjects({
        calendar: { url: ctx.calendar.remoteId ?? '' },
        timeRange: { start: from.toISOString(), end: to.toISOString() },
      });
      const events: NormalizedEvent[] = [];
      for (const obj of objects) {
        if (!obj.data) continue;
        for (const instance of await expandICS(obj.data, from, to, ctx.env.TIMEZONE ?? 'UTC')) {
          events.push({ ...instance, externalId: `${obj.url}::${instance.externalId}` });
        }
      }
      return events;
    } catch (err) {
      throw humanError(err);
    }
  },

  async createEvent(ctx: ProviderCtx, ev: EventInput): Promise<NormalizedEvent> {
    const config = ctx.account?.config as CaldavConfig | undefined;
    if (!config) throw new Error('CalDAV account is not connected');
    const c = client(config);
    try {
      await c.login();
      const uid = crypto.randomUUID();
      const res = await c.createCalendarObject({
        calendar: { url: ctx.calendar.remoteId ?? '' },
        filename: `${uid}.ics`,
        iCalString: buildVevent(uid, ev),
      });
      if (!res.ok) throw new Error(`create failed (HTTP ${res.status})`);
      const href = res.headers.get('location') ?? `${ctx.calendar.remoteId}${uid}.ics`;
      return { ...ev, externalId: `${href}::${uid}` };
    } catch (err) {
      throw humanError(err);
    }
  },

  // v1: updates/deletes act on the whole series at the object's href - see the comment on
  // splitExternalId above.
  async updateEvent(ctx: ProviderCtx, externalId: string, ev: Partial<EventInput>): Promise<NormalizedEvent> {
    const config = ctx.account?.config as CaldavConfig | undefined;
    if (!config) throw new Error('CalDAV account is not connected');
    const { href } = splitExternalId(externalId);
    const c = client(config);
    try {
      await c.login();
      const [existing] = await c.fetchCalendarObjects({
        calendar: { url: ctx.calendar.remoteId ?? '' },
        objectUrls: [href],
      });
      const uidMatch = existing?.data?.match(/UID:([^\r\n]+)/);
      const uid = uidMatch?.[1] ?? crypto.randomUUID();
      // Best-effort merge: pull the current field values from the existing object (via the
      // shared ICS parser) so a partial update doesn't blank out fields the caller didn't pass.
      const base = existing?.data ? (await expandICS(existing.data, new Date(0), new Date(8640000000000000), ctx.env.TIMEZONE ?? 'UTC'))[0] : undefined;
      const merged: EventInput = {
        title: ev.title ?? base?.title ?? '',
        start: ev.start ?? base?.start ?? '',
        end: ev.end ?? base?.end ?? '',
        allDay: ev.allDay ?? base?.allDay ?? false,
        location: ev.location ?? base?.location,
        description: ev.description ?? base?.description,
      };
      const res = await c.updateCalendarObject({
        calendarObject: { url: href, data: buildVevent(uid, merged), etag: existing?.etag },
      });
      if (!res.ok) throw new Error(`update failed (HTTP ${res.status})`);
      return { ...merged, externalId: `${href}::${uid}` };
    } catch (err) {
      throw humanError(err);
    }
  },

  async deleteEvent(ctx: ProviderCtx, externalId: string): Promise<void> {
    const config = ctx.account?.config as CaldavConfig | undefined;
    if (!config) throw new Error('CalDAV account is not connected');
    const { href } = splitExternalId(externalId);
    const c = client(config);
    try {
      await c.login();
      const res = await c.deleteCalendarObject({ calendarObject: { url: href } });
      if (!res.ok && res.status !== 404) throw new Error(`delete failed (HTTP ${res.status})`);
    } catch (err) {
      throw humanError(err);
    }
  },
};
