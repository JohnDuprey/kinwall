// MCP list_events with dates ("what's on today?"): a date is the household's day, not a UTC day.
// It used to pass bare dates on to GET /api/events, which reads them as UTC midnight, so a family
// in Los Angeles asking for Nov 10 lost that evening's events and got the evening before's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const rest = (p: string, init: RequestInit = {}) =>
    app.request(p, { ...init, headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json' } }, env);
  let id = 1;
  const tool = async (name: string, args: Record<string, unknown>) => {
    const res = await app.request('/mcp', {
      method: 'POST',
      headers: { Authorization: `Bearer ${ADMIN_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
      body: JSON.stringify({ jsonrpc: '2.0', id: id++, method: 'tools/call', params: { name, arguments: args } }),
    }, env);
    const body = await res.json() as any;
    assert.notEqual(body.result?.isError, true, JSON.stringify(body));
    return body.result.structuredContent;
  };
  return { rest, tool };
}

test('mcp list_events: from/to dates are days in the household timezone', async () => {
  const { rest, tool } = setup();
  await rest('/api/settings', { method: 'PATCH', body: JSON.stringify({ timezone: 'America/Los_Angeles' }) });
  const cal = await (await rest('/api/calendars', { method: 'POST', body: JSON.stringify({ kind: 'local', name: 'Home' }) })).json() as any;
  const add = (title: string, start: string, end: string, allDay = false) =>
    rest('/api/events', { method: 'POST', body: JSON.stringify({ calendarId: cal.id, title, start, end, allDay }) });
  await add('Dinner the night before', '2026-11-10T02:00:00.000Z', '2026-11-10T03:00:00.000Z'); // Nov 9, 6 PM PST
  await add('Morning drop-off', '2026-11-10T16:00:00.000Z', '2026-11-10T16:30:00.000Z'); // Nov 10, 8 AM PST
  await add('Soccer practice', '2026-11-11T01:00:00.000Z', '2026-11-11T02:00:00.000Z'); // Nov 10, 5 PM PST
  await add('Veterans Day', '2026-11-11', '2026-11-12', true);

  const day = await tool('list_events', { from: '2026-11-10', to: '2026-11-11' });
  assert.deepEqual(day.events.map((e: any) => e.title), ['Morning drop-off', 'Soccer practice']);

  // Date-times are taken as given.
  const exact = await tool('list_events', { from: '2026-11-10T00:00:00Z', to: '2026-11-11T00:00:00Z' });
  assert.deepEqual(exact.events.map((e: any) => e.title), ['Dinner the night before', 'Morning drop-off']);

  // An all-day event is on its own date, and `to` defaults to a week of household days.
  const week = await tool('list_events', { from: '2026-11-11' });
  assert.deepEqual(week.events.map((e: any) => e.title), ['Veterans Day']);
});
