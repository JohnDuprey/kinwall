import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import type { KinwallDb } from '../db.ts';
import { requestKey } from '../auth.ts';
import { emit } from '../bus.ts';
import { ContactCategoryInputSchema, ContactCategorySchema, ContactInputSchema, ContactPrivateFieldSchema, ContactPatchSchema, ContactSchema, ErrorSchema } from '../schemas.ts';
import { duplicateScore, mergeContacts, parseVCards, type ContactInput } from '../contacts-domain.ts';

export const contactsRoutes = createRouter();
const tag = ['Contacts'];
const security = [{ Bearer: [] }];
const idParam = z.object({ id: z.string().uuid() });
const okSchema = z.object({ ok: z.boolean() });
const queryBoolean = z.enum(['true', 'false']).transform((value) => value === 'true').optional();
const jsonBody = <T extends z.ZodType>(schema: T) => ({ content: { 'application/json': { schema } } });
const answer = (schema: typeof ContactSchema | typeof ContactCategorySchema | typeof okSchema, description = 'ok') => ({ description, content: { 'application/json': { schema } } });
const error = (description: string) => ({ description, content: { 'application/json': { schema: ErrorSchema } } });
// One event per change; the action says what happened.
function contactEvent(c: Context<{ Bindings: Env }>, action: 'created' | 'updated' | 'deleted' | 'imported' | 'merged', id: string) {
  emit(c, 'contact.changed', { id, action });
}
function categoryEvent(c: Context<{ Bindings: Env }>, id: string) { emit(c, 'contact.category.changed', { id }); }

export type ContactRow = { id: string; kind: 'person' | 'service' | 'organization' | 'place'; name: string; organization: string | null; title: string | null; given_name: string | null; family_name: string | null; nickname: string | null; relationship: string | null; favorite: number; emergency: number; phones: string; emails: string; addresses: string; websites: string; dates: string; notes: string | null; category_ids: string; tags: string; member_ids: string; service_hours: string | null; service_area: string | null; always_open: number; wall_visible: number; emergency_visible: number; phone_visible_on_wall: number; address_visible_on_wall: number; visibility: 'household' | 'adults' | 'selected_members' | 'private'; selected_member_ids: string; source_metadata: string | null; private_fields: string; created_at: string; updated_at: string };
type CategoryRow = { id: string; name: string; color: string | null; sort: number; created_at: string; updated_at: string };
const categoryApi = (r: CategoryRow) => ({ id: r.id, name: r.name, color: r.color, sort: r.sort, createdAt: r.created_at, updatedAt: r.updated_at });
const builtInCategory = (id: string) => /^00000000-0000-4000-8000-0000000000(?:0[1-9]|1[0-3])$/.test(id);

export function fromRow(r: ContactRow): ContactInput & { id: string; createdAt: string; updatedAt: string } {
  const parse = <T>(raw: string | null, fallback: T): T => { try { return raw ? JSON.parse(raw) as T : fallback; } catch { return fallback; } };
  return { id: r.id, kind: r.kind, name: r.name, organization: r.organization, relationship: r.relationship, title: r.title, givenName: r.given_name, familyName: r.family_name, nickname: r.nickname,
    phones: parse(r.phones, []), emails: parse(r.emails, []), addresses: parse(r.addresses, []), websites: parse(r.websites, []), dates: parse(r.dates, []), notes: r.notes,
    categoryIds: parse(r.category_ids, []), tags: parse(r.tags, []), memberIds: parse(r.member_ids, []), serviceHours: r.service_hours, serviceArea: r.service_area,
    alwaysOpen: !!r.always_open, favorite: !!r.favorite, emergency: !!r.emergency,
    wallVisible: !!r.wall_visible, emergencyVisible: !!r.emergency_visible, phoneVisibleOnWall: !!r.phone_visible_on_wall, addressVisibleOnWall: !!r.address_visible_on_wall,
    visibility: r.visibility, selectedMemberIds: parse(r.selected_member_ids, []), sourceMetadata: parse(r.source_metadata, null), privateFields: parse(r.private_fields, []), createdAt: r.created_at, updatedAt: r.updated_at };
}

type Contact = ReturnType<typeof fromRow>;
// Who is asking decides what they see. Admin keys (parents' devices, connected apps with full
// access) see everything. A shared wall screen, or a legacy display with no owner, sees household
// contacts marked for the wall. A member's own device sees household contacts, adults contacts
// when that member is a grown-up, and contacts shared with them by name.
type Viewer = { kind: 'admin' } | { kind: 'wall' } | { kind: 'member'; id: string; grownUp: boolean };
async function viewer(c: Context<{ Bindings: Env }>): Promise<Viewer> {
  const key = await requestKey(c);
  if (key?.scope === 'admin') return { kind: 'admin' };
  if (!key?.owner || key.owner === 'shared') return { kind: 'wall' };
  const member = await c.env.DB.prepare('SELECT grown_up FROM members WHERE id = ?').bind(key.owner).first<{ grown_up: number }>();
  return { kind: 'member', id: key.owner, grownUp: !!member?.grown_up };
}
function canSee(contact: Contact, v: Viewer): boolean {
  if (v.kind === 'admin') return true;
  if (v.kind === 'wall') return contact.wallVisible && contact.visibility === 'household';
  return contact.visibility === 'household' || (contact.visibility === 'adults' && v.grownUp)
    || (contact.visibility === 'selected_members' && contact.selectedMemberIds.includes(v.id));
}
function forViewer(contact: Contact, v: Viewer): Contact {
  if (v.kind === 'admin') return contact;
  const hidden = (field: z.infer<typeof ContactPrivateFieldSchema>) => contact.privateFields.includes(field);
  // Device keys never get notes, where the contact came from, or who else it's shared with.
  const device = { ...contact, notes: null, sourceMetadata: null, selectedMemberIds: [], privateFields: [] };
  if (v.kind === 'member') {
    return { ...device,
      organization: hidden('organization') ? null : contact.organization, relationship: hidden('relationship') ? null : contact.relationship, title: hidden('title') ? null : contact.title,
      phones: hidden('phones') ? [] : contact.phones, emails: hidden('emails') ? [] : contact.emails, addresses: hidden('addresses') ? [] : contact.addresses,
      websites: hidden('websites') ? [] : contact.websites, dates: hidden('dates') ? [] : contact.dates, tags: hidden('tags') ? [] : contact.tags, memberIds: hidden('members') ? [] : contact.memberIds };
  }
  // A wall shows the name, organization and emergency flag, plus the phones and address it's allowed to.
  // Every other field is blanked here: a new field needs a line, or it shows on the wall.
  return { ...device,
    givenName: null, familyName: null, nickname: null, relationship: null, title: null,
    organization: hidden('organization') ? null : contact.organization,
    phones: contact.phoneVisibleOnWall && !hidden('phones') ? contact.phones.filter((p) => p.wallVisible) : [],
    emails: [], websites: [], dates: [], tags: [], memberIds: [],
    addresses: contact.addressVisibleOnWall && !hidden('addresses') ? contact.addresses : [],
    emergency: contact.emergencyVisible && contact.emergency,
    serviceArea: null,
  };
}

async function load(db: KinwallDb, id: string) { return db.prepare('SELECT * FROM contacts WHERE id = ?').bind(id).first<ContactRow>(); }
async function all(db: KinwallDb) { return (await db.prepare('SELECT * FROM contacts ORDER BY name COLLATE NOCASE, id').all<ContactRow>()).results; }
async function validateCategories(db: KinwallDb, ids: string[]): Promise<boolean> {
  if (new Set(ids).size !== ids.length) return false;
  if (!ids.length) return true;
  const rows = await db.prepare(`SELECT id FROM contact_categories WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string }>();
  return rows.results.length === ids.length;
}
async function validateReferences(db: KinwallDb, contact: ContactInput): Promise<boolean> {
  if (!(await validateCategories(db, contact.categoryIds))) return false;
  const ids = [...new Set([...contact.memberIds, ...contact.selectedMemberIds])];
  if (contact.visibility === 'selected_members' && !contact.selectedMemberIds.length) return false;
  if (!ids.length) return true;
  const rows = await db.prepare(`SELECT id FROM members WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: string }>();
  return rows.results.length === ids.length;
}
function values(c: ContactInput) { return [c.kind, c.name, c.organization ?? null, c.title ?? null, c.givenName ?? null, c.familyName ?? null, c.nickname ?? null, c.relationship ?? null, c.favorite ? 1 : 0, c.emergency ? 1 : 0, JSON.stringify(c.phones), JSON.stringify(c.emails), JSON.stringify(c.addresses), JSON.stringify(c.websites), JSON.stringify(c.dates), c.notes ?? null, JSON.stringify(c.categoryIds), JSON.stringify(c.tags), JSON.stringify(c.memberIds), c.serviceHours ?? null, c.serviceArea ?? null, c.alwaysOpen ? 1 : 0, c.wallVisible ? 1 : 0, c.emergencyVisible ? 1 : 0, c.phoneVisibleOnWall ? 1 : 0, c.addressVisibleOnWall ? 1 : 0, c.visibility ?? 'household', JSON.stringify(c.selectedMemberIds), c.sourceMetadata ? JSON.stringify(c.sourceMetadata) : null, JSON.stringify(c.privateFields)]; }
function normalizeInput(c: ContactInput): ContactInput {
  const phones = c.phones.map((p) => {
    const originalValue = p.originalValue ?? p.value;
    const digits = originalValue.replace(/[^\d+]/g, '').replace(/^00/, '+');
    const normalizedValue = /^\+?[0-9]{7,15}$/.test(digits) ? digits : null;
    return { ...p, value: originalValue, originalValue, normalizedValue };
  });
  return { ...c, phones };
}
async function insert(db: KinwallDb, input: ContactInput) {
  input = normalizeInput(input);
  const id = crypto.randomUUID(), now = new Date().toISOString();
  await db.prepare('INSERT INTO contacts (id,kind,name,organization,title,given_name,family_name,nickname,relationship,favorite,emergency,phones,emails,addresses,websites,dates,notes,category_ids,tags,member_ids,service_hours,service_area,always_open,wall_visible,emergency_visible,phone_visible_on_wall,address_visible_on_wall,visibility,selected_member_ids,source_metadata,private_fields,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id, ...values(input), now, now).run();
  return fromRow((await load(db, id))!);
}
async function update(db: KinwallDb, id: string, input: ContactInput) {
  input = normalizeInput(input);
  await db.prepare('UPDATE contacts SET kind=?,name=?,organization=?,title=?,given_name=?,family_name=?,nickname=?,relationship=?,favorite=?,emergency=?,phones=?,emails=?,addresses=?,websites=?,dates=?,notes=?,category_ids=?,tags=?,member_ids=?,service_hours=?,service_area=?,always_open=?,wall_visible=?,emergency_visible=?,phone_visible_on_wall=?,address_visible_on_wall=?,visibility=?,selected_member_ids=?,source_metadata=?,private_fields=?,updated_at=? WHERE id=?').bind(...values(input), new Date().toISOString(), id).run();
  return fromRow((await load(db, id))!);
}
function inputOf(c: ReturnType<typeof fromRow>): ContactInput { const { id: _id, createdAt: _created, updatedAt: _updated, ...input } = c; return input; }

contactsRoutes.openapi(createRoute({ method: 'get', path: '/api/contact-categories', tags: tag, security, summary: 'List contact categories', responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(ContactCategorySchema) } } } } }), async (c) => {
  const rows = await c.env.DB.prepare('SELECT * FROM contact_categories ORDER BY sort, name COLLATE NOCASE').all<CategoryRow>();
  return c.json(rows.results.map(categoryApi), 200);
});

contactsRoutes.openapi(createRoute({ method: 'post', path: '/api/contact-categories', tags: tag, security, summary: 'Create a contact category (admin)', request: { body: jsonBody(ContactCategoryInputSchema) }, responses: { 201: answer(ContactCategorySchema, 'created'), 409: error('name already exists') } }), async (c) => {
  const body = c.req.valid('json');
  const conflict = await c.env.DB.prepare('SELECT id FROM contact_categories WHERE name = ? COLLATE NOCASE').bind(body.name).first();
  if (conflict) return c.json({ error: 'category name already exists' }, 409);
  const now = new Date().toISOString();
  const row: CategoryRow = { id: crypto.randomUUID(), name: body.name, color: body.color ?? null, sort: body.sort ?? 0, created_at: now, updated_at: now };
  await c.env.DB.prepare('INSERT INTO contact_categories (id,name,color,sort,created_at,updated_at) VALUES (?,?,?,?,?,?)').bind(row.id, row.name, row.color, row.sort, now, now).run();
  categoryEvent(c, row.id);
  return c.json(categoryApi(row), 201);
});

contactsRoutes.openapi(createRoute({ method: 'patch', path: '/api/contact-categories/{id}', tags: tag, security, summary: 'Edit a contact category (admin)', request: { params: idParam, body: jsonBody(ContactCategoryInputSchema.partial()) }, responses: { 200: answer(ContactCategorySchema), 403: error('built-in category'), 404: error('not found'), 409: error('name already exists') } }), async (c) => {
  const { id } = c.req.valid('param'), body = c.req.valid('json');
  const row = await c.env.DB.prepare('SELECT * FROM contact_categories WHERE id = ?').bind(id).first<CategoryRow>();
  if (!row) return c.json({ error: 'not found' }, 404);
  if (builtInCategory(id)) return c.json({ error: 'built-in categories cannot be changed' }, 403);
  const updated = { ...row, name: body.name ?? row.name, color: body.color === undefined ? row.color : body.color, sort: body.sort ?? row.sort, updated_at: new Date().toISOString() };
  const conflict = await c.env.DB.prepare('SELECT id FROM contact_categories WHERE name = ? COLLATE NOCASE AND id != ?').bind(updated.name, id).first();
  if (conflict) return c.json({ error: 'category name already exists' }, 409);
  await c.env.DB.prepare('UPDATE contact_categories SET name=?,color=?,sort=?,updated_at=? WHERE id=?').bind(updated.name, updated.color, updated.sort, updated.updated_at, id).run();
  categoryEvent(c, id);
  return c.json(categoryApi(updated), 200);
});

contactsRoutes.openapi(createRoute({ method: 'delete', path: '/api/contact-categories/{id}', tags: tag, security, summary: 'Delete a contact category (admin)', request: { params: idParam }, responses: { 200: answer(okSchema), 403: error('built-in category'), 404: error('not found') } }), async (c) => {
  const { id } = c.req.valid('param');
  const category = await c.env.DB.prepare('SELECT id FROM contact_categories WHERE id = ?').bind(id).first();
  if (!category) return c.json({ error: 'not found' }, 404);
  if (builtInCategory(id)) return c.json({ error: 'built-in categories cannot be deleted' }, 403);
  const affected = (await all(c.env.DB)).filter((r) => (JSON.parse(r.category_ids) as string[]).includes(id));
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM contact_categories WHERE id = ?').bind(id), ...affected.map((r) => c.env.DB.prepare('UPDATE contacts SET category_ids=?,updated_at=? WHERE id=?').bind(JSON.stringify((JSON.parse(r.category_ids) as string[]).filter((x) => x !== id)), new Date().toISOString(), r.id))]);
  categoryEvent(c, id);
  return c.json({ ok: true }, 200);
});

contactsRoutes.openapi(createRoute({ method: 'get', path: '/api/contacts', tags: tag, security, summary: 'List contacts with privacy-aware filters', request: { query: z.object({ search: z.string().optional(), kind: z.enum(['person', 'service', 'organization', 'place']).optional(), category: z.string().uuid().optional(), favorite: queryBoolean, emergency: queryBoolean, emergencyVisible: queryBoolean, wallVisible: queryBoolean, memberId: z.string().optional(), visibility: z.enum(['household', 'adults', 'selected_members', 'private']).optional() }) }, responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(ContactSchema) } } } } }), async (c) => {
  const query = c.req.valid('query');
  const q = query.search;
  const categoryId = query.category;
  const v = await viewer(c);
  const rows = (await all(c.env.DB)).map(fromRow);
  return c.json(rows.filter((c) => {
    const allowed = canSee(c, v);
    const haystack = [c.name, c.givenName, c.familyName, c.nickname, c.organization, c.relationship, c.title, ...c.tags, ...c.categoryIds].filter(Boolean).join(' ').toLocaleLowerCase();
    return allowed && (!query.visibility || c.visibility === query.visibility) && (!query.kind || c.kind === query.kind) && (!q || haystack.includes(q.toLocaleLowerCase())) && (!categoryId || c.categoryIds.includes(categoryId)) && (query.favorite === undefined || c.favorite === query.favorite) && (query.emergency === undefined || c.emergency === query.emergency) && (query.emergencyVisible === undefined || c.emergencyVisible === query.emergencyVisible) && (query.wallVisible === undefined || c.wallVisible === query.wallVisible) && (!query.memberId || c.memberIds.includes(query.memberId));
  }).map((c) => forViewer(c, v)), 200);
});

contactsRoutes.openapi(createRoute({ method: 'get', path: '/api/contacts/{id}', tags: tag, security, summary: 'Get a contact', request: { params: idParam }, responses: { 200: answer(ContactSchema), 404: error('not found') } }), async (c) => {
  const row = await load(c.env.DB, c.req.valid('param').id), v = await viewer(c);
  const contact = row && fromRow(row);
  if (!contact || !canSee(contact, v)) return c.json({ error: 'not found' }, 404);
  return c.json(forViewer(contact, v), 200);
});

contactsRoutes.openapi(createRoute({ method: 'post', path: '/api/contacts', tags: tag, security, summary: 'Create a contact (admin)', request: { body: jsonBody(ContactInputSchema) }, responses: { 201: answer(ContactSchema, 'created'), 400: error('invalid category') } }), async (c) => {
  const body = c.req.valid('json');
  if (!(await validateReferences(c.env.DB, body))) return c.json({ error: 'invalid category or member ids' }, 400);
  const result = await insert(c.env.DB, body);
  contactEvent(c, 'created', result.id);
  return c.json(result, 201);
});

contactsRoutes.openapi(createRoute({ method: 'patch', path: '/api/contacts/{id}', tags: tag, security, summary: 'Edit a contact (admin)', request: { params: idParam, body: jsonBody(ContactPatchSchema) }, responses: { 200: answer(ContactSchema), 400: error('invalid category'), 404: error('not found') } }), async (c) => {
  const { id } = c.req.valid('param'), row = await load(c.env.DB, c.req.valid('param').id);
  if (!row) return c.json({ error: 'not found' }, 404);
  const patch = c.req.valid('json');
  const body = { ...inputOf(fromRow(row)), ...patch };
  if (!(await validateReferences(c.env.DB, body))) return c.json({ error: 'invalid category or member ids' }, 400);
  const result = await update(c.env.DB, id, body);
  contactEvent(c, 'updated', id);
  return c.json(result, 200);
});

contactsRoutes.openapi(createRoute({ method: 'delete', path: '/api/contacts/{id}', tags: tag, security, summary: 'Delete a contact (admin)', request: { params: idParam }, responses: { 200: answer(okSchema), 404: error('not found') } }), async (c) => {
  const { id } = c.req.valid('param');
  const result = await c.env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(id).run();
  if (!result.meta.changes) return c.json({ error: 'not found' }, 404);
  contactEvent(c, 'deleted', id);
  return c.json({ ok: true }, 200);
});

const ImportSchema = z.object({ vcard: z.string().min(1).max(2_000_000).optional(), contacts: z.array(ContactInputSchema).max(1000).optional(), strategy: z.enum(['skip', 'merge', 'create']).default('skip'), mergeTargets: z.array(z.string().uuid()).optional(), confirmMerge: z.literal(true).optional(), categoryId: z.string().uuid().optional() }).refine((v) => !!v.vcard || !!v.contacts, 'vCard text or normalized contacts are required');
const PreviewSchema = z.object({ entries: z.array(z.object({ contact: ContactInputSchema, duplicateIds: z.array(z.string()) })) });
const ImportResultSchema = z.object({ created: z.number(), merged: z.number(), skipped: z.number(), ids: z.array(z.string()) });
const MergeSchema = z.object({ targetId: z.string().uuid(), sourceId: z.string().uuid(), confirm: z.literal(true) });

async function preview(db: KinwallDb, vcard: string | undefined, contacts: ContactInput[] | undefined, categoryId?: string) {
  const imported = (contacts ?? parseVCards(vcard!)).map((contact) => ({ ...contact, categoryIds: categoryId ? [...new Set([...contact.categoryIds, categoryId])] : contact.categoryIds }));
  const existing = (await all(db)).map(fromRow);
  return imported.map((contact) => ({ contact, duplicateIds: existing.filter((other) => duplicateScore(contact, other) > 0).map((other) => other.id) }));
}

contactsRoutes.openapi(createRoute({ method: 'post', path: '/api/contacts/import/preview', tags: tag, security, summary: 'Preview a vCard import and duplicate matches (admin)', request: { body: jsonBody(ImportSchema) }, responses: { 200: { description: 'ok', content: { 'application/json': { schema: PreviewSchema } } }, 400: error('invalid vCard') } }), async (c) => {
  const { vcard, contacts, categoryId } = c.req.valid('json');
  if (categoryId && !(await validateCategories(c.env.DB, [categoryId]))) return c.json({ error: 'invalid category id' }, 400);
  try { return c.json({ entries: await preview(c.env.DB, vcard, contacts, categoryId) }, 200); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : 'invalid vCard' }, 400); }
});

contactsRoutes.openapi(createRoute({ method: 'post', path: '/api/contacts/import', tags: tag, security, summary: 'Import vCards; skip, merge or create duplicates (admin)', request: { body: jsonBody(ImportSchema) }, responses: { 200: { description: 'ok', content: { 'application/json': { schema: ImportResultSchema } } }, 400: error('invalid vCard') } }), async (c) => {
  const { vcard, contacts, strategy, categoryId, mergeTargets, confirmMerge } = c.req.valid('json');
  if (categoryId && !(await validateCategories(c.env.DB, [categoryId]))) return c.json({ error: 'invalid category id' }, 400);
  let incoming: ContactInput[];
  try { incoming = (contacts ?? parseVCards(vcard!)).map((contact) => ({ ...contact, categoryIds: categoryId ? [...new Set([...contact.categoryIds, categoryId])] : contact.categoryIds })); }
  catch (e) { return c.json({ error: e instanceof Error ? e.message : 'invalid vCard' }, 400); }
  if (strategy === 'merge' && (!confirmMerge || mergeTargets?.length !== incoming.length)) return c.json({ error: 'explicit merge targets and confirmation are required' }, 400);
  for (const contact of incoming) if (!(await validateReferences(c.env.DB, contact))) return c.json({ error: 'invalid category or member ids' }, 400);
  const existing = (await all(c.env.DB)).map(fromRow);
  if (strategy === 'merge' && incoming.some((contact, index) => {
    const target = existing.find((item) => item.id === mergeTargets![index]);
    return !target || duplicateScore(contact, target) === 0;
  })) return c.json({ error: 'a merge target is missing or does not match' }, 400);
  const result = { created: 0, merged: 0, skipped: 0, ids: [] as string[] };
  for (const [index, contact] of incoming.entries()) {
    const match = strategy === 'merge' ? existing.find((other) => other.id === mergeTargets![index]) : existing.find((other) => duplicateScore(contact, other) > 0);
    if (match && strategy === 'skip') { result.skipped++; result.ids.push(match.id); continue; }
    if (match && strategy === 'merge') {
      const merged = await update(c.env.DB, match.id, mergeContacts(inputOf(match), contact));
      existing[existing.indexOf(match)] = merged; result.merged++; result.ids.push(match.id);
      contactEvent(c, 'merged', match.id);
    } else {
      const created = await insert(c.env.DB, contact);
      existing.push(created); result.created++; result.ids.push(created.id);
      contactEvent(c, 'imported', created.id);
    }
  }
  return c.json(result, 200);
});

contactsRoutes.openapi(createRoute({ method: 'post', path: '/api/contacts/merge', tags: tag, security, summary: 'Merge another contact into this one and delete the source (admin)', request: { body: jsonBody(MergeSchema) }, responses: { 200: answer(ContactSchema), 400: error('same contact'), 404: error('not found') } }), async (c) => {
  const { targetId: id, sourceId } = c.req.valid('json');
  if (id === sourceId) return c.json({ error: 'cannot merge a contact into itself' }, 400);
  const target = await load(c.env.DB, id), source = await load(c.env.DB, sourceId);
  if (!target || !source) return c.json({ error: 'not found' }, 404);
  const merged = mergeContacts(inputOf(fromRow(target)), inputOf(fromRow(source)));
  await update(c.env.DB, id, merged);
  await c.env.DB.prepare('DELETE FROM contacts WHERE id = ?').bind(sourceId).run();
  contactEvent(c, 'merged', id);
  return c.json(fromRow((await load(c.env.DB, id))!), 200);
});
