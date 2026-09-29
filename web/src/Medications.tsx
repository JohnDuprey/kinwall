// A person's medications (#/medications/{memberId}): what's due now, today's doses (taken, skipped,
// due, not marked, later) with catch-up buttons, yesterday's unmarked doses, and a 7-day grid. Opens on their own device and parents' devices; the
// server refuses everyone else (403). A shared wall still gets the Take now cards, never the history.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { inkFor } from './color.ts'
import { formatTime } from './timeFormat.ts'
import { dayName } from './Snapshot.tsx'
import { announce } from './a11y.tsx'
import { catchUpLabel, doseTimeLabel, scheduleLabel, STATUS, weekCells } from './medications.ts'
import TakeNow from './TakeNow.tsx'
import type { Medication, MedicationHistory } from './types.ts'

type Day = MedicationHistory['days'][number]

export default function Medications({ memberId }: { memberId?: string }) {
  const { members, meMemberId, parentDevice, refreshTick, toast } = useApp()
  const member = members.find(m => m.id === memberId) ?? members.find(m => m.id === meMemberId)
  const [data, setData] = useState<MedicationHistory | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  useEffect(() => {
    if (!member) return
    let canceled = false
    api.getMedicationHistory(member.id)
      .then(h => { if (!canceled) { setData(h); setError('') } })
      .catch(e => { if (!canceled) setError(e instanceof ApiError && e.status === 403 ? `${member.name}'s medicines are private. They show on ${member.name}'s own device and parents' devices.` : e instanceof ApiError ? e.message : "Couldn't open this page.") })
    return () => { canceled = true }
  }, [member?.id, refreshTick, reload]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!member) return <div className="state-card">No one in the family yet.</div>
  const shown = data?.memberId === member.id ? data : null
  const byId = new Map(shown?.medications.map(m => [m.id, m]))
  const today = shown?.days.at(-1)
  const yesterday = shown?.days.at(-2)
  const behind = yesterday?.doses.filter(d => d.status === 'missed') ?? []
  // Catch-up: mark a dose that's due or past its window. The server logs the time it's marked.
  const mark = async (date: string, d: Day['doses'][number], action: 'taken' | 'skipped') => {
    const k = `${date}:${d.medicationId}:${d.time}`
    setBusy(k)
    try {
      await api.markDose(d.medicationId, { date, time: d.time, action })
      const said = action === 'taken' ? 'Marked taken ✓' : 'Marked skipped'
      toast(said); announce(said); setReload(x => x + 1)
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true) }
    finally { setBusy(null) }
  }
  const rows = (day: Day, doses: Day['doses']) => (
    <ul className="meds-today">
      {doses.map(d => {
        const m = byId.get(d.medicationId)
        const s = STATUS[d.status]
        const taken = catchUpLabel(d.status)
        const k = `${day.date}:${d.medicationId}:${d.time}`
        return (
          <li key={k} className={`meds-today-row meds-${d.status}`}>
            <span className="meds-today-time">{doseTimeLabel(d)}</span>
            <span className="meds-today-what">{medName(m)}</span>
            <span className="meds-status"><span aria-hidden="true">{s.emoji}</span> {s.label}{d.at && (d.status === 'taken' || d.status === 'skipped') ? ` ${formatTime(d.at)}` : ''}</span>
            {taken && <div className="meds-now-actions meds-catch-up" role="group" aria-label={`${medName(m)}, ${doseTimeLabel(d)}`}>
              <button className="btn btn-primary" disabled={busy === k} onClick={() => mark(day.date, d, 'taken')}>{taken}</button>
              <button className="btn btn-secondary" disabled={busy === k} onClick={() => mark(day.date, d, 'skipped')}>Skipped</button>
            </div>}
          </li>
        )
      })}
    </ul>
  )

  return (
    <div className="profile profile-narrow meds-page scroll-y" style={{ ['--m' as string]: member.color }}>
      <section className="profile-top">
        <div className="profile-hero">
          <span className="profile-avatar" style={{ background: member.color, color: inkFor(member.color) }} aria-hidden="true">{member.avatar || member.name[0]}</span>
          <div>
            <h2 className="profile-name">{member.name}'s medicines</h2>
            <p className="profile-meta">🔒 {member.grownUp ? `Private to ${member.name}'s own devices and parent devices.` : `For ${member.name} and parents.`}</p>
          </div>
        </div>
        {parentDevice && <div className="profile-actions"><a className="btn btn-secondary" href="#/trackers/health">Change medicines</a></div>}
      </section>
      <TakeNow memberId={member.id} />
      {error && <p className="snap-empty" role="alert">{error}</p>}
      {!shown && !error && <p className="snap-empty">Loading…</p>}
      {shown && shown.medications.length === 0 && <p className="snap-empty">No medicines for {member.name}.{parentDevice ? ' Add one in Trackers → Health.' : ''}</p>}
      {shown && today && shown.medications.length > 0 && <>
        <section className="board-card" aria-labelledby="meds-today">
          <h3 id="meds-today" className="snap-heading">Today</h3>
          {today.doses.length === 0 ? <p className="snap-dim">Nothing today.</p> : rows(today, today.doses)}
        </section>
        {yesterday && behind.length > 0 && <section className="board-card" aria-labelledby="meds-yesterday">
          <h3 id="meds-yesterday" className="snap-heading">Yesterday</h3>
          <p className="snap-dim">Not marked yet. If it was taken or skipped, you can still say so.</p>
          {rows(yesterday, behind)}
        </section>}
        <section className="board-card" aria-labelledby="meds-week">
          <h3 id="meds-week" className="snap-heading">Last 7 days</h3>
          <div className="meds-grid-wrap">
            <table className="meds-grid">
              <thead>
                <tr><th scope="col"><span className="sr-only">Medicine</span></th>{shown.days.map(d => <th key={d.date} scope="col" className={d.date === shown.today ? 'meds-grid-today' : undefined}>{dayName(d.date, { weekday: 'short' })}{d.date === shown.today && <span className="sr-only"> (today)</span>}</th>)}</tr>
              </thead>
              <tbody>
                {shown.medications.map(m => (
                  <tr key={m.id}>
                    <th scope="row"><span className="meds-grid-name">{m.name}</span><span className="meds-grid-sub">{scheduleLabel(m)}</span></th>
                    {weekCells(shown.days, m.id).map(c => (
                      <td key={c.date} className={c.status ? `meds-${c.status}` : ''}>
                        {c.status ? <><span aria-hidden="true">{STATUS[c.status].emoji}</span><span className="sr-only">{STATUS[c.status].label}</span></> : <span className="snap-dim" aria-label="No dose">·</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="meds-legend">{(['taken', 'skipped', 'missed'] as const).map(k => <span key={k}><span aria-hidden="true">{STATUS[k].emoji}</span> {STATUS[k].label}</span>)}</p>
        </section>
      </>}
    </div>
  )
}

const medName = (m: Medication | undefined) => (m ? (m.dose ? `${m.name} · ${m.dose}` : m.name) : 'Removed medicine')
