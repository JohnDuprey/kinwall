import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const ADMIN = 'kw_fake_trip_next_admin';
const SECRET = 'FAKE-PRIVATE-PET-CARE-4412';
async function fixture(encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=') {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '../migrations'));
  const env = { DB: db, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: encryptionKey } as Env;
  const app = createApp();
  async function req(method: string, url: string, body?: unknown, key = ADMIN, extra: Record<string, string> = {}) {
    const res = await app.request(url, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, json: (text.startsWith('{') || text.startsWith('[')) ? JSON.parse(text) as any : null };
  }
  const features = (await req('GET', '/api/settings')).json.features;
  await req('PATCH', '/api/settings', { features: { ...features, trips: true } });
  const alex = (await req('POST', '/api/members', { name: 'Alex', color: '#336699', grownUp: true })).json;
  const maya = (await req('POST', '/api/members', { name: 'Maya', color: '#339966' })).json;
  const keys: Record<string, string> = {};
  for (const [label, kind, owner] of [['adult', 'grownup', alex.id], ['kid', 'kid', maya.id], ['wall', 'wall', 'shared']]) {
    const key = (await req('POST', '/api/keys', { name: label, scope: 'display' })).json;
    await req('PATCH', `/api/keys/${key.id}`, { kind, owner }); keys[label] = key.key;
  }
  const trip = (await req('POST', '/api/trips', { title: 'Family cabin break', startDate: '2027-07-10', endDate: '2027-07-14', memberIds: [alex.id, maya.id] })).json;
  const care = { title: 'Feed Biscuit', kind: 'pet', helperName: 'Sam', helperContact: 'sam@example.test', fromDate: '2027-07-10', toDate: '2027-07-14', status: 'confirmed', tasks: [{ id: crypto.randomUUID(), text: 'Fresh water each morning', done: false }], instructions: SECRET, entry: 'FAKE-ENTRY-ONLY', emergency: 'FAKE-CONTACT-ONLY' };
  return { db, req, trip, care, keys };
}

test('trip care privacy: whole encrypted record stays off child, wall, connected and ordinary export surfaces', async () => {
  const f = await fixture();
  const added = await f.req('POST', `/api/trips/${f.trip.id}/care`, { revision: f.trip.revision, ...f.care });
  assert.equal(added.status, 201, added.text);
  let trip = added.json;
  assert.equal(trip.care[0].instructions, SECRET);
  assert.equal(trip.canEditCare, true);
  for (const settings of [{ detailsAudience: 'grownups', detailsOnWall: false }, { detailsAudience: 'everyone', detailsOnWall: false }, { detailsAudience: 'everyone', detailsOnWall: true }]) {
    const edited = await f.req('PATCH', `/api/trips/${trip.id}`, { revision: trip.revision, ...settings });
    assert.equal(edited.status, 200, edited.text); trip = edited.json;
    for (const [key, extra] of [[f.keys.kid, {}], [f.keys.wall, {}], [ADMIN, { 'X-Kinwall-Source': 'mcp' }]] as [string, Record<string, string>][]) {
      const read = await f.req('GET', `/api/trips/${trip.id}`, undefined, key, extra);
      assert.equal(read.status, 200, read.text);
      assert.deepEqual(read.json.care, []);
      assert.equal(read.json.canSeeCare, false);
      assert.equal(read.json.canEditCare, false);
      for (const text of [SECRET, f.care.title, f.care.helperContact, f.care.tasks[0].text, f.care.entry]) assert.equal(read.text.includes(text), false, 'hidden care must not leak even through checks or counts');
    }
  }
  const everyday = await f.req('GET', `/api/trips/${trip.id}`, undefined, f.keys.adult);
  assert.equal(everyday.json.care[0].instructions, SECRET);
  assert.equal(everyday.json.canSeeCare, true);
  assert.equal(everyday.json.canEditCare, false);
  for (const key of [f.keys.adult, f.keys.kid, f.keys.wall]) {
    assert.equal((await f.req('POST', `/api/trips/${trip.id}/care`, { revision: trip.revision, ...f.care }, key)).status, 403);
    assert.equal((await f.req('PATCH', `/api/trips/${trip.id}/care/${trip.care[0].id}`, { revision: trip.revision, instructions: 'changed' }, key)).status, 403);
    assert.equal((await f.req('DELETE', `/api/trips/${trip.id}/care/${trip.care[0].id}?revision=${trip.revision}`, undefined, key)).status, 403);
  }
  assert.equal((await f.req('POST', `/api/trips/${trip.id}/care`, { revision: trip.revision, ...f.care }, ADMIN, { 'X-Kinwall-Source': 'mcp' })).status, 403);
  for (const url of ['/api/trips', '/api/trips/links', '/api/export']) {
    const read = await f.req('GET', url); assert.equal(read.status, 200, read.text);
    for (const text of [SECRET, f.care.title, f.care.helperContact, f.care.tasks[0].text, f.care.entry]) assert.equal(read.text.includes(text), false, url);
  }
  const rows = await f.db.prepare('SELECT data FROM trip_care').all<{ data: string }>();
  assert.equal(rows.results.length, 1);
  assert.match(rows.results[0].data, /^v1:/);
  for (const text of [SECRET, f.care.helperContact, f.care.title, f.care.tasks[0].text]) assert.equal(rows.results[0].data.includes(text), false);
  assert.match(everyday.headers.get('cache-control') ?? '', /no-store/);
});

test('trip care backup: explicit private export restores under a new key and cannot be requested by connected apps', async () => {
  const source = await fixture();
  const created = await source.req('POST', `/api/trips/${source.trip.id}/care`, { ...source.care, revision: source.trip.revision });
  assert.equal(created.status, 201, created.text);
  const full = await source.req('GET', '/api/export?includeTripDetails=1');
  assert.equal(full.status, 200, full.text);
  assert.ok(full.text.includes(SECRET));
  assert.equal((await source.req('GET', '/api/export?includeTripDetails=1', undefined, ADMIN, { 'X-Kinwall-Source': 'mcp' })).status, 403);
  assert.equal((await source.req('GET', '/api/export?includeTripDetails=1', undefined, source.keys.adult)).status, 403);
  assert.equal((await source.req('POST', '/api/import', full.json, source.keys.adult)).status, 403);
  const target = await fixture('AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=');
  for (let i = 0; i < 2; i++) {
    const imported = await target.req('POST', '/api/import', full.json);
    assert.equal(imported.status, 200, imported.text);
  }
  const restored = await target.req('GET', `/api/trips/${source.trip.id}`);
  assert.equal(restored.status, 200, restored.text);
  assert.equal(restored.json.care.length, 1);
  assert.equal(restored.json.care[0].instructions, SECRET);
  assert.equal(restored.json.care[0].tasks[0].done, false);
  const encrypted = await target.db.prepare('SELECT data FROM trip_care WHERE trip_id=?').bind(source.trip.id).all<{ data: string }>();
  assert.equal(encrypted.results.length, 1);
  assert.match(encrypted.results[0].data, /^v1:/);
  assert.equal(encrypted.results[0].data.includes(SECRET), false);
});

test('trip care writes: stale edits and deletes cannot replace a newer checklist or silently remove it', async () => {
  const f = await fixture();
  const added = await f.req('POST', `/api/trips/${f.trip.id}/care`, { revision: f.trip.revision, ...f.care });
  assert.equal(added.status, 201, added.text);
  const old = added.json;
  const tasks = old.care[0].tasks.map((x: any) => ({ ...x, done: true }));
  const changed = await f.req('PATCH', `/api/trips/${old.id}/care/${old.care[0].id}`, { revision: old.revision, tasks });
  assert.equal(changed.status, 200, changed.text);
  assert.equal((await f.req('PATCH', `/api/trips/${old.id}/care/${old.care[0].id}`, { revision: old.revision, tasks: old.care[0].tasks })).status, 409);
  assert.equal((await f.req('DELETE', `/api/trips/${old.id}/care/${old.care[0].id}?revision=${old.revision}`)).status, 409);
  const current = (await f.req('GET', `/api/trips/${old.id}`)).json;
  assert.equal(current.care[0].tasks[0].done, true);
  const removed = await f.req('DELETE', `/api/trips/${old.id}/care/${old.care[0].id}?revision=${current.revision}`);
  assert.equal(removed.status, 200, removed.text);
  assert.deepEqual(removed.json.care, []);
});

test('trip care date review: care appears privately for review and trip edits do not move home dates', async () => {
  const f = await fixture();
  const added = await f.req('POST', `/api/trips/${f.trip.id}/care`, { revision: f.trip.revision, ...f.care });
  assert.equal(added.status, 201, added.text);
  const trip = added.json;
  const dates = { startDate: '2027-08-10', endDate: '2027-08-14' };
  const preview = await f.req('POST', `/api/trips/${trip.id}/date-change/preview`, dates);
  assert.equal(preview.status, 200, preview.text);
  assert.deepEqual(preview.json.care, [{ id: trip.care[0].id, title: f.care.title, date: f.care.fromDate }]);
  const connected = await f.req('POST', `/api/trips/${trip.id}/date-change/preview`, dates, ADMIN, { 'X-Kinwall-Source': 'mcp' });
  assert.ok(!connected.text.includes(f.care.title));
  assert.ok(!connected.text.includes(SECRET));
  const changed = await f.req('PATCH', `/api/trips/${trip.id}`, { revision: trip.revision, ...dates });
  assert.equal(changed.status, 200, changed.text);
  assert.equal(changed.json.care[0].fromDate, f.care.fromDate);
  assert.equal(changed.json.care[0].toDate, f.care.toDate);
});

test('trip care recovery: one damaged encrypted record does not fail a committed trip edit or disappear silently', async () => {
  const f = await fixture();
  const first = await f.req('POST', `/api/trips/${f.trip.id}/care`, { ...f.care, revision: f.trip.revision });
  assert.equal(first.status, 201, first.text);
  const brokenId = first.json.care[0].id;
  const second = await f.req('POST', `/api/trips/${f.trip.id}/care`, { ...f.care, title: 'Water the plants', revision: first.json.revision });
  assert.equal(second.status, 201, second.text);
  await f.db.prepare('UPDATE trip_care SET data=? WHERE id=?').bind('v1:FAKE-DAMAGED-CARE-CIPHERTEXT', brokenId).run();
  const read = await f.req('GET', `/api/trips/${f.trip.id}`);
  assert.equal(read.status, 200, read.text);
  assert.equal(read.json.careUnavailable, true);
  assert.deepEqual(read.json.care.map((c: any) => c.title), ['Water the plants']);
  const edited = await f.req('PATCH', `/api/trips/${f.trip.id}`, { revision: read.json.revision, description: 'Plan updated despite an unrelated damaged record.' });
  assert.equal(edited.status, 200, edited.text);
  assert.equal(edited.json.revision, read.json.revision + 1);
  assert.equal(edited.json.careUnavailable, true);
  assert.equal((await f.db.prepare('SELECT data FROM trip_care WHERE id=?').bind(brokenId).first<{ data: string }>())?.data, 'v1:FAKE-DAMAGED-CARE-CIPHERTEXT');
  const kid = await f.req('GET', `/api/trips/${f.trip.id}`, undefined, f.keys.kid);
  assert.equal(kid.status, 200, kid.text);
  assert.equal(kid.json.careUnavailable, false);
  assert.deepEqual(kid.json.care, []);
  const ordinary = await f.req('GET', '/api/export');
  assert.equal(ordinary.status, 200, ordinary.text);
  assert.ok(!ordinary.text.includes(SECRET));
  const privateBackup = await f.req('GET', '/api/export?includeTripDetails=1');
  assert.equal(privateBackup.status, 400);
  assert.ok(!privateBackup.text.includes(SECRET));
});

test('private travel export fails cleanly when an existing booking record cannot be decrypted', async () => {
  const f = await fixture();
  const group = await f.req('POST', `/api/trips/${f.trip.id}/stay-groups`, { revision: f.trip.revision, label: 'Family stay' });
  const stay = await f.req('POST', `/api/trips/${f.trip.id}/stays`, { revision: group.json.revision, groupId: group.json.stayGroups[0].id, name: 'Family home', kind: 'family', details: { codes: SECRET } });
  assert.equal(stay.status, 201, stay.text);
  const id = stay.json.stayGroups[0].options[0].id;
  await f.db.prepare('UPDATE trip_private SET data=? WHERE id=?').bind('v1:FAKE-DAMAGED-BOOKING-CIPHERTEXT', id).run();
  assert.equal((await f.req('GET', '/api/export')).status, 200);
  const failed = await f.req('GET', '/api/export?includeTripDetails=1');
  assert.equal(failed.status, 400, failed.text);
  assert.ok(!failed.text.includes(SECRET));
  assert.ok(!failed.text.includes('FAKE-DAMAGED-BOOKING-CIPHERTEXT'));
});
