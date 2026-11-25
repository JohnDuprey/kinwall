// Pieces Trips.tsx and Away.tsx share: who's acting on this device, the listing picture, a "where's
// this clock" zone field and a row of faces.
import { useEffect, useId, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { actingMember } from './actingAs.ts'
import PickField from './PickField.tsx'
import { Segmented } from './a11y.tsx'
import { Face } from './Face'
import { todayKeyInTz } from './date.ts'
import { t } from './i18n.ts'
import { onMinute } from './minuteTick.ts'
import { timezoneList, tzCity, tzInfo, tzName, tzOrder } from './timezone.ts'
import type { Member } from './types.ts'

export const TRIPS_CHANGED = 'kinwall:trips'
/** Tells every trip list, page and the Board line to read again. */
export const tripsChanged = () => window.dispatchEvent(new Event(TRIPS_CHANGED))
export function useTripsTick(): [number, () => void] {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(n => n + 1)
    window.addEventListener(TRIPS_CHANGED, bump)
    // Clock-derived trip data can change without a family-data revision (midnight, arrival, etc.).
    const stopClock = onMinute(() => { if (document.visibilityState === 'visible') bump() })
    return () => { stopClock(); window.removeEventListener(TRIPS_CHANGED, bump) }
  }, [])
  return [tick, () => setTick(n => n + 1)]
}

export const errText = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

/** What this device is: a parent's (everything), a kid's own, or a shared wall. The server decides
 * what each may read and change; this only picks which controls to offer. */
export function useTripWho() {
  const { members, parentDevice, meMemberId, settings } = useApp()
  const kidId = !parentDevice && meMemberId && members.find(m => m.id === meMemberId)?.grownUp === false ? meMemberId : null
  const tz = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  return { parent: parentDevice, kidId, wall: !parentDevice && !meMemberId, today: todayKeyInTz(tz), tz }
}

/** Who a mark or vote is for: a member's own device is them; a wall uses its picked person or asks;
 * a parent's device starts on its owner with "Someone else". `allowed` limits the names (a stay vote:
 * the people going). Returns the chosen member and the picker to show. */
export function useActingAs(allowed?: string[]) {
  const { members, meMemberId, actingMemberId, parentDevice } = useApp()
  const people = allowed ? members.filter(m => allowed.includes(m.id)) : members
  const lockedTo = !parentDevice && meMemberId ? meMemberId : actingMember(actingMemberId, members)?.id ?? null
  const [picked, setPicked] = useState<string | null>(parentDevice && meMemberId && (!allowed || allowed.includes(meMemberId)) ? meMemberId : null)
  const [choosing, setChoosing] = useState(false)
  const who = lockedTo ?? picked
  const id = useId()
  const name = (memberId: string | null) => members.find(m => m.id === memberId)?.name ?? t('Someone')
  const picker = (verb: 'mark' | 'vote') => {
    const line = (memberId: string) => verb === 'vote' ? t('Voting as {name}', { name: name(memberId) }) : t('Marking for {name}', { name: name(memberId) })
    if (lockedTo) return <p className="poll-voting-as"><Face m={members.find(m => m.id === lockedTo) ?? { name: '?', color: 'var(--bg-alt)' }} /> {line(lockedTo)}</p>
    if (parentDevice && picked && !choosing) return <p className="poll-voting-as"><Face m={members.find(m => m.id === picked) ?? { name: '?', color: 'var(--bg-alt)' }} /> {line(picked)} <button type="button" className="link-btn" onClick={() => setChoosing(true)}>{t('Someone else')}</button></p>
    return <div className="poll-who">
      <p className="poll-who-label" id={id}>{picked ? line(picked) : t('Who? Tap your name.')}</p>
      <div className="poll-who-row" role="group" aria-labelledby={id}>
        {people.map(m => <button key={m.id} type="button" className={`news-who-btn poll-who-btn ${picked === m.id ? 'active' : ''}`} aria-pressed={picked === m.id} onClick={() => { setPicked(m.id); setChoosing(false) }}>
          <Face m={m} /><span>{m.name}</span>
        </button>)}
      </div>
    </div>
  }
  /** A shared wall forgets the name after each tap, ready for the next person. */
  const done = () => { if (!lockedTo && !parentDevice) setPicked(null) }
  return { who, picker, done, name }
}

/** A saved place to stay's picture, through the server (it fetches the listing's saved picture URL;
 * the browser keeps it a week). Nothing when there's none, in the demo, or when it fails. */
export function StayPhoto({ optionId, siteName, className = 'stay-photo' }: { optionId: string; siteName: string | null; className?: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const src = api.stayImageUrl(optionId)
  if (!src || failed === src) return null
  return <figure className={className}>
    <img src={src} alt="" loading="lazy" decoding="async" onError={() => setFailed(src)} />
    {siteName && <figcaption>{t('Picture: {site}', { site: siteName })}</figcaption>}
  </figure>
}

/** Faces of the people, with their names for a screen reader. */
export function Faces({ ids, members, max = 4 }: { ids: string[]; members: Member[]; max?: number }) {
  const who = ids.map(id => members.find(m => m.id === id)).filter((m): m is Member => !!m)
  if (!who.length) return null
  return <span className="outing-faces trip-faces" role="img" aria-label={new Intl.ListFormat(undefined, { type: 'conjunction' }).format(who.map(m => m.name))}>
    {who.slice(0, max).map(m => <Face key={m.id} m={m} />)}
    {who.length > max && <span className="trip-faces-more" aria-hidden="true">+{who.length - max}</span>}
  </span>
}

/** The zone a clock belongs to (where a flight leaves or lands). "Not sure" stays unknown: Kinwall
 * never fills in home time for a place it doesn't know. */
export function ZoneField({ id, label, value, onChange }: { id?: string; label: string; value: string | null; onChange: (tz: string | null) => void }) {
  const options = () => {
    const now = new Date()
    return [{ value: '', label: t('Not sure') }, ...tzOrder(timezoneList(), Intl.DateTimeFormat().resolvedOptions().timeZone, value).map(tz => {
      const { time, offset } = tzInfo(tz, now)
      return { value: tz, label: tzCity(tz), keywords: tz, detail: [tz.includes('/') ? tz.slice(0, tz.lastIndexOf('/')) : '', time, tz === 'UTC' ? '' : offset].filter(Boolean).join(' · ') }
    })]
  }
  return <PickField id={id} label={label} options={options} value={value ? [value] : ['']} onChange={v => onChange(v[0] || null)}
    search placeholder={t('City or region, like New York')} summary={value ? tzName(value) : t('Not sure')} />
}

/** A field with its label above it, for controls that aren't inputs (PickField, ZoneField). */
export function Labeled({ label, children }: { label: string; children: (id: string) => React.ReactNode }) {
  const id = useId()
  return <div className="field"><label htmlFor={id}>{label}</label>{children(id)}</div>
}

/** One choice, never a native <select>: a few short choices are a segmented control; more open a
 * sheet (PickField). `none` is what the row says while nothing is picked. */
export function Choose<T extends string>({ label, value, options, onChange, none }: {
  label: string; value: T; options: { value: T; label: string; emoji?: string }[]; onChange: (v: T) => void; none?: string
}) {
  const id = useId()
  if (options.length <= 3 && options.reduce((n, o) => n + o.label.length, 0) <= 40) return <div className="field"><label id={id}>{label}</label>
    <Segmented label={label} value={value} onChange={onChange}
      options={options.map(o => ({ key: o.value, label: o.emoji ? <><span aria-hidden="true">{o.emoji} </span>{o.label}</> : o.label }))} /></div>
  return <div className="field"><label htmlFor={id}>{label}</label>
    <PickField id={id} label={label} value={[value]} none={none} onChange={v => onChange(v[0] as T)}
      options={options.map(o => ({ value: o.value, label: o.label, lead: o.emoji && <span aria-hidden="true">{o.emoji}</span> }))} /></div>
}
