// Rewards: parents set them up, members spend points on them (atomically, within limits), parents
// approve / decline (refund) / mark given; a member's own device acts only for them; goals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(import.meta.dirname, '..', 'migrations');
const ADMIN = 'kw_test_admin';
const b64u = (b: Uint8Array) => Buffer.from(b).toString('base64url');

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  db.prepare("INSERT INTO settings (key, value) VALUES ('timezone', 'UTC')").run();
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as unknown as Env;
  const app = createApp();
  const background: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => background.push(p), passThroughOnException() {}, props: {} };
  const req = async (p: string, method = 'GET', body?: unknown, key = ADMIN) => {
    const res = await app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env, ctx as never);
    return { status: res.status, json: (await res.json()) as any };
  };
  const flush = async () => {
    while (background.length) await Promise.all(background.splice(0));
  };
  const sent: { url: string; body: string }[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown, init: RequestInit = {}) => {
    sent.push({ url: String(url), body: typeof init.body === 'string' ? init.body : '' });
    return new Response('', { status: 201 });
  }) as typeof fetch;
  const restore = async () => {
    await flush();
    globalThis.fetch = realFetch;
  };
  const events = () => sent.filter((s) => new URL(s.url).origin === 'https://hooks.example.com').map((s) => JSON.parse(s.body) as { type: string; data: any });
  const pushes = (device: string) => sent.filter((s) => s.url === `https://fcm.googleapis.com/fcm/send/${device}`).length;

  const leo = (await req('/api/members', 'POST', { name: 'Leo', color: '#e57' })).json;
  const maya = (await req('/api/members', 'POST', { name: 'Maya', color: '#57e' })).json;
  const deviceKey = async (name: string, scope: 'display' | 'admin', owner?: string) => {
    const k = (await req('/api/keys', 'POST', { name, scope })).json;
    if (owner) assert.equal((await req(`/api/keys/${k.id}`, 'PATCH', { owner })).status, 200);
    const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    const p256dh = b64u(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
    const auth = b64u(crypto.getRandomValues(new Uint8Array(16)));
    assert.ok((await req('/api/push/subscriptions', 'POST', { subscription: { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: { p256dh, auth } }, deviceName: name }, k.key)).status < 300);
    return k.key as string;
  };
  const leoKey = await deviceKey('leo-tablet', 'display', leo.id);
  const wallKey = await deviceKey('wall', 'display', 'shared');
  await deviceKey('parent-phone', 'admin');
  assert.equal((await req('/api/webhooks', 'POST', { url: 'https://hooks.example.com/k', events: [] })).status, 201);
  const today = new Date().toISOString().slice(0, 10);
  /** Earn `points` for a member by a parent ticking a one-off chore. */
  let n = 0;
  const earn = async (memberId: string, points: number) => {
    const chore = (await req('/api/chores', 'POST', { title: `Job ${++n}`, points, memberId, dueDate: today })).json;
    assert.equal((await req(`/api/chores/${chore.id}/complete`, 'POST', { date: today, memberId })).status, 200);
  };
  const balance = async (id: string) => (await req(`/api/members/${id}/points`)).json.balance as number;
  const reward = async (body: Record<string, unknown>) => {
    const r = await req('/api/rewards', 'POST', { title: 'Ice cream trip', emoji: '🍦', cost: 50, ...body });
    assert.equal(r.status, 201, JSON.stringify(r.json));
    return r.json;
  };
  const redeem = (rewardId: string, memberId: string, key = leoKey) => req(`/api/rewards/${rewardId}/redeem`, 'POST', { memberId }, key);
  return { db, app, env, req, flush, restore, events, pushes, leo, maya, leoKey, wallKey, today, earn, balance, reward, redeem, deviceKey };
}

test('milestones: earn once from enrollment without spending, persist after corrections', async () => {
  const t = await setup();
  try {
    await t.earn(t.leo.id, 30);
    const created = await t.req('/api/reward-milestones', 'POST', { title: 'Movie night', reward: 'Pick the movie', metric: 'points', target: 20, memberIds: [t.leo.id] });
    assert.equal(created.status, 201);
    const id = created.json.id;
    const progress = async () => (await t.req(`/api/reward-milestones?memberId=${t.leo.id}`)).json[0].members[0];
    assert.equal((await progress()).progress, 0);
    await t.earn(t.leo.id, 10);
    assert.equal((await progress()).progress, 10);
    const bonus = await t.req('/api/points/awards', 'POST', { memberId: t.leo.id, points: 10 });
    assert.ok((await progress()).earnedAt);
    assert.equal(await t.balance(t.leo.id), 50);
    await t.req(`/api/points/awards/${bonus.json.award.id}`, 'DELETE');
    assert.ok((await progress()).earnedAt);
    assert.equal((await t.req(`/api/reward-milestones/${id}/given`, 'POST', { memberId: t.leo.id }, t.leoKey)).status, 403);
    assert.equal((await t.req(`/api/reward-milestones/${id}/given`, 'POST', { memberId: t.leo.id })).status, 200);
    assert.equal((await t.req(`/api/reward-milestones/${id}/given`, 'POST', { memberId: t.leo.id })).status, 409);
    assert.equal((await t.req(`/api/reward-milestones/${id}`, 'PATCH', { target: 1 })).status, 400);
    await t.req(`/api/reward-milestones/${id}`, 'PATCH', { active: false });
    await t.req(`/api/reward-milestones/${id}`, 'PATCH', { active: true });
    await t.flush();
    assert.equal(t.events().filter(e => e.type === 'reward.milestone.earned').length, 1);
    const feed = (await t.req('/api/notifications', 'GET', undefined, t.leoKey)).json;
    assert.equal(feed.filter((n: any) => n.title === '🎁 Movie night').length, 1);
  } finally { await t.restore(); }
});

test('milestones: approval, device ownership, switches, archive, and independent progress', async () => {
  const t = await setup();
  try {
    const body = { title: 'Helping hands', reward: 'Ice cream trip', metric: 'chores', target: 1, memberIds: [t.leo.id, t.maya.id] };
    assert.equal((await t.req('/api/reward-milestones', 'POST', body, t.wallKey)).status, 403);
    assert.equal((await t.req('/api/reward-milestones', 'POST', { ...body, memberIds: ['missing'] })).status, 400);
    assert.equal((await t.req('/api/reward-milestones', 'POST', { ...body, target: 0 })).status, 400);
    assert.equal((await t.req('/api/reward-milestones', 'POST', { ...body, emoji: 'not an emoji' })).status, 400);
    const r = await t.req('/api/reward-milestones', 'POST', body);
    assert.equal(r.status, 201);
    const id = r.json.id;
    const chore = (await t.req('/api/chores', 'POST', { title: 'Tidy up', memberId: t.leo.id, points: 5, dueDate: t.today, needsApproval: true })).json;
    await t.req(`/api/chores/${chore.id}/complete`, 'POST', { date: t.today, memberId: t.leo.id }, t.leoKey);
    const own = () => t.req('/api/reward-milestones', 'GET', undefined, t.leoKey);
    assert.equal((await own()).json[0].members.length, 1);
    assert.equal((await own()).json[0].members[0].progress, 0);
    assert.equal((await t.req(`/api/reward-milestones?memberId=${t.maya.id}`, 'GET', undefined, t.leoKey)).status, 403);
    assert.equal((await t.req(`/api/reward-milestones/${id}`, 'PATCH', { active: false }, t.wallKey)).status, 403);
    await t.req('/api/settings', 'PATCH', { rewardsEnabled: false });
    await t.req(`/api/chores/${chore.id}/approve`, 'POST', { date: t.today });
    assert.equal((await own()).status, 403);
    assert.equal((await t.req(`/api/reward-milestones/${id}/given`, 'POST', { memberId: t.leo.id })).status, 403);
    await t.req('/api/settings', 'PATCH', { rewardsEnabled: true });
    assert.ok((await own()).json[0].members[0].earnedAt);
    await t.req('/api/settings', 'PATCH', { features: { ...(await t.req('/api/settings')).json.features, chores: false } });
    assert.equal((await own()).status, 403);
    await t.req('/api/settings', 'PATCH', { features: { ...(await t.req('/api/settings')).json.features, chores: true } });
    assert.equal((await t.req(`/api/reward-milestones?memberId=${t.maya.id}`)).json[0].members[0].earnedAt, null);
    await t.req(`/api/reward-milestones/${id}`, 'PATCH', { active: false });
    await t.earn(t.maya.id, 10);
    assert.equal((await t.req('/api/reward-milestones?archived=true')).json[0].members.find((m: any) => m.memberId === t.maya.id).progress, 0);
    await t.req(`/api/reward-milestones/${id}`, 'PATCH', { active: true });
    assert.equal((await t.req(`/api/reward-milestones?memberId=${t.maya.id}`)).json[0].members[0].earnedAt, null, 'work during archive is excluded');
    await t.earn(t.maya.id, 0);
    assert.ok((await t.req(`/api/reward-milestones?memberId=${t.maya.id}`)).json[0].members[0].earnedAt, 'zero-point approved chore counts');
  } finally { await t.restore(); }
});

test('milestones: corrections, old undo/re-tick, spending, refunds, and check-ins', async () => {
  const t = await setup();
  try {
    const chore = (await t.req('/api/chores', 'POST', { title: 'Water plants', memberId: t.leo.id, points: 20, dueDate: t.today })).json;
    await t.req(`/api/chores/${chore.id}/complete`, 'POST', { date: t.today, memberId: t.leo.id });
    await t.req('/api/reward-milestones', 'POST', { title: 'Movie night', reward: 'Pick the movie', metric: 'points', target: 30, memberIds: [t.leo.id] });
    const progress = async () => (await t.req(`/api/reward-milestones?memberId=${t.leo.id}`)).json[0].members[0];
    const bonus = (await t.req('/api/points/awards', 'POST', { memberId: t.leo.id, points: 10 })).json.award;
    assert.equal((await progress()).progress, 10);
    await t.req(`/api/chores/${chore.id}/complete?date=${t.today}`, 'DELETE');
    assert.equal((await progress()).progress, 10, 'undoing earlier work does not reduce new progress');
    await t.req(`/api/chores/${chore.id}/complete`, 'POST', { date: t.today, memberId: t.leo.id });
    assert.equal((await progress()).progress, 10, 're-ticking old work does not earn it again');
    await t.req(`/api/points/awards/${bonus.id}`, 'DELETE');
    assert.equal((await progress()).progress, 0);
    const reward = await t.reward({ cost: 5 });
    const redemption = (await t.redeem(reward.id, t.leo.id)).json.redemption;
    await t.req(`/api/rewards/redemptions/${redemption.id}/decline`, 'POST', {});
    assert.equal((await progress()).progress, 0, 'spending and refunds do not count');
    await t.req('/api/settings', 'PATCH', { checkInPoints: 3 });
    const checkin = await t.req(`/api/members/${t.leo.id}/check-in`, 'POST', {}, t.leoKey);
    assert.equal(checkin.status, 200);
    assert.equal((await progress()).progress, checkin.json.points);
  } finally { await t.restore(); }
});

test('milestones: simultaneous writes award once; export/import preserves baselines and awards', async () => {
  const t = await setup();
  try {
    await t.earn(t.leo.id, 20);
    const r = await t.req('/api/reward-milestones', 'POST', { title: 'Movie night', reward: 'Pick the movie', metric: 'points', target: 10, memberIds: [t.leo.id] });
    await Promise.all([t.req('/api/points/awards', 'POST', { memberId: t.leo.id, points: 10 }), t.req('/api/points/awards', 'POST', { memberId: t.leo.id, points: 10 })]);
    await t.flush();
    assert.equal(t.events().filter(e => e.type === 'reward.milestone.earned').length, 1);
    const exported = (await t.req('/api/export')).json;
    assert.equal(exported.rewardMilestones.length, 1);
    assert.ok(exported.rewardMilestones[0].members[0].baseline.length);
    const saved = JSON.stringify(exported.rewardMilestones);
    t.db.prepare('DELETE FROM reward_milestones').run();
    assert.equal((await t.req('/api/import', 'POST', exported)).status, 200);
    assert.equal(JSON.stringify((await t.req('/api/export')).json.rewardMilestones), saved);
    await t.req(`/api/reward-milestones/${r.json.id}/given`, 'POST', { memberId: t.leo.id });
    await t.req('/api/import', 'POST', exported);
    assert.ok((await t.req(`/api/reward-milestones?memberId=${t.leo.id}`)).json[0].members[0].givenAt, 'stale imports cannot revoke a handoff');
  } finally { await t.restore(); }
});

test('milestones: approving an already-done chore suggestion awards immediately', async () => {
  const t = await setup();
  try {
    await t.req('/api/reward-milestones', 'POST', { title: 'Helping hands', reward: 'Choose a family outing', metric: 'chores', target: 1, memberIds: [t.leo.id] });
    const suggestion = await t.req('/api/chore-suggestions', 'POST', { title: 'Folded laundry', memberId: t.leo.id, points: 5, done: true }, t.leoKey);
    assert.equal(suggestion.status, 201);
    assert.equal((await t.req(`/api/chore-suggestions/${suggestion.json.id}/approve`, 'POST', {})).status, 200);
    const milestone = (await t.req(`/api/reward-milestones?memberId=${t.leo.id}`)).json[0];
    assert.ok(milestone.members[0].earnedAt);
  } finally { await t.restore(); }
});
