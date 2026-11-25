// Where a meal, outing or calendar event came from on a trip (GET /api/trips/links): the "✈️ Beach
// week" tag on a meal in Meals, and the From Trips row on an event. Read once per app refresh and
// shared; nothing while Trips is off or on a server without the route.
import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { ChevronRight } from './icons.tsx'
import { t } from './i18n.ts'
import type { TripLinkRef } from './trip-types.ts'

let cache: { tick: number; links: Promise<TripLinkRef[]> } | null = null
window.addEventListener('kinwall:trips', () => { cache = null })

/** The trip links by kind and record id, e.g. links.get('meal:<id>'). */
export function useTripLinks(): Map<string, TripLinkRef> {
  const { settings, refreshTick } = useApp()
  const on = !!settings.features.trips
  const [links, setLinks] = useState<Map<string, TripLinkRef>>(new Map())
  useEffect(() => {
    if (!on) { setLinks(new Map()); return }
    let canceled = false
    if (!cache || cache.tick !== refreshTick) cache = { tick: refreshTick, links: api.getTripLinks().catch(() => []) }
    cache.links.then(list => { if (!canceled) setLinks(new Map(list.map(l => [`${l.kind}:${l.refId}`, l]))) })
    return () => { canceled = true }
  }, [on, refreshTick])
  return links
}

/** On an event a trip linked or added: which trip, with a link back. */
export function EventTrip({ eventId }: { eventId: string }) {
  const link = useTripLinks().get(`event:${eventId}`)
  if (!link) return null
  return <section className="event-outing" aria-label={t('From Trips')}>
    <a className="sheet-link" href={`#/trips?${new URLSearchParams({ trip: link.tripId })}`}><span aria-hidden="true">{link.emoji || '🧳'}</span>
      <span>{t('From Trips: {title}', { title: link.title })}<small>{t('Open the trip')}</small></span><ChevronRight /></a>
  </section>
}
