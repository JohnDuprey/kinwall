import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { resolveKey, validOwner } from '../auth.ts';
import { emit } from '../bus.ts';
import { recordDeviceOwner } from '../notify.ts';
import { isConnectedApp } from './mcp-oauth.ts';
import { ErrorSchema, MeSchema } from '../schemas.ts';
import { VERSION } from '../version.ts';

export const meRoutes = createRouter();

meRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/me',
    tags: ['System'],
    summary: "Identify the current API key (scope, name, whose device it is and whether that locks its family filter), so clients can adapt their UI",
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: MeSchema } } } },
  }),
  async (c) => {
    // requireAuth already validated the key; re-resolving here is cheap and avoids threading
    // Variables typing through every route file just for this one endpoint.
    const resolved = await resolveKey(c);
    return c.json({ scope: resolved?.scope ?? 'admin', keyName: resolved?.name ?? '', kind: resolved?.kind ?? 'api', owner: resolved?.owner ?? null, locked: resolved?.scope === 'display' && !!resolved.owner, version: VERSION, ...(c.env.HOST_PORTAL_URL ? { hostPortalUrl: c.env.HOST_PORTAL_URL } : {}) }, 200);
  },
);

// "This is my device": a parent's device (full access) says whose it is, so it reads their private
// journal (routes/journal.ts). Saved where the sign-in lives: the API key itself, the passkey (its
// later sessions carry it too) or Kinwall's app sign-in (the grant). Only a grown-up; never the
// environment ADMIN_API_KEY, a recovery session (a recovery code or hosted support's link) or a
// connected app. Everyday-access devices can't reassign themselves (not in DISPLAY_ALLOWED; a parent
// does it in Settings → Access). Every change leaves a line in the family's notification feed.
meRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/me/owner',
    tags: ['System'],
    summary: "Say whose device this full-access sign-in is: a grown-up's member id, or 'shared' for nobody. It then reads that person's private journal. Not for the environment admin key, recovery sessions or connected apps.",
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: z.object({ owner: z.string().min(1) }) } } } },
    responses: {
      200: { description: 'saved', content: { 'application/json': { schema: z.object({ owner: z.string() }) } } },
      400: { description: 'not a grown-up, or a sign-in that can\'t belong to anyone', content: { 'application/json': { schema: ErrorSchema } } },
      403: { description: 'a connected app or an everyday-access device', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const key = await resolveKey(c);
    if (!key || key.scope !== 'admin' || (await isConnectedApp(c))) return c.json({ error: "Only a parent's own device can say whose it is." }, 403);
    const owner = await validOwner(c.env.DB, c.req.valid('json').owner, 'admin');
    if (!owner) return c.json({ error: 'A full-access device can only belong to a grown-up' }, 400);
    const db = c.env.DB;
    const row = key.id ? await db.prepare('SELECT passkey_id, oauth_grant_id FROM api_keys WHERE id = ?').bind(key.id).first<{ passkey_id: string | null; oauth_grant_id: string | null }>() : null;
    if (!row || (key.kind === 'session' && !row.passkey_id)) return c.json({ error: "This sign-in can't belong to anyone (the admin key or a recovery sign-in). Sign in with a passkey or pair this device." }, 400);
    if (row.passkey_id) {
      await db.batch([db.prepare('UPDATE passkeys SET owner = ? WHERE id = ?').bind(owner === 'shared' ? null : owner, row.passkey_id), db.prepare('UPDATE api_keys SET owner = ? WHERE passkey_id = ?').bind(owner, row.passkey_id)]);
    } else if (row.oauth_grant_id) {
      await db.batch([db.prepare('UPDATE oauth_grants SET owner = ? WHERE id = ?').bind(owner, row.oauth_grant_id), db.prepare('UPDATE api_keys SET owner = ? WHERE oauth_grant_id = ?').bind(owner, row.oauth_grant_id)]);
    } else {
      await db.prepare('UPDATE api_keys SET owner = ? WHERE id = ?').bind(owner, key.id).run();
    }
    if (owner !== key.owner) await recordDeviceOwner(db, key.name, owner);
    emit(c, 'settings.changed', { keyId: key.id });
    return c.json({ owner }, 200);
  },
);
