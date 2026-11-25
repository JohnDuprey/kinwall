// A trip's Getting there and Day plan (docs/using/trips.md). Legs are records to keep track of,
// never options to compare: each clock is shown in the zone where it happens. The day plan shows
// only what's tied to this trip: legs and stays from their own records, trip activities, and
// outings, meals and events linked from their own areas (never every meal on those dates).
import { useEffect, useId, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import PickField from './PickField.tsx'
import { Face } from './Face'
import { PlusIcon } from './icons.tsx'
import { formatTime } from './timeFormat.ts'
import { t, tn } from './i18n.ts'
import { dayPlan, legClock, LEG_EMOJI, longDay } from './trips.ts'
import { Choose, errText, Faces, Labeled, useActingAs, useTripWho, ZoneField } from './tripShared.tsx'
import { PlanLine, type TripApi } from './Trips.tsx'
import type { LegDetails, LegInput, LegMode, MarkKind, TripActivity, TripCan, TripItem, TripLeg } from './trip-types.ts'
import type { EventInstance, Outing } from './types.ts'
import type { Meal } from './meal-types.ts'

const MODES: LegMode[] = ['flight', 'drive', 'train', 'bus', 'ferry', 'rental', 'other']
const modeLabel = (m: LegMode) => m === 'flight' ? t('Flight') : m === 'drive' ? t('Drive') : m === 'train' ? t('Train') : m === 'bus' ? t('Bus') : m === 'ferry' ? t('Ferry') : m === 'rental' ? t('Rental car') : t('Other')

export function TravelPage({ t_, can }: { t_: TripApi; can: TripCan }) {
  const { trip } = t_
  const { members } = useApp()
  const [editing, setEditing] = useState<TripLeg | 'new' | null>(null)
  const legs = [...trip.legs].sort((a, b) => (a.departDate ?? '9999').localeCompare(b.departDate ?? '9999') || (a.departTime ?? '').localeCompare(b.departTime ?? '') || a.sort - b.sort)
  return <>
    <div className="meals-heading"><div><h1>{t('Getting there')}</h1><p className="field-hint">{trip.legs.length ? `${tn(trip.legs.length, '{n} leg', '{n} legs')} · ${t('{n} booked', { n: trip.counts.legsBooked })}` : t('Flights, drives, trains and rental cars, in order.')}</p></div>
      {can.edit && <div className="meal-actions"><button className="btn btn-primary" onClick={() => setEditing('new')}><PlusIcon /> {t('Add a leg')}</button></div>}
    </div>
    {!legs.length && <p className="state-card">{can.edit ? t('Add each part of the journey: the flight out, the rental car, the drive between stops, the way home.') : t('Nothing here yet.')}</p>}
    <ul className="trip-legs">{legs.map(l => <LegRow key={l.id} l={l} members={members} onEdit={can.edit ? () => setEditing(l) : undefined} />)}</ul>
    <p className="field-hint">{t('Times stay in their own time zone, and “+1” marks a next-day arrival. Booked shows only when a grown-up marks it; Kinwall doesn’t check airlines.')}</p>
    {editing && <LegSheet leg={editing === 'new' ? null : editing} t_={t_} onClose={() => setEditing(null)} />}
  </>
}

function LegRow({ l, members, onEdit }: { l: TripLeg; members: ReturnType<typeof useApp>['members']; onEdit?: () => void }) {
  const c = legClock(l)
  const title = l.title || [l.from, l.to].filter(Boolean).join(' → ') || modeLabel(l.mode)
  const when = [l.departDate && longDay(l.departDate), [l.carrier, l.number].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
  const badge = l.booking === 'booked' ? t('✓ Booked') : l.booking === 'canceled' ? t('✕ Canceled') : ['drive', 'other'].includes(l.mode) ? t('Plan only') : t('Not booked yet')
  return <li className="trip-leg">
    <span className="outing-emoji" aria-hidden="true">{LEG_EMOJI[l.mode]}</span>
    <div className="trip-leg-main">
      <strong>{title}</strong>
      {when && <span className="outing-row-meta">{when}</span>}
      {(c.depart || c.arrive) && <span className="trip-leg-clock">{c.depart ?? '—'}{c.arrive && <> → {c.arrive}{c.plusDays > 0 && <span className="trip-plus" aria-label={tn(c.plusDays, 'the next day', '{n} days later')}> +{c.plusDays}</span>}</>}</span>}
      {l.notes && <span className="field-hint">{l.notes}</span>}
      <span className="outing-tags"><span className="chip chip-static">{badge}</span>{l.memberIds.length > 0 && <span className="chip chip-static trip-going"><Faces ids={l.memberIds} members={members} /> {l.memberIds.map(id => members.find(m => m.id === id)?.name).filter(Boolean).join(', ')}</span>}</span>
      {l.details && (l.details.confirmation || l.details.manageUrl || l.details.notes) && <div className="trip-details">
        {l.details.confirmation && <p>🎫 {t('Confirmation: {code}', { code: l.details.confirmation })}</p>}
        {l.details.notes && <p>🔒 {l.details.notes}</p>}
        {l.details.manageUrl && <p><a href={l.details.manageUrl} target="_blank" rel="noopener noreferrer">{t('Manage booking')}</a></p>}
      </div>}
      {!l.details && l.hasDetails && <span className="field-hint">{t('🔒 Booking details are for grown-ups.')}</span>}
    </div>
    {onEdit && <button type="button" className="btn btn-secondary trip-fit" onClick={onEdit} aria-label={t('Edit {name}', { name: title })}>{t('Edit')}</button>}
  </li>
}

type LegDraft = Omit<LegInput, 'details'> & { details: LegDetails }
function LegSheet({ leg, t_: { trip, save }, onClose }: { leg: TripLeg | null; t_: TripApi; onClose: () => void }) {
  const { members } = useApp()
  const who = useTripWho()
  const dialog = useDialog()
  const id = useId()
  const [d, setD] = useState<LegDraft>(() => ({
    mode: leg?.mode ?? 'flight', title: leg?.title ?? null, from: leg?.from ?? null, to: leg?.to ?? null,
    departDate: leg?.departDate ?? trip.startDate, departTime: leg?.departTime ?? null, departTz: leg?.departTz ?? null,
    arriveDate: leg?.arriveDate ?? null, arriveTime: leg?.arriveTime ?? null, arriveTz: leg?.arriveTz ?? null,
    carrier: leg?.carrier ?? null, number: leg?.number ?? null, memberIds: leg?.memberIds ?? trip.memberIds, booking: leg?.booking ?? 'none', notes: leg?.notes ?? null,
    details: { confirmation: null, manageUrl: null, notes: null, ...leg?.details },
  }))
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof LegDraft>(k: K, v: LegDraft[K]) => setD(x => ({ ...x, [k]: v }))
  const text = (k: 'title' | 'from' | 'to' | 'carrier' | 'number' | 'notes', v: string) => set(k, v.trim() ? v : null)
  const detail = (k: keyof LegDetails, v: string) => { setTouched(true); setD(x => ({ ...x, details: { ...x.details, [k]: v.trim() ? v : null } })) }
  const submit = async () => {
    if (d.arriveDate && d.departDate && d.arriveDate < d.departDate && !(d.departTz && d.arriveTz)) { setError(t('Arriving is before leaving. Add both time zones if it crosses the date line.')); return }
    const { details, ...rest } = d
    const body: LegInput = { ...rest, ...(!leg && { sort: Math.max(-1, ...trip.legs.map(l => l.sort)) + 1 }), ...((!leg || touched) && who.parent && { details: Object.values(details).some(Boolean) ? details : null }) }
    setBusy(true); setError('')
    const ok = await save(rev => leg ? api.updateTripPart(trip.id, 'legs', leg.id, rev, body) : api.addTripPart(trip.id, 'legs', rev, body), t('Saved: {name}', { name: d.title || [d.from, d.to].filter(Boolean).join(' → ') || modeLabel(d.mode!) }))
    setBusy(false)
    if (ok) onClose()
  }
  const remove = async () => {
    if (!leg || !await dialog.confirm({ title: t('Delete “{name}”?', { name: leg.title || modeLabel(leg.mode) }), confirmLabel: t('Delete leg'), danger: true })) return
    setBusy(true)
    const ok = await save(rev => api.deleteTripPart(trip.id, 'legs', leg.id, rev), t('Leg deleted'))
    setBusy(false)
    if (ok) onClose()
  }
  const input = (k: 'title' | 'from' | 'to' | 'carrier' | 'number', label: string, placeholder = '') =>
    <div className="field"><label htmlFor={`${id}-${k}`}>{label}</label><input id={`${id}-${k}`} type="text" maxLength={200} placeholder={placeholder} value={d[k] ?? ''} onChange={e => text(k, e.target.value)} /></div>
  return <Sheet title={leg ? t('Edit leg') : t('Add a leg')} onClose={() => { if (!busy) onClose() }} dismissable={!busy} dirty="auto" actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" type="submit" form={id} disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
  </>}>
    <form id={id} onSubmit={e => { e.preventDefault(); void submit() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <Choose label={t('How')} value={d.mode!} onChange={v => set('mode', v)} options={MODES.map(m => ({ value: m, emoji: LEG_EMOJI[m], label: modeLabel(m) }))} />
        {input('title', t('Name (optional)'), t('Fly to Harbor Point'))}
        <div className="meal-form-row">{input('from', d.mode === 'rental' ? t('Pick up at') : t('From'))}{input('to', d.mode === 'rental' ? t('Return at') : t('To'))}</div>
        <h3>{d.mode === 'rental' ? t('Pick up') : t('Leaves')}</h3>
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-dd`}>{t('Date')}</label><input id={`${id}-dd`} type="date" value={d.departDate ?? ''} onChange={e => set('departDate', e.target.value || null)} /></div>
          <div className="field"><label htmlFor={`${id}-dt`}>{t('Time')}</label><input id={`${id}-dt`} type="time" value={d.departTime ?? ''} onChange={e => set('departTime', e.target.value || null)} /></div>
        </div>
        <Labeled label={t('Time zone where it leaves')}>{fid => <ZoneField id={fid} label={t('Time zone where it leaves')} value={d.departTz ?? null} onChange={v => set('departTz', v)} />}</Labeled>
        <h3>{d.mode === 'rental' ? t('Return') : t('Arrives')}</h3>
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-ad`}>{t('Date')}</label><input id={`${id}-ad`} type="date" value={d.arriveDate ?? ''} onChange={e => set('arriveDate', e.target.value || null)} /></div>
          <div className="field"><label htmlFor={`${id}-at`}>{t('Time')}</label><input id={`${id}-at`} type="time" value={d.arriveTime ?? ''} onChange={e => set('arriveTime', e.target.value || null)} /></div>
        </div>
        <Labeled label={t('Time zone where it arrives')}>{fid => <ZoneField id={fid} label={t('Time zone where it arrives')} value={d.arriveTz ?? null} onChange={v => set('arriveTz', v)} />}</Labeled>
        <p className="field-hint">{t('Use the times on the ticket, in each place’s own time. Leave a zone as Not sure rather than guessing.')}</p>
        <div className="meal-form-row">{input('carrier', d.mode === 'rental' ? t('Company') : t('Airline or company'))}{d.mode !== 'drive' && d.mode !== 'rental' && input('number', t('Flight or train number'))}</div>
        <Labeled label={t('Who’s on it')}>{fid => <PickField id={fid} label={t('Who’s on it')} multiple none={t('Nobody picked')} value={d.memberIds ?? []} onChange={v => set('memberIds', v)} options={members.map(m => ({ value: m.id, label: m.name, lead: <Face m={m} /> }))} />}</Labeled>
        <Choose<TripLeg['booking']> label={t('Booking')} value={d.booking!} onChange={v => set('booking', v)}
          options={[{ value: 'none', label: ['drive', 'other'].includes(d.mode!) ? t('Plan only') : t('Not booked yet') }, { value: 'booked', label: t('Booked') }, { value: 'canceled', label: t('Canceled') }]} />
        <div className="field"><label htmlFor={`${id}-notes`}>{t('Notes (optional)')}</label><textarea id={`${id}-notes`} maxLength={2000} placeholder={t('About 3 hours. Leave after checkout.')} value={d.notes ?? ''} onChange={e => text('notes', e.target.value)} />
          <p className="field-hint">{t('Everyone sees notes. Put confirmation numbers in booking details.')}</p></div>
        {who.parent && <fieldset className="meal-fieldset trip-details-fields">
          <legend><span aria-hidden="true">🔒 </span>{t('Booking details')}</legend>
          <div className="field"><label htmlFor={`${id}-conf`}>{t('Confirmation number')}</label><input id={`${id}-conf`} type="text" autoComplete="off" maxLength={200} value={d.details.confirmation ?? ''} onChange={e => detail('confirmation', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-man`}>{t('Manage booking link')}</label><input id={`${id}-man`} type="url" maxLength={2000} value={d.details.manageUrl ?? ''} onChange={e => detail('manageUrl', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-pn`}>{t('Private notes')}</label><input id={`${id}-pn`} type="text" autoComplete="off" maxLength={500} placeholder={t('Seats, loyalty number')} value={d.details.notes ?? ''} onChange={e => detail('notes', e.target.value)} /></div>
        </fieldset>}
        {leg && <div className="sheet-danger-zone"><button type="button" className="link-btn link-danger" onClick={() => void remove()}>{t('Delete leg…')}</button></div>}
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Sheet>
}

export function PlanPage({ t_, can }: { t_: TripApi; can: TripCan }) {
  const { trip } = t_
  const { members } = useApp()
  const plan = dayPlan(trip)
  const [activity, setActivity] = useState<{ item: TripActivity | null; date: string | null } | null>(null)
  const [linking, setLinking] = useState<string | null | false>(false)
  const open = (it: TripItem) => { if (it.kind === 'activity') setActivity({ item: it, date: it.date }) }
  const hrefOf = (it: TripItem) => it.kind === 'outing' ? `#/outings?outing=${encodeURIComponent(it.refId)}` : it.kind === 'meal' ? `#/meals?meal=${encodeURIComponent(it.refId)}` : it.kind === 'event' ? `#/calendar?${new URLSearchParams({ event: it.refId, ...(it.date && { at: it.date }) })}` : null
  const day = (date: string, entries: ReturnType<typeof dayPlan>['outside']) => <section key={date} className="trip-day" aria-labelledby={`day-${date}`}>
    <h2 id={`day-${date}`}>{longDay(date)}</h2>
    {entries.length ? <ul className="trip-plan-list">{entries.map(e => {
      if (e.kind !== 'item') return <PlanLine key={`${e.kind}-${e.id}`} e={e} />
      const href = hrefOf(e.item)
      return <li key={e.id} className="trip-plan-line trip-plan-tap">
        {href && !(e.item.kind !== 'activity' && e.item.missing) ? <a href={href} className="trip-plan-link"><PlanBits it={e.item} time={e.time} members={members} /></a>
          : e.item.kind === 'activity' ? <button type="button" className="trip-plan-link" onClick={() => open(e.item)}><PlanBits it={e.item} time={e.time} members={members} /></button>
          : <span className="trip-plan-link"><PlanBits it={e.item} time={e.time} members={members} /></span>}
      </li>
    })}</ul> : <p className="field-hint">{t('Nothing planned yet.')}</p>}
  </section>
  return <>
    <div className="meals-heading"><div><h1>{t('Day plan')}</h1><p className="field-hint">{t('Only what’s tied to this trip. Legs and stays show up from their own records.')}</p></div>
      <div className="meal-actions">
        {can.edit && <button className="btn btn-secondary" onClick={() => setLinking(trip.startDate)}>{t('Link from Outings, Meals or the calendar')}</button>}
        {can.suggest && <button className="btn btn-primary" onClick={() => setActivity({ item: null, date: null })}><PlusIcon /> {can.edit ? t('Add something to do') : t('Suggest something')}</button>}
      </div>
    </div>
    {!plan.days.length && <p className="state-card">{t('Add the trip’s dates to see it day by day. Ideas can go below meanwhile.')}</p>}
    {plan.days.map(d => day(d.date, d.entries))}
    {plan.outside.length > 0 && <section className="trip-day"><h2>{t('Outside the trip’s dates')}</h2><ul className="trip-plan-list">{plan.outside.map(e => <PlanLine key={`${e.kind}-${e.id}`} e={e} withDate />)}</ul></section>}
    <section className="trip-day trip-ideas" aria-labelledby="trip-ideas-h">
      <h2 id="trip-ideas-h">{t('Things to do there')} <small>{t('not on a day yet')}</small></h2>
      {plan.ideas.length ? <ul className="trip-plan-list">{plan.ideas.map(it => <li key={it.id} className="trip-plan-line trip-plan-tap">
        <button type="button" className="trip-plan-link" onClick={() => open(it)} disabled={it.kind !== 'activity'}><PlanBits it={it} time={null} members={members} /></button>
      </li>)}</ul> : <p className="field-hint">{t('Got an idea? Suggest something to do, and a grown-up puts it on a day.')}</p>}
    </section>
    {activity && <ActivitySheet item={activity.item} date={activity.date} t_={t_} can={can} onClose={() => setActivity(null)} />}
    {linking !== false && <LinkSheet date={linking} t_={t_} onClose={() => setLinking(false)} />}
  </>
}

function PlanBits({ it, time, members }: { it: TripItem; time: string | null; members: ReturnType<typeof useApp>['members'] }) {
  const by = it.kind === 'activity' && it.suggestedBy ? members.find(m => m.id === it.suggestedBy) : null
  const stars = it.kind === 'activity' ? it.marks.filter(m => m.kind === 'really').length : 0
  const eyes = it.kind === 'activity' ? it.marks.length - stars : 0
  return <>
    <span className="trip-plan-time">{time ? formatTime(time) : ''}</span>
    <span aria-hidden="true" className="trip-plan-emoji">{it.kind === 'outing' ? '🎟' : it.kind === 'meal' ? '🍽️' : it.kind === 'event' ? '📅' : '⭐'}</span>
    <span className="trip-plan-main"><strong>{it.kind === 'activity' ? it.title : it.label}</strong>
      <span>{[it.kind === 'outing' ? t('From Outings') : it.kind === 'meal' ? t('From Meals') : it.kind === 'event' ? t('From the calendar') : by ? t('{name}’s idea', { name: by.name }) : t('Trip activity'),
        it.kind !== 'activity' && it.missing ? t('No longer there') : null, it.kind === 'activity' && it.place, stars ? `⭐ ${stars}` : null, eyes ? `👀 ${eyes}` : null].filter(Boolean).join(' · ')}</span></span>
  </>
}

/** A trip activity: grown-ups add and place it on a day; kids suggest one (a grown-up places it).
 * Everyone marks 👀 / ⭐ as themselves. */
function ActivitySheet({ item, date, t_: { trip, save }, can, onClose }: { item: TripActivity | null; date: string | null; t_: TripApi; can: TripCan; onClose: () => void }) {
  const { members } = useApp()
  const dialog = useDialog()
  const acting = useActingAs()
  const id = useId()
  const plan = dayPlan(trip)
  const [title, setTitle] = useState(item?.title ?? '')
  const [day, setDay] = useState(item?.date ?? date ?? '')
  const [time, setTime] = useState(item?.time ?? '')
  const [tz, setTz] = useState<string | null>(item?.tz ?? trip.stops.find(x => x.timezone)?.timezone ?? null)
  const [place, setPlace] = useState(item?.place ?? '')
  const [url, setUrl] = useState(item?.url ?? '')
  const [notes, setNotes] = useState(item?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const editable = !item || can.edit
  const submit = async () => {
    if (!title.trim()) { setError(t('Say what it is.')); return }
    const body = { kind: 'activity' as const, title: title.trim(), place: place.trim() || null, url: url.trim() || null, notes: notes.trim() || null, ...(can.edit ? { date: day || null, time: day && time ? time : null, tz: day && time ? tz : null } : { date: null, time: null, tz: null }) }
    setBusy(true); setError('')
    const ok = await save(rev => item ? api.updateTripPart(trip.id, 'items', item.id, rev, body) : api.addTripPart(trip.id, 'items', rev, body), can.edit ? t('Saved: {name}', { name: body.title }) : t('Suggested: {name}', { name: body.title }))
    setBusy(false)
    if (ok) onClose()
  }
  const mine = item && acting.who ? item.marks.find(m => m.memberId === acting.who)?.kind ?? null : null
  const mark = (kind: MarkKind) => {
    if (!item || !acting.who) return
    void save(() => api.markTripItem(trip.id, item.id, acting.who!, mine === kind ? null : kind), null)
    acting.done()
  }
  const remove = async () => {
    if (!item || !await dialog.confirm({ title: t('Delete “{name}”?', { name: item.title }), confirmLabel: t('Delete'), danger: true })) return
    setBusy(true)
    const ok = await save(rev => api.deleteTripPart(trip.id, 'items', item.id, rev), t('Deleted: {name}', { name: item.title }))
    setBusy(false)
    if (ok) onClose()
  }
  return <Sheet title={item ? item.title : can.edit ? t('Add something to do') : t('Suggest something to do')} onClose={() => { if (!busy) onClose() }} dismissable={!busy} dirty={editable ? 'auto' : false} actions={editable ? <>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" type="submit" form={id} disabled={busy}>{busy ? t('Saving…') : item ? t('Save') : can.edit ? t('Add') : t('Suggest it')}</button>
  </> : undefined}>
    {item && <section className="outing-interest" aria-label={t('Who wants to do it')}>
      {acting.picker('mark')}
      <div className="outing-interest-btns">
        <button type="button" className="btn btn-secondary outing-level" aria-pressed={mine === 'interested'} disabled={!acting.who || busy} onClick={() => mark('interested')}><span aria-hidden="true">👀</span> {t('Interested')}</button>
        <button type="button" className="btn btn-secondary outing-level" aria-pressed={mine === 'really'} disabled={!acting.who || busy} onClick={() => mark('really')}><span aria-hidden="true">⭐</span> {t('Really want to')}</button>
      </div>
      {item.marks.length > 0 && <ul className="outing-marked">{item.marks.map(m => { const p = members.find(x => x.id === m.memberId); return p && <li key={m.memberId}><Face m={p} /> {m.kind === 'really' ? t('{name} ⭐ really wants to', { name: p.name }) : t('{name} 👀 is interested', { name: p.name })}</li> })}</ul>}
    </section>}
    {editable ? <form id={id} onSubmit={e => { e.preventDefault(); void submit() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="field"><label htmlFor={`${id}-t`}>{t('What')}</label><input id={`${id}-t`} type="text" required maxLength={200} placeholder={t('Tide pools, mini golf…')} value={title} onChange={e => setTitle(e.target.value)} /></div>
        {can.edit && <div className="meal-form-row">
          <Choose label={t('Day')} value={day} onChange={setDay} options={[{ value: '', label: t('Not on a day yet') }, ...plan.days.map(x => ({ value: x.date, label: longDay(x.date) })),
            ...(day && !plan.days.some(x => x.date === day) ? [{ value: day, label: longDay(day) }] : [])]} />
          {day && <div className="field"><label htmlFor={`${id}-tm`}>{t('Time (optional)')}</label><input id={`${id}-tm`} type="time" value={time} onChange={e => setTime(e.target.value)} /></div>}
        </div>}
        {can.edit && day && time && <Labeled label={t('Time zone there')}>{fid => <ZoneField id={fid} label={t('Time zone there')} value={tz} onChange={setTz} />}</Labeled>}
        {!can.edit && <p className="field-hint">{t('A grown-up puts it on a day.')}</p>}
        <div className="field"><label htmlFor={`${id}-p`}>{t('Where (optional)')}</label><input id={`${id}-p`} type="text" maxLength={200} value={place} onChange={e => setPlace(e.target.value)} /></div>
        <div className="field"><label htmlFor={`${id}-u`}>{t('Link (optional)')}</label><input id={`${id}-u`} type="url" maxLength={2000} value={url} onChange={e => setUrl(e.target.value)} /></div>
        <div className="field"><label htmlFor={`${id}-n`}>{t('Notes (optional)')}</label><textarea id={`${id}-n`} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></div>
        {item && can.edit && <div className="sheet-danger-zone"><button type="button" className="link-btn link-danger" onClick={() => void remove()}>{t('Delete…')}</button></div>}
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form> : <>
      {item && <ul className="outing-facts">
        {item.date && <li><span aria-hidden="true">📅</span><span>{[longDay(item.date), item.time && formatTime(item.time)].filter(Boolean).join(' · ')}</span></li>}
        {item.place && <li><span aria-hidden="true">📍</span><span>{item.place}</span></li>}
        {item.notes && <li><span aria-hidden="true">📝</span><span>{item.notes}</span></li>}
        {item.url && <li><span aria-hidden="true">🔗</span><a href={item.url} target="_blank" rel="noopener noreferrer">{t('More info')}</a></li>}
      </ul>}
    </>}
  </Sheet>
}

/** Link an outing, a meal or a calendar event to a day of the trip. The record stays where it is;
 * the trip shows it, and never copies it or changes its date. */
function LinkSheet({ date, t_: { trip, save }, onClose }: { date: string | null; t_: TripApi; onClose: () => void }) {
  const { settings } = useApp()
  const kinds = [settings.features.outings !== false && 'outing', settings.features.meals && 'meal', 'event'].filter(Boolean) as ('outing' | 'meal' | 'event')[]
  const [kind, setKind] = useState(kinds[0])
  const [choices, setChoices] = useState<{ value: string; label: string; detail?: string; date: string | null; time: string | null }[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const from = trip.startDate ?? date
  const to = trip.endDate ?? trip.startDate ?? date
  useEffect(() => {
    let canceled = false
    setChoices(null); setPicked([])
    const linked = new Set(trip.items.filter(i => i.kind === kind).map(i => (i as { refId: string }).refId))
    const load: Promise<{ value: string; label: string; detail?: string; date: string | null; time: string | null }[]> =
      kind === 'outing' ? api.getOutings().then((xs: Outing[]) => xs.filter(o => !o.archived).map(o => ({ value: o.id, label: o.title, detail: o.placeName ?? undefined, date: o.startsOn, time: o.startTime })))
      : !from || !to ? Promise.resolve([])
      : kind === 'meal' ? api.getMeals(from, to).then((xs: Meal[]) => xs.map(m => ({ value: m.id, label: m.title, detail: longDay(m.date), date: m.date, time: m.plannedTime })))
      : api.getEvents(`${from}T00:00:00Z`, `${to}T23:59:59Z`).then((xs: EventInstance[]) => xs.map(e => ({ value: e.id, label: e.title, detail: longDay(e.start.slice(0, 10)), date: e.start.slice(0, 10), time: null })))
    load.then(x => { if (!canceled) setChoices(x.filter(c => !linked.has(c.value))) }).catch(e => { if (!canceled) { setChoices([]); setError(errText(e, t('Could not load.'))) } })
    return () => { canceled = true }
  }, [kind, from, to, trip.items])
  const add = async () => {
    const c = choices?.find(x => x.value === picked[0])
    if (!c) return
    setBusy(true)
    const inTrip = c.date && from && to && c.date >= from && c.date <= to
    const ok = await save(rev => api.addTripPart(trip.id, 'items', rev, { kind, refId: c.value, label: c.label, date: inTrip ? c.date : date, time: c.time } as never), t('Linked: {name}', { name: c.label }))
    setBusy(false)
    if (ok) onClose()
  }
  const kindLabel = (k: typeof kind) => k === 'outing' ? t('An outing') : k === 'meal' ? t('A meal') : t('A calendar event')
  return <Sheet title={t('Link to the trip')} onClose={onClose} actions={<>
    <button className="btn btn-secondary" onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" disabled={busy || !picked.length} onClick={() => void add()}>{t('Link it')}</button>
  </>}>
    <Choose label={t('What to link')} value={kind} onChange={setKind} options={kinds.map(k => ({ value: k, label: kindLabel(k) }))} />
    {kind !== 'outing' && (!from || !to) ? <p className="field-hint">{t('Add the trip’s dates first: meals and events are picked from those days.')}</p>
      : !choices ? <p role="status">{t('Loading…')}</p>
      : <Labeled label={kindLabel(kind)}>{fid => <PickField id={fid} label={kindLabel(kind)} value={picked} onChange={setPicked} options={choices} none={t('Pick one')} />}</Labeled>}
    {kind === 'meal' && <p className="field-hint">{t('Plan the meal in Meals first, on a day of the trip. It stays an ordinary meal in Meals.')}</p>}
    <p className="field-hint">{t('It stays in its own place. The trip shows it, and never copies it or changes its date.')}</p>
    {error && <p className="field-error" role="alert">{error}</p>}
  </Sheet>
}
