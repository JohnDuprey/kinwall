import { useEffect, useRef, useState } from 'react'
import { announce } from './a11y.tsx'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import { Face } from './Face'
import { CartIcon, CheckIcon, EditIcon, MinusIcon, PhoneIcon, PlusIcon } from './icons.tsx'
import { MenuList } from './Restaurants.tsx'
import { hasAddon, itemsLabel, orderLines, orderPeople, ordersLabel, orderText, ORDER_TYPE_LABEL, ORDER_TYPE_ICON, ownOrderer, toggleAddon, usualFor, waitingOn } from './orders.ts'
import { addonsFor, optionName, telHref } from './restaurants.ts'
import { useDialog } from './dialog.tsx'
import type { Meal, MenuItem, OrderItem, Restaurant } from './meal-types.ts'
import type { Me } from './types.ts'
import { SLOT_WORD, mealDayLabel } from './meal-date.ts'
import { intlLocale, t, tm, tn } from './i18n.ts'
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
  const own = ownOrderer(me) // a kid's own device: their order, not the grown-ups' calling tools
  const orders = meal.orders ?? []
  const lines = orderLines(orders, members)
  const notes = orders.filter(o => o.note)
  const tel = telHref(restaurant?.phone ?? null)
  const ordered = meal.status !== 'planned'
  const waiting = ordered ? [] : waitingOn(meal, members)
  const dialog = useDialog()
  const run = async (work: () => Promise<Meal | void>, done: string, undo?: () => void) => {
    setBusy(true)
    try { const saved = await work(); toast(done, false, undo && { label: t('Undo'), run: undo }); if (saved) onChanged(saved) } catch (e) { toast(e instanceof Error ? e.message : t('Could not save.'), true) } finally { setBusy(false) }
  }
  const names = new Intl.ListFormat(intlLocale()).format(waiting.map(m => m.name))
  // Only who hasn't ordered gets the notification (the server skips the rest too).
  const ask = async () => {
    if (!await dialog.confirm({ title: waiting.length ? tn(waiting.length, 'Ask {names} for an order?', 'Ask {names} for their orders?', { names }) : t('Ask everyone who hasn’t ordered yet?'), body: t('They get a notification that opens the order sheet.'), confirmLabel: t('Ask') })) return
    void run(async () => { await api.askForOrders(meal.id) }, t('Asked for orders'))
  }
  const reopen = () => void run(() => api.updateMeal(meal.id, { status: 'planned' }), t('Orders open again'))
  const copy = async () => {
    try { await navigator.clipboard.writeText(orderText(meal, members)); toast(t('Order copied')) } catch { toast(t('Could not copy the order.'), true) }
  }
  const actions = <div className="meal-actions">
    {(!locked(meal, me) || admin) && <button type="button" className={own && !ordered ? 'btn btn-primary' : 'btn btn-secondary'} disabled={busy} onClick={onOrder}>{own ? (orders.some(o => o.memberId === own) ? t('Change my order') : t('Add my order')) : lines.length ? t('Change orders') : t('Add orders')}</button>}
    {admin && !ordered && (waiting.length > 0 || !meal.eaterIds.length) && <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void ask()}>{t('Ask for orders')}</button>}
    {admin && <button type="button" className={ordered ? 'btn btn-secondary' : 'btn btn-primary'} disabled={busy} onClick={() => ordered ? reopen() : void run(() => api.updateMeal(meal.id, { status: 'prepared' }), t('Marked ordered'), reopen)}>{ordered ? t('Open orders again') : t('Mark ordered')}</button>}
  </div>
  return <section className="order-summary" aria-label={t('Orders')}>
    <div className="order-head">
      <h3>{t('Orders')}</h3>
      <span className="chip chip-static">{ordered ? `✓ ${t('Ordered')}` : ordersLabel(meal)}</span>
    </div>
    {waiting.length > 0 && <p className="order-waiting">{t('Still waiting on {names}.', { names })}</p>}
    {/* A kid's own device: their button first, then everyone's order to look at. */}
    {own && actions}
    {!own && (tel || lines.length > 0 || restaurant?.orderUrl) && <div className="restaurant-actions">
      {tel && <a className="btn btn-primary" href={tel}><PhoneIcon /> {t('Call {name}', { name: restaurant!.name })}</a>}
      {restaurant?.orderUrl && <a className="btn btn-secondary" href={restaurant.orderUrl} target="_blank" rel="noopener noreferrer"><CartIcon /> {t('Order online')}</a>}
      {lines.length > 0 && <button type="button" className="btn btn-secondary" onClick={() => void copy()}>{t('Copy order')}</button>}
    </div>}
    {lines.length > 0 && !own && <p className="field-hint">{t('Tick each one off as you order it.')}</p>}
    {lines.length ? <ul className="order-lines">{lines.map(l => {
      const on = ticked.has(l.key)
      const text = <span><strong>{l.qty} × {l.name}</strong>{l.note && <span className="order-line-note">{l.note}</span>}<small>{l.who.join(', ')}</small></span>
      if (own) return <li key={l.key} className="order-static">{text}</li>
      return <li key={l.key}><button type="button" className="order-tick" aria-pressed={on} onClick={() => setTicked(prev => { const next = new Set(prev); if (!next.delete(l.key)) next.add(l.key); return next })}>
        <span className="order-box" aria-hidden="true">{on && <CheckIcon width={18} height={18} />}</span>
        {text}
      </button></li>
    })}</ul> : <p className="field-hint">{t('No orders yet.')}</p>}
    {notes.length > 0 && <ul className="order-notes">{notes.map(o => <li key={o.memberId}><strong>{members.find(m => m.id === o.memberId)?.name ?? t('Someone')}:</strong> {o.note}</li>)}</ul>}
    {!own && actions}
    {ordered && !admin && <p className="field-hint">{t('It’s ordered. Ask a grown-up to change an order.')}</p>}
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
    try { const saved = await api.setMealOrder(meal.id, memberId, { items, note }); setMeal(saved); onSaved(saved); toast(items.length || note ? t('Saved {name}’s order', { name: members.find(m => m.id === memberId)?.name ?? '' }) : t('Order cleared')); return true }
    catch (e) { toast(e instanceof Error ? e.message : t('Could not save the order.'), true); return false }
  }
  const person = members.find(m => m.id === picking)
  return <Sheet title={t('Orders: {title}', { title: meal.title })} onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>{t('Done')}</button>}>
    <p className="field-hint">{meal.orderType ? `${tm(ORDER_TYPE_LABEL[meal.orderType])}. ` : ''}{ordersLabel(meal)}. {readOnly ? t('It’s ordered, so ask a grown-up to change an order.') : !own ? t('Tap a person to add their order.') : ''}</p>
    <ul className="order-people">{people.map(m => {
      const order = meal.orders?.find(o => o.memberId === m.id)
      const usual = !readOnly ? usualFor(restaurant, m.id, meal) : null
      return <li key={m.id} className="order-person">
        <button type="button" className="order-row" disabled={readOnly} aria-label={t('{name}’s order: {items}', { name: m.name, items: order?.items.length ? itemsLabel(order.items) : t('nothing yet') })} onClick={() => setPicking(m.id)}>
          <Face m={m} className="member-avatar-sm" aria-hidden="true" />
          <span><strong>{m.name}</strong><small>{order?.items.length ? itemsLabel(order.items) : t('Nothing yet')}</small>{order?.note && <small>{t('Note: {note}', { note: order.note })}</small>}</span>
          {!readOnly && <span className="order-add" aria-hidden="true">{order?.items.length ? t('Change') : t('Add')}</span>}
        </button>
        {usual && <button type="button" className="chip order-usual" onClick={() => void save(m.id, usual, order?.note ?? null)}>↺ {t('Usual: {items}', { items: itemsLabel(usual) })}</button>}
      </li>
    })}</ul>
    {/* A kid's own device came for their order only: closing it goes straight back to the night. */}
    {picking && person && <OrderPicker key={picking} name={person.name} restaurant={restaurant} current={meal.orders?.find(o => o.memberId === picking) ?? null} usual={usualFor(restaurant, picking, meal)}
      onClose={() => own ? onClose() : setPicking(null)} onSave={async (items, note) => { if (await save(picking, items, note)) { if (own) onClose(); else setPicking(null) } }} />}
  </Sheet>
}

/** One person's order: what's in it so far (− / + for how many, a note and add-ons for each), the
 * whole order's note, then the menu to tap (favorites first, a jump row, sizes as their own buttons,
 * a search that stays on top) and something that isn't on the menu. Leaving with changes asks first. */
function OrderPicker({ name, restaurant, current, usual, onClose, onSave }: {
  name: string; restaurant: Restaurant | null; current: { items: OrderItem[]; note: string | null } | null; usual: OrderItem[] | null
  onClose: () => void; onSave: (items: OrderItem[], note: string | null) => Promise<void>
}) {
  const dialog = useDialog()
  const top = useRef<HTMLUListElement>(null)
  const [items, setItems] = useState<OrderItem[]>(current?.items ?? [])
  const [note, setNote] = useState(current?.note ?? '')
  const [query, setQuery] = useState('')
  const [other, setOther] = useState('')
  const [busy, setBusy] = useState(false)
  const fullMenu = restaurant?.menu ?? []
  const q = query.trim().toLocaleLowerCase()
  const menu = fullMenu.filter(i => !q || `${i.name} ${i.section ?? ''} ${i.description ?? ''}`.toLocaleLowerCase().includes(q))
  const counts = new Map<string, number>()
  for (const i of items) counts.set(i.name, (counts.get(i.name) ?? 0) + i.qty)
  const add = (item: Pick<OrderItem, 'menuItemId' | 'name'>) => {
    setItems(list => {
      const i = list.findIndex(x => x.name === item.name && !x.note)
      return i >= 0 ? list.map((x, n) => n === i ? { ...x, qty: Math.min(99, x.qty + 1) } : x) : [...list, { ...item, qty: 1, note: null }]
    })
    announce(t('Added: {name}', { name: item.name })) // the order line on top of the menu shows it
  }
  const count = items.reduce((n, i) => n + i.qty, 0)
  const set = (index: number, patch: Partial<OrderItem>) => setItems(list => list.map((x, n) => n === index ? { ...x, ...patch } : x).filter(x => x.qty > 0))
  const save = async () => { setBusy(true); await onSave(items, note.trim() || null); setBusy(false) }
  const changed = JSON.stringify([items, note.trim()]) !== JSON.stringify([current?.items ?? [], current?.note ?? ''])
  const close = async () => {
    if (busy) return
    if (changed && !await dialog.confirm({ title: t('Leave without saving {name}’s order?', { name }), body: t('What you changed here won’t be kept.'), confirmLabel: t('Leave without saving'), cancelLabel: t('Keep editing') })) return
    onClose()
  }
  const addOther = (text: string) => { if (text.trim()) add({ menuItemId: null, name: text.trim() }) }
  return <Sheet title={t('{name}’s order', { name })} onClose={() => void close()} dismissable={!busy} actions={<>
    <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? t('Saving…') : t('Save')}</button>
  </>}>
    {items.length ? <ul ref={top} className="order-items" aria-label={t('In {name}’s order', { name })}>{items.map((item, i) => {
      const extras = addonsFor(fullMenu, fullMenu.find(m => m.id === item.menuItemId))
      return <li key={`${item.name}:${i}`}>
        <div className="order-item-row">
          <strong className="order-item-name">{item.name}</strong>
          <span className="order-qty" role="group" aria-label={t('How many {name}', { name: item.name })}>
            <button type="button" className="icon-btn" aria-label={item.qty === 1 ? t('Remove {name}', { name: item.name }) : t('One less {name}', { name: item.name })} onClick={() => set(i, { qty: item.qty - 1 })}><MinusIcon width={18} height={18} /></button>
            <span aria-live="polite">{item.qty}</span>
            <button type="button" className="icon-btn" aria-label={t('One more {name}', { name: item.name })} disabled={item.qty >= 99} onClick={() => set(i, { qty: item.qty + 1 })}><PlusIcon width={18} height={18} /></button>
          </span>
        </div>
        <input type="text" className="order-item-note" aria-label={t('Note for {name}', { name: item.name })} placeholder={t('Note for this item: no onions…')} maxLength={200} value={item.note ?? ''} onChange={e => set(i, { note: e.target.value || null })} />
        {extras.length > 0 && <details className="order-addons">
          <summary>{t('+ Add-ons for {name}', { name: item.name })}</summary>
          <div className="chip-row">{extras.map(a => <button key={a.id} type="button" className={`chip${hasAddon(item.note, a.name) ? ' active' : ''}`} aria-pressed={hasAddon(item.note, a.name)} onClick={() => set(i, { note: toggleAddon(item.note, a.name) })}>+ {a.name}</button>)}</div>
        </details>}
      </li>
    })}</ul> : <p className="field-hint order-empty">{t('Nothing in {name}’s order yet.', { name })} {fullMenu.length ? t('Pick from the menu below, or add something else.') : t('Add what they’d like below.')}</p>}
    {usual && <button type="button" className="chip order-usual-pick" onClick={() => setItems(usual)}>↺ {t('Same as last time: {items}', { items: itemsLabel(usual) })}</button>}
    <div className="field"><label htmlFor="order-note">{t('Note for the whole order')}</label><input id="order-note" type="text" maxLength={1000} placeholder={t('I’ll share with Leo…')} value={note} onChange={e => setNote(e.target.value)} /></div>
    {fullMenu.length ? <>
      {/* Typing brings the box to the top so the matches show under it (a phone on its side has room for little else). */}
      <div className="field order-search">
        {/* The order so far stays in view while you pick; Review goes back up to change how many, notes and add-ons. */}
        {count > 0 && <button type="button" className="order-so-far" onClick={() => top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })}>
          <span>{tn(count, '{n} item: {items}', '{n} items: {items}', { items: itemsLabel(items) })}</span><strong>{t('Review')}</strong>
        </button>}
        <label htmlFor="order-search">{t('Find on the menu')}</label><input id="order-search" type="search" placeholder={t('Pizza, fries…')} value={query} onChange={e => { setQuery(e.target.value); e.target.parentElement!.scrollIntoView({ block: 'start' }) }} /></div>
      {q && !menu.length && <div className="state-card">
        <p>{t('Nothing on the menu matches “{query}”.', { query: query.trim() })}</p>
        <button type="button" className="btn btn-secondary" onClick={() => { addOther(query); setQuery('') }}><PlusIcon /> {t('Add “{name}” anyway', { name: query.trim() })}</button>
      </div>}
      <MenuList menu={menu} counts={counts} onPick={(item: MenuItem, option?: string) => add({ menuItemId: item.id, name: option ? optionName(item.name, option) : item.name })} />
    </> : null}
    <form className="order-other" onSubmit={e => { e.preventDefault(); addOther(other); setOther('') }}>
      <div className="field"><label htmlFor="order-other">{t('Something else')}</label><input id="order-other" type="text" maxLength={200} placeholder={restaurant ? t('Not on the menu…') : t('What do you want?')} value={other} onChange={e => setOther(e.target.value)} /></div>
      <button type="submit" className="btn btn-secondary" disabled={!other.trim()}><PlusIcon /> {t('Add')}</button>
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
      <span className="chip chip-static"><span aria-hidden="true">📅</span> {time ? t('{day}, {meal} at {time}', { day: mealDayLabel(meal.date, { weekday: 'long', month: 'short', day: 'numeric' }), meal: tm(SLOT_WORD[meal.slot]), time: formatTime(time) }) : t('{day}, {meal}', { day: mealDayLabel(meal.date, { weekday: 'long', month: 'short', day: 'numeric' }), meal: tm(SLOT_WORD[meal.slot]) })}</span>
      <span className="chip chip-static"><span aria-hidden="true">{meal.orderType ? ORDER_TYPE_ICON[meal.orderType] : '❔'}</span> {meal.orderType ? tm(ORDER_TYPE_LABEL[meal.orderType]) : t('How we’re getting it isn’t set yet')}</span>
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
    {onEdit && <button type="button" className="btn btn-secondary" onClick={onEdit}><EditIcon width={20} height={20} /> {t('Edit meal')}</button>}
    <button type="button" className="btn btn-primary" onClick={onClose}>{t('Done')}</button>
  </>}>
    <OrderNightFacts meal={meal} restaurant={restaurant} />
    <OrderSummary meal={meal} restaurant={restaurant} me={me} onChanged={onChanged} onOrder={() => setOrdering(true)} />
    <p className="field-hint">{t('Eating out doesn’t add anything to the grocery list.')}</p>
    {ordering && <OrderSheet meal={meal} restaurant={restaurant} me={me} onClose={() => setOrdering(false)} onSaved={onChanged} />}
  </Sheet>
}
