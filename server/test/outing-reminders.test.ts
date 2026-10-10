// Outing reminders and ideas: the schedule (outing-reminders.ts dueReminders), who gets each note,
// the morning tick sending each once (notify.ts runOutings) with the per-device "Outing reminders"
// switch, "date announced" when a date is saved, and the ideas rules (outing-rules.ts outingIdeas).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { runNotifications } from '../src/notify.ts';
import { dateAnnounced, dueReminders, type ReminderOuting } from '../src/outing-reminders.ts';
import { dayPick, openStretches, outingIdeas, type IdeaOuting } from '../src/outing-rules.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

const people = [{ id: 'alex', name: 'Alex', grownUp: true }, { id: 'sam', name: 'Sam', grownUp: true }, { id: 'maya', name: 'Maya', grownUp: false }, { id: 'leo', name: 'Leo', grownUp: false }];
const ro = (p: Partial<ReminderOuting>): ReminderOuting => ({ id: 'o1', title: 'Fall Fest', kind: 'upcoming', startsOn: null, endsOn: null, startTime: null, buyBy: null, ticketsOnSaleAt: null, gotTickets: false, calendarEventId: null, archived: false, emoji: '🎪', interest: [], ...p });
const TODAY = '2026-10-07';
const noSale = () => null;

test('reminders: ⭐ heads-up a week before and the day before, to who ⭐ it, grown-ups too for a kid', () => {
  const kids = [{ memberId: 'maya', level: 'really' as const }, { memberId: 'leo', level: 'really' as const }, { memberId: 'alex', level: 'interested' as const }];
  const week = dueReminders([ro({ startsOn: '2026-10-14', interest: kids })], people, TODAY, noSale);
  assert.deepEqual(week.map((r) => [r.key, r.title, r.body, r.memberIds, r.grownUps]), [['outing:o1:headsup7:2026-10-14', '🎪 Fall Fest is a week away', 'Maya and Leo really want to go.', ['maya', 'leo'], true]]);
  assert.equal(dueReminders([ro({ startsOn: '2026-10-08', interest: kids })], people, TODAY, noSale)[0].title, '🎪 Fall Fest is tomorrow');
  assert.equal(dueReminders([ro({ startsOn: '2026-10-08', interest: [{ memberId: 'sam', level: 'really' }] })], people, TODAY, noSale)[0].grownUps, false, 'a grown-up ⭐: just them');
  assert.deepEqual(dueReminders([ro({ startsOn: '2026-10-09', interest: kids })], people, TODAY, noSale), [], 'not 2 days before');
  assert.deepEqual(dueReminders([ro({ startsOn: '2026-10-08', interest: kids, calendarEventId: 'e1' })], people, TODAY, noSale), [], 'on the calendar: the event reminds');
  assert.deepEqual(dueReminders([ro({ startsOn: '2026-10-08', interest: [{ memberId: 'leo', level: 'interested' }] })], people, TODAY, noSale), [], '👀 alone gets no heads-up');
  assert.deepEqual(dueReminders([ro({ startsOn: '2026-10-08', interest: kids, archived: true })], people, TODAY, noSale), [], '"Not for us"');
});

test('reminders: buy tickets 3 days before and that morning, on sale the day before and at the time, last chance', () => {
  const marked = [{ memberId: 'leo', level: 'interested' as const }];
  assert.deepEqual(dueReminders([ro({ buyBy: '2026-10-10', interest: marked })], people, TODAY, noSale).map((r) => [r.key, r.title, r.grownUps, r.memberIds]), [['outing:o1:buy3:2026-10-10', '🎟 Get tickets for Fall Fest by Saturday', true, []]]);
  assert.equal(dueReminders([ro({ buyBy: TODAY, interest: marked })], people, TODAY, noSale)[0].key, `outing:o1:buy0:${TODAY}`);
  assert.deepEqual(dueReminders([ro({ buyBy: TODAY, interest: marked, gotTickets: true })], people, TODAY, noSale), [], 'We have tickets stops them');
  assert.deepEqual(dueReminders([ro({ buyBy: TODAY })], people, TODAY, noSale), [], 'nobody marked it');
  const sale = (now: boolean, on: string) => () => ({ saleOn: on, saleAt: '10:00 AM', saleNow: now });
  assert.equal(dueReminders([ro({ ticketsOnSaleAt: 'x', interest: marked })], people, TODAY, sale(false, '2026-10-08'))[0].title, '🎟 Tickets for Fall Fest go on sale tomorrow at 10:00 AM');
  assert.deepEqual(dueReminders([ro({ ticketsOnSaleAt: 'x', interest: marked })], people, TODAY, sale(false, TODAY)), [], 'not yet 10');
  assert.equal(dueReminders([ro({ ticketsOnSaleAt: 'x', interest: marked })], people, TODAY, sale(true, TODAY))[0].key, `outing:o1:onsale0:${TODAY}`);
  const run = ro({ title: 'Pumpkin patch', emoji: '🎃', startsOn: '2026-10-01', endsOn: '2026-10-14', interest: marked });
  assert.deepEqual(dueReminders([run], people, TODAY, noSale).map((r) => [r.title, r.memberIds, r.grownUps]), [['🎃 Pumpkin patch closes Oct 14', ['leo'], false]]);
  const announced = dateAnnounced(ro({ startsOn: '2027-06-12', interest: [{ memberId: 'sam', level: 'really' }, { memberId: 'alex', level: 'really' }] }), 'alex');
  assert.deepEqual([announced?.key, announced?.title, announced?.body, announced?.memberIds], ['outing:o1:dated:2027-06-12', '🎪 Fall Fest: the date is set', "It's Saturday, June 12.", ['sam']]);
});

test('reminders: the morning tick sends each once, to who it is for; date announced; the ideas route', async () => {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const send = async (method: string, p: string, body?: unknown, key = ADMIN_KEY) => (await (await app.request(p, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env)).json()) as any;
  await send('PATCH', '/api/settings', { timezone: 'UTC', quietFrom: '22:00', quietTo: '06:00' });
  const maya = await send('POST', '/api/members', { name: 'Maya', color: '#339966' });
  await send('POST', '/api/members', { name: 'Alex', color: '#336699', grownUp: true });
  const now = new Date('2026-10-07T09:30:00Z');
  const fest = await send('POST', '/api/outings', { title: 'Fall Fest', startsOn: '2026-10-08', categoryId: 'oc-fairs' });
  await send('PUT', `/api/outings/${fest.id}/interest`, { memberId: maya.id, level: 'really' });
  const feed = async () => (await send('GET', '/api/notifications')).filter((n: any) => n.kind === 'outing').map((n: any) => n.title);
  await runNotifications(env, new Date('2026-10-07T08:30:00Z'));
  assert.deepEqual(await feed(), [], 'before 9 AM');
  await runNotifications(env, now);
  await runNotifications(env, new Date(now.getTime() + 300_000));
  assert.deepEqual(await feed(), ['🎪 Fall Fest is tomorrow'], 'once');
  const row = (await db.prepare("SELECT member_ids FROM notifications WHERE kind = 'outing'").first()) as { member_ids: string };
  assert.equal(JSON.parse(row.member_ids).length, 2, "Maya, and the grown-ups since a kid ⭐ it");
  // Turned off, the notes leave the bell too.
  const features = (await send('GET', '/api/settings')).features;
  await send('PATCH', '/api/settings', { features: { ...features, outings: false } });
  assert.deepEqual(await feed(), []);
  await send('PATCH', '/api/settings', { features: { ...features, outings: true } });
  // Date announced: Maya hears when a grown-up fills in the date.
  const tour = await send('POST', '/api/outings', { title: 'The Lanterns', categoryId: 'oc-music' });
  await send('PUT', `/api/outings/${tour.id}/interest`, { memberId: maya.id, level: 'really' });
  await send('PATCH', `/api/outings/${tour.id}`, { startsOn: '2027-06-12' });
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(await feed(), ['🎵 The Lanterns: the date is set', '🎪 Fall Fest is tomorrow']);
  // Ideas: date night only on a parent's device; a kid's device never gets grown-ups-only outings.
  await send('POST', '/api/outings', { title: 'Wine tasting', startsOn: '2026-10-20', startTime: '19:00', audience: ['grownups'] });
  const k = await send('POST', '/api/keys', { name: "Maya's tablet", scope: 'display' });
  await send('PATCH', `/api/keys/${k.id}`, { kind: 'kid', owner: maya.id });
  const parent = await send('GET', '/api/outings/ideas');
  assert.ok(parent.ideas.some((i: any) => i.key === 'date-night'));
  assert.ok(parent.outings.every((o: any) => parent.ideas.some((i: any) => i.outingIds.includes(o.id))));
  const kid = await send('GET', '/api/outings/ideas', undefined, k.key);
  assert.equal(kid.ideas.some((i: any) => i.key === 'date-night'), false);
  assert.equal(kid.outings.some((o: any) => o.title === 'Wine tasting'), false);
});

const io = (p: Partial<IdeaOuting>): IdeaOuting => ({ id: p.title ?? 'x', title: 'x', kind: 'upcoming', categoryId: null, startsOn: null, endsOn: null, startTime: null, endTime: null, priceCents: null, audience: [], memberIds: [], ageMin: null, ageMax: null, interest: [], visitStatus: null, lastVisitedOn: null, buyBy: null, archived: false, ...p });

test('ideas: weekend, open time, rain, next weekend, free, next month, date night, a while, surprise', () => {
  const fest = io({ title: 'Fall Fest', startsOn: '2026-10-10', startTime: '10:00', endTime: '16:00', priceCents: 0, audience: ['family'], interest: [{ memberId: 'maya', level: 'really' }], categoryId: 'oc-fairs' });
  const hike = io({ title: 'Willow Creek', kind: 'place', categoryId: 'oc-outdoors', priceCents: 0, visitStatus: 'want', interest: [{ memberId: 'leo', level: 'really' }] });
  const museum = io({ title: 'Science museum', kind: 'place', categoryId: 'oc-art', priceCents: 1200, visitStatus: 'been', lastVisitedOn: '2025-12-01', interest: [{ memberId: 'leo', level: 'interested' }] });
  const story = io({ title: 'Story time', startsOn: '2026-10-11', startTime: '10:30', categoryId: 'oc-library', priceCents: 0, audience: ['kids'] });
  const concert = io({ title: 'Concert', startsOn: '2026-11-06', startTime: '19:30', audience: ['grownups'], buyBy: '2026-10-30' });
  const clash = io({ title: 'Parade', startsOn: '2026-10-10', startTime: '17:00' });
  const all = [fest, hike, museum, story, concert, clash];
  const busy = [{ day: '2026-10-10', from: 16 * 60 + 30, to: 18 * 60 }]; // Saturday 4:30 to 6 PM
  assert.deepEqual(openStretches('2026-10-10', busy), [{ from: 540, to: 990 }]);
  assert.deepEqual(openStretches('2026-10-10', [{ day: '2026-10-10', from: 9 * 60, to: 13 * 60 }]), [{ from: 780, to: 1200 }]);
  assert.deepEqual(openStretches('2026-10-10', [{ day: '2026-10-10', from: 0, to: 1440 }]), []);
  const dry = outingIdeas(all, '2026-10-07', busy, [], { grownUp: true });
  const byKey = Object.fromEntries(dry.map((i) => [i.key, i]));
  assert.deepEqual(byKey.weekend.outingIds, ['Fall Fest', 'Willow Creek', 'Story time'], 'ranked by interest; the parade clashes with a busy event');
  assert.deepEqual([byKey['open-2026-10-10'].title, byKey['open-2026-10-10'].note], ['Saturday is open', '9 AM to 4:30 PM']);
  assert.equal(byKey.rain, undefined, 'no rain, no rain card');
  assert.deepEqual(byKey['next-weekend'].outingIds, ['Willow Creek'], 'nothing marked then: places you want to go');
  assert.deepEqual(byKey.free.outingIds, ['Fall Fest', 'Willow Creek', 'Story time']);
  assert.deepEqual([byKey['next-month'].title, byKey['next-month'].note, byKey['next-month'].outingIds], ['In November', '1 needs tickets ahead', ['Concert']]);
  assert.deepEqual(byKey['date-night'].outingIds, ['Concert']);
  assert.deepEqual(byKey['a-while'].outingIds, ['Willow Creek', 'Science museum']);
  assert.equal(byKey.surprise.outingIds.length, 1);
  assert.equal(outingIdeas(all, '2026-10-07', busy, [], { grownUp: false }).some((i) => i.key === 'date-night'), false, "date night only on grown-ups' devices");
  const wet = outingIdeas(all, '2026-10-07', busy, [{ date: '2026-10-10', rainChance: 80, code: 61 }], { grownUp: true });
  const wetKeys = Object.fromEntries(wet.map((i) => [i.key, i]));
  assert.deepEqual(wetKeys.weekend.outingIds.at(-1), 'Willow Creek', 'outdoors drops on a rainy weekend');
  assert.deepEqual([wetKeys.rain.title, wetKeys.rain.outingIds], ['Rain Saturday: indoor ideas', ['Science museum']]);
  assert.equal(dayPick(['a', 'b', 'c'], '2026-10-07'), dayPick(['a', 'b', 'c'], '2026-10-07'), 'the same pick all day');
});
