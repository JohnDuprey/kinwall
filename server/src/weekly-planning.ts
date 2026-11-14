import { stored } from './i18n.ts';
// Calendar planning composes ordinary meals and list items; it never writes provider events.
import { HTTPException } from 'hono/http-exception';
import type { KinwallDb, KinwallStatement } from './db.ts';
import type { Actor } from './auth.ts';
import { hostTimezone } from './env.ts';
import { readSettings } from './routes/settings.ts';
import { todayInTz } from './routes/members.ts';
import { eventInstances } from './routes/events.ts';
import { buildMeal } from './routes/meals.ts';
import { listItemInsert } from './routes/lists.ts';
import { readMeal, readMeals, readRecipes, mealWrite } from './meals.ts';
import { readPantry, rankRecipes, expiringWithin } from './pantry.ts';
import { readJobs } from './upkeep.ts';
import { zonedTimeToUtc } from './recurrence.ts';
import type { PlanningApplied, PlanningDraft, WeeklyPlanning } from './weekly-planning-schemas.ts';

export class PlanningError extends HTTPException {
  constructor(message: string, status: 400 | 409 = 400) { super(status, { message }); }
}
export const addPlanningDays = (date: string, days: number) => {
  const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10);
};
export function nextPlanningWeek(today: string, weekStart: number): string {
  return addPlanningDays(today, (weekStart - new Date(`${today}T12:00:00Z`).getUTCDay() + 7) % 7 || 7);
}
const midnight = (date: string, tz: string) => zonedTimeToUtc({ y: +date.slice(0, 4), mo: +date.slice(5, 7) - 1, d: +date.slice(8, 10), h: 0, mi: 0, s: 0 }, tz);
const sourceVersion = async (db: KinwallDb) => (await db.prepare('SELECT version FROM weekly_plan_source WHERE id = 1').first<{ version: number }>())!.version;
const emptyDraft = (): PlanningDraft => ({ dinners: [], prep: [] });
const emptyApplied = (): PlanningApplied => ({ dinners: {}, prep: {} });
type PlanRow = { week_start: string; revision: number; draft: string; applied: string };
const planRow = (db: KinwallDb, week: string) => db.prepare('SELECT * FROM weekly_plans WHERE week_start = ?').bind(week).first<PlanRow>();

/** Before/after source versions prevent a review assembled from different source snapshots. */
export async function readWeeklyPlanning(db: KinwallDb, requested?: string): Promise<WeeklyPlanning> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const version = await sourceVersion(db);
    const settings = await readSettings(db);
    const timezone = settings.timezone ?? hostTimezone();
    const today = todayInTz(timezone);
    const weekStart = requested ?? nextPlanningWeek(today, settings.weekStart);
    if (new Date(`${weekStart}T12:00:00Z`).getUTCDay() !== settings.weekStart) throw new PlanningError(stored('error', 'Choose the first day of your family’s week.'));
    const dates = Array.from({ length: 7 }, (_, i) => addPlanningDays(weekStart, i));
    const end = dates[6];
    const features = { meals: settings.features.meals, lists: settings.features.lists, upkeep: settings.features.upkeep };
    const [row, events, meals, recipes, pantry, jobs, listRows, taskRows] = await Promise.all([
      planRow(db, weekStart),
      eventInstances(db, midnight(weekStart, timezone), midnight(addPlanningDays(end, 1), timezone)),
      features.meals ? readMeals(db, weekStart, end) : [],
      features.meals ? readRecipes(db, { kind: 'meal' }) : [],
      features.meals && features.lists ? readPantry(db, weekStart) : [],
      features.upkeep ? readJobs(db, today, iso => todayInTz(timezone, new Date(iso))) : [],
      features.lists ? db.prepare("SELECT id, name FROM lists WHERE kind = 'todo' AND purpose IS NULL AND archived = 0 ORDER BY sort, created_at").all<{ id: string; name: string }>() : { results: [] },
      features.lists ? db.prepare("SELECT li.id, li.title, li.due_date, li.event_id, li.list_id, li.done FROM list_items li JOIN lists l ON l.id = li.list_id WHERE l.kind = 'todo' AND l.purpose IS NULL AND l.archived = 0 AND li.done = 0 AND li.due_date BETWEEN ? AND ? ORDER BY li.due_date, li.sort").bind(weekStart, end).all<{ id: string; title: string; due_date: string | null; event_id: string | null; list_id: string; done: number }>() : { results: [] },
    ]);
    if (version !== await sourceVersion(db)) continue;
    // Expired food never becomes a suggestion for a future meal.
    const safePantry = pantry.filter(i => !i.useBy || i.useBy >= weekStart);
    const suggestions = rankRecipes(recipes, safePantry, expiringWithin(safePantry, 6)).slice(0, 8);
    return {
      weekStart, dates, timezone, sourceVersion: version, revision: row?.revision ?? 0,
      draft: row ? { dinners: features.meals ? JSON.parse(row.draft).dinners : [], prep: features.lists ? JSON.parse(row.draft).prep : [] } : emptyDraft(),
      applied: row ? { dinners: features.meals ? JSON.parse(row.applied).dinners : {}, prep: features.lists ? JSON.parse(row.applied).prep : {} } : emptyApplied(), features,
      events: events.map(e => ({ id: e.id, title: e.title, start: e.start, end: e.end, allDay: e.allDay, memberIds: e.memberIds, occurrenceStart: e.occurrenceStart })),
      meals: meals.map(m => ({ id: m.id, date: m.date, slot: m.slot, title: m.title, canSwap: m.status === 'planned' && m.mealKind !== 'dining_out' && !(m.calendarEventId && m.calendarEventStart) })),
      pantry: expiringWithin(safePantry, 6).filter(i => i.useBy).map(i => ({ id: i.id, title: i.title, useBy: i.useBy! })),
      recipes: recipes.map(r => ({ id: r.id, name: r.name, totalMinutes: r.totalMinutes ?? null })),
      suggestions: suggestions.map(s => ({ ...s.recipe, uses: s.uses.map(i => ({ title: i.title, useBy: i.useBy })) })),
      tasks: taskRows.results.map(i => ({ id: i.id, title: i.title, dueDate: i.due_date, eventId: i.event_id, listId: i.list_id, done: !!i.done })),
      jobs: jobs.filter(j => !j.archived && j.nextDue && j.nextDue <= end).map(j => ({ id: j.id, title: j.title, date: j.nextDue! })),
      lists: listRows.results,
    };
  }
  throw new PlanningError(stored('error', 'The week changed. Reload it before reviewing your plan.'), 409);
}
function validateDates(week: string, draft: PlanningDraft) {
  if (draft.dinners.some(m => m.date < week || m.date > addPlanningDays(week, 6)) || draft.prep.some(p => p.dueDate < addPlanningDays(week, -7) || p.dueDate > addPlanningDays(week, 6))) throw new PlanningError(stored('error', 'Choose dates in the planning week, or the week before for preparation.'));
}
// A failed compare-and-swap makes revision NULL, intentionally violating NOT NULL and aborting
// the entire D1/SQLite batch, before any domain writes. Concurrent requests cannot both win.
function guard(db: KinwallDb, week: string, revision: number, source?: number): KinwallStatement[] {
  return [
    db.prepare('INSERT OR IGNORE INTO weekly_plans (week_start) VALUES (?)').bind(week),
    db.prepare(`UPDATE weekly_plans SET revision = CASE WHEN revision = ? ${source === undefined ? '' : 'AND (SELECT version FROM weekly_plan_source WHERE id = 1) = ?'} THEN revision + 1 ELSE NULL END WHERE week_start = ?`).bind(revision, ...(source === undefined ? [] : [source]), week),
  ];
}
async function commit(db: KinwallDb, statements: KinwallStatement[]) {
  try { await db.batch(statements); }
  catch (e) {
    if (e instanceof Error && /weekly_plans\.revision|weekly_plan_applies\.id/.test(e.message)) throw new PlanningError(stored('error', 'The week or saved plan changed. Reload and review it before trying again.'), 409);
    throw e;
  }
}
export async function saveWeeklyDraft(db: KinwallDb, week: string, revision: number, draft: PlanningDraft) {
  const snapshot = await readWeeklyPlanning(db, week);
  if ((!snapshot.features.meals && draft.dinners.length) || (!snapshot.features.lists && draft.prep.length)) throw new PlanningError(stored('error', 'Turn on Meals or Lists before adding these choices.'));
  validateDates(week, draft);
  await commit(db, [...guard(db, week, revision), db.prepare('UPDATE weekly_plans SET draft = ? WHERE week_start = ?').bind(JSON.stringify(draft), week)]);
}

export async function applyWeeklyPlan(db: KinwallDb, week: string, input: { revision: number; sourceVersion: number; requestId: string; draft: PlanningDraft }, actor: Actor) {
  const request = JSON.stringify(input);
  const replay = await db.prepare('SELECT week_start, request FROM weekly_plan_applies WHERE id = ?').bind(input.requestId).first<{ week_start: string; request: string }>();
  if (replay) {
    if (replay.week_start !== week || replay.request !== request) throw new PlanningError(stored('error', 'This save was already used for a different plan. Reload and review your changes.'), 409);
    return { changed: false, mealIds: [] as string[], tasks: [] as { id: string; listId: string }[] };
  }
  const snapshot = await readWeeklyPlanning(db, week);
  if (snapshot.revision !== input.revision || snapshot.sourceVersion !== input.sourceVersion) throw new PlanningError(stored('error', 'The week or saved plan changed. Reload and review it before trying again.'), 409);
  validateDates(week, input.draft);
  if ((!snapshot.features.meals && input.draft.dinners.length) || (!snapshot.features.lists && input.draft.prep.length)) throw new PlanningError(stored('error', 'Turn on Meals or Lists before adding these choices.'));
  const applied = structuredClone(snapshot.applied);
  const writes: KinwallStatement[] = [];
  const mealIds: string[] = [], tasks: { id: string; listId: string }[] = [];
  for (const dinner of input.draft.dinners) {
    if (dinner.kind === 'open') continue;
    const choice = JSON.stringify(dinner);
    const previous = applied.dinners[dinner.date];
    if (previous?.choice === choice) continue; // an acknowledged choice never overwrites later Meals edits
    const target = dinner.replaceMealId ? snapshot.meals.find(m => m.id === dinner.replaceMealId && m.date === dinner.date && m.slot === 'dinner') : undefined;
    if (dinner.replaceMealId && (!target || !target.canSwap)) throw new PlanningError(stored('error', 'This dinner can no longer be swapped here. Refresh the week or open Meals.'), 409);
    if (!dinner.replaceMealId && (snapshot.meals.some(m => m.date === dinner.date && m.slot === 'dinner') || previous)) throw new PlanningError(stored('error', 'Dinner is already planned for that day. Change it in Meals.'), 409);
    const old = target ? await readMeal(db, target.id) : undefined;
    if (target && !old) throw new PlanningError(stored('error', 'This dinner can no longer be swapped here. Refresh the week or open Meals.'), 409);
    const meal = await buildMeal(db, { date: dinner.date, slot: 'dinner', title: dinner.title, mealKind: dinner.recipeId ? 'recipe' : 'freeform', recipeId: dinner.recipeId ?? null, ...(old ? { servings: old.servings, sourceUrl: null } : {}) }, old ?? undefined);
    if (typeof meal === 'string') throw new PlanningError(meal);
    if (dinner.recipeId && !(await readRecipes(db, { id: dinner.recipeId, kind: 'meal' })).length) throw new PlanningError(stored('error', 'Choose a meal recipe that is still in your library.'));
    writes.push(mealWrite(db, meal)); mealIds.push(meal.id);
    applied.dinners[dinner.date] = { id: meal.id, choice };
  }
  const now = new Date().toISOString();
  for (const prep of input.draft.prep) {
    const choice = JSON.stringify(prep), previous = applied.prep[prep.id];
    if (previous) {
      if (previous.choice !== choice) throw new PlanningError(stored('error', 'Preparation already added is edited in its to-do list.'), 409);
      continue;
    }
    const event = snapshot.events.find(e => e.id === prep.eventId && e.occurrenceStart === prep.occurrenceStart);
    if (!event || !snapshot.lists.some(l => l.id === prep.listId)) throw new PlanningError(stored('error', 'Choose a visible event and an active to-do list.'));
    const eventDay = event.allDay ? event.start.slice(0, 10) : todayInTz(snapshot.timezone, new Date(event.start));
    if (prep.dueDate > eventDay) throw new PlanningError(stored('error', 'Preparation must be due on or before its event.'));
    const id = crypto.randomUUID();
    const maxSort = await db.prepare('SELECT coalesce(max(sort), -1) AS m FROM list_items WHERE list_id = ?').bind(prep.listId).first<{ m: number }>();
    writes.push(listItemInsert(db, {
      id, list_id: prep.listId, title: prep.title, notes: null, quantity: null, store: null, category: null, aisle: null,
      member_id: null, for_member_ids: '[]', on_sale: 0, due_date: prep.dueDate, event_id: event.id, priority: 'normal',
      done: 0, done_at: null, done_by: null, added_by: actor.memberId, added_by_label: actor.label, sort: (maxSort?.m ?? -1) + 1 + tasks.length, created_at: now, updated_at: now,
    }));
    tasks.push({ id, listId: prep.listId }); applied.prep[prep.id] = { id, choice };
  }
  await commit(db, [
    ...guard(db, week, input.revision, input.sourceVersion), ...writes,
    db.prepare('UPDATE weekly_plans SET draft = ?, applied = ? WHERE week_start = ?').bind(JSON.stringify(input.draft), JSON.stringify(applied), week),
    db.prepare('INSERT INTO weekly_plan_applies (id, week_start, request) VALUES (?, ?, ?)').bind(input.requestId, week, request),
  ]);
  return { changed: true, mealIds, tasks };
}

/** Saved choices and links travel with JSON backups; source tokens and request receipts do not. */
export async function exportWeeklyPlans(db: KinwallDb) {
  const rows = (await db.prepare('SELECT * FROM weekly_plans ORDER BY week_start').all<PlanRow>()).results;
  return rows.map(row => ({ weekStart: row.week_start, revision: row.revision, draft: JSON.parse(row.draft) as PlanningDraft, applied: JSON.parse(row.applied) as PlanningApplied }));
}
