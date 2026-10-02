// Workers-compatible. Fixed-window attempt counter in the rate_limits table (migration 0016).
import type { KinwallDb } from './db.ts';
import type { Env } from './env.ts';

const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000; // windows longer than this would be pruned early

/**
 * The caller's address, for per-address limits. The host decides how to find it (`Env.CLIENT_IP`);
 * a header is only as honest as whoever set it, so nothing here reads X-Forwarded-For on its own.
 * Without a host resolver (Cloudflare Workers / the hosted Durable Object) it is `cf-connecting-ip`,
 * which Cloudflare always sets and overwrites. Null when unknown; callers share one bucket then.
 */
export function clientIp(c: { req: { raw: Request }; env: Pick<Env, 'CLIENT_IP'> }): string | null {
  const resolve = c.env?.CLIENT_IP;
  return resolve ? resolve(c.req.raw) : c.req.raw.headers.get('cf-connecting-ip');
}

/**
 * Node's resolver. `remote` is the socket's peer. Ignores every header unless `trustProxy` (one
 * reverse proxy that appends the peer it saw to X-Forwarded-For): then the right-most entry, the one
 * our proxy added; anything to its left is whatever the client sent. HA ingress requests come from
 * the Supervisor, whose headers describe the HA proxy chain, so they count as one address.
 */
export function nodeClientIp(remote: string | undefined, xff: string | null, trustProxy: boolean, ingress: boolean): string | null {
  if (ingress) return 'ingress';
  if (trustProxy) {
    const last = xff?.split(',').pop()?.trim();
    if (last) return last;
  }
  return remote?.replace(/^::ffff:/, '') || null;
}

/** Counts one attempt against `key`; false once more than `max` land within `windowMs`. */
export async function checkRate(db: KinwallDb, key: string, max: number, windowMs: number): Promise<boolean> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const windowCutoff = new Date(now - windowMs).toISOString();
  await db.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(new Date(now - PRUNE_AFTER_MS).toISOString()).run();
  // SET expressions all read the pre-update row, so both CASEs see the old window_start.
  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, count, window_start) VALUES (?, 1, ?)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN window_start < ? THEN 1 ELSE count + 1 END,
         window_start = CASE WHEN window_start < ? THEN excluded.window_start ELSE window_start END
       RETURNING count`,
    )
    .bind(key, nowIso, windowCutoff, windowCutoff)
    .first<{ count: number }>();
  return (row?.count ?? 1) <= max;
}

/** Clears a key's window, e.g. when the thing being guessed is replaced. */
export async function resetRate(db: KinwallDb, key: string): Promise<void> {
  await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
}
