// "Start prep by" for calendar events tied to a meal (the event a planned meal made, or one the family
// linked to it). Where a trip counts down to leaving (travel time), a meal counts down to starting
// the cooking: the meal's time minus the recipe's time. Used by GET /api/events (prepAt, cookId),
// transition reminders (notify.ts) and, through the API, every "leave by" the web app shows.
import type { KinwallDb } from './db.ts';

/** With no recipe time (a freeform meal, or a recipe without times): half an hour. */
export const DEFAULT_PREP_MINUTES = 30;

type Times = { totalMinutes?: number | null; prepMinutes?: number | null } | null | undefined;

/** How long before the meal to start: the recipe's total time, else its prep time (Kinwall keeps
 * prep and total, not a separate cook time), else DEFAULT_PREP_MINUTES. */
export function mealPrepMinutes(recipe: Times): number {
  return recipe?.totalMinutes || recipe?.prepMinutes || DEFAULT_PREP_MINUTES;
}

/** When to start prep. An event that starts when cooking starts (calendarEventStart 'cooking')
 * already starts then; any other (at the meal time, or linked by the family) starts `minutes` earlier. */
export function prepAt(start: string, eventStart: 'meal' | 'cooking' | null | undefined, minutes: number): string {
  return eventStart === 'cooking' ? new Date(start).toISOString() : new Date(Date.parse(start) - minutes * 60000).toISOString();
}

/** firstStep: the recipe's first step, for a transition reminder's hint (nudges.ts stepHint). */
export type MealLink = { eventStart: 'meal' | 'cooking' | null; minutes: number; cookId: string | null; firstStep?: { title?: string | null; text: string; bullets?: string[] } | null };

type LinkRow = { event_id: string; event_start: 'meal' | 'cooking' | null; cook: string | null; snapshot: string | null; total_minutes: number | null; prep_minutes: number | null; steps: string | null };

/** Every event a meal is linked to, as one statement (for a caller's db.batch; read with parseMealLinks). */
export const mealLinksQuery = (db: KinwallDb) =>
  db.prepare(
    'SELECT m.calendar_event_id AS event_id, m.calendar_event_start AS event_start, m.assignee_member_id AS cook, m.recipe_snapshot AS snapshot, r.total_minutes, r.prep_minutes, r.steps ' +
      'FROM meals m LEFT JOIN recipes r ON r.id = m.recipe_id WHERE m.calendar_event_id IS NOT NULL',
  );

/** Event id -> how its prep time is worked out, and who cooks. */
export function parseMealLinks(rows: unknown[]): Map<string, MealLink> {
  const out = new Map<string, MealLink>();
  for (const r of rows as LinkRow[]) {
    let snap: Times = null;
    try { snap = r.snapshot ? JSON.parse(r.snapshot) : null; } catch { /* a bad snapshot falls back to the recipe */ }
    // The meal's own copy of the recipe first (what mealEvent sizes the event by), then the recipe.
    const minutes = mealPrepMinutes({ totalMinutes: snap?.totalMinutes ?? r.total_minutes, prepMinutes: snap?.prepMinutes ?? r.prep_minutes });
    let firstStep: MealLink['firstStep'] = null;
    try { firstStep = r.steps ? JSON.parse(r.steps)[0] ?? null : null; } catch { /* no hint */ }
    out.set(r.event_id, { eventStart: r.event_start, minutes, cookId: r.cook, firstStep });
  }
  return out;
}

/** Who a meal event's countdown is for: its cook when one is set, else the event's people. */
export const prepFor = (link: MealLink | undefined, memberIds: string[]): string[] => (link?.cookId ? [link.cookId] : memberIds);
