import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import { Face } from './Face'
import { CartIcon, CheckIcon, EditIcon, MinusIcon, PhoneIcon, PlusIcon } from './icons.tsx'
import { MenuList } from './Restaurants.tsx'
import { itemsLabel, orderLines, orderPeople, ordersLabel, orderText, ORDER_TYPE_LABEL, ORDER_TYPE_ICON, ownOrderer, usualFor } from './orders.ts'
import { telHref } from './restaurants.ts'
import type { Meal, MenuItem, OrderItem, Restaurant } from './meal-types.ts'
import type { Me } from './types.ts'
import { SLOT_LABEL, mealDayLabel } from './meal-date.ts'
import { formatTime } from './timeFormat.ts'

const locked = (meal: Meal, me: Me | null) => meal.status !== 'planned' && me?.scope !== 'admin'

/** The restaurant a meal is from, loaded once for its phone, menu and everyone's usual. */
export function useMealRestaurant(meal: Meal | null) {
  const [restaurant, setRestaurant] = useState<Restaurant | null>(null)
  const id = meal?.mealKind === 'dining_out' ? meal.restaurantId : null
  useEffect(() => {
    let canceled = false
    if (id) api.getRestaurants(true).then(all => { if (!canceled) setRestaurant(all.find(r => r.id === id) ?? null) }).catch(() => {})
    return () => { canceled = true }
  }, [id])
  return id ? restaurant : null
}

/** The order as the caller reads it: Call, Copy order, each line with a tick (only while it's open),
 * then everyone's notes. Parents ask for orders and mark it ordered here. Meal sheet and event page. */
export function OrderSummary({ meal, restaurant, me, onChanged, onOrder }: {
  meal: Meal; restaurant: Restaurant | null; me: Me | null; onChanged: (meal: Meal) => void; onOrder: () => void
}) {
  const { members, toast } = useApp()
  const [ticked, setTicked] = useState<ReadonlySet<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const admin = me?.scope === 'admin'
  const orders = meal.orders ?? []
  const lines = orderLines(orders, members)
  const notes = orders.filter(o => o.note)
  const tel = telHref(restaurant?.phone ?? null)
  const ordered = meal.status !== 'planned'
  const run = async (work: () => Promise<Meal | void>, done: string) => {
    setBusy(true)
    try { const saved = await work(); toast(done); if (saved) onChanged(saved) } catch (e) { toast(e instanceof Error ? e.message : 'Could not save.', true) } finally { setBusy(false) }
  }
  const copy = async () => {
    try { await navigator.clipboard.writeText(orderText(meal, members)); toast('Order copied') } catch { toast('Could not copy the order.', true) }
  }
  return <section className="order-summary" aria-label="Orders">
    <div className="order-head">
      <h3>Orders</h3>
      <span className="chip chip-static">{ordered ? '✓ Ordered' : ordersLabel(meal)}</span>
    </div>
    {(tel || lines.length > 0 || restaurant?.orderUrl) && <div className="restaurant-actions">
      {tel && <a className="btn btn-primary" href={tel}><PhoneIcon /> Call {restaurant!.name}</a>}
      {restaurant?.orderUrl && <a className="btn btn-secondary" href={restaurant.orderUrl} target="_blank" rel="noopener noreferrer"><CartIcon /> Order online</a>}
      {lines.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => void copy()}>Copy order</button>}
    </div>}
    {lines.length ? <ul className="order-lines">{lines.map(l => {
      const on = ticked.has(l.key)
      return <li key={l.key}><button type="button" className="order-tick" aria-pressed={on} onClick={() => setTicked(t => { const next = new Set(t); if (!next.delete(l.key)) next.add(l.key); return next })}>
        <span className="order-box" aria-hidden="true">{on && <CheckIcon width={18} height={18} />}</span>
        <span><strong>{l.qty} × {l.name}</strong>{l.note && <span className="order-line-note">{l.note}</span>}<small>{l.who.join(', ')}</small></span>
      </button></li>
    })}</ul> : <p className="field-hint">No orders yet.</p>}
    {notes.length > 0 && <ul className="order-notes">{notes.map(o => <li key={o.memberId}><strong>{members.find(m => m.id === o.memberId)?.name ?? 'Someone'}:</strong> {o.note}</li>)}</ul>}
    <div className="meal-actions">
      {(!locked(meal, me) || admin) && <button type="button" className="btn btn-secondary" disabled={busy} onClick={onOrder}>{ownOrderer(me) ? (orders.some(o => o.memberId === ownOrderer(me)) ? 'Change my order' : 'Add my order') : lines.length ? 'Change orders' : 'Add orders'}</button>}
      {admin && !ordered && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void run(async () => { await api.askForOrders(meal.id) }, 'Asked for orders')}>Ask for orders</button>}
      {admin && <button type="button" className={ordered ? 'btn btn-secondary' : 'btn btn-primary'} disabled={busy} onClick={() => void run(() => api.updateMeal(meal.id, { status: ordered ? 'planned' : 'prepared' }), ordered ? 'Orders open again' : 'Marked ordered')}>{ordered ? 'Open orders again' : 'Mark ordered'}</button>}
    </div>
    {ordered && !admin && <p className="field-hint">It’s ordered. Ask a grown-up to change an order.</p>}
  </section>
}

/** Everyone's order, a row each with their items, note and their usual a tap away. A kid's own
 * device shows only their row; on a shared wall anyone picks whose row to fill in. */
export function OrderSheet({ meal: initial, restaurant, me, onClose, onSaved }: {
  meal: Meal; restaurant: Restaurant | null; me: Me | null; onClose: () => void; onSaved: (meal: Meal) => void
}) {
  const { members, toast } = useApp()
  const [meal, setMeal] = useState(initial)
  const [picking, setPicking] = useState<string | null>(null)
  const own = ownOrderer(me)
  const people = orderPeople(meal, members, own)
  const readOnly = locked(meal, me)
  // A kid's own device goes straight to their order.
  useEffect(() => { if (own && !readOnly) setPicking(own) }, [own, readOnly])
  const save = async (memberId: string, items: OrderItem[], note: string | null) => {
    try { const saved = await api.setMealOrder(meal.id, memberId, { items, note }); setMeal(saved); onSaved(saved); toast(items.length || note ? `Saved ${members.find(m => m.id === memberId)?.name ?? ''}’s order` : 'Order cleared'); return true }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not save the order.', true); return false }
  }
  const person = members.find(m => m.id === picking)
  return <Sheet title={`Orders: ${meal.title}`} onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
    <p className="field-hint">{meal.orderType ? `${ORDER_TYPE_LABEL[meal.orderType]}. ` : ''}{ordersLabel(meal)}. {readOnly ? 'It’s ordered, so ask a grown-up to change an order.' : !own ? 'Tap a person to add their order.' : ''}</p>
    <ul className="order-people">{people.map(m => {
      const order = meal.orders?.find(o => o.memberId === m.id)
      const usual = !readOnly ? usualFor(restaurant, m.id, meal) : null
      return <li key={m.id} className="order-person">
        <button type="button" className="order-row" disabled={readOnly} aria-label={`${m.name}’s order: ${order?.items.length ? itemsLabel(order.items) : 'nothing yet'}`} onClick={() => setPicking(m.id)}>
          <Face m={m} className="member-avatar-sm" aria-hidden="true" />
          <span><strong>{m.name}</strong><small>{order?.items.length ? itemsLabel(order.items) : 'Nothing yet'}{order?.note ? ` · ${order.note}` : ''}</small></span>
          {!readOnly && <span className="order-add" aria-hidden="true">{order?.items.length ? 'Change' : 'Add'}</span>}
        </button>
        {usual && <button type="button" className="chip order-usual" onClick={() => void save(m.id, usual, order?.note ?? null)}>↺ Usual: {itemsLabel(usual)}</button>}
      </li>
    })}</ul>
    {picking && person && <OrderPicker key={picking} name={person.name} restaurant={restaurant} current={meal.orders?.find(o => o.memberId === picking) ?? null} usual={usualFor(restaurant, picking, meal)}
      onClose={() => setPicking(null)} onSave={async (items, note) => { if (await save(picking, items, note)) setPicking(null) }} />}
  </Sheet>
}

/** One person's order: tap menu items to add them (favorites first), − / + for how many, something
 * that isn't on the menu, and a note. */
function OrderPicker({ name, restaurant, current, usual, onClose, onSave }: {
  name: string; restaurant: Restaurant | null; current: { items: OrderItem[]; note: string | null } | null; usual: OrderItem[] | null
  onClose: () => void; onSave: (items: OrderItem[], note: string | null) => Promise<void>
}) {
  const [items, setItems] = useState<OrderItem[]>(current?.items ?? [])
  const [note, setNote] = useState(current?.note ?? '')
  const [query, setQuery] = useState('')
  const [other, setOther] = useState('')
  const [busy, setBusy] = useState(false)
  const q = query.trim().toLocaleLowerCase()
  const menu = (restaurant?.menu ?? []).filter(i => !q || `${i.name} ${i.section ?? ''} ${i.description ?? ''}`.toLocaleLowerCase().includes(q))
  const add = (item: Pick<OrderItem, 'menuItemId' | 'name'>) => setItems(list => {
    const i = list.findIndex(x => x.name === item.name && !x.note)
    return i >= 0 ? list.map((x, n) => n === i ? { ...x, qty: Math.min(99, x.qty + 1) } : x) : [...list, { ...item, qty: 1, note: null }]
  })
  const set = (index: number, patch: Partial<OrderItem>) => setItems(list => list.map((x, n) => n === index ? { ...x, ...patch } : x).filter(x => x.qty > 0))
  const save = async () => { setBusy(true); await onSave(items, note.trim() || null); setBusy(false) }
  return <Sheet title={`${name}’s order`} onClose={onClose} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
    <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save order'}</button>
  </>}>
    {items.length ? <ul className="order-items">{items.map((item, i) => <li key={`${item.name}:${i}`}>
      <span className="order-item-name"><strong>{item.name}</strong>
        <input type="text" aria-label={`Note for ${item.name}`} placeholder="No onions…" maxLength={200} value={item.note ?? ''} onChange={e => set(i, { note: e.target.value || null })} /></span>
      <span className="order-qty" role="group" aria-label={`How many ${item.name}`}>
        <button type="button" className="icon-btn" aria-label={item.qty === 1 ? `Remove ${item.name}` : `One less ${item.name}`} onClick={() => set(i, { qty: item.qty - 1 })}><MinusIcon width={18} height={18} /></button>
        <span aria-live="polite">{item.qty}</span>
        <button type="button" className="icon-btn" aria-label={`One more ${item.name}`} disabled={item.qty >= 99} onClick={() => set(i, { qty: item.qty + 1 })}><PlusIcon width={18} height={18} /></button>
      </span>
    </li>)}</ul> : <p className="state-card">Tap what {name} wants.</p>}
    {usual && <button type="button" className="chip order-usual-pick" onClick={() => setItems(usual)}>↺ Same as last time: {itemsLabel(usual)}</button>}
    <div className="field"><label htmlFor="order-note">Note</label><input id="order-note" type="text" maxLength={1000} placeholder="I’ll share with Leo…" value={note} onChange={e => setNote(e.target.value)} /></div>
    {restaurant?.menu.length ? <>
      <div className="field"><label htmlFor="order-search">Find on the menu</label><input id="order-search" type="search" placeholder="Pizza, fries…" value={query} onChange={e => setQuery(e.target.value)} /></div>
      <MenuList menu={menu} onPick={(item: MenuItem) => add({ menuItemId: item.id, name: item.name })} />
    </> : null}
    <form className="order-other" onSubmit={e => { e.preventDefault(); if (other.trim()) { add({ menuItemId: null, name: other.trim() }); setOther('') } }}>
      <div className="field"><label htmlFor="order-other">Something else</label><input id="order-other" type="text" maxLength={200} placeholder={restaurant ? 'Not on the menu…' : 'What do you want?'} value={other} onChange={e => setOther(e.target.value)} /></div>
      <button type="submit" className="btn btn-secondary" disabled={!other.trim()}><PlusIcon /> Add</button>
    </form>
  </Sheet>
}

/** What an order night is: where (when the meal's name isn't the restaurant's), when, how, and its
 * notes (left off on a calendar event, whose own Notes already show them). */
export function OrderNightFacts({ meal, restaurant, notes = true }: { meal: Meal; restaurant: Restaurant | null; notes?: boolean }) {
  const { settings } = useApp()
  const time = meal.plannedTime ?? settings.mealTimes[meal.slot]
  return <div className="order-night-facts">
    {restaurant && restaurant.name !== meal.title && <p className="order-night-place">{restaurant.name}</p>}
    {restaurant?.cuisine && <p className="field-hint">{restaurant.cuisine}</p>}
    <div className="chip-row">
      <span className="chip chip-static"><span aria-hidden="true">📅</span> {mealDayLabel(meal.date, { weekday: 'long', month: 'short', day: 'numeric' })}, {SLOT_LABEL[meal.slot].toLowerCase()}{time ? ` at ${formatTime(time)}` : ''}</span>
      <span className="chip chip-static"><span aria-hidden="true">{meal.orderType ? ORDER_TYPE_ICON[meal.orderType] : '❔'}</span> {meal.orderType ? ORDER_TYPE_LABEL[meal.orderType] : 'How we’re getting it isn’t set yet'}</span>
    </div>
    {notes && meal.notes && <p className="meal-prose">{meal.notes}</p>}
  </div>
}

/** Tapping an order night (planner, Board, a person's day): the restaurant, when and how, and the
 * orders front and center. Edit meal (parents) opens the full meal form. */
export function OrderNightSheet({ meal, me, startOrders = false, onClose, onChanged, onEdit }: {
  meal: Meal; me: Me | null; startOrders?: boolean; onClose: () => void; onChanged: (meal: Meal) => void; onEdit?: () => void
}) {
  const [ordering, setOrdering] = useState(false)
  // A link from "Ask for orders" opens the order sheet over this one.
  useEffect(() => { if (startOrders) setOrdering(true) }, [startOrders])
  const restaurant = useMealRestaurant(meal)
  return <Sheet title={meal.title} onClose={onClose} actions={<>
    {onEdit && <button type="button" className="btn btn-secondary" onClick={onEdit}><EditIcon width={20} height={20} /> Edit meal</button>}
    <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
  </>}>
    <OrderNightFacts meal={meal} restaurant={restaurant} />
    <OrderSummary meal={meal} restaurant={restaurant} me={me} onChanged={onChanged} onOrder={() => setOrdering(true)} />
    <p className="field-hint">Eating out doesn’t add anything to the grocery list.</p>
    {ordering && <OrderSheet meal={meal} restaurant={restaurant} me={me} onClose={() => setOrdering(false)} onSaved={onChanged} />}
  </Sheet>
}
