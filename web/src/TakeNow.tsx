// "Take now": a card for each medicine dose that's due (from its time until it's taken, skipped or
// 3 hours on; a snooze hides it for 10 minutes). At the top of the Board, in a person's Day view and
// on their medications page. The server decides what this device may see: a shared wall gets
// everyone's doses as "Meds" unless the family turned names on, a person's own device only theirs.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { announce } from './a11y.tsx'
import { inkFor } from './color.ts'
import { timeLabel } from './journal.ts'
import { cardLabel } from './medications.ts'
import type { DueDose, MedicationsDue } from './types.ts'

const RECHECK_MS = 60_000 // a dose shows up at its time without waiting for the next refresh

export default function TakeNow({ memberId, className = '' }: { memberId?: string; className?: string }) {
  const { settings, members, refreshTick, toast } = useApp()
  const [due, setDue] = useState<MedicationsDue | null>(null)
  const [tick, setTick] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
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
      setDue(x => x && { ...x, doses: x.doses.filter(y => key(y) !== key(d)) })
      const said = action === 'taken' ? `Taken: ${who} ✓` : action === 'skipped' ? `Skipped for now: ${who}` : `We'll remind you again in 10 minutes`
      toast(said); announce(said)
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true) }
    finally { setBusy(null) }
  }

  return (
    <section className={`board-card meds-now ${className}`} aria-labelledby="meds-now-title">
      <h3 id="meds-now-title" className="snap-heading">💊 Take now</h3>
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
              <div className="meds-now-actions" role="group" aria-label={`${m?.name ?? 'Someone'}: ${label}, ${timeLabel(d.time)}`}>
                <button className="btn btn-primary" disabled={busy === key(d)} onClick={() => mark(d, 'taken')}>Taken</button>
                <button className="btn btn-secondary" disabled={busy === key(d)} onClick={() => mark(d, 'skipped')}>Skip</button>
                <button className="btn btn-secondary" disabled={busy === key(d)} onClick={() => mark(d, 'snooze')}>Snooze 10 min</button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
