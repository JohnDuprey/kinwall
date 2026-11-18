// School (docs/using/school.md, migration 0150): subjects, which kids are in school, and a log of
// school time by kid and subject.
//
// Who does what: parents (full access) do everything. A wall screen or a kid's own device reads
// subjects, kids, logs and the summary, and logs time: a wall for any kid in school, a kid's device
// only for its kid (ownerBlock). One save for several kids writes one row per kid with a shared
// group_id; ?all=1 on PATCH, DELETE and approve acts on the whole group. A row a wall or kid's
// device logs for a kid whose settings say approveLogs is pending until a parent approves it, and
// pending time stays out of the summary. Display keys reach only what auth.ts DISPLAY_ALLOWED lists.
//
// Its own feature switch (settings.features.school, off by default): off, every route here answers
// 404 (so MCP tools refuse). Nothing is deleted.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import type { KinwallDb } from '../db.ts';
import { emit } from '../bus.ts';
import { notifyChoreApproval } from '../notify.ts';
import { actorOf, ownerBlock, requestKey } from '../auth.ts';
import { ErrorSchema } from '../schemas.ts';
import { stored, words } from '../i18n.ts';
import { readFeatures, readSettings } from './settings.ts';
import { todayInTz } from './members.ts';
import { classifyDay, lastDayOf, loadSchoolDays, schoolDaysLeft } from '../school-days.ts';

export const schoolRoutes = createRouter();

/** When a school year starts unless a kid's is set: mid-August, around when most US schools start. */
export const DEFAULT_YEAR_START = '08-15';

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const COLOR = z.string().regex(/^#[0-9a-fA-F]{6}$/, '#RRGGBB');

export const SchoolSubjectSchema = z.object({ id: z.string(), name: z.string(), emoji: z.string().nullable(), color: z.string(), sort: z.number().int(), archived: z.boolean(), goalHours: z.number().int().nullable().openapi({ description: 'Hours a school year aims for, for each kid (records).' }) }).openapi('SchoolSubject');
const SubjectInputSchema = z.object({ name: z.string().trim().min(1).max(60), emoji: z.string().trim().max(16).nullable().optional(), color: COLOR, sort: z.number().int().optional(), archived: z.boolean().optional(), goalHours: z.number().int().min(1).max(2000).nullable().optional() });

export const SchoolKidSchema = z
  .object({
    memberId: z.string(),
    mode: z.enum(['home', 'enrolled']).openapi({ description: 'home: homeschooled. enrolled: goes to a public or private school.' }),
    grade: z.string().nullable(),
    approveLogs: z.boolean().openapi({ description: 'Time this kid logs from a wall or their own device waits for a parent to approve it.' }),
    dayStart: z.string().nullable().openapi({ description: 'School starts, "HH:MM" (household time), on schoolDays.' }), dayEnd: z.string().nullable(),
    toSchoolBy: z.string().nullable().openapi({ description: 'How they get to school on schoolDays: "bus", or the id of the grown-up who drops them off.' }), toSchoolTime: z.string().nullable().openapi({ description: 'The bus picks them up, or the drop-off, "HH:MM".' }),
    fromSchoolBy: z.string().nullable().openapi({ description: 'How they get home: "bus", or the id of the grown-up who picks them up.' }), fromSchoolTime: z.string().nullable().openapi({ description: 'The bus drops them off, or the pickup, "HH:MM".' }),
    schoolDays: z.array(z.number().int()).openapi({ description: 'Weekdays school meets, 0 = Sunday (default Monday to Friday).' }),
    calendarIds: z.array(z.string()).openapi({ description: "The calendars the school and district publish (days off, early release): their events show on the kid's School day, and the family's day rules read them." }),
    halfDayEnd: z.string().nullable().openapi({ description: 'A half day (early release) ends, "HH:MM".' }),
    halfFromSchoolTime: z.string().nullable().openapi({ description: 'On a half day, the bus drops them off, or the pickup, "HH:MM".' }),
    lastDay: z.string().nullable().openapi({ description: 'The last day of school, "YYYY-MM-DD", when their calendars don\'t say (a "Last Day of School" event).' }),
    schoolContactId: z.string().nullable().openapi({ description: 'Their school, a contact (the number to call, for the teacher too).' }),
    teacherName: z.string().nullable().openapi({ description: "Their teacher's name." }),
    teacherEmail: z.string().nullable().openapi({ description: "Their teacher's email. Parents' devices only (null on a wall or kid's device)." }),
    teacherLink: z.string().nullable().openapi({ description: 'Another way to reach the teacher, a link (ClassDojo, Seesaw, Remind). Parents\' devices only.' }),
    contactIds: z.array(z.string()).openapi({ description: 'Other contacts for school (a tutor, a coach), from Contacts.' }),
    terms: z.number().int().openapi({ description: 'Report card terms in a school year.' }),
    yearGoalHours: z.number().int().nullable().openapi({ description: 'Hours a school year aims for (records).' }), yearGoalDays: z.number().int().nullable().openapi({ description: 'School days a year aims for (a day counts with approved time logged).' }),
    dailyGoalMinutes: z.number().int().nullable().openapi({ description: 'Minutes a school day aims for.' }),
    yearStart: z.string().openapi({ description: 'When their school year starts, "MM-DD" (default 08-15, mid-August); it runs to the day before it comes round again.' }),
  })
  .openapi('SchoolKid');
const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 08:15.');
const KidInputSchema = z.object({
  mode: z.enum(['home', 'enrolled']), grade: z.string().trim().max(30).nullable().optional(), approveLogs: z.boolean().optional(),
  dayStart: HHMM.nullable().optional(), dayEnd: HHMM.nullable().optional(), toSchoolBy: z.string().nullable().optional(), toSchoolTime: HHMM.nullable().optional(), fromSchoolBy: z.string().nullable().optional(), fromSchoolTime: HHMM.nullable().optional(), schoolDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  calendarIds: z.array(z.string()).max(10).optional(), halfDayEnd: HHMM.nullable().optional(), halfFromSchoolTime: HHMM.nullable().optional(), lastDay: DAY.nullable().optional(), schoolContactId: z.string().nullable().optional(), teacherName: z.string().trim().max(80).nullable().optional(), teacherEmail: z.string().trim().email().max(200).nullable().optional().or(z.literal('')), teacherLink: z.string().trim().max(500).regex(/^https?:\/\//i, 'A link starting with http:// or https://').nullable().optional().or(z.literal('')), contactIds: z.array(z.string()).max(20).optional(), terms: z.number().int().min(1).max(12).optional(),
  yearGoalHours: z.number().int().min(1).max(5000).nullable().optional(), yearGoalDays: z.number().int().min(1).max(366).nullable().optional(), dailyGoalMinutes: z.number().int().min(1).max(1440).nullable().optional(),
  yearStart: z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'Use a date like 08-24.').refine((v) => { const [m, d] = v.split('-').map(Number); return d <= new Date(Date.UTC(2001, m, 0)).getUTCDate(); }, 'That day isn’t in that month.').optional(),
});
export const SchoolGradeSchema = z.object({ id: z.string(), memberId: z.string().nullable(), formerMember: z.string().nullable().default(null), year: z.number().int(), term: z.number().int(), subjectId: z.string(), grade: z.string(), updatedAt: z.string() })
  .openapi('SchoolGrade', { description: 'A report card grade. year: the school year\'s first calendar year (2026 = 2026-27). Parents only.' });
const GradeInputSchema = z.object({
  memberId: z.string(), year: z.number().int().min(2000).max(2100), term: z.number().int().min(1).max(12), subjectId: z.string(),
  grade: z.string().trim().max(20).openapi({ description: 'Free text: A-, 3, 92%, Meets. Empty clears it.' }),
});

export const SchoolLogSchema = z
  .object({
    id: z.string(), groupId: z.string().openapi({ description: 'Shared by the rows one save wrote, one per kid.' }), memberId: z.string().nullable().openapi({ description: 'null once the member was removed (formerMember has their name).' }), formerMember: z.string().nullable().default(null), subjectId: z.string().nullable(),
    date: z.string(), minutes: z.number().int(), title: z.string().nullable(), notes: z.string().nullable(),
    pending: z.boolean().openapi({ description: 'Waiting for a parent to approve it; not counted in the summary.' }), createdBy: z.string().nullable(), createdAt: z.string(), updatedAt: z.string(),
    choreId: z.string().nullable().default(null).openapi({ description: 'Logged by ticking off this schoolwork chore (on choreDate); undoing the tick removes it.' }), choreDate: z.string().nullable().default(null),
    photoId: z.string().nullable().default(null).openapi({ description: 'A photo for the portfolio (GET /api/photos/{id}/image). Upload one just for this with POST /api/photos?family=0.' }),
  })
  .openapi('SchoolLog');
const MINUTES = z.number().int().min(1).max(1440);
export const SchoolLogInputSchema = z.object({
  memberIds: z.array(z.string()).min(1).max(20).openapi({ description: 'Every kid who took part (each must be in school): one row each.' }),
  subjectId: z.string().nullable().optional(), date: DAY.optional().openapi({ description: "Defaults to today in the family's timezone." }), minutes: MINUTES,
  title: z.string().trim().max(200).nullable().optional(), notes: z.string().trim().max(2000).nullable().optional(), photoId: z.string().nullable().optional(),
});
const LogPatchSchema = z.object({ subjectId: z.string().nullable().optional(), date: DAY.optional(), minutes: MINUTES.optional(), title: z.string().trim().max(200).nullable().optional(), notes: z.string().trim().max(2000).nullable().optional(), photoId: z.string().nullable().optional() });
export const SchoolSummarySchema = z
  .object({ from: z.string(), to: z.string(), rows: z.array(z.object({ memberId: z.string(), subjectId: z.string().nullable(), minutes: z.number().int() })) })
  .openapi('SchoolSummary', { description: 'Approved minutes by kid and subject between from and to (inclusive).' });

const OFF = { error: 'School is turned off in Settings → General → Features' };
const errors = {
  400: { description: 'invalid request', content: { 'application/json': { schema: ErrorSchema } } },
  403: { description: "parents only, or a kid's device logging for someone else", content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'not found, or School is turned off (settings.features.school)', content: { 'application/json': { schema: ErrorSchema } } },
};
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const res = <T extends z.ZodType>(description: string, schema: T) => ({ description, content: { 'application/json': { schema } } });
const ok = res('done', z.object({ ok: z.boolean() }));
const params = z.object({ id: z.string() });
const allQuery = z.object({ all: z.enum(['0', '1']).optional().openapi({ description: '1: every row from the same save (the whole group).' }) });

type Ctx = Context<{ Bindings: Env }>;
const off = async (c: Ctx) => !(await readFeatures(c.env.DB)).school;
const isParent = async (c: Ctx) => (await requestKey(c))?.scope !== 'display';

type SubjectRow = { id: string; name: string; emoji: string | null; color: string; sort: number; archived: number; goal_hours: number | null };
type KidRow = { member_id: string; mode: 'home' | 'enrolled'; grade: string | null; approve_logs: number; day_start: string | null; day_end: string | null; to_school_by: string | null; to_school_time: string | null; from_school_by: string | null; from_school_time: string | null; school_days: string; calendar_ids: string; half_day_end: string | null; half_from_school_time: string | null; last_day: string | null; school_contact_id: string | null; teacher_name: string | null; teacher_email: string | null; teacher_link: string | null; contact_ids: string; terms: number; year_goal_hours: number | null; year_goal_days: number | null; daily_goal_minutes: number | null; year_start: string };
type GradeRow = { id: string; member_id: string | null; former_member?: string | null; year: number; term: number; subject_id: string; grade: string; updated_at: string };
const json = <T,>(v: string, fallback: T): T => { try { return JSON.parse(v) as T } catch { return fallback } };
type LogRow = { id: string; group_id: string; member_id: string | null; former_member?: string | null; subject_id: string | null; date: string; minutes: number; title: string | null; notes: string | null; pending: number; created_by: string | null; created_at: string; updated_at: string; chore_id?: string | null; chore_date?: string | null; photo_id?: string | null };
const toSubject = (r: SubjectRow) => ({ id: r.id, name: r.name, emoji: r.emoji, color: r.color, sort: r.sort, archived: !!r.archived, goalHours: r.goal_hours ?? null });
const toKid = (r: KidRow) => ({ memberId: r.member_id, mode: r.mode, grade: r.grade, approveLogs: !!r.approve_logs, dayStart: r.day_start, dayEnd: r.day_end, toSchoolBy: r.to_school_by ?? null, toSchoolTime: r.to_school_time ?? null, fromSchoolBy: r.from_school_by ?? null, fromSchoolTime: r.from_school_time ?? null, schoolDays: json<number[]>(r.school_days, [1, 2, 3, 4, 5]), calendarIds: json<string[]>(r.calendar_ids, []), halfDayEnd: r.half_day_end ?? null, halfFromSchoolTime: r.half_from_school_time ?? null, lastDay: r.last_day ?? null, schoolContactId: r.school_contact_id ?? null, teacherName: r.teacher_name ?? null, teacherEmail: r.teacher_email ?? null, teacherLink: r.teacher_link ?? null, contactIds: json<string[]>(r.contact_ids, []), terms: r.terms, yearGoalHours: r.year_goal_hours ?? null, yearGoalDays: r.year_goal_days ?? null, dailyGoalMinutes: r.daily_goal_minutes ?? null, yearStart: r.year_start ?? DEFAULT_YEAR_START });
export const toGrade = (r: GradeRow) => ({ id: r.id, memberId: r.member_id, formerMember: r.former_member ?? null, year: r.year, term: r.term, subjectId: r.subject_id, grade: r.grade, updatedAt: r.updated_at });
export const toSchoolLog = (r: LogRow) => ({ id: r.id, groupId: r.group_id, memberId: r.member_id, formerMember: r.former_member ?? null, subjectId: r.subject_id, date: r.date, minutes: r.minutes, title: r.title, notes: r.notes, pending: !!r.pending, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, choreId: r.chore_id ?? null, choreDate: r.chore_date ?? null, photoId: r.photo_id ?? null });

export async function readSubjects(db: KinwallDb, archived = false) {
  const { results } = await db.prepare(`SELECT * FROM school_subjects ${archived ? '' : 'WHERE archived = 0'} ORDER BY sort, name`).all<SubjectRow>();
  return results.map(toSubject);
}
export async function readKids(db: KinwallDb) {
  const { results } = await db.prepare('SELECT k.* FROM school_kids k JOIN members m ON m.id = k.member_id ORDER BY m.sort, m.name').all<KidRow>();
  return results.map(toKid);
}
export async function readLogs(db: KinwallDb, q: { from?: string; to?: string; memberId?: string; pending?: boolean } = {}) {
  const { results } = await db.prepare('SELECT * FROM school_logs WHERE (?1 IS NULL OR date >= ?1) AND (?2 IS NULL OR date <= ?2) AND (?3 IS NULL OR member_id = ?3) AND (?4 = 0 OR pending = 1) ORDER BY date DESC, created_at DESC, id')
    .bind(q.from ?? null, q.to ?? null, q.memberId ?? null, q.pending ? 1 : 0).all<LogRow>();
  return results.map(toSchoolLog);
}
export async function readGrades(db: KinwallDb, q: { memberId?: string; year?: number } = {}) {
  const { results } = await db.prepare('SELECT * FROM school_grades WHERE (?1 IS NULL OR member_id = ?1) AND (?2 IS NULL OR year = ?2) ORDER BY year, term, subject_id').bind(q.memberId ?? null, q.year ?? null).all<GradeRow>();
  return results.map(toGrade);
}
async function today(db: KinwallDb) { return todayInTz((await readSettings(db)).timezone || hostTimezone()); }
async function subjectExists(db: KinwallDb, id: string | null | undefined) { return !id || !!(await db.prepare('SELECT id FROM school_subjects WHERE id = ?').bind(id).first()); }
/** A photo a log or report card may use: a family photo, or one uploaded for it (not a coloring page or a profile picture). */
async function photoUsable(db: KinwallDb, id: string | null | undefined) {
  if (!id) return true;
  const p = await db.prepare('SELECT family, coloring, avatar FROM photos WHERE id = ?').bind(id).first<{ family: number; coloring: number; avatar: number }>();
  return !!p && !(p.coloring || p.avatar);
}
/** Deletes the photos among `ids` that were uploaded just for School (family = 0) once no log, report card or memory uses them. */
export async function dropSchoolPhotos(c: Ctx, ids: (string | null | undefined)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return;
  const r = await c.env.DB.prepare(`DELETE FROM photos WHERE id IN (SELECT value FROM json_each(?)) AND family = 0 AND coloring = 0 AND avatar = 0
    AND NOT EXISTS (SELECT 1 FROM school_logs WHERE photo_id = photos.id) AND NOT EXISTS (SELECT 1 FROM school_report_cards WHERE photo_id = photos.id) AND NOT EXISTS (SELECT 1 FROM tracker_entries WHERE photo_id = photos.id)`).bind(JSON.stringify(list)).run();
  if (r.meta.changes) emit(c, 'photo.changed', { ids: list });
}
/** The rows ?all=1 reaches: the log's whole group, or just the log. */
async function targetIds(db: KinwallDb, id: string, all: boolean): Promise<string[]> {
  const row = await db.prepare('SELECT group_id FROM school_logs WHERE id = ?').bind(id).first<{ group_id: string }>();
  if (!row) return [];
  if (!all) return [id];
  return (await db.prepare('SELECT id FROM school_logs WHERE group_id = ?').bind(row.group_id).all<{ id: string }>()).results.map((r) => r.id);
}

/** Time a kid logged that waits for a grown-up: the bell and grown-ups' devices, once per `key` (like a chore's "Approve?"). */
async function askGrownUps(c: Ctx, key: string, memberIds: string[], minutes: number, subjectId: string | null) {
  if (!memberIds.length) return;
  const db = c.env.DB;
  const names = (await db.prepare('SELECT name FROM members WHERE id IN (SELECT value FROM json_each(?)) ORDER BY sort, name').bind(JSON.stringify(memberIds)).all<{ name: string }>()).results.map((r) => r.name).join(', ');
  const subject = subjectId ? (await db.prepare('SELECT name FROM school_subjects WHERE id = ?').bind(subjectId).first<{ name: string }>())?.name : null;
  let ctx;
  try { ctx = c.executionCtx; } catch { ctx = undefined; } // Node: no ExecutionContext
  notifyChoreApproval(c.env, ctx, 'parents', key, {
    text: (lang) => {
      const { t } = words(lang);
      return {
        title: subject ? t('{name} logged {n} min of {subject}. Approve?', { name: names, n: minutes, subject }) : t('{name} logged {n} min of school time. Approve?', { name: names, n: minutes }),
        body: t('Open School to approve it.'),
      };
    },
    url: '/#/school',
    memberIds,
  });
}

/** Schoolwork ticked off (and approved, if it needed that) by `memberId`: logs its minutes under its
 * subject, once per chore and day. Held for approval when it was ticked on a wall or kid's device
 * and the kid's settings say so, unless a parent just approved the tick itself. */
export async function schoolFromChore(c: Ctx, chore: { id: string; title: string; school_subject_id?: string | null; school_minutes?: number | null; timer_minutes?: number | null }, date: string, memberId: string | null | undefined, parentApproved = false): Promise<void> {
  if (!chore.school_subject_id || await off(c)) return;
  const db = c.env.DB;
  const kid = memberId ? await db.prepare('SELECT approve_logs FROM school_kids WHERE member_id = ?').bind(memberId).first<{ approve_logs: number }>() : null;
  // Credited to no one in particular, or to someone not in school (a grown-up): no kid keeps time a re-tick took from them.
  if (!memberId || !kid) return unschoolFromChore(c, chore.id, date);
  const pending = !parentApproved && !(await isParent(c)) && !!kid?.approve_logs ? 1 : 0;
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const logged = await db.prepare('INSERT INTO school_logs (id, group_id, member_id, subject_id, date, minutes, title, pending, created_by, created_at, updated_at, chore_id, chore_date) VALUES (?, ?, ?, (SELECT id FROM school_subjects WHERE id = ?), ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chore_id, chore_date) WHERE chore_id IS NOT NULL DO UPDATE SET member_id = excluded.member_id, pending = excluded.pending, updated_at = excluded.updated_at WHERE school_logs.member_id <> excluded.member_id RETURNING id')
    .bind(id, id, memberId, chore.school_subject_id, date, chore.school_minutes ?? chore.timer_minutes ?? 30, chore.title, pending, (await actorOf(c)).memberId, now, now, chore.id, date).first<{ id: string }>();
  if (logged) emit(c, 'school.changed', { id: logged.id, kind: 'log', memberIds: [memberId], pending: !!pending, choreId: chore.id });
  if (logged && pending) await askGrownUps(c, `school:${chore.id}:${date}:${memberId}`, [memberId], chore.school_minutes ?? chore.timer_minutes ?? 30, chore.school_subject_id);
}
/** A schoolwork tick undone: the school time it logged goes too. */
export async function unschoolFromChore(c: Ctx, choreId: string, date: string): Promise<void> {
  const r = await c.env.DB.prepare('DELETE FROM school_logs WHERE chore_id = ? AND chore_date = ?').bind(choreId, date).run();
  if (r.meta.changes) emit(c, 'school.changed', { id: choreId, kind: 'log', deleted: true, choreId });
}

// ---- Subjects ----------------------------------------------------------------------------------

schoolRoutes.openapi(
  createRoute({ method: 'get', path: '/api/school/subjects', tags: ['School'], summary: 'School subjects (Math, Reading…), in order', security: [{ Bearer: [] }], request: { query: z.object({ archived: z.enum(['all']).optional() }) }, responses: { 200: res('subjects', z.array(SchoolSubjectSchema)), 404: errors[404] } }),
  async (c) => (await off(c) ? c.json(OFF, 404) : c.json(await readSubjects(c.env.DB, c.req.valid('query').archived === 'all'), 200)),
);

schoolRoutes.openapi(
  createRoute({ method: 'post', path: '/api/school/subjects', tags: ['School'], summary: 'Add a school subject (parents)', security: [{ Bearer: [] }], request: { body: body(SubjectInputSchema) }, responses: { 201: res('subject', SchoolSubjectSchema), ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { name, emoji, color, sort, archived, goalHours } = c.req.valid('json');
    const db = c.env.DB;
    const next = sort ?? ((await db.prepare('SELECT MAX(sort) AS m FROM school_subjects').first<{ m: number | null }>())?.m ?? -1) + 1;
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO school_subjects (id, name, emoji, color, sort, archived, goal_hours, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(id, name, emoji || null, color, next, archived ? 1 : 0, goalHours ?? null, new Date().toISOString()).run();
    emit(c, 'school.changed', { id, kind: 'subject' });
    return c.json({ id, name, emoji: emoji || null, color, sort: next, archived: !!archived, goalHours: goalHours ?? null }, 201);
  },
);

schoolRoutes.openapi(
  createRoute({ method: 'patch', path: '/api/school/subjects/{id}', tags: ['School'], summary: 'Rename, recolor, reorder or archive a school subject (parents)', security: [{ Bearer: [] }], request: { params, body: body(SubjectInputSchema.partial()) }, responses: { 200: res('subject', SchoolSubjectSchema), ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const { name, emoji, color, sort, archived, goalHours } = c.req.valid('json');
    const r = await c.env.DB.prepare('UPDATE school_subjects SET name = coalesce(?, name), emoji = CASE WHEN ? THEN ? ELSE emoji END, color = coalesce(?, color), sort = coalesce(?, sort), archived = coalesce(?, archived), goal_hours = CASE WHEN ? THEN ? ELSE goal_hours END WHERE id = ?')
      .bind(name ?? null, emoji !== undefined ? 1 : 0, emoji || null, color ?? null, sort ?? null, archived === undefined ? null : archived ? 1 : 0, goalHours !== undefined ? 1 : 0, goalHours ?? null, id).run();
    if (!r.meta.changes) return c.json({ error: 'subject not found' }, 404);
    emit(c, 'school.changed', { id, kind: 'subject' });
    return c.json(toSubject((await c.env.DB.prepare('SELECT * FROM school_subjects WHERE id = ?').bind(id).first<SubjectRow>())!), 200);
  },
);

schoolRoutes.openapi(
  createRoute({ method: 'delete', path: '/api/school/subjects/{id}', tags: ['School'], summary: 'Delete a school subject (parents); time logged under it stays, with no subject', security: [{ Bearer: [] }], request: { params }, responses: { 200: ok, ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const r = await c.env.DB.prepare('DELETE FROM school_subjects WHERE id = ?').bind(id).run(); // ON DELETE SET NULL clears logs
    if (!r.meta.changes) return c.json({ error: 'subject not found' }, 404);
    emit(c, 'school.changed', { id, kind: 'subject', deleted: true });
    return c.json({ ok: true }, 200);
  },
);

// ---- Kids --------------------------------------------------------------------------------------

schoolRoutes.openapi(
  createRoute({ method: 'get', path: '/api/school/kids', tags: ['School'], summary: 'The kids in school and their school settings', security: [{ Bearer: [] }], responses: { 200: res('kids', z.array(SchoolKidSchema)), 404: errors[404] } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const kids = await readKids(c.env.DB);
    // A teacher's email and link stay on parents' devices, like a contact's details off the wall.
    return c.json(await isParent(c) ? kids : kids.map((k) => ({ ...k, teacherEmail: null, teacherLink: null })), 200);
  },
);

schoolRoutes.openapi(
  createRoute({ method: 'put', path: '/api/school/kids/{id}', tags: ['School'], summary: "Put a family member in school, or change their school settings (parents); id is the member's", security: [{ Bearer: [] }], request: { params, body: body(KidInputSchema) }, responses: { 200: res('kid', SchoolKidSchema), ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = c.env.DB;
    if (!(await db.prepare('SELECT id FROM members WHERE id = ?').bind(id).first())) return c.json({ error: 'member not found' }, 404);
    if (input.calendarIds?.length && ((await db.prepare('SELECT COUNT(*) AS n FROM calendars WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify([...new Set(input.calendarIds)])).first<{ n: number }>())?.n ?? 0) !== new Set(input.calendarIds).size) return c.json({ error: 'calendar not found' }, 400);
    if (input.schoolContactId && !(await db.prepare('SELECT id FROM contacts WHERE id = ?').bind(input.schoolContactId).first())) return c.json({ error: 'contact not found' }, 400);
    for (const by of [input.toSchoolBy, input.fromSchoolBy]) if (by && by !== 'bus' && !(await db.prepare('SELECT id FROM members WHERE id = ? AND grown_up = 1').bind(by).first())) return c.json({ error: stored('error', 'Pick the bus or a grown-up.') }, 400);
    if (input.contactIds?.length && ((await db.prepare('SELECT COUNT(*) AS n FROM contacts WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify([...new Set(input.contactIds)])).first<{ n: number }>())?.n ?? 0) !== new Set(input.contactIds).size) return c.json({ error: 'contact not found' }, 400);
    // Only the fields sent change; a new kid starts with the table's defaults.
    const cols: [string, unknown][] = [['mode', input.mode], ['grade', input.grade === undefined ? undefined : input.grade || null], ['approve_logs', input.approveLogs === undefined ? undefined : input.approveLogs ? 1 : 0],
      ['day_start', input.dayStart], ['day_end', input.dayEnd], ['to_school_by', input.toSchoolBy], ['to_school_time', input.toSchoolTime], ['from_school_by', input.fromSchoolBy], ['from_school_time', input.fromSchoolTime], ['school_days', input.schoolDays && JSON.stringify([...new Set(input.schoolDays)].sort())], ['calendar_ids', input.calendarIds && JSON.stringify([...new Set(input.calendarIds)])], ['half_day_end', input.halfDayEnd], ['half_from_school_time', input.halfFromSchoolTime], ['last_day', input.lastDay], ['school_contact_id', input.schoolContactId], ['teacher_name', input.teacherName === undefined ? undefined : input.teacherName || null], ['teacher_email', input.teacherEmail === undefined ? undefined : input.teacherEmail || null], ['teacher_link', input.teacherLink === undefined ? undefined : input.teacherLink || null],
      ['contact_ids', input.contactIds && JSON.stringify([...new Set(input.contactIds)])], ['terms', input.terms], ['year_goal_hours', input.yearGoalHours], ['year_goal_days', input.yearGoalDays], ['daily_goal_minutes', input.dailyGoalMinutes], ['year_start', input.yearStart]];
    const set = cols.filter(([, v]) => v !== undefined);
    const now = new Date().toISOString();
    await db.batch([
      db.prepare('INSERT OR IGNORE INTO school_kids (member_id, mode, updated_at) VALUES (?, ?, ?)').bind(id, input.mode, now),
      db.prepare(`UPDATE school_kids SET ${set.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE member_id = ?`).bind(...set.map(([, v]) => v), now, id),
    ]);
    emit(c, 'school.changed', { id, kind: 'kid' });
    return c.json(toKid((await db.prepare('SELECT * FROM school_kids WHERE member_id = ?').bind(id).first<KidRow>())!), 200);
  },
);

schoolRoutes.openapi(
  createRoute({ method: 'delete', path: '/api/school/kids/{id}', tags: ['School'], summary: 'Take a family member out of school (parents); their logged time stays', security: [{ Bearer: [] }], request: { params }, responses: { 200: ok, ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const r = await c.env.DB.prepare('DELETE FROM school_kids WHERE member_id = ?').bind(id).run();
    if (!r.meta.changes) return c.json({ error: 'not in school' }, 404);
    emit(c, 'school.changed', { id, kind: 'kid', deleted: true });
    return c.json({ ok: true }, 200);
  },
);

// ---- Grades (parents only: not in auth.ts DISPLAY_ALLOWED) ------------------------------------

schoolRoutes.openapi(
  createRoute({ method: 'get', path: '/api/school/grades', tags: ['School'], summary: 'Report card grades (parents only)', security: [{ Bearer: [] }], request: { query: z.object({ memberId: z.string().optional(), year: z.coerce.number().int().optional() }) }, responses: { 200: res('grades', z.array(SchoolGradeSchema)), 403: errors[403], 404: errors[404] } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const q = c.req.valid('query');
    return c.json(await readGrades(c.env.DB, q), 200);
  },
);

schoolRoutes.openapi(
  createRoute({ method: 'put', path: '/api/school/grades', tags: ['School'], summary: 'Set or clear one report card grade (parents only)', security: [{ Bearer: [] }], request: { body: body(GradeInputSchema) }, responses: { 200: res('the grade, or null once cleared', SchoolGradeSchema.nullable()), ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const g = c.req.valid('json');
    const db = c.env.DB;
    const kid = await db.prepare('SELECT terms FROM school_kids WHERE member_id = ?').bind(g.memberId).first<{ terms: number }>();
    if (!kid) return c.json({ error: stored('error', 'Only kids in school can have school time. Add them in School → Set up.') }, 400);
    if (g.term > kid.terms) return c.json({ error: 'term out of range' }, 400);
    if (!(await subjectExists(db, g.subjectId))) return c.json({ error: 'subject not found' }, 400);
    const key = [g.memberId, g.year, g.term, g.subjectId];
    if (!g.grade) {
      await db.prepare('DELETE FROM school_grades WHERE member_id = ? AND year = ? AND term = ? AND subject_id = ?').bind(...key).run();
      emit(c, 'school.changed', { id: g.memberId, kind: 'grade', deleted: true });
      return c.json(null, 200);
    }
    await db.prepare('INSERT INTO school_grades (id, member_id, year, term, subject_id, grade, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(member_id, year, term, subject_id) DO UPDATE SET grade = excluded.grade, updated_at = excluded.updated_at')
      .bind(crypto.randomUUID(), ...key, g.grade, new Date().toISOString()).run();
    emit(c, 'school.changed', { id: g.memberId, kind: 'grade' });
    const row = await db.prepare('SELECT * FROM school_grades WHERE member_id = ? AND year = ? AND term = ? AND subject_id = ?').bind(...key).first<GradeRow>();
    return c.json(toGrade(row!), 200);
  },
);

schoolRoutes.openapi(
  createRoute({ method: 'get', path: '/api/school/kids/{id}/terms-used', tags: ['School'], summary: "The highest report card term with a grade or report card photo saved for this kid, in any school year (parents only); 0 for none", security: [{ Bearer: [] }], request: { params }, responses: { 200: res('highest term', z.object({ highestTerm: z.number().int() })), 403: errors[403], 404: errors[404] } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const row = await c.env.DB.prepare('SELECT max(coalesce((SELECT max(term) FROM school_grades WHERE member_id = ?1), 0), coalesce((SELECT max(term) FROM school_report_cards WHERE member_id = ?1), 0)) AS highest').bind(id).first<{ highest: number }>();
    return c.json({ highestTerm: row?.highest ?? 0 }, 200);
  },
);

// ---- Records (parents only: not in auth.ts DISPLAY_ALLOWED) -----------------------------------

export const SchoolRecordsSchema = z.object({
  year: z.number().int(), from: z.string(), to: z.string(),
  minutes: z.number().int().openapi({ description: 'Approved minutes in the school year.' }), days: z.number().int().openapi({ description: 'Days with approved time logged.' }),
  bySubject: z.array(z.object({ subjectId: z.string().nullable(), minutes: z.number().int() })),
  byMonth: z.array(z.object({ month: z.string(), minutes: z.number().int(), days: z.number().int() })),
  photos: z.array(z.object({ photoId: z.string(), logId: z.string(), date: z.string(), title: z.string().nullable(), subjectId: z.string().nullable() })),
  reportCards: z.array(z.object({ term: z.number().int(), photoId: z.string() })),
}).openapi('SchoolRecords', { description: "A kid's school year: from their yearStart to the day before the next one, named by its first calendar year." });

/** The days a kid's school year `year` covers: from its start (MM-DD) to the day before the next year's. */
export function schoolYearRange(year: number, start = DEFAULT_YEAR_START) {
  const next = new Date(`${year + 1}-${start}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() - 1);
  return { from: `${year}-${start}`, to: next.toISOString().slice(0, 10) };
}
/** Which school year a day is in for a year starting on `start` (MM-DD). */
export const schoolYearOf = (day: string, start = DEFAULT_YEAR_START) => Number(day.slice(0, 4)) - (day.slice(5) < start ? 1 : 0);

/** A kid's school year from approved logs: totals, by subject and month, the portfolio and report card photos. */
export async function readRecords(db: KinwallDb, memberId: string, year: number) {
  const start = (await db.prepare('SELECT year_start FROM school_kids WHERE member_id = ?').bind(memberId).first<{ year_start: string }>())?.year_start;
  const { from, to } = schoolYearRange(year, start);
  const [subj, month, total, photos, cards] = await db.batch<any>([
    db.prepare('SELECT subject_id, SUM(minutes) AS minutes FROM school_logs WHERE member_id = ? AND pending = 0 AND date BETWEEN ? AND ? GROUP BY subject_id ORDER BY minutes DESC').bind(memberId, from, to),
    db.prepare('SELECT substr(date, 1, 7) AS month, SUM(minutes) AS minutes, COUNT(DISTINCT date) AS days FROM school_logs WHERE member_id = ? AND pending = 0 AND date BETWEEN ? AND ? GROUP BY month ORDER BY month').bind(memberId, from, to),
    db.prepare('SELECT coalesce(SUM(minutes), 0) AS minutes, COUNT(DISTINCT date) AS days FROM school_logs WHERE member_id = ? AND pending = 0 AND date BETWEEN ? AND ?').bind(memberId, from, to),
    db.prepare('SELECT id, photo_id, date, title, subject_id FROM school_logs WHERE member_id = ? AND pending = 0 AND photo_id IS NOT NULL AND date BETWEEN ? AND ? ORDER BY date, created_at').bind(memberId, from, to),
    db.prepare('SELECT term, photo_id FROM school_report_cards WHERE member_id = ? AND year = ? ORDER BY term').bind(memberId, year),
  ]);
  return {
    year, from, to, minutes: total.results[0].minutes, days: total.results[0].days,
    bySubject: subj.results.map((r: any) => ({ subjectId: r.subject_id, minutes: r.minutes })),
    byMonth: month.results.map((r: any) => ({ month: r.month, minutes: r.minutes, days: r.days })),
    photos: photos.results.map((r: any) => ({ photoId: r.photo_id, logId: r.id, date: r.date, title: r.title, subjectId: r.subject_id })),
    reportCards: cards.results.map((r: any) => ({ term: r.term, photoId: r.photo_id })),
  };
}

schoolRoutes.openapi(
  createRoute({ method: 'get', path: '/api/school/records', tags: ['School'], summary: "A kid's school year: hours, days, by subject and month, portfolio photos and report cards (parents only)", security: [{ Bearer: [] }], request: { query: z.object({ memberId: z.string(), year: z.coerce.number().int().min(2000).max(2100) }) }, responses: { 200: res('records', SchoolRecordsSchema), 403: errors[403], 404: errors[404] } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { memberId, year } = c.req.valid('query');
    return c.json(await readRecords(c.env.DB, memberId, year), 200);
  },
);

schoolRoutes.openapi(
  createRoute({ method: 'put', path: '/api/school/report-cards', tags: ['School'], summary: 'Set or clear the photo of a report card (parents only)', security: [{ Bearer: [] }], request: { body: body(z.object({ memberId: z.string(), year: z.number().int().min(2000).max(2100), term: z.number().int().min(1).max(12), photoId: z.string().nullable() })) }, responses: { 200: ok, ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const b = c.req.valid('json');
    const db = c.env.DB;
    const kid = await db.prepare('SELECT terms FROM school_kids WHERE member_id = ?').bind(b.memberId).first<{ terms: number }>();
    if (!kid) return c.json({ error: stored('error', 'Only kids in school can have school time. Add them in School → Set up.') }, 400);
    if (b.term > kid.terms) return c.json({ error: 'term out of range' }, 400);
    if (!(await photoUsable(db, b.photoId))) return c.json({ error: 'photo not found' }, 400);
    const was = (await db.prepare('SELECT photo_id FROM school_report_cards WHERE member_id = ? AND year = ? AND term = ?').bind(b.memberId, b.year, b.term).first<{ photo_id: string }>())?.photo_id;
    if (b.photoId) await db.prepare('INSERT INTO school_report_cards (id, member_id, year, term, photo_id, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(member_id, year, term) DO UPDATE SET photo_id = excluded.photo_id, updated_at = excluded.updated_at').bind(crypto.randomUUID(), b.memberId, b.year, b.term, b.photoId, new Date().toISOString()).run();
    else await db.prepare('DELETE FROM school_report_cards WHERE member_id = ? AND year = ? AND term = ?').bind(b.memberId, b.year, b.term).run();
    if (was && was !== b.photoId) await dropSchoolPhotos(c, [was]);
    emit(c, 'school.changed', { id: b.memberId, kind: 'report-card' });
    return c.json({ ok: true }, 200);
  },
);

// ---- School days -------------------------------------------------------------------------------
// Each kid's days (school-days.ts): a school day, a half day, none (a day off, a weekend, summer), and
// the countdown to the last day of school. A grown-up's mark for one day wins over the calendars.

export const SchoolDaySchema = z.object({
  memberId: z.string(), date: z.string(),
  kind: z.enum(['school', 'half', 'off', 'weekend', 'summer']).openapi({ description: 'half: early release (halfDayEnd). weekend: not one of their schoolDays. summer: after their last day of school, until the next school year.' }),
  reason: z.string().nullable().openapi({ description: 'The school calendar event that made it a day off or a half day.' }),
  last: z.boolean().openapi({ description: 'The last day of school.' }),
  marked: z.boolean().openapi({ description: 'A grown-up marked this day, over what the calendars say.' }),
}).openapi('SchoolDay');
const SchoolDaysSchema = z.object({
  days: z.array(SchoolDaySchema),
  left: z.array(z.object({ memberId: z.string(), lastDay: z.string(), left: z.number().int().openapi({ description: 'School days and half days from today through the last day.' }) })),
}).openapi('SchoolDays');
const DaysQuery = z.object({ from: DAY, to: DAY }).refine((q) => q.to >= q.from && Date.parse(q.to) - Date.parse(q.from) <= 62 * 86400000, 'choose an ordered range of at most 63 days');

schoolRoutes.openapi(
  createRoute({ method: 'get', path: '/api/school/days', tags: ['School'], summary: "Each kid's school days from `from` to `to` (at most 63), from their school calendars, the family's day rules (settings.school) and grown-ups' marks, with the school days left this year", security: [{ Bearer: [] }], request: { query: DaysQuery }, responses: { 200: res('days', SchoolDaysSchema), 400: errors[400], 404: errors[404] } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { from, to } = c.req.valid('query');
    const db = c.env.DB;
    const { kids, settings, tz } = await loadSchoolDays(db, from, to);
    const today = todayInTz(tz);
    const days = [], left = [];
    for (const [memberId, kid] of kids) for (let d = from; d <= to; d = new Date(Date.parse(`${d}T12:00:00Z`) + 86400000).toISOString().slice(0, 10)) days.push({ memberId, ...classifyDay(kid, d, settings.rules, tz) });
    // The countdown reads the calendars from today to the furthest last day, once.
    const lasts = [...kids.values()].map(k => lastDayOf(k, today, settings.rules, tz)).filter((d): d is string => !!d && d >= today).sort();
    if (lasts.length) {
      const wide = await loadSchoolDays(db, today, lasts[lasts.length - 1]);
      for (const [memberId, kid] of wide.kids) { const count = schoolDaysLeft(kid, today, settings.rules, tz); if (count) left.push({ memberId, ...count }); }
    }
    return c.json({ days, left }, 200);
  },
);

schoolRoutes.openapi(
  createRoute({ method: 'put', path: '/api/school/days/{id}/{date}', tags: ['School'], summary: "Mark one kid's day as a school day, a half day or no school (parents), over what the calendars say; kind null clears the mark. id is the member's", security: [{ Bearer: [] }], request: { params: z.object({ id: z.string(), date: DAY }), body: body(z.object({ kind: z.enum(['school', 'half', 'off']).nullable() })) }, responses: { 200: ok, ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id, date } = c.req.valid('param');
    const { kind } = c.req.valid('json');
    const db = c.env.DB;
    if (!(await db.prepare('SELECT member_id FROM school_kids WHERE member_id = ?').bind(id).first())) return c.json({ error: 'not in school' }, 404);
    await (kind ? db.prepare('INSERT INTO school_day_marks (member_id, date, kind) VALUES (?, ?, ?) ON CONFLICT(member_id, date) DO UPDATE SET kind = excluded.kind').bind(id, date, kind) : db.prepare('DELETE FROM school_day_marks WHERE member_id = ? AND date = ?').bind(id, date)).run();
    emit(c, 'school.changed', { id, kind: 'day', date });
    return c.json({ ok: true }, 200);
  },
);

// ---- Logs --------------------------------------------------------------------------------------

schoolRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/school/logs', tags: ['School'], summary: 'Logged school time, newest first', security: [{ Bearer: [] }],
    request: { query: z.object({ from: DAY.optional(), to: DAY.optional(), memberId: z.string().optional(), pending: z.enum(['0', '1']).optional().openapi({ description: '1: only the ones waiting for approval.' }) }) },
    responses: { 200: res('logs', z.array(SchoolLogSchema)), 404: errors[404] },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const q = c.req.valid('query');
    return c.json(await readLogs(c.env.DB, { ...q, pending: q.pending === '1' }), 200);
  },
);

schoolRoutes.openapi(
  createRoute({ method: 'post', path: '/api/school/logs', tags: ['School'], summary: 'Log school time for one kid or several', security: [{ Bearer: [] }], request: { body: body(SchoolLogInputSchema) }, responses: { 201: res('the rows written, one per kid', z.object({ logs: z.array(SchoolLogSchema) })), ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const input = c.req.valid('json');
    const db = c.env.DB;
    const memberIds = [...new Set(input.memberIds)];
    const blocked = await ownerBlock(c, ...memberIds);
    if (blocked) return c.json({ error: blocked }, 403);
    const kids = new Map((await readKids(db)).map((k) => [k.memberId, k]));
    if (memberIds.some((id) => !kids.has(id))) return c.json({ error: stored('error', 'Only kids in school can have school time. Add them in School → Set up.') }, 400);
    if (!(await subjectExists(db, input.subjectId))) return c.json({ error: 'subject not found' }, 400);
    if (!(await photoUsable(db, input.photoId))) return c.json({ error: 'photo not found' }, 400);
    const parent = await isParent(c);
    const date = input.date ?? (await today(db));
    const now = new Date().toISOString();
    const groupId = crypto.randomUUID();
    const createdBy = (await actorOf(c)).memberId;
    const rows: LogRow[] = memberIds.map((memberId) => ({
      id: crypto.randomUUID(), group_id: groupId, member_id: memberId, subject_id: input.subjectId ?? null, date, minutes: input.minutes, title: input.title || null, notes: input.notes || null,
      pending: !parent && kids.get(memberId)!.approveLogs ? 1 : 0, created_by: createdBy, created_at: now, updated_at: now, photo_id: input.photoId ?? null,
    }));
    await db.batch(rows.map((r) => db.prepare('INSERT INTO school_logs (id, group_id, member_id, subject_id, date, minutes, title, notes, pending, created_by, created_at, updated_at, photo_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(r.id, r.group_id, r.member_id, r.subject_id, r.date, r.minutes, r.title, r.notes, r.pending, r.created_by, r.created_at, r.updated_at, r.photo_id)));
    emit(c, 'school.changed', { id: groupId, kind: 'log', memberIds, pending: rows.some((r) => r.pending) });
    await askGrownUps(c, `school:${groupId}`, rows.filter((r) => r.pending).map((r) => r.member_id!), input.minutes, input.subjectId ?? null);
    return c.json({ logs: rows.map(toSchoolLog) }, 201);
  },
);

schoolRoutes.openapi(
  createRoute({ method: 'patch', path: '/api/school/logs/{id}', tags: ['School'], summary: 'Change logged school time (parents); ?all=1 changes every kid’s copy', security: [{ Bearer: [] }], request: { params, query: allQuery, body: body(LogPatchSchema) }, responses: { 200: res('the rows changed', z.object({ logs: z.array(SchoolLogSchema) })), ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const p = c.req.valid('json');
    const db = c.env.DB;
    if (!(await subjectExists(db, p.subjectId))) return c.json({ error: 'subject not found' }, 400);
    if (!(await photoUsable(db, p.photoId))) return c.json({ error: 'photo not found' }, 400);
    const ids = await targetIds(db, id, c.req.valid('query').all === '1');
    if (!ids.length) return c.json({ error: 'log not found' }, 404);
    const before = p.photoId === undefined ? [] : (await db.prepare('SELECT photo_id FROM school_logs WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<{ photo_id: string | null }>()).results.map((r) => r.photo_id);
    const set = (v: unknown) => (v === undefined ? 0 : 1);
    await db.prepare(`UPDATE school_logs SET subject_id = CASE WHEN ?1 THEN ?2 ELSE subject_id END, date = coalesce(?3, date), minutes = coalesce(?4, minutes),
      title = CASE WHEN ?5 THEN ?6 ELSE title END, notes = CASE WHEN ?7 THEN ?8 ELSE notes END, photo_id = CASE WHEN ?11 THEN ?12 ELSE photo_id END, updated_at = ?9 WHERE id IN (SELECT value FROM json_each(?10))`)
      .bind(set(p.subjectId), p.subjectId ?? null, p.date ?? null, p.minutes ?? null, set(p.title), p.title || null, set(p.notes), p.notes || null, new Date().toISOString(), JSON.stringify(ids), set(p.photoId), p.photoId ?? null).run();
    await dropSchoolPhotos(c, before);
    emit(c, 'school.changed', { id, kind: 'log' });
    const { results } = await db.prepare('SELECT * FROM school_logs WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<LogRow>();
    return c.json({ logs: results.map(toSchoolLog) }, 200);
  },
);

schoolRoutes.openapi(
  createRoute({ method: 'post', path: '/api/school/logs/{id}/approve', tags: ['School'], summary: 'Approve school time a kid logged (parents); ?all=1 approves every kid’s copy', security: [{ Bearer: [] }], request: { params, query: allQuery }, responses: { 200: ok, ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const ids = await targetIds(c.env.DB, c.req.valid('param').id, c.req.valid('query').all === '1');
    if (!ids.length) return c.json({ error: 'log not found' }, 404);
    await c.env.DB.prepare('UPDATE school_logs SET pending = 0, updated_at = ? WHERE id IN (SELECT value FROM json_each(?))').bind(new Date().toISOString(), JSON.stringify(ids)).run();
    emit(c, 'school.changed', { id: c.req.valid('param').id, kind: 'log', approved: true });
    return c.json({ ok: true }, 200);
  },
);

schoolRoutes.openapi(
  createRoute({ method: 'delete', path: '/api/school/logs/{id}', tags: ['School'], summary: 'Delete logged school time (parents); ?all=1 deletes every kid’s copy', security: [{ Bearer: [] }], request: { params, query: allQuery }, responses: { 200: ok, ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const ids = await targetIds(c.env.DB, c.req.valid('param').id, c.req.valid('query').all === '1');
    if (!ids.length) return c.json({ error: 'log not found' }, 404);
    const photos = (await c.env.DB.prepare('SELECT photo_id FROM school_logs WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).all<{ photo_id: string | null }>()).results.map((r) => r.photo_id);
    await c.env.DB.prepare('DELETE FROM school_logs WHERE id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(ids)).run();
    await dropSchoolPhotos(c, photos);
    emit(c, 'school.changed', { id: c.req.valid('param').id, kind: 'log', deleted: true });
    return c.json({ ok: true }, 200);
  },
);

schoolRoutes.openapi(
  createRoute({ method: 'get', path: '/api/school/summary', tags: ['School'], summary: 'Approved school minutes by kid and subject (default: the last 7 days)', security: [{ Bearer: [] }], request: { query: z.object({ from: DAY.optional(), to: DAY.optional() }) }, responses: { 200: res('summary', SchoolSummarySchema), 404: errors[404] } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const db = c.env.DB;
    const q = c.req.valid('query');
    const to = q.to ?? (await today(db));
    const from = q.from ?? new Date(Date.parse(to + 'T00:00:00Z') - 6 * 86_400_000).toISOString().slice(0, 10);
    const { results } = await db.prepare('SELECT member_id, subject_id, SUM(minutes) AS minutes FROM school_logs WHERE pending = 0 AND date >= ? AND date <= ? GROUP BY member_id, subject_id ORDER BY member_id, minutes DESC')
      .bind(from, to).all<{ member_id: string; subject_id: string | null; minutes: number }>();
    return c.json({ from, to, rows: results.map((r) => ({ memberId: r.member_id, subjectId: r.subject_id, minutes: r.minutes })) }, 200);
  },
);
