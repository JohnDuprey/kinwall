// "Remembers where things go": the store, category and aisle last used for an item name, shared by
// every device and the MCP (migration 0040). One row per (name, store): the newest row gives the
// store and category, the row for the chosen store gives the aisle - milk can be in Aisle 4 at one
// store and on the back wall at another.
// Each shopping list type has its own catalog (migration 0076): 'groceries' or 'shopping', a list's
// `catalog`. Every read and write here is scoped to one. Stores' aisle orders are shared.
import type { KinwallDb, KinwallStatement } from './db.ts';

export type Catalog = 'groceries' | 'shopping';
export const CATALOGS = ['groceries', 'shopping'] as const;

/** A shopping list named like groceries, in generic words ("Groceries", "Grocery run", "Food",
 * "Supermarket", "Farmers market", "Produce", "Pantry"; never store brands). Picks a new shopping list's type when none is given, and an older
 * export's. migrations/0076_list_catalogs.sql uses the same words. */
export function looksLikeGroceries(name: string): boolean {
  return /grocer|food|market|produce|pantry/i.test(name);
}

/** A list's catalog column: null unless it's a shopping list; else the given type, else groceries
 * when the name looks like it or the family has no Groceries list yet (the first shopping list is
 * the grocery list, as before list types), else shopping. */
export async function listCatalog(db: KinwallDb, kind: string, name: string, catalog?: Catalog | null): Promise<Catalog | null> {
  if (kind !== 'shopping') return null;
  if (catalog) return catalog;
  if (looksLikeGroceries(name)) return 'groceries';
  const any = await db.prepare("SELECT 1 FROM lists WHERE kind = 'shopping' AND coalesce(catalog, 'groceries') = 'groceries' AND archived = 0 LIMIT 1").first();
  return any ? 'shopping' : 'groceries';
}

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
export async function recall(db: KinwallDb, catalog: Catalog, titles: string[]): Promise<Map<string, MemoryRow[]>> {
  const keys = [...new Set(titles.map(itemKey))];
  const out = new Map<string, MemoryRow[]>();
  if (!keys.length) return out;
  const { results } = await db
    .prepare('SELECT * FROM item_memory WHERE catalog = ? AND name_key IN (SELECT value FROM json_each(?)) ORDER BY updated_at DESC')
    .bind(catalog, JSON.stringify(keys))
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
export function rememberPlace(db: KinwallDb, catalog: Catalog, title: string, place: Place, now: string): KinwallStatement | null {
  if (!place.store && !place.category && !place.aisle) return null;
  return db
    .prepare(
      `INSERT INTO item_memory (catalog, name_key, store, category, aisle, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(catalog, name_key, store) DO UPDATE SET category = excluded.category, aisle = excluded.aisle, updated_at = excluded.updated_at`,
    )
    .bind(catalog, itemKey(title), place.store ?? '', place.category, place.aisle, now);
}

/** Remember an item's name for autocomplete (migration 0041): its spelling, and one more use when
 * added (uses 0 for a rename). Goes in the same batch as the add. */
/** The family's own name for a product barcode in this catalog (migration 0085), else null. */
export async function recallBarcode(db: KinwallDb, catalog: Catalog, barcode: string): Promise<string | null> {
  return (await db.prepare('SELECT title FROM item_barcodes WHERE catalog = ? AND barcode = ?').bind(catalog, barcode).first<{ title: string }>())?.title ?? null;
}

/** A scanned item was added as `title`: the next scan of that barcode suggests it. */
export function rememberBarcode(db: KinwallDb, catalog: Catalog, barcode: string, title: string, now: string): KinwallStatement {
  return db
    .prepare('INSERT INTO item_barcodes (catalog, barcode, title, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(catalog, barcode) DO UPDATE SET title = excluded.title, updated_at = excluded.updated_at')
    .bind(catalog, barcode, title.trim(), now);
}

export function rememberName(db: KinwallDb, catalog: Catalog, title: string, now: string, uses = 1): KinwallStatement {
  return db
    .prepare(
      `INSERT INTO item_names (catalog, name_key, title, uses, last_used) VALUES (?, ?, ?, max(?, 1), ?)
       ON CONFLICT(catalog, name_key) DO UPDATE SET title = excluded.title, uses = item_names.uses + ?, last_used = excluded.last_used`,
    )
    .bind(catalog, itemKey(title), title.trim(), uses, now, uses);
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

// A catalog (GET/POST /api/lists/remembered, PUT/DELETE /api/lists/remembered/{key}):
// every remembered name, its department and where it's found at each store.
export type CatalogItem = {
  key: string;
  title: string;
  uses: number;
  lastUsed: string | null;
  category: string | null;
  places: { store: string; aisle: string | null; updatedAt: string }[];
  lastStore: string | null;
  tags: string[];
};

/** Every remembered item (names, plus places whose name was never kept), by title - or just `key`. */
export async function catalog(db: KinwallDb, cat: Catalog, key?: string): Promise<CatalogItem[]> {
  const only = key === undefined ? '' : ' AND name_key = ?';
  const binds = key === undefined ? [cat] : [cat, key];
  const [names, memory, tagRows] = await db.batch<unknown>([
    db.prepare(
      `SELECT k.name_key, n.title, n.uses, n.last_used FROM (SELECT name_key FROM item_names WHERE catalog = ?1 UNION SELECT name_key FROM item_memory WHERE catalog = ?1) k
       LEFT JOIN item_names n ON n.catalog = ?1 AND n.name_key = k.name_key${key === undefined ? '' : ' WHERE k.name_key = ?2'}`,
    ).bind(...binds),
    db.prepare(`SELECT * FROM item_memory WHERE catalog = ?${only} ORDER BY updated_at DESC`).bind(...binds),
    db.prepare(`SELECT name_key, tag FROM item_tags WHERE catalog = ?${only} ORDER BY sort`).bind(...binds),
  ]);
  const tags = new Map<string, string[]>();
  for (const r of tagRows.results as { name_key: string; tag: string }[]) tags.set(r.name_key, [...(tags.get(r.name_key) ?? []), r.tag]);
  const rows = new Map<string, MemoryRow[]>();
  for (const r of memory.results as MemoryRow[]) rows.set(r.name_key, [...(rows.get(r.name_key) ?? []), r]);
  return (names.results as { name_key: string; title: string | null; uses: number | null; last_used: string | null }[])
    .filter((n) => n.name_key)
    .map((n) => {
      const mine = rows.get(n.name_key) ?? []; // newest first
      return {
        key: n.name_key,
        title: n.title ?? n.name_key,
        uses: n.uses ?? 0,
        lastUsed: n.last_used,
        category: mine.find((r) => r.category)?.category ?? null,
        places: mine.filter((r) => r.store).map((r) => ({ store: r.store, aisle: r.aisle, updatedAt: r.updated_at })).sort((a, b) => a.store.localeCompare(b.store, undefined, { sensitivity: 'base' })),
        lastStore: mine.find((r) => r.store)?.store ?? null,
        tags: tags.get(n.name_key) ?? [],
      };
    })
    .sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

/** Search (title or matching key), store and category (tag, case ignored) filters for the catalog. */
export function filterCatalog(items: CatalogItem[], q?: string, store?: string, tag?: string): CatalogItem[] {
  const t = tag?.trim().toLowerCase();
  const text = q?.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
  const key = text ? itemKey(text) : '';
  return items.filter(
    (i) => (!text || i.title.toLowerCase().includes(text) || i.key.includes(key)) && (!store || i.places.some((p) => p.store === store)) && (!t || i.tags.some((x) => x.toLowerCase() === t)),
  );
}

export type CatalogEdit = { title?: string; category?: string | null; places?: { store: string; aisle?: string | null }[]; tags?: string[] };

/** An item's categories as saved: trimmed, each once ignoring case (the first spelling wins, or the
 * family's spelling when another item already has it). */
export function tagsInput(tags: string[], family: string[]): string[] {
  const known = new Map(family.map((t) => [t.toLowerCase(), t] as const));
  const out = new Map<string, string>();
  for (const raw of tags) {
    const t = raw.trim().replace(/\s+/g, ' ');
    if (t && !out.has(t.toLowerCase())) out.set(t.toLowerCase(), known.get(t.toLowerCase()) ?? t);
  }
  return [...out.values()];
}

/** The writes for a catalog edit of `from` (an existing item, or a new one when `existing` is null):
 * a new title respells it (a different matching key moves it there), category sets its department
 * on every place, and places replaces its stores (aisle per store; stores left out are forgotten).
 * New places are the newest, as if just bought there. The department is kept even with no place.
 * tags (already cleaned by tagsInput) replace its categories. */
export function catalogWrites(db: KinwallDb, cat: Catalog, from: string, existing: CatalogItem | null, edit: CatalogEdit, now: string): { key: string; writes: KinwallStatement[] } {
  const key = edit.title !== undefined ? itemKey(edit.title) : from;
  const writes: KinwallStatement[] = [];
  if (key !== from) {
    writes.push(db.prepare('UPDATE item_names SET name_key = ? WHERE catalog = ? AND name_key = ?').bind(key, cat, from));
    writes.push(db.prepare('UPDATE item_memory SET name_key = ? WHERE catalog = ? AND name_key = ?').bind(key, cat, from));
    writes.push(db.prepare('UPDATE OR REPLACE item_tags SET name_key = ? WHERE catalog = ? AND name_key = ?').bind(key, cat, from));
  }
  if (edit.tags) {
    writes.push(db.prepare('DELETE FROM item_tags WHERE catalog = ? AND name_key = ?').bind(cat, key));
    writes.push(db.prepare('INSERT INTO item_tags (catalog, name_key, tag, sort) SELECT ?, ?, value, key FROM json_each(?)').bind(cat, key, JSON.stringify(edit.tags)));
  }
  if (edit.title !== undefined || !existing) {
    writes.push(
      db.prepare('INSERT INTO item_names (catalog, name_key, title, uses, last_used) VALUES (?, ?, ?, 0, ?) ON CONFLICT(catalog, name_key) DO UPDATE SET title = excluded.title')
        .bind(cat, key, (edit.title ?? existing?.title ?? key).trim(), now),
    );
  }
  const category = edit.category !== undefined ? edit.category : existing?.category ?? null;
  if (edit.category !== undefined) writes.push(db.prepare('UPDATE item_memory SET category = ? WHERE catalog = ? AND name_key = ?').bind(category, cat, key));
  if (edit.places) {
    const stores = edit.places.map((p) => p.store);
    writes.push(db.prepare("DELETE FROM item_memory WHERE catalog = ? AND name_key = ? AND store != '' AND store NOT IN (SELECT value FROM json_each(?))").bind(cat, key, JSON.stringify(stores)));
    for (const p of edit.places) {
      writes.push(
        db.prepare(
          `INSERT INTO item_memory (catalog, name_key, store, category, aisle, updated_at) VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT(catalog, name_key, store) DO UPDATE SET aisle = excluded.aisle, category = excluded.category`,
        ).bind(cat, key, p.store, category, p.aisle ?? null, now),
      );
    }
  }
  // No place left (or none yet): a "no store" row keeps the department.
  writes.push(
    db.prepare("INSERT INTO item_memory (catalog, name_key, store, category, aisle, updated_at) SELECT ?1, ?2, '', ?3, NULL, ?4 WHERE ?3 IS NOT NULL AND NOT EXISTS (SELECT 1 FROM item_memory WHERE catalog = ?1 AND name_key = ?2)")
      .bind(cat, key, category, now),
  );
  return { key, writes };
}
