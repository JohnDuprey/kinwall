import { t, tn } from './i18n.ts'

// Bonus points a parent gives outside a chore (POST /api/points/awards): the typed amount and the
// short lines the profile and toast show.
export const BONUS_MAX = 500
export const BONUS_NOTE_MAX = 80
export const BONUS_QUICK = [5, 10, 25]

/** A typed amount as a whole number from 1 to BONUS_MAX, else null. */
export function bonusPoints(raw: string): number | null {
  const t = raw.trim()
  if (!/^\d+$/.test(t)) return null
  const n = Number(t)
  return n >= 1 && n <= BONUS_MAX ? n : null
}

export const bonusLine = (a: { points: number; note: string | null }) => [`+${a.points}`, a.note, t('from a parent')].filter(Boolean).join(' · ')
export const gaveText = (name: string, points: number) => tn(points, 'Gave {name} {n} point', 'Gave {name} {n} points', { name })
