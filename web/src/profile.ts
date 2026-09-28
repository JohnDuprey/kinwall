// Words and labels for a member's profile (Profile.tsx). Pure, so web/test/profile.test.ts covers them.
import type { MemberStats, StatsPeriod } from './types.ts'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const EARLIER: Record<Exclude<StatsPeriod, 'all'>, string> = { today: 'yesterday', week: 'last week', month: 'this time last month', year: 'this time last year' }

/** Chores done against their own earlier stretch: up is cheered, down is just a number. */
export function compareText(now: number, previous: Pick<NonNullable<MemberStats['previous']>, 'choresDone'> | null, period: StatsPeriod, joined: string): string {
  if (!previous || period === 'all') return `Since ${MONTHS[Number(joined.slice(5, 7)) - 1]} ${joined.slice(0, 4)}`
  const earlier = EARLIER[period]
  if (now > previous.choresDone) return `▲ ${now - previous.choresDone} more than ${earlier}`
  if (now === previous.choresDone) return `Same as ${earlier}`
  return `${previous.choresDone} ${earlier}`
}

export function periodWord(period: StatsPeriod, today: string): string {
  return period === 'today' ? 'today' : period === 'week' ? 'this week' : period === 'month' ? `in ${MONTHS[Number(today.slice(5, 7)) - 1]}` : period === 'year' ? `in ${today.slice(0, 4)}` : 'since joining'
}

export function duration(seconds: number): string {
  const m = Math.floor(seconds / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`
}

export function birthdayText(b: { daysUntil: number; turning: number | null }): string {
  if (b.daysUntil === 0) return 'Birthday today! 🎂'
  const what = b.turning === null ? 'Birthday' : `Turns ${b.turning}`
  return b.daysUntil === 1 ? `${what} tomorrow 🎂` : `${what} in ${b.daysUntil} days`
}

/** Axis labels for the chores chart: weekday initials, a few days of the month, month initials,
 * or (all time) the first month, Januaries and Julys. */
export function chartLabels(keys: string[], period: StatsPeriod): string[] {
  return keys.map((k, i) => {
    if (period === 'week') return 'SMTWTFS'[new Date(`${k}T12:00:00Z`).getUTCDay()]
    const day = Number(k.slice(8, 10))
    if (period === 'month') return [1, 8, 15, 22, 29].includes(day) ? String(day) : ''
    const month = Number(k.slice(5, 7))
    if (period === 'year') return MONTHS[month - 1][0]
    return i === 0 || month === 1 || month === 7 ? `${MONTHS[month - 1].slice(0, 3)} ’${k.slice(2, 4)}` : ''
  })
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
