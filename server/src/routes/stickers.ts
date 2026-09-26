// Points ledger + sticker book (migration 0025): members spend chore points on sticker packs
// (defined in ../stickers.ts) and place the stickers on their own scrapbook page.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { emit } from '../bus.ts';
import type { KinwallDb } from '../db.ts';
import { readSettings } from './settings.ts';
import { BALANCE_EXPR, STICKER_PACKS, scaledPrice, pointTotalsStmt, type PointTotals, type StickerPack } from '../stickers.ts';
import {
  ErrorSchema,
  PointsSchema,
  StickerPackSchema,
  StickerPlacementInputSchema,
  StickerPlacementPatchSchema,
  StickerPlacementSchema,
  type PointEntrySchema,
} from '../schemas.ts';

export const stickersRoutes = createRouter();

export type PointEntryRow = { id: string; member_id: string; amount: number; reason: string; ref: string | null; at: string };
export type PlacementRow = { id: string; member_id: string; sticker: string; x: number; y: number; scale: number; rotation: number; z: number; placed_at: string };

export const toEntryApi = (r: PointEntryRow): z.infer<typeof PointEntrySchema> => ({ id: r.id, memberId: r.member_id, amount: r.amount, reason: r.reason, ref: r.ref, at: r.at });
export const toPlacementApi = (r: PlacementRow) => ({
  id: r.id, memberId: r.member_id, sticker: r.sticker, x: r.x, y: r.y, scale: r.scale, rotation: r.rotation, z: r.z, placedAt: r.placed_at,
});

// ponytail: fixed per-page cap so a page can't grow without bound; raise it if families fill it.
const MAX_STICKERS_PER_PAGE = 300;

const packApi = (p: StickerPack, scale: number, owned: Set<string>) => ({
  id: p.id, name: p.name, cover: p.cover, stickers: p.stickers, basePrice: p.price, price: scaledPrice(p, scale), unlocked: p.price === 0 || owned.has(p.id),
});

async function ownedPacks(db: KinwallDb, memberId: string): Promise<Set<string>> {
  const { results } = await db.prepare('SELECT pack_id FROM member_sticker_packs WHERE member_id = ?').bind(memberId).all<{ pack_id: string }>();
  return new Set(results.map((r) => r.pack_id));
}

const memberExists = async (db: KinwallDb, id: string) => !!(await db.prepare('SELECT id FROM members WHERE id = ?').bind(id).first());

const notFound = { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } };

stickersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/members/{id}/points',
    tags: ['Members'],
    summary: "A member's points: balance to spend, all-time earned and spent, and the last 50 ledger entries",
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: PointsSchema } } }, 404: notFound },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const db = c.env.DB;
    const [totalsRes, entriesRes] = await db.batch<unknown>([
      pointTotalsStmt(db, id),
      db.prepare('SELECT * FROM point_entries WHERE member_id = ? ORDER BY at DESC, rowid DESC LIMIT 50').bind(id),
    ]);
    const totals = totalsRes.results[0] as PointTotals | undefined;
    if (!totals) return c.json({ error: 'member not found' }, 404);
    return c.json({ balance: totals.earned - totals.spent, earnedTotal: totals.earned, spentTotal: totals.spent, entries: (entriesRes.results as PointEntryRow[]).map(toEntryApi) }, 200);
  },
);

stickersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/stickers/packs',
    tags: ['Stickers'],
    summary: 'All sticker packs with prices after the household scale; with ?memberId=, which ones that member has unlocked',
    security: [{ Bearer: [] }],
    request: { query: z.object({ memberId: z.string().optional() }) },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(StickerPackSchema) } } } },
  }),
  async (c) => {
    const { memberId } = c.req.valid('query');
    const [{ stickerPriceScale }, owned] = await Promise.all([readSettings(c.env.DB), memberId ? ownedPacks(c.env.DB, memberId) : new Set<string>()]);
    return c.json(STICKER_PACKS.map((p) => packApi(p, stickerPriceScale, owned)), 200);
  },
);

stickersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/stickers/packs/{packId}/buy',
    tags: ['Stickers'],
    summary: "Unlock a sticker pack for a member, paying its price from their points balance",
    security: [{ Bearer: [] }],
    request: {
      params: z.object({ packId: z.string() }),
      body: { content: { 'application/json': { schema: z.object({ memberId: z.string() }) } } },
    },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ pack: StickerPackSchema, balance: z.number() }) } } },
      402: { description: 'not enough points', content: { 'application/json': { schema: z.object({ error: z.string(), balance: z.number(), price: z.number() }) } } },
      403: { description: 'sticker shop is off', content: { 'application/json': { schema: ErrorSchema } } },
      404: notFound,
      409: { description: 'already unlocked', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { packId } = c.req.valid('param');
    const { memberId } = c.req.valid('json');
    const db = c.env.DB;
    const pack = STICKER_PACKS.find((p) => p.id === packId);
    if (!pack) return c.json({ error: 'pack not found' }, 404);
    const settings = await readSettings(db);
    if (!settings.stickersEnabled) return c.json({ error: 'The sticker shop is turned off' }, 403);
    const [totalsRes, ownedRes] = await db.batch<unknown>([
      pointTotalsStmt(db, memberId),
      db.prepare('SELECT 1 FROM member_sticker_packs WHERE member_id = ? AND pack_id = ?').bind(memberId, packId),
    ]);
    const totals = totalsRes.results[0] as PointTotals | undefined;
    if (!totals) return c.json({ error: 'member not found' }, 404);
    if (pack.price === 0 || ownedRes.results.length) return c.json({ error: 'Already unlocked' }, 409);
    const price = scaledPrice(pack, settings.stickerPriceScale);
    const balance = totals.earned - totals.spent;
    if (balance < price) return c.json({ error: 'Not enough points', balance, price }, 402);

    // Charge + unlock in one batch. The charge re-checks the balance in SQL, and the unlock only
    // happens if the charge row landed, so two purchases racing can't overspend; a pack already
    // unlocked by a racing request fails the PK and rolls back the charge with it.
    const entryId = crypto.randomUUID();
    const now = new Date().toISOString();
    const writes = [
      db
        .prepare(`INSERT INTO point_entries (id, member_id, amount, reason, ref, at) SELECT ?, ?, ?, 'sticker_pack', ?, ? WHERE ${BALANCE_EXPR} >= ?`)
        .bind(entryId, memberId, -price, packId, now, memberId, memberId, price),
      db
        .prepare(`INSERT INTO member_sticker_packs (member_id, pack_id, unlocked_at) SELECT ?, ?, ? WHERE ? = 0 OR EXISTS (SELECT 1 FROM point_entries WHERE id = ?)`)
        .bind(memberId, packId, now, price, entryId),
    ];
    if (price === 0) writes.shift();
    try {
      await db.batch(writes);
    } catch {
      return c.json({ error: 'Already unlocked' }, 409);
    }
    const owned = await ownedPacks(db, memberId);
    const after = (await pointTotalsStmt(db, memberId).first<PointTotals>())!;
    if (!owned.has(packId)) return c.json({ error: 'Not enough points', balance: after.earned - after.spent, price }, 402);
    emit(c, 'sticker.changed', { memberId, packId });
    return c.json({ pack: packApi(pack, settings.stickerPriceScale, owned), balance: after.earned - after.spent }, 200);
  },
);

const scrapParams = z.object({ memberId: z.string() });

stickersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/stickers/scrapbook/{memberId}',
    tags: ['Stickers'],
    summary: "The stickers on a member's scrapbook page, back to front",
    security: [{ Bearer: [] }],
    request: { params: scrapParams },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(StickerPlacementSchema) } } }, 404: notFound },
  }),
  async (c) => {
    const { memberId } = c.req.valid('param');
    if (!(await memberExists(c.env.DB, memberId))) return c.json({ error: 'member not found' }, 404);
    const { results } = await c.env.DB.prepare('SELECT * FROM scrapbook_stickers WHERE member_id = ? ORDER BY z, placed_at').bind(memberId).all<PlacementRow>();
    return c.json(results.map(toPlacementApi), 200);
  },
);

stickersRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/stickers/scrapbook/{memberId}',
    tags: ['Stickers'],
    summary: "Place a sticker on a member's page (it must be from a pack they've unlocked). Defaults: center, scale 1, on top.",
    security: [{ Bearer: [] }],
    request: { params: scrapParams, body: { content: { 'application/json': { schema: StickerPlacementInputSchema } } } },
    responses: {
      201: { description: 'created', content: { 'application/json': { schema: StickerPlacementSchema } } },
      403: { description: 'sticker not unlocked', content: { 'application/json': { schema: ErrorSchema } } },
      404: notFound,
      409: { description: 'page full', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { memberId } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.env.DB;
    const [memberRes, ownedRes, pageRes] = await db.batch<unknown>([
      db.prepare('SELECT id FROM members WHERE id = ?').bind(memberId),
      db.prepare('SELECT pack_id FROM member_sticker_packs WHERE member_id = ?').bind(memberId),
      db.prepare('SELECT COUNT(*) AS n, COALESCE(MAX(z), 0) AS top FROM scrapbook_stickers WHERE member_id = ?').bind(memberId),
    ]);
    if (!memberRes.results.length) return c.json({ error: 'member not found' }, 404);
    const owned = new Set((ownedRes.results as { pack_id: string }[]).map((r) => r.pack_id));
    if (!STICKER_PACKS.some((p) => (p.price === 0 || owned.has(p.id)) && p.stickers.includes(body.sticker))) {
      return c.json({ error: "That sticker isn't in a pack this member has unlocked" }, 403);
    }
    const page = pageRes.results[0] as { n: number; top: number };
    if (page.n >= MAX_STICKERS_PER_PAGE) return c.json({ error: 'This page is full' }, 409);
    const row: PlacementRow = {
      id: crypto.randomUUID(),
      member_id: memberId,
      sticker: body.sticker,
      x: body.x ?? 0.5,
      y: body.y ?? 0.5,
      scale: body.scale ?? 1,
      rotation: body.rotation ?? 0,
      z: body.z ?? page.top + 1,
      placed_at: new Date().toISOString(),
    };
    await db
      .prepare('INSERT INTO scrapbook_stickers (id, member_id, sticker, x, y, scale, rotation, z, placed_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .bind(row.id, row.member_id, row.sticker, row.x, row.y, row.scale, row.rotation, row.z, row.placed_at)
      .run();
    emit(c, 'sticker.changed', { memberId, id: row.id });
    return c.json(toPlacementApi(row), 201);
  },
);

const placementParams = z.object({ memberId: z.string(), id: z.string() });

stickersRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/stickers/scrapbook/{memberId}/{id}',
    tags: ['Stickers'],
    summary: 'Move, resize, rotate or restack a placed sticker',
    security: [{ Bearer: [] }],
    request: { params: placementParams, body: { content: { 'application/json': { schema: StickerPlacementPatchSchema } } } },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: StickerPlacementSchema } } }, 404: notFound },
  }),
  async (c) => {
    const { memberId, id } = c.req.valid('param');
    const body = c.req.valid('json');
    const db = c.env.DB;
    const existing = await db.prepare('SELECT * FROM scrapbook_stickers WHERE id = ? AND member_id = ?').bind(id, memberId).first<PlacementRow>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    const row: PlacementRow = { ...existing, ...body };
    await db.prepare('UPDATE scrapbook_stickers SET x = ?, y = ?, scale = ?, rotation = ?, z = ? WHERE id = ?').bind(row.x, row.y, row.scale, row.rotation, row.z, id).run();
    emit(c, 'sticker.changed', { memberId, id });
    return c.json(toPlacementApi(row), 200);
  },
);

stickersRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/stickers/scrapbook/{memberId}/{id}',
    tags: ['Stickers'],
    summary: "Peel a sticker off a member's page",
    security: [{ Bearer: [] }],
    request: { params: placementParams },
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } }, 404: notFound },
  }),
  async (c) => {
    const { memberId, id } = c.req.valid('param');
    const result = await c.env.DB.prepare('DELETE FROM scrapbook_stickers WHERE id = ? AND member_id = ?').bind(id, memberId).run();
    if (result.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    emit(c, 'sticker.changed', { memberId, id });
    return c.json({ ok: true }, 200);
  },
);
