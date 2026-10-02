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
export type ResolvedKey = { id?: string; scope: KeyScope; name: string; kind: 'api' | 'session' | 'oauth'; lastUsedAt?: string | null; owner?: string | null; deviceKind?: KeyDeviceKind | null };

// Shared by POST /api/keys and the pairing-approval flow (routes/pair.ts) so key creation +
// hashing lives in exactly one place. `kind` defaults to 'api' (permanent automation keys);
// passkey login mints 'session' keys with an expiry instead.
export async function createApiKey(
  db: KinwallDb,
  name: string,
  scope: KeyScope,
  opts: { kind?: 'api' | 'session' | 'oauth'; expiresAt?: string; passkeyId?: string; owner?: string | null; deviceKind?: KeyDeviceKind | null; parentKeyId?: string | null; parentGrantId?: string | null } = {},
): Promise<{ id: string; key: string }> {
  const key = generateApiKey();
  const id = crypto.randomUUID();
  await db
    .prepare('INSERT INTO api_keys (id, name, hash, prefix, scope, created_at, kind, expires_at, passkey_id, owner, device_kind, parent_key_id, parent_grant_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .bind(id, name, await sha256Hex(key), key.slice(0, 8), scope, new Date().toISOString(), opts.kind ?? 'api', opts.expiresAt ?? null, opts.passkeyId ?? null, opts.owner ?? null, opts.deviceKind ?? null, opts.parentKeyId ?? null, opts.parentGrantId ?? null)
    .run();
  return { id, key };
}

/** A device owner from an admin: 'shared' or an existing member's id that fits the key. Null
 * otherwise. 'display' (a paired device, an everyday-access sign-in): shared or a kid, never a
 * grown-up, so whoever approves a pairing code or a kid's sign-in never gets a key that opens a
 * grown-up's private journal (routes/journal.ts); grown-ups claim their own device from it
 * (PUT /api/me/owner). 'admin' (a parent's device): shared or a grown-up. 'app': a full-access
 * sign-in of the Kinwall app, any member (only a grown-up owner opens a journal: journalOwner). */
export async function validOwner(db: KinwallDb, owner: string, scope: KeyScope | 'app' = 'display'): Promise<string | null> {
  if (owner === 'shared') return owner;
  const m = await db.prepare('SELECT id, grown_up FROM members WHERE id = ?').bind(owner).first<{ id: string; grown_up: number }>();
  if (!m) return null;
  return scope === 'app' || (scope === 'display') === !m.grown_up ? m.id : null;
}

/** Why validOwner refused a grown-up for an everyday-access key. */
export const GROWN_UP_PAIRING = "A paired device can't be a grown-up's. Grown-ups sign in on their own phone or computer with a passkey or the Kinwall app, then pick themselves under Whose device is this?";

/** What a device is: the family's wall screen, a kid's own device or a grown-up's own device. */
export const DEVICE_KINDS = ['wall', 'kid', 'grownup'] as const;
export type DeviceKind = (typeof DEVICE_KINDS)[number];
/** On a key, also 'widgets': the Kinwall app's widgets and Watch (POST /api/device-keys), which follow the device that made them. */
export type KeyDeviceKind = DeviceKind | 'widgets';

/** A device's kind and owner from an admin (pairing, PATCH /api/keys), checked against each other:
 * a wall screen is shared, a kid's device is a kid's. A paired device (display key) is only ever
 * one of those two (validOwner). A full-access key is a parent's device: a grown-up's
 * ('grownup'), or shared with no kind (automation). Without a kind (older clients) it follows the
 * owner ('shared' when that's missing too). */
export async function deviceKindOwner(db: KinwallDb, scope: KeyScope, kind: DeviceKind | undefined, ownerIn: string | undefined): Promise<{ kind: DeviceKind | null; owner: string } | { error: string }> {
  const admin = scope === 'admin';
  if (!admin && kind === 'grownup') return { error: GROWN_UP_PAIRING };
  if (kind === 'wall') {
    if (admin) return { error: "A full-access device can't be a wall screen" };
    if (ownerIn && ownerIn !== 'shared') return { error: 'A wall screen belongs to the whole family' };
    return { kind, owner: 'shared' };
  }
  const owner = ownerIn ?? 'shared';
  if (owner === 'shared') return kind ? { error: 'Pick whose device it is' } : { kind: admin ? null : 'wall', owner };
  const m = await db.prepare('SELECT id, name, grown_up FROM members WHERE id = ?').bind(owner).first<{ id: string; name: string; grown_up: number }>();
  if (!m) return { error: 'unknown family member' };
  if (admin && !m.grown_up) return { error: 'A full-access device can only belong to a grown-up' };
  if (!admin && m.grown_up) return { error: GROWN_UP_PAIRING };
  const theirs: DeviceKind = m.grown_up ? 'grownup' : 'kid';
  if (kind && kind !== theirs) return { error: kind === 'kid' ? `A kid's device belongs to a kid. ${m.name} is a grown-up.` : `A grown-up's device belongs to a grown-up. ${m.name} isn't marked as one.` };
  return { kind: theirs, owner: m.id };
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

/** Whose own device this is: a display key owned by one member (deviceOwner), or a full-access key
 * a grown-up owns (their phone or computer: an API key, a passkey's sessions or the Kinwall app's
 * sign-in, set under "Whose device is this?", PUT /api/me/owner). Never a connected app's. For the
 * things a person's own device does for them (starting their day, being credited); limits on what
 * a device may do stay with deviceOwner (ownerBlock), since a parent's device acts for anyone. */
export async function ownDevice(c: Context<{ Bindings: Env }>): Promise<string | null> {
  const paired = await deviceOwner(c);
  if (paired) return paired;
  const key = await requestKey(c);
  if (key?.scope !== 'admin' || !key.owner || key.owner === 'shared' || (await isConnectedApp(c))) return null;
  const m = await c.env.DB.prepare('SELECT grown_up FROM members WHERE id = ?').bind(key.owner).first<{ grown_up: number }>();
  return m?.grown_up ? key.owner : null;
}

/** Who is doing this, for "Added by" / "Checked off by" on lists: a person (their own device,
 * ownDevice) as a member id; an AI connector as "Assistant"; a device that is nobody's (a wall
 * screen, a named automation key like Home Assistant's) by its name. Null when there's nothing
 * worth showing (the server's ADMIN_API_KEY, an unclaimed passkey or recovery sign-in). */
export type Actor = { memberId: string | null; label: string | null };
export async function actorOf(c: Context<{ Bindings: Env }>): Promise<Actor> {
  if (await isConnectedApp(c)) return { memberId: null, label: 'Assistant' };
  const memberId = await ownDevice(c);
  if (memberId) return { memberId, label: null };
  const key = await requestKey(c);
  const credited = key?.id && key.deviceKind === 'widgets' ? await widgetsGrownUp(c.env.DB, key.id) : null;
  if (credited) return { memberId: credited, label: null };
  return { memberId: null, label: key?.id && (key.scope === 'display' || key.kind === 'api') ? key.name : null };
}

/** A parent's phone's widgets key (and its Watch's) is shared, so it shows the whole family, but
 * what it adds or ticks is credited to the grown-up whose full-access sign-in made it (its parent
 * key's or app sign-in's owner; a Watch key's parent is the widgets' key). Only for actorOf: what
 * the key may do stays a shared key's. */
async function widgetsGrownUp(db: KinwallDb, keyId: string): Promise<string | null> {
  const row = await db.prepare(
    `SELECT m.id FROM api_keys k
       LEFT JOIN api_keys p ON p.id = k.parent_key_id
       LEFT JOIN api_keys pp ON pp.id = p.parent_key_id
       LEFT JOIN oauth_grants g ON g.id = coalesce(k.parent_grant_id, p.parent_grant_id)
       JOIN members m ON m.grown_up = 1 AND m.id = CASE WHEN g.scope = 'admin' THEN g.owner WHEN p.scope = 'admin' THEN p.owner WHEN pp.scope = 'admin' THEN pp.owner END
     WHERE k.id = ?`,
  ).bind(keyId).first<{ id: string }>();
  return row?.id ?? null;
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
  { method: 'PUT', pattern: /^\/api\/recipes\/[^/]+\/rating$/ }, // family members rate dinners (a member's own device only for them)
  { method: 'GET', pattern: /^\/api\/(recipes|meals)\/[^/]+\/source\.pdf$/ }, // the recipe card viewer
  { method: 'GET', pattern: /^\/api\/(recipes|meals)\/[^/]+\/image$/ }, // recipe photos
  { method: 'GET', pattern: /^\/api\/recipes\/[^/]+\/steps\/\d+\/image$/ }, // recipe step photos
  { method: 'GET', pattern: /^\/api\/meals(\/(?!projection$)[^/]+)?$/ }, // not the shopping projection (admin)
  { method: 'PATCH', pattern: /^\/api\/meals\/[^/]+$/ }, // route restricts assigned devices to notes/status

  { method: 'POST', pattern: /^\/api\/device-keys$/ }, // an app's widgets / watch key (everyday access only)
  { method: 'DELETE', pattern: /^\/api\/device-keys\/self$/ },
  { method: 'PUT', pattern: /^\/api\/live-activities\/tokens$/ }, // the iPhone app's Live Activity tokens, for its own device
  { method: 'DELETE', pattern: /^\/api\/live-activities\/tokens$/ },
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
  { method: 'GET', pattern: /^\/api\/members\/[^/]+\/stats$/ }, // profiles: the whole family sees the fun stats
  { method: 'PUT', pattern: /^\/api\/members\/[^/]+\/avatar$/ }, // a kid's own device, its own avatar only (routes/members.ts)
  { method: 'POST', pattern: /^\/api\/members\/[^/]+\/check-in$/ },
  // Temp check: answered on the wall like a chore; routes/temp-check.ts keeps the answers off shared screens.
  { method: 'GET', pattern: /^\/api\/members\/[^/]+\/temp-check$/ },
  { method: 'PUT', pattern: /^\/api\/members\/[^/]+\/temp-check$/ }, // daily check-in, like ticking a chore (a member's own device only for them)
  // Journal: a member's own device only (routes/journal.ts refuses shared walls and other members' devices).
  { method: 'GET', pattern: /^\/api\/members\/[^/]+\/journal$/ },
  { method: 'POST', pattern: /^\/api\/members\/[^/]+\/journal$/ },
  { method: 'PATCH', pattern: /^\/api\/members\/[^/]+\/journal\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/members\/[^/]+\/journal\/[^/]+$/ },
  { method: 'PUT', pattern: /^\/api\/members\/[^/]+\/journal\/privacy$/ }, // a kid turns their private journal on or off (routes/journal.ts: own device only)
  { method: 'GET', pattern: /^\/api\/members\/[^/]+\/(insights|battery)$/ }, // a member's own device only (routes/insights.ts refuses shared walls and other members' devices)
  // Medications: Take now cards and marking doses on the wall and a person's own device; their own list
  // and history on their own device (routes/medications.ts decides who sees what). Adding and editing: parents.
  { method: 'GET', pattern: /^\/api\/medications$/ },
  { method: 'GET', pattern: /^\/api\/medications\/due$/ },
  { method: 'POST', pattern: /^\/api\/medications\/[^/]+\/doses$/ },
  { method: 'GET', pattern: /^\/api\/members\/[^/]+\/medications$/ },
  { method: 'POST', pattern: /^\/api\/members\/[^/]+\/day-started$/ }, // a person's own device only ("When I start my day" doses)
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
  { method: 'POST', pattern: /^\/api\/rewards\/redemptions\/[^/]+\/cancel$/ }, // take back their own pending request (routes/rewards.ts: own device only)
  { method: 'PUT', pattern: /^\/api\/members\/[^/]+\/reward-goal$/ },
  { method: 'GET', pattern: /^\/api\/categories$/ },
  { method: 'GET', pattern: /^\/api\/(?:contacts(?:\/categories|\/[0-9a-f-]+)?|contact-categories(?:\/[0-9a-f-]+)?)$/ },
  { method: 'GET', pattern: /^\/api\/lists$/ },
  { method: 'POST', pattern: /^\/api\/lists$/ },
  // The grocery catalog: read and edited like list items (which remember the same places); forgetting is for parent devices.
  { method: 'GET', pattern: /^\/api\/lists\/remembered$/ },
  { method: 'POST', pattern: /^\/api\/lists\/remembered$/ },
  { method: 'PUT', pattern: /^\/api\/lists\/remembered\/[^/]+$/ },
  { method: 'GET', pattern: /^\/api\/lists\/(?!(?:remembered-tags|values|aisles|order)$)[^/]+$/ }, // a list id, never a fixed route like remembered-tags (parents only)
  { method: 'PATCH', pattern: /^\/api\/lists\/(?!(?:remembered-tags|values|aisles|order)$)[^/]+$/ }, // a list id, never a fixed route like remembered-tags (parents only); routes/lists.ts keeps displays to view fields; deleting lists and their order are for parent devices
  { method: 'POST', pattern: /^\/api\/lists\/[^/]+\/items$/ },
  { method: 'POST', pattern: /^\/api\/lists\/[^/]+\/items\/move$/ }, // moving between lists, like editing items on both
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
  { method: 'GET', pattern: /^\/api\/coloring-pages$/ }, // Paint's coloring book; adding and deleting pages stay admin-only
  { method: 'GET', pattern: /^\/api\/google-photos(\/next)?$/ }, // the Night screen and the Board show them; connecting is for parent devices
  // Trackers: reading and memories on the wall (kids log books there). The paths are shared with
  // health, so routes/trackers.ts refuses health to display keys itself. DELETE: the route allows
  // only a member's own device, on their own entries.
  { method: 'GET', pattern: /^\/api\/trackers(\/[^/]+)?$/ },
  { method: 'POST', pattern: /^\/api\/trackers$/ },
  { method: 'PATCH', pattern: /^\/api\/trackers\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/trackers\/[^/]+$/ },
  // Newscast: read, post as the device's person (or a picked one on a wall), react; routes/newscast.ts
  // keeps a person's own device to that person and deletion to the author's device or a parent's.
  { method: 'GET', pattern: /^\/api\/newscast$/ },
  { method: 'POST', pattern: /^\/api\/newscast\/posts$/ },
  { method: 'DELETE', pattern: /^\/api\/newscast\/posts\/[^/]+$/ },
  { method: 'PUT', pattern: /^\/api\/newscast\/reactions$/ },
  { method: 'GET', pattern: /^\/api\/weather$/ },
  { method: 'GET', pattern: /^\/api\/tidbits$/ },
  { method: 'GET', pattern: /^\/api\/plugins$/ },
  { method: 'GET', pattern: /^\/api\/plugins\/[a-z0-9-]+\/data$/ },
  { method: 'PUT', pattern: /^\/api\/plugins\/[a-z0-9-]+\/data$/ },
  { method: 'POST', pattern: /^\/api\/plugins\/[a-z0-9-]+\/playtime$/ }, // activity chores: the player's heartbeat
  { method: 'GET', pattern: /^\/api\/geocode$/ },
  { method: 'GET', pattern: /^\/api\/settings$/ },
  // Family settings (name, timezone, weather, quote sources, appearance, night, features)
  // are for parent devices; a display reads them, keeps its own look on the device, and may add a
  // color scheme to the family's list for itself.
  { method: 'POST', pattern: /^\/api\/settings\/color-schemes$/ },
  { method: 'POST', pattern: /^\/api\/quiet-pin\/verify$/ }, // waking the night screen; setting the PIN is for parent devices
  { method: 'GET', pattern: /^\/api\/rev$/ },
  { method: 'GET', pattern: /^\/api\/notifications$/ },
  { method: 'DELETE', pattern: /^\/api\/notifications\/[^/]+$/ }, // a kid's own device removes its own privacy notes only (routes/push.ts)
  { method: 'GET', pattern: /^\/api\/push\/vapid-public-key$/ },
  { method: 'GET', pattern: /^\/api\/push\/subscriptions$/ },
  { method: 'POST', pattern: /^\/api\/push\/subscriptions$/ },
  { method: 'PATCH', pattern: /^\/api\/push\/subscriptions\/[^/]+$/ },
  { method: 'DELETE', pattern: /^\/api\/push\/subscriptions\/[^/]+$/ },
  { method: 'POST', pattern: /^\/api\/push\/test\/[^/]+$/ },
];

// What a connected app may never do, whatever its scope: manage how anyone signs in. That's API and
// device keys, recovery codes, passkeys, pairing displays, whose device a sign-in is, the sign-in
// providers and the public address, and other connected apps. Otherwise an app could mint itself a
// permanent key that outlives revoking it. The passkey ceremony routes are public, so
// routes/passkeys.ts asks connectedAppBlock itself.
const CONNECTED_APP_DENIED: { method: RegExp; pattern: RegExp }[] = [
  { method: /^(POST)$/, pattern: /^\/api\/keys$/ },
  { method: /^(PATCH|DELETE)$/, pattern: /^\/api\/keys\/[^/]+$/ },
  { method: /^(POST)$/, pattern: /^\/api\/device-keys$/ },
  { method: /^(DELETE)$/, pattern: /^\/api\/device-keys\/self$/ },
  { method: /^(POST)$/, pattern: /^\/api\/recovery-codes$/ },
  { method: /^(POST)$/, pattern: /^\/api\/passkeys\/register-token$/ },
  { method: /^(PATCH|DELETE)$/, pattern: /^\/api\/passkeys\/[^/]+$/ },
  { method: /^(POST)$/, pattern: /^\/api\/pair\/approve$/ },
  { method: /^(PUT)$/, pattern: /^\/api\/me\/owner$/ },
  { method: /^(PUT|DELETE)$/, pattern: /^\/api\/providers\/[^/]+$/ },
  { method: /./, pattern: /^\/api\/authorizations(\/.*)?$/ },
  { method: /^(GET)$/, pattern: /^\/api\/security-events$/ }, // the security log: parent devices only
];

/** The 403 message when a connected app (mcp-oauth isConnectedApp) asks to manage sign-ins, else null. */
export async function connectedAppBlock(c: Context<{ Bindings: Env }>): Promise<string | null> {
  return (await isConnectedApp(c)) ? "Connected apps can't create or change sign-ins. Do this from a parent's own device." : null;
}

// Kinwall's own phone/tablet app signs in on its family.kinwall.app: link. Only its sign-ins are a
// person's device. Decided from the link the sign-in actually used (oauth_grants.device_app, set at
// the code exchange), never from what else the client registered.
export const DEVICE_APP_SCHEME = 'family.kinwall.app:';
export const isDeviceAppLink = (uri: string) => uri.startsWith(DEVICE_APP_SCHEME);

/** The grant of an OAuth key that Kinwall's own app signed in with, else null. */
export async function deviceAppGrant(db: KinwallDb, keyId: string | undefined): Promise<string | null> {
  const row = await db.prepare('SELECT g.id FROM api_keys k JOIN oauth_grants g ON g.id = k.oauth_grant_id WHERE k.id = ? AND g.device_app = 1')
    .bind(keyId ?? '').first<{ id: string }>();
  return row?.id ?? null;
}

/** A connected app (Claude and other AI connectors, automations), not one of the family's own
 * devices: every MCP tool call (mcp.ts marks its in-process requests), whatever key it uses, and
 * an OAuth token on REST unless Kinwall's own app signed in with it. The family's own API keys,
 * passkey sessions and pairings on REST are the family's. Health stays away from these unless the
 * family turns on aiHealthAccess (AGENTS.md "Health data"), and they never manage sign-ins
 * (CONNECTED_APP_DENIED). */
export async function isConnectedApp(c: Context<{ Bindings: Env }>): Promise<boolean> {
  if (c.req.header('X-Kinwall-Source') === 'mcp') return true;
  const key = await requestKey(c);
  return key?.kind === 'oauth' && !(await deviceAppGrant(c.env.DB, key.id));
}

function isDisplayAllowed(method: string, path: string): boolean {
  return DISPLAY_ALLOWED.some((rule) => rule.method === method && rule.pattern.test(path));
}

// Routes that can't send a header, so they take the key as ?key=: the OAuth start and the photo zip
// (browser navigations) and a photo's or recipe photo's bytes (an <img src>). Nowhere else - a key in a URL ends up in logs.
const QUERY_KEY_PATH = /^\/api\/oauth\/[^/]+\/start$|^\/api\/photos\/[^/]+\/image$|^\/api\/(recipes|meals)\/[^/]+\/image$|^\/api\/recipes\/[^/]+\/steps\/\d+\/image$|^\/api\/photos\/export\.zip$/;

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

  const row = await c.env.DB.prepare('SELECT id, name, scope, expires_at, kind, last_used_at, owner, device_kind FROM api_keys WHERE hash = ?')
    .bind(hash)
    .first<{ id: string; name: string; scope: string | null; expires_at: string | null; kind: string | null; last_used_at: string | null; owner: string | null; device_kind: KeyDeviceKind | null }>();
  if (!row) return null;
  if (row.expires_at && row.expires_at < new Date().toISOString()) return null; // expired session key
  return {
    id: row.id,
    name: row.name,
    scope: row.scope === 'display' ? 'display' : 'admin',
    kind: row.kind === 'session' ? 'session' : row.kind === 'oauth' ? 'oauth' : 'api',
    lastUsedAt: row.last_used_at,
    owner: row.owner,
    deviceKind: row.device_kind,
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
  if (CONNECTED_APP_DENIED.some((r) => r.method.test(c.req.method) && r.pattern.test(c.req.path))) {
    const blocked = await connectedAppBlock(c);
    if (blocked) return c.json({ error: blocked }, 403);
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
