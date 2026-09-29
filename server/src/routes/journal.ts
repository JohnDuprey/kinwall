// A person's journal (#/journal/<id>): their days, newest first, with that day's Temp check (sleep,
// feelings, goal and the evening goal check) and their own free-form entries (a line of text and an
// optional mood emoji), the start of bullet journaling.
//
// Private like health data (AGENTS.md "Health data"): an entry's text and mood are sealed with the
// family's key (crypto.ts seal; aad '<id>:text' / '<id>:mood'); writes fail closed without it.
// Bodies are never logged, and the journal.changed webhook says who, which day and which entry only.
//
// Who may open it (see `block`): the person's own device (a display key they own) and parents'
// devices (admin keys, passkey sessions, Kinwall's own app). Never a shared wall screen or another
// member's device. Connected apps (MCP, AI connectors) only once the family turns on aiHealthAccess.
// A grown-up's journal is on parents' devices too: the UI says so.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { hostTimezone } from '../env.ts';
import { emit } from '../bus.ts';
import { deviceOwner, requestKey } from '../auth.ts';
import { seal, unseal, type EncryptionEnv } from '../crypto.ts';
import { ErrorSchema } from '../schemas.ts';
import { healthBlock } from './trackers.ts';
import { todayInTz } from './members.ts';
import { readSettings } from './settings.ts';
import { openTempCheck, type TempCheckRow } from './temp-check.ts';

export const journalRoutes = createRouter();
type C = Context<{ Bindings: Env }>;

export const JOURNAL_TEXT_MAX = 2000;
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date: YYYY-MM-DD');
const MoodSchema = z.string().trim().max(16).nullable().optional().transform((v) => v || null);

const EntrySchema = z
  .object({ id: z.string(), memberId: z.string(), date: z.string(), text: z.string(), mood: z.string().nullable(), createdAt: z.string(), updatedAt: z.string() })
  .openapi('JournalEntry');
const EntryInputSchema = z
  .object({
    date: DateSchema.optional().openapi({ description: 'Household day; today by default.' }),
    text: z.string().trim().min(1).max(JOURNAL_TEXT_MAX),
    mood: MoodSchema.openapi({ description: 'An emoji, or null.' }),
  })
  .openapi('JournalEntryInput');
const EntryPatchSchema = z
  .object({ date: DateSchema.optional(), text: z.string().trim().min(1).max(JOURNAL_TEXT_MAX).optional(), mood: z.string().trim().max(16).nullable().optional() })
  .openapi('JournalEntryPatch');
const DaySchema = z.object({
  date: z.string(),
  tempCheck: z
    .object({
      sleep: z.string().nullable(), feelings: z.array(z.string()).nullable(), goal: z.string().nullable(), goalSkipped: z.boolean(),
      followup: z.object({ outcome: z.string(), helped: z.string().nullable(), hindered: z.string().nullable(), next: z.string().nullable() }).nullable(),
    })
    .nullable(),
  entries: z.array(EntrySchema),
});
const JournalSchema = z.object({ memberId: z.string(), from: z.string(), to: z.string(), days: z.array(DaySchema) }).openapi('Journal');

export type JournalRow = { id: string; member_id: string; date: string; text: string; mood: string | null; created_at: string; updated_at: string };
const aad = (id: string, col: 'text' | 'mood') => `${id}:${col}`;

/** The row as stored: text and mood sealed. Throws without a key, before anything is written. */
export async function sealEntry(env: EncryptionEnv, r: JournalRow): Promise<JournalRow> {
  return { ...r, text: await seal(env, r.text, aad(r.id, 'text')), mood: r.mood === null ? null : await seal(env, r.mood, aad(r.id, 'mood')) };
}
/** A stored row, opened, as the API returns it (a sealed value that won't open throws: never read as empty). */
export async function openEntry(env: EncryptionEnv, r: JournalRow) {
  return {
    id: r.id, memberId: r.member_id, date: r.date, text: await unseal(env, r.text, aad(r.id, 'text')),
    mood: r.mood === null ? null : await unseal(env, r.mood, aad(r.id, 'mood')), createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const PRIVATE = { error: "This journal is private: it opens on their own device and parents' devices." };
const APPS = { error: "Journals are private to the family's own devices. A parent can allow connected apps to see them in Settings → Connected apps." };

/** Why this caller may not open `memberId`'s journal, or null when it may (see the top of the file). */
async function block(c: C, memberId: string): Promise<{ error: string } | null> {
  if ((await requestKey(c))?.scope === 'display') return (await deviceOwner(c)) === memberId ? null : PRIVATE;
  return (await healthBlock(c)) ? APPS : null;
}

const householdToday = async (c: C) => todayInTz((await readSettings(c.env.DB)).timezone ?? hostTimezone());
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const memberExists = async (c: C, id: string) => !!(await c.env.DB.prepare('SELECT 1 FROM members WHERE id = ?').bind(id).first());
const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });
const params = z.object({ id: z.string() });
const entryParams = z.object({ id: z.string(), entryId: z.string() });
const denied = { 403: { description: "a shared wall, another member's device, or a connected app without aiHealthAccess", content: json(ErrorSchema) } };

journalRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/members/{id}/journal',
    tags: ['Journal'],
    summary: "A person's journal: days with their Temp check (and evening goal check) or their own entries, newest first. Their own device and parents' devices only.",
    security: [{ Bearer: [] }],
    request: {
      params,
      query: z.object({
        to: DateSchema.optional().openapi({ description: 'Last day (household); today by default.' }),
        days: z.coerce.number().int().min(1).max(366).default(60).openapi({ description: 'How many days back from `to` (default 60).' }),
      }),
    },
    responses: { 200: { description: 'ok', content: json(JournalSchema) }, ...denied, 404: { description: 'member not found', content: json(ErrorSchema) } },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const blocked = await block(c, id);
    if (blocked) return c.json(blocked, 403);
    if (!(await memberExists(c, id))) return c.json({ error: 'member not found' }, 404);
    const q = c.req.valid('query');
    const to = q.to ?? (await householdToday(c));
    const from = addDays(to, 1 - q.days);
    const [checks, entries] = await c.env.DB.batch<unknown>([
      c.env.DB.prepare('SELECT * FROM temp_checks WHERE member_id = ? AND date BETWEEN ? AND ?').bind(id, from, to),
      c.env.DB.prepare('SELECT * FROM journal_entries WHERE member_id = ? AND date BETWEEN ? AND ? ORDER BY created_at DESC, id').bind(id, from, to),
    ]);
    const days = new Map<string, z.infer<typeof DaySchema>>();
    const day = (date: string) => days.get(date) ?? days.set(date, { date, tempCheck: null, entries: [] }).get(date)!;
    for (const r of checks.results as TempCheckRow[]) {
      if (!r.sleep && !r.feelings && !r.goal && !r.goal_skipped && !r.followup) continue;
      day(r.date).tempCheck = await openTempCheck(c.env, r);
    }
    for (const r of entries.results as JournalRow[]) day(r.date).entries.push(await openEntry(c.env, r));
    return c.json({ memberId: id, from, to, days: [...days.values()].sort((a, b) => b.date.localeCompare(a.date)) }, 200);
  },
);

journalRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/members/{id}/journal',
    tags: ['Journal'],
    summary: 'Add a journal entry (text up to 2000 characters, an optional mood emoji). Their own device and parents\' devices only.',
    security: [{ Bearer: [] }],
    request: { params, body: { content: json(EntryInputSchema) } },
    responses: { 201: { description: 'added', content: json(EntrySchema) }, 400: { description: 'bad input', content: json(ErrorSchema) }, ...denied, 404: { description: 'member not found', content: json(ErrorSchema) } },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const blocked = await block(c, id);
    if (blocked) return c.json(blocked, 403);
    if (!(await memberExists(c, id))) return c.json({ error: 'member not found' }, 404);
    const body = c.req.valid('json');
    const now = new Date().toISOString();
    const row: JournalRow = { id: crypto.randomUUID(), member_id: id, date: body.date ?? (await householdToday(c)), text: body.text, mood: body.mood, created_at: now, updated_at: now };
    const s = await sealEntry(c.env, row);
    await c.env.DB.prepare('INSERT INTO journal_entries (id, member_id, date, text, mood, created_at, updated_at) VALUES (?,?,?,?,?,?,?)')
      .bind(s.id, s.member_id, s.date, s.text, s.mood, s.created_at, s.updated_at).run();
    emit(c, 'journal.changed', { memberId: id, date: row.date, id: row.id }); // never the words
    return c.json(await openEntry(c.env, s), 201);
  },
);

async function findEntry(c: C, memberId: string, entryId: string) {
  return c.env.DB.prepare('SELECT * FROM journal_entries WHERE id = ? AND member_id = ?').bind(entryId, memberId).first<JournalRow>();
}

journalRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/members/{id}/journal/{entryId}',
    tags: ['Journal'],
    summary: 'Change a journal entry (only the fields sent). Their own device and parents\' devices only.',
    security: [{ Bearer: [] }],
    request: { params: entryParams, body: { content: json(EntryPatchSchema) } },
    responses: { 200: { description: 'saved', content: json(EntrySchema) }, 400: { description: 'bad input', content: json(ErrorSchema) }, ...denied, 404: { description: 'entry not found', content: json(ErrorSchema) } },
  }),
  async (c) => {
    const { id, entryId } = c.req.valid('param');
    const blocked = await block(c, id);
    if (blocked) return c.json(blocked, 403);
    const found = await findEntry(c, id, entryId);
    if (!found) return c.json({ error: 'entry not found' }, 404);
    const body = c.req.valid('json');
    const old = await openEntry(c.env, found);
    const s = await sealEntry(c.env, {
      ...found, date: body.date ?? found.date, text: body.text ?? old.text, mood: body.mood === undefined ? old.mood : body.mood || null, updated_at: new Date().toISOString(),
    });
    await c.env.DB.prepare('UPDATE journal_entries SET date = ?, text = ?, mood = ?, updated_at = ? WHERE id = ?').bind(s.date, s.text, s.mood, s.updated_at, s.id).run();
    emit(c, 'journal.changed', { memberId: id, date: s.date, id: s.id });
    return c.json(await openEntry(c.env, s), 200);
  },
);

journalRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/members/{id}/journal/{entryId}',
    tags: ['Journal'],
    summary: 'Delete a journal entry. Their own device and parents\' devices only.',
    security: [{ Bearer: [] }],
    request: { params: entryParams },
    responses: { 204: { description: 'deleted' }, ...denied, 404: { description: 'entry not found', content: json(ErrorSchema) } },
  }),
  async (c) => {
    const { id, entryId } = c.req.valid('param');
    const blocked = await block(c, id);
    if (blocked) return c.json(blocked, 403);
    const found = await findEntry(c, id, entryId);
    if (!found) return c.json({ error: 'entry not found' }, 404);
    await c.env.DB.prepare('DELETE FROM journal_entries WHERE id = ?').bind(entryId).run();
    emit(c, 'journal.changed', { memberId: id, date: found.date, id: entryId });
    return c.body(null, 204);
  },
);
