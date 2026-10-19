// One calendar implementation on the server and in the editor/demo.
export { goalPeriod, maxGoalTimes, shiftGoalDate } from '../../server/src/chore-goal.ts'
export type { ChoreGoal, GoalProgress } from '../../server/src/chore-goal.ts'

import { t, tn } from './i18n.ts'
import { maxGoalTimes } from '../../server/src/chore-goal.ts'
import type { ChoreGoal } from '../../server/src/chore-goal.ts'
export function validGoal(g: ChoreGoal): boolean {
  return Number.isInteger(g.times) && g.times >= 1 && g.times <= maxGoalTimes(g) && Number.isInteger(g.every) && g.every >= 1 && g.every <= 365
}
export function goalLabel(g: ChoreGoal): string {
  if (g.every === 1) return g.unit === 'day' ? tn(g.times, '{n} time per day', '{n} times per day')
    : g.unit === 'week' ? tn(g.times, '{n} time per week', '{n} times per week') : tn(g.times, '{n} time per month', '{n} times per month')
  const times = tn(g.times, '{n} time', '{n} times')
  return g.unit === 'day' ? t('{times} every {n} days', { times, n: g.every }) : g.unit === 'week' ? t('{times} every {n} weeks', { times, n: g.every }) : t('{times} every {n} months', { times, n: g.every })
}

export function goalProgressLabel(g: ChoreGoal, done: number): string {
  const values = { done, target: g.times }
  if (g.every === 1) return g.unit === 'day' ? t('{done} of {target} done today', values) : g.unit === 'week' ? t('{done} of {target} done this week', values) : t('{done} of {target} done this month', values)
  return t('{done} of {target} done this interval', values)
}
