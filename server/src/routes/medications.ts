// Medication reminders: per person, a medicine's name, dose (free text) and daily times, optionally
// on certain weekdays only. At each time the person's own devices get a reminder (notify.ts
// runMedicationReminders) and shared walls a "Take now" card; Taken / Skip / Snooze 10 min.
//
// Health data end to end (AGENTS.md "Health data"):
// - Off until a parent turns it on (settings.medications); off hides everything (404) and keeps the data.
// - Name, dose, times, weekdays, course end and late window are one sealed JSON (medications.data, aad '<id>:data'); a day's
//   taken / skipped / snoozed log, and when their day started for a "When I start my day" dose (startDay),
//   is one sealed JSON per medicine per day (medication_log.log, aad '<medication_id>:<date>:log').
//   Only who (member_id) and which day (date, and updated_at holds the day too) stay plain. No key: 500, nothing stored.
// - The bell's medicine notes (notifications, kind 'medication') are sealed too, text and exact time
//   (notify.ts recordNotification / openNote); only kind, day and member stay plain. No key: no note.
// - Refills (routes/medication-refills.ts): each medicine's refill details (which contact to ask, the pharmacy,
//   date of birth, callback number, a reminder day) and its open refill request ride in the same sealed JSON.
// - Never logged, no webhook events at all, not in snapshots, profiles or share links. MCP tools only
//   read and start refill requests, through these routes (so aiHealthAccess applies).
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
import { actorOf, ownDevice, requestKey } from '../auth.ts';
import { seal, unseal, type EncryptionEnv } from '../crypto.ts';
import { zonedTimeToUtc } from '../recurrence.ts';
import { ErrorSchema } from '../schemas.ts';
import { isConnectedApp } from './mcp-oauth.ts';
import { todayInTz } from './members.ts';
import { parseFeatures } from './settings.ts';

export const medicationsRoutes = createRouter();
type C = Context<{ Bindings: Env }>;

export const DUE_MS = 3 * 60 * 60_000; // a dose shows as "Take now" for 3 hours (its late window by default), then "Not marked"
export const STRICT_MS = 60 * 60_000; // lateWindow 'none': the card stays an hour, time enough to notice it
export const EVENING = '20:00'; // lateWindow 'evening'
export const LATE_MS = 30 * 60_000; // a kid's dose not marked by then tells parents
export const SNOOZE_MS = 10 * 60_000;
// Marking with `at` (a dose taken earlier than the tap): up to this far ahead of the server's clock is
// the phone's clock running fast, and is stored as now; further ahead is refused.
export const CLOCK_SKEW_MS = 2 * 60_000;

const TimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'times: HH:MM');
const DateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date: YYYY-MM-DD');
const Name = z.string().trim().min(1).max(60).openapi({ description: 'What it is, in the family\'s words (e.g. "Allergy medicine").' });
const Dose = z.string().trim().max(40).openapi({ description: 'Free text, e.g. "5 mg" or "1 tablet".' });
// A dose time: a clock time, or "When I start my day" by a latest time (see startDay). At most one of those.
const WakeSchema = z.object({ wake: z.literal(true), latest: TimeSchema }).strict().openapi({ description: '"When I start my day": due when their day starts (startDay), or at latest.' });
export const DoseTimesSchema = z.array(z.union([TimeSchema, WakeSchema])).min(1); // the export file's
const Times = z
  .array(z.union([TimeSchema, WakeSchema]))
  .min(1).max(8)
  .refine((t) => t.filter((x) => typeof x !== 'string').length <= 1, 'times: one "When I start my day" at most')
  .transform((t) => [...t.filter((x) => typeof x !== 'string'), ...[...new Set(t.filter((x) => typeof x === 'string'))].sort()])
  .openapi({ description: 'Household times, HH:MM, and at most one { wake: true, latest: "HH:MM" } (up to 8 in all).' });
const Days = z.array(z.number().int().min(0).max(6)).min(1).max(7).transform((d) => [...new Set(d)].sort((a, b) => a - b)).openapi({ description: 'Weekdays, 0 = Sunday. Every day by default.' });

// A course (e.g. an antibiotic) ends on its endDate, or once totalDoses have been taken (skips don't count).
const EndDate = DateSchema.nullable().openapi({ description: 'Last household day of doses (YYYY-MM-DD); null: no end.' });
const TotalDoses = z.number().int().min(1).max(1000).nullable().openapi({ description: 'Stop after this many doses are taken; null: no limit.' });
// How late a dose may still be taken: the Take now card, "due" and the reminders follow it. Never shorter
// than 3 hours except 'none' (1 hour), so a 7 PM dose with 'evening' still gets until 10 PM.
export const LATE_WINDOWS = ['3h', 'evening', 'endOfDay', 'none'] as const;
export type LateWindow = (typeof LATE_WINDOWS)[number];
export const LateWindowSchema = z.enum(LATE_WINDOWS).openapi({ description: "How late a dose can be taken: '3h' (default), 'evening' (until 8 PM), 'endOfDay' (until midnight), 'none' (the card stays 1 hour)." });

// Refill details (routes/medication-refills.ts), sealed with the rest.
export const RefillSchema = z
  .object({
    contactId: z.string().nullable().openapi({ description: 'Where to ask for refills: a contact from the family\'s contacts (GET /api/contacts), like the doctor\'s office, or null.' }),
    pharmacyContactId: z.string().nullable().openapi({ description: 'The pharmacy from the family\'s contacts (GET /api/contacts), or null.' }),
    pharmacy: z.string().trim().max(120).openapi({ description: 'The pharmacy by name: used when no contact is picked (or it was deleted, or this device can\'t see it).' }),
    dateOfBirth: DateSchema.nullable().openapi({ description: 'YYYY-MM-DD, said in the refill message.' }),
    callback: z.string().trim().max(30).regex(/^[0-9+()\-.\s]*$/, 'callback: a phone number').openapi({ description: 'A phone number the office can call back.' }),
    remindOn: DateSchema.nullable().openapi({ description: 'A household day to open a refill request by itself (at 9 AM); cleared once it does.' }),
  })
  .openapi('MedicationRefill');
export type Refill = z.infer<typeof RefillSchema>;
export const NO_REFILL: Refill = { contactId: null, pharmacyContactId: null, pharmacy: '', dateOfBirth: null, callback: '', remindOn: null };
export const RefillRequestSchema = z.object({ at: z.string(), by: z.string().nullable() }).openapi('MedicationRefillRequest');
const MedicationSchema = z
  .object({
    id: z.string(), memberId: z.string(), name: z.string(), dose: z.string(), times: z.array(z.union([z.string(), WakeSchema])), days: z.array(z.number()),
    endDate: z.string().nullable(), totalDoses: z.number().nullable(), lateWindow: LateWindowSchema,
    dosesLeft: z.number().nullable().openapi({ description: 'totalDoses minus doses taken; null without totalDoses.' }),
    refill: RefillSchema,
    refillRequest: RefillRequestSchema.nullable().openapi({ description: 'An open "Request refill" to-do (since `at`), until someone marks it requested.' }),
    createdAt: z.string(), updatedAt: z.string(),
  })
  .openapi('Medication');
const MedicationInputSchema = z.object({ memberId: z.string(), name: Name, dose: Dose.default(''), times: Times, days: Days.default([0, 1, 2, 3, 4, 5, 6]), endDate: EndDate.default(null), totalDoses: TotalDoses.default(null), lateWindow: LateWindowSchema.default('3h'), refill: RefillSchema.partial().optional() }).openapi('MedicationInput');
const MedicationPatchSchema = z.object({ name: Name.optional(), dose: Dose.optional(), times: Times.optional(), days: Days.optional(), endDate: EndDate.optional(), totalDoses: TotalDoses.optional(), lateWindow: LateWindowSchema.optional(), refill: RefillSchema.partial().optional().openapi({ description: 'Only the refill fields sent change.' }) }).openapi('MedicationPatch');
const STATUSES = ['taken', 'skipped', 'due', 'missed', 'upcoming'] as const;
const DoseSchema = z
  .object({
    medicationId: z.string(), date: z.string(), time: z.string().openapi({ description: 'HH:MM, or "wake" for a "When I start my day" dose.' }), status: z.enum(STATUSES),
    startedAt: z.string().nullable().openapi({ description: 'A "When I start my day" dose: when their day started (null until it does, or when the latest time came first).' }),
    at: z.string().nullable().openapi({ description: 'When it was taken or skipped: the time it was marked, or the `at` it was marked with.' }),
    late: z.boolean().openapi({ description: 'Taken after its late window closed.' }),
    by: z.string().nullable().openapi({ description: 'The device that marked it.' }),
    edited: z.boolean().openapi({ description: 'Changed after it was first marked (its time or status). The first mark and who changed it stay in the sealed log.' }),
    snoozedUntil: z.string().nullable(),
  })
  .openapi('MedicationDose');
const DueSchema = z
  .object({
    names: z.boolean().openapi({ description: 'false: a shared wall with names off; name and dose are null ("Meds").' }),
    doses: z.array(z.object({
      medicationId: z.string(), memberId: z.string(), date: z.string(), time: z.string().openapi({ description: 'HH:MM, or "wake".' }), dueAt: z.string(),
      startedAt: z.string().nullable(), until: z.string().openapi({ description: 'When its late window closes.' }), name: z.string().nullable(), dose: z.string().nullable(),
    })),
  })
  .openapi('MedicationsDue');
const HistorySchema = z
  .object({
    memberId: z.string(), today: z.string(), medications: z.array(MedicationSchema),
    days: z.array(z.object({ date: z.string(), doses: z.array(DoseSchema.omit({ date: true, snoozedUntil: true }).extend({ dueAt: z.string() })) })).openapi({ description: 'Oldest first, today last.' }),
  })
  .openapi('MedicationHistory');

export type Medication = z.infer<typeof MedicationSchema>;
// An edited dose keeps its first mark (first) and the latest change (editedAt, editedBy), sealed with the rest.
export type FirstMark = { status: 'taken' | 'skipped'; at?: string; by?: string };
/** snoozedFor: a grown-up's own phone snoozed someone else's dose just for itself (member id → until). */
export type DoseEntry = { status?: 'taken' | 'skipped'; at?: string; by?: string; snoozedUntil?: string; snoozedFor?: Record<string, string>; startedAt?: string; first?: FirstMark; editedAt?: string; editedBy?: string };
export type DoseLog = Record<string, DoseEntry>; // by time, HH:MM, or WAKE
export type DoseTime = Medication['times'][number];
export const WAKE = 'wake'; // a "When I start my day" dose's key in the log and the API
/** A dose time's key: its HH:MM, or WAKE. */
export const timeKey = (t: DoseTime) => (typeof t === 'string' ? t : WAKE);
const wakeOf = (m: Pick<Medication, 'times'>) => m.times.find((t) => typeof t !== 'string');
export type MedRow = { id: string; member_id: string; data: string; created_at: string; updated_at: string };
type LogRow = { medication_id: string; date: string; log: string; updated_at: string };

const dataAad = (id: string) => `${id}:data`;
const logAad = (id: string, date: string) => `${id}:${date}:log`;
export const sealMedication = async (env: EncryptionEnv, m: Pick<Medication, 'id' | 'name' | 'dose' | 'times' | 'days'> & Partial<Pick<Medication, 'endDate' | 'totalDoses' | 'lateWindow' | 'refill' | 'refillRequest'>>) =>
  seal(env, JSON.stringify({ name: m.name, dose: m.dose, times: m.times.map((t) => (typeof t === 'string' ? { at: t } : t)), days: m.days, endDate: m.endDate ?? null, totalDoses: m.totalDoses ?? null, lateWindow: m.lateWindow ?? '3h', refill: { ...NO_REFILL, ...m.refill }, refillRequest: m.refillRequest ?? null }), dataAad(m.id));
export async function openMedication(env: EncryptionEnv & { DB: KinwallDb }, r: MedRow): Promise<Medication> {
  const d = JSON.parse(await unseal(env, r.data, dataAad(r.id)));
  // Times sealed before "When I start my day" are plain "HH:MM"; now { at } or { wake, latest }. Written back in the new shape.
  const times = (d.times as (string | { at: string } | { wake: true; latest: string })[]).map((t) => (typeof t === 'string' ? t : 'at' in t ? t.at : { wake: true as const, latest: t.latest }));
  const m: Medication = { id: r.id, memberId: r.member_id, name: d.name, dose: d.dose ?? '', times, days: d.days, endDate: d.endDate ?? null, totalDoses: d.totalDoses ?? null, lateWindow: d.lateWindow ?? '3h', dosesLeft: null, refill: { ...NO_REFILL, ...d.refill }, refillRequest: d.refillRequest ?? null, createdAt: r.created_at, updatedAt: r.updated_at };
  return withDosesLeft(env, m);
}
/** dosesLeft for a medicine with totalDoses: counts every taken dose in its log. */
export async function withDosesLeft(env: EncryptionEnv & { DB: KinwallDb }, m: Medication): Promise<Medication> {
  if (m.totalDoses == null) return { ...m, dosesLeft: null };
  const { results } = await env.DB.prepare('SELECT * FROM medication_log WHERE medication_id = ?').bind(m.id).all<LogRow>();
  const taken = (await Promise.all(results.map((r) => openLog(env, r)))).reduce((n, log) => n + Object.values(log).filter((e) => e.status === 'taken').length, 0);
  return { ...m, dosesLeft: Math.max(0, m.totalDoses - taken) };
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

/** Read a day's log, change it and write it back only if nobody wrote in between (a wall and a phone at
 *  once). `change` edits the log in place; false leaves it as it was (null). 'conflict' after 3 tries.
 *  updated_at keeps the day only: a clock time there would say, in plain text, when a dose was marked
 *  or when someone's day started. */
export async function updateLog(env: EncryptionEnv & { DB: KinwallDb }, id: string, date: string, change: (log: DoseLog, now: Date) => boolean): Promise<{ log: DoseLog; now: Date } | null | 'conflict'> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await env.DB.prepare('SELECT * FROM medication_log WHERE medication_id = ? AND date = ?').bind(id, date).first<LogRow>();
    const log = row ? await openLog(env, row) : {};
    const now = new Date();
    if (!change(log, now)) return null;
    const sealed = await sealLog(env, id, date, log);
    const res = row
      ? await env.DB.prepare('UPDATE medication_log SET log = ?, updated_at = ? WHERE medication_id = ? AND date = ? AND log = ?').bind(sealed, date, id, date, row.log).run()
      : await env.DB.prepare('INSERT INTO medication_log (medication_id, date, log, updated_at) VALUES (?,?,?,?) ON CONFLICT DO NOTHING').bind(id, date, sealed, date).run();
    if (!res.meta.changes) continue;
    await bumpRev(env.DB).run();
    return { log, now };
  }
  return 'conflict';
}

// "When I start my day" doses: due at the earliest of their first Temp check answer, their first daily
// check-in, or their own device opening the app (POST /api/members/{id}/day-started), else at the
// latest time. Each of those calls startDay, and the first one writes the moment into that dose's
// sealed log entry (startedAt, like the rest of the log: it says when someone woke up). Nothing is
// kept for a person without such a dose that day, and nothing after the latest time (it's due by then).
// For a kid, a parent's device never starts their day (dayStartCounts).
export async function startDay(env: EncryptionEnv & { DB: KinwallDb }, memberId: string, tz: string): Promise<void> {
  const now = new Date();
  const date = todayInTz(tz, now);
  for (const m of await loadMedications(env, memberId)) {
    const wake = wakeOf(m);
    if (!wake || typeof wake === 'string' || !scheduledOn(m, date) || now.getTime() >= doseAt(date, wake.latest, tz)) continue;
    await updateLog(env, m.id, date, (log) => {
      if (log[WAKE]?.startedAt || log[WAKE]?.status) return false;
      log[WAKE] = { ...log[WAKE], startedAt: now.toISOString() };
      return true;
    });
  }
}
/** Does this request start `memberId`'s day: their own device (a grown-up's phone too) or a shared
 *  wall; another parent's device never; a parent's device nobody owns only for a grown-up. */
async function dayStartCounts(c: C, memberId: string): Promise<boolean> {
  const key = await requestKey(c);
  if (key?.scope === 'display') return !key.owner || key.owner === 'shared' || key.owner === memberId;
  const own = await ownDevice(c);
  if (own) return own === memberId;
  return !!(await c.env.DB.prepare('SELECT grown_up FROM members WHERE id = ?').bind(memberId).first<{ grown_up: number }>())?.grown_up;
}
/** From the Temp check and check-in routes: start their day if medications are on and this counts.
 *  Never fails the caller's request; the error's name only, never data. */
export async function startDayFrom(c: C, memberId: string): Promise<void> {
  try {
    const settings = await medSettings(c.env.DB);
    if (!settings.medications || !(await dayStartCounts(c, memberId))) return;
    await startDay(c.env, memberId, settings.timezone ?? hostTimezone());
  } catch (e) { console.error('start of day skipped:', e instanceof Error ? e.name : 'error'); }
}

export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
/** Is a dose due that day: its weekday, not past its end date, and (for a counted course) doses left. */
export const scheduledOn = (m: Pick<Medication, 'days' | 'endDate' | 'dosesLeft'>, date: string) =>
  m.days.includes(new Date(`${date}T12:00:00Z`).getUTCDay()) && (!m.endDate || date <= m.endDate) && m.dosesLeft !== 0;
/** The instant a dose is due: its HH:MM on that household day. */
export function doseAt(date: string, time: string, tz: string): number {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = time.split(':').map(Number);
  return zonedTimeToUtc({ y, mo: mo - 1, d, h, mi, s: 0 }, tz).getTime();
}
/** When a dose due at `dueAt` (on household `date`) stops being "due" and becomes "Not marked". */
export function windowEnd(lateWindow: LateWindow, date: string, dueAt: number, tz: string): number {
  if (lateWindow === 'none') return dueAt + STRICT_MS;
  const until = lateWindow === 'evening' ? doseAt(date, EVENING, tz) : lateWindow === 'endOfDay' ? doseAt(addDays(date, 1), '00:00', tz) : 0;
  return Math.max(until, dueAt + DUE_MS);
}
/** When a dose is due: its clock time, or for "When I start my day" when their day started, else its latest time. */
export function dueAt(t: DoseTime, date: string, tz: string, e: DoseEntry | undefined): number {
  if (typeof t === 'string') return doseAt(date, t, tz);
  const latest = doseAt(date, t.latest, tz);
  const started = e?.startedAt ? Date.parse(e.startedAt) : Infinity;
  return Math.min(started, latest);
}
/** A log key's dose time on this medicine (a time it no longer has: as it was). */
export const timeFor = (m: Pick<Medication, 'times'>, key: string): DoseTime => m.times.find((t) => timeKey(t) === key) ?? (key === WAKE ? { wake: true, latest: '12:00' } : key);

/** Taken after its late window closed ("Taken late"); a dose marked with an earlier `at` inside its window is on time. */
export const takenLate = (e: DoseEntry | undefined, end: number) => e?.status === 'taken' && !!e.at && Date.parse(e.at) > end;

export function doseStatus(dueAt: number, end: number, e: DoseEntry | undefined, now: number): (typeof STATUSES)[number] {
  if (e?.status) return e.status;
  return now < dueAt ? 'upcoming' : now < end ? 'due' : 'missed';
}
/** "Allergy medicine · 1 tablet" (for a device that opted into names). */
export const medicineLabel = (m: Pick<Medication, 'name' | 'dose'>) => (m.dose ? `${m.name} · ${m.dose}` : m.name);

type Caller = { kind: 'parent' } | { kind: 'wall' } | { kind: 'own'; memberId: string };
const APPS = { error: "Medications are private to the family's own devices. A parent can allow connected apps to see them in Settings → Connected apps." };
export const PARENTS = { error: "Medicines are added and changed from a parent's device." };
export const PRIVATE = { error: "Medications are private: they show on that person's own device and parents' devices." };
const OFF = { error: 'Medications are turned off (Settings → General → Features, under Health)' };

/** Who's asking (see the top of the file), or why they may not. */
/** The settings these routes use (parsed as routes/settings.ts readSettings does), by key: every open
 * screen asks GET /api/medications/due each minute, and readSettings reads every settings row (hosted
 * is billed per row read). */
export async function medSettings(db: KinwallDb) {
  const { results } = await db
    .prepare("SELECT key, value FROM settings WHERE key IN ('medications', 'features', 'aiHealthAccess', 'timezone', 'medicationNamesOnWalls')")
    .all<{ key: string; value: string }>();
  const map = new Map(results.map((r) => [r.key, r.value]));
  return {
    medications: map.get('medications') === 'true' && parseFeatures(map.get('features')).trackersHealth,
    aiHealthAccess: map.get('aiHealthAccess') === 'true',
    medicationNamesOnWalls: map.get('medicationNamesOnWalls') === 'true',
    timezone: map.get('timezone') ?? null,
  };
}

async function caller(c: C, settings: { aiHealthAccess: boolean }): Promise<Caller | { error: string }> {
  if ((await isConnectedApp(c)) && !settings.aiHealthAccess) return APPS;
  const key = await requestKey(c);
  if (key?.scope !== 'display') return { kind: 'parent' };
  return key.owner && key.owner !== 'shared' ? { kind: 'own', memberId: key.owner } : { kind: 'wall' };
}
/** Settings, the caller and the household day, or what to answer instead (feature off: 404). */
export async function gate(c: C) {
  const settings = await medSettings(c.env.DB);
  if (!settings.medications) return { fail: OFF, status: 404 as const };
  const who = await caller(c, settings);
  if ('error' in who) return { fail: who, status: 403 as const };
  const tz = settings.timezone ?? hostTimezone();
  return { settings, who, tz, today: todayInTz(tz) };
}

/** SQL for the bell's feed (routes/push.ts): which 'medication' rows this caller may see, with its bind values. */
export async function medicationFeedFilter(c: C): Promise<{ sql: string; binds: string[] }> {
  const settings = await medSettings(c.env.DB);
  const who = settings.medications ? await caller(c, settings) : OFF;
  if ('error' in who) return { sql: " AND kind != 'medication'", binds: [] };
  if (who.kind === 'own') return { sql: " AND (kind != 'medication' OR EXISTS (SELECT 1 FROM json_each(member_ids) WHERE value = ?))", binds: [who.memberId] };
  return { sql: '', binds: [] };
}

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: json(ErrorSchema) });
const denied = { 403: err("not allowed from this device (see the Medications tag), or a connected app without aiHealthAccess"), 404: err('medications are off, or not found') };
const TAG = ['Medications'];

export async function findMed(c: C, id: string) {
  const row = await c.env.DB.prepare('SELECT * FROM medications WHERE id = ?').bind(id).first<MedRow>();
  return row && openMedication(c.env, row);
}
// A pharmacy or refill contact id that is not a contact.
const badPharmacy = async (c: C, id: string | null | undefined) => !!id && !(await c.env.DB.prepare('SELECT 1 FROM contacts WHERE id = ?').bind(id).first());
async function write(c: C, m: Medication) {
  const data = await sealMedication(c.env, m); // throws without a key, before anything is written
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO medications (id, member_id, data, created_at, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at')
      .bind(m.id, m.memberId, data, m.createdAt, m.updatedAt),
    bumpRev(c.env.DB),
  ]);
}
// Open screens refetch on rev; no bus event (it would reach webhooks).
export const bumpRev = (db: KinwallDb) => db.prepare("INSERT INTO settings (key, value) VALUES ('rev', '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1");

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
    if (await badPharmacy(c, body.refill?.pharmacyContactId)) return c.json({ error: 'pharmacy contact not found' }, 400);
    if (await badPharmacy(c, body.refill?.contactId)) return c.json({ error: 'refill contact not found' }, 400);
    const now = new Date().toISOString();
    const m: Medication = { id: crypto.randomUUID(), memberId: body.memberId, name: body.name, dose: body.dose, times: body.times, days: body.days, endDate: body.endDate, totalDoses: body.totalDoses, lateWindow: body.lateWindow, dosesLeft: body.totalDoses, refill: { ...NO_REFILL, ...body.refill }, refillRequest: null, createdAt: now, updatedAt: now };
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
    if (await badPharmacy(c, body.refill?.pharmacyContactId)) return c.json({ error: 'pharmacy contact not found' }, 400);
    if (await badPharmacy(c, body.refill?.contactId)) return c.json({ error: 'refill contact not found' }, 400);
    const m: Medication = {
      ...found, name: body.name ?? found.name, dose: body.dose ?? found.dose, times: body.times ?? found.times, days: body.days ?? found.days,
      endDate: body.endDate !== undefined ? body.endDate : found.endDate, totalDoses: body.totalDoses !== undefined ? body.totalDoses : found.totalDoses, lateWindow: body.lateWindow ?? found.lateWindow, refill: { ...found.refill, ...body.refill }, updatedAt: new Date().toISOString(),
    };
    await write(c, m);
    return c.json(await withDosesLeft(c.env, m), 200);
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
    const who = await caller(c, await medSettings(c.env.DB));
    if ('error' in who) return c.json(who, 403);
    if (who.kind !== 'parent') return c.json(PARENTS, 403);
    const db = c.env.DB;
    const deleted = (await db.prepare('SELECT COUNT(*) AS n FROM medications').first<{ n: number }>())?.n ?? 0;
    await db.batch([
      db.prepare('DELETE FROM medication_log'),
      db.prepare('DELETE FROM medications'),
      db.prepare('DELETE FROM medication_refill_contacts'),
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
    summary: 'Doses to take now (from their time through their late window, 3 hours by default, until taken, skipped or snoozed): the "Take now" cards. A shared wall gets everyone\'s, with name and dose null unless medicationNamesOnWalls; a person\'s own device only theirs.',
    responses: { 200: { description: 'ok', content: json(DueSchema) }, ...denied },
  }),
  async (c) => {
    const g = await gate(c);
    if ('fail' in g) return c.json(g.fail, g.status);
    const names = g.who.kind !== 'wall' || g.settings.medicationNamesOnWalls;
    const viewer = (await actorOf(c)).memberId; // whose phone: what it snoozed for itself stays hidden here
    const meds = (await loadMedications(c.env, g.who.kind === 'own' ? g.who.memberId : undefined));
    const yesterday = addDays(g.today, -1);
    const logs = await loadLogs(c.env, meds.map((m) => m.id), yesterday, g.today);
    const now = Date.now();
    const doses = meds.flatMap((m) => [yesterday, g.today].flatMap((date) => (scheduledOn(m, date) ? m.times : []).flatMap((t) => {
      const time = timeKey(t);
      const e = logs.get(`${m.id}:${date}`)?.[time];
      const at = dueAt(t, date, g.tz, e);
      const end = windowEnd(m.lateWindow, date, at, g.tz);
      const mine = viewer ? e?.snoozedFor?.[viewer] : undefined;
      if (doseStatus(at, end, e, now) !== 'due' || (e?.snoozedUntil && Date.parse(e.snoozedUntil) > now) || (mine && Date.parse(mine) > now)) return [];
      return [{ medicationId: m.id, memberId: m.memberId, date, time, dueAt: new Date(at).toISOString(), startedAt: e?.startedAt ?? null, until: new Date(end).toISOString(), name: names ? m.name : null, dose: names ? m.dose : null }];
    })));
    const order = new Map((await c.env.DB.prepare('SELECT id FROM members ORDER BY sort, created_at').all<{ id: string }>()).results.map((r, i) => [r.id, i]));
    doses.sort((a, b) => a.dueAt.localeCompare(b.dueAt) || (order.get(a.memberId) ?? 0) - (order.get(b.memberId) ?? 0));
    return c.json({ names, doses }, 200);
  },
);

medicationsRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/medications/{id}/doses', tags: TAG, security: [{ Bearer: [] }],
    summary: "Mark a dose taken or skipped, or snooze it 10 minutes (today's or yesterday's). Parent devices, shared walls, and the person's own device for their own. A grown-up's own phone snoozing someone else's dose snoozes it on that phone only. Marking an already-marked dose again with a different status or `at` changes it (edited: true), and unmark takes the mark back: parent devices and the person's own device only (a shared wall gets 409).",
    request: { params: idParams, body: { content: json(z.object({ date: DateSchema, time: z.union([TimeSchema, z.literal(WAKE)]), action: z.enum(['taken', 'skipped', 'snooze', 'unmark']).openapi({ description: 'unmark: back to not marked.' }),
      at: z.string().datetime({ offset: true }).optional().openapi({ description: "Taken or skipped only: when it really happened (ISO), for a dose marked after the fact. From the start of the dose's household day (midnight) until now (2 minutes ahead is taken as now). Default: now." }),
    }).openapi('MedicationDoseInput')) } },
    responses: { 200: { description: 'saved', content: json(DoseSchema) }, 400: err('not one of its doses, nothing to snooze, or an `at` out of range'), 409: err('marked from another device at the same moment, or a shared wall changing a marked dose'), ...denied },
  }),
  async (c) => {
    const g = await gate(c);
    if ('fail' in g) return c.json(g.fail, g.status);
    const m = await findMed(c, c.req.valid('param').id);
    if (!m) return c.json({ error: 'not found' }, 404);
    if (g.who.kind === 'own' && g.who.memberId !== m.memberId) return c.json({ error: 'This device can only mark its own medicines.' }, 403);
    const { date, time, action, at: when } = c.req.valid('json');
    if (date !== g.today && date !== addDays(g.today, -1)) return c.json({ error: "Only today's and yesterday's doses can be marked" }, 400);
    const scheduled = m.times.find((x) => timeKey(x) === time);
    const t = scheduled ?? timeFor(m, time); // a marked dose whose time or course has since ended can still be corrected
    const taken = when === undefined ? null : Date.parse(when);
    if (taken !== null) {
      if (action === 'snooze' || action === 'unmark') return c.json({ error: 'A time goes with taken or skipped only' }, 400);
      if (taken > Date.now() + CLOCK_SKEW_MS) return c.json({ error: "That time hasn't happened yet" }, 400);
      if (taken < doseAt(date, '00:00', g.tz)) return c.json({ error: "That's before the dose's day started" }, 400);
    }
    const key = await requestKey(c);
    const actor = await actorOf(c);
    // A grown-up's own phone (its page, or its widgets' key on the Live Activity) snoozing someone
    // else's dose snoozes it there only: the kid's device and the wall keep it. Elsewhere it's for everyone.
    const just = actor.memberId && actor.memberId !== m.memberId ? actor.memberId : null;
    // A parent's phone's widgets key is shared, but what it marks is that grown-up's doing (actorOf).
    const credited = key?.deviceKind === 'widgets' && actor.memberId ? (await c.env.DB.prepare('SELECT name FROM members WHERE id = ?').bind(actor.memberId).first<{ name: string }>())?.name : null;
    const by = credited ?? key?.name ?? null;
    let refused: { error: string; status: 400 | 409 } | null = null;
    let same: DoseEntry | null = null; // already marked just so: nothing to change
    const done = await updateLog(c.env, m.id, date, (log, now) => {
      const prev = log[time];
      const startedAt = prev?.startedAt ? { startedAt: prev.startedAt } : {}; // kept through a snooze or a mark
      const trail = prev?.first ? { first: prev.first, ...(prev.editedAt ? { editedAt: prev.editedAt } : {}), ...(prev.editedBy ? { editedBy: prev.editedBy } : {}) } : {};
      if (!prev?.status && (!scheduled || !scheduledOn(m, date))) refused = { error: "That isn't one of its doses", status: 400 };
      else if (prev?.status && action === prev.status && taken === null) same = prev; // the same tap twice (a wall and a phone)
      else if (g.who.kind === 'wall' && action !== 'snooze' && (prev?.status || action === 'unmark')) refused = { error: "It's already marked. A parent's device or their own device can change it.", status: 409 };
      else if (action === 'snooze') {
        const at = dueAt(t, date, g.tz, prev);
        if (doseStatus(at, windowEnd(m.lateWindow, date, at, g.tz), prev, now.getTime()) !== 'due') refused = { error: 'Only a dose that is due can be snoozed', status: 400 };
        else {
          const until = new Date(now.getTime() + SNOOZE_MS).toISOString();
          log[time] = just ? { ...prev, snoozedFor: { ...prev?.snoozedFor, [just]: until } } : { ...startedAt, ...trail, snoozedUntil: until };
        }
      } else if (action === 'unmark' && !prev?.status) same = prev ?? {};
      else {
        // Changing a marked (or unmarked) dose: its first mark is kept once, and who changed it last.
        const first = prev?.first ?? (prev?.status ? { status: prev.status, ...(prev.at ? { at: prev.at } : {}), ...(prev.by ? { by: prev.by } : {}) } : null);
        const edit = first ? { first, editedAt: now.toISOString(), ...(by ? { editedBy: by } : {}) } : {};
        log[time] = action === 'unmark' ? { ...startedAt, ...edit } : { ...startedAt, ...edit, status: action, at: new Date(Math.min(taken ?? Infinity, now.getTime())).toISOString(), ...(by ? { by } : {}) };
      }
      return !refused && !same;
    });
    if (done === 'conflict') return c.json({ error: 'Someone else just marked it. Try again.' }, 409);
    const r = refused as { error: string; status: 400 | 409 } | null;
    if (r) return c.json({ error: r.error }, r.status);
    const e: DoseEntry = done ? done.log[time] : ((same as DoseEntry | null) ?? {});
    const now = done ? done.now : new Date();
    const at = dueAt(t, date, g.tz, e);
    const end = windowEnd(m.lateWindow, date, at, g.tz);
    return c.json({ medicationId: m.id, date, time, status: doseStatus(at, end, e, now.getTime()), startedAt: e.startedAt ?? null, at: e.at ?? null, late: takenLate(e, end), by: e.by ?? null, edited: !!e.editedAt, snoozedUntil: (just ? e.snoozedFor?.[just] : e.snoozedUntil) ?? null }, 200);
  },
);

medicationsRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/members/{id}/day-started', tags: TAG, security: [{ Bearer: [] }],
    summary: 'Their own device opened the app today: starts the day for "When I start my day" doses (the first call a day counts; again changes nothing). The person\'s own device only (theirs paired, or a grown-up\'s own full-access device; never a connected app); the web app calls it once a day.',
    request: { params: idParams },
    responses: { 204: { description: 'noted (or nothing to note)' }, ...denied },
  }),
  async (c) => {
    const g = await gate(c);
    if ('fail' in g) return c.json(g.fail, g.status);
    const { id } = c.req.valid('param');
    if ((await ownDevice(c)) !== id) return c.json({ error: "Only that person's own device can start their day." }, 403);
    await startDay(c.env, id, g.tz);
    return c.body(null, 204);
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
        const times = [...new Set([...(date >= since && scheduledOn({ ...m, dosesLeft: null }, date) ? m.times.map(timeKey) : []), ...Object.keys(log).filter((t) => log[t].status)])];
        return times.map((time) => {
          const e = log[time];
          const due = dueAt(timeFor(m, time), date, g.tz, e);
          const end = windowEnd(m.lateWindow, date, due, g.tz);
          return { medicationId: m.id, time, dueAt: new Date(due).toISOString(), status: doseStatus(due, end, e, now), startedAt: e?.startedAt ?? null, at: e?.at ?? null, late: takenLate(e, end), by: e?.by ?? null, edited: !!e?.editedAt };
        });
      }).sort((a, b) => a.dueAt.localeCompare(b.dueAt) || a.time.localeCompare(b.time));
      days.push({ date, doses });
    }
    return c.json({ memberId: id, today: g.today, medications: meds, days }, 200);
  },
);
