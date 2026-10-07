// Order nights' pure helpers (web/test/orders.test.ts): who orders, the order read off by item, and its text.
import type { Meal, MealOrder, OrderItem, OrderType, Restaurant } from './meal-types.ts'
import type { Me } from './types.ts'

export const ORDER_TYPE_LABEL: Record<OrderType, string> = { dine_in: 'Eating there', pickup: 'Pickup', delivery: 'Delivery' }
type Person = { id: string; name: string }

/** Whose rows the order sheet shows: a kid's own device only theirs; otherwise who's eating (everyone
 * when nobody is picked), plus anyone who has ordered anyway, in family order. */
export function orderPeople<P extends Person>(meal: Pick<Meal, 'eaterIds' | 'orders'>, members: P[], own?: string | null): P[] {
  if (own) return members.filter(m => m.id === own)
  const ordered = new Set((meal.orders ?? []).map(o => o.memberId))
  return members.filter(m => (meal.eaterIds.length ? meal.eaterIds.includes(m.id) : true) || ordered.has(m.id))
}

/** "2 of 4 orders in" (or "1 order in" when nobody's picked as eating). */
export function ordersLabel(meal: Pick<Meal, 'eaterIds' | 'orders'>): string {
  const n = (meal.orders ?? []).filter(o => o.items.length).length
  return meal.eaterIds.length ? `${n} of ${meal.eaterIds.length} orders in` : `${n} order${n === 1 ? '' : 's'} in`
}

/** The order the way the caller reads it: the same item (and item note) added up, with who it's for. */
export function orderLines(orders: MealOrder[], members: Person[]): { key: string; qty: number; name: string; note: string | null; who: string[] }[] {
  const lines = new Map<string, { key: string; qty: number; name: string; note: string | null; who: string[] }>()
  const rank = (id: string) => { const i = members.findIndex(m => m.id === id); return i < 0 ? members.length : i }
  for (const o of [...orders].sort((a, b) => rank(a.memberId) - rank(b.memberId))) {
    const who = members.find(m => m.id === o.memberId)?.name ?? 'Someone'
    for (const item of o.items) {
      const key = JSON.stringify([item.name.trim().toLocaleLowerCase(), (item.note ?? '').trim().toLocaleLowerCase()])
      const line = lines.get(key) ?? { key, qty: 0, name: item.name, note: item.note, who: [] }
      line.qty += item.qty
      if (!line.who.includes(who)) line.who.push(who)
      lines.set(key, line)
    }
  }
  return [...lines.values()]
}

/** Copy order: a plain-text order to paste into an ordering page's notes or a message. */
export function orderText(meal: Pick<Meal, 'title' | 'orderType' | 'orders'>, members: Person[]): string {
  const orders = meal.orders ?? []
  const head = [meal.title, meal.orderType ? ORDER_TYPE_LABEL[meal.orderType] : null].filter(Boolean).join(' · ')
  const lines = orderLines(orders, members).map(l => `${l.qty} × ${l.name}${l.note ? `, ${l.note}` : ''} (${l.who.join(', ')})`)
  const notes = orders.filter(o => o.note).map(o => `${members.find(m => m.id === o.memberId)?.name ?? 'Someone'}: ${o.note}`)
  return [head, ...lines, ...(notes.length ? ['', 'Notes:', ...notes] : [])].join('\n')
}

/** Someone's usual here: their latest order from another night, when it differs from what they have. */
export function usualFor(restaurant: Pick<Restaurant, 'lastOrders'> | null | undefined, memberId: string, meal: Pick<Meal, 'id' | 'orders'>): OrderItem[] | null {
  const last = restaurant?.lastOrders?.find(o => o.memberId === memberId && o.mealId !== meal.id)
  const now = meal.orders?.find(o => o.memberId === memberId)?.items ?? []
  if (!last?.items.length || JSON.stringify(last.items.map(i => [i.name, i.qty])) === JSON.stringify(now.map(i => [i.name, i.qty]))) return null
  return last.items
}

/** "2 × Cheese slice, Fries". */
export const itemsLabel = (items: OrderItem[]) => items.map(i => `${i.qty > 1 ? `${i.qty} × ` : ''}${i.name}`).join(', ')

/** A kid's own device orders only for them; parents' devices and shared walls for anyone. */
export const ownOrderer = (me: Pick<Me, 'scope' | 'owner'> | null) => me && me.scope !== 'admin' && me.owner && me.owner !== 'shared' ? me.owner : null
