// Category keyword matching, shared by routes/events.ts and routes/categories.ts. Mirrors
// calendar-members.ts's role for member tags: small pure helpers, no DB access.

export type CategoryRow = { id: string; name: string; emoji: string | null; color: string; keywords: string; sort: number; created_at: string };

export function parseKeywords(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : [];
  } catch {
    return [];
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Case-insensitive whole-word/phrase match: "bday" matches "Grandpa bday" but "soccer" doesn't
// match "soccerball". Keywords are literal text (regex-special chars escaped). Boundaries use
// \p{L}/\p{N} instead of \b so non-Latin scripts (e.g. accented names) still get real word
// boundaries, not just ASCII ones.
function keywordMatches(title: string, keyword: string): boolean {
  const trimmed = keyword.trim();
  if (!trimmed) return false;
  const re = new RegExp(`(?:^|[^\\p{L}\\p{N}])${escapeRegex(trimmed)}(?:$|[^\\p{L}\\p{N}])`, 'iu');
  return re.test(` ${title} `); // pad so a match at the very start/end still has a boundary char
}

// First category (in sort order) with a keyword matching the title wins - `categories` must
// already be sorted by sort for that to hold (routes/events.ts always fetches them that way).
export function matchCategoryByKeyword(title: string, categories: CategoryRow[]): CategoryRow | null {
  for (const cat of categories) {
    const keywords = parseKeywords(cat.keywords);
    if (keywords.some((kw) => keywordMatches(title, kw))) return cat;
  }
  return null;
}
