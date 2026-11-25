// A trip's places to stay (docs/using/trips.md, Places to stay): one decision per stay (a stop's
// nights), each with places to compare side by side, an optional family vote (a poll), a grown-up's
// final choice and, separately, Booked or Confirmed with family. Prices show as listed and are never
// added up. A family home needs only a name. Booking details come from the server only to devices
// this trip allows.
import { useId, useState } from 'react'
import { Segmented } from './a11y.tsx'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { Face } from './Face'
import { ExternalIcon, PlusIcon } from './icons.tsx'
import { t, tn } from './i18n.ts'
import { changedFields, costLabel, longDay, nights, pollOptionFor, sortableByPrice, STAY_EMOJI, stayOfVote, tally, tripWhen } from './trips.ts'
import { Choose, errText, StayPhoto, useActingAs, useTripWho } from './tripShared.tsx'
import type { TripApi } from './Trips.tsx'
import type { LinkPreview, PriceBasis, StayBooking, StayCost, StayDetails, StayGroup, StayKind, StayOption, StayOptionInput, TripCan } from './trip-types.ts'

/** Stays in their own order, then by when you arrive (no date last). */
export const byStayOrder = (a: StayGroup, b: StayGroup) => a.sort - b.sort || (a.checkIn ?? '9999').localeCompare(b.checkIn ?? '9999')
const KINDS: StayKind[] = ['rental', 'hotel', 'family', 'camping', 'other']
const kindLabel = (k: StayKind) => k === 'rental' ? t('Rental home') : k === 'hotel' ? t('Hotel') : k === 'family' ? t('Staying with family') : k === 'camping' ? t('Camping') : t('Other')

export function StaysPage({ t_, can }: { t_: TripApi; can: TripCan }) {
  const { trip } = t_
  const [group, setGroup] = useState<StayGroup | 'new' | null>(null)
  return <>
    <div className="meals-heading"><div><h1>{t('Places to stay')}</h1><p className="field-hint">{trip.stayGroups.length > 1 ? tn(trip.stayGroups.length, '{n} stop', '{n} stops') + ' · ' : ''}{t('Compare, vote, then a grown-up chooses. Booked is its own step.')}</p></div>
      {can.addStays && <div className="meal-actions"><button className="btn btn-primary" onClick={() => setGroup('new')}><PlusIcon /> {t('Add a stay')}</button></div>}
    </div>
    {!can.addStays && <p className="field-hint">{t('Only grown-ups add places to stay. You can vote when a vote is open.')}</p>}
    {!trip.stayGroups.length && <div className="state-card"><p>{t('No stays yet. A stay is where you sleep for some nights: a stop on the way, or the whole trip.')}</p>
      {can.addStays && <button className="btn btn-primary trip-fit" onClick={() => setGroup('new')}><PlusIcon /> {t('Add a stay')}</button>}</div>}
    {[...trip.stayGroups].sort(byStayOrder).map(g => <StayGroupSection key={g.id} g={g} t_={t_} can={can} single={trip.stayGroups.length === 1} onEdit={() => setGroup(g)} />)}
    {group && <StayGroupSheet group={group === 'new' ? null : group} t_={t_} onClose={() => setGroup(null)} />}
  </>
}

function StayGroupSection({ g, t_, can, single, onEdit }: { g: StayGroup; t_: TripApi; can: TripCan; single: boolean; onEdit: () => void }) {
  const { trip, save, busy } = t_
  const { members, settings } = useApp()
  const dialog = useDialog()
  const [adding, setAdding] = useState<StayOption | 'new' | null>(null)
  const [byPrice, setByPrice] = useState(false)
  const n = tally(g)
  const open = g.poll?.status === 'open'
  const acting = useActingAs(g.poll?.voterIds ?? [])
  const myVoteRaw = acting.who ? g.poll?.votes.find(v => v.memberId === acting.who)?.optionId ?? null : null
  const myVote = g.poll && myVoteRaw ? stayOfVote(g.poll, myVoteRaw) : null
  const pollsOn = settings.features.polls !== false
  const sortable = sortableByPrice(g.options)
  const options = byPrice && sortable ? [...g.options].sort((a, b) => a.price!.amountMinor - b.price!.amountMinor) : g.options
  const nightCount = nights(g.checkIn, g.checkOut)
  const name = (id: string | null) => members.find(m => m.id === id)?.name ?? t('Someone')
  const vote = async (optionId: string) => {
    if (!g.poll || !acting.who) return
    const voter = acting.who
    const next = myVote === optionId ? null : optionId
    await save(async () => { await api.votePoll(g.poll!.id, voter, next ? pollOptionFor(g.poll!, next) : null); return api.getTrip(trip.id) }, next ? t('{name} voted', { name: name(voter) }) : t('Cleared {name}’s vote', { name: name(voter) }))
    acting.done()
  }
  const choose = async (o: StayOption | null) => {
    if (o && n && n.voted && !n.leaders.includes(o.id) && !await dialog.confirm({ title: t('Choose {name}?', { name: o.name }), body: t('It isn’t in the lead. That’s fine: votes help, a grown-up decides.'), confirmLabel: t('Choose it') })) return
    void save(rev => api.chooseStay(trip.id, g.id, rev, o?.id ?? null), o ? t('Chosen: {name}', { name: o.name }) : t('Choice cleared'))
  }
  const endVote = () => { if (g.poll) void save(async () => { await api.endStayVote(g.poll!.id); return api.getTrip(trip.id) }, t('Voting ended. A grown-up chooses next.')) }
  const restartVote = async () => {
    if (await dialog.confirm({ title: t('Start a new vote?'), body: t('Everyone votes again. The last round’s votes are kept with it.'), confirmLabel: t('Start a new vote') })) void save(rev => api.startStayVote(trip.id, g.id, rev, true), t('New vote started'))
  }
  const lead = n && n.leaders.length === 1 ? g.options.find(o => o.id === n.leaders[0]) : null
  const headId = `stay-${g.id}`
  return <section className="trip-stay-group" aria-labelledby={headId}>
    <div className="trip-stay-head">
      <h2 id={headId}><span aria-hidden="true">🏠 </span>{single && !g.label ? t('Where we’re staying') : g.label}
        <small>{[g.checkIn && tripWhen({ startDate: g.checkIn, endDate: g.checkOut, dateNote: null }), nightCount !== null && tn(nightCount, '{n} night', '{n} nights')].filter(Boolean).join(' · ')}</small></h2>
      <div className="trip-stay-actions">
        {can.edit && pollsOn && !g.poll && g.options.length >= 2 && <button className="btn btn-secondary trip-fit" disabled={busy} onClick={() => void save(rev => api.startStayVote(trip.id, g.id, rev), t('Vote started. Everyone going can vote.'))}>{t('🗳 Ask the family')}</button>}
        {can.addStays && <button className="btn btn-secondary trip-fit" disabled={busy || open} onClick={() => setAdding('new')}><PlusIcon /> {t('Add a place')}</button>}
        {can.edit && open && <button className="btn btn-secondary trip-fit" disabled={busy} onClick={endVote}>{t('End voting')}</button>}
        {can.edit && g.poll && !open && pollsOn && g.options.length >= 2 && <button className="btn btn-secondary trip-fit" disabled={busy} onClick={() => void restartVote()}>{t('Start a new vote')}</button>}
        {can.edit && <button className="btn btn-secondary trip-fit" aria-haspopup="dialog" aria-label={t('Edit {name}', { name: g.label })} disabled={busy} onClick={onEdit}>{t('Edit')}</button>}
      </div>
    </div>
    {open && can.addStays && <p className="field-hint">{t('Voting is open, so the places can’t change. End voting to add or change one, then ask again.')}</p>}
    {g.poll && pollsOn && n && <div className="trip-vote" aria-live="polite">
      <p className="trip-vote-status"><strong>{open ? t('🗳 {voted} of {of} voted', { voted: n.voted, of: n.of }) : t('Voting ended · {voted} of {of} voted', { voted: n.voted, of: n.of })}</strong>
        {lead ? ` · ${t('{name} is in the lead', { name: lead.name })}` : n.tie ? ` · ${t('It’s a tie')}` : n.voted === 0 ? ` · ${t('No votes yet')}` : ''}</p>
      {open && can.vote && acting.picker('vote')}
    </div>}
    {can.choose && !g.chosenOptionId && g.options.length > 0 && <p className="trip-choice-hint">{lead ? t('{name} is in the lead with {n} votes. Choosing is up to a grown-up; votes don’t decide it.', { name: lead.name, n: n!.counts[lead.id] }) : n?.tie ? t('It’s a tie. A grown-up picks one; Kinwall never picks for you.') : t('When you’re ready, a grown-up chooses one.')}</p>}
    {sortable && <div className="field"><label>{t('Sort places')}</label><Segmented label={t('Sort places')} value={byPrice ? 'price' : 'added'} onChange={next => setByPrice(next === 'price')}
      options={[{ key: 'added', label: t('Added order') }, { key: 'price', label: t('Lowest price') }]} /></div>}
    {!sortable && g.options.length > 1 && g.options.some(o => o.cost === 'price') && <p className="field-hint">{t('Sort by price is off: these aren’t priced the same way (a night, the whole stay, a currency). Kinwall compares like with like only.')}</p>}
    {!g.options.length && <p className="state-card">{can.addStays ? t('Paste a link or add one by hand. Families often compare two or three.') : t('Grown-ups will add places to stay here. You’ll be able to vote.')}</p>}
    <div className="trip-stay-cards">{options.map(o => <StayCard key={o.id} o={o} g={g} busy={busy} chosen={g.chosenOptionId === o.id}
      votes={g.poll?.votes.filter(v => stayOfVote(g.poll!, v.optionId) === o.id && g.poll!.voterIds.includes(v.memberId)).map(v => v.memberId) ?? []}
      canVote={open && can.vote && !!acting.who && !!g.poll?.voterIds.includes(acting.who)} mine={myVote === o.id} onVote={() => void vote(o.id)} canChoose={can.choose} onChoose={() => void choose(o)} onUnchoose={() => void choose(null)}
      onEdit={can.edit ? () => setAdding(o) : undefined} />)}</div>
    {adding && <PlaceSheet option={adding === 'new' ? null : adding} group={g} t_={t_} onClose={() => setAdding(null)} />}
  </section>
}

function StayCard({ o, g, busy, chosen, votes, canVote, mine, onVote, canChoose, onChoose, onUnchoose, onEdit }: {
  o: StayOption; g: StayGroup; busy: boolean; chosen: boolean; votes: string[]; canVote: boolean; mine: boolean
  onVote: () => void; canChoose: boolean; onChoose: () => void; onUnchoose: () => void; onEdit?: () => void
}) {
  const { members } = useApp()
  const name = (id: string | null) => members.find(m => m.id === id)?.name ?? t('someone')
  const [showCode, setShowCode] = useState(false)
  const badges = [
    chosen && (g.chosenBy ? t('★ Chosen by {name}', { name: name(g.chosenBy) }) : t('★ Chosen')),
    o.booking === 'booked' && (o.bookedBy ? t('✓ Booked by {name}', { name: name(o.bookedBy) }) : t('✓ Booked')),
    o.booking === 'confirmed_family' && t('🏡 Confirmed with family'),
    o.booking === 'canceled' && t('✕ Canceled'),
  ].filter(Boolean) as string[]
  const d = o.details
  return <article className={`trip-stay-card ${chosen ? 'is-chosen' : ''}`} aria-label={o.name}>
    {o.imageUrl && <StayPhoto optionId={o.id} siteName={o.siteName} />}
    <div className="trip-stay-body">
      <h3><span aria-hidden="true">{STAY_EMOJI[o.kind]} </span>{o.name}</h3>
      <p className="outing-row-meta">{[kindLabel(o.kind), o.town].filter(Boolean).join(' · ')}</p>
      <p className="trip-stay-price">{costLabel(o)}{o.cost === 'price' && o.price && <span className="field-hint"> · {o.price.observedOn ? t('as listed {date}', { date: longDay(o.price.observedOn) }) : t('as listed')}</span>}</p>
      {o.price?.context && <p className="field-hint">{o.price.context}</p>}
      {(o.sleeps || o.notes) && <p className="trip-stay-notes">{[o.sleeps && tn(o.sleeps, 'Sleeps {n}', 'Sleeps {n}'), o.notes].filter(Boolean).join(' · ')}</p>}
      {badges.length > 0 && <p className="outing-tags">{badges.map(b => <span key={b} className="chip chip-static trip-badge">{b}</span>)}</p>}
      {g.poll && <p className="trip-stay-votes">{votes.length ? <><span className="outing-faces" aria-hidden="true">{votes.slice(0, 4).map(id => { const m = members.find(x => x.id === id); return m && <Face key={id} m={m} /> })}</span> {tn(votes.length, '{n} vote', '{n} votes')}</> : t('No votes')}</p>}
      {d && (d.address || d.contact || d.arrival || d.confirmation || d.manageUrl || d.codes) && <div className="trip-details" aria-label={t('Booking details')}>
        {d.address && <p>🔒 <span className="sr-only">{t('Street address')}: </span>{d.address}</p>}
        {d.contact && <p>📞 {d.contact}</p>}
        {d.arrival && <p>🔑 {d.arrival}</p>}
        {d.confirmation && <p>🎫 {t('Confirmation: {code}', { code: d.confirmation })}</p>}
        {d.codes && <p>🔢 {showCode ? d.codes : <button type="button" className="link-btn" onClick={() => setShowCode(true)}>{t('Show codes')}</button>}</p>}
        {d.manageUrl && <p><a href={d.manageUrl} target="_blank" rel="noopener noreferrer">{t('Manage booking')}</a></p>}
      </div>}
      {!d && o.hasDetails && <p className="field-hint">{t('🔒 Booking details are for grown-ups.')}</p>}
      <div className="trip-stay-btns">
        {o.sourceUrl && <a className="btn btn-secondary trip-fit" href={o.sourceUrl} target="_blank" rel="noopener noreferrer"><ExternalIcon width={18} height={18} /> {o.siteName ? t('Open on {site}', { site: o.siteName }) : t('Open listing')}</a>}
        {canVote && <button type="button" className="btn btn-secondary trip-fit outing-level" aria-pressed={mine} disabled={busy} onClick={onVote}>{mine ? t('✓ Your vote') : t('Vote for this')}</button>}
        {canChoose && !chosen && o.booking !== 'canceled' && <button type="button" className="btn btn-secondary trip-fit" disabled={busy} onClick={onChoose}>{t('Choose this one')}</button>}
        {canChoose && chosen && <button type="button" className="btn btn-secondary trip-fit" disabled={busy} onClick={onUnchoose}>{t('Undo choice')}</button>}
        {onEdit && <button type="button" className="btn btn-secondary trip-fit" aria-haspopup="dialog" disabled={busy} onClick={onEdit} aria-label={t('Edit {name}', { name: o.name })}>{t('Edit')}</button>}
      </div>
    </div>
  </article>
}

function StayGroupSheet({ group, t_: { trip, save }, onClose }: { group: StayGroup | null; t_: TripApi; onClose: () => void }) {
  const id = useId()
  const [label, setLabel] = useState(group?.label ?? (trip.stayGroups.length ? '' : trip.location ?? ''))
  const [stopId, setStopId] = useState(group?.stopId ?? '')
  const [checkIn, setCheckIn] = useState(group?.checkIn ?? (trip.stayGroups.length ? '' : trip.startDate ?? ''))
  const [checkOut, setCheckOut] = useState(group?.checkOut ?? (trip.stayGroups.length ? '' : trip.endDate ?? ''))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const dialog = useDialog()
  const remove = async () => {
    if (!group || !await dialog.confirm({ title: t('Delete “{name}”?', { name: group.label }), body: t('Its places to stay go too.'), confirmLabel: t('Delete stay'), danger: true })) return
    setBusy(true)
    const ok = await save(rev => api.deleteTripPart(trip.id, 'stay-groups', group.id, rev), t('Deleted: {name}', { name: group.label }))
    setBusy(false)
    if (ok) onClose()
  }
  const submit = async () => {
    if (!label.trim()) { setError(t('Give it a name, like the town.')); return }
    if (checkIn && checkOut && checkOut < checkIn) { setError(t('Leaving is before arriving.')); return }
    const body = { label: label.trim(), stopId: stopId || null, checkIn: checkIn || null, checkOut: checkOut || null, ...(!group && { sort: Math.max(-1, ...trip.stayGroups.map(g => g.sort)) + 1 }) }
    setBusy(true)
    const ok = await save(rev => group ? api.updateTripPart(trip.id, 'stay-groups', group.id, rev, body) : api.addTripPart(trip.id, 'stay-groups', rev, body), t('Saved: {name}', { name: body.label }))
    setBusy(false)
    if (ok) onClose()
  }
  return <Sheet title={group ? t('Edit {name}', { name: group.label }) : t('Add a stay')} onClose={() => { if (!busy) onClose() }} dismissable={!busy} dirty="auto" actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" type="submit" form={id} disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
  </>}>
    <form id={id} onSubmit={e => { e.preventDefault(); void submit() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="field"><label htmlFor={`${id}-label`}>{t('Name')}</label><input id={`${id}-label`} type="text" required maxLength={120} placeholder={t('Harbor Point, Grandma’s house…')} value={label} onChange={e => setLabel(e.target.value)} /></div>
        {trip.stops.length > 0 && <Choose label={t('Stop')} value={stopId} onChange={setStopId} options={[{ value: '', label: t('None') }, ...trip.stops.map(s => ({ value: s.id, label: s.label }))]} />}
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-in`}>{t('Arrive')}</label><input id={`${id}-in`} type="date" value={checkIn} onChange={e => setCheckIn(e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-out`}>{t('Leave')}</label><input id={`${id}-out`} type="date" min={checkIn || undefined} value={checkOut} onChange={e => setCheckOut(e.target.value)} /></div>
        </div>
        <p className="field-hint">{t('Leave is the morning you go. Dates can wait.')}</p>
        {group?.poll?.status === 'open' && <p className="field-hint">{t('Voting is open: changing the dates may ask for a new vote.')}</p>}
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
    {group && <div className="sheet-danger-zone"><button type="button" className="link-btn link-danger" disabled={busy} onClick={() => void remove()}>{t('Delete stay…')}</button></div>}
  </Sheet>
}

type PlaceDraft = { kind: StayKind; name: string; town: string; sourceUrl: string; siteName: string | null; imageUrl: string | null; fetchedAt: string | null
  cost: StayCost; amount: string; currency: string; basis: PriceBasis | ''; fees: 'included' | 'extra' | 'unknown'; observedOn: string | null; context: string
  sleeps: string; notes: string; booking: StayBooking; details: StayDetails }
const NO_DETAILS: StayDetails = { address: null, contact: null, arrival: null, confirmation: null, manageUrl: null, codes: null }

/** "212.50" → minor units in that currency (yen has none); undefined when it isn't a number. */
function toMinor(amount: string, currency: string): number | undefined {
  const n = Number(amount.replace(/[,\s]/g, '').replace(/^[^\d.]+/, ''))
  if (!amount.trim() || !Number.isFinite(n) || n < 0) return undefined
  let digits = 2
  try { digits = new Intl.NumberFormat('en', { style: 'currency', currency }).resolvedOptions().maximumFractionDigits ?? 2 } catch { return undefined }
  return Math.round(n * 10 ** digits)
}
function fromMinor(p: StayOption['price']): string {
  if (!p) return ''
  let digits = 2
  try { digits = new Intl.NumberFormat('en', { style: 'currency', currency: p.currency }).resolvedOptions().maximumFractionDigits ?? 2 } catch { /* two */ }
  const v = p.amountMinor / 10 ** digits
  return v % 1 ? v.toFixed(digits) : String(v)
}

/** Add or edit a place to stay: from a link (read into an editable preview; nothing is saved until
 * Add, and a link that can't be read still saves) or by hand. A family home needs only a name. */
function PlaceSheet({ option, group, t_: { trip, save }, onClose }: { option: StayOption | null; group: StayGroup; t_: TripApi; onClose: () => void }) {
  const { settings } = useApp()
  const who = useTripWho()
  const dialog = useDialog()
  const id = useId()
  const [d, setD] = useState<PlaceDraft>(() => ({
    kind: option?.kind ?? 'rental', name: option?.name ?? '', town: option?.town ?? '', sourceUrl: option?.sourceUrl ?? '', siteName: option?.siteName ?? null, imageUrl: option?.imageUrl ?? null, fetchedAt: option?.fetchedAt ?? null,
    cost: option?.cost ?? 'unknown', amount: fromMinor(option?.price ?? null), currency: option?.price?.currency ?? settings.currency ?? 'USD', basis: option?.price?.basis ?? 'night', fees: option?.price?.fees ?? 'unknown',
    observedOn: option?.price?.observedOn ?? null, context: option?.price?.context ?? '', sleeps: option?.sleeps ? String(option.sleeps) : '', notes: option?.notes ?? '',
    booking: option?.booking ?? 'none', details: { ...NO_DETAILS, ...option?.details },
  }))
  const [detailsTouched, setDetailsTouched] = useState(false)
  const [reading, setReading] = useState(false)
  const [read, setRead] = useState<LinkPreview | null>(null)
  const [newPicture, setNewPicture] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof PlaceDraft>(k: K, v: PlaceDraft[K]) => setD(x => ({ ...x, [k]: v }))
  const detail = (k: keyof StayDetails, v: string) => { setDetailsTouched(true); setD(x => ({ ...x, details: { ...x.details, [k]: v.trim() ? v : null } })) }
  const family = d.kind === 'family'
  const readLink = async () => {
    if (!/^https:\/\//i.test(d.sourceUrl.trim())) { setError(t('Paste a link that starts with https://')); return }
    setReading(true); setError('')
    try {
      const p = await api.previewStayLink(d.sourceUrl.trim())
      setRead(p)
      // Fills only what's empty, so nothing typed is lost.
      setD(x => ({
        ...x, sourceUrl: p.sourceUrl, siteName: x.siteName ?? p.siteName, fetchedAt: p.fetchedAt, name: x.name || p.name || '', town: x.town || p.town || '',
        imageUrl: x.imageUrl ?? p.imageUrl, sleeps: x.sleeps || (p.sleeps ? String(p.sleeps) : ''),
        ...(p.price && x.cost !== 'price' && { cost: 'price' as const, amount: fromMinor(p.price), currency: p.price.currency, basis: p.price.basis ?? '', fees: p.price.fees, observedOn: p.price.observedOn ?? who.today, context: p.price.context ?? '' }),
      }))
    } catch (e) { setError(errText(e, t('Could not read that link.'))) } finally { setReading(false) }
  }
  const submit = async () => {
    if (!d.name.trim()) { setError(t('Give it a name.')); return }
    const sleeps = d.sleeps.trim() ? Number(d.sleeps) : null
    if (sleeps !== null && (!Number.isInteger(sleeps) || sleeps < 1)) { setError(t('Sleeps is a whole number, like 6.')); return }
    const minor = d.cost === 'price' ? toMinor(d.amount, d.currency.toUpperCase()) : null
    if (d.cost === 'price' && minor === undefined) { setError(t('Check the price: a number like 212 or 1,480.50, and a currency like USD.')); return }
    if (d.imageUrl && !/^https:\/\//i.test(d.imageUrl)) { setError(t('A picture link starts with https://')); return }
    const priceChanged = d.cost === 'price' && (minor !== option?.price?.amountMinor || d.currency.toUpperCase() !== option?.price?.currency)
    const body: StayOptionInput = {
      groupId: group.id, kind: d.kind, name: d.name.trim(), town: d.town.trim() || null, sourceUrl: d.sourceUrl.trim() || null, siteName: d.siteName, imageUrl: d.imageUrl, fetchedAt: d.fetchedAt,
      cost: d.cost, price: d.cost === 'price' ? { amountMinor: minor!, currency: d.currency.toUpperCase(), basis: d.basis || null, fees: d.fees, observedOn: priceChanged ? who.today : d.observedOn, context: d.context.trim() || null } : null,
      sleeps, notes: d.notes.trim() || null, booking: family ? (d.booking === 'confirmed_family' ? 'confirmed_family' : 'none') : d.booking === 'confirmed_family' ? 'none' : d.booking,
      ...((!option || detailsTouched) && who.parent && { details: Object.values(d.details).some(Boolean) ? d.details : null }),
    }
    setBusy(true); setError('')
    const edits = option ? changedFields(option as unknown as Record<string, unknown>, body as Record<string, unknown>) : body
    if (option && !Object.keys(edits).length) { setBusy(false); onClose(); return }
    const ok = await save(rev => option ? api.updateTripPart(trip.id, 'stays', option.id, rev, edits) : api.addTripPart(trip.id, 'stays', rev, body), t('Saved: {name}', { name: body.name! }))
    setBusy(false)
    if (ok) onClose()
  }
  const remove = async () => {
    if (!option || !await dialog.confirm({ title: t('Delete “{name}”?', { name: option.name }), confirmLabel: t('Delete place'), danger: true })) return
    setBusy(true)
    const ok = await save(rev => api.deleteTripPart(trip.id, 'stays', option.id, rev), t('Deleted: {name}', { name: option.name }))
    setBusy(false)
    if (ok) onClose()
  }
  const audience = trip.detailsAudience === 'everyone' ? (trip.detailsOnWall ? t('Everyone in the family, and the wall') : t('Everyone in the family')) : t('Grown-ups only')
  const readNote = !read ? null : !read.ok ? (read.reason === 'blocked' ? t('That site doesn’t let Kinwall read its pages. The link still saves; fill in the rest.') : t('Couldn’t read that page. The link still saves; fill in the rest.'))
    : read.name ? t('Read from {site}. Check each field before adding: listings change.', { site: read.siteName ?? t('the page') }) : t('Partly read. Fill in what’s missing.')
  const field = (k: 'name' | 'town' | 'sleeps' | 'notes', label: string, extra: Record<string, string | number> = {}) =>
    <div className="field"><label htmlFor={`${id}-${k}`}>{label}</label>{k === 'notes'
      ? <textarea id={`${id}-${k}`} maxLength={2000} value={d[k]} onChange={e => set(k, e.target.value)} {...extra} />
      : <input id={`${id}-${k}`} type="text" maxLength={200} value={d[k]} onChange={e => set(k, e.target.value)} {...extra} />}</div>
  const dfield = (k: keyof StayDetails, label: string, extra: Record<string, string> = {}) =>
    <div className="field"><label htmlFor={`${id}-d-${k}`}>{label}</label><input id={`${id}-d-${k}`} type={k === 'manageUrl' ? 'url' : 'text'} maxLength={k === 'manageUrl' ? 2000 : 500} autoComplete="off" value={d.details[k] ?? ''} onChange={e => detail(k, e.target.value)} {...extra} /></div>
  return <Sheet title={option ? t('Edit {name}', { name: option.name }) : t('Add a place to stay')} onClose={() => { if (!busy) onClose() }} dismissable={!busy} dirty="auto" actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" type="submit" form={id} disabled={busy || reading}>{busy ? t('Saving…') : option ? t('Save') : t('Add to {stay}', { stay: group.label })}</button>
  </>}>
    <form id={id} onSubmit={e => { e.preventDefault(); void submit() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <Choose label={t('Kind of place')} value={d.kind} onChange={v => set('kind', v)} options={KINDS.map(k => ({ value: k, emoji: STAY_EMOJI[k], label: kindLabel(k) }))} />
        {family && <p className="field-hint">{t('Only the name is needed. The people who live there don’t need Kinwall, and there’s nothing to book.')}</p>}
        {!family && <>
          <div className="field"><label htmlFor={`${id}-url`}>{t('Link (optional)')}</label>
            <div className="trip-link-row">
              <input id={`${id}-url`} type="url" inputMode="url" maxLength={2000} value={d.sourceUrl} onChange={e => { set('sourceUrl', e.target.value); setRead(null) }} />
              <button type="button" className="btn btn-secondary trip-fit" disabled={reading || !d.sourceUrl.trim()} onClick={() => void readLink()}>{reading ? t('Reading…') : t('Read the page')}</button>
            </div>
            <p className="field-hint" role="status">{readNote ?? t('A hotel, rental or any public page. Kinwall reads only what the page publishes; nothing is saved until you add it.')}</p>
          </div>
        </>}
        {field('name', t('Name'), { required: 'required', placeholder: family ? t('Grandma’s house') : t('Seagrass Cottage') })}
        {field('town', t('Town (optional)'))}
        {!family && <div className="field trip-picture">
          <span className="recipe-photo-label">{t('Picture')}</span>
          {d.imageUrl ? <>
            {option?.imageUrl === d.imageUrl ? <StayPhoto optionId={option.id} siteName={d.siteName} /> : <p className="field-hint">{d.siteName ? t('Picture from {site}. It appears after saving.', { site: d.siteName }) : t('A picture from the page. It appears after saving.')}</p>}
            <p className="trip-picture-btns"><button type="button" className="link-btn" onClick={() => set('imageUrl', null)}>{t('Remove picture')}</button>
              <button type="button" className="link-btn" onClick={() => setNewPicture('')}>{t('Use a different picture')}</button></p>
          </> : <p className="field-hint">{t('No picture. The card works without one.')} <button type="button" className="link-btn" onClick={() => setNewPicture('')}>{t('Add a picture link')}</button></p>}
          {newPicture !== null && <div className="trip-link-row">
            <input type="url" inputMode="url" aria-label={t('Picture link')} maxLength={2000} value={newPicture} onChange={e => setNewPicture(e.target.value)} />
            <button type="button" className="btn btn-secondary trip-fit" disabled={!/^https:\/\//i.test(newPicture.trim())} onClick={() => { set('imageUrl', newPicture.trim()); setNewPicture(null) }}>{t('Use it')}</button>
          </div>}
          <p className="field-hint">{t('Kinwall shows the picture through its own server and never saves a copy.')}</p>
        </div>}
        <h3>{t('Cost')}</h3>
        <Choose label={t('Cost')} value={d.cost} onChange={v => set('cost', v)} options={[{ value: 'unknown', label: t('Not set yet') }, { value: 'free', label: t('Free') }, { value: 'contribution', label: t('We’ll offer to chip in') }, { value: 'price', label: t('A price') }]} />
        {d.cost === 'unknown' && <p className="field-hint">{t('Shows as “Cost not set yet”. It never counts as free.')}</p>}
        {d.cost === 'price' && <>
          <div className="meal-form-row">
            <div className="field"><label htmlFor={`${id}-amt`}>{t('Price as listed')}</label><input id={`${id}-amt`} type="text" inputMode="decimal" maxLength={14} placeholder="212" value={d.amount} onChange={e => set('amount', e.target.value)} /></div>
            <div className="field trip-currency"><label htmlFor={`${id}-cur`}>{t('Currency')}</label><input id={`${id}-cur`} type="text" maxLength={3} autoCapitalize="characters" value={d.currency} onChange={e => set('currency', e.target.value.toUpperCase())} /></div>
          </div>
          <div className="meal-form-row">
            <Choose label={t('For')} value={d.basis} onChange={v => set('basis', v)} options={[{ value: 'night', label: t('A night') }, { value: 'stay', label: t('The whole stay') }, { value: 'week', label: t('A week') }, { value: 'person', label: t('A person') }, { value: '', label: t('Not sure') }]} />
            <Choose label={t('Fees and taxes')} value={d.fees} onChange={v => set('fees', v)} options={[{ value: 'unknown', label: t('Not sure') }, { value: 'included', label: t('Included') }, { value: 'extra', label: t('Extra') }]} />
          </div>
          <div className="field"><label htmlFor={`${id}-ctx`}>{t('For which dates or people (optional)')}</label><input id={`${id}-ctx`} type="text" maxLength={200} placeholder={t('4 nights, 2 adults and 2 kids')} value={d.context} onChange={e => set('context', e.target.value)} /></div>
          <p className="field-hint">{t('Prices are shown as listed and never added up. Sites change prices; check before you book.')}</p>
        </>}
        {field('sleeps', t('Sleeps (optional)'), { inputMode: 'numeric', maxLength: 3 })}
        {field('notes', t('Notes (optional)'), { placeholder: t('Porch, 5 minutes to the beach') })}
        <h3>{t('Status')}</h3>
        <Choose<StayBooking> label={family ? t('With the family') : t('Booking')} value={family ? (d.booking === 'confirmed_family' ? 'confirmed_family' : 'none') : d.booking === 'confirmed_family' ? 'none' : d.booking} onChange={v => set('booking', v)}
          options={family ? [{ value: 'none', label: t('Not confirmed yet') }, { value: 'confirmed_family', label: t('Confirmed with family') }]
            : [{ value: 'none', label: t('Not booked') }, { value: 'booked', label: t('Booked') }, { value: 'canceled', label: t('Canceled') }]} />
        <p className="field-hint">{family ? t('No booking or payment step for a family home.') : t('Mark Booked after you book it elsewhere. Kinwall doesn’t book or check bookings.')}</p>
        {who.parent && <fieldset className="meal-fieldset trip-details-fields">
          <legend><span aria-hidden="true">🔒 </span>{t('Booking details')}</legend>
          <p className="field-hint">{t('Who sees these follows this trip’s setting: {audience}.', { audience })}</p>
          {dfield('address', t('Street address'))}
          {dfield('contact', family ? t('Contact at the house') : t('Host or front desk'), { placeholder: family ? t('Just text. They don’t need to be in Kinwall.') : '' })}
          {dfield('arrival', t('Arrival notes'), { placeholder: t('Where the key is, parking') })}
          {!family && dfield('confirmation', t('Confirmation number'))}
          {!family && dfield('manageUrl', t('Manage booking link'), { placeholder: 'https://' })}
          {dfield('codes', t('Door, lockbox or Wi-Fi codes'))}
        </fieldset>}
        {option && <div className="sheet-danger-zone"><button type="button" className="link-btn link-danger" onClick={() => void remove()}>{t('Delete place…')}</button></div>}
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Sheet>
}
