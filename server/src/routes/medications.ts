// Medication reminders: per person, a medicine's name, dose (free text) and daily times, optionally
// on certain weekdays only. At each time the person's own devices get a reminder (notify.ts
// runMedicationReminders) and shared walls a "Take now" card; Taken / Skip / Snooze 10 min.
//
// Health data end to end (AGENTS.md "Health data"):
// - Off until a parent turns it on (settings.medications); off hides everything (404) and keeps the data.
// - Name, dose, times and weekdays are one sealed JSON (medications.data, aad '<id>:data'); a day's
//   taken / skipped / snoozed log is one sealed JSON per medicine per day (medication_log.log, aad
//   '<medication_id>:<date>:log'). Only who (member_id) and which day stay plain. No key: 500, nothing stored.
// - Never logged, no webhook events at all, no MCP tool, not in snapshots, profiles or share links.
//
// Who sees what (see `caller`):
// - parent devices (admin keys): everyone's medicines, the Take now cards with names, history; only
//   they add, edit and delete.
// - a person's own device (a display key they own): their own medicines, cards and history; marks their own doses.
// - a shared wall: Take now cards for whoever is due ("Meds" unless settings.medicationNamesOnWalls),
//   and marks Taken / Skip / Snooze for them; no list, no history.
// - another member's device: nothing about anyone else's medicines.
// - connected apps (MCP, AI connectors): refused unless the family turned on aiHealthAccess.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import type { KinwallDb } from '../db.ts';
import { requestKey } from '../auth.ts';
import { seal, unseal, type EncryptionEnv } from '../crypto.ts';
import { zonedTimeToUtc } from '../recurrence.ts';
import { ErrorSchema } from '../schemas.ts';
import { isConnectedApp } from './mcp-oauth.ts';
import { todayInTz } from './members.ts';
import { readSettings } from './settings.ts';

export const medicationsRoutes = createRouter();
type C = Context<{ Bindings: Env }>;

export const DUE_MS = 3 * 60 * 60_000; // a dose shows as "Take now" for 3 hours, then it's missed
export const LATE_MS = 30 * 60_000; // a kid's dose not marked by then tells parents
export const SNOOZE_MS = 10 * 60_000;

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'times: HH:MM');
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date: YYYY-MM-DD');
const Name = z.string().trim().min(1).max(60).openapi({ description: 'What it is, in the family\'s words (e.g. "Allergy medicine").' });
const Dose = z.string().trim().max(40).openapi({ description: 'Free text, e.g. "5 mg" or "1 tablet".' });
const Times = z.array(TimeSchema).min(1).max(8).transform((t) => [...new Set(t)].sort()).openapi({ description: 'Household times, HH:MM (up to 8).' });
const Days = z.array(z.number().int().min(0).max(6)).min(1).max(7).transform((d) => [...new Set(d)].sort((a, b) => a - b)).openapi({ description: 'Weekdays, 0 = Sunday. Every day by default.' });

const MedicationSchema = z
  .object({ id: z.string(), memberId: z.string(), name: z.string(), dose: z.string(), times: z.array(z.string()), days: z.array(z.number()), createdAt: z.string(), updatedAt: z.string() })
  .openapi('Medication');
const MedicationInputSchema = z.object({ memberId: z.string(), name: Name, dose: Dose.default(''), times: Times, days: Days.default([0, 1, 2, 3, 4, 5, 6]) }).openapi('MedicationInput');
const MedicationPatchSchema = z.object({ name: Name.optional(), dose: Dose.optional(), times: Times.optional(), days: Days.optional() }).openapi('MedicationPatch');
const STATUSES = ['taken', 'skipped', 'due', 'missed', 'upcoming'] as const;
const DoseSchema = z
  .object({
    medicationId: z.string(), date: z.string(), time: z.string(), status: z.enum(STATUSES),
    at: z.string().nullable().openapi({ description: 'When it was marked taken or skipped.' }),
    by: z.string().nullable().openapi({ description: 'The device that marked it.' }),
    snoozedUntil: z.string().nullable(),
  })
  .openapi('MedicationDose');
const DueSchema = z
  .object({
    names: z.boolean().openapi({ description: 'false: a shared wall with names off; name and dose are null ("Meds").' }),
    doses: z.array(z.object({ medicationId: z.string(), memberId: z.string(), date: z.string(), time: z.string(), dueAt: z.string(), name: z.string().nullable(), dose: z.string().nullable() })),
  })
  .openapi('MedicationsDue');
const HistorySchema = z
  .object({
    memberId: z.string(), today: z.string(), medications: z.array(MedicationSchema),
    days: z.array(z.object({ date: z.string(), doses: z.array(DoseSchema.omit({ date: true, snoozedUntil: true })) })).openapi({ description: 'Oldest first, today last.' }),
  })
  .openapi('MedicationHistory');

export type Medication = z.infer<typeof MedicationSchema>;
export type DoseEntry = { status?: 'taken' | 'skipped'; at?: string; by?: string; snoozedUntil?: string };
export type DoseLog = Record<string, DoseEntry>; // by time, HH:MM
type MedRow = { id: string; member_id: string; data: string; created_at: string; updated_at: string };
type LogRow = { medication_id: string; date: string; log: string; updated_at: string };

const dataAad = (id: string) => `${id}:data`;
const logAad = (id: string, date: string) => `${id}:${date}:log`;
export const sealMedication = async (env: EncryptionEnv, m: Pick<Medication, 'id' | 'name' | 'dose' | 'times' | 'days'>) =>
  seal(env, JSON.stringify({ name: m.name, dose: m.dose, times: m.times, days: m.days }), dataAad(m.id));
export async function openMedication(env: EncryptionEnv, r: MedRow): Promise<Medication> {
  const d = JSON.parse(await unseal(env, r.data, dataAad(r.id)));
  return { id: r.id, memberId: r.member_id, name: d.name, dose: d.dose ?? '', times: d.times, days: d.days, createdAt: r.created_at, updatedAt: r.updated_at };
}
export const sealLog = (env: EncryptionEnv, id: string, date: string, log: DoseLog) => seal(env, JSON.stringify(log), logAad(id, date));
export const openLog = async (env: EncryptionEnv, r: LogRow): Promise<DoseLog> => JSON.parse(await unseal(env, r.log, logAad(r.medication_id, r.date)));

/** Every medicine (or one person's), opened. */
export async function loadMedications(env: EncryptionEnv & { DB: KinwallDb }, memberId?: string): Promise<Medication[]> {
  const q = memberId ? env.DB.prepare('SELECT * FROM medications WHERE member_id = ? ORDER BY created_at, id').bind(memberId) : env.DB.prepare('SELECT * FROM medications ORDER BY created_at, id');
  return Promise.all((await q.all<MedRow>()).results.map((r) => openMedication(env, r)));
}
/** Logs for these medicines between two household days, by '<id>:<date>'. */
export async function loadLogs(env: EncryptionEnv & { DB: KinwallDb }, ids: string[], from: string, to: string): Promise<Map<string, DoseLog>> {
  if (!ids.length) return new Map();
  const { results } = await env.DB.prepare('SELECT * FROM medication_log WHERE medication_id IN (SELECT value FROM json_each(?)) AND date BETWEEN ? AND ?').bind(JSON.stringify(ids), from, to).all<LogRow>();
  return new Map(await Promise.all(results.map(async (r) => [`${r.medication_id}:${r.date}`, await openLog(env, r)] as const)));
}

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
export const scheduledOn = (m: Pick<Medication, 'days'>, date: string) => m.days.includes(new Date(`${date}T12:00:00Z`).getUTCDay());
/** The instant a dose is due: its HH:MM on that household day. */
export function doseAt(date: string, time: string, tz: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return zonedTimeToUtc({ y, mo: mo - 1, d, h, mi, s: 0 }, tz).getTime();
}
export function doseStatus(dueAt: number, e: DoseEntry | undefined, now: number): (typeof STATUSES)[number] {
  if (e?.status) return e.status;
  return now < dueAt ? 'upcoming' : now < dueAt + DUE_MS ? 'due' : 'missed';
}
/** "8:00 AM" for "08:00". */
export const clockLabel = (hm: string) => { const [h, m] = hm.split(':').map(Number); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`; };
/** "Allergy medicine · 1 tablet" (for a device that opted into names). */
export const medicineLabel = (m: Pick<Medication, 'name' | 'dose'>) => (m.dose ? `${m.name} · ${m.dose}` : m.name);

type Caller = { kind: 'parent' } | { kind: 'wall' } | { kind: 'own'; memberId: string };
const APPS = { error: "Medications are private to the family's own devices. A parent can allow connected apps to see them in Settings → Connected apps." };
const PARENTS = { error: "Medicines are added and changed from a parent's device." };
const PRIVATE = { error: "Medications are private: they show on that person's own device and parents' devices." };
const OFF = { error: 'Medications are turned off (Settings → General → Features, under Health)' };

/** Who's asking (see the top of the file), or why they may not. */
async function caller(c: C, settings: { aiHealthAccess: boolean }): Promise<Caller | { error: string }> {
  if ((await isConnectedApp(c)) && !settings.aiHealthAccess) return APPS;
  const key = await requestKey(c);
  if (key?.scope !== 'display') return { kind: 'parent' };
  return key.owner && key.owner !== 'shared' ? { kind: 'own', memberId: key.owner } : { kind: 'wall' };
}
/** Settings, the caller and the household day, or what to answer instead (feature off: 404). */
async function gate(c: C) {
  const settings = await readSettings(c.env.DB);
  if (!settings.medications) return { fail: OFF, status: 404 as const };
  const who = await caller(c, settings);
  if ('error' in who) return { fail: who, status: 403 as const };
  const tz = settings.timezone ?? hostTimezone();
  return { settings, who, tz, today: todayInTz(tz) };
}

/** SQL for the bell's feed (routes/push.ts): which 'medication' rows this caller may see, with its bind values. */
export async function medicationFeedFilter(c: C): Promise<{ sql: string; binds: string[] }> {
  const settings = await readSettings(c.env.DB);
  const who = settings.medications ? await caller(c, settings) : OFF;
  if ('error' in who) return { sql: " AND kind != 'medication'", binds: [] };
  if (who.kind === 'own') return { sql: " AND (kind != 'medication' OR EXISTS (SELECT 1 FROM json_each(member_ids) WHERE value = ?))", binds: [who.memberId] };
  return { sql: '', binds: [] };
}

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: json(ErrorSchema) });
const denied = { 403: err("not allowed from this device (see the Medications tag), or a connected app without aiHealthAccess"), 404: err('medications are off, or not found') };
const TAG = ['Medications'];

async function findMed(c: C, id: string) {
  const row = await c.env.DB.prepare('SELECT * FROM medications WHERE id = ?').bind(id).first<MedRow>();
  return row && openMedication(c.env, row);
}
async function write(c: C, m: Medication) {
  const data = await sealMedication(c.env, m); // throws without a key, before anything is written
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO medications (id, member_id, data, created_at, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .bind(m.id, m.memberId, data, m.createdAt, m.updatedAt),
    bumpRev(c.env.DB),
  ]);
}
// Open screens refetch on rev; no bus event (it would reach webhooks).
const bumpRev = (db: KinwallDb) => db.prepare("INSERT INTO settings (key, value) VALUES ('rev', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1");

medicationsRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/medications', tags: TAG, security: [{ Bearer: [] }],
    summary: "Medicines: everyone's on a parent device, their own on a person's own device. Not on shared walls.",
    request: { query: z.object({ memberId: z.string().optional() }) },
    responses: { 200: { description: 'ok', content: json(z.array(MedicationSchema)) }, ...denied },
  }),
  async (c) => {
    const g = await gate(c);
    if ('fail' in g) return c.json(g.fail, g.status);
    if (g.who.kind === 'wall') return c.json(PRIVATE, 403);
    const memberId = g.who.kind === 'own' ? g.who.memberId : c.req.valid('query').memberId;
    const meds = await loadMedications(c.env, memberId);
    return c.json(g.who.kind === 'own' ? meds.filter((m) => m.memberId === memberId) : meds, 200);
  },
);

medicationsRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/medications', tags: TAG, security: [{ Bearer: [] }],
    summary: 'Add a medicine for someone (parent devices only).',
    request: { body: { content: json(MedicationInputSchema) } },
    responses: { 201: { description: 'added', content: json(MedicationSchema) }, 400: err('bad input'), ...denied },
  }),
  async (c) => {
    const g = await gate(c);
    if ('fail' in g) return c.json(g.fail, g.status);
    if (g.who.kind !== 'parent') return c.json(PARENTS, 403);
    const body = c.req.valid('json');
    if (!(await c.env.DB.prepare('SELECT 1 FROM members WHERE id = ?').bind(body.memberId).first())) return c.json({ error: 'member not found' }, 404);
    const now = new Date().toISOString();
    const m: Medication = { id: crypto.randomUUID(), memberId: body.memberId, name: body.name, dose: body.dose, times: body.times, days: body.days, createdAt: now, updatedAt: now };
    await write(c, m);
    return c.json(m, 201);
  },
);

const idParams = z.object({ id: z.string() });

medicationsRoutes.openapi(
  createRoute({
    method: 'patch', path: '/api/medications/{id}', tags: TAG, security: [{ Bearer: [] }],
    summary: 'Change a medicine (only the fields sent; parent devices only). Past days keep their log; history follows the new schedule.',
    request: { params: idParams, body: { content: json(MedicationPatchSchema) } },
    responses: { 200: { description: 'saved', content: json(MedicationSchema) }, 400: err('bad input'), ...denied },
  }),
  async (c) => {
    const g = await gate(c);
    if ('fail' in g) return c.json(g.fail, g.status);
    if (g.who.kind !== 'parent') return c.json(PARENTS, 403);
    const found = await findMed(c, c.req.valid('param').id);
    if (!found) return c.json({ error: 'not found' }, 404);
    const body = c.req.valid('json');
    const m: Medication = { ...found, name: body.name ?? found.name, dose: body.dose ?? found.dose, times: body.times ?? found.times, days: body.days ?? found.days, updatedAt: new Date().toISOString() };
    await write(c, m);
    return c.json(m, 200);
  },
);

medicationsRoutes.openapi(
  createRoute({
    method: 'delete', path: '/api/medications/{id}', tags: TAG, security: [{ Bearer: [] }],
    summary: 'Delete a medicine and its log (parent devices only).',
    request: { params: idParams },
    responses: { 204: { description: 'deleted' }, ...denied },
  }),
  async (c) => {
    const g = await gate(c);
    if ('fail' in g) return c.json(g.fail, g.status);
    if (g.who.kind !== 'parent') return c.json(PARENTS, 403);
    const { id } = c.req.valid('param');
    if (!(await c.env.DB.prepare('SELECT 1 FROM medications WHERE id = ?').bind(id).first())) return c.json({ error: 'not found' }, 404);
    await c.env.DB.batch([
      c.env.DB.prepare('DELETE FROM medication_log WHERE medication_id = ?').bind(id),
      c.env.DB.prepare('DELETE FROM medications WHERE id = ?').bind(id),
      bumpRev(c.env.DB),
    ]);
    return c.body(null, 204);
  },
);

medicationsRoutes.openapi(
  createRoute({
    method: 'delete', path: '/api/medications', tags: TAG, security: [{ Bearer: [] }],
    summary: "Delete all medication data: every medicine, its log and its notifications (parent devices only; works while the feature is off).",
    responses: { 200: { description: 'deleted', content: json(z.object({ deleted: z.number() })) }, 403: denied[403] },
  }),
  async (c) => {
    const who = await caller(c, await readSettings(c.env.DB));
    if ('error' in who) return c.json(who, 403);
    if (who.kind !== 'parent') return c.json(PARENTS, 403);
    const db = c.env.DB;
    const deleted = (await db.prepare('SELECT COUNT(*) AS n FROM medications').first<{ n: number }>())?.n ?? 0;
    await db.batch([
      db.prepare('DELETE FROM medication_log'),
      db.prepare('DELETE FROM medications'),
      db.prepare("DELETE FROM notifications WHERE kind = 'medication'"),
      db.prepare("DELETE FROM sent_notifications WHERE key LIKE 'med:%'"),
      bumpRev(db),
    ]);
    return c.json({ deleted }, 200);
  },
);

medicationsRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/medications/due', tags: TAG, security: [{ Bearer: [] }],
    summary: 'Doses to take now (from their time for 3 hours, until taken, skipped or snoozed): the "Take now" cards. A shared wall gets everyone\'s, with name and dose null unless medicationNamesOnWalls; a person\'s own device only theirs.',
    responses: { 200: { description: 'ok', content: json(DueSchema) }, ...denied },
  }),
  async (c) => {
    const g = await gate(c);
    if ('fail' in g) return c.json(g.fail, g.status);
    const names = g.who.kind !== 'wall' || g.settings.medicationNamesOnWalls;
    const meds = (await loadMedications(c.env, g.who.kind === 'own' ? g.who.memberId : undefined));
    const yesterday = addDays(g.today, -1);
    const logs = await loadLogs(c.env, meds.map((m) => m.id), yesterday, g.today);
    const now = Date.now();
    const doses = meds.flatMap((m) => [yesterday, g.today].flatMap((date) => (scheduledOn(m, date) ? m.times : []).flatMap((time) => {
      const e = logs.get(`${m.id}:${date}`)?.[time];
      const at = doseAt(date, time, g.tz);
      if (doseStatus(at, e, now) !== 'due' || (e?.snoozedUntil && Date.parse(e.snoozedUntil) > now)) return [];
      return [{ medicationId: m.id, memberId: m.memberId, date, time, dueAt: new Date(at).toISOString(), name: names ? m.name : null, dose: names ? m.dose : null }];
    })));
    const order = new Map((await c.env.DB.prepare('SELECT id FROM members ORDER BY sort, created_at').all<{ id: string }>()).results.map((r, i) => [r.id, i]));
    doses.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || (order.get(a.memberId) ?? 0) - (order.get(b.memberId) ?? 0));
    return c.json({ names, doses }, 200);
  },
);

medicationsRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/medications/{id}/doses', tags: TAG, security: [{ Bearer: [] }],
    summary: "Mark a dose taken or skipped, or snooze it 10 minutes (today's or yesterday's). Parent devices, shared walls, and the person's own device for their own.",
    request: { params: idParams, body: { content: json(z.object({ date: DateSchema, time: TimeSchema, action: z.enum(['taken', 'skipped', 'snooze']) }).openapi('MedicationDoseInput')) } },
    responses: { 200: { description: 'saved', content: json(DoseSchema) }, 400: err('not one of its doses, or nothing to snooze'), 409: err('marked from another device at the same moment'), ...denied },
  }),
  async (c) => {
    const g = await gate(c);
    if ('fail' in g) return c.json(g.fail, g.status);
    const m = await findMed(c, c.req.valid('param').id);
    if (!m) return c.json({ error: 'not found' }, 404);
    if (g.who.kind === 'own' && g.who.memberId !== m.memberId) return c.json({ error: 'This device can only mark its own medicines.' }, 403);
    const { date, time, action } = c.req.valid('json');
    if (date !== g.today && date !== addDays(g.today, -1)) return c.json({ error: "Only today's and yesterday's doses can be marked" }, 400);
    if (!m.times.includes(time) || !scheduledOn(m, date)) return c.json({ error: "That isn't one of its doses" }, 400);
    const at = doseAt(date, time, g.tz);
    const by = (await requestKey(c))?.name ?? null;
    // Read, change and write back only if nobody wrote in between (a wall and a phone at once).
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await c.env.DB.prepare('SELECT * FROM medication_log WHERE medication_id = ? AND date = ?').bind(m.id, date).first<LogRow>();
      const log = row ? await openLog(c.env, row) : {};
      const now = new Date();
      if (action === 'snooze') {
        if (doseStatus(at, log[time], now.getTime()) !== 'due') return c.json({ error: 'Only a dose that is due can be snoozed' }, 400);
        log[time] = { snoozedUntil: new Date(now.getTime() + SNOOZE_MS).toISOString() };
      } else log[time] = { status: action, at: now.toISOString(), ...(by ? { by } : {}) };
      const sealed = await sealLog(c.env, m.id, date, log);
      const res = row
        ? await c.env.DB.prepare('UPDATE medication_log SET log = ?, updated_at = ? WHERE medication_id = ? AND date = ? AND log = ?').bind(sealed, now.toISOString(), m.id, date, row.log).run()
        : await c.env.DB.prepare('INSERT INTO medication_log (medication_id, date, log, updated_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING').bind(m.id, date, sealed, now.toISOString()).run();
      if (!res.meta.changes) continue;
      await bumpRev(c.env.DB).run();
      const e = log[time];
      return c.json({ medicationId: m.id, date, time, status: doseStatus(at, e, now.getTime()), at: e.at ?? null, by: e.by ?? null, snoozedUntil: e.snoozedUntil ?? null }, 200);
    }
    return c.json({ error: 'Someone else just marked it. Try again.' }, 409);
  },
);

medicationsRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/members/{id}/medications', tags: TAG, security: [{ Bearer: [] }],
    summary: "A person's medicines and each day's doses (taken, skipped, due, missed, upcoming), today and the days before it. Their own device and parent devices only.",
    request: { params: idParams, query: z.object({ days: z.coerce.number().int().min(1).max(31).default(7) }) },
    responses: { 200: { description: 'ok', content: json(HistorySchema) }, ...denied },
  }),
  async (c) => {
    const g = await gate(c);
    if ('fail' in g) return c.json(g.fail, g.status);
    const { id } = c.req.valid('param');
    if (g.who.kind === 'wall' || (g.who.kind === 'own' && g.who.memberId !== id)) return c.json(PRIVATE, 403);
    if (!(await c.env.DB.prepare('SELECT 1 FROM members WHERE id = ?').bind(id).first())) return c.json({ error: 'member not found' }, 404);
    const meds = await loadMedications(c.env, id);
    const from = addDays(g.today, 1 - c.req.valid('query').days);
    const logs = await loadLogs(c.env, meds.map((m) => m.id), from, g.today);
    const now = Date.now();
    const days = [];
    for (let date = from; date <= g.today; date = addDays(date, 1)) {
      const doses = meds.flatMap((m) => {
        const log = logs.get(`${m.id}:${date}`) ?? {};
        const since = todayInTz(g.tz, new Date(m.createdAt));
        // Its schedule on days since it was added, plus anything logged under a time it no longer has.
        const times = [...new Set([...(date >= since && scheduledOn(m, date) ? m.times : []), ...Object.keys(log).filter((t) => log[t].status)])].sort();
        return times.map((time) => ({ medicationId: m.id, time, status: doseStatus(doseAt(date, time, g.tz), log[time], now), at: log[time]?.at ?? null, by: log[time]?.by ?? null }));
      }).sort((a, b) => a.time.localeCompare(b.time));
      days.push({ date, doses });
    }
    return c.json({ memberId: id, today: g.today, medications: meds, days }, 200);
  },
);
