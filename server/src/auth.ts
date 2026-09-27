import type { KinwallDb } from './db.ts';
import type { Context, Next } from 'hono';
import type { Env, WaitCtx } from './env.ts';
import { waitUntil } from './env.ts';
import { parseMemberIds } from './calendar-members.ts';

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
export type ResolvedKey = { id?: string; scope: KeyScope; name: string; kind: 'api' | 'session' | 'oauth'; lastUsedAt?: string | null; owner?: string | null };

// Shared by POST /api/keys and the pairing-approval flow (routes/pair.ts) so key creation +
// hashing lives in exactly one place. `kind` defaults to 'api' (permanent automation keys);
// passkey login mints 'session' keys with an expiry instead.
export async function createApiKey(
  db: KinwallDb,
  name: string,
  scope: KeyScope,
  opts: { kind?: 'api' | 'session' | 'oauth'; expiresAt?: string; passkeyId?: string; owner?: string | null } = {},
): Promise<{ id: string; key: string }> {
  const key = generateApiKey();
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO api_keys (id, name, hash, prefix, scope, created_at, kind, expires_at, passkey_id, owner) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .bind(id, name, await sha256Hex(key), key.slice(0, 8), scope, new Date().toISOString(), opts.kind ?? 'api', opts.expiresAt ?? null, opts.passkeyId ?? null, opts.owner ?? null)
    .run();
  return { id, key };
}

/** A device owner from an admin: 'shared' or an existing member's id. Null when it's neither. */
export async function validOwner(db: KinwallDb, owner: string): Promise<string | null> {
  if (owner === 'shared') return owner;
  return (await db.prepare('SELECT id FROM members WHERE id = ?').bind(owner).first<{ id: string }>())?.id ?? null;
}

// The one rule for who may change a calendar's events (create, edit, delete, and linking tasks to
// them), used by every event-writing route and by GET /api/calendars (canEditEvents) so the app
// hides what would be refused. Admin keys: always. Display keys (wall screens, kids' devices, the
// app's widget/Watch keys): only on calendars with "Wall screens and kids' devices can edit" on
// (display_edit), and a display pinned to a member only on calendars that are for that member.
// Shared and legacy (null owner) displays are not limited by member. Reading is never limited.
type EditableCal = { member_ids: string; display_edit: number };

export function canChangeEvents(key: ResolvedKey | null, cal: EditableCal): boolean {
  if (key?.scope !== 'display') return true;
  if (!cal.display_edit) return false;
  const kid = key.owner && key.owner !== 'shared' ? key.owner : null;
  return !kid || parseMemberIds(cal.member_ids).includes(kid);
}

/** The 403 message when this request's key may not change events on every one of `cals` (an
 * event's calendar, or both calendars of a move), or null when it may. */
export async function eventWriteBlock(c: Context<{ Bindings: Env }>, cals: EditableCal[]): Promise<string | null> {
  const key = await requestKey(c);
  const denied = cals.filter((cal) => !canChangeEvents(key, cal));
  if (denied.length === 0) return null;
  if (denied.some((cal) => !cal.display_edit)) return "Events on this calendar can only be changed from a parent's device.";
  const name = (await c.env.DB.prepare('SELECT name FROM members WHERE id = ?').bind(key!.owner).first<{ name: string }>())?.name;
  return `This device can only change events on ${name ? `${name}'s` : 'its own'} calendars.`;
}

/** The member this request's device belongs to (a display key owned by one member), else null.
 * Shared and legacy (null owner) displays and admin keys belong to no one. */
export async function deviceOwner(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const key = await requestKey(c);
  return key?.scope === 'display' && key.owner && key.owner !== 'shared' ? key.owner : null;
}

/** A member's own device acts only for them: the 403 message when any of `memberIds` is someone
 * else, or null when it may. Null / undefined ids are ignored. */
export async function ownerBlock(c: Context<{ Bindings: Env }>, ...memberIds: (string | null | undefined)[]): Promise<string | null> {
  const owner = await deviceOwner(c);
  if (!owner || memberIds.every((id) => !id || id === owner)) return null;
  const name = (await c.env.DB.prepare('SELECT name FROM members WHERE id = ?').bind(owner).first<{ name: string }>())?.name;
  return `This device can only do that for ${name ?? 'its owner'}.`;
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
  { method: 'GET', pattern: /^\/api\/recipes(\/[^/]+)?$/ },
  { method: 'GET', pattern: /^\/api\/meals(\/(?!projection$)[^/]+)?$/ }, // not the shopping projection (admin)
  { method: 'PATCH', pattern: /^\/api\/meals\/[^/]+$/ }, // route restricts assigned devices to notes/status

  { method: 'POST', pattern: /^\/api\/device-keys$/ }, // an app's widgets / watch key (everyday access only)
  { method: 'DELETE', pattern: /^\/api\/device-keys\/self$/ },
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
  // Chores: wall screens and kids' devices tick them off (and undo); adding, editing and deleting
  // chores is for parent devices.
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
  // Rewards: wall screens and kids' devices list them, redeem and pick a goal (routes/rewards.ts
  // keeps a member's own device to that member); adding, editing and deciding is for parent devices.
  { method: 'GET', pattern: /^\/api\/rewards$/ },
  { method: 'GET', pattern: /^\/api\/rewards\/redemptions$/ },
  { method: 'POST', pattern: /^\/api\/rewards\/[^/]+\/redeem$/ },
  { method: 'PUT', pattern: /^\/api\/members\/[^/]+\/reward-goal$/ },
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
  { method: 'GET', pattern: /^\/api\/photos(\/quota)?$/ },
  { method: 'POST', pattern: /^\/api\/photos$/ }, // Paint's "Save to family photos" on the wall; delete/edit stay admin-only
  { method: 'GET', pattern: /^\/api\/photos\/[^/]+\/image$/ },
  // Trackers: reading and memories on the wall (kids log books there). The paths are shared with
  // health, so routes/trackers.ts refuses health to display keys itself. No DELETE.
  { method: 'GET', pattern: /^\/api\/trackers(\/[^/]+)?$/ },
  { method: 'POST', pattern: /^\/api\/trackers$/ },
  { method: 'PATCH', pattern: /^\/api\/trackers\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/weather$/ },
  { method: 'GET', pattern: /^\/api\/tidbits$/ },
  { method: 'GET', pattern: /^\/api\/plugins$/ },
  { method: 'GET', pattern: /^\/api\/plugins\/[a-z0-9-]+\/data$/ },
  { method: 'PUT', pattern: /^\/api\/plugins\/[a-z0-9-]+\/data$/ },
  { method: 'POST', pattern: /^\/api\/plugins\/[a-z0-9-]+\/playtime$/ }, // activity chores: the player's heartbeat
  { method: 'GET', pattern: /^\/api\/geocode$/ },
  { method: 'GET', pattern: /^\/api\/settings$/ },
  // Family settings (name, timezone, weather, quote sources, appearance, quiet hours, features)
  // are for parent devices; a display reads them, keeps its own look on the device, and may add a
  // color scheme to the family's list for itself.
  { method: 'POST', pattern: /^\/api\/settings\/color-schemes$/ },
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

// Routes that can't send a header, so they take the key as ?key=: the OAuth start and the photo zip
// (browser navigations) and a photo's bytes (an <img src>). Nowhere else - a key in a URL ends up in logs.
const QUERY_KEY_PATH = /^\/api\/oauth\/[^/]+\/start$|^\/api\/photos\/[^/]+\/image$|^\/api\/photos\/export\.zip$/;

// Shared by requireAuth and GET /api/me: resolves the bearer key (or ?key= on QUERY_KEY_PATH)
// to its scope. Returns null if the key is missing/unknown.
export async function resolveKey(c: Context<{ Bindings: Env }>): Promise<ResolvedKey | null> {
  const header = c.req.header('Authorization') ?? '';
  const key = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : QUERY_KEY_PATH.test(c.req.path) ? c.req.query('key') ?? '' : '';
  if (!key) return null;

  const hash = await sha256Hex(key);
  if (c.env.ADMIN_API_KEY && timingSafeEqual(hash, await sha256Hex(c.env.ADMIN_API_KEY))) {
    return { scope: 'admin', name: 'ADMIN_API_KEY', kind: 'api' };
  }

  const row = await c.env.DB.prepare('SELECT id, name, scope, expires_at, kind, last_used_at, owner FROM api_keys WHERE hash = ?')
    .bind(hash)
    .first<{ id: string; name: string; scope: string | null; expires_at: string | null; kind: string | null; last_used_at: string | null; owner: string | null }>();
  if (!row) return null;
  if (row.expires_at && row.expires_at < new Date().toISOString()) return null; // expired session key
  return {
    id: row.id,
    name: row.name,
    scope: row.scope === 'display' ? 'display' : 'admin',
    kind: row.kind === 'session' ? 'session' : row.kind === 'oauth' ? 'oauth' : 'api',
    lastUsedAt: row.last_used_at,
    owner: row.owner,
  };
}

// requireAuth's resolved key, per request, so routes that need it (eventWriteBlock, GET /api/calendars)
// don't look the key up again.
const resolvedKeys = new WeakMap<Request, ResolvedKey>();
export async function requestKey(c: Context<{ Bindings: Env }>): Promise<ResolvedKey | null> {
  return resolvedKeys.get(c.req.raw) ?? resolveKey(c);
}

export async function requireAuth(c: Context<{ Bindings: Env }>, next: Next) {
  if (PUBLIC_PATH.test(c.req.path)) return next();

  const resolved = await resolveKey(c);
  if (!resolved) return c.json({ error: 'unauthorized' }, 401);
  resolvedKeys.set(c.req.raw, resolved);

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
