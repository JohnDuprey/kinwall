// A member's day (or week) at a glance: greeting, weather, their events + everyone's, their chores,
// their due/important list items, birthdays, and a peek at tomorrow. What the header avatar opens,
// and the MCP get_snapshot tool.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { hostTimezone } from '../env.ts';
import { zonedTimeToUtc } from '../recurrence.ts';
import { BoardSchema, ErrorSchema, SnapshotSchema } from '../schemas.ts';
import { readSettings } from './settings.ts';
import { eventInstances } from './events.ts';
import { dueOnDate, type ChoreRow } from './chores.ts';
import { groupSteps, priorityRankSql, stepsQuery, toItemApi, type ListItemRow, type ListItemStepRow } from './lists.ts';
import { todayInTz } from './members.ts';
import { getWeather } from './weather.ts';

export const snapshotRoutes = createRouter();

type Snapshot = z.infer<typeof SnapshotSchema>;

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`); // noon: no DST-edge date shift
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** "Good morning, Maya" by the household-local hour (morning 5-11, afternoon 12-16, else evening). */
export function greetingFor(name: string, hour: number): string {
  return `${hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : 'Good evening'}, ${name}`;
}

/** The date in `year` a YYYY-MM-DD / --MM-DD birthday falls on (Feb 29 -> Feb 28 outside leap years). */
function birthdayIn(birthday: string, year: number): string {
  const md = birthday.slice(-5);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return `${year}-${md === '02-29' && !leap ? '02-28' : md}`;
}

const localMidnight = (date: string, tz: string) => {
  const [y, mo, d] = date.split('-').map(Number);
  return zonedTimeToUtc({ y, mo: mo - 1, d, h: 0, mi: 0, s: 0 }, tz);
};

type Birthday = Snapshot['birthdays'][number];

// Member birthdays plus "Birthdays"-category events, within `dates`, sorted by date. Shared by
// /api/snapshot and /api/board so the "which day a birthday falls on" logic lives in one place.
function birthdaysInRange(
  members: { id: string; name: string; avatar: string | null; birthday: string | null }[],
  events: { id: string; title: string; date: string; categoryId: string | null }[],
  dates: string[],
  birthdayCats: Set<string>,
): Birthday[] {
  const birthdays: Birthday[] = [];
  for (const m of members) {
    if (!m.birthday) continue;
    for (const y of new Set(dates.map((d) => Number(d.slice(0, 4))))) {
      const date = birthdayIn(m.birthday, y);
      if (!dates.includes(date)) continue;
      birthdays.push({ memberId: m.id, eventId: null, name: m.name, avatar: m.avatar, date, age: m.birthday.startsWith('--') ? null : y - Number(m.birthday.slice(0, 4)) });
    }
  }
  for (const ev of events) {
    if (!ev.categoryId || !birthdayCats.has(ev.categoryId)) continue;
    // "Sam's Birthday" on the day Sam's own birthday is already listed: once is enough.
    if (birthdays.some((b) => b.memberId && b.date === ev.date && ev.title.toLowerCase().includes(b.name.toLowerCase()))) continue;
    birthdays.push({ memberId: null, eventId: ev.id, name: ev.title, avatar: null, date: ev.date, age: null });
  }
  birthdays.sort((a, b) => a.date.localeCompare(b.date));
  return birthdays;
}

const priorityRank = (p: string) => ({ urgent: 0, high: 1, normal: 2, low: 3 } as Record<string, number>)[p] ?? 2;

snapshotRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/snapshot',
    tags: ['Snapshot'],
    summary: "One member's day (or next 7 days): greeting, weather, events, chores, due/important list items, birthdays, and tomorrow at a glance.",
    security: [{ Bearer: [] }],
    request: { query: z.object({ member: z.string(), range: z.enum(['day', 'week']).default('day') }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: SnapshotSchema } } },
      404: { description: 'no such member', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { member: memberId, range } = c.req.valid('query');
    const db = c.env.DB;
    const now = new Date();
    const settings = await readSettings(db);
    const tz = settings.timezone ?? hostTimezone();
    const [membersRes, choresRes, itemsRes, stepsRes, categoriesRes] = await db.batch<unknown>([
      db.prepare('SELECT id, name, color, avatar, birthday FROM members ORDER BY sort, created_at'),
      db.prepare('SELECT * FROM chores WHERE active = 1 AND (member_id = ? OR member_id IS NULL) ORDER BY sort, created_at').bind(memberId),
      db
        .prepare(
          `SELECT li.*, l.name AS list_name, l.emoji AS list_emoji FROM list_items li JOIN lists l ON l.id = li.list_id
           WHERE l.archived = 0 AND li.done = 0 AND li.member_id = ? AND (li.due_date IS NOT NULL OR li.priority IN ('high', 'urgent'))
           ORDER BY li.due_date IS NULL, li.due_date, ${priorityRankSql('li.priority')}, li.sort`,
        )
        .bind(memberId),
      stepsQuery(db, 'member_id = ? AND done = 0', memberId),
      db.prepare("SELECT id FROM categories WHERE name LIKE '%birthday%'"),
    ]);
    const members = membersRes.results as { id: string; name: string; color: string; avatar: string | null; birthday: string | null }[];
    const member = members.find((m) => m.id === memberId);
    if (!member) return c.json({ error: 'member not found' }, 404);

    const today = todayInTz(tz, now);
    const tomorrow = addDays(today, 1);
    const to = range === 'week' ? addDays(today, 6) : today;
    const last = range === 'week' ? to : tomorrow; // day range also looks at tomorrow
    const dates: string[] = [];
    for (let d = today; d <= last; d = addDays(d, 1)) dates.push(d);

    // Events: theirs plus everyone's (untagged). Birthdays-category events go to birthdays instead,
    // whoever they're tagged to. Each is listed under its local start day (or today, if it began earlier).
    const birthdayCats = new Set((categoriesRes.results as { id: string }[]).map((r) => r.id));
    const dayOf = (start: string, allDay: boolean) => {
      const d = allDay ? start.slice(0, 10) : todayInTz(tz, new Date(start));
      return d < today ? today : d;
    };
    const all = (await eventInstances(db, localMidnight(today, tz), localMidnight(addDays(last, 1), tz)))
      .map((ev) => ({ ...ev, date: dayOf(ev.start, ev.allDay) }))
      .filter((ev) => ev.date <= last && (!ev.allDay || ev.end.slice(0, 10) > today)); // all-day ends are exclusive
    const events = all.filter((ev) => !(ev.categoryId && birthdayCats.has(ev.categoryId)) && (ev.memberIds.length === 0 || ev.memberIds.includes(memberId)));

    const birthdays = birthdaysInRange(members, all, dates, birthdayCats);

    const choreDays = range === 'week' ? dates : [today];
    const completions = new Set(
      ((await db.prepare('SELECT chore_id, date FROM chore_completions WHERE date >= ? AND date <= ?').bind(today, to).all<{ chore_id: string; date: string }>()).results).map((r) => `${r.chore_id}:${r.date}`),
    );
    const chores = choreDays.flatMap((date) =>
      (choresRes.results as unknown as ChoreRow[])
        .filter((row) => dueOnDate(row, date, tz))
        .map((row) => ({ id: row.id, title: row.title, emoji: row.emoji, points: row.points, dueTime: row.due_time, date, done: completions.has(`${row.id}:${date}`), shared: !row.member_id })),
    );

    const steps = groupSteps(stepsRes.results as unknown as ListItemStepRow[]);
    const itemRows = itemsRes.results as unknown as (ListItemRow & { list_name: string; list_emoji: string | null })[];
    const toItem = (r: (typeof itemRows)[number]) => ({ ...toItemApi(r, steps.get(r.id)), listName: r.list_name, listEmoji: r.list_emoji, overdue: !!r.due_date && r.due_date < today });
    const items = itemRows.filter((r) => (r.due_date && r.due_date <= to) || r.priority === 'high' || r.priority === 'urgent').map(toItem);

    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(now));
    const isBirthday = birthdays.some((b) => b.memberId === memberId && b.date === today);
    const weather = await getWeather(db, now);

    const body: Snapshot = {
      greeting: isBirthday ? `Happy birthday, ${member.name}! 🎉` : greetingFor(member.name, hour),
      member,
      range,
      from: today,
      to,
      generatedAt: now.toISOString(),
      weather: weather && { ...weather, days: weather.days.filter((d) => dates.includes(d.date)) },
      events: events.filter((ev) => ev.date <= to),
      chores,
      items,
      birthdays: birthdays.filter((b) => b.date <= to),
      tomorrow:
        range === 'day'
          ? {
              date: tomorrow,
              events: events.filter((ev) => ev.date === tomorrow),
              items: itemRows.filter((r) => r.due_date === tomorrow).map(toItem),
              birthdays: birthdays.filter((b) => b.date === tomorrow),
            }
          : null,
    };
    return c.json(body, 200);
  },
);

type Board = z.infer<typeof BoardSchema>;

snapshotRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/board',
    tags: ['Snapshot'],
    summary: 'Household bulletin board: everyone\'s events, due/important list items, chores and birthdays for the next `days` days.',
    security: [{ Bearer: [] }],
    request: { query: z.object({ days: z.coerce.number().int().min(1).max(14).default(7) }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: BoardSchema } } } },
  }),
  async (c) => {
    const { days } = c.req.valid('query');
    const db = c.env.DB;
    const now = new Date();
    const settings = await readSettings(db);
    const tz = settings.timezone ?? hostTimezone();
    const today = todayInTz(tz, now);
    const to = addDays(today, days - 1);
    const dates: string[] = [];
    for (let d = today; d <= to; d = addDays(d, 1)) dates.push(d);

    const [membersRes, choresRes, completionsRes, itemsRes, stepsRes, categoriesRes] = await db.batch<unknown>([
      db.prepare('SELECT id, name, color, avatar, birthday FROM members ORDER BY sort, created_at'),
      db.prepare('SELECT * FROM chores WHERE active = 1 ORDER BY sort, created_at'),
      db.prepare('SELECT chore_id FROM chore_completions WHERE date = ?').bind(today),
      db.prepare(
        `SELECT li.*, l.name AS list_name, l.emoji AS list_emoji FROM list_items li JOIN lists l ON l.id = li.list_id
         WHERE l.archived = 0 AND li.done = 0 AND (li.due_date IS NOT NULL OR li.priority IN ('high', 'urgent'))
         ORDER BY li.due_date IS NULL, li.due_date, ${priorityRankSql('li.priority')}, li.sort`,
      ),
      stepsQuery(db, 'done = 0'),
      db.prepare("SELECT id FROM categories WHERE name LIKE '%birthday%'"),
    ]);
    const members = membersRes.results as { id: string; name: string; color: string; avatar: string | null; birthday: string | null }[];

    const birthdayCats = new Set((categoriesRes.results as { id: string }[]).map((r) => r.id));
    const dayOf = (start: string, allDay: boolean) => {
      const d = allDay ? start.slice(0, 10) : todayInTz(tz, new Date(start));
      return d < today ? today : d;
    };
    const all = (await eventInstances(db, localMidnight(today, tz), localMidnight(addDays(to, 1), tz)))
      .map((ev) => ({ ...ev, date: dayOf(ev.start, ev.allDay) }))
      .filter((ev) => ev.date <= to && (!ev.allDay || ev.end.slice(0, 10) > today)); // all-day ends are exclusive
    const events = all.filter((ev) => !(ev.categoryId && birthdayCats.has(ev.categoryId)));

    const birthdays = birthdaysInRange(members, all, dates, birthdayCats);

    const completedToday = new Set((completionsRes.results as { chore_id: string }[]).map((r) => r.chore_id));
    const dueToday = (choresRes.results as unknown as ChoreRow[]).filter((row) => dueOnDate(row, today, tz));
    const byMember = new Map<string | null, ChoreRow[]>();
    for (const row of dueToday) byMember.set(row.member_id, [...(byMember.get(row.member_id) ?? []), row]);
    const memberById = new Map(members.map((m) => [m.id, m]));
    const chores = [...byMember.entries()]
      .map(([memberId, rows]) => {
        const m = memberId ? memberById.get(memberId) : undefined;
        return { memberId, name: m?.name ?? null, avatar: m?.avatar ?? null, color: m?.color ?? null, remaining: rows.filter((r) => !completedToday.has(r.id)).length, total: rows.length };
      })
      .filter((c) => c.total > 0);

    const steps = groupSteps(stepsRes.results as unknown as ListItemStepRow[]);
    const itemRows = itemsRes.results as unknown as (ListItemRow & { list_name: string; list_emoji: string | null })[];
    const items = itemRows
      .filter((r) => (r.due_date && r.due_date <= to) || (!r.due_date && (r.priority === 'high' || r.priority === 'urgent')))
      .map((r) => ({ ...toItemApi(r, steps.get(r.id)), listName: r.list_name, listEmoji: r.list_emoji, overdue: !!r.due_date && r.due_date < today }))
      .sort((a, b) => Number(b.overdue) - Number(a.overdue) || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') || priorityRank(a.priority) - priorityRank(b.priority));

    const weather = await getWeather(db, now);

    const body: Board = {
      today,
      to,
      generatedAt: now.toISOString(),
      weather: weather && { ...weather, days: weather.days.filter((d) => dates.includes(d.date)) },
      events,
      items,
      chores,
      birthdays: birthdays.filter((b) => b.date <= to),
    };
    return c.json(body, 200);
  },
);
