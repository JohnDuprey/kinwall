import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import type { Env } from '../src/env.ts';
import { deflateRawSync } from 'node:zlib';
import { crc32, zipStream, type ZipFile } from '../src/zip.ts';
import { githubRepo, PLUGIN_LIMITS, sha256 } from '../src/routes/plugins.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function setup(extra: Partial<Env> = {}) {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, PUBLIC_URL: 'http://localhost:8080', ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=', ...extra } as Env;
  const app = createApp();
  const req = (p: string, init: RequestInit & { key?: string } = {}) =>
    app.request(p, { ...init, headers: { Authorization: `Bearer ${init.key ?? ADMIN_KEY}`, ...(init.headers ?? {}) } }, env);
  const json = (p: string, method: string, body: unknown, key?: string) => req(p, { method, key, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { req, json };
}

async function zip(files: Record<string, string>): Promise<Uint8Array<ArrayBuffer>> {
  const list: ZipFile[] = Object.entries(files).map(([name, text]) => ({ name, data: new TextEncoder().encode(text), modified: new Date() }));
  const stream = zipStream(async () => list.shift() ?? null);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A DEFLATE zip, for packages that are small but unpack big. */
function deflateZip(files: Record<string, Uint8Array>): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  const block = (size: number, fill: (v: DataView) => void) => { const b = new Uint8Array(size); fill(new DataView(b.buffer)); return b; };
  let offset = 0;
  for (const [name, data] of Object.entries(files)) {
    const n = new TextEncoder().encode(name);
    const packed = new Uint8Array(deflateRawSync(data));
    const fields = (v: DataView, at: number) => {
      v.setUint16(at, 20, true); v.setUint16(at + 4, 8, true); // version, DEFLATE
      v.setUint32(at + 10, crc32(data), true); v.setUint32(at + 14, packed.length, true); v.setUint32(at + 18, data.length, true); v.setUint16(at + 22, n.length, true);
    };
    parts.push(block(30, (v) => { v.setUint32(0, 0x04034b50, true); fields(v, 4); }), n, packed);
    central.push(block(46, (v) => { v.setUint32(0, 0x02014b50, true); fields(v, 6); v.setUint32(42, offset, true); }), n);
    offset += 30 + n.length + packed.length;
  }
  const count = Object.keys(files).length;
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const all = [...parts, ...central, block(22, (v) => { v.setUint32(0, 0x06054b50, true); v.setUint16(8, count, true); v.setUint16(10, count, true); v.setUint32(12, cdSize, true); v.setUint32(16, offset, true); })];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let at = 0;
  for (const b of all) { out.set(b, at); at += b.length; }
  return out;
}

const MANIFEST = { id: 'sight-words', name: 'Sight words', version: '1.0.0', description: 'Hear a word, tap it.', emoji: '🔤', ages: { min: 4, max: 7 } };
const upload = (req: ReturnType<typeof setup>["req"], bytes: Uint8Array<ArrayBuffer>, key?: string) =>
  req('/api/plugins', { method: 'POST', key, headers: { 'Content-Type': 'application/zip' }, body: bytes });

test('plugins: upload a package, serve its files sandboxed, save per-person data, remove', async () => {
  const { req, json } = setup();
  // Zipped with its folder, like a desktop "compress" would: the top folder is dropped.
  const pkg = await zip({ 'sight-words/kinwall-plugin.json': JSON.stringify(MANIFEST), 'sight-words/index.html': '<h1>Hi</h1>', 'sight-words/game.js': 'console.log(1)', 'sight-words/README.md': '# not served' });
  const res = await upload(req, pkg);
  assert.equal(res.status, 201, await res.clone().text());
  const p = (await res.json()) as any;
  assert.equal(p.id, 'sight-words');
  assert.equal(p.url, '/plugins/sight-words/index.html');
  assert.equal(p.enabled, true);
  assert.equal(p.source, null);

  const page = await req('/plugins/sight-words/index.html', { key: '' });
  assert.equal(page.status, 200);
  assert.equal(await page.text(), '<h1>Hi</h1>');
  const csp = page.headers.get('Content-Security-Policy')!;
  assert.match(csp, /sandbox allow-scripts/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /script-src http:\/\/localhost\/plugins\/sight-words\/ /);
  assert.equal((await req('/plugins/sight-words/README.md')).status, 404); // not a served file type
  assert.equal((await req('/plugins/sight-words/../index.html')).status, 404);

  // Per-person data; a display key can play (read and save) but not install.
  const member = (await (await json('/api/members', 'POST', { name: 'Maya', color: '#7ED9A6' })).json()) as any;
  const display = (await (await json('/api/keys', 'POST', { name: 'Wall', scope: 'display' })).json()) as any;
  assert.equal((await json('/api/plugins/sight-words/data', 'PUT', { member: member.id, key: 'progress', value: { level: 2 } }, display.key)).status, 204);
  assert.deepEqual(await (await req(`/api/plugins/sight-words/data?member=${member.id}`, { key: display.key })).json(), { progress: { level: 2 } });
  assert.deepEqual(await (await req('/api/plugins/sight-words/data?member=')).json(), {}); // shared data is separate
  assert.equal((await json('/api/plugins/sight-words/data', 'PUT', { member: 'nobody', key: 'x', value: 1 })).status, 404);
  assert.equal((await upload(req, pkg, display.key)).status, 403);
  assert.equal((await json('/api/plugins/sight-words', 'PATCH', { enabled: false }, display.key)).status, 403);

  // Off: hidden files; an update keeps the saved data.
  assert.equal((await json('/api/plugins/sight-words', 'PATCH', { enabled: false })).status, 200);
  assert.equal((await req('/plugins/sight-words/index.html')).status, 404);
  await json('/api/plugins/sight-words', 'PATCH', { enabled: true });
  const v2 = await zip({ 'kinwall-plugin.json': JSON.stringify({ ...MANIFEST, version: '1.1.0' }), 'index.html': '<h1>v2</h1>' });
  assert.equal(((await (await upload(req, v2)).json()) as any).version, '1.1.0');
  assert.equal(await (await req('/plugins/sight-words/index.html')).text(), '<h1>v2</h1>');
  assert.equal((await req('/plugins/sight-words/game.js')).status, 404); // files are replaced wholesale
  assert.deepEqual(await (await req(`/api/plugins/sight-words/data?member=${member.id}`)).json(), { progress: { level: 2 } });

  assert.equal((await req('/api/plugins/sight-words', { method: 'DELETE' })).status, 204);
  assert.deepEqual(await (await req('/api/plugins')).json(), []);
  assert.equal((await req('/plugins/sight-words/index.html')).status, 404);
});

test('plugins: bad packages are refused with a reason', async () => {
  const { req, json } = setup();
  const cases: [Record<string, string>, RegExp][] = [
    [{ 'index.html': 'x' }, /no kinwall-plugin\.json/],
    [{ 'kinwall-plugin.json': '{nope' }, /isn't valid JSON/],
    [{ 'kinwall-plugin.json': JSON.stringify({ ...MANIFEST, id: 'Bad ID' }) }, /id/],
    [{ 'kinwall-plugin.json': JSON.stringify(MANIFEST) }, /entry page index\.html isn't in the package/],
  ];
  for (const [files, error] of cases) {
    const res = await upload(req, await zip(files));
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as any).error, error);
  }
  assert.equal((await upload(req, new TextEncoder().encode('not a zip'))).status, 400);
  assert.equal((await json('/api/plugins', 'POST', { url: 'https://example.com/plugin.zip' })).status, 400); // GitHub repos only
});

test('plugins: size limits hold against zip bombs, a full family and chatty saving', async () => {
  const { req, json } = setup();
  const manifest = new TextEncoder().encode(JSON.stringify(MANIFEST));
  const page = new TextEncoder().encode('<h1>Hi</h1>');
  const refused = async (bytes: Uint8Array<ArrayBuffer>, error: RegExp) => {
    const res = await upload(req, bytes);
    assert.equal(res.status, 400);
    assert.match(((await res.json()) as any).error, error);
  };

  // A few KB that would unpack to 3 MB (one file) or 12 MB (six files under 2 MB each).
  const zeros = (mb: number) => new Uint8Array(mb * 1024 * 1024 - 1);
  const oneBig = deflateZip({ 'kinwall-plugin.json': manifest, 'index.html': page, 'big.js': zeros(3) });
  assert.ok(oneBig.length < 20_000);
  await refused(oneBig, /big\.js is larger than 2 MB unpacked/);
  const six = deflateZip({ 'kinwall-plugin.json': manifest, 'index.html': page, ...Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`part${i}.js`, zeros(2)])) });
  await refused(six, /add up to at most 10 MB unpacked/);
  // Too many entries is refused before anything is unpacked.
  await refused(deflateZip(Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`f${i}.txt`, page]))), /at most 1000 entries/);
  // Files that aren't served aren't unpacked, so they can't blow the budget either.
  assert.equal((await upload(req, deflateZip({ 'kinwall-plugin.json': manifest, 'index.html': page, 'notes.md': zeros(3) }))).status, 201);

  // The family's total across plugins (lowered here to keep the test small).
  const saved = { ...PLUGIN_LIMITS };
  try {
    PLUGIN_LIMITS.maxTotalBytes = 3 * 1024 * 1024;
    const withFile = (id: string, mb: number) => deflateZip({ 'kinwall-plugin.json': new TextEncoder().encode(JSON.stringify({ ...MANIFEST, id })), 'index.html': page, 'data.js': zeros(mb) });
    assert.equal((await upload(req, withFile('one', 2))).status, 201);
    await refused(withFile('two', 2), /All plugins together can take at most 3 MB/);
    assert.equal((await upload(req, withFile('one', 1))).status, 201); // an update only counts its new size

    // Saved data: 1 MB per plugin for everyone together (lowered to 40 KB here).
    PLUGIN_LIMITS.maxDataBytes = 40 * 1024;
    const value = 'x'.repeat(15 * 1024);
    assert.equal((await json('/api/plugins/one/data', 'PUT', { key: 'a', value })).status, 204);
    assert.equal((await json('/api/plugins/one/data', 'PUT', { key: 'b', value })).status, 204);
    const full = await json('/api/plugins/one/data', 'PUT', { key: 'c', value });
    assert.equal(full.status, 400);
    assert.match(((await full.json()) as any).error, /for the whole family/);
    assert.equal((await json('/api/plugins/one/data', 'PUT', { key: 'b', value })).status, 204); // overwriting doesn't double-count
  } finally {
    Object.assign(PLUGIN_LIMITS, saved);
  }

  // Bad escapes in a file path are a 404, not a crash; homepages must be https.
  assert.equal((await req('/plugins/sight-words/%E0%A4%A', { key: '' })).status, 404);
  await refused(await zip({ 'kinwall-plugin.json': JSON.stringify({ ...MANIFEST, homepage: 'javascript:alert(1)' }), 'index.html': 'x' }), /homepage/);
});

test('plugins: GitHub links resolve to owner/repo', () => {
  assert.equal(githubRepo('https://github.com/ourfamily/kinwall-plugin-math'), 'ourfamily/kinwall-plugin-math');
  assert.equal(githubRepo('https://github.com/ourfamily/kinwall-plugin-math/releases/tag/v1.0.0'), 'ourfamily/kinwall-plugin-math');
  assert.equal(githubRepo('https://github.com/ourfamily/kinwall-plugin-math.git'), 'ourfamily/kinwall-plugin-math');
  assert.equal(githubRepo('https://gitlab.com/ourfamily/x'), null);
});

test('plugins: install from a GitHub release package', async () => {
  const { json } = setup();
  const pkg = await zip({ 'kinwall-plugin.json': JSON.stringify(MANIFEST), 'index.html': '<h1>Hi</h1>' });
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url);
    if (u === 'https://api.github.com/repos/ourfamily/kinwall-plugin-words/releases/latest') {
      return Response.json({ assets: [{ name: 'kinwall-plugin.zip', size: pkg.byteLength, browser_download_url: 'https://github.com/OurFamily/kinwall-plugin-words/releases/download/v1.0.0/kinwall-plugin.zip' }] });
    }
    if (u === 'https://github.com/OurFamily/kinwall-plugin-words/releases/download/v1.0.0/kinwall-plugin.zip') return new Response(pkg);
    if (u === 'https://api.github.com/repos/ourfamily/no-package/releases/latest') return Response.json({ assets: [{ name: 'source.tar.gz', size: 1, browser_download_url: 'x' }] });
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  try {
    const res = await json('/api/plugins', 'POST', { url: 'https://github.com/ourfamily/kinwall-plugin-words' });
    assert.equal(res.status, 201);
    assert.equal(((await res.json()) as any).source, 'ourfamily/kinwall-plugin-words');
    assert.equal((await json('/api/plugins/sight-words/update', 'POST', {})).status, 200);
    const none = await json('/api/plugins', 'POST', { url: 'https://github.com/ourfamily/no-package' });
    assert.match(((await none.json()) as any).error, /has no kinwall-plugin\.zip/);
    const noRel = await json('/api/plugins', 'POST', { url: 'https://github.com/ourfamily/nothing' });
    assert.match(((await noRel.json()) as any).error, /has no releases yet/);
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('plugins: the catalog pins reviewed versions, and catalog-only hosts allow nothing else', async () => {
  const v1 = await zip({ 'kinwall-plugin.json': JSON.stringify(MANIFEST), 'index.html': 'v1' });
  const v2 = await zip({ 'kinwall-plugin.json': JSON.stringify({ ...MANIFEST, version: '2.0.0' }), 'index.html': 'v2' });
  const evil = await zip({ 'kinwall-plugin.json': JSON.stringify(MANIFEST), 'index.html': 'swapped' });
  const releases: Record<string, Uint8Array<ArrayBuffer>> = { 'v1.0.0': v1, 'v2.0.0': v2, latest: v2 };
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async (url: unknown) => {
    const u = String(url);
    const rel = /^https:\/\/api\.github\.com\/repos\/([^/]+\/[^/]+)\/releases\/(?:tags\/)?(.+)$/.exec(u);
    if (rel && releases[rel[2]]) return Response.json({ assets: [{ name: 'kinwall-plugin.zip', size: 1, browser_download_url: `https://github.com/${rel[1]}/releases/download/${rel[2]}/kinwall-plugin.zip` }] });
    const dl = /releases\/download\/(.+)\/kinwall-plugin\.zip$/.exec(u);
    if (dl && releases[dl[1]]) return new Response(releases[dl[1]]);
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  let catalog: unknown[] = [{ id: 'sight-words', repo: 'OurFamily/kinwall-plugin-words', version: '1.0.0', sha256: await sha256(v1), name: 'Sight words', emoji: '🔤' }, { bad: 'entry' }];
  try {
    const { req, json } = setup({ PLUGIN_CATALOG: async () => catalog, PLUGINS_CATALOG_ONLY: '1' });
    const listed = (await (await req('/api/plugins/catalog')).json()) as any;
    assert.equal(listed.catalogOnly, true);
    assert.deepEqual(listed.plugins.map((p: any) => p.version), ['1.0.0']); // the bad entry is skipped

    // A catalog plugin installs its reviewed version, not the newer latest release.
    const res = await json('/api/plugins', 'POST', { url: 'https://github.com/ourfamily/kinwall-plugin-words' });
    assert.equal(res.status, 201, await res.clone().text());
    assert.equal(((await res.json()) as any).version, '1.0.0');
    // Catalog-only: other repos and uploads are refused.
    const other = await json('/api/plugins', 'POST', { url: 'https://github.com/someone/kinwall-plugin-else' });
    assert.equal(other.status, 403);
    assert.equal((await upload(req, v2)).status, 403);

    // Update follows the catalog: nothing new until it's bumped, then exactly that version.
    assert.equal(((await (await json('/api/plugins/sight-words/update', 'POST', {})).json()) as any).version, '1.0.0');
    catalog = [{ ...(catalog[0] as object), version: '2.0.0', sha256: await sha256(v2) }];
    assert.equal(((await (await json('/api/plugins/sight-words/update', 'POST', {})).json()) as any).version, '2.0.0');

    // A release swapped after review doesn't match the pinned hash and isn't installed.
    releases['v2.0.0'] = evil;
    const swapped = await json('/api/plugins/sight-words/update', 'POST', {});
    assert.equal(swapped.status, 400);
    assert.match(((await swapped.json()) as any).error, /doesn't match the reviewed package/);
    assert.equal(await (await req('/plugins/sight-words/index.html', { key: '' })).text(), 'v2');

    // Self-hosted (not catalog-only): any repo still installs, from its latest release.
    const open = setup({ PLUGIN_CATALOG: async () => [] });
    const any = await open.json('/api/plugins', 'POST', { url: 'https://github.com/someone/kinwall-plugin-else' });
    assert.equal(any.status, 201);
    assert.equal(((await any.json()) as any).version, '2.0.0');
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('activity chores: link a plugin, heartbeats add up (capped), and complete once at the threshold, with points', async () => {
  const { req, json } = setup();
  const { todayInTz } = await import('../src/routes/members.ts');
  const { hostTimezone } = await import('../src/env.ts');
  const today = todayInTz(hostTimezone());
  assert.equal((await upload(req, await zip({ 'kinwall-plugin.json': JSON.stringify(MANIFEST), 'index.html': '<h1>Hi</h1>' }))).status, 201);
  const alex = (await (await json('/api/members', 'POST', { name: 'Alex', color: '#7AB8FF' })).json()) as any;
  const sam = (await (await json('/api/members', 'POST', { name: 'Sam', color: '#FF9E7A' })).json()) as any;
  const display = (await (await json('/api/keys', 'POST', { name: 'Wall', scope: 'display' })).json()) as any;
  const body = async (r: Response) => (await r.json()) as any;
  const play = (member: string, seconds: number, key?: string) => json('/api/plugins/sight-words/playtime', 'POST', { member, seconds }, key);

  // Linking: must be an installed plugin; minutes 1-60, default 5; null unlinks.
  assert.equal((await json('/api/chores', 'POST', { title: 'x', dueDate: today, pluginId: 'nope' })).status, 400);
  assert.equal((await json('/api/chores', 'POST', { title: 'x', dueDate: today, pluginId: 'sight-words', pluginMinutes: 61 })).status, 400);
  const dflt = await body(await json('/api/chores', 'POST', { title: 'Default', dueDate: '2020-01-01', pluginId: 'sight-words' }));
  assert.equal(dflt.pluginMinutes, 5);
  const unlinked = await body(await json(`/api/chores/${dflt.id}`, 'PATCH', { pluginId: null }));
  assert.deepEqual([unlinked.pluginId, unlinked.pluginMinutes], [null, null]);

  const mine = await body(await json('/api/chores', 'POST', { title: 'Sight words', emoji: '🔤', rrule: 'FREQ=DAILY', points: 10, memberId: alex.id, pluginId: 'sight-words', pluginMinutes: 2 }));
  const anyone = await body(await json('/api/chores', 'POST', { title: 'Anyone reads', dueDate: today, points: 3, pluginId: 'sight-words', pluginMinutes: 1 }));
  const notToday = await body(await json('/api/chores', 'POST', { title: 'Tomorrow', dueDate: '2099-01-01', memberId: alex.id, pluginId: 'sight-words', pluginMinutes: 1 }));
  assert.equal(mine.pluginId, 'sight-words');

  // A display key (the wall, a kid's tablet) can send playtime; unknown plugin or member is a 404.
  // No save comes first: play counts from launch, whether or not the activity saves.
  assert.equal((await play('nobody', 30)).status, 404);
  assert.equal((await json('/api/plugins/nope/playtime', 'POST', { member: alex.id, seconds: 30 })).status, 404);
  let progress = await body(await play(alex.id, 30, display.key));
  assert.deepEqual(progress.map((p: any) => [p.title, p.doneSeconds, p.needSeconds, p.completed]), [['Sight words', 30, 120, false], ['Anyone reads', 30, 60, false]]);
  assert.ok(!progress.some((p: any) => p.choreId === notToday.id)); // not due today: not listed, never completed

  // 45 more: a call is capped at 60, and the Anyone chore (1 min) completes for Alex, once.
  progress = await body(await play(alex.id, 500));
  const any1 = progress.find((p: any) => p.choreId === anyone.id);
  assert.deepEqual([any1.doneSeconds, any1.completed, any1.justCompleted], [60, true, true]);
  assert.equal(progress.find((p: any) => p.choreId === mine.id).doneSeconds, 90);
  progress = await body(await play(alex.id, 45));
  const mine1 = progress.find((p: any) => p.choreId === mine.id);
  assert.deepEqual([mine1.completed, mine1.justCompleted], [true, true]);
  assert.equal(progress.find((p: any) => p.choreId === anyone.id).justCompleted, false);
  progress = await body(await play(alex.id, 45));
  assert.ok(progress.every((p: any) => p.completed && !p.justCompleted)); // exactly once

  const day = await body(await req(`/api/chores/day?date=${today}`));
  const row = day.find((c: any) => c.id === mine.id);
  assert.equal(row.completed, true);
  assert.equal(row.completedBy, alex.id);
  assert.deepEqual(row.activity, { pluginId: 'sight-words', name: 'Sight words', emoji: '🔤', available: true, needSeconds: 120, doneSeconds: 180 });
  assert.equal(day.find((c: any) => c.id === anyone.id).completedBy, alex.id);
  const members = await body(await req('/api/members'));
  assert.equal(members.find((m: any) => m.id === alex.id).pointsToday, 13);

  // Sam playing doesn't take the Anyone chore Alex already earned.
  progress = await body(await play(sam.id, 60));
  assert.deepEqual(progress.map((p: any) => [p.choreId, p.completed, p.justCompleted]), [[anyone.id, true, false]]);
  assert.equal((await body(await req('/api/members'))).find((m: any) => m.id === sam.id).pointsToday, 0);

  // A day is capped (four hours).
  for (let i = 0; i < 250; i++) await play(sam.id, 60);
  const samDay = await body(await req(`/api/chores/day?date=${today}`));
  assert.equal(samDay.find((c: any) => c.id === anyone.id).activity.doneSeconds, 4 * 60 * 60);

  // Turned off: no playtime, and the chore says it's unavailable. Removed: likewise, and it stays a plain chore.
  await json('/api/plugins/sight-words', 'PATCH', { enabled: false });
  assert.equal((await play(alex.id, 30)).status, 404);
  assert.equal((await body(await req(`/api/chores/day?date=${today}`))).find((c: any) => c.id === mine.id).activity.available, false);
  await json('/api/plugins/sight-words', 'PATCH', { enabled: true });
  assert.equal((await req('/api/plugins/sight-words', { method: 'DELETE' })).status, 204);
  const after = (await body(await req(`/api/chores/day?date=${today}`))).find((c: any) => c.id === mine.id);
  assert.deepEqual([after.activity.available, after.activity.name, after.activity.doneSeconds], [false, null, 0]);
  assert.equal((await req(`/api/chores/${mine.id}/complete?date=${today}`, { method: 'DELETE' })).status, 200);
  assert.equal((await json(`/api/chores/${mine.id}/complete`, 'POST', { date: today })).status, 200); // a plain tick still works
});
