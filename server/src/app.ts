import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { createRouter } from './router.ts';
import { requireAuth } from './auth.ts';
import { healthRoutes } from './routes/health.ts';
import { meRoutes } from './routes/me.ts';
import { settingsRoutes } from './routes/settings.ts';
import { appearanceRoutes } from './routes/appearance.ts';
import { membersRoutes } from './routes/members.ts';
import { accountsRoutes } from './routes/accounts.ts';
import { oauthRoutes } from './routes/oauth.ts';
import { providersRoutes } from './routes/providers.ts';
import { calendarsRoutes } from './routes/calendars.ts';
import { categoriesRoutes } from './routes/categories.ts';
import { eventsRoutes } from './routes/events.ts';
import { choresRoutes } from './routes/chores.ts';
import { leaderboardRoutes } from './routes/leaderboard.ts';
import { listsRoutes } from './routes/lists.ts';
import { keysRoutes } from './routes/keys.ts';
import { passkeysRoutes } from './routes/passkeys.ts';
import { recoveryRoutes } from './routes/recovery.ts';
import { pairRoutes } from './routes/pair.ts';
import { setupRoutes } from './routes/setup.ts';
import { webhooksRoutes } from './routes/webhooks.ts';
import { pushRoutes } from './routes/push.ts';
import { mcpOAuthRoutes } from './routes/mcp-oauth.ts';
import { revRoutes } from './routes/rev.ts';
import { dataRoutes } from './routes/data.ts';
import { notesRoutes } from './routes/notes.ts';
import { stickersRoutes } from './routes/stickers.ts';
import { photosRoutes } from './routes/photos.ts';
import { snapshotRoutes } from './routes/snapshot.ts';
import { weatherRoutes } from './routes/weather.ts';
import { tidbitRoutes } from './routes/tidbits.ts';
import { handleMcp } from './mcp.ts';

// Keep in sync with web/public/_headers (Workers serves the UI with that file; Node/Docker with this).
// blob: = Paint drawings; Met + Picsum = the quiet-hours screensaver (per display, off by default).
// script-src hashes: the inline loader scripts @vitejs/plugin-legacy adds to index.html for old
// Safari; web/vite.config.ts fails the build (printing the new list) if they ever change.
export const CSP_DEFAULT =
  "default-src 'self'; script-src 'self' 'sha256-hVuWKiiLwHwswXAaru00Ouusz3CAwXF9FKoMwru+9ts=' 'sha256-+5XkZFazzJo8n0iOP4ti/cLCMUudTf//Mzkb7xNPXIc=' 'sha256-MS6/3FCg4WjP9gwgaBGwLpRCY6fZBgwmhVCdrPrNf3E=' 'sha256-tQjf8gvb2ROOMapIxFvFAYBeUJ0v1HCbOcSmDNXGtDo='; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: blob: https://images.metmuseum.org https://picsum.photos https://fastly.picsum.photos; connect-src 'self' https://collectionapi.metmuseum.org; frame-ancestors 'self'";
// /docs (Swagger UI) loads its JS/CSS from a CDN - loosen only for that path, not globally.
const CSP_DOCS =
  "default-src 'self'; style-src 'self' 'unsafe-inline' https:; script-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' https: data:; connect-src 'self' https:; frame-ancestors 'self'";

export function createApp() {
  const app = createRouter();

  // Safety net for anything thrown rather than returned as a c.json(...) error - SPEC says
  // every error is `{ error: string }`, never a stack trace or framework-shaped object.
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: err instanceof Error ? err.message : 'internal error' }, 500);
  });

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    const isDocs = c.req.path === '/docs' || c.req.path.startsWith('/docs/') || c.req.path === '/openapi.json';
    c.header('Content-Security-Policy', isDocs ? CSP_DOCS : CSP_DEFAULT);
  });

  app.use('/api/*', async (c, next) => {
    const origins = c.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
    if (!origins || origins.length === 0) return next();
    return cors({ origin: origins })(c, next);
  });

  app.use('/api/*', requireAuth);

  app.route('/', healthRoutes);
  app.route('/', setupRoutes);
  app.route('/', meRoutes);
  app.route('/', revRoutes);
  app.route('/', settingsRoutes);
  app.route('/', appearanceRoutes);
  app.route('/', membersRoutes);
  app.route('/', accountsRoutes);
  app.route('/', oauthRoutes);
  app.route('/', providersRoutes);
  app.route('/', calendarsRoutes);
  app.route('/', categoriesRoutes);
  app.route('/', eventsRoutes);
  app.route('/', choresRoutes);
  app.route('/', leaderboardRoutes);
  app.route('/', listsRoutes);
  app.route('/', notesRoutes);
  app.route('/', stickersRoutes);
  app.route('/', photosRoutes);
  app.route('/', snapshotRoutes);
  app.route('/', weatherRoutes);
  app.route('/', tidbitRoutes);
  app.route('/', keysRoutes);
  app.route('/', passkeysRoutes);
  app.route('/', recoveryRoutes);
  app.route('/', pairRoutes);
  app.route('/', webhooksRoutes);
  app.route('/', pushRoutes);
  app.route('/', dataRoutes);

  // MCP endpoint: stateless Streamable HTTP (see src/mcp.ts). Not under /api/* - it does its
  // own auth (same bearer keys) and every tool re-enters the REST routes via app.request().
  app.all('/mcp', (c) => handleMcp(c, app));
  // OAuth for /mcp: /.well-known + /oauth/* are public; /api/authorizations* go through requireAuth.
  app.route('/', mcpOAuthRoutes);

  app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
    type: 'http',
    scheme: 'bearer',
    description: 'API key, e.g. kw_xxxxx. Also accepted as ?key= on the OAuth start route, GET /api/photos/export.zip and GET /api/photos/{id}/image (browser navigations and <img src>).',
  });

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: { title: 'Kinwall API', version: '1' }, // API contract version, not the build (docs are public)
  });

  app.get('/docs', swaggerUI({ url: '/openapi.json' }));

  return app;
}
