// A member's profile numbers (GET /api/members/{id}/stats), built from tables Kinwall already
// fills: chore_completions, check_ins, point_entries, tracker_entries (reading only - health never shows
// here), member_sticker_packs, scrapbook_stickers, plugin_playtime and reward_redemptions.
// Readable by wall screens and kids' devices (auth.ts): the whole family sees the fun stats.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { hostTimezone } from '../env.ts';
import { todayInTz, weekStartDate } from './members.ts';
import type { ChoreRow } from './chores.ts';
import { addDaysStr, streakStats } from './leaderboard.ts';
import { birthdayIn } from './snapshot.ts';
import { STICKER_PACKS } from '../stickers.ts';
import { earnedBadges } from '../badges.ts';
import { minutesOf, pagesOf, readingPercent, type ReadingProgress } from '../reading.ts';
import { ErrorSchema, MemberStatsSchema, StatsPeriodSchema } from '../schemas.ts';

export const memberStatsRoutes = createRouter();

type Period = z.infer<typeof StatsPeriodSchema>;
type Done = { chore_id: string; date: string; points: number; title: string; emoji: string | null };

// ponytail: the best-streak walk covers at most this many days (about 10 years).
const MAX_STREAK_DAYS = 3660;
const DAY_MS = 24 * 60 * 60 * 1000;

const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate(); // m is 1-12
const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY_MS);

/** The period's first day, and the same stretch just before it (none for all time). */
export function periodRange(period: Period, today: string, weekFrom: string, allFrom: string) {
  const [y, m, d] = today.split('-').map(Number);
  switch (period) {
    case 'today':
      return { from: today, previous: { from: addDaysStr(today, -1), to: addDaysStr(today, -1) } };
    case 'week':
      return { from: weekFrom, previous: { from: addDaysStr(weekFrom, -7), to: addDaysStr(today, -7) } };
    case 'month': {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { from: ymd(y, m, 1), previous: { from: ymd(py, pm, 1), to: ymd(py, pm, Math.min(d, lastDay(py, pm))) } };
    }
    case 'year':
      return { from: ymd(y, 1, 1), previous: { from: ymd(y - 1, 1, 1), to: ymd(y - 1, m, Math.min(d, lastDay(y - 1, m))) } };
    case 'all':
      return { from: allFrom, previous: null };
  }
}

function monthsFrom(from: string, to: string): string[] {
  const out: string[] = [];
  let [y, m] = from.split('-').map(Number);
  for (let key = ymd(y, m, 1).slice(0, 7); key <= to.slice(0, 7); key = ymd(y, m, 1).slice(0, 7)) {
    out.push(key);
    [y, m] = m === 12 ? [y + 1, 1] : [y, m + 1];
  }
  return out;
}

memberStatsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/members/{id}/stats',
    tags: ['Members'],
    summary: "A member's profile stats for a period: chores done and points (with the same stretch before), streak and best streak, books, sticker book, activity time, badges and birthday",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), query: z.object({ period: StatsPeriodSchema.default('week') }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: MemberStatsSchema } } },
      404: { description: 'member not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { period } = c.req.valid('query');
    const db = c.env.DB;
    const [memberRes, settingsRes, doneRes, entriesRes, choresRes, keysRes, booksRes, packsRes, placedRes, playRes, rewardsRes, checkInsRes] = await db.batch<unknown>([
      db.prepare('SELECT birthday, created_at FROM members WHERE id = ?').bind(id),
      db.prepare("SELECT key, value FROM settings WHERE key IN ('timezone', 'weekStart', 'streakGraceDays')"),
      // Every approved completion, archived chores included, so all-time numbers never drop.
      db.prepare("SELECT cc.chore_id, cc.date, COALESCE(cc.points_awarded, 0) AS points, c.title, c.emoji FROM chore_completions cc JOIN chores c ON c.id = cc.chore_id WHERE cc.member_id = ? AND cc.status = 'approved' ORDER BY cc.date").bind(id),
      db.prepare("SELECT amount, reason, at FROM point_entries WHERE member_id = ? AND (amount < 0 OR reason = 'reward_refund')").bind(id),
      // The streak: the leaderboard's chores (active, assigned to them) and anyone's ticks on them.
      db.prepare('SELECT * FROM chores WHERE active = 1 AND member_id = ?').bind(id),
      db.prepare("SELECT chore_id, date FROM chore_completions WHERE status = 'approved' AND chore_id IN (SELECT id FROM chores WHERE active = 1 AND member_id = ?)").bind(id),
      db.prepare("SELECT id, title, data FROM tracker_entries WHERE kind = 'reading' AND member_id = ?").bind(id),
      db.prepare('SELECT pack_id FROM member_sticker_packs WHERE member_id = ?').bind(id),
      db.prepare('SELECT COUNT(*) AS n FROM scrapbook_stickers WHERE member_id = ?').bind(id),
      db.prepare('SELECT t.date, t.plugin_id, t.seconds, p.name, p.manifest FROM plugin_playtime t LEFT JOIN plugins p ON p.id = t.plugin_id WHERE t.member_id = ?').bind(id),
      db.prepare("SELECT COUNT(*) AS n FROM reward_redemptions WHERE member_id = ? AND status IN ('approved', 'given')").bind(id),
      db.prepare('SELECT date, points FROM check_ins WHERE member_id = ?').bind(id),
    ]);
    const member = memberRes.results[0] as { birthday: string | null; created_at: string } | undefined;
    if (!member) return c.json({ error: 'member not found' }, 404);
    const settings = new Map((settingsRes.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
    const tz = settings.get('timezone') ?? hostTimezone();
    const today = todayInTz(tz);
    const dayOf = (iso: string) => todayInTz(tz, new Date(iso));
    const joined = dayOf(member.created_at);
    const done = doneRes.results as Done[];
    const allFrom = done.length && done[0].date < joined ? done[0].date : joined;
    const range = periodRange(period, today, weekStartDate(tz, Number(settings.get('weekStart') ?? 0) as 0 | 1), allFrom);
    const from = range.from;
    // All time has no lower bound: a book finished or a pack bought before joining still counts.
    const inRange = (date: string, a = period === 'all' ? '' : from, b = today) => date >= a && date <= b;
    const checkIns = checkInsRes.results as { date: string; points: number }[];
    // Points earned: chores plus daily check-ins (both by their household day).
    const tally = (a: string, b: string) => {
      const rows = done.filter((r) => inRange(r.date, a, b));
      const ins = checkIns.filter((r) => inRange(r.date, a, b));
      return { choresDone: rows.length, pointsEarned: rows.reduce((s, r) => s + r.points, 0) + ins.reduce((s, r) => s + r.points, 0) };
    };
    const now = tally(from, today);
    const inPeriod = done.filter((r) => inRange(r.date));

    // Spent: sticker packs, and rewards net of refunds, on the household day they happened.
    const spent = { stickers: 0, rewards: 0 };
    for (const e of entriesRes.results as { amount: number; reason: string; at: string }[]) {
      if (!inRange(dayOf(e.at))) continue;
      if (e.reason === 'sticker_pack') spent.stickers -= e.amount;
      else if (e.reason === 'reward' || e.reason === 'reward_refund') spent.rewards -= e.amount;
    }

    const graceDays = Number(settings.get('streakGraceDays') ?? 1);
    const keys = new Set((keysRes.results as { chore_id: string; date: string }[]).map((r) => `${r.chore_id}:${r.date}`));
    const streakDays = Math.min(MAX_STREAK_DAYS, Math.max(60, daysBetween(allFrom, today) + 1)); // at least the leaderboard's 60
    const streak = streakStats(choresRes.results as ChoreRow[], keys, tz, today, graceDays, streakDays);

    const chart: { key: string; count: number }[] = [];
    if (period === 'week' || period === 'month') {
      // The whole week or month, days still ahead at 0, so the bars keep their width.
      const last = period === 'week' ? addDaysStr(from, 6) : `${today.slice(0, 8)}${lastDay(Number(today.slice(0, 4)), Number(today.slice(5, 7)))}`;
      for (let d = from; d <= last; d = addDaysStr(d, 1)) chart.push({ key: d, count: 0 });
    } else if (period !== 'today') {
      for (const key of monthsFrom(from, period === 'year' ? `${today.slice(0, 4)}-12-01` : today)) chart.push({ key, count: 0 });
    }
    const bucket = new Map(chart.map((b) => [b.key, b]));
    const weekdays = [0, 0, 0, 0, 0, 0, 0];
    const perChore = new Map<string, { choreId: string; title: string; emoji: string | null; count: number }>();
    for (const r of inPeriod) {
      const b = bucket.get(r.date) ?? bucket.get(r.date.slice(0, 7));
      if (b) b.count++;
      weekdays[new Date(`${r.date}T12:00:00Z`).getUTCDay()]++;
      const f = perChore.get(r.chore_id) ?? { choreId: r.chore_id, title: r.title, emoji: r.emoji, count: 0 };
      f.count++;
      perChore.set(r.chore_id, f);
    }
    const busiest = weekdays.indexOf(Math.max(...weekdays));
    const favorite = [...perChore.values()].reduce<{ choreId: string; title: string; emoji: string | null; count: number } | null>((a, b) => (!a || b.count > a.count ? b : a), null);

    // Books: finished ones by the day they were finished; the shelf is this year's (or every one).
    type ReadingData = ReadingProgress & { status?: string; finishedOn?: string; rating?: number };
    const books = (booksRes.results as { id: string; title: string | null; data: string }[]).map((b) => {
      let d: ReadingData = {};
      try { d = JSON.parse(b.data); } catch { /* unreadable: left off */ }
      return { id: b.id, title: b.title ?? '', d };
    });
    const finished = books.filter((b) => b.d.status === 'finished' && b.d.finishedOn).sort((a, b) => a.d.finishedOn!.localeCompare(b.d.finishedOn!));
    const finishedNow = finished.filter((b) => inRange(b.d.finishedOn!));
    const shelfScope: 'year' | 'all' = period === 'all' ? 'all' : 'year';
    const shelf = shelfScope === 'all' ? finished : finished.filter((b) => b.d.finishedOn!.startsWith(today.slice(0, 4)));

    const owned = new Set((packsRes.results as { pack_id: string }[]).map((r) => r.pack_id));
    const packsOwned = STICKER_PACKS.filter((p) => p.price === 0 || owned.has(p.id)).length;
    const packsBought = STICKER_PACKS.filter((p) => p.price > 0 && owned.has(p.id)).length;

    const play = new Map<string, { pluginId: string; name: string; emoji: string | null; seconds: number }>();
    for (const r of playRes.results as { date: string; plugin_id: string; seconds: number; name: string | null; manifest: string | null }[]) {
      if (!inRange(r.date)) continue;
      let emoji: string | null = null;
      try { emoji = (JSON.parse(r.manifest ?? '{}') as { emoji?: string }).emoji ?? null; } catch { /* no emoji */ }
      const a = play.get(r.plugin_id) ?? { pluginId: r.plugin_id, name: r.name ?? r.plugin_id, emoji, seconds: 0 };
      a.seconds += Number(r.seconds);
      play.set(r.plugin_id, a);
    }

    let birthday = null;
    if (member.birthday) {
      const year = Number(today.slice(0, 4));
      const next = birthdayIn(member.birthday, year) >= today ? year : year + 1;
      birthday = {
        date: member.birthday,
        daysUntil: daysBetween(today, birthdayIn(member.birthday, next)),
        turning: member.birthday.startsWith('--') ? null : next - Number(member.birthday.slice(0, 4)),
      };
    }

    return c.json(
      {
        memberId: id,
        period,
        from,
        to: today,
        joined,
        ...now,
        checkIns: checkIns.filter((r) => inRange(r.date)).length,
        previous: range.previous ? { ...range.previous, ...tally(range.previous.from, range.previous.to) } : null,
        pointsSpent: spent,
        streak,
        chart,
        busiestWeekday: inPeriod.length ? busiest : null,
        favoriteChore: favorite,
        books: {
          finished: finishedNow.length,
          pages: finishedNow.reduce((s, b) => s + (pagesOf(b.d) ?? 0), 0),
          minutesListened: finishedNow.reduce((s, b) => s + (minutesOf(b.d) ?? 0), 0),
          shelfScope,
          shelf: shelf.map((b) => ({ id: b.id, title: b.title, pages: pagesOf(b.d), minutes: minutesOf(b.d), rating: b.d.rating ?? null, finishedOn: b.d.finishedOn! })),
          reading: books.filter((b) => b.d.status === 'reading').map((b) => ({ id: b.id, title: b.title, percent: readingPercent(b.d) })),
        },
        stickers: { packsOwned, packsTotal: STICKER_PACKS.length, placed: Number((placedRes.results[0] as { n: number }).n) },
        activities: [...play.values()].sort((a, b) => b.seconds - a.seconds),
        badges: earnedBadges({
          chores: done.length,
          bestStreak: streak.best,
          rewards: Number((rewardsRes.results[0] as { n: number }).n),
          packsBought,
          packsOwned,
          packsTotal: STICKER_PACKS.length,
          books: finished.length,
        }),
        birthday,
      },
      200,
    );
  },
);
