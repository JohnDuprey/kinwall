import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { duplicateScore, parseVCards } from '../src/contacts-domain.ts';

const ADMIN = 'kw_contacts_admin';
function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const background: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => background.push(p), passThroughOnException() {}, props: {} };
  const req = async (url: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const response = await app.request(url, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx as never);
    return { status: response.status, body: await response.json() as any };
  };
  return { db, req, flush: async () => { while (background.length) await Promise.all(background.splice(0)); } };
}

test('contacts CRUD, categories, display redaction and scope', async () => {
  const t = setup();
  const category = await t.req('/api/contact-categories', 'POST', { name: 'Emergency', color: '#ef0000' });
  assert.equal(category.status, 201);
  const display = (await t.req('/api/keys', 'POST', { name: 'wall', scope: 'display' })).body.key;
  const created = await t.req('/api/contacts', 'POST', { kind: 'person', name: 'Ada Lovelace', phones: [{ label: 'mobile', value: '+1 555 123 4567' }], notes: 'private note', privateFields: ['phones', 'notes'], wallVisible: true, categoryIds: [category.body.id] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const id = created.body.id;
  assert.equal((await t.req('/api/contacts', 'GET', undefined, display)).body[0].phones.length, 0);
  assert.equal((await t.req(`/api/contacts/${id}`, 'GET', undefined, display)).body.notes, null);
  assert.equal((await t.req(`/api/contacts/${id}`, 'GET', undefined, display)).body.privateFields.length, 0);
  assert.equal((await t.req(`/api/contacts/${id}`, 'PATCH', { notes: 'no' }, display)).status, 403);
  assert.equal((await t.req('/api/contacts/import/preview', 'POST', { vcard: 'BEGIN:VCARD\nFN:X\nEND:VCARD' }, display)).status, 403);
  assert.equal((await t.req('/api/contacts', 'POST', { kind: 'person', name: 'X', categoryIds: [crypto.randomUUID()] })).status, 400);
  const privateContact = await t.req('/api/contacts', 'POST', { kind: 'organization', name: 'Private Company', visibility: 'private' });
  assert.equal(privateContact.status, 201);
  assert.equal((await t.req('/api/contacts', 'GET', undefined, display)).body.length, 1);
  assert.equal((await t.req(`/api/contacts/${privateContact.body.id}`, 'GET', undefined, display)).status, 404);
  const changed = await t.req(`/api/contacts/${id}`, 'PATCH', { title: 'Mathematician' });
  assert.equal(changed.body.title, 'Mathematician');
  assert.deepEqual(changed.body.categoryIds, [category.body.id]);
  assert.equal((await t.req('/api/contacts?q=ada&kind=person&categoryId=' + category.body.id)).body.length, 1);
  assert.equal((await t.req(`/api/contact-categories/${category.body.id}`, 'DELETE')).status, 200);
  assert.deepEqual((await t.req(`/api/contacts/${id}`)).body.categoryIds, []);
  assert.equal((await t.req(`/api/contacts/${id}`, 'DELETE')).status, 200);
  assert.equal((await t.req(`/api/contacts/${id}`)).status, 404);
  await t.flush();
});

test('display reads redact every non-wall field and honor adults visibility', async () => {
  const t = setup();
  const display = (await t.req('/api/keys', 'POST', { name: 'wall', scope: 'display' })).body.key;
  const created = await t.req('/api/contacts', 'POST', {
    name: 'Emergency office', kind: 'service', wallVisible: true, phoneVisibleOnWall: true,
    phones: [{ label: 'public', value: '+1 555 111 2222', wallVisible: true }, { label: 'private', value: '+1 555 333 4444' }],
    emails: [{ label: 'work', value: 'secret@example.com' }], relationship: 'private relation', tags: ['private tag'],
    notes: 'private note', sourceMetadata: { source: 'private' }, addresses: [{ street: 'Private street' }], addressVisibleOnWall: false,
  });
  assert.equal(created.status, 201);
  const wall = (await t.req(`/api/contacts/${created.body.id}`, 'GET', undefined, display)).body;
  assert.deepEqual(wall.phones.map((p: { value: string }) => p.value), ['+1 555 111 2222']);
  assert.deepEqual(wall.emails, []);
  assert.deepEqual(wall.tags, []);
  assert.equal(wall.relationship, null);
  assert.equal(wall.notes, null);
  assert.deepEqual(wall.addresses, []);
  assert.equal(wall.sourceMetadata, null);
  assert.equal((await t.req('/api/contacts?favorite=false', 'GET')).body.length, 1);
  assert.equal((await t.req('/api/contacts?favorite=true', 'GET')).body.length, 0);
  await t.req(`/api/contacts/${created.body.id}`, 'PATCH', { visibility: 'adults' });
  assert.equal((await t.req('/api/contacts', 'GET', undefined, display)).body.length, 0);
  assert.equal((await t.req(`/api/contacts/${created.body.id}`, 'GET', undefined, display)).status, 404);
  assert.equal((await t.req('/api/contact-categories/00000000-0000-4000-8000-000000000001', 'DELETE')).status, 403);
  await t.flush();
});

test('vCard 2.1/3/4 parse, preview duplicates, import strategies, explicit merge', async () => {
  const t = setup();
  const card = 'BEGIN:VCARD\r\nVERSION:2.1\r\nN:Doe;Jane;;;\r\nFN;CHARSET=UTF-8;ENCODING=QUOTED-PRINTABLE:Jane=20Doe\r\nTEL;HOME:+1 (555) 222-3333\r\nEMAIL;TYPE=WORK:jane@example.com\r\nEND:VCARD\r\n';
  assert.equal(parseVCards(card)[0].name, 'Jane Doe');
  const rich = parseVCards('BEGIN:VCARD\nVERSION:3.0\nFN:Jane Doe\nNICKNAME:Janey\nCATEGORIES:Family,Childcare\nURL:https://example.com\nNOTE:hello\\nworld\nEND:VCARD')[0];
  assert.equal(rich.notes, 'hello\nworld');
  assert.equal(rich.nickname, 'Janey');
  assert.deepEqual(rich.tags, ['Family', 'Childcare']);
  assert.equal(rich.websites[0].value, 'https://example.com');
  assert.equal(parseVCards('BEGIN:VCARD\nVERSION:4.0\nFN:Example Org\nKIND:org\nORG:Example Org\nEND:VCARD')[0].kind, 'organization');
  assert.throws(() => parseVCards('BEGIN:VCARD\nEND:VCARD'));
  const first = await t.req('/api/contacts/import', 'POST', { vcard: card });
  assert.deepEqual([first.status, first.body.created], [200, 1]);
  const preview = await t.req('/api/contacts/import/preview', 'POST', { vcard: card });
  assert.deepEqual(preview.body.entries[0].duplicateIds, first.body.ids);
  assert.equal((await t.req('/api/contacts/import', 'POST', { vcard: card })).body.skipped, 1);
  const richer = card.replace('END:VCARD', 'TITLE:Engineer\r\nEND:VCARD');
  assert.equal((await t.req('/api/contacts/import', 'POST', { vcard: richer, strategy: 'merge' })).status, 400);
  assert.equal((await t.req('/api/contacts/import', 'POST', { vcard: richer, strategy: 'merge', mergeTargets: first.body.ids, confirmMerge: true })).body.merged, 1);
  assert.equal((await t.req(`/api/contacts/${first.body.ids[0]}`)).body.title, 'Engineer');
  const copy = await t.req('/api/contacts/import', 'POST', { vcard: card, strategy: 'create' });
  assert.equal(copy.body.created, 1);
  const merged = await t.req('/api/contacts/merge', 'POST', { targetId: first.body.ids[0], sourceId: copy.body.ids[0], confirm: true });
  assert.equal(merged.status, 200);
  assert.equal((await t.req(`/api/contacts/${copy.body.ids[0]}`)).status, 404);
  assert.equal(duplicateScore(parseVCards(card)[0], parseVCards(card)[0]), 100);
  await t.flush();
});

test('vCard: a trailing = only joins lines inside a quoted-printable property', () => {
  const apple = [
    'BEGIN:VCARD', 'VERSION:3.0', 'N:Doe;Jane;;;', 'FN:Jane Doe',
    'PHOTO;ENCODING=b;TYPE=JPEG:/9j/4AAQSkZJRgABAQAAAQABAAD==',
    'TEL;TYPE=CELL:+1 555 010 1234',
    'URL:https://example.com/?a=',
    'EMAIL;TYPE=HOME:jane@example.com',
    'END:VCARD',
  ].join('\r\n');
  const [card] = parseVCards(apple);
  assert.deepEqual(card.phones.map((p) => p.value), ['+1 555 010 1234']);
  assert.deepEqual(card.websites.map((w) => w.value), ['https://example.com/?a=']);
  assert.deepEqual(card.emails.map((e) => e.value), ['jane@example.com']);

  const qp = [
    'BEGIN:VCARD', 'VERSION:2.1', 'FN:Sam Doe',
    'NOTE;ENCODING=QUOTED-PRINTABLE:Line one=0D=0A=',
    'line two=',
    'continues',
    'TEL;CELL:555-010-9999',
    'END:VCARD',
  ].join('\r\n');
  const [sam] = parseVCards(qp);
  assert.equal(sam.notes, 'Line one\r\nline twocontinues');
  assert.deepEqual(sam.phones.map((p) => p.value), ['555-010-9999']);
});

test('import preview reads raw vCard text into structured drafts for the app to review', async () => {
  const t = setup();
  const vcard = 'BEGIN:VCARD\nVERSION:3.0\nFN:Coach Taylor\nADR;TYPE=WORK:;;1 Field Rd;Springfield;OR;97000;US\nBDAY:1980-04-02\nTEL:555-010-1111\nEND:VCARD';
  const res = await t.req('/api/contacts/import/preview', 'POST', { vcard });
  assert.equal(res.status, 200);
  const [{ contact, duplicateIds }] = res.body.entries;
  assert.deepEqual(duplicateIds, []);
  assert.equal(contact.addresses[0].city, 'Springfield');
  assert.equal(contact.addresses[0].street, '1 Field Rd');
  assert.deepEqual(contact.dates, [{ label: 'birthday', date: '1980-04-02' }]);
  assert.equal((await t.req('/api/contacts')).body.length, 0);
});

test('contacts keep one field per fact: emergency, wallVisible, visibility, addresses', async () => {
  const t = setup();
  const columns = (await t.db.prepare('PRAGMA table_info(contacts)').all<{ name: string }>()).results.map((c) => c.name);
  for (const gone of ['emergency_designation', 'show_on_wall', 'privacy_visibility', 'address']) assert.ok(!columns.includes(gone), gone);
  for (const kept of ['emergency', 'wall_visible', 'visibility', 'addresses']) assert.ok(columns.includes(kept), kept);
  const created = await t.req('/api/contacts', 'POST', { name: 'School office', emergency: true, wallVisible: true, visibility: 'adults', addresses: [{ street: '1 School Rd', city: 'Springfield' }] });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  for (const gone of ['emergencyDesignation', 'showOnWall', 'address']) assert.ok(!(gone in created.body), gone);
  assert.equal(created.body.visibility, 'adults');
  assert.equal(created.body.addresses[0].city, 'Springfield');
  for (const old of [{ showOnWall: true }, { emergencyDesignation: true }, { address: '1 School Rd' }]) {
    assert.equal((await t.req('/api/contacts', 'POST', { name: 'Old field', ...old })).status, 400, JSON.stringify(old));
  }
});

test('each contact change emits exactly one event', async () => {
  const t = setup();
  const rev = async () => { await t.flush(); return Number((await t.db.prepare("SELECT value FROM settings WHERE key = 'rev'").first<{ value: string }>())?.value ?? 0); };
  const before = await rev();
  const created = await t.req('/api/contacts', 'POST', { name: 'Coach Taylor' });
  assert.equal(await rev(), before + 1);
  await t.req(`/api/contacts/${created.body.id}`, 'PATCH', { title: 'Coach' });
  assert.equal(await rev(), before + 2);
  const category = await t.req('/api/contact-categories', 'POST', { name: 'Sports' });
  assert.equal(await rev(), before + 3);
  await t.req(`/api/contacts/${created.body.id}`, 'PATCH', { categoryIds: [category.body.id] });
  await t.req(`/api/contact-categories/${category.body.id}`, 'DELETE');
  assert.equal(await rev(), before + 5);
  await t.req(`/api/contacts/${created.body.id}`, 'DELETE');
  assert.equal(await rev(), before + 6);
});

test('visibility levels: admin, shared wall, a kid’s own device and a grown-up’s own device', async () => {
  const t = setup();
  const alex = (await t.req('/api/members', 'POST', { name: 'Alex', color: '#57e', grownUp: true })).body;
  const leo = (await t.req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).body;
  const maya = (await t.req('/api/members', 'POST', { name: 'Maya', color: '#5e7' })).body;
  const device = async (owner: string) => {
    const k = (await t.req('/api/keys', 'POST', { name: `tablet ${owner}`, scope: 'display' })).body;
    assert.equal((await t.req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    return k.key as string;
  };
  const keys = { admin: ADMIN, wall: await device('shared'), leo: await device(leo.id), alex: await device(alex.id) };
  const make = async (name: string, extra: object) => (await t.req('/api/contacts', 'POST', { name, ...extra })).body.id as string;
  const ids = {
    household: await make('Babysitter', { visibility: 'household' }),
    householdWall: await make('Fire department', { visibility: 'household', wallVisible: true }),
    adults: await make('Family lawyer', { visibility: 'adults', wallVisible: true }),
    selected: await make('Leo’s coach', { visibility: 'selected_members', selectedMemberIds: [leo.id] }),
    selectedMaya: await make('Maya’s tutor', { visibility: 'selected_members', selectedMemberIds: [maya.id] }),
    private: await make('Doctor', { visibility: 'private', wallVisible: true }),
  };
  const sees = async (key: string) => {
    const listed = new Set((await t.req('/api/contacts', 'GET', undefined, key)).body.map((c: { id: string }) => c.id));
    const names = Object.entries(ids).filter(([, id]) => listed.has(id)).map(([name]) => name);
    for (const [name, id] of Object.entries(ids)) assert.equal((await t.req(`/api/contacts/${id}`, 'GET', undefined, key)).status, listed.has(id) ? 200 : 404, name);
    return names;
  };
  assert.deepEqual(await sees(keys.admin), ['household', 'householdWall', 'adults', 'selected', 'selectedMaya', 'private']);
  assert.deepEqual(await sees(keys.wall), ['householdWall']);
  assert.deepEqual(await sees(keys.leo), ['household', 'householdWall', 'selected']);
  assert.deepEqual(await sees(keys.alex), ['household', 'householdWall', 'adults']);
  // A member's own device never learns who else a contact is shared with.
  assert.deepEqual((await t.req(`/api/contacts/${ids.selected}`, 'GET', undefined, keys.leo)).body.selectedMemberIds, []);
});
