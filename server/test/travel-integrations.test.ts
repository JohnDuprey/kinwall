import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { loadAway } from '../src/away.ts';
import { shiftGoalDate } from '../src/chore-goal.ts';

const ADMIN = 'travel_test_admin';
async function setup(encryptionKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=') {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(import.meta.dirname, '..', 'migrations'));
  const env = { DB: db, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'https://family.example', ENCRYPTION_KEY: encryptionKey } as unknown as Env;
  const app = createApp();
  const req = async (url: string, method = 'GET', body?: unknown, extra: Record<string, string> = {}) => {
    const res = await app.request(url, { method, headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json', ...extra }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, env);
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, json: text.startsWith('{') || text.startsWith('[') ? JSON.parse(text) as any : null };
  };
  const settings = await req('/api/settings');
  assert.equal((await req('/api/settings', 'PATCH', { features: { ...settings.json.features, trips: true } })).status, 200);
  const member = (await req('/api/members', 'POST', { name: 'Maya', color: '#339966' })).json;
  const mcp = async (name: string, args: Record<string, unknown> = {}) => {
    const result = await req('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { Accept: 'application/json, text/event-stream' });
    return result.json?.result;
  };
  return { db, env, req, mcp, member };
}

test('travel backup: explicit protected section, re-encryption and idempotent away history round-trip', async () => {
  const source = await setup();
  let trip = (await source.req('/api/trips', 'POST', { title: 'Family visit', status: 'ready', memberIds: [source.member.id] })).json;
  assert.ok(trip?.id);
  trip = (await source.req(`/api/trips/${trip.id}/stay-groups`, 'POST', { revision: trip.revision, label: 'Family home' })).json;
  const groupId = trip.stayGroups[0].id;
  trip = (await source.req(`/api/trips/${trip.id}/stays`, 'POST', { revision: trip.revision, groupId, name: 'Family home', kind: 'family', cost: 'unknown', booking: 'confirmed_family', details: { address: '41 Test Lane', arrival: 'Use the side door', codes: 'fake-door-code' } })).json;
  assert.ok(trip.stayGroups[0].options[0].id);
  const draft = { label: 'Family visit', tripId: trip.id, people: [{ memberId: source.member.id, startDate: '2027-07-10', endDate: '2027-07-12', leaveDayAway: true, returnDayAway: true }], keepDue: [], handoffs: [] };
  const preview = await source.req('/api/away/preview', 'POST', draft);
  assert.equal(preview.status, 200, preview.text);
  assert.equal((await source.req('/api/away', 'POST', { ...draft, token: preview.json.token })).status, 201);
  const basic = await source.req('/api/export');
  assert.equal(basic.status, 200);
  assert.equal(basic.json.trips.length, 1);
  assert.equal(basic.json.awayPeriods.length, 1);
  assert.equal(basic.json.tripDetails, undefined);
  for (const secret of ['41 Test Lane', 'fake-door-code', 'Use the side door']) assert.equal(basic.text.includes(secret), false);
  const full = await source.req('/api/export?includeTripDetails=1');
  assert.equal(full.status, 200);
  assert.ok(full.text.includes('fake-door-code'));
  assert.match(full.headers.get('cache-control') ?? '', /no-store/);
  assert.equal((await source.req('/api/export?includeTripDetails=1', 'GET', undefined, { 'X-Kinwall-Source': 'mcp' })).status, 403);
  const target = await setup('AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=');
  for (let i = 0; i < 2; i++) {
    const imported = await target.req('/api/import', 'POST', full.json);
    assert.equal(imported.status, 200, imported.text);
  }
  const restored = await target.req(`/api/trips/${trip.id}`);
  assert.equal(restored.status, 200, restored.text);
  assert.equal(restored.json.stayGroups[0].options[0].details.codes, 'fake-door-code');
  assert.equal((await target.req('/api/away')).json.length, 1);
  const encrypted = (await target.db.prepare('SELECT data FROM trip_private').all<{ data: string }>()).results;
  assert.equal(encrypted.length, 1);
  assert.match(encrypted[0].data, /^v1:/);
  assert.equal(encrypted[0].data.includes('fake-door-code'), false);
  assert.equal((await target.req('/api/import', 'POST', full.json, { 'X-Kinwall-Source': 'mcp' })).status, 403);
  const legacy = { ...basic.json };
  delete legacy.trips; delete legacy.awayPeriods; delete legacy.tripDetails;
  assert.equal((await target.req('/api/import', 'POST', legacy)).status, 200, 'older exports remain valid');
  assert.equal((await target.req('/api/trips')).json.length, 1, 'old backups do not erase travel');
});

test('travel MCP: read/write routes, stale writes, feature-off and protected data boundary', async () => {
  const t = await setup();
  const created = await t.mcp('create_trip', { title: 'Summer visit', memberIds: [t.member.id], description: 'Visit family', location: 'Maple Falls' });
  assert.equal(created?.isError, undefined, JSON.stringify(created));
  const trip = created.structuredContent.trip;
  assert.equal(trip.title, 'Summer visit');
  const read = await t.mcp('get_trip', { trip: trip.id });
  assert.equal(read.isError, undefined);
  assert.equal(read.structuredContent.trip.canSeeDetails, false, 'MCP excludes protected data even with parent key');
  const changed = await t.mcp('update_trip', { trip: trip.id, revision: trip.revision, title: 'Summer family visit' });
  assert.equal(changed.isError, undefined, JSON.stringify(changed));
  assert.equal(changed.structuredContent.trip.description, 'Visit family');
  assert.equal(changed.structuredContent.trip.location, 'Maple Falls');
  assert.deepEqual(changed.structuredContent.trip.memberIds, [t.member.id]);
  const stale = await t.mcp('update_trip', { trip: trip.id, revision: trip.revision, title: 'Stale change' });
  assert.equal(stale.isError, true);
  const settings = (await t.req('/api/settings')).json;
  await t.req('/api/settings', 'PATCH', { features: { ...settings.features, trips: false } });
  assert.equal((await t.mcp('list_trips')).isError, true);
  const away = await t.mcp('list_away_periods');
  assert.equal(away.isError, undefined, 'standalone away survives Trips off');
  assert.deepEqual(away.structuredContent.periods, []);
});

test('away backup: handoffs restore without changing original owners; invalid restore is atomic', async () => {
  const source = await setup();
  const sam = (await source.req('/api/members', 'POST', { name: 'Sam', color: '#336699', grownUp: true })).json;
  const chore = (await source.req('/api/chores', 'POST', { title: 'Water the plants', memberId: source.member.id, dueDate: '2027-07-10', rrule: 'FREQ=DAILY', points: 5 })).json;
  const draft = { label: 'Camp', tripId: null, people: [{ memberId: source.member.id, startDate: '2027-07-10', endDate: '2027-07-12', leaveDayAway: true, returnDayAway: true }], keepDue: [], handoffs: [{ choreId: chore.id, fromMemberId: source.member.id, toMemberId: sam.id, startDate: '2027-07-10', endDate: '2027-07-12' }] };
  const preview = await source.req('/api/away/preview', 'POST', draft);
  assert.equal(preview.status, 200, preview.text);
  const saved = await source.req('/api/away', 'POST', { ...draft, token: preview.json.token });
  assert.equal(saved.status, 201, saved.text);
  const backup = (await source.req('/api/export')).json;
  const target = await setup();
  for (let i = 0; i < 2; i++) {
    const imported = await target.req('/api/import', 'POST', backup);
    assert.equal(imported.status, 200, imported.text);
  }
  const away = await loadAway(target.env.DB, '2027-07-10', '2027-07-13');
  const row = { id: chore.id, member_id: source.member.id };
  assert.equal(away.forMember(row, '2027-07-11', sam.id), true);
  assert.equal(away.forMember(row, '2027-07-11', source.member.id), false);
  assert.equal(away.forMember(row, '2027-07-13', source.member.id), true, 'handoff ends without editing the original chore');
  assert.equal((await target.db.prepare('SELECT member_id FROM chores WHERE id=?').bind(chore.id).first<{ member_id: string }>())?.member_id, source.member.id);
  const invalid = structuredClone(backup);
  invalid.members.find((m: any) => m.id === source.member.id).name = 'Invalid replacement';
  invalid.awayPeriods[0].handoffs[0].toMemberId = source.member.id;
  const refused = await target.req('/api/import', 'POST', invalid);
  assert.equal(refused.status, 400, refused.text);
  assert.equal((await target.req('/api/members')).json.find((m: any) => m.id === source.member.id).name, 'Maya', 'no partial member write before invalid handoff rejection');
  assert.equal((await target.req('/api/away')).json[0].handoffs[0].toMemberId, sam.id);
  const schoolHandoff = structuredClone(backup);
  const schoolChore = schoolHandoff.chores.find((c: any) => c.id === chore.id);
  schoolChore.schoolSubjectId = schoolHandoff.schoolSubjects[0].id;
  schoolChore.schoolKind = 'lesson';
  const schoolRefused = await target.req('/api/import', 'POST', schoolHandoff);
  assert.equal(schoolRefused.status, 400, schoolRefused.text);
  assert.match(schoolRefused.json.error, /Schoolwork/);
  assert.equal((await target.db.prepare('SELECT school_subject_id FROM chores WHERE id=?').bind(chore.id).first<{ school_subject_id: string | null }>())?.school_subject_id, null, 'schoolwork handoff rejection is atomic too');
});

test('away backup: ending a period never reactivates future absence or handoffs after restore', async () => {
  const source = await setup();
  const today = new Date().toISOString().slice(0, 10), first = shiftGoalDate(today, -2), last = shiftGoalDate(today, 2);
  await source.req('/api/settings', 'PATCH', { timezone: 'UTC' });
  const sam = (await source.req('/api/members', 'POST', { name: 'Sam', color: '#336699', grownUp: true })).json;
  const chore = (await source.req('/api/chores', 'POST', { title: 'Water plants', memberId: source.member.id, dueDate: first, rrule: 'FREQ=DAILY' })).json;
  const draft = { label: 'Back early', tripId: null, people: [{ memberId: source.member.id, startDate: first, endDate: last, leaveDayAway: true, returnDayAway: true }], keepDue: [], handoffs: [{ choreId: chore.id, fromMemberId: source.member.id, toMemberId: sam.id, startDate: first, endDate: last }] };
  const preview = await source.req('/api/away/preview', 'POST', draft);
  const saved = await source.req('/api/away', 'POST', { ...draft, token: preview.json.token });
  assert.equal(saved.status, 201, saved.text);
  assert.equal((await source.req(`/api/away/${saved.json.id}?revision=${saved.json.revision}`, 'DELETE')).status, 200);
  const backup = (await source.req('/api/export')).json;
  const target = await setup();
  const restored = await target.req('/api/import', 'POST', backup);
  assert.equal(restored.status, 200, restored.text);
  const context = await loadAway(target.env.DB, first, last);
  assert.equal(context.isAway(source.member.id, first), true, 'elapsed excused history remains');
  assert.equal(context.isAway(source.member.id, last), false, 'future away effects stay ended');
  assert.equal(context.forMember({ id: chore.id, member_id: source.member.id }, last, source.member.id), true, 'future handoff stays ended');
});
