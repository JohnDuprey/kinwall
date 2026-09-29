// Google Photos for the Night screen and the Board's picture, through Google's Ambient API
// (developers.google.com/photos/ambient). Family level, one row in google_photos (migration 0061),
// apart from calendar accounts so either disconnects alone.
//
// Connect, asking for the Photos scope alone (a consent separate from Calendar), one of two ways:
// - The web sign-in (the default): the family's Google Calendar web client, its redirect URI and
//   its callback (routes/oauth.ts, state purpose 'photos'). The callback stores the tokens here and
//   creates the family's Ambient device. Google's docs describe only the device sign-in for this
//   API, so Google may refuse the scope or the device for a web client: that's state 'refused'.
// - The device sign-in, when GOOGLE_PHOTOS_CLIENT_ID / _SECRET (a "TVs and Limited Input devices"
//   client) are set: the parent enters a code at google.com/device; the sheet's status checks poll
//   for the token, then create the device under the requestId the sign-in carried, so Google's last
//   sign-in page opens its album picker (settingsUri).
// Tokens refresh with the client that made them (flow). Status checks then poll the device, at
// Google's pollInterval, until albums are picked.
//
// Photos: the list of picked photos is kept as ids and a little metadata, fetched again after 50
// minutes (Google's photo links last 60). Photo bytes need the bearer token, so GET .../next passes
// them through without storing them. No webhooks or MCP: nothing here is family data to act on.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { emit } from '../bus.ts';
import { requestKey } from '../auth.ts';
import { checkRate } from '../ratelimit.ts';
import { decryptConfig, encryptConfig } from '../crypto.ts';
import { ErrorSchema } from '../schemas.ts';
import { providerEnv } from '../providers/config.ts';
import { googlePhotosAuthUrl } from './oauth.ts';

type Ctx = Context<{ Bindings: Env }>;

const SCOPE = 'https://www.googleapis.com/auth/photosambient.mediaitems';
const DEVICE_CODE_URL = 'https://oauth2.googleapis.com/device/code';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke';
const AMBIENT = 'https://photosambient.googleapis.com/v1';
const AAD = 'google-photos'; // the sealed config's associated data
const LIST_EVERY_MS = 50 * 60_000;
// ponytail: 500 photos per refresh (Google allows 240 list calls a device a day, and a refresh
// runs at most hourly); walk the pages across refreshes if families pick bigger albums.
const MAX_PAGES = 5;
const NEXT_PER_HOUR = 300; // a Board changes its picture every minute; room for retries

type Flow = 'device' | 'web';
type Row = {
  flow: Flow;
  auth_url: string | null;
  config: string;
  request_id: string;
  user_code: string | null;
  verification_url: string | null;
  code_expires_at: string | null;
  device_id: string | null;
  settings_uri: string | null;
  sources_set: number;
  poll_seconds: number;
  next_poll_at: string | null;
  items_at: string | null;
  problem: string | null;
};
type Tokens = { access_token: string; refresh_token: string; expires_at: number };
type Device = { id: string; settingsUri?: string; mediaSourcesSet?: boolean; pollingConfig?: { pollInterval?: string } };
export type GooglePhotosState = 'off' | 'signing-in' | 'choosing' | 'ready' | 'reconnect' | 'refused';
const WEB_SIGN_IN_MS = 10 * 60_000; // routes/oauth.ts keeps a sign-in's state this long

/** Google refused (401, a revoked refresh token, the device deleted in Google Photos): reconnect. */
class Reconnect extends Error {}
/** Any other Google error; the message carries only the status, never a body or a token. */
class GoogleError extends Error {
  status: number;
  constructor(what: string, status: number) {
    super(`Google Photos ${what} failed (HTTP ${status})`);
    this.status = status;
  }
}

type Client = { flow: Flow; id: string; secret: string };
/** The client for a flow: the TV client from its env vars, or Calendar's web client (the one set in
 * Settings → Calendars, else GOOGLE_CLIENT_ID / _SECRET). */
async function clientFor(c: Ctx, flow: Flow): Promise<Client | null> {
  if (flow === 'device') {
    const { GOOGLE_PHOTOS_CLIENT_ID: id, GOOGLE_PHOTOS_CLIENT_SECRET: secret } = c.env;
    return id && secret ? { flow, id, secret } : null;
  }
  const penv = await providerEnv(c.env, c.env.DB);
  return penv.GOOGLE_CLIENT_ID && penv.GOOGLE_CLIENT_SECRET ? { flow, id: penv.GOOGLE_CLIENT_ID, secret: penv.GOOGLE_CLIENT_SECRET } : null;
}
/** How a new connection signs in: the TV client when it's set, else Calendar's web client. */
async function newClient(c: Ctx): Promise<Client | null> {
  return (await clientFor(c, 'device')) ?? clientFor(c, 'web');
}

export function stateOf(row: Pick<Row, 'problem' | 'device_id' | 'sources_set'> | null | undefined): GooglePhotosState {
  if (!row) return 'off';
  if (row.problem === 'reconnect' || row.problem === 'refused') return row.problem;
  if (!row.device_id) return 'signing-in';
  return row.sources_set ? 'ready' : 'choosing';
}

/** stateOf in SQL, for GET /api/settings (its one query also reads the row; walls need the state). */
export const GOOGLE_PHOTOS_STATE_SQL =
  "CASE WHEN problem IN ('reconnect', 'refused') THEN problem WHEN device_id IS NULL THEN 'signing-in' WHEN sources_set = 1 THEN 'ready' ELSE 'choosing' END";

const load = (c: Ctx) => c.env.DB.prepare('SELECT * FROM google_photos').first<Row>();
const nowIso = () => new Date().toISOString();
const later = (seconds: number) => new Date(Date.now() + seconds * 1000).toISOString();
const form = (body: Record<string, string>) => ({ method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body).toString() });

/** "7.5s" (a protobuf Duration) as whole seconds, within reason. */
function pollSeconds(d: Device, fallback: number): number {
  const s = Number.parseFloat(d.pollingConfig?.pollInterval ?? '');
  return Number.isFinite(s) ? Math.min(3600, Math.max(2, Math.ceil(s))) : fallback;
}

async function update(c: Ctx, fields: Partial<Row>): Promise<void> {
  const keys = Object.keys(fields);
  await c.env.DB.prepare(`UPDATE google_photos SET ${keys.map((k) => `${k} = ?`).join(', ')}`).bind(...keys.map((k) => fields[k as keyof Row] ?? null)).run();
}

async function clear(c: Ctx): Promise<void> {
  await c.env.DB.batch([c.env.DB.prepare('DELETE FROM google_photos'), c.env.DB.prepare('DELETE FROM google_photo_items')]);
}

async function markReconnect(c: Ctx): Promise<void> {
  await c.env.DB.batch([c.env.DB.prepare("UPDATE google_photos SET problem = 'reconnect'"), c.env.DB.prepare('DELETE FROM google_photo_items')]);
  emit(c, 'settings.changed', {});
}

/** A current access token, refreshed (and saved, sealed) when it's about to run out. */
async function accessToken(c: Ctx, row: Row): Promise<string> {
  const tokens = (await decryptConfig(c.env, AAD, row.config)) as Tokens;
  if (tokens.expires_at - 60_000 > Date.now()) return tokens.access_token;
  const app = await clientFor(c, row.flow);
  if (!app || !tokens.refresh_token) throw new Reconnect();
  const res = await fetch(TOKEN_URL, form({ client_id: app.id, client_secret: app.secret, refresh_token: tokens.refresh_token, grant_type: 'refresh_token' }));
  if (res.status === 400 || res.status === 401) throw new Reconnect();
  if (!res.ok) throw new GoogleError('sign-in refresh', res.status);
  const tok = (await res.json()) as { access_token: string; expires_in: number };
  const next: Tokens = { access_token: tok.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + tok.expires_in * 1000 };
  const sealed = await encryptConfig(c.env, AAD, next);
  row.config = sealed;
  await update(c, { config: sealed });
  return next.access_token;
}

async function ambient<T>(c: Ctx, row: Row, path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${AMBIENT}${path}`, {
    ...init,
    headers: { ...init.headers, authorization: `Bearer ${token ?? (await accessToken(c, row))}`, 'content-type': 'application/json' },
  });
  if (res.status === 401 || res.status === 404) throw new Reconnect(); // 404: the device was removed in Google Photos
  if (!res.ok) throw new GoogleError(path.split('?')[0].split('/')[1] ?? 'request', res.status);
  return (await res.json()) as T;
}

/** One step of connecting, when it's due: poll for the sign-in, or for the album choice. */
async function advance(c: Ctx, row: Row): Promise<void> {
  if (row.problem || (row.device_id && row.sources_set) || (row.next_poll_at && row.next_poll_at > nowIso())) return;
  if (!row.device_id && row.code_expires_at && row.code_expires_at < nowIso()) return clear(c); // the sign-in ran out: start again
  const app = await clientFor(c, row.flow);
  if (!app || (row.flow === 'web' && !row.device_id)) return; // the web sign-in finishes in its callback
  if (!row.device_id) {
    const { device_code } = (await decryptConfig(c.env, AAD, row.config)) as { device_code: string };
    const res = await fetch(TOKEN_URL, form({ client_id: app.id, client_secret: app.secret, device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }));
    const body = (await res.json().catch(() => ({}))) as { error?: string; access_token?: string; refresh_token?: string; expires_in?: number };
    if (!res.ok || !body.access_token) {
      if (body.error === 'authorization_pending') return update(c, { next_poll_at: later(row.poll_seconds) });
      if (body.error === 'slow_down') return update(c, { poll_seconds: row.poll_seconds + 5, next_poll_at: later(row.poll_seconds + 5) });
      return clear(c); // access_denied, expired_token: the parent can try again
    }
    const tokens: Tokens = { access_token: body.access_token, refresh_token: body.refresh_token ?? '', expires_at: Date.now() + (body.expires_in ?? 3600) * 1000 };
    const sealed = await encryptConfig(c.env, AAD, tokens);
    await update(c, { config: sealed, user_code: null, verification_url: null, code_expires_at: null });
    row.config = sealed;
    await createDevice(c, row, tokens.access_token);
  } else {
    const device = await ambient<Device>(c, row, `/devices/${encodeURIComponent(row.device_id)}`);
    const poll = pollSeconds(device, row.poll_seconds);
    await update(c, { settings_uri: device.settingsUri ?? row.settings_uri, sources_set: device.mediaSourcesSet ? 1 : 0, poll_seconds: poll, next_poll_at: later(poll) });
  }
  if (stateOf(await load(c)) === 'ready') emit(c, 'settings.changed', {});
}

/** The family's Ambient device, under the sign-in's requestId. */
async function createDevice(c: Ctx, row: Row, token: string): Promise<void> {
  const device = await ambient<Device>(c, row, `/devices?requestId=${row.request_id}`, { method: 'POST', body: JSON.stringify({ displayName: await deviceName(c) }) }, token);
  const poll = pollSeconds(device, row.poll_seconds);
  await update(c, { device_id: device.id, settings_uri: device.settingsUri ?? null, sources_set: device.mediaSourcesSet ? 1 : 0, poll_seconds: poll, next_poll_at: later(poll) });
}

// Google turning the Photos scope or the Ambient device down for this client (the web client).
const REFUSALS = ['invalid_scope', 'unauthorized_client', 'restricted_client', 'admin_policy_enforced', 'org_internal'];

/** The web sign-in's return (routes/oauth.ts callback): store the tokens, create the device.
 * 'connected', 'canceled' (declined), 'refused' (Google won't allow Photos with this client) or
 * 'failed'. Never a calendar account. */
export async function finishGooglePhotosWeb(c: Ctx, p: { code?: string; error?: string; redirectUri: string; verifier: string }): Promise<'connected' | 'canceled' | 'refused' | 'failed'> {
  const row = await load(c);
  if (!row || row.flow !== 'web' || row.device_id) return 'failed';
  const refuse = async () => {
    await update(c, { problem: 'refused', auth_url: null });
    emit(c, 'settings.changed', {});
    return 'refused' as const;
  };
  if (p.error) {
    if (p.error === 'access_denied' || p.error === 'consent_required') return clear(c).then(() => 'canceled' as const);
    return refuse();
  }
  const app = await clientFor(c, 'web');
  if (!app || !p.code) return clear(c).then(() => 'failed' as const);
  try {
    const res = await fetch(TOKEN_URL, form({ client_id: app.id, client_secret: app.secret, code: p.code, redirect_uri: p.redirectUri, grant_type: 'authorization_code', code_verifier: p.verifier }));
    const body = (await res.json().catch(() => ({}))) as { error?: string; access_token?: string; refresh_token?: string; expires_in?: number };
    if (!res.ok || !body.access_token) {
      if (REFUSALS.includes(body.error ?? '')) return refuse();
      throw new GoogleError('sign-in', res.status);
    }
    const tokens: Tokens = { access_token: body.access_token, refresh_token: body.refresh_token ?? '', expires_at: Date.now() + (body.expires_in ?? 3600) * 1000 };
    const sealed = await encryptConfig(c.env, AAD, tokens);
    await update(c, { config: sealed, auth_url: null, code_expires_at: null });
    row.config = sealed;
    await createDevice(c, row, tokens.access_token);
  } catch (err) {
    // 403 on the device: the Ambient API isn't open to this client or project.
    if (err instanceof GoogleError && err.status === 403) return refuse();
    await logFailure(err);
    await clear(c);
    return 'failed';
  }
  emit(c, 'settings.changed', {});
  return 'connected';
}

async function deviceName(c: Ctx): Promise<string> {
  const row = await c.env.DB.prepare("SELECT value FROM settings WHERE key = 'familyName'").first<{ value: string }>();
  return `${row?.value?.trim() || 'Our Family'} Kinwall`.slice(0, 100);
}

type Item = { id: string; createTime?: string; mediaFile?: { baseUrl?: string; mimeType?: string; mediaFileMetadata?: { width?: number; height?: number } } };

/** Fetches the picked photos again (ids, dates, sizes, and Google's hour-long links) once the list
 * is 50 minutes old. The lease on items_at keeps two walls from both doing it. */
async function refreshItems(c: Ctx, row: Row): Promise<void> {
  const cutoff = new Date(Date.now() - LIST_EVERY_MS).toISOString();
  const lease = await c.env.DB.prepare('UPDATE google_photos SET items_at = ? WHERE items_at IS NULL OR items_at < ?').bind(nowIso(), cutoff).run();
  if (!lease.meta.changes) return;
  try {
    const items: Item[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const q = new URLSearchParams({ deviceId: row.device_id!, pageSize: '100', ...(pageToken ? { pageToken } : {}) });
      const data = await ambient<{ mediaItems?: Item[]; nextPageToken?: string }>(c, row, `/mediaItems?${q}`);
      items.push(...(data.mediaItems ?? []));
      pageToken = data.nextPageToken;
      if (!pageToken) break;
    }
    const photos = items.filter((i) => i.id && i.mediaFile?.baseUrl && (i.mediaFile.mimeType ?? 'image/').startsWith('image/'));
    const db = c.env.DB;
    await db.batch([
      // Keep shown_at for photos still picked, so the shuffled pass carries on.
      db.prepare('DELETE FROM google_photo_items WHERE id NOT IN (SELECT value FROM json_each(?))').bind(JSON.stringify(photos.map((p) => p.id))),
      ...photos.map((p) =>
        db
          .prepare('INSERT INTO google_photo_items (id, created, width, height, base_url) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET created = excluded.created, width = excluded.width, height = excluded.height, base_url = excluded.base_url')
          .bind(p.id, p.createTime ?? null, p.mediaFile?.mediaFileMetadata?.width ?? null, p.mediaFile?.mediaFileMetadata?.height ?? null, p.mediaFile!.baseUrl),
      ),
    ]);
  } catch (err) {
    await update(c, { items_at: null }); // try again on the next picture
    if (err instanceof GoogleError && err.status === 400) {
      // FAILED_PRECONDITION: no albums picked any more. Back to waiting for them.
      await update(c, { sources_set: 0, next_poll_at: null });
      emit(c, 'settings.changed', {});
    }
    throw err;
  }
}

const StatusSchema = z
  .object({
    available: z.boolean().describe('This server has a Google Photos client (GOOGLE_PHOTOS_CLIENT_ID / _SECRET)'),
    state: z.enum(['off', 'signing-in', 'choosing', 'ready', 'reconnect', 'refused']).describe(
      'off: not connected. signing-in: open authUrl (web) or enter userCode at verificationUrl (device). choosing: pick albums at settingsUri. ready: photos can show. ' +
        "reconnect: Google stopped sharing; connect again. refused: Google didn't allow Photos with the web client (see the TV-client option in the docs).",
    ),
    flow: z.enum(['web', 'device']).optional().describe("Parent devices only: web = Calendar's web client, device = the TV client (code at google.com/device)"),
    authUrl: z.string().optional().describe("Parent devices only, while signing in with the web client: Google's consent page, to open or show as a QR code"),
    userCode: z.string().optional().describe('Parent devices only, while signing in with the device flow'),
    verificationUrl: z.string().optional(),
    codeExpiresAt: z.string().optional(),
    settingsUri: z.string().optional().describe("Parent devices only: Google Photos' page for this family's albums"),
    photos: z.number().optional().describe('Photos in the list right now (parent devices, when ready)'),
  })
  .openapi('GooglePhotos');

async function status(c: Ctx, row: Row | null): Promise<z.infer<typeof StatusSchema>> {
  const state = stateOf(row);
  const out: z.infer<typeof StatusSchema> = { available: !!(await newClient(c)), state };
  if ((await requestKey(c))?.scope === 'display' || !row) return out;
  out.flow = row.flow;
  if (state === 'signing-in') {
    Object.assign(out, row.flow === 'web'
      ? { authUrl: row.auth_url ?? undefined, codeExpiresAt: row.code_expires_at ?? undefined }
      : { userCode: row.user_code ?? undefined, verificationUrl: row.verification_url ?? undefined, codeExpiresAt: row.code_expires_at ?? undefined });
  }
  if (row.settings_uri && (state === 'choosing' || state === 'ready')) out.settingsUri = row.settings_uri;
  if (state === 'ready') out.photos = (await c.env.DB.prepare('SELECT COUNT(*) AS n FROM google_photo_items').first<{ n: number }>())?.n ?? 0;
  return out;
}

async function logFailure(err: unknown) {
  // Messages here only ever carry an HTTP status (GoogleError); never a token or a body.
  console.warn('google photos:', err instanceof Error ? err.message : 'failed');
}

export const googlePhotosRoutes = createRouter();
const json = <T extends z.ZodTypeAny>(schema: T) => ({ 'application/json': { schema } });

googlePhotosRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/google-photos',
    tags: ['Google Photos'],
    summary: "Google Photos' state for the Night screen. While connecting, each check also polls Google (at most at its poll interval).",
    description: 'Wall screens and kids\' devices get `available` and `state` only.',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: json(StatusSchema) } },
  }),
  async (c) => {
    let row = await load(c);
    if (row) {
      try {
        await advance(c, row);
      } catch (err) {
        if (err instanceof Reconnect) await markReconnect(c);
        else await logFailure(err);
      }
      row = await load(c);
    }
    return c.json(await status(c, row), 200);
  },
);

googlePhotosRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/google-photos/connect',
    tags: ['Google Photos'],
    summary: "Start connecting Google Photos (parent devices): Google's consent link (web client) or a code to enter at google.com/device (TV client)",
    description:
      'Asks for the Ambient API scope only, separate from Google Calendar. With the web client, open `authUrl`; Google returns to /api/oauth/google/callback, ' +
      'which lands on `#/settings?googlePhotos=connected|canceled|refused|failed`. Poll GET /api/google-photos either way.',
    security: [{ Bearer: [] }],
    responses: {
      200: { description: 'signing in', content: json(StatusSchema) },
      409: { description: 'already connected', content: json(ErrorSchema) },
      429: { description: 'too many tries', content: json(ErrorSchema) },
      502: { description: 'Google refused', content: json(ErrorSchema) },
      503: { description: 'no Google Photos client on this server', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const app = await newClient(c);
    if (!app) return c.json({ error: "Google Photos isn't set up on this server" }, 503);
    const existing = await load(c);
    if (existing && ['choosing', 'ready'].includes(stateOf(existing))) return c.json({ error: 'Google Photos is already connected. Disconnect it first.' }, 409);
    if (!(await checkRate(c.env.DB, 'google-photos-connect', 20, 3600_000))) return c.json({ error: 'Too many tries. Wait a while and try again.' }, 429);
    if (existing) await disconnect(c, existing); // a stale sign-in or a revoked connection: start over

    const requestId = crypto.randomUUID();
    if (app.flow === 'web') {
      const authUrl = await googlePhotosAuthUrl(c, SCOPE);
      await c.env.DB
        .prepare("INSERT INTO google_photos (id, flow, config, request_id, auth_url, code_expires_at, created_at) VALUES (1, 'web', ?, ?, ?, ?, ?)")
        .bind(await encryptConfig(c.env, AAD, {}), requestId, authUrl, new Date(Date.now() + WEB_SIGN_IN_MS).toISOString(), nowIso())
        .run();
      return c.json(await status(c, await load(c)), 200);
    }
    // The state lets Google's last sign-in page go straight to the album picker for this device.
    const res = await fetch(DEVICE_CODE_URL, form({ client_id: app.id, scope: SCOPE, state: JSON.stringify({ requestId, displayName: await deviceName(c) }) }));
    if (!res.ok) {
      await logFailure(new GoogleError('sign-in', res.status));
      return c.json({ error: `Google didn't start the sign-in (HTTP ${res.status}). Check the Google Photos client settings.` }, 502);
    }
    const code = (await res.json()) as { device_code: string; user_code: string; verification_url?: string; verification_uri?: string; expires_in: number; interval?: number };
    await c.env.DB
      .prepare('INSERT INTO google_photos (id, config, request_id, user_code, verification_url, code_expires_at, poll_seconds, next_poll_at, created_at) VALUES (1,?,?,?,?,?,?,?,?)')
      .bind(
        await encryptConfig(c.env, AAD, { device_code: code.device_code }),
        requestId,
        code.user_code,
        code.verification_url ?? code.verification_uri ?? 'https://www.google.com/device',
        later(code.expires_in),
        code.interval ?? 5,
        later(code.interval ?? 5),
        nowIso(),
      )
      .run();
    return c.json(await status(c, await load(c)), 200);
  },
);

/** Best-effort at Google (delete the Ambient device, revoke the token), then forget everything. */
async function disconnect(c: Ctx, row: Row): Promise<void> {
  try {
    if (row.device_id && !row.problem) await ambient(c, row, `/devices/${encodeURIComponent(row.device_id)}`, { method: 'DELETE' });
  } catch (err) {
    if (!(err instanceof Reconnect)) await logFailure(err);
  }
  try {
    const cfg = (await decryptConfig(c.env, AAD, row.config)) as Partial<Tokens>;
    const token = cfg.refresh_token || cfg.access_token;
    if (token) await fetch(REVOKE_URL, form({ token }));
  } catch {
    // best-effort
  }
  await clear(c);
}

googlePhotosRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/google-photos',
    tags: ['Google Photos'],
    summary: 'Disconnect Google Photos (parent devices): removes the Ambient device, revokes the sign-in, forgets the photo list',
    description: 'Google Calendar accounts are not affected.',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: json(StatusSchema) } },
  }),
  async (c) => {
    const row = await load(c);
    if (row) {
      await disconnect(c, row);
      emit(c, 'settings.changed', {});
    }
    return c.json(await status(c, null), 200);
  },
);

const size = (fallback: number) => z.coerce.number().int().optional().transform((v) => Math.min(4096, Math.max(64, v ?? fallback)));

googlePhotosRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/google-photos/next',
    tags: ['Google Photos'],
    summary: "The next Google Photos picture, fitted within w×h pixels. Wall screens and kids' devices may call it.",
    description:
      'A shuffled pass over the picked photos. The bytes come from Google through this server and are never stored (`Cache-Control: no-store`). ' +
      '404: no photos in the picked albums. 409: not connected, albums not picked, or Google Photos needs reconnecting (see GET /api/google-photos).',
    security: [{ Bearer: [] }],
    request: { query: z.object({ w: size(1920), h: size(1080) }) },
    responses: {
      200: { description: 'the picture', content: { 'image/jpeg': { schema: z.string().openapi({ format: 'binary' }) } } },
      404: { description: 'no photos', content: json(ErrorSchema) },
      409: { description: 'not ready', content: json(ErrorSchema) },
      429: { description: 'too many requests', content: json(ErrorSchema) },
      502: { description: 'Google error', content: json(ErrorSchema) },
    },
  }),
  async (c) => {
    const { w, h } = c.req.valid('query');
    const key = await requestKey(c);
    if (!(await checkRate(c.env.DB, `google-photos:${key?.id ?? key?.name ?? 'unknown'}`, NEXT_PER_HOUR, 3600_000))) return c.json({ error: 'Too many requests' }, 429);
    const row = await load(c);
    if (!row || stateOf(row) !== 'ready') return c.json({ error: stateOf(row) === 'reconnect' ? 'Reconnect Google Photos' : 'Google Photos is not ready' }, 409);
    try {
      await refreshItems(c, row);
      const db = c.env.DB;
      // Least recently shown first (never-shown first of all), ties at random: a shuffled pass.
      const pick = await db.prepare('SELECT id, base_url FROM google_photo_items WHERE base_url IS NOT NULL ORDER BY shown_at IS NOT NULL, shown_at, random() LIMIT 1').first<{ id: string; base_url: string }>();
      if (!pick) return c.json({ error: 'No photos in the picked albums' }, 404);
      await db.prepare('UPDATE google_photo_items SET shown_at = ? WHERE id = ?').bind(nowIso(), pick.id).run();
      const res = await fetch(`${pick.base_url}=w${w}-h${h}`, { headers: { authorization: `Bearer ${await accessToken(c, row)}` } });
      if (!res.ok || !res.body) {
        await update(c, { items_at: null }); // the link ran out early: fetch the list again next time
        throw new GoogleError('photo', res.status);
      }
      return new Response(res.body, { status: 200, headers: { 'Content-Type': res.headers.get('content-type') ?? 'image/jpeg', 'Cache-Control': 'no-store' } });
    } catch (err) {
      if (err instanceof Reconnect) {
        await markReconnect(c);
        return c.json({ error: 'Reconnect Google Photos' }, 409);
      }
      if (err instanceof GoogleError && err.status === 400) return c.json({ error: 'Pick albums in Google Photos' }, 409);
      await logFailure(err);
      return c.json({ error: err instanceof GoogleError ? err.message : 'Google Photos failed' }, 502);
    }
  },
);
