import type { ListItemPriority } from './types.ts'

export const PRIORITY_LABEL: Record<ListItemPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
/** A mark per priority that differs in shape, not only color, so it reads without color vision. */
export const PRIORITY_MARK: Record<ListItemPriority, string> = { low: '↓', normal: '', high: '!', urgent: '‼' }

/** "‼ Urgent", "! High", "↓ Low" on a list item (nothing for Normal). */
export function PriorityBadge({ p }: { p: ListItemPriority }) {
  if (p === 'normal') return null
  return (
    <span className={`prio-badge prio-${p}`} role="img" aria-label={`${PRIORITY_LABEL[p]} priority`}>
      <span className="prio-mark" aria-hidden="true">{PRIORITY_MARK[p]}</span>{PRIORITY_LABEL[p]}
    </span>
  )
}
