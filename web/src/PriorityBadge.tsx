import type { ListItemPriority } from './types.ts'
import { msg, tm } from './i18n.ts'

export const PRIORITY_LABEL: Record<ListItemPriority, string> = { low: msg('Low'), normal: msg('Normal'), high: msg('High'), urgent: msg('Urgent') }
/** What a screen reader says for each badge (t() at render). */
const PRIORITY_ARIA: Record<ListItemPriority, string> = { low: msg('Low priority'), normal: msg('Normal priority'), high: msg('High priority'), urgent: msg('Urgent priority') }
/** A mark per priority that differs in shape, not only color, so it reads without color vision. */
export const PRIORITY_MARK: Record<ListItemPriority, string> = { low: '↓', normal: '', high: '!', urgent: '‼' }

/** "‼ Urgent", "! High", "↓ Low" on a list item (nothing for Normal). */
export function PriorityBadge({ p }: { p: ListItemPriority }) {
  if (p === 'normal') return null
  return (
    <span className={`prio-badge prio-${p}`} role="img" aria-label={tm(PRIORITY_ARIA[p])}>
      <span className="prio-mark" aria-hidden="true">{PRIORITY_MARK[p]}</span>{tm(PRIORITY_LABEL[p])}
    </span>
  )
}
