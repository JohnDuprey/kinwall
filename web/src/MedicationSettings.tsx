// Settings → Family → Medications (parent devices): turn medication reminders on (with a one-time
// notice about what's kept and who sees it), names on shared screens, each person's medicines, and
// "Delete all medication data" behind More….
import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { inkFor } from './color.ts'
import Sheet from './Sheet.tsx'
import { daysLabel, EVERY_DAY, scheduleLabel, WEEKDAYS } from './medications.ts'
import type { Medication, Member } from './types.ts'

const NOTICE = 'Kinwall keeps each medicine’s name, dose and times, and when a dose was marked taken or skipped. It’s encrypted on the server. Parent devices see everyone’s; each person’s own device sees theirs. Wall screens show “Meds” when a dose is due, without names. Reminders say “Time for Leo’s medicine” unless a device turns names on. Nothing goes to connected apps, webhooks or Home Assistant.'

export default function MedicationSettings() {
  const { settings, members, reloadCore, toast } = useApp()
  const dialog = useDialog()
  const on = settings.medications
  const [meds, setMeds] = useState<Medication[]>([])
  const [editing, setEditing] = useState<{ med: Medication | null; member: Member } | null>(null)
  const load = () => { if (on) api.getMedications().then(setMeds).catch(() => setMeds([])) }
  useEffect(load, [on]) // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (patch: { medications?: boolean; medicationNamesOnWalls?: boolean }) => {
    try { await api.updateSettings(patch); reloadCore() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save settings', true) }
  }
  const toggle = async () => {
    if (!on && !await dialog.confirm({ title: 'Turn on medication reminders?', body: NOTICE, confirmLabel: 'Turn on' })) return
    save({ medications: !on })
  }
  const more = async (action: string) => {
    if (action !== 'delete-all') return
    if (!await dialog.confirm({ title: 'Delete all medication data?', body: 'Every medicine and its taken and skipped log, for everyone. This can’t be undone.', confirmLabel: 'Delete all', danger: true })) return
    try { await api.deleteAllMedications(); setMeds([]); toast('Medication data deleted') } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't delete that", true) }
  }

  return (
    <section className="settings-section" id="medications" aria-labelledby="medications-title">
      <h2 className="settings-section-title" id="medications-title" tabIndex={-1}>Medications</h2>
      <div className="toggle-row">
        <div>
          <label id="meds-on-label">Medication reminders</label>
          <div className="settings-row-sub" id="meds-on-sub">{on ? 'A reminder at each dose time and a Take now card on the Board. Only parent devices add or change medicines.' : 'Off: nothing about medicines shows anywhere. Anything saved is kept.'}</div>
        </div>
        <button className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-labelledby="meds-on-label" aria-describedby="meds-on-sub" onClick={toggle}><span className="knob" /></button>
      </div>
      {on && <>
        <div className="toggle-row">
          <div>
            <label id="meds-names-label">Show medicine names on shared screens</label>
            <div className="settings-row-sub" id="meds-names-sub">Off: wall screens say “Meds”. Parent devices and each person’s own device always show names.</div>
          </div>
          <button className={`switch ${settings.medicationNamesOnWalls ? 'on' : ''}`} role="switch" aria-checked={settings.medicationNamesOnWalls} aria-labelledby="meds-names-label" aria-describedby="meds-names-sub"
            onClick={() => save({ medicationNamesOnWalls: !settings.medicationNamesOnWalls })}><span className="knob" /></button>
        </div>
        {members.map(m => {
          const mine = meds.filter(x => x.memberId === m.id)
          return (
            <div key={m.id} className="meds-person">
              <div className="meds-person-head">
                <span className="board-avatar" style={{ background: m.color, color: inkFor(m.color) }} aria-hidden="true">{m.avatar || m.name[0]}</span>
                <span className="settings-row-label">{m.name}</span>
              </div>
              {mine.map(x => (
                <button key={x.id} className="meds-set-row" onClick={() => setEditing({ med: x, member: m })} aria-label={`Edit ${x.name} for ${m.name}`}>
                  <span className="settings-row-label">{x.dose ? `${x.name} · ${x.dose}` : x.name}</span>
                  <span className="settings-row-sub">{scheduleLabel(x)}</span>
                </button>
              ))}
              <div className="settings-inline-btns">
                <button className="btn btn-secondary" onClick={() => setEditing({ med: null, member: m })}>+ Add medicine</button>
                {mine.length > 0 && <a className="btn btn-secondary meds-link" href={`#/medications/${m.id}`}>History</a>}
              </div>
            </div>
          )
        })}
      </>}
      <div className="settings-row">
        <div className="settings-row-sub">{on ? 'Reminders follow quiet hours: during them, the card and the bell still show.' : ''}</div>
        <select className="settings-select" aria-label="More medication actions" value="" onChange={e => more(e.target.value)}>
          <option value="">More…</option>
          <option value="delete-all">Delete all medication data</option>
        </select>
      </div>
      {editing && <MedicationSheet med={editing.med} member={editing.member} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load() }} />}
    </section>
  )
}

type DaysMode = 'every' | 'weekdays' | 'weekends' | 'some'
const modeOf = (days: number[]): DaysMode => { const l = daysLabel(days); return l === 'Every day' ? 'every' : l === 'Weekdays' ? 'weekdays' : l === 'Weekends' ? 'weekends' : 'some' }
const MODE_DAYS: Record<Exclude<DaysMode, 'some'>, number[]> = { every: EVERY_DAY, weekdays: [1, 2, 3, 4, 5], weekends: [0, 6] }

function MedicationSheet({ med, member, onClose, onSaved }: { med: Medication | null; member: Member; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp()
  const dialog = useDialog()
  const [name, setName] = useState(med?.name ?? '')
  const [dose, setDose] = useState(med?.dose ?? '')
  const [times, setTimes] = useState<string[]>(med?.times ?? ['08:00'])
  const [days, setDays] = useState<number[]>(med?.days ?? EVERY_DAY)
  const [mode, setMode] = useState<DaysMode>(modeOf(med?.days ?? EVERY_DAY))
  const valid = name.trim() && times.length > 0 && times.every(Boolean) && days.length > 0
  const save = async () => {
    const body = { name: name.trim(), dose: dose.trim(), times, days }
    try {
      if (med) await api.updateMedication(med.id, body)
      else await api.addMedication({ memberId: member.id, ...body })
      toast(`Saved: ${body.name}`)
      onSaved()
    } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save that", true) }
  }
  const more = async (action: string) => {
    if (action !== 'delete' || !med) return
    if (!await dialog.confirm({ title: `Delete ${med.name}?`, body: `Its reminders stop and its history for ${member.name} is deleted.`, confirmLabel: 'Delete', danger: true })) return
    try { await api.deleteMedication(med.id); toast(`Deleted: ${med.name}`); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't delete that", true) }
  }
  const pickMode = (m: DaysMode) => { setMode(m); if (m !== 'some') setDays(MODE_DAYS[m]) }
  const toggleDay = (d: number) => setDays(ds => ds.includes(d) ? ds.filter(x => x !== d) : [...ds, d].sort())

  return (
    <Sheet title={med ? `Edit ${med.name}` : `New medicine for ${member.name}`} onClose={onClose}
      actions={<>
        {med && <select className="settings-select" aria-label="More" value="" onChange={e => more(e.target.value)}><option value="">More…</option><option value="delete">Delete medicine</option></select>}
        <button className="btn btn-primary" onClick={save} disabled={!valid}>Save</button>
      </>}>
      <div className="field">
        <label htmlFor="med-name">Medicine</label>
        <input id="med-name" type="text" maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="Allergy medicine" autoComplete="off" />
        <p className="field-hint">Just a name the family knows it by. No need for what it's for.</p>
      </div>
      <div className="field">
        <label htmlFor="med-dose">Dose <span className="settings-row-sub">(optional)</span></label>
        <input id="med-dose" type="text" maxLength={40} value={dose} onChange={e => setDose(e.target.value)} placeholder="1 tablet or 5 mg" autoComplete="off" />
      </div>
      <fieldset className="field meds-times">
        <legend>Times</legend>
        {times.map((t, i) => (
          <div key={i} className="meds-time-row">
            <input type="time" aria-label={`Time ${i + 1}`} value={t} onChange={e => setTimes(ts => ts.map((x, j) => (j === i ? e.target.value : x)))} />
            {times.length > 1 && <button type="button" className="btn btn-secondary" onClick={() => setTimes(ts => ts.filter((_, j) => j !== i))} aria-label={`Remove time ${i + 1}`}>Remove</button>}
          </div>
        ))}
        {times.length < 8 && <button type="button" className="btn btn-secondary" onClick={() => setTimes(ts => [...ts, '20:00'])}>+ Add a time</button>}
      </fieldset>
      <div className="field">
        <label htmlFor="med-days">Days</label>
        <select id="med-days" className="settings-select" value={mode} onChange={e => pickMode(e.target.value as DaysMode)}>
          <option value="every">Every day</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekends">Weekends</option>
          <option value="some">Certain days</option>
        </select>
        {mode === 'some' && (
          <div className="chip-row meds-days" role="group" aria-label="Which days">
            {WEEKDAYS.map((d, i) => (
              <button key={d} type="button" className={`chip ${days.includes(i) ? 'active' : ''}`} aria-pressed={days.includes(i)} onClick={() => toggleDay(i)}>{d}</button>
            ))}
          </div>
        )}
        {days.length === 0 && <p className="field-hint">Pick at least one day.</p>}
      </div>
    </Sheet>
  )
}
