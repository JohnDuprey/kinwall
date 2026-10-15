// Medication reminders, part of the Health tracker (off unless both are on, server-side too):
// - MedicationsToggle: the switch under Health in Settings → Features, with a one-time notice about
//   what's kept and who sees it;
// - MedicineList: Trackers → Health (parent devices only): each person's medicines, names on shared
//   screens, and "Delete all medication data" behind More….
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { daysMode, EVERY_DAY, scheduleLabel, WEEKDAYS, weekdayShort } from './medications.ts'
import { msg, t, tm, tn } from './i18n.ts'
import type { LateWindow, Medication, MedicationRefill, Member, MedTime } from './types.ts'
import { Face } from './Face'
import { RefillFields } from './Refills.tsx'
import { ChevronDown } from './icons.tsx'

const NOTICE = msg('Kinwall keeps each medicine’s name, dose and times, and when a dose was marked taken or skipped. It’s encrypted on the server. Parent devices see everyone’s; each person’s own device sees theirs. Wall screens show “Meds” when a dose is due, without names. Reminders say “Time for Leo’s medicine” unless a device turns names on. Nothing goes to connected apps, webhooks or Home Assistant.')

const useSaveSettings = () => {
  const { reloadCore, toast } = useApp()
  return async (patch: { medications?: boolean; medicationNamesOnWalls?: boolean }) => {
    try { await api.updateSettings(patch); reloadCore() } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not save settings'), true) }
  }
}

export function MedicationsToggle() {
  const { settings } = useApp()
  const dialog = useDialog()
  const save = useSaveSettings()
  const on = settings.medications
  const toggle = async () => {
    if (!on && !await dialog.confirm({ title: t('Turn on medication reminders?'), body: tm(NOTICE), confirmLabel: t('Turn on') })) return
    save({ medications: !on })
  }
  return (
    <div className="toggle-row features-sub">
      <div>
        <label id="meds-on-label"><span className="sr-only">{t('Trackers:')} </span>{t('Medication reminders')}</label>
        <div className="settings-row-sub" id="meds-on-sub">{t('Medicines in the Health tracker, a reminder at each dose and a Take now tile on the Board.')}</div>
      </div>
      <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-labelledby="meds-on-label" aria-describedby="meds-on-sub" onClick={toggle}><span className="knob" /></button>
    </div>
  )
}

/** Each person's medicines with Add, edit and History (Trackers → Health, parent devices). */
export function MedicineList({ memberId }: { memberId?: string | null }) {
  const { members, settings, toast } = useApp()
  const dialog = useDialog()
  const save = useSaveSettings()
  const [meds, setMeds] = useState<Medication[]>([])
  const [editing, setEditing] = useState<{ med: Medication | null; member: Member } | null>(null)
  const load = () => { api.getMedications().then(setMeds).catch(() => setMeds([])) }
  useEffect(load, [])
  const more = async (action: string) => {
    if (action !== 'delete-all') return
    if (!await dialog.confirm({ title: t('Delete all medication data?'), body: t('Every medicine and its taken and skipped log, for everyone. This can’t be undone.'), confirmLabel: t('Delete all'), danger: true })) return
    try { await api.deleteAllMedications(); setMeds([]); toast(t('Medication data deleted')) } catch (e) { toast(e instanceof ApiError ? e.message : t("Couldn't delete that"), true) }
  }
  return (
    <section className="meds-list" aria-labelledby="meds-list-title">
      <h3 className="trk-heading" id="meds-list-title">💊 {t('Medicines')}</h3>
      {members.filter(m => !memberId || m.id === memberId).map(m => {
          const mine = meds.filter(x => x.memberId === m.id)
          // Nobody's medicines to hide: say so and offer Add right in the row.
          if (mine.length === 0) return (
            <div key={m.id} className="meds-person meds-person-head">
              <Face m={m} className="board-avatar" aria-hidden="true" />
              <span className="settings-row-label">{m.name}</span>
              <span className="settings-row-sub">{t('No medicines')}</span>
              <button className="btn btn-secondary meds-add-inline" onClick={() => setEditing({ med: null, member: m })} aria-label={t('Add a medicine for {name}', { name: m.name })}>{t('+ Add')}</button>
            </div>
          )
          return (
            // Collapsed by default so a glance at Health doesn't show anyone's medicines.
            <details key={m.id} className="meds-person">
              <summary className="meds-person-head">
                <Face m={m} className="board-avatar" aria-hidden="true" />
                <span className="settings-row-label">{m.name}</span>
                <span className="settings-row-sub">{tn(mine.length, '{n} medicine', '{n} medicines')}</span>
                <ChevronDown className="meds-chevron" aria-hidden="true" />
              </summary>
              <div className="meds-person-body">
                {mine.map(x => (
                  <button key={x.id} className="meds-set-row" onClick={() => setEditing({ med: x, member: m })} aria-label={t('Edit {medicine} for {name}', { medicine: x.name, name: m.name })}>
                    <span className="settings-row-label">{x.dose ? `${x.name} · ${x.dose}` : x.name}</span>
                    <span className="settings-row-sub">{scheduleLabel(x)}</span>
                    {x.refillRequest && <span className="settings-row-sub">📝 {t('Refill to request')}</span>}
                  </button>
                ))}
                <div className="settings-inline-btns">
                  <button className="btn btn-secondary" onClick={() => setEditing({ med: null, member: m })}>{t('+ Add medicine')}</button>
                  <a className="btn btn-secondary meds-link" href={`#/medications/${m.id}`}>{t('History')}</a>
                </div>
              </div>
            </details>
          )
        })}
      <div className="toggle-row">
        <div>
          <label id="meds-names-label">{t('Show medicine names on shared screens')}</label>
          <div className="settings-row-sub" id="meds-names-sub">{t('Off: wall screens say “Meds”. Parent devices and each person’s own device always show names.')}</div>
        </div>
        <button className={`switch ${settings.medicationNamesOnWalls ? 'on' : ''}`} role="switch" aria-checked={settings.medicationNamesOnWalls} aria-labelledby="meds-names-label" aria-describedby="meds-names-sub"
          onClick={() => save({ medicationNamesOnWalls: !settings.medicationNamesOnWalls })}><span className="knob" /></button>
      </div>
      <div className="settings-row">
        <div className="settings-row-sub">{t('Reminders come through at night too.')}</div>
        <select className="settings-select" aria-label={t('More medication actions')} value="" onChange={e => more(e.target.value)}>
          <option value="">{t('More…')}</option>
          <option value="delete-all">{t('Delete all medication data')}</option>
        </select>
      </div>
      {editing && <MedicationSheet med={editing.med} member={editing.member} siblings={meds.filter(x => x.memberId === editing.member.id && x.id !== editing.med?.id)} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </section>
  )
}

type DaysMode = 'every' | 'weekdays' | 'weekends' | 'some'
const modeOf = (days: number[]): DaysMode => daysMode(days)
const MODE_DAYS: Record<Exclude<DaysMode, 'some'>, number[]> = { every: EVERY_DAY, weekdays: [1, 2, 3, 4, 5], weekends: [0, 6] }

function MedicationSheet({ med, member, siblings, onClose, onSaved }: { med: Medication | null; member: Member; siblings: Medication[]; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp()
  const dialog = useDialog()
  const [name, setName] = useState(med?.name ?? '')
  const [dose, setDose] = useState(med?.dose ?? '')
  const [times, setTimes] = useState<MedTime[]>(med?.times ?? ['08:00'])
  const hasWake = times.some(t => typeof t !== 'string')
  const setTime = (i: number, t: MedTime) => setTimes(ts => ts.map((x, j) => (j === i ? t : x)))
  const [days, setDays] = useState<number[]>(med?.days ?? EVERY_DAY)
  const [mode, setMode] = useState<DaysMode>(modeOf(med?.days ?? EVERY_DAY))
  // A course (e.g. an antibiotic): no end, a last day, or a number of doses taken.
  const [ends, setEnds] = useState<'never' | 'date' | 'doses'>(med?.totalDoses != null ? 'doses' : med?.endDate ? 'date' : 'never')
  const [endDate, setEndDate] = useState(med?.endDate ?? '')
  const [totalDoses, setTotalDoses] = useState(med?.totalDoses != null ? String(med.totalDoses) : '')
  const [lateWindow, setLateWindow] = useState<LateWindow>(med?.lateWindow ?? '3h')
  const [refill, setRefill] = useState<MedicationRefill>(med?.refill ?? { contactId: null, pharmacyContactId: null, pharmacy: '', dateOfBirth: null, callback: '', remindOn: null })
  const total = Number(totalDoses)
  const endsValid = ends === 'never' || (ends === 'date' ? /^\d{4}-\d{2}-\d{2}$/.test(endDate) : Number.isInteger(total) && total >= 1 && total <= 1000)
  const valid = name.trim() && times.length > 0 && times.every(t => (typeof t === 'string' ? t : t.latest)) && days.length > 0 && endsValid
  const save = async () => {
    const body = { name: name.trim(), dose: dose.trim(), times, days, endDate: ends === 'date' ? endDate : null, totalDoses: ends === 'doses' ? total : null, lateWindow, refill: { ...refill, pharmacy: refill.pharmacy.trim(), callback: refill.callback.trim() } }
    try {
      if (med) await api.updateMedication(med.id, body)
      else await api.addMedication({ memberId: member.id, ...body })
      toast(t('Saved: {name}', { name: body.name }))
      onSaved()
    } catch (e) { toast(e instanceof ApiError ? e.message : t("Couldn't save that"), true) }
  }
  const more = async (action: string) => {
    if (action !== 'delete' || !med) return
    if (!await dialog.confirm({ title: t('Delete {name}?', { name: med.name }), body: t('Its reminders stop and its history for {name} is deleted.', { name: member.name }), confirmLabel: t('Delete'), danger: true })) return
    try { await api.deleteMedication(med.id); toast(t('Deleted: {name}', { name: med.name })); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : t("Couldn't delete that"), true) }
  }
  const pickMode = (m: DaysMode) => { setMode(m); if (m !== 'some') setDays(MODE_DAYS[m]) }
  const toggleDay = (d: number) => setDays(ds => ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d].sort())

  return (
    <Sheet title={med ? t('Edit {name}', { name: med.name }) : t('New medicine for {name}', { name: member.name })} onClose={onClose}
      actions={<>
        {med && <select className="settings-select" aria-label={t('More')} value="" onChange={e => more(e.target.value)}><option value="">{t('More…')}</option><option value="delete">{t('Delete medicine')}</option></select>}
        <button className="btn btn-primary" onClick={save} disabled={!valid}>{t('Save')}</button>
      </>}>
      <div className="field">
        <label htmlFor="med-name">{t('Medicine')}</label>
        <input id="med-name" type="text" maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder={t('Allergy medicine')} autoComplete="off" />
        <p className="field-hint">{t("Just a name the family knows it by. No need for what it's for.")}</p>
      </div>
      <div className="field">
        <label htmlFor="med-dose">{t('Dose')} <span className="settings-row-sub">{t('(optional)')}</span></label>
        <input id="med-dose" type="text" maxLength={40} value={dose} onChange={e => setDose(e.target.value)} placeholder={t('1 tablet or 5 mg')} autoComplete="off" />
      </div>
      <fieldset className="field meds-times">
        <legend>{t('Times')}</legend>
        {times.map((time, i) => (
          <div key={i} className="meds-time-row">
            <select className="settings-select" aria-label={t('Time {n}: when', { n: i + 1 })} value={typeof time === 'string' ? 'at' : 'wake'}
              onChange={e => setTime(i, e.target.value === 'wake' ? { wake: true, latest: '12:00' } : '08:00')}>
              <option value="at">{t('At a time')}</option>
              <option value="wake" disabled={hasWake && typeof time === 'string'}>{t('When I start my day')}</option>
            </select>
            {typeof time === 'string'
              ? <input type="time" aria-label={t('Time {n}', { n: i + 1 })} value={time} onChange={e => setTime(i, e.target.value)} />
              : <label className="meds-latest">{t('By')} <input type="time" aria-label={t('Time {n}: at the latest', { n: i + 1 })} value={time.latest} onChange={e => setTime(i, { wake: true, latest: e.target.value })} /></label>}
            {times.length > 1 && <button type="button" className="btn btn-secondary" onClick={() => setTimes(ts => ts.filter((_, j) => j !== i))} aria-label={t('Remove time {n}', { n: i + 1 })}>{t('Remove')}</button>}
          </div>
        ))}
        {hasWake && <p className="field-hint">{t('Due when {name} first opens Kinwall on their own device, answers their Temp check or checks in that day, or at the “By” time if that comes first.', { name: member.name })}</p>}
        {times.length < 8 && <button type="button" className="btn btn-secondary" onClick={() => setTimes(ts => [...ts, '20:00'])}>{t('+ Add a time')}</button>}
      </fieldset>
      <div className="field">
        <label htmlFor="med-days">{t('Days')}</label>
        <select id="med-days" className="settings-select" value={mode} onChange={e => pickMode(e.target.value as DaysMode)}>
          <option value="every">{t('Every day')}</option>
          <option value="weekdays">{t('Weekdays')}</option>
          <option value="weekends">{t('Weekends')}</option>
          <option value="some">{t('Certain days')}</option>
        </select>
        {mode === 'some' && (
          <div className="chip-row meds-days" role="group" aria-label={t('Which days')}>
            {WEEKDAYS.map((d, i) => (
              <button key={d} type="button" className={`chip ${days.includes(i) ? 'active' : ''}`} aria-pressed={days.includes(i)} onClick={() => toggleDay(i)}>{weekdayShort(i)}</button>
            ))}
          </div>
        )}
        {days.length === 0 && <p className="field-hint">{t('Pick at least one day.')}</p>}
      </div>
      <div className="field">
        <label htmlFor="med-late">{t('Can be taken late')}</label>
        <select id="med-late" className="settings-select" value={lateWindow} onChange={e => setLateWindow(e.target.value as LateWindow)} aria-describedby="med-late-hint">
          <option value="3h">{t('Up to 3 hours')}</option>
          <option value="evening">{t('Until evening (8 PM)')}</option>
          <option value="endOfDay">{t('Until the end of the day')}</option>
          <option value="none">{t("Don't take late")}</option>
        </select>
        <p className="field-hint" id="med-late-hint">{t("Some medicines shouldn't be taken late. Check with your doctor or pharmacist.")}</p>
      </div>
      <div className="field">
        <label htmlFor="med-ends">{t('Ends')}</label>
        <select id="med-ends" className="settings-select" value={ends} onChange={e => setEnds(e.target.value as typeof ends)}>
          <option value="never">{t('No end')}</option>
          <option value="date">{t('On a date')}</option>
          <option value="doses">{t('After a number of doses')}</option>
        </select>
        {ends === 'date' && <div className="meds-ends-detail"><input type="date" aria-label={t('Last day')} value={endDate} onChange={e => setEndDate(e.target.value)} /></div>}
        {ends === 'doses' && (
          <div className="meds-ends-detail">
            <input type="number" inputMode="numeric" min={1} max={1000} aria-label={t('Total doses')} placeholder="20" value={totalDoses} onChange={e => setTotalDoses(e.target.value)} />
            <span aria-hidden="true">{t('doses in all')}</span>
          </div>
        )}
        {ends !== 'never' && <p className="field-hint">{ends === 'date' ? t('Reminders stop after this day.') : med?.dosesLeft != null ? t("Reminders stop once they're all taken. {n} left now.", { n: med.dosesLeft }) : t("For a course like an antibiotic: reminders stop once they're all taken. Skipped doses don't count.")}</p>}
      </div>
      <RefillFields refill={refill} onChange={setRefill} siblings={siblings} />
    </Sheet>
  )
}
