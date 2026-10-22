// The iPhone app registers its Live Activity push tokens here (kinwall-mobile), so the notify tick
// can start a leave-by / start-prep Live Activity while the app is closed and end it on time
// (notify.ts runLiveActivities, apns.ts). Tokens are kept per device: the key making the request,
// or for the app's own sign-in, its OAuth grant (whose access keys rotate hourly). Revoking either
// deletes them.
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import { requestKey, sha256Hex } from '../auth.ts';
import { encrypt, seal } from '../crypto.ts';
import { nativePushStatus } from '../native-push.ts';
import { GatewayInput, gatewayAad, verifyGateway } from '../push-gateway.ts';
import { ErrorSchema, NativePushStatusSchema } from '../schemas.ts';
import type { Env } from '../env.ts';
import type { Context } from 'hono';

export const liveActivitiesRoutes = createRouter();

const TokenSchema = z
  .object({
    kind: z.enum(['start', 'update']).openapi({ description: "'start': the app's push-to-start token (iOS 17.2+); 'update': one running activity's token" }),
    token: z.string().regex(/^[0-9a-f]{16,400}$/i).openapi({ description: 'The APNs token, hex. Never returned or logged' }),
    activity: z.string().min(1).max(300).optional().openapi({ description: "An update token's activity, as the app names it: 'leaveBy:<event id>@<start>'" }),
    endsAt: z.string().datetime({ offset: true }).optional().openapi({ description: "An update token's activity: when the server should end it" }),
    gateway: GatewayInput.nullable().optional(),
  })
  .strict()
  .openapi('LiveActivityToken');

// A device legitimately has one push-to-start token and a few running activities (iOS allows about
// five at once); more than this is a client making up activity names, so the oldest are dropped.
const MAX_TOKENS_PER_DEVICE = 8;

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
    summary: "Register the iPhone app's Live Activity push token for this device (replaces the last one of that kind and activity; a device keeps its 8 newest)",
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: TokenSchema } } } },
    responses: {
      200: { description: 'ok; `push` reports native delivery readiness for this token; not confirmation of device delivery', content: { 'application/json': { schema: NativePushStatusSchema } } },
      400: { description: 'invalid, or not a device key', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const body = c.req.valid('json');
    if ((body.kind === 'update') !== !!body.activity) return c.json({ error: 'an update token needs its activity; a start token has none' }, 400);
    const d = await device(c);
    if (!d) return c.json({ error: 'register from a device key' }, 400);
    const token = body.token.toLowerCase();
    const kind = body.kind === 'start' ? 'liveactivity-start' : 'liveactivity-update';
    const gatewayExpiry = body.gateway ? await verifyGateway(c.env, body.gateway.credential, token, kind) : null;
    if (body.gateway && !gatewayExpiry) return c.json({ error: 'Push gateway registration could not be verified' }, 400);
    const existing = await c.env.DB.prepare('SELECT id,gateway_token_hash,gateway_credential,gateway_expires_at FROM live_activity_tokens WHERE device=? AND kind=? AND activity=?')
      .bind(d.device, body.kind, body.activity ?? '').first<{ id: string; gateway_token_hash: string | null; gateway_credential: string | null; gateway_expires_at: number | null }>();
    const id = existing?.id ?? crypto.randomUUID();
    const fingerprint = await sha256Hex(token);
    const keepGateway = body.gateway === undefined && existing?.gateway_token_hash === fingerprint;
    const gatewayCredential = body.gateway ? await encrypt(c.env, body.gateway.credential, gatewayAad(id)) : keepGateway ? existing.gateway_credential : null;
    const gatewayExpiresAt = body.gateway ? gatewayExpiry : keepGateway ? existing.gateway_expires_at : null;
    await c.env.DB.prepare(
      'INSERT INTO live_activity_tokens (id, device, api_key_id, oauth_grant_id, kind, activity, token, ends_at, created_at,gateway_credential,gateway_expires_at,gateway_token_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?) ' +
        'ON CONFLICT(device, kind, activity) DO UPDATE SET id = excluded.id, token = excluded.token, ends_at = excluded.ends_at, created_at = excluded.created_at,gateway_credential=excluded.gateway_credential,gateway_expires_at=excluded.gateway_expires_at,gateway_token_hash=excluded.gateway_token_hash',
    )
      .bind(id, d.device, d.keyId, d.grantId, body.kind, body.activity ?? '', await seal(c.env, token, aad(id)), body.endsAt ?? null, new Date().toISOString(), gatewayCredential, gatewayExpiresAt, gatewayCredential ? fingerprint : null)
      .run();
    await c.env.DB.prepare('DELETE FROM live_activity_tokens WHERE device = ? AND id NOT IN (SELECT id FROM live_activity_tokens WHERE device = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)')
      .bind(d.device, d.device, MAX_TOKENS_PER_DEVICE)
      .run();
    return c.json(await nativePushStatus(c.env, token, kind), 200);
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
