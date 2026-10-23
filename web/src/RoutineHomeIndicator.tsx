import { t, tn } from './i18n.ts'
import { routineHomeStatus } from './routineHome.ts'
import type { HomeRoutine } from './useHomeRoutine.ts'

export default function RoutineHomeIndicator({ rows, parent, chip = false }: { rows: HomeRoutine[]; parent: boolean; chip?: boolean }) {
  const now = Date.now()
  const links = rows.flatMap(row => {
    const status = routineHomeStatus(row.state, row.unavailable, now)
    if (!status) return []
    const left = row.state.remaining.length
    const label = status === 'locked' ? parent ? tn(left, '{name}: one chore left before free time', '{name}: {n} chores left before free time', { name: row.name }) : tn(left, 'One chore left before free time', '{n} chores left before free time')
      : status === 'bedtime' ? parent ? t('{name}: free time is finished for today', { name: row.name }) : t('Free time is finished for today')
      : status === 'unknown' ? parent ? t('{name}: check free time', { name: row.name }) : t('Check free time')
      : parent ? t('{name}: free time is available', { name: row.name }) : t('Free time is available')
    const icon = status === 'locked' ? '🔒' : status === 'bedtime' ? '🌙' : status === 'unknown' ? '◷' : '✓'
    return [<a key={row.id} className={chip ? 'board-slot-chip' : 'board-slot-row'} href={`#/routine?child=${encodeURIComponent(row.id)}`} aria-label={label}>
      <span aria-hidden="true">{icon}</span>
      {chip ? <>
        <span className="board-slot-chip-text board-slot-chip-short">{parent ? t('{name}: free time', { name: row.name }) : t('Free time')}</span>
        <span className="board-slot-chip-text board-slot-chip-long">{label}</span>
      </> : <span className="board-slot-row-text">{label}</span>}
    </a>]
  })
  if (!links.length) return null
  return chip ? <>{links}</> : <div className="board-routine-indicators">{links}</div>
}
