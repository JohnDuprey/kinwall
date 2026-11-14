// Late chores on the Board: one-off chores whose day passed without a tick (GET /api/board
// overdueChores). A count in the Chores spot opens a sheet to tick them off for their own day.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { announce } from './a11y.tsx'
import { DAY, formatDate, t, tn } from './i18n.ts'
import { Face } from './Face'
import Sheet from './Sheet.tsx'
import { ChevronRight } from './icons.tsx'
import type { OverdueChore } from './types.ts'

const lateKey = (c: OverdueChore) => `${c.id}:${c.date}`
const dayOf = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d) }

/** The count (as a Today slot item: chip, row, full) and the sheet it opens; no item while none are late. */
export function useLateChoresSlot(late: OverdueChore[]) {
  const { members, selectedMemberId, settings, toast, reloadCore, parentDevice } = useApp()
  const [open, setOpen] = useState(false)
  const [gone, setGone] = useState<Set<string>>(new Set()) // ticked here, until the Board reloads
  const [busy, setBusy] = useState<string | null>(null)
  const shown = late.filter(c => !gone.has(lateKey(c)))
  // Once a refresh confirms removal, retire the optimistic marker so another parent's Undo
  // can bring that same missed date back on this screen too.
  useEffect(() => {
    const present = new Set(late.map(lateKey))
    setGone(g => { const next = new Set([...g].filter(key => present.has(key))); return next.size === g.size ? g : next })
  }, [late])


  const done = async (c: OverdueChore) => {
    setBusy(lateKey(c))
    try {
      // An Anyone chore counts for the person picked on this device, else the device's owner (server).
      const r = await api.completeChore(c.id, c.date, c.memberId ?? selectedMemberId ?? undefined) as { pending?: boolean }
      setGone(g => new Set(g).add(lateKey(c)))
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

  const dismiss = async (c: OverdueChore) => {
    if (busy) return
    setBusy(lateKey(c))
    try {
      await api.setChoreDismissed(c.id, c.date, true)
      setGone(g => new Set(g).add(lateKey(c)))
      const said = t('{title} dismissed as not done. No points awarded.', { title: c.title })
      toast(said, false, { label: t('Undo'), run: () => {
        api.setChoreDismissed(c.id, c.date, false).then(() => {
          setGone(g => { const next = new Set(g); next.delete(lateKey(c)); return next })
          reloadCore()
        }).catch(e => toast(e instanceof ApiError ? e.message : t('Could not restore chore'), true))
      } })
      announce(said)
      reloadCore()
    } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not dismiss chore'), true) }
    finally { setBusy(null) }
  }

  const sheets = open && shown.length > 0 && (
    <Sheet title={`⏰ ${t('Late chores')}`} onClose={() => setOpen(false)}>
      {parentDevice && <p className="field-hint">{t('Not done removes only that missed day from this list. No points are awarded, and future repeats stay scheduled.')}</p>}
      <ul className="meds-now-list">
        {shown.map(c => {
          const m = members.find(x => x.id === c.memberId)
          const due = t('Was due {day}', { day: formatDate(dayOf(c.date), DAY) })
          return (
            <li key={lateKey(c)} className="meds-now-item">
              <Face m={m ?? { name: t('Anyone'), color: 'var(--bg)', avatar: '⭐', picture: null }} className="board-avatar meds-now-avatar" aria-hidden="true" />
              <p className="meds-now-what">
                <strong>{c.emoji ? `${c.emoji} ` : ''}{c.title}</strong>
                <span>{m?.name ?? t('Anyone')} · {due}</span>
              </p>
              <div className="late-chore-actions">
                {parentDevice && <button type="button" className="btn btn-secondary" disabled={busy !== null} aria-label={t('Dismiss {title} as not done', { title: c.title })} onClick={() => void dismiss(c)}>{t('Not done')}</button>}
                <button type="button" className="btn btn-primary late-chore-done" disabled={busy !== null} aria-label={t('Mark {title} done', { title: c.title })} onClick={() => done(c)}>{t('Done')}</button>
              </div>
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
      row: <button type="button" className="board-slot-row" aria-haspopup="dialog" onClick={() => setOpen(true)}><span aria-hidden="true">⏰</span><span className="board-slot-row-text snap-overdue">{label}</span><ChevronRight className="board-slot-row-meta" width={18} height={18} /></button>,
      full: <button type="button" className="board-slot-row" aria-haspopup="dialog" onClick={() => setOpen(true)}><span aria-hidden="true">⏰</span><span className="board-slot-row-text snap-overdue">{label}</span><ChevronRight className="board-slot-row-meta" width={18} height={18} /></button>,
    },
  }
}
