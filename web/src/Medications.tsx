// A person’s medicines: Today for tracking, Medicines for schedules and refills, History for records.
// Parent devices can switch person and edit here; other personal devices see only their own data.
// Shared walls keep their existing Take now cards and cannot read this page’s health data.
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { formatTime } from './timeFormat.ts'
import { dayName } from './Snapshot.tsx'
import { announce, Segmented } from './a11y.tsx'
import { groupTodayDoses, askWhenTaken, catchUpLabel, doseTimeLabel, earlierInput, pickedTime, scheduleLabel, STATUS, statusLabel, weekCells } from './medications.ts'
import Sheet from './Sheet.tsx'
import { DAY, formatDate, t, tm, tn } from './i18n.ts'
import { DoseList, useDueDoses, WhenTakenSheet } from './TakeNow.tsx'
import type { Medication, MedicationHistory, Member } from './types.ts'
import { Face } from './Face'
import { MedicineCards } from './Refills.tsx'
import { ChevronLeft } from './icons.tsx'
import { MedicationSheet } from './MedicationSettings.tsx'
import PickField from './PickField.tsx'
import { doseChanges } from './doseChanges.ts'

type Day = MedicationHistory['days'][number]

export default function Medications({ memberId }: { memberId?: string }) {
  const { members, meMemberId, parentDevice } = useApp()
  const member = members.find(m => m.id === (parentDevice ? memberId ?? meMemberId : meMemberId))
  if (!member) return members.length === 0 ? <div className="state-card">{t('No one in the family yet.')}</div> : (
    <div className="profile profile-narrow meds-page scroll-y">
      <h2 className="profile-name">{t('Whose medicines?')}</h2>
      <p className="snap-dim">{t('Pick someone.')}</p>
      <div className="meds-person-body">
        {members.filter(m => parentDevice || m.id === meMemberId).map(m => <a key={m.id} className="meds-set-row meds-pick" href={`#/medications/${m.id}`}><Face m={m} className="board-avatar" aria-hidden="true" /> <span className="settings-row-label">{m.name}</span></a>)}
      </div>
    </div>
  )
  return <PersonMedicines key={member.id} member={member} />
}

function PersonMedicines({ member }: { member: Member }) {
  const { members, parentDevice, refreshTick, toast } = useApp()
  const [view, setView] = useState<'today' | 'medicines' | 'history'>('today')
  const [editing, setEditing] = useState<{ med: Medication | null } | null>(null)
  const [data, setData] = useState<MedicationHistory | null>(null)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState<string | null>(null)
  const [refillOpen, setRefillOpen] = useState<string | null>(null) // the refill card's medicine
  const [asking, setAsking] = useState<{ date: string; d: Day['doses'][number] } | null>(null) // Taken, well after its time: when?
  const due = useDueDoses()
  const active = due.doses.filter(d => d.memberId === member.id)
  const [changing, setChanging] = useState<{ date: string; d: Day['doses'][number] } | null>(null) // a marked dose: fix its time or status
  useEffect(() => {
    let canceled = false
    api.getMedicationHistory(member.id)
      .then(h => { if (!canceled) { setData(h); setError('') } })
      .catch(e => { if (!canceled) setError(e instanceof ApiError && e.status === 403 ? t("{name}'s medicines are private. They show on {name}'s own device and parents' devices.", { name: member.name }) : e instanceof ApiError ? e.message : t("Couldn't open this page.")) })
    return () => { canceled = true }
  }, [member.id, refreshTick, reload]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => doseChanges.listen(() => setReload(x => x + 1)), [])

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
      toast(said); announce(said)
    } catch (e) { toast(e instanceof ApiError ? e.message : t("Couldn't save that"), true) }
    finally { setBusy(null) }
  }
  const groups = today && groupTodayDoses(today.date, today.doses, active)
  const refillCount = shown?.medications.filter(m => m.refillRequest).length ?? 0
  const rows = (day: Day, doses: Day['doses']) => (
    <ul className="meds-today">
      {doses.map(d => {
        const m = byId.get(d.medicationId)
        const s = STATUS[d.status]
        const k = `${day.date}:${d.medicationId}:${d.time}`
        const taken = editable(day.date) ? catchUpLabel(d.status) : null
        const marked = d.status === 'taken' || d.status === 'skipped'
        const label = d.status === 'due' && d.snoozedUntil && Date.parse(d.snoozedUntil) > Date.now() ? t('Snoozed until {time}', { time: formatTime(new Date(d.snoozedUntil)) }) : statusLabel(d)
        const said = <><span aria-hidden="true">{s.emoji}</span> {label}{d.at && marked ? ` ${formatTime(d.at)}` : ''}{d.edited && <span className="meds-edited"> · {t('edited')}</span>}</>
        return (
          <li key={k} className={`meds-today-row meds-${d.status}`}>
            <span className="meds-today-time">{doseTimeLabel(d)}</span>
            <span className="meds-today-what">{medName(m)}</span>
            {/* Marked today or yesterday: tap to fix its time or status. */}
            {marked && editable(day.date) ? <button type="button" className="meds-status meds-status-btn" disabled={busy === k} aria-label={t('{dose}: {status}. Change', { dose: `${medName(m)}, ${doseTimeLabel(d)}`, status: [`${statusLabel(d)}${d.at ? ` ${formatTime(d.at)}` : ''}`, d.edited ? t('edited') : ''].filter(Boolean).join(', ') })} onClick={() => setChanging({ date: day.date, d })}>{said} <span className="meds-change">· {t('Change')}</span></button>
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
        {parentDevice && <PickField label={t('Whose medicines')} title={t('Whose medicines?')} value={[member.id]}
          options={members.map(m => ({ value: m.id, label: m.name, lead: <Face m={m} aria-hidden="true" /> }))}
          onChange={([id]) => { setView('today'); window.location.hash = `#/medications/${id}` }} />}
        <Segmented tabs idBase="meds-tab" label={t('Medicines view')} value={view} onChange={setView} options={[
          { key: 'today', label: t('Today') }, { key: 'medicines', label: t('Medicines') }, { key: 'history', label: t('History') },
        ]} />
      </section>
      {error && <p className="snap-empty" role="alert">{error}</p>}
      {!shown && !error && <p className="snap-empty">{t('Loading…')}</p>}
      {shown && <div className="meds-panel" role="tabpanel" aria-labelledby={`meds-tab-${view}`}>
        {shown.medications.length === 0 && <div className="board-card">
          <p className="snap-empty">{t('No medicines for {name}.', { name: member.name })}</p>
          {parentDevice && <button className="btn btn-primary" onClick={() => setEditing({ med: null })}>{t('+ Add medicine')}</button>}
        </div>}
        {view === 'today' && shown.medications.length > 0 && <>
          <section className="board-card meds-now" aria-labelledby="meds-due">
            <h3 id="meds-due" className="snap-heading">💊 {t('Due now')}</h3>
            {active.length > 0 && <DoseList doses={active} drop={due.drop} />}
            {today && groups && groups.due.length > 0 && rows(today, groups.due)}
            {active.length === 0 && !groups?.due.length && <p className="snap-dim">{t('Nothing due right now.')}</p>}
          </section>
          {today && groups && <>
            {groups.snoozed.length > 0 && <section className="board-card" aria-labelledby="meds-snoozed">
              <h3 id="meds-snoozed" className="snap-heading">{t('Snoozed')}</h3>
              {rows(today, groups.snoozed)}
            </section>}
            {groups.unmarked.length > 0 && <section className="board-card" aria-labelledby="meds-unmarked">
              <h3 id="meds-unmarked" className="snap-heading">{t('Not marked yet')}</h3>
              <p className="snap-dim">{t('If a dose was already taken or skipped, record it here.')}</p>
              {rows(today, groups.unmarked)}
            </section>}
            <section className="board-card" aria-labelledby="meds-later">
              <h3 id="meds-later" className="snap-heading">{t('Later today')}</h3>
              {groups.later.length ? rows(today, groups.later) : <p className="snap-dim">{t('No more doses scheduled today.')}</p>}
            </section>
            <section className="board-card" aria-labelledby="meds-recorded">
              <h3 id="meds-recorded" className="snap-heading">{t('Recorded today')}</h3>
              {groups.recorded.length ? rows(today, groups.recorded) : <p className="snap-dim">{t('No doses recorded today.')}</p>}
            </section>
          </>}
          {refillCount > 0 && <button className="btn btn-secondary" onClick={() => setView('medicines')}>{tn(refillCount, '{n} refill to request · Open medicines', '{n} refills to request · Open medicines')}</button>}
        </>}
        {view === 'medicines' && shown.medications.length > 0 && <>
          {parentDevice && <div className="meds-toolbar"><button className="btn btn-primary" onClick={() => setEditing({ med: null })}>{t('+ Add medicine')}</button></div>}
          <p className="snap-dim">{t('Prepare a refill request to get contact details and a message to use. Kinwall does not contact anyone for you.')}</p>
          <MedicineCards meds={shown.medications} member={member} onChanged={() => setReload(x => x + 1)} openId={refillOpen} setOpenId={setRefillOpen} onEdit={parentDevice ? med => setEditing({ med }) : undefined} />
        </>}
        {view === 'history' && shown.medications.length > 0 && <>
          <details className="board-card meds-week-details">
            <summary>{t('Seven-day overview')}</summary>
            <section aria-labelledby="meds-week">
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
          </details>
          {[...shown.days].reverse().map(day => <section key={day.date} className="board-card" aria-label={formatDate(new Date(`${day.date}T12:00:00`), DAY)}>
            <h3 className="snap-heading">{day.date === today?.date ? t('Today') : day.date === yesterday?.date ? t('Yesterday') : formatDate(new Date(`${day.date}T12:00:00`), DAY)}</h3>
            {day.date === yesterday?.date && behind.length > 0 && <p className="snap-dim">{t("Some weren't marked. If they were taken or skipped, you can still say so.")}</p>}
            {day.doses.length ? rows(day, day.doses) : <p className="snap-dim">{t('No doses scheduled.')}</p>}
          </section>)}
        </>}
      </div>}
      {editing && parentDevice && shown && <MedicationSheet med={editing.med} member={member} siblings={shown.medications.filter(m => m.id !== editing.med?.id)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setReload(x => x + 1); setView('medicines') }} />}
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
