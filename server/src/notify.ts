// Push notification scheduling: event reminders, daily summary, chore nudge, list updates.
// Each one is also recorded once (household-wide) in the in-app feed via recordNotification.
// Called from the Workers cron (every 5 min, worker.ts) and the Node setInterval loop (node.ts,
// every ~2 min) - both call runNotifications(env, now) directly, no HTTP round trip.
import type { KinwallDb } from './db.ts';
import type { Env, WaitCtx } from './env.ts';
import { waitUntil } from './env.ts';
import { hostTimezone } from './env.ts';
import { expand, zonedTimeToUtc } from './recurrence.ts';
import { dueOnDate, type ChoreRow } from './routes/chores.ts';
import { priorityRankSql } from './routes/lists.ts';
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

// Time-of-day triggers (daily summary, chore nudge) fire when their configured HH:MM falls inside
// (windowStart, now], not on an exact-minute match - a tick can land at any second past the tick
// cadence (Workers cron */5, Docker ~2 min) and would otherwise skip the configured minute.
// windowStart is the last recorded tick; with no prior tick (or a >24h gap, e.g. after downtime)
// fall back to a short window so we don't replay a whole day's worth of times at once.
const FIRST_TICK_WINDOW_MS = LOOKBACK_MS;
const MAX_TICK_GAP_MS = 24 * 60 * 60 * 1000;

async function getTickWindowStart(db: KinwallDb, now: Date): Promise<Date> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'notifyLastTick'").first<{ value: string }>();
  const last = row?.value ? new Date(row.value) : null;
  if (!last || Number.isNaN(last.getTime()) || now.getTime() - last.getTime() > MAX_TICK_GAP_MS) {
    return new Date(now.getTime() - FIRST_TICK_WINDOW_MS);
  }
  return last;
}

async function setTickWindowEnd(db: KinwallDb, now: Date): Promise<void> {
  await db
    .prepare("INSERT INTO settings (key, value) VALUES ('notifyLastTick', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
    .bind(now.toISOString())
    .run();
}

function ymdInTz(date: Date, tz: string): { y: number; mo: number; d: number } {
  const [y, mo, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date).split('-').map(Number);
  return { y, mo: mo - 1, d };
}

// Does "HH:MM" (household tz) land in (windowStart, now]? Checked against both today's and
// yesterday's date so a window straddling local midnight still catches a time just before it.
function timeInWindow(hm: string, tz: string, windowStart: Date, now: Date): boolean {
  const [h, mi] = hm.split(':').map(Number);
  const { y, mo, d } = ymdInTz(now, tz);
  for (const day of [d, d - 1]) {
    const t = zonedTimeToUtc({ y, mo, d: day, h, mi, s: 0 }, tz).getTime();
    if (t > windowStart.getTime() && t <= now.getTime()) return true;
  }
  return false;
}

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

async function alreadySent(db: KinwallDb, key: string): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM sent_notifications WHERE key = ?').bind(key).first();
  return !!row;
}

async function markSent(db: KinwallDb, key: string, now: Date): Promise<void> {
  await db
    .prepare("INSERT INTO sent_notifications (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET sent_at = excluded.sent_at")
    .bind(key, now.toISOString())
    .run();
}

async function pruneSentNotifications(db: KinwallDb, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const feedCutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
  await db.batch([
    db.prepare('DELETE FROM sent_notifications WHERE sent_at < ?').bind(cutoff),
    db.prepare('DELETE FROM notifications WHERE at < ?').bind(feedCutoff),
  ]);
}

export type NotificationKind = 'reminder' | 'summary' | 'chore' | 'list' | 'message';
export type NotificationSource = 'system' | 'api' | 'mcp';

// The in-app feed (GET /api/notifications): every send site records one row here, push or no
// push. Bumps rev in the same batch so open walls/phones refetch and the bell updates.
export async function recordNotification(
  db: KinwallDb,
  n: { kind: NotificationKind; title: string; body?: string | null; url?: string | null; memberIds?: string[]; source: NotificationSource; at?: Date },
): Promise<void> {
  await db.batch([
    db
      .prepare('INSERT INTO notifications (id, at, kind, title, body, url, member_ids, source) VALUES (?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), (n.at ?? new Date()).toISOString(), n.kind, n.title, n.body ?? null, n.url ?? null, JSON.stringify(n.memberIds ?? []), n.source),
    db.prepare("INSERT INTO settings (key, value) VALUES ('rev', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1"),
  ]);
}

// The feed records the household-wide summary/nudge once a day: at the default time, or earlier
// if a device that has it on asked for an earlier time (first tick whose window covers it wins,
// dedupe key below prevents a second).
function feedTime(subs: PushSubRow[], on: 'dailySummary' | 'choreNudge', time: 'summaryTime' | 'choreNudgeTime', tz: string, windowStart: Date, now: Date): boolean {
  return (
    timeInWindow(DEFAULT_PUSH_PREFS[time], tz, windowStart, now) ||
    subs.some((s) => subPrefs(s)[on] && timeInWindow(subPrefs(s)[time], tz, windowStart, now))
  );
}

type EventRow = {
  id: string;
  calendar_id: string;
  external_id: string | null;
  title: string;
  start: string;
  end: string;
  all_day: number;
  rrule: string | null;
  member_ids: string;
  category_id: string | null;
  reminders: string | null;
  location: string | null;
  description: string | null;
  travel_minutes: number | null;
  remind_before_leave: number;
};

type CalRow = { id: string; kind: string; name: string; member_ids: string; enabled: number };

function fireTime(startIso: string, allDay: boolean, minutes: number, tz: string): number {
  if (!allDay) return Date.parse(startIso) - minutes * 60000;
  const [y, mo, d] = startIso.split('-').map(Number);
  return zonedTimeToUtc({ y, mo: mo - 1, d, h: 0, mi: 0, s: 0 }, tz).getTime() - minutes * 60000;
}

function fmtTime(iso: string, tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

async function sendToSub(env: Env, db: KinwallDb, row: PushSubRow, payload: { title: string; body: string; url?: string; tag?: string }): Promise<void> {
  const result = await sendWebPush(env, db, row, payload);
  if (result.ok) await db.prepare('UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?').bind(new Date().toISOString(), row.id).run();
  else if (result.gone) await db.prepare('DELETE FROM push_subscriptions WHERE id = ?').bind(row.id).run();
}

async function runEventReminders(env: Env, db: KinwallDb, now: Date, tz: string, defaultReminders: number[], subs: PushSubRow[]): Promise<void> {
  const eligible = subs.filter((s) => subPrefs(s).eventReminders);

  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + SEARCH_WINDOW_MS);

  const [calsRes, eventsRes, categoriesRes, membersRes, travelRes] = await db.batch<unknown>([
    db.prepare("SELECT id, kind, name, member_ids, enabled FROM calendars WHERE enabled = 1"),
    db.prepare('SELECT * FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE enabled = 1)'),
    db.prepare('SELECT id, emoji FROM categories'),
    db.prepare('SELECT id, name FROM members'),
    // Synced events keep travel time here, not on the row (see migration 0019).
    db.prepare('SELECT calendar_id, external_id, travel_minutes, remind_before_leave FROM event_travel_overrides'),
  ]);
  const travelOverrides = new Map(
    (travelRes.results as unknown as { calendar_id: string; external_id: string; travel_minutes: number | null; remind_before_leave: number }[]).map((r) => [`${r.calendar_id}\u0000${r.external_id}`, r]),
  );
  const memberNames = new Map((membersRes.results as unknown as { id: string; name: string }[]).map((m) => [m.id, m.name]));
  const cals = new Map((calsRes.results as unknown as CalRow[]).map((c) => [c.id, c]));
  const categoryEmojis = new Map((categoriesRes.results as unknown as { id: string; emoji: string | null }[]).map((c) => [c.id, c.emoji]));
  const events = eventsRes.results as unknown as EventRow[];

  // leadMinutes: travel time when the event reminds before leaving - reminders then count back from
  // the leave-by time (start - travel) instead of the start.
  type Candidate = { eventId: string; occurrenceKey: string; title: string; start: string; allDay: boolean; memberIds: string[]; categoryId: string | null; minutes: number; leadMinutes: number; row: EventRow; calName: string };
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

    const travel = cal.kind === 'local' ? row : row.external_id ? travelOverrides.get(`${cal.id}\u0000${row.external_id}`) : undefined;
    const leadMinutes = travel?.remind_before_leave && travel.travel_minutes && !row.all_day ? travel.travel_minutes : 0;

    if (cal.kind === 'local' && row.rrule) {
      for (const inst of expand(row.rrule, row.start, row.end, !!row.all_day, tz, from, to)) {
        for (const minutes of effective) {
          candidates.push({ eventId: row.id, occurrenceKey: inst.start, title: row.title, start: inst.start, allDay: !!row.all_day, memberIds, categoryId: row.category_id, minutes, leadMinutes, row, calName: cal.name });
        }
      }
      continue;
    }
    const startMs = row.all_day ? Date.parse(`${row.start}T00:00:00Z`) : Date.parse(row.start);
    if (startMs < from.getTime() || startMs >= to.getTime()) continue;
    for (const minutes of effective) {
      candidates.push({ eventId: row.id, occurrenceKey: row.start, title: row.title, start: row.start, allDay: !!row.all_day, memberIds, categoryId: row.category_id, minutes, leadMinutes, row, calName: cal.name });
    }
  }

  const due = candidates.filter((cand) => {
    const t = fireTime(cand.start, cand.allDay, cand.minutes + cand.leadMinutes, tz);
    return t > now.getTime() - LOOKBACK_MS && t <= now.getTime();
  });
  if (due.length === 0) return;

  for (const cand of due) {
    const emoji = cand.categoryId ? categoryEmojis.get(cand.categoryId) : null;
    const when = cand.minutes === 0 ? 'Now' : cand.minutes % 60 === 0 ? `In ${cand.minutes / 60} hour${cand.minutes === 60 ? '' : 's'}` : `In ${cand.minutes} minutes`;
    const timeLabel = cand.allDay ? 'All day' : fmtTime(cand.start, tz);
    // Event name as the title: it's what you scan for, and iOS already adds "from Kinwall" under it.
    // First line is what shows collapsed; the rest appears when the notification is long-pressed.
    const who = cand.memberIds.map((id) => memberNames.get(id)).filter(Boolean).join(', ');
    const notes = cand.row.description?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const leaveBy = cand.leadMinutes ? fmtTime(new Date(Date.parse(cand.start) - cand.leadMinutes * 60000).toISOString(), tz) : null;
    const lines = [
      leaveBy ? `Leave by ${leaveBy} for ${cand.title} · starts ${timeLabel}` : `${when} · ${timeLabel}`,
      cand.row.location && `📍 ${cand.row.location.replace(/\s*\n\s*/g, ', ')}`,
      who && `👥 ${who}`,
      `🗓 ${cand.calName}`,
      notes && (notes.length > 140 ? `${notes.slice(0, 139)}…` : notes),
    ].filter(Boolean);
    const at = cand.allDay ? cand.occurrenceKey : new Date(cand.start).toISOString();
    const payload = {
      title: `${emoji ? emoji + ' ' : ''}${cand.title}`,
      body: lines.join('\n'),
      url: `/#/calendar?event=${encodeURIComponent(cand.eventId)}&at=${encodeURIComponent(at)}`, // tap opens this event
      tag: `event:${cand.eventId}`,
    };

    const feedKey = `feed:rem:${cand.eventId}:${cand.occurrenceKey}:${cand.minutes}`;
    if (!(await alreadySent(db, feedKey))) {
      await recordNotification(db, { kind: 'reminder', title: payload.title, body: payload.body, url: payload.url, memberIds: cand.memberIds, source: 'system', at: now });
      await markSent(db, feedKey, now);
    }

    for (const sub of eligible) {
      if (!memberMatch(parseMemberIds(sub.member_ids), cand.memberIds)) continue;
      const key = `rem:${sub.id}:${cand.eventId}:${cand.occurrenceKey}:${cand.minutes}`;
      if (await alreadySent(db, key)) continue;
      await sendToSub(env, db, sub, payload);
      await markSent(db, key, now);
    }
  }
}

async function runDailySummary(env: Env, db: KinwallDb, now: Date, tz: string, subs: PushSubRow[], windowStart: Date): Promise<void> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  // null = the household-wide copy for the in-app feed (everyone's events, no device filter).
  const targets: (PushSubRow | null)[] = subs.filter((s) => subPrefs(s).dailySummary && timeInWindow(subPrefs(s).summaryTime, tz, windowStart, now));
  if (feedTime(subs, 'dailySummary', 'summaryTime', tz, windowStart, now)) targets.push(null);

  for (const sub of targets) {
    const key = sub ? `sum:${sub.id}:${today}` : `feed:sum:${today}`;
    if (await alreadySent(db, key)) continue;

    const dayStart = new Date(`${today}T00:00:00Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const [eventsRes, choresRes, linkedRes, dueRes] = await db.batch<unknown>([
      db.prepare("SELECT * FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE enabled = 1)"),
      db.prepare('SELECT * FROM chores WHERE active = 1'),
      // Urgent/important items first (so they make the top 3) and marked.
      db.prepare(`SELECT event_id, title, priority FROM list_items WHERE done = 0 AND event_id IS NOT NULL ORDER BY ${priorityRankSql()}, sort, created_at`),
      db.prepare(`SELECT title, priority, member_id FROM list_items WHERE done = 0 AND due_date = ? ORDER BY ${priorityRankSql()}, sort, created_at`).bind(today),
    ]);
    const mark = (r: { title: string; priority: string }) => `${r.priority === 'urgent' ? '‼️ ' : r.priority === 'high' ? '⭐ ' : ''}${r.title}`;
    const top3 = (titles: string[]) => titles.slice(0, 3).join(', ') + (titles.length > 3 ? ` +${titles.length - 3} more` : '');
    const linked = new Map<string, string[]>();
    for (const r of linkedRes.results as unknown as { event_id: string; title: string; priority: string }[]) {
      linked.set(r.event_id, [...(linked.get(r.event_id) ?? []), mark(r)]);
    }
    const events = eventsRes.results as unknown as EventRow[];
    const deviceMemberIds = sub ? parseMemberIds(sub.member_ids) : [];
    const todaysTitles: string[] = [];
    const todo: string[] = []; // "• Soccer — cleats, water" for today's events with open linked items
    const addTodo = (row: EventRow) => {
      const items = linked.get(row.id);
      if (items) todo.push(`• ${row.title} — ${top3(items)}`);
    };
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
          addTodo(row);
        }
        continue;
      }
      const startMs = row.all_day ? Date.parse(`${row.start}T00:00:00Z`) : Date.parse(row.start);
      const endMs = row.all_day ? Date.parse(`${row.end}T00:00:00Z`) : Date.parse(row.end);
      if (endMs > dayStart.getTime() && startMs < dayEnd.getTime()) {
        eventCount++;
        todaysTitles.push(row.title);
        addTodo(row);
      }
    }
    const chores = (choresRes.results as unknown as ChoreRow[]).filter((row) => dueOnDate(row, today, tz));
    const first = todaysTitles.slice(0, 2).join(', ') + (todaysTitles.length > 2 ? '…' : '');
    let body = `${eventCount} event${eventCount === 1 ? '' : 's'} · ${chores.length} chore${chores.length === 1 ? '' : 's'}${first ? ` — ${first}` : ''}`;
    if (todo.length) body += `\nTo do for today's events:\n${todo.join('\n')}`;
    // List items due today (any list), for this device's members like the chore nudge.
    const due = (dueRes.results as unknown as { title: string; priority: string; member_id: string | null }[]).filter((r) => memberMatch(deviceMemberIds, r.member_id ? [r.member_id] : []));
    if (due.length) body += `\nDue today: ${top3(due.map(mark))}`;
    if (sub) await sendToSub(env, db, sub, { title: 'Today', body, url: '/' });
    else await recordNotification(db, { kind: 'summary', title: 'Today', body, url: '/', source: 'system', at: now });
    await markSent(db, key, now);
  }
}

async function runChoreNudge(env: Env, db: KinwallDb, now: Date, tz: string, subs: PushSubRow[], windowStart: Date): Promise<void> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  // null = the household-wide copy for the in-app feed.
  const targets: (PushSubRow | null)[] = subs.filter((s) => subPrefs(s).choreNudge && timeInWindow(subPrefs(s).choreNudgeTime, tz, windowStart, now));
  if (feedTime(subs, 'choreNudge', 'choreNudgeTime', tz, windowStart, now)) targets.push(null);
  if (targets.length === 0) return;

  const [choresRes, completionsRes] = await db.batch<unknown>([
    db.prepare('SELECT * FROM chores WHERE active = 1'),
    db.prepare('SELECT chore_id FROM chore_completions WHERE date = ?').bind(today),
  ]);
  const chores = choresRes.results as unknown as ChoreRow[];
  const done = new Set((completionsRes.results as unknown as { chore_id: string }[]).map((r) => r.chore_id));
  const dueToday = chores.filter((c) => dueOnDate(c, today, tz) && !done.has(c.id));

  for (const sub of targets) {
    const key = sub ? `nudge:${sub.id}:${today}` : `feed:nudge:${today}`;
    if (await alreadySent(db, key)) continue;
    const deviceMemberIds = sub ? parseMemberIds(sub.member_ids) : [];
    const mine = dueToday.filter((c) => memberMatch(deviceMemberIds, c.member_id ? [c.member_id] : []));
    if (mine.length === 0) continue;
    const titles = mine.slice(0, 3).map((c) => c.title).join(', ');
    const payload = { title: `${mine.length} chore${mine.length === 1 ? '' : 's'} left today`, body: titles, url: '/chores' };
    if (sub) await sendToSub(env, db, sub, payload);
    else await recordNotification(db, { kind: 'chore', ...payload, memberIds: [...new Set(mine.flatMap((c) => (c.member_id ? [c.member_id] : [])))], source: 'system', at: now });
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
      await markSent(env.DB, key, now);
      const payload = { title: 'List updated', body: `${listName} has new items`, url: `/#/lists?list=${encodeURIComponent(listId)}`, tag: `list:${listId}` }; // tap opens that list
      await recordNotification(env.DB, { kind: 'list', title: payload.title, body: payload.body, url: payload.url, source: 'system', at: now });
      const { results } = await env.DB.prepare('SELECT * FROM push_subscriptions').all<PushSubRow>();
      for (const sub of results.filter((s) => subPrefs(s).listUpdates)) await sendToSub(env, env.DB, sub, payload);
    })(),
  );
}

// Entry point for the cron (Workers) and setInterval (Node) tickers.
export async function runNotifications(env: Env, now: Date, _execCtx?: WaitCtx): Promise<void> {
  // No early bail on zero subscriptions: the in-app feed records reminders/summaries regardless.
  const { results: subs } = await env.DB.prepare('SELECT * FROM push_subscriptions').all<PushSubRow>();

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

  const windowStart = await getTickWindowStart(env.DB, now);

  await runEventReminders(env, env.DB, now, tz, defaultReminders, subs);
  await runDailySummary(env, env.DB, now, tz, subs, windowStart);
  await runChoreNudge(env, env.DB, now, tz, subs, windowStart);
  await pruneSentNotifications(env.DB, now);
  await setTickWindowEnd(env.DB, now);
}
