// Outings (routes/outings.ts, outing-rules.ts): parents do everything, a kid's own device adds and
// edits its own and marks interest only for that kid, a wall only marks interest; grown-ups-only
// outings stay off kids' devices; the "for me" rule; Add to our calendar links both ways; the
// feature switch takes it all away.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { ageOn, forBoxes, isPast, matchesFilter, weekendOf, type OutingFacts } from '../src/outing-rules.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(HERE, '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const year = new Date().getUTCFullYear();

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const send = async (method: string, p: string, body?: unknown, key = ADMIN_KEY) => {
    const res = await app.request(p, { method, headers: { Authorization: `Bearer ${key}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  const device = async (name: string, kind: 'kid' | 'wall', owner?: string) => {
    const k = (await send('POST', '/api/keys', { name, scope: 'display' })).body;
    assert.equal((await send('PATCH', `/api/keys/${k.id}`, { kind, owner: owner ?? 'shared' })).status, 200);
    return k.key as string;
  };
  const alex = (await send('POST', '/api/members', { name: 'Alex', color: '#336699', grownUp: true })).body;
  const maya = (await send('POST', '/api/members', { name: 'Maya', color: '#339966', birthday: `${year - 8}-01-15` })).body;
  const leo = (await send('POST', '/api/members', { name: 'Leo', color: '#996633', birthday: `${year - 4}-01-15` })).body;
  const cal = (await send('POST', '/api/calendars', { kind: 'local', name: 'Family' })).body;
  return { env, db, send, alex, maya, leo, cal, mayaKey: await device("Maya's tablet", 'kid', maya.id), leoKey: await device("Leo's tablet", 'kid', leo.id), wallKey: await device('Kitchen wall', 'wall') };
}

test('outing-rules: the copy in web/ is identical', () => {
  const read = (p: string) => readFileSync(path.join(HERE, p), 'utf8');
  assert.equal(read('../../web/src/outing-rules.ts'), read('../src/outing-rules.ts'), 'copy server/src/outing-rules.ts to web/src/outing-rules.ts');
});

test('outing-rules: ages, "for me" boxes, weekends, past and filters', () => {
  assert.equal(ageOn('2018-10-10', '2026-10-09'), 7);
  assert.equal(ageOn('2018-10-09', '2026-10-09'), 8);
  assert.equal(ageOn('--10-09', '2026-10-09'), null);
  const o = (p: Partial<OutingFacts>): OutingFacts => ({ kind: 'upcoming', categoryId: null, startsOn: '2026-10-10', endsOn: null, priceCents: null, audience: [], memberIds: [], ageMin: null, ageMax: null, interest: [], ...p });
  const maya = { id: 'maya', grownUp: false, birthday: '2018-01-15' }; // 8
  const leo = { id: 'leo', grownUp: false, birthday: '2022-01-15' }; // 4
  const ollie = { id: 'ollie', grownUp: false, birthday: null }; // age unknown
  const alex = { id: 'alex', grownUp: true, birthday: null };
  const sewing = o({ audience: ['kids'], ageMin: 7, ageMax: 10 });
  assert.deepEqual(forBoxes(sewing, maya, '2026-10-09'), ['age']);
  assert.deepEqual(forBoxes(sewing, leo, '2026-10-09'), []);
  assert.deepEqual(forBoxes(sewing, ollie, '2026-10-09'), ['age'], 'an unknown age fits');
  assert.deepEqual(forBoxes(sewing, alex, '2026-10-09'), []);
  assert.deepEqual(forBoxes(o({ audience: ['family'], memberIds: ['leo'] }), leo, '2026-10-09'), ['just', 'family']);
  assert.deepEqual(forBoxes(o({ audience: ['grownups'] }), alex, '2026-10-09'), ['age']);
  assert.deepEqual(forBoxes(o({ audience: ['grownups'] }), maya, '2026-10-09'), []);
  assert.deepEqual(weekendOf('2026-10-07'), ['2026-10-10', '2026-10-11']); // a Wednesday
  assert.deepEqual(weekendOf('2026-10-11'), ['2026-10-10', '2026-10-11']); // a Sunday
  assert.equal(isPast(o({ startsOn: '2026-10-01', endsOn: '2026-10-31' }), '2026-10-09'), false, 'a run still going');
  assert.equal(isPast(o({ startsOn: '2026-10-08' }), '2026-10-09'), true);
  assert.equal(isPast(o({ startsOn: null }), '2026-10-09'), false, 'not announced yet');
  assert.equal(isPast(o({ kind: 'place', startsOn: null }), '2026-10-09'), false);
  const today = '2026-10-09';
  assert.equal(matchesFilter(o({ priceCents: 0 }), { free: true }, today), true);
  assert.equal(matchesFilter(o({ priceCents: null }), { free: true }, today), false);
  assert.equal(matchesFilter(o({ priceCents: null }), { maxPriceCents: 2000 }, today), false, 'unknown price drops out of a price cap');
  assert.equal(matchesFilter(o({ startsOn: null }), { from: '2026-10-10', to: '2026-10-11' }, today), false);
  assert.equal(matchesFilter(o({ kind: 'place', startsOn: null }), { from: '2026-10-10', to: '2026-10-11' }, today), true);
  assert.equal(matchesFilter(sewing, { for: { people: [maya], boxes: ['just', 'family'] } }, today), false, 'only the boxes ticked count');
  assert.equal(matchesFilter(sewing, { for: { people: [leo], audiences: ['kids'] } }, today), true, 'an audience token matches by itself');
  const marked = o({ interest: [{ memberId: 'leo', level: 'interested' }] });
  assert.equal(matchesFilter(marked, { markedBy: ['leo'] }, today), true);
  assert.equal(matchesFilter(marked, { markedBy: 'really' }, today), false);
  assert.equal(matchesFilter(marked, { markedBy: ['leo'], reallyOnly: true }, today), false);
});

test('outings: who adds, edits and deletes; walls only read; kids edit their own', async () => {
  const t = await setup();
  const fest = await t.send('POST', '/api/outings', { title: 'Maple Grove Fall Fest', startsOn: '2026-10-10', startTime: '10:00', endTime: '16:00', placeName: 'Town Green', priceCents: 0, audience: ['family'], categoryId: 'oc-fairs' });
  assert.equal(fest.status, 201, JSON.stringify(fest.body));
  assert.equal(fest.body.kind, 'upcoming');
  assert.equal(fest.body.source, 'manual');
  const kids = await t.send('POST', '/api/outings', { title: 'Willow Creek Nature Preserve', kind: 'place', visitStatus: 'want' }, t.mayaKey);
  assert.equal(kids.status, 201);
  assert.equal(kids.body.addedBy, t.maya.id);
  assert.equal((await t.send('PATCH', `/api/outings/${kids.body.id}`, { notes: 'Bring boots' }, t.mayaKey)).body.notes, 'Bring boots');
  const notHers = await t.send('PATCH', `/api/outings/${fest.body.id}`, { title: 'Mine now' }, t.mayaKey);
  assert.equal(notHers.status, 403);
  assert.match(notHers.body.error, /outings they added/);
  assert.equal((await t.send('PATCH', `/api/outings/${kids.body.id}`, { notes: 'x' }, t.leoKey)).status, 403, "Leo can't edit Maya's");
  assert.equal((await t.send('POST', '/api/outings', { title: 'From the wall' }, t.wallKey)).status, 403);
  assert.equal((await t.send('PATCH', `/api/outings/${fest.body.id}`, { title: 'x' }, t.wallKey)).status, 403);
  for (const key of [t.mayaKey, t.wallKey]) assert.equal((await t.send('DELETE', `/api/outings/${fest.body.id}`, undefined, key)).status, 403);
  assert.equal((await t.send('GET', '/api/outings', undefined, t.wallKey)).body.length, 2);
  // Validation
  assert.equal((await t.send('POST', '/api/outings', { title: 'x', startsOn: '2026-10-10', endsOn: '2026-10-01' })).status, 400);
  assert.equal((await t.send('POST', '/api/outings', { title: 'x', categoryId: 'nope' })).status, 400);
  assert.equal((await t.send('POST', '/api/outings', { title: 'x', memberIds: ['nobody'] })).status, 400);
  assert.equal((await t.send('POST', '/api/outings', { title: 'x', url: 'javascript:alert(1)' })).status, 400);
  // "Not for us" hides it; archived=true shows it.
  await t.send('PATCH', `/api/outings/${kids.body.id}`, { archived: true });
  assert.equal((await t.send('GET', '/api/outings')).body.length, 1);
  assert.equal((await t.send('GET', '/api/outings?archived=true')).body[0].title, 'Willow Creek Nature Preserve');
  assert.equal((await t.send('DELETE', `/api/outings/${kids.body.id}`)).status, 200);
  assert.equal((await t.send('GET', `/api/outings/${kids.body.id}`)).status, 404);
});

test("outings: grown-ups-only ones stay off kids' devices unless they name the kid", async () => {
  const t = await setup();
  const beer = (await t.send('POST', '/api/outings', { title: 'Pop-up beer garden', audience: ['grownups'], startsOn: '2026-10-10' })).body;
  const concert = (await t.send('POST', '/api/outings', { title: 'Grown-up concert, Maya ushering', audience: ['grownups'], memberIds: [t.maya.id], startsOn: '2026-10-10' })).body;
  const mayas = (await t.send('GET', '/api/outings', undefined, t.mayaKey)).body.map((o: any) => o.title);
  assert.deepEqual(mayas, ['Grown-up concert, Maya ushering']);
  assert.equal((await t.send('GET', `/api/outings/${beer.id}`, undefined, t.mayaKey)).status, 404);
  assert.equal((await t.send('GET', `/api/outings/${concert.id}`, undefined, t.leoKey)).status, 404);
  assert.equal((await t.send('GET', '/api/outings', undefined, t.wallKey)).body.length, 2, 'a wall shows everything');
});

test('outings: "for" and interest filters on the list', async () => {
  const t = await setup();
  const add = async (b: object) => (await t.send('POST', '/api/outings', { startsOn: '2026-10-24', ...b })).body;
  const sewing = await add({ title: "Kids' sewing class", audience: ['kids'], ageMin: 7, ageMax: 10, priceCents: 2000 });
  const story = await add({ title: 'Library story time', audience: ['kids'], ageMin: 3, ageMax: 7, priceCents: 0 });
  const fest = await add({ title: 'Fall Fest', audience: ['family'], priceCents: 0 });
  const recital = await add({ title: "Leo's recital", memberIds: [t.leo.id] });
  const titles = async (q: string) => (await t.send('GET', `/api/outings?${q}`)).body.map((o: any) => o.title).sort();
  assert.deepEqual(await titles(`for=${t.maya.id}`), ['Fall Fest', "Kids' sewing class"]);
  assert.deepEqual(await titles(`for=${t.leo.id}`), ['Fall Fest', "Leo's recital", 'Library story time']);
  assert.deepEqual(await titles(`for=${t.alex.id}`), ['Fall Fest']);
  assert.deepEqual(await titles('for=grownups,family'), ['Fall Fest']);
  assert.equal((await t.send('GET', '/api/outings?for=nobody')).status, 400);
  assert.deepEqual(await titles('free=true'), ['Fall Fest', 'Library story time']);
  assert.deepEqual(await titles('maxPrice=1500'), ['Fall Fest', 'Library story time']);
  // Interest marks: a kid's own device only for that kid, a wall for anyone, tapping again clears.
  const mark = (id: string, memberId: string, level: string | null, key?: string) => t.send('PUT', `/api/outings/${id}/interest`, { memberId, level }, key);
  assert.equal((await mark(fest.id, t.maya.id, 'really', t.mayaKey)).status, 200);
  const blocked = await mark(fest.id, t.leo.id, 'really', t.mayaKey);
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error, /only do that for Maya/);
  assert.equal((await mark(sewing.id, t.leo.id, 'interested', t.wallKey)).status, 200);
  assert.equal((await mark(story.id, t.alex.id, 'interested')).status, 200);
  assert.deepEqual((await mark(story.id, t.alex.id, 'really')).body.interest, [{ memberId: t.alex.id, level: 'really' }], 'changing the level replaces it');
  assert.deepEqual(await titles('interestedBy=any'), ['Fall Fest', "Kids' sewing class", 'Library story time']);
  assert.deepEqual(await titles(`interestedBy=${t.leo.id}`), ["Kids' sewing class"]);
  assert.deepEqual(await titles('interestedBy=any&reallyOnly=true'), ['Fall Fest', 'Library story time']);
  assert.deepEqual((await mark(story.id, t.alex.id, null)).body.interest, []);
  assert.equal((await mark(recital.id, 'nobody', 'really')).status, 404);
  // Past ones drop off, and come back with past=true.
  await t.send('PATCH', `/api/outings/${recital.id}`, { startsOn: '2020-01-01' });
  assert.deepEqual(await titles('past=true'), ["Leo's recital"]);
  assert.equal((await titles('past=all')).length, 4);
});

test('outings: Add to our calendar makes a real event in the 🎟 Outing category and links both ways', async () => {
  const t = await setup();
  const fest = (await t.send('POST', '/api/outings', { title: 'Maple Grove Fall Fest', startsOn: '2026-10-10', startTime: '10:00', endTime: '16:00', placeName: 'Town Green', address: '1 Main St', priceCents: 0, url: 'https://example.com/fest', audience: ['family'], memberIds: [t.leo.id] })).body;
  await t.send('PUT', `/api/outings/${fest.id}/interest`, { memberId: t.maya.id, level: 'really' });
  await t.send('PUT', `/api/outings/${fest.id}/interest`, { memberId: t.alex.id, level: 'interested' });
  assert.equal((await t.send('POST', `/api/outings/${fest.id}/calendar`, {}, t.mayaKey)).status, 403, 'parents only');
  const res = await t.send('POST', `/api/outings/${fest.id}/calendar`, { calendarId: t.cal.id });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const eventId = res.body.calendarEventId;
  assert.ok(eventId);
  assert.ok(res.body.calendarEventStart);
  const event = (await t.send('GET', `/api/events/${eventId}`)).body;
  assert.equal(event.title, 'Maple Grove Fall Fest');
  assert.equal(event.location, 'Town Green, 1 Main St');
  assert.match(event.description, /Free\n\nMore info: https:\/\/example.com\/fest\n\nFrom Kinwall Outings/);
  assert.deepEqual([...event.memberIds].sort(), [t.maya.id, t.leo.id].sort(), "who ⭐ it and who it's for");
  const cats = (await t.send('GET', '/api/categories')).body;
  const outingCat = cats.find((c: any) => c.id === event.categoryId);
  assert.deepEqual([outingCat.name, outingCat.emoji], ['Outing', '🎟']);
  assert.equal((await t.send('GET', `/api/events/${eventId}/outing`, undefined, t.wallKey)).body.outing.id, fest.id);
  assert.equal((await t.send('POST', `/api/outings/${fest.id}/calendar`, {})).status, 409);
  // A second outing reuses the category, even renamed.
  await t.send('PATCH', `/api/categories/${outingCat.id}`, { name: 'Fun stuff' });
  const run = (await t.send('POST', '/api/outings', { title: 'Pumpkin patch', startsOn: '2026-10-01', endsOn: '2026-10-31' })).body;
  assert.equal((await t.send('POST', `/api/outings/${run.id}/calendar`, {})).status, 400, 'a run needs a day');
  assert.equal((await t.send('POST', `/api/outings/${run.id}/calendar`, { date: '2026-11-02' })).status, 400, 'not a day it is on');
  const runEvent = (await t.send('POST', `/api/outings/${run.id}/calendar`, { date: '2026-10-17', calendarId: t.cal.id })).body;
  const second = (await t.send('GET', `/api/events/${runEvent.calendarEventId}`)).body;
  assert.equal(second.categoryId, outingCat.id);
  assert.equal(second.allDay, true);
  assert.equal((await t.send('GET', '/api/categories')).body.length, cats.length, 'no second Outing category');
  // Deleting the event clears the link; the outing stays.
  assert.equal((await t.send('DELETE', `/api/events/${eventId}`)).status, 200);
  const after = (await t.send('GET', `/api/outings/${fest.id}`)).body;
  assert.equal(after.calendarEventId, null);
});

test('outings: categories are seeded and editable; deleting one leaves its outings without one', async () => {
  const t = await setup();
  const cats = (await t.send('GET', '/api/outing-categories', undefined, t.leoKey)).body;
  assert.equal(cats.length, 14);
  assert.deepEqual([cats[0].name, cats[0].emoji], ['Food', '🍔']);
  assert.equal((await t.send('POST', '/api/outing-categories', { name: 'Zoos', emoji: '🦒' }, t.mayaKey)).status, 403);
  const zoo = (await t.send('POST', '/api/outing-categories', { name: 'Zoos', emoji: '🦒' })).body;
  assert.equal(zoo.sort, 14);
  assert.equal((await t.send('PATCH', `/api/outing-categories/${zoo.id}`, { name: 'Zoos & farms' })).body.name, 'Zoos & farms');
  const o = (await t.send('POST', '/api/outings', { title: 'Cedar Hollow farm', kind: 'place', categoryId: zoo.id })).body;
  assert.equal((await t.send('DELETE', `/api/outing-categories/${zoo.id}`)).status, 200);
  assert.equal((await t.send('GET', `/api/outings/${o.id}`)).body.categoryId, null);
});

test('outings: turned off, every route answers 404 and nothing is deleted', async () => {
  const t = await setup();
  const o = (await t.send('POST', '/api/outings', { title: 'Fall Fest' })).body;
  const features = (await t.send('GET', '/api/settings')).body.features;
  assert.equal(features.outings, true, 'on by default');
  await t.send('PATCH', '/api/settings', { features: { ...features, outings: false } });
  assert.equal((await t.send('GET', '/api/outings')).status, 404);
  assert.equal((await t.send('GET', '/api/outing-categories')).status, 404);
  assert.equal((await t.send('PUT', `/api/outings/${o.id}/interest`, { memberId: t.maya.id, level: 'really' })).status, 404);
  await t.send('PATCH', '/api/settings', { features: { ...features, outings: true } });
  assert.equal((await t.send('GET', '/api/outings')).body.length, 1);
});

test('outings: export and import carry outings, their marks and categories', async () => {
  const t = await setup();
  const cat = (await t.send('POST', '/api/outing-categories', { name: 'Zoos', emoji: '🦒' })).body;
  const o = (await t.send('POST', '/api/outings', { title: 'Maple Grove Zoo', kind: 'place', categoryId: cat.id, audience: ['family'], visitStatus: 'been', lastVisitedOn: '2026-03-01' }, t.mayaKey)).body;
  await t.send('PUT', `/api/outings/${o.id}/interest`, { memberId: t.leo.id, level: 'really' });
  const file = (await t.send('GET', '/api/export')).body;
  assert.equal(file.outings[0].interest[0].memberId, t.leo.id);
  assert.ok(file.outingCategories.some((c: any) => c.name === 'Zoos'));
  await t.send('DELETE', `/api/outings/${o.id}`);
  await t.send('DELETE', `/api/outing-categories/${cat.id}`);
  const imported = await t.send('POST', '/api/import', file);
  assert.equal(imported.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.imported.outings, 1);
  const back = (await t.send('GET', `/api/outings/${o.id}`)).body;
  assert.deepEqual([back.categoryId, back.addedBy, back.visitStatus, back.interest], [cat.id, t.maya.id, 'been', [{ memberId: t.leo.id, level: 'really' }]]);
});
