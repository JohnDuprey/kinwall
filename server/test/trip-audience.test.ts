import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const ADMIN = 'kw_fake_trip_audience_admin';
const TITLE = 'FAKE-SURPRISE-TRIP-7731';
async function fixture() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '../migrations'));
  const env = { DB: db, ADMIN_API_KEY: ADMIN, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  async function req(method: string, url: string, body?: unknown, key = ADMIN, extra: Record<string, string> = {}) {
    const res = await app.request(url, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    const text = await res.text();
    return { status: res.status, text, json: (text.startsWith('{') || text.startsWith('[')) ? JSON.parse(text) as any : null };
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
  return { req, keys, alex, maya };
}

test('trip audience: a grown-ups-only trip is gone for kids, walls and connected apps, and stays for grown-ups', async () => {
  const f = await fixture();
  let trip = (await f.req('POST', '/api/trips', { title: TITLE, audience: 'grownups', startDate: '2027-07-10', endDate: '2027-07-14', memberIds: [f.alex.id, f.maya.id] })).json;
  assert.equal(trip.audience, 'grownups');
  trip = (await f.req('POST', `/api/trips/${trip.id}/stay-groups`, { revision: trip.revision, label: 'Harbor' })).json;
  const groupId = trip.stayGroups[0].id;
  for (const name of ['Cottage', 'Hotel']) trip = (await f.req('POST', `/api/trips/${trip.id}/stays`, { revision: trip.revision, groupId, name })).json;
  trip = (await f.req('POST', `/api/trips/${trip.id}/stay-groups/${groupId}/vote`, { revision: trip.revision })).json;
  const draft = { label: 'Away', tripId: trip.id, people: [{ memberId: f.maya.id, startDate: '2027-07-10', endDate: '2027-07-14' }] };
  const review = (await f.req('POST', '/api/away/preview', draft)).json;
  const away = await f.req('POST', '/api/away', { ...draft, token: review.token });
  assert.ok(away.status < 300, away.text);

  const hiddenFor: [string, string, Record<string, string>][] = [['kid', f.keys.kid, {}], ['wall', f.keys.wall, {}], ['connected app', ADMIN, { 'X-Kinwall-Source': 'mcp' }]];
  for (const [who, key, extra] of hiddenFor) {
    const list = await f.req('GET', '/api/trips?archived=1', undefined, key, extra);
    assert.equal(list.status, 200, who);
    assert.equal(list.text.includes(TITLE), false, `${who}: not in the list`);
    assert.equal((await f.req('GET', `/api/trips/${trip.id}`, undefined, key, extra)).status, 404, `${who}: the trip reads as missing`);
    assert.equal((await f.req('PUT', `/api/trips/${trip.id}/marks`, { memberId: f.maya.id, kind: 'interested' }, key, extra)).status, 404, `${who}: its parts too`);
    assert.equal((await f.req('GET', '/api/trips/links', undefined, key, extra)).text.includes(TITLE), false, `${who}: no trip tags`);
    assert.equal((await f.req('GET', '/api/polls', undefined, key, extra)).text.includes('Cottage'), false, `${who}: no stay vote`);
    assert.equal((await f.req('GET', '/api/away', undefined, key, extra)).text.includes(TITLE), false, `${who}: away days don't name it`);
  }
  for (const key of [ADMIN, f.keys.adult]) {
    assert.equal((await f.req('GET', '/api/trips', undefined, key)).text.includes(TITLE), true);
    assert.equal((await f.req('GET', `/api/trips/${trip.id}`, undefined, key)).status, 200);
  }
  // Only a grown-up with full access changes it; never a connected app.
  assert.equal((await f.req('PATCH', `/api/trips/${trip.id}`, { revision: trip.revision, audience: 'everyone' }, ADMIN, { 'X-Kinwall-Source': 'mcp' })).status, 403);
  trip = (await f.req('GET', `/api/trips/${trip.id}`)).json;
  const shared = await f.req('PATCH', `/api/trips/${trip.id}`, { revision: trip.revision, audience: 'everyone' });
  assert.equal(shared.status, 200, shared.text);
  assert.equal((await f.req('GET', `/api/trips/${trip.id}`, undefined, f.keys.kid)).status, 200, 'shared: the kid sees it now');
});

test('trip audience: everyone is the default, and a backup keeps the setting', async () => {
  const f = await fixture();
  const open = (await f.req('POST', '/api/trips', { title: 'Beach week' })).json;
  assert.equal(open.audience, 'everyone');
  assert.equal((await f.req('GET', `/api/trips/${open.id}`, undefined, f.keys.kid)).status, 200);
  await f.req('POST', '/api/trips', { title: TITLE, audience: 'grownups' });
  const backup = (await f.req('GET', '/api/export')).json;
  assert.equal(backup.trips.find((t: any) => t.title === TITLE)?.audience, 'grownups');
});

test('trip audience: only some people sees it on their own devices and full access, nowhere else', async () => {
  const f = await fixture();
  const trip = (await f.req('POST', '/api/trips', { title: TITLE, audience: 'people', audienceMemberIds: [f.maya.id] })).json;
  assert.deepEqual([trip.audience, trip.audienceMemberIds], ['people', [f.maya.id]]);
  const sees = async (key: string, extra: Record<string, string> = {}) => (await f.req('GET', '/api/trips', undefined, key, extra)).text.includes(TITLE);
  assert.equal(await sees(ADMIN), true, 'full access always sees it');
  assert.equal(await sees(f.keys.kid), true, 'Maya, picked, sees it on her own device');
  assert.equal(await sees(f.keys.adult), false, 'Alex, not picked, does not');
  assert.equal(await sees(f.keys.wall), false, 'walls never do');
  assert.equal(await sees(ADMIN, { 'X-Kinwall-Source': 'mcp' }), false, 'nor connected apps');
  assert.equal((await f.req('GET', `/api/trips/${trip.id}`, undefined, f.keys.adult)).status, 404);
  assert.equal((await f.req('POST', '/api/trips', { title: 'Nobody real', audience: 'people', audienceMemberIds: ['not-a-member'] })).status, 400);
});

test('trip audience: connected apps see a surprise trip only when the trip allows them', async () => {
  const f = await fixture();
  const mcp = { 'X-Kinwall-Source': 'mcp' };
  let trip = (await f.req('POST', '/api/trips', { title: TITLE, audience: 'grownups' })).json;
  assert.equal(trip.connectedApps, false, 'off by default');
  const appSees = async () => (await f.req('GET', '/api/trips', undefined, ADMIN, mcp)).text.includes(TITLE);
  assert.equal(await appSees(), false);
  trip = (await f.req('PATCH', `/api/trips/${trip.id}`, { revision: trip.revision, connectedApps: true })).json;
  assert.equal(await appSees(), true, 'allowed: listed for connected apps');
  assert.equal((await f.req('GET', `/api/trips/${trip.id}`, undefined, ADMIN, mcp)).status, 200);
  assert.equal((await f.req('GET', '/api/trips', undefined, f.keys.kid)).text.includes(TITLE), false, 'still hidden from the kids');
  assert.equal((await f.req('PATCH', `/api/trips/${trip.id}`, { revision: trip.revision, connectedApps: false }, ADMIN, mcp)).status, 403, 'an app cannot change it');
});
