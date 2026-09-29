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
import { readFeatures, type Features } from './routes/settings.ts';
import { parseTempCheck, parseTransitions, todayInTz } from './routes/members.ts';
import { addDays, clockLabel, doseAt, LATE_MS, loadLogs, loadMedications, medicineLabel, scheduledOn, type Medication } from './routes/medications.ts';
import { sha256Hex } from './auth.ts';
import { batteryFor } from './routes/insights.ts';
import { mealLinksQuery, parseMealLinks, prepAt, prepFor } from './prepBy.ts';

export const DEFAULT_PUSH_PREFS = {
  eventReminders: true,
  dailySummary: false,
  summaryTime: '07:30',
  choreNudge: false,
  choreNudgeTime: '08:00',
  listUpdates: false,
  medicationNames: false, // medicine names in medication reminders on this device (push text shows on lock screens)
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

export type NotificationKind = 'reminder' | 'summary' | 'chore' | 'list' | 'message' | 'goal' | 'medication';
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

// One timed or all-day occurrence in the search window, with what the regular reminders use.
// prepAt: a meal's event counts down to starting prep (prepBy.ts) instead of leaving, for prepFor.
type Occurrence = { eventId: string; occurrenceKey: string; title: string; start: string; allDay: boolean; memberIds: string[]; effective: number[]; leadMinutes: number; travelMinutes: number; location: string | null; prepAt: string | null; prepFor: string[] };

async function runEventReminders(env: Env, db: KinwallDb, now: Date, tz: string, defaultReminders: number[], subs: PushSubRow[], quiet: boolean): Promise<void> {
  const eligible = subs.filter((s) => subPrefs(s).eventReminders);

  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + SEARCH_WINDOW_MS);

  const [calsRes, eventsRes, categoriesRes, membersRes, travelRes, mealsRes] = await db.batch<unknown>([
    db.prepare("SELECT id, kind, name, member_ids, enabled FROM calendars WHERE enabled = 1"),
    db.prepare('SELECT * FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE enabled = 1)'),
    db.prepare('SELECT id, emoji FROM categories'),
    db.prepare('SELECT id, name FROM members'),
    // Synced events keep travel time here, not on the row (see migration 0019).
    db.prepare('SELECT calendar_id, external_id, travel_minutes, remind_before_leave FROM event_travel_overrides'),
    mealLinksQuery(db),
  ]);
  const travelOverrides = new Map(
    (travelRes.results as unknown as { calendar_id: string; external_id: string; travel_minutes: number | null; remind_before_leave: number }[]).map((r) => [`${r.calendar_id}\u0000${r.external_id}`, r]),
  );
  const memberNames = new Map((membersRes.results as unknown as { id: string; name: string }[]).map((m) => [m.id, m.name]));
  const cals = new Map((calsRes.results as unknown as CalRow[]).map((c) => [c.id, c]));
  const categoryEmojis = new Map((categoriesRes.results as unknown as { id: string; emoji: string | null }[]).map((c) => [c.id, c.emoji]));
  const events = eventsRes.results as unknown as EventRow[];
  const meals = parseMealLinks(mealsRes.results);

  // leadMinutes: travel time when the event reminds before leaving - reminders then count back from
  // the leave-by time (start - travel) instead of the start.
  type Candidate = { eventId: string; occurrenceKey: string; title: string; start: string; allDay: boolean; memberIds: string[]; categoryId: string | null; minutes: number; leadMinutes: number; row: EventRow; calName: string };
  const candidates: Candidate[] = [];
  const occurrences: Occurrence[] = [];

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
    // [] = turned off on the event: no regular reminders (transition reminders are per person).
    const effective = reminders ?? defaultReminders ?? [];

    const travel = cal.kind === 'local' ? row : row.external_id ? travelOverrides.get(`${cal.id}\u0000${row.external_id}`) : undefined;
    const leadMinutes = travel?.remind_before_leave && travel.travel_minutes && !row.all_day ? travel.travel_minutes : 0;
    const meal = row.all_day ? undefined : meals.get(row.id);
    const occ = (start: string): Occurrence => ({
      eventId: row.id, occurrenceKey: start, title: row.title, start, allDay: !!row.all_day, memberIds, effective, leadMinutes, travelMinutes: row.all_day ? 0 : travel?.travel_minutes ?? 0, location: row.location,
      prepAt: meal ? prepAt(start, meal.eventStart, meal.minutes) : null, prepFor: prepFor(meal, memberIds),
    });

    if (cal.kind === 'local' && row.rrule) {
      for (const inst of expand(row.rrule, row.start, row.end, !!row.all_day, tz, from, to)) {
        occurrences.push(occ(inst.start));
        for (const minutes of effective) {
          candidates.push({ eventId: row.id, occurrenceKey: inst.start, title: row.title, start: inst.start, allDay: !!row.all_day, memberIds, categoryId: row.category_id, minutes, leadMinutes, row, calName: cal.name });
        }
      }
      continue;
    }
    const startMs = row.all_day ? Date.parse(`${row.start}T00:00:00Z`) : Date.parse(row.start);
    if (startMs < from.getTime() || startMs >= to.getTime()) continue;
    occurrences.push(occ(row.start));
    for (const minutes of effective) {
      candidates.push({ eventId: row.id, occurrenceKey: row.start, title: row.title, start: row.start, allDay: !!row.all_day, memberIds, categoryId: row.category_id, minutes, leadMinutes, row, calName: cal.name });
    }
  }

  const due = candidates.filter((cand) => {
    const t = fireTime(cand.start, cand.allDay, cand.minutes + cand.leadMinutes, tz);
    return t > now.getTime() - LOOKBACK_MS && t <= now.getTime();
  });

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

  if (!quiet) await runTransitionReminders(env, db, now, tz, occurrences, eligible);
}

/** A person's transition times: their picked minutes plus every `repeat.every` during the last
 * `repeat.within`, deduped, latest first. [10, 5] + every 5 in the last 15 -> [15, 10, 5]. */
export function transitionTimes(minutes: number[], repeat: { every: number; within: number } | null): number[] {
  const all = new Set(minutes);
  if (repeat && repeat.every > 0) for (let m = repeat.every; m <= repeat.within; m += repeat.every) all.add(m);
  return [...all].filter((m) => m >= 1 && m <= 120).sort((a, b) => b - a);
}

// Is `now` (household tz) inside quiet hours "HH:MM"-"HH:MM" (may wrap midnight)?
export function inQuietHours(from: string | undefined, to: string | undefined, now: Date, tz: string): boolean {
  if (!from || !to || from === to) return false;
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return from < to ? hm >= from && hm < to : hm >= from || hm < to;
}

// Per-person transition reminders: for each member who has them on, calm pushes before their
// timed events ("Soccer in 10 minutes", "Leave for Soccer in 5 minutes") to devices that belong to
// them (the device's key has them as owner) and have event reminders on. Untagged events count as
// everyone's, like everywhere else. Skipped when a regular reminder for the same event lands on
// that device in the same minute, and during quiet hours (the caller checks). Not recorded in the
// household feed: they're personal and frequent.
async function runTransitionReminders(env: Env, db: KinwallDb, now: Date, tz: string, occurrences: Occurrence[], eligible: PushSubRow[]): Promise<void> {
  if (!eligible.length) return;
  const [membersRes, keysRes] = await db.batch<unknown>([
    db.prepare('SELECT id, transitions FROM members WHERE transitions IS NOT NULL'),
    db.prepare("SELECT id, owner FROM api_keys WHERE owner IS NOT NULL AND owner <> 'shared'"),
  ]);
  const ownerOfKey = new Map((keysRes.results as { id: string; owner: string }[]).map((k) => [k.id, k.owner]));
  const minute = (ms: number) => Math.floor(ms / 60000);

  for (const m of membersRes.results as { id: string; transitions: string }[]) {
    const cfg = parseTransitions(m.transitions);
    const times = cfg.on ? transitionTimes(cfg.minutes, cfg.repeat) : [];
    const devices = eligible.filter((s) => s.api_key_id && ownerOfKey.get(s.api_key_id) === m.id);
    if (!times.length || !devices.length) continue;

    for (const occ of occurrences) {
      if (occ.allDay || !memberMatch([m.id], occ.prepFor)) continue;
      // A meal counts to starting prep whatever the leave-by switch says: its start is the meal itself.
      const lead = cfg.leaveBy ? occ.travelMinutes : 0;
      const target = occ.prepAt ? Date.parse(occ.prepAt) : Date.parse(occ.start) - lead * 60000;
      if (target <= now.getTime()) continue;
      // Every time due in the lookback window. A late tick can catch several (repeat every 1-2
      // min on a 5-min cron): send only the latest, mark the rest so they don't trail in after.
      const due = times.filter((t) => {
        const at = target - t * 60000;
        return at > now.getTime() - LOOKBACK_MS && at <= now.getTime();
      });
      if (!due.length) continue;
      const regular = occ.effective.map((r) => minute(Date.parse(occ.start) - (r + occ.leadMinutes) * 60000));
      const left = Math.max(1, Math.round((target - now.getTime()) / 60000)); // the truth, even on a late tick
      const by = fmtTime(new Date(target).toISOString(), tz), starts = fmtTime(occ.start, tz);
      const what = occ.prepAt ? `Start prep for ${occ.title}` : lead ? `Leave for ${occ.title}` : occ.title;
      const when = occ.prepAt ? (by === starts ? `Start prep by ${by}` : `Start prep by ${by} · starts ${starts}`) : lead ? `Leave by ${by} · starts ${starts}` : `Starts at ${starts}`;
      const payload = {
        title: `${what} in ${left} minute${left === 1 ? '' : 's'}`,
        body: [when, occ.location && `📍 ${occ.location.replace(/\s*\n\s*/g, ', ')}`].filter(Boolean).join('\n'),
        url: `/#/calendar?event=${encodeURIComponent(occ.eventId)}&at=${encodeURIComponent(new Date(occ.start).toISOString())}`,
        tag: `transition:${occ.eventId}`, // each one replaces the last on the lock screen
      };
      for (const sub of devices) {
        const keys = due.map((t) => `tr:${sub.id}:${occ.eventId}:${occ.occurrenceKey}:${t}`);
        const latest = due[due.length - 1];
        const fireMinute = minute(target - latest * 60000);
        const doubled = memberMatch(parseMemberIds(sub.member_ids), occ.memberIds) && regular.includes(fireMinute);
        if (!doubled && !(await alreadySent(db, keys[keys.length - 1]))) await sendToSub(env, db, sub, payload);
        for (const key of keys) await markSent(db, key, now);
      }
    }
  }
}

// Features turned off in Settings (chores, lists) are left out of the summary.
async function runDailySummary(env: Env, db: KinwallDb, now: Date, tz: string, subs: PushSubRow[], windowStart: Date, features: Features): Promise<void> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  // null = the household-wide copy for the in-app feed (everyone's events, no device filter).
  const targets: (PushSubRow | null)[] = subs.filter((s) => subPrefs(s).dailySummary && timeInWindow(subPrefs(s).summaryTime, tz, windowStart, now));
  if (feedTime(subs, 'dailySummary', 'summaryTime', tz, windowStart, now)) targets.push(null);

  for (const sub of targets) {
    const key = sub ? `sum:${sub.id}:${today}` : `feed:sum:${today}`;
    if (await alreadySent(db, key)) continue;

    const dayStart = new Date(`${today}T00:00:00Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const [eventsRes, choresRes, linkedRes, dueRes, mealsRes] = await db.batch<unknown>([
      db.prepare("SELECT * FROM events WHERE calendar_id IN (SELECT id FROM calendars WHERE enabled = 1)"),
      db.prepare('SELECT * FROM chores WHERE active = 1'),
      // Urgent/important items first (so they make the top 3) and marked.
      db.prepare(`SELECT event_id, title, priority FROM list_items WHERE done = 0 AND event_id IS NOT NULL ORDER BY ${priorityRankSql()}, sort, created_at`),
      db.prepare(`SELECT title, priority, member_id FROM list_items WHERE done = 0 AND due_date = ? ORDER BY ${priorityRankSql()}, sort, created_at`).bind(today),
      db.prepare("SELECT slot, title FROM meals WHERE date = ? ORDER BY CASE slot WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END, planned_time, created_at").bind(today),
    ]);
    const mark = (r: { title: string; priority: string }) => `${r.priority === 'urgent' ? '‼️ ' : r.priority === 'high' ? '⭐ ' : ''}${r.title}`;
    const top3 = (titles: string[]) => titles.slice(0, 3).join(', ') + (titles.length > 3 ? ` +${titles.length - 3} more` : '');
    const linked = new Map<string, string[]>();
    for (const r of features.lists ? linkedRes.results as unknown as { event_id: string; title: string; priority: string }[] : []) {
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
    const choreCount = features.chores ? ` · ${chores.length} chore${chores.length === 1 ? '' : 's'}` : '';
    let body = `${eventCount} event${eventCount === 1 ? '' : 's'}${choreCount}${first ? ` — ${first}` : ''}`;
    const meals = mealsRes.results as { slot: string; title: string }[];
    if (features.meals && meals.length) body += `\nMeals: ${top3(meals.map((m) => `${m.slot[0].toUpperCase()}${m.slot.slice(1)} · ${m.title}`))}`;
    if (todo.length) body += `\nTo do for today's events:\n${todo.join('\n')}`;
    // List items due today (any list), for this device's members like the chore nudge.
    const due = features.lists ? (dueRes.results as unknown as { title: string; priority: string; member_id: string | null }[]).filter((r) => memberMatch(deviceMemberIds, r.member_id ? [r.member_id] : [])) : [];
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
      if (!(await readFeatures(env.DB)).lists) return; // Lists turned off in Settings
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

// Evening check (Temp check), at a person's eveningTime (household time), one push a day to devices
// that belong to them, when there's something to ask:
// - the goal check (settings.evening): they set a goal today (not skipped) and haven't answered.
//   "Did you finish your goal? 🎯" with the goal (family content), and one row in the in-app feed.
//   The same card then asks "How drained do you feel?" too when their battery is on.
// - otherwise, with their energy battery on (settings.battery) and no drained answer yet: "How
//   drained do you feel? 🔋", generic text and no feed row (personal, like the battery heads-up).
// Once per person per day (claimed in one statement). Answers are never in the text.
// Sent during quiet hours too: it's the person's own chosen time (the family asked for that).
async function runGoalFollowups(env: Env, db: KinwallDb, now: Date, tz: string, windowStart: Date): Promise<void> {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now);
  const { results } = await db
    .prepare('SELECT m.id, m.temp_check, t.goal, t.goal_skipped, t.followup, t.drained FROM members m LEFT JOIN temp_checks t ON t.member_id = m.id AND t.date = ? WHERE m.temp_check IS NOT NULL')
    .bind(today)
    .all<{ id: string; temp_check: string; goal: string | null; goal_skipped: number | null; followup: string | null; drained: string | null }>();
  const [y, mo, d] = today.split('-').map(Number);
  for (const m of results) {
    const s = parseTempCheck(m.temp_check);
    if (!s.on) continue;
    const goal = s.goal && s.evening && m.goal && !m.goal_skipped && !m.followup ? m.goal : null;
    if (!goal && !(s.battery && !m.drained)) continue;
    const [h, mi] = s.eveningTime.split(':').map(Number);
    const at = zonedTimeToUtc({ y, mo: mo - 1, d, h, mi, s: 0 }, tz).getTime();
    if (at <= windowStart.getTime() || at > now.getTime()) continue;
    const key = `goal:${m.id}:${today}`;
    const claimed = await db.prepare('INSERT INTO sent_notifications (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(key, now.toISOString()).run();
    if (!claimed.meta.changes) continue;
    const payload = goal
      ? { title: 'Did you finish your goal? 🎯', body: goal, url: `/#/journal/${m.id}`, tag: key }
      : { title: 'How drained do you feel? 🔋', body: 'A quick check-in before bed.', url: `/#/journal/${m.id}`, tag: key };
    if (goal) await recordNotification(db, { kind: 'goal', title: payload.title, body: payload.body, url: payload.url, memberIds: [m.id], source: 'system', at: now });
    const { results: subs } = await db.prepare('SELECT s.* FROM push_subscriptions s JOIN api_keys k ON k.id = s.api_key_id WHERE k.owner = ?').bind(m.id).all<PushSubRow>();
    for (const sub of subs) await sendToSub(env, db, sub, payload);
  }
}

// Medication reminders (routes/medications.ts), for each dose that isn't taken or skipped:
// - at its time (household), "Time for Leo's medicine" to devices that belong to them (key owner),
//   and one row in the in-app feed;
// - when a snooze runs out, the same push again (once per snooze, no feed row);
// - 30 minutes after its time, for a kid (not grownUp), "Leo's 8:00 AM medicine hasn't been marked
//   yet" to parent devices (admin keys) and the feed.
// Push text is generic unless the device turned on medicationNames. Each is claimed once (an
// insert into sent_notifications, keyed by a hash so the table never says what or when) and only
// within GRACE of its time, so a late tick still sends and a restart never repeats. Medicine pushes
// go out during quiet hours too: a missed dose matters more than a quiet night (the family asked).
const MED_GRACE_MS = 30 * 60_000;
async function runMedicationReminders(env: Env, db: KinwallDb, now: Date, tz: string): Promise<void> {
  const meds = await loadMedications(env);
  if (!meds.length) return;
  const today = todayInTz(tz, now);
  const yesterday = addDays(today, -1);
  const logs = await loadLogs(env, meds.map((m) => m.id), yesterday, today);
  const { results: members } = await db.prepare('SELECT id, name, grown_up FROM members').all<{ id: string; name: string; grown_up: number }>();
  const byId = new Map(members.map((m) => [m.id, m]));
  const claim = async (target: number, what: string) => {
    if (now.getTime() < target || now.getTime() - target >= MED_GRACE_MS) return false;
    const key = `med:${await sha256Hex(what)}`;
    return !!(await db.prepare('INSERT INTO sent_notifications (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(key, now.toISOString()).run()).meta.changes;
  };
  const due = new Map<string, { meds: Medication[]; feed: boolean }>(); // by member
  const late = new Map<string, { memberId: string; time: string; meds: Medication[] }>(); // by member + date + time
  for (const m of meds) {
    const member = byId.get(m.memberId);
    if (!member) continue;
    for (const date of [yesterday, today]) {
      if (!scheduledOn(m, date)) continue;
      for (const time of m.times) {
        const e = logs.get(`${m.id}:${date}`)?.[time];
        if (e?.status) continue;
        const at = doseAt(date, time, tz);
        const first = await claim(at, `due:${m.id}:${date}:${time}`);
        if (first || (e?.snoozedUntil && (await claim(Date.parse(e.snoozedUntil), `snooze:${m.id}:${date}:${time}:${e.snoozedUntil}`)))) {
          const d = due.get(m.memberId) ?? { meds: [], feed: false };
          due.set(m.memberId, { meds: [...d.meds, m], feed: d.feed || first });
        }
        if (!member.grown_up && (await claim(at + LATE_MS, `late:${m.id}:${date}:${time}`))) {
          const k = `${m.memberId}:${date}:${time}`;
          late.set(k, { memberId: m.memberId, time, meds: [...(late.get(k)?.meds ?? []), m] });
        }
      }
    }
  }
  const send = async (subs: PushSubRow[], title: string, generic: string, named: Medication[], url: string, tag: string) => {
    for (const sub of subs) await sendToSub(env, db, sub, { title, body: subPrefs(sub).medicationNames ? named.map(medicineLabel).join(', ') : generic, url, tag });
  };
  for (const [memberId, d] of due) {
    const title = `Time for ${byId.get(memberId)!.name}'s medicine`;
    const url = `/#/medications/${memberId}`;
    if (d.feed) await recordNotification(db, { kind: 'medication', title, url, memberIds: [memberId], source: 'system', at: now });
    const { results: subs } = await db.prepare('SELECT s.* FROM push_subscriptions s JOIN api_keys k ON k.id = s.api_key_id WHERE k.owner = ?').bind(memberId).all<PushSubRow>();
    await send(subs, title, 'Tap to mark it taken.', d.meds, url, `med:${memberId}`);
  }
  if (!late.size) return;
  const { results: parents } = await db.prepare("SELECT s.* FROM push_subscriptions s JOIN api_keys k ON k.id = s.api_key_id WHERE k.scope = 'admin'").all<PushSubRow>();
  for (const l of late.values()) {
    const title = `${byId.get(l.memberId)!.name}'s ${clockLabel(l.time)} medicine hasn't been marked yet`;
    const url = `/#/medications/${l.memberId}`;
    await recordNotification(db, { kind: 'medication', title, url, memberIds: [l.memberId], source: 'system', at: now });
    await send(parents, title, 'Tap to check.', l.meds, url, `med-late:${l.memberId}`);
  }
}

// Energy battery heads-up (battery.ts, Temp check → battery): when a person's next day looks likely
// to run their battery low, one calm push to devices that belong to them: from 7 PM the evening
// before, or held through quiet hours until they end (by noon, then it says "today"). Once per person
// per day: claimed in one insert, keyed by a hash so sent_notifications never says who or which day.
// The text is from the calendar and chores only, never sleep or feelings; not in the family feed.
export const BATTERY_PUSH_AT = '19:00';
export const BATTERY_PUSH_UNTIL = '12:00'; // a push held by quiet hours still goes out the morning of the day
async function runBatteryHeadsUp(env: Env, db: KinwallDb, now: Date, tz: string): Promise<void> {
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const today = todayInTz(tz, now);
  const day = clock >= BATTERY_PUSH_AT ? addDays(today, 1) : clock < BATTERY_PUSH_UNTIL ? today : null;
  if (!day) return;
  const { results: members } = await db.prepare('SELECT id, temp_check FROM members WHERE temp_check IS NOT NULL').all<{ id: string; temp_check: string }>();
  for (const m of members) {
    const s = parseTempCheck(m.temp_check);
    if (!s.on || !s.battery) continue;
    const { results: subs } = await db.prepare('SELECT s.* FROM push_subscriptions s JOIN api_keys k ON k.id = s.api_key_id WHERE k.owner = ?').bind(m.id).all<PushSubRow>();
    if (!subs.length) continue;
    const key = `battery:${await sha256Hex(`${m.id}:${day}`)}`;
    if (!(await db.prepare('INSERT INTO sent_notifications (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(key, now.toISOString()).run()).meta.changes) continue;
    const warning = (await batteryFor(env, m.id, tz, now)).warnings.find((w) => w.date === day);
    if (!warning) continue;
    const payload = { title: `🔋 Heads-up for ${day === today ? 'today' : 'tomorrow'}`, body: warning.text, url: `/#/insights/${m.id}`, tag: `battery:${m.id}` };
    for (const sub of subs) await sendToSub(env, db, sub, payload);
  }
}

// Entry point for the cron (Workers) and setInterval (Node) tickers.
export async function runNotifications(env: Env, now: Date, _execCtx?: WaitCtx): Promise<void> {
  // No early bail on zero subscriptions: the in-app feed records reminders/summaries regardless.
  const { results: subs } = await env.DB.prepare('SELECT * FROM push_subscriptions').all<PushSubRow>();

  const [tzRow, defaultRemindersRow, quietRes] = await Promise.all([
    env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>(),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'defaultReminderMinutes'").first<{ value: string }>(),
    env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('quietFrom', 'quietTo')").all<{ key: string; value: string }>(),
  ]);
  const quietHours = new Map(quietRes.results.map((r) => [r.key, r.value]));
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

  const quiet = inQuietHours(quietHours.get('quietFrom'), quietHours.get('quietTo'), now, tz);
  await runEventReminders(env, env.DB, now, tz, defaultReminders, subs, quiet);
  const features = await readFeatures(env.DB);
  await runDailySummary(env, env.DB, now, tz, subs, windowStart, features);
  if (features.chores) await runChoreNudge(env, env.DB, now, tz, subs, windowStart); // Chores turned off: no nudge
  await runGoalFollowups(env, env.DB, now, tz, windowStart);
  // Held during quiet hours; a sealed answer that won't open (no key) never stops the rest. The error's name only.
  if (!quiet) try { await runBatteryHeadsUp(env, env.DB, now, tz); } catch (e) { console.error('battery heads-up skipped:', e instanceof Error ? e.name : 'error'); }
  if (features.trackersHealth && (await env.DB.prepare("SELECT value FROM settings WHERE key = 'medications'").first<{ value: string }>())?.value === 'true') {
    // Never let a sealed value that won't open (no key) stop the other reminders; the error's name only, never data.
    try { await runMedicationReminders(env, env.DB, now, tz); } catch (e) { console.error('medication reminders skipped:', e instanceof Error ? e.name : 'error'); }
  }
  await pruneSentNotifications(env.DB, now);
  await setTickWindowEnd(env.DB, now);
}

// Chore approval (routes/chores.ts), sent right away rather than on the tick: "Leo finished Make
// bed. Approve?" to parent devices (push subscriptions on admin keys) and a parent's "Not yet" to
// the kid's own devices (keys owned by that member). Once per dedupe `key`; the in-app feed gets
// one row too.
export function notifyChoreApproval(
  env: Env,
  execCtx: WaitCtx | undefined,
  to: 'parents' | { owner: string },
  key: string,
  n: { title: string; body: string; url: string; memberIds?: string[] },
): void {
  waitUntil(
    execCtx,
    (async () => {
      const now = new Date();
      // Claimed in one statement, so two quick ticks can't both send.
      const claimed = await env.DB.prepare('INSERT INTO sent_notifications (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(key, now.toISOString()).run();
      if (!claimed.meta.changes) return;
      await recordNotification(env.DB, { kind: 'chore', ...n, source: 'system', at: now });
      const subs = to === 'parents'
        ? env.DB.prepare("SELECT s.* FROM push_subscriptions s JOIN api_keys k ON k.id = s.api_key_id WHERE k.scope = 'admin'")
        : env.DB.prepare('SELECT s.* FROM push_subscriptions s JOIN api_keys k ON k.id = s.api_key_id WHERE k.owner = ?').bind(to.owner);
      const { results } = await subs.all<PushSubRow>();
      for (const sub of results) await sendToSub(env, env.DB, sub, { title: n.title, body: n.body, url: n.url, tag: key });
    })(),
  );
}
