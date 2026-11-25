// A trip's stops (docs/using/trips.md, Stops): the places on the way, in order, each with its town,
// the time zone there and its own arrive and leave days. Stays can belong to a stop, and a stop's
// zone is the default for activities there. Grown-ups add, edit, reorder and remove them.
import { useId, useState } from 'react'
import { api } from './api.ts'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { PlusIcon } from './icons.tsx'
import { t, tn } from './i18n.ts'
import { tzName } from './timezone.ts'
import { longDay, reorderStops, tripWhen } from './trips.ts'
import { Labeled, ZoneField } from './tripShared.tsx'
import type { TripApi } from './Trips.tsx'
import type { Trip, TripStop } from './trip-types.ts'

export const stopsSummary = (trip: Pick<Trip, 'stops'>) => trip.stops.length ? [...trip.stops].sort((a, b) => a.sort - b.sort).map(s => s.label).join(' → ') : null

export function StopsPage({ t_, canEdit }: { t_: TripApi; canEdit: boolean }) {
  const { trip, save, busy } = t_
  const [editing, setEditing] = useState<TripStop | 'new' | null>(null)
  const stops = [...trip.stops].sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
  const move = (s: TripStop, by: -1 | 1) => {
    const changes = reorderStops(trip.stops, s.id, by)
    if (!changes.length) return
    // One revision after another, so the order lands as one change.
    void save(async rev => {
      let latest: Trip | null = null
      for (const c of changes) latest = await api.updateTripPart(trip.id, 'stops', c.id, latest?.revision ?? rev, { sort: c.sort })
      return latest!
    }, by < 0 ? t('Moved up: {name}', { name: s.label }) : t('Moved down: {name}', { name: s.label }))
  }
  return <>
    <div className="meals-heading"><div><h1>{t('Stops')}</h1><p className="field-hint">{stops.length ? tn(stops.length, '{n} stop', '{n} stops') : t('The places on the way, in order: a town, a park, Grandma’s.')}</p></div>
      {canEdit && <div className="meal-actions"><button className="btn btn-primary" onClick={() => setEditing('new')}><PlusIcon /> {t('Add a stop')}</button></div>}
    </div>
    {!stops.length && <p className="state-card">{canEdit ? t('A trip to one place doesn’t need stops. For a road trip, add each place you’ll stay or visit, with the time zone there.') : t('No stops yet.')}</p>}
    <ol className="trip-stops">{stops.map((s, i) => <li key={s.id} className="trip-stop">
      <span className="trip-stop-n" aria-hidden="true">{i + 1}</span>
      <div className="trip-leg-main">
        <strong>{s.label}</strong>
        <span className="outing-row-meta">{[s.town && s.town !== s.label ? s.town : null, s.arriveDate && tripWhen({ startDate: s.arriveDate, endDate: s.leaveDate, dateNote: null }), s.timezone && tzName(s.timezone)].filter(Boolean).join(' · ') || t('No dates yet')}</span>
        {s.notes && <span className="field-hint">{s.notes}</span>}
      </div>
      {canEdit && <div className="trip-stop-btns">
        <button type="button" className="btn btn-secondary trip-fit" disabled={busy || i === 0} onClick={() => move(s, -1)} aria-label={t('Move {name} up', { name: s.label })}>↑</button>
        <button type="button" className="btn btn-secondary trip-fit" disabled={busy || i === stops.length - 1} onClick={() => move(s, 1)} aria-label={t('Move {name} down', { name: s.label })}>↓</button>
        <button type="button" className="btn btn-secondary trip-fit" disabled={busy} onClick={() => setEditing(s)} aria-label={t('Edit {name}', { name: s.label })}>{t('Edit')}</button>
      </div>}
    </li>)}</ol>
    {stops.length > 0 && <p className="field-hint">{t('Places to stay can belong to a stop, and a stop’s time zone is used for activities there.')}</p>}
    {editing && <StopSheet stop={editing === 'new' ? null : editing} t_={t_} onClose={() => setEditing(null)} />}
  </>
}

function StopSheet({ stop, t_: { trip, save }, onClose }: { stop: TripStop | null; t_: TripApi; onClose: () => void }) {
  const dialog = useDialog()
  const id = useId()
  const last = [...trip.stops].sort((a, b) => b.sort - a.sort)[0]
  const [label, setLabel] = useState(stop?.label ?? '')
  const [town, setTown] = useState(stop?.town ?? '')
  const [timezone, setTimezone] = useState<string | null>(stop?.timezone ?? null)
  const [arriveDate, setArrive] = useState(stop?.arriveDate ?? last?.leaveDate ?? (trip.stops.length ? '' : trip.startDate ?? ''))
  const [leaveDate, setLeave] = useState(stop?.leaveDate ?? '')
  const [notes, setNotes] = useState(stop?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const used = trip.stayGroups.filter(g => stop && g.stopId === stop.id).length
  const submit = async () => {
    if (!label.trim()) { setError(t('Give the stop a name, like the town.')); return }
    if (arriveDate && leaveDate && leaveDate < arriveDate) { setError(t('Leaving is before arriving.')); return }
    const body = { label: label.trim(), town: town.trim() || null, timezone, arriveDate: arriveDate || null, leaveDate: leaveDate || null, notes: notes.trim() || null, ...(!stop && { sort: Math.max(-1, ...trip.stops.map(s => s.sort)) + 1 }) }
    setBusy(true); setError('')
    const ok = await save(rev => stop ? api.updateTripPart(trip.id, 'stops', stop.id, rev, body) : api.addTripPart(trip.id, 'stops', rev, body), t('Saved: {name}', { name: body.label }))
    setBusy(false)
    if (ok) onClose()
  }
  const remove = async () => {
    if (!stop || !await dialog.confirm({ title: t('Delete “{name}”?', { name: stop.label }), body: used ? tn(used, 'Its stay stays, without a stop.', 'Its {n} stays stay, without a stop.') : undefined, confirmLabel: t('Delete stop'), danger: true })) return
    setBusy(true)
    const ok = await save(rev => api.deleteTripPart(trip.id, 'stops', stop.id, rev), t('Deleted: {name}', { name: stop.label }))
    setBusy(false)
    if (ok) onClose()
  }
  return <Sheet title={stop ? t('Edit {name}', { name: stop.label }) : t('Add a stop')} onClose={() => { if (!busy) onClose() }} dismissable={!busy} dirty="auto" actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" type="submit" form={id} disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
  </>}>
    <form id={id} onSubmit={e => { e.preventDefault(); void submit() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="field"><label htmlFor={`${id}-label`}>{t('Name')}</label><input id={`${id}-label`} type="text" required maxLength={120} placeholder={t('Harbor Point, Grandma’s…')} value={label} onChange={e => setLabel(e.target.value)} /></div>
        <div className="field"><label htmlFor={`${id}-town`}>{t('Town (optional)')}</label><input id={`${id}-town`} type="text" maxLength={200} value={town} onChange={e => setTown(e.target.value)} /></div>
        <Labeled label={t('Time zone there')}>{fid => <ZoneField id={fid} label={t('Time zone there')} value={timezone} onChange={setTimezone} />}</Labeled>
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-in`}>{t('Arrive')}</label><input id={`${id}-in`} type="date" value={arriveDate} onChange={e => setArrive(e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-out`}>{t('Leave')}</label><input id={`${id}-out`} type="date" min={arriveDate || undefined} value={leaveDate} onChange={e => setLeave(e.target.value)} /></div>
        </div>
        {arriveDate && <p className="field-hint">{leaveDate ? t('{from} to {to}', { from: longDay(arriveDate), to: longDay(leaveDate) }) : longDay(arriveDate)}</p>}
        <div className="field"><label htmlFor={`${id}-notes`}>{t('Notes (optional)')}</label><textarea id={`${id}-notes`} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} />
          <p className="field-hint">{t('Everyone sees notes. Put addresses and codes in a place to stay’s booking details.')}</p></div>
        {stop && <div className="sheet-danger-zone"><button type="button" className="link-btn link-danger" onClick={() => void remove()}>{t('Delete stop…')}</button></div>}
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Sheet>
}
