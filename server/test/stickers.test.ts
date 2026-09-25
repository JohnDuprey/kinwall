import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { getRev } from '../src/bus.ts';
import { STICKER_PACKS } from '../src/stickers.ts';
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
  return { env, send };
}

// A member who has earned `points` today from one chore.
async function earner(send: ReturnType<typeof makeApp>['send'], name: string, points: number) {
  await send('PATCH', '/api/settings', { timezone: 'UTC' });
  const m = (await send('POST', '/api/members', { name, color: '#ff0000' })).body;
  if (points) {
    const today = new Date().toISOString().slice(0, 10);
    const chore = (await send('POST', '/api/chores', { title: `Job for ${name}`, memberId: m.id, points, dueDate: today })).body;
    assert.equal((await send('POST', `/api/chores/${chore.id}/complete`, { date: today })).status, 200);
  }
  return m as { id: string };
}

const balanceOf = async (send: ReturnType<typeof makeApp>['send'], id: string) => (await send('GET', '/api/members')).body.find((m: any) => m.id === id).balance;

test('stickers: packs are well-formed; the free pack is unlocked for everyone', async () => {
  const ids = STICKER_PACKS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of STICKER_PACKS) assert.ok(p.stickers.length >= 12 && p.stickers.length <= 16, p.id);
  const { send } = makeApp();
  const maya = await earner(send, 'Maya', 0);
  const packs = (await send('GET', `/api/stickers/packs?memberId=${maya.id}`)).body;
  assert.deepEqual(packs.filter((p: any) => p.unlocked).map((p: any) => p.id), ['animals']);
  assert.equal(packs.find((p: any) => p.id === 'dinosaurs').price, 20);
});

test('stickers: buying spends points (402 short, 409 owned), balance = earned + ledger, leaderboard keeps earned', async () => {
  const { env, send } = makeApp();
  const maya = await earner(send, 'Maya', 30);
  assert.equal(await balanceOf(send, maya.id), 30);

  const exact = await send('POST', '/api/stickers/packs/unicorns/buy', { memberId: maya.id });
  assert.equal(exact.status, 200); // exactly enough is enough
  assert.equal(await balanceOf(send, maya.id), 0);
  const broke = await send('POST', '/api/stickers/packs/sweets/buy', { memberId: maya.id });
  assert.deepEqual([broke.status, broke.body], [402, { error: 'Not enough points', balance: 0, price: 15 }]);
  assert.equal((await send('POST', '/api/stickers/packs/unicorns/buy', { memberId: maya.id })).status, 409);
  assert.equal((await send('POST', '/api/stickers/packs/animals/buy', { memberId: maya.id })).status, 409); // free from the start
  assert.equal((await send('POST', '/api/stickers/packs/nope/buy', { memberId: maya.id })).status, 404);
  assert.equal((await send('POST', '/api/stickers/packs/sweets/buy', { memberId: 'ghost' })).status, 404);

  // A positive ledger entry (future rewards/adjustments) adds to the balance but not the leaderboard.
  await env.DB.prepare("INSERT INTO point_entries (id, member_id, amount, reason, at) VALUES ('b', ?, 20, 'adjustment', '2026-01-01')").bind(maya.id).run();
  const bought = await send('POST', '/api/stickers/packs/sweets/buy', { memberId: maya.id });
  assert.deepEqual([bought.status, bought.body.balance, bought.body.pack.unlocked], [200, 5, true]);

  const points = (await send('GET', `/api/members/${maya.id}/points`)).body;
  assert.deepEqual([points.balance, points.earnedTotal, points.spentTotal], [5, 50, 45]);
  assert.deepEqual(points.entries.map((e: any) => [e.amount, e.reason, e.ref]), [[-15, 'sticker_pack', 'sweets'], [-30, 'sticker_pack', 'unicorns'], [20, 'adjustment', null]]);
  assert.equal((await send('GET', '/api/members/ghost/points')).status, 404);
  const [row] = (await send('GET', '/api/leaderboard')).body;
  assert.equal(row.points, 30);
});

test('stickers: price scale (0 = free), and the shop can be turned off', async () => {
  const { send } = makeApp();
  const leo = await earner(send, 'Leo', 0);
  await send('PATCH', '/api/settings', { stickerPriceScale: 50 });
  assert.equal((await send('GET', '/api/stickers/packs')).body.find((p: any) => p.id === 'space').price, 13); // 12.5 rounds up
  await send('PATCH', '/api/settings', { stickerPriceScale: 0 });
  const free = await send('POST', '/api/stickers/packs/space/buy', { memberId: leo.id });
  assert.deepEqual([free.status, free.body.balance, free.body.pack.price], [200, 0, 0]);
  assert.deepEqual((await send('GET', `/api/members/${leo.id}/points`)).body.entries, []); // nothing charged, nothing logged
  assert.equal((await send('PATCH', '/api/settings', { stickerPriceScale: 201 })).status, 400);

  await send('PATCH', '/api/settings', { stickersEnabled: false });
  assert.equal((await send('POST', '/api/stickers/packs/robots/buy', { memberId: leo.id })).status, 403);
});

test('stickers: scrapbook CRUD, only unlocked stickers, per-member pages; writes bump rev', async () => {
  const { env, send } = makeApp();
  const sam = await earner(send, 'Sam', 0);
  const alex = await earner(send, 'Alex', 0);
  const page = `/api/stickers/scrapbook/${sam.id}`;

  assert.equal((await send('POST', page, { sticker: '🦖' })).status, 403); // Dinosaurs not unlocked
  assert.equal((await send('POST', page, { sticker: 'x' })).status, 403);
  assert.equal((await send('POST', '/api/stickers/scrapbook/ghost', { sticker: '🐶' })).status, 404);
  const before = await getRev(env.DB);
  const dog = await send('POST', page, { sticker: '🐶' });
  assert.equal(dog.status, 201);
  assert.deepEqual([dog.body.x, dog.body.y, dog.body.scale, dog.body.rotation, dog.body.z], [0.5, 0.5, 1, 0, 1]);
  const cat = (await send('POST', page, { sticker: '🐱', x: 0.1, y: 0.9 })).body;
  assert.equal(cat.z, 2);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok((await getRev(env.DB)) > before);

  const moved = await send('PATCH', `${page}/${dog.body.id}`, { x: 0.3, scale: 2, rotation: -45, z: 3 });
  assert.deepEqual([moved.body.x, moved.body.y, moved.body.scale, moved.body.rotation, moved.body.z], [0.3, 0.5, 2, -45, 3]);
  assert.equal((await send('PATCH', `${page}/${dog.body.id}`, { x: 1.5 })).status, 400);
  assert.equal((await send('PATCH', `${page}/${dog.body.id}`, { scale: 10 })).status, 400);
  assert.equal((await send('PATCH', `/api/stickers/scrapbook/${alex.id}/${dog.body.id}`, { x: 0 })).status, 404); // someone else's sticker

  assert.deepEqual((await send('GET', page)).body.map((s: any) => s.sticker), ['🐱', '🐶']); // back to front
  assert.deepEqual((await send('GET', `/api/stickers/scrapbook/${alex.id}`)).body, []);
  assert.equal((await send('DELETE', `${page}/${cat.id}`)).status, 200);
  assert.equal((await send('DELETE', `${page}/${cat.id}`)).status, 404);
  assert.equal((await send('GET', page)).body.length, 1);

  // Deleting the member takes their page and ledger with them.
  await send('DELETE', `/api/members/${sam.id}`);
  const left = await env.DB.prepare('SELECT COUNT(*) AS n FROM scrapbook_stickers').first<{ n: number }>();
  assert.equal(left!.n, 0);
});

test('stickers: a display key can shop and decorate', async () => {
  const { send } = makeApp();
  const maya = await earner(send, 'Maya', 20);
  const { key } = (await send('POST', '/api/keys', { name: 'Wall', scope: 'display' })).body;
  assert.equal((await send('GET', `/api/members/${maya.id}/points`, undefined, key)).status, 200);
  assert.equal((await send('GET', `/api/stickers/packs?memberId=${maya.id}`, undefined, key)).status, 200);
  assert.equal((await send('POST', '/api/stickers/packs/dinosaurs/buy', { memberId: maya.id }, key)).status, 200);
  const rex = await send('POST', `/api/stickers/scrapbook/${maya.id}`, { sticker: '🦖' }, key);
  assert.equal(rex.status, 201);
  assert.equal((await send('GET', `/api/stickers/scrapbook/${maya.id}`, undefined, key)).status, 200);
  assert.equal((await send('PATCH', `/api/stickers/scrapbook/${maya.id}/${rex.body.id}`, { rotation: 15 }, key)).status, 200);
  assert.equal((await send('DELETE', `/api/stickers/scrapbook/${maya.id}/${rex.body.id}`, undefined, key)).status, 200);
});
