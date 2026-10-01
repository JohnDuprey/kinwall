// Newscast's grouping: day sections (Today, Yesterday, then days), about 8 a day before "Show all",
// family totals for the week, and the quiet "New: N · Show" count. The server groups items per
// person per day (server/src/routes/newscast.ts); this only lays them out.
import { format } from 'date-fns'
import type { NewscastItem } from './types.ts'

export const PER_DAY = 8

export type DaySection = { date: string; label: string; long: string; items: NewscastItem[]; more: number }

const local = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d) }
const addDays = (date: string, n: number) => { const d = local(date); d.setDate(d.getDate() + n); return format(d, 'yyyy-MM-dd') }

/** Items by day, newest day first (items keep the server's order inside a day). A day shows
 * PER_DAY items unless it's in `showAll`; `more` is how many wait behind "Show all". */
export function daySections(items: NewscastItem[], today: string, showAll: ReadonlySet<string> = new Set()): DaySection[] {
  const days = new Map<string, NewscastItem[]>()
  for (const i of items) days.set(i.date, [...(days.get(i.date) ?? []), i])
  return [...days.entries()].sort(([a], [b]) => b.localeCompare(a)).map(([date, all]) => {
    const long = format(local(date), 'EEEE, MMMM d')
    const label = date === today ? 'Today' : date === addDays(today, -1) ? 'Yesterday' : date >= addDays(today, -6) ? format(local(date), 'EEEE') : long
    const shown = showAll.has(date) ? all : all.slice(0, PER_DAY)
    return { date, label, long, items: shown, more: all.length - shown.length }
  })
}

/** "This week, together": family totals for the last 7 days. Totals only, nobody ranked. */
export function weekDigest(items: NewscastItem[], today: string) {
  const from = addDays(today, -6)
  const d = { chores: 0, books: 0, pictures: 0, rewards: 0 }
  for (const i of items) {
    if (i.date < from) continue
    if (i.kind === 'chores') d.chores += i.count
    else if (i.kind === 'book') d.books++
    else if (i.kind === 'photos' || i.kind === 'drawings') d.pictures += i.count
    else if (i.kind === 'reward') d.rewards++
  }
  return d
}

/** How many items a fresh load has that the screen doesn't, for "New: N · Show" (no jumping). */
export const newCount = (shown: NewscastItem[], fresh: NewscastItem[]) => {
  const have = new Set(shown.map(i => i.key))
  return fresh.filter(i => !have.has(i.key)).length
}

/** On a person's own device, things about them read "You finished 4 chores". Posts keep their words. */
export const asYou = (i: NewscastItem, me: string | null, name: string | undefined) =>
  i.kind !== 'post' && me && i.memberId === me && name && i.title.startsWith(`${name} `) ? `You ${i.title.slice(name.length + 1)}` : i.title
