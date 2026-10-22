// Home upkeep (docs/using/upkeep.md, migration 0124): the things a family looks after, the jobs that
// keep them working and a log of every time one was done. Dates come from upkeep-rules.ts, the
// shared reads and the chore hand-off from upkeep.ts, the morning notes from notify.ts runUpkeep.
//
// Who does what: parents (full access) do everything. A kid's own device sees its kid's jobs, marks
// them done and sees its own history. A wall screen sees the jobs shown on the wall and marks them
// done for whoever picks themselves; it has no history. Neither ever gets costs, readings, notes,
// serial numbers, warranty dates, files or the people who service things: they're left out here,
// not just hidden in the app. Display keys reach only what auth.ts DISPLAY_ALLOWED lists.
//
// Its own feature switch (settings.features.upkeep): off, every route here answers 404 (so MCP
// tools refuse) and no notes go out. Nothing is deleted.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import type { KinwallDb } from '../db.ts';
import { emit } from '../bus.ts';
import { actorOf, ownerBlock, requestKey } from '../auth.ts';
import { ErrorSchema } from '../schemas.ts';
import { requestLang, stored, tm, wordsFor } from '../i18n.ts';
import { readFeatures, readSettings } from './settings.ts';
import { todayInTz } from './members.ts';
import { createEvent } from './events.ts';
import { blobBytes } from './photos.ts';
import { zonedTimeToUtc } from '../recurrence.ts';
import { addDays, scheduledDue } from '../upkeep-rules.ts';
import { factsOf, logDone, MAX_UPKEEP_FILE_BYTES, readAreas, readJobs, readLog, readThings, type UpkeepEntry, type UpkeepJob, type UpkeepThing } from '../upkeep.ts';
import { UPKEEP_STARTERS } from '../upkeep-starters.ts';

export const upkeepRoutes = createRouter();

const DAY = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
const TIME = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const LINK = z.string().trim().max(2000).regex(/^https?:\/\//i, 'a link starting with http:// or https://');
const CENTS = z.number().int().min(0).max(100_000_000);
const text = (max: number) => z.string().trim().max(max).nullable();

export const UpkeepAreaSchema = z.object({ id: z.string(), name: z.string(), emoji: z.string().nullable(), sort: z.number().int() }).openapi('UpkeepArea');
const FileSchema = z.object({ id: z.string(), name: z.string(), mime: z.string(), bytes: z.number().int() }).openapi('UpkeepFile');

export const UpkeepThingSchema = z
  .object({
    id: z.string(), name: z.string(), emoji: z.string().nullable(), areaId: z.string().nullable(), room: z.string().nullable().openapi({ description: 'Where it is: "Basement", "Garage".' }),
    brand: z.string().nullable(), model: z.string().nullable(), serial: z.string().nullable(), partNotes: z.string().nullable().openapi({ description: 'What to buy for it: "Filter 16x25x1 MERV 8".' }),
    boughtOn: z.string().nullable(), priceCents: z.number().int().nullable(), warrantyUntil: z.string().nullable(), manualUrl: z.string().nullable(),
    contactId: z.string().nullable().openapi({ description: 'The contact who services it.' }), notes: z.string().nullable(),
    archived: z.boolean().openapi({ description: 'Sold or gone: hidden from the list; its history stays.' }), createdAt: z.string(), updatedAt: z.string(),
    files: z.array(FileSchema).openapi({ description: 'Receipts, manuals, photos of the label (GET /api/upkeep/files/{id}).' }),
  })
  .openapi('UpkeepThing', { description: "A wall screen or a kid's device gets only the name, emoji, area and room; the rest is null." });

const RepeatKindSchema = z.enum(['once', 'after', 'on']);
const UnitSchema = z.enum(['day', 'week', 'month', 'year']);
const SupplySchema = z.object({ name: z.string().trim().min(1).max(200) });
export const UpkeepJobSchema = z
  .object({
    id: z.string(), title: z.string(), emoji: z.string().nullable(), thingId: z.string().nullable(), areaId: z.string().nullable(),
    repeatKind: RepeatKindSchema.openapi({ description: "'once' (on dueOn), 'after' (every N units from the last time it was done) or 'on' (fixed months and day)." }),
    every: z.number().int().nullable(), unit: UnitSchema.nullable(),
    onMonths: z.array(z.number().int()).openapi({ description: "'on': months 1-12, like [4, 10] for April and October." }), onDay: z.number().int().nullable(),
    startOn: z.string().nullable().openapi({ description: 'First due date for a job never done. Left out: the day it was added.' }), dueOn: z.string().nullable().openapi({ description: "'once': the day it's due." }),
    headsUpDays: z.number().int().openapi({ description: 'How many days before it shows as due soon and the heads-up goes out.' }),
    snoozedUntil: z.string().nullable(), skippedUntil: z.string().nullable().openapi({ description: '"Skip this time": the due date skipped; the next one counts from it.' }),
    memberId: z.string().nullable().openapi({ description: 'Who usually does it; null: any grown-up.' }), contactId: z.string().nullable().openapi({ description: 'A pro who does it.' }),
    usualCostCents: z.number().int().nullable(), steps: z.array(z.string()), supplies: z.array(SupplySchema), suppliesListId: z.string().nullable(), suppliesDays: z.number().int(),
    chorePoints: z.number().int().nullable().openapi({ description: "Set: on its due day it becomes a one-off chore for memberId with these points, and ticking that chore marks it done." }),
    handedChoreId: z.string().nullable(), calendarEventId: z.string().nullable(), calendarEventStart: z.string().nullable(), wallVisible: z.boolean(), libraryKey: z.string().nullable(),
    archived: z.boolean(), createdAt: z.string(), updatedAt: z.string(),
    nextDue: z.string().nullable().openapi({ description: 'YYYY-MM-DD, after any snooze. null: a one-off that is done, or archived.' }),
    status: z.enum(['overdue', 'due', 'soon', 'later', 'done']), lastDone: z.object({ id: z.string(), doneOn: z.string(), memberId: z.string().nullable() }).nullable(),
  })
  .openapi('UpkeepJob', { description: "A wall screen or a kid's device gets no cost, pro, supplies or list." });

export const UpkeepEntrySchema = z
  .object({
    id: z.string(), jobId: z.string().nullable(), thingId: z.string().nullable(), title: z.string(), doneOn: z.string(), memberId: z.string().nullable(), contactId: z.string().nullable(),
    costCents: z.number().int().nullable(), reading: z.number().int().nullable().openapi({ description: 'Odometer or hour meter, as read.' }), readingUnit: z.enum(['mi', 'km', 'h']).nullable(),
    notes: z.string().nullable(), choreId: z.string().nullable(), createdBy: z.string().nullable(), createdAt: z.string(), files: z.array(FileSchema),
  })
  .openapi('UpkeepEntry', { description: "A kid's device gets no cost, reading, notes or files." });

const thingFields = {
  name: z.string().trim().min(1).max(200), emoji: z.string().trim().max(16).nullable(), areaId: z.string().nullable(), room: text(100), brand: text(100), model: text(100), serial: text(100),
  partNotes: text(500), boughtOn: DAY.nullable(), priceCents: CENTS.nullable(), warrantyUntil: DAY.nullable(), manualUrl: LINK.nullable(), contactId: z.string().nullable(),
  notes: z.string().max(10_000).nullable(), archived: z.boolean(),
};
export const UpkeepThingInputSchema = z.object(thingFields).partial().required({ name: true }).openapi('UpkeepThingInput');
export const UpkeepThingPatchSchema = z.object(thingFields).partial().openapi('UpkeepThingPatch');

const jobFields = {
  title: z.string().trim().min(1).max(200), emoji: z.string().trim().max(16).nullable(), thingId: z.string().nullable(), areaId: z.string().nullable(), repeatKind: RepeatKindSchema,
  every: z.number().int().min(1).max(1000).nullable(), unit: UnitSchema.nullable(), onMonths: z.array(z.number().int().min(1).max(12)).max(12), onDay: z.number().int().min(1).max(31).nullable(),
  startOn: DAY.nullable(), dueOn: DAY.nullable(), headsUpDays: z.number().int().min(0).max(60), memberId: z.string().nullable(), contactId: z.string().nullable(),
  usualCostCents: CENTS.nullable(), steps: z.array(z.string().trim().min(1).max(300)).max(30), supplies: z.array(SupplySchema).max(20), suppliesListId: z.string().nullable(),
  suppliesDays: z.number().int().min(0).max(60), chorePoints: z.number().int().min(0).max(1000).nullable(), wallVisible: z.boolean(), archived: z.boolean(),
};
export const UpkeepJobInputSchema = z.object(jobFields).partial().required({ title: true }).openapi('UpkeepJobInput');
export const UpkeepJobPatchSchema = z.object(jobFields).partial().openapi('UpkeepJobPatch');
type JobInput = z.infer<typeof UpkeepJobPatchSchema>;
type ThingInput = z.infer<typeof UpkeepThingPatchSchema>;

export const UpkeepDoneInputSchema = z
  .object({
    doneOn: DAY.optional().openapi({ description: 'Left out: today.' }), memberId: z.string().nullable().optional(), contactId: z.string().nullable().optional(),
    costCents: CENTS.nullable().optional(), reading: z.number().int().min(0).max(100_000_000).nullable().optional(), readingUnit: z.enum(['mi', 'km', 'h']).nullable().optional(),
    notes: z.string().max(10_000).nullable().optional(),
  })
  .openapi('UpkeepDoneInput', { description: "From a wall screen or a kid's device only doneOn and memberId count (a kid's device: always its kid)." });
export const UpkeepDoneResultSchema = z.object({ entry: UpkeepEntrySchema, job: UpkeepJobSchema }).openapi('UpkeepDoneResult');
const EntryPatchSchema = z.object({ doneOn: DAY, memberId: z.string().nullable(), contactId: z.string().nullable(), costCents: CENTS.nullable(), reading: z.number().int().min(0).nullable(), readingUnit: z.enum(['mi', 'km', 'h']).nullable(), notes: z.string().max(10_000).nullable() }).partial().openapi('UpkeepEntryPatch');
export const UpkeepCalendarInputSchema = z
  .object({
    date: DAY.optional().openapi({ description: "Left out: the job's next due date." }), startTime: TIME.nullable().optional().openapi({ description: 'Left out or null: all day.' }), endTime: TIME.nullable().optional(),
    calendarId: z.string().optional().openapi({ description: 'Left out: the default calendar.' }),
  })
  .openapi('UpkeepCalendarInput');
export const UpkeepStarterSchema = z.object({ key: z.string(), title: z.string(), emoji: z.string(), areaId: z.string(), repeatKind: RepeatKindSchema, every: z.number().int().nullable(), unit: UnitSchema.nullable(), onMonths: z.array(z.number().int()), onDay: z.number().int().nullable(), supplies: z.array(z.string()) }).openapi('UpkeepStarter');
const AreaInputSchema = z.object({ name: z.string().trim().min(1).max(60), emoji: z.string().trim().max(16).nullable().optional(), sort: z.number().int().optional() });

const params = z.object({ id: z.string() });
const OFF = { error: 'Home upkeep is turned off in Settings → General → Features' };
const errors = {
  400: { description: 'invalid request', content: { 'application/json': { schema: ErrorSchema } } },
  403: { description: "parents only, or a kid's device acting on someone else's job", content: { 'application/json': { schema: ErrorSchema } } },
  404: { description: 'not found, or home upkeep is turned off (settings.features.upkeep)', content: { 'application/json': { schema: ErrorSchema } } },
};
const body = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const res = <T extends z.ZodType>(description: string, schema: T) => ({ description, content: { 'application/json': { schema } } });
const ok = res('done', z.object({ ok: z.boolean() }));
const MIMES = ['image/webp', 'image/jpeg', 'image/png', 'application/pdf'] as const;
const MAX_FILES = 20;
/** How long a Done from a wall or kid's device can be taken back (the toast's Undo). */
const UNDO_MS = 15 * 60_000;
const DISPLAY_DAYS_BACK = 7;

type Ctx = Context<{ Bindings: Env }>;
type Viewer = { parent: boolean; kid: string | null };
/** Who's asking: a parent (full access), a kid's own device (its kid), or a shared screen. */
async function viewer(c: Ctx): Promise<Viewer> {
  const key = await requestKey(c);
  if (key?.scope !== 'display') return { parent: true, kid: null };
  const owner = key.owner && key.owner !== 'shared' ? key.owner : null;
  if (!owner) return { parent: false, kid: null };
  const m = await c.env.DB.prepare('SELECT grown_up FROM members WHERE id = ?').bind(owner).first<{ grown_up: number }>();
  return { parent: false, kid: m && !m.grown_up ? owner : null };
}
const off = async (c: Ctx) => !(await readFeatures(c.env.DB)).upkeep;
async function clock(db: KinwallDb) {
  const tz = (await readSettings(db)).timezone || hostTimezone();
  return { tz, today: todayInTz(tz), dayOf: (iso: string) => todayInTz(tz, new Date(iso)) };
}
export async function jobsNow(db: KinwallDb, opts: { id?: string } = {}) {
  const { today, dayOf } = await clock(db);
  return readJobs(db, today, dayOf, opts);
}

/** What this device may see of each. */
export const shownThing = (t: UpkeepThing, who: Viewer): UpkeepThing =>
  who.parent ? t : { ...t, brand: null, model: null, serial: null, partNotes: null, boughtOn: null, priceCents: null, warrantyUntil: null, manualUrl: null, contactId: null, notes: null, files: [] };
export const shownJob = (j: UpkeepJob, who: Viewer): UpkeepJob => (who.parent ? j : { ...j, usualCostCents: null, contactId: null, supplies: [], suppliesListId: null });
export const shownEntry = (e: UpkeepEntry, who: Viewer): UpkeepEntry => (who.parent ? e : { ...e, contactId: null, costCents: null, reading: null, readingUnit: null, notes: null, files: [] });
const jobVisible = (j: UpkeepJob, who: Viewer) => who.parent || (who.kid ? j.memberId === who.kid : j.wallVisible);

async function exists(db: KinwallDb, table: string, id: string | null | undefined): Promise<boolean> {
  return !id || !!(await db.prepare(`SELECT id FROM ${table} WHERE id = ?`).bind(id).first());
}

/** What's wrong with a job as it would be saved, or null. */
async function invalidJob(db: KinwallDb, j: JobInput): Promise<string | null> {
  if (j.repeatKind === 'after' && (!j.every || !j.unit)) return stored('error', 'Say how often: every how many days, weeks, months or years.');
  if (j.repeatKind === 'on' && (!j.onMonths?.length || !j.onDay)) return stored('error', 'Pick the months and the day it comes round.');
  if (j.chorePoints != null) {
    if (!j.memberId) return stored('error', 'Pick who does it before giving it points.');
    const m = await db.prepare('SELECT grown_up FROM members WHERE id = ?').bind(j.memberId).first<{ grown_up: number }>();
    if (m?.grown_up) return stored('error', 'Only a kid gets upkeep jobs as chores.');
  }
  if (!(await exists(db, 'members', j.memberId))) return 'member not found';
  if (!(await exists(db, 'upkeep_things', j.thingId))) return 'thing not found';
  if (!(await exists(db, 'upkeep_areas', j.areaId))) return 'area not found';
  if (!(await exists(db, 'contacts', j.contactId))) return 'contact not found';
  if (j.suppliesListId && !(await db.prepare("SELECT id FROM lists WHERE id = ? AND kind = 'shopping' AND archived = 0").bind(j.suppliesListId).first())) return stored('error', 'Supplies go on a shopping list.');
  return null;
}
async function invalidThing(db: KinwallDb, t: ThingInput): Promise<string | null> {
  if (!(await exists(db, 'upkeep_areas', t.areaId))) return 'area not found';
  if (!(await exists(db, 'contacts', t.contactId))) return 'contact not found';
  return null;
}

const JOB_COLUMNS: [keyof JobInput, string, (v: never) => unknown][] = [
  ['title', 'title', (v) => v], ['emoji', 'emoji', (v: string | null) => v || null], ['thingId', 'thing_id', (v) => v], ['areaId', 'area_id', (v) => v], ['repeatKind', 'repeat_kind', (v) => v],
  ['every', 'every', (v) => v], ['unit', 'unit', (v) => v], ['onMonths', 'on_months', (v: number[]) => JSON.stringify([...new Set(v)].sort((a, b) => a - b))], ['onDay', 'on_day', (v) => v],
  ['startOn', 'start_on', (v) => v], ['dueOn', 'due_on', (v) => v], ['headsUpDays', 'heads_up_days', (v) => v], ['memberId', 'member_id', (v) => v], ['contactId', 'contact_id', (v) => v],
  ['usualCostCents', 'usual_cost_cents', (v) => v], ['steps', 'steps', (v: string[]) => JSON.stringify(v)], ['supplies', 'supplies', (v: { name: string }[]) => JSON.stringify(v.map((s) => ({ name: s.name })))],
  ['suppliesListId', 'supplies_list_id', (v) => v], ['suppliesDays', 'supplies_days', (v) => v], ['chorePoints', 'chore_points', (v) => v], ['wallVisible', 'wall_visible', (v: boolean) => (v ? 1 : 0)],
  ['archived', 'archived', (v: boolean) => (v ? 1 : 0)],
];
const THING_COLUMNS: [keyof ThingInput, string, (v: never) => unknown][] = [
  ['name', 'name', (v) => v], ['emoji', 'emoji', (v: string | null) => v || null], ['areaId', 'area_id', (v) => v], ['room', 'room', (v) => v || null], ['brand', 'brand', (v) => v || null],
  ['model', 'model', (v) => v || null], ['serial', 'serial', (v) => v || null], ['partNotes', 'part_notes', (v) => v || null], ['boughtOn', 'bought_on', (v) => v], ['priceCents', 'price_cents', (v) => v],
  ['warrantyUntil', 'warranty_until', (v) => v], ['manualUrl', 'manual_url', (v) => v || null], ['contactId', 'contact_id', (v) => v], ['notes', 'notes', (v: string | null) => v?.trim() || null],
  ['archived', 'archived', (v: boolean) => (v ? 1 : 0)],
];
const rowOf = <T extends object>(cols: [keyof T, string, (v: never) => unknown][], o: T) => cols.filter(([k]) => o[k] !== undefined).map(([k, col, f]) => [col, f(o[k] as never)] as const);

async function insertJob(db: KinwallDb, input: JobInput & { title: string }, extra: Record<string, unknown> = {}): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const cols = [...rowOf(JOB_COLUMNS, input), ...Object.entries(extra), ['id', id], ['created_at', now], ['updated_at', now]] as const;
  await db.prepare(`INSERT INTO upkeep_jobs (${cols.map(([k]) => k).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map(([, v]) => v)).run();
  return id;
}

// ---- Areas -------------------------------------------------------------------------------------

upkeepRoutes.openapi(
  createRoute({ method: 'get', path: '/api/upkeep/areas', tags: ['Upkeep'], summary: 'Upkeep areas (Heating & cooling, Safety, Cars & bikes…), in order', security: [{ Bearer: [] }], responses: { 200: res('areas', z.array(UpkeepAreaSchema)), 404: errors[404] } }),
  async (c) => (await off(c) ? c.json(OFF, 404) : c.json(await readAreas(c.env.DB), 200)),
);

upkeepRoutes.openapi(
  createRoute({ method: 'post', path: '/api/upkeep/areas', tags: ['Upkeep'], summary: 'Add an upkeep area (parents)', security: [{ Bearer: [] }], request: { body: body(AreaInputSchema) }, responses: { 201: res('area', UpkeepAreaSchema), ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { name, emoji, sort } = c.req.valid('json');
    const db = c.env.DB;
    const next = sort ?? ((await db.prepare('SELECT MAX(sort) AS m FROM upkeep_areas').first<{ m: number | null }>())?.m ?? -1) + 1;
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO upkeep_areas (id, name, emoji, sort, created_at) VALUES (?, ?, ?, ?, ?)').bind(id, name, emoji || null, next, new Date().toISOString()).run();
    emit(c, 'upkeep.changed', { id, kind: 'area' });
    return c.json({ id, name, emoji: emoji || null, sort: next }, 201);
  },
);

upkeepRoutes.openapi(
  createRoute({ method: 'patch', path: '/api/upkeep/areas/{id}', tags: ['Upkeep'], summary: 'Rename or reorder an upkeep area (parents)', security: [{ Bearer: [] }], request: { params, body: body(AreaInputSchema.partial()) }, responses: { 200: res('area', UpkeepAreaSchema), ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const { name, emoji, sort } = c.req.valid('json');
    const r = await c.env.DB.prepare('UPDATE upkeep_areas SET name = coalesce(?, name), emoji = CASE WHEN ? THEN ? ELSE emoji END, sort = coalesce(?, sort) WHERE id = ?').bind(name ?? null, emoji !== undefined ? 1 : 0, emoji || null, sort ?? null, id).run();
    if (!r.meta.changes) return c.json({ error: 'area not found' }, 404);
    emit(c, 'upkeep.changed', { id, kind: 'area' });
    return c.json((await readAreas(c.env.DB)).find((a) => a.id === id)!, 200);
  },
);

upkeepRoutes.openapi(
  createRoute({ method: 'delete', path: '/api/upkeep/areas/{id}', tags: ['Upkeep'], summary: 'Delete an upkeep area (parents); its things and jobs stay, with no area', security: [{ Bearer: [] }], request: { params }, responses: { 200: ok, ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const r = await c.env.DB.prepare('DELETE FROM upkeep_areas WHERE id = ?').bind(id).run(); // ON DELETE SET NULL clears things and jobs
    if (!r.meta.changes) return c.json({ error: 'area not found' }, 404);
    emit(c, 'upkeep.changed', { id, kind: 'area', deleted: true });
    return c.json({ ok: true }, 200);
  },
);

// ---- Things ------------------------------------------------------------------------------------

upkeepRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/upkeep/things', tags: ['Upkeep'], security: [{ Bearer: [] }],
    summary: 'The things the family looks after, by name. Sold or gone ones only with archived=true (all: both)',
    request: { query: z.object({ archived: z.enum(['true', 'false', 'all']).optional(), area: z.string().optional() }) },
    responses: { 200: res('things', z.array(UpkeepThingSchema)), 404: errors[404] },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const q = c.req.valid('query');
    const [all, who] = await Promise.all([readThings(c.env.DB), viewer(c)]);
    const shown = all.filter((t) => ((q.archived ?? 'false') === 'all' || t.archived === (q.archived === 'true')) && (!q.area || t.areaId === q.area));
    return c.json(shown.map((t) => shownThing(t, who)), 200);
  },
);

upkeepRoutes.openapi(
  createRoute({ method: 'get', path: '/api/upkeep/things/{id}', tags: ['Upkeep'], summary: 'One thing', security: [{ Bearer: [] }], request: { params }, responses: { 200: res('thing', UpkeepThingSchema), 404: errors[404] } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const [t] = await readThings(c.env.DB, { id: c.req.valid('param').id });
    return t ? c.json(shownThing(t, await viewer(c)), 200) : c.json({ error: 'thing not found' }, 404);
  },
);

upkeepRoutes.openapi(
  createRoute({ method: 'post', path: '/api/upkeep/things', tags: ['Upkeep'], summary: 'Add a thing to look after (parents)', security: [{ Bearer: [] }], request: { body: body(UpkeepThingInputSchema) }, responses: { 201: res('thing', UpkeepThingSchema), ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const input = c.req.valid('json');
    const db = c.env.DB;
    const bad = await invalidThing(db, input);
    if (bad) return c.json({ error: bad }, 400);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const cols = [...rowOf(THING_COLUMNS, input), ['id', id], ['created_at', now], ['updated_at', now]] as const;
    await db.prepare(`INSERT INTO upkeep_things (${cols.map(([k]) => k).join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).bind(...cols.map(([, v]) => v)).run();
    emit(c, 'upkeep.changed', { id, kind: 'thing' });
    return c.json((await readThings(db, { id }))[0], 201);
  },
);

upkeepRoutes.openapi(
  createRoute({ method: 'patch', path: '/api/upkeep/things/{id}', tags: ['Upkeep'], summary: 'Change a thing (parents). archived: true is "Sold or gone"', security: [{ Bearer: [] }], request: { params, body: body(UpkeepThingPatchSchema) }, responses: { 200: res('thing', UpkeepThingSchema), ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = c.env.DB;
    if (!(await exists(db, 'upkeep_things', id))) return c.json({ error: 'thing not found' }, 404);
    const bad = await invalidThing(db, input);
    if (bad) return c.json({ error: bad }, 400);
    const cols = rowOf(THING_COLUMNS, input);
    const now = new Date().toISOString();
    await db.batch([
      ...(cols.length ? [db.prepare(`UPDATE upkeep_things SET ${cols.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(...cols.map(([, v]) => v), now, id)] : []),
      // Gone: its jobs go quiet too (archived), and come back if it does.
      ...(input.archived !== undefined ? [db.prepare('UPDATE upkeep_jobs SET archived = ?, updated_at = ? WHERE thing_id = ?').bind(input.archived ? 1 : 0, now, id)] : []),
    ]);
    emit(c, 'upkeep.changed', { id, kind: 'thing' });
    return c.json((await readThings(db, { id }))[0], 200);
  },
);

upkeepRoutes.openapi(
  createRoute({ method: 'delete', path: '/api/upkeep/things/{id}', tags: ['Upkeep'], summary: 'Delete a thing and its files (parents). Its jobs and history stay, with no thing', security: [{ Bearer: [] }], request: { params }, responses: { 200: ok, ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const r = await c.env.DB.prepare('DELETE FROM upkeep_things WHERE id = ?').bind(id).run();
    if (!r.meta.changes) return c.json({ error: 'thing not found' }, 404);
    emit(c, 'upkeep.changed', { id, kind: 'thing', deleted: true });
    return c.json({ ok: true }, 200);
  },
);

// ---- Jobs --------------------------------------------------------------------------------------

upkeepRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/upkeep/jobs', tags: ['Upkeep'], security: [{ Bearer: [] }],
    summary: "Upkeep jobs, soonest due first, with where each stands today. A kid's own device gets its kid's; a wall screen the ones shown on the wall",
    request: {
      query: z.object({
        status: z.string().optional().openapi({ description: 'Comma-separated: overdue, due, soon, later, done. Left out: all.' }),
        thing: z.string().optional(), member: z.string().optional(), area: z.string().optional(),
        archived: z.enum(['true', 'false', 'all']).optional().openapi({ description: 'Default false.' }),
      }),
    },
    responses: { 200: res('jobs', z.array(UpkeepJobSchema)), 404: errors[404] },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const q = c.req.valid('query');
    const [all, who] = await Promise.all([jobsNow(c.env.DB), viewer(c)]);
    const statuses = (q.status ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const shown = all.filter((j) => jobVisible(j, who) && ((q.archived ?? 'false') === 'all' || j.archived === (q.archived === 'true'))
      && (!statuses.length || statuses.includes(j.status)) && (!q.thing || j.thingId === q.thing) && (!q.member || j.memberId === q.member) && (!q.area || j.areaId === q.area));
    return c.json(shown.map((j) => shownJob(j, who)), 200);
  },
);

async function visibleJob(c: Ctx, id: string, who: Viewer): Promise<UpkeepJob | null> {
  const [j] = await jobsNow(c.env.DB, { id });
  return j && jobVisible(j, who) ? j : null;
}

upkeepRoutes.openapi(
  createRoute({ method: 'get', path: '/api/upkeep/jobs/{id}', tags: ['Upkeep'], summary: 'One upkeep job', security: [{ Bearer: [] }], request: { params }, responses: { 200: res('job', UpkeepJobSchema), 404: errors[404] } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const who = await viewer(c);
    const j = await visibleJob(c, c.req.valid('param').id, who);
    return j ? c.json(shownJob(j, who), 200) : c.json({ error: 'job not found' }, 404);
  },
);

upkeepRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/upkeep/jobs', tags: ['Upkeep'], security: [{ Bearer: [] }],
    summary: "Add an upkeep job (parents). repeatKind 'after' (the default) needs every and unit; 'on' needs onMonths and onDay; 'once' takes dueOn",
    request: { body: body(UpkeepJobInputSchema) }, responses: { 201: res('job', UpkeepJobSchema), ...errors },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const input = { repeatKind: 'after' as const, ...c.req.valid('json') };
    const db = c.env.DB;
    const bad = await invalidJob(db, input);
    if (bad) return c.json({ error: bad }, 400);
    const id = await insertJob(db, input);
    emit(c, 'upkeep.changed', { id, kind: 'job' });
    return c.json((await jobsNow(db, { id }))[0], 201);
  },
);

upkeepRoutes.openapi(
  createRoute({ method: 'patch', path: '/api/upkeep/jobs/{id}', tags: ['Upkeep'], summary: 'Change an upkeep job (parents). archived: true puts it away; its history stays', security: [{ Bearer: [] }], request: { params, body: body(UpkeepJobPatchSchema) }, responses: { 200: res('job', UpkeepJobSchema), ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = c.env.DB;
    const [old] = await jobsNow(db, { id });
    if (!old) return c.json({ error: 'job not found' }, 404);
    const bad = await invalidJob(db, { ...old, ...input });
    if (bad) return c.json({ error: bad }, 400);
    const cols = rowOf(JOB_COLUMNS, input);
    if (cols.length) await db.prepare(`UPDATE upkeep_jobs SET ${cols.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(...cols.map(([, v]) => v), new Date().toISOString(), id).run();
    emit(c, 'upkeep.changed', { id, kind: 'job' });
    return c.json((await jobsNow(db, { id }))[0], 200);
  },
);

upkeepRoutes.openapi(
  createRoute({ method: 'delete', path: '/api/upkeep/jobs/{id}', tags: ['Upkeep'], summary: 'Delete an upkeep job (parents). Its history stays', security: [{ Bearer: [] }], request: { params }, responses: { 200: ok, ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const r = await c.env.DB.prepare('DELETE FROM upkeep_jobs WHERE id = ?').bind(id).run();
    if (!r.meta.changes) return c.json({ error: 'job not found' }, 404);
    emit(c, 'upkeep.changed', { id, kind: 'job', deleted: true });
    return c.json({ ok: true }, 200);
  },
);

upkeepRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/upkeep/jobs/{id}/done', tags: ['Upkeep'], security: [{ Bearer: [] }],
    summary: "Mark a job done. A kid's own device marks its kid's jobs, a wall screen the ones on the wall (both for the last 7 days); only a parent's device adds a cost, reading, notes or a pro",
    request: { params, body: body(UpkeepDoneInputSchema) }, responses: { 200: res('done', UpkeepDoneResultSchema), ...errors },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = c.env.DB;
    const who = await viewer(c);
    const job = await visibleJob(c, id, who);
    if (!job) return c.json({ error: 'job not found' }, 404);
    const { today } = await clock(db);
    const doneOn = input.doneOn ?? today;
    if (doneOn > today) return c.json({ error: "That day hasn't come yet." }, 400);
    if (!who.parent && doneOn < addDays(today, -DISPLAY_DAYS_BACK)) return c.json({ error: `From this device a job can be marked done for the last ${DISPLAY_DAYS_BACK} days. Older days are for a parent's device.` }, 400);
    const memberId = who.kid ?? input.memberId ?? (who.parent ? (await actorOf(c)).memberId : null);
    const blocked = await ownerBlock(c, memberId);
    if (blocked) return c.json({ error: blocked }, 403);
    if (!(await exists(db, 'members', memberId))) return c.json({ error: 'member not found' }, 400);
    if (who.parent && !(await exists(db, 'contacts', input.contactId))) return c.json({ error: 'contact not found' }, 400);
    const entryId = (await logDone(db, id, {
      doneOn, memberId, createdBy: who.kid ?? (await actorOf(c)).memberId,
      ...(who.parent ? { contactId: input.contactId, costCents: input.costCents, reading: input.reading, readingUnit: input.readingUnit, notes: input.notes } : {}),
    }))!;
    emit(c, 'upkeep.done', { id: entryId, jobId: id, thingId: job.thingId, title: job.title, doneOn, memberId });
    const [entry] = await readLog(db, { id: entryId });
    const [saved] = await jobsNow(db, { id });
    return c.json({ entry: shownEntry(entry, who), job: shownJob(saved, who) }, 200);
  },
);

upkeepRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/upkeep/jobs/{id}/snooze', tags: ['Upkeep'], security: [{ Bearer: [] }],
    summary: '"Not this week" (parents): shows the job as due on `until` instead. Done clears it; null clears it now',
    request: { params, body: body(z.object({ until: DAY.nullable() })) }, responses: { 200: res('job', UpkeepJobSchema), ...errors },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const { until } = c.req.valid('json');
    const r = await c.env.DB.prepare('UPDATE upkeep_jobs SET snoozed_until = ?, updated_at = ? WHERE id = ?').bind(until, new Date().toISOString(), id).run();
    if (!r.meta.changes) return c.json({ error: 'job not found' }, 404);
    emit(c, 'upkeep.changed', { id, kind: 'job' });
    return c.json((await jobsNow(c.env.DB, { id }))[0], 200);
  },
);

upkeepRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/upkeep/jobs/{id}/skip', tags: ['Upkeep'], security: [{ Bearer: [] }],
    summary: '"Skip this time" (parents): nothing is logged, and the next due date counts on from the one skipped',
    request: { params }, responses: { 200: res('job', UpkeepJobSchema), ...errors },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const db = c.env.DB;
    const [job] = await jobsNow(db, { id });
    if (!job) return c.json({ error: 'job not found' }, 404);
    const { dayOf } = await clock(db);
    const due = scheduledDue(factsOf(job, dayOf(job.createdAt)), job.lastDone?.doneOn ?? null);
    if (!due || job.repeatKind === 'once') return c.json({ error: "A one-off job can't be skipped. Archive it instead." }, 400);
    await db.prepare('UPDATE upkeep_jobs SET skipped_until = ?, snoozed_until = NULL, updated_at = ? WHERE id = ?').bind(due, new Date().toISOString(), id).run();
    emit(c, 'upkeep.changed', { id, kind: 'job' });
    return c.json((await jobsNow(db, { id }))[0], 200);
  },
);

upkeepRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/upkeep/jobs/{id}/calendar', tags: ['Upkeep'], security: [{ Bearer: [] }],
    summary: "Add to the calendar (parents), for a pro's visit: a normal event with the job's title, its thing and steps, linked back to the job",
    request: { params, body: body(UpkeepCalendarInputSchema) },
    responses: { 200: res('job', UpkeepJobSchema), 409: res('already on the calendar', ErrorSchema), 502: res('a synced calendar refused it', ErrorSchema), ...errors },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const db = c.env.DB;
    const [job] = await jobsNow(db, { id });
    if (!job) return c.json({ error: 'job not found' }, 404);
    if (job.calendarEventId) return c.json({ error: 'This job is already on the calendar.' }, 409);
    const date = input.date ?? job.nextDue;
    if (!date) return c.json({ error: 'Pick a day first.' }, 400);
    const settings = await readSettings(db);
    const tz = settings.timezone || hostTimezone();
    let start: string, end: string;
    if (!input.startTime) { start = date; end = addDays(date, 1); } else {
      const at = (t: string) => { const [y, mo, d] = date.split('-').map(Number); const [h, mi] = t.split(':').map(Number); return zonedTimeToUtc({ y, mo: mo - 1, d, h, mi, s: 0 }, tz).getTime(); };
      const from = at(input.startTime);
      const to = input.endTime && input.endTime > input.startTime ? at(input.endTime) : from + (settings.defaultEventMinutes || 60) * 60000;
      start = new Date(from).toISOString(); end = new Date(to).toISOString();
    }
    const thing = job.thingId ? (await readThings(db, { id: job.thingId }))[0] : null;
    const description = [thing && [thing.name, thing.brand, thing.model].filter(Boolean).join(' · '), job.steps.map((s) => `• ${s}`).join('\n'), (await wordsFor(c)).t('From Kinwall Upkeep')].filter(Boolean).join('\n\n');
    const created = await createEvent(c, {
      ...(input.calendarId ? { calendarId: input.calendarId } : {}), title: `${job.emoji ? `${job.emoji} ` : ''}${job.title}`, start, end, allDay: !input.startTime,
      memberIds: job.memberId ? [job.memberId] : [], description, ...(thing?.room ? { location: thing.room } : {}),
    });
    if ('error' in created) return c.json({ error: created.error }, created.status);
    await db.prepare('UPDATE upkeep_jobs SET calendar_event_id = ?, updated_at = ? WHERE id = ?').bind(created.row.id, new Date().toISOString(), id).run();
    emit(c, 'upkeep.changed', { id, kind: 'job' });
    return c.json((await jobsNow(db, { id }))[0], 200);
  },
);

// ---- History -----------------------------------------------------------------------------------

upkeepRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/upkeep/log', tags: ['Upkeep'], security: [{ Bearer: [] }],
    summary: "Every Done, newest first. A kid's own device gets its kid's, without costs, readings or notes; a wall screen gets none (403)",
    request: { query: z.object({ job: z.string().optional(), thing: z.string().optional(), member: z.string().optional(), year: z.string().regex(/^\d{4}$/).optional(), q: z.string().max(200).optional().openapi({ description: 'Searches titles and notes.' }), limit: z.coerce.number().int().min(1).max(5000).optional() }) },
    responses: { 200: res('history', z.array(UpkeepEntrySchema)), ...errors },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const q = c.req.valid('query');
    const who = await viewer(c);
    if (!who.parent && !who.kid) return c.json({ error: "Upkeep history is on a parent's device." }, 403);
    const entries = await readLog(c.env.DB, { jobId: q.job, thingId: q.thing, memberId: who.kid ?? q.member, year: q.year, q: who.parent ? q.q : undefined, limit: q.limit ?? 1000 });
    return c.json(entries.map((e) => shownEntry(e, who)), 200);
  },
);

upkeepRoutes.openapi(
  createRoute({ method: 'patch', path: '/api/upkeep/log/{id}', tags: ['Upkeep'], summary: 'Fix a Done: its day, who, cost, reading or notes (parents)', security: [{ Bearer: [] }], request: { params, body: body(EntryPatchSchema) }, responses: { 200: res('entry', UpkeepEntrySchema), ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const p = c.req.valid('json');
    const db = c.env.DB;
    const [old] = await readLog(db, { id });
    if (!old) return c.json({ error: 'entry not found' }, 404);
    if (!(await exists(db, 'members', p.memberId)) || !(await exists(db, 'contacts', p.contactId))) return c.json({ error: 'member or contact not found' }, 400);
    const map: [keyof typeof p, string][] = [['doneOn', 'done_on'], ['memberId', 'member_id'], ['contactId', 'contact_id'], ['costCents', 'cost_cents'], ['reading', 'reading'], ['readingUnit', 'reading_unit'], ['notes', 'notes']];
    const cols = map.filter(([k]) => p[k] !== undefined).map(([k, col]) => [col, k === 'notes' ? (p.notes?.trim() || null) : p[k]] as const);
    if (cols.length) await db.prepare(`UPDATE upkeep_log SET ${cols.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`).bind(...cols.map(([, v]) => v), id).run();
    emit(c, 'upkeep.changed', { id, kind: 'log' });
    return c.json((await readLog(db, { id }))[0], 200);
  },
);

upkeepRoutes.openapi(
  createRoute({
    method: 'delete', path: '/api/upkeep/log/{id}', tags: ['Upkeep'], security: [{ Bearer: [] }],
    summary: "Remove a Done and its files (parents; a wall screen or kid's device only one it just made, as Undo). The job's next due date goes back",
    request: { params }, responses: { 200: ok, ...errors },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const db = c.env.DB;
    const who = await viewer(c);
    const [e] = await readLog(db, { id });
    if (!e) return c.json({ error: 'entry not found' }, 404);
    if (!who.parent && (Date.now() - Date.parse(e.createdAt) > UNDO_MS || (who.kid && e.memberId !== who.kid))) return c.json({ error: "Ask a grown-up to remove this from the history." }, 403);
    await db.prepare('DELETE FROM upkeep_log WHERE id = ?').bind(id).run();
    emit(c, 'upkeep.changed', { id, kind: 'log', deleted: true });
    return c.json({ ok: true }, 200);
  },
);

// ---- Files -------------------------------------------------------------------------------------

upkeepRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/upkeep/files', tags: ['Upkeep'], security: [{ Bearer: [] }],
    summary: `Add a receipt, manual or photo (parents) to a thing or a Done: the file as the body (image/webp, image/jpeg, image/png or application/pdf, at most 2 MB), its name in X-File-Name (URI-encoded). Up to ${MAX_FILES} each`,
    request: {
      query: z.object({ thing: z.string().optional(), entry: z.string().optional() }),
      body: { required: true, content: Object.fromEntries(MIMES.map((m) => [m, { schema: z.string().openapi({ format: 'binary' }) }])) },
    },
    responses: { 201: res('file', FileSchema), 413: res('file too large', ErrorSchema), ...errors },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const q = c.req.valid('query');
    const db = c.env.DB;
    if (!!q.thing === !!q.entry) return c.json({ error: 'Pick a thing or a Done to add it to.' }, 400);
    if (q.thing ? !(await exists(db, 'upkeep_things', q.thing)) : !(await exists(db, 'upkeep_log', q.entry))) return c.json({ error: q.thing ? 'thing not found' : 'entry not found' }, 404);
    const mime = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (!(MIMES as readonly string[]).includes(mime)) return c.json({ error: 'Add a photo (WebP, JPEG or PNG) or a PDF.' }, 400);
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.byteLength > MAX_UPKEEP_FILE_BYTES) return c.json({ error: 'That file is bigger than 2 MB.' }, 413);
    if (!data.byteLength) return c.json({ error: 'body: empty file' }, 400);
    let name = 'File';
    try { name = decodeURIComponent(c.req.header('X-File-Name') ?? '').trim().slice(0, 200) || name; } catch { /* a bad escape: keep the default */ }
    const col = q.thing ? 'thing_id' : 'log_id';
    const count = (await db.prepare(`SELECT count(*) AS n FROM upkeep_files WHERE ${col} = ?`).bind(q.thing ?? q.entry).first<{ n: number }>())?.n ?? 0;
    if (count >= MAX_FILES) return c.json({ error: `There's room for ${MAX_FILES} files here.` }, 400);
    const id = crypto.randomUUID();
    await db.prepare(`INSERT INTO upkeep_files (id, ${col}, name, mime, bytes, data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`).bind(id, q.thing ?? q.entry, name, mime, data.byteLength, data, new Date().toISOString()).run();
    emit(c, 'upkeep.changed', { id: q.thing ?? q.entry, kind: q.thing ? 'thing' : 'log' });
    return c.json({ id, name, mime, bytes: data.byteLength }, 201);
  },
);

upkeepRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/upkeep/files/{id}', tags: ['Upkeep'], security: [{ Bearer: [] }],
    summary: "One file (parents). Takes a parent's media token as ?key=, like the image routes",
    request: { params }, responses: { 200: { description: 'the file', content: Object.fromEntries(MIMES.map((m) => [m, { schema: z.string().openapi({ format: 'binary' }) }])) }, 404: errors[404], 403: errors[403] },
  }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    if (!(await viewer(c)).parent) return c.json({ error: "Upkeep files are on a parent's device." }, 403);
    const row = await c.env.DB.prepare('SELECT name, mime, data FROM upkeep_files WHERE id = ?').bind(c.req.valid('param').id).first<{ name: string; mime: string; data: unknown }>();
    if (!row) return c.json({ error: 'file not found' }, 404);
    const safe = row.name.replace(/[^\w .()-]/g, '_');
    c.header('Cache-Control', 'private, max-age=31536000, immutable');
    c.header('Content-Disposition', `inline; filename="${safe}"`);
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(blobBytes(row.data), 200, { 'Content-Type': row.mime }) as never;
  },
);

upkeepRoutes.openapi(
  createRoute({ method: 'delete', path: '/api/upkeep/files/{id}', tags: ['Upkeep'], summary: 'Delete a file (parents)', security: [{ Bearer: [] }], request: { params }, responses: { 200: ok, ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { id } = c.req.valid('param');
    const row = await c.env.DB.prepare('DELETE FROM upkeep_files WHERE id = ? RETURNING thing_id, log_id').bind(id).first<{ thing_id: string | null; log_id: string | null }>();
    if (!row) return c.json({ error: 'file not found' }, 404);
    emit(c, 'upkeep.changed', { id: row.thing_id ?? row.log_id, kind: row.thing_id ? 'thing' : 'log' });
    return c.json({ ok: true }, 200);
  },
);

// ---- Starters ----------------------------------------------------------------------------------

upkeepRoutes.openapi(
  createRoute({ method: 'get', path: '/api/upkeep/starters', tags: ['Upkeep'], summary: "Common upkeep jobs the family hasn't added yet, each with a usual schedule (parents)", security: [{ Bearer: [] }], responses: { 200: res('starters', z.array(UpkeepStarterSchema)), ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const used = new Set((await c.env.DB.prepare('SELECT library_key FROM upkeep_jobs WHERE library_key IS NOT NULL').all<{ library_key: string }>()).results.map((r) => r.library_key));
    const lang = await requestLang(c);
    return c.json(UPKEEP_STARTERS.filter((s) => !used.has(s.key)).map((s) => ({
      key: s.key, title: tm(lang, s.title), emoji: s.emoji, areaId: s.areaId, repeatKind: s.repeatKind, every: s.every ?? null, unit: s.unit ?? null, onMonths: s.onMonths ?? [], onDay: s.onDay ?? null,
      supplies: (s.supplies ?? []).map((n) => tm(lang, n)),
    })), 200);
  },
);

upkeepRoutes.openapi(
  createRoute({ method: 'post', path: '/api/upkeep/starters', tags: ['Upkeep'], summary: 'Add starter jobs by key (parents); ones already added are skipped', security: [{ Bearer: [] }], request: { body: body(z.object({ keys: z.array(z.string()).min(1).max(50) })) }, responses: { 201: res('the jobs added', z.array(UpkeepJobSchema)), ...errors } }),
  async (c) => {
    if (await off(c)) return c.json(OFF, 404);
    const { keys } = c.req.valid('json');
    const db = c.env.DB;
    const used = new Set((await db.prepare('SELECT library_key FROM upkeep_jobs WHERE library_key IS NOT NULL').all<{ library_key: string }>()).results.map((r) => r.library_key));
    const lang = await requestLang(c);
    const ids: string[] = [];
    for (const s of UPKEEP_STARTERS.filter((x) => keys.includes(x.key) && !used.has(x.key))) {
      ids.push(await insertJob(db, {
        title: tm(lang, s.title), emoji: s.emoji, areaId: s.areaId, repeatKind: s.repeatKind, every: s.every ?? null, unit: s.unit ?? null, onMonths: s.onMonths ?? [], onDay: s.onDay ?? null,
        headsUpDays: s.headsUpDays ?? 7, supplies: (s.supplies ?? []).map((n) => ({ name: tm(lang, n) })),
      }, { library_key: s.key }));
    }
    if (ids.length) emit(c, 'upkeep.changed', { ids, kind: 'job' });
    const all = await jobsNow(db);
    return c.json(all.filter((j) => ids.includes(j.id)), 201);
  },
);

