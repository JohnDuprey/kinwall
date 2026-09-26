import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.ts';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { getRev } from '../src/bus.ts';
import { blobBytes, PHOTO_LIMITS } from '../src/routes/photos.ts';
import { crc32, readZip } from '../src/zip.ts';
import type { Env } from '../src/env.ts';

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
const ADMIN_KEY = 'fc_test_admin_key';

function makeApp() {
  const db = openDb(':memory:');
  applyMigrations(db, MIGRATIONS_DIR);
  const env: Env = { DB: db as unknown as D1Database, ADMIN_API_KEY: ADMIN_KEY, ENCRYPTION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' };
  const app = createApp();
  const raw = (method: string, p: string, init: { body?: BodyInit; headers?: Record<string, string>; key?: string | null } = {}) =>
    app.request(p, { method, body: init.body, headers: { ...(init.key === null ? {} : { Authorization: `Bearer ${init.key ?? ADMIN_KEY}` }), ...init.headers } }, env);
  const send = async (method: string, p: string, body?: unknown, key = ADMIN_KEY) => {
    const res = await raw(method, p, { body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, key });
    return { status: res.status, body: (await res.json()) as any };
  };
  const upload = async (bytes: Uint8Array<ArrayBuffer>, opts: { mime?: string; caption?: string; key?: string } = {}) => {
    const res = await raw('POST', `/api/photos${opts.caption ? `?caption=${encodeURIComponent(opts.caption)}` : ''}`, {
      body: bytes, key: opts.key, headers: { 'Content-Type': opts.mime ?? 'image/webp', 'X-Photo-Width': '640', 'X-Photo-Height': '480' },
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const displayKey = async () => (await send('POST', '/api/keys', { name: 'Wall', scope: 'display' })).body.key as string;
  return { env, db, raw, send, upload, displayKey };
}

const bytes = (n: number, seed = 7): Uint8Array<ArrayBuffer> => Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);

test('d1-sqlite: a Uint8Array bound as a param comes back as the same bytes', async () => {
  const db = openDb(':memory:');
  db.exec('CREATE TABLE b (data BLOB)');
  const data = bytes(1000);
  await db.prepare('INSERT INTO b (data) VALUES (?)').bind(data).run();
  const row = await db.prepare('SELECT data FROM b').first<{ data: unknown }>();
  assert.deepEqual(blobBytes(row!.data), data);
  // The other backends' shapes normalize too (D1: number[], a Durable Object: ArrayBuffer).
  assert.deepEqual(blobBytes([1, 2, 255]), Uint8Array.from([1, 2, 255]));
  assert.deepEqual(blobBytes(Uint8Array.from([4, 5]).buffer), Uint8Array.from([4, 5]));
});

test('photos: upload, list (no bytes), image round trip with caching headers, rev bumps', async () => {
  const { env, raw, send, upload } = makeApp();
  const data = bytes(5000);
  const rev0 = await getRev(env.DB);
  const created = await upload(data, { caption: 'Beach day' });
  assert.equal(created.status, 201);
  assert.deepEqual([created.body.caption, created.body.mime, created.body.width, created.body.height, created.body.bytes, created.body.memberId], ['Beach day', 'image/webp', 640, 480, 5000, null]);
  assert.equal(created.body.url, `/api/photos/${created.body.id}/image`);
  await new Promise((r) => setTimeout(r, 10));
  assert.ok((await getRev(env.DB)) > rev0);

  const list = await send('GET', '/api/photos');
  assert.equal(list.body.length, 1);
  assert.equal('data' in list.body[0], false);

  const img = await raw('GET', created.body.url);
  assert.equal(img.status, 200);
  assert.equal(img.headers.get('Content-Type'), 'image/webp');
  assert.equal(img.headers.get('Cache-Control'), 'private, max-age=31536000, immutable');
  assert.deepEqual(new Uint8Array(await img.arrayBuffer()), data);
  const again = await raw('GET', created.body.url, { headers: { 'If-None-Match': img.headers.get('ETag')! } });
  assert.equal(again.status, 304);
  assert.equal((await raw('GET', '/api/photos/nope/image')).status, 404);
});

test('photos: size cap (413), mime check (415), bad size headers (400)', async () => {
  const { raw, upload } = makeApp();
  assert.equal((await upload(bytes(PHOTO_LIMITS.maxPhotoBytes))).status, 201); // exactly the cap is fine
  assert.equal((await upload(bytes(PHOTO_LIMITS.maxPhotoBytes + 1))).status, 413);
  assert.equal((await upload(bytes(10), { mime: 'image/gif' })).status, 415);
  assert.equal((await upload(bytes(10), { mime: 'text/plain' })).status, 415);
  assert.equal((await upload(bytes(10), { mime: 'image/jpeg' })).status, 201);
  const noSize = await raw('POST', '/api/photos', { body: bytes(10), headers: { 'Content-Type': 'image/png', 'X-Photo-Width': 'wide' } });
  assert.equal(noSize.status, 400);
});

test('photos: quota count (409 with the quota object)', async () => {
  const { db, upload, send } = makeApp();
  // Fill to one short of the cap directly, then the next upload fits and the one after doesn't.
  for (let i = 0; i < PHOTO_LIMITS.maxCount - 1; i++) {
    await db.prepare("INSERT INTO photos (id, mime, width, height, bytes, data, created_at) VALUES (?, 'image/webp', 1, 1, 1, ?, '2026-01-01')").bind(`p${i}`, bytes(1)).run();
  }
  assert.equal((await upload(bytes(10))).status, 201);
  const full = await upload(bytes(10));
  assert.equal(full.status, 409);
  assert.deepEqual([full.body.count, full.body.maxCount, full.body.maxBytes, full.body.maxPhotoBytes], [200, 200, 104857600, 614400]);
  const q = (await send('GET', '/api/photos/quota')).body;
  assert.deepEqual(q, { count: 200, bytes: 199 + 10, maxCount: 200, maxBytes: 104857600, maxPhotoBytes: 614400 });
});

test('photos: a display key can list, view and upload (Paint on the wall), but not edit or delete', async () => {
  const { raw, send, upload, displayKey } = makeApp();
  const key = await displayKey();
  const p = (await upload(bytes(100))).body;
  assert.equal((await send('GET', '/api/photos', undefined, key)).status, 200);
  assert.equal((await send('GET', '/api/photos/quota', undefined, key)).status, 200);
  assert.equal((await raw('GET', p.url, { key })).status, 200);
  assert.equal((await upload(bytes(100), { key })).status, 201);
  assert.equal((await send('PATCH', `/api/photos/${p.id}`, { caption: 'x' }, key)).status, 403);
  assert.equal((await send('DELETE', `/api/photos/${p.id}`, undefined, key)).status, 403);
});

test('photos: ?key= works on the image route (and the zip export) only', async () => {
  const { raw, upload, displayKey } = makeApp();
  const key = await displayKey();
  const p = (await upload(bytes(100))).body;
  assert.equal((await raw('GET', `${p.url}?key=${key}`, { key: null })).status, 200);
  assert.equal((await raw('GET', `${p.url}?key=wrong`, { key: null })).status, 401);
  assert.equal((await raw('GET', `/api/photos?key=${key}`, { key: null })).status, 401);
  assert.equal((await raw('GET', `/api/members?key=${ADMIN_KEY}`, { key: null })).status, 401);
});

test('photos: patch caption and owner, member delete clears the owner, delete', async () => {
  const { send, upload, raw } = makeApp();
  const m = (await send('POST', '/api/members', { name: 'Maya', color: '#ff0000' })).body;
  const p = (await upload(bytes(100), { caption: 'Old' })).body;
  const patched = await send('PATCH', `/api/photos/${p.id}`, { caption: '  Zoo trip ', memberId: m.id });
  assert.deepEqual([patched.status, patched.body.caption, patched.body.memberId], [200, 'Zoo trip', m.id]);
  assert.equal((await send('PATCH', `/api/photos/${p.id}`, { memberId: 'ghost' })).status, 400);
  assert.equal((await send('PATCH', '/api/photos/nope', { caption: 'x' })).status, 404);
  assert.equal((await send('DELETE', `/api/members/${m.id}`)).status, 200);
  assert.equal((await send('GET', '/api/photos')).body[0].memberId, null);

  assert.equal((await send('DELETE', `/api/photos/${p.id}`)).status, 200);
  assert.equal((await send('DELETE', `/api/photos/${p.id}`)).status, 404);
  assert.equal((await raw('GET', p.url)).status, 404);
  assert.deepEqual((await send('GET', '/api/photos')).body, []);
});

// ---------- Zip export / import ----------

const zipOf = async (res: Response) => new Uint8Array(await res.arrayBuffer());
const importZip = async (raw: ReturnType<typeof makeApp>['raw'], zip: Uint8Array<ArrayBuffer>, key?: string) => {
  const res = await raw('POST', '/api/photos/import', { body: zip, key, headers: { 'Content-Type': 'application/zip' } });
  return { status: res.status, body: (await res.json()) as any };
};

// A 3x2 PNG header (enough for the size sniffer) plus padding.
const png = (pad: number) => {
  const b = new Uint8Array(33 + pad);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, 3);
  new DataView(b.buffer).setUint32(20, 2);
  return b;
};

// A one-entry zip whose entry is DEFLATEd, like a desktop zip tool writes (no manifest).
async function deflatedZip(name: string, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const packed = new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const n = new TextEncoder().encode(name);
  const out = new Uint8Array(30 + n.length + packed.length + 46 + n.length + 22);
  const v = new DataView(out.buffer);
  const fields = (at: number) => {
    v.setUint16(at, 20, true); v.setUint16(at + 4, 8, true); // version, method 8
    v.setUint32(at + 10, crc32(data), true); v.setUint32(at + 14, packed.length, true); v.setUint32(at + 18, data.length, true); v.setUint16(at + 22, n.length, true);
  };
  v.setUint32(0, 0x04034b50, true); fields(4); out.set(n, 30); out.set(packed, 30 + n.length);
  const cd = 30 + n.length + packed.length;
  v.setUint32(cd, 0x02014b50, true); fields(cd + 6); v.setUint32(cd + 42, 0, true); out.set(n, cd + 46);
  const end = cd + 46 + n.length;
  v.setUint32(end, 0x06054b50, true); v.setUint16(end + 8, 1, true); v.setUint16(end + 10, 1, true); v.setUint32(end + 12, 46 + n.length, true); v.setUint32(end + 16, cd, true);
  return out;
}

test('photos zip: export -> import into a fresh family keeps bytes, captions and owners (by name); a second import skips duplicates', async () => {
  const a = makeApp();
  const maya = (await a.send('POST', '/api/members', { name: 'Maya', color: '#ff0000' })).body;
  const p1 = (await a.upload(bytes(3000, 1), { caption: 'Zoo' })).body;
  await a.send('PATCH', `/api/photos/${p1.id}`, { memberId: maya.id });
  const p2 = (await a.upload(bytes(4000, 2), { mime: 'image/png' })).body;

  const res = await a.raw('GET', '/api/photos/export.zip');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Content-Type'), 'application/zip');
  assert.match(res.headers.get('Content-Disposition')!, /^attachment; filename="kinwall-photos-\d{4}-\d{2}-\d{2}\.zip"$/);
  const zip = await zipOf(res);
  const names = readZip(zip, 1e6).map((e) => e.name);
  assert.deepEqual(names, ['manifest.json', `photos/${p1.createdAt.slice(0, 10)}-${p1.id}.webp`, `photos/${p2.createdAt.slice(0, 10)}-${p2.id}.png`]);
  const manifest = JSON.parse(new TextDecoder().decode((await readZip(zip, 1e6)[0].read())!));
  assert.deepEqual(manifest[0], { id: p1.id, file: names[1], caption: 'Zoo', memberId: maya.id, memberName: 'Maya', mime: 'image/webp', width: 640, height: 480, bytes: 3000, createdAt: p1.createdAt });

  const b = makeApp();
  const maya2 = (await b.send('POST', '/api/members', { name: 'maya ', color: '#00ff00' })).body; // different id, same name
  assert.deepEqual((await importZip(b.raw, zip)).body, { imported: 2, skipped: 0 });
  const list = (await b.send('GET', '/api/photos')).body;
  const zoo = list.find((p: any) => p.id === p1.id);
  assert.deepEqual([zoo.caption, zoo.memberId, zoo.createdAt, zoo.width], ['Zoo', maya2.id, p1.createdAt, 640]);
  assert.equal(list.find((p: any) => p.id === p2.id).mime, 'image/png');
  assert.deepEqual(new Uint8Array(await (await b.raw('GET', zoo.url)).arrayBuffer()), bytes(3000, 1));

  assert.deepEqual((await importZip(b.raw, zip)).body, { imported: 0, skipped: 2 });
  assert.equal((await importZip(a.raw, zip)).body.skipped, 2); // back into the family it came from: nothing doubles
});

test('photos zip: a deflated entry without a manifest imports, sized from its header', async () => {
  const { raw, send } = makeApp();
  const zip = await deflatedZip('Holiday/2026-07-04-beach-1.png', png(5000));
  assert.deepEqual((await importZip(raw, zip)).body, { imported: 1, skipped: 0 });
  const [p] = (await send('GET', '/api/photos')).body;
  assert.deepEqual([p.id, p.mime, p.width, p.height, p.bytes, p.caption], ['beach-1', 'image/png', 3, 2, 5033, null]);
  assert.deepEqual(new Uint8Array(await (await raw('GET', p.url)).arrayBuffer()), png(5000));
});

test('photos zip: import respects the quota and the per-photo cap; bad input; admin only', async () => {
  const a = makeApp();
  await a.upload(bytes(100, 1));
  await a.upload(bytes(100, 2));
  const zip = await zipOf(await a.raw('GET', '/api/photos/export.zip'));

  const b = makeApp();
  for (let i = 0; i < PHOTO_LIMITS.maxCount - 1; i++) {
    await b.db.prepare("INSERT INTO photos (id, mime, width, height, bytes, data, created_at) VALUES (?, 'image/webp', 1, 1, 1, ?, '2026-01-01')").bind(`p${i}`, bytes(1)).run();
  }
  assert.deepEqual((await importZip(b.raw, zip)).body, { imported: 1, skipped: 1 });

  const big = await deflatedZip('huge.png', png(PHOTO_LIMITS.maxPhotoBytes));
  assert.deepEqual((await importZip(a.raw, big)).body, { imported: 0, skipped: 1 });
  assert.equal((await importZip(a.raw, bytes(100))).status, 400);
  assert.equal((await a.raw('POST', '/api/photos/import', { body: zip, headers: { 'Content-Type': 'application/json' } })).status, 415);

  const key = await a.displayKey();
  assert.equal((await a.raw('GET', '/api/photos/export.zip', { key })).status, 403);
  assert.equal((await importZip(a.raw, zip, key)).status, 403);
  assert.equal((await a.raw('GET', `/api/photos/export.zip?key=${key}`, { key: null })).status, 403);
  assert.equal((await a.raw('GET', `/api/photos/export.zip?key=${ADMIN_KEY}`, { key: null })).status, 200);
});
