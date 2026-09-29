// The iPhone app registers its Live Activity push tokens here (kinwall-mobile), so the notify tick
// can start a leave-by / start-prep Live Activity while the app is closed and end it on time
// (notify.ts runLiveActivities, apns.ts). Tokens are kept per device: the key making the request,
// or for the app's own sign-in, its OAuth grant (whose access keys rotate hourly). Revoking either
// deletes them.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { requestKey } from '../auth.ts';
import { seal } from '../crypto.ts';
import { apnsConfigured } from '../apns.ts';
import { ErrorSchema } from '../schemas.ts';
import type { Env } from '../env.ts';
import type { Context } from 'hono';

export const liveActivitiesRoutes = createRouter();

const TokenSchema = z
  .object({
    kind: z.enum(['start', 'update']).openapi({ description: "'start': the app's push-to-start token (iOS 17.2+); 'update': one running activity's token" }),
    token: z.string().regex(/^[0-9a-f]{16,400}$/i).openapi({ description: 'The APNs token, hex. Never returned or logged' }),
    activity: z.string().min(1).max(300).optional().openapi({ description: "An update token's activity, as the app names it: 'leaveBy:<event id>@<start>'" }),
    endsAt: z.string().datetime({ offset: true }).optional().openapi({ description: "An update token's activity: when the server should end it" }),
  })
  .strict()
  .openapi('LiveActivityToken');

const aad = (id: string) => `live-activity-token:${id}`;

/** The device a request speaks for: its key, or its OAuth grant. Null for ADMIN_API_KEY. */
async function device(c: Context<{ Bindings: Env }>): Promise<{ device: string; keyId: string | null; grantId: string | null } | null> {
  const me = await requestKey(c);
  if (!me?.id) return null;
  if (me.kind === 'oauth') {
    const grant = (await c.env.DB.prepare('SELECT oauth_grant_id FROM api_keys WHERE id = ?').bind(me.id).first<{ oauth_grant_id: string | null }>())?.oauth_grant_id;
    if (grant) return { device: `grant:${grant}`, keyId: null, grantId: grant };
  }
  return { device: `key:${me.id}`, keyId: me.id, grantId: null };
}

liveActivitiesRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/live-activities/tokens',
    tags: ['Push'],
    summary: "Register the iPhone app's Live Activity push token for this device (replaces the last one of that kind and activity)",
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: TokenSchema } } } },
    responses: {
      200: { description: 'ok; `push` says whether this server sends Apple push (APNS_* set)', content: { 'application/json': { schema: z.object({ push: z.boolean() }) } } },
      400: { description: 'invalid, or not a device key', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    if ((body.kind === 'update') !== !!body.activity) return c.json({ error: 'an update token needs its activity; a start token has none' }, 400);
    const d = await device(c);
    if (!d) return c.json({ error: 'register from a device key' }, 400);
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO live_activity_tokens (id, device, api_key_id, oauth_grant_id, kind, activity, token, ends_at, created_at) VALUES (?,?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(device, kind, activity) DO UPDATE SET id = excluded.id, token = excluded.token, ends_at = excluded.ends_at, created_at = excluded.created_at',
    )
      .bind(id, d.device, d.keyId, d.grantId, body.kind, body.activity ?? '', await seal(c.env, body.token.toLowerCase(), aad(id)), body.endsAt ?? null, new Date().toISOString())
      .run();
    return c.json({ push: apnsConfigured(c.env) }, 200);
  },
);

liveActivitiesRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/live-activities/tokens',
    tags: ['Push'],
    summary: "Forget this device's Live Activity token: an activity that ended, or (no activity) the push-to-start token",
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: z.object({ activity: z.string().min(1).max(300).optional() }).strict() } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      400: { description: 'not a device key', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { activity } = c.req.valid('json');
    const d = await device(c);
    if (!d) return c.json({ error: 'register from a device key' }, 400);
    await c.env.DB.prepare('DELETE FROM live_activity_tokens WHERE device = ? AND kind = ? AND activity = ?').bind(d.device, activity ? 'update' : 'start', activity ?? '').run();
    return c.json({ ok: true }, 200);
  },
);
