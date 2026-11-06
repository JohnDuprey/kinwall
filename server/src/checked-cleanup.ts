// Ticked items on grocery and shopping lists (kind 'shopping') are cleared once they've been ticked
// for clearCheckedAfterDays (1-30, default 7), like Clear checked on the list. What a family buys is
// remembered elsewhere (item_names, item_memory), so old ticked rows only make every list read grow.
// Other list types keep their history. Notes have no FK, so they go first, as on the list itself.
import type { KinwallDb } from './db.ts';

export const CHECKED_DAYS = { min: 1, max: 30, fallback: 7 } as const;

export function checkedDays(value: string | undefined): number {
  const n = Number(value);
  return Number.isInteger(n) ? Math.min(CHECKED_DAYS.max, Math.max(CHECKED_DAYS.min, n)) : CHECKED_DAYS.fallback;
}

// A row ticked before done_at existed counts from its last update.
const OLD = "done = 1 AND coalesce(done_at, updated_at) < ?1 AND list_id IN (SELECT id FROM lists WHERE kind = 'shopping')";

/** Clears them and returns the lists that changed (for their change events). */
export async function clearOldChecked(db: KinwallDb, now: Date): Promise<string[]> {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'clearCheckedAfterDays'").first<{ value: string }>();
  const cutoff = new Date(now.getTime() - checkedDays(row?.value) * 86_400_000).toISOString();
  const { results } = await db.prepare(`SELECT DISTINCT list_id FROM list_items WHERE ${OLD}`).bind(cutoff).all<{ list_id: string }>();
  if (!results.length) return [];
  await db.batch([
    db.prepare(`DELETE FROM notes WHERE target_type = 'list_item' AND target_id IN (SELECT id FROM list_items WHERE ${OLD})`).bind(cutoff),
    db.prepare(`DELETE FROM list_items WHERE ${OLD}`).bind(cutoff),
  ]);
  return results.map((r) => r.list_id);
}
