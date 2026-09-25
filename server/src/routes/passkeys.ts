// Passkey (WebAuthn) admin authentication. Replaces "save this admin key" with Face ID/Touch ID:
// a registered passkey logs in via /login/options+/login/verify and mints a short-lived session
// key (an api_keys row, kind='session') instead of the permanent admin key. See webauthn.ts for
// the rpID/verify seam and SPEC.md "Security" for the key-scope model.
import type { KinwallDb } from '../db.ts';
import { createRoute, z } from '@hono/zod-openapi';
import { createRouter } from '../router.ts';
import type { Env } from '../env.ts';
import { createApiKey, resolveKey } from '../auth.ts';
import { emit } from '../bus.ts';
import { errorMessage } from '../redact.ts';
import { ErrorSchema } from '../schemas.ts';
import { checkRate, clientIp } from '../ratelimit.ts';
import {
  RpIdIsIpError,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  resolveRpId,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '../webauthn.ts';

export const passkeysRoutes = createRouter();

export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REG_TOKEN_TTL_MS = 15 * 60 * 1000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const RP_NAME = 'Kinwall';
const LOGIN_MAX_ATTEMPTS = 20;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
// Single stable WebAuthn user handle: Kinwall has one admin "account", not per-person logins.
const USER_ID = new TextEncoder().encode('kinwall-admin');

// Per-IP cap on the two unauthenticated login steps (options + verify each count). Direct
// connections with no proxy header share one 'unknown' bucket rather than going unlimited.
passkeysRoutes.use('/api/passkeys/login/*', async (c, next) => {
  const ok = await checkRate(c.env.DB, `passkey-login:${clientIp(c) ?? 'unknown'}`, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);
  if (!ok) return c.json({ error: 'too many sign-in attempts — try again in a few minutes' }, 429);
  return next();
});

type PasskeyRow = { id: string; credential_id: string; public_key: string; counter: number; transports: string | null; name: string; created_at: string; last_used_at: string | null };

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function randomToken(): string {
  return bytesToBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}
// Decode the challenge WebAuthn embedded in clientDataJSON, without trusting anything else in
// it — this is only used to look up our own server-side challenge row, whose expiry and
// single-use deletion are what actually gate the ceremony.
function decodeClientDataChallenge(clientDataJSONB64url: string): string | null {
  try {
    const json = new TextDecoder().decode(base64UrlToBytes(clientDataJSONB64url));
    const parsed = JSON.parse(json) as { challenge?: string };
    return parsed.challenge ?? null;
  } catch {
    return null;
  }
}

async function storeChallenge(db: KinwallDb, kind: 'reg_challenge' | 'auth_challenge', challenge: string, data: unknown, ttlMs: number): Promise<void> {
  const now = new Date();
  await db
    .prepare('INSERT INTO webauthn_challenges (id, kind, subject, data, created_at, expires_at) VALUES (?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), kind, challenge, JSON.stringify(data ?? null), now.toISOString(), new Date(now.getTime() + ttlMs).toISOString())
    .run();
}
// Looks up + deletes in one round trip's worth of intent (single use): callers must not reuse
// the row after this returns non-null.
async function takeChallenge(db: KinwallDb, kind: 'reg_challenge' | 'auth_challenge', challenge: string): Promise<{ data: any } | null> {
  const nowIso = new Date().toISOString();
  const row = await db
    .prepare('SELECT data FROM webauthn_challenges WHERE kind = ? AND subject = ? AND expires_at > ?')
    .bind(kind, challenge, nowIso)
    .first<{ data: string | null }>();
  if (!row) return null;
  await db.prepare('DELETE FROM webauthn_challenges WHERE kind = ? AND subject = ?').bind(kind, challenge).run();
  let data: any = null;
  try {
    data = row.data ? JSON.parse(row.data) : null;
  } catch {
    data = null;
  }
  return { data };
}

async function existingPasskeys(db: KinwallDb): Promise<PasskeyRow[]> {
  return (await db.prepare('SELECT * FROM passkeys').all<PasskeyRow>()).results;
}

function transportsOf(row: PasskeyRow): string[] {
  try {
    return row.transports ? (JSON.parse(row.transports) as string[]) : [];
  } catch {
    return [];
  }
}

// Resolves whether this request is allowed to register a passkey: either an admin bearer key
// (adding a passkey from an already-signed-in device), or a valid one-time register-token (the
// "finish on your phone" flow, where the device has no key at all yet).
async function authorizeRegistration(c: any, token: string | undefined): Promise<{ ok: true; viaToken: boolean } | { ok: false; status: 401 | 400; error: string }> {
  if (token) {
    const row = await c.env.DB.prepare('SELECT 1 FROM webauthn_challenges WHERE kind = ? AND subject = ? AND expires_at > ?')
      .bind('reg_token', token, new Date().toISOString())
      .first();
    if (!row) return { ok: false, status: 400, error: 'registration token is invalid or expired' };
    return { ok: true, viaToken: true };
  }
  const resolved = await resolveKey(c);
  if (!resolved || resolved.scope !== 'admin') return { ok: false, status: 401, error: 'unauthorized' };
  return { ok: true, viaToken: false };
}

const RegisterOptionsInputSchema = z
  .object({
    token: z.string().optional(),
    // Unset = let the browser choose (usually the platform authenticator: Face ID / Touch ID).
    // 'cross-platform' steers it to a hardware security key or a phone via QR (hybrid).
    authenticator: z.enum(['platform', 'cross-platform']).optional(),
  })
  .openapi('PasskeyRegisterOptionsInput');

passkeysRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/passkeys/register/options',
    tags: ['Passkeys'],
    summary: 'Begin passkey registration (admin key/session, or a one-time register-token)',
    request: { body: { content: { 'application/json': { schema: RegisterOptionsInputSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.record(z.string(), z.any()) } } },
      400: { description: 'bad token / rpID is an IP', content: { 'application/json': { schema: ErrorSchema } } },
      401: { description: 'unauthorized', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { token, authenticator } = c.req.valid('json');
    const auth = await authorizeRegistration(c, token);
    if (!auth.ok) return c.json({ error: auth.error }, auth.status);

    let rpID: string, origin: string;
    try {
      ({ rpID, origin } = await resolveRpId(c.env, c.req.url));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
    // Under a shared WEBAUTHN_RP_ID each instance needs its own user handle (authenticators keep
    // one credential per rpID + handle, so a shared one would overwrite another instance's
    // passkey) and a name that tells instances apart in the sign-in picker.
    const host = new URL(origin).host;
    const shared = !!c.env.WEBAUTHN_RP_ID;

    const passkeys = await existingPasskeys(c.env.DB);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID,
      userID: shared ? new TextEncoder().encode(`kinwall-admin@${host}`) : USER_ID,
      userName: shared ? host : 'admin',
      userDisplayName: shared ? `Kinwall admin (${host})` : 'Kinwall admin',
      attestationType: 'none',
      excludeCredentials: passkeys.map((p) => ({ id: p.credential_id, transports: transportsOf(p) as any })),
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred', ...(authenticator && { authenticatorAttachment: authenticator }) },
    });
    // @simplewebauthn/server v14 only emits a single hint (via preferredAuthenticatorType), so set
    // both on the JSON directly; @simplewebauthn/browser spreads it into credentials.create().
    if (authenticator === 'cross-platform') options.hints = ['security-key', 'hybrid'];
    await storeChallenge(c.env.DB, 'reg_challenge', options.challenge, { token }, CHALLENGE_TTL_MS);
    return c.json(options, 200);
  },
);

const RegisterVerifyInputSchema = z
  .object({ token: z.string().optional(), name: z.string().min(1), response: z.record(z.string(), z.any()) })
  .openapi('PasskeyRegisterVerifyInput');
const RegisterVerifyResponseSchema = z
  .object({ id: z.string(), name: z.string(), session: z.object({ key: z.string(), expiresAt: z.string() }).optional() })
  .openapi('PasskeyRegisterVerifyResponse');

passkeysRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/passkeys/register/verify',
    tags: ['Passkeys'],
    summary: 'Finish passkey registration - stores the credential, returns a session if this device had no key',
    request: { body: { content: { 'application/json': { schema: RegisterVerifyInputSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: RegisterVerifyResponseSchema } } },
      400: { description: 'bad ceremony / token', content: { 'application/json': { schema: ErrorSchema } } },
      401: { description: 'unauthorized', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { token, name, response } = c.req.valid('json');
    const clientDataJSON = response?.response?.clientDataJSON;
    const challenge = typeof clientDataJSON === 'string' ? decodeClientDataChallenge(clientDataJSON) : null;
    if (!challenge) return c.json({ error: 'malformed registration response' }, 400);

    const taken = await takeChallenge(c.env.DB, 'reg_challenge', challenge);
    if (!taken) return c.json({ error: 'registration ceremony expired or already used - try again' }, 400);
    const usedToken: string | undefined = taken.data?.token;

    // Re-authorize at verify time too (options and verify are separate requests; the token or
    // admin key must still be valid now, and a token must be consumed exactly once).
    if (usedToken) {
      const tokenRow = await c.env.DB.prepare('SELECT 1 FROM webauthn_challenges WHERE kind = ? AND subject = ? AND expires_at > ?')
        .bind('reg_token', usedToken, new Date().toISOString())
        .first();
      if (!tokenRow) return c.json({ error: 'registration token is invalid or expired' }, 400);
      await c.env.DB.prepare('DELETE FROM webauthn_challenges WHERE kind = ? AND subject = ?').bind('reg_token', usedToken).run();
    } else {
      const resolved = await resolveKey(c);
      if (!resolved || resolved.scope !== 'admin') return c.json({ error: 'unauthorized' }, 401);
    }

    let rpID: string, origin: string;
    try {
      ({ rpID, origin } = await resolveRpId(c.env, c.req.url));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({ response: response as any, expectedChallenge: challenge, expectedOrigin: origin, expectedRPID: rpID });
    } catch (err) {
      return c.json({ error: errorMessage(err, 'registration verification failed') }, 400);
    }
    if (!verification.verified || !verification.registrationInfo) return c.json({ error: 'registration could not be verified' }, 400);

    const { credential } = verification.registrationInfo;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await c.env.DB.prepare(
      'INSERT INTO passkeys (id, credential_id, public_key, counter, transports, name, created_at) VALUES (?,?,?,?,?,?,?)',
    )
      .bind(id, credential.id, bytesToBase64Url(credential.publicKey), credential.counter, JSON.stringify(credential.transports ?? []), name, now)
      .run();
    emit(c, 'settings.changed', {});

    // Always mint a session for the new passkey (not just for the token flow) - it lets any
    // caller (the setup wizard included) immediately swap a long-lived admin key for a
    // short-lived one without a second WebAuthn prompt. Token-flow callers *need* this since
    // they have no key at all yet; bearer-flow callers may simply ignore it and keep using
    // their existing key.
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
    const session = await createApiKey(c.env.DB, `Passkey: ${name}`, 'admin', { kind: 'session', expiresAt, passkeyId: id });
    return c.json({ id, name, session: { key: session.key, expiresAt } }, 200);
  },
);

const RegisterTokenResponseSchema = z.object({ token: z.string(), expiresAt: z.string() }).openapi('PasskeyRegisterTokenResponse');

passkeysRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/passkeys/register-token',
    tags: ['Passkeys'],
    summary: 'Issue a one-time 15-min token that lets another device register exactly one passkey ("finish on your phone")',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: RegisterTokenResponseSchema } } } },
  }),
  async (c) => {
    const token = randomToken();
    const expiresAt = new Date(Date.now() + REG_TOKEN_TTL_MS).toISOString();
    await c.env.DB.prepare('INSERT INTO webauthn_challenges (id, kind, subject, data, created_at, expires_at) VALUES (?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), 'reg_token', token, null, new Date().toISOString(), expiresAt)
      .run();
    return c.json({ token, expiresAt }, 200);
  },
);

passkeysRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/passkeys/login/options',
    tags: ['Passkeys'],
    summary: 'Begin passkey login (no auth)',
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.record(z.string(), z.any()) } } },
      400: { description: 'rpID is an IP', content: { 'application/json': { schema: ErrorSchema } } },
      429: { description: 'too many attempts from this address', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    let rpID: string;
    try {
      ({ rpID } = await resolveRpId(c.env, c.req.url));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }
    const passkeys = await existingPasskeys(c.env.DB);
    const options = await generateAuthenticationOptions({
      rpID,
      userVerification: 'preferred',
      allowCredentials: passkeys.map((p) => ({ id: p.credential_id, transports: transportsOf(p) as any })),
    });
    await storeChallenge(c.env.DB, 'auth_challenge', options.challenge, null, CHALLENGE_TTL_MS);
    return c.json(options, 200);
  },
);

const LoginVerifyInputSchema = z.object({ response: z.record(z.string(), z.any()) }).openapi('PasskeyLoginVerifyInput');
const LoginVerifyResponseSchema = z.object({ key: z.string(), expiresAt: z.string() }).openapi('PasskeyLoginVerifyResponse');

passkeysRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/passkeys/login/verify',
    tags: ['Passkeys'],
    summary: 'Finish passkey login (no auth) - mints a 30-day admin session key',
    request: { body: { content: { 'application/json': { schema: LoginVerifyInputSchema } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: LoginVerifyResponseSchema } } },
      400: { description: 'bad ceremony', content: { 'application/json': { schema: ErrorSchema } } },
      401: { description: 'unknown credential or verification failed', content: { 'application/json': { schema: ErrorSchema } } },
      429: { description: 'too many attempts from this address', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { response } = c.req.valid('json');
    const clientDataJSON = response?.response?.clientDataJSON;
    const challenge = typeof clientDataJSON === 'string' ? decodeClientDataChallenge(clientDataJSON) : null;
    if (!challenge) return c.json({ error: 'malformed authentication response' }, 400);

    const taken = await takeChallenge(c.env.DB, 'auth_challenge', challenge);
    if (!taken) return c.json({ error: 'login ceremony expired or already used - try again' }, 400);

    let rpID: string, origin: string;
    try {
      ({ rpID, origin } = await resolveRpId(c.env, c.req.url));
    } catch (err) {
      return c.json({ error: errorMessage(err) }, 400);
    }

    try {
      const { key, expiresAt } = await finishPasskeyLogin(c.env, { response, expectedChallenge: challenge, expectedOrigin: origin, expectedRpId: rpID });
      return c.json({ key, expiresAt }, 200);
    } catch (err) {
      return c.json({ error: errorMessage(err, 'authentication verification failed') }, 401);
    }
  },
);

/** Verifies a passkey assertion against a challenge the caller already checked (issued, unexpired,
 * consumed) and mints the same 30-day admin session key as POST /api/passkeys/login/verify, which
 * uses it too. For embedders that run the ceremony elsewhere (e.g. a sign-in page on another
 * subdomain sharing WEBAUTHN_RP_ID). Throws on an unknown credential or failed verification. */
export async function finishPasskeyLogin(
  env: Env,
  opts: { response: Record<string, any>; expectedChallenge: string; expectedOrigin: string | string[]; expectedRpId: string },
): Promise<{ key: string; expiresAt: string; scope: 'admin'; keyName: string }> {
  const { response } = opts;
  const credentialId = typeof response.id === 'string' ? response.id : null;
  const passkey = credentialId ? await env.DB.prepare('SELECT * FROM passkeys WHERE credential_id = ?').bind(credentialId).first<PasskeyRow>() : null;
  if (!passkey) throw new Error('unknown passkey');

  const verification = await verifyAuthenticationResponse({
    response: response as any,
    expectedChallenge: opts.expectedChallenge,
    expectedOrigin: opts.expectedOrigin,
    expectedRPID: opts.expectedRpId,
    credential: { id: passkey.credential_id, publicKey: base64UrlToBytes(passkey.public_key) as any, counter: passkey.counter, transports: transportsOf(passkey) as any },
  });
  if (!verification.verified) throw new Error('authentication could not be verified');

  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE passkeys SET counter = ?, last_used_at = ? WHERE id = ?')
    .bind(verification.authenticationInfo.newCounter, now, passkey.id)
    .run();

  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const keyName = `Passkey: ${passkey.name}`;
  const session = await createApiKey(env.DB, keyName, 'admin', { kind: 'session', expiresAt, passkeyId: passkey.id });
  return { key: session.key, expiresAt, scope: 'admin', keyName };
}

function toApi(row: PasskeyRow) {
  return { id: row.id, name: row.name, createdAt: row.created_at, lastUsedAt: row.last_used_at, transports: transportsOf(row) };
}
const PasskeySchema = z
  .object({ id: z.string(), name: z.string(), createdAt: z.string(), lastUsedAt: z.string().nullable(), transports: z.array(z.string()) })
  .openapi('Passkey');

passkeysRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/passkeys',
    tags: ['Passkeys'],
    summary: 'List registered passkeys',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.array(PasskeySchema) } } } },
  }),
  async (c) => {
    const { results } = await c.env.DB.prepare('SELECT * FROM passkeys ORDER BY created_at').all<PasskeyRow>();
    return c.json(results.map(toApi), 200);
  },
);

passkeysRoutes.openapi(
  createRoute({
    method: 'patch',
    path: '/api/passkeys/{id}',
    tags: ['Passkeys'],
    summary: 'Rename a passkey',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }), body: { content: { 'application/json': { schema: z.object({ name: z.string().min(1) }) } } } },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: PasskeySchema } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const { name } = c.req.valid('json');
    const existing = await c.env.DB.prepare('SELECT * FROM passkeys WHERE id = ?').bind(id).first<PasskeyRow>();
    if (!existing) return c.json({ error: 'not found' }, 404);
    await c.env.DB.prepare('UPDATE passkeys SET name = ? WHERE id = ?').bind(name, id).run();
    emit(c, 'settings.changed', {});
    return c.json(toApi({ ...existing, name }), 200);
  },
);

passkeysRoutes.openapi(
  createRoute({
    method: 'delete',
    path: '/api/passkeys/{id}',
    tags: ['Passkeys'],
    summary: 'Remove a passkey (also signs out any sessions created by logging in with it)',
    security: [{ Bearer: [] }],
    request: { params: z.object({ id: z.string() }) },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } },
      404: { description: 'not found', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    const { id } = c.req.valid('param');
    const result = await c.env.DB.prepare('DELETE FROM passkeys WHERE id = ?').bind(id).run();
    if (result.meta.changes === 0) return c.json({ error: 'not found' }, 404);
    await c.env.DB.prepare("DELETE FROM api_keys WHERE kind = 'session' AND passkey_id = ?").bind(id).run();
    emit(c, 'settings.changed', {});
    return c.json({ ok: true }, 200);
  },
);

passkeysRoutes.openapi(
  createRoute({
    method: 'post',
    path: '/api/sessions/logout',
    tags: ['Passkeys'],
    summary: 'Sign out the current passkey session',
    security: [{ Bearer: [] }],
    responses: { 200: { description: 'ok', content: { 'application/json': { schema: z.object({ ok: z.boolean() }) } } } },
  }),
  async (c) => {
    const resolved = await resolveKey(c);
    if (resolved?.id) await c.env.DB.prepare('DELETE FROM api_keys WHERE id = ?').bind(resolved.id).run();
    return c.json({ ok: true }, 200);
  },
);

// Re-exported for GET /api/setup's `passkeys: boolean` flag.
export async function hasAnyPasskey(db: KinwallDb): Promise<boolean> {
  const row = await db.prepare('SELECT 1 FROM passkeys LIMIT 1').first();
  return !!row;
}
