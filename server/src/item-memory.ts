// "Remembers where things go": the store, category and aisle last used for an item name, shared by
// every device and the MCP (migration 0040). One row per (name, store): the newest row gives the
// store and category, the row for the chosen store gives the aisle - milk can be in Aisle 4 at one
// store and on the back wall at another.
import type { KinwallDb, KinwallStatement } from './db.ts';

/** A matching key, not a display name: case, spacing and simple-plural insensitive, so "Eggs" =
 * "egg", "Tomatoes" = "tomato", "Berries" = "berry", "Cookies" = "cookie". Drops a plural s, then
 * a final e, then turns a final y into i. migrations/0040_groceries.sql backfills with the same rules. */
export function itemKey(title: string): string {
  let s = title.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  if (s.length > 3 && s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1);
  if (s.length > 2 && s.endsWith('e')) s = s.slice(0, -1);
  if (s.endsWith('y')) s = s.slice(0, -1) + 'i';
  return s;
}

export type Place = { store: string | null; category: string | null; aisle: string | null };
type MemoryRow = { name_key: string; store: string; category: string | null; aisle: string | null; updated_at: string };

/** Every remembered row for these titles, newest first per name - one query. */
export async function recall(db: KinwallDb, titles: string[]): Promise<Map<string, MemoryRow[]>> {
  const keys = [...new Set(titles.map(itemKey))];
  const out = new Map<string, MemoryRow[]>();
  if (!keys.length) return out;
  const { results } = await db
    .prepare('SELECT * FROM item_memory WHERE name_key IN (SELECT value FROM json_each(?)) ORDER BY updated_at DESC')
    .bind(JSON.stringify(keys))
    .all<MemoryRow>();
  for (const r of results) out.set(r.name_key, [...(out.get(r.name_key) ?? []), r]);
  return out;
}

/** Fill what the caller left out (undefined) from memory; an explicit value or null always wins. */
export function fillPlace(memory: Map<string, MemoryRow[]>, title: string, input: Partial<Place>): Place {
  const rows = memory.get(itemKey(title)) ?? [];
  const latest = rows[0];
  const store = input.store !== undefined ? input.store : latest?.store || null;
  const category = input.category !== undefined ? input.category : latest?.category ?? null;
  const aisle = input.aisle !== undefined ? input.aisle : rows.find((r) => r.store === (store ?? ''))?.aisle ?? null;
  return { store, category, aisle };
}

/** Remember an item's place, or null when it has none (nothing to remember - never forgets). */
export function rememberPlace(db: KinwallDb, title: string, place: Place, now: string): KinwallStatement | null {
  if (!place.store && !place.category && !place.aisle) return null;
  return db
    .prepare(
      `INSERT INTO item_memory (name_key, store, category, aisle, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(name_key, store) DO UPDATE SET category = excluded.category, aisle = excluded.aisle, updated_at = excluded.updated_at`,
    )
    .bind(itemKey(title), place.store ?? '', place.category, place.aisle, now);
}
