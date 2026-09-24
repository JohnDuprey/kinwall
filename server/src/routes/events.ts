import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { expand } from '../recurrence.ts';
import { getProvider } from '../providers/index.ts';
import type { ProviderCtx } from '../providers/types.ts';
import { decryptConfig, encryptConfig } from '../crypto.ts';
import { errorMessage } from '../redact.ts';
import { hostTimezone } from '../env.ts';
import { ErrorSchema, EventInputSchema, EventInstanceSchema } from '../schemas.ts';
import { deterministicEventId } from '../event-id.ts';

export const eventsRoutes = createRouter();

type EventRow = {
  id: string;
  calendar_id: string;
  external_id: string | null;
  title: string;
  start: string;
  end: string;
  all_day: number;
  location: string | null;
  description: string | null;
  rrule: string | null;
  member_ids: string;
  updated_at: string;
  series_id: string | null;
};

type CalendarRow = {
  id: string;
  kind: string;
  account_id: string | null;
  remote_id: string | null;
  name: string;
  color: string | null;
  member_id: string | null;
  config: string;
  writable: number;
  enabled: number;
};

type AccountRow = { id: string; kind: string; name: string; config: string };

async function householdTz(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>();
  return row?.value ?? hostTimezone();
}

async function colorsByMember(db: D1Database): Promise<Map<string, string>> {
  const { results } = await db.prepare('SELECT id, color FROM members').all<{ id: string; color: string }>();
  return new Map(results.map((r) => [r.id, r.color]));
}

function overrideKey(calendarId: string, externalId: string): string {
  return `${calendarId}\u0000${externalId}`;
}

type OverrideRow = { calendar_id: string; external_id: string; member_ids: string };

function buildOverrideMap(rows: OverrideRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of rows) {
    try {
      map.set(overrideKey(r.calendar_id, r.external_id), JSON.parse(r.member_ids));
    } catch {
      // malformed row - ignore, falls back to calendar member like no override at all
    }
  }
  return map;
}

// Per-instance member assignment for synced (remote-kind) events - keyed by (calendar_id,
// external_id) rather than the event row's own id, since remote rows are deleted/reinserted
// wholesale on every sync. Overrides a row's member_ids (which sync always writes as '[]') for
// GET, and is what PATCH .../memberIds writes to for a remote calendar instead of the row.

// '[]' clears the override (falls back to the calendar member again) rather than storing an
// empty array forever.
async function setMemberOverride(db: D1Database, calendarId: string, externalId: string, memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) {
    await db.prepare('DELETE FROM event_member_overrides WHERE calendar_id = ? AND external_id = ?').bind(calendarId, externalId).run();
    return;
  }
  await db
    .prepare(
      'INSERT INTO event_member_overrides (calendar_id, external_id, member_ids, updated_at) VALUES (?,?,?,?) ' +
        'ON CONFLICT(calendar_id, external_id) DO UPDATE SET member_ids = excluded.member_ids, updated_at = excluded.updated_at',
    )
    .bind(calendarId, externalId, JSON.stringify(memberIds), new Date().toISOString())
    .run();
}

function seriesOverrideKey(calendarId: string, seriesId: string): string {
  return `${calendarId}\u0000${seriesId}`;
}

type SeriesOverrideRow = { calendar_id: string; series_id: string; member_ids: string };

function buildSeriesOverrideMap(rows: SeriesOverrideRow[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const r of rows) {
    try {
      map.set(seriesOverrideKey(r.calendar_id, r.series_id), JSON.parse(r.member_ids));
    } catch {
      // malformed row - ignore, falls back to calendar member like no override at all
    }
  }
  return map;
}

// Series-wide member assignment for recurring synced events - keyed by (calendar_id, series_id),
// same "survives wholesale re-sync" reasoning as the override table above. Falls in between the
// occurrence override and the calendar's own member in the resolution order (see instanceFrom).

// Both override tables for a single calendar in one round trip - used by the single-event routes
// (GET/POST/PATCH) instead of two separate overridesMap/seriesOverridesMap calls. Local calendars
// never use either table, so this is a no-op for them.
async function remoteOverrides(
  db: D1Database,
  cal: CalendarRow,
  externalId: string | null,
  seriesId: string | null,
): Promise<{ override?: string[]; seriesOverride?: string[] }> {
  if (cal.kind === 'local') return {};
  const [overrideRes, seriesRes] = await db.batch<unknown>([
    db.prepare('SELECT calendar_id, external_id, member_ids FROM event_member_overrides WHERE calendar_id = ?').bind(cal.id),
    db.prepare('SELECT calendar_id, series_id, member_ids FROM event_series_member_overrides WHERE calendar_id = ?').bind(cal.id),
  ]);
  const overrideMap = buildOverrideMap(overrideRes.results as OverrideRow[]);
  const seriesMap = buildSeriesOverrideMap(seriesRes.results as SeriesOverrideRow[]);
  return {
    override: externalId ? overrideMap.get(overrideKey(cal.id, externalId)) : undefined,
    seriesOverride: seriesId ? seriesMap.get(seriesOverrideKey(cal.id, seriesId)) : undefined,
  };
}

// '[]' clears the series override back to the calendar member fallback, same as setMemberOverride.
async function setSeriesMemberOverride(db: D1Database, calendarId: string, seriesId: string, memberIds: string[]): Promise<void> {
  if (memberIds.length === 0) {
    await db.prepare('DELETE FROM event_series_member_overrides WHERE calendar_id = ? AND series_id = ?').bind(calendarId, seriesId).run();
    return;
  }
  await db
    .prepare(
      'INSERT INTO event_series_member_overrides (calendar_id, series_id, member_ids, updated_at) VALUES (?,?,?,?) ' +
        'ON CONFLICT(calendar_id, series_id) DO UPDATE SET member_ids = excluded.member_ids, updated_at = excluded.updated_at',
    )
    .bind(calendarId, seriesId, JSON.stringify(memberIds), new Date().toISOString())
    .run();
}

// "All events in the series" means all: an occurrence-level tag left over from before the event
// was tagged at series level would otherwise still win (occurrence beats series in the resolution
// order) and make the series tag look like it didn't apply to that occurrence.
async function clearOccurrenceOverridesForSeries(db: D1Database, calendarId: string, seriesId: string): Promise<void> {
  await db
    .prepare(
      'DELETE FROM event_member_overrides WHERE calendar_id = ? AND external_id IN ' +
        '(SELECT external_id FROM events WHERE calendar_id = ? AND series_id = ?)',
    )
    .bind(calendarId, calendarId, seriesId)
    .run();
}

type MemberScope = 'occurrence' | 'series' | 'calendar' | 'none';

function instanceFrom(
  row: EventRow,
  cal: CalendarRow,
  memberColors: Map<string, string>,
  occurrenceStart: string | null,
  start: string,
  end: string,
  occurrenceOverride?: string[],
  seriesOverride?: string[],
) {
  let memberIds: string[];
  let memberScope: MemberScope;
  let localTags: string[] = [];
  if (cal.kind === 'local') {
    try {
      localTags = JSON.parse(row.member_ids || '[]');
    } catch {
      localTags = [];
    }
  }
  // Local events carry their own tags (a recurring local event is one series row); synced events use
  // overrides. Either way, untagged events fall back to the calendar's member.
  if (localTags.length > 0) {
    memberIds = localTags;
    memberScope = row.rrule ? 'series' : 'occurrence';
  } else if (occurrenceOverride) {
    memberIds = occurrenceOverride;
    memberScope = 'occurrence';
  } else if (seriesOverride) {
    memberIds = seriesOverride;
    memberScope = 'series';
  } else if (cal.member_id) {
    memberIds = [cal.member_id];
    memberScope = 'calendar';
  } else {
    memberIds = [];
    memberScope = 'none';
  }
  const color = (memberIds[0] && memberColors.get(memberIds[0])) || cal.color || '#888';
  return {
    id: row.id,
    calendarId: row.calendar_id,
    title: row.title,
    start,
    end,
    allDay: !!row.all_day,
    location: row.location,
    description: row.description,
    memberIds,
    color,
    rrule: row.rrule,
    occurrenceStart,
    readOnly: !cal.writable,
    seriesId: row.series_id,
    memberScope,
  };
}

async function buildCtx(db: D1Database, cal: CalendarRow, env: Env): Promise<ProviderCtx> {
  let account: AccountRow | null = null;
  if (cal.account_id) {
    account = await db.prepare('SELECT * FROM accounts WHERE id = ?').bind(cal.account_id).first<AccountRow>();
  }
  const tz = await householdTz(db);
  return {
    env: { ...env, TIMEZONE: tz },
    account: account ? { id: account.id, config: await decryptConfig(env, account.id, account.config) } : undefined,
    calendar: { id: cal.id, remoteId: cal.remote_id, config: await decryptConfig(env, cal.id, cal.config) },
    saveAccountConfig: async (config: unknown) => {
      if (!account) return;
      const encrypted = await encryptConfig(env, account.id, config);
      await db.prepare('UPDATE accounts SET config = ? WHERE id = ?').bind(encrypted, account.id).run();
    },
  };
}

eventsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/events',
    tags: ['Events'],
    summary: 'List events in a range, merging local (expanded) and synced remote instances',
    security: [{ Bearer: [] }],
    request: {
      query: z.object({ from: z.string(), to: z.string(), memberId: z.string().optional(), calendarId: z.string().optional() }),
    },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(EventInstanceSchema) } } } },
  }),
  async (c) => {
    const { from, to, memberId, calendarId } = c.req.valid('query');
    const fromDate = new Date(from);
    const toDate = new Date(to);

    // calendars, household timezone and member colors are independent reads - one batch.
    const calendarsStmt = calendarId
      ? c.env.DB.prepare('SELECT * FROM calendars WHERE id = ?').bind(calendarId)
      : c.env.DB.prepare('SELECT * FROM calendars');
    const [calendarsRes, tzRes, membersRes] = await c.env.DB.batch<unknown>([
      calendarsStmt,
      c.env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'"),
      c.env.DB.prepare('SELECT id, color FROM members'),
    ]);
    const calendars = calendarsRes.results as unknown as CalendarRow[];
    const calById = new Map(calendars.map((cal) => [cal.id, cal]));
    if (calendars.length === 0) return c.json([], 200);
    const tz = (tzRes.results[0] as { value: string } | undefined)?.value ?? hostTimezone();
    const memberColors = new Map((membersRes.results as { id: string; color: string }[]).map((r) => [r.id, r.color]));

    // events + both override tables, all filtered by the same calendar id set - another batch.
    const calIds = calendars.map((cal) => cal.id);
    const placeholders = calIds.map(() => '?').join(',');
    const [eventsRes, overridesRes, seriesOverridesRes] = await c.env.DB.batch<unknown>([
      c.env.DB.prepare(`SELECT * FROM events WHERE calendar_id IN (${placeholders})`).bind(...calIds),
      c.env.DB.prepare(`SELECT calendar_id, external_id, member_ids FROM event_member_overrides WHERE calendar_id IN (${placeholders})`).bind(...calIds),
      c.env.DB
        .prepare(`SELECT calendar_id, series_id, member_ids FROM event_series_member_overrides WHERE calendar_id IN (${placeholders})`)
        .bind(...calIds),
    ]);
    const rows = eventsRes.results as unknown as EventRow[];
    const overrides = buildOverrideMap(overridesRes.results as OverrideRow[]);
    const seriesOverrides = buildSeriesOverrideMap(seriesOverridesRes.results as SeriesOverrideRow[]);
    const out: ReturnType<typeof instanceFrom>[] = [];

    for (const row of rows) {
      const cal = calById.get(row.calendar_id);
      if (!cal) continue;
      const override = row.external_id ? overrides.get(overrideKey(cal.id, row.external_id)) : undefined;
      const seriesOverride = row.series_id ? seriesOverrides.get(seriesOverrideKey(cal.id, row.series_id)) : undefined;

      if (cal.kind === 'local' && row.rrule) {
        for (const inst of expand(row.rrule, row.start, row.end, !!row.all_day, tz, fromDate, toDate)) {
          out.push(instanceFrom(row, cal, memberColors, inst.start, inst.start, inst.end, override, seriesOverride));
        }
        continue;
      }

      // Non-recurring local event, or an already-expanded remote instance: filter by overlap.
      const startMs = row.all_day ? Date.parse(`${row.start}T00:00:00Z`) : Date.parse(row.start);
      const endMs = row.all_day ? Date.parse(`${row.end}T00:00:00Z`) : Date.parse(row.end);
      if (endMs <= fromDate.getTime() || startMs >= toDate.getTime()) continue;
      out.push(instanceFrom(row, cal, memberColors, null, row.start, row.end, override, seriesOverride));
    }

    let filtered = out;
    if (memberId) filtered = filtered.filter((ev) => ev.memberIds.includes(memberId));
    filtered.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
    return c.json(filtered, 200);
  },
);

eventsRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/events',
    tags: ['Events'],
    summary: 'Create an event (write-through to the provider for remote writable calendars)',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: EventInputSchema } } } },
    responses: {
      201: { description: 'created', content: { 'application/json': { schema: EventInstanceSchema } } },
      400: { description: 'invalid', content: { 'application/json': { schema: ErrorSchema } } },
      502: { description: 'provider write failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    const cal = await c.env.DB.prepare('SELECT * FROM calendars WHERE id = ?').bind(body.calendarId).first<CalendarRow>();
    if (!cal) return c.json({ error: 'calendar not found' }, 400);
    if (!cal.writable) return c.json({ error: 'calendar is not writable' }, 400);

    let externalId: string | null = null;
    let title = body.title;
    let start = body.start;
    let end = body.end;
    let location = body.location ?? null;
    let description = body.description ?? null;
    let seriesId: string | null = null;

    if (cal.kind !== 'local') {
      const provider = getProvider(cal.kind as 'ics' | 'google' | 'microsoft' | 'caldav');
      if (!provider.createEvent) return c.json({ error: `${cal.kind} calendars are read-only` }, 400);
      const ctx = await buildCtx(c.env.DB, cal, c.env);
      try {
        const created = await provider.createEvent(ctx, {
          title,
          start,
          end,
          allDay: body.allDay,
          location: location ?? undefined,
          description: description ?? undefined,
        });
        externalId = created.externalId;
        title = created.title;
        start = created.start;
        end = created.end;
        location = created.location ?? null;
        description = created.description ?? null;
        seriesId = created.seriesId ?? null;
      } catch (err) {
        return c.json({ error: errorMessage(err, 'provider write failed') }, 502);
      }
    }

    const row: EventRow = {
      // Remote calendars get the same deterministic id sync would assign this externalId, so a
      // freshly write-through-created event keeps its id across the next sync instead of
      // colliding with (or being orphaned by) the row sync inserts.
      id: externalId ? await deterministicEventId(cal.id, externalId) : crypto.randomUUID(),
      calendar_id: cal.id,
      external_id: externalId,
      title,
      start,
      end,
      all_day: body.allDay ? 1 : 0,
      location,
      description,
      rrule: cal.kind === 'local' ? (body.rrule ?? null) : null,
      member_ids: JSON.stringify(body.memberIds ?? []),
      updated_at: new Date().toISOString(),
      series_id: seriesId,
    };
    await c.env.DB.prepare(
      'INSERT INTO events (id, calendar_id, external_id, title, start, end, all_day, location, description, rrule, member_ids, updated_at, series_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(row.id, row.calendar_id, row.external_id, row.title, row.start, row.end, row.all_day, row.location, row.description, row.rrule, row.member_ids, row.updated_at, row.series_id)
      .run();
    emit(c, 'events.changed', { calendarId: cal.id });

    const memberColors = await colorsByMember(c.env.DB);
    const { seriesOverride } = await remoteOverrides(c.env.DB, cal, null, row.series_id);
    return c.json(instanceFrom(row, cal, memberColors, null, row.start, row.end, undefined, seriesOverride), 201);
  },
);

type EventCalRow = EventRow & {
  cal_kind: string;
  cal_account_id: string | null;
  cal_remote_id: string | null;
  cal_name: string;
  cal_color: string | null;
  cal_member_id: string | null;
  cal_config: string;
  cal_writable: number;
  cal_enabled: number;
};

// Event + its calendar in one round trip (join) instead of two sequential lookups.
async function loadEventAndCalendar(db: D1Database, id: string): Promise<{ row: EventRow; cal: CalendarRow } | null> {
  const joined = await db
    .prepare(
      `SELECT e.*, c.kind AS cal_kind, c.account_id AS cal_account_id, c.remote_id AS cal_remote_id, c.name AS cal_name,
              c.color AS cal_color, c.member_id AS cal_member_id, c.config AS cal_config, c.writable AS cal_writable, c.enabled AS cal_enabled
       FROM events e JOIN calendars c ON c.id = e.calendar_id WHERE e.id = ?`,
    )
    .bind(id)
    .first<EventCalRow>();
  if (!joined) return null;
  const cal: CalendarRow = {
    id: joined.calendar_id,
    kind: joined.cal_kind,
    account_id: joined.cal_account_id,
    remote_id: joined.cal_remote_id,
    name: joined.cal_name,
    color: joined.cal_color,
    member_id: joined.cal_member_id,
    config: joined.cal_config,
    writable: joined.cal_writable,
    enabled: joined.cal_enabled,
  };
  return { row: joined, cal };
}

eventsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/events/{id}',
    tags: ['Events'],
    summary: 'Get a single event (series row for local recurring events)',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: EventInstanceSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const found = await loadEventAndCalendar(c.env.DB, id);
    if (!found) return c.json({ error: 'not found' }, 404);
    const memberColors = await colorsByMember(c.env.DB);
    const { override, seriesOverride } = await remoteOverrides(c.env.DB, found.cal, found.row.external_id, found.row.series_id);
    return c.json(instanceFrom(found.row, found.cal, memberColors, null, found.row.start, found.row.end, override, seriesOverride), 200);
  },
);

const EventPatchSchema = EventInputSchema.omit({ calendarId: true })
  .partial()
  .extend({ scope: z.enum(['occurrence', 'series']).optional() })
  .openapi('EventPatch');

eventsRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/events/{id}',
    tags: ['Events'],
    summary: 'Update an event (whole series, for local recurring events)',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: EventPatchSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: EventInstanceSchema } } },
      400: { description: 'invalid', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
      502: { description: 'provider write failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const found = await loadEventAndCalendar(c.env.DB, id);
    if (!found) return c.json({ error: 'not found' }, 404);
    const { row, cal } = found;

    const otherFieldsPresent =
      body.title !== undefined ||
      body.start !== undefined ||
      body.end !== undefined ||
      body.allDay !== undefined ||
      body.location !== undefined ||
      body.description !== undefined ||
      body.rrule !== undefined;
    // Member assignment on a remote-kind event is a local-only annotation (event-member-overrides,
    // keyed by external_id - the row is wiped wholesale on every sync). A memberIds-only patch
    // never touches the provider, so it works even on a read-only calendar (ICS) or when the
    // calendar isn't writable.
    const memberOnlyPatch = cal.kind !== 'local' && !otherFieldsPresent && body.memberIds !== undefined;

    if (!memberOnlyPatch && !cal.writable) return c.json({ error: 'calendar is not writable' }, 400);

    let title = body.title ?? row.title;
    let start = body.start ?? row.start;
    let end = body.end ?? row.end;
    let location = body.location !== undefined ? body.location : row.location;
    let description = body.description !== undefined ? body.description : row.description;

    if (cal.kind !== 'local' && otherFieldsPresent) {
      const provider = getProvider(cal.kind as 'ics' | 'google' | 'microsoft' | 'caldav');
      if (!provider.updateEvent || !row.external_id) return c.json({ error: `${cal.kind} calendars are read-only` }, 400);
      const ctx = await buildCtx(c.env.DB, cal, c.env);
      try {
        const updated = await provider.updateEvent(ctx, row.external_id, {
          title,
          start,
          end,
          allDay: body.allDay ?? !!row.all_day,
          location: location ?? undefined,
          description: description ?? undefined,
        });
        title = updated.title;
        start = updated.start;
        end = updated.end;
        location = updated.location ?? null;
        description = updated.description ?? null;
      } catch (err) {
        return c.json({ error: errorMessage(err, 'provider write failed') }, 502);
      }
    }

    if (cal.kind !== 'local' && body.memberIds !== undefined) {
      const scope = body.scope ?? 'occurrence';
      if (scope === 'series') {
        if (!row.series_id) return c.json({ error: 'event has no series to tag' }, 400);
        await setSeriesMemberOverride(c.env.DB, cal.id, row.series_id, body.memberIds);
        await clearOccurrenceOverridesForSeries(c.env.DB, cal.id, row.series_id);
      } else {
        if (!row.external_id) return c.json({ error: 'event has no external id' }, 400);
        await setMemberOverride(c.env.DB, cal.id, row.external_id, body.memberIds);
      }
    }

    const updatedRow: EventRow = {
      ...row,
      title,
      start,
      end,
      all_day: body.allDay !== undefined ? (body.allDay ? 1 : 0) : row.all_day,
      location,
      description,
      rrule: cal.kind === 'local' && body.rrule !== undefined ? body.rrule : row.rrule,
      member_ids: cal.kind === 'local' && body.memberIds !== undefined ? JSON.stringify(body.memberIds) : row.member_ids,
      updated_at: new Date().toISOString(),
    };
    // The UPDATE (when needed) and the member-colors lookup for the response are independent of
    // each other - batch them into one round trip instead of running them back to back.
    let memberColors: Map<string, string>;
    if (otherFieldsPresent || (cal.kind === 'local' && body.memberIds !== undefined)) {
      const updateStmt = c.env.DB
        .prepare(
          'UPDATE events SET title = ?, start = ?, end = ?, all_day = ?, location = ?, description = ?, rrule = ?, member_ids = ?, updated_at = ? WHERE id = ?',
        )
        .bind(
          updatedRow.title,
          updatedRow.start,
          updatedRow.end,
          updatedRow.all_day,
          updatedRow.location,
          updatedRow.description,
          updatedRow.rrule,
          updatedRow.member_ids,
          updatedRow.updated_at,
          id,
        );
      const [, colorsRes] = await c.env.DB.batch<unknown>([updateStmt, c.env.DB.prepare('SELECT id, color FROM members')]);
      memberColors = new Map((colorsRes.results as { id: string; color: string }[]).map((r) => [r.id, r.color]));
    } else {
      memberColors = await colorsByMember(c.env.DB);
    }
    emit(c, 'events.changed', { calendarId: cal.id });

    const { override, seriesOverride } = await remoteOverrides(c.env.DB, cal, updatedRow.external_id, updatedRow.series_id);
    return c.json(instanceFrom(updatedRow, cal, memberColors, null, updatedRow.start, updatedRow.end, override, seriesOverride), 200);
  },
);

eventsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/events/{id}',
    tags: ['Events'],
    summary: 'Delete an event (whole series, for local recurring events)',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      400: { description: 'invalid', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
      502: { description: 'provider write failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const found = await loadEventAndCalendar(c.env.DB, id);
    if (!found) return c.json({ error: 'not found' }, 404);
    const { row, cal } = found;

    if (cal.kind !== 'local') {
      const provider = getProvider(cal.kind as 'ics' | 'google' | 'microsoft' | 'caldav');
      if (!provider.deleteEvent || !row.external_id) return c.json({ error: `${cal.kind} calendars are read-only` }, 400);
      const ctx = await buildCtx(c.env.DB, cal, c.env);
      try {
        await provider.deleteEvent(ctx, row.external_id);
      } catch (err) {
        return c.json({ error: errorMessage(err, 'provider write failed') }, 502);
      }
    }

    await c.env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id).run();
    emit(c, 'events.changed', { calendarId: cal.id });
    return c.json({ ok: true }, 200);
  },
);
