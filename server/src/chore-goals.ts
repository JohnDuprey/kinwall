import type { KinwallDb } from './db.ts';
import { goalPeriod, readChoreGoal } from './chore-goal.ts';
import type { GoalProgress } from './chore-goal.ts';

type GoalRow = { id: string; due_date: string | null; repeat_goal?: string | null };
/** Approved days make progress. Pending days reserve a place until a parent decides. */
export async function goalProgressFor(db: KinwallDb, rows: GoalRow[], date: string): Promise<Map<string, GoalProgress>> {
  const goals = rows.flatMap(row => {
    const goal = readChoreGoal(row.repeat_goal);
    if (!goal || !row.due_date) return [];
    const period = goalPeriod(goal, row.due_date, date);
    return [{ id: row.id, goal, ...period, countFrom: row.due_date > period.from ? row.due_date : period.from }];
  });
  if (!goals.length) return new Map();
  const results = await db.batch<{ done: number; pending: number }>(goals.map(g => db.prepare("SELECT COALESCE(SUM(status = 'approved'), 0) AS done, COALESCE(SUM(status = 'pending'), 0) AS pending FROM chore_completions WHERE chore_id = ? AND date BETWEEN ? AND ?").bind(g.id, g.countFrom, g.to)));
  return new Map(goals.map((g, i) => {
    const { done, pending } = results[i].results[0];
    return [g.id, { done: Number(done), pending: Number(pending), target: g.goal.times, from: g.from, to: g.to, full: Number(done) + Number(pending) >= g.goal.times }];
  }));
}
