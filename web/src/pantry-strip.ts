import type { PantryItem } from './types.ts'

/** Keep the soonest food visible and leave space for +N when some chips are hidden. */
export function chipsThatFit(widths: number[], available: number, more: number, gap: number): number {
  const total = widths.reduce((sum, width) => sum + width, 0) + Math.max(0, widths.length - 1) * gap
  if (total <= available) return widths.length
  let used = 0
  let count = 0
  for (const width of widths) {
    if (used + width + gap + more > available) break
    used += width + gap
    count++
  }
  return count
}

/** The strip is a prompt to use food today; the sheet keeps the actual expired status. */
export function stripFood<T extends Pick<PantryItem, 'useBy' | 'daysLeft' | 'status'>>(items: T[]): T[] {
  return [...items].sort((a, b) => (a.useBy ?? '').localeCompare(b.useBy ?? ''))
    .map(item => item.status === 'expired' ? { ...item, daysLeft: 0, status: 'today' } : item)
}
