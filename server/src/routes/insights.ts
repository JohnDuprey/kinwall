// Insights (#/insights/<id>): a person's check-ins over time (sleep, feelings, goals and how they
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
import { ErrorSchema, FOLLOWUP_OUTCOMES, SLEEP_ANSWERS } from '../schemas.ts';
import { healthBlock } from './trackers.ts';
import { todayInTz } from './members.ts';
import { readSettings } from './settings.ts';
import { openTempCheck, type TempCheckRow } from './temp-check.ts';
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
