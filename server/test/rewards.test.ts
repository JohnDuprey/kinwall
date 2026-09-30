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
  const events = () => sent.filter((s) => s.url.startsWith('https://hooks.example.com')).map((s) => JSON.parse(s.body) as { type: string; data: any });
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
  return { db, app, env, req, flush, restore, events, pushes, leo, maya, leoKey, wallKey, today, earn, balance, reward, redeem };
}

test('rewards: parents create and edit; display keys cannot', async () => {
  const t = await setup();
  try {
    const r = await t.reward({ memberIds: [t.leo.id], limit: { count: 2, period: 'week' } });
    assert.deepEqual([r.title, r.cost, r.needsApproval, r.limit, r.active, r.memberIds], ['Ice cream trip', 50, true, { count: 2, period: 'week' }, true, [t.leo.id]]);
    assert.equal((await t.req('/api/rewards', 'POST', { title: 'x', cost: 5, limit: { count: 21, period: 'day' } })).status, 400, 'count 1-20');
    assert.equal((await t.req(`/api/rewards/${r.id}`, 'PATCH', { limit: null })).json.limit, null);
    assert.equal((await t.req('/api/rewards', 'POST', { title: 'x', cost: 5 }, t.leoKey)).status, 403);
    assert.equal((await t.req(`/api/rewards/${r.id}`, 'PATCH', { cost: 1 }, t.wallKey)).status, 403);
    assert.equal((await t.req(`/api/rewards/${r.id}`, 'DELETE', undefined, t.leoKey)).status, 403);
    assert.equal((await t.req('/api/rewards', 'POST', { title: 'Free', cost: 0 })).status, 400, 'cost must be > 0');
    assert.equal((await t.req('/api/rewards', 'POST', { title: 'x', cost: 5, memberIds: ['nobody'] })).status, 400);

    const edited = await t.req(`/api/rewards/${r.id}`, 'PATCH', { cost: 60, needsApproval: false });
    assert.deepEqual([edited.json.cost, edited.json.needsApproval, edited.json.title], [60, false, 'Ice cream trip']);
    // For Leo only: Maya doesn't see it; the wall (display) can list.
    assert.equal((await t.req(`/api/rewards?memberId=${t.maya.id}`, 'GET', undefined, t.wallKey)).json.length, 0);
    assert.equal((await t.req(`/api/rewards?memberId=${t.leo.id}`, 'GET', undefined, t.wallKey)).json.length, 1);
    // Archive hides it unless asked.
    await t.req(`/api/rewards/${r.id}`, 'PATCH', { active: false });
    assert.equal((await t.req('/api/rewards')).json.length, 0);
    assert.equal((await t.req('/api/rewards?archived=true')).json.length, 1);
  } finally {
    await t.restore();
  }
});

test('rewards: redeem deducts at once, refuses when short, holds while pending; approve then given', async () => {
  const t = await setup();
  try {
    const r = await t.reward({});
    await t.earn(t.leo.id, 40);
    const short = await t.redeem(r.id, t.leo.id);
    assert.equal(short.status, 402);
    assert.deepEqual([short.json.balance, short.json.cost], [40, 50]);
    assert.equal(await t.balance(t.leo.id), 40);

    await t.earn(t.leo.id, 20);
    const ok = await t.redeem(r.id, t.leo.id);
    assert.equal(ok.status, 201);
    assert.deepEqual([ok.json.redemption.status, ok.json.balance], ['pending', 10]);
    assert.equal(await t.balance(t.leo.id), 10, 'points held while pending');
    const pts = (await t.req(`/api/members/${t.leo.id}/points`)).json;
    assert.deepEqual([pts.earnedTotal, pts.spentTotal], [60, 50]);
    assert.deepEqual(pts.entries.filter((e: any) => e.reason === 'reward').map((e: any) => [e.amount, e.ref]), [[-50, ok.json.redemption.id]]);

    // Parents see it; the kid's device can't decide.
    const queue = (await t.req('/api/rewards/redemptions?status=pending,approved')).json;
    assert.deepEqual(queue.map((q: any) => q.id), [ok.json.redemption.id]);
    const id = ok.json.redemption.id;
    assert.equal((await t.req(`/api/rewards/redemptions/${id}/approve`, 'POST', undefined, t.leoKey)).status, 403);
    assert.equal((await t.req(`/api/rewards/redemptions/${id}/given`, 'POST')).status, 409, 'given only from approved');
    const approved = await t.req(`/api/rewards/redemptions/${id}/approve`, 'POST');
    assert.equal(approved.json.status, 'approved');
    assert.equal((await t.req(`/api/rewards/redemptions/${id}/approve`, 'POST')).status, 409, 'approves once');
    const given = await t.req(`/api/rewards/redemptions/${id}/given`, 'POST');
    assert.equal(given.json.status, 'given');
    assert.ok(given.json.givenAt);
    assert.equal((await t.req(`/api/rewards/redemptions/${id}/decline`, 'POST', {})).status, 409, "can't decline once given");
    assert.equal(await t.balance(t.leo.id), 10);
    assert.equal((await t.req('/api/rewards/redemptions/nope/approve', 'POST')).status, 404);

    await t.flush();
    assert.deepEqual(t.events().map((e) => e.type).filter((x) => x.startsWith('reward.') && x !== 'reward.changed'), ['reward.redeemed', 'reward.approved', 'reward.given']);
    assert.deepEqual(t.events().find((e) => e.type === 'reward.redeemed')!.data, { id, rewardId: r.id, memberId: t.leo.id, title: 'Ice cream trip', emoji: '🍦', cost: 50, status: 'pending' });
    // "Leo wants 🍦 Ice cream trip (50 points). Approve?" to the parent's device and the feed, not to Leo's.
    assert.equal(t.pushes('parent-phone'), 1);
    assert.equal(t.pushes('leo-tablet'), 0);
    const feed = (await t.req('/api/notifications')).json;
    assert.ok(feed.some((f: any) => f.title === 'Leo wants 🍦 Ice cream trip (50 points). Approve?'), JSON.stringify(feed.map((f: any) => f.title)));
  } finally {
    await t.restore();
  }
});

test('rewards: decline refunds and tells the kid; cancel an approved one refunds; balance stays right', async () => {
  const t = await setup();
  try {
    const r = await t.reward({});
    await t.earn(t.leo.id, 100);
    const a = (await t.redeem(r.id, t.leo.id)).json.redemption;
    assert.equal(await t.balance(t.leo.id), 50);
    const declined = await t.req(`/api/rewards/redemptions/${a.id}/decline`, 'POST', { note: 'Maybe on Saturday.' });
    assert.deepEqual([declined.json.status, declined.json.note], ['declined', 'Maybe on Saturday.']);
    assert.equal(await t.balance(t.leo.id), 100);
    assert.equal((await t.req(`/api/rewards/redemptions/${a.id}/decline`, 'POST', {})).status, 409, 'refunds once');
    assert.equal(await t.balance(t.leo.id), 100);
    const pts = (await t.req(`/api/members/${t.leo.id}/points`)).json;
    assert.deepEqual([pts.earnedTotal, pts.spentTotal], [100, 0], "a refund isn't earning");

    // Cancel: approved, not given yet -> decline refunds too.
    const b = (await t.redeem(r.id, t.leo.id)).json.redemption;
    await t.req(`/api/rewards/redemptions/${b.id}/approve`, 'POST');
    assert.equal(await t.balance(t.leo.id), 50);
    assert.equal((await t.req(`/api/rewards/redemptions/${b.id}/decline`, 'POST', {})).json.status, 'declined');
    assert.equal(await t.balance(t.leo.id), 100);

    await t.flush();
    const d = t.events().filter((e) => e.type === 'reward.declined');
    assert.equal(d.length, 2);
    assert.equal(d[0].data.note, 'Maybe on Saturday.');
    assert.equal(t.pushes('leo-tablet'), 2, "the kid's own device hears each decline");
    const history = (await t.req(`/api/rewards/redemptions?memberId=${t.leo.id}`, 'GET', undefined, t.leoKey)).json;
    assert.deepEqual(history.map((h: any) => h.status), ['declined', 'declined']);
  } finally {
    await t.restore();
  }
});

test("rewards: no-approval rewards and a parent's device approve at once", async () => {
  const t = await setup();
  try {
    await t.earn(t.leo.id, 100);
    const quick = await t.reward({ title: 'Sticker', cost: 5, needsApproval: false });
    assert.equal((await t.redeem(quick.id, t.leo.id)).json.redemption.status, 'approved');
    const slow = await t.reward({});
    assert.equal((await t.redeem(slow.id, t.leo.id, ADMIN)).json.redemption.status, 'approved');
    assert.equal(await t.balance(t.leo.id), 45);
    await t.flush();
    assert.equal(t.pushes('parent-phone'), 0, 'nothing to approve, nobody asked');
  } finally {
    await t.restore();
  }
});

test("rewards: a member's own device only redeems for them; limits per day and week; chores off", async () => {
  const t = await setup();
  try {
    await t.earn(t.maya.id, 100);
    await t.earn(t.leo.id, 100);
    const r = await t.reward({ title: '15 min screen time', emoji: '📺', cost: 10, limit: { count: 3, period: 'day' }, needsApproval: false });
    assert.equal((await t.redeem(r.id, t.maya.id, t.leoKey)).status, 403);
    assert.equal(await t.balance(t.maya.id), 100);
    assert.equal((await t.redeem(r.id, t.maya.id, t.wallKey)).status, 201, 'a shared wall screen redeems for anyone');

    // Up to 3 a day: three go through, the fourth is refused; "2 of 3" along the way.
    const used = async () => (await t.req(`/api/rewards?memberId=${t.leo.id}`, 'GET', undefined, t.leoKey)).json.find((x: any) => x.id === r.id).used;
    const firstToday = (await t.redeem(r.id, t.leo.id)).json.redemption;
    assert.equal((await t.redeem(r.id, t.leo.id)).status, 201);
    assert.equal(await used(), 2);
    assert.equal((await t.redeem(r.id, t.leo.id)).status, 201);
    const fourth = await t.redeem(r.id, t.leo.id);
    assert.deepEqual([fourth.status, fourth.json.error], [409, "That's all for today"]);
    assert.equal(await t.balance(t.leo.id), 70);
    // A declined one frees a slot.
    await t.req(`/api/rewards/redemptions/${firstToday.id}/decline`, 'POST', {});
    assert.equal((await t.redeem(r.id, t.leo.id)).status, 201);
    assert.equal((await t.redeem(r.id, t.leo.id)).status, 409);
    // The next day starts fresh.
    t.db.prepare("UPDATE reward_redemptions SET date = date(date, '-1 day') WHERE reward_id = ?").bind(r.id).run();
    assert.equal(await used(), 0);
    assert.equal((await t.redeem(r.id, t.leo.id)).status, 201);

    const w = await t.reward({ cost: 10, limit: { count: 1, period: 'week' } });
    const first = (await t.redeem(w.id, t.leo.id)).json.redemption;
    assert.equal((await t.redeem(w.id, t.leo.id)).json.error, "That's all for this week");
    await t.req(`/api/rewards/redemptions/${first.id}/decline`, 'POST', {});
    assert.equal((await t.redeem(w.id, t.leo.id)).status, 201);
    // Last week's doesn't count.
    t.db.prepare("UPDATE reward_redemptions SET date = '2000-01-01' WHERE reward_id = ?").bind(w.id).run();
    assert.equal((await t.redeem(w.id, t.leo.id)).status, 201);

    // Not for Maya; unknown; archived.
    const leoOnly = await t.reward({ cost: 1, memberIds: [t.leo.id] });
    assert.equal((await t.redeem(leoOnly.id, t.maya.id, ADMIN)).status, 403);
    assert.equal((await t.redeem('nope', t.leo.id)).status, 404);
    await t.req(`/api/rewards/${leoOnly.id}`, 'PATCH', { active: false });
    assert.equal((await t.redeem(leoOnly.id, t.leo.id)).status, 404);

    const features = (await t.req('/api/settings')).json.features;
    assert.equal((await t.req('/api/settings', 'PATCH', { features: { ...features, chores: false } })).status, 200);
    assert.equal((await t.redeem(r.id, t.maya.id, ADMIN)).status, 403);
  } finally {
    await t.restore();
  }
});

test('rewards: two redeems at once cannot overspend', async () => {
  const t = await setup();
  try {
    await t.earn(t.leo.id, 60);
    const r = await t.reward({ needsApproval: false });
    const results = await Promise.all([t.redeem(r.id, t.leo.id), t.redeem(r.id, t.leo.id)]);
    assert.deepEqual(results.map((x) => x.status).sort(), [201, 402]);
    assert.equal(await t.balance(t.leo.id), 10);
  } finally {
    await t.restore();
  }
});

test('rewards: goal set and cleared; own device only; shows on members; deleting the reward clears it', async () => {
  const t = await setup();
  try {
    const r = await t.reward({ title: 'Movie night', emoji: '🍿', cost: 100 });
    assert.equal((await t.req(`/api/members/${t.maya.id}/reward-goal`, 'PUT', { rewardId: r.id }, t.leoKey)).status, 403);
    assert.equal((await t.req(`/api/members/${t.leo.id}/reward-goal`, 'PUT', { rewardId: r.id }, t.leoKey)).status, 200);
    await t.earn(t.leo.id, 40);
    const leo = async () => (await t.req('/api/members', 'GET', undefined, t.wallKey)).json.find((m: any) => m.id === t.leo.id);
    assert.deepEqual([(await leo()).rewardGoal, (await leo()).balance], [{ rewardId: r.id, title: 'Movie night', emoji: '🍿', cost: 100 }, 40]);
    assert.equal((await t.req(`/api/members/${t.leo.id}/reward-goal`, 'PUT', { rewardId: null }, t.leoKey)).status, 200);
    assert.equal((await leo()).rewardGoal, null);
    await t.req(`/api/members/${t.leo.id}/reward-goal`, 'PUT', { rewardId: r.id });
    await t.req(`/api/rewards/${r.id}`, 'PATCH', { active: false });
    assert.equal((await leo()).rewardGoal, null, 'archived reads as no goal');
    await t.req(`/api/rewards/${r.id}`, 'PATCH', { active: true });
    assert.equal((await leo()).rewardGoal.rewardId, r.id);
    await t.req(`/api/rewards/${r.id}`, 'DELETE');
    assert.equal((await leo()).rewardGoal, null);
    assert.equal((await t.req(`/api/members/${t.leo.id}/reward-goal`, 'PUT', { rewardId: 'nope' })).status, 404);
  } finally {
    await t.restore();
  }
});

test('rewards: export/import round trip (rewards, redemptions, goals); older files import with defaults', async () => {
  const t = await setup();
  try {
    await t.earn(t.leo.id, 100);
    const r = await t.reward({ memberIds: [t.leo.id], limit: { count: 2, period: 'week' } });
    const red = (await t.redeem(r.id, t.leo.id)).json.redemption;
    await t.req(`/api/members/${t.leo.id}/reward-goal`, 'PUT', { rewardId: r.id });
    const file = (await t.req('/api/export')).json;
    assert.equal(file.rewards.length, 1);
    assert.deepEqual(file.rewardRedemptions.map((x: any) => [x.id, x.status]), [[red.id, 'pending']]);
    assert.equal(file.members.find((m: any) => m.id === t.leo.id).rewardGoalId, r.id);

    const u = await setup();
    try {
      const res = await u.req('/api/import', 'POST', file);
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.deepEqual([res.json.imported.rewards, res.json.imported.rewardRedemptions], [1, 1]);
      const again = (await u.req('/api/export')).json;
      assert.deepEqual(again.rewards, file.rewards);
      assert.deepEqual(again.rewardRedemptions, file.rewardRedemptions);
      assert.equal((await u.req('/api/members')).json.find((m: any) => m.id === t.leo.id).rewardGoal.rewardId, r.id);
      assert.equal((await u.req(`/api/members/${t.leo.id}/points`)).json.balance, 50);
      // The imported pending one can still be declined (and refunds).
      await u.req(`/api/rewards/redemptions/${red.id}/decline`, 'POST', {});
      assert.equal((await u.req(`/api/members/${t.leo.id}/points`)).json.balance, 100);
    } finally {
      await u.restore();
    }

    // A file from before rewards.
    const old = structuredClone(file);
    delete old.rewards;
    delete old.rewardRedemptions;
    for (const m of old.members) delete m.rewardGoalId;
    const v = await setup();
    try {
      const res = await v.req('/api/import', 'POST', old);
      assert.equal(res.status, 200, JSON.stringify(res.json));
      assert.deepEqual([res.json.imported.rewards, res.json.imported.rewardRedemptions], [0, 0]);
    } finally {
      await v.restore();
    }
  } finally {
    await t.restore();
  }
});

test('rewards: MCP tools wrap the routes', async () => {
  const t = await setup();
  try {
    await t.earn(t.leo.id, 100);
    let id = 1;
    const tool = async (name: string, args: Record<string, unknown>) => {
      const res = await t.app.request('/mcp', {
        method: 'POST',
        headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }),
      }, t.env);
      const body = (await res.json()) as any;
      assert.ok(!body.error, JSON.stringify(body.error));
      return body.result;
    };
    const created = await tool('create_reward', { title: 'Pizza night', emoji: '🍕', cost: 30, members: ['leo'], limit: { count: 1, period: 'week' } });
    assert.ok(!created.isError, JSON.stringify(created));
    const rewardId = created.structuredContent.reward.id;
    assert.deepEqual(created.structuredContent.reward.memberIds, [t.leo.id]);
    assert.equal((await tool('update_reward', { rewardId, cost: 40 })).structuredContent.reward.cost, 40);
    assert.equal((await tool('list_rewards', { member: 'Leo' })).structuredContent.rewards.length, 1);
    // From an admin key it's approved straight away; make it wait by redeeming from Leo's device.
    const redeemed = await t.redeem(rewardId, t.leo.id);
    const reqs = (await tool('list_reward_requests', {})).structuredContent.requests;
    assert.deepEqual(reqs.map((r: any) => r.id), [redeemed.json.redemption.id]);
    assert.equal((await tool('approve_reward', { redemptionId: reqs[0].id })).structuredContent.redemption.status, 'approved');
    assert.equal((await tool('mark_reward_given', { redemptionId: reqs[0].id })).structuredContent.redemption.status, 'given');
    const second = await tool('redeem_reward', { rewardId, member: 'Leo' });
    assert.ok(second.isError, 'weekly limit');
    await t.db.prepare("UPDATE reward_redemptions SET date = '2000-01-01'").run();
    const third = await tool('redeem_reward', { rewardId, member: 'Leo' });
    assert.equal(third.structuredContent.redemption.status, 'approved');
    assert.equal((await tool('decline_reward', { redemptionId: third.structuredContent.redemption.id, note: 'Not tonight' })).structuredContent.redemption.note, 'Not tonight');
    const short = await tool('redeem_reward', { rewardId: (await t.reward({ cost: 999 })).id, member: 'Leo' });
    assert.ok(short.isError);
    assert.match(short.content[0].text, /Not enough points/);
    // MCP's in-process calls have no ExecutionContext, so the decline's push runs detached: let it land on the fake fetch.
    await new Promise((r) => setTimeout(r, 100));
  } finally {
    await t.restore();
  }
});
