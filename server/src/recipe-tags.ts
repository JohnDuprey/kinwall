import type { KinwallDb, KinwallStatement } from './db.ts';
import type { Recipe, RecipeTag } from './meal-schemas.ts';

export function recipeTagNameKey(name: string): string {
  return name.toLowerCase().normalize('NFC');
}

export async function readRecipeTags(db: KinwallDb): Promise<RecipeTag[]> {
  return (await db.prepare('SELECT id, name FROM recipe_tags ORDER BY name_key, id').all<RecipeTag>()).results;
}

/** Keep destination names and IDs on a name collision. A clean restore keeps source IDs.
 * If an imported ID is already used by a differently named tag, allocate an ID for the imported name. */
export function recipeTagImportWrites(db: KinwallDb, catalog: RecipeTag[], recipes: Recipe[]): KinwallStatement[] {
  const tagged = recipes.filter(recipe => recipe.tags !== undefined);
  if (!catalog.length && !tagged.length) return [];

  const byName = new Map<string, RecipeTag>();
  for (const tag of [...catalog, ...tagged.flatMap(recipe => recipe.tags ?? [])]) {
    const key = recipeTagNameKey(tag.name);
    if (!byName.has(key)) byName.set(key, tag);
  }
  const names = JSON.stringify([...byName].map(([key, tag]) => ({ ...tag, key, fallbackId: crypto.randomUUID() })));
  const writes = [
    db.prepare(`INSERT INTO recipe_tags (id, name, name_key)
      SELECT value->>'id', value->>'name', value->>'key' FROM json_each(?) WHERE true
      ON CONFLICT DO NOTHING`).bind(names),
    db.prepare(`INSERT INTO recipe_tags (id, name, name_key)
      SELECT value->>'fallbackId', value->>'name', value->>'key'
      FROM json_each(?) j WHERE NOT EXISTS (SELECT 1 FROM recipe_tags WHERE name_key = j.value->>'key')`).bind(names),
  ];
  if (tagged.length) {
    const links = tagged.flatMap(recipe => (recipe.tags ?? []).map(tag => ({ recipeId: recipe.id, key: recipeTagNameKey(tag.name) })));
    writes.push(
      db.prepare('DELETE FROM recipe_tag_links WHERE recipe_id IN (SELECT value FROM json_each(?))').bind(JSON.stringify(tagged.map(recipe => recipe.id))),
      db.prepare(`INSERT INTO recipe_tag_links (recipe_id, tag_id)
        SELECT j.value->>'recipeId', t.id FROM json_each(?) j JOIN recipe_tags t ON t.name_key = j.value->>'key'
        WHERE true ON CONFLICT (recipe_id, tag_id) DO NOTHING`).bind(JSON.stringify(links)),
    );
  }
  return writes;
}
