// Event reminders more than two days ahead ("1 week before" from Google, or reminders: [10080]
// from the API, which takes up to four weeks) fire. The reminder tick only looked two days ahead
// for events to remind about, so those reminders were silently never sent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { runNotifications } from '../src/notify.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const rest = async (p: string, method = 'GET', body?: unknown) => {
    const res = await app.request(p, { method, headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }, env);
    return res.json() as Promise<any>;
  };
  await rest('/api/settings', 'PATCH', { timezone: 'America/New_York' });
  const cal = await rest('/api/calendars', 'POST', { kind: 'local', name: 'Home' });
  const reminders = () => db.prepare("SELECT title FROM notifications WHERE kind = 'reminder' ORDER BY at").all<{ title: string }>().results.map((r) => r.title);
  return { env, rest, cal, reminders };
}

test('event reminders: a week and three days before fire on time', async () => {
  const { env, rest, cal, reminders } = await setup();
  const start = Date.parse('2026-11-20T15:00:00.000Z');
  const ev = await rest('/api/events', 'POST', { calendarId: cal.id, title: 'Dentist', start: new Date(start).toISOString(), end: new Date(start + 3600e3).toISOString(), allDay: false, reminders: [10080, 4320] });
  assert.ok(ev.id, JSON.stringify(ev));

  await runNotifications(env, new Date(start - 10080 * 60e3 - 60e3)); // a minute early: nothing yet
  assert.deepEqual(reminders(), []);
  await runNotifications(env, new Date(start - 10080 * 60e3 + 60e3));
  assert.deepEqual(reminders(), ['Dentist']);
  await runNotifications(env, new Date(start - 4320 * 60e3 + 60e3));
  assert.deepEqual(reminders(), ['Dentist', 'Dentist']);
});

test('event reminders: a repeating event and an all-day event remind a week ahead', async () => {
  const { env, rest, cal, reminders } = await setup();
  await rest('/api/events', 'POST', { calendarId: cal.id, title: 'Piano', start: '2026-11-02T22:00:00.000Z', end: '2026-11-02T23:00:00.000Z', allDay: false, rrule: 'FREQ=WEEKLY', reminders: [10080] });
  await rest('/api/events', 'POST', { calendarId: cal.id, title: 'Field trip', start: '2026-11-27', end: '2026-11-28', allDay: true, reminders: [10080] });
  // Piano on Mon Nov 23 at 5 PM EST: a week before is Mon Nov 16, 5 PM.
  await runNotifications(env, new Date('2026-11-16T22:01:00.000Z'));
  assert.deepEqual(reminders(), ['Piano']);
  // Field trip on Fri Nov 27 (all day, from midnight EST): a week before is Fri Nov 20, 00:00 EST.
  await runNotifications(env, new Date('2026-11-20T05:01:00.000Z'));
  assert.deepEqual(reminders(), ['Piano', 'Field trip']);
});

test('event reminders: four weeks, the longest the API takes, fires too', async () => {
  const { env, rest, cal, reminders } = await setup();
  const start = Date.parse('2026-12-20T15:00:00.000Z');
  await rest('/api/events', 'POST', { calendarId: cal.id, title: 'Recital', start: new Date(start).toISOString(), end: new Date(start + 3600e3).toISOString(), allDay: false, reminders: [40320] });
  await runNotifications(env, new Date(start - 40320 * 60e3 + 60e3));
  assert.deepEqual(reminders(), ['Recital']);
});

test('event reminders: a household default of a week reminds events without their own', async () => {
  const { env, rest, cal, reminders } = await setup();
  await rest('/api/settings', 'PATCH', { defaultReminderMinutes: [10080] });
  const start = Date.parse('2026-11-20T15:00:00.000Z');
  await rest('/api/events', 'POST', { calendarId: cal.id, title: 'Dentist', start: new Date(start).toISOString(), end: new Date(start + 3600e3).toISOString(), allDay: false });
  await runNotifications(env, new Date(start - 10080 * 60e3 + 60e3));
  assert.deepEqual(reminders(), ['Dentist']);
});
