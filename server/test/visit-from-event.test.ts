// A calendar event made into a health visit (visit-from-event.ts, "Make it a health visit"): the
// guessed type and fields, the link (the visit's sealed data.eventId, never anything on the event),
// health's privacy (walls and kids' devices can't see or make one), and MCP add_tracker_entry's eventId.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { guessVisitType, looksMedical, plainText, visitFromEvent } from '../src/visit-from-event.ts';
import type { Env } from '../src/env.ts';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ADMIN_KEY = 'fc_test_admin_key';

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(HERE, '..', 'migrations'));
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const req = (p: string, init: RequestInit, key: string) => app.request(p, { ...init, headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...init.headers } }, env);
  const send = async (method: string, p: string, body?: unknown, key = ADMIN_KEY) => {
    const res = await req(p, { method, body: body === undefined ? undefined : JSON.stringify(body) }, key);
    return { status: res.status, body: (await res.json()) as any };
  };
  const tool = async (name: string, args: Record<string, unknown>) =>
    ((await (await req('/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }, ADMIN_KEY)).json()) as any).result;
  const device = async (name: string, kind: 'kid' | 'wall', owner?: string) => {
    const k = (await send('POST', '/api/keys', { name, scope: 'display' })).body;
    assert.equal((await send('PATCH', `/api/keys/${k.id}`, { kind, owner: owner ?? 'shared' })).status, 200);
    return k.key as string;
  };
  return { db, send, tool, device };
}

test('visit-from-event: the copy in web/ is identical', () => {
  const read = (p: string) => readFileSync(path.join(HERE, p), 'utf8');
  assert.equal(read('../../web/src/visit-from-event.ts'), read('../src/visit-from-event.ts'), 'copy server/src/visit-from-event.ts to web/src/visit-from-event.ts');
});

test('visit-from-event: the type a title suggests', () => {
  const cases: [string, string][] = [
    ['Dentist - Maya', 'dentist'], ['Dental cleaning', 'dentist'], ['Orthodontist', 'dentist'],
    ['Flu shots', 'vaccine'], ['Leo vaccine', 'vaccine'], ['COVID booster', 'vaccine'],
    ['Annual checkup', 'checkup'], ['Sports physical', 'checkup'], ['Well-child visit', 'checkup'], ['Well visit', 'checkup'],
    ['Sick visit', 'sick'], ['Urgent care', 'sick'],
    ['Dr. Rivera', 'specialist'], ['Dermatologist', 'specialist'], ['Physical therapy', 'specialist'], ['Allergy test', 'specialist'],
    ['Checkup with Dr. Patel', 'checkup'], ['Sick visit, Dr. Lee', 'sick'],
    ['Soccer Practice', 'other'], ['Vet - Biscuit', 'other'], ['Parent-Teacher Conference', 'other'], ['Farewell party', 'other'], ['Shopping well', 'other'],
  ];
  for (const [title, type] of cases) assert.equal(guessVisitType(title), type, title);
  assert.equal(looksMedical('Dentist - Alex'), true);
  assert.equal(looksMedical('Piano Lesson'), false);
});

test('visit-from-event: fields from the event, in household time', () => {
  const timed = visitFromEvent({ title: ' Checkup ', start: '2026-10-14T13:30:00.000Z', allDay: false, location: 'Northside Pediatrics', description: '<p>Bring the <b>shot</b> card</p><br>Fast &amp; easy', memberIds: ['m3'] }, 'America/New_York');
  assert.deepEqual(timed, { date: '2026-10-14', time: '09:30', title: 'Checkup', type: 'checkup', provider: 'Northside Pediatrics', notes: 'Bring the shot card\n\nFast & easy', memberId: 'm3' });
  const late = visitFromEvent({ title: 'Dentist', start: '2026-10-15T02:00:00.000Z', allDay: false, memberIds: [] }, 'America/Los_Angeles');
  assert.deepEqual([late.date, late.time], ['2026-10-14', '19:00'], 'the household day, not UTC');
  const allDay = visitFromEvent({ title: 'Flu shots', start: '2026-10-20', allDay: true, location: '  ', description: null, memberIds: ['m3', 'm4'] }, 'America/New_York');
  assert.deepEqual([allDay.date, allDay.time, allDay.provider, allDay.notes, allDay.memberId], ['2026-10-20', null, null, null, undefined], 'several members: ask');
  assert.equal(plainText('plain\n\n\n\ntext'), 'plain\n\ntext');
});

test('visit-from-event: a visit links to its event on the Kinwall side only, sealed at rest', async () => {
  const { db, send } = setup();
  const maya = (await send('POST', '/api/members', { name: 'Maya', color: '#7ED9A6' })).body;
  const cal = (await send('POST', '/api/calendars', { kind: 'local', name: 'Family' })).body;
  const ev = (await send('POST', '/api/events', { calendarId: cal.id, title: 'Dentist - Maya', start: '2026-10-14T13:30:00.000Z', end: '2026-10-14T14:30:00.000Z', allDay: false, location: 'Bright Smiles Dental', memberIds: [maya.id] })).body;
  const before = JSON.stringify((await send('GET', `/api/events/${ev.id}`)).body);

  const visit = await send('POST', '/api/trackers', { kind: 'health', memberId: maya.id, date: '2026-10-14', title: 'Dentist - Maya', data: { type: 'dentist', time: '09:30', provider: 'Bright Smiles Dental', eventId: ev.id } });
  assert.equal(visit.status, 201);
  assert.equal(visit.body.data.eventId, ev.id);
  const listed = (await send('GET', '/api/trackers?kind=health')).body;
  assert.equal(listed.find((e: any) => e.data.eventId === ev.id)?.id, visit.body.id, 'the event sheet finds its visit');

  const row = await db.prepare('SELECT title, data FROM tracker_entries WHERE id = ?').bind(visit.body.id).first<{ title: string; data: string }>();
  assert.match(row!.title, /^enc:v1:/);
  assert.match(row!.data, /^enc:v1:/);
  assert.ok(!row!.data.includes(ev.id), 'the link is sealed with the rest of the visit');
  assert.equal(JSON.stringify((await send('GET', `/api/events/${ev.id}`)).body), before, 'nothing is written to the event');
});

test("visit-from-event: walls and kids' devices can't see or make a health visit", async () => {
  const { send, device } = setup();
  const maya = (await send('POST', '/api/members', { name: 'Maya', color: '#7ED9A6' })).body;
  const wall = await device('Kitchen wall', 'wall');
  const kid = await device("Maya's tablet", 'kid', maya.id);
  await send('POST', '/api/trackers', { kind: 'health', memberId: maya.id, data: { type: 'dentist', eventId: 'e_1' } });
  for (const key of [wall, kid]) {
    assert.equal((await send('GET', '/api/trackers?kind=health', undefined, key)).status, 403);
    assert.equal((await send('POST', '/api/trackers', { kind: 'health', memberId: maya.id, data: { type: 'checkup', eventId: 'e_1' } }, key)).status, 403);
  }
});

test('visit-from-event: MCP add_tracker_entry with eventId fills the visit in from the event and links it', async () => {
  const { send, tool } = setup();
  await send('PATCH', '/api/settings', { timezone: 'America/New_York', aiHealthAccess: true });
  const maya = (await send('POST', '/api/members', { name: 'Maya', color: '#7ED9A6' })).body;
  const cal = (await send('POST', '/api/calendars', { kind: 'local', name: 'Family' })).body;
  const ev = (await send('POST', '/api/events', { calendarId: cal.id, title: 'Flu shot', start: '2026-10-14T13:30:00.000Z', end: '2026-10-14T14:00:00.000Z', allDay: false, location: 'Northside Pediatrics', description: 'Bring the card', memberIds: [maya.id] })).body;

  const made = await tool('add_tracker_entry', { kind: 'health', eventId: ev.id });
  assert.ok(!made.isError, made.content?.[0]?.text);
  const e = made.structuredContent.entry;
  assert.deepEqual([e.memberId, e.date, e.title, e.data.type, e.data.time, e.data.provider, e.data.notes, e.data.eventId], [maya.id, '2026-10-14', 'Flu shot', 'vaccine', '09:30', 'Northside Pediatrics', 'Bring the card', ev.id]);

  const given = (await tool('add_tracker_entry', { kind: 'health', eventId: ev.id, title: 'Flu and COVID shots', data: { type: 'other' } })).structuredContent.entry;
  assert.deepEqual([given.title, given.data.type, given.data.time], ['Flu and COVID shots', 'other', '09:30'], 'what the caller gives wins');

  assert.equal((await tool('add_tracker_entry', { kind: 'health', eventId: 'nope' })).isError, true);
  assert.equal((await tool('add_tracker_entry', { kind: 'reading', title: 'Matilda', eventId: ev.id })).isError, true, 'only a health visit comes from an event');
});
