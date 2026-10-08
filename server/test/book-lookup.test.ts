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
    { title: "Charlotte's Web", author: 'E. B. White', year: 1952, pages: 184, coverId: 12345, coverUrl: 'https://covers.openlibrary.org/b/id/12345-M.jpg', workKey: '/works/OL1W' },
    { title: 'Bare', workKey: '/works/OL2W' },
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
  const { app, env, req, send } = setup();
  const calls = mockFetch(() => new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }));
  const { token } = (await send('GET', '/api/media-token')).body;
  const res = await app.request(`/api/books/covers/12345?key=${token}`, {}, env); // an <img> can't send a header: a media token
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
  const { token } = (await send('GET', '/api/media-token')).body;
  const res = await app.request(`/api/trackers/${book.body.id}/cover?key=${token}`, {}, env);
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

test("book lookup and covers work from kids' own devices and wall screens (display keys)", async () => {
  const { app, env, send } = setup();
  await send('POST', '/api/members', { name: 'Alex', color: '#336699', grownUp: true });
  const leo = (await send('POST', '/api/members', { name: 'Leo', color: '#993366' })).body;
  const device = async (name: string, kind: string, owner: string) => {
    const k = (await send('POST', '/api/keys', { name, scope: 'display' })).body;
    assert.equal((await send('PATCH', `/api/keys/${k.id}`, { kind, owner })).status, 200);
    return k.key as string;
  };
  const keys = { kid: await device("Leo's tablet", 'kid', leo.id), wall: await device('Kitchen wall', 'wall', 'shared') };
  mockFetch((url) => url.includes('search.json') ? Response.json({ docs: [{ title: 'Holes', cover_i: 5 }] }) : new Response(JPEG, { headers: { 'content-type': 'image/jpeg' } }));
  const book = (await send('POST', '/api/trackers', { kind: 'reading', memberId: leo.id, title: 'Holes', data: { coverUrl: 'https://covers.example.com/holes.jpg' } })).body;
  for (const [who, key] of Object.entries(keys)) {
    const get = (p: string) => app.request(p, { headers: { Authorization: `Bearer ${key}` } }, env);
    assert.equal((await get('/api/books/search?q=holes')).status, 200, `${who}: search`);
    const { token } = (await (await get('/api/media-token')).json()) as { token: string };
    assert.equal((await app.request(`/api/books/covers/5?key=${token}`, {}, env)).status, 200, `${who}: thumbnail`);
    assert.equal((await app.request(`/api/trackers/${book.id}/cover?key=${token}`, {}, env)).status, 200, `${who}: cover`);
  }
});

test('genresFrom: a few clean genres out of Open Library\'s mixed subjects', async () => {
  const { genresFrom } = await import('../src/routes/books.ts');
  assert.deepEqual(genresFrom(['Kinderbuch ab 10 Jahren', 'Fantasy', 'Katzen', 'Cats', 'Fantasy Fiction', 'Feral Cats', 'Fiction']), ['Fantasy', 'Animals']);
  assert.deepEqual(genresFrom(['hard science-fiction', 'sci-fi', 'Fiction, science fiction, action & adventure', 'Astronauts']), ['Science fiction', 'Adventure']);
  assert.deepEqual(genresFrom(['Detective and mystery stories', 'Humorous stories', 'Graphic novels', 'Fantasy', 'Poetry', 'Horror', 'Biography']), ['Fantasy', 'Mystery', 'Humor', 'Graphic novel', 'Poetry'], 'priority order, five at most');
  assert.deepEqual(genresFrom(['Fiction', 'Juvenile fiction', 'Open Library Staff Picks']), ["Children's"], 'who it is for, for the Kids shelf');
  assert.deepEqual(genresFrom(undefined), []);
});

test("cleanDescription: Open Library's Markdown as plain text (links, their footnotes, rules, bold)", async () => {
  const { cleanDescription } = await import('../src/routes/books.ts');
  const raw = '[The Dark Tower][1] I The Gunslinger is a dark-fantasy by **Stephen King** ([source][2]).\r\n\r\n----------\r\n**Contains:**\r\n\r\n - [The Gunslinger](https://openlibrary.org/works/OL1W)\r\n - _The Way Station_\r\n\r\n\r\n\r\n  [1]: https://openlibrary.org/works/OL81600W/The_Dark_Tower_1-7\r\n  [2]: https://en.wikipedia.org/wiki/The_Gunslinger';
  assert.equal(cleanDescription(raw), 'The Dark Tower I The Gunslinger is a dark-fantasy by Stephen King.\n\nContains:\n\n - The Gunslinger\n - The Way Station');
  assert.equal(cleanDescription('Plain text, nothing to do.'), 'Plain text, nothing to do.');
  assert.equal(cleanDescription('[1]: https://only.a/footnote'), null);
});
