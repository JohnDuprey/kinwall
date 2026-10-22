// Home upkeep (routes/upkeep.ts, upkeep.ts, notify.ts runUpkeep): parents do everything; a kid's own
// device sees and marks its kid's jobs and its own history; a wall marks the jobs shown on it and
// has no history. Costs, serials, notes and files never reach either. Done moves the next due date;
// a kid's job becomes a chore whose tick logs it; supplies go on the shopping list once; the morning
// notes go out once each; webhooks carry no cost; the feature switch takes it all away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { runUpkeep } from '../src/notify.ts';
import { addDays } from '../src/upkeep-rules.ts';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO settings (key, value) VALUES ('timezone', 'UTC')").run();
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const background: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => background.push(p), passThroughOnException() {}, props: {} };
  const raw = (p: string, init: RequestInit, key = ADMIN) => app.request(p, { ...init, headers: { Authorization: `Bearer ${key}`, ...(init.headers as Record<string, string>) } }, env, ctx as never);
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await raw(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }, key);
    return { status: res.status, json: (await res.json()) as any };
  };
  const flush = async () => { while (background.length) await Promise.all(background.splice(0)); };
  const sent: { url: string; body: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
    sent.push({ url: String(url), body: typeof init.body === 'string' ? init.body : '' });
    return new Response('', { status: 201 });
  }) as typeof fetch;
  const restore = async () => { await flush(); globalThis.fetch = realFetch; };
  const events = () => sent.filter((s) => s.url.startsWith('https://hooks.example.com')).map((s) => JSON.parse(s.body) as { type: string; data: any });
  const device = async (name: string, kind: 'kid' | 'wall', owner?: string) => {
    const k = (await req('/api/keys', 'POST', { name, scope: 'display' })).json;
    assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { kind, owner: owner ?? 'shared' })).status, 200);
    return k.key as string;
  };
  const alex = (await req('/api/members', 'POST', { name: 'Alex', color: '#336699', grownUp: true })).json;
  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#996633' })).json;
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#339966' })).json;
  const today = new Date().toISOString().slice(0, 10);
  return { db, env, ctx: ctx as never, req, raw, flush, restore, events, alex, leo, maya, today, leoKey: await device("Leo's tablet", 'kid', leo.id), wallKey: await device('Kitchen wall', 'wall') };
}

test('upkeep: things and jobs, and what a wall or kid device sees of them', async () => {
  const t = await setup();
  try {
    const furnace = await t.req('/api/upkeep/things', 'POST', { name: 'Furnace', emoji: '🔥', areaId: 'ua-heating', room: 'Basement', brand: 'Acme', model: 'X1', serial: 'SN-123', priceCents: 450000, warrantyUntil: '2030-01-01', notes: 'Pilot on the left' });
    assert.equal(furnace.status, 201, JSON.stringify(furnace.json));
    const filter = await t.req('/api/upkeep/jobs', 'POST', { title: 'Change the furnace filter', thingId: furnace.json.id, every: 3, unit: 'month', startOn: t.today, usualCostCents: 2500, supplies: [{ name: 'Furnace filter 16x25x1' }], memberId: t.alex.id });
    assert.equal(filter.status, 201, JSON.stringify(filter.json));
    assert.deepEqual([filter.json.repeatKind, filter.json.nextDue, filter.json.status], ['after', t.today, 'due']);
    const smoke = (await t.req('/api/upkeep/jobs', 'POST', { title: 'Test the smoke alarms', every: 1, unit: 'month', startOn: addDays(t.today, 3), memberId: t.leo.id, chorePoints: 5 })).json;
    const hidden = (await t.req('/api/upkeep/jobs', 'POST', { title: 'Check the safe', every: 1, unit: 'year', wallVisible: false })).json;

    assert.equal((await t.req('/api/upkeep/jobs', 'POST', { title: 'Gutters', repeatKind: 'on', onMonths: [] })).status, 400);
    assert.equal((await t.req('/api/upkeep/jobs', 'POST', { title: 'Oil', every: 6 })).status, 400, 'after needs a unit');
    assert.equal((await t.req('/api/upkeep/jobs', 'POST', { title: 'Mow', every: 1, unit: 'week', chorePoints: 5, memberId: t.alex.id })).status, 400, 'only a kid gets chores');

    const wallJobs = (await t.req('/api/upkeep/jobs', 'GET', undefined, t.wallKey)).json;
    assert.deepEqual(wallJobs.map((j: any) => j.title).sort(), ['Change the furnace filter', 'Test the smoke alarms'], 'the wall leaves out jobs not shown on it');
    const wallFilter = wallJobs.find((j: any) => j.id === filter.json.id);
    assert.deepEqual([wallFilter.usualCostCents, wallFilter.supplies, wallFilter.contactId], [null, [], null]);
    assert.deepEqual((await t.req('/api/upkeep/jobs', 'GET', undefined, t.leoKey)).json.map((j: any) => j.id), [smoke.id], "a kid's device: its kid's jobs");
    assert.equal((await t.req(`/api/upkeep/jobs/${hidden.id}`, 'GET', undefined, t.wallKey)).status, 404);

    const wallThing = (await t.req(`/api/upkeep/things/${furnace.json.id}`, 'GET', undefined, t.wallKey)).json;
    assert.deepEqual([wallThing.name, wallThing.room, wallThing.serial, wallThing.priceCents, wallThing.warrantyUntil, wallThing.notes, wallThing.brand], ['Furnace', 'Basement', null, null, null, null, null]);
    assert.equal((await t.req(`/api/upkeep/things/${furnace.json.id}`)).json.serial, 'SN-123');

    assert.equal((await t.req('/api/upkeep/things', 'POST', { name: 'Car' }, t.wallKey)).status, 403, 'walls only mark done');
    assert.equal((await t.req(`/api/upkeep/jobs/${smoke.id}`, 'PATCH', { title: 'x' }, t.leoKey)).status, 403);
    assert.equal((await t.req('/api/upkeep/log', 'GET', undefined, t.wallKey)).status, 403, 'a wall has no history');

    // Selling the furnace puts its jobs away; deleting it keeps them.
    assert.equal((await t.req(`/api/upkeep/things/${furnace.json.id}`, 'PATCH', { archived: true })).json.archived, true);
    assert.equal((await t.req(`/api/upkeep/jobs/${filter.json.id}`)).json.archived, true);
    assert.equal((await t.req(`/api/upkeep/things/${furnace.json.id}`, 'PATCH', { archived: false })).status, 200);
    assert.equal((await t.req(`/api/upkeep/things/${furnace.json.id}`, 'DELETE')).status, 200);
    const kept = (await t.req(`/api/upkeep/jobs/${filter.json.id}`)).json;
    assert.deepEqual([kept.thingId, kept.archived], [null, false]);
  } finally { await t.restore(); }
});

test('upkeep: Done moves the next due date, keeps history, and Undo puts it back', async () => {
  const t = await setup();
  try {
    assert.equal((await t.req('/api/webhooks', 'POST', { url: 'https://hooks.example.com/k', events: [] })).status, 201);
    const job = (await t.req('/api/upkeep/jobs', 'POST', { title: 'Oil change', every: 6, unit: 'month', startOn: t.today })).json;
    const r = await t.req(`/api/upkeep/jobs/${job.id}/done`, 'POST', { costCents: 5400, reading: 48210, readingUnit: 'mi', notes: 'Synthetic' });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.entry.costCents, r.json.entry.reading, r.json.entry.memberId, r.json.job.status], [5400, 48210, null, 'later']);
    assert.equal(r.json.job.lastDone.doneOn, t.today);
    assert.ok(r.json.job.nextDue > t.today);

    // A wall marks it done for someone, but costs and notes from it don't count.
    const wall = await t.req(`/api/upkeep/jobs/${job.id}/done`, 'POST', { memberId: t.leo.id, costCents: 100, notes: 'x' }, t.wallKey);
    assert.equal(wall.status, 200, JSON.stringify(wall.json));
    assert.deepEqual([wall.json.entry.memberId, wall.json.entry.costCents], [t.leo.id, null]);
    const stored = (await t.req('/api/upkeep/log')).json.find((e: any) => e.id === wall.json.entry.id);
    assert.deepEqual([stored.costCents, stored.notes], [null, null], 'not saved either');
    assert.equal((await t.req(`/api/upkeep/jobs/${job.id}/done`, 'POST', { doneOn: addDays(t.today, -30) }, t.wallKey)).status, 400, 'old days are for a parent');
    assert.equal((await t.req(`/api/upkeep/jobs/${job.id}/done`, 'POST', { doneOn: addDays(t.today, 1) })).status, 400);
    assert.equal((await t.req(`/api/upkeep/log/${wall.json.entry.id}`, 'DELETE', undefined, t.wallKey)).status, 200, 'Undo');

    await t.flush();
    const done = t.events().filter((e) => e.type === 'upkeep.done');
    assert.equal(done.length, 2);
    assert.deepEqual(Object.keys(done[0].data).sort(), ['doneOn', 'id', 'jobId', 'memberId', 'thingId', 'title'], 'no cost, reading or notes');

    // History: costs stay on a parent's device; a parent fixes a Done.
    const log = (await t.req(`/api/upkeep/log?job=${job.id}`)).json;
    assert.deepEqual(log.map((e: any) => e.costCents), [5400]);
    assert.equal((await t.req(`/api/upkeep/log/${log[0].id}`, 'PATCH', { costCents: 5900 })).json.costCents, 5900);
    assert.equal((await t.req(`/api/upkeep/log?q=synth`)).json.length, 1, 'search reads notes');
    assert.equal((await t.req(`/api/upkeep/log/${log[0].id}`, 'DELETE')).status, 200);
    assert.equal((await t.req(`/api/upkeep/jobs/${job.id}`)).json.nextDue, t.today, 'back to due');

    // Delete the job: what was done stays.
    await t.req(`/api/upkeep/jobs/${job.id}/done`, 'POST', {});
    assert.equal((await t.req(`/api/upkeep/jobs/${job.id}`, 'DELETE')).status, 200);
    const left = (await t.req('/api/upkeep/log')).json;
    assert.deepEqual([left.length, left[0].jobId, left[0].title], [1, null, 'Oil change']);
  } finally { await t.restore(); }
});

test('upkeep: snooze and skip', async () => {
  const t = await setup();
  try {
    const job = (await t.req('/api/upkeep/jobs', 'POST', { title: 'Rotate the tires', every: 6, unit: 'month', startOn: t.today })).json;
    const later = addDays(t.today, 5);
    assert.equal((await t.req(`/api/upkeep/jobs/${job.id}/snooze`, 'POST', { until: later })).json.nextDue, later);
    const skipped = (await t.req(`/api/upkeep/jobs/${job.id}/skip`, 'POST')).json;
    assert.deepEqual([skipped.skippedUntil, skipped.snoozedUntil], [t.today, null]);
    assert.ok(skipped.nextDue > addDays(t.today, 150));
    const once = (await t.req('/api/upkeep/jobs', 'POST', { title: 'Fix the window', repeatKind: 'once', dueOn: t.today })).json;
    assert.equal((await t.req(`/api/upkeep/jobs/${once.id}/skip`, 'POST')).status, 400);
    const done = (await t.req(`/api/upkeep/jobs/${once.id}/done`, 'POST', {})).json;
    assert.deepEqual([done.job.nextDue, done.job.status], [null, 'done']);
  } finally { await t.restore(); }
});

test("upkeep: a kid's job becomes a chore; ticking it logs the job, and undoing takes it back", async () => {
  const t = await setup();
  try {
    const job = (await t.req('/api/upkeep/jobs', 'POST', { title: 'Test the smoke alarms', emoji: '🚨', every: 1, unit: 'month', startOn: t.today, memberId: t.leo.id, chorePoints: 5 })).json;
    const nine = new Date(`${t.today}T09:30:00Z`);
    await runUpkeep(t.env, t.env.DB, nine, 'UTC', t.ctx);
    await runUpkeep(t.env, t.env.DB, nine, 'UTC', t.ctx);
    const chores = (await t.req('/api/chores')).json.filter((c: any) => c.title === 'Test the smoke alarms');
    assert.equal(chores.length, 1, 'once');
    assert.deepEqual([chores[0].memberId, chores[0].points, chores[0].dueDate, chores[0].emoji], [t.leo.id, 5, t.today, '🚨']);
    assert.equal((await t.req(`/api/upkeep/jobs/${job.id}`)).json.handedChoreId, chores[0].id);

    const tick = await t.req(`/api/chores/${chores[0].id}/complete`, 'POST', { date: t.today }, t.leoKey);
    assert.equal(tick.status, 200, JSON.stringify(tick.json));
    const after = (await t.req(`/api/upkeep/jobs/${job.id}`)).json;
    assert.deepEqual([after.lastDone.doneOn, after.lastDone.memberId, after.status], [t.today, t.leo.id, 'later']);
    assert.equal((await t.req('/api/upkeep/log', 'GET', undefined, t.leoKey)).json.length, 1, 'Leo sees his own history');

    assert.equal((await t.req(`/api/chores/${chores[0].id}/complete?date=${t.today}`, 'DELETE', undefined, t.leoKey)).status, 200);
    assert.equal((await t.req(`/api/upkeep/jobs/${job.id}`)).json.lastDone, null);
  } finally { await t.restore(); }
});

test('upkeep: supplies go on the shopping list once, without doubling up', async () => {
  const t = await setup();
  try {
    const list = (await t.req('/api/lists', 'POST', { name: 'Hardware store', kind: 'shopping', catalog: 'shopping' })).json;
    await t.req(`/api/lists/${list.id}/items`, 'POST', { title: '9V batteries' });
    await t.req('/api/upkeep/jobs', 'POST', { title: 'Smoke alarm batteries', every: 1, unit: 'year', startOn: addDays(t.today, 5), suppliesDays: 7, suppliesListId: list.id, supplies: [{ name: '9V batteries' }, { name: 'Light bulbs' }] });
    await t.req('/api/upkeep/jobs', 'POST', { title: 'Far off', every: 1, unit: 'year', startOn: addDays(t.today, 60), suppliesListId: list.id, supplies: [{ name: 'Gutter guard' }] });
    const nine = new Date(`${t.today}T09:30:00Z`);
    await runUpkeep(t.env, t.env.DB, nine, 'UTC', t.ctx);
    await runUpkeep(t.env, t.env.DB, nine, 'UTC', t.ctx);
    const items = (await t.env.DB.prepare('SELECT title, notes FROM list_items WHERE list_id = ? ORDER BY sort').bind(list.id).all<{ title: string; notes: string | null }>()).results.map((r) => ({ ...r }));
    assert.deepEqual(items, [{ title: '9V batteries', notes: null }, { title: 'Light bulbs', notes: 'For Smoke alarm batteries' }]);
  } finally { await t.restore(); }
});

test('upkeep: morning notes go out once each, from 9 AM, to the right people', async () => {
  const t = await setup();
  try {
    assert.equal((await t.req('/api/webhooks', 'POST', { url: 'https://hooks.example.com/k', events: ['upkeep.due'] })).status, 201);
    await t.req('/api/upkeep/jobs', 'POST', { title: 'Flush the water heater', emoji: '🚿', every: 1, unit: 'year', startOn: addDays(t.today, 3), memberId: t.alex.id });
    await t.req('/api/upkeep/jobs', 'POST', { title: 'Clean the gutters', every: 6, unit: 'month', startOn: addDays(t.today, -20) });
    await t.req('/api/upkeep/things', 'POST', { name: 'Dishwasher', warrantyUntil: addDays(t.today, 10) });
    await runUpkeep(t.env, t.env.DB, new Date(`${t.today}T08:30:00Z`), 'UTC');
    const feed = () => t.env.DB.prepare("SELECT title, member_ids FROM notifications WHERE kind = 'upkeep' ORDER BY title").all<{ title: string; member_ids: string }>();
    assert.equal((await feed()).results.length, 0, 'not before 9');
    const nine = new Date(`${t.today}T09:01:00Z`);
    await runUpkeep(t.env, t.env.DB, nine, 'UTC', t.ctx);
    await runUpkeep(t.env, t.env.DB, nine, 'UTC', t.ctx);
    const rows = (await feed()).results;
    assert.equal(rows.length, 3, rows.map((r) => r.title).join(' | '));
    assert.ok(rows.some((r) => r.title === '🔧 Clean the gutters is 20 days late'));
    assert.ok(rows.some((r) => r.title.startsWith('🚿 Flush the water heater is due ')));
    assert.ok(rows.some((r) => r.title.startsWith('🧾 The warranty on Dishwasher ends ')));
    await t.flush();
    assert.equal(t.events().filter((e) => e.type === 'upkeep.due').length, 2);
  } finally { await t.restore(); }
});

test('upkeep: files are for parents, and walls never get them', async () => {
  const t = await setup();
  try {
    const thing = (await t.req('/api/upkeep/things', 'POST', { name: 'Fridge' })).json;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
    const up = await t.raw(`/api/upkeep/files?thing=${thing.id}`, { method: 'POST', body: png, headers: { 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('Receipt – May.png') } });
    assert.equal(up.status, 201);
    const file = (await up.json()) as any;
    assert.deepEqual([file.name, file.bytes], ['Receipt – May.png', 7]);
    assert.equal((await t.req(`/api/upkeep/things/${thing.id}`)).json.files.length, 1);
    const got = await t.raw(`/api/upkeep/files/${file.id}`, { method: 'GET' });
    assert.equal(got.status, 200);
    assert.deepEqual(new Uint8Array(await got.arrayBuffer()), png);
    assert.equal((await t.raw(`/api/upkeep/files/${file.id}`, { method: 'GET' }, t.wallKey)).status, 403);
    assert.equal((await t.raw(`/api/upkeep/files?thing=${thing.id}`, { method: 'POST', body: png, headers: { 'Content-Type': 'text/html' } })).status, 400);
    const token = (await t.req('/api/media-token')).json.token;
    const viaToken = await app_get(t, `/api/upkeep/files/${file.id}?key=${token}`);
    assert.equal(viaToken, 200, "a parent's media token opens it in an <img>");
    assert.equal((await t.req(`/api/upkeep/files/${file.id}`, 'DELETE')).status, 200);
  } finally { await t.restore(); }
});
async function app_get(t: Awaited<ReturnType<typeof setup>>, p: string) {
  const res = await createApp().request(p, { method: 'GET' }, t.env);
  return res.status;
}

test('upkeep: starters are offered once, in order', async () => {
  const t = await setup();
  try {
    const starters = (await t.req('/api/upkeep/starters')).json;
    assert.ok(starters.length >= 10);
    const added = await t.req('/api/upkeep/starters', 'POST', { keys: ['hvac-filter', 'gutters', 'nope'] });
    assert.equal(added.status, 201);
    assert.deepEqual(added.json.map((j: any) => j.libraryKey).sort(), ['gutters', 'hvac-filter']);
    const gutters = added.json.find((j: any) => j.libraryKey === 'gutters');
    assert.deepEqual([gutters.repeatKind, gutters.onMonths, gutters.onDay], ['on', [4, 10], 15]);
    assert.deepEqual(added.json.find((j: any) => j.libraryKey === 'hvac-filter').supplies, [{ name: 'Furnace filter' }]);
    assert.equal((await t.req('/api/upkeep/starters')).json.length, starters.length - 2);
    assert.equal((await t.req('/api/upkeep/starters', 'POST', { keys: ['gutters'] })).json.length, 0, 'not twice');
  } finally { await t.restore(); }
});

test('upkeep: turned off, every route answers 404 and nothing goes out', async () => {
  const t = await setup();
  try {
    await t.req('/api/upkeep/jobs', 'POST', { title: 'Clean the gutters', every: 6, unit: 'month', startOn: addDays(t.today, -20) });
    const features = (await t.req('/api/settings')).json.features;
    assert.equal(features.upkeep, true, 'on by default');
    assert.equal((await t.req('/api/settings', 'PATCH', { features: { ...features, upkeep: false } })).status, 200);
    assert.equal((await t.req('/api/upkeep/jobs')).status, 404);
    assert.equal((await t.req('/api/upkeep/things')).status, 404);
    const { runNotifications } = await import('../src/notify.ts');
    await runNotifications(t.env, new Date(`${t.today}T09:30:00Z`));
    assert.equal((await t.env.DB.prepare("SELECT count(*) AS n FROM notifications WHERE kind = 'upkeep'").first<{ n: number }>())!.n, 0);
  } finally { await t.restore(); }
});

test('upkeep: the export and the photo backup zip bring it all back', async () => {
  const a = await setup();
  let file: any, zip: Uint8Array;
  try {
    const thing = (await a.req('/api/upkeep/things', 'POST', { name: 'Fridge', areaId: 'ua-kitchen', serial: 'F-9' })).json;
    const job = (await a.req('/api/upkeep/jobs', 'POST', { title: 'Change the water filter', thingId: thing.id, every: 6, unit: 'month', startOn: a.today, memberId: a.alex.id, supplies: [{ name: 'Water filter' }] })).json;
    const done = (await a.req(`/api/upkeep/jobs/${job.id}/done`, 'POST', { costCents: 3999, notes: 'Model WF-2' })).json;
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 9, 9]);
    assert.equal((await a.raw(`/api/upkeep/files?entry=${done.entry.id}`, { method: 'POST', body: png, headers: { 'Content-Type': 'image/png', 'X-File-Name': 'receipt.png' } })).status, 201);
    file = (await a.req('/api/export')).json;
    assert.deepEqual([file.upkeepThings.length, file.upkeepJobs.length, file.upkeepLog.length, file.upkeepAreas.length], [1, 1, 1, 7]);
    assert.equal('files' in file.upkeepLog[0], false, 'files stay in the zip');
    zip = new Uint8Array(await (await a.raw('/api/photos/export.zip', { method: 'GET' })).arrayBuffer());
  } finally { await a.restore(); }

  const b = await setup();
  try {
    const imported = await b.req('/api/import', 'POST', file);
    assert.equal(imported.status, 200, JSON.stringify(imported.json));
    assert.equal(imported.json.imported.upkeep, 3);
    const [job] = (await b.req('/api/upkeep/jobs')).json;
    assert.deepEqual([job.title, job.supplies, job.lastDone?.doneOn, job.memberId], ['Change the water filter', [{ name: 'Water filter' }], b.today, file.upkeepJobs[0].memberId], 'members come with the file');
    const back = await b.raw('/api/photos/import', { method: 'POST', body: zip! as Uint8Array<ArrayBuffer>, headers: { 'Content-Type': 'application/zip' } });
    assert.deepEqual(await back.json(), { imported: 0, skipped: 0, upkeepFiles: 1 });
    const [entry] = (await b.req('/api/upkeep/log')).json;
    assert.deepEqual([entry.costCents, entry.notes, entry.files.map((f: any) => f.name)], [3999, 'Model WF-2', ['receipt.png']]);
  } finally { await b.restore(); }
});
