// Push notification scheduling: event reminders, daily summary, chore nudge, list updates.
// Called from the Workers cron (every 5 min, worker.ts) and the Node setInterval loop (node.ts,
// every ~2 min) - both call runNotifications(env, now) directly, no HTTP round trip.
import type { Env, WaitCtx } from './env.ts';
import { waitUntil } from './env.ts';
import { hostTimezone } from './env.ts';
import { expand, zonedTimeToUtc } from './recurrence.ts';
import { dueOnDate, type ChoreRow } from './routes/chores.ts';
import { parseMemberIds } from './calendar-members.ts';
import { sendWebPush } from './webpush.ts';

export const DEFAULT_PUSH_PREFS = {
  eventReminders: true,
  dailySummary: false,
  summaryTime: '07:30',
  choreNudge: false,
  choreNudgeTime: '08:00',
  listUpdates: false,
};

const LOOKBACK_MS = 10 * 60 * 1000; // a missed tick still fires once
// ponytail: fixed 2-day search window for occurrence starts, covers every reminder offset the UI
// offers (up to 1 day before) with slack for all-day/timezone edge cases. Revisit if a longer
// reminder offset is ever added.
const SEARCH_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

type PushSubRow = {
  id: string;
  api_key_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  device_name: string;
  member_ids: string;
  prefs: string;
  created_at: string;
  last_success_at: string | null;
};

function subPrefs(row: PushSubRow): typeof DEFAULT_PUSH_PREFS {
  try {
    return { ...DEFAULT_PUSH_PREFS, ...JSON.parse(row.prefs || '{}') };
  } catch {
    return DEFAULT_PUSH_PREFS;
  }
}

// A device with no member_ids follows everyone. An event/target with no member_ids applies to
// everyone. Otherwise: does the device follow at least one of the target's members?
export function memberMatch(deviceMemberIds: string[], targetMemberIds: string[] | undefined | null): boolean {
  if (!targetMemberIds || targetMemberIds.length === 0) return true;
  if (deviceMemberIds.length === 0) return true;
  return deviceMemberIds.some((id) => targetMemberIds.includes(id));
}

async function alreadySent(db: D1Database, key: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM sent_notifications WHERE key = ?').bind(key).first();
  return !!row;
}

async function markSent(db: D1Database, key: string, now: Date): Promise<void> {
  await db
    .prepare("INSERT INTO sent_notifications (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET sent_at = excluded.sent_at")
    .bind(key, now.toISOString())
    .run();
}

async function pruneSentNotifications(db: D1Database, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  await db.prepare('DELETE FROM sent_notifications WHERE sent_at < ?').bind(cutoff).run();
}

type EventRow = {
  id: string;
  calendar_id: string;
  title: string;
  start: string;
  end: string;
  all_day: number;
  rrule: string | null;
  member_ids: string;
  category_id: string | null;
  reminders: string | null;
};

type CalRow = { id: string; kind: string; member_ids: string; enabled: number };

function fireTime(startIso: string, allDay: boolean, minutes: number, tz: string): number {
  if (!allDay) return Date.parse(startIso) - minutes * 60000;
  const [y, mo, d] = startIso.split('-').map(Number);
  return zonedTimeToUtc({ y, mo: mo - 1, d, h: 0, mi: 0, s: 0 }, tz).getTime() - minutes * 60000;
}

function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

async function sendToSub(env: Env, db: D1Database, row: PushSubRow, payload: { title: string; body: string; url?: string; tag?: string }): Promise<void> {
  const result = await sendWebPush(env, db, row, payload);
  if (result.ok) await db.prepare('UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?').bind(new Date().toISOString(), row.id).run();
  else if (result.gone) await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(row.id).run();
}

async function runEventReminders(env: Env, db: D1Database, now: Date, tz: string, defaultReminders: number[], subs: PushSubRow[]): Promise<void> {
  const eligible = subs.filter((s) => subPrefs(s).eventReminders);
  if (eligible.length === 0) return;

  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + SEARCH_WINDOW_MS);

  const [calsRes, eventsRes, categoriesRes] = await db.batch<unknown>([
    db.prepare("SELECT id, kind, member_ids, enabled FROM calendars WHERE enabled = 1"),
    db.prepare('SELECT * FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE enabled = 1)'),
    db.prepare('SELECT id, emoji FROM categories'),
  ]);
  const cals = new Map((calsRes.results as unknown as CalRow[]).map((c) => [c.id, c]));
  const categoryEmojis = new Map((categoriesRes.results as unknown as { id: string; emoji: string | null }[]).map((c) => [c.id, c.emoji]));
  const events = eventsRes.results as unknown as EventRow[];

  type Candidate = { eventId: string; occurrenceKey: string; title: string; start: string; allDay: boolean; memberIds: string[]; categoryId: string | null; minutes: number };
  const candidates: Candidate[] = [];

  for (const row of events) {
    const cal = cals.get(row.calendar_id);
    if (!cal) continue;
    // ponytail: member resolution uses the row's own tags (local events) or the calendar's
    // member (everything else) - skips per-occurrence/series overrides on synced calendars.
    // Full reuse of routes/events.ts's override resolution would need plumbing its override-map
    // batches through here too; revisit if reminders need to respect per-occurrence tags.
    let memberIds = parseMemberIds(row.member_ids);
    if (memberIds.length === 0) memberIds = parseMemberIds(cal.member_ids);

    let reminders: number[] | null = null;
    if (row.reminders) {
      try {
        reminders = JSON.parse(row.reminders);
      } catch {
        reminders = null;
      }
    }
    const effective = reminders ?? defaultReminders; // [] = turned off on the event: stays silent
    if (!effective || effective.length === 0) continue;

    if (cal.kind === 'local' && row.rrule) {
      for (const inst of expand(row.rrule, row.start, row.end, !!row.all_day, tz, from, to)) {
        for (const minutes of effective) {
          candidates.push({ eventId: row.id, occurrenceKey: inst.start, title: row.title, start: inst.start, allDay: !!row.all_day, memberIds, categoryId: row.category_id, minutes });
        }
      }
      continue;
    }
    const startMs = row.all_day ? Date.parse(`${row.start}T00:00:00Z`) : Date.parse(row.start);
    if (startMs < from.getTime() || startMs >= to.getTime()) continue;
    for (const minutes of effective) {
      candidates.push({ eventId: row.id, occurrenceKey: row.start, title: row.title, start: row.start, allDay: !!row.all_day, memberIds, categoryId: row.category_id, minutes });
    }
  }

  const due = candidates.filter((cand) => {
    const t = fireTime(cand.start, cand.allDay, cand.minutes, tz);
    return t > now.getTime() - LOOKBACK_MS && t <= now.getTime();
  });
  if (due.length === 0) return;

  for (const sub of eligible) {
    const deviceMemberIds = parseMemberIds(sub.member_ids);
    for (const cand of due) {
      if (!memberMatch(deviceMemberIds, cand.memberIds)) continue;
      const key = `rem:${sub.id}:${cand.eventId}:${cand.occurrenceKey}:${cand.minutes}`;
      if (await alreadySent(db, key)) continue;
      const emoji = cand.categoryId ? categoryEmojis.get(cand.categoryId) : null;
      const when = cand.minutes === 0 ? 'Now' : cand.minutes % 60 === 0 ? `In ${cand.minutes / 60} hour${cand.minutes === 60 ? '' : 's'}` : `In ${cand.minutes} minutes`;
      const timeLabel = cand.allDay ? 'All day' : fmtTime(cand.start, tz);
      // Event name as the title: it's what you scan for, and iOS already adds "from Kinwall" under it.
      await sendToSub(env, db, sub, { title: `${emoji ? emoji + ' ' : ''}${cand.title}`, body: `${when} · ${timeLabel}`, url: '/', tag: `event:${cand.eventId}` });
      await markSent(db, key, now);
    }
  }
}

async function runDailySummary(env: Env, db: D1Database, now: Date, tz: string, subs: PushSubRow[]): Promise<void> {
  const eligible = subs.filter((s) => subPrefs(s).dailySummary);
  if (eligible.length === 0) return;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const nowHm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);

  for (const sub of eligible) {
    const prefs = subPrefs(sub);
    if (prefs.summaryTime !== nowHm) continue;
    const key = `sum:${sub.id}:${today}`;
    if (await alreadySent(db, key)) continue;

    const dayStart = new Date(`${today}T00:00:00Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const [eventsRes, choresRes] = await db.batch<unknown>([
      db.prepare("SELECT * FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE enabled = 1)"),
      db.prepare('SELECT * FROM chores WHERE active = 1'),
    ]);
    const events = eventsRes.results as unknown as EventRow[];
    const deviceMemberIds = parseMemberIds(sub.member_ids);
    const todaysTitles: string[] = [];
    let eventCount = 0;
    for (const row of events) {
      let memberIds = parseMemberIds(row.member_ids);
      const cal = await db.prepare('SELECT member_ids FROM calendars WHERE id = ?').bind(row.calendar_id).first<{ member_ids: string }>();
      if (memberIds.length === 0 && cal) memberIds = parseMemberIds(cal.member_ids);
      if (!memberMatch(deviceMemberIds, memberIds)) continue;
      if (row.rrule) {
        const insts = expand(row.rrule, row.start, row.end, !!row.all_day, tz, dayStart, dayEnd);
        if (insts.length > 0) {
          eventCount += insts.length;
          todaysTitles.push(row.title);
        }
        continue;
      }
      const startMs = row.all_day ? Date.parse(`${row.start}T00:00:00Z`) : Date.parse(row.start);
      const endMs = row.all_day ? Date.parse(`${row.end}T00:00:00Z`) : Date.parse(row.end);
      if (endMs > dayStart.getTime() && startMs < dayEnd.getTime()) {
        eventCount++;
        todaysTitles.push(row.title);
      }
    }
    const chores = (choresRes.results as unknown as ChoreRow[]).filter((row) => dueOnDate(row, today, tz));
    const first = todaysTitles.slice(0, 2).join(', ') + (todaysTitles.length > 2 ? '…' : '');
    const body = `${eventCount} event${eventCount === 1 ? '' : 's'} · ${chores.length} chore${chores.length === 1 ? '' : 's'}${first ? ` — ${first}` : ''}`;
    await sendToSub(env, db, sub, { title: 'Today', body, url: '/' });
    await markSent(db, key, now);
  }
}

async function runChoreNudge(env: Env, db: D1Database, now: Date, tz: string, subs: PushSubRow[]): Promise<void> {
  const eligible = subs.filter((s) => subPrefs(s).choreNudge);
  if (eligible.length === 0) return;
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const nowHm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);

  const [choresRes, completionsRes] = await db.batch<unknown>([
    db.prepare('SELECT * FROM chores WHERE active = 1'),
    db.prepare('SELECT chore_id FROM chore_completions WHERE date = ?').bind(today),
  ]);
  const chores = choresRes.results as unknown as ChoreRow[];
  const done = new Set((completionsRes.results as unknown as { chore_id: string }[]).map((r) => r.chore_id));
  const dueToday = chores.filter((c) => dueOnDate(c, today, tz) && !done.has(c.id));

  for (const sub of eligible) {
    const prefs = subPrefs(sub);
    if (prefs.choreNudgeTime !== nowHm) continue;
    const key = `nudge:${sub.id}:${today}`;
    if (await alreadySent(db, key)) continue;
    const deviceMemberIds = parseMemberIds(sub.member_ids);
    const mine = dueToday.filter((c) => memberMatch(deviceMemberIds, c.member_id ? [c.member_id] : []));
    if (mine.length === 0) continue;
    const titles = mine.slice(0, 3).map((c) => c.title).join(', ');
    await sendToSub(env, db, sub, { title: `${mine.length} chore${mine.length === 1 ? '' : 's'} left today`, body: titles, url: '/chores' });
    await markSent(db, key, now);
  }
}

// Called from routes/lists.ts right after a list item is created (not on the periodic tick - a
// new grocery item should notify promptly). Debounced to one notification per list per 10 min via
// sent_notifications' key granularity (a 10-min time bucket).
export function notifyListUpdate(env: Env, execCtx: WaitCtx | undefined, listId: string, listName: string): void {
  waitUntil(
    execCtx,
    (async () => {
      const now = new Date();
      const bucket = Math.floor(now.getTime() / (10 * 60 * 1000));
      const key = `list:${listId}:${bucket}`;
      if (await alreadySent(env.DB, key)) return;
      const { results } = await env.DB.prepare('SELECT * FROM push_subscriptions').all<PushSubRow>();
      const eligible = results.filter((s) => subPrefs(s).listUpdates);
      if (eligible.length === 0) return;
      await markSent(env.DB, key, now);
      for (const sub of eligible) {
        await sendToSub(env, env.DB, sub, { title: 'List updated', body: `${listName} has new items`, url: '/lists', tag: `list:${listId}` });
      }
    })(),
  );
}

// Entry point for the cron (Workers) and setInterval (Node) tickers.
export async function runNotifications(env: Env, now: Date, _execCtx?: WaitCtx): Promise<void> {
  const { results: subs } = await env.DB.prepare('SELECT * FROM push_subscriptions').all<PushSubRow>();
  if (subs.length === 0) return; // bail early - no subscriptions, nothing to do

  const [tzRow, defaultRemindersRow] = await Promise.all([
    env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>(),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'defaultReminderMinutes'").first<{ value: string }>(),
  ]);
  const tz = tzRow?.value ?? hostTimezone();
  let defaultReminders: number[] = [30];
  if (defaultRemindersRow?.value) {
    try {
      defaultReminders = JSON.parse(defaultRemindersRow.value);
    } catch {
      defaultReminders = [];
    }
  }

  await runEventReminders(env, env.DB, now, tz, defaultReminders, subs);
  await runDailySummary(env, env.DB, now, tz, subs);
  await runChoreNudge(env, env.DB, now, tz, subs);
  await pruneSentNotifications(env.DB, now);
}
