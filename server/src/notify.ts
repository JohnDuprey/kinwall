import { MED_GRACE_MS, REFILL_REMIND_AT, medicineReminderTimes } from './medicine-reminder-times.ts';
import { goalProgressFor } from './chore-goals.ts';
// Push notification scheduling: event reminders, daily summary, chore nudge, list updates.
// Each one is also recorded once (household-wide) in the in-app feed via recordNotification.
// Called from the Workers cron (every 5 min, worker.ts) and the Node setInterval loop (node.ts,
// every ~2 min) - both call runNotifications(env, now) directly, no HTTP round trip.
import type { KinwallDb } from './db.ts';
import { APP_NAME, type TaskAppKind } from './tasks/apps.ts';
import { familyLang, isLang, LOCALES, perLang, words, type Lang } from './i18n.ts';
import type { Env, WaitCtx } from './env.ts';
import { waitUntil } from './env.ts';
import { hostTimezone } from './env.ts';
import { expand, zonedTimeToUtc } from './recurrence.ts';
import { dueOnDate, type ChoreRow } from './routes/chores.ts';
import { priorityRankSql } from './routes/lists.ts';
import { parseMemberIds } from './calendar-members.ts';
import { enqueueMedicinePush, retryMedicinePushes } from './medicine-push-retries.ts';
import type { PushSendResult } from './webpush.ts';
import { sendPush } from './push-delivery.ts';
import { readFeatures, type Features } from './routes/settings.ts';
import { newscastPrunes } from './routes/newscast.ts';
import { parseTempCheck, parseTransitions, todayInTz } from './routes/members.ts';
import { addDays, doseAt, loadLogs, loadMedications, medicineLabel, scheduledOn, timeKey, WAKE, type Medication } from './routes/medications.ts';
import { openRefillRequest } from './routes/medication-refills.ts';
import { sha256Hex, type ChangedBy } from './auth.ts';
import { batteryFor } from './routes/insights.ts';
import { eveningPending, LAST_NIGHT_UNTIL, lastNightSkipKey, morningAnswered } from './routes/temp-check.ts';
import { mealLinksQuery, parseMealLinks, prepAt, prepFor } from './prepBy.ts';
import { medFollowup, nudge, pickNudge, rememberNudge, stepHint, type NudgeSeen, type NudgeWords } from './nudges.ts';
import { swiftDate, unixSeconds } from './apns.ts';
import { nativePushConfigured, sendNativeLiveActivity } from './native-push.ts';
import { isSealed, seal, unseal, type EncryptionEnv } from './crypto.ts';
import { formatTime, hour12For } from './timeFormat.ts';
import { eventRowsFrom, eventRowsStmts, hiddenInstanceKeys, instanceKey } from './routes/events.ts';
import { readOutings } from './routes/outings.ts';
import { dueReminders, type OutingReminder } from './outing-reminders.ts';
import { publish } from './bus.ts';
import { addSupplies, handOutChore, readJobs, readThings, suppliesList, type UpkeepJob } from './upkeep.ts';
import { daysBetween, dueNotes, suppliesDue, type UpkeepNote } from './upkeep-rules.ts';

export const DEFAULT_PUSH_PREFS = {
  eventReminders: true,
  dailySummary: false,
  summaryTime: '07:30',
  choreNudge: false,
  choreNudgeTime: '08:00',
  listUpdates: false,
  outingReminders: true, // Outings: heads-ups for ⭐ outings, ticket dates, last chance (notify.ts runOutings)
  upkeepReminders: true, // Home upkeep: jobs coming up, due and late, warranties ending (notify.ts runUpkeep)
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
  /** The language its text goes out in: its owner's (members.language), else the family's (i18n.ts). */
  lang: Lang;
  gateway_credential?: string | null;
  delivery_owner?: string | null;
  delivery_scope?: string | null;
};
/** A push's words, or how to write them in a device's language (i18n.ts perLang for many devices). */
type PushPayload = { title: string; body: string; url?: string; tag?: string };
type PushText = PushPayload | ((lang: Lang) => PushPayload);
const inLang = (p: PushText, lang: Lang | undefined) => (typeof p === 'function' ? p(lang ?? 'en') : p);
/** A nudge line's translator (nudges.ts can't import i18n.ts). */
const nudgeWords = (lang: Lang): NudgeWords => ({ t: words(lang).t, lang });

function subPrefs(row: PushSubRow): typeof DEFAULT_PUSH_PREFS {
  try {
    return { ...DEFAULT_PUSH_PREFS, ...JSON.parse(row.prefs || '{}') };
  } catch {
    return DEFAULT_PUSH_PREFS;
  }
}

// Every push subscription (or those `where` picks, on s = push_subscriptions and k = its api_keys
// row), each with the language its text goes out in. A kid's own device (a display key owned by a
// member, auth.ts deviceOwner) follows only that kid, whatever its row says: routes/push.ts saves
// it that way, and this covers rows saved before it did.
export async function loadSubs(db: KinwallDb, where = '', ...binds: unknown[]): Promise<PushSubRow[]> {
  const stmt = db.prepare(`SELECT s.*, k.owner AS delivery_owner, k.scope AS delivery_scope, CASE WHEN k.scope = 'display' AND k.owner IS NOT NULL AND k.owner <> 'shared' THEN k.owner END AS kid,
      o.language AS owner_lang, (SELECT value FROM settings WHERE key = 'language') AS family_lang
      FROM push_subscriptions s LEFT JOIN api_keys k ON k.id = COALESCE(s.api_key_id,
        (SELECT id FROM api_keys WHERE oauth_grant_id = s.oauth_grant_id ORDER BY created_at DESC, rowid DESC LIMIT 1))
      LEFT JOIN members o ON o.id = k.owner
      ${where ? `WHERE (${where}) AND` : 'WHERE'}
        (s.endpoint NOT LIKE 'apns:%' OR (k.id IS NOT NULL AND
          (k.expires_at IS NULL OR k.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now') OR EXISTS
            (SELECT 1 FROM oauth_refresh_tokens r WHERE r.grant_id = s.oauth_grant_id
              AND r.used_at IS NULL AND r.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')))))`);
  const { results } = await (binds.length ? stmt.bind(...binds) : stmt)
    .all<Omit<PushSubRow, 'lang'> & { kid: string | null; owner_lang: string | null; family_lang: string | null }>();
  return results.map(({ kid, owner_lang, family_lang, ...s }) => {
    const lang: Lang = isLang(owner_lang) ? owner_lang : isLang(family_lang) ? family_lang : 'en';
    return kid ? { ...s, member_ids: JSON.stringify([kid]), lang } : { ...s, lang };
  });
}
/** loadSubs' filter for a change someone made (`by`): leaves out the device they made it on and
 * their other devices. Spread it into loadSubs: loadSubs(db, ...notBy(by)). */
export function notBy(by?: ChangedBy): [string, ...unknown[]] {
  const where: string[] = [], binds: unknown[] = [];
  if (by?.keyId) { where.push('COALESCE(s.api_key_id,k.id) IS NOT ?'); binds.push(by.keyId); }
  if (by?.memberId) { where.push('k.owner IS NOT ?'); binds.push(by.memberId); }
  return [where.join(' AND '), ...binds];
}

/** The devices that belong to a member (their key's owner). */
export const ownSubs = (db: KinwallDb, memberId: string) => loadSubs(db, 'k.owner = ?', memberId);
/** Parent devices (full-access keys). */
export const PARENT_SUBS = "k.scope = 'admin'";

/** The end of a parent-facing medicine note's title written before notes were translated ("Leo's
 * 8:00 AM medicine hasn't been marked yet"): the feed leaves these off kids' devices and walls
 * (routes/push.ts), after opening the note: it's sealed, so SQL can't see which medicine notes are
 * late. Notes written since carry `late` in their sealed text instead, in any language. */
export const MED_LATE = " medicine hasn't been marked yet";

// A device with no member_ids follows everyone. An event/target with no member_ids applies to
// everyone. Otherwise: does the device follow at least one of the target's members?
export function memberMatch(deviceMemberIds: string[], targetMemberIds: string[] | undefined | null): boolean {
  if (!targetMemberIds || targetMemberIds.length === 0) return true;
  if (deviceMemberIds.length === 0) return true;
  return deviceMemberIds.some((id) => targetMemberIds.includes(id));
}

/** Pushes one message to every device following any of `memberIds` (none: every device), dropping
 * subscriptions the push service says are gone. How many devices got it. */
export async function pushToMembers(env: Env, memberIds: string[] | undefined, payload: PushText): Promise<number> {
  let sent = 0;
  for (const row of await loadSubs(env.DB)) {
    if (!memberMatch(parseMemberIds(row.member_ids), memberIds)) continue;
    const result = await sendPush(env, env.DB, row, inLang(payload, row.lang));
    if (result.ok) {
      sent++;
      await env.DB.prepare('UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?').bind(new Date().toISOString(), row.id).run();
    } else if (result.gone) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE id = ? AND auth = ?').bind(row.id, row.auth).run();
    }
  }
  return sent;
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
    ...newscastPrunes(db, now), // announcements and reactions: 30 days
  ]);
}

export type NotificationKind = 'reminder' | 'summary' | 'chore' | 'list' | 'message' | 'goal' | 'medication' | 'privacy' | 'meal' | 'poll' | 'outing' | 'upkeep';
export type NotificationSource = 'system' | 'api' | 'mcp';

// Medicine notes (kind 'medication') are health data (AGENTS.md "Health data"): the title (whose
// medicine, which dose time, that it's late), the body and the exact time are one sealed JSON in
// `title` (aad '<id>:title'); body is null and `at` keeps only the day (UTC midnight), so the
// database and its backups don't show the dose schedule. Plain: id, kind, day, url (the member's
// medicines page), member_ids, source. The feed orders by day, then by rowid (insertion order).
// `late`: a parent-facing "hasn't been marked yet" note (sealed with the rest; the feed hides it from kids).
type NoteText = { title: string; body: string | null; at: string; late?: boolean };
async function sealNote(env: EncryptionEnv, id: string, n: NoteText): Promise<NoteText> {
  return { title: await seal(env, JSON.stringify({ title: n.title, body: n.body, at: n.at, ...(n.late ? { late: true } : {}) }), `${id}:title`), body: null, at: `${n.at.slice(0, 10)}T00:00:00.000Z` };
}
/** A feed row as read: a medicine note opened. One that won't open throws, never reads as empty.
 * Other kinds, and medicine notes saved before sealing, are read as stored. */
export async function openNote<T extends { id: string; kind: string } & NoteText>(env: EncryptionEnv, r: T): Promise<T & { late?: boolean }> {
  if (r.kind !== 'medication' || !isSealed(r.title)) return r;
  const n = JSON.parse(await unseal(env, r.title, `${r.id}:title`)) as NoteText;
  return { ...r, title: n.title, body: n.body, at: n.at, late: !!n.late };
}

/** Seals medicine notes still in plaintext (written before sealing, or by an older server mid-deploy),
 * like sealHealthEntries: a compare-and-swap UPDATE per row, a batch per 50, safe to run twice at
 * once; without a key it waits. createKinwall runs it once per server instance. */
export async function sealMedicationNotes(env: EncryptionEnv & { DB: KinwallDb }): Promise<number> {
  if (!env.ENCRYPTION_KEY) return 0;
  let after = '';
  let sealed = 0;
  for (;;) {
    const { results } = await env.DB.prepare(
      "SELECT id, kind, title, body, at FROM notifications WHERE kind = 'medication' AND id > ? AND substr(title, 1, 7) != 'enc:v1:' ORDER BY id LIMIT 50",
    ).bind(after).all<{ id: string; kind: string } & NoteText>();
    if (!results.length) return sealed;
    const updates = await Promise.all(results.map(async (r) => {
      const s = await sealNote(env, r.id, r);
      return env.DB.prepare("UPDATE notifications SET title = ?, body = NULL, at = ? WHERE id = ? AND kind = 'medication' AND title = ? AND body IS ? AND at = ?")
        .bind(s.title, s.at, r.id, r.title, r.body, r.at);
    }));
    await env.DB.batch(updates);
    sealed += results.length;
    after = results[results.length - 1].id;
  }
}

// The in-app feed (GET /api/notifications): every send site records one row here, push or no
// push, written once in the family's language (familyLang). Bumps rev in the same batch so open walls/phones refetch and the bell updates. A medicine
// note needs the key (`keys`): without it this throws before anything is written, never plaintext.
export async function recordNotification(
  db: KinwallDb,
  n: { kind: NotificationKind; title: string; body?: string | null; url?: string | null; memberIds?: string[]; source: NotificationSource; at?: Date; by?: ChangedBy; late?: boolean },
  keys: EncryptionEnv = {},
): Promise<void> {
  const id = crypto.randomUUID();
  const text = { title: n.title, body: n.body ?? null, at: (n.at ?? new Date()).toISOString() };
  const row = n.kind === 'medication' ? await sealNote(keys, id, { ...text, late: n.late }) : text;
  await db.batch([
    db
      .prepare('INSERT INTO notifications (id, at, kind, title, body, url, member_ids, source, by_key, by_member) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, row.at, n.kind, row.title, row.body, n.url ?? null, JSON.stringify(n.memberIds ?? []), n.source, n.by?.keyId ?? null, n.by?.memberId ?? null),
    db.prepare("INSERT INTO settings (key, value) VALUES ('rev', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1"),
  ]);
}

/** The privacy note to a member when a device (a kid's device, a parent's phone, the app) now
 * belongs to them: it can read their private journal (routes/journal.ts), so that never changes
 * silently. Shown only on their own devices (routes/push.ts feedFilter); callers also write the
 * Security activity line (routes/security-events.ts), which is where parents see it. */
// No url: that's how a kid's device and a wall leave it out (routes/push.ts feedFilter).
export async function recordDeviceOwner(db: KinwallDb, device: string, owner: string | null | undefined, kind?: 'wall' | 'kid' | 'grownup' | null): Promise<void> {
  if (!owner || owner === 'shared') return;
  const m = await db.prepare('SELECT name FROM members WHERE id = ?').bind(owner).first<{ name: string }>();
  if (!m) return;
  const { t } = words(await familyLang(db));
  const what = kind === 'kid' ? t("A kid's device.") : kind === 'grownup' ? t("A grown-up's device.") : '';
  const body = [what, t("It opens {name}'s journal, private entries too.", { name: m.name })].filter(Boolean).join(' ');
  await recordNotification(db, { kind: 'privacy', title: t('{device} now belongs to {name}', { device, name: m.name }), body, memberIds: [owner], source: 'system' });
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
  busy: number;
};

const ENABLED = 'IN (SELECT id FROM calendars WHERE enabled = 1)';

type CalRow = { id: string; kind: string; name: string; member_ids: string; enabled: number };

function fireTime(startIso: string, allDay: boolean, minutes: number, tz: string): number {
  if (!allDay) return Date.parse(startIso) - minutes * 60000;
  const [y, mo, d] = startIso.split('-').map(Number);
  return zonedTimeToUtc({ y, mo: mo - 1, d, h: 0, mi: 0, s: 0 }, tz).getTime() - minutes * 60000;
}

const fmtTime = (iso: string, tz: string, h12: boolean): string => formatTime(iso, { tz, h12 });

export async function sendToSub(env: Env, db: KinwallDb, row: PushSubRow, payload: PushText): Promise<PushSendResult> {
  const result = await sendPush(env, db, row, inLang(payload, row.lang));
  if (result.ok) await db.prepare('UPDATE push_subscriptions SET last_success_at = ? WHERE id = ?').bind(new Date().toISOString(), row.id).run();
  else if (result.gone) await db.prepare('DELETE FROM push_subscriptions WHERE id = ? AND auth = ?').bind(row.id, row.auth).run();
  return result;
}

// One timed or all-day occurrence in the search window, with what the regular reminders use.
// prepAt: a meal's event counts down to starting prep (prepBy.ts) instead of leaving, for prepFor.
// category (name and emoji) and step (a meal recipe's first step) pick a transition headline's hint;
// mealName names a meal's event there ("Tuesday Tacos", not "Dinner · Tuesday Tacos").
type Occurrence = { eventId: string; occurrenceKey: string; title: string; start: string; allDay: boolean; memberIds: string[]; effective: number[]; leadMinutes: number; travelMinutes: number; location: string | null; prepAt: string | null; prepFor: string[]; category: string | null; step: string | null; mealName: string | null };

async function runEventReminders(env: Env, db: KinwallDb, now: Date, tz: string, h12: boolean, defaultReminders: number[], subs: PushSubRow[], hold: boolean): Promise<void> {
  const eligible = subs.filter((s) => subPrefs(s).eventReminders);
  const fam = await familyLang(db);

  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = new Date(now.getTime() + SEARCH_WINDOW_MS);

  const [calsRes, eventsRes, openRes, categoriesRes, membersRes, travelRes, mealsRes] = await db.batch<unknown>([
    db.prepare("SELECT id, kind, name, member_ids, enabled FROM calendars WHERE enabled = 1"),
    ...eventRowsStmts(db, ENABLED, [], from, to),
    db.prepare('SELECT id, name, emoji FROM categories'),
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
  const categoryRows = categoriesRes.results as unknown as { id: string; name: string; emoji: string | null }[];
  const categoryEmojis = new Map(categoryRows.map((c) => [c.id, c.emoji]));
  const categoryText = new Map(categoryRows.map((c) => [c.id, `${c.name} ${c.emoji ?? ''}`.trim()]));
  const events = eventRowsFrom([eventsRes, openRes]);
  const meals = parseMealLinks(mealsRes.results);
  // Hidden and filtered-out events get no reminders, transition warnings or Live Activities.
  const hidden = await hiddenInstanceKeys(db, from, to, events);

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
    // A free event (busy = 0) keeps its own reminders, but no leave-by, transition warnings or Live Activity.
    const free = row.busy === 0;
    const leadMinutes = !free && travel?.remind_before_leave && travel.travel_minutes && !row.all_day ? travel.travel_minutes : 0;
    const meal = row.all_day ? undefined : meals.get(row.id);
    const occ = (start: string): Occurrence => ({
      eventId: row.id, occurrenceKey: start, title: row.title, start, allDay: !!row.all_day, memberIds, effective, leadMinutes, travelMinutes: row.all_day ? 0 : travel?.travel_minutes ?? 0, location: row.location,
      prepAt: meal ? prepAt(start, meal.eventStart, meal.minutes) : null, prepFor: prepFor(meal, memberIds),
      category: row.category_id ? categoryText.get(row.category_id) ?? null : null, step: stepHint(meal?.firstStep), mealName: meal?.name ?? null,
    });

    if (cal.kind === 'local' && row.rrule) {
      for (const inst of expand(row.rrule, row.start, row.end, !!row.all_day, tz, from, to)) {
        if (hidden.has(instanceKey(row.id, inst.start))) continue;
        if (!free) occurrences.push(occ(inst.start));
        for (const minutes of effective) {
          candidates.push({ eventId: row.id, occurrenceKey: inst.start, title: row.title, start: inst.start, allDay: !!row.all_day, memberIds, categoryId: row.category_id, minutes, leadMinutes, row, calName: cal.name });
        }
      }
      continue;
    }
    const startMs = row.all_day ? Date.parse(`${row.start}T00:00:00Z`) : Date.parse(row.start);
    if (startMs < from.getTime() || startMs >= to.getTime() || hidden.has(instanceKey(row.id, row.start))) continue;
    if (!free) occurrences.push(occ(row.start));
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
    // Event name as the title: it's what you scan for, and iOS already adds "from Kinwall" under it.
    // First line is what shows collapsed; the rest appears when the notification is long-pressed.
    const who = cand.memberIds.map((id) => memberNames.get(id)).filter(Boolean).join(', ');
    const notes = cand.row.description?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    const leaveBy = cand.leadMinutes ? fmtTime(new Date(Date.parse(cand.start) - cand.leadMinutes * 60000).toISOString(), tz, h12) : null;
    const at = cand.allDay ? cand.occurrenceKey : new Date(cand.start).toISOString();
    const payload = perLang((lang) => {
      const { t, tn } = words(lang);
      const m = cand.minutes;
      const when = m === 0 ? t('Now') : m % 60 === 0 ? tn(m / 60, 'In {n} hour', 'In {n} hours') : tn(m, 'In {n} minute', 'In {n} minutes');
      const timeLabel = cand.allDay ? t('All day') : fmtTime(cand.start, tz, h12);
      const lines = [
        leaveBy ? t('Leave by {time} for {event} · starts {start}', { time: leaveBy, event: cand.title, start: timeLabel }) : `${when} · ${timeLabel}`,
        cand.row.location && `📍 ${cand.row.location.replace(/\s*\n\s*/g, ', ')}`,
        who && `👥 ${who}`,
        `🗓 ${cand.calName}`,
        notes && (notes.length > 140 ? `${notes.slice(0, 139)}…` : notes),
      ].filter(Boolean);
      return {
        title: `${emoji ? emoji + ' ' : ''}${cand.title}`,
        body: lines.join('\n'),
        url: `/#/calendar?event=${encodeURIComponent(cand.eventId)}&at=${encodeURIComponent(at)}`, // tap opens this event
        tag: `event:${cand.eventId}`,
      };
    });

    const feedKey = `feed:rem:${cand.eventId}:${cand.occurrenceKey}:${cand.minutes}`;
    if (!(await alreadySent(db, feedKey))) {
      const { title, body, url } = payload(fam);
      await recordNotification(db, { kind: 'reminder', title, body, url, memberIds: cand.memberIds, source: 'system', at: now });
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

  if (!hold) await runTransitionReminders(env, db, now, tz, h12, occurrences, eligible);
  await runLiveActivities(env, db, now, tz, h12, occurrences, hold);
}

/** A person's transition times: their picked minutes plus every `repeat.every` during the last
 * `repeat.within`, deduped, latest first. [10, 5] + every 5 in the last 15 -> [15, 10, 5]. */
export function transitionTimes(minutes: number[], repeat: { every: number; within: number } | null): number[] {
  const all = new Set(minutes);
  if (repeat && repeat.every > 0) for (let m = repeat.every; m <= repeat.within; m += repeat.every) all.add(m);
  return [...all].filter((m) => m >= 1 && m <= 120).sort((a, b) => b - a);
}

// Is it night? `now` (household tz) inside the family's night hours "HH:MM"-"HH:MM" (quietFrom /
// quietTo; may wrap midnight). The server's one check; walls use web/src/wallScreen.ts isNight.
export function isNight(from: string | undefined, to: string | undefined, now: Date, tz: string): boolean {
  if (!from || !to || from === to) return false;
  const hm = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  return from < to ? hm >= from && hm < to : hm >= from || hm < to;
}

// Per-person transition reminders: for each member who has them on, calm pushes before their
// timed events ("Soccer in 10 minutes", "Leave for Soccer in 5 minutes") to devices that belong to
// them (the device's key has them as owner) and have event reminders on. Untagged events count as
// everyone's, like everywhere else. Skipped when a regular reminder for the same event lands on
// that device in the same minute, and during night hours (the caller checks). Not recorded in the
// household feed: they're personal and frequent.
async function runTransitionReminders(env: Env, db: KinwallDb, now: Date, tz: string, h12: boolean, occurrences: Occurrence[], eligible: PushSubRow[]): Promise<void> {
  if (!eligible.length) return;
  const [membersRes, keysRes] = await db.batch<unknown>([
    db.prepare('SELECT id, name, transitions, nudges FROM members WHERE transitions IS NOT NULL'),
    db.prepare("SELECT id, owner FROM api_keys WHERE owner IS NOT NULL AND owner <> 'shared'"),
  ]);
  const ownerOfKey = new Map((keysRes.results as { id: string; owner: string }[]).map((k) => [k.id, k.owner]));
  const minute = (ms: number) => Math.floor(ms / 60000);

  for (const m of membersRes.results as { id: string; name: string; transitions: string; nudges: string | null }[]) {
    const cfg = parseTransitions(m.transitions);
    const times = cfg.on ? transitionTimes(cfg.minutes, cfg.repeat) : [];
    const devices = eligible.filter((s) => s.api_key_id && ownerOfKey.get(s.api_key_id) === m.id);
    if (!times.length || !devices.length) continue;
    // Their last few headlines (part indexes), so the next one is different: saved when one is sent.
    let seen: NudgeSeen[] = [];
    try { seen = m.nudges ? JSON.parse(m.nudges) : []; } catch { /* start over */ }
    const seenBefore = seen;

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
      const by = fmtTime(new Date(target).toISOString(), tz, h12), starts = fmtTime(occ.start, tz, h12);
      // Varied, kind and escalating (nudges.ts), unlike their last few; the body keeps the plain facts.
      // The same line in each device's language (picked from the history as it was before this one).
      const args = { kind: occ.prepAt ? 'prep' as const : lead ? 'leave' as const : 'start' as const, title: occ.mealName ?? occ.title, minutes: left, at: by, seed: `${m.id}:${occ.eventId}:${occ.occurrenceKey.slice(0, 10)}`, ordinal: times.indexOf(due[due.length - 1]), name: m.name.split(' ')[0], category: occ.category, step: occ.step };
      const history = seen;
      const headline = pickNudge(args, history);
      const payload = perLang((lang) => {
        const { t } = words(lang);
        const when = occ.prepAt ? (by === starts ? t('Start prep by {by}', { by }) : t('Start prep by {by} · starts {starts}', { by, starts })) : lead ? t('Leave by {by} · starts {starts}', { by, starts }) : t('Starts at {starts}', { starts });
        return {
          title: lang === 'en' ? headline.line : pickNudge(args, history, nudgeWords(lang)).line,
          body: [when, occ.location && `📍 ${occ.location.replace(/\s*\n\s*/g, ', ')}`].filter(Boolean).join('\n'),
          url: `/#/calendar?event=${encodeURIComponent(occ.eventId)}&at=${encodeURIComponent(new Date(occ.start).toISOString())}`,
          tag: `transition:${occ.eventId}`, // each one replaces the last on the lock screen
        };
      });
      for (const sub of devices) {
        const keys = due.map((t) => `tr:${sub.id}:${occ.eventId}:${occ.occurrenceKey}:${t}`);
        const latest = due[due.length - 1];
        const fireMinute = minute(target - latest * 60000);
        const doubled = memberMatch(parseMemberIds(sub.member_ids), occ.memberIds) && regular.includes(fireMinute);
        if (!doubled && !(await alreadySent(db, keys[keys.length - 1]))) {
          await sendToSub(env, db, sub, payload);
          if (headline.seen) seen = rememberNudge(seen, headline.seen);
        }
        for (const key of keys) await markSent(db, key, now);
      }
    }
    if (seen !== seenBefore) await db.prepare('UPDATE members SET nudges = ? WHERE id = ?').bind(JSON.stringify(seen), m.id).run();
  }
}

// The iPhone app's leave-by / start-prep Live Activity while the app is closed (apns.ts; the app
// starts it itself while open, web/src/liveActivity.ts). Pushed to start at the person's first
// transition warning, to their own devices (the device's owner is them) that registered a
// push-to-start token, never during night hours; ended with the activity's own update token once
// the event starts (or GRACE after the time, if later). Nothing at all unless APNs is set up.
const LIVE_GRACE_MS = 5 * 60000; // web/src/liveActivity.ts GRACE_MIN
type LiveTokenRow = { id: string; device: string; kind: 'start' | 'update'; activity: string; token: string; ends_at: string | null; owner: string | null };

async function runLiveActivities(env: Env, db: KinwallDb, now: Date, tz: string, h12: boolean, occurrences: Occurrence[], hold: boolean): Promise<void> {
  if (!await nativePushConfigured(env)) return;
  const [tokensRes, membersRes] = await db.batch<unknown>([
    db.prepare('SELECT t.id, t.device, t.kind, t.activity, t.token, t.ends_at, COALESCE(k.owner, g.owner) AS owner FROM live_activity_tokens t LEFT JOIN api_keys k ON k.id = t.api_key_id LEFT JOIN oauth_grants g ON g.id = t.oauth_grant_id'),
    db.prepare('SELECT id, name, transitions, language FROM members WHERE transitions IS NOT NULL'),
  ]);
  const tokens = tokensRes.results as LiveTokenRow[];
  if (!tokens.length) return;
  const send = async (t: LiveTokenRow, aps: Record<string, unknown>) => {
    const res = await sendNativeLiveActivity(env, await unseal(env, t.token, `live-activity-token:${t.id}`), aps);
    if (res.gone) await db.prepare('DELETE FROM live_activity_tokens WHERE id = ? AND token = ?').bind(t.id, t.token).run();
    return res;
  };
  const key = (occ: Occurrence) => `leaveBy:${occ.eventId}@${new Date(occ.start).toISOString()}`;

  // What the activity shows (the app's KinwallActivityAttributes / ContentState, native side), in
  // the person's language, else the family's.
  const members = membersRes.results as { id: string; name: string; transitions: string; language: string | null }[];
  const fam = await familyLang(db);
  const shown = (occ: Occurrence, m: { id: string; name: string; language: string | null }, target: number) => {
    const lang = isLang(m.language) ? m.language : fam;
    const { t } = words(lang);
    const w = nudgeWords(lang);
    const by = fmtTime(new Date(target).toISOString(), tz, h12);
    const args = { kind: occ.prepAt ? 'prep' as const : 'leave' as const, title: occ.mealName ?? occ.title, at: by, seed: `${m.id}:${occ.eventId}:${occ.occurrenceKey.slice(0, 10)}`, name: m.name.split(' ')[0], category: occ.category, step: occ.step, live: true };
    const headline = nudge({ ...args, minutes: Math.ceil((target - now.getTime()) / 60000) }, [], w);
    const body = occ.prepAt ? t('Start prep by {by}', { by }) : t('Leave by {by} · starts {starts}', { by, starts: fmtTime(occ.start, tz, h12) });
    return { content: { title: headline, detail: nudge({ ...args, minutes: 0 }, [], w), date: swiftDate(target), count: 0, done: false }, alert: { title: headline, body } };
  };

  // End the ones that are over (sent or not, the token is done).
  for (const t of tokens.filter((x) => x.kind === 'update' && x.ends_at && Date.parse(x.ends_at) <= now.getTime())) {
    await send(t, { timestamp: unixSeconds(now.getTime()), event: 'end', 'dismissal-date': unixSeconds(now.getTime()) });
    await db.prepare('DELETE FROM live_activity_tokens WHERE id = ? AND token = ?').bind(t.id, t.token).run();
  }
  if (hold) return;

  for (const m of members) {
    const cfg = parseTransitions(m.transitions);
    const first = cfg.on ? transitionTimes(cfg.minutes, cfg.repeat)[0] : undefined;
    const devices = tokens.filter((t) => t.kind === 'start' && t.owner === m.id);
    if (!first || !devices.length) continue;
    for (const occ of occurrences) {
      if (occ.allDay || !memberMatch([m.id], occ.prepFor)) continue;
      const lead = cfg.leaveBy ? occ.travelMinutes : 0;
      if (!occ.prepAt && !lead) continue; // a leave-by or start-prep time only
      const target = occ.prepAt ? Date.parse(occ.prepAt) : Date.parse(occ.start) - lead * 60000;
      const ends = Math.max(Date.parse(occ.start), target + LIVE_GRACE_MS);
      if (now.getTime() < target - first * 60000 || now.getTime() >= ends) continue;
      const activity = key(occ);
      const { content, alert } = shown(occ, m, target);
      for (const t of devices) {
        // Already showing (the app started it, or an earlier push did and registered its token).
        if (tokens.some((u) => u.kind === 'update' && u.device === t.device && u.activity === activity)) continue;
        const sentKey = `la:${t.device}:${activity}`;
        if (await alreadySent(db, sentKey)) continue;
        const res = await send(t, {
          timestamp: unixSeconds(now.getTime()),
          event: 'start',
          'attributes-type': 'KinwallActivityAttributes',
          attributes: { kind: occ.prepAt ? 'prep' : 'leave', name: occ.title, eventId: occ.eventId, activity, endsAt: swiftDate(ends) },
          'content-state': content,
          'stale-date': unixSeconds(target),
          alert,
        });
        if (res.ok || res.gone) await markSent(db, sentKey, now);
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

  let hidden: Set<string> | undefined; // read once, for the first target that needs it
  const fam = await familyLang(db);
  for (const sub of targets) {
    const key = sub ? `sum:${sub.id}:${today}` : `feed:sum:${today}`;
    if (await alreadySent(db, key)) continue;
    const { t, tn } = words(sub ? sub.lang : fam);

    const dayStart = new Date(`${today}T00:00:00Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const [eventsRes, openRes, choresRes, linkedRes, dueRes, mealsRes] = await db.batch<unknown>([
      ...eventRowsStmts(db, ENABLED, [], dayStart, dayEnd),
      db.prepare('SELECT * FROM chores WHERE active = 1'),
      // Urgent/important items first (so they make the top 3) and marked.
      db.prepare(`SELECT event_id, title, priority FROM list_items WHERE done = 0 AND event_id IS NOT NULL ORDER BY ${priorityRankSql()}, sort, created_at`),
      db.prepare(`SELECT title, priority, member_id FROM list_items WHERE done = 0 AND due_date = ? ORDER BY ${priorityRankSql()}, sort, created_at`).bind(today),
      db.prepare("SELECT slot, title FROM meals WHERE date = ? ORDER BY CASE slot WHEN 'breakfast' THEN 0 WHEN 'lunch' THEN 1 WHEN 'dinner' THEN 2 ELSE 3 END, planned_time, created_at").bind(today),
    ]);
    const mark = (r: { title: string; priority: string }) => `${r.priority === 'urgent' ? '‼️ ' : r.priority === 'high' ? '⭐ ' : ''}${r.title}`;
    const top3 = (titles: string[]) => titles.slice(0, 3).join(', ') + (titles.length > 3 ? ` ${t('+{n} more', { n: titles.length - 3 })}` : '');
    const linked = new Map<string, string[]>();
    for (const r of features.lists ? linkedRes.results as unknown as { event_id: string; title: string; priority: string }[] : []) {
      linked.set(r.event_id, [...(linked.get(r.event_id) ?? []), mark(r)]);
    }
    const events = eventRowsFrom([eventsRes, openRes]);
    hidden ??= await hiddenInstanceKeys(db, dayStart, dayEnd, events);
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
        const insts = expand(row.rrule, row.start, row.end, !!row.all_day, tz, dayStart, dayEnd).filter((i) => !hidden!.has(instanceKey(row.id, i.start)));
        if (insts.length > 0) {
          eventCount += insts.length;
          todaysTitles.push(row.title);
          addTodo(row);
        }
        continue;
      }
      const startMs = row.all_day ? Date.parse(`${row.start}T00:00:00Z`) : Date.parse(row.start);
      const endMs = row.all_day ? Date.parse(`${row.end}T00:00:00Z`) : Date.parse(row.end);
      if (endMs > dayStart.getTime() && startMs < dayEnd.getTime() && !hidden.has(instanceKey(row.id, row.start))) {
        eventCount++;
        todaysTitles.push(row.title);
        addTodo(row);
      }
    }
    const goalStates = await goalProgressFor(db, choresRes.results as ChoreRow[], today);
    const chores = (choresRes.results as unknown as ChoreRow[]).filter((row) => dueOnDate(row, today, tz) && !goalStates.get(row.id)?.full);
    const first = todaysTitles.slice(0, 2).join(', ') + (todaysTitles.length > 2 ? '…' : '');
    const counts = [tn(eventCount, '{n} event', '{n} events'), ...(features.chores ? [tn(chores.length, '{n} chore', '{n} chores')] : [])];
    let body = `${counts.join(' · ')}${first ? ` — ${first}` : ''}`;
    const meals = mealsRes.results as { slot: string; title: string }[];
    const slots: Record<string, string> = { breakfast: t('Breakfast'), lunch: t('Lunch'), dinner: t('Dinner'), snack: t('Snack') };
    if (features.meals && meals.length) body += `\n${t('Meals: {list}', { list: top3(meals.map((m) => `${slots[m.slot] ?? m.slot} · ${m.title}`)) })}`;
    if (todo.length) body += `\n${t("To do for today's events:")}\n${todo.join('\n')}`;
    // List items due today (any list), for this device's members like the chore nudge.
    const due = features.lists ? (dueRes.results as unknown as { title: string; priority: string; member_id: string | null }[]).filter((r) => memberMatch(deviceMemberIds, r.member_id ? [r.member_id] : [])) : [];
    if (due.length) body += `\n${t('Due today: {list}', { list: top3(due.map(mark)) })}`;
    if (sub) await sendToSub(env, db, sub, { title: t('Today'), body, url: '/' });
    else await recordNotification(db, { kind: 'summary', title: t('Today'), body, url: '/', source: 'system', at: now });
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
  const goalStates = await goalProgressFor(db, chores, today);
  const dueToday = chores.filter((c) => dueOnDate(c, today, tz) && !done.has(c.id) && !goalStates.get(c.id)?.full);
  const fam = await familyLang(db);

  for (const sub of targets) {
    const key = sub ? `nudge:${sub.id}:${today}` : `feed:nudge:${today}`;
    if (await alreadySent(db, key)) continue;
    const deviceMemberIds = sub ? parseMemberIds(sub.member_ids) : [];
    const mine = dueToday.filter((c) => memberMatch(deviceMemberIds, c.member_id ? [c.member_id] : []));
    if (mine.length === 0) continue;
    const titles = mine.slice(0, 3).map((c) => c.title).join(', ');
    const { tn } = words(sub ? sub.lang : fam);
    const payload = { title: tn(mine.length, '{n} chore left today', '{n} chores left today'), body: titles, url: '/chores' };
    if (sub) await sendToSub(env, db, sub, payload);
    else await recordNotification(db, { kind: 'chore', ...payload, memberIds: [...new Set(mine.flatMap((c) => (c.member_id ? [c.member_id] : [])))], source: 'system', at: now });
    await markSent(db, key, now);
  }
}

// Called from routes/lists.ts right after a list item is created (not on the periodic tick - a
// new grocery item should notify promptly). Debounced to one notification per list per 10 min via
// sent_notifications' key granularity (a 10-min time bucket).
// Not to the device (or person) that added them (`by`).
export function notifyListUpdate(env: Env, execCtx: WaitCtx | undefined, listId: string, listName: string, by: ChangedBy): void {
  waitUntil(
    execCtx,
    (async () => {
      if (!(await readFeatures(env.DB)).lists) return; // Lists turned off in Settings
      const now = new Date();
      const bucket = Math.floor(now.getTime() / (10 * 60 * 1000));
      const key = `list:${listId}:${bucket}`;
      if (await alreadySent(env.DB, key)) return;
      await markSent(env.DB, key, now);
      const payload = perLang((lang) => {
        const { t } = words(lang);
        return { title: t('List updated'), body: t('{list} has new items', { list: listName }), url: `/#/lists?list=${encodeURIComponent(listId)}`, tag: `list:${listId}` }; // tap opens that list
      });
      const { title, body, url } = payload(await familyLang(env.DB));
      await recordNotification(env.DB, { kind: 'list', title, body, url, source: 'system', at: now, by });
      for (const sub of (await loadSubs(env.DB, ...notBy(by))).filter((s) => subPrefs(s).listUpdates)) await sendToSub(env, env.DB, sub, payload);
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
// Sent during night hours too: it's the person's own chosen time (the family asked for that).
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
    const payload = perLang((lang) => {
      const { t } = words(lang);
      return goal
        ? { title: t('Did you finish your goal? 🎯'), body: goal, url: `/#/journal/${m.id}`, tag: key }
        : { title: t('How drained do you feel? 🔋'), body: t('A quick check-in before bed.'), url: `/#/journal/${m.id}`, tag: key };
    });
    if (goal) {
      const { title, body, url } = payload(await familyLang(db));
      await recordNotification(db, { kind: 'goal', title, body, url, memberIds: [m.id], source: 'system', at: now });
    }
    for (const sub of await ownSubs(db, m.id)) await sendToSub(env, db, sub, payload);
  }
}

// Last night's check-in (routes/temp-check.ts): when yesterday's evening check (goal check or
// "How drained?") was left unanswered and is still open (not skipped, their morning Temp check not
// answered), one generic push to devices that belong to them, from LAST_NIGHT_PUSH_AT until the
// window closes at noon, held through night hours. Once per person per night (a hash key, like the
// battery's). The text says nothing about the answers or the goal; not in the family feed.
export const LAST_NIGHT_PUSH_AT = '07:00';
async function runLastNightReminders(env: Env, db: KinwallDb, now: Date, tz: string): Promise<void> {
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  if (clock < LAST_NIGHT_PUSH_AT || clock >= LAST_NIGHT_UNTIL) return;
  const today = todayInTz(tz, now);
  const night = addDays(today, -1);
  const { results } = await db
    .prepare(`SELECT m.id, m.temp_check, y.goal, y.goal_skipped, y.followup, y.drained, t.sleep, t.feelings, t.goal AS t_goal, t.goal_skipped AS t_goal_skipped
      FROM members m LEFT JOIN temp_checks y ON y.member_id = m.id AND y.date = ? LEFT JOIN temp_checks t ON t.member_id = m.id AND t.date = ? WHERE m.temp_check IS NOT NULL`)
    .bind(night, today)
    .all<{ id: string; temp_check: string; goal: string | null; goal_skipped: number | null; followup: string | null; drained: string | null; sleep: string | null; feelings: string | null; t_goal: string | null; t_goal_skipped: number | null }>();
  for (const m of results) {
    if (!eveningPending(parseTempCheck(m.temp_check), { goal: m.goal, goal_skipped: m.goal_skipped ?? 0, followup: m.followup, drained: m.drained })) continue;
    if (morningAnswered({ sleep: m.sleep, feelings: m.feelings, goal: m.t_goal, goal_skipped: m.t_goal_skipped ?? 0 })) continue;
    if (await db.prepare('SELECT 1 FROM sent_notifications WHERE key = ?').bind(await lastNightSkipKey(m.id, night)).first()) continue;
    const subs = await ownSubs(db, m.id);
    if (!subs.length) continue;
    const key = `lastnight:${await sha256Hex(`${m.id}:${night}`)}`;
    if (!(await db.prepare('INSERT INTO sent_notifications (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(key, now.toISOString()).run()).meta.changes) continue;
    const payload = (lang: Lang) => {
      const { t } = words(lang);
      return { title: t("Last night's check-in is still open 🌙"), body: t('Finish it or skip it.'), url: `/#/journal/${m.id}`, tag: `lastnight:${m.id}` };
    };
    for (const sub of subs) await sendToSub(env, db, sub, payload);
  }
}

// Medication reminders (routes/medications.ts), for each dose that isn't taken or skipped:
// - at its time (household; a "When I start my day" dose when their day starts), "Time for Leo's medicine" to devices that belong to them (key owner),
//   and one row in the in-app feed;
// - when a snooze runs out, the same push again (once per snooze, no feed row);
// - when its late window is longer than 3 hours ('evening', 'endOfDay'), one kind follow-up halfway
//   through, "Still time for Leo's medicine (until 8 PM)" (nudges.ts MED_FOLLOWUPS), to the same
//   devices and no feed row: halfway leaves real time to take it, and one is enough;
// - for a kid (not grownUp), "Leo's 8:00 AM medicine hasn't been marked yet" to parent devices (admin
//   keys) and the feed: 30 minutes after its time, or with a late window past 3 hours when about an
//   hour of it is left (7 PM for 'evening'): the gentler default, so a kid who sleeps in isn't
//   chased at 8:30 for a dose that's fine until 8 PM, and parents still hear in time to help.
// Push text is generic unless the device turned on medicationNames. Each is claimed once (an
// insert into sent_notifications, keyed by a hash so the table never says what or when) and only
// within GRACE of its time, so a late tick still sends and a restart never repeats. Medicine pushes
// go out during night hours too: a missed dose matters more than a quiet night (the family asked).
export { REFILL_REMIND_AT } from './medicine-reminder-times.ts';
async function runMedicationReminders(env: Env, db: KinwallDb, now: Date, tz: string, h12: boolean): Promise<void> {
  const meds = await loadMedications(env);
  if (!meds.length) { await db.prepare('DELETE FROM push_retries').run(); return; }
  const today = todayInTz(tz, now);
  const yesterday = addDays(today, -1);
  const logs = await loadLogs(env, meds.map((m) => m.id), yesterday, today);
  const { results: members } = await db.prepare('SELECT id, name, grown_up FROM members').all<{ id: string; name: string; grown_up: number }>();
  const byId = new Map(members.map((m) => [m.id, m]));
  // Bind pending text to the complete current dose/recipient state. A taken, skipped, snoozed,
  // edited or removed dose cancels it conservatively, including grouped reminders.
  const retryVersion = await sha256Hex(JSON.stringify([tz, h12, meds, [...logs].sort(([a], [b]) => a.localeCompare(b)), members]));
  await retryMedicinePushes(env, await loadSubs(db), retryVersion, now.getTime(), (sub, payload) => sendToSub(env, db, sub, payload));
  const claim = async (target: number, what: string) => {
    if (now.getTime() < target || now.getTime() - target >= MED_GRACE_MS) return false;
    const key = `med:${await sha256Hex(what)}`;
    return !!(await db.prepare('INSERT INTO sent_notifications (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(key, now.toISOString()).run()).meta.changes;
  };
  const due = new Map<string, { meds: Medication[]; feed: boolean }>(); // by member
  const late = new Map<string, { memberId: string; time: string; meds: Medication[] }>(); // by member + date + time
  const follow = new Map<string, { memberId: string; seed: string; end: number; meds: Medication[] }>(); // by member + window end
  for (const m of meds) {
    const member = byId.get(m.memberId);
    if (!member) continue;
    for (const date of [yesterday, today]) {
      if (!scheduledOn(m, date)) continue;
      for (const t of m.times) {
        const time = timeKey(t);
        const e = logs.get(`${m.id}:${date}`)?.[time];
        if (e?.status) continue;
        // A "When I start my day" dose: from when their day started (startDay), else its latest time.
        // The claims are keyed by 'wake', so a start that comes in later never sends it twice.
        const targets = medicineReminderTimes(m, date, t, tz, e, !!member.grown_up);
        const end = targets.end;
        if (targets.follow && (await claim(targets.follow.at, targets.follow.key))) {
          const k = `${m.memberId}:${end}`;
          follow.set(k, { memberId: m.memberId, seed: `${m.id}:${date}:${time}`, end, meds: [...(follow.get(k)?.meds ?? []), m] });
        }
        const first = await claim(targets.due.at, targets.due.key);
        if (first || (targets.snooze && (await claim(targets.snooze.at, targets.snooze.key)))) {
          const d = due.get(m.memberId) ?? { meds: [], feed: false };
          due.set(m.memberId, { meds: [...d.meds, m], feed: d.feed || first });
        }
        // A long window: parents hear when about an hour is left, not 30 minutes in.
        if (targets.late && (await claim(targets.late.at, targets.late.key))) {
          const k = `${m.memberId}:${date}:${time}`;
          late.set(k, { memberId: m.memberId, time, meds: [...(late.get(k)?.meds ?? []), m] });
        }
      }
    }
  }
  // The words in each device's language: a title and the body for a device without medicine names.
  const send = async (subs: PushSubRow[], text: (lang: Lang) => { title: string; generic: string }, named: Medication[], url: string, tag: string) => {
    for (const sub of subs) {
      const { title, generic } = text(sub.lang);
      const payload = { title, body: subPrefs(sub).medicationNames ? named.map(medicineLabel).join(', ') : generic, url, tag };
      const result = await sendToSub(env, db, sub, payload);
      if (!result.ok && !result.gone && !tag.startsWith('med-refill:')) await enqueueMedicinePush(env, sub, payload, retryVersion, now.getTime());
    }
  };
  const fam = await familyLang(db);
  for (const [memberId, d] of due) {
    const name = byId.get(memberId)!.name;
    const text = perLang((lang) => {
      const { t } = words(lang);
      return { title: t("Time for {name}'s medicine", { name }), generic: t('Tap to mark it taken.') };
    });
    const url = `/#/medications/${memberId}`;
    if (d.feed) await recordNotification(db, { kind: 'medication', title: text(fam).title, url, memberIds: [memberId], source: 'system', at: now }, env);
    await send(await ownSubs(db, memberId), text, d.meds, url, `med:${memberId}`);
  }
  for (const f of follow.values()) {
    const hm = formatTime(new Date(f.end), { h12: false, tz });
    const text = perLang((lang) => {
      const { t } = words(lang);
      const until = hm === '00:00' ? t('midnight') : formatTime(hm, { h12, hourOnly: hm.endsWith(':00') });
      return { title: medFollowup(byId.get(f.memberId)!.name, until, f.seed, nudgeWords(lang)), generic: t('Tap to mark it taken.') };
    });
    await send(await ownSubs(db, f.memberId), text, f.meds, `/#/medications/${f.memberId}`, `med:${f.memberId}`);
  }
  // A refill reminder day (refill.remindOn, routes/medication-refills.ts): from 9 AM that household day,
  // a "Request refill" to-do once (and the bell note), and a push: a grown-up's own devices, a kid's parents.
  for (const m of meds) {
    const on = m.refill.remindOn;
    const member = byId.get(m.memberId);
    if (!on || !member || on > today || (on === today && now.getTime() < doseAt(today, REFILL_REMIND_AT, tz))) continue;
    const opened = await openRefillRequest(env, m.id, null, { clearRemindOn: true });
    if (!opened || opened === 'open') continue;
    const subs = member.grown_up ? await ownSubs(db, m.memberId) : await loadSubs(db, PARENT_SUBS);
    await send(subs, (lang) => {
      const { t } = words(lang);
      return { title: t("Time to ask for a refill of {name}'s medicine", { name: member.name }), generic: t('Tap to see how.') };
    }, [m], `/#/medications/${m.memberId}`, `med-refill:${m.id}`);
  }
  if (!late.size) return;
  const parents = await loadSubs(db, PARENT_SUBS);
  for (const l of late.values()) {
    const text = perLang((lang) => {
      const { t } = words(lang);
      const time = l.time === WAKE ? t('start-of-day') : formatTime(l.time, { h12 });
      return { title: t("{name}'s {time} medicine hasn't been marked yet", { name: byId.get(l.memberId)!.name, time }), generic: t('Tap to check.') };
    });
    const url = `/#/medications/${l.memberId}`;
    await recordNotification(db, { kind: 'medication', title: text(fam).title, url, memberIds: [l.memberId], source: 'system', at: now, late: true }, env);
    await send(parents, text, l.meds, url, `med-late:${l.memberId}`);
  }
}

/** Due medicine reminders only, for hosts that wake between maintenance ticks. */
export async function runMedicineReminders(env: Env, now: Date): Promise<void> {
  if (!(await readFeatures(env.DB)).trackersHealth || (await env.DB.prepare("SELECT value FROM settings WHERE key='medications'").first<{ value: string }>())?.value !== 'true') return;
  const { results } = await env.DB.prepare("SELECT key,value FROM settings WHERE key IN ('timezone','timeFormat','location')").all<{ key: string; value: string }>();
  const prefs = new Map(results.map(r => [r.key,r.value]));
  let countryCode: string | undefined;
  try { countryCode = JSON.parse(prefs.get('location') ?? 'null')?.countryCode; } catch { /* no location */ }
  await runMedicationReminders(env, env.DB, now, prefs.get('timezone') ?? hostTimezone(), hour12For(prefs.get('timeFormat'), countryCode));
}

// Energy battery heads-up (battery.ts, Temp check → battery): when a person's next day looks likely
// to run their battery low, one calm push to devices that belong to them: from 7 PM the evening
// before, or held through night hours until they end (by noon, then it says "today"). Once per person
// per day: claimed in one insert, keyed by a hash so sent_notifications never says who or which day.
// The text is from the calendar and chores only, never sleep or feelings; not in the family feed.
export const BATTERY_PUSH_AT = '19:00';
export const BATTERY_PUSH_UNTIL = '12:00'; // a push held by night hours still goes out the morning of the day
async function runBatteryHeadsUp(env: Env, db: KinwallDb, now: Date, tz: string): Promise<void> {
  const clock = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now);
  const today = todayInTz(tz, now);
  const day = clock >= BATTERY_PUSH_AT ? addDays(today, 1) : clock < BATTERY_PUSH_UNTIL ? today : null;
  if (!day) return;
  const { results: members } = await db.prepare('SELECT id, temp_check FROM members WHERE temp_check IS NOT NULL').all<{ id: string; temp_check: string }>();
  for (const m of members) {
    const s = parseTempCheck(m.temp_check);
    if (!s.on || !s.battery) continue;
    const subs = await ownSubs(db, m.id);
    if (!subs.length) continue;
    const key = `battery:${await sha256Hex(`${m.id}:${day}`)}`;
    if (!(await db.prepare('INSERT INTO sent_notifications (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(key, now.toISOString()).run()).meta.changes) continue;
    // The heads-up in each device's language (the battery's words come from batteryFor).
    const warnings = new Map<Lang, string | undefined>();
    for (const lang of new Set(subs.map((s) => s.lang))) warnings.set(lang, (await batteryFor(env, m.id, tz, now, lang)).warnings.find((w) => w.date === day)?.text);
    for (const sub of subs) {
      const body = warnings.get(sub.lang);
      if (!body) continue;
      const { t } = words(sub.lang);
      await sendToSub(env, db, sub, { title: day === today ? t('🔋 Heads-up for today') : t('🔋 Heads-up for tomorrow'), body, url: `/#/insights/${m.id}`, tag: `battery:${m.id}` });
    }
  }
}

// Borrowed library books (routes/library.ts): at LIBRARY_DUE_AT (household), books due back in
// LIBRARY_DUE_DAYS days and books due today, one push to parent devices and a row in the family feed.
// Once per book per due date per heads-up; returning it (or moving the date) stops it.
export const LIBRARY_DUE_AT = '09:00';
export const LIBRARY_DUE_DAYS = 2;
async function runLibraryDue(env: Env, db: KinwallDb, now: Date, tz: string, windowStart: Date): Promise<void> {
  if (!timeInWindow(LIBRARY_DUE_AT, tz, windowStart, now)) return;
  const today = todayInTz(tz, now);
  const soon = addDays(today, LIBRARY_DUE_DAYS);
  const { results } = await db.prepare('SELECT id, title, borrowed_from, due_on FROM library_books WHERE borrowed_from IS NOT NULL AND returned_on IS NULL AND due_on IN (?, ?) ORDER BY title')
    .bind(today, soon).all<{ id: string; title: string; borrowed_from: string; due_on: string }>();
  const fresh: typeof results = [];
  for (const b of results) {
    const key = `librarydue:${b.id}:${b.due_on}:${b.due_on === today ? 'today' : 'soon'}`;
    if (await alreadySent(db, key)) continue;
    await markSent(db, key, now);
    fresh.push(b);
  }
  if (!fresh.length) return;
  const parents = await loadSubs(db, PARENT_SUBS);
  const fam = await familyLang(db);
  for (const when of [today, soon]) {
    const books = fresh.filter((b) => b.due_on === when);
    if (!books.length) continue;
    const payload = perLang((lang) => {
      const { t } = words(lang);
      const vars = { title: books[0].title, n: books.length, days: LIBRARY_DUE_DAYS };
      const title = books.length === 1
        ? (when === today ? t('📚 {title} is due back today', vars) : t('📚 {title} is due back in {days} days', vars))
        : (when === today ? t('📚 {n} borrowed books are due back today', vars) : t('📚 {n} borrowed books are due back in {days} days', vars));
      const body = books.map((b) => (books.length === 1 ? t('To {person}', { person: b.borrowed_from }) : t('{title} to {person}', { title: b.title, person: b.borrowed_from }))).join(', ');
      return { title, body, url: '/#/trackers/library', tag: `librarydue:${when}` };
    });
    await recordNotification(db, { kind: 'reminder', ...payload(fam), source: 'system', at: now });
    for (const sub of parents) await sendToSub(env, db, sub, payload);
  }
}

// Outings (routes/outings.ts, outing-reminders.ts): from OUTINGS_AT (household) on, the day's
// heads-ups, ticket and last-chance notes, each once by its key; "on sale now" as soon as that time
// comes. Held through quiet hours (the caller skips the tick), so a held note goes out after.
export const OUTINGS_AT = '09:00';
async function runOutings(env: Env, db: KinwallDb, now: Date, tz: string, h12: boolean): Promise<void> {
  const today = todayInTz(tz, now);
  const morning = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now) >= OUTINGS_AT;
  const [outings, people, cats] = await Promise.all([
    readOutings(db),
    db.prepare('SELECT id, name, grown_up FROM members ORDER BY sort, created_at').all<{ id: string; name: string; grown_up: number }>(),
    db.prepare('SELECT id, emoji FROM outing_categories').all<{ id: string; emoji: string | null }>(),
  ]);
  const emoji = new Map(cats.results.map((c) => [c.id, c.emoji]));
  const due = dueReminders(outings.map((o) => ({ ...o, emoji: (o.categoryId && emoji.get(o.categoryId)) || null })), people.results.map((m) => ({ id: m.id, name: m.name, grownUp: !!m.grown_up })), today, (o) => {
    if (!o.ticketsOnSaleAt) return null;
    const at = new Date(o.ticketsOnSaleAt);
    return { saleOn: todayInTz(tz, at), saleAt: formatTime(at, { h12, tz }), saleNow: now >= at };
  });
  for (const r of due) if (morning || r.key.includes(':onsale0:')) await sendOutingReminder(env, db, r, now);
}

/** One outing note, once by its key: in the bell for the people it's for (and the grown-ups when
 * `grownUps`), and pushed to their own devices and, for grown-ups, parents' devices, where
 * "Outing reminders" is on. */
export async function sendOutingReminder(env: Env, db: KinwallDb, r: OutingReminder, now = new Date()): Promise<void> {
  const claimed = await db.prepare('INSERT INTO sent_notifications (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(r.key, now.toISOString()).run();
  if (!claimed.meta.changes) return;
  const grownUps = r.grownUps ? (await db.prepare('SELECT id FROM members WHERE grown_up = 1').all<{ id: string }>()).results.map((m) => m.id) : [];
  const url = `/#/outings?outing=${encodeURIComponent(r.outingId)}`;
  await recordNotification(db, { kind: 'outing', ...r.text(await familyLang(db)), url, memberIds: [...new Set([...r.memberIds, ...grownUps])], source: 'system', at: now });
  const results = await loadSubs(db,
    "k.owner IN (SELECT value FROM json_each(?1)) OR (?2 AND k.scope = 'admin' AND (k.owner IS NULL OR k.owner NOT IN (SELECT id FROM members WHERE grown_up = 0)))",
    JSON.stringify(r.memberIds), r.grownUps ? 1 : 0);
  for (const sub of results.filter((x) => subPrefs(x).outingReminders)) await sendToSub(env, db, sub, (lang) => ({ ...r.text(lang), url, tag: r.key }));
}

// Home upkeep (routes/upkeep.ts, upkeep-rules.ts): from UPKEEP_AT (household) on, a kid's due job
// becomes a one-off chore for the day, supplies go on the shopping list, and the heads-up, due,
// late and warranty notes go out, each once by its key in upkeep_sent (kept a year: a heads-up
// window can be weeks long, past sent_notifications' 3 days). Held through night hours.
export const UPKEEP_AT = '09:00';
export async function runUpkeep(env: Env, db: KinwallDb, now: Date, tz: string, execCtx?: WaitCtx): Promise<void> {
  if (new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(now) < UPKEEP_AT) return;
  const today = todayInTz(tz, now);
  const claim = async (key: string) => !!(await db.prepare('INSERT INTO upkeep_sent (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(key, now.toISOString()).run()).meta.changes;
  const [jobs, things, people] = await Promise.all([
    readJobs(db, today, (iso) => todayInTz(tz, new Date(iso))),
    readThings(db),
    db.prepare('SELECT id, grown_up FROM members').all<{ id: string; grown_up: number }>(),
  ]);
  const open = jobs.filter((j) => !j.archived && j.nextDue);
  const kids = new Set(people.results.filter((m) => !m.grown_up).map((m) => m.id));
  const fam = await familyLang(db);
  for (const j of open) {
    // A kid's job on (or past) its day: a chore for today, which logs the job when ticked.
    if (j.chorePoints != null && j.memberId && kids.has(j.memberId) && j.nextDue! <= today && (await claim('upkeep:chore:' + j.id + ':' + j.nextDue))) {
      await handOutChore(db, j, today);
      publish(env, execCtx, 'chore.changed', { upkeepJobId: j.id });
    }
    if (j.supplies.length && suppliesDue(j.nextDue, j.suppliesDays, today) && (await claim('upkeep:supplies:' + j.id + ':' + j.nextDue))) {
      const list = await suppliesList(db, j.suppliesListId);
      if (list && (await addSupplies(db, list, j.supplies, words(fam).t('For {job}', { job: j.title }))).length) publish(env, execCtx, 'list.item.changed', { listId: list.id });
    }
  }
  const byId = new Map(open.map((j) => [j.id, j]));
  const thingById = new Map(things.map((t) => [t.id, t]));
  for (const n of dueNotes(open.map((j) => ({ id: j.id, due: j.nextDue, headsUpDays: j.headsUpDays })), things, today)) {
    if (!(await claim(n.key))) continue;
    if (n.kind === 'warranty') { await sendUpkeepNote(env, db, n, null, thingById.get(n.thingId)!.name, today, now, kids); continue; }
    const j = byId.get(n.jobId)!;
    await sendUpkeepNote(env, db, n, j, j.thingId ? thingById.get(j.thingId)?.name ?? null : null, today, now, kids);
    publish(env, execCtx, 'upkeep.due', { jobId: j.id, title: j.title, dueOn: n.due, status: j.status }, false);
  }
  await db.prepare('DELETE FROM upkeep_sent WHERE sent_at < ?').bind(new Date(now.getTime() - 400 * 86400000).toISOString()).run();
}

/** One upkeep note: in the bell and pushed (where "Home upkeep" is on) to the job's person, and the
 * grown-ups unless that person is a grown-up; late and warranty notes go to the grown-ups. */
async function sendUpkeepNote(env: Env, db: KinwallDb, n: UpkeepNote, j: UpkeepJob | null, thing: string | null, today: string, now: Date, kids: Set<string>): Promise<void> {
  const day = (lang: Lang, d: string) => {
    const at = new Date(`${d}T12:00:00Z`);
    return new Intl.DateTimeFormat(LOCALES[lang], daysBetween(today, d) < 7 ? { weekday: 'long', timeZone: 'UTC' } : { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(at);
  };
  const text = perLang((lang) => {
    const { t, tn } = words(lang);
    if (n.kind === 'warranty') return { title: `🧾 ${t('The warranty on {thing} ends {day}', { thing: thing ?? '', day: day(lang, n.until) })}`, body: t('Open Upkeep to see its receipts and details.') };
    const job = j!.title, emoji = j!.emoji ?? '🔧';
    const title = n.kind === 'heads-up' ? t('{job} is due {day}', { job, day: day(lang, n.due) }) : n.kind === 'due' ? t('{job} is due today', { job }) : tn(n.late ?? 0, '{job} is {n} day late', '{job} is {n} days late', { job });
    return { title: `${emoji} ${title}`, body: thing ? t('{thing} · Open Upkeep to mark it done.', { thing }) : t('Open Upkeep to mark it done.') };
  });
  const person = n.kind === 'warranty' || n.kind === 'late' ? null : j!.memberId;
  const grownUps = !person || kids.has(person);
  const url = n.kind === 'warranty' ? `/#/upkeep?thing=${encodeURIComponent(n.thingId)}` : `/#/upkeep?job=${encodeURIComponent(n.jobId)}`;
  const grownUpIds = grownUps ? (await db.prepare('SELECT id FROM members WHERE grown_up = 1').all<{ id: string }>()).results.map((m) => m.id) : [];
  await recordNotification(db, { kind: 'upkeep', ...text(await familyLang(db)), url, memberIds: [...new Set([...(person ? [person] : []), ...grownUpIds])], source: 'system', at: now });
  const subs = await loadSubs(db,
    "k.owner = ?1 OR (?2 AND k.scope = 'admin' AND (k.owner IS NULL OR k.owner NOT IN (SELECT id FROM members WHERE grown_up = 0)))",
    person ?? '', grownUps ? 1 : 0);
  for (const sub of subs.filter((x) => subPrefs(x).upkeepReminders)) await sendToSub(env, db, sub, (lang) => ({ ...text(lang), url, tag: n.key }));
}

// A calendar whose sign-in Google or Microsoft revoked (sync.ts records last_error_code 'revoked'):
// one note to the grown-ups, "Leo's calendar stopped syncing", in the feed (for grown-ups only, so
// not on kids' devices) and pushed to parent devices (full-access keys not owned by a kid), opening
// Settings → Calendars where its Reconnect button is. Once per outage: claimed in
// reconnect_notified_at, which only a good sync (or reconnecting) clears. Held through night hours.
async function runCalendarReconnect(env: Env, db: KinwallDb, now: Date): Promise<void> {
  const { results } = await db.prepare("SELECT id, name, member_ids FROM calendars WHERE last_error_code = 'revoked' AND reconnect_notified_at IS NULL AND enabled = 1 ORDER BY name")
    .all<{ id: string; name: string; member_ids: string }>();
  const fresh: typeof results = [];
  for (const cal of results) {
    const claimed = await db.prepare("UPDATE calendars SET reconnect_notified_at = ? WHERE id = ? AND reconnect_notified_at IS NULL AND last_error_code = 'revoked'").bind(now.toISOString(), cal.id).run();
    if (claimed.meta.changes) fresh.push(cal);
  }
  if (!fresh.length) return;
  // Whose calendar, like sync.ts calendarWho: one member's, else by its name.
  const one = fresh.length === 1 ? fresh[0] : null;
  const ids = one ? parseMemberIds(one.member_ids) : [];
  const owner = ids.length === 1 ? (await db.prepare('SELECT name FROM members WHERE id = ?').bind(ids[0]).first<{ name: string }>())?.name : null;
  const payload = perLang((lang) => {
    const { t } = words(lang);
    const title = !one ? t('{n} calendars stopped syncing', { n: fresh.length }) : owner ? t("{name}'s calendar stopped syncing", { name: owner }) : t('The {calendar} calendar stopped syncing', { calendar: one.name });
    return { title, body: one ? t('Tap to reconnect it.') : t('Tap to reconnect them.'), url: '/#/settings?tab=calendars', tag: 'calendar-reconnect' };
  });
  const grownUps = (await db.prepare('SELECT id FROM members WHERE grown_up = 1').all<{ id: string }>()).results.map((m) => m.id);
  await recordNotification(db, { kind: 'reminder', ...payload(await familyLang(db)), memberIds: grownUps, source: 'system', at: now });
  const parents = await loadSubs(db, `${PARENT_SUBS} AND (k.owner IS NULL OR k.owner NOT IN (SELECT id FROM members WHERE grown_up = 0))`);
  for (const sub of parents) await sendToSub(env, db, sub, payload);
}

// A to-do list synced with Todoist, Google Tasks or Microsoft To Do whose sign-in or token was
// turned down (tasks/sync.ts records last_error_code 'revoked'): told like a calendar's, once per
// outage (reconnect_notified_at, cleared by a good sync), to the grown-ups' feed and parent devices,
// opening Settings → Calendars → To-do apps where its Reconnect button is. Held through night hours.
async function runTaskLinkReconnect(env: Env, db: KinwallDb, now: Date): Promise<void> {
  const { results } = await db.prepare("SELECT t.list_id, t.app, l.name FROM task_links t JOIN lists l ON l.id = t.list_id WHERE t.last_error_code = 'revoked' AND t.reconnect_notified_at IS NULL ORDER BY l.name")
    .all<{ list_id: string; app: TaskAppKind; name: string }>();
  const fresh: typeof results = [];
  for (const link of results) {
    const claimed = await db.prepare("UPDATE task_links SET reconnect_notified_at = ? WHERE list_id = ? AND reconnect_notified_at IS NULL AND last_error_code = 'revoked'").bind(now.toISOString(), link.list_id).run();
    if (claimed.meta.changes) fresh.push(link);
  }
  if (!fresh.length) return;
  const one = fresh.length === 1 ? fresh[0] : null;
  const payload = perLang((lang) => {
    const { t, tn } = words(lang);
    const title = one ? t('{list} stopped syncing with {app}', { list: one.name, app: APP_NAME[one.app] }) : tn(fresh.length, '{n} list stopped syncing', '{n} lists stopped syncing');
    return { title, body: one ? t('Tap to reconnect it.') : t('Tap to reconnect them.'), url: '/#/settings?tab=calendars&section=todo-apps', tag: 'task-reconnect' };
  });
  const grownUps = (await db.prepare('SELECT id FROM members WHERE grown_up = 1').all<{ id: string }>()).results.map((m) => m.id);
  await recordNotification(db, { kind: 'reminder', ...payload(await familyLang(db)), memberIds: grownUps, source: 'system', at: now });
  const parents = await loadSubs(db, `${PARENT_SUBS} AND (k.owner IS NULL OR k.owner NOT IN (SELECT id FROM members WHERE grown_up = 0))`);
  for (const sub of parents) await sendToSub(env, db, sub, payload);
}

// Entry point for the cron (Workers) and setInterval (Node) tickers.
export async function runNotifications(env: Env, now: Date, _execCtx?: WaitCtx): Promise<void> {
  // No early bail on zero subscriptions: the in-app feed records reminders/summaries regardless.
  const subs = await loadSubs(env.DB);

  const [tzRow, defaultRemindersRow, prefsRes] = await Promise.all([
    env.DB.prepare("SELECT value FROM settings WHERE key = 'timezone'").first<{ value: string }>(),
    env.DB.prepare("SELECT value FROM settings WHERE key = 'defaultReminderMinutes'").first<{ value: string }>(),
    env.DB.prepare("SELECT key, value FROM settings WHERE key IN ('quietFrom', 'quietTo', 'nightHoldReminders', 'timeFormat', 'location')").all<{ key: string; value: string }>(),
  ]);
  const prefs = new Map(prefsRes.results.map((r) => [r.key, r.value]));
  const tz = tzRow?.value ?? hostTimezone();
  let countryCode: string | undefined;
  try { countryCode = JSON.parse(prefs.get('location') ?? 'null')?.countryCode; } catch { /* no location */ }
  const h12 = hour12For(prefs.get('timeFormat'), countryCode);
  let defaultReminders: number[] = [30];
  if (defaultRemindersRow?.value) {
    try {
      defaultReminders = JSON.parse(defaultRemindersRow.value);
    } catch {
      defaultReminders = [];
    }
  }

  const windowStart = await getTickWindowStart(env.DB, now);

  // Each part runs on its own: one that throws (a bad row, a sealed value that won't open) is logged
  // by name, never its data, and the others still run. The window doesn't move past a failed
  // time-of-day part (`windowed`), so the next tick retries it; each send is claimed once, so nothing repeats.
  let retry = false;
  const part = async (name: string, run: () => Promise<unknown>, windowed = false) => {
    try { await run(); } catch (e) { retry ||= windowed; console.error(`${name} skipped:`, e instanceof Error ? e.name : 'error'); }
  };
  // Hold reminders at night (on unless the family turned it off): transitions, Live Activities,
  // battery alerts and the morning check-in reminder wait; event and medicine reminders don't.
  const hold = prefs.get('nightHoldReminders') !== 'false' && isNight(prefs.get('quietFrom'), prefs.get('quietTo'), now, tz);
  await part('event reminders', () => runEventReminders(env, env.DB, now, tz, h12, defaultReminders, subs, hold));
  const features = await readFeatures(env.DB);
  await part('daily summary', () => runDailySummary(env, env.DB, now, tz, subs, windowStart, features), true);
  if (features.chores) await part('chore nudge', () => runChoreNudge(env, env.DB, now, tz, subs, windowStart), true); // Chores turned off: no nudge
  if (features.trackersReading) await part('library due dates', () => runLibraryDue(env, env.DB, now, tz, windowStart), true);
  // Check-ins turned off: no evening goal check, battery heads-up or morning check-in reminder.
  if (features.checkIns) await part('goal follow-ups', () => runGoalFollowups(env, env.DB, now, tz, windowStart), true);
  if (features.checkIns && !hold) await part('battery heads-up', () => runBatteryHeadsUp(env, env.DB, now, tz)); // held at night
  if (features.checkIns && !hold) await part('last night reminders', () => runLastNightReminders(env, env.DB, now, tz)); // held at night
  if (features.trackersHealth && (await env.DB.prepare("SELECT value FROM settings WHERE key = 'medications'").first<{ value: string }>())?.value === 'true') {
    await part('medication reminders', () => runMedicationReminders(env, env.DB, now, tz, h12));
  } else {
    await part('discard disabled medicine retries', async () => env.DB.prepare('DELETE FROM push_retries').run());
  }
  if (features.outings && !hold) await part('outing reminders', () => runOutings(env, env.DB, now, tz, h12)); // held at night: sent once it's over
  if (features.upkeep && !hold) await part('home upkeep', () => runUpkeep(env, env.DB, now, tz, _execCtx)); // held at night too
  if (!hold) await part('calendar reconnect', () => runCalendarReconnect(env, env.DB, now)); // held at night: the Board's banner shows it meanwhile
  if (!hold) await part('to-do list reconnect', () => runTaskLinkReconnect(env, env.DB, now)); // held at night too: the list shows its warning meanwhile
  await part('prune', () => pruneSentNotifications(env.DB, now));
  if (!retry) await setTickWindowEnd(env.DB, now);
}

// Chore approval (routes/chores.ts), sent right away rather than on the tick: "Leo finished Make
// bed. Approve?" to parent devices (push subscriptions on admin keys) and a parent's "Not yet" to
// the kid's own devices (keys owned by that member). Once per dedupe `key`; the in-app feed gets
// one row too. `text` writes the words in a language: each device's, and the family's for the feed.
export function notifyChoreApproval(
  env: Env,
  execCtx: WaitCtx | undefined,
  to: 'parents' | { owner: string },
  key: string,
  n: { text: (lang: Lang) => { title: string; body: string }; url: string; memberIds?: string[] },
): void {
  waitUntil(
    execCtx,
    (async () => {
      const now = new Date();
      // Claimed in one statement, so two quick ticks can't both send.
      const claimed = await env.DB.prepare('INSERT INTO sent_notifications (key, sent_at) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').bind(key, now.toISOString()).run();
      if (!claimed.meta.changes) return;
      const text = perLang(n.text);
      await recordNotification(env.DB, { kind: 'chore', ...text(await familyLang(env.DB)), url: n.url, memberIds: n.memberIds, source: 'system', at: now });
      const results = to === 'parents' ? await loadSubs(env.DB, PARENT_SUBS) : await ownSubs(env.DB, to.owner);
      for (const sub of results) await sendToSub(env, env.DB, sub, (lang) => ({ ...text(lang), url: n.url, tag: key }));
    })(),
  );
}
