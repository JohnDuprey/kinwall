// Google Photos (Ambient API) for the Night screen and the Board: connect by Google's device sign-in,
// the Ambient device and its album picker, the media list, serving photos, and disconnecting. Google
// is mocked; nothing here reaches the network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';
const ACCESS = 'ya29.FAKE-ACCESS-TOKEN';
const REFRESH = '1//FAKE-REFRESH-TOKEN';
const DEVICE_CODE = 'FAKE-DEVICE-CODE';
const IMAGE = Uint8Array.from([0xff, 0xd8, 0xff, 1, 2, 3]);

type Call = { method: string; url: URL; body: string; auth: string | null };

/** A fake Google: the device sign-in, token refresh and revoke, the Ambient devices and media list,
 * and the photo bytes (which need the bearer token, like the Picker's). */
function fakeGoogle() {
  const calls: Call[] = [];
  const g = {
    calls,
    authorized: false, // the parent finished signing in
    sourcesSet: false,
    refreshFails: false,
    listFails: 0, // HTTP status for mediaItems.list, 0 = fine
    bytesStatus: 200,
    pages: [
      [item('p1'), item('p2'), { id: 'v1', createTime: '2025-01-01T00:00:00Z', mediaFile: { baseUrl: 'https://lh3.googleusercontent.com/v1', mimeType: 'video/mp4', mediaFileMetadata: { width: 1920, height: 1080 } } }],
      [item('p3')],
    ] as unknown[][],
  };
  function item(id: string) {
    return { id, createTime: '2025-06-01T12:00:00Z', mediaFile: { baseUrl: `https://lh3.googleusercontent.com/${id}`, mimeType: 'image/jpeg', mediaFileMetadata: { width: 4000, height: 3000 } } };
  }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = (async (input: unknown, init: RequestInit = {}) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? init.body : init.body instanceof URLSearchParams ? init.body.toString() : '';
    const auth = new Headers(init.headers).get('authorization');
    calls.push({ method, url, body, auth });
    const form = new URLSearchParams(body);
    if (url.href === 'https://oauth2.googleapis.com/device/code') {
      return json({ device_code: DEVICE_CODE, user_code: 'WXYZ-ABCD', verification_url: 'https://www.google.com/device', expires_in: 1800, interval: 5 });
    }
    if (url.href === 'https://oauth2.googleapis.com/token') {
      if (form.get('grant_type') === 'urn:ietf:params:oauth:grant-type:device_code') {
        return g.authorized ? json({ access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, scope: form.get('scope') }) : json({ error: 'authorization_pending' }, 428);
      }
      return g.refreshFails ? json({ error: 'invalid_grant' }, 400) : json({ access_token: ACCESS, expires_in: 3600 });
    }
    if (url.href === 'https://oauth2.googleapis.com/revoke') return new Response('', { status: 200 });
    if (url.host === 'photosambient.googleapis.com') {
      if (auth !== `Bearer ${ACCESS}`) return json({ error: { code: 401, status: 'UNAUTHENTICATED' } }, 401);
      const device = () => ({ id: 'dev-1', displayName: 'Our Family Kinwall', settingsUri: 'https://photos.google.com/ambient/dev-1', mediaSourcesSet: g.sourcesSet, pollingConfig: { pollInterval: '7.5s' } });
      if (method === 'POST' && url.pathname === '/v1/devices') return json(device());
      if (method === 'GET' && url.pathname === '/v1/devices/dev-1') return json(device());
      if (method === 'DELETE' && url.pathname === '/v1/devices/dev-1') return json({});
      if (method === 'GET' && url.pathname === '/v1/mediaItems') {
        if (g.listFails) return json({ error: { code: g.listFails, status: g.listFails === 400 ? 'FAILED_PRECONDITION' : 'INTERNAL' } }, g.listFails);
        const n = Number(url.searchParams.get('pageToken') ?? 0);
        return json({ mediaItems: g.pages[n] ?? [], ...(n + 1 < g.pages.length ? { nextPageToken: String(n + 1) } : {}) });
      }
    }
    if (url.host === 'lh3.googleusercontent.com') {
      if (auth !== `Bearer ${ACCESS}`) return new Response('', { status: 403 });
      return new Response(g.bytesStatus === 200 ? IMAGE : '', { status: g.bytesStatus, headers: { 'content-type': 'image/jpeg' } });
    }
    return new Response('unexpected', { status: 599 });
  }) as typeof globalThis.fetch;
  return { g, fetch, count: (pred: (c: Call) => boolean) => calls.filter(pred).length };
}

function makeApp(opts: { configured?: boolean } = {}) {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = {
    DB: db as unknown as D1Database,
    ADMIN_API_KEY: ADMIN_KEY,
    ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    ...(opts.configured === false ? {} : { GOOGLE_PHOTOS_CLIENT_ID: 'tv-client.apps.googleusercontent.com', GOOGLE_PHOTOS_CLIENT_SECRET: 'FAKE-CLIENT-SECRET' }),
  };
  const app = createApp();
  const raw = (method: string, p: string, key = ADMIN_KEY, body?: unknown) =>
    app.request(p, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, env);
  const send = async (method: string, p: string, key = ADMIN_KEY, body?: unknown) => {
    const res = await raw(method, p, key, body);
    return { status: res.status, body: (await res.json()) as any };
  };
  const displayKey = async () => (await send('POST', '/api/keys', ADMIN_KEY, { name: 'Wall', scope: 'display' })).body.key as string;
  /** Lets the next status check poll Google now instead of waiting out the poll interval. */
  const sql = async (q: string, ...args: unknown[]) => { await db.prepare(q).bind(...args).run(); };
  const rows = async (q: string) => (await db.prepare(q).all<Record<string, any>>()).results;
  const pollNow = () => sql('UPDATE google_photos SET next_poll_at = NULL');
  const row = async () => (await rows('SELECT * FROM google_photos'))[0];
  const count = async (table: string) => (await rows(`SELECT COUNT(*) AS n FROM ${table}`))[0].n as number;
  return { env, db, raw, send, displayKey, pollNow, row, sql, rows, count };
}

/** Runs `fn` with Google faked and every console line captured. */
async function withGoogle<T>(fake: ReturnType<typeof fakeGoogle>, fn: () => Promise<T>, logs: string[] = []): Promise<T> {
  const realFetch = globalThis.fetch;
  const real = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  const capture = (...a: unknown[]) => { logs.push(a.map((x) => (x instanceof Error ? `${x.message} ${x.stack}` : typeof x === 'string' ? x : JSON.stringify(x))).join(' ')); };
  globalThis.fetch = fake.fetch;
  Object.assign(console, { log: capture, warn: capture, error: capture, info: capture });
  try {
    return await fn();
  } finally {
    globalThis.fetch = realFetch;
    Object.assign(console, real);
  }
}

/** Connected, albums picked: the state most tests start from. */
async function connected(t: ReturnType<typeof makeApp>, fake: ReturnType<typeof fakeGoogle>) {
  await t.send('POST', '/api/google-photos/connect');
  fake.g.authorized = true;
  await t.pollNow();
  await t.send('GET', '/api/google-photos');
  fake.g.sourcesSet = true;
  await t.pollNow();
  const s = await t.send('GET', '/api/google-photos');
  assert.equal(s.body.state, 'ready');
}

test('google photos: off and unavailable until the server has a Google Photos client', async () => {
  const t = makeApp({ configured: false });
  const fake = fakeGoogle();
  await withGoogle(fake, async () => {
    const s = await t.send('GET', '/api/google-photos');
    assert.deepEqual(s.body, { available: false, state: 'off' });
    const c = await t.send('POST', '/api/google-photos/connect');
    assert.equal(c.status, 503);
    assert.equal(fake.g.calls.length, 0);
    assert.equal((await t.send('GET', '/api/settings')).body.googlePhotos, 'off');
  });
});

test('google photos: connect asks only for the Photos scope with the device sign-in, seals the tokens, creates the Ambient device', async () => {
  const t = makeApp();
  const fake = fakeGoogle();
  await withGoogle(fake, async () => {
    await t.send('PATCH', '/api/settings', ADMIN_KEY, { familyName: 'Our Family' });
    const c = await t.send('POST', '/api/google-photos/connect');
    assert.equal(c.status, 200);
    assert.equal(c.body.state, 'signing-in');
    assert.equal(c.body.userCode, 'WXYZ-ABCD');
    assert.equal(c.body.verificationUrl, 'https://www.google.com/device');

    const start = new URLSearchParams(fake.g.calls[0].body);
    assert.equal(start.get('client_id'), 'tv-client.apps.googleusercontent.com');
    assert.equal(start.get('scope'), 'https://www.googleapis.com/auth/photosambient.mediaitems');
    const state = JSON.parse(start.get('state')!);
    assert.match(state.requestId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    assert.equal(state.displayName, 'Our Family Kinwall');
    assert.ok(String((await t.row())!.config).startsWith('v1:'), 'the device code is sealed');
    assert.ok(!String((await t.row())!.config).includes(DEVICE_CODE));

    // Not signed in yet: Google says pending, and the next check waits for the poll interval.
    await t.pollNow();
    assert.equal((await t.send('GET', '/api/google-photos')).body.state, 'signing-in');
    const tokenPolls = () => fake.count((x) => x.url.pathname === '/token');
    const before = tokenPolls();
    await t.send('GET', '/api/google-photos');
    assert.equal(tokenPolls(), before, 'respects the poll interval');

    fake.g.authorized = true;
    await t.pollNow();
    const s = await t.send('GET', '/api/google-photos');
    assert.equal(s.body.state, 'choosing');
    assert.equal(s.body.settingsUri, 'https://photos.google.com/ambient/dev-1');
    assert.equal(s.body.userCode, undefined);
    const create = fake.g.calls.find((x) => x.method === 'POST' && x.url.pathname === '/v1/devices')!;
    assert.equal(create.url.searchParams.get('requestId'), state.requestId, 'the same requestId as the sign-in, so Google opens the album picker');
    assert.equal(JSON.parse(create.body).displayName, 'Our Family Kinwall');

    const r = (await t.row())!;
    assert.equal(r.device_id, 'dev-1');
    assert.ok(String(r.config).startsWith('v1:'));
    for (const secret of [ACCESS, REFRESH, DEVICE_CODE]) assert.ok(!JSON.stringify(r).includes(secret), 'tokens are sealed');
    // Separate from calendar accounts.
    assert.equal(await t.count('accounts'), 0);
  });
});

test('google photos: waits for albums, following pollInterval, then ready', async () => {
  const t = makeApp();
  const fake = fakeGoogle();
  await withGoogle(fake, async () => {
    await t.send('POST', '/api/google-photos/connect');
    fake.g.authorized = true;
    await t.pollNow();
    await t.send('GET', '/api/google-photos');
    assert.equal((await t.row())!.poll_seconds, 8, "Google's 7.5s, rounded up");
    const gets = () => fake.count((x) => x.method === 'GET' && x.url.pathname === '/v1/devices/dev-1');
    await t.send('GET', '/api/google-photos');
    assert.equal(gets(), 0, 'not before the poll interval');
    await t.pollNow();
    assert.equal((await t.send('GET', '/api/google-photos')).body.state, 'choosing');
    assert.equal(gets(), 1);
    fake.g.sourcesSet = true;
    await t.pollNow();
    const s = await t.send('GET', '/api/google-photos');
    assert.equal(s.body.state, 'ready');
    assert.equal(s.body.settingsUri, 'https://photos.google.com/ambient/dev-1', 'still there for Change albums');
    assert.equal((await t.send('GET', '/api/settings')).body.googlePhotos, 'ready');
    // Ready: status checks stop polling the device.
    await t.pollNow();
    await t.send('GET', '/api/google-photos');
    assert.equal(gets(), 2);
  });
});

test('google photos: next photo lists every page, keeps only ids, passes the bytes through with the bearer token', async () => {
  const t = makeApp();
  const fake = fakeGoogle();
  await withGoogle(fake, async () => {
    await connected(t, fake);
    const wall = await t.displayKey();
    const res = await t.raw('GET', '/api/google-photos/next?w=800&h=600', wall);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('content-type'), 'image/jpeg');
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(new Uint8Array(await res.arrayBuffer()), IMAGE);

    const lists = fake.g.calls.filter((x) => x.url.pathname === '/v1/mediaItems');
    assert.equal(lists.length, 2, 'both pages');
    assert.equal(lists[0].url.searchParams.get('deviceId'), 'dev-1');
    assert.equal(lists[0].url.searchParams.get('pageSize'), '100');
    assert.equal(lists[1].url.searchParams.get('pageToken'), '1');
    const bytes = fake.g.calls.filter((x) => x.url.host === 'lh3.googleusercontent.com');
    assert.equal(bytes.length, 1);
    assert.match(bytes[0].url.href, /^https:\/\/lh3\.googleusercontent\.com\/p[123]=w800-h600$/);
    assert.equal(bytes[0].auth, `Bearer ${ACCESS}`);

    // Only ids and a little metadata; the video is skipped.
    const items = await t.rows('SELECT * FROM google_photo_items ORDER BY id');
    assert.deepEqual(items.map((i) => i.id), ['p1', 'p2', 'p3']);
    assert.deepEqual(Object.keys(items[0]).sort(), ['base_url', 'created', 'height', 'id', 'shown_at', 'width']);
    assert.equal(items[0].width, 4000);

    // The next two are the other photos (a shuffled pass), with no new list call.
    const shown = new Set([bytes[0].url.pathname]);
    for (let i = 0; i < 2; i++) await t.raw('GET', '/api/google-photos/next?w=800&h=600', wall);
    for (const b of fake.g.calls.filter((x) => x.url.host === 'lh3.googleusercontent.com')) shown.add(b.url.pathname);
    assert.equal(shown.size, 3);
    assert.equal(fake.count((x) => x.url.pathname === '/v1/mediaItems'), 2);

    // Sizes are clamped, and the default is a screen's worth.
    await t.raw('GET', '/api/google-photos/next?w=99999&h=10', wall);
    assert.match(fake.g.calls.at(-1)!.url.href, /=w4096-h64$/);
  });
});

test('google photos: a list older than 50 minutes is fetched again (base URLs last an hour)', async () => {
  const t = makeApp();
  const fake = fakeGoogle();
  await withGoogle(fake, async () => {
    await connected(t, fake);
    await t.raw('GET', '/api/google-photos/next');
    fake.g.pages = [[fake.g.pages[1][0]]]; // only p3 is left in the albums
    await t.sql('UPDATE google_photos SET items_at = ?', new Date(Date.now() - 51 * 60_000).toISOString());
    await t.raw('GET', '/api/google-photos/next');
    assert.equal(fake.count((x) => x.url.pathname === '/v1/mediaItems'), 3);
    assert.deepEqual((await t.rows('SELECT id FROM google_photo_items')).map((i) => i.id), ['p3']);
  });
});

test('google photos: no photos, albums unpicked in Google, and API errors', async () => {
  const t = makeApp();
  const fake = fakeGoogle();
  await withGoogle(fake, async () => {
    await connected(t, fake);
    fake.g.pages = [[]];
    const empty = await t.send('GET', '/api/google-photos/next');
    assert.equal(empty.status, 404);

    await t.sql('UPDATE google_photos SET items_at = NULL');
    fake.g.listFails = 500;
    assert.equal((await t.send('GET', '/api/google-photos/next')).status, 502);
    assert.equal((await t.send('GET', '/api/google-photos')).body.state, 'ready', 'a Google hiccup is not a disconnect');

    await t.sql('UPDATE google_photos SET items_at = NULL');
    fake.g.listFails = 400; // FAILED_PRECONDITION: the albums were unpicked in Google Photos
    fake.g.sourcesSet = false;
    assert.equal((await t.send('GET', '/api/google-photos/next')).status, 409);
    assert.equal((await t.send('GET', '/api/google-photos')).body.state, 'choosing');
  });
});

test('google photos: an expired photo link makes the next call fetch the list again', async () => {
  const t = makeApp();
  const fake = fakeGoogle();
  await withGoogle(fake, async () => {
    await connected(t, fake);
    fake.g.bytesStatus = 403;
    assert.equal((await t.send('GET', '/api/google-photos/next')).status, 502);
    assert.equal((await t.row())!.items_at, null);
  });
});

test('google photos: revoked permission shows Reconnect, and the photos stop', async () => {
  const t = makeApp();
  const fake = fakeGoogle();
  await withGoogle(fake, async () => {
    await connected(t, fake);
    // The access token has run out and Google refuses the refresh token.
    await t.sql('UPDATE google_photos SET items_at = NULL');
    const { encryptConfig } = await import('../src/crypto.ts');
    await t.sql('UPDATE google_photos SET config = ?', await encryptConfig(t.env, 'google-photos', { access_token: 'old', refresh_token: REFRESH, expires_at: 0 }));
    fake.g.refreshFails = true;
    const res = await t.send('GET', '/api/google-photos/next');
    assert.equal(res.status, 409);
    const s = await t.send('GET', '/api/google-photos');
    assert.equal(s.body.state, 'reconnect');
    assert.equal((await t.send('GET', '/api/settings')).body.googlePhotos, 'reconnect');
    assert.equal(await t.count('google_photo_items'), 0);
    // Connecting again starts over.
    fake.g.refreshFails = false;
    const again = await t.send('POST', '/api/google-photos/connect');
    assert.equal(again.body.state, 'signing-in');
  });
});

test('google photos: wall screens can show photos and read the state, never connect or disconnect', async () => {
  const t = makeApp();
  const fake = fakeGoogle();
  await withGoogle(fake, async () => {
    const wall = await t.displayKey();
    assert.equal((await t.send('POST', '/api/google-photos/connect', wall)).status, 403);
    await connected(t, fake);
    const s = await t.send('GET', '/api/google-photos', wall);
    assert.deepEqual(s.body, { available: true, state: 'ready' }, 'no album link or codes on a wall');
    assert.equal((await t.send('DELETE', '/api/google-photos', wall)).status, 403);
    assert.equal((await t.raw('GET', '/api/google-photos/next', wall)).status, 200);
  });
});

test('google photos: connect again while connected is refused', async () => {
  const t = makeApp();
  const fake = fakeGoogle();
  await withGoogle(fake, async () => {
    await connected(t, fake);
    assert.equal((await t.send('POST', '/api/google-photos/connect')).status, 409);
  });
});

test('google photos: next is rate limited per device', async () => {
  const t = makeApp();
  const fake = fakeGoogle();
  await withGoogle(fake, async () => {
    await connected(t, fake);
    await t.sql("INSERT INTO rate_limits (key, count, window_start) VALUES ('google-photos:ADMIN_API_KEY', 10000, ?)", new Date().toISOString());
    assert.equal((await t.send('GET', '/api/google-photos/next')).status, 429);
  });
});

test('google photos: disconnect deletes the Ambient device, revokes the token and clears the ids, leaving Calendar alone', async () => {
  const t = makeApp();
  const fake = fakeGoogle();
  await withGoogle(fake, async () => {
    await t.sql("INSERT INTO accounts (id, kind, name, config, created_at) VALUES ('cal', 'google', 'alex@example.com', '', '2025-01-01')");
    await connected(t, fake);
    await t.raw('GET', '/api/google-photos/next');
    const d = await t.send('DELETE', '/api/google-photos');
    assert.equal(d.status, 200);
    assert.equal(d.body.state, 'off');
    assert.equal(fake.count((x) => x.method === 'DELETE' && x.url.pathname === '/v1/devices/dev-1'), 1);
    const revoke = fake.g.calls.find((x) => x.url.pathname === '/revoke')!;
    assert.equal(new URLSearchParams(revoke.body).get('token'), REFRESH);
    assert.equal(await t.row(), undefined);
    assert.equal(await t.count('google_photo_items'), 0);
    assert.equal(await t.count('accounts'), 1, 'the calendar account stays');
    // And disconnecting a calendar account never touches Photos.
    await connected(t, fake);
    await t.send('DELETE', '/api/accounts/cal');
    assert.equal((await t.send('GET', '/api/google-photos')).body.state, 'ready');
  });
});

test('google photos: tokens and codes never reach the logs or error bodies', async () => {
  const t = makeApp();
  const fake = fakeGoogle();
  const logs: string[] = [];
  const bodies: string[] = [];
  await withGoogle(fake, async () => {
    await connected(t, fake);
    bodies.push(JSON.stringify((await t.send('GET', '/api/google-photos')).body));
    await t.raw('GET', '/api/google-photos/next');
    await t.sql('UPDATE google_photos SET items_at = NULL');
    fake.g.listFails = 500;
    bodies.push(JSON.stringify((await t.send('GET', '/api/google-photos/next')).body));
    fake.g.listFails = 0;
    fake.g.bytesStatus = 403;
    bodies.push(JSON.stringify((await t.send('GET', '/api/google-photos/next')).body));
    const { encryptConfig } = await import('../src/crypto.ts');
    await t.sql('UPDATE google_photos SET config = ?, items_at = NULL', await encryptConfig(t.env, 'google-photos', { access_token: 'old', refresh_token: REFRESH, expires_at: 0 }));
    fake.g.refreshFails = true;
    bodies.push(JSON.stringify((await t.send('GET', '/api/google-photos/next')).body));
    await t.send('DELETE', '/api/google-photos');
  }, logs);
  for (const secret of [ACCESS, REFRESH, DEVICE_CODE, 'FAKE-CLIENT-SECRET']) {
    assert.ok(!logs.some((l) => l.includes(secret)), `${secret} logged`);
    assert.ok(!bodies.some((b) => b.includes(secret)), `${secret} in a response`);
  }
});
