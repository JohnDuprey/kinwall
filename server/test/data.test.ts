import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { recordHostEvent } from '../src/entry.ts';
import { checkRate } from '../src/ratelimit.ts';
import { RECONNECT_MESSAGE, syncCalendar, syncDue } from '../src/sync.ts';
import { parseIcsEvents } from '../src/providers/ics.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function makeApp(extra: Partial<Env> = {}) {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', ...extra };
  const app = createApp();
  const request = (p: string, init: RequestInit & { key?: string } = {}) =>
    app.request(p, { ...init, headers: { Authorization: `Bearer ${init.key ?? ADMIN_KEY}`, 'Content-Type': 'application/json' } }, env);
  const post = async (p: string, body: unknown) => (await request(p, { method: 'POST', body: JSON.stringify(body) })).json() as Promise<any>;
  return Object.assign(request, { env, post });
}

test('export: seeded household has every section and no credentials', async () => {
  const request = makeApp();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n')) as typeof fetch;
  try {
    const member = await request.post('/api/members', { name: 'Ada', color: '#ff0000' });
    await request.post('/api/categories', { name: 'School', color: '#00ff00' });
    const local = await request.post('/api/calendars', { kind: 'local', name: 'Family' });
    const ics = await request.post('/api/calendars', { kind: 'ics', name: 'Feed', url: 'https://calendar.example.com/private-token.ics' });
    await request.post('/api/events', { calendarId: local.id, title: 'Dentist', start: '2026-10-01T15:00:00.000Z', end: '2026-10-01T16:00:00.000Z', allDay: false, memberIds: [member.id], reminders: [15] });
    await request.env.DB.prepare("INSERT INTO events (id, calendar_id, title, start, end, member_ids, updated_at) VALUES ('synced', ?, 'From feed', '2026-10-02', '2026-10-03', '[]', '2026-01-01')").bind(ics.id).run();
    const chore = await request.post('/api/chores', { title: 'Dishes', memberId: member.id, points: 2 });
    await request.post(`/api/chores/${chore.id}/complete`, { date: '2026-09-25', memberId: member.id });
    const list = await request.post('/api/lists', { name: 'Groceries', kind: 'shopping' });
    await request.post(`/api/lists/${list.id}/items`, { title: 'Milk' });
    await request.post('/api/webhooks', { url: 'https://hooks.example.com/k', events: ['events.changed'], secret: 'whsec_do_not_leak' });
    await request.env.DB.prepare("INSERT INTO passkeys (id, credential_id, public_key, name, created_at) VALUES ('p1', 'cred', 'pubkey-bytes', 'Phone', '2026-01-01')").run();

    const res = await request('/api/export');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition')!, /^attachment; filename="kinwall-export-\d{4}-\d{2}-\d{2}\.json"$/);
    const text = await res.text();
    const body = JSON.parse(text);
    assert.deepEqual(Object.keys(body), [
      'version', 'exportedAt', 'settings', 'members', 'categories', 'calendars', 'events', 'eventMemberOverrides', 'eventCategoryOverrides',
      'eventTravelOverrides', 'eventSeriesMemberOverrides', 'eventSeriesCategoryOverrides', 'chores', 'choreCompletions', 'lists', 'notes', 'pointEntries', 'stickerPacks', 'scrapbook', 'passkeys', 'webhooks',
    ]);
    assert.equal(body.members[0].name, 'Ada');
    assert.equal(body.calendars.length, 2);
    assert.deepEqual(body.events.map((e: any) => e.title), ['Dentist']); // synced events are re-fetched, not exported
    assert.deepEqual(body.events[0].reminders, [15]);
    assert.equal(body.choreCompletions[0].choreId, chore.id);
    assert.equal(body.lists[0].items[0].title, 'Milk');
    assert.deepEqual(body.passkeys, [{ name: 'Phone', createdAt: '2026-01-01' }]);
    assert.deepEqual(body.webhooks[0].events, ['events.changed']);
    for (const banned of ['config', 'secret', 'key_hash', 'v1:', 'pubkey-bytes', ADMIN_KEY]) assert.equal(text.includes(banned), false, banned);
    // ICS feed urls are the family's own and come along so feeds reconnect on import.
    assert.equal(body.calendars.find((c: any) => c.kind === 'ics').url, 'https://calendar.example.com/private-token.ics');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('export + host events are admin-only', async () => {
  const request = makeApp();
  const { key } = await request.post('/api/keys', { name: 'Wall', scope: 'display' });
  assert.equal((await request('/api/export', { key })).status, 403);
  assert.equal((await request('/api/host-events', { key })).status, 403);
});

test('host events: empty by default; recordHostEvent rows come back newest first, capped at 100', async () => {
  const request = makeApp();
  assert.deepEqual(await (await request('/api/host-events')).json(), []);
  await recordHostEvent(request.env.DB, 'Restored from backup', 'backup of 2026-09-24');
  await new Promise((r) => setTimeout(r, 2));
  await recordHostEvent(request.env.DB, 'Moved to a new server');
  const events = (await (await request('/api/host-events')).json()) as any[];
  assert.deepEqual(events.map((e) => [e.action, e.detail]), [['Moved to a new server', null], ['Restored from backup', 'backup of 2026-09-24']]);
  for (let i = 0; i < 120; i++) await recordHostEvent(request.env.DB, `a${i}`);
  assert.equal(((await (await request('/api/host-events')).json()) as any[]).length, 100);
});

test('/api/me: hostPortalUrl only when HOST_PORTAL_URL is set', async () => {
  const bare = await (await makeApp()('/api/me')).json() as any;
  assert.equal('hostPortalUrl' in bare, false);
  const hosted = await (await makeApp({ HOST_PORTAL_URL: 'https://host.example.com/family' })('/api/me')).json() as any;
  assert.equal(hosted.hostPortalUrl, 'https://host.example.com/family');
});

test('checkRate: allows max per window, then refuses; a new window starts over', async () => {
  const { env } = makeApp();
  for (let i = 0; i < 3; i++) assert.equal(await checkRate(env.DB, 'k', 3, 60_000), true);
  assert.equal(await checkRate(env.DB, 'k', 3, 60_000), false);
  assert.equal(await checkRate(env.DB, 'other', 3, 60_000), true);
  await env.DB.prepare("UPDATE rate_limits SET window_start = ? WHERE key = 'k'").bind(new Date(Date.now() - 61_000).toISOString()).run();
  assert.equal(await checkRate(env.DB, 'k', 3, 60_000), true);
});

async function seed(request: ReturnType<typeof makeApp>) {
  await request('/api/settings', { method: 'PATCH', body: JSON.stringify({ familyName: 'Lovelace', quietFrom: '22:00', quietTo: '06:30', weekStart: 1, defaultReminderMinutes: [10, 60] }) });
  const ada = await request.post('/api/members', { name: 'Ada', color: '#ff0000', avatar: 'A' });
  const bob = await request.post('/api/members', { name: 'Bob', color: '#0000ff' });
  const school = await request.post('/api/categories', { name: 'School', color: '#00ff00', emoji: '🏫', keywords: ['math'] });
  const cal = await request.post('/api/calendars', { kind: 'local', name: 'Family', color: '#123456', memberIds: [ada.id], categoryId: school.id });
  // Synced calendars: settings and per-event overrides travel in the export, credentials don't.
  const feed = await request.post('/api/calendars', { kind: 'ics', name: 'School feed', url: 'https://calendar.example.com/school.ics', color: '#654321', memberIds: [bob.id], categoryId: school.id });
  await request.env.DB.prepare("INSERT INTO accounts (id, kind, name, config, created_at) VALUES ('acc', 'google', 'Gmail', '', '2026-01-01')").run();
  const work = await request.post('/api/calendars', { kind: 'google', accountId: 'acc', remoteId: 'primary', name: 'Work', color: '#abcdef', memberIds: [ada.id] });
  await request.env.DB.batch([
    request.env.DB.prepare("INSERT INTO event_member_overrides (calendar_id, external_id, member_ids, updated_at) VALUES (?, 'x1', ?, '2026-01-01')").bind(feed.id, JSON.stringify([ada.id])),
    request.env.DB.prepare("INSERT INTO event_category_overrides (calendar_id, external_id, category_id, updated_at) VALUES (?, 'x2', ?, '2026-01-01')").bind(work.id, school.id),
    request.env.DB.prepare("INSERT INTO event_travel_overrides (calendar_id, external_id, travel_minutes, remind_before_leave, updated_at) VALUES (?, 'x3', 25, 1, '2026-01-01')").bind(work.id),
    request.env.DB.prepare("INSERT INTO event_series_member_overrides (calendar_id, series_id, member_ids, updated_at) VALUES (?, 's1', ?, '2026-01-01')").bind(work.id, JSON.stringify([bob.id])),
    request.env.DB.prepare("INSERT INTO event_series_category_overrides (calendar_id, series_id, category_id, updated_at) VALUES (?, 's2', ?, '2026-01-01')").bind(feed.id, school.id),
  ]);
  const dentist = await request.post('/api/events', { calendarId: cal.id, title: 'Dentist', start: '2026-10-01T15:00:00.000Z', end: '2026-10-01T16:00:00.000Z', allDay: false, memberIds: [ada.id, bob.id], reminders: [15], categoryId: school.id, travelMinutes: 20, remindBeforeLeave: true });
  await request.post('/api/events', { calendarId: cal.id, title: 'Swim', start: '2026-10-02', end: '2026-10-03', allDay: true, rrule: 'FREQ=WEEKLY', memberIds: [] });
  const dishes = await request.post('/api/chores', { title: 'Dishes', memberId: ada.id, points: 2, rrule: 'FREQ=DAILY' });
  await request.post('/api/chores', { title: 'Bins', points: 1 });
  await request.post(`/api/chores/${dishes.id}/complete`, { date: '2026-09-25', memberId: ada.id });
  const list = await request.post('/api/lists', { name: 'Groceries', kind: 'shopping', memberIds: [bob.id], sortBy: 'alpha' });
  const [milk, bread] = await request.post(`/api/lists/${list.id}/items`, [{ title: 'Milk', store: 'Aldi', category: 'Dairy', memberId: bob.id, priority: 'low' }, { title: 'Bread', priority: 'urgent', steps: ['Slice', 'Wrap'] }]);
  await request(`/api/lists/${list.id}/items/${bread.id}/steps/${bread.steps[0].id}`, { method: 'PATCH', body: JSON.stringify({ done: true }) });
  await request(`/api/lists/${list.id}/groups`, { method: 'PUT', body: JSON.stringify({ groups: [{ kind: 'category', name: 'Dairy' }, { kind: 'store', name: 'Aldi' }] }) });
  await request.post('/api/notes', { target: `event:${dentist.id}`, body: 'Bring the forms', memberId: ada.id });
  await request.post('/api/notes', { target: `list_item:${milk.id}`, body: 'Oat milk this time' });
  // A note on a synced event isn't exported (its target isn't in the file).
  await request.env.DB.prepare("INSERT INTO notes (id, target_type, target_id, member_id, body, created_at, updated_at) VALUES ('n-synced', 'event', 'e_remote', NULL, 'x', '2026-01-01', '2026-01-01')").run();
  // Points ledger + sticker book: a bonus, a purchase, and two stickers on Ada's page.
  await request.env.DB.prepare("INSERT INTO point_entries (id, member_id, amount, reason, ref, at) VALUES ('bonus', ?, 20, 'adjustment', NULL, '2026-09-01T00:00:00.000Z')").bind(ada.id).run();
  await request.post('/api/stickers/packs/sweets/buy', { memberId: ada.id });
  const cat = await request.post(`/api/stickers/scrapbook/${ada.id}`, { sticker: '🐱', x: 0.25, y: 0.75 });
  await request(`/api/stickers/scrapbook/${ada.id}/${cat.id}`, { method: 'PATCH', body: JSON.stringify({ scale: 1.5, rotation: 30 }) });
  await request.post(`/api/stickers/scrapbook/${ada.id}`, { sticker: '🍩' });
  return { ada, cal, dishes, list };
}

const exported = async (request: ReturnType<typeof makeApp>) => {
  const { exportedAt, ...rest } = (await (await request('/api/export')).json()) as any;
  return rest;
};
const importFile = (request: ReturnType<typeof makeApp>, body: unknown, key?: string) => request('/api/import', { method: 'POST', body: JSON.stringify(body), key });

test('import: export -> fresh instance -> import -> export round-trips; a second import changes nothing', async () => {
  const source = makeApp();
  await seed(source);
  await source.post('/api/webhooks', { url: 'https://hooks.example.com/k', events: [], secret: 's' });
  await source.env.DB.prepare("INSERT INTO passkeys (id, credential_id, public_key, name, created_at) VALUES ('p1', 'cred', 'pk', 'Phone', '2026-01-01')").run();
  const file = (await (await source('/api/export')).json()) as any;
  assert.deepEqual([file.settings.familyName, file.settings.quietFrom, file.events[0].reminders, file.lists[0].groups.length], ['Lovelace', '22:00', [15], 2]);
  assert.deepEqual([file.calendars.length, file.eventMemberOverrides.length, file.eventCategoryOverrides.length], [3, 1, 1]);
  assert.deepEqual([file.events[0].travelMinutes, file.events[0].remindBeforeLeave], [20, true]);
  assert.deepEqual(file.eventTravelOverrides, [{ calendarId: file.calendars.find((c: any) => c.name === 'Work').id, externalId: 'x3', travelMinutes: 25, remindBeforeLeave: true }]);
  assert.deepEqual(file.eventSeriesMemberOverrides, [{ calendarId: file.calendars.find((c: any) => c.name === 'Work').id, seriesId: 's1', memberIds: [file.members.find((m: any) => m.name === 'Bob').id] }]);
  assert.deepEqual(file.eventSeriesCategoryOverrides.map((o: any) => o.seriesId), ['s2']);
  assert.equal(typeof file.choreCompletions[0].pointsAwarded, 'number');
  assert.deepEqual(file.notes.map((n: any) => [n.targetType, n.body, !!n.memberId]), [['event', 'Bring the forms', true], ['list_item', 'Oat milk this time', false]]);
  assert.deepEqual(file.pointEntries.map((e: any) => [e.amount, e.reason, e.ref]), [[20, 'adjustment', null], [-15, 'sticker_pack', 'sweets']]);
  assert.deepEqual(file.stickerPacks.map((p: any) => p.packId), ['sweets']);
  assert.deepEqual(file.scrapbook.map((st: any) => [st.sticker, st.x, st.y, st.scale, st.rotation, st.z]), [['🐱', 0.25, 0.75, 1.5, 30, 1], ['🍩', 0.5, 0.5, 1, 0, 2]]);
  const bread = file.lists[0].items.find((i: any) => i.title === 'Bread');
  assert.deepEqual([bread.priority, bread.steps.map((st: any) => [st.title, st.done]), bread.stepsDone], ['urgent', [['Slice', true], ['Wrap', false]], 1]);
  assert.deepEqual([file.lists[0].sortBy, file.lists[0].items.find((i: any) => i.title === 'Milk').priority], ['alpha', 'low']);
  file.settings = { ...file.settings, lateCompletionCredit: 25, streakGraceDays: 3, leaderboardEnabled: false }; // non-defaults must survive too

  const target = makeApp();
  const res = await importFile(target, file);
  assert.equal(res.status, 200);
  const byName = (n: string) => file.calendars.find((c: any) => c.name === n);
  assert.deepEqual(await res.json(), {
    imported: { members: 2, categories: 1, calendars: 3, events: 2, eventMemberOverrides: 1, eventCategoryOverrides: 1, eventTravelOverrides: 1, eventSeriesMemberOverrides: 1, eventSeriesCategoryOverrides: 1, chores: 2, choreCompletions: 1, lists: 1, listItems: 2, listItemSteps: 2, notes: 2, pointEntries: 2, stickerPacks: 1, scrapbook: 2 },
    needsReconnect: [{ id: byName('Work').id, kind: 'google', name: 'Work' }], // the ICS feed came back with its url
    skipped: { passkeys: 1, webhooks: 1 },
  });
  const after = await exported(target);
  const { exportedAt, ...expected } = file;
  assert.deepEqual(after, { ...expected, passkeys: [], webhooks: [] });
  const ada = file.members.find((m: any) => m.name === 'Ada');
  assert.equal((await (await target('/api/members')).json() as any[]).find((m) => m.id === ada.id).balance, file.choreCompletions[0].pointsAwarded + 20 - 15); // balance is derived, so it round-trips too

  assert.equal((await importFile(target, file)).status, 200);
  assert.deepEqual(await exported(target), after);
});

test('import merges by id into a family that already has data', async () => {
  const source = makeApp();
  const { ada } = await seed(source);
  const file = (await (await source('/api/export')).json()) as any;
  const target = makeApp();
  const mine = await target.post('/api/members', { name: 'Zed', color: '#000000' });
  file.members[0].name = 'Ada L.';
  assert.equal((await importFile(target, file)).status, 200);
  const members = (await (await target('/api/members')).json()) as any[];
  assert.deepEqual(members.map((m) => m.id).sort(), [mine.id, ...file.members.map((m: any) => m.id)].sort());
  assert.equal(members.find((m) => m.id === ada.id).name, 'Ada L.');
});

test('import: a list from before sortBy imports as manual; a legacy "high" priority is kept', async () => {
  const source = makeApp();
  await seed(source);
  const file = (await (await source('/api/export')).json()) as any;
  delete file.lists[0].sortBy;
  file.lists[0].items.find((i: any) => i.title === 'Bread').priority = 'high';
  const target = makeApp();
  assert.equal((await importFile(target, file)).status, 200);
  const [l] = (await exported(target)).lists;
  assert.deepEqual([l.sortBy, l.items.find((i: any) => i.title === 'Bread').priority], ['manual', 'high']);
});

// A version-1 file from before the override sections existed.
const legacyFile = () => ({
  version: 1,
  exportedAt: '2026-09-25T00:00:00.000Z',
  settings: { familyName: 'X', timezone: null, someRemovedKey: 'ignored' },
  members: [{ id: 'm', name: 'Ada', color: '#ff0000', avatar: null, sort: 0 }],
  categories: [{ id: 'cat', name: 'School', emoji: null, color: '#00ff00', keywords: [], sort: 0, createdAt: '2026-01-01' }],
  calendars: [
    { id: 'loc', kind: 'local', name: 'Home', color: null, remoteId: null, memberIds: [], categoryId: null, enabled: true },
    { id: 'g', kind: 'google', name: 'Work', color: '#abcdef', remoteId: 'primary', memberIds: ['m'], categoryId: 'cat', enabled: true },
    { id: 'f', kind: 'ics', name: 'Feed', color: '#123123', remoteId: null, memberIds: [], categoryId: null, enabled: true },
  ],
  events: [
    { id: 'e1', calendarId: 'loc', title: 'Kept', start: '2026-10-01', end: '2026-10-02', allDay: true, location: null, description: null, rrule: null, memberIds: ['nobody'], categoryId: null, reminders: null },
    { id: 'e2', calendarId: 'g', title: 'Dropped', start: '2026-10-01', end: '2026-10-02', allDay: true, location: null, description: null, rrule: null, memberIds: [], categoryId: null, reminders: null },
  ],
  chores: [{ id: 'c1', title: 'Orphan', emoji: null, memberId: 'gone', points: 1, rrule: null, dueDate: null, dueTime: null, active: true, sort: 0 }],
  choreCompletions: [{ id: 'cc', choreId: 'missing-chore', date: '2026-09-25', memberId: null, completedAt: '2026-09-25T10:00:00.000Z' }],
  lists: [],
  passkeys: [],
  webhooks: [],
});

type CalRow = { account_id: string | null; config: string; last_error: string | null; last_synced_at: string | null; color: string; member_ids: string; category_id: string | null };
const calRow = (request: ReturnType<typeof makeApp>, id: string) => request.env.DB.prepare('SELECT * FROM calendars WHERE id = ?').bind(id).first<CalRow>();
const count = async (request: ReturnType<typeof makeApp>, sql: string) => (await request.env.DB.prepare(sql).first<{ n: number }>())!.n;
// Reconnecting kicks off a sync in the background; it stamps last_synced_at when done (ok or not).
async function synced(request: ReturnType<typeof makeApp>, id: string) {
  for (let i = 0; i < 200 && !(await calRow(request, id))!.last_synced_at; i++) await new Promise((r) => setTimeout(r, 5));
  assert.ok((await calRow(request, id))!.last_synced_at, 'sync ran after reconnect');
}

test('import: synced calendars come in as disconnected placeholders (file without override sections)', async () => {
  const request = makeApp();
  const res = await importFile(request, legacyFile());
  assert.equal(res.status, 200);
  const body = (await res.json()) as any;
  assert.deepEqual(body.needsReconnect, [{ id: 'f', kind: 'ics', name: 'Feed' }, { id: 'g', kind: 'google', name: 'Work' }]);
  assert.deepEqual([body.imported.calendars, body.imported.events, body.imported.eventMemberOverrides, body.imported.choreCompletions], [3, 1, 0, 0]);
  const ids = (await request.env.DB.prepare('SELECT id FROM events ORDER BY id').all<{ id: string }>()).results.map((r) => r.id);
  assert.deepEqual(ids, ['e1']); // synced events are re-fetched, not imported
  const g = (await calRow(request, 'g'))!;
  assert.deepEqual([g.account_id, g.config, g.last_error, g.color, g.member_ids, g.category_id], [null, '', RECONNECT_MESSAGE, '#abcdef', '["m"]', 'cat']);
  const api = ((await (await request('/api/calendars')).json()) as any[]).find((c) => c.id === 'g');
  assert.deepEqual([api.needsReconnect, api.writable, api.lastError], [true, false, RECONNECT_MESSAGE]);
  assert.equal((await request.env.DB.prepare("SELECT member_id FROM chores WHERE id = 'c1'").first<{ member_id: string | null }>())!.member_id, null); // unknown member -> unassigned
  assert.equal(((await (await request('/api/settings')).json()) as any).familyName, 'X');

  // Sync leaves placeholders alone: no provider call, no error rewrite, no last_synced_at churn.
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => assert.fail('placeholder must not be fetched')) as typeof fetch;
  try {
    assert.deepEqual(await syncCalendar(request.env, 'g'), { ok: false, error: RECONNECT_MESSAGE });
    await syncDue(request.env);
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual([(await calRow(request, 'g'))!.last_error, (await calRow(request, 'f'))!.last_synced_at], [RECONNECT_MESSAGE, null]);
});

test('reconnect: adding the same provider calendar from an account re-attaches the placeholder with its settings and overrides', async () => {
  const request = makeApp();
  const file = {
    ...legacyFile(),
    eventMemberOverrides: [{ calendarId: 'g', externalId: 'x1', memberIds: ['m'] }, { calendarId: 'not-in-file', externalId: 'x', memberIds: [] }],
    eventCategoryOverrides: [{ calendarId: 'g', externalId: 'x2', categoryId: 'cat' }],
  };
  const imported = (await (await importFile(request, file)).json()) as any;
  assert.deepEqual([imported.imported.eventMemberOverrides, imported.imported.eventCategoryOverrides], [1, 1]);
  await request.env.DB.prepare("INSERT INTO accounts (id, kind, name, config, created_at) VALUES ('acc', 'google', 'Gmail', '', '2026-01-01')").run();

  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('nope', { status: 500 })) as typeof fetch;
  try {
    // The picker sends the remote calendar's own name/color; the placeholder's settings win.
    const res = await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'google', accountId: 'acc', remoteId: 'primary', name: 'primary@gmail', color: '#000000', memberIds: [] }) });
    assert.equal(res.status, 200);
    const cal = (await res.json()) as any;
    assert.deepEqual(
      [cal.id, cal.accountId, cal.name, cal.color, cal.memberIds, cal.categoryId, cal.lastError, cal.needsReconnect],
      ['g', 'acc', 'Work', '#abcdef', ['m'], 'cat', null, false],
    );
    await synced(request, 'g');
    assert.equal(await count(request, "SELECT COUNT(*) AS n FROM calendars WHERE kind = 'google'"), 1);
    assert.equal(await count(request, "SELECT COUNT(*) AS n FROM event_member_overrides WHERE calendar_id = 'g' AND external_id = 'x1'"), 1);
    assert.equal(await count(request, "SELECT COUNT(*) AS n FROM event_category_overrides WHERE calendar_id = 'g' AND category_id = 'cat'"), 1);
    // Only a disconnected row is re-attached: adding it again (or another remote calendar) creates a new one.
    assert.equal((await request('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'google', accountId: 'acc', remoteId: 'primary', name: 'Again' }) })).status, 201);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('reconnect: an imported ICS calendar takes a feed URL by PATCH (checked like create) and its overrides apply', async () => {
  const request = makeApp();
  const start = new Date(Date.now() + 5 * 86400_000);
  start.setUTCHours(10, 0, 0, 0);
  const stamp = start.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''); // 20261001T100000Z
  const feed = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:u1', `DTSTART:${stamp}`, `DTEND:${stamp.replace('T10', 'T11')}`, 'SUMMARY:Match', 'END:VEVENT', 'END:VCALENDAR', ''].join('\r\n');
  const [{ externalId }] = await parseIcsEvents(feed, new Date(0), new Date(start.getTime() + 86400_000), 'UTC'); // what the old instance keyed it by
  await importFile(request, { ...legacyFile(), eventMemberOverrides: [{ calendarId: 'f', externalId, memberIds: ['m'] }] });

  const patch = (id: string, body: unknown) => request(`/api/calendars/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  assert.equal((await patch('f', { url: 'http://127.0.0.1/private.ics' })).status, 400);
  assert.equal((await patch('loc', { url: 'https://calendar.example.com/x.ics' })).status, 400);
  assert.equal((await calRow(request, 'f'))!.config, '');

  const realFetch = globalThis.fetch;
  const fetched: string[] = [];
  globalThis.fetch = (async (url: string) => {
    fetched.push(String(url));
    return new Response(feed);
  }) as typeof fetch;
  try {
    const res = await patch('f', { url: 'https://calendar.example.com/feed.ics' });
    assert.equal(res.status, 200);
    const cal = (await res.json()) as any;
    assert.deepEqual([cal.lastError, cal.needsReconnect, cal.color], [null, false, '#123123']);
    await synced(request, 'f');
  } finally {
    globalThis.fetch = realFetch;
  }
  assert.deepEqual(fetched, ['https://calendar.example.com/feed.ics']);
  assert.equal((await calRow(request, 'f'))!.last_error, null);
  const from = new Date(start.getTime() - 86400_000).toISOString();
  const to = new Date(start.getTime() + 86400_000).toISOString();
  const events = (await (await request(`/api/events?from=${from}&to=${to}&calendarId=f`)).json()) as any[];
  assert.deepEqual(events.map((e) => [e.title, e.memberIds]), [['Match', ['m']]]);
});

test('import rejects other versions, bad settings (before writing anything), oversize bodies and display keys', async () => {
  const request = makeApp();
  const empty = { version: 1, settings: {}, members: [], categories: [], calendars: [], events: [], chores: [], choreCompletions: [], lists: [], passkeys: [], webhooks: [] };
  const v2 = await importFile(request, { ...empty, version: 2 });
  assert.equal(v2.status, 400);
  assert.match(((await v2.json()) as any).error, /^version: unsupported export version/);
  assert.equal((await importFile(request, { nope: true })).status, 400);
  const badSettings = await importFile(request, { ...empty, settings: { accent: 'red' }, members: [{ id: 'm', name: 'M', color: '#fff', avatar: null, sort: 0 }] });
  assert.equal(badSettings.status, 400);
  assert.match(((await badSettings.json()) as any).error, /^settings\.accent/);
  assert.equal((await request.env.DB.prepare('SELECT COUNT(*) AS n FROM members').first<{ n: number }>())!.n, 0);
  assert.equal((await importFile(request, { ...empty, pad: 'x'.repeat(10 * 1024 * 1024) })).status, 413);
  const { key } = await request.post('/api/keys', { name: 'Wall', scope: 'display' });
  assert.equal((await importFile(request, empty, key)).status, 403);
});

test('import: a section bigger than one JSON chunk is split across statements and fully applied', async () => {
  const request = makeApp();
  const item = (i: number) => ({ id: `i${i}`, listId: 'l', title: `Item ${i} ${'x'.repeat(200)}`, notes: null, quantity: null, store: null, category: null, memberId: null, dueDate: null, done: false, doneAt: null, doneBy: null, sort: i, createdAt: '2026-01-01', updatedAt: '2026-01-01' });
  const list = { id: 'l', name: 'Big', emoji: null, color: null, kind: 'todo', memberIds: [], groupBy: 'none', sort: 0, archived: false, createdAt: '2026-01-01', itemCount: 0, openCount: 0, groups: [], items: Array.from({ length: 5000 }, (_, i) => item(i)) };
  const res = await importFile(request, { version: 1, settings: {}, members: [], categories: [], calendars: [], events: [], chores: [], choreCompletions: [], lists: [list], passkeys: [], webhooks: [] });
  assert.equal(res.status, 200);
  assert.equal((await request.env.DB.prepare('SELECT COUNT(*) AS n FROM list_items').first<{ n: number }>())!.n, 5000);
});
