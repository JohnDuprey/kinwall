// Outings' community calendars (routes/outing-feeds.ts): an .ics link read 90 days ahead into a pile
// to Keep or mark Not for us; skip words; a refetch updates instead of adding again; pile items follow
// the feed (moved, gone, called off), kept ones follow its day and time and get marked canceled; parents only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { feedItems, refreshDueFeeds, skipList, skipped } from '../src/routes/outing-feeds.ts';
import { expandICS } from '../src/providers/ics.ts';

const FEED = 'https://town.example/calendar.ics';
/** YYYYMMDD n days from today (UTC). */
const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10).replace(/-/g, '');
const iso = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`;
const vevent = (uid: string, title: string, lines: string[]) => ['BEGIN:VEVENT', `UID:${uid}`, `SUMMARY:${title}`, ...lines, 'END:VEVENT'];
const ics = (...events: string[][]) => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Maple Grove//EN', ...events.flat(), 'END:VCALENDAR'].join('\r\n');

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, fileURLToPath(new URL('../migrations', import.meta.url)));
  const state = { body: '', fetches: 0 };
  const OUTBOUND_FETCH = async (input: string | URL | Request) => {
    state.fetches++;
    return String(input instanceof Request ? input.url : input) === FEED ? new Response(state.body, { headers: { 'content-type': 'text/calendar' } }) : new Response('nope', { status: 404 });
  };
  const env: Env = { DB: db, ADMIN_API_KEY: 'test-admin', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', OUTBOUND_FETCH };
  const app = createApp();
  const send = async (method: string, path: string, body?: unknown, key = 'test-admin'): Promise<{ status: number; json: any }> => {
    const res = await app.request(path, { method, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }, env);
    return { status: res.status, json: await res.json() };
  };
  await send('PATCH', '/api/settings', { timezone: 'UTC' });
  const device = async (name: string, kind: 'kid' | 'wall', owner?: string) => {
    const k = (await send('POST', '/api/keys', { name, scope: 'display' })).json;
    await send('PATCH', `/api/keys/${k.id}`, { kind, owner: owner ?? 'shared' });
    return k.key as string;
  };
  const maya = (await send('POST', '/api/members', { name: 'Maya', color: '#339966', birthday: '2018-01-15' })).json;
  return { env, db, state, send, kidKey: await device("Maya's tablet", 'kid', maya.id), wallKey: await device('Kitchen wall', 'wall') };
}

test('outing-feeds: skip words are whole words, case ignored', () => {
  const w = skipList(' Meeting, committee ,board,, hearing ');
  assert.deepEqual(w, ['meeting', 'committee', 'board', 'hearing']);
  assert.equal(skipped('Select Board Meeting', w), true);
  assert.equal(skipped('Board games for teens', w), true);
  assert.equal(skipped('Skateboarding demo', w), false);
});

test('outing-feeds: a repeating item is one outing at its next time; a canceled time is skipped', async () => {
  const text = ics(
    vevent('story', 'Story time', [`DTSTART:${day(-14)}T150000Z`, `DTEND:${day(-14)}T160000Z`, 'RRULE:FREQ=WEEKLY']),
    vevent('fair', 'CANCELED: Craft fair', [`DTSTART;VALUE=DATE:${day(4)}`, `DTEND;VALUE=DATE:${day(5)}`]),
  );
  const from = new Date(Date.now() - 86_400_000), to = new Date(Date.now() + 91 * 86_400_000);
  const today = iso(day(0));
  const items = feedItems(await expandICS(text, from, to, 'UTC', { keepCancelled: true }), 'UTC', today, []);
  const story = items.find((i) => i.title === 'Story time')!;
  assert.equal(items.filter((i) => i.title === 'Story time').length, 1);
  assert.ok(story.startsOn >= today && story.startsOn <= iso(day(7)), story.startsOn);
  assert.equal(story.startTime, '15:00');
  const fair = items.find((i) => i.title === 'Craft fair')!;
  assert.deepEqual([fair.canceled, fair.startsOn, fair.endsOn, fair.startTime], [true, iso(day(4)), null, null]);
});

test('outing-feeds: the pile, Keep and Not for us, updates, cancels, no duplicates', async () => {
  const t = await setup();
  const fest = (start: string, extra: string[] = []) => vevent('fest-1', 'Fall Fest', [`DTSTART:${day(5)}T${start}00Z`, `DTEND:${day(5)}T${String(+start.slice(0, 2) + 3).padStart(2, '0')}0000Z`, 'LOCATION:Maple Grove Common', ...extra]);
  const meeting = vevent('board-1', 'Select Board meeting', [`DTSTART:${day(3)}T230000Z`]);
  const patch = vevent('patch-1', 'Pumpkin patch', [`DTSTART;VALUE=DATE:${day(2)}`, `DTEND;VALUE=DATE:${day(13)}`]);
  const old = vevent('old-1', 'Summer concert', [`DTSTART:${day(-10)}T180000Z`]);
  t.state.body = ics(fest('1000'), meeting, patch, old);

  const feed = await t.send('POST', '/api/outing-feeds', { name: 'Town calendar', url: FEED, categoryId: 'oc-fairs', audience: ['family'] });
  assert.equal(feed.status, 201, JSON.stringify(feed.json));
  assert.deepEqual([feed.json.skipWords, feed.json.waiting, feed.json.lastError], ['meeting, committee, board, hearing', 2, null]);
  let pile = (await t.send('GET', '/api/outing-feeds/pile')).json;
  assert.equal(pile.length, 1);
  assert.equal(pile[0].feed.name, 'Town calendar');
  assert.deepEqual(pile[0].outings.map((o: any) => o.title), ['Pumpkin patch', 'Fall Fest']);
  const [patchItem, festItem] = pile[0].outings;
  assert.deepEqual([festItem.startTime, festItem.endTime, festItem.placeName, festItem.categoryId, festItem.audience, festItem.source], ['10:00', '13:00', 'Maple Grove Common', 'oc-fairs', ['family'], 'feed']);
  assert.deepEqual([patchItem.startsOn, patchItem.endsOn], [iso(day(2)), iso(day(12))]);
  assert.equal((await t.send('GET', '/api/outings')).json.length, 0, 'the pile is not in the list');

  assert.equal((await t.send('POST', `/api/outing-feeds/pile/${festItem.id}`, { keep: true })).status, 200);
  assert.equal((await t.send('POST', `/api/outing-feeds/pile/${patchItem.id}`, { keep: false })).status, 200);
  assert.equal((await t.send('POST', `/api/outing-feeds/pile/${festItem.id}`, { keep: true })).status, 404, 'no longer waiting');
  assert.deepEqual((await t.send('GET', '/api/outings')).json.map((o: any) => o.title), ['Fall Fest']);

  // The family renames what it kept; the feed moves its time and adds something new.
  await t.send('PATCH', `/api/outings/${festItem.id}`, { title: 'Fall Fest with Grandma' });
  t.state.body = ics(fest('1500'), meeting, patch, vevent('craft-1', 'Craft fair', [`DTSTART;VALUE=DATE:${day(20)}`]));
  assert.equal((await t.send('POST', `/api/outing-feeds/${feed.json.id}/refresh`)).json.waiting, 1);
  const kept = (await t.send('GET', `/api/outings/${festItem.id}`)).json;
  assert.deepEqual([kept.title, kept.startTime, kept.endTime, kept.canceled], ['Fall Fest with Grandma', '15:00', '18:00', false]);
  assert.deepEqual((await t.send('GET', '/api/outing-feeds/pile')).json[0].outings.map((o: any) => o.title), ['Craft fair'], 'Not for us stays hidden');
  const rows = async () => (await t.db.prepare('SELECT count(*) AS n FROM outings').first<{ n: number }>())!.n;
  assert.equal(await rows(), 3);

  // A feed that makes up new UIDs every time: the same name on the same day is the same item.
  t.state.body = ics(fest('1500'), patch, vevent('craft-NEW', 'Craft fair', [`DTSTART;VALUE=DATE:${day(20)}`]));
  await t.send('POST', `/api/outing-feeds/${feed.json.id}/refresh`);
  assert.equal(await rows(), 3);

  // Called off: the kept one is marked canceled; the craft fair leaves the pile.
  t.state.body = ics(fest('1500', ['STATUS:CANCELLED']), patch);
  await t.send('POST', `/api/outing-feeds/${feed.json.id}/refresh`);
  assert.equal((await t.send('GET', `/api/outings/${festItem.id}`)).json.canceled, true);
  assert.deepEqual((await t.send('GET', '/api/outing-feeds/pile')).json, []);

  // Skip words the family adds take items out of the pile.
  t.state.body = ics(patch, vevent('yoga-1', 'Teen yoga', [`DTSTART:${day(6)}T170000Z`]));
  await t.send('POST', `/api/outing-feeds/${feed.json.id}/refresh`);
  assert.equal((await t.send('GET', '/api/outing-feeds/pile')).json[0].outings.length, 1);
  assert.equal((await t.send('PATCH', `/api/outing-feeds/${feed.json.id}`, { skipWords: 'meeting, yoga' })).json.waiting, 0);

  // Removing the calendar removes its pile; what was kept stays.
  t.state.body = ics(patch, vevent('dance-1', 'Square dance', [`DTSTART:${day(8)}T230000Z`]));
  await t.send('POST', `/api/outing-feeds/${feed.json.id}/refresh`);
  assert.equal((await t.send('DELETE', `/api/outing-feeds/${feed.json.id}`)).status, 200);
  assert.deepEqual((await t.send('GET', '/api/outings')).json.map((o: any) => [o.title, o.feedId]), [['Fall Fest with Grandma', null]]);
  assert.equal(await rows(), 1, 'only the kept one');
});

test('outing-feeds: once a day on the tick; errors in plain words; parents only; off with Outings', async () => {
  const t = await setup();
  t.state.body = ics(vevent('a', 'Fall Fest', [`DTSTART;VALUE=DATE:${day(5)}`]));
  const feed = (await t.send('POST', '/api/outing-feeds', { name: 'Library', url: FEED })).json;
  const before = t.state.fetches;
  await refreshDueFeeds(t.env);
  assert.equal(t.state.fetches, before, 'read today already');
  await refreshDueFeeds(t.env, new Date(Date.now() + 86_400_000));
  assert.equal(t.state.fetches, before + 1);

  const bad = await t.send('POST', '/api/outing-feeds', { name: 'Nope', url: 'https://town.example/missing.ics' });
  assert.equal(bad.json.lastError, "The calendar link didn't work (error 404). Check the link.");
  t.state.body = '<html>not a calendar</html>';
  assert.match((await t.send('POST', `/api/outing-feeds/${feed.id}/refresh`)).json.lastError, /isn't an iCal/);
  assert.equal((await t.send('POST', '/api/outing-feeds', { name: 'Home', url: 'http://192.168.1.5/cal.ics' })).status, 400);

  for (const key of [t.kidKey, t.wallKey]) {
    assert.equal((await t.send('GET', '/api/outing-feeds', undefined, key)).status, 403);
    assert.equal((await t.send('GET', '/api/outing-feeds/pile', undefined, key)).status, 403);
    assert.equal((await t.send('POST', '/api/outing-feeds', { name: 'X', url: FEED }, key)).status, 403);
  }
  const { features } = (await t.send('GET', '/api/settings')).json;
  await t.send('PATCH', '/api/settings', { features: { ...features, outings: false } });
  assert.equal((await t.send('GET', '/api/outing-feeds')).status, 404);
  const fetches = t.state.fetches;
  await refreshDueFeeds(t.env, new Date(Date.now() + 3 * 86_400_000));
  assert.equal(t.state.fetches, fetches, 'nothing read while Outings is off');
});
