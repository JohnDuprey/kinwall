import { useId, useState, type ReactNode } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { CalendarIcon, CartIcon, ChevronRight, LinkIcon, LocationIcon, PhoneIcon, PlusIcon } from './icons.tsx'
import { EaterAvatars } from './MealSheet.tsx'
import { SLOT_WORD, mealDayLabel } from './meal-date.ts'
import { t, tm, tn } from './i18n.ts'
import { formatTime } from './timeFormat.ts'
import { ORDER_TYPE_LABEL, ordersInLabel } from './orders.ts'
import { mapHref, menuOptions, menuSections, optionName, parsePrice, priceLabel, telHref } from './restaurants.ts'
import { LoadError, reducedMotion } from './a11y.tsx'
import type { MenuItem, MenuItemInput, Restaurant, RestaurantInput } from './meal-types.ts'

/** The Restaurants tab in Meals: the binder, searchable, read-only for walls and kids. */
export function RestaurantBinder({ restaurants, loaded, error, onRetry, onOpen }: {
  restaurants: Restaurant[]; loaded: boolean; error: string; onRetry: () => void; onOpen: (r: Restaurant) => void
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('active')
  const q = search.trim().toLocaleLowerCase()
  const shown = restaurants.filter(r => (filter === 'all' || r.archived === (filter === 'archived'))
    && (!q || [r.name, r.cuisine ?? '', ...r.menu.map(i => i.name)].some(s => s.toLocaleLowerCase().includes(q))))
  return <section role="tabpanel" aria-labelledby="meals-tab-restaurants">
    <div className="meals-toolbar">
      <div className="field meals-search"><label htmlFor="restaurant-search">{t('Find a restaurant')}</label><input id="restaurant-search" type="search" placeholder={t('Pizza, lo mein…')} value={search} onChange={e => setSearch(e.target.value)} /></div>
      <div className="field"><label htmlFor="restaurant-filter">{t('Show')}</label><select id="restaurant-filter" value={filter} onChange={e => setFilter(e.target.value)}><option value="active">{t('Restaurants')}</option><option value="archived">{t('Archived')}</option><option value="all">{t('All')}</option></select></div>
    </div>
    {error && <LoadError what="restaurants" error={error} onRetry={onRetry} />}
    {!loaded && !error ? <p role="status">{t('Loading restaurants…')}</p> : <>
      <p className="field-hint" role="status">{tn(shown.length, '{n} restaurant', '{n} restaurants')}</p>
      {!shown.length && !error && <p className="state-card">{q || filter !== 'active' ? t('No restaurants match.') : t('Keep your takeout menus here: the places you order from, what everyone likes and how to call.')}</p>}
      <div className="recipe-library">{shown.map(r => {
        const stars = r.menu.filter(i => i.favorite).length
        return <button key={r.id} className="recipe-card restaurant-card" onClick={() => onOpen(r)}>
          <strong>{r.name}</strong>
          <span>{[r.cuisine, tn(r.menu.length, '{n} item', '{n} items'), r.archived && t('Archived')].filter(Boolean).join(' · ')}</span>
          {stars > 0 && <span className="restaurant-stars">★ {tn(stars, '{n} favorite', '{n} favorites')}</span>}
        </button>
      })}</div>
    </>}
  </section>
}

/** One place: one-tap Call / Order online / Website / Map, favorites pinned over the menu, notes. */
export function RestaurantSheet({ restaurant, admin, onClose, onEdit, onSaved, onPlan, onOpenMeal }: {
  restaurant: Restaurant; admin: boolean; onClose: () => void; onEdit: () => void; onSaved: (r: Restaurant | null) => void
  onPlan?: (r: Restaurant) => void; onOpenMeal?: (mealId: string, date: string) => void
}) {
  const { toast, members } = useApp()
  // Who had each item last time (their latest order here): avatars beside it, a second signal next to the star.
  const lastBy = new Map<string, string[]>()
  for (const o of restaurant.lastOrders ?? []) for (const i of o.items) if (i.menuItemId) lastBy.set(i.menuItemId, [...(lastBy.get(i.menuItemId) ?? []), o.memberId])
  const dialog = useDialog()
  const [busy, setBusy] = useState(false)
  const tel = telHref(restaurant.phone)
  const run = async (work: () => Promise<Restaurant | null>, done: string) => {
    setBusy(true)
    try { const saved = await work(); toast(done); onSaved(saved) } catch (e) { toast(e instanceof Error ? e.message : t('Could not save.'), true) } finally { setBusy(false) }
  }
  const star = (item: MenuItem) => run(() => api.updateRestaurant(restaurant.id, { menu: restaurant.menu.map(i => i.id === item.id ? { ...i, favorite: !i.favorite } : i) }), item.favorite ? t('Unstarred: {name}', { name: item.name }) : t('Starred: {name}', { name: item.name }))
  const remove = async () => {
    if (!await dialog.confirm({ title: t('Delete “{title}”?', { title: restaurant.name }), body: t('This removes it and its menu from the binder. Archive it instead to keep it.'), confirmLabel: t('Delete restaurant'), danger: true })) return
    void run(async () => { await api.deleteRestaurant(restaurant.id); return null }, t('Restaurant deleted'))
  }
  return <Sheet title={restaurant.name} onClose={onClose} actions={admin ? <>
    <select className="settings-select actions-select" aria-label={t('Restaurant actions')} value="" disabled={busy} onChange={e => {
      if (e.target.value === 'archive') void run(() => api.updateRestaurant(restaurant.id, { archived: !restaurant.archived }), restaurant.archived ? t('Restaurant restored') : t('Restaurant archived'))
      if (e.target.value === 'delete') void remove()
    }}>
      <option value="" disabled hidden>{t('More…')}</option>
      <option value="archive">{restaurant.archived ? t('Restore restaurant') : t('Archive restaurant')}</option>
      <option value="delete">{t('Delete restaurant…')}</option>
    </select>
    <button className="btn btn-primary" disabled={busy} onClick={onEdit}>{t('Edit')}</button>
  </> : undefined}>
    {(restaurant.cuisine || restaurant.archived) && <p className="field-hint">{[restaurant.cuisine, restaurant.archived && t('Archived')].filter(Boolean).join(' · ')}</p>}
    <div className="restaurant-actions">
      {tel && <a className="btn btn-primary" href={tel}><PhoneIcon /> {t('Call')}</a>}
      {restaurant.orderUrl && <a className="btn btn-secondary" href={restaurant.orderUrl} target="_blank" rel="noopener noreferrer"><CartIcon /> {t('Order online')}</a>}
      {restaurant.website && <a className="btn btn-secondary" href={restaurant.website} target="_blank" rel="noopener noreferrer"><LinkIcon /> {t('Website')}</a>}
      {restaurant.address && <a className="btn btn-secondary" href={mapHref(restaurant.address)} target="_blank" rel="noopener noreferrer"><LocationIcon /> {t('Map')}</a>}
    </div>
    {(restaurant.phone || restaurant.address) && <p className="field-hint">{[restaurant.phone, restaurant.address].filter(Boolean).join(' · ')}</p>}
    {restaurant.menuUrl && <p><a href={restaurant.menuUrl} target="_blank" rel="noopener noreferrer">{t('Their menu')}</a></p>}
    {(!!restaurant.upcoming?.length || (admin && onPlan && !restaurant.archived)) && <section className="restaurant-section" aria-label={t('Coming up')}>
      {!!restaurant.upcoming?.length && <h3>{t('Coming up')}</h3>}
      <div className="sheet-links">
        {restaurant.upcoming?.map(u => <button key={u.mealId} type="button" className="sheet-link" onClick={() => onOpenMeal?.(u.mealId, u.date)}>
          <CalendarIcon /><span>{t('{day} {meal}', { day: mealDayLabel(u.date, { weekday: 'long' }), meal: tm(SLOT_WORD[u.slot]) })}{u.plannedTime ? ` · ${formatTime(u.plannedTime)}` : ''}
            <small>{[u.orderType && tm(ORDER_TYPE_LABEL[u.orderType]), u.status === 'planned' ? ordersInLabel(u.orderCount, u.eaterIds.length) : `✓ ${t('Ordered')}`].filter(Boolean).join(' · ')}</small></span>
          <EaterAvatars ids={u.eaterIds} members={members} /><ChevronRight />
        </button>)}
        {admin && onPlan && !restaurant.archived && <button type="button" className="sheet-link" onClick={() => onPlan(restaurant)}><PlusIcon /><span>{t('Plan a night here')}</span><ChevronRight /></button>}
      </div>
    </section>}
    <MenuList menu={restaurant.menu} onStar={admin && !busy ? item => void star(item) : undefined} lastBy={lastBy} />
    {!restaurant.menu.length && <p className="state-card">{admin ? t('No menu yet. Edit to add items or paste the menu.') : t('No menu yet.')}</p>}
    {restaurant.notes && <section className="restaurant-section"><h3>{t('Notes')}</h3><p className="meal-prose">{restaurant.notes}</p></section>}
  </Sheet>
}

/** The menu by section, favorites first, with a row of section buttons to jump to on a long menu.
 * With onStar (parents) each item's star is a button. With onPick (the order picker) each item adds
 * to the order, an item with sizes or choices one button per option, and `counts` (by order item
 * name) shows what's in the order already. */
export function MenuList({ menu, onStar, onPick, lastBy, counts }: {
  menu: MenuItem[]; onStar?: (item: MenuItem) => void; onPick?: (item: MenuItem, option?: string) => void; lastBy?: Map<string, string[]>; counts?: Map<string, number>
}) {
  const { members } = useApp()
  const id = useId()
  const sections = menuSections(menu)
  const anchor = (i: number) => `${id}-s${i}`
  const added = (n: number | undefined) => n ? <span className="menu-count">✓ {t('{n} added', { n })}</span> : null
  return <>
    {sections.length > 4 && <nav className="chip-row menu-jump" aria-label={t('Menu sections')}>{sections.map((section, i) =>
      <button key={i} type="button" className="chip" onClick={() => document.getElementById(anchor(i))?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' })}>{section.favorites ? `★ ${t('Favorites')}` : section.title ?? t('More')}</button>)}
    </nav>}
    {sections.map((section, i) => <section key={section.favorites ? '★' : section.title ?? ''} id={anchor(i)} className="restaurant-section">
      {(section.title || sections.length > 1) && <h3>{section.favorites ? `★ ${t('Favorites')}` : section.title ?? t('More')}</h3>}
      <ul className="menu-list">{section.items.map(item => {
        const { options, rest } = menuOptions(item.description)
        return <li key={item.id} className="menu-item">
          {onPick && options.length ? <div className="menu-text">
            <span className="menu-name"><strong>{item.name}</strong></span>
            {rest && <small>{rest}</small>}
            <span className="chip-row menu-options">{options.map(o => {
              const n = counts?.get(optionName(item.name, o.label))
              return <button key={o.label} type="button" className="chip menu-option" aria-label={`${t('Add {name}', { name: optionName(item.name, o.label) })}, ${priceLabel(o.cents)}${n ? `, ${t('{n} added', { n })}` : ''}`} onClick={() => onPick(item, o.label)}>
                <PlusIcon width={16} height={16} aria-hidden="true" />{o.label} <span className="menu-price">{priceLabel(o.cents)}</span>{n ? <span className="menu-count">✓ {n}</span> : null}
              </button>
            })}</span>
          </div>
            : onPick ? <button type="button" className="menu-pick" aria-label={`${t('Add {name}', { name: item.name })}${item.priceCents !== null ? `, ${priceLabel(item.priceCents)}` : ''}${counts?.get(item.name) ? `, ${t('{n} added', { n: counts.get(item.name)! })}` : ''}`} onClick={() => onPick(item)}><MenuText item={item} extra={added(counts?.get(item.name))} /></button>
            : <MenuText item={item} options={options.length > 0} />}
          {section.favorites && !!lastBy?.get(item.id)?.length && <span className="menu-who"><EaterAvatars ids={lastBy.get(item.id)!} members={members} label={t('Had it last time')} /></span>}
          {onStar ? <button type="button" className="icon-btn menu-star" aria-pressed={item.favorite} aria-label={t('Favorite: {name}', { name: item.name })} onClick={() => onStar(item)}>{item.favorite ? '★' : '☆'}</button>
            : item.favorite && !section.favorites && !onPick && <span className="menu-star" role="img" aria-label={t('Favorite')}>★</span>}
        </li>
      })}</ul>
    </section>)}
  </>
}
/** An item as it reads on the menu. With options its one price is only the first option's, so it's
 * left off: the description starts with all of them. */
function MenuText({ item, options = false, extra }: { item: MenuItem; options?: boolean; extra?: ReactNode }) {
  const price = options ? null : priceLabel(item.priceCents)
  return <span className="menu-text"><span className="menu-name"><strong>{item.name}</strong>{price && <span className="menu-price">{price}</span>}</span>{item.description && <small>{item.description}</small>}{extra}</span>
}

type Row = { key: string; id?: string; section: string; name: string; price: string; description: string; favorite: boolean }
const toRow = (i: MenuItemInput): Row => ({ key: crypto.randomUUID(), id: i.id, section: i.section ?? '', name: i.name, price: i.priceCents === null ? '' : (i.priceCents / 100).toFixed(2), description: i.description ?? '', favorite: i.favorite })

/** Adding or editing a place (parents): details, then menu items one at a time or pasted as text. */
export function RestaurantEditSheet({ restaurant, onClose, onSaved }: { restaurant: Restaurant | null; onClose: () => void; onSaved: (r: Restaurant) => void }) {
  const { toast } = useApp()
  const formId = useId()
  const [draft, setDraft] = useState<Omit<RestaurantInput, 'menu' | 'archived'>>(() => ({ name: restaurant?.name ?? '', cuisine: restaurant?.cuisine ?? null, phone: restaurant?.phone ?? null, address: restaurant?.address ?? null, website: restaurant?.website ?? null, orderUrl: restaurant?.orderUrl ?? null, menuUrl: restaurant?.menuUrl ?? null, notes: restaurant?.notes ?? null }))
  const [rows, setRows] = useState<Row[]>(() => restaurant?.menu.map(toRow) ?? [])
  const [paste, setPaste] = useState('')
  const [reading, setReading] = useState(false)
  const [filling, setFilling] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof typeof draft>(key: K, value: string) => setDraft(d => ({ ...d, [key]: value.trim() ? value : null }))
  const row = (key: string, patch: Partial<Row>) => setRows(rs => rs.map(r => r.key === key ? { ...r, ...patch } : r))
  const lastSection = rows.at(-1)?.section ?? ''
  const readPaste = async () => {
    setReading(true); setError('')
    try {
      const { items } = await api.parseMenuText(paste)
      if (!items.length) { setError(t('No menu items found in that text.')); return }
      setRows(rs => [...rs, ...items.map(i => toRow({ ...i, favorite: false }))]); setPaste('')
      toast(tn(items.length, 'Added {n} item: check them, then save', 'Added {n} items: check them, then save'))
    } catch (e) { setError(e instanceof Error ? e.message : t('Could not read the menu.')) } finally { setReading(false) }
  }
  const fillIn = async () => {
    setFilling(true); setError('')
    try {
      const { details } = await api.restaurantDetails(draft.website!)
      const found = (['name', 'cuisine', 'phone', 'address', 'menuUrl'] as const).filter(k => details[k])
      const keys = found.filter(k => !draft[k]?.trim())
      if (!keys.length) { setError(found.length ? t('Everything that page has is already filled in.') : t('No restaurant details found on that page. Fill them in by hand.')); return }
      setDraft(d => ({ ...d, ...Object.fromEntries(keys.map(k => [k, details[k]])) }))
      const word = { name: t('name'), cuisine: t('cuisine'), phone: t('phone'), address: t('address'), menuUrl: t('menu link') }
      const names = keys.map(k => word[k])
      toast(t('Filled in {fields}: check, then save', { fields: names.length > 1 ? t('{list} and {last}', { list: names.slice(0, -1).join(', '), last: names.at(-1)! }) : names[0] }))
    } catch (e) { setError(e instanceof Error ? e.message : t('Could not read that page.')) } finally { setFilling(false) }
  }
  const save = async () => {
    const menu = rows.map(r => ({ id: r.id, section: r.section.trim() || null, name: r.name.trim(), description: r.description.trim() || null, priceCents: parsePrice(r.price), favorite: r.favorite }))
    if (!draft.name.trim() || menu.some(i => !i.name)) { setError(t('Give the restaurant and each menu item a name.')); return }
    const bad = menu.find(i => i.priceCents === undefined)
    if (bad) { setError(t('Check the price of {name}: a number like 12.99.', { name: bad.name })); return }
    setBusy(true); setError('')
    try {
      const body = { ...draft, name: draft.name.trim(), menu: menu.map(i => ({ ...i, priceCents: i.priceCents ?? null })) }
      const saved = restaurant ? await api.updateRestaurant(restaurant.id, body) : await api.createRestaurant({ ...body, archived: false })
      toast(t('Saved: {name}', { name: saved.name })); onSaved(saved)
    } catch (e) { setError(e instanceof Error ? e.message : t('Could not save the restaurant.')) } finally { setBusy(false) }
  }
  const field = (key: keyof typeof draft, label: string, type = 'text', extra: Record<string, string> = {}) =>
    <div className="field"><label htmlFor={`${formId}-${key}`}>{label}</label><input id={`${formId}-${key}`} type={type} maxLength={type === 'url' ? 2000 : 500} {...(type === 'url' ? { pattern: 'https?://.*', placeholder: 'https://…' } : {})} {...extra} value={draft[key] ?? ''} onChange={e => set(key, e.target.value)} /></div>
  const close = () => { if (!busy) onClose() }
  return <Sheet title={restaurant ? t('Edit {name}', { name: restaurant.name }) : t('New restaurant')} onClose={close} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={close}>{t('Cancel')}</button>
    <button className="btn btn-primary" type="submit" form={formId} disabled={busy}>{busy ? t('Saving…') : restaurant ? t('Save') : t('Add restaurant')}</button>
  </>}>
    <form id={formId} onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="field"><label htmlFor={`${formId}-name`}>{t('Name')}</label><input id={`${formId}-name`} type="text" required maxLength={200} value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} /></div>
        <div className="meal-form-row">{field('cuisine', t('Cuisine'), 'text', { placeholder: t('Pizza, Thai…') })}{field('phone', t('Phone'), 'tel', { autoComplete: 'off' })}</div>
        {field('address', t('Address'), 'text', { placeholder: t('For the Map button') })}
        {field('orderUrl', t('Online ordering link'), 'url')}
        <div className="meal-form-row">{field('website', t('Website'), 'url')}{field('menuUrl', t('Menu link'), 'url')}</div>
        <div className="field">
          <button type="button" className="btn btn-secondary" disabled={!draft.website?.trim() || filling} onClick={() => void fillIn()}><LinkIcon /> {filling ? t('Reading…') : t('Fill in from website')}</button>
          <p className="field-hint">{t('Fills empty details from the website for you to check. Nothing is saved until you save.')}</p>
        </div>
        <div className="field"><label htmlFor={`${formId}-notes`}>{t('Notes')}</label><textarea id={`${formId}-notes`} maxLength={10000} placeholder={t('Cash only, ask for extra sauce…')} value={draft.notes ?? ''} onChange={e => set('notes', e.target.value)} /></div>
        <h3>{t('Menu')}</h3>
        {rows.map((r, index) => <fieldset key={r.key} className="recipe-ingredient">
          <legend>{t('Item {n}', { n: index + 1 })}</legend>
          <div className="field"><label htmlFor={`${r.key}-name`}>{t('Name')}</label><input id={`${r.key}-name`} type="text" required maxLength={200} value={r.name} onChange={e => row(r.key, { name: e.target.value })} /></div>
          <div className="meal-form-row">
            <div className="field"><label htmlFor={`${r.key}-section`}>{t('Section')}</label><input id={`${r.key}-section`} type="text" maxLength={200} placeholder={t('Pizza, Sides…')} value={r.section} onChange={e => row(r.key, { section: e.target.value })} /></div>
            <div className="field"><label htmlFor={`${r.key}-price`}>{t('Price')}</label><input id={`${r.key}-price`} type="text" inputMode="decimal" maxLength={10} placeholder="12.99" value={r.price} onChange={e => row(r.key, { price: e.target.value })} /></div>
          </div>
          <div className="field"><label htmlFor={`${r.key}-description`}>{t('Description')}</label><input id={`${r.key}-description`} type="text" maxLength={1000} value={r.description} onChange={e => row(r.key, { description: e.target.value })} /></div>
          <label className="meal-check"><input type="checkbox" checked={r.favorite} onChange={e => row(r.key, { favorite: e.target.checked })} /> ★ {t('Family favorite')}</label>
          <button type="button" className="link-btn" aria-label={r.name ? t('Remove item {n}, {name}', { n: index + 1, name: r.name }) : t('Remove item {n}', { n: index + 1 })} onClick={() => setRows(rs => rs.filter(x => x.key !== r.key))}>{t('Remove item')}</button>
        </fieldset>)}
        <button type="button" className="btn btn-secondary" disabled={rows.length >= 500} onClick={() => setRows(rs => [...rs, { key: crypto.randomUUID(), section: lastSection, name: '', price: '', description: '', favorite: false }])}><PlusIcon /> {t('Add item')}</button>
        <div className="field meal-spaced"><label htmlFor={`${formId}-paste`}>{t('Paste a menu')}</label>
          <textarea id={`${formId}-paste`} rows={4} maxLength={100000} placeholder={t('Pizza\nLarge cheese 14.99\nPepperoni $16')} value={paste} onChange={e => setPaste(e.target.value)} />
          <p className="field-hint">{t('One item per line with its price at the end. A line without a price starts a section. From a paper menu, copy the text off a photo first.')}</p>
          <button type="button" className="btn btn-secondary" disabled={!paste.trim() || reading} onClick={() => void readPaste()}>{reading ? t('Reading…') : t('Add these items')}</button>
        </div>
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Sheet>
}
