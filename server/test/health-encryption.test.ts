// Health data is encrypted at rest (AGENTS.md "Health data"): a health entry's title and fields are
// sealed with the family's ENCRYPTION_KEY (enc:v1:...), existing plaintext entries are sealed by a
// runtime pass (sealHealthEntries, run once per server instance by createKinwall), writes fail closed
// without a key, and no health body ever reaches the logs or a webhook.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { createKinwall } from '../src/entry.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { seal, unseal } from '../src/crypto.ts';
import { sealHealthEntries } from '../src/routes/trackers.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const KEY = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
// Distinctive strings that must never show up in the database, the logs or a webhook.
const NOTES = 'zz-secret-cavity-notes';
const PROVIDER = 'zz-secret-provider';
const TITLE = 'zz-secret-dentist-visit';

function makeApp(extra: Partial<Env> = {}) {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: KEY, ...extra };
  const app = createApp();
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException() {}, props: {} } as unknown as ExecutionContext;
  const send = async (method: string, p: string, body?: unknown) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' } }, env, ctx);
    return { status: res.status, body: (await res.json()) as any };
  };
  const raw = (id?: string) =>
    db.prepare(`SELECT id, kind, title, data FROM tracker_entries ${id ? 'WHERE id = ?' : 'ORDER BY id'}`).bind(...(id ? [id] : [])).all<{ id: string; kind: string; title: string | null; data: string }>().results;
  const settle = () => Promise.all(pending.splice(0));
  return { send, db, env, raw, settle };
}

const visit = { kind: 'health', date: '2026-09-10', title: TITLE, data: { type: 'dentist', provider: PROVIDER, notes: NOTES, time: '09:30', weight: { value: 46, unit: 'lb' }, temperature: { value: 99.1, unit: 'F' }, followUp: '2027-03-10' } };

test('health encryption: seal/unseal round-trips with a versioned prefix, a fresh IV and the row bound in', async () => {
  const env = { ENCRYPTION_KEY: KEY };
  const a = await seal(env, 'Dentist: cavity', 'row1:title');
  const b = await seal(env, 'Dentist: cavity', 'row1:title');
  assert.match(a, /^enc:v1:/);
  assert.notEqual(a, b, 'random IV per value');
  assert.equal(await unseal(env, a, 'row1:title'), 'Dentist: cavity');
  await assert.rejects(unseal(env, a, 'row2:title'), 'a sealed value cannot be moved to another row or column');
  assert.equal(await unseal(env, 'plain', 'row1:title'), 'plain', 'plaintext (not yet sealed) reads as is');
  await assert.rejects(seal({}, 'x', 'row1:title'), /ENCRYPTION_KEY/);
});

test('health encryption: the stored row holds no plaintext after create and update; the API reads it back', async () => {
  const { send, raw } = makeApp();
  const created = await send('POST', '/api/trackers', visit);
  assert.equal(created.status, 201);
  assert.equal(created.body.title, TITLE);
  assert.deepEqual(created.body.data, visit.data);
  const noPlaintext = (label: string) => {
    const [row] = raw(created.body.id);
    assert.match(row.title!, /^enc:v1:/, label);
    assert.match(row.data, /^enc:v1:/, label);
    for (const s of [TITLE, NOTES, PROVIDER, 'dentist', '99.1', '2027-03-10', '09:30']) assert.equal(JSON.stringify(row).includes(s), false, `${label}: ${s}`);
  };
  noPlaintext('create');

  const edited = await send('PATCH', `/api/trackers/${created.body.id}`, { title: `${TITLE} 2`, data: { notes: `${NOTES} 2`, weight: null } });
  assert.equal(edited.status, 200);
  assert.deepEqual([edited.body.title, edited.body.data.notes, edited.body.data.weight, edited.body.data.provider], [`${TITLE} 2`, `${NOTES} 2`, undefined, PROVIDER]);
  noPlaintext('update');

  const one = await send('GET', `/api/trackers/${created.body.id}`);
  assert.deepEqual([one.body.title, one.body.data.notes], [`${TITLE} 2`, `${NOTES} 2`]);
  const list = (await send('GET', '/api/trackers?kind=health')).body;
  assert.deepEqual(list.map((e: any) => e.data.provider), [PROVIDER]);
  // Search still finds health entries by their (encrypted) title and fields.
  assert.equal((await send('GET', `/api/trackers?q=${PROVIDER.toUpperCase()}`)).body.length, 1);
  assert.equal((await send('GET', '/api/trackers?q=cavity-notes 2')).body.length, 1);
  assert.equal((await send('GET', '/api/trackers?q=nothing-like-this')).body.length, 0);

  // Reading and memories stay plaintext (not health data).
  const book = await send('POST', '/api/trackers', { kind: 'reading', title: 'Matilda', data: { author: 'Roald Dahl' } });
  assert.equal(raw(book.body.id)[0].title, 'Matilda');
});

test('health encryption: the runtime pass seals existing plaintext entries once, survives interruption, and leaves reading and memories alone', async () => {
  const { send, db, env, raw } = makeApp();
  const insert = (id: string, kind: string, title: string | null, data: object) =>
    db.prepare("INSERT INTO tracker_entries (id, kind, date, title, data, created_at, updated_at) VALUES (?, ?, '2026-01-01', ?, ?, '', '')").bind(id, kind, title, JSON.stringify(data)).run();
  for (let i = 0; i < 130; i++) insert(`h${String(i).padStart(3, '0')}`, 'health', i % 2 ? `${TITLE} ${i}` : null, { type: 'checkup', notes: `${NOTES} ${i}` });
  insert('r1', 'reading', 'Matilda', { status: 'reading' });
  insert('m1', 'memory', 'Beach', { text: 'Sand castles' });
  const others = raw().filter((r) => r.kind !== 'health');

  // An interrupted earlier pass: h000 is already sealed (its data), h001 half-sealed (title only).
  const [h0, h1] = raw().filter((r) => r.id === 'h000' || r.id === 'h001');
  const h0data = await seal(env, h0.data, 'h000:data');
  const h1title = await seal(env, h1.title!, 'h001:title');
  db.prepare("UPDATE tracker_entries SET data = ? WHERE id = 'h000'").bind(h0data).run();
  db.prepare("UPDATE tracker_entries SET title = ? WHERE id = 'h001'").bind(h1title).run();

  // Two passes racing (two requests, two isolates) never double-seal.
  await Promise.all([sealHealthEntries(env), sealHealthEntries(env)]);
  const sealed = raw().filter((r) => r.kind === 'health');
  assert.equal(sealed.length, 130);
  for (const r of sealed) {
    assert.match(r.data, /^enc:v1:/);
    if (r.title !== null) assert.match(r.title, /^enc:v1:/);
    assert.equal(JSON.stringify(r).includes(NOTES), false);
  }
  assert.equal(raw('h000')[0].data, h0data, 'already sealed: untouched');
  assert.equal(raw('h001')[0].title, h1title, 'already sealed: untouched');
  assert.deepEqual(raw().filter((r) => r.kind !== 'health'), others, 'reading and memories untouched');

  // Idempotent: another pass changes nothing.
  const before = raw();
  await sealHealthEntries(env);
  assert.deepEqual(raw(), before);

  // Everything still reads back, exactly.
  const list = (await send('GET', '/api/trackers?kind=health&limit=1000')).body;
  assert.equal(list.length, 130);
  const e7 = list.find((e: any) => e.id === 'h007');
  assert.deepEqual([e7.title, e7.data.notes], [`${TITLE} 7`, `${NOTES} 7`]);
  assert.equal(list.find((e: any) => e.id === 'h000').data.notes, `${NOTES} 0`);
  assert.equal(list.find((e: any) => e.id === 'h001').title, `${TITLE} 1`);
});

test('health encryption: createKinwall seals existing entries before serving (Node, Worker and hosted Durable Objects)', async () => {
  const dir = MIGRATIONS_DIR;
  const migrations = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((name) => ({ name, sql: readFileSync(path.join(dir, name), 'utf8') }));
  const db = openDb(':memory:');
  applyMigrations(db, dir);
  db.prepare("INSERT INTO tracker_entries (id, kind, date, title, data, created_at, updated_at) VALUES ('h', 'health', '2026-01-01', ?, ?, '', '')").bind(TITLE, JSON.stringify({ notes: NOTES })).run();
  for (const opts of [{}, { migrations }]) {
    const kinwall = createKinwall({ DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: KEY }, opts);
    const res = await kinwall.fetch(new Request('http://x/api/trackers/h', { headers: { Authorization: `Bearer ${ADMIN_KEY}` } }));
    const row = db.prepare("SELECT title, data FROM tracker_entries WHERE id = 'h'").first<{ title: string; data: string }>()!;
    assert.match(row.title, /^enc:v1:/);
    assert.match(row.data, /^enc:v1:/);
    assert.deepEqual([((await res.json()) as any).title], [TITLE]);
  }
});

test('health encryption: without ENCRYPTION_KEY, health writes fail closed and nothing is stored; the rest keeps working', async () => {
  const { send, raw, env } = makeApp({ ENCRYPTION_KEY: undefined });
  const res = await send('POST', '/api/trackers', visit);
  assert.equal(res.status, 500);
  assert.match(res.body.error, /ENCRYPTION_KEY/);
  assert.deepEqual(raw(), [], 'no plaintext row');
  assert.equal((await send('POST', '/api/trackers', { kind: 'reading', title: 'Matilda' })).status, 201);

  // An existing plaintext entry: editing it fails closed too (and leaves it as it was); the
  // runtime pass waits for a key instead of failing every request.
  env.DB.prepare("INSERT INTO tracker_entries (id, kind, date, title, data, created_at, updated_at) VALUES ('h', 'health', '2026-01-01', 'Checkup', '{}', '', '')").run();
  assert.equal((await send('PATCH', '/api/trackers/h', { data: { notes: NOTES } })).status, 500);
  assert.equal(raw('h')[0].data, '{}');
  await sealHealthEntries(env);
  assert.equal(raw('h')[0].title, 'Checkup');
});

test('health encryption: the export is the family\'s plaintext backup; importing it seals health again', async () => {
  const a = makeApp();
  await a.send('POST', '/api/trackers', visit);
  await a.send('POST', '/api/trackers', { kind: 'reading', title: 'Matilda' });
  const exported = (await a.send('GET', '/api/export')).body;
  const h = exported.trackers.find((t: any) => t.kind === 'health');
  assert.deepEqual([h.title, h.data.notes], [TITLE, NOTES], 'decrypted in the export');

  const b = makeApp();
  const res = await b.send('POST', '/api/import', exported);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const [row] = b.raw(h.id);
  assert.match(row.title!, /^enc:v1:/);
  assert.match(row.data, /^enc:v1:/);
  assert.equal(JSON.stringify(b.raw()).includes(NOTES), false);
  assert.equal((await b.send('GET', `/api/trackers/${h.id}`)).body.data.notes, NOTES);

  // Without a key, an import with health entries is refused before anything is written.
  const c = makeApp({ ENCRYPTION_KEY: undefined });
  assert.equal((await c.send('POST', '/api/import', exported)).status, 500);
  assert.deepEqual(c.raw(), []);
});

test('health encryption: health bodies never reach the logs (create, update, invalid and failing requests)', async () => {
  const lines: string[] = [];
  const methods = ['log', 'info', 'warn', 'error', 'debug'] as const;
  const saved = methods.map((m) => console[m]);
  for (const m of methods) console[m] = (...args: unknown[]) => { lines.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : typeof a === 'string' ? a : JSON.stringify(a))).join(' ')); };
  try {
    const { send } = makeApp();
    const created = await send('POST', '/api/trackers', visit);
    await send('PATCH', `/api/trackers/${created.body.id}`, { data: { notes: `${NOTES} again` } });
    await send('POST', '/api/trackers', { ...visit, data: { ...visit.data, type: NOTES } }); // 400
    await send('PATCH', `/api/trackers/${created.body.id}`, { data: { notes: 'x'.repeat(5000) + NOTES } }); // 400
    const noKey = makeApp({ ENCRYPTION_KEY: undefined });
    await noKey.send('POST', '/api/trackers', visit); // 500
    await sealHealthEntries(noKey.env);
    assert.ok(lines.length > 0, 'the failing request was logged');
  } finally {
    methods.forEach((m, i) => { console[m] = saved[i]; });
  }
  for (const s of [NOTES, PROVIDER, TITLE]) assert.equal(lines.join('\n').includes(s), false, s);
});

test('health encryption: webhooks hear that a health entry changed, never its contents', async () => {
  const realFetch = globalThis.fetch;
  const sent: string[] = [];
  globalThis.fetch = (async (_url: unknown, init: RequestInit = {}) => { sent.push(String(init.body)); return new Response('ok'); }) as typeof fetch;
  try {
    const { send, settle } = makeApp();
    assert.equal((await send('POST', '/api/webhooks', { url: 'https://hooks.example.com/k', events: [] })).status, 201);
    const created = await send('POST', '/api/trackers', visit);
    await send('PATCH', `/api/trackers/${created.body.id}`, { data: { notes: `${NOTES} 2` } });
    await settle();
    const tracker = sent.filter((b) => b.includes('tracker.changed'));
    assert.equal(tracker.length, 2);
    for (const s of [NOTES, PROVIDER, TITLE, 'dentist']) assert.equal(sent.join('\n').includes(s), false, s);
  } finally {
    globalThis.fetch = realFetch;
  }
});
