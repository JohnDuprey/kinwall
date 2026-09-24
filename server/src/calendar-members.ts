// Shared by routes/calendars.ts, routes/events.ts and routes/members.ts (delete cascade) -
// calendars.member_ids (JSON array) is the one source of truth for which members a calendar
// belongs to (see migration 0008; the old single member_id column is kept only for compat and
// nothing here reads it).

export function parseMemberIds(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

// Dedupes and drops any id that isn't a real member, so a calendar never ends up "assigned" to
// a stale/typo'd id.
export async function resolveMemberIds(db: D1Database, ids: string[]): Promise<string[]> {
  const deduped = [...new Set(ids)];
  if (deduped.length === 0) return deduped;
  const placeholders = deduped.map(() => '?').join(',');
  const { results } = await db.prepare(`SELECT id FROM members WHERE id IN (${placeholders})`).bind(...deduped).all<{ id: string }>();
  const known = new Set(results.map((r) => r.id));
  return deduped.filter((id) => known.has(id));
}
