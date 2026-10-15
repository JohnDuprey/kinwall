// A person's medications (#/medications/{memberId}): what's due now, today's doses (taken, skipped,
// due, not marked, later) with catch-up buttons, yesterday's doses, and a 7-day grid. A marked dose from today or
// yesterday opens ChangeDoseSheet (fix its time, or Taken / Skipped / Not marked). Opens on their own device and parents' devices; the
// server refuses everyone else (403). A shared wall still gets the Take now cards, never the history.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { formatTime } from './timeFormat.ts'
import { dayName } from './Snapshot.tsx'
import { announce } from './a11y.tsx'
import { askWhenTaken, catchUpLabel, doseTimeLabel, earlierInput, pickedTime, scheduleLabel, STATUS, statusLabel, weekCells } from './medications.ts'
import Sheet from './Sheet.tsx'
import { t, tm } from './i18n.ts'
import TakeNow, { useDueDoses, WhenTakenSheet } from './TakeNow.tsx'
import type { Medication, MedicationHistory } from './types.ts'
import { Face } from './Face'
import { RefillsCard } from './Refills.tsx'
import { ChevronLeft } from './icons.tsx'

type Day = MedicationHistory['days'][number]

export default function Medications({ memberId }: { memberId?: string }) {
  const { members, meMemberId, parentDevice, refreshTick, toast } = useApp()
  const member = members.find(m => m.id === memberId) ?? members.find(m => m.id === meMemberId)
  const [data, setData] = useState<MedicationHistory | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [refillOpen, setRefillOpen] = useState<string | null>(null) // the refill card's medicine
  const [asking, setAsking] = useState<{ date: string; d: Day['doses'][number] } | null>(null) // Taken, well after its time: when?
  const takeNow = new Set(useDueDoses().doses.map(d => `${d.date}:${d.medicationId}:${d.time}`)) // these have their buttons on the Take now card
  const [changing, setChanging] = useState<{ date: string; d: Day['doses'][number] } | null>(null) // a marked dose: fix its time or status
  useEffect(() => {
    if (!member) return
    let canceled = false
    api.getMedicationHistory(member.id)
      .then(h => { if (!canceled) { setData(h); setError('') } })
      .catch(e => { if (!canceled) setError(e instanceof ApiError && e.status === 403 ? t("{name}'s medicines are private. They show on {name}'s own device and parents' devices.", { name: member.name }) : e instanceof ApiError ? e.message : t("Couldn't open this page.")) })
    return () => { canceled = true }
  }, [member?.id, refreshTick, reload]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!member) return members.length === 0 ? <div className="state-card">{t('No one in the family yet.')}</div> : (
    <div className="profile profile-narrow meds-page scroll-y">
      <h2 className="profile-name">{t('Whose medicines?')}</h2>
      <p className="snap-dim">{t('Pick someone.')}</p>
      <div className="meds-person-body">
        {members.map(m => <a key={m.id} className="meds-set-row meds-pick" href={`#/medications/${m.id}`}><Face m={m} className="board-avatar" aria-hidden="true" /> <span className="settings-row-label">{m.name}</span></a>)}
      </div>
    </div>
  )
  const shown = data?.memberId === member.id ? data : null
  const byId = new Map(shown?.medications.map(m => [m.id, m]))
  const today = shown?.days.at(-1)
  const yesterday = shown?.days.at(-2)
  const behind = yesterday?.doses.filter(d => d.status === 'missed') ?? []
  const editable = (date: string) => date === today?.date || date === yesterday?.date
  // Catch-up: mark a dose that's due or past its window, at the time it's marked or, for Taken well after
  // its time, when they say they took it (WhenTakenSheet).
  const mark = async (date: string, d: Day['doses'][number], action: 'taken' | 'skipped' | 'unmark', at?: string) => {
    const k = `${date}:${d.medicationId}:${d.time}`
    setBusy(k)
    try {
      await api.markDose(d.medicationId, { date, time: d.time, action, ...(at ? { at } : {}) })
      const said = d.status === 'taken' || d.status === 'skipped' ? t('Saved') : action === 'taken' ? t('Marked taken ✓') : t('Marked skipped')
      toast(said); announce(said); setReload(x => x + 1)
    } catch (e) { toast(e instanceof ApiError ? e.message : t("Couldn't save that"), true) }
    finally { setBusy(null) }
  }
  const refillsFirst = !!shown?.medications.some(m => m.refillRequest)
  const refills = shown && <RefillsCard meds={shown.medications} member={member} onChanged={() => setReload(x => x + 1)} openId={refillOpen} setOpenId={setRefillOpen} />
  const rows = (day: Day, doses: Day['doses']) => (
    <ul className="meds-today">
      {doses.map(d => {
        const m = byId.get(d.medicationId)
        const s = STATUS[d.status]
        const k = `${day.date}:${d.medicationId}:${d.time}`
        const taken = catchUpLabel(d.status, takeNow.has(k))
        const marked = d.status === 'taken' || d.status === 'skipped'
        const said = <><span aria-hidden="true">{s.emoji}</span> {statusLabel(d)}{d.at && marked ? ` ${formatTime(d.at)}` : ''}{d.edited && <span className="meds-edited"> · {t('edited')}</span>}</>
        return (
          <li key={k} className={`meds-today-row meds-${d.status}`}>
            <span className="meds-today-time">{doseTimeLabel(d)}</span>
            <span className="meds-today-what">{medName(m)}</span>
            {/* Marked today or yesterday: tap to fix its time or status. */}
            {marked && editable(day.date) ? <button type="button" className="meds-status meds-status-btn" disabled={busy === k} aria-label={t('{dose}: {status}. Change', { dose: `${medName(m)}, ${doseTimeLabel(d)}`, status: [`${statusLabel(d)}${d.at ? ` ${formatTime(d.at)}` : ''}`, d.edited ? t('edited') : ''].filter(Boolean).join(', ') })} onClick={() => setChanging({ date: day.date, d })}>{said} <span className="meds-change" aria-hidden="true">✏️</span></button>
              : <span className="meds-status">{said}</span>}
            {taken && <div className="meds-now-actions meds-catch-up" role="group" aria-label={`${medName(m)}, ${doseTimeLabel(d)}`}>
              <button className="btn btn-primary" disabled={busy === k} onClick={() => (askWhenTaken(d.dueAt, Date.now()) ? setAsking({ date: day.date, d }) : mark(day.date, d, 'taken'))}>{taken}</button>
              <button className="btn btn-secondary" disabled={busy === k} onClick={() => mark(day.date, d, 'skipped')}>{t('Skip')}</button>
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
          <a className="icon-btn" href={parentDevice ? '#/trackers/health' : `#/profile/${member.id}`} aria-label={parentDevice ? t('Back to Health') : t("Back to {name}'s profile", { name: member.name })}><ChevronLeft width={20} height={20} /></a>
          <Face m={member} className="profile-avatar" aria-hidden="true" />
          <div>
            <h2 className="profile-name">{t("{name}'s medicines", { name: member.name })}</h2>
            <p className="profile-meta">🔒 {member.grownUp ? t("Private to {name}'s own devices and parent devices.", { name: member.name }) : t('For {name} and parents.', { name: member.name })}</p>
          </div>
        </div>
        {parentDevice && <div className="profile-actions"><a className="btn btn-secondary" href="#/trackers/health">{t('Change medicines')}</a></div>}
      </section>
      <TakeNow memberId={member.id} />
      {error && <p className="snap-empty" role="alert">{error}</p>}
      {!shown && !error && <p className="snap-empty">{t('Loading…')}</p>}
      {shown && shown.medications.length === 0 && <p className="snap-empty">{parentDevice ? t('No medicines for {name}. Add one in Trackers → Health.', { name: member.name }) : t('No medicines for {name}.', { name: member.name })}</p>}
      {shown && today && shown.medications.length > 0 && <>
        {/* An open "Request refill" to-do goes first; otherwise the card waits below Today. */}
        {refillsFirst && refills}
        <section className="board-card" aria-labelledby="meds-today">
          <h3 id="meds-today" className="snap-heading">{t('Today')}</h3>
          {today.doses.length === 0 ? <p className="snap-dim">{t('Nothing today.')}</p> : rows(today, today.doses)}
        </section>
        {!refillsFirst && refills}
        {yesterday && yesterday.doses.length > 0 && <section className="board-card" aria-labelledby="meds-yesterday">
          <h3 id="meds-yesterday" className="snap-heading">{t('Yesterday')}</h3>
          {behind.length > 0 && <p className="snap-dim">{t("Some weren't marked. If they were taken or skipped, you can still say so.")}</p>}
          {rows(yesterday, yesterday.doses)}
        </section>}
        <section className="board-card" aria-labelledby="meds-week">
          <h3 id="meds-week" className="snap-heading">{t('Last 7 days')}</h3>
          <div className="meds-grid-wrap">
            <table className="meds-grid">
              <thead>
                <tr><th scope="col"><span className="sr-only">{t('Medicine')}</span></th>{shown.days.map(d => <th key={d.date} scope="col" className={d.date === shown.today ? 'meds-grid-today' : undefined}>{dayName(d.date, { weekday: 'short' })}{d.date === shown.today && <span className="sr-only"> {t('(today)')}</span>}</th>)}</tr>
              </thead>
              <tbody>
                {shown.medications.map(m => (
                  <tr key={m.id}>
                    <th scope="row"><span className="meds-grid-name">{m.name}</span><span className="meds-grid-sub">{scheduleLabel(m)}</span></th>
                    {weekCells(shown.days, m.id).map(c => (
                      <td key={c.date} className={c.status ? `meds-${c.status}` : ''}>
                        {c.status ? <><span aria-hidden="true">{STATUS[c.status].emoji}</span><span className="sr-only">{tm(STATUS[c.status].label)}</span></> : <span className="snap-dim" aria-label={t('No dose')}>·</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="meds-legend">{(['taken', 'skipped', 'missed'] as const).map(k => <span key={k}><span aria-hidden="true">{STATUS[k].emoji}</span> {tm(STATUS[k].label)}</span>)}</p>
        </section>
      </>}
      {asking && shown && <WhenTakenSheet dose={{ date: asking.date, dueAt: asking.d.dueAt }} today={shown.today} onClose={() => setAsking(null)}
        onPick={at => { setAsking(null); mark(asking.date, asking.d, 'taken', at) }} />}
      {changing && shown && <ChangeDoseSheet dose={changing.d} date={changing.date} today={shown.today} name={medName(byId.get(changing.d.medicationId))} onClose={() => setChanging(null)}
        onSave={(action, at) => { setChanging(null); mark(changing.date, changing.d, action, at) }} />}
    </div>
  )
}

const medName = (m: Medication | undefined) => (m ? (m.dose ? `${m.name} · ${m.dose}` : m.name) : t('Removed medicine'))

/** A marked dose, tapped: what happened and, for Taken, when (a time for today's dose, a date and time
 *  for yesterday's). The server keeps the first mark and who changed it; the page shows "edited". */
function ChangeDoseSheet({ dose, date, today, name, onSave, onClose }: { dose: Day['doses'][number]; date: string; today: string; name: string; onSave: (action: 'taken' | 'skipped' | 'unmark', at?: string) => void; onClose: () => void }) {
  const [status, setStatus] = useState<'taken' | 'skipped' | 'unmark'>(dose.status === 'skipped' ? 'skipped' : 'taken')
  const [when, setWhen] = useState(() => earlierInput(date, today, dose.at ?? dose.dueAt, Date.now()))
  const at = status === 'taken' ? pickedTime(when.value, date) : null
  return (
    <Sheet title={t('Change this dose')} variant="dialog" onClose={onClose}
      actions={<button className="btn btn-primary" disabled={status === 'taken' && !at} onClick={() => onSave(status, at ?? undefined)}>{t('Save')}</button>}>
      <p className="snap-dim">{name} · {doseTimeLabel(dose)}{date !== today ? ` ${t('(yesterday)')}` : ''}</p>
      <div className="field">
        <label htmlFor="dose-status">{t('What happened')}</label>
        <select id="dose-status" className="settings-select" value={status} onChange={e => setStatus(e.target.value as typeof status)}>
          <option value="taken">{t('Taken')}</option>
          <option value="skipped">{t('Skipped')}</option>
          <option value="unmark">{t('Not marked')}</option>
        </select>
      </div>
      {status === 'taken' && <div className="field">
        <label htmlFor="dose-at">{t('Taken at')}</label>
        <input id="dose-at" type={when.type} min={when.min} max={when.max} value={when.value} onChange={e => setWhen({ ...when, value: e.target.value })} />
      </div>}
    </Sheet>
  )
}
