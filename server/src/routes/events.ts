import type { KinwallDb } from '../db.ts';
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { expand, isEventTime, isValidRrule, rruleOccurs } from '../recurrence.ts';
import { getProvider } from '../providers/index.ts';
import type { ProviderCtx } from '../providers/types.ts';
import { decryptConfig, encryptConfig } from '../crypto.ts';
import { errorMessage } from '../redact.ts';
import { hostTimezone } from '../env.ts';
import { ErrorSchema, EventInputSchema, EventInstanceSchema } from '../schemas.ts';
import { deterministicEventId } from '../event-id.ts';
import { parseMemberIds } from '../calendar-members.ts';
import { matchCategoryByKeyword, type CategoryRow } from '../calendar-categories.ts';
import { eventWriteBlock, requestKey } from '../auth.ts';
import { defaultCalendarId } from '../default-calendar.ts';
import { filterActive, filterShows, parseFilter } from '../calendar-filter.ts';
import { mealLinksQuery, parseMealLinks, prepAt } from '../prepBy.ts';

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
  busy: number; // 1 busy (default), 0 free - migration 0073
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
  display_edit: number;
  filter?: string | null;
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
// external_id) rather than the event row's own id, since remote rows are rewritten from the
// provider whenever they change there. Overrides a row's member_ids (which sync always writes as '[]') for
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
// same "survives re-sync" reasoning as the override table above. Falls in between the
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
    // A free event never asks anyone to leave: no leave-by (its travel time is kept for when it's busy again).
    leaveAt: row.travel_minutes != null && !row.all_day && row.busy !== 0 && !Number.isNaN(Date.parse(start)) ? new Date(Date.parse(start) - row.travel_minutes * 60000).toISOString() : null,
    remindBeforeLeave: !!row.remind_before_leave,
    busy: row.busy !== 0,
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

// Hidden events (event_hidden, migration 0069): the keys an instance is hidden under. Synced events
// use the provider's ids so a resync never brings them back; a local recurring event is one row, so
// one of its occurrences is '<id>@<start>' and the series is the row itself.
function hideKeys(row: Pick<EventRow, 'id' | 'external_id' | 'series_id' | 'rrule'>, cal: Pick<CalendarRow, 'kind'>, instStart: string): { occurrence: string; series: string | null } {
  const localSeries = cal.kind === 'local' && !!row.rrule;
  return { occurrence: localSeries ? `${row.id}@${instStart}` : row.external_id ?? row.id, series: localSeries ? row.id : cal.kind === 'local' ? null : row.series_id };
}
const hiddenKey = (calendarId: string, scope: 'occurrence' | 'series', key: string) => `${calendarId}\u0000${scope}\u0000${key}`;

// The rows that can reach back more than a week: local repeats and long rows (idx_events_open,
// migration 0071, whose WHERE this must match exactly).
const EVENT_OPEN = '(rrule IS NOT NULL OR (julianday(end) - julianday(start) <= 7) IS NOT 1)';
const OPEN_DAYS = 7;

/** Two statements (for a batch) reading the event rows of `calendars` (an SQL condition on
 * calendar_id) that can have an instance overlapping [from, to): rows starting up to a week before
 * `from`, plus the open ones above. Hosted is billed per row read, and this reads by index instead of
 * the whole table. Bounds are compared as text with a day of slack each way (all-day rows store dates,
 * a synced row may carry an offset), so a row can come back from both or outside the window: pass the
 * results to eventRowsFrom, and callers still check the overlap themselves. */
export function eventRowsStmts(db: KinwallDb, calendars: string, binds: unknown[], from: Date, to: Date) {
  const lo = new Date(from.getTime() - (OPEN_DAYS + 1) * 86400000).toISOString();
  const hi = new Date(to.getTime() + 86400000).toISOString();
  return [
    db.prepare(`SELECT * FROM events WHERE calendar_id ${calendars} AND start >= ? AND start < ?`).bind(...binds, lo, hi),
    db.prepare(`SELECT * FROM events WHERE calendar_id ${calendars} AND start < ? AND ${EVENT_OPEN}`).bind(...binds, hi),
  ];
}
export function eventRowsFrom(results: { results: unknown[] }[]): EventRow[] {
  return [...new Map(results.flatMap((r) => r.results as EventRow[]).map((r) => [r.id, r])).values()];
}
type HiddenReason = 'event' | 'series' | 'filter' | null;

// Every event instance overlapping [from, to), members/categories/travel resolved, sorted by start -
// GET /api/events, the board and snapshot (routes/snapshot.ts), insights and notify.ts. Events the
// family has hidden (event_hidden) or filtered out (calendar-filter.ts) are left out here, the one
// place every consumer reads through; includeHidden keeps them, marked with why (Settings' preview
// and a parent's Show hidden).
// `rows`: event rows the caller already read with eventRowsStmts for this window (notify.ts), so
// they aren't read twice.
export async function eventInstances(db: KinwallDb, fromDate: Date, toDate: Date, calendarId?: string, opts: { includeHidden?: boolean; rows?: EventRow[] } = {}) {
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
  const filters = new Map(calendars.map((cal) => [cal.id, parseFilter(cal.filter)]));

  // events + all four override tables, all filtered by the same calendar id set - another batch.
  const calIds = calendars.map((cal) => cal.id);
  const placeholders = calIds.map(() => '?').join(',');
  const eventStmts = opts.rows ? [] : eventRowsStmts(db, `IN (${placeholders})`, calIds, fromDate, toDate);
  const res = await db.batch<unknown>([
    ...eventStmts,
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
    mealLinksQuery(db),
    db.prepare(`SELECT calendar_id, scope, key FROM event_hidden WHERE calendar_id IN (${placeholders})`).bind(...calIds),
  ]);
  const [overridesRes, seriesOverridesRes, categoryOverridesRes, categorySeriesOverridesRes, travelOverridesRes, linkedRes, notesRes, mealsRes, hiddenRes] = res.slice(eventStmts.length);
  const hiddenSet = new Set((hiddenRes.results as { calendar_id: string; scope: 'occurrence' | 'series'; key: string }[]).map((r) => hiddenKey(r.calendar_id, r.scope, r.key)));
  const noteCounts = new Map((notesRes.results as { target_id: string; n: number }[]).map((r) => [r.target_id, r.n]));
  const linkedCounts = new Map((linkedRes.results as { event_id: string; n: number }[]).map((r) => [r.event_id, r.n]));
  const travelOverrides = buildTravelOverrideMap(travelOverridesRes.results as TravelOverrideRow[]);
  const rows = opts.rows ?? eventRowsFrom(res.slice(0, eventStmts.length));
  const overrides = buildOverrideMap(overridesRes.results as OverrideRow[]);
  const seriesOverrides = buildSeriesOverrideMap(seriesOverridesRes.results as SeriesOverrideRow[]);
  const categoryOverrides = buildCategoryOverrideMap(categoryOverridesRes.results as CategoryOverrideRow[]);
  const categorySeriesOverrides = buildCategorySeriesOverrideMap(categorySeriesOverridesRes.results as CategorySeriesOverrideRow[]);
  const out: (ReturnType<typeof instanceFrom> & { hidden: HiddenReason })[] = [];
  // Hidden on its own or with its series, else by its calendar's filter (which needs the resolved category).
  const push = (row: EventRow, cal: CalendarRow, inst: ReturnType<typeof instanceFrom>) => {
    const keys = hideKeys(row, cal, inst.start);
    const hidden: HiddenReason = keys.series && hiddenSet.has(hiddenKey(cal.id, 'series', keys.series)) ? 'series'
      : hiddenSet.has(hiddenKey(cal.id, 'occurrence', keys.occurrence)) ? 'event'
      : filterShows(filters.get(cal.id)!, inst) ? null : 'filter';
    if (hidden && !opts.includeHidden) return;
    out.push({ ...inst, hidden });
  };

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
        push(row, cal, instanceFrom(row, cal, memberColors, inst.start, inst.start, inst.end, override, seriesOverride, categories, categoryOverride, categorySeriesOverride, defaultReminderMinutes));
      }
      continue;
    }

    // Non-recurring local event, or an already-expanded remote instance: filter by overlap.
    const startMs = row.all_day ? Date.parse(`${row.start}T00:00:00Z`) : Date.parse(row.start);
    const endMs = row.all_day ? Date.parse(`${row.end}T00:00:00Z`) : Date.parse(row.end);
    if (Number.isNaN(startMs) || Number.isNaN(endMs)) continue; // a stored row whose times aren't dates is left out, not a failed read
    if (endMs <= fromDate.getTime() || startMs >= toDate.getTime()) continue;
    push(row, cal, instanceFrom(row, cal, memberColors, null, row.start, row.end, override, seriesOverride, categories, categoryOverride, categorySeriesOverride, defaultReminderMinutes));
  }

  // A meal's event counts down to starting prep instead (prepBy.ts), for its cook.
  const meals = parseMealLinks(mealsRes.results);
  const withCounts = out.map((ev) => {
    const meal = ev.allDay ? undefined : meals.get(ev.id);
    return { ...ev, linkedItemCount: linkedCounts.get(ev.id) ?? 0, noteCount: noteCounts.get(ev.id) ?? 0, prepAt: meal ? prepAt(ev.start, meal.eventStart, meal.minutes) : null, cookId: meal?.cookId ?? null };
  });
  withCounts.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return withCounts;
}

/** notify.ts reads event rows itself (reminders, transitions, Live Activities, the daily summary):
 * the (event id, start) keys of the instances in [from, to) the family doesn't see, to skip. */
export async function hiddenInstanceKeys(db: KinwallDb, fromDate: Date, toDate: Date, rows: EventRow[]): Promise<Set<string>> {
  return new Set((await eventInstances(db, fromDate, toDate, undefined, { includeHidden: true, rows })).filter((ev) => ev.hidden).map((ev) => instanceKey(ev.id, ev.start)));
}
export const instanceKey = (id: string, start: string) => `${id}\u0000${start}`;

// The widest range one GET /api/events reads: a year at a glance with room to spare (the app asks
// for six weeks, three months at most). Every repeat is expanded across it, so it has to end somewhere.
const MAX_RANGE_DAYS = 400;

eventsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/events',
    tags: ['Events'],
    summary: 'List events in a range, merging local (expanded) and synced remote instances',
    security: [{ Bearer: [] }],
    request: {
      query: z.object({
        from: z.string().openapi({ description: `ISO date or date-time, inclusive. With \`to\`, at most ${MAX_RANGE_DAYS} days` }),
        to: z.string().openapi({ description: 'ISO date or date-time, exclusive' }),
        memberId: z.string().optional(),
        calendarId: z.string().optional(),
        includeHidden: z.enum(['true', 'false']).optional().openapi({ description: "Parents' devices only: also the events the family doesn't see, each with `hidden` saying why" }),
      }),
    },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.array(EventInstanceSchema) } } },
      400: { description: `from or to isn't a date, or they are more than ${MAX_RANGE_DAYS} days apart`, content: { 'application/json': { schema: ErrorSchema } } },
      403: { description: "includeHidden from a wall screen or kid's device", content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { from, to, memberId, calendarId, includeHidden } = c.req.valid('query');
    const [fromDate, toDate] = [new Date(from), new Date(to)];
    if (Number.isNaN(fromDate.getTime()) || Number.isNaN(toDate.getTime())) return c.json({ error: 'from and to must be ISO dates or date-times' }, 400);
    if (toDate.getTime() - fromDate.getTime() > MAX_RANGE_DAYS * 86400000) return c.json({ error: `from and to can be at most ${MAX_RANGE_DAYS} days apart` }, 400);
    if (includeHidden === 'true' && (await requestKey(c))?.scope !== 'admin') return c.json({ error: "Only parents' devices can see hidden events." }, 403);
    let filtered = await eventInstances(c.env.DB, fromDate, toDate, calendarId, { includeHidden: includeHidden === 'true' });
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
      403: { description: "this device may not change events on that calendar", content: { 'application/json': { schema: ErrorSchema } } },
      502: { description: 'provider write failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const created = await createEvent(c, c.req.valid('json'));
    if ('error' in created) return c.json({ error: created.error }, created.status);
    const { row, cal } = created;
    const { memberColors, categories, defaultReminderMinutes } = await colorsAndCategories(c.env.DB);
    const { seriesOverride, categorySeriesOverride } = await remoteOverrides(c.env.DB, cal, null, row.series_id);
    return c.json(instanceFrom(row, cal, memberColors, null, row.start, row.end, undefined, seriesOverride, categories, undefined, categorySeriesOverride, defaultReminderMinutes), 201);
  },
);

type Ctx = Context<{ Bindings: Env }>;
type Fail<S extends number> = { error: string; status: S };

/** Why these times and repeat can't be saved, or null: what's stored is read back by everyone, so
 * it has to be something every read can expand (recurrence.ts isEventTime, isValidRrule). */
function eventInputError(start: string, end: string, allDay: boolean, rrule: string | null | undefined, tz: string, keepStored = false): string | null {
  const want = allDay ? 'a date (YYYY-MM-DD) for an all-day event' : 'an ISO date-time with a UTC offset, like 2026-09-24T14:00:00Z';
  if (!isEventTime(start, allDay)) return `start must be ${want}`;
  if (!isEventTime(end, allDay)) return `end must be ${want}`;
  if (Date.parse(end) < Date.parse(start)) return 'end is before start';
  return rruleError(rrule, start, allDay, tz, keepStored);
}
/** `keepStored`: the rule is the event's own, unchanged (only its start moved), so one that was
 * already odd is left alone, but it still has to happen from the new start. */
function rruleError(rrule: string | null | undefined, start: string, allDay: boolean, tz: string, keepStored = false): string | null {
  if (!rrule) return null;
  if (!isValidRrule(rrule)) return keepStored ? null : 'invalid rrule: a repeat needs a FREQ of DAILY, WEEKLY, MONTHLY or YEARLY';
  return rruleOccurs(rrule, start, allDay, tz) ? null : 'That repeat never happens. Check the day and month.';
}

/** POST /api/events: write-through to the provider for a synced calendar, then the Kinwall row.
 * Meals create their calendar events through here too, so every calendar kind behaves the same. */
/** A synced calendar refused a write. A parent's device gets what the provider said (redacted), to
 * act on in Settings; a wall screen or kid's device gets a plain line, and the detail goes to the log. */
async function providerFail(c: Ctx, err: unknown): Promise<Fail<502>> {
  const said = errorMessage(err, 'provider write failed');
  if ((await requestKey(c))?.scope !== 'display') return { error: said, status: 502 };
  console.error('calendar write refused', said);
  return { error: "That couldn't be saved to the calendar. Ask a parent to check it under Settings → Calendars.", status: 502 };
}

export async function createEvent(c: Ctx, body: z.infer<typeof EventInputSchema>): Promise<Fail<400 | 403 | 502> | { row: EventRow; cal: CalendarRow }> {
  const calendarId = body.calendarId ?? (await defaultCalendarId(c.env.DB));
  if (!calendarId) return { error: 'No calendar takes new events. Add a Kinwall calendar in Settings → Calendars.', status: 400 };
  const cal = await c.env.DB.prepare('SELECT * FROM calendars WHERE id = ?').bind(calendarId).first<CalendarRow>();
  if (!cal) return { error: 'calendar not found', status: 400 };
  const block = await eventWriteBlock(c, [cal]);
  if (block) return { error: block, status: 403 };
  if (!cal.writable) return { error: 'calendar is not writable', status: 400 };
  const invalid = eventInputError(body.start, body.end, body.allDay, body.rrule, body.rrule ? await householdTz(c.env.DB) : 'UTC');
  if (invalid) return { error: invalid, status: 400 };

  let externalId: string | null = null;
  let title = body.title;
  let start = body.start;
  let end = body.end;
  let location = body.location ?? null;
  let description = body.description || null;
  let seriesId: string | null = null;
  let busy = body.busy ?? true;

  if (cal.kind !== 'local') {
    const provider = getProvider(cal.kind as 'ics' | 'google' | 'microsoft' | 'caldav');
    if (!provider.createEvent) return { error: `${cal.kind} calendars are read-only`, status: 400 };
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
        ...(body.busy !== undefined ? { busy: body.busy } : {}),
      });
      externalId = created.externalId;
      title = created.title;
      start = created.start;
      end = created.end;
      location = created.location ?? null;
      description = created.description || null;
      seriesId = created.seriesId ?? null;
      if (created.busy !== undefined) busy = created.busy;
    } catch (err) {
      return providerFail(c, err);
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
    busy: busy ? 1 : 0,
  };
  // Synced rows are wiped on resync, so their travel time goes to the override table (the row's
  // own columns stay empty, like sync writes them).
  const local = cal.kind === 'local';
  await c.env.DB.prepare(
    'INSERT INTO events (id, calendar_id, external_id, title, start, end, all_day, location, description, rrule, member_ids, updated_at, series_id, category_id, reminders, travel_minutes, remind_before_leave, busy) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
  )
    .bind(row.id, row.calendar_id, row.external_id, row.title, row.start, row.end, row.all_day, row.location, row.description, row.rrule, row.member_ids, row.updated_at, row.series_id, row.category_id, row.reminders, local ? row.travel_minutes : null, local ? row.remind_before_leave : 0, row.busy)
    .run();
  if (!local && externalId && (row.travel_minutes !== null || row.remind_before_leave)) await setTravelOverride(c.env.DB, cal.id, externalId, row.travel_minutes, !!row.remind_before_leave);
  // Like travel time, people on a synced event live in the override table - a full sync rewrites the row.
  if (!local && externalId && body.memberIds?.length) await setMemberOverride(c.env.DB, cal.id, externalId, body.memberIds);
  emit(c, 'events.changed', { calendarId: cal.id });
  return { row, cal };
}

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
  cal_display_edit: number;
  cal_filter: string | null;
};

// Event + its calendar in one round trip (join) instead of two sequential lookups.
async function loadEventAndCalendar(db: KinwallDb, id: string): Promise<{ row: EventRow; cal: CalendarRow } | null> {
  const joined = await db
    .prepare(
      `SELECT e.*, c.kind AS cal_kind, c.account_id AS cal_account_id, c.remote_id AS cal_remote_id, c.name AS cal_name,
              c.color AS cal_color, c.member_ids AS cal_member_ids, c.category_id AS cal_category_id, c.config AS cal_config, c.writable AS cal_writable, c.enabled AS cal_enabled, c.display_edit AS cal_display_edit, c.filter AS cal_filter
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
    display_edit: joined.cal_display_edit,
    filter: joined.cal_filter,
  };
  return { row: joined, cal };
}

/** Whether the family doesn't see this event at all: hidden on its own or with its series
 * (event_hidden), or left out by its calendar's filter - what eventInstances drops from every list.
 * One hidden occurrence of a repeating Kinwall event leaves the event itself (its other days) in view. */
async function hiddenFromFamily(db: KinwallDb, row: EventRow, cal: CalendarRow): Promise<boolean> {
  const keys = hideKeys(row, cal, row.start);
  const oneOfMany = cal.kind === 'local' && !!row.rrule;
  const hidden = await db
    .prepare("SELECT 1 FROM event_hidden WHERE calendar_id = ? AND ((scope = 'series' AND key = ?) OR (scope = 'occurrence' AND key = ?))")
    .bind(cal.id, keys.series, oneOfMany ? null : keys.occurrence)
    .first();
  if (hidden) return true;
  const filter = parseFilter(cal.filter);
  if (!filterActive(filter)) return false;
  const [{ memberColors, categories }, { categoryOverride, categorySeriesOverride }] = await Promise.all([colorsAndCategories(db), remoteOverrides(db, cal, row.external_id, row.series_id)]);
  return !filterShows(filter, instanceFrom(row, cal, memberColors, null, row.start, row.end, undefined, undefined, categories, categoryOverride, categorySeriesOverride));
}

/** An event by id, for the routes that read or change one: a hidden event isn't there for a wall
 * screen or kid's device (a display key), like in every list. Parents' devices reach it as before.
 * Also what the notes thread and linked tasks of an event ask (routes/notes.ts, routes/lists.ts). */
export async function hiddenFromDisplay(c: Ctx, id: string, found?: { row: EventRow; cal: CalendarRow } | null): Promise<boolean> {
  if ((await requestKey(c))?.scope !== 'display') return false;
  found ??= await loadEventAndCalendar(c.env.DB, id);
  return !!found && hiddenFromFamily(c.env.DB, found.row, found.cal);
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
    if (!found || (await hiddenFromDisplay(c, id, found))) return c.json({ error: 'not found' }, 404);
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
      403: { description: "this device may not change events on that calendar", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
      502: { description: 'provider write failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (await hiddenFromDisplay(c, c.req.valid('param').id)) return c.json({ error: 'not found' }, 404);
    const updated = await updateEvent(c, c.req.valid('param').id, c.req.valid('json'));
    if ('error' in updated) return c.json({ error: updated.error }, updated.status);
    const { row: updatedRow, cal } = updated;
    const { memberColors, categories, defaultReminderMinutes } = updated.lookups ?? await colorsAndCategories(c.env.DB);
    const { override, seriesOverride, categoryOverride, categorySeriesOverride, travel } = await remoteOverrides(c.env.DB, cal, updatedRow.external_id, updatedRow.series_id);
    return c.json(
      instanceFrom(withTravel(updatedRow, cal, travel), cal, memberColors, null, updatedRow.start, updatedRow.end, override, seriesOverride, categories, categoryOverride, categorySeriesOverride, defaultReminderMinutes),
      200,
    );
  },
);

/** PATCH /api/events/{id} (also how a meal keeps the event it created in step). */
export async function updateEvent(c: Ctx, id: string, body: z.infer<typeof EventPatchSchema>): Promise<Fail<400 | 403 | 404 | 502> | { row: EventRow; cal: CalendarRow; lookups?: Awaited<ReturnType<typeof colorsAndCategories>> }> {
  const found = await loadEventAndCalendar(c.env.DB, id);
  if (!found) return { error: 'not found', status: 404 };
  const { row, cal } = found;
  const block = await eventWriteBlock(c, [cal]);
  if (block) return { error: block, status: 403 };

  const otherFieldsPresent =
    body.title !== undefined ||
    body.start !== undefined ||
    body.end !== undefined ||
    body.allDay !== undefined ||
    body.location !== undefined ||
    body.description !== undefined ||
    body.rrule !== undefined ||
    // Reminders and free/busy live on the provider's event, so on a synced calendar changing them is a real write.
    body.reminders !== undefined ||
    body.busy !== undefined;
  // Member assignment and category assignment on a remote-kind event are local-only annotations
  // (event-member-overrides / event-category-overrides, keyed by external_id - the row is rewritten
  // from the provider on sync). A memberIds/categoryId-only patch never touches the provider, so it
  // works even on a read-only calendar (ICS) or when the calendar isn't writable. Travel time is
  // the same kind of Kinwall-only annotation (event_travel_overrides) and is never sent to the provider.
  const travelPresent = body.travelMinutes !== undefined || body.remindBeforeLeave !== undefined;
  const annotationOnlyPatch = cal.kind !== 'local' && !otherFieldsPresent && (body.memberIds !== undefined || body.categoryId !== undefined || travelPresent);

  if (!annotationOnlyPatch && !cal.writable) return { error: 'calendar is not writable', status: 400 };

  let title = body.title ?? row.title;
  let start = body.start ?? row.start;
  let end = body.end ?? row.end;
  // Only what this patch changes is checked, so an event that already holds something odd can still be retitled (or fixed).
  const timesChange = body.start !== undefined || body.end !== undefined || body.allDay !== undefined;
  const rule = body.rrule !== undefined ? body.rrule : cal.kind === 'local' ? row.rrule : null;
  const invalidTz = timesChange || body.rrule ? await householdTz(c.env.DB) : 'UTC';
  const invalid = timesChange ? eventInputError(start, end, body.allDay ?? !!row.all_day, rule, invalidTz, body.rrule === undefined) : rruleError(body.rrule, start, !!row.all_day, invalidTz);
  if (invalid) return { error: invalid, status: 400 };
  let location = body.location !== undefined ? body.location : row.location;
  let description = body.description !== undefined ? body.description || null : row.description;

  let remoteReminders: string | null | undefined;
  let busy = body.busy !== undefined ? (body.busy ? 1 : 0) : row.busy;
  if (cal.kind !== 'local' && otherFieldsPresent) {
    const provider = getProvider(cal.kind as 'ics' | 'google' | 'microsoft' | 'caldav');
    if (!provider.updateEvent || !row.external_id) return { error: `${cal.kind} calendars are read-only`, status: 400 };
    if (body.reminders !== undefined && cal.kind === 'caldav') return { error: 'reminders can only be changed on Google and Outlook calendars', status: 400 };
    const ctx = await buildCtx(c.env.DB, cal, c.env);
    try {
      const updated = await provider.updateEvent(ctx, row.external_id, {
        title,
        start,
        end,
        allDay: body.allDay ?? !!row.all_day,
        location: location ?? undefined,
        // Only when the notes changed: Kinwall keeps them as plain text, and writing that back on
        // every edit would flatten the provider's own formatting (Google/Outlook HTML).
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.reminders !== undefined ? { reminders: body.reminders } : {}),
        ...(body.busy !== undefined ? { busy: body.busy } : {}),
      });
      if (updated.busy !== undefined && body.busy !== undefined) busy = updated.busy ? 1 : 0;
      if (body.reminders !== undefined) remoteReminders = Array.isArray(updated.reminders) ? JSON.stringify(updated.reminders) : null;
      title = updated.title;
      start = updated.start;
      end = updated.end;
      location = updated.location ?? null;
      description = updated.description || null;
    } catch (err) {
      return providerFail(c, err);
    }
  }

  if (cal.kind !== 'local' && body.memberIds !== undefined) {
    const scope = body.scope ?? 'occurrence';
    if (scope === 'series') {
      if (!row.series_id) return { error: 'event has no series to tag', status: 400 };
      await setSeriesMemberOverride(c.env.DB, cal.id, row.series_id, body.memberIds);
      await clearOccurrenceOverridesForSeries(c.env.DB, cal.id, row.series_id);
    } else {
      if (!row.external_id) return { error: 'event has no external id', status: 400 };
      await setMemberOverride(c.env.DB, cal.id, row.external_id, body.memberIds);
    }
  }

  if (cal.kind !== 'local' && body.categoryId !== undefined) {
    const scope = body.scope ?? 'occurrence';
    if (scope === 'series') {
      if (!row.series_id) return { error: 'event has no series to tag', status: 400 };
      await setSeriesCategoryOverride(c.env.DB, cal.id, row.series_id, body.categoryId);
      await clearOccurrenceCategoryOverridesForSeries(c.env.DB, cal.id, row.series_id);
    } else {
      if (!row.external_id) return { error: 'event has no external id', status: 400 };
      await setCategoryOverride(c.env.DB, cal.id, row.external_id, body.categoryId);
    }
  }

  // Merge a partial travel patch over what's in effect now (override for synced, row for local).
  let travelMinutes = row.travel_minutes;
  let remindBeforeLeave = row.remind_before_leave;
  if (travelPresent) {
    if (cal.kind !== 'local' && !row.external_id) return { error: 'event has no external id', status: 400 };
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
    busy,
    updated_at: new Date().toISOString(),
  };
  let lookups: Awaited<ReturnType<typeof colorsAndCategories>> | undefined;
  if (otherFieldsPresent || (cal.kind === 'local' && (body.memberIds !== undefined || body.categoryId !== undefined || body.reminders !== undefined || travelPresent))) {
    // The response's member-colors/categories lookups ride along in the same batch - one round trip.
    const updateStmt = c.env.DB
      .prepare(
        'UPDATE events SET title = ?, start = ?, end = ?, all_day = ?, location = ?, description = ?, rrule = ?, member_ids = ?, category_id = ?, reminders = ?, travel_minutes = ?, remind_before_leave = ?, busy = ?, updated_at = ? WHERE id = ?',
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
        updatedRow.busy,
        updatedRow.updated_at,
        id,
      );
    const [, colorsRes, categoriesRes, settingsRes] = await c.env.DB.batch<unknown>([
      updateStmt,
      c.env.DB.prepare('SELECT id, color FROM members'),
      c.env.DB.prepare('SELECT * FROM categories ORDER BY sort, created_at'),
      c.env.DB.prepare("SELECT value FROM settings WHERE key = 'defaultReminderMinutes'"),
    ]);
    lookups = {
      memberColors: new Map((colorsRes.results as { id: string; color: string }[]).map((r) => [r.id, r.color])),
      categories: categoriesRes.results as unknown as CategoryRow[],
      defaultReminderMinutes: parseDefaultReminderMinutes((settingsRes.results[0] as { value: string } | undefined)?.value),
    };
  }
  emit(c, 'events.changed', { calendarId: cal.id });
  return { row: updatedRow, cal, lookups };
}

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
      403: { description: "this device may not change events on that calendar", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
      502: { description: 'provider write failed', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (await hiddenFromDisplay(c, c.req.valid('param').id)) return c.json({ error: 'not found' }, 404);
    const deleted = await deleteEvent(c, c.req.valid('param').id);
    return 'error' in deleted ? c.json({ error: deleted.error }, deleted.status) : c.json({ ok: true }, 200);
  },
);

/** DELETE /api/events/{id} (also how deleting a meal removes the event it created). */
export async function deleteEvent(c: Ctx, id: string): Promise<Fail<400 | 403 | 404 | 502> | { ok: true }> {
  const found = await loadEventAndCalendar(c.env.DB, id);
  if (!found) return { error: 'not found', status: 404 };
  const { row, cal } = found;
  const block = await eventWriteBlock(c, [cal]);
  if (block) return { error: block, status: 403 };

  if (cal.kind !== 'local') {
    const provider = getProvider(cal.kind as 'ics' | 'google' | 'microsoft' | 'caldav');
    if (!provider.deleteEvent || !row.external_id) return { error: `${cal.kind} calendars are read-only`, status: 400 };
    const ctx = await buildCtx(c.env.DB, cal, c.env);
    try {
      await provider.deleteEvent(ctx, row.external_id);
    } catch (err) {
      return providerFail(c, err);
    }
  }

  // Its notes thread goes with it (a synced event that merely drops out of the feed keeps its
  // notes - they come back if the event does).
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM events WHERE id = ?').bind(id),
    c.env.DB.prepare("DELETE FROM notes WHERE target_type = 'event' AND target_id = ?").bind(id),
    c.env.DB.prepare('UPDATE meals SET calendar_event_id = NULL, calendar_event_start = NULL, updated_at = ? WHERE calendar_event_id = ?').bind(new Date().toISOString(), id),
    // A deleted Kinwall event's hides go too (a synced one's stay, in case it comes back).
    c.env.DB.prepare('DELETE FROM event_hidden WHERE calendar_id = ? AND (key = ? OR substr(key, 1, ?) = ?)').bind(cal.id, cal.kind === 'local' ? id : '', id.length + 1, cal.kind === 'local' ? `${id}@` : ''),
  ]);
  emit(c, 'events.changed', { calendarId: cal.id });
  return { ok: true };
}

// Hiding an event (docs/using/calendar.md "Hiding events"): parents' devices only (not in auth.ts's
// display allow-list), on any calendar, read-only ones too - it's Kinwall-only, like member tags.
const HideSchema = z
  .object({
    scope: z.enum(['occurrence', 'series']).openapi({ description: "'occurrence': just this one; 'series': every one in its series (a recurring event)" }),
    occurrenceStart: z.string().optional().openapi({ description: "Which one, for one occurrence of a recurring Kinwall event: its `occurrenceStart`" }),
  })
  .openapi('EventHide');
const HiddenEventSchema = z
  .object({
    id: z.string(),
    calendarId: z.string(),
    scope: z.enum(['occurrence', 'series']),
    title: z.string(),
    start: z.string().openapi({ description: 'When the hidden one starts (the first one hidden, for a series)' }),
    allDay: z.boolean(),
    createdAt: z.string(),
  })
  .openapi('HiddenEvent');

/** The event_hidden key for hiding (or showing) this event at `scope`, or an error. */
async function hideTarget(db: KinwallDb, id: string, body: z.infer<typeof HideSchema>): Promise<Fail<400 | 404> | { row: EventRow; cal: CalendarRow; key: string; start: string }> {
  const found = await loadEventAndCalendar(db, id);
  if (!found) return { error: 'not found', status: 404 };
  const { row, cal } = found;
  if (cal.kind === 'local' && row.rrule && body.scope === 'occurrence' && !body.occurrenceStart) return { error: 'occurrenceStart is needed for one occurrence of a recurring event', status: 400 };
  const start = body.occurrenceStart ?? row.start;
  const keys = hideKeys(row, cal, start);
  const key = body.scope === 'series' ? keys.series : keys.occurrence;
  if (!key) return { error: 'this event is not part of a series', status: 400 };
  return { row, cal, key, start };
}

eventsRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/events/{id}/hidden',
    tags: ['Events'],
    summary: "Hide an event, or every one in its series, everywhere the family sees events (parents' devices; survives resyncs)",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: HideSchema } } } },
    responses: {
      200: { description: 'hidden', content: { 'application/json': { schema: HiddenEventSchema } } },
      400: { description: 'invalid', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const db = c.env.DB;
    const body = c.req.valid('json');
    const t = await hideTarget(db, c.req.valid('param').id, body);
    if ('error' in t) return c.json({ error: t.error }, t.status);
    const hid = { id: crypto.randomUUID(), calendarId: t.cal.id, scope: body.scope, title: t.row.title, start: t.start, allDay: !!t.row.all_day, createdAt: new Date().toISOString() };
    const writes = [
      db.prepare('INSERT INTO event_hidden (id, calendar_id, scope, key, title, start, all_day, created_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(calendar_id, scope, key) DO NOTHING')
        .bind(hid.id, hid.calendarId, hid.scope, t.key, hid.title, hid.start, hid.allDay ? 1 : 0, hid.createdAt),
    ];
    // The whole series covers its occurrences: hiding one on its own too would keep it hidden after "Show again" on the series.
    if (body.scope === 'series') {
      writes.push(t.cal.kind === 'local'
        ? db.prepare("DELETE FROM event_hidden WHERE calendar_id = ? AND scope = 'occurrence' AND substr(key, 1, ?) = ?").bind(t.cal.id, t.row.id.length + 1, `${t.row.id}@`)
        : db.prepare("DELETE FROM event_hidden WHERE calendar_id = ? AND scope = 'occurrence' AND key IN (SELECT external_id FROM events WHERE calendar_id = ? AND series_id = ?)").bind(t.cal.id, t.cal.id, t.key));
    }
    await db.batch(writes);
    const stored = await db.prepare('SELECT id, created_at FROM event_hidden WHERE calendar_id = ? AND scope = ? AND key = ?').bind(t.cal.id, body.scope, t.key).first<{ id: string; created_at: string }>();
    emit(c, 'events.changed', { calendarId: t.cal.id });
    return c.json({ ...hid, id: stored?.id ?? hid.id, createdAt: stored?.created_at ?? hid.createdAt }, 200);
  },
);

eventsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/events/{id}/hidden',
    tags: ['Events'],
    summary: "Show a hidden event again: just this one, or its series (parents' devices)",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), query: HideSchema },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      400: { description: 'invalid', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('query');
    const t = await hideTarget(c.env.DB, c.req.valid('param').id, body);
    if ('error' in t) return c.json({ error: t.error }, t.status);
    await c.env.DB.prepare('DELETE FROM event_hidden WHERE calendar_id = ? AND scope = ? AND key = ?').bind(t.cal.id, body.scope, t.key).run();
    emit(c, 'events.changed', { calendarId: t.cal.id });
    return c.json({ ok: true }, 200);
  },
);

eventsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/calendars/{id}/hidden',
    tags: ['Events'],
    summary: "A calendar's hidden events, soonest first (parents' devices)",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(HiddenEventSchema) } } } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT id, calendar_id, scope, title, start, all_day, created_at FROM event_hidden WHERE calendar_id = ? ORDER BY start, title')
      .bind(c.req.valid('param').id)
      .all<{ id: string; calendar_id: string; scope: 'occurrence' | 'series'; title: string; start: string; all_day: number; created_at: string }>();
    return c.json(results.map((r) => ({ id: r.id, calendarId: r.calendar_id, scope: r.scope, title: r.title, start: r.start, allDay: !!r.all_day, createdAt: r.created_at })), 200);
  },
);

eventsRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/calendars/{id}/hidden/{hiddenId}',
    tags: ['Events'],
    summary: "Show a hidden event (or series) again, from the calendar's Hidden events list (parents' devices)",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string(), hiddenId: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id, hiddenId } = c.req.valid('param');
    const res = await c.env.DB.prepare('DELETE FROM event_hidden WHERE id = ? AND calendar_id = ?').bind(hiddenId, id).run();
    if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
    emit(c, 'events.changed', { calendarId: id });
    return c.json({ ok: true }, 200);
  },
);

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const EventSyncInputSchema = z
  .object({
    source: z.string().min(1).max(100).openapi({ description: "Who owns these events, e.g. 'ha:hellofresh'. A sync only ever changes events from its own source." }),
    from: DATE.optional().openapi({ description: 'With `to`: only events of this source starting in [from, to] are deleted when missing, so past ones stay.' }),
    to: DATE.optional(),
    events: z
      .array(
        z.object({
          externalId: z.string().min(1).max(200),
          title: z.string().min(1),
          start: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be a date or date-time'),
          end: z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'must be a date or date-time'),
          allDay: z.boolean(),
          notes: z.string().nullable().optional(),
          location: z.string().nullable().optional(),
          busy: z.boolean().optional().openapi({ description: "Show as: false = free (a delivery window, a reminder that doesn't block time). Default true" }),
        }),
      )
      .max(500),
  })
  .openapi('EventSyncInput');

eventsRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/calendars/{id}/events/sync',
    tags: ['Events'],
    summary: "Replace one source's events on a local calendar (upsert by externalId, delete the missing ones)",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: EventSyncInputSchema } } } },
    responses: {
      200: { description: 'synced', content: { 'application/json': { schema: z.object({ created: z.number(), updated: z.number(), deleted: z.number() }) } } },
      400: { description: 'invalid, or not a local calendar', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'calendar not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const db = c.env.DB;
    const calId = c.req.valid('param').id;
    const { source, from, to, events } = c.req.valid('json');
    const cal = await db.prepare('SELECT kind FROM calendars WHERE id = ?').bind(calId).first<{ kind: string }>();
    if (!cal) return c.json({ error: 'not found' }, 404);
    if (cal.kind !== 'local') return c.json({ error: 'only local calendars take synced events' }, 400);

    const { results: existing } = await db
      .prepare('SELECT id, external_id, title, start, end, all_day, location, description, busy FROM events WHERE calendar_id = ? AND sync_source = ?')
      .bind(calId, source)
      .all<Pick<EventRow, 'id' | 'external_id' | 'title' | 'start' | 'end' | 'all_day' | 'location' | 'description' | 'busy'>>();
    const byExternalId = new Map(existing.map((r) => [r.external_id, r]));
    const now = new Date().toISOString();
    const writes: ReturnType<KinwallDb['prepare']>[] = [];
    const seen = new Set<string>();
    let created = 0;
    let updated = 0;
    for (const e of events) {
      seen.add(e.externalId);
      // Stored like every other event: timed in UTC ISO, all-day as YYYY-MM-DD (exclusive end).
      const norm = (s: string) => (e.allDay ? s.slice(0, 10) : new Date(s).toISOString());
      const next = { title: e.title, start: norm(e.start), end: norm(e.end), all_day: e.allDay ? 1 : 0, location: e.location ?? null, description: e.notes ?? null, busy: e.busy === false ? 0 : 1 };
      const old = byExternalId.get(e.externalId);
      if (!old) {
        created++;
        writes.push(
          db
            .prepare('INSERT INTO events (id, calendar_id, external_id, sync_source, title, start, end, all_day, location, description, busy, member_ids, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
            .bind(crypto.randomUUID(), calId, e.externalId, source, next.title, next.start, next.end, next.all_day, next.location, next.description, next.busy, '[]', now),
        );
      } else if ((Object.keys(next) as (keyof typeof next)[]).some((k) => old[k] !== next[k])) {
        updated++;
        writes.push(
          db
            .prepare('UPDATE events SET title = ?, start = ?, end = ?, all_day = ?, location = ?, description = ?, busy = ?, updated_at = ? WHERE id = ?')
            .bind(next.title, next.start, next.end, next.all_day, next.location, next.description, next.busy, now, old.id),
        );
      }
    }
    // Missing ones go, but only inside the window when one is given (by start date).
    const gone = existing.filter((r) => !seen.has(r.external_id!) && (!from || r.start.slice(0, 10) >= from) && (!to || r.start.slice(0, 10) <= to));
    for (const r of gone) {
      writes.push(
        db.prepare('DELETE FROM events WHERE id = ?').bind(r.id),
        db.prepare("DELETE FROM notes WHERE target_type = 'event' AND target_id = ?").bind(r.id),
      );
    }
    if (writes.length) {
      await db.batch(writes);
      emit(c, 'events.changed', { calendarId: calId });
    }
    return c.json({ created, updated, deleted: gone.length }, 200);
  },
);
