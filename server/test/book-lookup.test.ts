// Book lookup (routes/books.ts) and reading covers: Open Library search through the server, and a
// reading entry's coverUrl served through the server so the browser never talks to a third party.
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

function setup() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' } as Env;
  const app = createApp();
  const req = (p: string, init: RequestInit = {}) =>
    app.request(p, { ...init, headers: { Authorization: `Bearer ${ADMIN_KEY}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) } }, env);
  const send = async (method: string, p: string, body?: unknown) => {
    const res = await req(p, { method, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as any };
  };
  return { app, env, req, send };
}

function mockFetch(answer: (url: string) => Response) {
  const calls: string[] = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return answer(url);
  }) as typeof fetch;
  return calls;
}

test('book search: Open Library through the server, shaped for the reading form', async () => {
  const { req, send } = setup();
  const calls = mockFetch(() => Response.json({
    docs: [
      { key: '/works/OL1W', title: "Charlotte's Web", author_name: ['E. B. White', 'Garth Williams'], first_publish_year: 1952, number_of_pages_median: 184, cover_i: 12345 },
      { key: '/works/OL2W', title: 'Bare' },
    ],
  }));
  const res = await send('GET', "/api/books/search?q=charlotte's web");
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, [
    { title: "Charlotte's Web", author: 'E. B. White', year: 1952, pages: 184, coverId: 12345, coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg' },
    { title: 'Bare' },
  ]);
  const url = new URL(calls[0]);
  assert.equal(url.host, 'openlibrary.org');
  assert.equal(url.pathname, '/search.json');
  assert.equal(url.searchParams.get('q'), "charlotte's web");

  assert.equal((await req('/api/books/search?q=a')).status, 400, 'too short');
  mockFetch(() => new Response('down', { status: 503 }));
  assert.equal((await req('/api/books/search?q=matilda')).status, 502);
});

test('book search: a result thumbnail is fetched by its numeric cover id only', async () => {
  const { app, env, req } = setup();
  const calls = mockFetch(() => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }));
  const res = await app.request(`/api/books/covers/12345?key=${ADMIN_KEY}`, {}, env); // an <img> can't send a header
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.equal(calls[0], 'https://covers.openlibrary.org/b/id/12345-M.jpg');
  assert.equal((await req('/api/books/covers/abc')).status, 400);
});

test('reading covers: a public https coverUrl is stored and served through the server', async () => {
  const { app, env, req, send } = setup();
  const book = await send('POST', '/api/trackers', { kind: 'reading', title: 'Matilda', data: { coverUrl: 'https://covers.example.com/matilda.jpg' } });
  assert.equal(book.status, 201);
  assert.equal(book.body.data.coverUrl, 'https://covers.example.com/matilda.jpg');

  const calls = mockFetch(() => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }));
  const res = await app.request(`/api/trackers/${book.body.id}/cover?key=${ADMIN_KEY}`, {}, env);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(calls, ['https://covers.example.com/matilda.jpg']);

  mockFetch(() => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } }));
  assert.equal((await req(`/api/trackers/${book.body.id}/cover`)).status, 502, 'never serves anything but a photo');

  const bare = await send('POST', '/api/trackers', { kind: 'reading', title: 'Holes' });
  assert.equal((await req(`/api/trackers/${bare.body.id}/cover`)).status, 404);
  const memory = await send('POST', '/api/trackers', { kind: 'memory', data: { text: 'Snow day' } });
  assert.equal((await req(`/api/trackers/${memory.body.id}/cover`)).status, 404);

  for (const coverUrl of ['http://covers.example.com/a.jpg', 'javascript:alert(1)', 'https://10.0.0.5/a.jpg']) {
    assert.equal((await send('POST', '/api/trackers', { kind: 'reading', title: 'Bad', data: { coverUrl } })).status, 400, coverUrl);
  }
  const cleared = await send('PATCH', `/api/trackers/${book.body.id}`, { data: { coverUrl: null } });
  assert.equal(cleared.body.data.coverUrl, undefined);
});
