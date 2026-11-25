// The Board's Today at a glance lines for travel (Board.tsx): who's away today (away days work with
// Trips off), and a trip that's under way or starts within two weeks. Basic plans only: never a
// booking detail, so it's safe on a wall.
import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { todayKeyInTz } from './date.ts'
import { t } from './i18n.ts'
import { awayUntil } from './away.ts'
import { onMinute } from './minuteTick.ts'
import { longDay, tripCountdown, tripDayLabel, tripPhase, tripToday } from './trips.ts'
import { addDays, daysBetween } from './upkeep-rules.ts'
import type { AwayPeriod, TripSummary } from './trip-types.ts'

type Glance = { key: string; full: React.ReactNode; row: React.ReactNode; chip: React.ReactNode }

export function useTripGlance(): Glance[] {
  const { settings, members, refreshTick } = useApp()
  const tripsOn = !!settings.features.trips
  const [away, setAway] = useState<AwayPeriod[]>([])
  const [trips, setTrips] = useState<TripSummary[]>([])
  const [tick, setTick] = useState(0)
  const today = todayKeyInTz(settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  useEffect(() => {
    const bump = () => setTick(n => n + 1)
    window.addEventListener('kinwall:trips', bump)
    const stopClock = onMinute(() => { if (document.visibilityState === 'visible') bump() })
    return () => { stopClock(); window.removeEventListener('kinwall:trips', bump) }
  }, [])
  useEffect(() => {
    let canceled = false
    // All of them, not just today's: back-to-back periods make one longer run (awayUntil).
    api.getAway().then(x => { if (!canceled) setAway(x) }).catch(() => { /* keep the last ones */ })
    if (tripsOn) api.getTrips().then(x => { if (!canceled) setTrips(x) }).catch(() => { /* keep the last ones */ })
    return () => { canceled = true }
  }, [tripsOn, refreshTick, tick, today])
  const out: Glance[] = []
  const gone = members.map(m => ({ m, until: awayUntil(away, m.id, today) })).filter(x => x.until)
  if (gone.length) {
    const names = new Intl.ListFormat(undefined, { type: 'conjunction' }).format(gone.map(x => x.m.name))
    const last = gone.map(x => x.until!).sort().at(-1)!
    const back = longDay(addDays(last, 1))
    const text = gone.every(x => x.until === last) ? t('{names} away, back {day}', { names, day: back }) : t('{names} away', { names })
    const link = (cls: string) => <a className={cls} href="#/away" aria-label={text}><span aria-hidden="true">✈️</span><span aria-hidden="true" className={cls === 'board-slot-chip' ? 'board-slot-chip-text' : 'board-slot-row-text'}>{text}</span></a>
    out.push({ key: 'away', chip: link('board-slot-chip'), row: link('board-slot-row'), full: link('board-slot-row') })
  }
  if (tripsOn) {
    const open = trips.filter(x => !x.archivedAt && !x.canceledAt && x.status !== 'idea')
    // A trip under way counts its days on the clock where the family is (the server's travel day).
    const now = open.find(x => tripPhase(x, tripToday(x, today)) === 'underway')
    const next = now ?? open.filter(x => tripPhase(x, today) === 'soon' && daysBetween(today, x.startDate!) <= 14).sort((a, b) => a.startDate!.localeCompare(b.startDate!))[0]
    if (next) {
      const when = now ? tripDayLabel(next, tripToday(next, today)) : tripCountdown(next, today)
      const text = `${next.title} · ${when}`
      const href = `#/trips?trip=${encodeURIComponent(next.id)}`
      const link = (cls: string) => <a className={cls} href={href} aria-label={text}><span aria-hidden="true">{next.emoji || '🧳'}</span><span aria-hidden="true" className={cls === 'board-slot-chip' ? 'board-slot-chip-text' : 'board-slot-row-text'}>{text}</span></a>
      out.push({ key: 'trip', chip: link('board-slot-chip'), row: link('board-slot-row'), full: link('board-slot-row') })
    }
  }
  return out
}
