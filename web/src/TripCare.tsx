// Home and pet care while a trip is on (docs/using/trips.md, Home and pet care): who feeds the cat,
// waters the plants or checks the house, on which home calendar days, with a checklist and private
// instructions (how to get in, who to call). The helper is a name and a way to reach them, never an
// account or an invitation. Only grown-ups' own devices get any of it from the server (canSeeCare);
// full-access ones change it. Nothing here hides it on its own, and nothing is kept offline.
import { useId, useState } from 'react'
import { api } from './api.ts'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { PlusIcon } from './icons.tsx'
import { t } from './i18n.ts'
import { CARE_EMOJI, careStatusLabel, longDay } from './trips.ts'
import { Choose } from './tripShared.tsx'
import type { TripApi } from './Trips.tsx'
import type { CareArrangement, CareKind, CareStatus, CareTask } from './trip-types.ts'

const KINDS: { value: CareKind; label: () => string }[] = [
  { value: 'pet', label: () => t('Pets') }, { value: 'plants', label: () => t('Plants') },
  { value: 'home', label: () => t('The house') }, { value: 'other', label: () => t('Something else') },
]
const STATUSES: CareStatus[] = ['needed', 'asked', 'confirmed', 'canceled']
const homeDays = (c: Pick<CareArrangement, 'fromDate' | 'toDate'>) => !c.fromDate ? null
  : !c.toDate || c.toDate === c.fromDate ? longDay(c.fromDate) : t('{from} – {to}', { from: longDay(c.fromDate), to: longDay(c.toDate) })

export function CarePage({ t_ }: { t_: TripApi }) {
  const { trip, save, busy } = t_
  const [editing, setEditing] = useState<CareArrangement | 'new' | null>(null)
  if (!trip.canSeeCare) return <p className="state-card">{t('Home and pet care is only on grown-ups’ own devices.')}</p>
  const canEdit = !!trip.canEditCare
  const care = [...(trip.care ?? [])].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
  const tick = (c: CareArrangement, task: CareTask) => {
    const tasks = c.tasks.map(x => x.id === task.id ? { ...x, done: !x.done } : x)
    void save(rev => api.updateTripPart(trip.id, 'care', c.id, rev, { tasks }))
  }
  return <>
    <div className="meals-heading"><div><h1>{t('Home and pet care')}</h1>
      <p className="field-hint">{t('Who looks after pets, plants and the house while you’re away.')}</p></div>
      {canEdit && <div className="meal-actions"><button className="btn btn-primary" onClick={() => setEditing('new')}><PlusIcon /> {t('Add care')}</button></div>}
    </div>
    <p className="field-hint trip-care-private"><span aria-hidden="true">🔒 </span>{t('Only grown-ups’ own devices see this: never the wall, kids’ devices or connected apps. Dates are days at home.')}</p>
    {trip.careUnavailable && <p className="state-card" role="alert"><span aria-hidden="true">⚠️ </span>{t('Some home or pet care could not be opened. Check this server’s encryption key or restore a private backup.')}</p>}
    {!care.length && !trip.careUnavailable && <p className="state-card">{canEdit ? t('Nothing set up yet. Add who feeds the pets, waters the plants or checks on the house, with what they need to know.') : t('Nothing set up yet.')}</p>}
    <ul className="trip-care-list">{care.map(c => <li key={c.id} className="trip-card trip-care">
      <div className="trip-care-head">
        <span className="trip-decision-emoji" aria-hidden="true">{CARE_EMOJI[c.kind]}</span>
        <div className="trip-leg-main">
          <strong>{c.title}</strong>
          <span className="outing-row-meta">{[c.helperName ?? t('No helper yet'), homeDays(c) && t('At home: {days}', { days: homeDays(c)! })].filter(Boolean).join(' · ')}</span>
        </div>
        {canEdit && <button type="button" className="btn btn-secondary trip-fit" disabled={busy} onClick={() => setEditing(c)} aria-label={t('Edit {name}', { name: c.title })}>{t('Edit')}</button>}
      </div>
      <p className="trip-head-meta"><span className={`chip chip-static trip-care-status trip-care-${c.status}`}>{careStatusLabel(c.status)}</span>
        {c.helperContact && <span className="chip chip-static">📞 {c.helperContact}</span>}</p>
      {c.tasks.length > 0 && <ul className="trip-care-tasks" aria-label={t('Checklist for {name}', { name: c.title })}>{c.tasks.map(task => <li key={task.id}>
        <label className="trip-care-task"><input type="checkbox" checked={task.done} disabled={!canEdit || busy} onChange={() => tick(c, task)} /><span>{task.text}</span></label>
      </li>)}</ul>}
      {(c.instructions || c.entry || c.emergency) && <dl className="trip-care-private-list">
        {c.instructions && <><dt>{t('🔒 Instructions')}</dt><dd>{c.instructions}</dd></>}
        {c.entry && <><dt>{t('🔒 Getting in')}</dt><dd>{c.entry}</dd></>}
        {c.emergency && <><dt>{t('🔒 If something goes wrong')}</dt><dd>{c.emergency}</dd></>}
      </dl>}
    </li>)}</ul>
    {care.length > 0 && <p className="field-hint">{t('This keeps track of the plan. It doesn’t message the helper, give them a login or add chores.')}</p>}
    {editing && <CareSheet care={editing === 'new' ? null : editing} t_={t_} onClose={() => setEditing(null)} />}
  </>
}

function CareSheet({ care, t_: { trip, save }, onClose }: { care: CareArrangement | null; t_: TripApi; onClose: () => void }) {
  const dialog = useDialog()
  const id = useId()
  const [kind, setKind] = useState<CareKind>(care?.kind ?? 'pet')
  const [title, setTitle] = useState(care?.title ?? '')
  const [status, setStatus] = useState<CareStatus>(care?.status ?? 'needed')
  const [helperName, setHelperName] = useState(care?.helperName ?? '')
  const [helperContact, setHelperContact] = useState(care?.helperContact ?? '')
  const [fromDate, setFrom] = useState(care ? care.fromDate ?? '' : trip.startDate ?? '')
  const [toDate, setTo] = useState(care ? care.toDate ?? '' : trip.endDate ?? trip.startDate ?? '')
  const [tasks, setTasks] = useState<CareTask[]>(care?.tasks ?? [])
  const [instructions, setInstructions] = useState(care?.instructions ?? '')
  const [entry, setEntry] = useState(care?.entry ?? '')
  const [emergency, setEmergency] = useState(care?.emergency ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const setTask = (i: number, text: string) => setTasks(ts => ts.map((x, j) => j === i ? { ...x, text } : x))
  const submit = async () => {
    if (!title.trim()) { setError(t('Give it a name, like “Feed Biscuit”.')); return }
    if (!fromDate !== !toDate) { setError(t('Pick both days, or neither.')); return }
    if (fromDate && toDate < fromDate) { setError(t('The last day is before the first.')); return }
    const body = {
      kind, title: title.trim(), status, helperName: helperName.trim() || null, helperContact: helperContact.trim() || null,
      fromDate: fromDate || null, toDate: toDate || null,
      tasks: tasks.map(x => ({ ...x, text: x.text.trim() })).filter(x => x.text),
      instructions: instructions.trim() || null, entry: entry.trim() || null, emergency: emergency.trim() || null,
      ...(!care && { sort: Math.max(-1, ...(trip.care ?? []).map(c => c.sort)) + 1 }),
    }
    setBusy(true); setError('')
    const ok = await save(rev => care ? api.updateTripPart(trip.id, 'care', care.id, rev, body) : api.addTripPart(trip.id, 'care', rev, body), t('Saved: {name}', { name: body.title }))
    setBusy(false)
    if (ok) onClose()
  }
  const remove = async () => {
    if (!care || !await dialog.confirm({ title: t('Delete “{name}”?', { name: care.title }), body: t('Its checklist and private instructions go too.'), confirmLabel: t('Delete'), danger: true })) return
    setBusy(true)
    const ok = await save(rev => api.deleteTripPart(trip.id, 'care', care.id, rev), t('Deleted: {name}', { name: care.title }))
    setBusy(false)
    if (ok) onClose()
  }
  return <Sheet title={care ? t('Edit {name}', { name: care.title }) : t('Add care')} onClose={() => { if (!busy) onClose() }} dismissable={!busy} dirty="auto" actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" type="submit" form={id} disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
  </>}>
    <form id={id} onSubmit={e => { e.preventDefault(); void submit() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="meal-form-row">
          <Choose label={t('For')} value={kind} onChange={setKind} options={KINDS.map(k => ({ value: k.value, emoji: CARE_EMOJI[k.value], label: k.label() }))} />
          <Choose label={t('Status')} value={status} onChange={setStatus} options={STATUSES.map(s => ({ value: s, label: careStatusLabel(s) }))} />
        </div>
        <div className="field"><label htmlFor={`${id}-title`}>{t('What')}</label><input id={`${id}-title`} type="text" required maxLength={120} placeholder={t('Feed Biscuit, water the plants…')} value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-helper`}>{t('Helper (optional)')}</label><input id={`${id}-helper`} type="text" maxLength={120} autoComplete="off" placeholder={t('A neighbor, a friend…')} value={helperName} onChange={e => setHelperName(e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-contact`}>{t('How to reach them (optional)')}</label><input id={`${id}-contact`} type="text" maxLength={200} autoComplete="off" value={helperContact} onChange={e => setHelperContact(e.target.value)} /></div>
        </div>
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-from`}>{t('First day')}</label><input id={`${id}-from`} type="date" value={fromDate} onChange={e => setFrom(e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-to`}>{t('Last day')}</label><input id={`${id}-to`} type="date" min={fromDate || undefined} value={toDate} onChange={e => setTo(e.target.value)} /></div>
        </div>
        <p className="field-hint">{t('Days at home, on the family calendar, whatever time it is on the trip.')}</p>
        <fieldset className="meal-fieldset field">
          <legend className="trip-legend">{t('Checklist (optional)')}</legend>
          {tasks.map((x, i) => <div key={x.id} className="trip-care-task-edit">
            <input type="text" maxLength={200} aria-label={t('Checklist item {n}', { n: i + 1 })} value={x.text} onChange={e => setTask(i, e.target.value)} />
            <button type="button" className="btn btn-secondary trip-fit" aria-label={t('Remove checklist item {n}', { n: i + 1 })} onClick={() => setTasks(ts => ts.filter((_, j) => j !== i))}>✕</button>
          </div>)}
          {tasks.length < 100 && <button type="button" className="btn btn-secondary trip-fit" onClick={() => setTasks(ts => [...ts, { id: crypto.randomUUID(), text: '', done: false }])}><PlusIcon /> {t('Add to checklist')}</button>}
        </fieldset>
        <fieldset className="meal-fieldset trip-care-private-fields">
          <legend className="trip-legend">{t('🔒 Private')}</legend>
          <p className="field-hint">{t('Grown-ups’ own devices only. Write it here for your own reference; Kinwall doesn’t send it to the helper.')}</p>
          <div className="field"><label htmlFor={`${id}-instructions`}>{t('Instructions')}</label><textarea id={`${id}-instructions`} maxLength={4000} placeholder={t('Half a scoop morning and night. Plants on Tuesday.')} value={instructions} onChange={e => setInstructions(e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-entry`}>{t('Getting in')}</label><textarea id={`${id}-entry`} maxLength={4000} autoComplete="off" placeholder={t('Key, door code, alarm…')} value={entry} onChange={e => setEntry(e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-emergency`}>{t('If something goes wrong')}</label><textarea id={`${id}-emergency`} maxLength={4000} placeholder={t('Who to call: the vet, a neighbor…')} value={emergency} onChange={e => setEmergency(e.target.value)} /></div>
        </fieldset>
        {care && <div className="sheet-danger-zone"><button type="button" className="link-btn link-danger" onClick={() => void remove()}>{t('Delete…')}</button></div>}
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Sheet>
}
