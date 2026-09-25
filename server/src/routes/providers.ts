// UI configuration of Google/Microsoft OAuth credentials + PUBLIC_URL (SPEC "Config (OAuth)").
// Admin-only: not in auth.ts's DISPLAY_ALLOWED list, so a display key gets 403 automatically.
// Household values win over env vars when present (see providers/config.ts's providerEnv), but a
// provider the env configures and the household hasn't is read-only here ("Provided by your
// host"). These routes never return a secret once saved.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import {
  clearStoredProvider,
  effectivePublicUrl,
  providerSource,
  readStoredProvider,
  redirectUri,
  setStoredPublicUrl,
  writeStoredProvider,
  type ProviderKind,
} from '../providers/config.ts';
import { ErrorSchema, ProviderInputSchema, ProvidersSchema, PublicUrlInputSchema, PublicUrlResultSchema } from '../schemas.ts';

export const providersRoutes = createRouter();

const KindSchema = z.enum(['google', 'microsoft']);

const GOOGLE_CLIENT_ID_RE = /\.apps\.googleusercontent\.com$/;
const GUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function validateClientId(kind: ProviderKind, clientId: string): string | null {
  if (kind === 'google' && !GOOGLE_CLIENT_ID_RE.test(clientId)) return 'Google client ID should end with .apps.googleusercontent.com';
  if (kind === 'microsoft' && !GUID_RE.test(clientId)) return 'Microsoft client ID should be a GUID (Application (client) ID)';
  return null;
}

function validateTenant(tenant: string): string | null {
  if (['common', 'organizations', 'consumers'].includes(tenant)) return null;
  if (GUID_RE.test(tenant) || DOMAIN_RE.test(tenant)) return null;
  return "tenant should be 'common', 'organizations', 'consumers', a GUID, or a domain";
}

async function statusFor(c: Context<{ Bindings: Env }>, kind: ProviderKind) {
  const source = await providerSource(c.env, c.env.DB, kind);
  const stored = await readStoredProvider(c.env, c.env.DB, kind);
  const clientId = source === 'env' ? (kind === 'google' ? c.env.GOOGLE_CLIENT_ID : c.env.MS_CLIENT_ID) : stored.clientId;
  const tenant = kind === 'microsoft' ? (source === 'env' ? c.env.MS_TENANT || 'common' : stored.tenant || 'common') : undefined;
  const secretSet = source === 'env' ? !!(kind === 'google' ? c.env.GOOGLE_CLIENT_SECRET : c.env.MS_CLIENT_SECRET) : !!stored.clientSecret;
  return { configured: source !== null, source, clientId, tenant, secretSet };
}

providersRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/providers',
    tags: ['Providers'],
    summary: 'OAuth provider configuration status (admin only; never returns secrets)',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: ProvidersSchema } } } },
  }),
  async (c) => {
    const publicUrl = await effectivePublicUrl(c.env, c.env.DB);
    const [google, microsoft] = await Promise.all([statusFor(c, 'google'), statusFor(c, 'microsoft')]);
    return c.json(
      {
        publicUrl,
        redirectUris: { google: redirectUri(publicUrl.value, 'google'), microsoft: redirectUri(publicUrl.value, 'microsoft') },
        google,
        microsoft,
      },
      200,
    );
  },
);

function publicUrlWarning(value: string): string | undefined {
  const url = new URL(value);
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname) || url.hostname === '[::1]' || (url.hostname.includes(':') && url.hostname !== 'localhost');
  if (isIp) return 'This looks like a bare IP address — Google rejects IP redirect URIs. Use a hostname instead.';
  if (url.protocol === 'http:' && url.hostname !== 'localhost') return 'This URL uses plain http — most OAuth providers require https except for localhost.';
  return undefined;
}

// Registered before /{kind} below: both are single-segment PUTs under /api/providers, and a
// literal path must be matched before the param route or "public-url" would be swallowed as
// kind="public-url" and fail KindSchema with a confusing 400.
providersRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/providers/public-url',
    tags: ['Providers'],
    summary: 'Set the public URL used for OAuth redirect URIs and passkey rpID',
    security: [{ Bearer: [] }],
    request: { body: { content: { 'application/json': { schema: PublicUrlInputSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: PublicUrlResultSchema } } },
      400: { description: 'invalid', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: 'PUBLIC_URL set via env (read-only)', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    if (c.env.PUBLIC_URL) return c.json({ error: 'PUBLIC_URL is set via environment variable (read-only)' }, 409);
    const { value } = c.req.valid('json');
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      return c.json({ error: 'must be an absolute http(s) URL' }, 400);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return c.json({ error: 'must be an absolute http(s) URL' }, 400);
    const clean = url.origin + url.pathname.replace(/\/+$/, '');
    await setStoredPublicUrl(c.env.DB, clean);
    emit(c, 'settings.changed', { publicUrl: true });
    return c.json({ value: clean, warning: publicUrlWarning(clean) }, 200);
  },
);

providersRoutes.openapi(
  createRoute({
    method: 'put',
    path: '/api/providers/{kind}',
    tags: ['Providers'],
    summary: 'Configure a provider (client ID + secret). Omit clientSecret to keep the existing one.',
    security: [{ Bearer: [] }],
    request: { params: z.object({ kind: KindSchema }), body: { content: { 'application/json': { schema: ProviderInputSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: ProvidersSchema.shape.google } } },
      400: { description: 'invalid', content: { 'application/json': { schema: ErrorSchema } } },
      409: { description: 'configured via env (read-only)', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { kind } = c.req.valid('param');
    const { clientId, clientSecret, tenant } = c.req.valid('json');
    if ((await providerSource(c.env, c.env.DB, kind)) === 'env') return c.json({ error: `${kind} is configured via environment variables (read-only)` }, 409);

    const idError = validateClientId(kind, clientId);
    if (idError) return c.json({ error: idError }, 400);
    if (kind === 'microsoft' && tenant) {
      const tenantError = validateTenant(tenant);
      if (tenantError) return c.json({ error: tenantError }, 400);
    }
    if (!clientSecret) {
      const existing = await readStoredProvider(c.env, c.env.DB, kind);
      if (!existing.clientSecret) return c.json({ error: 'clientSecret is required the first time a provider is configured' }, 400);
    }

    await writeStoredProvider(c.env, c.env.DB, kind, { clientId, clientSecret, tenant });
    emit(c, 'settings.changed', { provider: kind });
    return c.json(await statusFor(c, kind), 200);
  },
);

providersRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/providers/{kind}',
    tags: ['Providers'],
    summary: 'Clear a provider’s UI-configured credentials',
    security: [{ Bearer: [] }],
    request: { params: z.object({ kind: KindSchema }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      409: { description: 'configured via env (read-only)', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { kind } = c.req.valid('param');
    if ((await providerSource(c.env, c.env.DB, kind)) === 'env') return c.json({ error: `${kind} is configured via environment variables (read-only)` }, 409);
    await clearStoredProvider(c.env.DB, kind);
    emit(c, 'settings.changed', { provider: kind });
    return c.json({ ok: true }, 200);
  },
);
