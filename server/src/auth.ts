import type { KinwallDb } from './db.ts';
import type { Context, Next } from 'hono';
import type { Env, WaitCtx } from './env.ts';
import { waitUntil } from './env.ts';

const LAST_USED_STALE_MS = 60 * 60 * 1000; // don't write last_used_at more than once an hour

export async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Callers pass fixed-length hex hashes, so a plain char-by-char XOR is a real constant-time comparison.
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function generateApiKey(): string {
  return `kw_${crypto.randomUUID().replace(/-/g, '')}`;
}

export type KeyScope = 'admin' | 'display';
export type ResolvedKey = { id?: string; scope: KeyScope; name: string; kind: 'api' | 'session' | 'oauth'; lastUsedAt?: string | null };

// Shared by POST /api/keys and the pairing-approval flow (routes/pair.ts) so key creation +
// hashing lives in exactly one place. `kind` defaults to 'api' (permanent automation keys);
// passkey login mints 'session' keys with an expiry instead.
export async function createApiKey(
  db: KinwallDb,
  name: string,
  scope: KeyScope,
  opts: { kind?: 'api' | 'session' | 'oauth'; expiresAt?: string; passkeyId?: string } = {},
): Promise<{ id: string; key: string }> {
  const key = generateApiKey();
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO api_keys (id, name, hash, prefix, scope, created_at, kind, expires_at, passkey_id) VALUES (?,?,?,?,?,?,?,?,?)')
    .bind(id, name, await sha256Hex(key), key.slice(0, 8), scope, new Date().toISOString(), opts.kind ?? 'api', opts.expiresAt ?? null, opts.passkeyId ?? null)
    .run();
  return { id, key };
}

// No-auth routes: health check, the OAuth callback (browser redirect from the provider), the
// two display-pairing routes a not-yet-paired display calls before it has any key, and the
// passkey ceremony routes that authenticate a not-yet-signed-in browser by other means
// (a one-time registration token in the body, or the WebAuthn assertion itself), and the
// recovery-code login (the code in the body is the credential).
const PUBLIC_PATH =
  /^\/api\/health$|^\/api\/appearance$|^\/api\/oauth\/[^/]+\/callback$|^\/api\/pair$|^\/api\/pair\/poll$|^\/api\/setup$|^\/api\/setup\/claim$|^\/api\/passkeys\/register\/options$|^\/api\/passkeys\/register\/verify$|^\/api\/passkeys\/login\/options$|^\/api\/passkeys\/login\/verify$|^\/api\/recovery\/login$/;

// Central allow-list of what a 'display' scoped key may do (the wall iPad). Anything not
// listed here is denied for display keys - deny by default, not scattered checks.
const DISPLAY_ALLOWED: { method: string; pattern: RegExp }[] = [
  { method: 'GET', pattern: /^\/api\/me$/ },
  { method: 'GET', pattern: /^\/api\/members$/ },
  { method: 'GET', pattern: /^\/api\/calendars$/ },
  { method: 'GET', pattern: /^\/api\/events(\/[^/]+)?$/ },
  { method: 'GET', pattern: /^\/api\/events\/[^/]+\/items$/ },
  { method: 'POST', pattern: /^\/api\/events$/ },
  { method: 'PATCH', pattern: /^\/api\/events\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/events\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/chores$/ },
  { method: 'GET', pattern: /^\/api\/chores\/day$/ },
  { method: 'POST', pattern: /^\/api\/chores$/ },
  { method: 'PATCH', pattern: /^\/api\/chores\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/chores\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/chores\/[^/]+\/complete$/ },
  { method: 'DELETE', pattern: /^\/api\/chores\/[^/]+\/complete$/ },
  { method: 'GET', pattern: /^\/api\/leaderboard$/ },
  { method: 'GET', pattern: /^\/api\/members\/[^/]+\/points$/ },
  { method: 'GET', pattern: /^\/api\/stickers\/packs$/ },
  { method: 'POST', pattern: /^\/api\/stickers\/packs\/[^/]+\/buy$/ },
  { method: 'GET', pattern: /^\/api\/stickers\/scrapbook\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/stickers\/scrapbook\/[^/]+$/ },
  { method: 'PATCH', pattern: /^\/api\/stickers\/scrapbook\/[^/]+\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/stickers\/scrapbook\/[^/]+\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/categories$/ },
  { method: 'POST', pattern: /^\/api\/categories$/ },
  { method: 'PATCH', pattern: /^\/api\/categories\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/categories\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/categories\/reorder$/ },
  { method: 'GET', pattern: /^\/api\/lists$/ },
  { method: 'POST', pattern: /^\/api\/lists$/ },
  { method: 'GET', pattern: /^\/api\/lists\/[^/]+$/ },
  { method: 'PATCH', pattern: /^\/api\/lists\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/lists\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/lists\/[^/]+\/items$/ },
  { method: 'PATCH', pattern: /^\/api\/lists\/[^/]+\/items\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/lists\/[^/]+\/items\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/lists\/[^/]+\/items\/[^/]+\/steps(\/reorder)?$/ },
  { method: 'PATCH', pattern: /^\/api\/lists\/[^/]+\/items\/[^/]+\/steps\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/lists\/[^/]+\/items\/[^/]+\/steps\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/lists\/[^/]+\/clear-completed$/ },
  { method: 'POST', pattern: /^\/api\/lists\/[^/]+\/reset$/ },
  { method: 'POST', pattern: /^\/api\/lists\/[^/]+\/reorder$/ },
  { method: 'PUT', pattern: /^\/api\/lists\/[^/]+\/groups$/ },
  { method: 'GET', pattern: /^\/api\/notes$/ },
  { method: 'POST', pattern: /^\/api\/notes$/ },
  { method: 'PATCH', pattern: /^\/api\/notes\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/notes\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/snapshot$/ },
  { method: 'GET', pattern: /^\/api\/board$/ },
  { method: 'GET', pattern: /^\/api\/weather$/ },
  { method: 'GET', pattern: /^\/api\/geocode$/ }, // Settings -> General's location search (settings PATCH is display-allowed too)
  { method: 'GET', pattern: /^\/api\/settings$/ },
  { method: 'PATCH', pattern: /^\/api\/settings$/ },
  { method: 'GET', pattern: /^\/api\/rev$/ },
  { method: 'GET', pattern: /^\/api\/notifications$/ },
  { method: 'GET', pattern: /^\/api\/push\/vapid-public-key$/ },
  { method: 'GET', pattern: /^\/api\/push\/subscriptions$/ },
  { method: 'POST', pattern: /^\/api\/push\/subscriptions$/ },
  { method: 'PATCH', pattern: /^\/api\/push\/subscriptions\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/push\/subscriptions\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/push\/test\/[^/]+$/ },
];

function isDisplayAllowed(method: string, path: string): boolean {
  return DISPLAY_ALLOWED.some((rule) => rule.method === method && rule.pattern.test(path));
}

// Shared by requireAuth and GET /api/me: resolves the bearer key (or ?key= for the OAuth
// start browser nav) to its scope. Returns null if the key is missing/unknown.
export async function resolveKey(c: Context<{ Bindings: Env }>): Promise<ResolvedKey | null> {
  const header = c.req.header('Authorization') ?? '';
  const key = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : c.req.query('key') ?? '';
  if (!key) return null;

  const hash = await sha256Hex(key);
  if (c.env.ADMIN_API_KEY && timingSafeEqual(hash, await sha256Hex(c.env.ADMIN_API_KEY))) {
    return { scope: 'admin', name: 'ADMIN_API_KEY', kind: 'api' };
  }

  const row = await c.env.DB.prepare('SELECT id, name, scope, expires_at, kind, last_used_at FROM api_keys WHERE hash = ?')
    .bind(hash)
    .first<{ id: string; name: string; scope: string | null; expires_at: string | null; kind: string | null; last_used_at: string | null }>();
  if (!row) return null;
  if (row.expires_at && row.expires_at < new Date().toISOString()) return null; // expired session key
  return {
    id: row.id,
    name: row.name,
    scope: row.scope === 'display' ? 'display' : 'admin',
    kind: row.kind === 'session' ? 'session' : row.kind === 'oauth' ? 'oauth' : 'api',
    lastUsedAt: row.last_used_at,
  };
}

export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  if (PUBLIC_PATH.test(c.req.path)) return next();

  const resolved = await resolveKey(c);
  if (!resolved) return c.json({ error: 'unauthorized' }, 401);

  if (resolved.scope === 'display' && !isDisplayAllowed(c.req.method, c.req.path)) {
    return c.json({ error: 'display key cannot access this route' }, 403);
  }

  // Tracking last_used_at is best-effort telemetry, not something any request should wait on:
  // skip the write entirely when it was already refreshed within the last hour, and otherwise
  // fire it in the background instead of blocking the response on it.
  if (resolved.id && (!resolved.lastUsedAt || Date.parse(resolved.lastUsedAt) < Date.now() - LAST_USED_STALE_MS)) {
    let ctx: WaitCtx | undefined;
    try {
      ctx = c.executionCtx;
    } catch {
      ctx = undefined; // Node: no ExecutionContext
    }
    waitUntil(
      ctx,
      Promise.resolve(c.env.DB.prepare('UPDATE api_keys SET last_used_at = ? WHERE id = ?').bind(new Date().toISOString(), resolved.id).run()),
    );
  }
  return next();
}
