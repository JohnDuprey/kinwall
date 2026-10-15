// A list item's due line and linked event (Lists.tsx rows and sheets, Get stuff done's card), and
// a linked event's date standing in for a missing due date when sorting (compareItems eventDue).
import { DAY, formatDate, MONTH_DAY, t } from './i18n.ts'
import { dateKey } from './date.ts'
import type { EventInstance } from './types.ts'

/** "Due today" / "Due Fri, Oct 3" / "Overdue · Sep 22" (open items only). `today` is YYYY-MM-DD. */
export function dueLabel(item: { dueDate: string | null; done: boolean }, today: string): { text: string; overdue: boolean } | null {
  if (!item.dueDate) return null
  const d = new Date(item.dueDate + 'T00:00:00')
  if (item.dueDate === today) return { text: t('Due today'), overdue: false }
  if (item.dueDate < today && !item.done) return { text: t('Overdue · {date}', { date: formatDate(d, MONTH_DAY) }), overdue: true }
  return { text: t('Due {date}', { date: formatDate(d, DAY) }), overdue: false }
}

export const eventDay = (e: Pick<EventInstance, 'start' | 'allDay'>) => new Date(e.allDay ? e.start + 'T00:00:00' : e.start)
/** "Thu, Oct 15 · 4:30 PM · Soccer practice" (no time for an all-day event), so two on one day differ. */
export const eventLabel = (e: Pick<EventInstance, 'start' | 'allDay' | 'title'>) =>
  [formatDate(eventDay(e), DAY), !e.allDay && formatDate(eventDay(e), { hour: 'numeric', minute: '2-digit' }), e.title].filter(Boolean).join(' · ')

/** Each linked event's day (YYYY-MM-DD) by id: compareItems' eventDue. */
export const eventDueMap = (byId: Map<string, Pick<EventInstance, 'start' | 'allDay'>>) =>
  new Map([...byId].map(([id, e]) => [id, dateKey(eventDay(e))]))
