// Autocomplete for adding to a shopping list: pure matching over the remembered names that come
// with the list (ListDetail.suggestions.items), so it's instant and works offline.

/** The server's matching key (server/src/item-memory.ts itemKey) - keep in step: case, spacing and
 * simple-plural insensitive, so "Eggs" = "egg", "Berries" = "berry". */
export function itemKey(title: string): string {
  let s = title.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
  if (s.length > 3 && s.endsWith('s') && !/(ss|us|is)$/.test(s)) s = s.slice(0, -1)
  if (s.length > 2 && s.endsWith('e')) s = s.slice(0, -1)
  if (s.endsWith('y')) s = s.slice(0, -1) + 'i'
  return s
}

/** Up to `limit` names for what's typed: a word starting with it first, then containing it, each in
 * the given order (most used first). Names whose key is in `skip` (already on the list) are left out. */
export function matchItems<T extends { title: string; key: string }>(query: string, items: T[], skip: Set<string>, limit = 6): T[] {
  const q = query.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ')
  if (!q) return []
  // The key form only for a whole-ish word: itemKey("ye") would be "yi".
  const qs = q.length > 3 ? [q, itemKey(q)] : [q]
  const starts: T[] = [], contains: T[] = []
  for (const s of items) {
    if (skip.has(s.key)) continue
    const hay = [s.title.toLowerCase(), s.key]
    if (hay.some(h => qs.some(x => h.startsWith(x) || h.includes(` ${x}`)))) starts.push(s)
    else if (hay.some(h => qs.some(x => h.includes(x)))) contains.push(s)
    if (starts.length >= limit) break
  }
  return [...starts, ...contains].slice(0, limit)
}
