// Workers-compatible. Fixed-window attempt counter in the rate_limits table (migration 0016).
import type { KinwallDb } from './db.ts';

const PRUNE_AFTER_MS = 24 * 60 * 60 * 1000; // windows longer than this would be pruned early

/** Client address as seen behind Cloudflare / a reverse proxy; null on a direct connection. */
export function clientIp(c: { req: { header(name: string): string | undefined } }): string | null {
  return c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? null;
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
