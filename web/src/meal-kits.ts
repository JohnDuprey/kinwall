import { todayKeyInTz } from './date.ts'
import { formatDate, t } from './i18n.ts'
import type { MealKit } from './meal-types.ts'

export const kitDate = (date: string) => formatDate(new Date(`${date}T12:00:00`), { weekday: 'short', month: 'short', day: 'numeric' })
export const kitWhen = (kit: MealKit) => t('Arrived {arrived} · cook by {date}', { arrived: kitDate(kit.receivedOn), date: kitDate(kit.cookBy) })
export const kitPast = (kit: MealKit, timezone?: string | null) => todayKeyInTz(timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone) > kit.cookBy
