// Pantry lists (food at home): an item's dueDate is its use-by date and its category where it's kept.
// Use-by status follows server/src/pantry.ts; recipe matching and ranking live on the server.
import { DAY, formatDate, MONTH_DAY, msg, t } from './i18n.ts'
import type { PantryItem, UseByStatus } from './types.ts'

/** Within this many days (and not today) an item is "soon". */
export const SOON_DAYS = 3
/** Where food is kept, offered before the family has its own places. */
export const KEPT_STARTERS = [msg('Fridge'), msg('Freezer'), msg('Pantry')]

const DATE = /^\d{4}-\d{2}-\d{2}$/
const dayNumber = (date: string) => Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) / 86_400_000

/** Days from `today` to a use-by date (YYYY-MM-DD) and what that means; null without a real date. */
export function expiryStatus(useBy: string | null | undefined, today: string): { daysLeft: number; status: UseByStatus } | null {
  if (!useBy || !DATE.test(useBy) || Number.isNaN(Date.parse(useBy))) return null
  const daysLeft = Math.round(dayNumber(useBy) - dayNumber(today))
  return { daysLeft, status: daysLeft < 0 ? 'expired' : daysLeft === 0 ? 'today' : daysLeft <= SOON_DAYS ? 'soon' : 'later' }
}

/** A pantry item's line: "⚠ Expired · Nov 6", "⏳ Use today", "⏳ Use by tomorrow", "⏳ Use by Tue, Nov 11",
 * "Use by Nov 20". The words and the mark carry it, not just the color. Nothing once used up or undated. */
export function expiryLabel(item: { dueDate: string | null; done: boolean }, today: string): { text: string; status: UseByStatus } | null {
  const when = item.done ? null : expiryStatus(item.dueDate, today)
  if (!when) return null
  const d = new Date(item.dueDate + 'T00:00:00')
  if (when.status === 'expired') return { text: t('⚠ Expired · {date}', { date: formatDate(d, MONTH_DAY) }), status: when.status }
  if (when.status === 'today') return { text: t('⏳ Use today'), status: when.status }
  if (when.daysLeft === 1) return { text: t('⏳ Use by tomorrow'), status: when.status }
  if (when.status === 'soon') return { text: t('⏳ Use by {date}', { date: formatDate(d, DAY) }), status: when.status }
  return { text: t('Use by {date}', { date: formatDate(d, MONTH_DAY) }), status: when.status }
}

/** Pantry groups (Fridge, Freezer...) in the order to look at them: the one with the soonest use-by
 * date first, groups with no dated food after, then A-Z. Each group's items are its open ones. */
export function soonestGroupFirst(a: { name: string; items: { dueDate: string | null }[] }, b: { name: string; items: { dueDate: string | null }[] }): number {
  const soonest = (items: { dueDate: string | null }[]) => items.reduce<string | null>((min, i) => (i.dueDate && (!min || i.dueDate < min) ? i.dueDate : min), null)
  const x = soonest(a.items), y = soonest(b.items)
  return x && y ? x.localeCompare(y) || a.name.localeCompare(b.name) : x ? -1 : y ? 1 : a.name.localeCompare(b.name)
}

/** A short "when" for a pantry item in a sentence ("today", "tomorrow", "Tue", "expired"). */
export function expiryShort(item: Pick<PantryItem, 'useBy' | 'daysLeft' | 'status'>): string {
  if (item.status === 'expired') return t('expired')
  if (item.daysLeft === 0) return t('today')
  if (item.daysLeft === 1) return t('tomorrow')
  return item.useBy ? formatDate(new Date(item.useBy + 'T00:00:00'), { weekday: 'short' }) : ''
}
