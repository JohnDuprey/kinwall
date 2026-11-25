// Away days (docs/using/away.md; server: routes/away.ts, away.ts): whole days on the home calendar
// when someone isn't home, with or without a trip. Their own chores pause (unless kept due or handed
// to someone at home for those days, coming back afterward), and streaks, schoolwork and bus
// reminders wait. Lives at #/away, reachable from Chores, Settings → Family and a trip, and keeps
// working with Trips turned off. Grown-ups set it up; everyone sees who's away.
import { useEffect, useId, useLayoutEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { LoadError } from './a11y.tsx'
import Sheet from './Sheet.tsx'
import { Face } from './Face'
import { PlusIcon } from './icons.tsx'
import { t, tn } from './i18n.ts'
import { hashQuery, withHashParam } from './hashQuery.ts'
import { tellAppHere } from './native.ts'
import { awayDays, awayUntil, handoffProblems, personSummary } from './away.ts'
import { longDay } from './trips.ts'
import { Choose, errText, useTripWho } from './tripShared.tsx'
import type { AwayChoreLine, AwayInput, AwayPeriod, AwayPerson, AwayReview, Handoff } from './trip-types.ts'
import './meals.css'
import './outings.css'
import './trips.css'

const CHANGED = 'kinwall:away'
const changed = () => { window.dispatchEvent(new Event(CHANGED)); window.dispatchEvent(new Event('kinwall:trips')) }

/** Every away period (past ones explain history), fresh on a change or the app's refresh. */
export function useAway() {
  const { refreshTick } = useApp()
  const [periods, setPeriods] = useState<AwayPeriod[] | null>(null)
  const [error, setError] = useState('')
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(n => n + 1)
    window.addEventListener(CHANGED, bump)
    return () => window.removeEventListener(CHANGED, bump)
  }, [])
  useEffect(() => {
    let canceled = false
    api.getAway().then(x => { if (!canceled) { setPeriods(x); setError('') } }).catch(e => { if (!canceled) setError(errText(e, t('Could not load away days.'))) })
    return () => { canceled = true }
  }, [refreshTick, tick])
  return { periods: periods ?? [], loaded: !!periods, error, retry: () => setTick(n => n + 1) }
}

const readLink = () => {
  if (!location.hash.startsWith('#/away')) return { period: null, trip: null }
  const q = hashQuery(location.hash)
  return { period: q.get('period'), trip: q.get('trip') }
}
function dropLink() {
  const l = readLink()
  if (!l.period && !l.trip) return
  history.replaceState(history.state, '', withHashParam(withHashParam(location.hash, 'period', null), 'trip', null))
  tellAppHere()
}

export default function Away() {
  const who = useTripWho()
  const { members, settings } = useApp()
  const { periods, loaded, error, retry } = useAway()
  const [link] = useState(readLink)
  const [editing, setEditing] = useState<AwayPeriod | 'new' | null>(null)
  const [fromTrip, setFromTrip] = useState<AwayInput | null>(null)
  const [backTo, setBackTo] = useState<{ id: string; title: string } | null>(null) // opened from a trip: a way back to it
  useLayoutEffect(dropLink, [])
  // A link (from a trip, the bell, Chores) opens that period, or a new one filled in from a trip.
  useEffect(() => {
    if (!who.parent) return
    if (link.period && loaded) {
      const p = periods.find(x => x.id === link.period)
      if (p) setEditing(p)
      if (p?.tripId && p.tripTitle) setBackTo({ id: p.tripId, title: p.tripTitle })
    }
  }, [link.period, loaded, periods, who.parent])
  useEffect(() => {
    if (!link.trip || !who.parent || !settings.features.trips) return
    let canceled = false
    api.getTrip(link.trip).then(trip => {
      if (canceled) return
      setBackTo({ id: trip.id, title: trip.title })
      if (!trip.startDate) { setFromTrip(null); return }
      setFromTrip({ label: trip.audience !== 'everyone' ? t('Away') : trip.title, tripId: trip.id, handoffs: [], keepDue: [], people: trip.memberIds.map(memberId => ({ memberId, startDate: trip.startDate!, endDate: trip.endDate ?? trip.startDate!, leaveDayAway: true, returnDayAway: true })) })
      setEditing('new')
    }).catch(() => { /* the trip is gone: start empty */ })
    return () => { canceled = true }
  }, [link.trip, who.parent, settings.features.trips])
  const current = periods.filter(p => p.people.some(x => x.endDate >= who.today))
  const past = periods.filter(p => !current.includes(p))
  const mine = who.kidId ? awayUntil(periods, who.kidId, who.today) : null
  const kept = !!who.kidId && periods.some(p => p.keepDue.some(k => k.memberId === who.kidId) && p.people.some(x => x.memberId === who.kidId && x.startDate <= who.today && who.today <= x.endDate))
  const row = (p: AwayPeriod) => {
    const body = <>
      <span className="outing-emoji" aria-hidden="true">{p.tripId ? '🧳' : '✈️'}</span>
      <span className="outing-row-main">
        <strong>{p.label}</strong>
        {p.people.map(x => <span key={x.memberId} className="outing-row-meta trip-away-person"><Face m={members.find(m => m.id === x.memberId) ?? { name: '?', color: 'var(--bg-alt)' }} /> {members.find(m => m.id === x.memberId)?.name}: {personSummary(x)}</span>)}
        <span className="outing-tags">
          {p.handoffs.length > 0 && <span className="chip chip-static">{tn(p.handoffs.length, '↪︎ {n} handoff', '↪︎ {n} handoffs')}</span>}
          {p.keepDue.length > 0 && <span className="chip chip-static">{tn(p.keepDue.length, '▶ {n} kept due', '▶ {n} kept due')}</span>}
          {p.tripTitle && <span className="chip chip-static">{t('From trip: {title}', { title: p.tripTitle })}</span>}
        </span>
      </span>
    </>
    return who.parent ? <button key={p.id} type="button" className="outing-row" aria-haspopup="dialog" onClick={() => setEditing(p)}>{body}</button> : <div key={p.id} className="outing-row">{body}</div>
  }
  return <div className="meals-view outings-view trips-view scroll-y">
    {backTo && <a className="link-btn trip-back" href={`#/trips?${new URLSearchParams({ trip: backTo.id })}`}>‹ {backTo.title}</a>}
    <div className="meals-heading"><div><h1>{t('Away days')}</h1><p className="field-hint">{t('Pauses someone’s chores, streaks, schoolwork and bus reminders on the days they’re away. Medicines and bedtimes keep going.')}</p></div>
      {who.parent && <div className="meal-actions"><button className="btn btn-primary" onClick={() => { setFromTrip(null); setEditing('new') }}><PlusIcon /> {t('Add away days')}</button></div>}
    </div>
    {mine && <p className="state-card trip-enjoy">{kept ? t('✈️ Enjoy your trip! Your usual chores wait until you’re back, except the ones a grown-up kept due.') : t('✈️ Enjoy your trip! Your usual chores wait until you’re back.')}</p>}
    {!who.parent && <p className="field-hint">{t('Away days are set by grown-ups.')}</p>}
    {error && <LoadError what="away" error={error} onRetry={retry} />}
    {!loaded && !error ? <p role="status">{t('Loading away days…')}</p> : <>
      {!current.length && <p className="state-card">{t('Nobody is set to be away. For band camp, a weekend at Grandma’s or a trip, add away days so chores don’t pile up.')}</p>}
      {current.length > 0 && <section className="outing-section" aria-labelledby="away-now"><h2 id="away-now">{t('Now and coming up')}</h2><div className="outing-list">{current.map(row)}</div></section>}
      {past.length > 0 && <details className="settings-disclosure"><summary>{tn(past.length, 'Past ({n})', 'Past ({n})')}</summary><div className="outing-list">{past.map(row)}</div></details>}
    </>}
    {editing && <AwayEditor period={editing === 'new' ? null : editing} start={editing === 'new' ? fromTrip : null} others={periods.filter(p => editing === 'new' || p.id !== editing.id)} onClose={() => { setEditing(null); setFromTrip(null) }} />}
  </div>
}

type Choice = { mode: 'pause' | 'keep' | 'give'; to: string; from: string; until: string }

/** Set up or change away days in three steps: who and when, each away person's chores (Pause, Keep
 * due or Give to someone at home), then a review of everything that changes. Nothing is saved
 * before the review, and the server checks the review is still true when it's saved. */
function AwayEditor({ period, start, others, onClose }: { period: AwayPeriod | null; start: AwayInput | null; others: AwayPeriod[]; onClose: () => void }) {
  const { members, toast } = useApp()
  const who = useTripWho()
  const dialog = useDialog()
  const id = useId()
  const [step, setStep] = useState<'when' | 'chores' | 'review'>('when')
  const [label, setLabel] = useState(period?.label ?? start?.label ?? '')
  const [people, setPeople] = useState<AwayPerson[]>(period?.people ?? start?.people ?? [])
  const [choices, setChoices] = useState<Record<string, Choice>>(() => {
    const c: Record<string, Choice> = {}
    for (const k of period?.keepDue ?? []) c[`${k.memberId}:${k.choreId}`] = { mode: 'keep', to: '', from: '', until: '' }
    for (const h of period?.handoffs ?? []) c[`${h.fromMemberId}:${h.choreId}`] = { mode: 'give', to: h.toMemberId, from: h.startDate, until: h.endDate }
    return c
  })
  const [chores, setChores] = useState<AwayChoreLine[]>([])
  const [review, setReview] = useState<AwayReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const name = (memberId: string) => members.find(m => m.id === memberId)?.name ?? t('Someone')
  const tripId = period?.tripId ?? start?.tripId ?? null
  const handoffs: Handoff[] = Object.entries(choices).filter(([, c]) => c.mode === 'give' && c.to).map(([k, c]) => { const [fromMemberId, choreId] = k.split(':'); return { choreId, fromMemberId, toMemberId: c.to, startDate: c.from, endDate: c.until } })
  const keepDue = Object.entries(choices).filter(([, c]) => c.mode === 'keep').map(([k]) => { const [memberId, choreId] = k.split(':'); return { memberId, choreId } })
  const draft: AwayInput = { label: label.trim(), tripId, people, handoffs: handoffs.filter(h => people.some(p => p.memberId === h.fromMemberId)), keepDue: keepDue.filter(k => people.some(p => p.memberId === k.memberId)) }
  const problems = handoffProblems(draft, others, Object.fromEntries(members.map(m => [m.id, m.name])))
  const setPerson = (i: number, patch: Partial<AwayPerson>) => setPeople(ps => ps.map((p, j) => j === i ? { ...p, ...patch, ...(patch.startDate && p.endDate < patch.startDate ? { endDate: patch.startDate } : {}) } : p))
  const addPerson = (memberId: string) => setPeople(ps => [...ps, { memberId, startDate: ps[0]?.startDate ?? who.today, endDate: ps[0]?.endDate ?? who.today, leaveDayAway: true, returnDayAway: true }])
  const preview = async (body: AwayInput) => {
    setBusy(true); setError('')
    try { return await api.previewAway(period ? { ...body, id: period.id, revision: period.revision } : body) } catch (e) { setError(errText(e, t('Could not check these away days.'))); return null } finally { setBusy(false) }
  }
  const toChores = async () => {
    if (!draft.label) { setError(t('Give these away days a name, like “Band camp”.')); return }
    if (!people.length) { setError(t('Pick who’s away.')); return }
    if (people.some(p => p.endDate < p.startDate)) { setError(t('A back day is before the leave day.')); return }
    // Everything paused first, so the review lists every chore these people have on those days.
    const r = await preview({ ...draft, handoffs: [], keepDue: [] })
    if (!r) return
    const seen = new Set<string>()
    setChores([...r.paused, ...r.handoffs, ...r.keepDue].filter(c => { const k = `${c.memberId}:${c.choreId}`; if (seen.has(k)) return false; seen.add(k); return true }))
    setStep('chores')
  }
  const toReview = async () => {
    if (problems.length) return
    const r = await preview(draft)
    if (r) { setReview(r); setStep('review') }
  }
  const saveIt = async () => {
    if (!review) return
    setBusy(true); setError('')
    try {
      if (period) await api.updateAway(period.id, { ...draft, token: review.token, revision: period.revision }); else await api.createAway({ ...draft, token: review.token })
      changed()
      const awayNames = new Intl.ListFormat(undefined, { type: 'conjunction' }).format(people.filter(p => awayDays(p)).map(p => name(p.memberId)))
      toast(awayNames ? t('Saved: {names} away for {label}', { names: awayNames, label: draft.label }) : t('Saved: {label}', { label: draft.label }))
      onClose()
    } catch (e) {
      setError(errText(e, t('Could not save.')))
      if ((e as { status?: number }).status === 409) { setStep('chores'); setReview(null) }
    } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!period || !await dialog.confirm({ title: t('Delete “{name}”?', { name: period.label }), body: t('Days already past stay excused, so streaks and history don’t change. Days ahead go back to normal.'), confirmLabel: t('Delete away days'), danger: true })) return
    setBusy(true)
    try { await api.deleteAway(period.id, period.revision); changed(); toast(t('Deleted: {name}', { name: period.label })); onClose() } catch (e) { setError(errText(e, t('Could not delete.'))) } finally { setBusy(false) }
  }
  // Someone home on every day of the handoff: not away then in this draft or in another saved period.
  const home = (p: AwayPerson, from: string, until: string) => members.filter(m => m.id !== p.memberId && ![draft, ...others].some(period =>
    period.people.some(x => { const r = x.memberId === m.id ? awayDays(x) : null; return !!r && r.from <= until && r.to >= from })))
  const actions = step === 'when' ? <>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" disabled={busy} onClick={() => void toChores()}>{busy ? t('Checking…') : t('Next: chores')}</button>
  </> : step === 'chores' ? <>
    <button className="btn btn-secondary" disabled={busy} onClick={() => setStep('when')}>{t('Back')}</button>
    <button className="btn btn-primary" disabled={busy || problems.length > 0} onClick={() => void toReview()}>{busy ? t('Checking…') : t('Next: review')}</button>
  </> : <>
    <button className="btn btn-secondary" disabled={busy} onClick={() => setStep('chores')}>{t('Back')}</button>
    <button className="btn btn-primary" disabled={busy || !!review?.conflicts.some(c => c.blocking)} onClick={() => void saveIt()}>{busy ? t('Saving…') : t('Save away days')}</button>
  </>
  const line = (c: AwayChoreLine, extra?: string) => <li key={`${c.memberId}:${c.choreId}`}><span aria-hidden="true">{c.emoji || '✅'} </span><strong>{c.title}</strong> · {name(c.memberId)}{c.dates.length ? ` · ${tn(c.dates.length, '{n} day', '{n} days')}` : ''}{extra ? ` · ${extra}` : ''}</li>
  return <Sheet title={period ? t('Edit {name}', { name: period.label }) : t('Add away days')} onClose={() => { if (!busy) onClose() }} dismissable={!busy} dirty="auto" actions={actions}>
    <ol className="trip-steps" aria-label={t('Steps')}>
      {(['when', 'chores', 'review'] as const).map((s, i) => <li key={s} aria-current={step === s ? 'step' : undefined}>{i + 1}. {s === 'when' ? t('Who and when') : s === 'chores' ? t('Chores') : t('Review')}</li>)}
    </ol>
    {step === 'when' && <fieldset className="meal-fieldset" disabled={busy}>
      <div className="field"><label htmlFor={`${id}-label`}>{t('Name')}</label><input id={`${id}-label`} type="text" maxLength={120} placeholder={t('Band camp, weekend at Grandma’s…')} value={label} onChange={e => setLabel(e.target.value)} /></div>
      {tripId && <p className="field-hint">{t('Filled in from the trip. Each person can have their own dates.')}</p>}
      <p className="field-hint">{t('Whole days on the family’s home calendar. Choose whether the day someone leaves and the day they’re back count as away.')}</p>
      {people.map((p, i) => <fieldset key={p.memberId} className="trip-away-edit">
        <legend><Face m={members.find(m => m.id === p.memberId) ?? { name: '?', color: 'var(--bg-alt)' }} /> {name(p.memberId)}</legend>
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-${i}-s`}>{t('Leaves')}</label><input id={`${id}-${i}-s`} type="date" value={p.startDate} onChange={e => e.target.value && setPerson(i, { startDate: e.target.value })} /></div>
          <div className="field"><label htmlFor={`${id}-${i}-e`}>{t('Back')}</label><input id={`${id}-${i}-e`} type="date" min={p.startDate} value={p.endDate} onChange={e => e.target.value && setPerson(i, { endDate: e.target.value })} /></div>
        </div>
        <label className="meal-check"><input type="checkbox" checked={p.leaveDayAway} onChange={e => setPerson(i, { leaveDayAway: e.target.checked })} /> {t('Away on the day they leave')}</label>
        <label className="meal-check"><input type="checkbox" checked={p.returnDayAway} onChange={e => setPerson(i, { returnDayAway: e.target.checked })} /> {t('Away on the day they’re back')}</label>
        <p className={awayDays(p) ? 'field-hint' : 'field-hint trip-warn'}>{awayDays(p) ? t('Away {from} to {to}', { from: longDay(awayDays(p)!.from), to: longDay(awayDays(p)!.to) }) : t('No away days: both boundary days are unticked.')}</p>
        <button type="button" className="link-btn" onClick={() => setPeople(ps => ps.filter((_, j) => j !== i))}>{t('Remove {name}', { name: name(p.memberId) })}</button>
      </fieldset>)}
      {members.some(m => !people.some(p => p.memberId === m.id)) && <Choose label={t('Add someone who’s away')} value="" none={t('Pick a person')} onChange={addPerson}
        options={members.filter(m => !people.some(p => p.memberId === m.id)).map(m => ({ value: m.id, label: m.name }))} />}
      {people.some(p => p.endDate < who.today) && <p className="field-hint">{t('Some of these days have passed. The review shows what that changes before anything is saved.')}</p>}
    </fieldset>}
    {step === 'chores' && <div>
      <p>{t('Each away person’s own chores pause unless you choose otherwise. A handed-over chore goes back to its owner afterward.')}</p>
      {!chores.length && <p className="state-card">{t('No personal chores on those days. Anyone chores carry on with whoever is home.')}</p>}
      {people.filter(p => chores.some(c => c.memberId === p.memberId)).map(p => <section key={p.memberId} className="trip-away-chores" aria-labelledby={`${id}-c-${p.memberId}`}>
        <h3 id={`${id}-c-${p.memberId}`}><Face m={members.find(m => m.id === p.memberId) ?? { name: '?', color: 'var(--bg-alt)' }} /> {t('{name}’s chores', { name: name(p.memberId) })}</h3>
        {chores.filter(c => c.memberId === p.memberId).map(c => {
          const k = `${c.memberId}:${c.choreId}`
          const r = awayDays(p)
          const ch = choices[k] ?? { mode: 'pause', to: '', from: r?.from ?? p.startDate, until: r?.to ?? p.endDate }
          const set = (patch: Partial<Choice>) => setChoices(x => ({ ...x, [k]: { ...ch, ...patch } }))
          const value = ch.mode === 'give' ? `give:${ch.to}` : ch.mode
          const atHome = home(p, ch.from || r?.from || p.startDate, ch.until || r?.to || p.endDate)
          return <div key={k} className="trip-away-chore">
            <Choose label={`${c.emoji || '✅'} ${c.title}`} value={value} onChange={v => {
              if (v === 'pause' || v === 'keep') set({ mode: v })
              else set({ mode: 'give', to: v.slice(5), from: ch.from || r?.from || p.startDate, until: ch.until || r?.to || p.endDate })
            }} options={[{ value: 'pause', label: t('Pause while away') }, { value: 'keep', label: t('Keep due (they can do it away)') },
              ...(c.schoolwork ? [] : atHome.map(m => ({ value: `give:${m.id}`, label: t('Give to {name} while away', { name: m.name }) })))]} />
            {ch.mode === 'give' && <div className="meal-form-row">
              <div className="field"><label htmlFor={`${id}-${k}-f`}>{t('From')}</label><input id={`${id}-${k}-f`} type="date" min={r?.from} max={r?.to} value={ch.from} onChange={e => set({ from: e.target.value })} /></div>
              <div className="field"><label htmlFor={`${id}-${k}-u`}>{t('Until')}</label><input id={`${id}-${k}-u`} type="date" min={ch.from || r?.from} max={r?.to} value={ch.until} onChange={e => set({ until: e.target.value })} /></div>
            </div>}
            <p className="field-hint">{ch.mode === 'pause' ? t('Not due on away days. It won’t show up late afterward.') : ch.mode === 'keep' ? t('Still due, and counts for their streak as usual.') : t('{to} does it and gets the points. Back to {from} afterward.', { to: name(ch.to), from: name(c.memberId) })}</p>
          </div>
        })}
      </section>)}
      {problems.length > 0 && <ul className="field-error trip-problems" role="alert">{problems.map(p => <li key={p}>{p}</li>)}</ul>}
    </div>}
    {step === 'review' && review && <div className="trip-review">
      <p>{t('Here’s what changes. Nothing is saved until you tap Save.')}</p>
      {review.paused.length > 0 && <section className="trip-review-sec"><h3>{t('⏸ Paused while away')}</h3><ul>{review.paused.map(c => line(c))}</ul></section>}
      {review.handoffs.length > 0 && <section className="trip-review-sec"><h3>{t('↪︎ Handed over, then back')}</h3><ul>{review.handoffs.map(c => line(c, c.toMemberId ? t('to {name}', { name: name(c.toMemberId) }) : undefined))}</ul></section>}
      {review.keepDue.length > 0 && <section className="trip-review-sec"><h3>{t('▶ Kept due')}</h3><ul>{review.keepDue.map(c => line(c))}</ul></section>}
      {review.conflicts.length > 0 && <section className="trip-review-sec"><h3>{t('⚠️ Check these')}</h3><ul>{review.conflicts.map((c, i) => <li key={i} className={c.blocking ? 'trip-blocking' : undefined}>{c.blocking && <strong>{t('Needs fixing: ')}</strong>}{c.text}</li>)}</ul>
        {review.conflicts.some(c => c.blocking) && <p className="field-hint">{t('Go back and change these before saving.')}</p>}</section>}
      <section className="trip-review-sec"><h3>{t('Points and streaks')}</h3><ul>
        <li>{t('An away day doesn’t break or grow a streak and doesn’t use a grace day.')}</li>
        <li>{t('A weekly goal that overlaps away days can’t fail that week, but earns no free points.')}</li>
        <li>{t('Work already done or waiting for an OK keeps its points.')}</li>
      </ul></section>
      {review.continues.length > 0 && <section className="trip-review-sec"><h3>{t('▶ Keeps going')}</h3><ul>{review.continues.map((c, i) => <li key={i}>{c.text}</li>)}</ul></section>}
    </div>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {period && step === 'when' && <div className="sheet-danger-zone"><button type="button" className="link-btn link-danger" disabled={busy} onClick={() => void remove()}>{t('Delete away days…')}</button></div>}
  </Sheet>
}
