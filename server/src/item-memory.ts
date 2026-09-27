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

/** Remember an item's name for autocomplete (migration 0041): its spelling, and one more use when
 * added (uses 0 for a rename). Goes in the same batch as the add. */
export function rememberName(db: KinwallDb, title: string, now: string, uses = 1): KinwallStatement {
  return db
    .prepare(
      `INSERT INTO item_names (name_key, title, uses, last_used) VALUES (?, ?, max(?, 1), ?)
       ON CONFLICT(name_key) DO UPDATE SET title = excluded.title, uses = item_names.uses + ?, last_used = excluded.last_used`,
    )
    .bind(itemKey(title), title.trim(), uses, now, uses);
}

export const SUGGESTION_CAP = 300;
export type NameSuggestion = { title: string; key: string; uses: number; category?: string; place?: { store: string; aisle: string | null } };

/** Autocomplete for a shopping list: remembered names (most used, then most recent, first - as
 * queried), each with its department and where it goes (at `store` when given, else its newest
 * store); then recipe ingredients not yet bought (uses 0), up to the cap. A name that only has its
 * key for a spelling (backfilled) takes an ingredient's spelling when one matches. */
export function nameSuggestions(
  names: { name_key: string; title: string; uses: number }[],
  memory: { name_key: string; store: string; category: string | null; aisle: string | null }[], // newest first
  ingredients: { name: string; category: string | null }[],
  store?: string,
): NameSuggestion[] {
  const rows = new Map<string, typeof memory>();
  for (const r of memory) rows.set(r.name_key, [...(rows.get(r.name_key) ?? []), r]);
  const byKey = new Map(ingredients.map((i) => [itemKey(i.name), i] as const));
  const out: NameSuggestion[] = names.map((n) => {
    const mine = rows.get(n.name_key) ?? [];
    const at = (store && mine.find((r) => r.store === store)) || mine.find((r) => r.store);
    const category = mine.find((r) => r.category)?.category ?? byKey.get(n.name_key)?.category;
    const title = n.title === n.name_key ? (byKey.get(n.name_key)?.name.trim() ?? n.title) : n.title;
    return { title, key: n.name_key, uses: n.uses, ...(category ? { category } : {}), ...(at ? { place: { store: at.store, aisle: at.aisle } } : {}) };
  });
  const seen = new Set(out.map((s) => s.key));
  for (const [key, i] of byKey) {
    if (out.length >= SUGGESTION_CAP) break;
    if (seen.has(key) || !key) continue;
    seen.add(key);
    out.push({ title: i.name.trim(), key, uses: 0, ...(i.category ? { category: i.category } : {}) });
  }
  return out.slice(0, SUGGESTION_CAP);
}
