// Family photos (migration 0028): small images stored as blobs in the database, so SQLite, D1 and
// a Durable Object all behave the same. The web client downscales before upload (web/src/photos.ts);
// this caps each photo and the family's total. Writes are admin-only (see DISPLAY_ALLOWED in auth.ts).
// family = 0 (migration 0031): a memory's own photo (routes/trackers.ts). It isn't listed here, so it
// stays off the Photos page, the Board and the screensaver; it's served by id, counts toward the
// limits, and travels in the zip backup marked "family": false.
// coloring = 1 (migration 0083): a Paint coloring page a parent added (line art, a PNG), stored with
// family = 0 and listed only by /api/coloring-pages; "coloring": true in the zip backup.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { emit } from '../bus.ts';
import { actorOf, ownerBlock, photoExportTicket } from '../auth.ts';
import { ErrorSchema } from '../schemas.ts';
import type { KinwallDb } from '../db.ts';
import { readZip, zipStream, type ZipFile } from '../zip.ts';

export const photosRoutes = createRouter();

export const PHOTO_LIMITS = { maxCount: 200, maxBytes: 100 * 1024 * 1024, maxPhotoBytes: 600 * 1024 };
const MIMES = ['image/webp', 'image/jpeg', 'image/png'];

// drawing / added_by (migration 0081): a Paint drawing and its artist, or who added a photo from
// their own device. Only Newscast reads them ("Maya saved a drawing", "Alex added 3 photos").
type PhotoRow = { id: string; caption: string | null; mime: string; width: number; height: number; bytes: number; member_id: string | null; created_at: string; family: number; drawing?: number; added_by?: string | null; coloring?: number };
const COLS = 'id, caption, mime, width, height, bytes, member_id, created_at, family';

const PhotoSchema = z
  .object({
    id: z.string(),
    caption: z.string().nullable(),
    mime: z.string(),
    width: z.number(),
    height: z.number(),
    bytes: z.number(),
    memberId: z.string().nullable(),
    createdAt: z.string(),
    url: z.string(),
    family: z.boolean(), // false = a memory's own photo (not in the family photos)
  })
  .openapi('Photo');
const QuotaSchema = z
  .object({ count: z.number(), bytes: z.number(), memoryPhotos: z.number(), maxCount: z.number(), maxBytes: z.number(), maxPhotoBytes: z.number() }) // count/bytes include memoryPhotos
  .openapi('PhotoQuota');

const toApi = (r: PhotoRow): z.infer<typeof PhotoSchema> => ({
  id: r.id, caption: r.caption, mime: r.mime, width: r.width, height: r.height, bytes: r.bytes, memberId: r.member_id, createdAt: r.created_at, url: `/api/photos/${r.id}/image`, family: r.family !== 0,
});

// D1 hands BLOBs back as number[], node:sqlite as Uint8Array, a Durable Object as ArrayBuffer.
export function blobBytes(v: unknown): Uint8Array<ArrayBuffer> {
  if (v instanceof Uint8Array) return v as Uint8Array<ArrayBuffer>;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return Uint8Array.from(v as number[]);
  throw new Error('photo data is not a blob');
}

async function quota(db: KinwallDb) {
  const row = await db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(bytes), 0) AS bytes, COALESCE(SUM(family = 0 AND coloring = 0), 0) AS memory FROM photos').first<{ count: number; bytes: number; memory: number }>();
  return { count: row?.count ?? 0, bytes: row?.bytes ?? 0, memoryPhotos: row?.memory ?? 0, ...PHOTO_LIMITS };
}

// One statement, so two uploads racing can't both squeeze past the quota. false = it's full.
async function insertWithinQuota(db: KinwallDb, row: PhotoRow, data: Uint8Array): Promise<boolean> {
  const res = await db
    .prepare(
      `INSERT INTO photos (${COLS}, drawing, added_by, coloring, data) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?
       WHERE (SELECT COUNT(*) FROM photos) < ? AND (SELECT COALESCE(SUM(bytes), 0) FROM photos) + ? <= ?`,
    )
    .bind(row.id, row.caption, row.mime, row.width, row.height, row.bytes, row.member_id, row.created_at, row.family, row.drawing ?? 0, row.added_by ?? null, row.coloring ?? 0, data, PHOTO_LIMITS.maxCount, row.bytes, PHOTO_LIMITS.maxBytes)
    .run();
  return res.meta.changes > 0;
}

const memberExists = async (db: KinwallDb, id: string) => !!(await db.prepare('SELECT id FROM members WHERE id = ?').bind(id).first());

const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });
const notFound = { description: 'not found', content: json(ErrorSchema) };
const idParam = z.object({ id: z.string() });

photosRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/photos',
    tags: ['Photos'],
    summary: "The family's photos, newest first (metadata only; fetch each one's bytes from its url). Memories' own photos aren't listed.",
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: json(z.array(PhotoSchema)) } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare(`SELECT ${COLS} FROM photos WHERE family = 1 ORDER BY created_at DESC, rowid DESC`).all<PhotoRow>();
    return c.json(results.map(toApi), 200);
  },
);

photosRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/photos/quota',
    tags: ['Photos'],
    summary: 'How many photos and bytes are stored, and the limits',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: json(QuotaSchema) } },
  }),
  async (c) => c.json(await quota(c.env.DB), 200),
);

photosRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/photos',
    tags: ['Photos'],
    summary: 'Upload a photo: the raw image as the body (image/webp, image/jpeg or image/png, at most 600 KB), its size in X-Photo-Width / X-Photo-Height. Admin and display keys (so a drawing on the wall can be saved to the family photos); editing and deleting stay admin-only.',
    security: [{ Bearer: [] }],
    request: {
      query: z.object({
        caption: z.string().max(200).optional(),
        family: z.enum(['0', '1']).optional().openapi({ description: "0 = a memory's own photo: kept out of the family photos (attach it with POST /api/trackers)" }),
        drawing: z.enum(['0', '1']).optional().openapi({ description: '1 = a Paint drawing (Newscast: "Maya saved a drawing").' }),
        by: z.string().optional().openapi({ description: "Who made or added it, for Newscast (a member id; a person's own device only as them). Default: this device's person, if it's someone's." }),
      }),
      headers: z.object({ 'x-photo-width': z.coerce.number().int().min(1).max(10000), 'x-photo-height': z.coerce.number().int().min(1).max(10000) }),
      body: { required: true, content: Object.fromEntries(MIMES.map((m) => [m, { schema: z.string().openapi({ format: 'binary' }) }])) },
    },
    responses: {
      201: { description: 'created', content: json(PhotoSchema) },
      400: { description: 'empty body, bad size headers or unknown member', content: json(ErrorSchema) },
      403: { description: "a person's own device crediting someone else", content: json(ErrorSchema) },
      409: { description: 'quota full', content: json(QuotaSchema.extend({ error: z.string() })) },
      413: { description: 'photo too large', content: json(ErrorSchema) },
      415: { description: 'not a supported image type', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const { caption, family, drawing, by } = c.req.valid('query');
    const blocked = await ownerBlock(c, by);
    if (blocked) return c.json({ error: blocked }, 403);
    if (by && !(await memberExists(c.env.DB, by))) return c.json({ error: 'by: member not found' }, 400);
    const headers = c.req.valid('header');
    const mime = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (!MIMES.includes(mime)) return c.json({ error: 'Photos must be WebP, JPEG or PNG' }, 415);
    const tooBig = { error: `Photos can be at most ${PHOTO_LIMITS.maxPhotoBytes / 1024} KB` };
    if (Number(c.req.header('Content-Length')) > PHOTO_LIMITS.maxPhotoBytes) return c.json(tooBig, 413);
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.byteLength > PHOTO_LIMITS.maxPhotoBytes) return c.json(tooBig, 413);
    if (data.byteLength === 0) return c.json({ error: 'body: empty image' }, 400);

    const row: PhotoRow = {
      id: crypto.randomUUID(), caption: caption?.trim() || null, mime, width: headers['x-photo-width'], height: headers['x-photo-height'],
      bytes: data.byteLength, member_id: null, created_at: new Date().toISOString(), family: family === '0' ? 0 : 1,
      drawing: drawing === '1' ? 1 : 0, added_by: by ?? (await actorOf(c)).memberId,
    };
    if (!(await insertWithinQuota(c.env.DB, row, data))) return c.json({ error: 'Photo storage is full — delete some photos first', ...(await quota(c.env.DB)) }, 409);
    emit(c, 'photo.changed', { id: row.id });
    return c.json(toApi(row), 201);
  },
);

photosRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/photos/{id}',
    tags: ['Photos'],
    summary: "Change a photo's caption or who it's for (null clears either). Admin only.",
    security: [{ Bearer: [] }],
    request: {
      params: idParam,
      body: { content: json(z.object({ caption: z.string().max(200).nullable().optional(), memberId: z.string().nullable().optional() })) },
    },
    responses: { 200: { description: 'ok', content: json(PhotoSchema) }, 400: { description: 'unknown member', content: json(ErrorSchema) }, 404: notFound },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.env.DB;
    const existing = await db.prepare(`SELECT ${COLS} FROM photos WHERE id = ?`).bind(id).first<PhotoRow>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    if (body.memberId && !(await memberExists(db, body.memberId))) return c.json({ error: 'memberId: member not found' }, 400);
    const row: PhotoRow = {
      ...existing,
      caption: body.caption === undefined ? existing.caption : body.caption?.trim() || null,
      member_id: body.memberId === undefined ? existing.member_id : body.memberId,
    };
    await db.prepare('UPDATE photos SET caption = ?, member_id = ? WHERE id = ?').bind(row.caption, row.member_id, id).run();
    emit(c, 'photo.changed', { id });
    return c.json(toApi(row), 200);
  },
);

photosRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/photos/{id}',
    tags: ['Photos'],
    summary: 'Delete a photo. Admin only.',
    security: [{ Bearer: [] }],
    request: { params: idParam },
    responses: { 200: { description: 'ok', content: json(z.object({ ok: z.boolean() })) }, 404: notFound },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const res = await c.env.DB.prepare('DELETE FROM photos WHERE id = ?').bind(id).run();
    if (res.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    emit(c, 'photo.changed', { id, deleted: true });
    return c.json({ ok: true }, 200);
  },
);

photosRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/photos/{id}/image',
    tags: ['Photos'],
    summary: "A photo's bytes. Takes the API key as the Bearer header, or a media token (GET /api/media-token) as ?key= so an <img src> can load it (never the full key).",
    security: [{ Bearer: [] }],
    request: { params: idParam, query: z.object({ key: z.string().optional() }) },
    responses: {
      200: { description: 'the image, with its stored Content-Type', content: Object.fromEntries(MIMES.map((m) => [m, { schema: z.string().openapi({ format: 'binary' }) }])) },
      304: { description: 'not modified' },
      404: notFound,
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    // Bytes never change for an id (PATCH only touches caption/member), so the id is the ETag.
    const etag = `"${id}"`;
    const cache = { ETag: etag, 'Cache-Control': 'private, max-age=31536000, immutable' };
    if (c.req.header('If-None-Match') === etag) return c.body(null, 304, cache);
    const row = await c.env.DB.prepare('SELECT mime, data FROM photos WHERE id = ?').bind(id).first<{ mime: string; data: unknown }>();
    if (!row) return c.json({ error: 'not found' }, 404);
    return c.body(blobBytes(row.data), 200, { ...cache, 'Content-Type': row.mime });
  },
);

// ---------- Zip export / import (a separate backup; the JSON export never carries photo bytes) ----------

const EXT: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' };
const MIME_OF_EXT: Record<string, string> = { webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png' };
export const MAX_ZIP_BYTES = PHOTO_LIMITS.maxBytes + 10 * 1024 * 1024; // a full album plus zip overhead and manifest
const binary = { schema: z.string().openapi({ format: 'binary' }) };

type ManifestEntry = { id: string; file: string; caption: string | null; memberId: string | null; memberName: string | null; mime: string; width: number; height: number; bytes: number; createdAt: string; family: boolean; coloring?: boolean };

/** Pixel size from the file header (PNG, JPEG, WebP), for zips without a manifest. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const ascii = (at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
  const ok = (width: number, height: number) => (width > 0 && height > 0 ? { width, height } : null);
  try {
    if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return ok(v.getUint32(16), v.getUint32(20));
    if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') {
      const kind = ascii(12, 4);
      if (kind === 'VP8 ') return ok(v.getUint16(26, true) & 0x3fff, v.getUint16(28, true) & 0x3fff);
      if (kind === 'VP8L') { const x = v.getUint32(21, true); return ok((x & 0x3fff) + 1, ((x >> 14) & 0x3fff) + 1); }
      if (kind === 'VP8X') return ok(1 + (v.getUint32(24, true) & 0xffffff), 1 + (v.getUint32(27, true) & 0xffffff));
    }
    if (b[0] === 0xff && b[1] === 0xd8) {
      for (let i = 2; i + 9 < b.length; ) {
        if (b[i] !== 0xff) return null;
        const m = b[i + 1];
        if (m === 0xff) { i++; continue; } // fill byte
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return ok(v.getUint16(i + 7), v.getUint16(i + 5)); // SOFn
        i += 2 + v.getUint16(i + 2);
      }
    }
  } catch {
    // truncated header
  }
  return null;
}

// A browser download can't send a header, and a key in a link lands in history and logs: the web
// app asks for a one-time link (auth.ts photoExportTicket) and opens that.
photosRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/photos/export-link',
    tags: ['Photos'],
    summary: 'A link that downloads GET /api/photos/export.zip once, within a minute, with no key in it. Admin only.',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: json(z.object({ url: z.string().openapi({ example: '/api/photos/export.zip?ticket=…' }), expiresAt: z.string() })) } },
  }),
  async (c) => {
    const { ticket, expiresAt } = await photoExportTicket(c.env.DB);
    c.header('Cache-Control', 'no-store');
    return c.json({ url: `/api/photos/export.zip?ticket=${ticket}`, expiresAt }, 200);
  },
);

photosRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/photos/export.zip',
    tags: ['Photos'],
    summary:
      'Download every photo as a zip: photos/<yyyy-mm-dd>-<id>.<ext> plus manifest.json (captions, owners, sizes; "family": false marks a memory\'s own photo). Admin only. Takes the key as the Bearer header, or ?ticket= from POST /api/photos/export-link (a plain download link); never a key in the URL.',
    security: [{ Bearer: [] }],
    request: { query: z.object({ ticket: z.string().optional() }) },
    responses: { 200: { description: 'the zip, streamed', content: { 'application/zip': binary } } },
  }),
  async (c) => {
    const db = c.env.DB;
    const { results } = await db
      .prepare(`SELECT p.id, p.caption, p.mime, p.width, p.height, p.bytes, p.member_id, p.created_at, p.family, p.coloring, m.name AS member_name
        FROM photos p LEFT JOIN members m ON m.id = p.member_id ORDER BY p.created_at, p.rowid`)
      .all<PhotoRow & { member_name: string | null }>();
    const fileOf = (r: PhotoRow) => `photos/${r.created_at.slice(0, 10)}-${r.id}.${EXT[r.mime] ?? 'bin'}`;
    const manifest: ManifestEntry[] = results.map((r) => ({
      id: r.id, file: fileOf(r), caption: r.caption, memberId: r.member_id, memberName: r.member_name, mime: r.mime, width: r.width, height: r.height, bytes: r.bytes, createdAt: r.created_at, family: r.family !== 0, ...(r.coloring ? { coloring: true } : {}),
    }));
    // The manifest first, then one photo's bytes fetched per pull: only one photo in memory at a time.
    let i = -1;
    const next = async (): Promise<ZipFile | null> => {
      if (i === -1) { i++; return { name: 'manifest.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 2)), modified: new Date() }; }
      while (i < results.length) {
        const r = results[i++];
        const row = await db.prepare('SELECT data FROM photos WHERE id = ?').bind(r.id).first<{ data: unknown }>();
        if (row) return { name: fileOf(r), data: blobBytes(row.data), modified: new Date(r.created_at) }; // else deleted meanwhile
      }
      return null;
    };
    return c.body(zipStream(next), 200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="kinwall-photos-${new Date().toISOString().slice(0, 10)}.zip"`,
      'Cache-Control': 'no-store',
    });
  },
);

photosRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/photos/import',
    tags: ['Photos'],
    summary:
      'Import photos from a zip made by /api/photos/export.zip (or re-saved by another zip tool: stored or deflated). manifest.json, when present, restores captions and owners (members matched by id, else by name). Photos whose id is already here are skipped, as are ones over the size or quota limits. Admin only.',
    security: [{ Bearer: [] }],
    request: { body: { required: true, content: { 'application/zip': binary } } },
    responses: {
      200: { description: 'ok', content: json(z.object({ imported: z.number(), skipped: z.number() })) },
      400: { description: 'not a zip', content: json(ErrorSchema) },
      413: { description: 'zip too large', content: json(ErrorSchema) },
      415: { description: 'not application/zip', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const type = (c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/zip' && type !== 'application/x-zip-compressed') return c.json({ error: 'Send the zip as application/zip' }, 415);
    const tooBig = { error: `The zip can be at most ${MAX_ZIP_BYTES / 1048576} MB` };
    if (Number(c.req.header('Content-Length')) > MAX_ZIP_BYTES) return c.json(tooBig, 413);
    // ponytail: the whole zip is held in memory (the central directory is at the end); fine at the
    // 110 MB cap, stream it to R2/disk first if the quota ever grows much.
    const zip = new Uint8Array(await c.req.arrayBuffer());
    if (zip.byteLength > MAX_ZIP_BYTES) return c.json(tooBig, 413);
    let entries;
    try {
      entries = readZip(zip, PHOTO_LIMITS.maxPhotoBytes);
    } catch {
      return c.json({ error: "That file isn't a zip Kinwall can read." }, 400);
    }

    const base = (name: string) => name.split('/').pop() ?? name;
    const manifest = new Map<string, Partial<ManifestEntry>>();
    const manifestEntry = entries.find((e) => base(e.name) === 'manifest.json');
    const manifestBytes = await manifestEntry?.read(5 * 1024 * 1024);
    if (manifestBytes) {
      try {
        const list = JSON.parse(new TextDecoder().decode(manifestBytes));
        if (Array.isArray(list)) for (const m of list) if (m && typeof m.file === 'string') manifest.set(base(m.file), m);
      } catch {
        // unreadable manifest: import the pictures without captions/owners
      }
    }

    const db = c.env.DB;
    const [membersRes, idsRes] = await db.batch<unknown>([db.prepare('SELECT id, name FROM members'), db.prepare('SELECT id FROM photos')]);
    const members = membersRes.results as { id: string; name: string }[];
    const existing = new Set((idsRes.results as { id: string }[]).map((r) => r.id));
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

    let imported = 0;
    let skipped = 0;
    for (const entry of entries) {
      const name = base(entry.name);
      const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
      if (entry.name.endsWith('/') || entry.name.startsWith('__MACOSX/') || name.startsWith('.') || !MIME_OF_EXT[ext]) continue; // not a photo
      const meta = manifest.get(name) ?? {};
      const stem = name.slice(0, -(ext.length + 1));
      const candidate = str(meta.id, 64) ?? stem.replace(/^\d{4}-\d{2}-\d{2}-/, '');
      const id = /^[\w-]{1,64}$/.test(candidate) ? candidate : crypto.randomUUID();
      if (existing.has(id) || entry.size > PHOTO_LIMITS.maxPhotoBytes) { skipped++; continue; }
      const data = await entry.read();
      const mime = typeof meta.mime === 'string' && MIMES.includes(meta.mime) ? meta.mime : MIME_OF_EXT[ext];
      const size = Number.isInteger(meta.width) && Number.isInteger(meta.height) && meta.width! > 0 && meta.height! > 0
        ? { width: meta.width!, height: meta.height! }
        : data && imageSize(data);
      if (!data || !data.byteLength || !size) { skipped++; continue; }
      const memberName = str(meta.memberName, 100)?.toLowerCase();
      const member = members.find((m) => m.id === meta.memberId) ?? (memberName ? members.find((m) => m.name.trim().toLowerCase() === memberName) : undefined);
      const created = typeof meta.createdAt === 'string' && !Number.isNaN(Date.parse(meta.createdAt)) ? new Date(meta.createdAt).toISOString() : new Date().toISOString();
      const row: PhotoRow = { id, caption: str(meta.caption, 200), mime, width: size.width, height: size.height, bytes: data.byteLength, member_id: member?.id ?? null, created_at: created, family: meta.family === false || meta.coloring === true ? 0 : 1, coloring: meta.coloring === true ? 1 : 0 };
      if (!(await insertWithinQuota(db, row, data))) { skipped++; continue; }
      existing.add(id);
      imported++;
    }
    if (imported) emit(c, 'photo.changed', { imported });
    return c.json({ imported, skipped }, 200);
  },
);

// ---------- Coloring pages (Paint's coloring book) ----------
// The built-in pages ship with the app (web/src/coloringPages.ts); these are the family's own, added
// from a parent's device. Wall screens and kids' devices list and draw on them (DISPLAY_ALLOWED in
// auth.ts lets them GET); adding and deleting stay with full access, like other family content.

const ColoringPageSchema = z
  .object({ id: z.string(), name: z.string(), width: z.number(), height: z.number(), createdAt: z.string(), url: z.string() })
  .openapi('ColoringPage');
const pageOf = (r: Pick<PhotoRow, 'id' | 'caption' | 'width' | 'height' | 'created_at'>): z.infer<typeof ColoringPageSchema> => ({
  id: r.id, name: r.caption ?? 'Coloring page', width: r.width, height: r.height, createdAt: r.created_at, url: `/api/photos/${r.id}/image`,
});

photosRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/coloring-pages',
    tags: ['Photos'],
    summary: "The family's own coloring pages for Paint, newest first (fetch each one's line art from its url). They aren't family photos.",
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: json(z.array(ColoringPageSchema)) } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT id, caption, width, height, created_at FROM photos WHERE coloring = 1 ORDER BY created_at DESC, rowid DESC').all<PhotoRow>();
    return c.json(results.map(pageOf), 200);
  },
);

photosRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/coloring-pages',
    tags: ['Photos'],
    summary: 'Add a coloring page: line art as a PNG body (dark lines on a transparent background, at most 600 KB), its size in X-Photo-Width / X-Photo-Height. Counts toward the photo limits. Admin only.',
    security: [{ Bearer: [] }],
    request: {
      query: z.object({ name: z.string().max(60).optional() }),
      headers: z.object({ 'x-photo-width': z.coerce.number().int().min(1).max(10000), 'x-photo-height': z.coerce.number().int().min(1).max(10000) }),
      body: { required: true, content: { 'image/png': { schema: z.string().openapi({ format: 'binary' }) } } },
    },
    responses: {
      201: { description: 'created', content: json(ColoringPageSchema) },
      400: { description: 'empty body or bad size headers', content: json(ErrorSchema) },
      409: { description: 'photo storage full', content: json(QuotaSchema.extend({ error: z.string() })) },
      413: { description: 'too large', content: json(ErrorSchema) },
      415: { description: 'not a PNG', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const { name } = c.req.valid('query');
    const size = c.req.valid('header');
    if ((c.req.header('Content-Type') ?? '').split(';')[0].trim().toLowerCase() !== 'image/png') return c.json({ error: 'A coloring page must be a PNG' }, 415);
    const tooBig = { error: `A coloring page can be at most ${PHOTO_LIMITS.maxPhotoBytes / 1024} KB` };
    if (Number(c.req.header('Content-Length')) > PHOTO_LIMITS.maxPhotoBytes) return c.json(tooBig, 413);
    const data = new Uint8Array(await c.req.arrayBuffer());
    if (data.byteLength > PHOTO_LIMITS.maxPhotoBytes) return c.json(tooBig, 413);
    if (data.byteLength === 0) return c.json({ error: 'body: empty image' }, 400);
    const row: PhotoRow = {
      id: crypto.randomUUID(), caption: name?.trim() || 'Coloring page', mime: 'image/png', width: size['x-photo-width'], height: size['x-photo-height'],
      bytes: data.byteLength, member_id: null, created_at: new Date().toISOString(), family: 0, coloring: 1,
    };
    if (!(await insertWithinQuota(c.env.DB, row, data))) return c.json({ error: 'Photo storage is full — delete some photos first', ...(await quota(c.env.DB)) }, 409);
    emit(c, 'photo.changed', { id: row.id });
    return c.json(pageOf(row), 201);
  },
);

photosRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/coloring-pages/{id}',
    tags: ['Photos'],
    summary: "Delete one of the family's coloring pages (drawings already made on it keep their lines). Admin only.",
    security: [{ Bearer: [] }],
    request: { params: idParam },
    responses: { 200: { description: 'ok', content: json(z.object({ ok: z.boolean() })) }, 404: notFound },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const res = await c.env.DB.prepare('DELETE FROM photos WHERE id = ? AND coloring = 1').bind(id).run();
    if (res.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    emit(c, 'photo.changed', { id, deleted: true });
    return c.json({ ok: true }, 200);
  },
);
