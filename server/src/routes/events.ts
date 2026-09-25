import type { KinwallDb } from '../db.ts';
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
import { parseMemberIds } from '../calendar-members.ts';
import { matchCategoryByKeyword, type CategoryRow } from '../calendar-categories.ts';

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
  category_id: string | null;
  reminders: string | null;
  travel_minutes: number | null;
  remind_before_leave: number;
};

type CalendarRow = {
  id: string;
  kind: string;
  account_id: string | null;
  remote_id: string | null;
  name: string;
  color: string | null;
  member_ids: string;
  category_id: string | null;
  config: string;
  writable: number;
  enabled: number;
};

type AccountRow = { id: string; kind: string; name: string; config: string };

async function householdTz(db: KinwallDb): Promise<string> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>();
  return row?.value ?? hostTimezone();
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
async function setMemberOverride(db: KinwallDb, calendarId: string, externalId: string, memberIds: string[]): Promise<void> {
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
  db: KinwallDb,
  cal: CalendarRow,
  externalId: string | null,
  seriesId: string | null,
): Promise<{ override?: string[]; seriesOverride?: string[]; categoryOverride?: string; categorySeriesOverride?: string; travel?: TravelOverrideRow }> {
  if (cal.kind === 'local') return {};
  const [overrideRes, seriesRes, categoryOverrideRes, categorySeriesRes, travelRes] = await db.batch<unknown>([
    db.prepare('SELECT calendar_id, external_id, member_ids FROM event_member_overrides WHERE calendar_id = ?').bind(cal.id),
    db.prepare('SELECT calendar_id, series_id, member_ids FROM event_series_member_overrides WHERE calendar_id = ?').bind(cal.id),
    db.prepare('SELECT calendar_id, external_id, category_id FROM event_category_overrides WHERE calendar_id = ?').bind(cal.id),
    db.prepare('SELECT calendar_id, series_id, category_id FROM event_series_category_overrides WHERE calendar_id = ?').bind(cal.id),
    db.prepare('SELECT calendar_id, external_id, travel_minutes, remind_before_leave FROM event_travel_overrides WHERE calendar_id = ? AND external_id = ?').bind(cal.id, externalId),
  ]);
  const overrideMap = buildOverrideMap(overrideRes.results as OverrideRow[]);
  const seriesMap = buildSeriesOverrideMap(seriesRes.results as SeriesOverrideRow[]);
  const categoryOverrideMap = buildCategoryOverrideMap(categoryOverrideRes.results as CategoryOverrideRow[]);
  const categorySeriesMap = buildCategorySeriesOverrideMap(categorySeriesRes.results as CategorySeriesOverrideRow[]);
  return {
    override: externalId ? overrideMap.get(overrideKey(cal.id, externalId)) : undefined,
    seriesOverride: seriesId ? seriesMap.get(seriesOverrideKey(cal.id, seriesId)) : undefined,
    categoryOverride: externalId ? categoryOverrideMap.get(categoryOverrideKey(cal.id, externalId)) : undefined,
    categorySeriesOverride: seriesId ? categorySeriesMap.get(categorySeriesOverrideKey(cal.id, seriesId)) : undefined,
    travel: (travelRes.results as TravelOverrideRow[])[0],
  };
}

// Never saved = 30 min, matching what Settings shows and what notify.ts sends.
function parseDefaultReminderMinutes(value: string | undefined): number[] {
  if (!value) return [30];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((n): n is number => typeof n === 'number') : [];
  } catch {
    return [];
  }
}

// Member colors + categories + the household's default reminder minutes are independent reads
// needed by nearly every response below - one batch instead of separate round trips.
async function colorsAndCategories(db: KinwallDb): Promise<{ memberColors: Map<string, string>; categories: CategoryRow[]; defaultReminderMinutes: number[] }> {
  const [membersRes, categoriesRes, settingsRes] = await db.batch<unknown>([
    db.prepare('SELECT id, color FROM members'),
    db.prepare('SELECT * FROM categories ORDER BY sort, created_at'),
    db.prepare("SELECT value FROM settings WHERE key = 'defaultReminderMinutes'"),
  ]);
  return {
    memberColors: new Map((membersRes.results as { id: string; color: string }[]).map((r) => [r.id, r.color])),
    categories: categoriesRes.results as unknown as CategoryRow[],
    defaultReminderMinutes: parseDefaultReminderMinutes((settingsRes.results[0] as { value: string } | undefined)?.value),
  };
}

// '[]' clears the series override back to the calendar member fallback, same as setMemberOverride.
async function setSeriesMemberOverride(db: KinwallDb, calendarId: string, seriesId: string, memberIds: string[]): Promise<void> {
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
async function clearOccurrenceOverridesForSeries(db: KinwallDb, calendarId: string, seriesId: string): Promise<void> {
  await db
    .prepare(
      'DELETE FROM event_member_overrides WHERE calendar_id = ? AND external_id IN ' +
        '(SELECT external_id FROM events WHERE calendar_id = ? AND series_id = ?)',
    )
    .bind(calendarId, calendarId, seriesId)
    .run();
}

// Same override-table pattern as event_member_overrides/event_series_member_overrides, but for a
// single categoryId instead of a member_ids array - see migration 0011.
function categoryOverrideKey(calendarId: string, externalId: string): string {
  return `${calendarId}\u0000${externalId}`;
}

type CategoryOverrideRow = { calendar_id: string; external_id: string; category_id: string };

function buildCategoryOverrideMap(rows: CategoryOverrideRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) map.set(categoryOverrideKey(r.calendar_id, r.external_id), r.category_id);
  return map;
}

// null clears the override (falls back to the next source) rather than storing a null value.
async function setCategoryOverride(db: KinwallDb, calendarId: string, externalId: string, categoryId: string | null): Promise<void> {
  if (categoryId === null) {
    await db.prepare('DELETE FROM event_category_overrides WHERE calendar_id = ? AND external_id = ?').bind(calendarId, externalId).run();
    return;
  }
  await db
    .prepare(
      'INSERT INTO event_category_overrides (calendar_id, external_id, category_id, updated_at) VALUES (?,?,?,?) ' +
        'ON CONFLICT(calendar_id, external_id) DO UPDATE SET category_id = excluded.category_id, updated_at = excluded.updated_at',
    )
    .bind(calendarId, externalId, categoryId, new Date().toISOString())
    .run();
}

function categorySeriesOverrideKey(calendarId: string, seriesId: string): string {
  return `${calendarId}\u0000${seriesId}`;
}

type CategorySeriesOverrideRow = { calendar_id: string; series_id: string; category_id: string };

function buildCategorySeriesOverrideMap(rows: CategorySeriesOverrideRow[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const r of rows) map.set(categorySeriesOverrideKey(r.calendar_id, r.series_id), r.category_id);
  return map;
}

async function setSeriesCategoryOverride(db: KinwallDb, calendarId: string, seriesId: string, categoryId: string | null): Promise<void> {
  if (categoryId === null) {
    await db.prepare('DELETE FROM event_series_category_overrides WHERE calendar_id = ? AND series_id = ?').bind(calendarId, seriesId).run();
    return;
  }
  await db
    .prepare(
      'INSERT INTO event_series_category_overrides (calendar_id, series_id, category_id, updated_at) VALUES (?,?,?,?) ' +
        'ON CONFLICT(calendar_id, series_id) DO UPDATE SET category_id = excluded.category_id, updated_at = excluded.updated_at',
    )
    .bind(calendarId, seriesId, categoryId, new Date().toISOString())
    .run();
}

// "All events in the series" means all - see clearOccurrenceOverridesForSeries above for the same
// reasoning applied to member tags.
async function clearOccurrenceCategoryOverridesForSeries(db: KinwallDb, calendarId: string, seriesId: string): Promise<void> {
  await db
    .prepare(
      'DELETE FROM event_category_overrides WHERE calendar_id = ? AND external_id IN ' +
        '(SELECT external_id FROM events WHERE calendar_id = ? AND series_id = ?)',
    )
    .bind(calendarId, calendarId, seriesId)
    .run();
}

// Travel time (leave-by) on a synced event: Kinwall-only, so it can't live on the row sync wipes -
// event_travel_overrides keyed by (calendar_id, external_id), see migration 0019. Local events keep
// it on their own row. Either way it's never sent to the provider.
type TravelOverrideRow = { calendar_id: string; external_id: string; travel_minutes: number | null; remind_before_leave: number };

function buildTravelOverrideMap(rows: TravelOverrideRow[]): Map<string, TravelOverrideRow> {
  return new Map(rows.map((r) => [overrideKey(r.calendar_id, r.external_id), r]));
}

// A synced row with its travel override applied (local rows already carry their own).
function withTravel(row: EventRow, cal: CalendarRow, override: TravelOverrideRow | undefined): EventRow {
  if (cal.kind === 'local') return row;
  return { ...row, travel_minutes: override?.travel_minutes ?? null, remind_before_leave: override?.remind_before_leave ?? 0 };
}

// No travel and no remind-before-leave clears the override instead of storing an empty row.
async function setTravelOverride(db: KinwallDb, calendarId: string, externalId: string, travelMinutes: number | null, remindBeforeLeave: boolean): Promise<void> {
  if (travelMinutes === null && !remindBeforeLeave) {
    await db.prepare('DELETE FROM event_travel_overrides WHERE calendar_id = ? AND external_id = ?').bind(calendarId, externalId).run();
    return;
  }
  await db
    .prepare(
      'INSERT INTO event_travel_overrides (calendar_id, external_id, travel_minutes, remind_before_leave, updated_at) VALUES (?,?,?,?,?) ' +
        'ON CONFLICT(calendar_id, external_id) DO UPDATE SET travel_minutes = excluded.travel_minutes, remind_before_leave = excluded.remind_before_leave, updated_at = excluded.updated_at',
    )
    .bind(calendarId, externalId, travelMinutes, remindBeforeLeave ? 1 : 0, new Date().toISOString())
    .run();
}

type MemberScope = 'occurrence' | 'series' | 'calendar' | 'none';
type CategorySource = 'event' | 'series' | 'keyword' | 'calendar' | null;

// Resolution order (highest first): occurrence override -> series override -> keyword match ->
// calendar default -> none. `categories` must be sorted by sort (first keyword match by sort
// order wins) - callers always fetch it that way.
function resolveCategory(
  title: string,
  categories: CategoryRow[],
  occurrenceOverride: string | undefined,
  seriesOverride: string | undefined,
  calendarDefaultCategoryId: string | null,
): { categoryId: string | null; categorySource: CategorySource } {
  if (occurrenceOverride) return { categoryId: occurrenceOverride, categorySource: 'event' };
  if (seriesOverride) return { categoryId: seriesOverride, categorySource: 'series' };
  const keywordMatch = matchCategoryByKeyword(title, categories);
  if (keywordMatch) return { categoryId: keywordMatch.id, categorySource: 'keyword' };
  if (calendarDefaultCategoryId) return { categoryId: calendarDefaultCategoryId, categorySource: 'calendar' };
  return { categoryId: null, categorySource: null };
}

function instanceFrom(
  row: EventRow,
  cal: CalendarRow,
  memberColors: Map<string, string>,
  occurrenceStart: string | null,
  start: string,
  end: string,
  occurrenceOverride?: string[],
  seriesOverride?: string[],
  categories: CategoryRow[] = [],
  categoryOccurrenceOverride?: string,
  categorySeriesOverride?: string,
  defaultReminderMinutes: number[] = [],
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
  } else {
    const calMemberIds = parseMemberIds(cal.member_ids);
    if (calMemberIds.length > 0) {
      memberIds = calMemberIds;
      memberScope = 'calendar';
    } else {
      memberIds = [];
      memberScope = 'none';
    }
  }
  const color = (memberIds[0] && memberColors.get(memberIds[0])) || cal.color || '#888';

  // Own reminders if set, else the household default - "from provider or default" per SPEC.
  let ownReminders: number[] | null = null;
  if (row.reminders) {
    try {
      ownReminders = JSON.parse(row.reminders);
    } catch {
      ownReminders = null;
    }
  }
  // An explicit [] (reminders turned off on the event) stays silent rather than taking the default.
  const reminders = ownReminders ?? (defaultReminderMinutes.length > 0 ? defaultReminderMinutes : null);
  const reminderSource: 'event' | 'default' | null = ownReminders ? 'event' : reminders ? 'default' : null;

  let categoryId: string | null;
  let categorySource: CategorySource;
  const localCategory = cal.kind === 'local' ? row.category_id : null;
  if (localCategory) {
    categoryId = localCategory;
    categorySource = row.rrule ? 'series' : 'event';
  } else {
    ({ categoryId, categorySource } = resolveCategory(row.title, categories, categoryOccurrenceOverride, categorySeriesOverride, cal.category_id));
  }

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
    categoryId,
    categorySource,
    reminders: reminders && reminders.length > 0 ? reminders : null,
    reminderSource: reminders && reminders.length > 0 ? reminderSource : null,
    travelMinutes: row.travel_minutes,
    leaveAt: row.travel_minutes != null && !row.all_day ? new Date(Date.parse(start) - row.travel_minutes * 60000).toISOString() : null,
    remindBeforeLeave: !!row.remind_before_leave,
  };
}

async function buildCtx(db: KinwallDb, cal: CalendarRow, env: Env): Promise<ProviderCtx> {
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

// Every event instance overlapping [from, to), members/categories/travel resolved, sorted by start -
// GET /api/events, and the snapshot (routes/snapshot.ts).
export async function eventInstances(db: KinwallDb, fromDate: Date, toDate: Date, calendarId?: string) {
  // calendars, household timezone, member colors and categories (for keyword matching) are
  // independent reads - one batch.
  const calendarsStmt = calendarId
    ? db.prepare('SELECT * FROM calendars WHERE id = ?').bind(calendarId)
    : db.prepare('SELECT * FROM calendars');
  const [calendarsRes, settingsRes, membersRes, categoriesRes] = await db.batch<unknown>([
    calendarsStmt,
    db.prepare("SELECT key, value FROM settings WHERE key IN ('timezone', 'defaultReminderMinutes')"),
    db.prepare('SELECT id, color FROM members'),
    db.prepare('SELECT * FROM categories ORDER BY sort, created_at'),
  ]);
  const calendars = calendarsRes.results as unknown as CalendarRow[];
  const calById = new Map(calendars.map((cal) => [cal.id, cal]));
  if (calendars.length === 0) return [];
  const settingsMap = new Map((settingsRes.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  const tz = settingsMap.get('timezone') ?? hostTimezone();
  const defaultReminderMinutes = parseDefaultReminderMinutes(settingsMap.get('defaultReminderMinutes'));
  const memberColors = new Map((membersRes.results as { id: string; color: string }[]).map((r) => [r.id, r.color]));
  const categories = categoriesRes.results as unknown as CategoryRow[];

  // events + all four override tables, all filtered by the same calendar id set - another batch.
  const calIds = calendars.map((cal) => cal.id);
  const placeholders = calIds.map(() => '?').join(',');
  const [eventsRes, overridesRes, seriesOverridesRes, categoryOverridesRes, categorySeriesOverridesRes, travelOverridesRes, linkedRes, notesRes] = await db.batch<unknown>([
    db.prepare(`SELECT * FROM events WHERE calendar_id IN (${placeholders})`).bind(...calIds),
    db.prepare(`SELECT calendar_id, external_id, member_ids FROM event_member_overrides WHERE calendar_id IN (${placeholders})`).bind(...calIds),
    db
      .prepare(`SELECT calendar_id, series_id, member_ids FROM event_series_member_overrides WHERE calendar_id IN (${placeholders})`)
      .bind(...calIds),
    db.prepare(`SELECT calendar_id, external_id, category_id FROM event_category_overrides WHERE calendar_id IN (${placeholders})`).bind(...calIds),
    db
      .prepare(`SELECT calendar_id, series_id, category_id FROM event_series_category_overrides WHERE calendar_id IN (${placeholders})`)
      .bind(...calIds),
    db
      .prepare(`SELECT calendar_id, external_id, travel_minutes, remind_before_leave FROM event_travel_overrides WHERE calendar_id IN (${placeholders})`)
      .bind(...calIds),
    // Every event's open linked-item count (small, indexed) - no per-id IN list, which could pass D1's 100-param cap.
    db.prepare('SELECT event_id, COUNT(*) AS n FROM list_items WHERE done = 0 AND event_id IS NOT NULL GROUP BY event_id'),
    db.prepare("SELECT target_id, COUNT(*) AS n FROM notes WHERE target_type = 'event' GROUP BY target_id"),
  ]);
  const noteCounts = new Map((notesRes.results as { target_id: string; n: number }[]).map((r) => [r.target_id, r.n]));
  const linkedCounts = new Map((linkedRes.results as { event_id: string; n: number }[]).map((r) => [r.event_id, r.n]));
  const travelOverrides = buildTravelOverrideMap(travelOverridesRes.results as TravelOverrideRow[]);
  const rows = eventsRes.results as unknown as EventRow[];
  const overrides = buildOverrideMap(overridesRes.results as OverrideRow[]);
  const seriesOverrides = buildSeriesOverrideMap(seriesOverridesRes.results as SeriesOverrideRow[]);
  const categoryOverrides = buildCategoryOverrideMap(categoryOverridesRes.results as CategoryOverrideRow[]);
  const categorySeriesOverrides = buildCategorySeriesOverrideMap(categorySeriesOverridesRes.results as CategorySeriesOverrideRow[]);
  const out: ReturnType<typeof instanceFrom>[] = [];

  for (const storedRow of rows) {
    const cal = calById.get(storedRow.calendar_id);
    if (!cal) continue;
    const row = withTravel(storedRow, cal, storedRow.external_id ? travelOverrides.get(overrideKey(cal.id, storedRow.external_id)) : undefined);
    const override = row.external_id ? overrides.get(overrideKey(cal.id, row.external_id)) : undefined;
    const seriesOverride = row.series_id ? seriesOverrides.get(seriesOverrideKey(cal.id, row.series_id)) : undefined;
    const categoryOverride = row.external_id ? categoryOverrides.get(categoryOverrideKey(cal.id, row.external_id)) : undefined;
    const categorySeriesOverride = row.series_id ? categorySeriesOverrides.get(categorySeriesOverrideKey(cal.id, row.series_id)) : undefined;

    if (cal.kind === 'local' && row.rrule) {
      for (const inst of expand(row.rrule, row.start, row.end, !!row.all_day, tz, fromDate, toDate)) {
        out.push(instanceFrom(row, cal, memberColors, inst.start, inst.start, inst.end, override, seriesOverride, categories, categoryOverride, categorySeriesOverride, defaultReminderMinutes));
      }
      continue;
    }

    // Non-recurring local event, or an already-expanded remote instance: filter by overlap.
    const startMs = row.all_day ? Date.parse(`${row.start}T00:00:00Z`) : Date.parse(row.start);
    const endMs = row.all_day ? Date.parse(`${row.end}T00:00:00Z`) : Date.parse(row.end);
    if (endMs <= fromDate.getTime() || startMs >= toDate.getTime()) continue;
    out.push(instanceFrom(row, cal, memberColors, null, row.start, row.end, override, seriesOverride, categories, categoryOverride, categorySeriesOverride, defaultReminderMinutes));
  }

  const withCounts = out.map((ev) => ({ ...ev, linkedItemCount: linkedCounts.get(ev.id) ?? 0, noteCount: noteCounts.get(ev.id) ?? 0 }));
  withCounts.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return withCounts;
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
    let filtered = await eventInstances(c.env.DB, new Date(from), new Date(to), calendarId);
    if (memberId) filtered = filtered.filter((ev) => ev.memberIds.includes(memberId));
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
          ...(body.reminders !== undefined ? { reminders: body.reminders } : {}),
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
      category_id: body.categoryId ?? null,
      reminders: Array.isArray(body.reminders) ? JSON.stringify(body.reminders) : null,
      travel_minutes: body.travelMinutes ?? null,
      remind_before_leave: body.remindBeforeLeave ? 1 : 0,
    };
    // Synced rows are wiped on resync, so their travel time goes to the override table (the row's
    // own columns stay empty, like sync writes them).
    const local = cal.kind === 'local';
    await c.env.DB.prepare(
      'INSERT INTO events (id, calendar_id, external_id, title, start, end, all_day, location, description, rrule, member_ids, updated_at, series_id, category_id, reminders, travel_minutes, remind_before_leave) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    )
      .bind(row.id, row.calendar_id, row.external_id, row.title, row.start, row.end, row.all_day, row.location, row.description, row.rrule, row.member_ids, row.updated_at, row.series_id, row.category_id, row.reminders, local ? row.travel_minutes : null, local ? row.remind_before_leave : 0)
      .run();
    if (!local && externalId && (row.travel_minutes !== null || row.remind_before_leave)) await setTravelOverride(c.env.DB, cal.id, externalId, row.travel_minutes, !!row.remind_before_leave);
    emit(c, 'events.changed', { calendarId: cal.id });

    const { memberColors, categories, defaultReminderMinutes } = await colorsAndCategories(c.env.DB);
    const { seriesOverride, categorySeriesOverride } = await remoteOverrides(c.env.DB, cal, null, row.series_id);
    return c.json(instanceFrom(row, cal, memberColors, null, row.start, row.end, undefined, seriesOverride, categories, undefined, categorySeriesOverride, defaultReminderMinutes), 201);
  },
);

type EventCalRow = EventRow & {
  cal_kind: string;
  cal_account_id: string | null;
  cal_remote_id: string | null;
  cal_name: string;
  cal_color: string | null;
  cal_member_ids: string;
  cal_category_id: string | null;
  cal_config: string;
  cal_writable: number;
  cal_enabled: number;
};

// Event + its calendar in one round trip (join) instead of two sequential lookups.
async function loadEventAndCalendar(db: KinwallDb, id: string): Promise<{ row: EventRow; cal: CalendarRow } | null> {
  const joined = await db
    .prepare(
      `SELECT e.*, c.kind AS cal_kind, c.account_id AS cal_account_id, c.remote_id AS cal_remote_id, c.name AS cal_name,
              c.color AS cal_color, c.member_ids AS cal_member_ids, c.category_id AS cal_category_id, c.config AS cal_config, c.writable AS cal_writable, c.enabled AS cal_enabled
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
    member_ids: joined.cal_member_ids,
    category_id: joined.cal_category_id,
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
    const { memberColors, categories, defaultReminderMinutes } = await colorsAndCategories(c.env.DB);
    const { override, seriesOverride, categoryOverride, categorySeriesOverride, travel } = await remoteOverrides(c.env.DB, found.cal, found.row.external_id, found.row.series_id);
    return c.json(
      instanceFrom(withTravel(found.row, found.cal, travel), found.cal, memberColors, null, found.row.start, found.row.end, override, seriesOverride, categories, categoryOverride, categorySeriesOverride, defaultReminderMinutes),
      200,
    );
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
      body.rrule !== undefined ||
      // Reminders live on the provider's event, so on Google/Outlook changing them is a real write.
      body.reminders !== undefined;
    // Member assignment and category assignment on a remote-kind event are local-only annotations
    // (event-member-overrides / event-category-overrides, keyed by external_id - the row is wiped
    // wholesale on every sync). A memberIds/categoryId-only patch never touches the provider, so it
    // works even on a read-only calendar (ICS) or when the calendar isn't writable. Travel time is
    // the same kind of Kinwall-only annotation (event_travel_overrides) and is never sent to the provider.
    const travelPresent = body.travelMinutes !== undefined || body.remindBeforeLeave !== undefined;
    const annotationOnlyPatch = cal.kind !== 'local' && !otherFieldsPresent && (body.memberIds !== undefined || body.categoryId !== undefined || travelPresent);

    if (!annotationOnlyPatch && !cal.writable) return c.json({ error: 'calendar is not writable' }, 400);

    let title = body.title ?? row.title;
    let start = body.start ?? row.start;
    let end = body.end ?? row.end;
    let location = body.location !== undefined ? body.location : row.location;
    let description = body.description !== undefined ? body.description : row.description;

    let remoteReminders: string | null | undefined;
    if (cal.kind !== 'local' && otherFieldsPresent) {
      const provider = getProvider(cal.kind as 'ics' | 'google' | 'microsoft' | 'caldav');
      if (!provider.updateEvent || !row.external_id) return c.json({ error: `${cal.kind} calendars are read-only` }, 400);
      if (body.reminders !== undefined && cal.kind === 'caldav') return c.json({ error: 'reminders can only be changed on Google and Outlook calendars' }, 400);
      const ctx = await buildCtx(c.env.DB, cal, c.env);
      try {
        const updated = await provider.updateEvent(ctx, row.external_id, {
          title,
          start,
          end,
          allDay: body.allDay ?? !!row.all_day,
          location: location ?? undefined,
          description: description ?? undefined,
          ...(body.reminders !== undefined ? { reminders: body.reminders } : {}),
        });
        if (body.reminders !== undefined) remoteReminders = Array.isArray(updated.reminders) ? JSON.stringify(updated.reminders) : null;
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

    if (cal.kind !== 'local' && body.categoryId !== undefined) {
      const scope = body.scope ?? 'occurrence';
      if (scope === 'series') {
        if (!row.series_id) return c.json({ error: 'event has no series to tag' }, 400);
        await setSeriesCategoryOverride(c.env.DB, cal.id, row.series_id, body.categoryId);
        await clearOccurrenceCategoryOverridesForSeries(c.env.DB, cal.id, row.series_id);
      } else {
        if (!row.external_id) return c.json({ error: 'event has no external id' }, 400);
        await setCategoryOverride(c.env.DB, cal.id, row.external_id, body.categoryId);
      }
    }

    // Merge a partial travel patch over what's in effect now (override for synced, row for local).
    let travelMinutes = row.travel_minutes;
    let remindBeforeLeave = row.remind_before_leave;
    if (travelPresent) {
      if (cal.kind !== 'local' && !row.external_id) return c.json({ error: 'event has no external id' }, 400);
      const current = cal.kind === 'local' ? row : withTravel(row, cal, (await remoteOverrides(c.env.DB, cal, row.external_id, null)).travel);
      travelMinutes = body.travelMinutes !== undefined ? body.travelMinutes : current.travel_minutes;
      remindBeforeLeave = body.remindBeforeLeave !== undefined ? (body.remindBeforeLeave ? 1 : 0) : current.remind_before_leave;
      if (cal.kind !== 'local') await setTravelOverride(c.env.DB, cal.id, row.external_id!, travelMinutes, !!remindBeforeLeave);
    }

    const updatedRow: EventRow = {
      ...row,
      travel_minutes: cal.kind === 'local' ? travelMinutes : row.travel_minutes,
      remind_before_leave: cal.kind === 'local' ? remindBeforeLeave : row.remind_before_leave,
      title,
      start,
      end,
      all_day: body.allDay !== undefined ? (body.allDay ? 1 : 0) : row.all_day,
      location,
      description,
      rrule: cal.kind === 'local' && body.rrule !== undefined ? body.rrule : row.rrule,
      member_ids: cal.kind === 'local' && body.memberIds !== undefined ? JSON.stringify(body.memberIds) : row.member_ids,
      category_id: cal.kind === 'local' && body.categoryId !== undefined ? body.categoryId : row.category_id,
      reminders: remoteReminders !== undefined ? remoteReminders : cal.kind === 'local' && body.reminders !== undefined ? (Array.isArray(body.reminders) ? JSON.stringify(body.reminders) : null) : row.reminders,
      updated_at: new Date().toISOString(),
    };
    // The UPDATE (when needed) and the member-colors/categories lookups for the response are
    // independent of each other - batch them into one round trip instead of running them back to back.
    let memberColors: Map<string, string>;
    let categories: CategoryRow[];
    let defaultReminderMinutes: number[];
    if (otherFieldsPresent || (cal.kind === 'local' && (body.memberIds !== undefined || body.categoryId !== undefined || body.reminders !== undefined || travelPresent))) {
      const updateStmt = c.env.DB
        .prepare(
          'UPDATE events SET title = ?, start = ?, end = ?, all_day = ?, location = ?, description = ?, rrule = ?, member_ids = ?, category_id = ?, reminders = ?, travel_minutes = ?, remind_before_leave = ?, updated_at = ? WHERE id = ?',
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
          updatedRow.category_id,
          updatedRow.reminders,
          updatedRow.travel_minutes,
          updatedRow.remind_before_leave,
          updatedRow.updated_at,
          id,
        );
      const [, colorsRes, categoriesRes, settingsRes] = await c.env.DB.batch<unknown>([
        updateStmt,
        c.env.DB.prepare('SELECT id, color FROM members'),
        c.env.DB.prepare('SELECT * FROM categories ORDER BY sort, created_at'),
        c.env.DB.prepare("SELECT value FROM settings WHERE key = 'defaultReminderMinutes'"),
      ]);
      memberColors = new Map((colorsRes.results as { id: string; color: string }[]).map((r) => [r.id, r.color]));
      categories = categoriesRes.results as unknown as CategoryRow[];
      defaultReminderMinutes = parseDefaultReminderMinutes((settingsRes.results[0] as { value: string } | undefined)?.value);
    } else {
      ({ memberColors, categories, defaultReminderMinutes } = await colorsAndCategories(c.env.DB));
    }
    emit(c, 'events.changed', { calendarId: cal.id });

    const { override, seriesOverride, categoryOverride, categorySeriesOverride, travel } = await remoteOverrides(c.env.DB, cal, updatedRow.external_id, updatedRow.series_id);
    return c.json(
      instanceFrom(withTravel(updatedRow, cal, travel), cal, memberColors, null, updatedRow.start, updatedRow.end, override, seriesOverride, categories, categoryOverride, categorySeriesOverride, defaultReminderMinutes),
      200,
    );
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

    // Its notes thread goes with it (a synced event that merely drops out of the feed keeps its
    // notes - they come back if the event does).
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id),
      c.env.DB.prepare("DELETE FROM notes WHERE target_type = 'event' AND target_id = ?").bind(id),
    ]);
    emit(c, 'events.changed', { calendarId: cal.id });
    return c.json({ ok: true }, 200);
  },
);
