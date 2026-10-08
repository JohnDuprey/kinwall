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

export type MenuOption = { label: string; cents: number }
/** An item's sizes or choices, read off the start of its description the way a menu is read in
 * ("Single $9.35 · Double $12.45 — Lettuce…" or '10" $11.40 · 14" $14.50'): the options (two or
 * more, each with a label) and the rest of the description. No options: the description as is. */
export function menuOptions(description: string | null): { options: MenuOption[]; rest: string | null } {
  const [head, ...tail] = (description ?? '').split(' — ')
  const options = head.split(' · ').map(part => /^(.+?)\s+\$(\d{1,4}(?:\.\d{1,2})?)$/.exec(part.trim()))
    .map(m => m && { label: m[1].replace(/^\((.+)\)$/, '$1'), cents: Math.round(Number(m[2]) * 100) })
  if (options.length < 2 || options.some(o => !o)) return { options: [], rest: description || null }
  return { options: options as MenuOption[], rest: tail.join(' — ') || null }
}

/** What goes in the order for an option: "Classic burger (Double)", "Garlic knots (6)". */
export const optionName = (name: string, label: string) => `${name} (${label})`

/** The Add-ons section's items that go with an item: those saying "For <its section>" (or saying
 * nothing about what they're for). Nothing for an add-on itself or an item with no section. */
export const ADDONS = 'Add-ons'
export function addonsFor(menu: MenuItem[], item: Pick<MenuItem, 'section'> | undefined): MenuItem[] {
  if (!item?.section || item.section === ADDONS) return []
  // The section as a whole entry of "A, B and C" (a section's own name may have "and" in it).
  const entry = new RegExp(`(?:^|, | and )${item.section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:, | and |$)`, 'i')
  return menu.filter(a => {
    if (a.section !== ADDONS) return false
    const forText = /(?:^| — )For (.+)$/.exec(a.description ?? '')?.[1]
    return !forText || entry.test(forText)
  })
}
