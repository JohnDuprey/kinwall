// "Take now": a card for each medicine dose that's due (from its time until it's taken, skipped or
// 3 hours on; a snooze hides it for 10 minutes). At the top of the Board, in a person's Day view and
// on their medications page. On the Board (compact) it's one small tile that opens the list in a sheet. The server decides what this device may see: a shared wall gets
// everyone's doses as "Meds" unless the family turned names on, a person's own device only theirs.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { announce } from './a11y.tsx'
import { inkFor } from './color.ts'
import { timeLabel } from './journal.ts'
import { cardLabel, cheerLine } from './medications.ts'
import { Confetti } from './Chores.tsx'
import Sheet from './Sheet.tsx'
import type { DueDose, MedicationsDue } from './types.ts'

const RECHECK_MS = 60_000 // a dose shows up at its time without waiting for the next refresh

export default function TakeNow({ memberId, className = '', compact = false }: { memberId?: string; className?: string; compact?: boolean }) {
  const { settings, members, refreshTick, toast } = useApp()
  const [due, setDue] = useState<MedicationsDue | null>(null)
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [cheer, setCheer] = useState<{ key: string; line: string } | null>(null) // the dose just marked Taken: a moment of cheer before it goes
  const on = settings.medications
  useEffect(() => {
    if (!on) return
    let canceled = false
    api.getMedicationsDue().then(d => { if (!canceled) setDue(d) }).catch(() => { if (!canceled) setDue(null) }) // no card rather than an error
    return () => { canceled = true }
  }, [on, refreshTick, tick])
  useEffect(() => {
    if (!on) return
    const t = setInterval(() => setTick(x => x + 1), RECHECK_MS)
    return () => clearInterval(t)
  }, [on])
  const doses = on && due ? due.doses.filter(d => !memberId || d.memberId === memberId) : []
  if (!doses.length) return null

  const key = (d: DueDose) => `${d.medicationId}:${d.date}:${d.time}`
  const mark = async (d: DueDose, action: 'taken' | 'skipped' | 'snooze') => {
    const who = members.find(m => m.id === d.memberId)?.name ?? 'Them'
    setBusy(key(d))
    try {
      await api.markDose(d.medicationId, { date: d.date, time: d.time, action })
      const drop = () => setDue(x => x && { ...x, doses: x.doses.filter(y => key(y) !== key(d)) })
      if (action === 'taken') {
        // A small celebration, no points: points would give a reason to tap Taken without taking it.
        // Low-stimulation mode (per device): one calm line, and its CSS already hides the confetti.
        const line = document.documentElement.hasAttribute('data-lowstim') ? `Nice job, ${who}.` : cheerLine(who, cheer?.line)
        setCheer({ key: key(d), line }); announce(`${line} Taken ✓`)
        setTimeout(() => { setCheer(c => (c?.key === key(d) ? null : c)); drop() }, 1400)
        return
      }
      drop()
      const said = action === 'skipped' ? `Skipped for now: ${who}` : `We'll remind you again in 10 minutes`
      toast(said); announce(said)
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true) }
    finally { setBusy(null) }
  }

  const list = (
      <ul className="meds-now-list">
        {doses.map(d => {
          const m = members.find(x => x.id === d.memberId)
          const label = cardLabel(d)
          return (
            <li key={key(d)} className="meds-now-item">
              {m && <span className="board-avatar meds-now-avatar" style={{ background: m.color, color: inkFor(m.color) }} aria-hidden="true">{m.avatar || m.name[0]}</span>}
              <p className="meds-now-what">
                <strong>{m?.name ?? 'Someone'}</strong>
                <span>{label} · {timeLabel(d.time)}</span>
              </p>
              {cheer?.key === key(d) ? <p className="meds-now-cheer" role="status">{cheer.line} Taken ✓<Confetti /></p> : <div className="meds-now-actions" role="group" aria-label={`${m?.name ?? 'Someone'}: ${label}, ${timeLabel(d.time)}`}>
                <button className="btn btn-primary" disabled={busy === key(d)} onClick={() => mark(d, 'taken')}>Taken</button>
                <button className="btn btn-secondary" disabled={busy === key(d)} onClick={() => mark(d, 'skipped')}>Skip</button>
                <button className="btn btn-secondary" disabled={busy === key(d)} onClick={() => mark(d, 'snooze')}>Snooze 10 min</button>
              </div>}
            </li>
          )
        })}
      </ul>
  )
  if (compact) {
    const who = [...new Set(doses.map(d => d.memberId))].map(id => members.find(m => m.id === id)).filter(m => m !== undefined)
    return <>
      <button className={`board-tile meds-now meds-now-tile ${className}`} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span className="board-tile-label">💊 Take now</span>
        <span className="board-tile-value">{doses.length} due</span>
        <span className="board-tile-people">
          {who.map(m => (
            <span key={m.id} className="board-tile-person">
              <span className="board-avatar" style={{ background: m.color, color: inkFor(m.color) }} aria-hidden="true">{m.avatar || m.name[0]}</span>{m.name}
            </span>
          ))}
        </span>
      </button>
      {open && <Sheet title="💊 Take now" onClose={() => setOpen(false)}>{list}</Sheet>}
    </>
  }
  return (
    <section className={`board-card meds-now ${className}`} aria-labelledby="meds-now-title">
      <h3 id="meds-now-title" className="snap-heading">💊 Take now</h3>
      {list}
    </section>
  )
}
