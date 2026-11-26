import { todayKeyInTz } from './date.ts'
import { formatDate, t } from './i18n.ts'
import type { MealKit } from './meal-types.ts'

export const plannedMealKit = (meal: { status: string; date: string; readyId?: string | null }, kits: MealKit[] = []) =>
  meal.status === 'planned' ? kits.find(kit => kit.left > 0 && (meal.readyId ? kit.id === meal.readyId : kit.receivedOn <= meal.date)) : undefined

export const kitDate = (date: string) => formatDate(new Date(`${date}T12:00:00`), { weekday: 'short', month: 'short', day: 'numeric' })
export const kitIcon = (kit: Pick<MealKit, 'kind'>) => kit.kind === 'prepped' ? '🥡' : kit.kind === 'frozen' ? '❄️' : '📦'
export const kitLabel = (kit: Pick<MealKit, 'kind'>) => kit.kind === 'prepped' ? t('Prepped') : kit.kind === 'frozen' ? t('Frozen') : t('Meal kit')
export const kitPlanLabel = (kit: Pick<MealKit, 'kind' | 'cookBy'>) => kit.kind === 'prepped'
  ? t('Prepped · eat by {date}', { date: kitDate(kit.cookBy) })
  : kit.kind === 'frozen' ? t('Frozen · use by {date}', { date: kitDate(kit.cookBy) })
  : t('Meal kit · cook by {date}', { date: kitDate(kit.cookBy) })
export const kitWhen = (kit: MealKit) => kit.kind === 'prepped'
  ? t('Prepped {date} · eat by {until}', { date: kitDate(kit.receivedOn), until: kitDate(kit.cookBy) })
  : kit.kind === 'frozen' ? t('Frozen {date} · use by {until}', { date: kitDate(kit.receivedOn), until: kitDate(kit.cookBy) })
  : t('Arrived {arrived} · cook by {date}', { arrived: kitDate(kit.receivedOn), date: kitDate(kit.cookBy) })
export const kitPast = (kit: MealKit, timezone?: string | null) => todayKeyInTz(timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone) > kit.cookBy
