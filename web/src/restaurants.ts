// The restaurant binder's pure helpers (web/test/restaurants.test.ts).
import type { MenuItem } from './meal-types.ts'

/** "$12.99"; null for no price. Prices are shown, never totaled. */
export const priceLabel = (cents: number | null) => cents === null ? null : `$${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`

/** "12.99" typed into a price field, in cents; '' is no price, anything else unreadable is undefined. */
export function parsePrice(value: string): number | null | undefined {
  const v = value.trim().replace(/^\$/, '').replace(',', '.')
  if (!v) return null
  return /^\d{1,4}(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : undefined
}

/** A dialable tel: link, or null when the text isn't a phone number. */
export function telHref(phone: string | null) {
  const digits = (phone ?? '').trim().replace(/[\s().-]/g, '')
  return /^\+?[0-9]{7,15}$/.test(digits) ? `tel:${digits}` : null
}
/** The same map search Contacts uses. */
export const mapHref = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`

/** The menu as it's read: favorites first, then each section in the order it first appears. */
export function menuSections(menu: MenuItem[]): { title: string | null; favorites?: true; items: MenuItem[] }[] {
  const out: { title: string | null; favorites?: true; items: MenuItem[] }[] = []
  const favorites = menu.filter(i => i.favorite)
  if (favorites.length) out.push({ title: 'Favorites', favorites: true, items: favorites })
  const bySection = new Map<string | null, MenuItem[]>()
  for (const item of menu) bySection.set(item.section, [...(bySection.get(item.section) ?? []), item])
  for (const [title, items] of bySection) out.push({ title, items })
  return out
}
