import type { Env, WaitCtx } from './env.ts';
import { syncIntervalMinutes, hostTimezone } from './env.ts';
import { publish } from './bus.ts';
import { getProvider, type ProviderKind } from './providers/index.ts';
import type { ProviderCtx, NormalizedEvent } from './providers/types.ts';
import { parseIcsEvents, fetchIcsConditional, icsFingerprint } from './providers/ics.ts';
import { decryptConfig, encryptConfig } from './crypto.ts';
import { providerEnv } from './providers/config.ts';
import { redact } from './redact.ts';
import { deterministicEventIds } from './event-id.ts';

const SYNC_WINDOW_PAST_DAYS = 30;
const SYNC_WINDOW_FUTURE_DAYS = 365;

// Chunked sync (Workers free tier, 10ms CPU/request): google/microsoft/caldav calendars are
// synced in ~31-day slices instead of the whole 395-day window at once. The near slice
// (now-1d..now+31d) refreshes on every syncDue tick; far slices (the rest of the window,
// chunked the same way) rotate through a per-calendar cursor and refresh at most every 6h.
// ponytail: fixed slice size / refresh cadence rather than a CPU-time-aware scheduler -
// revisit if a household's calendar count makes even one slice/tick too slow.
const SLICE_DAYS = 31;
const NEAR_PAST_DAYS = 1;
const FAR_REFRESH_MS = 6 * 60 * 60 * 1000;
const SYNC_TICK_DEADLINE_MS = 20_000;

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
  last_synced_at: string | null;
  last_error: string | null;
  sync_cursor: string | null;
  etag: string | null;
  last_modified: string | null;
  content_hash: string | null;
};

type AccountRow = { id: string; kind: string; name: string; config: string; created_at: string };

async function householdTz(db: D1Database): Promise<string> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>();
  return row?.value ?? hostTimezone();
}

async function buildProviderCtx(env: Env, cal: CalendarRow): Promise<ProviderCtx> {
  let account: AccountRow | null = null;
  if (cal.account_id) {
    account = await env.DB.prepare('SELECT * FROM accounts WHERE id = ?').bind(cal.account_id).first<AccountRow>();
  }
  const tz = await householdTz(env.DB);
  const penv = await providerEnv(env, env.DB);
  return {
    env: { ...penv, TIMEZONE: tz },
    account: account ? { id: account.id, config: await decryptConfig(env, account.id, account.config) } : undefined,
    calendar: { id: cal.id, remoteId: cal.remote_id, config: await decryptConfig(env, cal.id, cal.config) },
    saveAccountConfig: async (config: unknown) => {
      if (!account) return;
      const encrypted = await encryptConfig(env, account.id, config);
      await env.DB.prepare('UPDATE accounts SET config = ? WHERE id = ?').bind(encrypted, account.id).run();
    },
  };
}

function insertEventStmt(env: Env, calendarId: string, ev: NormalizedEvent, now: Date, id: string) {
  return env.DB.prepare(
    'INSERT INTO events (id, calendar_id, external_id, title, start, end, all_day, location, description, rrule, member_ids, updated_at, series_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
  ).bind(
    id,
    calendarId,
    ev.externalId,
    ev.title,
    ev.start,
    ev.end,
    ev.allDay ? 1 : 0,
    ev.location ?? null,
    ev.description ?? null,
    null,
    '[]',
    now.toISOString(),
    ev.seriesId ?? null,
  );
}

// Full sync: replaces every event of the calendar in one batch. Used for the user-triggered
// POST /api/calendars/:id/sync (full CPU cost is acceptable there - it's a one-off request,
// not a cron tick) and directly by tests.
export async function syncCalendar(env: Env, calendarId: string, execCtx?: WaitCtx): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  const cal = await env.DB.prepare('SELECT * FROM calendars WHERE id = ?').bind(calendarId).first<CalendarRow>();
  if (!cal) return { ok: false, error: 'calendar not found' };
  if (cal.kind === 'local') return { ok: false, error: 'local calendars are not synced' };

  const provider = getProvider(cal.kind as ProviderKind);
  const ctx = await buildProviderCtx(env, cal);

  const now = new Date();
  const from = new Date(now.getTime() - SYNC_WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + SYNC_WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000);

  try {
    const events = await provider.listEvents(ctx, from, to);
    const ids = await deterministicEventIds(cal.id, events.map((ev) => ev.externalId));

    const stmts = [
      env.DB.prepare('DELETE FROM events WHERE calendar_id = ?').bind(cal.id),
      ...events.map((ev, i) => insertEventStmt(env, cal.id, ev, now, ids[i])),
      env.DB.prepare('UPDATE calendars SET last_synced_at = ?, last_error = NULL WHERE id = ?').bind(now.toISOString(), cal.id),
    ];
    await env.DB.batch(stmts);

    publish(env, execCtx, 'calendar.synced', { calendarId: cal.id, count: events.length });
    publish(env, execCtx, 'events.changed', { calendarId: cal.id });
    return { ok: true, count: events.length };
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err));
    await env.DB.prepare('UPDATE calendars SET last_synced_at = ?, last_error = ? WHERE id = ?').bind(now.toISOString(), message, cal.id).run();
    publish(env, execCtx, 'calendar.synced', { calendarId: cal.id, error: message });
    return { ok: false, error: message };
  }
}

type SyncCursor = { farIndex: number; farSyncedAt: string | null };

function loadCursor(raw: string | null): SyncCursor {
  if (!raw) return { farIndex: 0, farSyncedAt: null };
  try {
    const parsed = JSON.parse(raw);
    return { farIndex: Number(parsed.farIndex) || 0, farSyncedAt: typeof parsed.farSyncedAt === 'string' ? parsed.farSyncedAt : null };
  } catch {
    return { farIndex: 0, farSyncedAt: null };
  }
}

function farSliceCount(): number {
  return Math.ceil((SYNC_WINDOW_FUTURE_DAYS - SLICE_DAYS) / SLICE_DAYS);
}

function farSliceBounds(now: Date, index: number): { from: Date; to: Date } {
  const dayMs = 24 * 60 * 60 * 1000;
  const farStart = now.getTime() + SLICE_DAYS * dayMs;
  const farEnd = now.getTime() + SYNC_WINDOW_FUTURE_DAYS * dayMs;
  const sliceStart = Math.min(farStart + index * SLICE_DAYS * dayMs, farEnd);
  const sliceEnd = Math.min(sliceStart + SLICE_DAYS * dayMs, farEnd);
  return { from: new Date(sliceStart), to: new Date(sliceEnd) };
}

// Replaces only the events of `cal` that start within [from, to) - not the whole calendar -
// so a slice sync can't clobber events synced by a different slice.
// ponytail: bounds are compared as strings against the ISO `start` column (works for both the
// UTC-ISO timed format and the YYYY-MM-DD all-day format, since both are lexically ordered the
// same as chronologically - but an all-day event can fall a day outside its "true" slice at
// the boundary). Acceptable slop given slices overlap by design; tighten with a numeric epoch
// column if an event ever gets dropped between slices.
async function replaceSlice(env: Env, provider: ReturnType<typeof getProvider>, cal: CalendarRow, ctx: ProviderCtx, from: Date, to: Date): Promise<number> {
  const events = await provider.listEvents(ctx, from, to);
  const ids = await deterministicEventIds(cal.id, events.map((ev) => ev.externalId));
  const stmts = [
    env.DB.prepare('DELETE FROM events WHERE calendar_id = ? AND start >= ? AND start < ?').bind(cal.id, from.toISOString(), to.toISOString()),
    ...events.map((ev, i) => insertEventStmt(env, cal.id, ev, new Date(), ids[i])),
  ];
  await env.DB.batch(stmts);
  return events.length;
}

async function syncRemoteTick(env: Env, cal: CalendarRow, now: Date, execCtx: WaitCtx | undefined): Promise<{ ok: true }> {
  const provider = getProvider(cal.kind as ProviderKind);
  const ctx = await buildProviderCtx(env, cal);

  const nearFrom = new Date(now.getTime() - NEAR_PAST_DAYS * 24 * 60 * 60 * 1000);
  const nearTo = new Date(now.getTime() + SLICE_DAYS * 24 * 60 * 60 * 1000);
  let count = await replaceSlice(env, provider, cal, ctx, nearFrom, nearTo);

  const cursor = loadCursor(cal.sync_cursor);
  const dueForFar = !cursor.farSyncedAt || Date.now() - new Date(cursor.farSyncedAt).getTime() > FAR_REFRESH_MS;
  let nextCursor = cursor;
  if (dueForFar) {
    const totalSlices = Math.max(farSliceCount(), 1);
    const index = cursor.farIndex % totalSlices;
    const bounds = farSliceBounds(now, index);
    count += await replaceSlice(env, provider, cal, ctx, bounds.from, bounds.to);
    nextCursor = { farIndex: (index + 1) % totalSlices, farSyncedAt: now.toISOString() };
  }

  await env.DB.prepare('UPDATE calendars SET last_synced_at = ?, last_error = NULL, sync_cursor = ? WHERE id = ?')
    .bind(now.toISOString(), JSON.stringify(nextCursor), cal.id)
    .run();
  publish(env, execCtx, 'calendar.synced', { calendarId: cal.id, count });
  publish(env, execCtx, 'events.changed', { calendarId: cal.id });
  return { ok: true };
}

async function syncIcsTick(env: Env, cal: CalendarRow, now: Date, execCtx: WaitCtx | undefined): Promise<{ ok: true }> {
  const config = await decryptConfig(env, cal.id, cal.config);
  const url = config?.url;
  if (!url) throw new Error('ICS calendar is missing a url');

  const result = await fetchIcsConditional(url, cal.etag, cal.last_modified);
  if (result.notModified) {
    await env.DB.prepare('UPDATE calendars SET last_synced_at = ?, last_error = NULL WHERE id = ?').bind(now.toISOString(), cal.id).run();
    publish(env, execCtx, 'calendar.synced', { calendarId: cal.id, count: 0, notModified: true });
    return { ok: true };
  }

  // Belt-and-suspenders: some feeds ignore If-None-Match and hand back a fresh weak ETag every
  // request, so ETag alone can't tell us "unchanged". Fingerprint the body itself (DTSTAMP/UID
  // stripped, since those are exactly what such a feed rewrites) and skip the parse + DB
  // replace if it matches what we stored last time - still bump last_synced_at/etag so the
  // calendar shows as freshly checked.
  const fingerprint = await icsFingerprint(result.text);
  if (fingerprint === cal.content_hash) {
    await env.DB.prepare('UPDATE calendars SET last_synced_at = ?, last_error = NULL, etag = ?, last_modified = ? WHERE id = ?')
      .bind(now.toISOString(), result.etag, result.lastModified, cal.id)
      .run();
    publish(env, execCtx, 'calendar.synced', { calendarId: cal.id, count: 0, notModified: true });
    return { ok: true };
  }

  const tz = await householdTz(env.DB);
  const from = new Date(now.getTime() - SYNC_WINDOW_PAST_DAYS * 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + SYNC_WINDOW_FUTURE_DAYS * 24 * 60 * 60 * 1000);
  const events = await parseIcsEvents(result.text, from, to, tz);
  const ids = await deterministicEventIds(cal.id, events.map((ev) => ev.externalId));

  const stmts = [
    env.DB.prepare('DELETE FROM events WHERE calendar_id = ?').bind(cal.id),
    ...events.map((ev, i) => insertEventStmt(env, cal.id, ev, now, ids[i])),
    env.DB.prepare('UPDATE calendars SET last_synced_at = ?, last_error = NULL, etag = ?, last_modified = ?, content_hash = ? WHERE id = ?').bind(
      now.toISOString(),
      result.etag,
      result.lastModified,
      fingerprint,
      cal.id,
    ),
  ];
  await env.DB.batch(stmts);
  publish(env, execCtx, 'calendar.synced', { calendarId: cal.id, count: events.length });
  publish(env, execCtx, 'events.changed', { calendarId: cal.id });
  return { ok: true };
}

// One chunked sync tick for a single calendar - the unit of work syncDue schedules per
// calendar, as opposed to syncCalendar's full-window replace.
export async function syncCalendarTick(env: Env, calendarId: string, execCtx?: WaitCtx): Promise<{ ok: true } | { ok: false; error: string }> {
  const cal = await env.DB.prepare('SELECT * FROM calendars WHERE id = ?').bind(calendarId).first<CalendarRow>();
  if (!cal || cal.kind === 'local') return { ok: false, error: 'not syncable' };
  const now = new Date();
  try {
    return cal.kind === 'ics' ? await syncIcsTick(env, cal, now, execCtx) : await syncRemoteTick(env, cal, now, execCtx);
  } catch (err) {
    const message = redact(err instanceof Error ? err.message : String(err));
    await env.DB.prepare('UPDATE calendars SET last_synced_at = ?, last_error = ? WHERE id = ?').bind(now.toISOString(), message, cal.id).run();
    publish(env, execCtx, 'calendar.synced', { calendarId: cal.id, error: message });
    return { ok: false, error: message };
  }
}

// Syncs enabled non-local calendars whose last_synced_at is stalest first, one chunked tick
// each, stopping after ~20s wall time (Workers cron budget). Called by the cron on Workers and
// setInterval on Node.
export async function syncDue(env: Env, execCtx?: WaitCtx): Promise<void> {
  const intervalMs = syncIntervalMinutes(env) * 60 * 1000;
  const cutoff = new Date(Date.now() - intervalMs).toISOString();

  const { results } = await env.DB.prepare(
    `SELECT id FROM calendars WHERE kind != 'local' AND enabled = 1 AND (last_synced_at IS NULL OR last_synced_at < ?) ORDER BY last_synced_at IS NOT NULL, last_synced_at ASC`,
  )
    .bind(cutoff)
    .all<{ id: string }>();

  const deadline = Date.now() + SYNC_TICK_DEADLINE_MS;
  for (const row of results) {
    if (Date.now() > deadline) break;
    await syncCalendarTick(env, row.id, execCtx);
  }
}
