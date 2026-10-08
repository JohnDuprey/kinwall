// Medicine refills: where and how a family asks for one, and a "Request refill" to-do per medicine.
//
// - Where to ask: a family contact (medications.data refill.contactId), like the doctor's office: its
//   phone numbers, each with its phone menu (schemas.ts ContactPhoneSchema, dial-steps.ts), and its
//   websites and app links. Contacts aren't health data; who takes which medicine stays sealed here.
// - The refill card (GET /api/medications/{id}/refill): that contact as this device may see it, a tel:
//   link per phone that dials its menu ("," waits 2 seconds, ";" waits for the caller to tap), and the
//   message filled in from the medicine (name, dose, how often), the person and the medicine's refill
//   details (date of birth, pharmacy, callback number; sealed with the medicine). Parent devices and the
//   person's own device; never a shared wall or another member's device (routes/medications.ts gate).
// - The to-do (POST /api/medications/{id}/refill-request): opens a "Request refill: <medicine> for
//   <person>" request on the medicine (sealed, at most one open per medicine) and a note in the bell (kind
//   'medication', sealed, shown to parents and that person's devices); "Done, requested" closes it. Kept
//   in the medicine rather than on a to-do list, because list items are plain text that every screen sees.
//   A medicine's refill.remindOn day opens one by itself (notify.ts runMedicationReminders).
// - Refill places from before (medication_refill_contacts, 0109, sealed) become contacts once
//   (convertRefillPlaces, from entry.ts and a data import). The table stays, empty, until a later migration drops it.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import type { KinwallDb } from '../db.ts';
import { requestKey } from '../auth.ts';
import { unseal, type EncryptionEnv } from '../crypto.ts';
import { ContactInputSchema, DialStepSchema, ErrorSchema } from '../schemas.ts';
import { recordNotification } from '../notify.ts';
import { contactFor, fromRow, inputOf, insert, update, type ContactRow } from './contacts.ts';
import { phoneKey } from '../vcard.ts';
import { dialToSteps, stepsToDial, stepsToWords, type DialStep } from '../dial-steps.ts';
import { RefillRequestSchema, PRIVATE, bumpRev, findMed, gate, loadMedications, openMedication, sealMedication, type Medication, type MedRow } from './medications.ts';

export const medicationRefillRoutes = createRouter();
type C = Context<{ Bindings: Env }>;

// A link the card opens: a website, or an app's own link (e.g. "myclinic://"), never one that runs code or reads files.
const safeLink = (s: string) => /^[a-z][a-z0-9+.-]*:/i.test(s) && !/^(javascript|data|vbscript|file|blob):/i.test(s);

export const DEFAULT_SCRIPT = [
  'Hi, this is a refill request for {name}, date of birth {dateOfBirth}.',
  'The medicine is {medicine}, {dose}, taken {howOften}.',
  'Please send it to {pharmacy}.',
  'You can call me back at {callback}.',
  'Thank you.',
].join('\n');

const RefillPhoneSchema = z.object({
  label: z.string(), number: z.string(),
  steps: z.string().openapi({ description: 'The phone menu in words: "Wait 4 seconds, then press 2 (Prescriptions)."; \'\' without one.' }),
  telUri: z.string().nullable().openapi({ description: 'tel: link that dials the menu after the number; not every phone waits at the pauses, so show the steps too.' }),
}).openapi('MedicationRefillPhone');
export const RefillCardSchema = z.object({
  medicationId: z.string(), memberId: z.string(),
  contact: z.object({
    id: z.string(), name: z.string(),
    phones: z.array(RefillPhoneSchema),
    websites: z.array(z.object({ label: z.string(), url: z.string() })).openapi({ description: "The contact's websites and app links." }),
  }).nullable().openapi({ description: 'Where to ask: the contact picked as refill.contactId, as this device may see it; null when none is picked (or this device can\'t see it).' }),
  pharmacy: z.object({
    name: z.string(), contactId: z.string().nullable().openapi({ description: 'The picked contact, when this device can see it; null: the typed name.' }),
    phone: z.string().nullable(), telUri: z.string().nullable(), address: z.string().nullable().openapi({ description: 'One line, for a map search.' }),
  }).nullable().openapi({ description: 'Where it goes: the picked pharmacy contact (its first phone and address), or the typed name; null when neither is set.' }),
  script: z.string().openapi({ description: 'The message filled in; a blank the family has not entered stays in [brackets].' }),
  request: RefillRequestSchema.nullable(),
}).openapi('MedicationRefillCard');

/** "tel:5550102233,,2,1": the number's digits (and a leading +), then the dial digits; # is escaped. */
export function telUri(phone: string, dialDigits: string): string | null {
  const n = phone.replace(/[^0-9+]/g, '').replace(/(?!^)\+/g, '');
  if (!/\d/.test(n)) return null;
  return `tel:${n}${dialDigits}`.replace(/#/g, '%23');
}

/** "twice a day", "once a day on weekdays", "3 times a day on Mon, Wed, Fri". */
export function howOften(m: Pick<Medication, 'times' | 'days'>): string {
  const n = m.times.length;
  const per = n === 1 ? 'once a day' : n === 2 ? 'twice a day' : `${n} times a day`;
  const d = [...m.days].sort().join();
  const days = d === '0,1,2,3,4,5,6' ? '' : d === '1,2,3,4,5' ? ' on weekdays' : d === '0,6' ? ' on weekends' : ` on ${m.days.map((i) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][i]).join(', ')}`;
  return per + days;
}
const spokenDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

/** The message with its blanks filled; one with nothing known stays as "[date of birth]" so it's said aloud. */
export function fillScript(m: Medication, memberName: string, pharmacy = m.refill.pharmacy, template = DEFAULT_SCRIPT): string {
  const v: Record<string, [string, string]> = {
    name: [memberName, 'name'],
    dateOfBirth: [m.refill.dateOfBirth ? spokenDate(m.refill.dateOfBirth) : '', 'date of birth'],
    medicine: [m.name, 'medicine'],
    dose: [m.dose, 'dose'],
    howOften: [howOften(m), 'how often'],
    pharmacy: [pharmacy, 'pharmacy'],
    callback: [m.refill.callback, 'callback number'],
  };
  return template.replace(/\{(\w+)\}/g, (all, k: string) => (v[k] ? v[k][0] || `[${v[k][1]}]` : all));
}

/** Open a refill request on a medicine unless one is open: written only if nobody changed the medicine
 *  in between (two taps at once make one). Records the bell note. 'open' when one was already open. */
export async function openRefillRequest(env: Env, id: string, by: string | null, o: { clearRemindOn?: boolean } = {}): Promise<Medication | 'open' | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await env.DB.prepare('SELECT * FROM medications WHERE id = ?').bind(id).first<MedRow>();
    if (!row) return null;
    const found = await openMedication(env, row);
    const now = new Date().toISOString();
    const refill = o.clearRemindOn ? { ...found.refill, remindOn: null } : found.refill;
    if (found.refillRequest) {
      // A reminder day while one is open: the day is used up, so marking it requested doesn't reopen it.
      if (o.clearRemindOn && found.refill.remindOn) await env.DB.prepare('UPDATE medications SET data = ?, updated_at = ? WHERE id = ? AND data = ?').bind(await sealMedication(env, { ...found, refill }), now, id, row.data).run();
      return 'open';
    }
    const m = { ...found, refill, refillRequest: { at: now, by }, updatedAt: now };
    const res = await env.DB.prepare('UPDATE medications SET data = ?, updated_at = ? WHERE id = ? AND data = ?').bind(await sealMedication(env, m), now, id, row.data).run();
    if (!res.meta.changes) continue;
    const member = await env.DB.prepare('SELECT name FROM members WHERE id = ?').bind(m.memberId).first<{ name: string }>();
    await recordNotification(env.DB, { kind: 'medication', title: `Request refill: ${m.name} for ${member?.name ?? 'someone'}`, url: `/#/medications/${m.memberId}`, memberIds: [m.memberId], source: 'system' }, env);
    return m;
  }
  return 'open';
}

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });
const err = (description: string) => ({ description, content: json(ErrorSchema) });
const denied = { 403: err('not from this device (parent devices, and the person\'s own device for the card and request), or a connected app without aiHealthAccess'), 404: err('medications are off, or not found') };
const TAG = ['Medications'];
export const RefillRequestResultSchema = z.object({ request: RefillRequestSchema.nullable(), created: z.boolean() }).openapi('MedicationRefillRequestResult');
const idParams = z.object({ id: z.string() });

/** The medicine for a card or request route, if this caller may see it. */
type Refused = { fail: { error: string }; status: 403 | 404 };
async function medFor(c: C, id: string): Promise<Refused | { m: Medication }> {
  const g = await gate(c);
  if (g.fail) return { fail: g.fail, status: g.status! };
  if (g.who.kind === 'wall') return { fail: PRIVATE, status: 403 as const };
  const m = await findMed(c, id);
  if (!m) return { fail: { error: 'not found' }, status: 404 as const };
  if (g.who.kind === 'own' && g.who.memberId !== m.memberId) return { fail: PRIVATE, status: 403 as const };
  return { m };
}

medicationRefillRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/medications/{id}/refill', tags: TAG, security: [{ Bearer: [] }],
    summary: "A medicine's refill card: where to ask (app, website, phone with the menu steps and a tel: link), what to say on the message (filled in), and its open request. Parent devices and the person's own device.",
    request: { params: idParams },
    responses: { 200: { description: 'ok', content: json(RefillCardSchema) }, ...denied },
  }),
  async (c) => {
    const r = await medFor(c, c.req.valid('param').id);
    if (!('m' in r)) return c.json(r.fail, r.status);
    const { m } = r;
    const where = m.refill.contactId ? await contactFor(c, m.refill.contactId) : null;
    const member = await c.env.DB.prepare('SELECT name FROM members WHERE id = ?').bind(m.memberId).first<{ name: string }>();
    const contact = where && {
      id: where.id, name: where.name,
      phones: where.phones.map((p) => ({ label: p.label, number: p.value, steps: stepsToWords(p.menu ?? []), telUri: telUri(p.value, stepsToDial(p.menu ?? [])) })),
      websites: where.websites.filter((w) => safeLink(w.value)).map((w) => ({ label: w.label, url: w.value })),
    };
    // A pharmacy contact this device can't see (a grown-ups-only one on a kid's device) falls back to the typed name.
    const pc = m.refill.pharmacyContactId ? await contactFor(c, m.refill.pharmacyContactId) : null;
    const phone = pc?.phones[0]?.value ?? null;
    const addr = pc?.addresses[0];
    const pharmacy = pc
      ? { name: pc.name, contactId: pc.id, phone, telUri: phone ? telUri(phone, '') : null, address: addr ? [addr.street, [addr.city, addr.region].filter(Boolean).join(', '), addr.postalCode].filter(Boolean).join(', ') || null : null }
      : m.refill.pharmacy ? { name: m.refill.pharmacy, contactId: null, phone: null, telUri: null, address: null } : null;
    return c.json({
      medicationId: m.id, memberId: m.memberId, contact,
      pharmacy,
      script: fillScript(m, member?.name ?? '', pharmacy?.name ?? ''),
      request: m.refillRequest,
    }, 200);
  },
);

medicationRefillRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/medications/{id}/refill-request', tags: TAG, security: [{ Bearer: [] }],
    summary: 'open: start a "Request refill" to-do for this medicine (one open at a time: asking again returns the open one, created false) with a note in the bell. done: it was requested, so close it. Parent devices and the person\'s own device.',
    request: { params: idParams, body: { content: json(z.object({ action: z.enum(['open', 'done']) }).openapi('MedicationRefillRequestInput')) } },
    responses: { 200: { description: 'already open, or closed', content: json(RefillRequestResultSchema) }, 201: { description: 'opened', content: json(RefillRequestResultSchema) }, ...denied },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const r = await medFor(c, id);
    if (!('m' in r)) return c.json(r.fail, r.status);
    if (c.req.valid('json').action === 'done') {
      if (r.m.refillRequest) {
        const now = new Date().toISOString();
        const m = { ...r.m, refillRequest: null, updatedAt: now };
        await c.env.DB.batch([c.env.DB.prepare('UPDATE medications SET data = ?, updated_at = ? WHERE id = ?').bind(await sealMedication(c.env, m), now, id), bumpRev(c.env.DB)]);
      }
      return c.json({ request: null, created: false }, 200);
    }
    const opened = await openRefillRequest(c.env, id, (await requestKey(c))?.name ?? null);
    if (opened && opened !== 'open') return c.json({ request: opened.refillRequest, created: true }, 201);
    const now = await findMed(c, id);
    return c.json({ request: now?.refillRequest ?? null, created: false }, 200);
  },
);

// ---- Refill places from before (0109) become contacts, once. ----
// Each sealed place: a contact with the same name gets its phone (with the phone menu, or the menu on
// that number when it had none) and its app link and website; with none, a new service contact
// (relationship Medical) holds them. Its medicines then point to that contact, and the place is deleted
// only once they all do. Run again after a crash, the same-name match means no second contact.
// The per-place message was dropped: every card uses DEFAULT_SCRIPT now.
// ponytail: delete this with the migration that drops medication_refill_contacts.
type PlaceRow = { id: string; data: string };
const PlaceMenu = z.array(DialStepSchema).max(20);
export async function convertRefillPlaces(env: EncryptionEnv & { DB: KinwallDb }): Promise<number> {
  const { results } = await env.DB.prepare('SELECT id, data FROM medication_refill_contacts ORDER BY created_at, id').all<PlaceRow>();
  if (!results.length) return 0;
  const meds = await loadMedications(env);
  for (const r of results) {
    const d = JSON.parse(await unseal(env, r.data, `${r.id}:refill`)) as { name: string; appName?: string; appLink?: string; website?: string; phone?: string; menu?: DialStep[]; dialDigits?: string };
    const parsedMenu = PlaceMenu.safeParse(d.menu ?? dialToSteps(d.dialDigits ?? ''));
    const menu = parsedMenu.success ? parsedMenu.data : []; // a place saved before steps, with a pause too long for a step: no menu
    const phone = d.phone?.trim() ?? '';
    const links = [d.appLink?.trim() && { label: (d.appName?.trim() || 'App').slice(0, 50), value: d.appLink.trim() }, d.website?.trim() && { label: 'Website', value: d.website.trim() }].filter((x): x is { label: string; value: string } => !!x);
    const same = await env.DB.prepare('SELECT * FROM contacts WHERE name = ? COLLATE NOCASE ORDER BY created_at, id LIMIT 1').bind(d.name.trim()).first<ContactRow>();
    let id: string;
    if (same) {
      const c = inputOf(fromRow(same));
      const at = phone ? c.phones.findIndex((p) => phoneKey(p.value) === phoneKey(phone)) : -1;
      const phones = !phone ? c.phones
        : at < 0 ? [...c.phones, { label: 'Refills', value: phone, primary: false, emergency: false, wallVisible: false, ...(menu.length ? { menu } : {}) }]
        : c.phones.map((p, i) => (i === at && !p.menu?.length && menu.length ? { ...p, menu } : p));
      const websites = [...c.websites, ...links.filter((l) => !c.websites.some((w) => w.value === l.value)).map((l) => ({ ...l, primary: false, emergency: false, wallVisible: false }))];
      await update(env.DB, same.id, ContactInputSchema.parse({ ...c, phones, websites }));
      id = same.id;
    } else {
      id = (await insert(env.DB, ContactInputSchema.parse({ kind: 'service', name: d.name.trim(), relationship: 'Medical', phones: phone ? [{ label: 'Office', value: phone, ...(menu.length ? { menu } : {}) }] : [], websites: links }))).id;
    }
    for (const m of meds.filter((x) => x.refill.contactId === r.id)) {
      const row = await env.DB.prepare('SELECT * FROM medications WHERE id = ?').bind(m.id).first<MedRow>();
      if (!row) continue;
      const now = await openMedication(env, row);
      const res = await env.DB.prepare('UPDATE medications SET data = ? WHERE id = ? AND data = ?').bind(await sealMedication(env, { ...now, refill: { ...now.refill, contactId: id } }), m.id, row.data).run();
      if (!res.meta.changes) throw new Error('medicine changed meanwhile'); // the next run tries again
    }
    await env.DB.prepare('DELETE FROM medication_refill_contacts WHERE id = ?').bind(r.id).run();
  }
  await bumpRev(env.DB).run();
  return results.length;
}
