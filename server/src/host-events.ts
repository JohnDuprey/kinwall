// Workers-compatible. A family-visible log of actions taken by whoever hosts this instance (e.g.
// "restored from backup", "moved to a new server"). Kinwall itself never writes here - an
// embedding host calls recordHostEvent (re-exported from entry.ts); GET /api/host-events reads it.
import type { KinwallDb } from './db.ts';

export async function recordHostEvent(db: KinwallDb, action: string, detail?: string): Promise<void> {
  await db
    .prepare('INSERT INTO host_events (id, at, action, detail) VALUES (?, ?, ?, ?)')
    .bind(crypto.randomUUID(), new Date().toISOString(), action, detail ?? null)
    .run();
}
