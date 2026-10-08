// Medicine refills: where and how a family asks for one, and a "Request refill" to-do per medicine.
//
// - Refill places (medication_refill_contacts, 0109): a doctor's office or pharmacy with any of an app,
//   a website and a phone number, the phone-menu steps in words, dial digits for that menu ("," waits
//   2 seconds, ";" waits for the caller to tap), and what to say on the message (a script with blanks).
//   Several medicines can point to one place (medications.data refill.contactId). Sealed: one JSON,
//   aad '<id>:refill'. Parent devices only list, add, change and delete them.
// - The refill card (GET /api/medications/{id}/refill): the place, a tel: link with the dial digits, and
//   the script filled in from the medicine (name, dose, how often), the person and the medicine's refill
//   details (date of birth, pharmacy, callback number; sealed with the medicine). Parent devices and the
//   person's own device; never a shared wall or another member's device (routes/medications.ts gate).
// - The to-do (POST /api/medications/{id}/refill-request): opens a "Request refill: <medicine> for
//   <person>" request on the medicine (sealed, at most one open per medicine) and a note in the bell (kind
//   'medication', sealed, shown to parents and that person's devices); "Done, requested" closes it. Kept
//   in the medicine rather than on a to-do list, because list items are plain text that every screen sees.
//   A medicine's refill.remindOn day opens one by itself (notify.ts runMedicationReminders).
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import type { KinwallDb } from '../db.ts';
import { requestKey } from '../auth.ts';
import { seal, unseal, type EncryptionEnv } from '../crypto.ts';
import { ErrorSchema } from '../schemas.ts';
import { recordNotification } from '../notify.ts';
import { contactFor } from './contacts.ts';
import { dialToSteps, stepsToDial, stepsToWords, type DialStep } from '../dial-steps.ts';
import { RefillRequestSchema, PARENTS, PRIVATE, bumpRev, findMed, gate, openMedication, sealMedication, type Medication, type MedRow } from './medications.ts';

export const medicationRefillRoutes = createRouter();
type C = Context<{ Bindings: Env }>;

// Dial digits after the number: digits, + * #, "," (a 2-second pause) and ";" (wait for the caller).
export const DIAL_RE = /^[0-9+,;*#]*$/;
const PHONE_RE = /^[0-9+()\-.\s]*$/;
// An app link may be an app's own scheme (e.g. "myclinic://"), never one that runs code or reads files.
const safeLink = (s: string) => s === '' || (/^[a-z][a-z0-9+.-]*:/i.test(s) && !/^(javascript|data|vbscript|file|blob):/i.test(s));

export const DEFAULT_SCRIPT = [
  'Hi, this is a refill request for {name}, date of birth {dateOfBirth}.',
  'The medicine is {medicine}, {dose}, taken {howOften}.',
  'Please send it to {pharmacy}.',
  'You can call me back at {callback}.',
  'Thank you.',
].join('\n');

const Label = z.string().trim().max(40).optional();
export const DialStepSchema = z.union([
  z.object({ kind: z.literal('wait'), seconds: z.number().int().min(1).max(60), label: Label }).strict(),
  z.object({ kind: z.literal('press'), digits: z.string().regex(/^[0-9*#]{1,20}$/, 'press: digits, * and # only'), label: Label }).strict(),
  z.object({ kind: z.literal('confirm'), label: Label }).strict(),
]).openapi('MedicationRefillDialStep');
const ContactFields = {
  name: z.string().trim().min(1).max(80).openapi({ description: 'The office or pharmacy, e.g. "Maple Street Pediatrics".' }),
  appName: z.string().trim().max(60).openapi({ description: 'The app to ask through, by name.' }),
  appLink: z.string().trim().max(500).refine(safeLink, 'appLink: a link').openapi({ description: "A link that opens the app or its refill page (https:// or the app's own link)." }),
  website: z.string().trim().max(500).refine((s) => s === '' || /^https?:\/\//i.test(s), 'website: an http(s) link').openapi({ description: 'A website to ask on.' }),
  phone: z.string().trim().max(30).regex(PHONE_RE, 'phone: a phone number').openapi({ description: 'The number to call, as written, e.g. "(555) 010-2233".' }),
  menu: z.array(DialStepSchema).max(20).openapi({ description: 'The phone menu, step by step: wait some seconds, press keys, or wait until the caller is ready. Each step may have a short label ("Prescriptions").' }),
  script: z.string().trim().max(1000).openapi({ description: "What to say on the message; '' uses the default. Blanks: {name} {dateOfBirth} {medicine} {dose} {howOften} {pharmacy} {callback}." }),
};
export const RefillContactSchema = z.object({
  id: z.string(), ...ContactFields,
  phoneSteps: z.string().openapi({ description: 'The menu in words, from menu: "Wait 4 seconds, then press 2 (Prescriptions)."' }),
  dialDigits: z.string().openapi({ description: 'Dialed after the number, from menu: "," waits 2 seconds, ";" waits until the caller taps.' }),
  createdAt: z.string(), updatedAt: z.string() }).openapi('MedicationRefillContact');
const ContactInputSchema = z.object({
  name: ContactFields.name, appName: ContactFields.appName.default(''), appLink: ContactFields.appLink.default(''), website: ContactFields.website.default(''),
  phone: ContactFields.phone.default(''), menu: ContactFields.menu.default([]), script: ContactFields.script.default(''),
}).openapi('MedicationRefillContactInput');
const ContactPatchSchema = z.object(ContactFields).partial().openapi('MedicationRefillContactPatch');
export type RefillContact = z.infer<typeof RefillContactSchema>;
type ContactRow = { id: string; data: string; created_at: string; updated_at: string };

export const RefillCardSchema = z.object({
  medicationId: z.string(), memberId: z.string(),
  contact: RefillContactSchema.nullable(),
  call: z.object({ number: z.string(), steps: z.string(), telUri: z.string().openapi({ description: 'tel: link with the dial digits; not every phone waits at the pauses, so show the steps too.' }) }).nullable(),
  pharmacy: z.object({
    name: z.string(), contactId: z.string().nullable().openapi({ description: 'The picked contact, when this device can see it; null: the typed name.' }),
    phone: z.string().nullable(), telUri: z.string().nullable(), address: z.string().nullable().openapi({ description: 'One line, for a map search.' }),
  }).nullable().openapi({ description: 'Where it goes: the picked pharmacy contact (its first phone and address), or the typed name; null when neither is set.' }),
  script: z.string().openapi({ description: 'The message filled in; a blank the family has not entered stays in [brackets].' }),
  request: RefillRequestSchema.nullable(),
}).openapi('MedicationRefillCard');

const aad = (id: string) => `${id}:refill`;
export const sealContact = (env: EncryptionEnv, c: Omit<RefillContact, 'phoneSteps' | 'dialDigits'>) => {
  const { id: _i, createdAt: _c, updatedAt: _u, phoneSteps: _p, dialDigits: _d, ...data } = c as RefillContact;
  return seal(env, JSON.stringify(data), aad(c.id));
};
/** With its dial string and written steps, both from the menu. */
export function withMenu<T extends { menu: DialStep[] }>(c: T): T & { phoneSteps: string; dialDigits: string } {
  const dialDigits = stepsToDial(c.menu);
  if (!DIAL_RE.test(dialDigits)) throw new Error('bad dial string'); // the steps' schema rules this out
  return { ...c, phoneSteps: stepsToWords(c.menu), dialDigits };
}
export async function openContact(env: EncryptionEnv, r: ContactRow): Promise<RefillContact> {
  const d = JSON.parse(await unseal(env, r.data, aad(r.id)));
  // A place saved with a raw dial string (before steps): its steps from that string.
  const menu: DialStep[] = d.menu ?? dialToSteps(d.dialDigits ?? '');
  return withMenu({ id: r.id, name: d.name, appName: d.appName ?? '', appLink: d.appLink ?? '', website: d.website ?? '', phone: d.phone ?? '', menu, script: d.script ?? '', createdAt: r.created_at, updatedAt: r.updated_at });
}
export async function loadContacts(env: EncryptionEnv & { DB: KinwallDb }): Promise<RefillContact[]> {
  const { results } = await env.DB.prepare('SELECT * FROM medication_refill_contacts ORDER BY created_at, id').all<ContactRow>();
  return Promise.all(results.map((r) => openContact(env, r)));
}
export async function writeContact(env: EncryptionEnv & { DB: KinwallDb }, c: Omit<RefillContact, 'phoneSteps' | 'dialDigits'>) {
  const data = await sealContact(env, c); // throws without a key, before anything is written
  await env.DB.batch([
    env.DB.prepare('INSERT INTO medication_refill_contacts (id, data, created_at, updated_at) VALUES (?,?,?,?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at').bind(c.id, data, c.createdAt, c.updatedAt),
    bumpRev(env.DB),
  ]);
}

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
export function fillScript(template: string, m: Medication, memberName: string, pharmacy = m.refill.pharmacy): string {
  const v: Record<string, [string, string]> = {
    name: [memberName, 'name'],
    dateOfBirth: [m.refill.dateOfBirth ? spokenDate(m.refill.dateOfBirth) : '', 'date of birth'],
    medicine: [m.name, 'medicine'],
    dose: [m.dose, 'dose'],
    howOften: [howOften(m), 'how often'],
    pharmacy: [pharmacy, 'pharmacy'],
    callback: [m.refill.callback, 'callback number'],
  };
  return (template.trim() || DEFAULT_SCRIPT).replace(/\{(\w+)\}/g, (all, k: string) => (v[k] ? v[k][0] || `[${v[k][1]}]` : all));
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

/** The gate for a parent-only route: a parent device, or what to answer. */
async function parentGate(c: C) {
  const g = await gate(c);
  if (g.fail) return { fail: g.fail, status: g.status };
  if (g.who.kind !== 'parent') return { fail: PARENTS, status: 403 as const };
  return g;
}
medicationRefillRoutes.openapi(
  createRoute({
    method: 'get', path: '/api/medication-refill-contacts', tags: TAG, security: [{ Bearer: [] }],
    summary: 'Refill places: where the family asks for medicine refills (parent devices only).',
    responses: { 200: { description: 'ok', content: json(z.array(RefillContactSchema)) }, ...denied },
  }),
  async (c) => {
    const g = await parentGate(c);
    if ('fail' in g) return c.json(g.fail, g.status);
    return c.json(await loadContacts(c.env), 200);
  },
);

medicationRefillRoutes.openapi(
  createRoute({
    method: 'post', path: '/api/medication-refill-contacts', tags: TAG, security: [{ Bearer: [] }],
    summary: 'Add a refill place (parent devices only).',
    request: { body: { content: json(ContactInputSchema) } },
    responses: { 201: { description: 'added', content: json(RefillContactSchema) }, 400: err('bad input'), ...denied },
  }),
  async (c) => {
    const g = await parentGate(c);
    if ('fail' in g) return c.json(g.fail, g.status);
    const now = new Date().toISOString();
    const contact = withMenu({ id: crypto.randomUUID(), ...c.req.valid('json'), createdAt: now, updatedAt: now });
    await writeContact(c.env, contact);
    return c.json(contact, 201);
  },
);

medicationRefillRoutes.openapi(
  createRoute({
    method: 'patch', path: '/api/medication-refill-contacts/{id}', tags: TAG, security: [{ Bearer: [] }],
    summary: 'Change a refill place (only the fields sent; parent devices only). Every medicine pointing to it follows.',
    request: { params: idParams, body: { content: json(ContactPatchSchema) } },
    responses: { 200: { description: 'saved', content: json(RefillContactSchema) }, 400: err('bad input'), ...denied },
  }),
  async (c) => {
    const g = await parentGate(c);
    if ('fail' in g) return c.json(g.fail, g.status);
    const row = await c.env.DB.prepare('SELECT * FROM medication_refill_contacts WHERE id = ?').bind(c.req.valid('param').id).first<ContactRow>();
    if (!row) return c.json({ error: 'not found' }, 404);
    const patch = Object.fromEntries(Object.entries(c.req.valid('json')).filter(([, v]) => v !== undefined));
    const contact = withMenu({ ...(await openContact(c.env, row)), ...patch, updatedAt: new Date().toISOString() });
    await writeContact(c.env, contact);
    return c.json(contact, 200);
  },
);

medicationRefillRoutes.openapi(
  createRoute({
    method: 'delete', path: '/api/medication-refill-contacts/{id}', tags: TAG, security: [{ Bearer: [] }],
    summary: 'Delete a refill place (parent devices only). Medicines that pointed to it keep their other refill details.',
    request: { params: idParams },
    responses: { 204: { description: 'deleted' }, ...denied },
  }),
  async (c) => {
    const g = await parentGate(c);
    if ('fail' in g) return c.json(g.fail, g.status);
    const res = await c.env.DB.prepare('DELETE FROM medication_refill_contacts WHERE id = ?').bind(c.req.valid('param').id).run();
    if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
    await bumpRev(c.env.DB).run();
    return c.body(null, 204);
  },
);

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
    const row = m.refill.contactId ? await c.env.DB.prepare('SELECT * FROM medication_refill_contacts WHERE id = ?').bind(m.refill.contactId).first<ContactRow>() : null;
    const contact = row ? await openContact(c.env, row) : null;
    const member = await c.env.DB.prepare('SELECT name FROM members WHERE id = ?').bind(m.memberId).first<{ name: string }>();
    const tel = contact ? telUri(contact.phone, contact.dialDigits) : null;
    // A pharmacy contact this device can't see (a grown-ups-only one on a kid's device) falls back to the typed name.
    const pc = m.refill.pharmacyContactId ? await contactFor(c, m.refill.pharmacyContactId) : null;
    const phone = pc?.phones[0]?.value ?? null;
    const addr = pc?.addresses[0];
    const pharmacy = pc
      ? { name: pc.name, contactId: pc.id, phone, telUri: phone ? telUri(phone, '') : null, address: addr ? [addr.street, [addr.city, addr.region].filter(Boolean).join(', '), addr.postalCode].filter(Boolean).join(', ') || null : null }
      : m.refill.pharmacy ? { name: m.refill.pharmacy, contactId: null, phone: null, telUri: null, address: null } : null;
    return c.json({
      medicationId: m.id, memberId: m.memberId, contact,
      call: contact && tel ? { number: contact.phone, steps: contact.phoneSteps, telUri: tel } : null,
      pharmacy,
      script: fillScript(contact?.script ?? '', m, member?.name ?? '', pharmacy?.name ?? ''),
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
