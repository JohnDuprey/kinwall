// Home upkeep, the parts the routes, the morning tick (notify.ts runUpkeep) and chores share: reading
// things, jobs and the log in the shape the API returns, a job's next due date, and what ticking a
// kid's upkeep chore does. Dates are the rules in upkeep-rules.ts; who may see which fields is
// decided by the caller (routes/upkeep.ts `shown`).
import type { KinwallDb, KinwallStatement } from './db.ts';
import { fillPlace, itemKey, recall, rememberName } from './item-memory.ts';
import { nextDue, statusOf, type JobFacts, type RepeatKind, type Unit, type UpkeepStatus } from './upkeep-rules.ts';

/** A receipt, manual or photo: at most 2 MB (the API's request limit). */
export const MAX_UPKEEP_FILE_BYTES = 2 * 1024 * 1024;

export type UpkeepArea = { id: string; name: string; emoji: string | null; sort: number };
export type UpkeepFile = { id: string; name: string; mime: string; bytes: number };
export type UpkeepThing = {
  id: string; name: string; emoji: string | null; areaId: string | null; room: string | null; brand: string | null; model: string | null; serial: string | null;
  partNotes: string | null; boughtOn: string | null; priceCents: number | null; warrantyUntil: string | null; manualUrl: string | null; contactId: string | null;
  notes: string | null; archived: boolean; createdAt: string; updatedAt: string; files: UpkeepFile[];
};
export type UpkeepSupply = { name: string };
export type UpkeepJob = {
  id: string; title: string; emoji: string | null; thingId: string | null; areaId: string | null; repeatKind: RepeatKind; every: number | null; unit: Unit | null;
  onMonths: number[]; onDay: number | null; startOn: string | null; dueOn: string | null; headsUpDays: number; snoozedUntil: string | null; skippedUntil: string | null;
  memberId: string | null; contactId: string | null; usualCostCents: number | null; steps: string[]; supplies: UpkeepSupply[]; suppliesListId: string | null; suppliesDays: number;
  chorePoints: number | null; handedChoreId: string | null; calendarEventId: string | null; calendarEventStart: string | null; wallVisible: boolean; libraryKey: string | null; archived: boolean;
  createdAt: string; updatedAt: string; nextDue: string | null; status: UpkeepStatus; lastDone: { id: string; doneOn: string; memberId: string | null } | null;
};
export type UpkeepEntry = {
  id: string; jobId: string | null; thingId: string | null; title: string; doneOn: string; memberId: string | null; contactId: string | null; costCents: number | null;
  reading: number | null; readingUnit: 'mi' | 'km' | 'h' | null; notes: string | null; choreId: string | null; createdBy: string | null; createdAt: string; files: UpkeepFile[];
};

const json = <T>(s: string | null, fallback: T): T => { try { return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; } };

export async function readAreas(db: KinwallDb): Promise<UpkeepArea[]> {
  return (await db.prepare('SELECT id, name, emoji, sort FROM upkeep_areas ORDER BY sort, name COLLATE NOCASE').all<UpkeepArea>()).results;
}

async function filesBy(db: KinwallDb, col: 'thing_id' | 'log_id', ids: string[]): Promise<Map<string, UpkeepFile[]>> {
  const out = new Map<string, UpkeepFile[]>();
  if (!ids.length) return out;
  const { results } = await db.prepare(`SELECT id, ${col} AS owner, name, mime, bytes FROM upkeep_files WHERE ${col} IN (SELECT value FROM json_each(?)) ORDER BY created_at`).bind(JSON.stringify(ids)).all<UpkeepFile & { owner: string }>();
  for (const { owner, ...f } of results) out.set(owner, [...(out.get(owner) ?? []), f]);
  return out;
}

type ThingRow = {
  id: string; name: string; emoji: string | null; area_id: string | null; room: string | null; brand: string | null; model: string | null; serial: string | null; part_notes: string | null;
  bought_on: string | null; price_cents: number | null; warranty_until: string | null; manual_url: string | null; contact_id: string | null; notes: string | null; archived: number; created_at: string; updated_at: string;
};
export async function readThings(db: KinwallDb, opts: { id?: string } = {}): Promise<UpkeepThing[]> {
  const rows = (await db.prepare(`SELECT * FROM upkeep_things ${opts.id ? 'WHERE id = ?' : ''} ORDER BY archived, name COLLATE NOCASE`).bind(...(opts.id ? [opts.id] : [])).all<ThingRow>()).results;
  const files = await filesBy(db, 'thing_id', rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, name: r.name, emoji: r.emoji, areaId: r.area_id, room: r.room, brand: r.brand, model: r.model, serial: r.serial, partNotes: r.part_notes, boughtOn: r.bought_on,
    priceCents: r.price_cents, warrantyUntil: r.warranty_until, manualUrl: r.manual_url, contactId: r.contact_id, notes: r.notes, archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at,
    files: files.get(r.id) ?? [],
  }));
}

type JobRow = {
  id: string; title: string; emoji: string | null; thing_id: string | null; area_id: string | null; repeat_kind: RepeatKind; every: number | null; unit: Unit | null; on_months: string; on_day: number | null;
  start_on: string | null; due_on: string | null; heads_up_days: number; snoozed_until: string | null; skipped_until: string | null; member_id: string | null; contact_id: string | null;
  usual_cost_cents: number | null; steps: string; supplies: string; supplies_list_id: string | null; supplies_days: number; chore_points: number | null; handed_chore_id: string | null;
  calendar_event_id: string | null; event_start: string | null; wall_visible: number; library_key: string | null; archived: number; created_at: string; updated_at: string;
  last_id: string | null; last_on: string | null; last_member: string | null;
};

/** The facts upkeep-rules.ts works from, with the day it was added in the family's timezone. */
export const factsOf = (j: Pick<UpkeepJob, 'repeatKind' | 'every' | 'unit' | 'onMonths' | 'onDay' | 'startOn' | 'dueOn' | 'headsUpDays' | 'snoozedUntil' | 'skippedUntil' | 'createdAt'>, createdOn: string): JobFacts => ({
  repeatKind: j.repeatKind, every: j.every, unit: j.unit, onMonths: j.onMonths, onDay: j.onDay, startOn: j.startOn, dueOn: j.dueOn, headsUpDays: j.headsUpDays,
  snoozedUntil: j.snoozedUntil, skippedUntil: j.skippedUntil, createdOn,
});

/** Jobs with their next due date, where they stand today and the last time they were done, soonest
 * first (done one-offs last). `today` and `dayOf` (an ISO time as a household day) come from the
 * family's timezone. */
export async function readJobs(db: KinwallDb, today: string, dayOf: (iso: string) => string, opts: { id?: string } = {}): Promise<UpkeepJob[]> {
  const rows = (await db.prepare(`SELECT j.*, e.start AS event_start, l.id AS last_id, l.done_on AS last_on, l.member_id AS last_member
    FROM upkeep_jobs j LEFT JOIN events e ON e.id = j.calendar_event_id
    LEFT JOIN upkeep_log l ON l.id = (SELECT id FROM upkeep_log WHERE job_id = j.id ORDER BY done_on DESC, created_at DESC LIMIT 1)
    ${opts.id ? 'WHERE j.id = ?' : ''}`).bind(...(opts.id ? [opts.id] : [])).all<JobRow>()).results;
  const jobs = rows.map((r): UpkeepJob => {
    const base = {
      id: r.id, title: r.title, emoji: r.emoji, thingId: r.thing_id, areaId: r.area_id, repeatKind: r.repeat_kind, every: r.every, unit: r.unit, onMonths: json<number[]>(r.on_months, []),
      onDay: r.on_day, startOn: r.start_on, dueOn: r.due_on, headsUpDays: r.heads_up_days, snoozedUntil: r.snoozed_until, skippedUntil: r.skipped_until, memberId: r.member_id,
      contactId: r.contact_id, usualCostCents: r.usual_cost_cents, steps: json<string[]>(r.steps, []), supplies: json<UpkeepSupply[]>(r.supplies, []), suppliesListId: r.supplies_list_id,
      suppliesDays: r.supplies_days, chorePoints: r.chore_points, handedChoreId: r.handed_chore_id, calendarEventId: r.event_start ? r.calendar_event_id : null, calendarEventStart: r.event_start,
      wallVisible: !!r.wall_visible, libraryKey: r.library_key, archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at,
      lastDone: r.last_id && r.last_on ? { id: r.last_id, doneOn: r.last_on, memberId: r.last_member } : null,
    };
    const due = r.archived ? null : nextDue(factsOf(base, dayOf(r.created_at)), base.lastDone?.doneOn ?? null);
    return { ...base, nextDue: due, status: statusOf(due, today, r.heads_up_days) };
  });
  return jobs.sort((a, b) => (a.nextDue ?? '9999') < (b.nextDue ?? '9999') ? -1 : (a.nextDue ?? '9999') > (b.nextDue ?? '9999') ? 1 : a.title.localeCompare(b.title));
}

type LogRow = {
  id: string; job_id: string | null; thing_id: string | null; title: string; done_on: string; member_id: string | null; contact_id: string | null; cost_cents: number | null;
  reading: number | null; reading_unit: UpkeepEntry['readingUnit']; notes: string | null; chore_id: string | null; created_by: string | null; created_at: string;
};
export type LogFilter = { id?: string; jobId?: string; thingId?: string; memberId?: string; year?: string; q?: string; limit?: number };
/** The log, newest first. */
export async function readLog(db: KinwallDb, f: LogFilter = {}): Promise<UpkeepEntry[]> {
  const where: string[] = [], binds: unknown[] = [];
  const add = (sql: string, v: unknown) => { where.push(sql); binds.push(v); };
  if (f.id) add('upkeep_log.id = ?', f.id);
  if (f.jobId) add('job_id = ?', f.jobId);
  if (f.thingId) add('thing_id = ?', f.thingId);
  if (f.memberId) add('member_id = ?', f.memberId);
  if (f.year) add('substr(done_on, 1, 4) = ?', f.year);
  if (f.q) {
    const like = `%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    where.push("(upkeep_log.title LIKE ? ESCAPE '\\' OR upkeep_log.notes LIKE ? ESCAPE '\\')");
    binds.push(like, like);
  }
  const rows = (await db.prepare(`SELECT * FROM upkeep_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY done_on DESC, created_at DESC LIMIT ?`).bind(...binds, f.limit ? Math.min(f.limit, 5000) : -1).all<LogRow>()).results;
  const files = await filesBy(db, 'log_id', rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id, jobId: r.job_id, thingId: r.thing_id, title: r.title, doneOn: r.done_on, memberId: r.member_id, contactId: r.contact_id, costCents: r.cost_cents, reading: r.reading,
    readingUnit: r.reading_unit, notes: r.notes, choreId: r.chore_id, createdBy: r.created_by, createdAt: r.created_at, files: files.get(r.id) ?? [],
  }));
}

export type DoneInput = { doneOn: string; memberId?: string | null; contactId?: string | null; costCents?: number | null; reading?: number | null; readingUnit?: UpkeepEntry['readingUnit']; notes?: string | null; choreId?: string | null; createdBy?: string | null };
/** Writes one Done for a job (or nothing when the job is gone) and clears its snooze and skip. */
export async function logDone(db: KinwallDb, jobId: string, d: DoneInput): Promise<string | null> {
  const job = await db.prepare('SELECT title, thing_id FROM upkeep_jobs WHERE id = ?').bind(jobId).first<{ title: string; thing_id: string | null }>();
  if (!job) return null;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db.prepare('INSERT INTO upkeep_log (id, job_id, thing_id, title, done_on, member_id, contact_id, cost_cents, reading, reading_unit, notes, chore_id, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .bind(id, jobId, job.thing_id, job.title, d.doneOn, d.memberId ?? null, d.contactId ?? null, d.costCents ?? null, d.reading ?? null, d.reading != null ? d.readingUnit ?? 'mi' : null, d.notes?.trim() || null, d.choreId ?? null, d.createdBy ?? null, now),
    db.prepare('UPDATE upkeep_jobs SET snoozed_until = NULL, skipped_until = NULL, updated_at = ? WHERE id = ?').bind(now, jobId),
  ]);
  return id;
}

/** A kid's upkeep chore was ticked off (routes/chores.ts completeChore and approve): the job is
 * logged as done by them that day, once. Returns the Done (for the upkeep.done webhook), or null
 * for any other chore. */
export async function logFromChore(db: KinwallDb, choreId: string, date: string, memberId: string | null): Promise<{ id: string; jobId: string; thingId: string | null; title: string; doneOn: string; memberId: string | null } | null> {
  const job = await db.prepare('SELECT id, title, thing_id FROM upkeep_jobs WHERE handed_chore_id = ?').bind(choreId).first<{ id: string; title: string; thing_id: string | null }>();
  if (!job) return null;
  if (await db.prepare('SELECT id FROM upkeep_log WHERE chore_id = ? AND done_on = ?').bind(choreId, date).first()) return null;
  const id = await logDone(db, job.id, { doneOn: date, memberId, choreId, createdBy: memberId });
  return id ? { id, jobId: job.id, thingId: job.thing_id, title: job.title, doneOn: date, memberId } : null;
}

/** Its tick was undone: so is the Done it made. */
export async function unlogFromChore(db: KinwallDb, choreId: string, date: string): Promise<string | null> {
  const row = await db.prepare('DELETE FROM upkeep_log WHERE chore_id = ? AND done_on = ? RETURNING job_id').bind(choreId, date).first<{ job_id: string | null }>();
  return row?.job_id ?? null;
}

/** Hands a due job to its kid as a one-off chore for `day`, with the job's points. Returns the chore's id. */
export async function handOutChore(db: KinwallDb, job: Pick<UpkeepJob, 'id' | 'title' | 'emoji' | 'memberId' | 'chorePoints'>, day: string): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const sort = ((await db.prepare('SELECT MAX(sort) AS m FROM chores').first<{ m: number | null }>())?.m ?? -1) + 1;
  await db.batch([
    db.prepare('INSERT INTO chores (id, title, emoji, member_id, points, rrule, due_date, due_time, active, sort, created_at) VALUES (?,?,?,?,?,NULL,?,NULL,1,?,?)')
      .bind(id, job.title, job.emoji ?? '🔧', job.memberId, job.chorePoints ?? 0, day, sort, now),
    db.prepare('UPDATE upkeep_jobs SET handed_chore_id = ? WHERE id = ?').bind(id, job.id),
  ]);
  return id;
}

/** The list a job's supplies go on: its own, else the family's first Shopping list, else the first
 * shopping list of any kind. Null when there's none. */
export async function suppliesList(db: KinwallDb, listId: string | null): Promise<{ id: string; catalog: 'groceries' | 'shopping' } | null> {
  const own = listId ? await db.prepare("SELECT id, coalesce(catalog, 'shopping') AS catalog FROM lists WHERE id = ? AND archived = 0").bind(listId).first<{ id: string; catalog: 'groceries' | 'shopping' }>() : null;
  return own ?? (await db.prepare("SELECT id, coalesce(catalog, 'shopping') AS catalog FROM lists WHERE kind = 'shopping' AND archived = 0 ORDER BY catalog = 'shopping' DESC, sort, created_at LIMIT 1").first<{ id: string; catalog: 'groceries' | 'shopping' }>());
}

/** Puts a job's supplies on its list, skipping any already there and not ticked off. Returns the
 * names added. */
export async function addSupplies(db: KinwallDb, list: { id: string; catalog: 'groceries' | 'shopping' }, supplies: UpkeepSupply[], note: string): Promise<string[]> {
  const names = [...new Map(supplies.map((s) => [itemKey(s.name), s.name.trim()])).entries()].filter(([k, n]) => k && n);
  if (!names.length) return [];
  const open = new Set((await db.prepare('SELECT name_key FROM list_items WHERE list_id = ? AND done = 0').bind(list.id).all<{ name_key: string | null }>()).results.map((r) => r.name_key));
  const wanted = names.filter(([k]) => !open.has(k));
  if (!wanted.length) return [];
  const memory = await recall(db, list.catalog, wanted.map(([, n]) => n));
  const now = new Date().toISOString();
  let sort = ((await db.prepare('SELECT MAX(sort) AS m FROM list_items WHERE list_id = ?').bind(list.id).first<{ m: number | null }>())?.m ?? -1) + 1;
  const writes: KinwallStatement[] = [];
  for (const [key, name] of wanted) {
    const place = fillPlace(memory, name, {});
    writes.push(db.prepare("INSERT INTO list_items (id, list_id, title, name_key, notes, store, category, aisle, for_member_ids, sort, created_at, updated_at, added_by_label) VALUES (?,?,?,?,?,?,?,?,'[]',?,?,?,?)")
      .bind(crypto.randomUUID(), list.id, name, key, note, place.store, place.category, place.aisle, sort++, now, now, 'Kinwall'));
    writes.push(rememberName(db, list.catalog, name, now));
  }
  await db.batch(writes);
  return wanted.map(([, n]) => n);
}
