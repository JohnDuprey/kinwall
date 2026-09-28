// Trackers (routes/trackers.ts): CRUD per kind, validation, filters, the reading summary, and the
// privacy rule - health never reaches a display key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function makeApp() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const send = async (method: string, p: string, body?: unknown, key = ADMIN_KEY) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  // A photo as the web uploads one; family=0 is a memory's own photo.
  const upload = async (family = true, key = ADMIN_KEY) => {
    const res = await app.request(`/api/photos${family ? '' : '?family=0'}`, {
      method: 'POST', body: new Uint8Array(100), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'image/webp', 'X-Photo-Width': '4', 'X-Photo-Height': '3' },
    }, env);
    return ((await res.json()) as any).id as string;
  };
  return { send, upload, db };
}

async function family(send: ReturnType<typeof makeApp>['send']) {
  const maya = (await send('POST', '/api/members', { name: 'Maya', color: '#7ED9A6' })).body;
  const leo = (await send('POST', '/api/members', { name: 'Leo', color: '#F5A65B' })).body;
  return { maya, leo };
}

test('trackers: audiobooks log minutes, finish at their length, and count in the summary', async () => {
  const { send, db } = makeApp();
  const { maya } = await family(send);
  const plain = await send('POST', '/api/trackers', { kind: 'reading', memberId: maya.id, title: 'Matilda', data: { totalPages: 240 } });
  assert.equal(plain.body.data.format, 'book', 'a book unless it says otherwise');
  const audio = await send('POST', '/api/trackers', { kind: 'reading', memberId: maya.id, title: 'The Wild Robot', data: { format: 'audiobook', narrator: 'Kate Atwater', totalMinutes: 300, minutesListened: 75 } });
  assert.equal(audio.status, 201);
  assert.deepEqual([audio.body.data.format, audio.body.data.narrator, audio.body.data.minutesListened], ['audiobook', 'Kate Atwater', 75]);
  const bad = async (data: object) => (await send('POST', '/api/trackers', { kind: 'reading', title: 'x', data })).status;
  assert.equal(await bad({ format: 'podcast' }), 400);
  assert.equal(await bad({ format: 'audiobook', totalMinutes: 0 }), 400);
  assert.equal(await bad({ format: 'audiobook', minutesListened: 1.5 }), 400);
  assert.equal(await bad({ format: 'audiobook', totalMinutes: 100001 }), 400);

  // An entry from before audiobooks (no format) still reads as a book.
  await db.prepare("INSERT INTO tracker_entries (id, kind, member_id, date, title, data, created_at, updated_at) VALUES ('old', 'reading', ?, '2026-01-01', 'Old', ?, '', '')").bind(maya.id, JSON.stringify({ status: 'reading', pagesRead: 10, totalPages: 40 })).run();
  const sum1 = (await send('GET', '/api/trackers/summary?year=2026')).body.members.find((m: any) => m.memberId === maya.id);
  assert.deepEqual(sum1.reading.map((r: any) => [r.title, r.percent]).sort(), [['Matilda', 0], ['Old', 25], ['The Wild Robot', 25]]);
  assert.deepEqual([sum1.pages, sum1.minutes], [10, 75]);
  assert.equal((await send('PATCH', '/api/trackers/old', { data: { rating: 3 } })).status, 200, 'old entries still edit');

  const done = await send('PATCH', `/api/trackers/${audio.body.id}`, { data: { status: 'finished', finishedOn: '2026-09-20' } });
  assert.deepEqual([done.body.data.minutesListened, done.body.data.pagesRead], [300, undefined], 'finished = its whole length');
  const sum2 = (await send('GET', '/api/trackers/summary?year=2026')).body.members.find((m: any) => m.memberId === maya.id);
  assert.deepEqual([sum2.finished, sum2.minutes], [1, 300]);
});

test('trackers: reading CRUD, finishing a book, and the summary', async () => {
  const { send } = makeApp();
  const { maya, leo } = await family(send);
  const book = await send('POST', '/api/trackers', { kind: 'reading', memberId: maya.id, date: '2026-09-01', title: "  Charlotte's Web ", data: { author: 'E. B. White', totalPages: 184, pagesRead: 83 } });
  assert.equal(book.status, 201);
  assert.deepEqual([book.body.title, book.body.data.status, book.body.data.pagesRead], ["Charlotte's Web", 'reading', 83]);

  const rated = await send('PATCH', `/api/trackers/${book.body.id}`, { data: { rating: 5, status: 'finished', finishedOn: '2026-09-20' } });
  assert.equal(rated.status, 200);
  assert.deepEqual([rated.body.data.rating, rated.body.data.pagesRead, rated.body.data.author], [5, 184, 'E. B. White'], 'merged, and finished = last page');
  assert.equal((await send('PATCH', `/api/trackers/${book.body.id}`, { data: { rating: null } })).body.data.rating, undefined, 'null clears a field');

  await send('POST', '/api/trackers', { kind: 'reading', memberId: leo.id, title: 'Dragon Masters', data: { totalPages: 90, pagesRead: 45 } });
  const auto = await send('POST', '/api/trackers', { kind: 'reading', memberId: leo.id, title: 'Frog and Toad', data: { status: 'finished' } });
  assert.match(auto.body.data.finishedOn, /^\d{4}-\d{2}-\d{2}$/, 'finished today by default');

  const sum = (await send('GET', '/api/trackers/summary?year=2026')).body;
  const mayaSum = sum.members.find((m: any) => m.memberId === maya.id);
  assert.deepEqual([mayaSum.finished, mayaSum.pages], [1, 184]);
  const leoSum = sum.members.find((m: any) => m.memberId === leo.id);
  assert.deepEqual(leoSum.reading.map((r: any) => [r.title, r.percent]), [['Dragon Masters', 50]]);

  assert.equal((await send('GET', `/api/trackers/${book.body.id}`)).body.title, "Charlotte's Web");
  assert.equal((await send('DELETE', `/api/trackers/${book.body.id}`)).status, 200);
  assert.equal((await send('GET', `/api/trackers/${book.body.id}`)).status, 404);
});

test('trackers: validation per kind', async () => {
  const { send } = makeApp();
  const bad = async (body: unknown) => (await send('POST', '/api/trackers', body)).status;
  assert.equal(await bad({ kind: 'reading', data: {} }), 400, 'a book needs a title');
  assert.equal(await bad({ kind: 'reading', title: 'x', data: { rating: 6 } }), 400);
  assert.equal(await bad({ kind: 'reading', title: 'x', data: { status: 'lost' } }), 400);
  assert.equal(await bad({ kind: 'reading', title: 'x', data: { color: 'red' } }), 400, 'unknown fields are refused');
  assert.equal(await bad({ kind: 'memory', data: { text: '  ' } }), 400, 'a memory needs text or a photo');
  assert.equal(await bad({ kind: 'memory', data: { text: 'hi' }, photoId: 'nope' }), 400);
  assert.equal(await bad({ kind: 'memory', data: { text: 'hi' }, memberId: 'nobody' }), 400);
  assert.equal(await bad({ kind: 'health', data: { type: 'spa' } }), 400);
  assert.equal(await bad({ kind: 'health', data: { weight: { value: 40, unit: 'stone' } } }), 400);
  assert.equal(await bad({ kind: 'health', data: { time: '9am' } }), 400);
  assert.equal(await bad({ kind: 'diary', data: {} }), 400);
  assert.equal(await bad({ kind: 'memory', date: '26-9-1', data: { text: 'hi' } }), 400);
  const ok = await send('POST', '/api/trackers', { kind: 'memory', data: { text: 'First snow!', mood: '❄️' } });
  assert.equal(ok.status, 201);
  assert.equal(ok.body.memberId, null, 'the family');
  const err = await send('PATCH', `/api/trackers/${ok.body.id}`, { data: { mood: 'x'.repeat(40) } });
  assert.equal(err.status, 400);
  assert.match(err.body.error, /^data\.mood/);
});

test('trackers: health fields, filters and search', async () => {
  const { send } = makeApp();
  const { maya, leo } = await family(send);
  const visit = await send('POST', '/api/trackers', {
    kind: 'health', memberId: leo.id, date: '2026-09-10', title: 'Six-year checkup',
    data: { type: 'checkup', provider: 'Dr. Patel', time: '09:30', height: { value: 45.5, unit: 'in' }, weight: { value: 46, unit: 'lb' }, followUp: '2027-09-10' },
  });
  assert.equal(visit.status, 201);
  assert.deepEqual(visit.body.data.height, { value: 45.5, unit: 'in' });
  await send('POST', '/api/trackers', { kind: 'memory', memberId: maya.id, date: '2025-09-26', data: { text: 'Beach day' } });
  await send('POST', '/api/trackers', { kind: 'memory', memberId: leo.id, date: '2026-09-26', data: { text: 'Lost a tooth' } });

  const leos = (await send('GET', `/api/trackers?memberId=${leo.id}`)).body;
  assert.deepEqual(leos.map((e: any) => e.kind), ['memory', 'health'], 'newest first');
  assert.equal((await send('GET', '/api/trackers?kind=memory&from=2026-01-01')).body.length, 1);
  assert.equal((await send('GET', '/api/trackers?kind=memory&to=2025-12-31')).body[0].data.text, 'Beach day');
  assert.equal((await send('GET', '/api/trackers?q=patel')).body[0].id, visit.body.id);
  assert.equal((await send('GET', '/api/trackers?q=100%25')).body.length, 0, 'LIKE wildcards are literal');

  // Removing a member keeps their entries, under their name - never quietly the family's.
  await send('DELETE', `/api/members/${leo.id}`);
  const kept = (await send('GET', '/api/trackers')).body;
  assert.equal(kept.length, 3);
  const leoVisit = kept.find((e: any) => e.id === visit.body.id);
  assert.deepEqual([leoVisit.memberId, leoVisit.formerMember], [null, 'Leo']);
  assert.equal(kept.find((e: any) => e.data.text === 'Beach day').formerMember, null, "others' untouched");
  assert.equal((await send('GET', '/api/trackers?q=leo')).body.length, 2, 'searchable by the former name');
  // Giving the entry to someone (or the family) settles it.
  assert.equal((await send('PATCH', `/api/trackers/${visit.body.id}`, { memberId: maya.id })).body.formerMember, null);
});

test('trackers: a memory has one photo; its own photo stays out of the family photos unless asked, and goes with it', async () => {
  const { send, upload } = makeApp();
  const familyPhotos = async () => (await send('GET', '/api/photos')).body.map((p: any) => p.id);
  const own = await upload(false);
  assert.deepEqual(await familyPhotos(), [], 'not listed (so not on the Photos page, Board or screensaver)');
  assert.equal((await send('GET', '/api/photos/quota')).body.memoryPhotos, 1, 'it still counts toward storage');

  const m = await send('POST', '/api/trackers', { kind: 'memory', photoId: own, data: { text: 'Beach' } });
  assert.equal(m.status, 201);
  assert.deepEqual([m.body.photoOwned, m.body.photoFamily], [true, false]);
  assert.equal((await send('POST', '/api/trackers', { kind: 'memory', photoId: [own, own], data: { text: 'x' } })).status, 400, 'one photo');
  assert.equal((await send('POST', '/api/trackers', { kind: 'memory', photoId: own, data: { text: 'x' } })).status, 400, "another memory's photo");
  assert.equal((await send('POST', '/api/trackers', { kind: 'reading', title: 'x', photoId: own })).status, 400, 'memories only');

  // The toggle: in and out of the family photos.
  assert.equal((await send('PATCH', `/api/trackers/${m.body.id}`, { photoFamily: true })).body.photoFamily, true);
  assert.deepEqual(await familyPhotos(), [own]);
  assert.equal((await send('PATCH', `/api/trackers/${m.body.id}`, { photoFamily: false })).body.photoFamily, false);
  assert.deepEqual(await familyPhotos(), []);

  // Replacing its own private photo deletes the old one; a picked family photo is only referenced.
  const shared = await upload(true);
  const swapped = (await send('PATCH', `/api/trackers/${m.body.id}`, { photoId: shared, photoFamily: false })).body;
  assert.deepEqual([swapped.photoOwned, swapped.photoFamily], [false, true], 'the toggle does nothing to a picked photo');
  assert.equal((await send('GET', `/api/photos/${own}/image`)).status, 404, 'the private one is gone');
  await send('DELETE', `/api/trackers/${m.body.id}`);
  assert.deepEqual(await familyPhotos(), [shared], 'a family photo outlives the memory');

  // Deleting a memory deletes its private photo, but not one it shared to the family.
  const p1 = await upload(false);
  const p2 = await upload(false);
  const a = (await send('POST', '/api/trackers', { kind: 'memory', photoId: p1, data: {} })).body;
  const b = (await send('POST', '/api/trackers', { kind: 'memory', photoId: p2, photoFamily: true, data: {} })).body;
  assert.equal(b.photoFamily, true);
  await send('DELETE', `/api/trackers/${a.id}`);
  await send('DELETE', `/api/trackers/${b.id}`);
  assert.equal((await send('GET', `/api/photos/${p1}/image`)).status, 404);
  assert.deepEqual((await familyPhotos()).sort(), [shared, p2].sort());
});

test('trackers: a display key reads and writes reading and memories, never health, and cannot delete', async () => {
  const { send } = makeApp();
  const { leo } = await family(send);
  const wall = (await send('POST', '/api/keys', { name: 'Kitchen', scope: 'display' })).body.key;
  const visit = (await send('POST', '/api/trackers', { kind: 'health', memberId: leo.id, data: { type: 'dentist' } })).body;

  const book = await send('POST', '/api/trackers', { kind: 'reading', memberId: leo.id, title: 'Dog Man', data: { totalPages: 240 } }, wall);
  assert.equal(book.status, 201);
  assert.equal((await send('PATCH', `/api/trackers/${book.body.id}`, { data: { pagesRead: 120 } }, wall)).body.data.pagesRead, 120);
  assert.equal((await send('POST', '/api/trackers', { kind: 'memory', data: { text: 'Pancakes!' } }, wall)).status, 201);
  assert.equal((await send('GET', '/api/trackers/summary', undefined, wall)).status, 200);

  const all = (await send('GET', '/api/trackers', undefined, wall)).body;
  assert.deepEqual(all.map((e: any) => e.kind).sort(), ['memory', 'reading'], 'health filtered out');
  assert.equal((await send('GET', '/api/trackers?kind=health', undefined, wall)).status, 403);
  assert.equal((await send('GET', `/api/trackers/${visit.id}`, undefined, wall)).status, 403);
  assert.equal((await send('GET', `/api/trackers?q=dentist`, undefined, wall)).body.length, 0);
  assert.equal((await send('POST', '/api/trackers', { kind: 'health', data: {} }, wall)).status, 403);
  assert.equal((await send('PATCH', `/api/trackers/${visit.id}`, { data: { notes: 'x' } }, wall)).status, 403);
  assert.equal((await send('DELETE', `/api/trackers/${book.body.id}`, undefined, wall)).status, 403);
  assert.equal((await send('DELETE', `/api/trackers/${visit.id}`, undefined, wall)).status, 403);
  assert.equal((await send('GET', `/api/trackers/${visit.id}`)).status, 200, 'still there for an admin');
});

test('trackers: on by default in the feature switches, and a round trip through export/import', async () => {
  const { send } = makeApp();
  const f = (await send('GET', '/api/settings')).body.features;
  assert.deepEqual([f.trackersReading, f.trackersMemories, f.trackersHealth], [true, true, true]);
  const { maya } = await family(send);
  await send('POST', '/api/trackers', { kind: 'reading', memberId: maya.id, title: 'Matilda', data: { rating: 4 } });
  const exported = (await send('GET', '/api/export')).body;
  assert.equal(exported.trackers.length, 1);

  const other = makeApp();
  const res = await other.send('POST', '/api/import', exported);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.imported.trackers, 1);
  assert.equal((await other.send('GET', '/api/trackers')).body[0].data.rating, 4);
});

test('trackers: per-kind switches; a saved one-switch "trackers: false" turns all three off', async () => {
  const { send, db } = makeApp();
  const off = (await send('GET', '/api/settings')).body.features;
  const res = await send('PATCH', '/api/settings', { features: { ...off, trackersHealth: false } });
  assert.deepEqual([res.body.features.trackersReading, res.body.features.trackersHealth], [true, false]);
  assert.equal((await send('POST', '/api/trackers', { kind: 'health', data: {} })).status, 201, 'the API keeps answering');
  db.prepare("UPDATE settings SET value = ? WHERE key = 'features'").bind(JSON.stringify({ ...off, trackersReading: undefined, trackersMemories: undefined, trackersHealth: undefined, trackers: false })).run();
  const legacy = (await send('GET', '/api/settings')).body.features;
  assert.deepEqual([legacy.trackersReading, legacy.trackersMemories, legacy.trackersHealth, legacy.trackers], [false, false, false, undefined]);
});
