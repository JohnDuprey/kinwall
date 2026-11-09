// Late chores on the Board: one-off chores whose day passed without a tick (GET /api/board
// overdueChores). A count in the Chores spot opens a sheet to tick them off for their own day.
import { useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { announce } from './a11y.tsx'
import { DAY, formatDate, t, tn } from './i18n.ts'
import { Face } from './Face'
import Sheet from './Sheet.tsx'
import type { OverdueChore } from './types.ts'

const dayOf = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d) }

/** The count (as a Today slot item: chip, row, full) and the sheet it opens; no item while none are late. */
export function useLateChoresSlot(late: OverdueChore[]) {
  const { members, selectedMemberId, settings, toast, reloadCore } = useApp()
  const [open, setOpen] = useState(false)
  const [gone, setGone] = useState<Set<string>>(new Set()) // ticked here, until the Board reloads
  const [busy, setBusy] = useState<string | null>(null)
  const shown = late.filter(c => !gone.has(c.id))

  const done = async (c: OverdueChore) => {
    setBusy(c.id)
    try {
      // An Anyone chore counts for the person picked on this device, else the device's owner (server).
      const r = await api.completeChore(c.id, c.date, c.memberId ?? selectedMemberId ?? undefined) as { pending?: boolean }
      setGone(g => new Set(g).add(c.id))
      const pts = Math.round(c.points * settings.lateCompletionCredit / 100)
      const said = r.pending ? t("{title} done, waiting for a parent's OK", { title: c.title }) : tn(pts, '{title} done, {n} point', '{title} done, {n} points', { title: c.title })
      toast(said); announce(said)
      reloadCore()
    } catch (e) {
      // Its checklist has open items: open it on its day in Chores, to tick them off there.
      if (e instanceof ApiError && e.status === 409) { setOpen(false); location.hash = `#/chores?done=${encodeURIComponent(c.id)}&date=${c.date}`; return }
      toast(e instanceof ApiError ? e.message : t('Could not update chore'), true)
    }
    finally { setBusy(null) }
  }

  const sheets = open && shown.length > 0 && (
    <Sheet title={`⏰ ${t('Late chores')}`} onClose={() => setOpen(false)}>
      <ul className="meds-now-list">
        {shown.map(c => {
          const m = members.find(x => x.id === c.memberId)
          const due = t('Was due {day}', { day: formatDate(dayOf(c.date), DAY) })
          return (
            <li key={c.id} className="meds-now-item">
              <Face m={m ?? { name: t('Anyone'), color: 'var(--bg)', avatar: '⭐', picture: null }} className="board-avatar meds-now-avatar" aria-hidden="true" />
              <p className="meds-now-what">
                <strong>{c.emoji ? `${c.emoji} ` : ''}{c.title}</strong>
                <span>{m?.name ?? t('Anyone')} · {due}</span>
              </p>
              <button className="btn btn-primary late-chore-done" disabled={busy === c.id} aria-label={t('Mark {title} done', { title: c.title })} onClick={() => done(c)}>{t('Done')}</button>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
  if (!shown.length) return { item: null, sheets }
  const label = tn(shown.length, '{n} late chore', '{n} late chores')
  return {
    sheets,
    item: {
      key: 'late-chores',
      chip: <button type="button" className="board-slot-chip" aria-haspopup="dialog" aria-label={label} onClick={() => setOpen(true)}><span aria-hidden="true">⏰</span><span aria-hidden="true" className="board-slot-chip-text board-slot-chip-short snap-overdue">{shown.length}</span><span aria-hidden="true" className="board-slot-chip-text board-slot-chip-long snap-overdue">{label}</span></button>,
      row: <button type="button" className="board-slot-row" aria-haspopup="dialog" onClick={() => setOpen(true)}><span aria-hidden="true">⏰</span><span className="board-slot-row-text snap-overdue">{label}</span><span className="board-slot-row-meta" aria-hidden="true">›</span></button>,
      full: <button type="button" className="board-slot-row" aria-haspopup="dialog" onClick={() => setOpen(true)}><span aria-hidden="true">⏰</span><span className="board-slot-row-text snap-overdue">{label}</span><span className="board-slot-row-meta" aria-hidden="true">›</span></button>,
    },
  }
}
