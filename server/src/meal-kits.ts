import type { KinwallDb } from './db.ts';
import { kitBalances } from './kit-balances.ts';

export type KitRow = { id: string; recipe_id: string | null; kind: 'kit' | 'prepped' | 'frozen'; cook_by: string | null; title: string | null; provider: string; received_on: string; quantity: number; done: number; created_at: string; updated_at: string };
export { kitBalances } from './kit-balances.ts';
export async function readKitDays(db: KinwallDb) {
  const row = await db.prepare("SELECT value FROM settings WHERE key = 'mealKitDays'").first<{ value: string }>();
  const days = Number(row?.value ?? 7);
  return Number.isInteger(days) && days >= 1 && days <= 14 ? days : 7;
}
export async function readMealKits(db: KinwallDb, recipeId?: string | string[], includeUsed = false) {
  if (Array.isArray(recipeId) && !recipeId.length) return [];
  const filter = (column: string) => Array.isArray(recipeId) ? `${column} IN (SELECT value FROM json_each(?))` : recipeId ? `${column} = ?` : '1';
  const values = Array.isArray(recipeId) ? [JSON.stringify(recipeId)] : recipeId ? [recipeId] : [];
  const [kits, cooked, days] = await Promise.all([
    db.prepare(`SELECT k.*, r.name AS recipe_name, r.image_url FROM meal_kits k LEFT JOIN recipes r ON r.id = k.recipe_id WHERE ${filter('k.recipe_id')} ORDER BY k.received_on, k.id`).bind(...values).all<KitRow & { recipe_name: string | null; image_url: string | null }>(),
    db.prepare(`SELECT id, recipe_id, ready_id, date, status, meal_kind FROM meals WHERE status = 'prepared' AND ready_id IS NOT NULL AND ready_id IN (SELECT id FROM meal_kits WHERE ${filter('recipe_id')}) UNION SELECT id, recipe_id, ready_id, date, status, meal_kind FROM meals WHERE status = 'prepared' AND recipe_id IS NOT NULL AND recipe_id IN (SELECT recipe_id FROM meal_kits WHERE ${filter('recipe_id')}) ORDER BY date`).bind(...values, ...values).all<{ recipe_id: string | null; ready_id: string | null; date: string; status: string; meal_kind: string }>(),
    readKitDays(db),
  ]);
  return kitBalances(kits.results, cooked.results, days)
    .filter(k => includeUsed || k.left > 0).sort((a, b) => a.received_on.localeCompare(b.received_on) || a.id.localeCompare(b.id))
    .map(k => ({ id: k.id, recipeId: k.recipe_id, recipeName: k.recipe_name ?? k.title ?? '', kind: k.kind, title: k.title, provider: k.provider, receivedOn: k.received_on, cookBy: k.cookBy, quantity: k.quantity, left: k.left, imageUrl: k.image_url }));
}
