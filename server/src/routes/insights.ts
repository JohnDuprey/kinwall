// Insights (#/insights/<id>) and the energy battery (battery.ts, GET /api/members/{id}/battery): a person's check-ins over time (sleep, feelings, goals and how they
// went, journal entry counts and moods) next to what Kinwall already knows (chores done, activity
// time, books finished, calendar busyness), with plain summaries and, after about 3 weeks of
// check-ins, "connections" (insights.ts; the method is in docs/using/insights.md).
//
// Built on health data (AGENTS.md "Health data"), so it's treated like the journal:
// - computed on request from the sealed rows and never stored (no table, no cache); journal text is
//   never read, only each entry's mood;
// - their own device (a display key they own) and parents' devices; never a shared wall screen or
//   another member's device; connected apps (MCP, AI connectors) only with aiHealthAccess;
// - never logged, never in a webhook, a snapshot, a profile or the export (it's derived data).
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import { deviceOwner, requestKey } from '../auth.ts';
import { zonedTimeToUtc } from '../recurrence.ts';
import { analyze, type InsightDay } from '../insights.ts';
import { battery, calibrate, CALIBRATE_DAYS, DRAINED_ANSWERS, FORECAST_DAYS, HISTORY_DAYS, RECENT_DAYS, type BatteryInput } from '../battery.ts';
import { ErrorSchema, FOLLOWUP_OUTCOMES, SLEEP_ANSWERS } from '../schemas.ts';
import { healthBlock } from './trackers.ts';
import { parseTempCheck, todayInTz } from './members.ts';
import { readFeatures, readSettings } from './settings.ts';
import { dueDates, type ChoreRow } from './chores.ts';
import { openDrained, openTempCheck, type TempCheckRow } from './temp-check.ts';
import { openMood } from './journal.ts';
import { eventInstances } from './events.ts';

export const insightsRoutes = createRouter();
type C = Context<{ Bindings: Env }>;

export const INSIGHT_RANGES = { '4w': 28, '3m': 91, '1y': 364 } as const; // whole weeks, ending today

const InsightDaySchema = z
  .object({
    date: z.string(),
    checkedIn: z.boolean().openapi({ description: 'Answered any Temp check question that day.' }),
    sleep: z.enum(SLEEP_ANSWERS).nullable(),
    feelings: z.array(z.string()),
    goalSet: z.boolean(),
    goalOutcome: z.enum(FOLLOWUP_OUTCOMES).nullable().openapi({ description: 'The evening goal check; the goal itself and the notes are not included.' }),
    journalEntries: z.number().int(),
    journalMoods: z.array(z.string()).openapi({ description: "Their entries' mood emoji. Never the words." }),
    chores: z.number().int().openapi({ description: 'Approved chore completions credited to them.' }),
    points: z.number().int(),
    activityMinutes: z.number().int(),
    booksFinished: z.number().int(),
    events: z.number().int().openapi({ description: "Timed events starting that day (household time): theirs and the family's untagged ones. All-day events don't count." }),
    lastEventEnd: z.string().nullable().openapi({ description: "HH:MM household time: the latest end of those events; '24:00' when one runs past midnight." }),
  })
  .openapi('InsightDay');
const TallySchema = z.object({ hit: z.number().int(), n: z.number().int() });
const InsightsSchema = z
  .object({
    memberId: z.string(),
    range: z.enum(['4w', '3m', '1y']),
    from: z.string(),
    to: z.string(),
    days: z.array(InsightDaySchema).openapi({ description: 'One per household day, oldest first.' }),
    summary: z.array(z.object({ id: z.string(), text: z.string() })).openapi({ description: 'Plain sentences for the range, e.g. "Slept well or great on 12 of 20 nights".' }),
    topFeelings: z.array(z.object({ feeling: z.string(), days: z.number().int() })),
    connections: z.object({
      ready: z.boolean().openapi({ description: 'Enough days with check-ins (`needed`) to look for connections.' }),
      daysWithCheckIns: z.number().int(),
      needed: z.number().int(),
      list: z.array(z.object({
        id: z.string(), text: z.string(), detail: z.string(),
        confidence: z.enum(['early', 'clear']).openapi({ description: '"Early sign" or "Clear pattern" (days on each side and the size of the difference).' }),
        a: TallySchema, b: TallySchema,
      })),
    }),
  })
  .openapi('Insights');

const PRIVATE = { error: "Insights are private: they open on the person's own device and parents' devices." };
const APPS = { error: "Insights are private to the family's own devices. A parent can allow connected apps to see them in Settings → Connected apps." };

/** Why this caller may not see `memberId`'s insights, or null when it may (see the top of the file). */
async function block(c: C, memberId: string): Promise<{ error: string } | null> {
  if ((await requestKey(c))?.scope === 'display') return (await deviceOwner(c)) === memberId ? null : PRIVATE;
  return (await healthBlock(c)) ? APPS : null;
}

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const midnight = (date: string, tz: string) => {
  const [y, mo, d] = date.split('-').map(Number);
  return zonedTimeToUtc({ y, mo: mo - 1, d, h: 0, mi: 0, s: 0 }, tz);
};
const hm = (tz: string, at: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(at);

/** The person's per-day series from `from` to `to` (household days). */
export async function insightDays(c: C, memberId: string, from: string, to: string, tz: string): Promise<InsightDay[]> {
  const db = c.env.DB;
  const [checks, entries, chores, play, books] = await db.batch<unknown>([
    db.prepare('SELECT * FROM temp_checks WHERE member_id = ? AND date BETWEEN ? AND ?').bind(memberId, from, to),
    db.prepare('SELECT id, date, mood FROM journal_entries WHERE member_id = ? AND date BETWEEN ? AND ?').bind(memberId, from, to), // never the text
    db.prepare("SELECT date, COUNT(*) AS n, SUM(COALESCE(points_awarded, 0)) AS points FROM chore_completions WHERE member_id = ? AND status = 'approved' AND date BETWEEN ? AND ? GROUP BY date").bind(memberId, from, to),
    db.prepare('SELECT date, SUM(seconds) AS seconds FROM plugin_playtime WHERE member_id = ? AND date BETWEEN ? AND ? GROUP BY date').bind(memberId, from, to),
    db.prepare("SELECT data FROM tracker_entries WHERE kind = 'reading' AND member_id = ?").bind(memberId),
  ]);
  const days = new Map<string, InsightDay>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    days.set(d, {
      date: d, checkedIn: false, sleep: null, feelings: [], goalSet: false, goalOutcome: null, journalEntries: 0, journalMoods: [],
      chores: 0, points: 0, activityMinutes: 0, booksFinished: 0, events: 0, lastEventEnd: null,
    });
  }
  for (const r of checks.results as TempCheckRow[]) {
    const day = days.get(r.date);
    if (!day) continue;
    const t = await openTempCheck(c.env, r);
    day.sleep = t.sleep;
    day.feelings = t.feelings ?? [];
    day.goalSet = !!t.goal;
    day.goalOutcome = t.followup?.outcome ?? null;
    day.checkedIn = !!(t.sleep || t.feelings?.length || t.goal || t.goalSkipped || t.followup);
  }
  for (const r of entries.results as { id: string; date: string; mood: string | null }[]) {
    const day = days.get(r.date)!;
    day.journalEntries++;
    const mood = await openMood(c.env, r);
    if (mood) day.journalMoods.push(mood);
  }
  for (const r of chores.results as { date: string; n: number; points: number }[]) Object.assign(days.get(r.date)!, { chores: Number(r.n), points: Number(r.points) });
  for (const r of play.results as { date: string; seconds: number }[]) days.get(r.date)!.activityMinutes = Math.round(Number(r.seconds) / 60);
  for (const r of books.results as { data: string }[]) {
    let d: { status?: string; finishedOn?: string } = {};
    try { d = JSON.parse(r.data); } catch { /* unreadable: left out */ }
    const day = d.status === 'finished' && d.finishedOn ? days.get(d.finishedOn) : undefined;
    if (day) day.booksFinished++;
  }
  // Timed events, by the household day they start on; all-day ones (birthdays, school holidays) aren't busy hours.
  for (const ev of await eventInstances(db, midnight(from, tz), midnight(addDays(to, 1), tz))) {
    if (ev.allDay || (ev.memberIds.length && !ev.memberIds.includes(memberId))) continue;
    const day = days.get(todayInTz(tz, new Date(ev.start)));
    if (!day) continue;
    const end = new Date(ev.end);
    const endHm = todayInTz(tz, end) > day.date ? '24:00' : hm(tz, end);
    day.events++;
    if (!day.lastEventEnd || endHm > day.lastEventEnd) day.lastEventEnd = endHm;
  }
  return [...days.values()];
}

insightsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/members/{id}/insights',
    tags: ['Journal'],
    summary: "A person's insights: their per-day check-ins next to chores, activity, books and calendar busyness, with summaries and (after 21 days with check-ins) connections. Computed on request, nothing stored. Their own device and parents' devices only.",
    security: [{ Bearer: [] }],
    request: {
      params: z.object({ id: z.string() }),
      query: z.object({ range: z.enum(['4w', '3m', '1y']).default('4w').openapi({ description: '4 weeks, 3 months (13 weeks) or 1 year (52 weeks), ending today.' }) }),
    },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: InsightsSchema } } },
      403: { description: "a shared wall, another member's device, or a connected app without aiHealthAccess", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'member not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const blocked = await block(c, id);
    if (blocked) return c.json(blocked, 403);
    if (!(await c.env.DB.prepare('SELECT 1 FROM members WHERE id = ?').bind(id).first())) return c.json({ error: 'member not found' }, 404);
    const { range } = c.req.valid('query');
    const tz = (await readSettings(c.env.DB)).timezone ?? hostTimezone();
    const to = todayInTz(tz);
    const from = addDays(to, 1 - INSIGHT_RANGES[range]);
    const days = await insightDays(c, id, from, to, tz);
    return c.json({ memberId: id, range, from, to, days, ...analyze(days) }, 200);
  },
);

// ---------- The energy battery (battery.ts) ----------
// Derived from sleep and feelings, so it follows the insights rules above: computed on request and
// never stored, the same `block`, never logged. Off unless the person's Temp check and its battery
// setting are both on (members.temp_check). notify.ts sends the heads-up push from batteryFor.

const ReasonSchema = z.object({ text: z.string(), points: z.number().int().openapi({ description: 'Added to the start (+) or drained (-).' }) });
const BatterySchema = z
  .object({
    memberId: z.string(),
    on: z.boolean().openapi({ description: 'Their Temp check and battery are on. Off: no days and no warnings.' }),
    today: z.string(),
    days: z.array(z.object({
      date: z.string(),
      forecast: z.boolean().openapi({ description: 'After today: from the calendar and chores, starting from their usual night.' }),
      start: z.number().int().openapi({ description: 'The morning charge, 0-100.' }),
      drain: z.number().int().openapi({ description: 'What the day asks: events, chore points, a goal, and the adjustment for how they have felt lately.' }),
      level: z.number().int().openapi({ description: 'start - drain, 0-100: what is left by evening.' }),
      reasons: z.array(ReasonSchema).openapi({ description: 'Everything behind the numbers, in order: the start, then the drain. No hidden score.' }),
      lowBefore: z.string().nullable().openapi({ description: 'The first event that takes the battery under 25%, or null.' }),
      felt: z.enum(DRAINED_ANSWERS).nullable().openapi({ description: 'Their evening "How drained do you feel?" answer that day, or null (none, or Skip).' }),
    })).openapi({ description: 'The 7 days up to today, then 3 days ahead, oldest first.' }),
    warnings: z.array(z.object({ date: z.string(), text: z.string(), suggestions: z.array(z.string()) })).openapi({ description: 'A heads-up for each day from today on that looks likely to run under 25%.' }),
  })
  .openapi('Battery');

/** A person's battery: the week up to today and the days ahead, in household time. */
export async function batteryFor(env: Env, memberId: string, tz: string, now = new Date()): Promise<z.infer<typeof BatterySchema>> {
  const today = todayInTz(tz, now);
  const member = await env.DB.prepare('SELECT temp_check FROM members WHERE id = ?').bind(memberId).first<{ temp_check: string | null }>();
  const s = parseTempCheck(member?.temp_check);
  if (!s.on || !s.battery) return { memberId, on: false, today, days: [], warnings: [] };
  // The calibration's 4 weeks, and the days before them that feed their first starts.
  const from = addDays(today, 1 - CALIBRATE_DAYS - RECENT_DAYS);
  const to = addDays(today, FORECAST_DAYS);
  const [checks, chores, done] = await env.DB.batch<unknown>([
    env.DB.prepare('SELECT * FROM temp_checks WHERE member_id = ? AND date BETWEEN ? AND ?').bind(memberId, from, to),
    env.DB.prepare('SELECT * FROM chores WHERE active = 1 AND member_id = ?').bind(memberId),
    env.DB.prepare('SELECT cc.chore_id, cc.date, cc.member_id, c.points FROM chore_completions cc JOIN chores c ON c.id = cc.chore_id WHERE cc.date BETWEEN ? AND ?').bind(from, to),
  ]);
  const days = new Map<string, BatteryInput>();
  const felt: Record<string, string | null> = {};
  for (let d = from; d <= to; d = addDays(d, 1)) days.set(d, { date: d, sleep: null, feelings: [], goalSet: false, chores: 0, choreDone: 0, choreDue: 0, events: [] });
  for (const r of checks.results as TempCheckRow[]) {
    const t = await openTempCheck(env, r);
    Object.assign(days.get(r.date)!, { sleep: t.sleep, feelings: t.feelings ?? [], goalSet: !!t.goal });
    felt[r.date] = await openDrained(env, r);
  }
  // Chore points: the chore's points for each one they finished (theirs or anyone's, waiting for a
  // parent's OK too: the effort is the same), and their own chores due that nobody has done yet.
  if ((await readFeatures(env.DB)).chores) {
    const completions = done.results as { chore_id: string; date: string; member_id: string | null; points: number }[];
    const doneKeys = new Set(completions.map((c) => `${c.chore_id}:${c.date}`));
    for (const c of completions) if (c.member_id === memberId) days.get(c.date)!.choreDone += c.points;
    for (const row of chores.results as ChoreRow[]) for (const d of dueDates(row, from, to, tz)) {
      const day = days.get(d)!;
      day.chores++;
      if (!doneKeys.has(`${row.id}:${d}`)) day.choreDue += row.points;
    }
  }
  // Timed events like Insights counts them: theirs and the family's, by the day they start.
  for (const ev of await eventInstances(env.DB, midnight(from, tz), midnight(addDays(to, 1), tz))) {
    if (ev.allDay || (ev.memberIds.length && !ev.memberIds.includes(memberId))) continue;
    const day = days.get(todayInTz(tz, new Date(ev.start)));
    if (!day) continue;
    const end = new Date(ev.end);
    day.events.push({ title: ev.title, start: hm(tz, new Date(ev.start)), end: todayInTz(tz, end) > day.date ? '24:00' : hm(tz, end) });
  }
  // How it has matched how they felt, from its own guesses before any adjustment; then the real run.
  const inputs = [...days.values()];
  const b = battery(inputs, today, calibrate(battery(inputs, today).days, felt, today));
  const shown = b.days.slice(-(HISTORY_DAYS + FORECAST_DAYS)).map((d) => ({ ...d, felt: DRAINED_ANSWERS.find((a) => a === felt[d.date]) ?? null }));
  return { memberId, on: true, today, days: shown, warnings: b.warnings };
}

insightsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/members/{id}/battery',
    tags: ['Journal'],
    summary: "A person's energy battery: a rough daily guess from their sleep and feelings against their events, chores and goal, for the last 7 days and 3 days ahead, with every reason and a heads-up before heavy days. Computed on request, nothing stored. Their own device and parents' devices only.",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: BatterySchema } } },
      403: { description: "a shared wall, another member's device, or a connected app without aiHealthAccess", content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'member not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const blocked = await block(c, id);
    if (blocked) return c.json(blocked, 403);
    if (!(await c.env.DB.prepare('SELECT 1 FROM members WHERE id = ?').bind(id).first())) return c.json({ error: 'member not found' }, 404);
    return c.json(await batteryFor(c.env, id, (await readSettings(c.env.DB)).timezone ?? hostTimezone()), 200);
  },
);
