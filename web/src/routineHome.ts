import type { RoutineState } from './routineMode.ts'

type Child = { id: string; grownUp?: boolean }
export function routineHomeMembers<T extends Child>(members: T[], parent: boolean, ownId: string | null, selectedId: string | null, focusId: string | null): T[] {
  return members.filter(m => !m.grownUp && (parent || m.id === ownId) && (!selectedId || m.id === selectedId) && (!focusId || m.id === focusId))
}
export function routineChild(children: { id: string }[], ownId: string | null, requested: string | null): string {
  return children.find(m => m.id === requested)?.id ?? children.find(m => m.id === ownId)?.id ?? children[0]?.id ?? ''
}
/** Home reports the last fresh server decision; ordinary chore totals cannot grant free time. */
export function routineHomeStatus(state: RoutineState, unavailable: boolean, now: number): 'locked' | 'ready' | 'scheduled' | 'bedtime' | 'unknown' | null {
  if (!state.enabled) return null
  const checked = Date.parse(state.checkedAt), until = Date.parse(state.validUntil)
  if (unavailable || !Number.isFinite(checked) || !Number.isFinite(until) || now - checked > 90000 || checked - now > 30000 || (until <= now && state.reason !== 'bedtime')) return 'unknown'
  return state.reason === 'bedtime' ? 'bedtime' : state.reason === 'scheduled' ? 'scheduled' : state.locked ? 'locked' : 'ready'
}
