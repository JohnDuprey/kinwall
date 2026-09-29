// A person's medications (#/medications/{memberId}): what's due now, today's doses (taken, skipped,
// due, not marked, later) and a 7-day grid. Opens on their own device and parents' devices; the
// server refuses everyone else (403). A shared wall still gets the Take now cards, never the history.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { inkFor } from './color.ts'
import { timeLabel } from './journal.ts'
import { dayName } from './Snapshot.tsx'
import { scheduleLabel, STATUS, weekCells } from './medications.ts'
import TakeNow from './TakeNow.tsx'
import type { MedicationHistory } from './types.ts'

export default function Medications({ memberId }: { memberId?: string }) {
  const { members, meMemberId, parentDevice, refreshTick } = useApp()
  const member = members.find(m => m.id === memberId) ?? members.find(m => m.id === meMemberId)
  const [data, setData] = useState<MedicationHistory | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!member) return
    let canceled = false
    api.getMedicationHistory(member.id)
      .then(h => { if (!canceled) { setData(h); setError('') } })
      .catch(e => { if (!canceled) setError(e instanceof ApiError && e.status === 403 ? `${member.name}'s medicines are private. They show on ${member.name}'s own device and parents' devices.` : e instanceof ApiError ? e.message : "Couldn't open this page.") })
    return () => { canceled = true }
  }, [member?.id, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!member) return <div className="state-card">No one in the family yet.</div>
  const shown = data?.memberId === member.id ? data : null
  const byId = new Map(shown?.medications.map(m => [m.id, m]))
  const today = shown?.days.at(-1)

  return (
    <div className="profile meds-page scroll-y" style={{ ['--m' as string]: member.color }}>
      <section className="profile-top">
        <div className="profile-hero">
          <span className="profile-avatar" style={{ background: member.color, color: inkFor(member.color) }} aria-hidden="true">{member.avatar || member.name[0]}</span>
          <div>
            <h2 className="profile-name">{member.name}'s medicines</h2>
            <p className="profile-meta">🔒 {member.grownUp ? `Private to ${member.name}'s own devices and parent devices.` : `For ${member.name} and parents.`}</p>
          </div>
        </div>
        {parentDevice && <a className="btn btn-secondary meds-link" href="#/settings?tab=family">Change medicines</a>}
      </section>
      <TakeNow memberId={member.id} className="meds-page-card" />
      {error && <p className="snap-empty" role="alert">{error}</p>}
      {!shown && !error && <p className="snap-empty">Loading…</p>}
      {shown && shown.medications.length === 0 && <p className="snap-empty">No medicines for {member.name}.{parentDevice ? ' Add one in Settings → Family → Medications.' : ''}</p>}
      {shown && today && shown.medications.length > 0 && <>
        <section className="board-card meds-page-card" aria-labelledby="meds-today">
          <h3 id="meds-today" className="snap-heading">Today</h3>
          {today.doses.length === 0 ? <p className="snap-dim">Nothing today.</p> : (
            <ul className="meds-today">
              {today.doses.map(d => {
                const m = byId.get(d.medicationId)
                const s = STATUS[d.status]
                return (
                  <li key={`${d.medicationId}:${d.time}`} className={`meds-today-row meds-${d.status}`}>
                    <span className="meds-today-time">{timeLabel(d.time)}</span>
                    <span className="meds-today-what">{m ? (m.dose ? `${m.name} · ${m.dose}` : m.name) : 'Removed medicine'}</span>
                    <span className="meds-status"><span aria-hidden="true">{s.emoji}</span> {s.label}{d.at && (d.status === 'taken' || d.status === 'skipped') ? ` ${new Date(d.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
        <section className="board-card meds-page-card" aria-labelledby="meds-week">
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
