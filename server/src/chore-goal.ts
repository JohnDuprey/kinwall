// Calendar-date math shared with the web editor. UTC here represents a date, never a local instant.
export type ChoreGoal = { times: number; every: number; unit: 'day' | 'week' | 'month'; weekStart: number };
export type GoalProgress = { done: number; pending: number; target: number; from: string; to: string; full: boolean };
const parse = (key: string) => new Date(`${key}T00:00:00Z`);
const key = (date: Date) => date.toISOString().slice(0, 10);
export const shiftGoalDate = (date: string, n: number) => key(new Date(parse(date).getTime() + n * 86400000));
export function goalPeriod(goal: ChoreGoal, anchor: string, date: string): { from: string; to: string } {
  const a = parse(anchor), d = parse(date);
  if (goal.unit === 'month') {
    const first = a.getUTCFullYear() * 12 + a.getUTCMonth();
    const current = d.getUTCFullYear() * 12 + d.getUTCMonth();
    const month = first + Math.floor((current - first) / goal.every) * goal.every;
    const start = new Date(Date.UTC(Math.floor(month / 12), month % 12, 1));
    const end = new Date(start); end.setUTCMonth(end.getUTCMonth() + goal.every); end.setUTCDate(0);
    return { from: key(start), to: key(end) };
  }
  const anchorDay = goal.unit === 'week' ? shiftGoalDate(anchor, -((a.getUTCDay() - goal.weekStart + 7) % 7)) : anchor;
  const days = goal.every * (goal.unit === 'week' ? 7 : 1);
  const offset = Math.floor((d.getTime() - parse(anchorDay).getTime()) / (86400000 * days)) * days;
  const from = shiftGoalDate(anchorDay, offset);
  return { from, to: shiftGoalDate(from, days - 1) };
}
export function readChoreGoal(raw: string | null | undefined): ChoreGoal | null {
  if (!raw) return null;
  try { return JSON.parse(raw) as ChoreGoal; } catch { return null; }
}
export function maxGoalTimes(goal: ChoreGoal): number {
  // Every period must have enough distinct days, including February in a non-leap year.
  return Math.min(9999, goal.every * (goal.unit === 'day' ? 1 : goal.unit === 'week' ? 7 : 28));
}
