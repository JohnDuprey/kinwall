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
    notes: 'private note', sourceMetadata: { source: 'private' }, address: 'Private street', addressVisibleOnWall: false,
  });
  assert.equal(created.status, 201);
  const wall = (await t.req(`/api/contacts/${created.body.id}`, 'GET', undefined, display)).body;
  assert.deepEqual(wall.phones.map((p: { value: string }) => p.value), ['+1 555 111 2222']);
  assert.deepEqual(wall.emails, []);
  assert.deepEqual(wall.tags, []);
  assert.equal(wall.relationship, null);
  assert.equal(wall.notes, null);
  assert.equal(wall.address, null);
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
