// Newscast (routes/newscast.ts): what the family did and shared, derived at read time, plus
// announcements and reactions. Covers each item type, what never appears, who sees what,
// reactions, moderation and retention.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { pruneNewscast } from '../src/routes/newscast.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

const day = (n = 0) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const at = (n = 0, hh = '12') => `${day(n)}T${hh}:00:00.000Z`;

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const raw = (method: string, p: string, body?: unknown, key = ADMIN_KEY) =>
    Promise.resolve(app.request(p, { method, headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env));
  const send = async (method: string, p: string, body?: unknown, key?: string) => {
    const res = await raw(method, p, body, key);
    return { status: res.status, body: (await res.json()) as any };
  };
  const sql = (q: string, ...binds: unknown[]) => env.DB.prepare(q).bind(...binds).run();
  const device = async (name: string, scope: 'admin' | 'display', kind: 'kid' | 'wall' | 'grownup', owner?: string) => {
    const k = (await send('POST', '/api/keys', { name, scope })).body;
    assert.equal((await raw('PATCH', `/api/keys/${k.id}`, { kind, owner: owner ?? 'shared' })).status, 200);
    return k.key as string;
  };
  await send('PATCH', '/api/settings', { timezone: 'UTC' });
  const alex = (await send('POST', '/api/members', { name: 'Alex', color: '#336699', grownUp: true })).body;
  const sam = (await send('POST', '/api/members', { name: 'Sam', color: '#993366', grownUp: true })).body;
  const maya = (await send('POST', '/api/members', { name: 'Maya', color: '#339966' })).body;
  const leo = (await send('POST', '/api/members', { name: 'Leo', color: '#996633' })).body;
  const feed = async (key?: string, q = '') => {
    const r = await send('GET', `/api/newscast${q}`, undefined, key);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body as { today: string; from: string; to: string; earlier: boolean; items: any[] };
  };
  const chore = async (title: string, memberId: string, date: string, status = 'approved', completedAt = `${date}T15:00:00.000Z`) => {
    const id = crypto.randomUUID();
    await sql('INSERT INTO chores (id, title, emoji, member_id, points, created_at) VALUES (?,?,?,?,?,?)', id, title, '🧹', memberId, 1, at(-40));
    await sql('INSERT INTO chore_completions (id, chore_id, date, member_id, completed_at, status, points_awarded) VALUES (?,?,?,?,?,?,1)', crypto.randomUUID(), id, date, memberId, completedAt, status);
    return id;
  };
  const photo = async (q: string, key = ADMIN_KEY) => {
    const res = await app.request(`/api/photos${q}`, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'image/png', 'X-Photo-Width': '10', 'X-Photo-Height': '10' }, body: new Uint8Array([1, 2, 3]) }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  return {
    env, raw, send, sql, feed, chore, photo, alex, sam, maya, leo,
    leoKey: await device("Leo's tablet", 'display', 'kid', leo.id),
    mayaKey: await device("Maya's tablet", 'display', 'kid', maya.id),
    wallKey: await device('Kitchen wall', 'display', 'wall'),
    alexKey: await device("Alex's phone", 'admin', 'grownup', alex.id),
  };
}

const byKey = (items: any[]) => new Map(items.map((i) => [i.key, i]));

test('newscast: chores grouped per person per day (grown-ups too), rewards, photos, drawings, books, memories, birthdays', async () => {
  const t = await setup();
  const { leo, maya, alex, sam } = t;
  await t.chore('Feed the cat', leo.id, day(0), 'approved', at(0, '09'));
  await t.chore('Make bed', leo.id, day(0), 'approved', at(0, '10'));
  await t.chore('Toys away', leo.id, day(0), 'pending'); // waiting for a parent: not news yet
  await t.chore('Water plants', leo.id, day(-1));
  await t.chore('Mow the lawn', alex.id, day(0)); // grown-ups' chores count too
  await t.sql("INSERT INTO reward_redemptions (id, member_id, title, emoji, cost, status, date, requested_at, given_at) VALUES ('r1', ?, 'Ice cream trip', '🍦', 20, 'given', ?, ?, ?)", maya.id, day(-1), at(-2), at(-1, '19'));
  // Photos: two from Alex's own phone, one from the wall (nobody's), a drawing, and a memory's own photo.
  assert.equal((await t.photo('?caption=Apple%20picking', t.alexKey)).status, 201);
  await t.photo('', t.alexKey);
  await t.photo('?caption=Wall%20pic', t.wallKey);
  const drawing = await t.photo(`?caption=Rocket%20by%20Maya&drawing=1&by=${maya.id}`, t.wallKey);
  assert.equal(drawing.status, 201);
  assert.equal((await t.photo('?family=0')).status, 201);
  assert.equal((await t.photo(`?drawing=1&by=${maya.id}`, t.leoKey)).status, 403, "a kid's device can't credit someone else's drawing");
  const book = await t.send('POST', '/api/trackers', { kind: 'reading', memberId: maya.id, title: "Charlotte's Web", data: { status: 'finished', finishedOn: day(0), rating: 5 } });
  assert.equal(book.status, 201);
  await t.send('POST', '/api/trackers', { kind: 'reading', memberId: maya.id, title: 'Still reading', data: { status: 'reading' } });
  const memory = await t.send('POST', '/api/trackers', { kind: 'memory', memberId: sam.id, date: day(-2), title: 'First frost on the pumpkins', data: { text: 'The words stay in Memories' } });
  assert.equal(memory.status, 201);
  await t.send('PATCH', `/api/members/${maya.id}`, { birthday: `2018-${day(0).slice(5)}` });

  const { items, today } = await t.feed();
  assert.equal(today, day(0));
  const k = byKey(items);
  const leoToday = k.get(`chores:${leo.id}:${day(0)}`);
  assert.equal(leoToday.title, 'Leo finished 2 chores');
  assert.equal(leoToday.detail, 'Feed the cat · Make bed');
  assert.equal(leoToday.count, 2);
  assert.equal(leoToday.at, at(0, '10'));
  assert.equal(k.get(`chores:${leo.id}:${day(-1)}`).title, 'Leo finished Water plants');
  assert.equal(k.get(`chores:${alex.id}:${day(0)}`).title, 'Alex finished Mow the lawn');
  assert.ok(!JSON.stringify(items).includes('Toys away'), 'pending completions stay out');
  assert.equal(k.get('reward:r1').title, 'Maya got a reward: 🍦 Ice cream trip');
  assert.equal(k.get('reward:r1').date, day(-1));
  const alexPhotos = k.get(`photos:${alex.id}:${day(0)}`);
  assert.equal(alexPhotos.title, 'Alex added 2 photos');
  assert.equal(alexPhotos.detail, '“Apple picking”');
  assert.equal(alexPhotos.photos.length, 2);
  assert.equal(k.get(`photos:family:${day(0)}`).title, 'A new photo');
  assert.equal(k.get(`drawings:${maya.id}:${day(0)}`).title, 'Maya saved a drawing: “Rocket”');
  assert.equal(items.filter((i) => i.kind === 'photos').reduce((n, i) => n + i.photos.length, 0), 3, "a memory's own photo isn't a family photo");
  assert.equal(k.get(`book:${book.body.id}`).title, "Maya finished Charlotte's Web");
  assert.equal(k.get(`book:${book.body.id}`).detail, '⭐⭐⭐⭐⭐');
  assert.ok(!items.some((i) => i.title.includes('Still reading')));
  const mem = k.get(`memory:${memory.body.id}`);
  assert.equal(mem.title, 'Sam added a memory');
  assert.equal(mem.detail, '“First frost on the pumpkins”');
  assert.ok(!JSON.stringify(items).includes('The words stay'), "a memory's headline only, never its words");
  assert.match(k.get(`birthday:${maya.id}:${day(0)}`).title, /Maya/);
  // Newest day first; within a day, newest first.
  const dates = items.map((i) => i.date);
  assert.deepEqual(dates, [...dates].sort().reverse());
  assert.ok(items.every((i) => Array.isArray(i.reactions)));
});

test('newscast: rewards stay out while rewards are turned off (rewardsEnabled)', async () => {
  const t = await setup();
  await t.sql("INSERT INTO reward_redemptions (id, member_id, title, emoji, cost, status, date, requested_at, given_at) VALUES ('r1', ?, 'Ice cream trip', '🍦', 20, 'given', ?, ?, ?)", t.maya.id, day(-1), at(-2), at(-1, '19'));
  assert.ok(byKey((await t.feed()).items).has('reward:r1'));
  await t.send('PATCH', '/api/settings', { rewardsEnabled: false });
  assert.ok(!byKey((await t.feed()).items).has('reward:r1'));
});

test('newscast: health, journals, check-ins, goals, medications, messages, rejections, declines and points never appear', async () => {
  const t = await setup();
  const { leo, maya } = t;
  const health = await t.send('POST', '/api/trackers', { kind: 'health', memberId: leo.id, title: 'SECRET-health', data: { type: 'checkup', notes: 'SECRET-health-notes' } });
  assert.equal(health.status, 201);
  assert.equal((await t.send('POST', `/api/members/${maya.id}/journal`, { text: 'SECRET-journal', mood: '🙂' })).status, 201);
  await t.send('PATCH', '/api/settings', { medications: true });
  await t.send('POST', '/api/medications', { memberId: leo.id, name: 'SECRET-med', times: ['08:00'] });
  await t.send('POST', '/api/notify', { title: 'SECRET-message', body: 'SECRET-message-body' });
  await t.send('POST', `/api/members/${leo.id}/check-in`, {});
  const rejected = await t.chore('SECRET-rejected-chore', leo.id, day(-1), 'pending');
  await t.sql("INSERT INTO chore_rejections (chore_id, date, member_id, note, rejected_at) VALUES (?, ?, ?, 'SECRET-rejection-note', ?)", rejected, day(0), leo.id, at(0));
  await t.sql("INSERT INTO reward_redemptions (id, member_id, title, emoji, cost, status, date, requested_at, decided_at) VALUES ('r2', ?, 'SECRET-declined', '🎮', 50, 'declined', ?, ?, ?)", leo.id, day(0), at(0), at(0));
  await t.sql("INSERT INTO reward_redemptions (id, member_id, title, emoji, cost, status, date, requested_at) VALUES ('r3', ?, 'SECRET-requested', '🎮', 50, 'pending', ?, ?)", leo.id, day(0), at(0));
  await t.chore('Make bed', leo.id, day(0));

  for (const key of [undefined, t.alexKey, t.leoKey, t.wallKey]) {
    const { items } = await t.feed(key);
    const text = JSON.stringify(items);
    assert.doesNotMatch(text, /SECRET/, text);
    assert.doesNotMatch(text, /point|balance/i);
    assert.ok(items.every((i) => ['post', 'chores', 'reward', 'photos', 'drawings', 'book', 'memory', 'birthday'].includes(i.kind)));
    assert.ok(items.some((i) => i.title === 'Leo finished Make bed'));
  }
});

test('newscast: kids and walls never see grown-ups-only posts; Not featured hides a person; features switch items off', async () => {
  const t = await setup();
  const { alex, leo, maya } = t;
  await t.chore('Make bed', leo.id, day(0));
  await t.chore('Set the table', maya.id, day(0));
  const everyone = await t.send('POST', '/api/newscast/posts', { text: 'Pizza night moves to Friday 🍕' }, t.alexKey);
  assert.equal(everyone.status, 201);
  assert.equal(everyone.body.memberId, alex.id, "a grown-up's own device posts as them");
  const parentsOnly = await t.send('POST', '/api/newscast/posts', { text: 'Birthday gift ideas for Leo', audience: 'grownups' }, t.alexKey);
  assert.equal(parentsOnly.status, 201);
  assert.equal((await t.send('POST', '/api/newscast/posts', { text: 'Secret club', audience: 'grownups' }, t.leoKey)).status, 400);

  const has = (items: any[], id: string) => items.some((i) => i.key === `post:${id}`);
  for (const key of [t.leoKey, t.mayaKey, t.wallKey]) {
    const { items } = await t.feed(key);
    assert.ok(has(items, everyone.body.post.id));
    assert.ok(!has(items, parentsOnly.body.post.id), 'grown-ups only stays off kids devices and walls');
    assert.ok(items.some((i) => i.key === `chores:${maya.id}:${day(0)}`), "an item about one person is family news");
  }
  assert.ok(has((await t.feed(t.alexKey)).items, parentsOnly.body.post.id));
  assert.ok(has((await t.feed()).items, parentsOnly.body.post.id));

  // Not featured: none of Leo's derived items, anywhere. Only a parent's device sets it.
  assert.equal((await t.send('PATCH', '/api/settings', { newscastNotFeatured: [leo.id] }, t.leoKey)).status, 403);
  assert.equal((await t.send('PATCH', '/api/settings', { newscastNotFeatured: [leo.id] })).status, 200);
  for (const key of [undefined, t.leoKey, t.wallKey]) assert.ok(!(await t.feed(key)).items.some((i) => i.memberId === leo.id));

  // Feature switches: chores off, no chore items; Newscast off, the routes answer 404.
  await t.send('PATCH', '/api/settings', { features: { ...(await t.send('GET', '/api/settings')).body.features, chores: false } });
  assert.ok(!(await t.feed()).items.some((i) => i.kind === 'chores'));
  const features = (await t.send('GET', '/api/settings')).body.features;
  assert.equal(features.newscast, true, 'on by default');
  await t.send('PATCH', '/api/settings', { features: { ...features, newscast: false } });
  assert.equal((await t.send('GET', '/api/newscast')).status, 404);
  assert.equal((await t.send('POST', '/api/newscast/posts', { text: 'hi' }, t.alexKey)).status, 404);
});

test('newscast: posts are 280 characters, no links, one family photo, and a person posts as themselves', async () => {
  const t = await setup();
  const { leo, maya, sam } = t;
  assert.equal((await t.send('POST', '/api/newscast/posts', { text: 'x'.repeat(281) }, t.alexKey)).status, 400);
  assert.equal((await t.send('POST', '/api/newscast/posts', { text: '   ' }, t.alexKey)).status, 400);
  assert.equal((await t.send('POST', '/api/newscast/posts', { text: 'Look at https://example.com' }, t.alexKey)).status, 400);
  assert.equal((await t.send('POST', '/api/newscast/posts', { text: 'Hi', photoId: 'nope' }, t.alexKey)).status, 400);
  // A kid's device posts as the kid, never as someone else.
  const leos = await t.send('POST', '/api/newscast/posts', { text: 'I lost a tooth!', emoji: '🦷' }, t.leoKey);
  assert.equal(leos.status, 201);
  assert.equal(leos.body.memberId, leo.id);
  assert.equal(leos.body.post.emoji, '🦷');
  assert.equal((await t.send('POST', '/api/newscast/posts', { text: 'Hi', memberId: maya.id }, t.leoKey)).status, 403);
  assert.equal((await t.send('POST', '/api/newscast/posts', { text: 'Hi', memberId: sam.id }, t.alexKey)).status, 403, "a grown-up's own device posts as them");
  // A wall (and an unclaimed parent sign-in) must say who's posting.
  assert.equal((await t.send('POST', '/api/newscast/posts', { text: 'Hi' }, t.wallKey)).status, 400);
  const fromWall = await t.send('POST', '/api/newscast/posts', { text: 'Soccer at 4!', memberId: maya.id }, t.wallKey);
  assert.equal(fromWall.body.memberId, maya.id);
  // A post's photo: no separate "added a photo" item for it.
  const pic = await t.photo('', t.leoKey);
  const withPhoto = await t.send('POST', '/api/newscast/posts', { text: 'My fort', photoId: pic.body.id }, t.leoKey);
  assert.equal(withPhoto.status, 201);
  const { items } = await t.feed();
  assert.deepEqual(items.find((i) => i.key === `post:${withPhoto.body.post.id}`).photos.map((p: any) => p.id), [pic.body.id]);
  assert.ok(!items.some((i) => i.kind === 'photos'));
});

test('newscast: reactions are one per person per emoji, a wall names who, an owned device reacts only as its person', async () => {
  const t = await setup();
  const { leo, maya, alex } = t;
  await t.chore('Make bed', leo.id, day(0));
  const itemKey = `chores:${leo.id}:${day(0)}`;
  const react = (body: object, key?: string) => t.send('PUT', '/api/newscast/reactions', { itemKey, emoji: '👏', on: true, ...body }, key);

  assert.equal((await react({}, t.mayaKey)).status, 200);
  assert.equal((await react({}, t.mayaKey)).status, 200); // again: still one
  assert.equal((await react({ memberId: leo.id }, t.mayaKey)).status, 403, "Maya's tablet reacts as Maya");
  assert.equal((await react({ memberId: maya.id }, t.alexKey)).status, 403, "Alex's phone reacts as Alex");
  assert.equal((await react({}, t.wallKey)).status, 400, 'a wall asks who is reacting');
  assert.equal((await react({ memberId: alex.id }, t.wallKey)).status, 200);
  assert.equal((await react({ emoji: '👍' }, t.mayaKey)).status, 400, 'three reactions only');
  assert.equal((await react({ itemKey: 'nonsense' }, t.mayaKey)).status, 400);
  const love = await react({ emoji: '❤️' }, t.leoKey);
  assert.deepEqual(love.body.reactions, [{ emoji: '👏', memberIds: [maya.id, alex.id] }, { emoji: '❤️', memberIds: [leo.id] }]);

  let item = (await t.feed()).items.find((i) => i.key === itemKey);
  assert.deepEqual(item.reactions.find((r: any) => r.emoji === '👏').memberIds.sort(), [alex.id, maya.id].sort());
  assert.equal((await react({ on: false }, t.mayaKey)).status, 200);
  item = (await t.feed()).items.find((i) => i.key === itemKey);
  assert.deepEqual(item.reactions.find((r: any) => r.emoji === '👏').memberIds, [alex.id]);
  // Reacting never notifies anyone.
  assert.equal((await t.send('GET', '/api/notifications')).body.length, 0);
});

test('newscast: a parent removes any post, the author deletes their own, a kid nobody else’s; paused posting is a kind 403', async () => {
  const t = await setup();
  const { leo, maya } = t;
  const post = async (text: string, key: string, body: object = {}) => (await t.send('POST', '/api/newscast/posts', { text, ...body }, key)).body.post.id as string;
  const leos = await post('Leo was here', t.leoKey);
  const mayas = await post('Maya was here', t.mayaKey);

  assert.equal((await t.send('DELETE', `/api/newscast/posts/${mayas}`, undefined, t.leoKey)).status, 403, "a kid can't delete someone else's post");
  assert.equal((await t.send('DELETE', `/api/newscast/posts/${mayas}`, undefined, t.wallKey)).status, 403, "a wall can't either");
  assert.equal((await t.send('DELETE', `/api/newscast/posts/${leos}`, undefined, t.leoKey)).status, 200, 'the author deletes their own');
  assert.ok(!(await t.feed(t.leoKey)).items.some((i) => i.key === `post:${leos}`), 'gone, not marked');

  // A parent removes Maya's post (with its photo kept in the album unless they choose).
  const pic = await t.photo('', t.mayaKey);
  const withPhoto = await post('My drawing', t.mayaKey, { photoId: pic.body.id });
  assert.equal((await t.send('DELETE', `/api/newscast/posts/${mayas}`, undefined, t.alexKey)).status, 200);
  assert.equal((await t.send('DELETE', `/api/newscast/posts/${withPhoto}`, undefined, t.alexKey)).status, 200);
  assert.ok((await t.send('GET', '/api/photos')).body.some((p: any) => p.id === pic.body.id), 'the photo stays in the album');
  // Maya's own devices see "Removed by a parent" in its place (no text); everyone else sees nothing.
  const placeholder = (await t.feed(t.mayaKey)).items.find((i) => i.key === `post:${mayas}`);
  assert.equal(placeholder.post.removed, true);
  assert.equal(placeholder.post.text, null);
  assert.equal(placeholder.title, 'Removed by a parent');
  assert.ok(!(await t.feed(t.leoKey)).items.some((i) => i.key === `post:${mayas}`));
  assert.ok(!(await t.feed(t.wallKey)).items.some((i) => i.key === `post:${mayas}`));
  // ...and the parent's choice to also remove the photo.
  const pic2 = await t.photo('', t.mayaKey);
  const third = await post('Another', t.mayaKey, { photoId: pic2.body.id });
  assert.equal((await t.send('DELETE', `/api/newscast/posts/${third}?alsoPhoto=true`, undefined, t.mayaKey)).status, 403, 'only a parent removes the photo');
  assert.equal((await t.send('DELETE', `/api/newscast/posts/${third}?alsoPhoto=true`, undefined, t.alexKey)).status, 200);
  assert.ok(!(await t.send('GET', '/api/photos')).body.some((p: any) => p.id === pic2.body.id));

  // Posting paused for Leo: a kind 403 on any device; reacting still works; back on, he posts again.
  await t.send('PATCH', '/api/settings', { newscastPostingPaused: [leo.id] });
  const paused = await t.send('POST', '/api/newscast/posts', { text: 'Hi' }, t.leoKey);
  assert.equal(paused.status, 403);
  assert.match(paused.body.error, /Leo/);
  assert.doesNotMatch(paused.body.error, /ban|block|forbidden/i);
  assert.equal((await t.send('POST', '/api/newscast/posts', { text: 'Hi', memberId: leo.id }, t.wallKey)).status, 403);
  assert.equal((await t.send('POST', '/api/newscast/posts', { text: 'Hi' }, t.mayaKey)).status, 201, 'others still post');
  await t.send('PATCH', '/api/settings', { newscastPostingPaused: [] });
  assert.equal((await t.send('POST', '/api/newscast/posts', { text: 'Hi again' }, t.leoKey)).status, 201);
  assert.equal((await t.send('GET', '/api/settings')).body.newscastPostingPaused.length, 0);
  void maya;
});

test('newscast: 7 days first, Earlier to 30, and posts and reactions go after 30 days', async () => {
  const t = await setup();
  const { leo } = t;
  for (const n of [0, -3, -6, -7, -12, -29, -30, -40]) await t.chore(`Chore ${-n}`, leo.id, day(n));
  const first = await t.feed();
  assert.deepEqual([first.from, first.to], [day(-6), day(0)]);
  assert.deepEqual(first.items.map((i) => i.date), [day(0), day(-3), day(-6)]);
  assert.equal(first.earlier, true);
  const earlier = await t.feed(undefined, `?before=${day(-6)}&days=30`);
  assert.deepEqual([earlier.from, earlier.to], [day(-29), day(-7)]);
  assert.deepEqual(earlier.items.map((i) => i.date), [day(-7), day(-12), day(-29)]);
  assert.equal(earlier.earlier, false);

  const id = (await t.send('POST', '/api/newscast/posts', { text: 'Old news' }, t.alexKey)).body.post.id;
  await t.send('PUT', '/api/newscast/reactions', { itemKey: `post:${id}`, emoji: '🎉', on: true }, t.leoKey);
  await t.sql('UPDATE newscast_posts SET created_at = ?', at(-31));
  await t.sql('UPDATE newscast_reactions SET created_at = ?', at(-31));
  assert.ok(!(await t.feed(undefined, '?days=30')).items.some((i) => i.kind === 'post'), 'older than 30 days is out of the feed');
  await pruneNewscast(t.env.DB, new Date());
  assert.equal((await t.env.DB.prepare('SELECT COUNT(*) AS n FROM newscast_posts').first<{ n: number }>())?.n, 0);
  assert.equal((await t.env.DB.prepare('SELECT COUNT(*) AS n FROM newscast_reactions').first<{ n: number }>())?.n, 0);
});

test('newscast: posts and reactions stay out of the export (they last 30 days); the per-person switches go with settings', async () => {
  const t = await setup();
  await t.send('POST', '/api/newscast/posts', { text: 'Not in the export' }, t.alexKey);
  await t.send('PATCH', '/api/settings', { newscastNotFeatured: [t.leo.id], newscastPostingPaused: [t.maya.id] });
  const exp = await t.send('GET', '/api/export');
  assert.equal(exp.status, 200);
  assert.doesNotMatch(JSON.stringify(exp.body), /Not in the export/);
  assert.deepEqual(exp.body.settings.newscastNotFeatured, [t.leo.id]);
  assert.deepEqual(exp.body.settings.newscastPostingPaused, [t.maya.id]);
});
