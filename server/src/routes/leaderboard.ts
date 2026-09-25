import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { household, todayInTz, weekStartDate } from './members.ts';
import { dueOnDate } from './chores.ts';
import type { ChoreRow } from './chores.ts';
import { LeaderboardEntrySchema } from '../schemas.ts';

export const leaderboardRoutes = createRouter();

type MemberRow = { id: string; name: string; color: string; avatar: string | null; sort: number };
type CompletionRow = { chore_id: string; date: string; member_id: string | null; points_awarded: number | null };

// ponytail: fixed lookback cap - a streak longer than this just reports 60; page through history
// instead of widening the window if a household ever wants a longer streak to actually show.
const STREAK_LOOKBACK_DAYS = 60;

function monthStartDate(tz: string, at = new Date()): string {
  const [y, m] = todayInTz(tz, at).split('-');
  return `${y}-${m}-01`;
}

function addDaysStr(date: string, delta: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + delta);
  return dt.toISOString().slice(0, 10);
}

// The streak (🔥) is the number of *done* days walking back from today, where:
// - a day with nothing due for this member is skipped (neither counts nor breaks);
// - a done day (every chore assigned to the member and due that day was completed, by anyone)
//   adds 1;
// - today, if not finished yet, is skipped (the day isn't over);
// - any other day with something left undone is a *missed* day. A missed day is forgiven (skipped,
//   adds nothing) when, counting it, there are at most `graceDays` missed days in the 7 calendar
//   days starting at it (it and the 6 days after). Otherwise the streak stops there.
// Checking the window that starts at each miss is the same as "no rolling 7-day window holds more
// than graceDays misses", since every window's misses fit in the window starting at its earliest one.
// graceDays = 0 is the strict rule: any missed day ends the streak.
export function computeStreak(memberChores: ChoreRow[], completedKeys: Set<string>, tz: string, today: string, graceDays = 0): number {
  let streak = 0;
  let date = today;
  const missed: string[] = []; // forgiven misses so far, newest first
  for (let i = 0; i < STREAK_LOOKBACK_DAYS; i++) {
    const due = memberChores.filter((c) => dueOnDate(c, date, tz));
    const allDone = due.every((c) => completedKeys.has(`${c.id}:${date}`));
    if (due.length > 0 && allDone) streak++;
    else if (due.length > 0 && date !== today) {
      const windowEnd = addDaysStr(date, 6);
      if (missed.filter((d) => d <= windowEnd).length + 1 > graceDays) break;
      missed.push(date);
    }
    date = addDaysStr(date, -1);
  }
  return streak;
}

leaderboardRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/leaderboard',
    tags: ['Chores'],
    summary: 'Chore leaderboard: points, completions and streaks by member',
    security: [{ Bearer: [] }],
    request: { query: z.object({ period: z.enum(['today', 'week', 'month']).optional() }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(LeaderboardEntrySchema) } } } },
  }),
  async (c) => {
    const { period = 'week' } = c.req.valid('query');
    const { tz, weekStart } = await household(c.env.DB);
    const graceRow = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'streakGraceDays'").first<{ value: string }>();
    const graceDays = Number(graceRow?.value ?? 1);
    const today = todayInTz(tz);
    const periodFrom = period === 'today' ? today : period === 'week' ? weekStartDate(tz, weekStart) : monthStartDate(tz);
    const windowFrom = addDaysStr(today, -STREAK_LOOKBACK_DAYS);

    const { results: members } = await c.env.DB.prepare('SELECT id, name, color, avatar, sort FROM members ORDER BY sort, name').all<MemberRow>();
    const { results: chores } = await c.env.DB.prepare('SELECT * FROM chores WHERE active = 1').all<ChoreRow>();
    const { results: completions } = await c.env.DB.prepare('SELECT chore_id, date, member_id, points_awarded FROM chore_completions WHERE date >= ? AND date <= ?')
      .bind(windowFrom, today)
      .all<CompletionRow>();

    const choresById = new Map(chores.map((row) => [row.id, row]));
    const completedKeys = new Set(completions.map((row) => `${row.chore_id}:${row.date}`)); // any completion of that chore that day
    const choresByMember = new Map<string, ChoreRow[]>();
    for (const row of chores) {
      if (!row.member_id) continue;
      const list = choresByMember.get(row.member_id) ?? [];
      list.push(row);
      choresByMember.set(row.member_id, list);
    }

    const entries = members.map((m) => {
      let points = 0;
      let completed = 0;
      for (const row of completions) {
        if (row.member_id !== m.id || row.date < periodFrom || row.date > today) continue;
        if (!choresById.has(row.chore_id)) continue;
        points += row.points_awarded ?? 0;
        completed++;
      }
      const streak = computeStreak(choresByMember.get(m.id) ?? [], completedKeys, tz, today, graceDays);
      return { memberId: m.id, name: m.name, color: m.color, avatar: m.avatar, points, completed, streak };
    });

    entries.sort((a, b) => b.points - a.points || b.completed - a.completed || a.name.localeCompare(b.name));
    let rank = 1;
    const ranked = entries.map((e, i) => {
      if (i > 0 && !(e.points === entries[i - 1].points && e.completed === entries[i - 1].completed)) rank = i + 1;
      return { ...e, rank };
    });

    return c.json(ranked, 200);
  },
);
