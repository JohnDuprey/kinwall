import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { household, todayInTz, weekStartDate } from './members.ts';
import { dueOnDate } from './chores.ts';
import type { ChoreRow } from './chores.ts';
import { LeaderboardEntrySchema } from '../schemas.ts';

export const leaderboardRoutes = createRouter();

type MemberRow = { id: string; name: string; color: string; avatar: string | null; sort: number };
type CompletionRow = { chore_id: string; date: string; member_id: string | null };

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

// Consecutive days ending today (today only counts once fully complete), skipping days with
// nothing due, on which every chore assigned to this member and due that day was completed.
function computeStreak(memberChores: ChoreRow[], completedKeys: Set<string>, tz: string, today: string): number {
  let streak = 0;
  let date = today;
  for (let i = 0; i < STREAK_LOOKBACK_DAYS; i++) {
    const due = memberChores.filter((c) => dueOnDate(c, date, tz));
    if (due.length === 0) {
      date = addDaysStr(date, -1);
      continue;
    }
    const allDone = due.every((c) => completedKeys.has(`${c.id}:${date}`));
    if (!allDone) {
      if (date === today) {
        date = addDaysStr(date, -1); // today not finished yet - skip it, don't break the streak
        continue;
      }
      break;
    }
    streak++;
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
    const today = todayInTz(tz);
    const periodFrom = period === 'today' ? today : period === 'week' ? weekStartDate(tz, weekStart) : monthStartDate(tz);
    const windowFrom = addDaysStr(today, -STREAK_LOOKBACK_DAYS);

    const { results: members } = await c.env.DB.prepare('SELECT id, name, color, avatar, sort FROM members ORDER BY sort, name').all<MemberRow>();
    const { results: chores } = await c.env.DB.prepare('SELECT * FROM chores WHERE active = 1').all<ChoreRow>();
    const { results: completions } = await c.env.DB.prepare('SELECT chore_id, date, member_id FROM chore_completions WHERE date >= ? AND date <= ?')
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
        const chore = choresById.get(row.chore_id);
        if (!chore) continue;
        points += chore.points;
        completed++;
      }
      const streak = computeStreak(choresByMember.get(m.id) ?? [], completedKeys, tz, today);
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
