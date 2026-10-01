import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { encryptConfig } from '../src/crypto.ts';
import { notesText } from '../src/providers/notes.ts';
import type { Env } from '../src/env.ts';

// An event's notes (its description): typed in Kinwall or synced from Google, Outlook and CalDAV.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ADMIN = 'ke_test_admin';

async function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, path.join(__dirname, '..', 'migrations'));
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN, PUBLIC_URL: 'http://localhost', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const json = async (p: string, method = 'GET', body?: unknown) => {
    const headers = new Headers({ Authorization: `Bearer ${ADMIN}`, Accept: 'application/json, text/event-stream' });
    if (body !== undefined) headers.set('Content-Type', 'application/json');
    const res = await app.request(p, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  return { env, json };
}

const NOTES = 'Bring shin guards\nSnack: oranges, water';

test('notes round-trip through create, update, clear, export and import', async () => {
  const { json } = await setup();
  const cal = (await json('/api/calendars', 'POST', { kind: 'local', name: 'Family', memberIds: [] })).body.id;
  const made = await json('/api/events', 'POST', { calendarId: cal, title: 'Soccer', start: '2026-10-05T16:00:00Z', end: '2026-10-05T17:00:00Z', allDay: false, description: NOTES });
  assert.equal(made.status, 201);
  assert.equal(made.body.description, NOTES, 'line breaks kept');
  assert.equal((await json(`/api/events/${made.body.id}`)).body.description, NOTES);

  const titled = await json(`/api/events/${made.body.id}`, 'PATCH', { title: 'Soccer practice' });
  assert.equal(titled.body.description, NOTES, 'other edits leave the notes alone');
  const edited = await json(`/api/events/${made.body.id}`, 'PATCH', { description: 'Away game' });
  assert.equal(edited.body.description, 'Away game');

  const file = (await json('/api/export')).body;
  assert.equal(file.events.find((e: any) => e.id === made.body.id).description, 'Away game');
  const b = await setup();
  assert.equal((await b.json('/api/import', 'POST', file)).status, 200);
  assert.equal((await b.json(`/api/events/${made.body.id}`)).body.description, 'Away game');

  const cleared = await json(`/api/events/${made.body.id}`, 'PATCH', { description: '' });
  assert.equal(cleared.body.description, null, 'an empty value clears them');
});

test('mcp: create_event and update_event take notes', async () => {
  const { json } = await setup();
  const cal = (await json('/api/calendars', 'POST', { kind: 'local', name: 'Family', memberIds: [] })).body.id;
  const call = async (name: string, args: object) => {
    const res = await json('/mcp', 'POST', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
    assert.equal(res.body.result.isError, undefined, JSON.stringify(res.body));
    return res.body.result.structuredContent.event;
  };
  const ev = await call('create_event', { calendarId: cal, title: 'Dentist', start: '2026-10-05T16:00:00Z', end: '2026-10-05T17:00:00Z', description: NOTES });
  assert.equal(ev.description, NOTES);
  assert.equal((await call('update_event', { id: ev.id, description: 'Moved to Room 2' })).description, 'Moved to Room 2');
});

test('a Google event: editing the title never rewrites its notes there; editing the notes does', async () => {
  const { env, json } = await setup();
  await env.DB.prepare("INSERT INTO accounts (id, kind, name, config, created_at) VALUES ('a1', 'google', 'G', ?, '')")
    .bind(await encryptConfig(env, 'a1', { access_token: 'tok', refresh_token: 'r', expires_at: Date.now() + 3600e3 })).run();
  await env.DB.prepare("INSERT INTO calendars (id, kind, name, config, writable, enabled, account_id, remote_id) VALUES ('g1', 'google', 'G', '', 1, 1, 'a1', 'cal1')").run();
  const bodies: any[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: any, init?: RequestInit) => {
    const b = JSON.parse(String(init?.body ?? '{}'));
    bodies.push(b);
    return Response.json({ id: 'ext1', summary: b.summary ?? 'Soccer', description: 'description' in b ? b.description : '<b>Bring</b> shin guards<br>Snack', start: { dateTime: '2026-10-05T16:00:00Z' }, end: { dateTime: '2026-10-05T17:00:00Z' } });
  }) as typeof fetch;
  try {
    const created = await json('/api/events', 'POST', { calendarId: 'g1', title: 'Soccer', start: '2026-10-05T16:00:00Z', end: '2026-10-05T17:00:00Z', allDay: false });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.description, 'Bring shin guards\nSnack', 'HTML from Google is stored as text');
    bodies.length = 0;
    const titled = await json(`/api/events/${created.body.id}`, 'PATCH', { title: 'Soccer practice' });
    assert.equal(titled.status, 200, JSON.stringify(titled.body));
    assert.equal('description' in bodies[0], false, "Google keeps its own formatting unless the notes changed");
    await json(`/api/events/${created.body.id}`, 'PATCH', { description: 'Away game\nBus at 3' });
    assert.equal(bodies[1].description, 'Away game\nBus at 3');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('notesText: HTML becomes plain text with its line breaks; plain text passes through', () => {
  assert.equal(notesText(undefined), undefined);
  assert.equal(notesText(''), undefined);
  assert.equal(notesText('Line one\r\nLine two'), 'Line one\nLine two');
  assert.equal(notesText('5 < 6 & fine'), '5 < 6 & fine', 'plain text is never entity-decoded or stripped');
  assert.equal(notesText('<p>Bring <b>shin guards</b></p><p>Snack &amp; water</p>'), 'Bring shin guards\nSnack & water');
  assert.equal(notesText('Line<br>two<br/>three'), 'Line\ntwo\nthree');
  assert.equal(notesText('<ul><li>One</li><li>Two</li></ul>'), 'One\nTwo');
  assert.equal(notesText('<script>alert(1)</script><style>p{}</style>Hi'), 'Hi', 'script and style contents are dropped');
  assert.equal(notesText('Join: <a href="https://zoom.us/j/1">https://zoom.us/j/1</a>'), 'Join: https://zoom.us/j/1');
  assert.equal(notesText('<a href="https://zoom.us/j/1">Join the call</a>'), 'Join the call (https://zoom.us/j/1)', 'a link keeps its address');
  assert.equal(notesText('<p>a</p><p></p><p></p><p>b</p>'), 'a\n\nb', 'no runs of blank lines');
  assert.equal(notesText('&lt;b&gt;not a tag&lt;/b&gt;<br>'), '<b>not a tag</b>', 'encoded markup stays text');
});
