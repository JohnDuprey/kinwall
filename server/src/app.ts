import { swaggerUI } from '@hono/swagger-ui';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import type { MiddlewareHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { EncryptionKeyMissingError } from './crypto.ts';
import { GENERIC_ERROR } from './redact.ts';
import { createRouter } from './router.ts';
import { carryRequestKey, requireAuth } from './auth.ts';
import { healthRoutes } from './routes/health.ts';
import { meRoutes } from './routes/me.ts';
import { settingsRoutes } from './routes/settings.ts';
import { quietPinRoutes } from './routes/quiet-pin.ts';
import { appearanceRoutes } from './routes/appearance.ts';
import { membersRoutes } from './routes/members.ts';
import { accountsRoutes } from './routes/accounts.ts';
import { oauthRoutes } from './routes/oauth.ts';
import { providersRoutes } from './routes/providers.ts';
import { calendarsRoutes } from './routes/calendars.ts';
import { categoriesRoutes } from './routes/categories.ts';
import { eventsRoutes } from './routes/events.ts';
import { choresRoutes } from './routes/chores.ts';
import { choreLibraryRoutes } from './routes/chore-library.ts';
import { mealsRoutes } from './routes/meals.ts';
import { restaurantRoutes } from './routes/restaurants.ts';
import { recipeShareRoutes } from './routes/recipe-share.ts';
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
import { nightScreenRoutes } from './routes/night-screen.ts';
import { dataRoutes } from './routes/data.ts';
import { notesRoutes } from './routes/notes.ts';
import { contactsRoutes } from './routes/contacts.ts';
import { stickersRoutes } from './routes/stickers.ts';
import { memberStatsRoutes } from './routes/member-stats.ts';
import { checkInRoutes } from './routes/check-in.ts';
import { tempCheckRoutes } from './routes/temp-check.ts';
import { journalRoutes } from './routes/journal.ts';
import { insightsRoutes } from './routes/insights.ts';
import { medicationsRoutes } from './routes/medications.ts';
import { medicationRefillRoutes } from './routes/medication-refills.ts';
import { rewardsRoutes } from './routes/rewards.ts';
import { bonusPointsRoutes } from './routes/bonus-points.ts';
import { photosRoutes, MAX_ZIP_BYTES as MAX_PHOTO_ZIP_BYTES } from './routes/photos.ts';
import { googlePhotosRoutes } from './routes/google-photos.ts';
import { snapshotRoutes } from './routes/snapshot.ts';
import { weatherRoutes } from './routes/weather.ts';
import { booksRoutes } from './routes/books.ts';
import { libraryRoutes } from './routes/library.ts';
import { tidbitRoutes } from './routes/tidbits.ts';
import { trackersRoutes } from './routes/trackers.ts';
import { pluginsRoutes, servePluginFile, PLUGIN_LIMITS } from './routes/plugins.ts';
import { liveActivitiesRoutes } from './routes/live-activities.ts';
import { securityEventsRoutes } from './routes/security-events.ts';
import { newscastRoutes } from './routes/newscast.ts';
import { pollsRoutes } from './routes/polls.ts';
import { mediaRoutes } from './routes/media.ts';
import { shareRoutes } from './routes/share.ts';
import { handleMcp } from './mcp.ts';

// Keep in sync with web/public/_headers (Workers serves the UI with that file; Node/Docker with this).
// frame-src 'self': an activity's sandboxed frame can't navigate to another site (web/src/pluginFrame.ts);
// spelled out so loosening default-src never loosens it. blob: = Paint drawings; Met + Picsum = the quiet-hours screensaver (per display, off by default).
// script-src hashes: the inline loader scripts @vitejs/plugin-legacy adds to index.html for old
// Safari; web/vite.config.ts fails the build (printing the new list) if they ever change.
export const CSP_DEFAULT =
  "default-src 'self'; script-src 'self' 'sha256-hVuWKiiLwHwswXAaru00Ouusz3CAwXF9FKoMwru+9ts=' 'sha256-+5XkZFazzJo8n0iOP4ti/cLCMUudTf//Mzkb7xNPXIc=' 'sha256-MS6/3FCg4WjP9gwgaBGwLpRCY6fZBgwmhVCdrPrNf3E=' 'sha256-tQjf8gvb2ROOMapIxFvFAYBeUJ0v1HCbOcSmDNXGtDo='; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://images.metmuseum.org https://picsum.photos https://fastly.picsum.photos; connect-src 'self' https://collectionapi.metmuseum.org; frame-src 'self'; frame-ancestors 'self'";
// /docs (Swagger UI) loads its JS/CSS from a CDN - loosen only for that path, and only for that
// host: the page shares an origin with the web app, which keeps its key in localStorage.
const CSP_DOCS =
  "default-src 'self'; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'self'";
// The exact swagger-ui-dist release /docs loads. Without a version the CDN serves whatever is
// newest; bump this by hand after reading the release notes.
const SWAGGER_UI_VERSION = '5.33.1';

// Request bodies: 2 MB by default (the biggest JSON the schemas allow is a recipe import, about 1.2 MB),
// with the few uploads that are bigger given their own. Over the limit is a 413 { error } - with no
// Content-Length (chunked) hono reads the stream and stops at the limit, on Node and Workers alike.
const limit = (maxSize: number) => bodyLimit({ maxSize, onError: (c) => c.json({ error: `Request body is larger than ${Math.ceil(maxSize / 1048576)} MB` }, 413) });
const defaultLimit = limit(2 * 1024 * 1024);
const photoZipLimit = limit(MAX_PHOTO_ZIP_BYTES);
const pluginZipLimit = limit(PLUGIN_LIMITS.maxZipBytes);
const bodyLimits: MiddlewareHandler = (c, next) => {
  if (c.req.path === '/api/import') return next(); // sets its own (10 MB, routes/data.ts)
  const check = c.req.path === '/api/photos/import' ? photoZipLimit : c.req.path === '/api/plugins' && c.req.method === 'POST' ? pluginZipLimit : defaultLimit;
  const asked = c.req.raw;
  return check(c, () => {
    if (c.req.raw !== asked) { carryRequestKey(asked, c.req.raw); c.env.SAME_REQUEST?.(asked, c.req.raw); }
    return next();
  });
};

export function createApp() {
  const app = createRouter();

  // Safety net for anything thrown rather than returned as a c.json(...) error - SPEC says
  // every error is `{ error: string }`, never a stack trace or framework-shaped object.
  // Deliberate HTTPExceptions (and a body that isn't JSON) keep their status and words; anything else
  // is a calm fixed message plus a short ref the family can quote. The real error goes to the log,
  // with that ref, never to the client (it can hold table names, SQL or library text).
  app.onError((err, c) => {
    if (err instanceof HTTPException && err.status < 500) return c.json({ error: err.message }, err.status);
    if (err instanceof SyntaxError && c.req.method !== 'GET' && c.req.method !== 'HEAD') return c.json({ error: "That request isn't valid JSON" }, 400);
    if (err instanceof EncryptionKeyMissingError) { console.error(err); return c.json({ error: err.message }, 500); } // setup guidance for the parent, no internals
    const ref = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    console.error(`[${ref}] ${c.req.method} ${c.req.path}`, err);
    return c.json({ error: GENERIC_ERROR, ref }, 500);
  });

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    if (c.req.path.startsWith('/plugins/')) return; // plugin files carry their own, stricter policy (routes/plugins.ts)
    if (c.req.path.startsWith('/r/')) return; // shared recipe pages set their own, stricter one (routes/recipe-share.ts)
    if (/^\/api\/oauth\/[^/]+\/callback$/.test(c.req.path)) return; // its hand-back page sets its own, stricter one (routes/oauth.ts)
    const isDocs = c.req.path === '/docs' || c.req.path.startsWith('/docs/') || c.req.path === '/openapi.json';
    c.header('Content-Security-Policy', isDocs ? CSP_DOCS : CSP_DEFAULT);
  });

  app.use('/api/*', async (c, next) => {
    const origins = c.env.CORS_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean);
    if (!origins || origins.length === 0) return next();
    return cors({ origin: origins })(c, next);
  });

  app.use('/api/*', requireAuth);
  app.use('/api/*', bodyLimits); // after auth: nobody unauthenticated gets a big upload buffered
  app.use('/mcp', defaultLimit);
  app.use('/oauth/*', defaultLimit);

  app.route('/', healthRoutes);
  app.route('/', setupRoutes);
  app.route('/', meRoutes);
  app.route('/', mediaRoutes);
  app.route('/', securityEventsRoutes);
  app.route('/', revRoutes);
  app.route('/', nightScreenRoutes);
  app.route('/', settingsRoutes);
  app.route('/', quietPinRoutes);
  app.route('/', appearanceRoutes);
  app.route('/', membersRoutes);
  app.route('/', accountsRoutes);
  app.route('/', oauthRoutes);
  app.route('/', providersRoutes);
  app.route('/', calendarsRoutes);
  app.route('/', categoriesRoutes);
  app.route('/', eventsRoutes);
  app.route('/', choresRoutes);
  app.route('/', choreLibraryRoutes);
  app.route('/', recipeShareRoutes); // before mealsRoutes; /r/* is public (the token is the credential)
  app.route('/', mealsRoutes);
  app.route('/', restaurantRoutes);
  app.route('/', leaderboardRoutes);
  app.route('/', listsRoutes);
  app.route('/', notesRoutes);
  app.route('/', contactsRoutes);
  app.route('/', stickersRoutes);
  app.route('/', memberStatsRoutes);
  app.route('/', checkInRoutes);
  app.route('/', tempCheckRoutes);
  app.route('/', journalRoutes);
  app.route('/', insightsRoutes);
  app.route('/', medicationsRoutes);
  app.route('/', medicationRefillRoutes);
  app.route('/', rewardsRoutes);
  app.route('/', bonusPointsRoutes);
  app.route('/', photosRoutes);
  app.route('/', googlePhotosRoutes);
  app.route('/', snapshotRoutes);
  app.route('/', weatherRoutes);
  app.route('/', booksRoutes);
  app.route('/', libraryRoutes);
  app.route('/', tidbitRoutes);
  app.route('/', trackersRoutes);
  app.route('/', newscastRoutes);
  app.route('/', pollsRoutes);
  app.route('/', pluginsRoutes);
  app.get('/plugins/*', servePluginFile); // public: a sandboxed iframe can't send a key
  app.route('/', keysRoutes);
  app.route('/', passkeysRoutes);
  app.route('/', recoveryRoutes);
  app.route('/', pairRoutes);
  app.route('/', webhooksRoutes);
  app.route('/', liveActivitiesRoutes);
  app.route('/', pushRoutes);
  app.route('/', dataRoutes);
  app.route('/', shareRoutes(app)); // the "Add to Kinwall" Shortcut; adds books through POST /api/library

  // MCP endpoint: stateless Streamable HTTP (see src/mcp.ts). Not under /api/* - it does its
  // own auth (same bearer keys) and every tool re-enters the REST routes via app.request().
  app.all('/mcp', (c) => handleMcp(c, app));
  // OAuth for /mcp: /.well-known + /oauth/* are public; /api/authorizations* go through requireAuth.
  app.route('/', mcpOAuthRoutes);

  app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
    type: 'http',
    scheme: 'bearer',
    description:
      "API key, e.g. kw_xxxxx. An <img src> can't send a header: the image routes (GET /api/photos/{id}/image, /api/recipes/{id}/image, /api/recipes/{id}/steps/{n}/image, /api/meals/{id}/image, /api/trackers/{id}/cover, /api/books/covers/{coverId}) take ?key= with a media token from GET /api/media-token, and GET /api/photos/export.zip takes ?ticket= from POST /api/photos/export-link. A key is never accepted in a URL.",
  });

  app.doc('/openapi.json', {
    openapi: '3.0.0',
    info: { title: 'Kinwall API', version: '1' }, // API contract version, not the build (docs are public)
  });

  app.get('/docs', swaggerUI({ url: '/openapi.json', version: SWAGGER_UI_VERSION, validatorUrl: 'none' })); // no badge from swagger.io's validator

  return app;
}
