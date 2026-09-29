// Daily check-in: reading your day's snapshot to the end earns the household's checkInPoints, once per
// member per household day. The check_ins row makes it once a day; the points go in the ledger
// (point_entries, reason 'check_in'), so they're spendable and count as earned on the profile. The
// leaderboard ranks chore points only, as it does for every ledger entry.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { hostTimezone } from '../env.ts';
import { emit } from '../bus.ts';
import { ownerBlock } from '../auth.ts';
import { balanceOf } from '../stickers.ts';
import { readSettings } from './settings.ts';
import { startDayFrom } from './medications.ts';
import { todayInTz } from './members.ts';
import { ErrorSchema } from '../schemas.ts';

export const checkInRoutes = createRouter();

const CheckInResultSchema = z
  .object({
    date: z.string(), // the household day, YYYY-MM-DD
    points: z.number(), // what this day's check-in earned
    awarded: z.number(), // points added by this call: 0 when they'd already checked in today
    balance: z.number(),
  })
  .openapi('CheckInResult');

checkInRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/members/{id}/check-in',
    tags: ['Members'],
    summary: "Check in for today (read the day to the end): earns the household's check-in points once per household day. Calling again the same day awards nothing.",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'checked in (awarded is 0 if already done today)', content: { 'application/json': { schema: CheckInResultSchema } } },
      400: { description: 'daily check-ins are off', content: { 'application/json': { schema: ErrorSchema } } },
      403: { description: 'this device belongs to someone else', content: { 'application/json': { schema: ErrorSchema } } },
      404: { description: 'member not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.env.DB;
    const settings = await readSettings(db);
    if (!settings.checkInPoints) return c.json({ error: 'Daily check-ins are turned off' }, 400);
    const blocked = await ownerBlock(c, id);
    if (blocked) return c.json({ error: blocked }, 403);
    if (!(await db.prepare('SELECT 1 FROM members WHERE id = ?').bind(id).first())) return c.json({ error: 'member not found' }, 404);

    const date = todayInTz(settings.timezone ?? hostTimezone());
    const at = new Date().toISOString();
    // One batch: the check-in row is the once-a-day guard, and the ledger entry follows only a new one.
    // The entry id is fixed per member and day, so an import can't double it either.
    const [inserted] = await db.batch<{ points: number }>([
      db.prepare('INSERT INTO check_ins (member_id, date, points, at) VALUES (?, ?, ?, ?) ON CONFLICT(member_id, date) DO NOTHING RETURNING points').bind(id, date, settings.checkInPoints, at),
      db
        .prepare("INSERT INTO point_entries (id, member_id, amount, reason, ref, at) SELECT ?, member_id, points, 'check_in', date, at FROM check_ins WHERE member_id = ? AND date = ? ON CONFLICT(id) DO NOTHING")
        .bind(`checkin:${id}:${date}`, id, date),
    ]);
    const awarded = inserted.results[0]?.points ?? 0;
    const points = awarded || ((await db.prepare('SELECT points FROM check_ins WHERE member_id = ? AND date = ?').bind(id, date).first<{ points: number }>())?.points ?? 0);
    if (awarded) emit(c, 'checkin.completed', { memberId: id, date, points });
    if (awarded) await startDayFrom(c, id); // reading your day starts it ("When I start my day" medicines)
    return c.json({ date, points, awarded, balance: await balanceOf(db, id) }, 200);
  },
);
