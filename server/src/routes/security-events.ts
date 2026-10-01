// The family's security log: sign-ins and sign-outs, passkeys, recovery codes, API and widget keys,
// paired devices, connected apps, whose device something is, the Night PIN and private
// journal changes. Parent devices read it under Settings → Access → Security activity
// (GET /api/security-events); wall screens, kids' devices and connected apps never do (auth.ts).
// Never secrets: no keys, tokens, codes or credential IDs, only names a parent gave things. Not in
// webhooks (nothing here emits) or the export (routes/data.ts): it's about this server's sign-ins.
// Most of it stays out of the family's notifications; a new passkey and a recovery-code sign-in
// also push to parent devices (pushGrownUps), since a parent should notice those right away.
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import { createRouter } from '../router.ts';
import type { KinwallDb, KinwallStatement } from '../db.ts';
import { waitUntil, type Env, type WaitCtx } from '../env.ts';
import { resolveKey, type Actor, type KeyDeviceKind } from '../auth.ts';
import { sendToSub } from '../notify.ts';
import { ErrorSchema } from '../schemas.ts';

export const SECURITY_KINDS = [
  'passkey.added', 'passkey.renamed', 'passkey.removed',
  'signin.passkey', 'signin.recovery', 'signout',
  'recovery.generated',
  'device.paired', 'device.owner',
  'key.created', 'key.removed', 'widgets.added', 'widgets.removed',
  'app.connected', 'app.disconnected',
  'pin.set', 'pin.removed',
  'journal.privacy',
] as const;
export type SecurityKind = (typeof SECURITY_KINDS)[number];
export type SecurityEvent = { kind: SecurityKind; summary: string; by?: Actor | null; device?: string | null; detail?: Record<string, string | number | boolean | null> };

export const SECURITY_KEEP = 500;
const SECURITY_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/** The insert plus the prune (a year, then the newest 500), for a caller's own batch. */
export function securityEventStmts(db: KinwallDb, e: SecurityEvent, now = new Date()): KinwallStatement[] {
  return [
    db
      .prepare('INSERT INTO security_events (id, at, kind, summary, actor_member_id, actor_label, device, detail) VALUES (?,?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), now.toISOString(), e.kind, e.summary, e.by?.memberId ?? null, e.by?.label ?? null, e.device ?? null, e.detail ? JSON.stringify(e.detail) : null),
    db
      .prepare('DELETE FROM security_events WHERE at < ? OR id NOT IN (SELECT id FROM security_events ORDER BY rowid DESC LIMIT ?)')
      .bind(new Date(now.getTime() - SECURITY_MAX_AGE_MS).toISOString(), SECURITY_KEEP),
  ];
}

export async function recordSecurityEvent(db: KinwallDb, e: SecurityEvent): Promise<void> {
  await db.batch(securityEventStmts(db, e));
}

/** A member's name, or "the whole family" for a shared device (or one that's nobody's). */
export async function ownerName(db: KinwallDb, owner: string | null | undefined): Promise<string> {
  if (!owner || owner === 'shared') return 'the whole family';
  return (await db.prepare('SELECT name FROM members WHERE id = ?').bind(owner).first<{ name: string }>())?.name ?? 'someone';
}

/** "Kitchen wall is now the whole family's" / "Maya's tablet now belongs to Maya (a kid's device)". */
export async function deviceOwnerEvent(db: KinwallDb, device: string, owner: string | null | undefined, kind: KeyDeviceKind | null | undefined, by: Actor | null): Promise<SecurityEvent> {
  const who = await ownerName(db, owner);
  const what = kind === 'wall' ? ' (a wall screen)' : kind === 'kid' ? " (a kid's device)" : kind === 'grownup' ? " (a grown-up's device)" : '';
  const summary = !owner || owner === 'shared' ? `"${device}" is now the whole family's${what}` : `"${device}" now belongs to ${who}${what}`;
  return { kind: 'device.owner', summary, by, device };
}

// A push to every parent device (full access) that has notifications on, in the background so a
// sign-in never waits on a push service. Not in the family's feed: the record is the security log.
const parentSubs = "SELECT s.* FROM push_subscriptions s JOIN api_keys k ON k.id = s.api_key_id WHERE k.scope = 'admin'";
export function pushGrownUps(c: Context<{ Bindings: Env }>, payload: { title: string; body: string }): void {
  let ctx: WaitCtx | undefined;
  try {
    ctx = c.executionCtx;
  } catch {
    ctx = undefined; // Node: no ExecutionContext
  }
  const env = c.env;
  waitUntil(ctx, (async () => {
    const { results } = await env.DB.prepare(parentSubs).all<Parameters<typeof sendToSub>[2]>();
    for (const row of results) await sendToSub(env, env.DB, row, { ...payload, url: '/#/settings?tab=access&section=security-activity', tag: 'security' });
  })());
}

export const securityEventsRoutes = createRouter();

const SecurityEventSchema = z
  .object({
    id: z.string(),
    at: z.string(),
    kind: z.enum(SECURITY_KINDS),
    summary: z.string().openapi({ description: 'What happened, in plain words ("Passkey "iPhone" added").' }),
    by: z.object({ memberId: z.string().nullable(), label: z.string().nullable() }).nullable().openapi({ description: "Who did it: a member (their own device, or a passkey's owner when signing in with it) or a device's or app's name. Null when unknown (the setup key, a recovery code)." }),
    device: z.string().nullable().openapi({ description: 'The passkey, key, device or app it was about, by the name it was given.' }),
    detail: z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()])).nullable(),
  })
  .openapi('SecurityEvent');
type Row = { id: string; at: string; kind: SecurityKind; summary: string; actor_member_id: string | null; actor_label: string | null; device: string | null; detail: string | null };

securityEventsRoutes.openapi(
  createRoute({
    method: 'get',
    path: '/api/security-events',
    tags: ['System'],
    summary: "The family's security activity, newest first: sign-ins, passkeys, recovery codes, keys, devices, connected apps (parent devices only; kept a year, up to 500). Search with q, filter with kinds.",
    security: [{ Bearer: [] }],
    request: {
      query: z.object({
        limit: z.coerce.number().int().min(1).max(100).optional().openapi({ description: 'Default 20.' }),
        before: z.string().optional().openapi({ description: "An event's id: only events older than it (paging: the last id of the page before)." }),
        q: z.string().max(100).optional().openapi({ description: "Only events whose summary, passkey/key/device/app name, or who did it (a member's name or a device's or app's name) contains this, ignoring case." }),
        kinds: z
          .string()
          .optional()
          .refine((s) => !s || s.split(',').every((k) => (SECURITY_KINDS as readonly string[]).includes(k)), { message: 'unknown kind' })
          .openapi({ description: 'Only these kinds, comma-separated (`signin.passkey,signin.recovery,signout`).', example: 'passkey.added,passkey.removed' }),
      }),
    },
    responses: {
      200: { description: 'ok', content: { 'application/json': { schema: z.array(SecurityEventSchema) } } },
      403: { description: 'not a parent device', content: { 'application/json': { schema: ErrorSchema } } },
    },
  }),
  async (c) => {
    // Display keys never get here (auth.ts DISPLAY_ALLOWED) and connected apps are refused there too.
    if ((await resolveKey(c))?.scope !== 'admin') return c.json({ error: 'Admin key required' }, 403);
    const { limit = 20, before, q, kinds } = c.req.valid('query');
    const where = ['e.rowid < coalesce((SELECT rowid FROM security_events WHERE id = ?), 9e18)'];
    const binds: unknown[] = [before ?? ''];
    const list = kinds ? kinds.split(',') : [];
    if (list.length) { where.push(`e.kind IN (${list.map(() => '?').join(',')})`); binds.push(...list); }
    const needle = q?.trim();
    if (needle) {
      // Bound, never spliced in; % and _ match themselves. SQLite's LIKE ignores case for A-Z only.
      where.push("(e.summary LIKE ? ESCAPE '\\' OR e.device LIKE ? ESCAPE '\\' OR e.actor_label LIKE ? ESCAPE '\\' OR m.name LIKE ? ESCAPE '\\')");
      const like = `%${needle.replace(/[\\%_]/g, '\\$&')}%`;
      binds.push(like, like, like, like);
    }
    // Newest first in the order they were written (rowid), so events in the same millisecond page right.
    const { results } = await c.env.DB
      .prepare(`SELECT e.* FROM security_events e LEFT JOIN members m ON m.id = e.actor_member_id WHERE ${where.join(' AND ')} ORDER BY e.rowid DESC LIMIT ?`)
      .bind(...binds, limit)
      .all<Row>();
    return c.json(
      results.map((r) => ({
        id: r.id, at: r.at, kind: r.kind, summary: r.summary,
        by: r.actor_member_id || r.actor_label ? { memberId: r.actor_member_id, label: r.actor_label } : null,
        device: r.device, detail: r.detail ? JSON.parse(r.detail) : null,
      })),
      200,
    );
  },
);
