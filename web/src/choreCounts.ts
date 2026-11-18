import { t, tn } from './i18n.ts'
import type { ChoreDateCount } from './types.ts'
export type ChoreCount = { total: number; remaining: number; pending: number }
type Countable = { ongoing?: boolean; memberId: string | null; completed: boolean; pending?: boolean; goalProgress?: { full: boolean } | null }
const visible = (memberId: string | null, selected: string | null, shared: boolean) => !selected || memberId === selected || memberId === null && shared
export function sumChoreCounts(rows: ChoreDateCount[], selected: string | null, shared: boolean): ChoreCount {
  return rows.filter(r => visible(r.memberId, selected, shared)).reduce((sum, r) => ({ total: sum.total + r.total, remaining: sum.remaining + r.remaining, pending: sum.pending + r.pending }), { total: 0, remaining: 0, pending: 0 })
}
/** The selected day's live cards include optimistic/offline ticks, before a range refresh arrives. */
export function countChoreDay(rows: Countable[], selected: string | null, shared: boolean): ChoreCount {
  const shown = rows.filter(r => !r.ongoing && visible(r.memberId, selected, shared) && (!r.goalProgress?.full || r.completed || r.pending))
  return { total: shown.length, remaining: shown.filter(r => !r.completed).length, pending: shown.filter(r => r.pending).length }
}
export function choreCountLabel(count: ChoreCount): string {
  if (!count.total) return t('No chores')
  if (!count.remaining) return t('All chores done')
  const left = tn(count.remaining, '{n} chore left', '{n} chores left')
  return count.pending ? t('{left}; {pending}', { left, pending: tn(count.pending, '{n} waiting for OK', '{n} waiting for OK') }) : left
}
