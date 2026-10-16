import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from './AppContext.tsx'
import { api, ApiError } from './api.ts'
import { applyListOps, type Op } from './outbox.ts'
import type { EventInstance, ItemSuggestion, List, ListCatalog, ListDetail, ListItemInput, ListGroupBy, ListItem, ListItemPriority, ListItemStep, ListKind, ListSortBy, Member, RememberedItem, BarcodeLookup } from './types.ts'
import { aisleOrderMap, compareAisles, compareItems, LIST_EMOJI, MEMBER_PALETTE, type AisleOrder } from './types.ts'
import { dateKey } from './date.ts'
import { dueLabel as itemDueLabel, eventDueMap, eventLabel } from './itemDue.ts'
import { useEventWindow } from './useEventWindow.ts'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { MemberPicker } from './MemberPicker.tsx'
import { isSingleEmoji } from './emoji.ts'
import { colorName } from './color.ts'
import { useIsPhone } from './useIsPhone.ts'
import { BasketIcon, CalendarIcon, CartIcon, CheckIcon, ChevronLeft, ChevronRight, EditIcon, FilterIcon, InfoIcon, NoteIcon, PlusIcon, RepeatIcon, TrashIcon } from './icons.tsx'
import { announce, filterSortLabel, pressable, Segmented } from './a11y.tsx'
import { useDialog } from './dialog.tsx'
import { CustomColorSwatch } from './ColorSwatch.tsx'
import { PRIORITY_LABEL, PRIORITY_MARK, PriorityBadge } from './PriorityBadge.tsx'
import NotesThread from './NotesThread.tsx'
import { actorName, byLine, nowrap, whenLabel } from './addedBy.ts'
import { aisleAt, ANY_STORE, anyStoreView, departmentAisle, placeNeeds, setShoppingModeList, setTripReverse, setTripStore, tripLeftovers, tripReverse, tripStore, tripStoreFor, tripView } from './trip.ts'
import { hashPath, hashQuery, listRoute, useHashParam } from './hashQuery.ts'
import { holdAwake } from './wakeLock.ts'
import GetStuffDone from './GetStuffDone.tsx'
import { shoppingActivity } from './liveActivity.ts'
import { appBarcodeScanner, endAppActivity, scanBarcode, tellAppActivity, tellAppHere, wallCamera } from './native.ts'
import { itemKey, matchItems } from './itemSuggest.ts'
import { SWIPE_REVEAL, swipeAxis, swipeEnd, swipeOffset } from './swipe.ts'
import { aisleGroup, canChangeItem, listSections, listType, reorderWithin, TYPE_LABEL, typeFields, type ListType } from './listSections.ts'
import { activeCatalogFilters, boughtLabel, CATALOG_GROUP_LABELS, CATALOG_SORT_LABELS, catalogDepartments, catalogFilterSummary, catalogStores, catalogTags, catalogView, filterCatalog, groupCatalog, placeLabel, placesFor, placesInput, scanMatch, scanTarget, setCatalogView, sortCatalog, STARTER_TAGS, tagsInput, type CatalogGroup, type CatalogSort } from './catalog.ts'
import { Face, ChipFace, InlineFaces } from './Face'
import { useBackClose } from './backStack.ts'
import { intlLocale, t, tn, msg, tm } from './i18n.ts'
import { TaskSyncField, TaskSyncLine, useTaskLink } from './TaskApps.tsx'

// The list types in the edit sheet, each with its icon (Groceries first among the shopping ones).
const TYPE_ICON: Record<ListType, typeof CartIcon> = { todo: CheckIcon, groceries: BasketIcon, shopping: CartIcon, reusable: RepeatIcon }
const TYPE_ORDER: ListType[] = ['todo', 'groceries', 'shopping', 'reusable']
/** A shopping list's catalog, by type: "Grocery catalog" / "Shopping catalog". */
const catalogName = (catalog: ListCatalog) => (catalog === 'groceries' ? t('Grocery catalog') : t('Shopping catalog'))

/** "3 left" / "All done" summary shown on a list card, per SPEC. */
function countLabel(list: List) {
  if (list.itemCount === 0) return t('Empty')
  if (list.openCount === 0) return t('All done')
  return list.overdueCount ? t('{left} left, {overdue} overdue', { left: list.openCount, overdue: list.overdueCount }) : t('{n} left', { n: list.openCount })
}
/** "3 left · ⚠ 2 overdue": the overdue part in the danger color with an icon, so it's not color alone. */
function CountLine({ list }: { list: List }) {
  if (!list.overdueCount || list.openCount === 0) return <>{countLabel(list)}</>
  return <>{t('{n} left', { n: list.openCount })} · <span className="list-overdue">⚠ {t('{n} overdue', { n: list.overdueCount })}</span></>
}

const SORT_LABEL: Record<ListSortBy, string> = { manual: msg('Manual'), added: msg('Date added'), due: msg('Due date'), priority: msg('Priority'), alpha: msg('A–Z'), aisle: msg('Aisle') }
const SORT_HINT: Record<ListSortBy, string> = {
  manual: msg('Your order, urgent and important first'),
  added: msg('Newest first'),
  due: msg("Soonest first (a linked event's day counts), no date last"),
  priority: msg('Urgent first, then by due date'),
  alpha: msg('Alphabetical'),
  aisle: msg('By store, in the order you walk the aisles'),
}
// The View button's summary, as whole phrases (a word can't be lowercased into a sentence in every language).
const GROUPED_BY: Record<ListGroupBy, string> = { store: msg('Grouped by store'), category: msg('Grouped by category'), aisle: msg('Grouped by aisle'), none: msg('Not grouped') }
const SORTED_BY: Record<ListSortBy, string> = { manual: msg('Your order'), added: msg('Sorted by date added'), due: msg('Sorted by due date'), priority: msg('Sorted by priority'), alpha: msg('Sorted by A–Z'), aisle: msg('Sorted by aisle') }
const GROUP_LABEL: Record<ListGroupBy, string> = { store: msg('Store'), category: msg('Category'), aisle: msg('Aisle'), none: msg('None') }
/** What a new list of this kind starts with (the server's defaults); anything else counts on the View button. */
const listViewDefaults = (kind: ListKind): { groupBy: ListGroupBy; sortBy: ListSortBy } =>
  kind === 'shopping' ? { groupBy: 'aisle', sortBy: 'aisle' } : { groupBy: 'none', sortBy: 'manual' }
/** Reset on a reusable list (unchecks for next time), else Clear checked. A shopping trip's own
 * checkout says "Done shopping" instead (TRIP_DONE_LABEL). */
const CHECKOUT_LABEL: Record<ListKind, string> = { shopping: msg('Clear checked'), reusable: msg('Reset'), todo: msg('Clear checked') }
const TRIP_DONE_LABEL = msg('Done shopping')
const todayKey = () => dateKey(new Date())

const dueLabel = (item: ListItem) => itemDueLabel(item, todayKey())

function ownersOf(list: List, members: Member[]) {
  return list.memberIds.map(id => members.find(m => m.id === id)).filter((m): m is Member => !!m)
}

function ListCard({ list, active, members, onSelect, onEdit }: {
  list: List; active: boolean; members: Member[]; onSelect: () => void; onEdit?: () => void
}) {
  // A tap opens it. Editing is Edit lists mode, the open list's Edit button, or right-click (parent devices only: no onEdit elsewhere).
  const owners = ownersOf(list, members)
  return (
    <div className={`list-card ${active ? 'active' : ''}`} {...pressable(onSelect)}
      aria-current={active || undefined} onContextMenu={onEdit && (e => { e.preventDefault(); onEdit() })}
      aria-label={[list.name, countLabel(list), list.isDefault ? t('default {type} list', { type: tm(TYPE_LABEL[listType(list)]) }) : '', owners.length ? t('for {names}', { names: new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(owners.map(m => m.name)) }) : ''].filter(Boolean).join(', ')}
      style={{ ['--list-color' as string]: list.color || 'var(--accent)' }}>
      <div className="list-card-accent" />
      <div className="list-card-emoji">{list.emoji || '📝'}</div>
      <div className="list-card-body">
        <div className="list-card-name">{list.name}</div>
        <div className="list-card-sub"><CountLine list={list} />{list.isDefault && <span className="list-card-default"> · ⭐ {t('Default')}</span>}</div>
      </div>
      {owners.length > 0 && (
        <div className="list-card-owners">
          {owners.map(m => (
            <Face key={m.id} m={m} />
          ))}
        </div>
      )}
    </div>
  )
}

/** A list card in Edit lists mode: tap it to edit, drag it by the grip, or Move up / Move down. */
function ReorderCard({ list, handle, first, last, onMove, onEdit }: { list: List; handle: React.ReactNode; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void; onEdit: () => void }) {
  return (
    <div className="list-card list-card-reorder" style={{ ['--list-color' as string]: list.color || 'var(--accent)' }}>
      <div className="list-card-accent" />
      {handle}
      <button type="button" className="list-card-edit" aria-haspopup="dialog" aria-label={t('Edit {name}', { name: list.name })} onClick={onEdit}>
        <span className="list-card-emoji" aria-hidden="true">{list.emoji || '📝'}</span>
        <span className="list-card-body"><span className="list-card-name">{list.name}</span></span>
        <EditIcon width={18} height={18} aria-hidden="true" />
      </button>
      <button className="icon-btn" onClick={() => onMove(-1)} disabled={first} aria-label={t('Move {name} up', { name: list.name })}><ChevronRight width={20} height={20} style={{ transform: 'rotate(-90deg)' }} /></button>
      <button className="icon-btn" onClick={() => onMove(1)} disabled={last} aria-label={t('Move {name} down', { name: list.name })}><ChevronRight width={20} height={20} style={{ transform: 'rotate(90deg)' }} /></button>
    </div>
  )
}

const COLLAPSED_KEY = 'kinwall.listsCollapsed' // this device's folded sections on the Lists page
function readCollapsed(): ListType[] {
  try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]') } catch { return [] }
}

// A new list's emoji follows its type until one is picked.
const TYPE_EMOJI: Record<ListType, string> = { todo: '📝', groceries: '🛒', shopping: '🧺', reusable: '📋' }

function ListEditSheet({ list, onClose, onSaved, onDeleted }: {
  list: List | 'new'; onClose: () => void; onSaved: (created?: List) => void; onDeleted: () => void
}) {
  const dialog = useDialog()
  const { members, toast } = useApp()
  const existing = list === 'new' ? null : list
  const [name, setName] = useState(existing?.name ?? '')
  const [type, setTypeOnly] = useState<ListType>(existing ? listType(existing) : 'todo')
  const kind = typeFields(type).kind
  const [emoji, setEmojiOnly] = useState(existing?.emoji ?? LIST_EMOJI[0])
  const [emojiPicked, setEmojiPicked] = useState(!!existing)
  const setEmoji = (e: string) => { setEmojiOnly(e); setEmojiPicked(true) }
  const setType = (t: ListType) => { setTypeOnly(t); if (!emojiPicked) setEmojiOnly(TYPE_EMOJI[t]) }
  const [color, setColor] = useState(existing?.color ?? MEMBER_PALETTE[0])
  const [memberIds, setMemberIds] = useState<string[]>(existing?.memberIds ?? [])
  // null = not touched: the kind's default (the server applies it on create and on a kind change).
  const [keepTouched, setKeep] = useState<boolean | null>(null)
  const keepChecked = keepTouched ?? (existing && kind === existing.kind ? existing.keepChecked : kind !== 'todo')
  const [isDefault, setDefault] = useState(!!existing?.isDefault)
  const defaultable = !!existing && (type === 'groceries' || type === 'shopping') && type === listType(existing) // a type change clears it on the server

  const submit = async () => {
    if (!name.trim() || !isSingleEmoji(emoji)) return
    const body = { name: name.trim(), ...typeFields(type), emoji, color, memberIds, ...(keepTouched !== null ? { keepChecked } : {}), ...(defaultable && isDefault !== !!existing?.isDefault ? { isDefault } : {}) }
    try {
      if (existing) { await api.updateList(existing.id, body); onSaved() }
      else onSaved(await api.createList(body)) // opened next
    } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not save list'), true) }
  }
  const archive = async () => {
    if (!existing) return
    try { await api.updateList(existing.id, { archived: true }); announce(t('{name} archived', { name: existing.name })); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not archive list'), true) }
  }
  const del = async () => {
    if (!existing) return
    if (!await dialog.confirm({ title: t('Delete “{name}”?', { name: existing.name }), body: t('This removes all its items too.'), confirmLabel: t('Delete'), danger: true })) return
    try { await api.deleteList(existing.id); onDeleted() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not delete list'), true) }
  }

  return (
    <Sheet title={existing ? t('Edit list') : t('New list')} onClose={onClose} dirty="auto"
      actions={
        <>
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim() || !isSingleEmoji(emoji)}>{existing ? t('Save') : t('Add list')}</button>
        </>
      }>
      <div className="field">
        <label>{t('Name')}</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder={t('List name')} autoComplete="off" autoFocus={!existing} />
      </div>
      <div className="field">
        <label>{t('Type')}</label>
        <Segmented label={t('Type')} className="list-type-seg" value={type} onChange={setType}
          options={TYPE_ORDER.map(ty => { const Icon = TYPE_ICON[ty]; return { key: ty, label: <><Icon width={20} height={20} aria-hidden="true" />{tm(TYPE_LABEL[ty])}</> } })} />
        {(type === 'groceries' || type === 'shopping') && (
          <p className="field-hint">{type === 'groceries' ? t('Food and household groceries. Meals add ingredients here. It has its own catalog of things you buy.') : t('Hardware, clothes, gifts and other shopping. It has its own catalog of things you buy.')}</p>
        )}
      </div>
      <div className="field">
        <div className="steps-head">
          <label id="list-keep-checked">{t('Keep checked items in place')}</label>
          <button className={`switch ${keepChecked ? 'on' : ''}`} role="switch" aria-checked={keepChecked} aria-labelledby="list-keep-checked" aria-describedby="list-keep-checked-hint"
            onClick={() => setKeep(!keepChecked)}><span className="knob" /></button>
        </div>
        <p className="field-hint" id="list-keep-checked-hint">{keepChecked
          ? t('Checked items stay where they are, crossed off, until you tap {button}.', { button: tm(CHECKOUT_LABEL[kind]) })
          : t('Checked items move to a Done section at the bottom.')}</p>
      </div>
      {defaultable && (
        <div className="field">
          <div className="steps-head">
            <label id="list-default">{t('Default {type} list', { type: tm(TYPE_LABEL[type]) })}</label>
            <button className={`switch ${isDefault ? 'on' : ''}`} role="switch" aria-checked={isDefault} aria-labelledby="list-default" aria-describedby="list-default-hint"
              onClick={() => setDefault(!isDefault)}><span className="knob" /></button>
          </div>
          <p className="field-hint" id="list-default-hint">{type === 'groceries'
            ? t("Scanned food, meal ingredients, and the app's widgets, Siri and tiles use this list. Turning it on here turns it off on your other Groceries lists.")
            : t('Scanned household and beauty items go to this list. Turning it on here turns it off on your other Shopping lists.')}</p>
        </div>
      )}
      <div className="field">
        <label>{t('Emoji')}</label>
        <div className="emoji-swatch-row">
          {LIST_EMOJI.map(e => <button key={e} className={`emoji-swatch ${emoji === e ? 'active' : ''}`} aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>)}
        </div>
        <AnyEmojiField value={emoji} onChange={setEmoji} />
      </div>
      <div className="field">
        <label>{t('Color')}</label>
        <div className="color-swatch-row">
          {MEMBER_PALETTE.map(c => <button key={c} className={`color-swatch ${color === c ? 'active' : ''}`} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} aria-label={colorName(c)} />)}
          <CustomColorSwatch value={color} presets={MEMBER_PALETTE} onChange={hex => setColor(hex)} label={t('Custom list color')} />
        </div>
      </div>
      <MemberPicker members={members} selected={memberIds} onChange={setMemberIds} label={t('Owners')} noneLabel={t('Everyone')} />
      {existing && existing.kind === 'todo' && kind === 'todo' && <TaskSyncField list={existing} />}
      {existing && (
        <div className="sheet-danger-zone">
          <button className="link-btn" onClick={archive}>{t('Archive list')}</button>
          <button className="link-btn link-danger" onClick={del}>{t('Delete list')}</button>
        </div>
      )}
    </Sheet>
  )
}

const NEW_VALUE = '\u0000new'

/** A real dropdown of the household's values (a native select: the iPhone wheel, a big list on a
 * wall screen), plus "None" and "New …", which reveals a text field for a value not seen before. */
function ValuePicker({ id, label, value, options, onChange, newLabel, placeholder, noneLabel, className }: {
  id: string; label: string; value: string; options: string[]; onChange: (v: string) => void; newLabel: string; placeholder: string; noneLabel?: string; className?: string
}) {
  const [adding, setAdding] = useState(false)
  const typing = adding || (!!value && !options.includes(value)) // a value from elsewhere shows as typed
  return (
    <div className={className ? `field ${className}` : 'field'}>
      <label htmlFor={id}>{label}</label>
      <select id={id} value={typing ? NEW_VALUE : value}
        onChange={e => { const v = e.target.value; setAdding(v === NEW_VALUE); onChange(v === NEW_VALUE ? '' : v) }}>
        <option value="">{noneLabel ?? t('None')}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
        <option value={NEW_VALUE}>{newLabel}</option>
      </select>
      {typing && (
        <input type="text" className="value-picker-new" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          aria-label={t('{label} name', { label })} autoFocus={adding} maxLength={60} autoComplete="off" />
      )}
    </div>
  )
}

/** A store's known aisles in walking order (its custom order, then natural order). */
function storeAisles(suggestions: ListDetail['suggestions'], store: string | null, order: AisleOrder): string[] {
  return suggestions.aisles.filter(a => a.store === store).map(a => a.aisle).sort((a, b) => compareAisles(store, a, b, order))
}

/** Quantity and, on a shopping list, Store and Aisle (with their hints): the Add item and Edit item sheets' fields. */
function ItemPlaceFields({ shopping, quantity, onQuantity, store, onStore, aisle, onAisle, aisleStore, category, lastStore, suggestions, aisleOrder }: {
  shopping: boolean; quantity: string; onQuantity: (v: string) => void; store: string; onStore: (v: string) => void; aisle: string; onAisle: (v: string) => void
  aisleStore: string | null // whose aisles the picker offers
  category: string // its department: may stand in for an aisle (shown, not saved)
  lastStore?: string | null // suggested, never applied for you
  suggestions: ListDetail['suggestions']; aisleOrder: AisleOrder
}) {
  const deptAisle = departmentAisle(category, storeAisles(suggestions, aisleStore, aisleOrder))
  return (
    <>
      <div className="field">
        <label htmlFor="item-quantity">{t('Quantity')}</label>
        <input id="item-quantity" type="text" value={quantity} onChange={e => onQuantity(e.target.value)} placeholder={t('e.g. 2, 1 lb, x3')} />
      </div>
      {shopping && (
        <>
          <ValuePicker id="item-store" label={t('Store')} value={store} options={suggestions.stores} newLabel={t('New store…')} placeholder={t('Store name')} onChange={onStore} />
          {!store.trim() && lastStore && (
            <p className="field-hint item-last-store">{t('Last bought at {store}.', { store: lastStore })} <button type="button" className="link-btn" onClick={() => onStore(lastStore)}>{t('Plan to buy it there')}</button></p>
          )}
          <ValuePicker id="item-aisle" label={aisleStore ? t('Aisle at {store}', { store: aisleStore }) : t('Aisle')} value={aisle}
            options={storeAisles(suggestions, aisleStore, aisleOrder)} newLabel={t('New aisle…')} placeholder={t('e.g. Aisle 4, Produce, Back wall')} onChange={onAisle} />
          {!aisle.trim() && deptAisle && <p className="field-hint item-dept-aisle">{t('{aisle}, from its department', { aisle: deptAisle })}</p>}
        </>
      )}
    </>
  )
}

/** The On sale switch (shopping lists). Checking the item off clears it. */
function SaleField({ id, on, onChange }: { id: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="field">
      <div className="steps-head">
        <label id={id}>{t('On sale')}</label>
        <button type="button" className={`switch ${on ? 'on' : ''}`} role="switch" aria-checked={on} aria-labelledby={id} onClick={() => onChange(!on)}><span className="knob" /></button>
      </div>
    </div>
  )
}

function ItemEditSheet({ listId, item, kind, manual, members, suggestions, aisleOrder, trip, siblingIds, upcoming, byId, moveTargets, readOnly, onClose, onSaved }: {
  listId: string; item: ListItem; kind: ListKind; manual: boolean; members: Member[]
  readOnly?: boolean // a kid's device, someone else's item: shown, not changed (the server refuses it too)
  moveTargets: List[] // the other lists of this type: "Move to…" (hidden when there are none)
  suggestions: ListDetail['suggestions']; aisleOrder: AisleOrder
  trip: string | null // shopping at this store: the aisle picker is this store's
  upcoming: EventInstance[]; byId: Map<string, EventInstance> // for the "Linked event" picker
  siblingIds: string[] // items in current sort order, for up/down reorder
  onClose: () => void; onSaved: () => void
}) {
  const dialog = useDialog()
  const { toast, settings } = useApp()
  const [moving, setMoving] = useState(false)
  const moveTo = async (to: List) => {
    try { await api.moveListItems(listId, [item.id], to.id); announce(t('Moved {item} to {list}', { item: item.title, list: to.name })); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not move it'), true) }
  }
  const [title, setTitle] = useState(item.title)
  const [quantity, setQuantity] = useState(item.quantity ?? '')
  const [notes, setNotes] = useState(item.notes ?? '')
  const [store, setStore] = useState(item.store ?? '')
  const [category, setCategory] = useState(item.category ?? '')
  const initialAisle = (trip ? aisleAt(item, trip) : item.aisle) ?? ''
  const [aisle, setAisle] = useState(initialAisle)
  const aisleStore = trip ?? (store.trim() || null) // whose aisles the picker offers
  const lastStore = item.places?.find(p => p.store)?.store // suggested, never applied for you
  const [onSale, setOnSale] = useState(!!item.onSale)
  const [memberId, setMemberId] = useState<string | null>(item.memberId)
  const [forIds, setForIds] = useState<string[]>(item.forMemberIds ?? [])
  const showFor = kind === 'shopping' || !!item.forMemberIds?.length // shopping; set elsewhere (API, MCP) stays editable
  const [dueDate, setDueDate] = useState(item.dueDate ?? '')
  const [eventId, setEventId] = useState<string | null>(item.eventId)
  const [priority, setPriority] = useState(item.priority)
  const [live, setLive] = useState(item) // steps save as they change; this holds the latest item from the server
  const [pickingEvent, setPickingEvent] = useState(false)
  const linked = eventId ? byId.get(eventId) : undefined
  const showDue = kind === 'todo' || !!item.dueDate // due dates are a to-do thing, but one set elsewhere (API, MCP) stays editable
  // Unsaved changes (Sheet asks before discarding). Steps and the discussion save as they go.
  const edited = !readOnly && (title !== item.title || quantity !== (item.quantity ?? '') || notes !== (item.notes ?? '') || store !== (item.store ?? '')
    || category !== (item.category ?? '') || aisle !== initialAisle || onSale !== !!item.onSale || memberId !== item.memberId
    || forIds.join() !== (item.forMemberIds ?? []).join() || dueDate !== (item.dueDate ?? '') || eventId !== item.eventId || priority !== item.priority)

  const submit = async () => {
    if (!title.trim()) return
    const body = {
      title: title.replace(/\s+/g, ' ').trim(), quantity: quantity.trim() || null, notes: notes.trim() || null, priority,
      ...(kind === 'shopping' ? { store: store.trim() || null, category: category.trim() || null, onSale } : {}),
      // On a trip the aisle is the trip store's (sent only when changed, so an untouched one isn't remembered).
      ...(kind === 'shopping' && !trip ? { aisle: aisle.trim() || null } : {}),
      ...(kind === 'shopping' && trip && aisle.trim() !== initialAisle ? { aisle: aisle.trim() || null, aisleStore: trip } : {}),
      // Assignees on to-do and reusable lists (a routine has each person's jobs); due dates are to-do only.
      ...(kind !== 'shopping' ? { memberId } : {}),
      ...(showFor ? { forMemberIds: forIds } : {}),
      ...(showDue ? { dueDate: dueDate || null } : {}),
      ...(eventId !== item.eventId ? { eventId } : {}), // only when changed: a link to a since-deleted event still saves
    }
    try { await api.queueUpdateListItem(listId, item.id, body); onSaved() } // offline too: syncs when back
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not save item'), true) }
  }
  const del = async () => {
    if (!await dialog.confirm({ title: t('Delete “{name}”?', { name: item.title }), confirmLabel: t('Delete'), danger: true })) return
    try { await api.queueDeleteListItem(listId, item.id); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not delete item'), true) }
  }
  const move = async (dir: -1 | 1) => {
    const i = siblingIds.indexOf(item.id)
    if (i < 0) return
    const j = i + dir
    if (j < 0 || j >= siblingIds.length) return
    const next = [...siblingIds]
    ;[next[i], next[j]] = [next[j], next[i]]
    try { await api.reorderListItems(listId, next); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not reorder'), true) }
  }

  const quantityAndPlace = (
    <ItemPlaceFields shopping={kind === 'shopping'} quantity={quantity} onQuantity={setQuantity} store={store} aisle={aisle} onAisle={setAisle}
      aisleStore={aisleStore} category={category} lastStore={lastStore} suggestions={suggestions} aisleOrder={aisleOrder}
      onStore={v => {
        setStore(v)
        // An aisle belongs to a store: keep it only if the new store has it too (a trip's stays the trip store's).
        if (!trip && aisle && !storeAisles(suggestions, v.trim() || null, aisleOrder).includes(aisle)) setAisle('')
      }} />
  )

  const priorityField = (
    <div className="field">
      <label id="item-priority-label">{t('Priority')}</label>
      <Segmented className="priority-seg" label={t('Priority')} value={priority} onChange={setPriority}
        options={(['low', 'normal', 'high', 'urgent'] as ListItemPriority[]).map(p => ({
          key: p, label: <>{p !== 'normal' && <span className={`prio-mark prio-${p}`} aria-hidden="true">{PRIORITY_MARK[p]}</span>}{tm(PRIORITY_LABEL[p])}</>,
        }))} />
    </div>
  )
  const assignField = (
    <div className="field">
      <label>{t('Assign to')}</label>
      <div className="chip-row">
        <button className={`chip ${memberId === null ? 'active' : ''}`} aria-pressed={memberId === null} onClick={() => setMemberId(null)}>{t('Nobody')}</button>
        {members.map(m => (
          <button key={m.id} className={`chip ${memberId === m.id ? 'active' : ''}`} aria-pressed={memberId === m.id} style={{ ['--chip-color' as string]: m.color }} onClick={() => setMemberId(m.id)}><ChipFace m={m} /> {m.name}</button>
        ))}
      </div>
    </div>
  )
  const dueField = showDue && (
    <div className="field">
      <label htmlFor="item-due">{t('Due date')}</label>
      <div className="due-field">
        <input id="item-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        {dueDate && <button type="button" className="btn btn-secondary" onClick={() => { setDueDate(''); announce(t('Due date cleared')) }} aria-label={t('Clear due date')}>{t('Clear')}</button>}
      </div>
    </div>
  )
  const eventAndNotes = (
    <>
      <div className="field">
        <label>{t('Linked event')}</label>
        <button className="btn btn-secondary btn-block" style={{ justifyContent: 'flex-start', minHeight: 44 }} onClick={() => setPickingEvent(v => !v)} aria-expanded={pickingEvent}
          aria-label={t('Linked event: {event}', { event: eventId ? (linked ? eventLabel(linked) : t('an event outside the next 30 days')) : t('none') })}>
          <CalendarIcon width={16} height={16} />{eventId ? (linked ? eventLabel(linked) : t('An event outside the next 30 days')) : t('None')}
        </button>
        {pickingEvent && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto', marginTop: 6 }}>
            <button className={`chip ${eventId === null ? 'active' : ''}`} aria-pressed={eventId === null} style={{ minHeight: 44 }} onClick={() => { setEventId(null); setPickingEvent(false) }}>{t('None')}</button>
            {upcoming.map(e => (
              <button key={e.id} className={`chip ${eventId === e.id ? 'active' : ''}`} aria-pressed={eventId === e.id} style={{ minHeight: 44, justifyContent: 'flex-start', ['--chip-color' as string]: e.color }}
                onClick={() => { setEventId(e.id); setPickingEvent(false) }}>{eventLabel(e)}</button>
            ))}
            {upcoming.length === 0 && <div className="list-item-meta">{t('No events in the next 30 days')}</div>}
          </div>
        )}
      </div>
      <div className="field">
        <label>{t('Notes')}</label>
        <textarea className="item-notes-input" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
    </>
  )

  return (
    <Sheet title={readOnly ? t('Item') : t('Edit item')} onClose={onClose} dirty={edited}
      actions={readOnly ? <button className="btn btn-primary" onClick={onClose}>{t('Done')}</button> : <button className="btn btn-primary" onClick={submit} disabled={!title.trim()}>{t('Save')}</button>}>
      {readOnly && <p className="field-hint item-read-only">{(name => name ? t("This one is {name}'s.", { name }) : t("This one is someone else's."))(members.find(m => m.id === item.memberId)?.name)}</p>}
      {/* Read-only: every field and button inside is disabled; the discussion below stays open. */}
      <fieldset className="item-sheet-fields" disabled={readOnly}>
      <div className="field">
        <label htmlFor="item-title">{t('Name')}</label>
        {/* A textarea so a long title shows in full; Enter doesn't add a line break. */}
        <textarea id="item-title" className="item-title-input" rows={2} value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }} />
        <ItemByLines item={live} members={members} />
      </div>
      {kind === 'shopping' && quantityAndPlace /* on a shopping list, where it goes comes first */}
      {kind !== 'shopping' && assignField /* a to-do's: who and when come first */}
      {kind !== 'shopping' && dueField}
      {showFor && <MemberPicker members={members} selected={forIds} onChange={setForIds} label={t('For')} noneLabel={t('Everyone')} />}
      {kind === 'shopping' && <SaleField id="item-sale" on={onSale} onChange={setOnSale} />}
      {kind !== 'shopping' && priorityField}
      <StepsEditor listId={listId} item={live} onChange={setLive} />
      {kind === 'shopping' && dueField}
      {kind === 'shopping' ? (
        // Groceries: where it goes stays up front; the rest folds away, with what's set in the summary.
        <details className="settings-disclosure item-more">
          <summary>{[t('More'), category.trim(), priority !== 'normal' && t('{priority} priority', { priority: tm(PRIORITY_LABEL[priority]) }), eventId && t('Event'), notes.trim() && t('Notes')].filter(Boolean).join(' · ')}</summary>
          <ValuePicker id="item-category" label={t('Department')} value={category} options={suggestions.categories} newLabel={t('New department…')} placeholder={t('e.g. Produce')} onChange={setCategory} />
          {priorityField}
          {eventAndNotes}
        </details>
      ) : <>
        {eventAndNotes}
        {/* Quantity is rarely a to-do thing: folded away, its value in the summary. */}
        <details className="settings-disclosure item-more">
          <summary>{['More', quantity.trim()].filter(Boolean).join(' · ')}</summary>
          {quantityAndPlace}
        </details>
      </>}
      {moveTargets.length > 0 && (
        <div className="field">
          <button className="btn btn-secondary btn-block" onClick={() => setMoving(true)} aria-haspopup="dialog">{t('Move to another list…')}</button>
        </div>
      )}
      {moving && (
        <Sheet title={t('Move to…')} onClose={() => setMoving(false)}>
          <p className="field-hint">{t('{item} keeps everything on it: notes, steps and discussion.', { item: item.title })}</p>
          <div className="shop-store-options">
            {moveTargets.map(l => <button key={l.id} className="btn btn-secondary btn-block" onClick={() => moveTo(l)}>{l.emoji ? `${l.emoji} ` : ''}{l.name}</button>)}
          </div>
        </Sheet>
      )}
      </fieldset>
      {settings.features.notes && <NotesThread target={`list_item:${item.id}`} title={t('Discussion')} />}
      {manual && !readOnly && (
        <div className="field">
          <label>{t('Order')}</label>
          <div className="chip-row">
            <button className="btn btn-secondary" onClick={() => move(-1)} disabled={siblingIds.indexOf(item.id) <= 0}>{t('Move up')}</button>
            <button className="btn btn-secondary" onClick={() => move(1)} disabled={siblingIds.indexOf(item.id) >= siblingIds.length - 1}>{t('Move down')}</button>
          </div>
        </div>
      )}
      {!readOnly && <div className="sheet-danger-zone"><button className="link-btn link-danger" onClick={del}>{t('Delete item')}</button></div>}
    </Sheet>
  )
}

/** "Added by Maya · Tue 4:12 PM" and, once ticked, "Checked off by Leo · 5:02 PM"; nothing when nobody is known. */
function ItemByLines({ item, members }: { item: ListItem; members: Member[] }) {
  const lines = [byLine(t('Added by'), item.addedBy, item.createdAt, members), item.done ? byLine(t('Checked off by'), item.checkedBy, item.doneAt, members) : null].filter(l => l !== null)
  if (lines.length === 0) return null
  return <div className="item-by-lines">{lines.map(l => <div key={l}>{l}</div>)}</div>
}

/** "Last done: Maya · Tue 8:10 PM" on a reusable list; nothing until it's been done. */
function lastDoneLine(list: List, members: Member[]): string | null {
  if (list.kind !== 'reusable' || !list.lastDoneAt) return null
  const who = actorName(list.lastDoneBy, members)
  const when = nowrap(whenLabel(list.lastDoneAt))
  return who ? t('Last done: {who} · {when}', { who, when }) : t('Last done: {when}', { when })
}

/** An item's steps as a checklist (tick, add, drag or Alt+arrow to reorder, delete), or - "One at a
 * time" - just the next open step, big, with a Done button. Every change saves straight away; the
 * server answers with the whole item, which may have completed (last step) or re-opened. */
function StepsEditor({ listId, item, onChange }: { listId: string; item: ListItem; onChange: (item: ListItem) => void }) {
  const { toast } = useApp()
  const [draft, setDraft] = useState('')
  const [oneAtATime, setOneAtATime] = useState(false)
  const { steps } = item
  const nextStep = steps.find(st => !st.done)

  const run = async (req: Promise<ListItem>, failed: string) => {
    try { const next = await req; onChange(next); return next }
    catch (e) { toast(e instanceof ApiError ? e.message : failed, true); return null }
  }
  const tick = async (step: ListItemStep) => {
    const wasDone = step.done, itemWasDone = item.done // read first: the demo's mock updates objects in place
    const next = await run(api.updateListItemStep(listId, item.id, step.id, { done: !wasDone }), t('Could not update step'))
    if (!next) return
    const upNext = next.steps.find(st => !st.done)
    const counts = { step: step.title, done: next.stepsDone, total: next.stepsTotal }
    if (next.done && !itemWasDone) announce(t('{step} done. All steps finished: {item} is done', { step: step.title, item: item.title }))
    else if (!next.done && itemWasDone) announce(t('{step} not done. {item} is open again', { step: step.title, item: item.title }))
    else if (wasDone) announce(t('{step} not done, {done} of {total}', counts))
    else announce(oneAtATime && upNext ? t('{step} done, {done} of {total}. Next: {next}', { ...counts, next: upNext.title }) : t('{step} done, {done} of {total}', counts))
  }
  const add = async () => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    if (await run(api.addListItemStep(listId, item.id, title), t('Could not add step'))) announce(t('Added step {step}', { step: title }))
  }
  const remove = async (step: ListItemStep) => {
    if (await run(api.deleteListItemStep(listId, item.id, step.id), t('Could not delete step'))) announce(t('Deleted step {step}', { step: step.title }))
  }
  const reorder = (ids: string[]) => {
    onChange({ ...item, steps: ids.map(id => steps.find(st => st.id === id)!) }) // shown at once, then saved
    run(api.reorderListItemSteps(listId, item.id, ids), t('Could not reorder steps'))
  }

  return (
    <div className="field">
      <div className="steps-head">
        <label id={`steps-${item.id}`}>{steps.length > 0 ? t('Steps · {done} of {total}', { done: item.stepsDone, total: item.stepsTotal }) : t('Steps')}</label>
        {steps.length > 1 && (
          <div className="steps-mode">
            <span id={`steps-one-${item.id}`}>{t('One at a time')}</span>
            <button className={`switch ${oneAtATime ? 'on' : ''}`} role="switch" aria-checked={oneAtATime} aria-labelledby={`steps-one-${item.id}`}
              onClick={() => setOneAtATime(v => !v)}><span className="knob" /></button>
          </div>
        )}
      </div>
      {oneAtATime && steps.length > 1 ? (
        nextStep ? (
          <div className="step-focus">
            <div className="step-focus-count">{t('Step {n} of {total}', { n: steps.indexOf(nextStep) + 1, total: steps.length })}</div>
            <div className="step-focus-title">{nextStep.title}</div>
            <button className="btn btn-primary step-focus-btn" onClick={() => tick(nextStep)}>
              {steps.filter(st => !st.done).length === 1 ? t('Done — finish') : t('Done → next')}
            </button>
          </div>
        ) : (
          <div className="step-focus"><div className="step-focus-title"><span aria-hidden="true">✨ </span>{t('All steps done!')}</div></div>
        )
      ) : (
        <div role="group" aria-labelledby={`steps-${item.id}`}>
          <DragList items={steps} onReorder={reorder} renderRow={(st, handle) => (
            <div className={`list-item-row step-row ${st.done ? 'done' : ''}`}>
              <button className={`list-item-check ${st.done ? 'done' : ''}`} onClick={() => tick(st)} role="checkbox" aria-checked={st.done} aria-label={st.title}>
                {st.done && <CheckIcon width={20} height={20} />}
              </button>
              <div className="list-item-body step-body"><div className="list-item-title">{st.title}</div></div>
              <button className="icon-btn" onClick={() => remove(st)} aria-label={t('Delete step {step}', { step: st.title })}><TrashIcon width={16} height={16} /></button>
              {handle}
            </div>
          )} />
        </div>
      )}
      <div className="list-add-bar step-add">
        <input type="text" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder={t('Add a step…')} aria-label={t('Add a step to {item}', { item: item.title })} enterKeyHint="done" />
        <button className="icon-btn" onClick={add} disabled={!draft.trim()} aria-label={t('Add step')}><PlusIcon width={20} height={20} /></button>
      </div>
    </div>
  )
}

const OPEN_FACTS_NAMES: Partial<Record<BarcodeLookup['source'], string>> = {
  openfoodfacts: 'Open Food Facts', openproductsfacts: 'Open Products Facts', openbeautyfacts: 'Open Beauty Facts', openpetfoodfacts: 'Open Pet Food Facts',
}

/** After scanning a product the catalog doesn't know: where its name came from, the name to add
 * (with the catalog's names as you type, and a warning when it looks like something already on the
 * list: scanMatch), and whether to save the barcode to the catalog (off unless chosen; the next scan
 * then adds it at once). Kids' own devices don't change the catalog, so they don't see the switch.
 * While shopping at one store (`place`), where it was found is asked here too, not in a second sheet. */
function ScanSheet({ code, found, canSave, lists, target: suggested, checkOff, suggestions, onListKeys, onList, place, onAdd, onCheckOff, onClose }: {
  code: string; found: BarcodeLookup | null; canSave: boolean; lists: List[]; target: string; checkOff: boolean // shopping: it's in the cart
  suggestions?: ItemSuggestion[]; onListKeys: Set<string>
  onList: (ListItem & { listName: string })[] // what's on the list (both lists on a combined trip)
  place?: { store: string; aisles: string[]; departments: string[] }
  onAdd: (title: string, save: boolean, target: string, found?: { aisle: string; category: string }) => void
  onCheckOff: (item: ListItem) => void; onClose: () => void
}) {
  const [title, setTitle] = useState(found?.title ?? '')
  const [save, setSave] = useState(false)
  const [target, setTarget] = useState(suggested)
  const [aisle, setAisle] = useState('')
  const [category, setCategory] = useState<string | null>(null) // null: the catalog's, for the name
  const titleRef = useRef<HTMLInputElement>(null)
  const name = title.trim()
  const known = suggestions?.find(s => s.key === itemKey(name))
  const dept = category ?? known?.category ?? ''
  const here = place && target === suggested ? place : undefined // where it was found: this list's trip only
  const dupe = name ? scanMatch(onList, name) : undefined
  const add = () => { if (name) onAdd(name, canSave && save, target, here && { aisle: aisle.trim(), category: dept.trim() }) }
  return (
    <Sheet variant="dialog" title={t('Scanned product')} onClose={onClose}
      actions={<>
        <button className="btn btn-secondary" onClick={onClose}>{t('Cancel')}</button>
        <button className="btn btn-primary" onClick={add} disabled={!name}>{checkOff ? t('Add and check off') : t('Add to list')}</button>
      </>}>
      <p className="scan-source">
        {found ? t('Name from {source}. Check it before adding.', { source: OPEN_FACTS_NAMES[found.source] ?? 'Open Food Facts' }) : t("The Open Food Facts databases don't know this one. Type its name.")}
        {' '}<span className="scan-code">{t('Barcode {code}', { code })}</span>
      </p>
      <div className="field">
        <label htmlFor="scan-title">{t('Name')}</label>
        {/* Typed (no name found) it opens with the keyboard; a found name opens without it. */}
        <ItemAddField id="scan-title" value={title} onChange={setTitle} onAdd={v => (v.trim() === name ? add() : setTitle(v))} onPick={setTitle} suggestions={suggestions} onList={onListKeys}
          inputRef={titleRef} autoFocus={!found} label={t('Name')} placeholder={t('e.g. Paper towels')} />
        {dupe && (
          <p className="field-hint scan-dupe" role="status">
            <span aria-hidden="true">⚠ </span>{t('{item} is already on {list}.', { item: dupe.title, list: dupe.listName })}
            {checkOff && <> <button type="button" className="link-btn" onClick={() => onCheckOff(dupe)}>{t('Check it off instead')}</button></>}
          </p>
        )}
      </div>
      {lists.length > 1 && (
        <div className="field">
          <label htmlFor="scan-list">{t('Add to')}</label>
          <select id="scan-list" className="settings-select" value={target} onChange={e => setTarget(e.target.value)}>
            {lists.map(l => <option key={l.id} value={l.id}>{l.emoji ? `${l.emoji} ` : ''}{l.name}</option>)}
          </select>
        </div>
      )}
      {here && <>
        <ValuePicker id="scan-aisle" label={t('Aisle at {store}', { store: here.store })} value={aisle} options={here.aisles} newLabel={t('New aisle…')} placeholder={t('e.g. Aisle 4, Produce, Back wall')} onChange={setAisle} noneLabel={t('Not sure')} />
        <ValuePicker id="scan-dept" label={t('Department')} value={dept} options={here.departments} newLabel={t('New department…')} placeholder={t('e.g. Dairy, Pantry')} onChange={setCategory} noneLabel={t('Not sure')} />
      </>}
      {canSave && (
        <div className="scan-save">
          <div>
            <div id="scan-save-label" className="settings-row-label">{t('Also save to catalog')}</div>
            <div className="settings-row-sub">{name ? t('Next time, scanning it adds “{name}” right away.', { name }) : t('Next time, scanning it adds it right away.')}</div>
          </div>
          <button className={`switch ${save ? 'on' : ''}`} role="switch" aria-checked={save} aria-labelledby="scan-save-label" onClick={() => setSave(v => !v)}><span className="knob" /></button>
        </div>
      )}
    </Sheet>
  )
}

/** "Where did you find it?" after a scan while shopping: the item's aisle at this store and its
 * department, whichever it's missing. Skip leaves it as it is. */
function PlaceSheet({ title, store, need, category: initialCategory, aisles, departments, onSave, onStop, onClose }: {
  title: string; store: string | null; need: { aisle: boolean; department: boolean }; category: string
  aisles: string[]; departments: string[]; onSave: (aisle: string, category: string) => void
  onStop: () => void // Stop asking on this trip
  onClose: () => void
}) {
  const [aisle, setAisle] = useState('')
  const [category, setCategory] = useState(initialCategory)
  return (
    <Sheet variant="dialog" title={t('Where did you find it?')} onClose={onClose}
      actions={<>
        <button className="btn btn-secondary" onClick={onClose}>{t('Skip')}</button>
        <button className="btn btn-primary" onClick={() => onSave(aisle.trim(), category.trim())} disabled={!aisle.trim() && !category.trim()}>{t('Save')}</button>
      </>}>
      <p className="scan-source">{need.aisle && store ? t("Where was {item}? Next trip it'll be in the right aisle.", { item: title }) : t("Where was {item}? Next trip it'll be in the right department.", { item: title })}</p>
      {need.aisle && store && <ValuePicker id="place-aisle" label={t('Aisle at {store}', { store })} value={aisle} options={aisles} newLabel={t('New aisle…')} placeholder={t('e.g. Aisle 4, Produce, Back wall')} onChange={setAisle} noneLabel={t('Pick an aisle')} />}
      {need.department && <ValuePicker id="place-dept" label={t('Department')} value={category} options={departments} newLabel={t('New department…')} placeholder={t('e.g. Dairy, Pantry')} onChange={setCategory} noneLabel={t('Pick a department')} />}
      <button type="button" className="link-btn" onClick={onStop}>{t('Stop asking on this trip')}</button>
    </Sheet>
  )
}

function ReorderGroupsSheet({ listId, groupBy, names, onClose, onSaved }: {
  listId: string; groupBy: 'store' | 'category'; names: string[]; onClose: () => void; onSaved: () => void
}) {
  const { toast } = useApp()
  const [order, setOrder] = useState(names)
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= order.length) return
    const next = [...order]
    ;[next[i], next[j]] = [next[j], next[i]]
    setOrder(next)
  }
  const save = async () => {
    try { await api.setListGroups(listId, order.map(name => ({ kind: groupBy, name }))); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not save order'), true) }
  }
  return (
    <Sheet title={groupBy === 'store' ? t('Reorder stores') : t('Reorder categories')} onClose={onClose}
      actions={<button className="btn btn-primary" onClick={save}>{t('Save')}</button>}>
      {order.map((name, i) => (
        <div key={name} className="settings-row">
          <div className="settings-row-label">{name}</div>
          <div className="chip-row">
            <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('Move {name} up', { name })}>▲</button>
            <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={t('Move {name} down', { name })}>▼</button>
          </div>
        </div>
      ))}
    </Sheet>
  )
}

/** Group, Sort and Show store for the list page (the Filter and sort button; Contacts uses the same pattern). */
function ListViewSheet({ list, stores, store, onStore, onGroupBy, onSortBy, onReorder, onClose }: {
  list: List; stores: string[]; store: string | null; onStore: (s: string | null) => void
  onGroupBy: (g: ListGroupBy) => void; onSortBy: (s: ListSortBy) => void; onReorder?: () => void; onClose: () => void
}) {
  const shopping = list.kind === 'shopping'
  const def = listViewDefaults(list.kind)
  const changed = list.groupBy !== def.groupBy || list.sortBy !== def.sortBy || store !== null
  return (
    <Sheet title={t('Filter and sort')} onClose={onClose} actions={<>
      <button className="btn btn-secondary" disabled={!changed} onClick={() => { if (shopping && list.groupBy !== def.groupBy) onGroupBy(def.groupBy); if (list.sortBy !== def.sortBy) onSortBy(def.sortBy); onStore(null) }}>{t('Reset')}</button>
      <button className="btn btn-primary" onClick={onClose}>{t('Done')}</button>
    </>}>
      {shopping && (
        <div className="field">
          <label htmlFor={`list-group-${list.id}`}>{t('Group by')}</label>
          <select id={`list-group-${list.id}`} value={list.groupBy} onChange={e => onGroupBy(e.target.value as ListGroupBy)}>
            {(['store', 'aisle', 'none'] as ListGroupBy[]).map(g => <option key={g} value={g}>{tm(GROUP_LABEL[g])}</option>) /* no category: a department fills in the aisle */}
          </select>
          {onReorder && <button className="link-btn" onClick={onReorder}>{list.groupBy === 'store' ? t('Reorder stores') : t('Reorder categories')}</button>}
        </div>
      )}
      <div className="field">
        <label htmlFor={`list-sort-${list.id}`}>{t('Sort')}</label>
        <select id={`list-sort-${list.id}`} value={list.sortBy} onChange={e => onSortBy(e.target.value as ListSortBy)}>
          {(Object.keys(SORT_LABEL) as ListSortBy[]).filter(k => (k !== 'aisle' || shopping || list.sortBy === 'aisle') && (k !== 'due' || !shopping || list.sortBy === 'due')) /* shopping items have no due dates */.map(k => <option key={k} value={k}>{tm(SORT_LABEL[k])}</option>)}
        </select>
        <p className="field-hint">{tm(SORT_HINT[list.sortBy])}{list.sortBy !== 'manual' && t('. Switch to Manual to drag items into your own order.')}</p>
      </div>
      {shopping && stores.length > 0 && (
        <div className="field">
          <label htmlFor={`list-store-${list.id}`}>{t('Show store')}</label>
          <select id={`list-store-${list.id}`} value={store ?? ''} onChange={e => onStore(e.target.value || null)}>
            <option value="">{t('All stores')}</option>
            {stores.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      )}
    </Sheet>
  )
}

function ItemRow({ item, kind, groupBy, members, event, onToggle, onOpen, handle, from, readOnly, onDelete }: {
  item: ListItem; kind: ListKind; groupBy: ListGroupBy; members: Member[]; event?: EventInstance; onToggle: () => void; onOpen: () => void
  onDelete?: () => void // parent devices: swipe the row left to delete (SwipeRow)
  readOnly?: boolean // a kid's device, someone else's item: the tick shows but doesn't change
  handle?: React.ReactNode
  from?: React.ReactNode // a combined trip: the other list it's on (FromTag)
}) {
  const assignee = kind !== 'shopping' && item.memberId ? members.find(m => m.id === item.memberId) : null
  const forWho = members.filter(m => item.forMemberIds?.includes(m.id))
  const forLabel = forWho.length ? t('For {names}', { names: new Intl.ListFormat(intlLocale()).format(forWho.map(m => m.name)) }) : null
  const showStore = kind === 'shopping' && groupBy !== 'store' && groupBy !== 'aisle' && item.store
  const showAisle = kind === 'shopping' && groupBy !== 'aisle' && item.aisle
  // A department that just repeats the aisle ("Produce · Produce") isn't shown twice.
  const showCategory = kind === 'shopping' && groupBy !== 'category' && item.category && item.category.toLowerCase() !== item.aisle?.toLowerCase()
  const due = dueLabel(item)
  const prio = item.priority !== 'normal' ? item.priority : null
  const notesOn = useApp().settings.features.notes // off: an item's own notes still show, its thread's count doesn't
  const row = (
    <div className={`list-item-row ${item.done ? 'done' : ''} ${prio === 'urgent' && !item.done ? 'urgent' : ''} ${item.pending ? 'pending' : ''}`} title={item.pending ? t('Not synced yet') : undefined}>
      <button className={`list-item-check ${item.done ? 'done' : ''} ${readOnly ? 'read-only' : ''}`} onClick={readOnly ? undefined : onToggle} role="checkbox" aria-checked={item.done} aria-disabled={readOnly || undefined}
        aria-label={item.pending ? t('{item}, not synced yet', { item: item.title }) : readOnly && assignee ? t("{item}, {name}'s", { item: item.title, name: assignee.name }) : item.title}>
        {item.done && <CheckIcon width={20} height={20} />}
      </button>
      <div className="list-item-body" {...pressable(onOpen)}
        aria-label={[t('Edit {title}', { title: item.title }), item.done && t('checked off'), prio && t('{priority} priority', { priority: tm(PRIORITY_LABEL[prio]) }), forLabel, due?.text, (item.notes || (notesOn && item.noteCount)) && t('has notes'), item.stepsTotal > 0 && t('{done} of {total} steps done', { done: item.stepsDone, total: item.stepsTotal })].filter(Boolean).join(', ')}>
        <div className="list-item-title-row">
          {prio && <PriorityBadge p={prio} />}
          <div className="list-item-title">{item.title}</div>
          {forLabel && <span className="list-item-for" role="img" aria-label={forLabel} title={forLabel}><InlineFaces who={forWho} /></span>}
          {from}
          {(item.notes || (notesOn && !!item.noteCount)) && <NoteIcon className="list-item-note" width={14} height={14} aria-hidden={false} role="img" aria-label={t('Has notes')} />}
        </div>
        {due && <div className={`list-item-meta list-item-due ${due.overdue ? 'overdue' : ''}`} aria-hidden="true">{due.text}</div>}
        {item.stepsTotal > 0 && (
          <div className="list-item-steps" aria-hidden="true">
            <span>{t('{done} of {total}', { done: item.stepsDone, total: item.stepsTotal })}</span>
            <div className="list-item-progress"><div style={{ width: `${(item.stepsDone / item.stepsTotal) * 100}%` }} /></div>
          </div>
        )}
        {(showStore || showAisle || showCategory) && (
          <div className="list-item-meta">{[showStore ? item.store : null, showAisle ? item.aisle : null, showCategory ? item.category : null].filter(Boolean).join(' · ')}</div>
        )}
        {!!item.meals?.length && <div className="list-item-meta list-item-meals"><span aria-hidden="true">🍽️ </span>{t('For {meals}', { meals: item.meals.join(', ') })}</div>}
        {event && <div className="list-item-meta" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><CalendarIcon width={12} height={12} style={{ flexShrink: 0 }} />{eventLabel(event)}</div>}
      </div>
      {item.onSale && <div className="list-item-chip list-item-sale"><span aria-hidden="true">🏷️ </span>{t('Sale')}</div>}
      {item.quantity && <div className="list-item-chip">{item.quantity}</div>}
      {assignee && <Face m={assignee} className="member-avatar-sm" role="img" aria-label={t('For {name}', { name: assignee.name })} />}
      {handle}
    </div>
  )
  return onDelete ? <SwipeRow title={item.title} onDelete={onDelete}>{row}</SwipeRow> : row
}

/** Swipe a row left (touch or pen; a mouse uses the item sheet) to show a Delete button; far enough
 * deletes outright. Vertical drags stay scrolls (touch-action: pan-y, axis picked after 10px), the
 * reorder grip keeps its own drag, and a tap elsewhere closes it, so one row is open at a time. */
function SwipeRow({ title, onDelete, children }: { title: string; onDelete: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [offset, setOffset] = useState(0)
  const [dragging, setDragging] = useState(false)
  const g = useRef<{ id: number; x: number; y: number; axis: 'x' | 'y' | null; w: number } | null>(null)
  const swallow = useRef(false) // the click that ends a swipe (or closes the row) doesn't also tick or open it
  const settle = (to: 'open' | 'closed') => { setOpen(to === 'open'); setOffset(to === 'open' ? -SWIPE_REVEAL : 0); setDragging(false); g.current = null }
  useEffect(() => {
    if (!open) return
    // A tap elsewhere only closes it (that tap doesn't also tick or open another row).
    const outside = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      settle('closed')
      const stop = (c: MouseEvent) => { c.stopPropagation(); c.preventDefault() }
      document.addEventListener('click', stop, { capture: true, once: true })
      setTimeout(() => document.removeEventListener('click', stop, true), 600) // it was a scroll: no click came
    }
    document.addEventListener('pointerdown', outside, true)
    return () => document.removeEventListener('pointerdown', outside, true)
  }, [open])
  const down = (e: React.PointerEvent) => {
    swallow.current = false
    if (e.pointerType === 'mouse' || (e.target as Element).closest('.list-item-grip, .swipe-delete')) return
    g.current = { id: e.pointerId, x: e.clientX, y: e.clientY, axis: null, w: ref.current?.clientWidth ?? 0 }
  }
  const move = (e: React.PointerEvent) => {
    const s = g.current
    if (!s || s.id !== e.pointerId) return
    const dx = e.clientX - s.x
    if (!s.axis) {
      s.axis = swipeAxis(dx, e.clientY - s.y)
      if (s.axis === 'y') { g.current = null; return }
      if (!s.axis) return
      try { ref.current?.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
      setDragging(true)
    }
    setOffset(swipeOffset(dx, open, s.w))
  }
  const up = (e: React.PointerEvent) => {
    const s = g.current
    if (!s || s.id !== e.pointerId) return
    if (!s.axis) { if (open) { swallow.current = true; settle('closed') } g.current = null; return } // a tap on an open row closes it
    swallow.current = true
    const end = swipeEnd(swipeOffset(e.clientX - s.x, open, s.w), s.w)
    if (end === 'delete') { settle('closed'); onDelete() } else settle(end)
  }
  return (
    <div ref={ref} className="swipe-row" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => settle(open ? 'open' : 'closed')}
      onClickCapture={e => { if (swallow.current) { swallow.current = false; e.stopPropagation(); e.preventDefault() } }}>
      <div className={`swipe-track ${dragging ? 'dragging' : ''}`} style={offset ? { transform: `translateX(${offset}px)` } : undefined}>
        {children}
        {offset < 0 && (
          <button className="swipe-delete" style={{ width: Math.max(SWIPE_REVEAL, -offset) }} onClick={() => { settle('closed'); onDelete() }} aria-label={t('Delete {item}', { item: title })}>
            <TrashIcon width={20} height={20} /><span>{t('Delete')}</span>
          </button>
        )}
      </div>
    </div>
  )
}

/** On a combined trip, which other list an item is on: that type's icon and the list's name. */
function FromTag({ name, catalog }: { name: string; catalog: ListCatalog }) {
  const Icon = catalog === 'groceries' ? BasketIcon : CartIcon
  return <span className="list-from-tag"><Icon width={12} height={12} aria-hidden="true" /><span className="sr-only">{t('On')} </span>{name}</span>
}

/** A row in shopping mode: the whole row ticks the item; ⓘ (onOpen) opens it over shopping mode,
 * to read its notes or fix the quantity without leaving the aisle. */
function ShopRow({ item, meta, onToggle, onOpen, from, readOnly }: { item: ListItem; meta?: string | null; onToggle: () => void; onOpen?: () => void; from?: React.ReactNode; readOnly?: boolean }) {
  const sub = [meta, item.notes?.split('\n')[0]].filter(Boolean).join(' · ')
  const row = (
    <button className={`shop-row ${item.done ? 'done' : ''} ${item.pending ? 'pending' : ''} ${readOnly ? 'read-only' : ''}`} role="checkbox" aria-checked={item.done} aria-disabled={readOnly || undefined}
      onClick={readOnly ? undefined : onToggle} title={item.pending ? t('Not synced yet') : undefined}>
      <span className="shop-check" aria-hidden="true">{item.done && <CheckIcon width={20} height={20} />}</span>
      <span className="shop-row-body">
        <span className="shop-row-title">{item.title}</span>
        {from}
        {sub && <span className="shop-row-note">{sub}</span>}
      </span>
      {item.onSale && <span className="list-item-chip list-item-sale"><span aria-hidden="true">🏷️ </span>{t('Sale')}</span>}
      {item.quantity && <span className="list-item-chip">{item.quantity}</span>}
    </button>
  )
  return !onOpen ? row : (
    <div className="shop-row-wrap">
      {row}
      <button type="button" className="icon-btn shop-row-info" onClick={onOpen} aria-haspopup="dialog" aria-label={t('{item} details', { item: item.title })}><InfoIcon width={22} height={22} /></button>
    </div>
  )
}

/** Rows reorderable by dragging their grip (mouse, touch or pen). The grip alone starts a drag, so
 * tapping the row still ticks/opens it and swiping elsewhere still scrolls. The dragged row follows
 * the pointer and a line marks where it will land; dropping reports the new order of these ids.
 * Holding it near the top or bottom edge scrolls. Keyboard: focus the grip, Alt+Up/Down moves the
 * item one place (announced). */
function DragList<T extends { id: string; title: string }>({ items, renderRow, onReorder, fixed }: {
  items: T[]
  renderRow: (item: T, handle: React.ReactNode) => React.ReactNode
  onReorder: (ids: string[]) => void
  fixed?: boolean // the order isn't hand-set (a sort other than Manual): no grip, nothing to drag
}) {
  const rowsRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: string; startY: number; scroll0: number; dy: number; mids: number[]; from: number; to: number } | null>(null)
  // Auto-scroll: holding the row near the top or bottom edge of whatever scrolls it scrolls that way.
  const scroller = useRef<HTMLElement | null>(null)
  const pointerY = useRef(0)
  // Reordering moves the row's DOM node, which drops focus; put it back on the moved item's grip.
  const refocus = useRef<string | null>(null)
  useLayoutEffect(() => {
    if (!refocus.current) return
    rowsRef.current?.querySelector<HTMLElement>(`[data-grip="${refocus.current}"]`)?.focus()
    refocus.current = null
  })
  const moveByKey = (e: React.KeyboardEvent, item: T) => {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const ids = items.map(i => i.id)
    const from = ids.indexOf(item.id), to = from + (e.key === 'ArrowUp' ? -1 : 1)
    if (to < 0 || to >= ids.length) { announce(to < 0 ? t('{item} is already first', { item: item.title }) : t('{item} is already last', { item: item.title })); return }
    ids.splice(from, 1); ids.splice(to, 0, item.id)
    refocus.current = item.id
    onReorder(ids)
    announce(t('{item} moved to position {n} of {total}', { item: item.title, n: to + 1, total: ids.length }))
  }

  const start = (e: React.PointerEvent, id: string) => {
    const rows = [...(rowsRef.current?.children ?? [])] as HTMLElement[]
    const mids = rows.map(r => { const b = r.getBoundingClientRect(); return b.top + b.height / 2 })
    const from = items.findIndex(i => i.id === id)
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    scroller.current = scrollParent(rowsRef.current)
    pointerY.current = e.clientY
    setDrag({ id, startY: e.clientY, scroll0: scroller.current.scrollTop, dy: 0, mids, from, to: from })
  }
  // Where the dragged row is now: pointer travel plus how far its container has scrolled since.
  const place = () => setDrag(d => {
    if (!d) return d
    const dy = pointerY.current - d.startY + (scroller.current?.scrollTop ?? d.scroll0) - d.scroll0
    const y = d.mids[d.from] + dy
    // Slot = how many other rows' midpoints the dragged row's midpoint is below.
    return { ...d, dy, to: d.mids.filter((m, i) => i !== d.from && m < y).length }
  })
  const move = (e: React.PointerEvent) => {
    if (!drag) return
    pointerY.current = e.clientY
    place()
  }
  const dragging = !!drag
  useEffect(() => {
    if (!dragging) return
    let frame = 0
    const tick = () => {
      const el = scroller.current
      if (el) {
        const box = el === document.scrollingElement ? { top: 0, bottom: innerHeight } : el.getBoundingClientRect()
        const y = pointerY.current
        const step = y < box.top + 56 ? -10 : y > box.bottom - 56 ? 10 : 0
        const before = el.scrollTop
        if (step) el.scrollTop += step
        if (el.scrollTop !== before) place()
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [dragging]) // eslint-disable-line react-hooks/exhaustive-deps
  const end = () => {
    if (!drag) return
    if (drag.to !== drag.from) {
      const ids = items.map(i => i.id).filter(id => id !== drag.id)
      ids.splice(drag.to, 0, drag.id)
      onReorder(ids)
    }
    setDrag(null)
  }

  return (
    <div ref={rowsRef}>
      {items.map((item, i) => {
        const dragging = drag?.id === item.id
        const handle = fixed ? null : (
          <button className="list-item-grip" data-grip={item.id} aria-label={t('Reorder {item}: drag, or Alt+Up and Alt+Down arrow', { item: item.title })}
            aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown" onKeyDown={e => moveByKey(e, item)}
            onPointerDown={e => start(e, item.id)} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              {[3, 8, 13].flatMap(y => [5, 11].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}
            </svg>
          </button>
        )
        // Drop marker above the row the item will land before (or below the last row).
        const markBefore = drag && !dragging && drag.to !== drag.from && i === (drag.to > drag.from ? drag.to + 1 : drag.to)
        const markAfter = drag && !dragging && drag.to !== drag.from && drag.to === items.length - 1 && i === items.length - 1
        return (
          <div key={item.id} className={`drag-row ${dragging ? 'dragging' : ''} ${markBefore ? 'drop-before' : ''} ${markAfter ? 'drop-after' : ''}`}
            style={dragging ? { transform: `translateY(${drag!.dy}px)` } : undefined}>
            {renderRow(item, handle)}
          </div>
        )
      })}
    </div>
  )
}

/** The nearest ancestor that scrolls (else the page). */
function scrollParent(el: HTMLElement | null): HTMLElement {
  for (let p = el?.parentElement; p; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY
    if ((o === 'auto' || o === 'scroll') && p.scrollHeight > p.clientHeight) return p
  }
  return (document.scrollingElement ?? document.documentElement) as HTMLElement
}

const OTHER_GROUP = msg('Other')

/** Groups items by list.groupBy, ordered by the saved ListGroup order then alphabetically, with
 * null-valued items last under "Other"; each group in `cmp` order. Store groups in manual order keep
 * a store's categories together, per SPEC. Aisle groups are per store ("Market · Produce"), in store
 * order then the store's aisle order. Returns [] (flat) when groupBy is 'none'. */
function groupItems(items: ListItem[], groupBy: ListGroupBy, savedOrder: string[], sortBy: ListSortBy, cmp: (a: ListItem, b: ListItem) => number, aisleOrder: AisleOrder): { name: string; items: ListItem[] }[] {
  if (groupBy === 'none') return []
  const keyOf = (i: ListItem) => groupBy === 'aisle' ? aisleGroup(i) : i[groupBy]
  const byKey = new Map<string, ListItem[]>()
  for (const item of items) {
    const key = keyOf(item) ?? OTHER_GROUP
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key)!.push(item)
  }
  // Manual: a store's categories stay together, then the list order; other sorts win outright.
  const cat = (a: ListItem, b: ListItem) => (groupBy === 'store' && sortBy === 'manual' ? (a.category ?? '￿').localeCompare(b.category ?? '￿') : 0)
  for (const list of byKey.values()) list.sort((a, b) => cat(a, b) || cmp(a, b))
  const saved = (a: string, b: string) => {
    const ia = savedOrder.indexOf(a), ib = savedOrder.indexOf(b)
    return ia >= 0 && ib >= 0 ? ia - ib : ia >= 0 ? -1 : ib >= 0 ? 1 : a.localeCompare(b)
  }
  const keys = [...byKey.keys()]
  keys.sort((a, b) => {
    if (a === OTHER_GROUP) return 1
    if (b === OTHER_GROUP) return -1
    if (groupBy !== 'aisle') return saved(a, b)
    const [sa, aa] = a.split('\u0000'), [sb, ab] = b.split('\u0000')
    return (sa && sb ? saved(sa, sb) : sa ? -1 : sb ? 1 : 0) || compareAisles(sa || null, aa, ab, aisleOrder)
  })
  const label = (key: string) => {
    if (key === OTHER_GROUP) return tm(OTHER_GROUP)
    if (groupBy !== 'aisle') return key
    const [store, aisle] = key.split('\u0000')
    return store ? `${store} · ${aisle}` : aisle
  }
  return keys.map(key => ({ name: label(key), items: byKey.get(key)! }))
}

/** "Stores & departments" (from a catalog): rename or remove a store, department (the category field) or aisle on every list
 * of this type and in its catalog, and drag a store's aisles into the order you walk them. Each list type has its own. */
function ManageValuesSheet({ catalog, suggestions, aisleOrder, onClose, onChanged }: {
  catalog: ListCatalog
  suggestions: ListDetail['suggestions']; aisleOrder: AisleOrder; onClose: () => void; onChanged: () => void
}) {
  const dialog = useDialog()
  const { toast, reloadCore } = useApp()
  type Field = 'store' | 'category' | 'aisle'
  const [editing, setEditing] = useState<{ field: Field; from: string } | null>(null)
  const [draft, setDraft] = useState('')
  const aisleStores = [...suggestions.stores, ...(suggestions.aisles.some(a => a.store === null) ? [null] : [])]
  const [store, setStore] = useState<string | null>(aisleStores[0] ?? null)
  const [newAisle, setNewAisle] = useState('')
  const [override, setOverride] = useState<{ store: string | null; aisles: string[] } | null>(null) // a drag, shown before the reload
  const aisles = override?.store === store ? override.aisles : storeAisles(suggestions, store, aisleOrder)

  const rename = async (field: Field, from: string, to: string | null) => {
    try {
      const { updated } = await api.renameListValue({ field, from, to, catalog, ...(field === 'aisle' ? { store } : {}) })
      announce(!to ? t('Removed {name}', { name: from }) : updated ? tn(updated, 'Renamed {from} to {to}, {n} item updated', 'Renamed {from} to {to}, {n} items updated', { from, to }) : t('Renamed {from} to {to}', { from, to }))
      setEditing(null); setOverride(null); onChanged()
    } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not save'), true) }
  }
  const remove = async (field: Field, value: string) => {
    const body = field === 'store' ? t('Items that use it keep everything else; this store is cleared from them and forgotten.')
      : field === 'aisle' ? t('Items that use it keep everything else; this aisle is cleared from them and forgotten.')
      : t('Items that use it keep everything else; this department is cleared from them and forgotten.')
    if (!await dialog.confirm({ title: t('Remove “{name}”?', { name: value }), body, confirmLabel: t('Remove'), danger: true })) return
    rename(field, value, null)
  }
  const saveOrder = async (next: string[]) => {
    setOverride({ store, aisles: next })
    try { await api.setStoreAisles(store, next, catalog); onChanged() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not save the aisle order'), true); setOverride(null) }
  }
  // ↑/↓ on each aisle (as in Edit lists): reordering without dragging inside a scrolling sheet.
  const nudgeAisle = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= aisles.length) return
    const next = [...aisles]
    ;[next[i], next[j]] = [next[j], next[i]]
    saveOrder(next)
    announce(t('{aisle} moved to position {n} of {total}', { aisle: aisles[i], n: j + 1, total: aisles.length }))
  }
  const aisleMoves = (a: string, i: number) => <>
    <button className="icon-btn" onClick={() => nudgeAisle(i, -1)} disabled={i === 0} aria-label={t('Move {name} up', { name: a })}><ChevronRight width={20} height={20} style={{ transform: 'rotate(-90deg)' }} /></button>
    <button className="icon-btn" onClick={() => nudgeAisle(i, 1)} disabled={i === aisles.length - 1} aria-label={t('Move {name} down', { name: a })}><ChevronRight width={20} height={20} style={{ transform: 'rotate(90deg)' }} /></button>
  </>
  // The default store for this list type (the same setting as Settings → Family → Shopping): Shop starts there.
  const defaultKey = catalog === 'groceries' ? 'defaultGroceryStore' : 'defaultShoppingStore'
  const [defaultStore, setDefaultStore] = useState(suggestions.defaultStore ?? null)
  const makeDefault = async (st: string) => {
    const to = defaultStore === st ? null : st
    try { await api.updateSettings({ [defaultKey]: to }); setDefaultStore(to); announce(to ? t('{store} is the default store', { store: to }) : t('No default store')); reloadCore(); onChanged() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not save the default store'), true) }
  }
  const star = (st: string) => (
    <button className="icon-btn manage-star" onClick={() => makeDefault(st)} aria-pressed={defaultStore === st} aria-label={t('Default store: {store}', { store: st })}
      title={defaultStore === st ? t('Default store') : t('Make it the default store')}><span aria-hidden="true">{defaultStore === st ? '★' : '☆'}</span></button>
  )
  const addAisle = () => {
    const name = newAisle.trim()
    if (!name || aisles.includes(name)) return
    setNewAisle('')
    saveOrder([...aisles, name])
  }

  const row = (field: Field, value: string, handle?: React.ReactNode) => editing?.field === field && editing.from === value ? (
    <div className="manage-row" key={value}>
      <input type="text" value={draft} onChange={e => setDraft(e.target.value)} aria-label={t('New name for {name}', { name: value })} maxLength={60} autoFocus
        onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) rename(field, value, draft.trim()); if (e.key === 'Escape') setEditing(null) }} />
      <button className="btn btn-primary" disabled={!draft.trim() || draft.trim() === value} onClick={() => rename(field, value, draft.trim())}>{t('Save')}</button>
      <button className="btn btn-secondary" onClick={() => setEditing(null)}>{t('Cancel')}</button>
    </div>
  ) : (
    <div className="manage-row" key={value}>
      <span className="manage-row-name">{value}</span>
      <button className="link-btn" onClick={() => { setEditing({ field, from: value }); setDraft(value) }} aria-label={t('Rename {name}', { name: value })}>{t('Rename')}</button>
      <button className="icon-btn" onClick={() => remove(field, value)} aria-label={t('Remove {name}', { name: value })}><TrashIcon width={16} height={16} /></button>
      {handle}
    </div>
  )

  return (
    <Sheet title={t('Stores & departments')} onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>{t('Done')}</button>}>
      <p className="field-hint">{catalog === 'groceries' ? t('For grocery lists.') : t('For shopping lists other than groceries.')} {t('Renaming changes every item that uses the name on those lists. Removing clears it from those items.')}</p>
      <h3 className="manage-head">{t('Stores')}</h3>
      {suggestions.stores.length > 0 && <p className="field-hint">{t('★ marks the default store: Shop starts there without asking where you are. Tap a star to change it.')}</p>}
      {suggestions.stores.length ? suggestions.stores.map(v => row('store', v, star(v))) : <p className="list-item-meta">{t('No stores yet. Pick one on an item.')}</p>}
      <h3 className="manage-head">{t('Departments')}</h3>
      <p className="field-hint">{t('An item with no aisle at a store goes in the aisle named like its department, if the store has one.')}</p>
      {suggestions.categories.length ? suggestions.categories.map(v => row('category', v)) : <p className="list-item-meta">{t('No departments yet.')}</p>}
      <h3 className="manage-head">{t('Aisles')}</h3>
      {aisleStores.length > 1 && (
        <div className="field">
          <label htmlFor="manage-aisle-store">{t('Store')}</label>
          <select id="manage-aisle-store" value={store ?? ''} onChange={e => { setStore(e.target.value || null); setEditing(null) }}>
            {aisleStores.map(st => <option key={st ?? ''} value={st ?? ''}>{st ?? t('No store')}</option>)}
          </select>
        </div>
      )}
      <p className="field-hint">{store ? t('Put the aisles in the order you walk {store} (drag them, or use ↑ and ↓). Aisle sort follows it.', { store }) : t('Put the aisles in the order you walk the store (drag them, or use ↑ and ↓). Aisle sort follows it.')}</p>
      <DragList items={aisles.map(a => ({ id: a, title: a }))} onReorder={saveOrder} renderRow={(a, handle) => row('aisle', a.id, <>{aisleMoves(a.id, aisles.indexOf(a.id))}{handle}</>)} />
      <div className="list-add-bar step-add">
        <input type="text" value={newAisle} onChange={e => setNewAisle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addAisle() }} maxLength={60}
          placeholder={`${store ? t('Add an aisle at {store}', { store }) : t('Add an aisle')}…`} aria-label={store ? t('Add an aisle at {store}', { store }) : t('Add an aisle')} enterKeyHint="done" />
        <button className="icon-btn" onClick={addAisle} disabled={!newAisle.trim()} aria-label={t('Add aisle')}><PlusIcon width={20} height={20} /></button>
      </div>
    </Sheet>
  )
}

/** A list type's catalog (Grocery or Shopping): everything the family has bought before on lists of that type, its department, the family's own
 * categories and where it's found at each store. Search; filter by store, category and department
 * (they combine) and sort and group (kept per device) in the Filter and sort sheet, which applies live over it;
 * add one to this list, or tap it to edit (a sheet in place). */
function ListCatalogSheet({ catalog, listId, listName, onList, suggestions, aisleOrder, onClose, onChanged }: {
  catalog: ListCatalog; listId: string; listName: string; onList: Set<string>; suggestions: ListDetail['suggestions']; aisleOrder: AisleOrder
  onClose: () => void; onChanged: () => void // onChanged: this list (and its pickers) may have changed
}) {
  const { toast, parentDevice, focusLocked, meMemberId } = useApp()
  const kid = !parentDevice && focusLocked && !!meMemberId // a kid's own device: browse and add, but the catalog is changed from a grown-up's device or a wall screen
  const [items, setItems] = useState<RememberedItem[] | null>(null)
  const [query, setQuery] = useState('')
  const [store, setStore] = useState<string | null>(null)
  const [tag, setTag] = useState<string | null>(null)
  const [department, setDepartment] = useState<string | null>(null)
  const [view, setView] = useState(catalogView)
  const [filtering, setFiltering] = useState(false) // the Filter and sort sheet, over this one
  const [editing, setEditing] = useState<RememberedItem | 'new' | 'tags' | 'stores' | null>(null)
  const load = () => api.getRemembered(catalog).then(setItems).catch(() => { setItems([]); toast(t('Could not load the catalog'), true) })
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const all = items ?? []
  const stores = catalogStores(all), tags = catalogTags(all), departments = catalogDepartments(all)
  const atStore = store && stores.includes(store) ? store : null
  const onlyTag = tags.find(x => x.name === tag)?.name ?? null
  const onlyDept = departments.find(d => d.name === department)?.name ?? null
  const sort: CatalogSort = view.sort === 'aisle' && !atStore ? 'alpha' : view.sort // aisle order needs a store
  const shown = sortCatalog(filterCatalog(all, query, atStore, { tag: onlyTag, department: onlyDept }), sort, atStore, aisleOrder)
  const sections = groupCatalog(shown, view.group)
  const changeView = (next: Partial<typeof view>) => { const v = { ...view, ...next }; setView(v); setCatalogView(v) }
  const filters = { store: atStore, tag: onlyTag, department: onlyDept }
  const active = activeCatalogFilters(filters)
  const summary = catalogFilterSummary(filters, { sort, group: view.group })
  const clearFilters = () => { setStore(null); setTag(null); setDepartment(null) }
  const add = async (i: RememberedItem) => {
    // Filtered to a store: planned for it (its aisle there comes along); else wherever it was last bought.
    try { await api.queueAddListItem(listId, { title: i.title, ...(atStore ? { store: atStore } : {}) }); announce(t('Added {item} to {list}', { item: i.title, list: listName })); onChanged() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not add item'), true) }
  }
  const saved = () => { setEditing(null); load(); onChanged() }
  const chip = (label: string, on: boolean, pick: () => void, count?: number) => (
    <button key={label} className={`chip ${on ? 'active' : ''}`} aria-pressed={on} onClick={pick}>
      {label}{count !== undefined && <span className="chip-count">{count}</span>}
    </button>
  )

  if (editing === 'stores') return <ManageValuesSheet catalog={catalog} suggestions={suggestions} aisleOrder={aisleOrder} onClose={() => { setEditing(null); load() }} onChanged={onChanged} />
  if (editing === 'tags') return <CatalogTagsSheet catalog={catalog} tags={tags} onClose={() => setEditing(null)} onChanged={() => { load(); onChanged() }} />
  if (editing) return (
    <CatalogItemSheet catalog={catalog} item={editing === 'new' ? null : editing} newTitle={query.trim()} suggestions={suggestions} aisleOrder={aisleOrder} familyTags={tags.map(x => x.name)}
      onClose={() => setEditing(null)} onSaved={saved} />
  )
  const row = (i: RememberedItem) => (
    <div className="catalog-row" key={i.key}>
      <button className="catalog-row-main" onClick={kid ? undefined : () => setEditing(i)} disabled={kid} aria-label={kid ? i.title : t('Edit {item}', { item: i.title })}>
        <span className="catalog-row-title">{i.title}</span>
        <span className="catalog-row-meta">{[i.category, i.tags.length ? `🏷️ ${i.tags.join(', ')}` : null, boughtLabel(i.uses)].filter(Boolean).join(' · ')}</span>
        {i.places.length > 0 && (
          <span className="catalog-row-places">
            {placesFor(i, atStore).map(p => <span key={p.store} className="chip chip-static">{placeLabel(p)}</span>)}
          </span>
        )}
      </button>
      {onList.has(i.key)
        ? <span className="catalog-on-list"><CheckIcon width={16} height={16} aria-hidden="true" />{t('On list')}</span>
        : <button className="icon-btn catalog-add" onClick={() => add(i)} aria-label={t('Add {item} to {list}', { item: i.title, list: listName })} title={t('Add to {list}', { list: listName })}><PlusIcon width={20} height={20} /></button>}
    </div>
  )
  return (
    <Sheet title={catalogName(catalog)} onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>{t('Done')}</button>}>
      <div className="catalog-bar">
        <input type="search" className="manage-find" value={query} onChange={e => setQuery(e.target.value)} placeholder={t('Find an item…')} aria-label={t('Find an item')} autoComplete="off" />
        <button className="btn btn-secondary catalog-options-btn" onClick={() => setFiltering(true)} aria-haspopup="dialog" title={t('Filter and sort')}
          aria-label={filterSortLabel(active)}>
          <FilterIcon width={18} height={18} /><span className="catalog-options-label">{t('Filter and sort')}</span>{active > 0 && <span className="catalog-options-on" aria-hidden="true">{active}</span>}
        </button>
        {!kid && <button className="btn btn-secondary" onClick={() => setEditing('new')}><PlusIcon width={18} height={18} />{t('New')}</button>}
      </div>
      {summary && (
        <div className="catalog-summary">
          <button className="filter-summary" onClick={() => setFiltering(true)} aria-label={t('Filters: {summary}. Change filters', { summary })}>{summary}</button>
          <button className="link-btn" onClick={clearFilters}>{t('Clear')}</button>
        </div>
      )}
      {filtering && (
        <Sheet title={t('Filter and sort')} onClose={() => setFiltering(false)} actions={<>
          <button className="btn btn-secondary" disabled={!active && sort === 'alpha' && view.group === 'none'} onClick={() => { clearFilters(); changeView({ sort: 'alpha', group: 'none' }) }}>{t('Reset')}</button>
          <button className="btn btn-primary" onClick={() => setFiltering(false)}>{t('Done')}</button>
        </>}>
          {stores.length > 0 && <>
            <h3 className="manage-head">{t('Store')}</h3>
            <div className="chip-row" role="group" aria-label={t('Store')}>
              {[null, ...stores].map(st => chip(st ?? t('All stores'), atStore === st, () => setStore(st)))}
            </div>
          </>}
          {tags.length > 0 && <>
            <h3 className="manage-head">{t('Category')}</h3>
            <div className="chip-row" role="group" aria-label={t('Category')}>
              {chip(t('All categories'), !onlyTag, () => setTag(null))}
              {tags.map(x => chip(x.name, onlyTag === x.name, () => setTag(onlyTag === x.name ? null : x.name), x.count))}
            </div>
          </>}
          {departments.length > 0 && <>
            <h3 className="manage-head">{t('Department')}</h3>
            <div className="chip-row" role="group" aria-label={t('Department')}>
              {chip(t('All departments'), !onlyDept, () => setDepartment(null))}
              {departments.map(d => chip(d.name, onlyDept === d.name, () => setDepartment(onlyDept === d.name ? null : d.name), d.count))}
            </div>
          </>}
          <div className="catalog-view">
            <div className="field">
              <label htmlFor="catalog-sort">{t('Sort')}</label>
              <select id="catalog-sort" className="settings-select" value={sort} onChange={e => changeView({ sort: e.target.value as CatalogSort })}>
                {(Object.keys(CATALOG_SORT_LABELS) as CatalogSort[]).filter(k => k !== 'aisle' || atStore).map(k =>
                  <option key={k} value={k}>{k === 'aisle' ? t('Aisle at {store}', { store: atStore ?? '' }) : tm(CATALOG_SORT_LABELS[k])}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="catalog-group">{t('Group by')}</label>
              <select id="catalog-group" className="settings-select" value={view.group} onChange={e => changeView({ group: e.target.value as CatalogGroup })}>
                {(Object.keys(CATALOG_GROUP_LABELS) as CatalogGroup[]).map(k => <option key={k} value={k}>{tm(CATALOG_GROUP_LABELS[k])}</option>)}
              </select>
            </div>
          </div>
          {parentDevice && <button className="link-btn" onClick={() => { setFiltering(false); setEditing('tags') }}>{t('Edit categories')}</button>} {/* renaming or removing one everywhere is parents only */}
        </Sheet>
      )}
      {parentDevice && <button className="btn btn-secondary btn-block catalog-stores-btn" onClick={() => setEditing('stores')}>{t('Stores & departments')}</button>} {/* renaming everywhere is parents only */}
      {items === null ? <p className="list-item-meta">{t('Loading…')}</p>
        : !shown.length ? <p className="list-item-meta">{items.length ? (query.trim() ? t('Nothing by that name.') : t('Nothing matches these filters.')) : t('Nothing yet. Items you add to a shopping list show up here.')}</p>
        : sections.map(sec => sec.name === null ? sec.items.map(row) : (
          <section key={sec.name} aria-label={sec.name}>
            <h3 className="manage-head catalog-group">{sec.name} <span className="catalog-group-count">{sec.items.length}</span></h3>
            {sec.items.map(row)}
          </section>
        ))}
    </Sheet>
  )
}

/** Rename or remove a catalog category on every item that has it. */
function CatalogTagsSheet({ catalog, tags, onClose, onChanged }: { catalog: ListCatalog; tags: { name: string; count: number }[]; onClose: () => void; onChanged: () => void }) {
  const dialog = useDialog()
  const { toast } = useApp()
  const [list, setList] = useState(tags)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const rename = async (from: string, to: string | null) => {
    try {
      await api.renameCatalogTag(catalog, from, to)
      announce(to ? t('Renamed {from} to {to}', { from, to }) : t('Removed {name}', { name: from }))
      setList(to ? list.filter(x => x.name !== from && x.name.toLowerCase() !== to.toLowerCase()).concat({ name: to, count: 0 }).sort((a, b) => a.name.localeCompare(b.name)) : list.filter(x => x.name !== from))
      setEditing(null); onChanged()
    } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not save'), true) }
  }
  const remove = async (name: string) => {
    if (await dialog.confirm({ title: t('Remove “{name}”?', { name }), body: t('Items keep everything else; this category is taken off them.'), confirmLabel: t('Remove'), danger: true })) rename(name, null)
  }
  return (
    <Sheet title={t('Categories')} onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>{t('Done')}</button>}>
      <p className="field-hint">{t('Renaming changes every catalog item in the category. Removing takes it off them.')}</p>
      {!list.length && <p className="list-item-meta">{t('No categories yet. Add one to an item.')}</p>}
      {list.map(({ name }) => editing === name ? (
        <div className="manage-row" key={name}>
          <input type="text" value={draft} onChange={e => setDraft(e.target.value)} aria-label={t('New name for {name}', { name })} maxLength={40} autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) rename(name, draft.trim()); if (e.key === 'Escape') setEditing(null) }} />
          <button className="btn btn-primary" disabled={!draft.trim() || draft.trim() === name} onClick={() => rename(name, draft.trim())}>{t('Save')}</button>
          <button className="btn btn-secondary" onClick={() => setEditing(null)}>{t('Cancel')}</button>
        </div>
      ) : (
        <div className="manage-row" key={name}>
          <span className="manage-row-name">{name}</span>
          <button className="link-btn" onClick={() => { setEditing(name); setDraft(name) }} aria-label={t('Rename {name}', { name })}>{t('Rename')}</button>
          <button className="icon-btn" onClick={() => remove(name)} aria-label={t('Remove {name}', { name })}><TrashIcon width={16} height={16} /></button>
        </div>
      ))}
    </Sheet>
  )
}

/** Edit (or add) a catalog item: its name, department and the stores it's found at, each with its aisle. */
function CatalogItemSheet({ catalog, item, newTitle, suggestions, aisleOrder, familyTags, onClose, onSaved }: {
  catalog: ListCatalog; item: RememberedItem | null; newTitle: string; suggestions: ListDetail['suggestions']; aisleOrder: AisleOrder
  familyTags: string[] // every category the family uses, for picking
  onClose: () => void; onSaved: () => void
}) {
  const dialog = useDialog()
  const { toast } = useApp()
  const [title, setTitle] = useState(item?.title ?? newTitle)
  const [category, setCategory] = useState(item?.category ?? '')
  const [rows, setRows] = useState(() => (item?.places ?? []).map(p => ({ store: p.store, aisle: p.aisle ?? '' })))
  const [newStore, setNewStore] = useState('')
  const [pickerKey, setPickerKey] = useState(0) // resets the "Add a store" picker after an add
  const [tags, setTags] = useState(item?.tags ?? [])
  const [newTag, setNewTag] = useState('')
  // The family's categories to pick from; until it has some, a few starters (one tap adds one).
  const starters = !familyTags.length
  const tagOptions = tagsInput([...(starters ? STARTER_TAGS : familyTags), ...tags], familyTags)
  const has = (tag: string) => tags.some(x => x.toLowerCase() === tag.toLowerCase())
  const toggleTag = (tag: string) => setTags(has(tag) ? tags.filter(x => x.toLowerCase() !== tag.toLowerCase()) : tagsInput([...tags, tag], familyTags).slice(0, 10))
  const addTag = () => { if (newTag.trim()) setTags(tagsInput([...tags, newTag], familyTags).slice(0, 10)); setNewTag('') }
  const otherStores = suggestions.stores.filter(st => !rows.some(r => r.store === st))
  const addStore = (name: string) => {
    const st = name.trim()
    if (st && !rows.some(r => r.store === st)) setRows([...rows, { store: st, aisle: '' }])
    setNewStore(''); setPickerKey(k => k + 1)
  }
  const save = async () => {
    const body = { title: title.replace(/\s+/g, ' ').trim(), category: category.trim() || null, places: placesInput(rows), tags: tagsInput(newTag.trim() ? [...tags, newTag] : tags, familyTags).slice(0, 10) }
    if (!body.title) return
    try {
      if (item) await api.updateRemembered(catalog, item.key, body)
      else await api.addRemembered(catalog, body)
      announce(t('Saved: {name}', { name: body.title })); onSaved()
    } catch (e) { toast(e instanceof Error && e.message ? e.message : t('Could not save'), true) }
  }
  const forget = async () => {
    if (!item || !await dialog.confirm({ title: t('Forget “{name}”?', { name: item.title }), body: t('It leaves the catalog, stops being suggested as you add, and where it goes is forgotten. Items on lists keep it.'), confirmLabel: t('Forget'), danger: true })) return
    try { await api.forgetItemName(catalog, item.key); announce(t('Forgot {name}', { name: item.title })); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not forget it'), true) }
  }
  return (
    <Sheet title={item ? t('Edit catalog item') : t('New catalog item')} onClose={onClose}
      actions={<button className="btn btn-primary" onClick={save} disabled={!title.trim()}>{t('Save')}</button>}>
      <div className="field">
        <label htmlFor="catalog-title">{t('Name')}</label>
        <input id="catalog-title" type="text" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} autoComplete="off" autoFocus={!item} placeholder={t('e.g. Oat milk')} />
      </div>
      <ValuePicker id="catalog-category" label={t('Department')} value={category} options={suggestions.categories} newLabel={t('New department…')} placeholder={t('e.g. Produce')} onChange={setCategory} />
      <h3 className="manage-head">{t('Categories')}</h3>
      <p className="field-hint catalog-hint">{starters ? t('Your own groupings, like Breakfast or Lunchbox. Tap any that fit, or add your own.') : t('Your own groupings. Tap any that fit, or add a new one.')}</p>
      <div className="chip-row catalog-tag-picks" role="group" aria-label={t('Categories')}>
        {tagOptions.map(tag => (
          <button key={tag} className={`chip ${has(tag) ? 'active' : ''}`} aria-pressed={has(tag)} onClick={() => toggleTag(tag)} disabled={!has(tag) && tags.length >= 10}>
            {!has(tag) && <PlusIcon width={14} height={14} aria-hidden="true" />}{starters && STARTER_TAGS.includes(tag) ? tm(tag) : tag /* a starter shows translated, saves in English */}
          </button>
        ))}
      </div>
      <div className="catalog-place">
        <div className="field">
          <label htmlFor="catalog-new-tag">{t('New category')}</label>
          <input id="catalog-new-tag" type="text" value={newTag} onChange={e => setNewTag(e.target.value)} maxLength={40} list="catalog-tag-list" autoComplete="off"
            placeholder={t('e.g. Snacks')} enterKeyHint="done" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} />
          <datalist id="catalog-tag-list">{familyTags.filter(tag => !has(tag)).map(tag => <option key={tag} value={tag} />)}</datalist>
        </div>
        <button className="btn btn-secondary" onClick={addTag} disabled={!newTag.trim() || tags.length >= 10}>{t('Add')}</button>
      </div>
      <h3 className="manage-head">{t('Stores')}</h3>
      <p className="field-hint catalog-hint">{t("Where it's found. Adding it to a list at one of these stores puts it in that aisle.")}</p>
      {rows.map((r, n) => (
        <div className="catalog-place" key={r.store}>
          <ValuePicker id={`catalog-aisle-${n}`} label={t('Aisle at {store}', { store: r.store })} value={r.aisle} noneLabel={t('Not known')} options={storeAisles(suggestions, r.store, aisleOrder)}
            newLabel={t('New aisle…')} placeholder={t('e.g. Aisle 4, Produce, Back wall')} onChange={v => setRows(rows.map((x, i) => i === n ? { ...x, aisle: v } : x))} />
          <button className="icon-btn" onClick={() => setRows(rows.filter((_, i) => i !== n))} aria-label={t('Remove {name}', { name: r.store })}><TrashIcon width={18} height={18} /></button>
        </div>
      ))}
      <div className="catalog-place">
        <ValuePicker key={pickerKey} id="catalog-add-store" label={t('Add a store')} value={newStore} options={otherStores} noneLabel={t('Pick a store…')} newLabel={t('New store…')} placeholder={t('Store name')}
          onChange={v => otherStores.includes(v) ? addStore(v) : setNewStore(v)} />
        {newStore.trim() && <button className="btn btn-secondary" onClick={() => addStore(newStore)}>{t('Add')}</button>}
      </div>
      {item && <>
        <p className="field-hint catalog-stats">{item.lastStore ? t('{bought}, last at {store}.', { bought: boughtLabel(item.uses), store: item.lastStore }) : `${boughtLabel(item.uses)}.`}</p>
        <div className="sheet-danger-zone"><button className="link-btn link-danger" onClick={forget}>{t('Forget this item')}</button></div>
      </>}
    </Sheet>
  )
}

/** Checkout with items left over at one store: "Didn't find these?" - pick another store (or
 * Anywhere) for any of them, or leave them as they are. Either way Checkout goes ahead after;
 * closing it (✕, Escape, a swipe) is "not yet": back to the trip, nothing ended. */
function LeftoversSheet({ items, trip, stores, onDone, onCancel }: {
  items: ListItem[]; trip: string; stores: string[]; onDone: (moves: { item: ListItem; store: string | null }[]) => void; onCancel: () => void
}) {
  const [picked, setPicked] = useState<Record<string, string>>(() => Object.fromEntries(items.map(i => [i.id, i.store ?? ''])))
  const moves = items.filter(i => picked[i.id].trim() !== (i.store ?? '')).map(item => ({ item, store: picked[item.id].trim() || null }))
  const leave = () => onDone([])
  return (
    <Sheet title={t("Didn't find these?")} onClose={onCancel} actions={<>
      <button className="btn btn-secondary" onClick={leave}>{t('Leave them as they are')}</button>
      {moves.length > 0 && <button className="btn btn-primary" onClick={() => onDone(moves)}>{t('Move {n}', { n: moves.length })}</button>}
    </>}>
      <p className="field-hint">{t('Still on the list after {store}. Pick where to look for them next time.', { store: trip })}</p>
      {items.map(i => (
        <ValuePicker key={i.id} id={`leftover-${i.id}`} label={i.title} className="leftover-pick" value={picked[i.id]} options={stores} newLabel={t('New store…')} placeholder={t('Store name')} noneLabel={t('Anywhere')}
          onChange={v => setPicked(p => ({ ...p, [i.id]: v }))} />
      ))}
    </Sheet>
  )
}

/** The add field. On a shopping list it autocompletes (a combobox): up to 6 remembered names as you
 * type, with where each goes; ↑/↓ and Enter or a tap adds one straight away, Enter with none
 * highlighted adds what's typed, Escape closes the list. `above` opens it above the field (Shopping
 * mode's bottom dock, clear of the on-screen keyboard), where an empty field also offers "Buy again".
 * With onPick (the Add item sheet), a tapped suggestion fills the name instead of adding it. */
function ItemAddField({ id, value, onChange, onAdd, onPick, suggestions, onList, inputRef, above, buyAgain, label, placeholder, autoFocus, onEscape }: {
  id: string; value: string; onChange: (v: string) => void; onAdd: (title: string) => void; onPick?: (title: string) => void
  suggestions?: ItemSuggestion[]; onList: Set<string> // keys of the open items, not suggested
  inputRef: React.RefObject<HTMLInputElement>; above?: boolean; buyAgain?: boolean
  label: string; placeholder: string; autoFocus?: boolean; onEscape?: (e: React.KeyboardEvent) => void
}) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const matches = open && suggestions ? matchItems(value, suggestions, onList) : []
  const again = buyAgain && !value.trim() && suggestions ? suggestions.filter(s => s.uses > 0 && !onList.has(s.key)).slice(0, 6) : []
  const listId = `${id}-suggest`
  const pick = (title: string, tapped = false) => { setOpen(false); setActive(-1); (tapped && onPick ? onPick : onAdd)(title) }
  const hint = (s: ItemSuggestion) => [s.category ?? s.place?.aisle, s.place?.store].filter(Boolean).join(' · ')
  const keepFocus = (e: React.MouseEvent) => e.preventDefault() // a tap doesn't close the keyboard
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.nativeEvent.isComposing) return
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && matches.length) {
      e.preventDefault()
      const n = matches.length
      setActive(a => (e.key === 'ArrowDown' ? (a + 1) % n : (a <= 0 ? n : a) - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      pick(active >= 0 && matches[active] ? matches[active].title : value)
    } else if (e.key === 'Escape') {
      if (matches.length) { e.stopPropagation(); setOpen(false); setActive(-1) } else onEscape?.(e)
    }
  }
  return (
    <div className={`item-add${above ? ' above' : ''}`}>
      <input ref={inputRef} id={id} type="text" value={value} placeholder={placeholder} aria-label={label} enterKeyHint="done" autoFocus={autoFocus} data-autofocus={autoFocus || undefined}
        // The browser's autofill stays off (the item suggestions below replace it); the keyboard's
        // spell check and autocorrect stay on, so a new item doesn't go in with a typo.
        autoComplete="off" autoCorrect="on" autoCapitalize="sentences" spellCheck
        onChange={e => { onChange(e.target.value); setOpen(true); setActive(-1) }} onKeyDown={onKeyDown}
        onBlur={() => { setOpen(false); setActive(-1) }}
        {...(suggestions ? {
          role: 'combobox', 'aria-autocomplete': 'list' as const, 'aria-expanded': matches.length > 0,
          'aria-controls': matches.length ? listId : undefined, 'aria-activedescendant': active >= 0 && matches[active] ? `${listId}-${active}` : undefined,
        } : {})} />
      {matches.length > 0 && (
        <ul id={listId} role="listbox" aria-label={t('Suggestions')} className="item-suggest">
          {matches.map((s, i) => (
            <li key={s.key} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'active' : undefined}
              onMouseDown={keepFocus} onClick={() => pick(s.title, true)}>
              <span className="item-suggest-name">{s.title}</span>
              {hint(s) && <span className="item-suggest-hint">{hint(s)}</span>}
            </li>
          ))}
        </ul>
      )}
      {again.length > 0 && (
        <div className="item-again" role="group" aria-label={t('Buy again')}>
          <span className="item-again-label" aria-hidden="true">{t('Buy again')}</span>
          {again.map(s => <button key={s.key} type="button" className="chip" onMouseDown={keepFocus} onClick={() => pick(s.title, true)} aria-label={onPick ? s.title : t('Add {item}', { item: s.title })}>{s.title}</button>)}
        </div>
      )}
    </div>
  )
}

/** Add item (shopping lists): the name with its suggestions, then where it goes and the rest. A
 * place left alone is filled in by the server from what the catalog remembers for the name (shown
 * here as a preview); on a trip the item is planned for the trip's store. Enter in the name is Add
 * another, so several items still go in quickly. Adds are queued, so they work offline too. */
function ItemAddSheet({ listId, listName, members, suggestions, aisleOrder, onList, trip, onAdded, onClose }: {
  listId: string; listName: string; members: Member[]; suggestions: ListDetail['suggestions']; aisleOrder: AisleOrder
  onList: Set<string>; trip: string | null; onAdded: (op: Op | null) => void; onClose: () => void
}) {
  const { toast } = useApp()
  const nameRef = useRef<HTMLInputElement>(null)
  const [title, setTitle] = useState('')
  const [quantity, setQuantity] = useState('')
  const [place, setPlace] = useState<{ store: string; aisle: string | null } | null>(null) // null: from the catalog; aisle null: the same
  const [forIds, setForIds] = useState<string[]>([])
  const [onSale, setOnSale] = useState(false)
  const [notes, setNotes] = useState('')
  const known = suggestions.items?.find(s => s.key === itemKey(title))
  const store = place?.store ?? trip ?? known?.place?.store ?? ''
  const aisle = place?.aisle ?? (known?.place?.store === store.trim() ? known.place.aisle ?? '' : '')

  const add = async (name: string, another: boolean) => {
    const clean = name.replace(/\s+/g, ' ').trim()
    if (!clean) return
    const body: ListItemInput = {
      id: crypto.randomUUID(), title: clean, quantity: quantity.trim() || null, notes: notes.trim() || null,
      ...(place ? { store: place.store.trim() || null } : trip ? { store: trip } : {}),
      ...(place?.aisle != null ? { aisle: place.aisle.trim() || null } : {}),
      ...(forIds.length ? { forMemberIds: forIds } : {}), ...(onSale ? { onSale } : {}),
    }
    try { onAdded(await api.queueAddListItem(listId, body)) }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not add item'), true); return }
    announce(t('Added {item} to {list}', { item: clean, list: listName }))
    if (!another) return onClose()
    setTitle(''); setQuantity(''); setForIds([]); setOnSale(false); setNotes('')
    setPlace(p => p && { store: p.store, aisle: null }) // a store picked stays for the next one
    nameRef.current?.focus()
  }

  return (
    <Sheet title={t('Add item')} onClose={onClose} dirty={!!(title.trim() || quantity.trim() || notes.trim())} actions={<>
      <button className="btn btn-secondary" onClick={() => add(title, true)} disabled={!title.trim()}>{t('Add another')}</button>
      <button className="btn btn-primary" onClick={() => add(title, false)} disabled={!title.trim()}>{t('Add')}</button>
    </>}>
      <div className="field">
        <label htmlFor={`add-name-${listId}`}>{t('Name')}</label>
        <ItemAddField id={`add-name-${listId}`} value={title} onChange={setTitle} onAdd={x => add(x, true)} onPick={setTitle} suggestions={suggestions.items} onList={onList}
          inputRef={nameRef} buyAgain autoFocus label={t('Name')} placeholder={t('e.g. Milk')} />
      </div>
      <ItemPlaceFields shopping quantity={quantity} onQuantity={setQuantity} store={store} aisle={aisle} aisleStore={store.trim() || null}
        category={known?.category ?? ''} suggestions={suggestions} aisleOrder={aisleOrder}
        onStore={v => setPlace({ store: v, aisle: null })} onAisle={v => setPlace({ store, aisle: v })} />
      <MemberPicker members={members} selected={forIds} onChange={setForIds} label={t('For')} noneLabel={t('Everyone')} />
      <SaleField id={`add-sale-${listId}`} on={onSale} onChange={setOnSale} />
      <div className="field">
        <label htmlFor={`add-notes-${listId}`}>{t('Notes')}</label>
        <textarea id={`add-notes-${listId}`} className="item-notes-input" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
    </Sheet>
  )
}

function ListDetailPane({ listId, lists, isPhone, shopMode, onBack, onArchivedOrDeleted, onLoaded }: {
  listId: string; isPhone: boolean; onBack: () => void; onArchivedOrDeleted: () => void; onLoaded: (list: List) => void
  lists: List[] // the family's lists on this screen: where an item can move
  shopMode: boolean // #/lists/<id>/shop: shopping mode, full screen
}) {
  const { members, toast, refreshTick, parentDevice, focusLocked, meMemberId } = useApp()
  const kid = !parentDevice && focusLocked ? meMemberId : null // a kid's own device: only their items change (canChangeItem)
  const [detail, setDetail] = useState<ListDetail | null>(null)
  const [error, setError] = useState(false)
  const [editItem, setEditItem] = useState<ListItem | null>(null)
  const [editList, setEditList] = useState(false)
  const [reorderGroups, setReorderGroups] = useState(false)
  const [viewing, setViewing] = useState(false) // the View sheet: group, sort, show store
  const [cataloging, setCataloging] = useState(false) // the list type's catalog
  const [showDone, setShowDone] = useState(false)
  const [selectedStore, setSelectedStore] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [scanned, setScanned] = useState<{ code: string; found: BarcodeLookup | null } | null>(null) // a new product's scan sheet
  const [gsd, setGsd] = useHashParam('gsd') // Get stuff done (GetStuffDone.tsx), over the list; in the link, so a reload reopens it
  const doing = gsd === listId
  const inputRef = useRef<HTMLInputElement>(null)
  const { upcoming, byId } = useEventWindow(refreshTick)
  const taskLink = useTaskLink(listId, refreshTick) // synced with a to-do app (TaskApps.tsx)

  // On a one-store trip, the other list type's items for that store come too (alsoAtStore).
  const load = () => {
    const at = tripStore(listId)
    return api.getList(listId, at && at !== ANY_STORE ? at : undefined).then(d => { setDetail(d); setError(false); onLoaded(d.list) }).catch(() => setError(true))
  }
  // "Shopping at": a trip in one store, kept on this device only, until Checkout (or End).
  const [trip, setTrip] = useState<string | null>(() => tripStore(listId))
  useEffect(() => { setSelectedStore(null); setShowDone(false); setTrip(tripStore(listId)) }, [listId])
  const changeTrip = (store: string | null) => {
    setTripStore(listId, store); setTrip(store); shopScroll.current = 0; setQuiet(false)
    announce(store ? t('Shopping at {store}', { store: store === ANY_STORE ? t('any store') : store }) : t('Shopping ended'))
  }
  // Walking this store backwards (trip.ts tripReverse): per store, on this device. Not for Any store.
  // #/lists/<id>/shop?store=<name> (Siri, a shortcut): start the trip at that store, skipping the
  // store step. A store that isn't one of the list's leaves the step to ask, as usual.
  const linkedStore = () => (/\/shop$/.test(hashPath(location.hash)) ? hashQuery(location.hash).get('store') : null)
  const [storeLink, setStoreLink] = useState<string | null>(linkedStore)
  useEffect(() => {
    const read = () => { const s = linkedStore(); if (s !== null) setStoreLink(s) }
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  useEffect(() => {
    if (storeLink === null || !shopMode || detail?.list.id !== listId) return
    const current = tripStore(listId)
    const store = tripStoreFor(storeLink, [...detail.suggestions.stores, ...(current && current !== ANY_STORE ? [current] : [])])
    if (store && store !== current) changeTrip(store)
    setStoreLink(null)
    history.replaceState(history.state, '', hashPath(location.hash)) // handled: a reload doesn't start it again
  }, [storeLink, shopMode, detail, listId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [reversed, setReversed] = useState(() => !!trip && trip !== ANY_STORE && tripReverse(trip))
  useEffect(() => setReversed(!!trip && trip !== ANY_STORE && tripReverse(trip)), [trip])
  const flipReverse = () => {
    if (!trip || trip === ANY_STORE) return
    setTripReverse(trip, !reversed); setReversed(!reversed)
    announce(reversed ? t('Aisles in walking order') : t('Aisles reversed'))
  }

  // Shopping mode: the trip alone, full screen. "Back" leaves it with the trip still on
  // (Shopping at on the list comes back to it); only Done shopping (the checkout) or End ends the trip.
  // History: the list is shopping mode's parent, so Back steps back to it (never a new entry,
  // which left shopping mode one Back away, ready to start an ended trip again).
  const enterShop = () => { location.hash = `#/lists/${listId}/shop`; history.replaceState({ ...history.state, kinwallShopFrom: true }, '') }
  const exitShop = () => { if (history.state?.kinwallShopFrom) history.back(); else location.replace(`#/lists/${listId}`) }
  useBackClose(exitShop, shopMode) // the app's Back button: like Escape
  const freshLink = useRef(false) // shopping mode opened by a link (Siri), not come back to with Back or Forward
  const [picking, setPicking] = useState(false) // the store step
  const [adding, setAdding] = useState(false) // the Add item sheet (shopping lists)
  const [leftovers, setLeftovers] = useState<ListItem[] | null>(null) // Checkout's "Didn't find these?" step
  const shopScroll = useRef(0) // where the aisles were, for going back to the trip
  const shopList = useRef<HTMLDivElement>(null)
  const shopHeading = useRef<HTMLHeadingElement>(null)
  const saveShopScroll = (e: React.UIEvent<HTMLElement>) => { shopScroll.current = e.currentTarget.scrollTop }
  // Kept for a relaunch, the screen stays on, and the app behind is out of reach (the view covers it).
  useEffect(() => {
    if (!shopMode) return
    freshLink.current = !history.state?.kinwallShopSeen
    history.replaceState({ ...history.state, kinwallShopSeen: true }, '')
    setShoppingModeList(listId); holdAwake('shopping', true)
    const shell = document.querySelector('.app-shell')
    shell?.setAttribute('inert', '')
    document.documentElement.dataset.fullscreenMode = '' // hides the update banner, which sits in the (now inert) app behind
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.sheet')) exitShop() }
    document.addEventListener('keydown', onKey)
    return () => {
      setShoppingModeList(null); holdAwake('shopping', false); shell?.removeAttribute('inert'); delete document.documentElement.dataset.fullscreenMode
      document.removeEventListener('keydown', onKey); setAdding(false)
      setTimeout(() => document.querySelector<HTMLElement>('.list-shop-btn')?.focus({ preventScroll: true })) // back on the Shop button
    }
  }, [shopMode, listId]) // eslint-disable-line react-hooks/exhaustive-deps

  // Checkout / Reset: the checked items go (or uncheck) at once on screen, and the server hears about
  // it after a few seconds unless Undo is tapped. Leaving the list sends it straight away.
  const [checkout, setCheckout] = useState<{ ids: string[]; reset: boolean; trip: string | null; shop: boolean; left: number } | null>(null)
  const pendingCheckout = useRef<(() => void) | null>(null)
  const checkoutTimer = useRef<ReturnType<typeof setTimeout>>()
  const commitCheckout = () => { clearTimeout(checkoutTimer.current); const run = pendingCheckout.current; pendingCheckout.current = null; run?.() }
  useEffect(() => commitCheckout, [listId]) // eslint-disable-line react-hooks/exhaustive-deps
  const startCheckout = (checked: ListItem[], kind: ListKind, trip: string | null = null, left = 0) => {
    if (!checked.length) return
    commitCheckout(); commitDelete()
    const ids = checked.map(i => i.id), reset = kind === 'reusable'
    setCheckout({ ids, reset, trip, shop: shopMode, left })
    if (trip) { setTripStore(listId, null); setTrip(null); shopScroll.current = 0 } // Checkout ends the trip
    pendingCheckout.current = async () => {
      // A combined trip checks out each list's own ticked items.
      const byList = new Map<string, string[]>()
      for (const i of checked) byList.set(i.listId || listId, [...(byList.get(i.listId || listId) ?? []), i.id])
      try { await Promise.all([...byList].map(([id, its]) => (reset ? api.resetList(id, its) : api.clearListCompleted(id, its, trip && trip !== ANY_STORE ? trip : undefined)))) }
      catch (e) { toast(e instanceof ApiError ? e.message : reset ? t('Could not reset the list') : t('Could not clear checked items'), true) }
      setCheckout(null); load()
    }
    checkoutTimer.current = setTimeout(commitCheckout, 5000)
  }
  // Swipe-to-delete (parent devices): the item goes at once on screen and is deleted after a few
  // seconds unless Undo is tapped, so Undo brings it back whole (steps, notes, added-by, places, place in the list).
  const [deleting, setDeleting] = useState<ListItem | null>(null)
  const pendingDelete = useRef<(() => void) | null>(null)
  const deleteTimer = useRef<ReturnType<typeof setTimeout>>()
  const commitDelete = () => { clearTimeout(deleteTimer.current); const run = pendingDelete.current; pendingDelete.current = null; run?.() }
  useEffect(() => commitDelete, [listId]) // eslint-disable-line react-hooks/exhaustive-deps
  const swipeDelete = (item: ListItem) => {
    commitDelete(); commitCheckout() // one Undo at a time
    setDeleting(item)
    pendingDelete.current = () => {
      setDetail(d => d && { ...d, items: d.items.filter(i => i.id !== item.id) }); setDeleting(null)
      api.queueDeleteListItem(item.listId || listId, item.id).catch(e => { toast(e instanceof ApiError ? e.message : t('Could not delete item'), true); load() })
    }
    deleteTimer.current = setTimeout(commitDelete, 5000)
  }
  const undoDelete = () => { clearTimeout(deleteTimer.current); pendingDelete.current = null; setDeleting(null); announce(t('Undone')) }
  const undoCheckout = () => {
    clearTimeout(checkoutTimer.current); pendingCheckout.current = null
    if (checkout?.trip) { setTripStore(listId, checkout.trip); setTrip(checkout.trip) }
    if (checkout?.shop) enterShop() // back to the aisles
    setCheckout(null); announce(t('Undone'))
  }
  useEffect(() => { load() }, [listId, refreshTick, trip]) // eslint-disable-line react-hooks/exhaustive-deps
  // The iPhone app's Live Activity for the trip (liveActivity.ts): what's left and what's next, in the
  // same walking order as the aisles below, on every change; End or Checkout ends it.
  const hadTrip = useRef<string | null>(null) // the list whose trip it's showing
  useEffect(() => {
    if (!detail || detail.list.id !== listId || detail.list.kind !== 'shopping') return
    if (!trip) { if (hadTrip.current === listId) endAppActivity('shopping'); hadTrip.current = null; return }
    hadTrip.current = listId
    const order = aisleOrderMap(detail)
    const walked = [...detail.items, ...(trip !== ANY_STORE ? detail.alsoAtStore ?? [] : [])] // a combined trip counts both lists
    const pending = checkout && !checkout.reset ? walked.filter(i => !checkout.ids.includes(i.id)) : walked
    const items = trip !== ANY_STORE ? pending : pending.map(i => (i.aisle ? i : { ...i, aisle: departmentAisle(i.category, storeAisles(detail.suggestions, i.store, order)) }))
    tellAppActivity('shopping', { list: detail.list.name, ...shoppingActivity(listId, trip, items, order, trip !== ANY_STORE ? storeAisles(detail.suggestions, trip, order) : [], reversed) })
  }, [detail, trip, checkout, listId, reversed])
  // Adds, ticks, edits and deletes are queued (api.queue*): shown at once, sent in order, kept
  // offline. A refresh after they sync clears their pending mark (App bumps refreshTick).
  const showQueued = (op: Op | null) => { if (op) setDetail(d => d && applyListOps(d, [op])); else load() }

  // barcode: a scan saved to the catalog, so the next scan of it adds this name at once.
  // checkOff (a scan while shopping): it's already in the cart, so it's added ticked. to: another list.
  const addItem = async (text = draft, barcode?: string, { checkOff = false, to = listId } = {}) => {
    const title = text.trim()
    if (!title) return
    if (text === draft) setDraft('') // from the add bar, not a scan
    const id = crypto.randomUUID() // ours, so the tick can follow the add (both queued, in order)
    try {
      const added = await api.queueAddListItem(to, { id, title, ...(barcode ? { barcode } : {}) })
      const ticked = checkOff ? await api.queueUpdateListItem(to, id, { done: true }) : null
      if (to === listId) { showQueued(added); if (checkOff) showQueued(ticked) }
    } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not add item'), true); return null }
    if (!checkOff) inputRef.current?.focus() // keep the keyboard open for the next item
    return id
  }

  // After a scan while shopping: "Where did you find it?" for what the item is missing, its aisle at
  // this store and its department (placeNeeds). Saving teaches them, so the next one walks right.
  const [placing, setPlacing] = useState<{ listId: string; id: string; title: string; category: string; need: { aisle: boolean; department: boolean } } | null>(null)
  const [quiet, setQuiet] = useState(false) // Stop asking on this trip
  const askPlace = (item: { id: string; listId?: string; title: string; store?: string | null; aisle?: string | null; category?: string | null; places?: ListItem['places'] }, onlyAisle = false) => {
    if (!detail || quiet) return
    // A brand-new add: what the catalog remembers for the name (the server fills it in from there too).
    const known = detail.suggestions.items?.find(s => s.key === itemKey(item.title))
    const full = { store: null, aisle: null, places: known?.place ? [known.place] : [], ...item, category: item.category ?? known?.category ?? null }
    const need = placeNeeds(full, trip, trip && trip !== ANY_STORE ? storeAisles(detail.suggestions, trip, aisleOrderMap(detail)) : [])
    if (onlyAisle ? need.aisle : need.aisle || need.department) setPlacing({ listId: item.listId ?? listId, id: item.id, title: item.title, category: full.category ?? '', need })
  }
  const savePlace = async (aisle: string, category: string) => {
    if (!placing) return
    const body = { ...(placing.need.aisle && aisle && trip ? { aisle, aisleStore: trip } : {}), ...(placing.need.department && category ? { category } : {}) }
    setPlacing(null)
    if (!Object.keys(body).length) return
    try { const op = await api.queueUpdateListItem(placing.listId, placing.id, body); if (placing.listId === listId) showQueued(op); announce(t('Saved where {item} goes', { item: placing.title })) }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not save it'), true) }
  }
  const placeSheet = placing && detail && (
    <PlaceSheet title={placing.title} store={trip && trip !== ANY_STORE ? trip : null} need={placing.need} category={placing.category}
      aisles={trip && trip !== ANY_STORE ? storeAisles(detail.suggestions, trip, aisleOrderMap(detail)) : []} departments={detail.suggestions.categories}
      onSave={savePlace} onClose={() => setPlacing(null)} onStop={() => { setPlacing(null); setQuiet(true); announce(t("Won't ask again on this trip")) }} />
  )

  // The app's camera (shopping lists): a product saved in the catalog goes straight on the list
  // under the family's name; anything else opens the scan sheet to check the name, and saving its
  // barcode to the catalog is a choice made there. While shopping, a scan checks the product off
  // (scanMatch finds it on the trip, both lists on a combined one), or adds it already checked off.
  const scan = async () => {
    const code = await scanBarcode(wallCamera({ parentDevice, focusLocked, meMemberId }))
    if (!code) return
    let found = null
    try { found = await api.lookupBarcode(listId, code) }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not look that up'), true) }
    if (shopMode && found) {
      const hit = scanMatch([...(detail?.items ?? []), ...(detail?.alsoAtStore ?? [])], found.title)
      if (hit) { await toggle(hit); toast(t('Checked off: {item}', { item: hit.title })); announce(t('Checked off {item}', { item: hit.title })); askPlace(hit); return }
      if (found.source === 'family') {
        const id = await addItem(found.title, code, { checkOff: true })
        toast(t('Added and checked off: {item}', { item: found.title })); announce(t('Added and checked off {item}', { item: found.title }))
        if (id) askPlace({ id, title: found.title })
        return
      }
    }
    if (found?.source === 'family') {
      if (detail?.items.some(i => !i.done && itemKey(i.title) === itemKey(found.title))) {
        toast(t('{item} is already on the list', { item: found.title })); announce(t('{item} is already on the list', { item: found.title }))
        return
      }
      await addItem(found.title, code)
      toast(t('Added: {item}', { item: found.title })); announce(t('Added {item}', { item: found.title }))
      return
    }
    setScanned({ code, found })
  }
  const shoppingLists = lists.filter(l => l.kind === 'shopping' && !l.archived)
  // A product found in another list type's database goes there by default (scanTarget): paper towels
  // scanned on Groceries start out headed for the Shopping list.
  const addScanned = async (title: string, save: boolean, target: string, place?: { aisle: string; category: string }) => {
    if (!scanned) return
    const barcode = save ? scanned.code : undefined
    setScanned(null)
    const id = await addItem(title, barcode, { checkOff: shopMode, to: target })
    if (id && place && tripAt && (place.aisle || place.category)) { // where it was found, from the scan sheet
      try { showQueued(await api.queueUpdateListItem(target, id, { ...(place.aisle ? { aisle: place.aisle, aisleStore: tripAt } : {}), ...(place.category ? { category: place.category } : {}) })) }
      catch (e) { toast(e instanceof ApiError ? e.message : t('Could not save where it goes'), true) }
    } else if (id && !place && shopMode && target === listId) askPlace({ id, title })
    const other = shoppingLists.find(l => l.id === target)?.name ?? t('the other list')
    const said = target === listId ? (shopMode ? t('Added and checked off: {item}', { item: title }) : t('Added: {item}', { item: title }))
      : shopMode ? t('Added and checked off to {list}: {item}', { list: other, item: title }) : t('Added to {list}: {item}', { list: other, item: title })
    toast(said); announce(said)
  }
  const tripAt = detail?.list.kind === 'shopping' && trip !== ANY_STORE ? trip : null // one store: its aisles, in its order
  const scanSheet = scanned && detail && (
    <ScanSheet code={scanned.code} found={scanned.found} canSave={!kid} onClose={() => setScanned(null)}
      lists={shoppingLists} target={scanTarget(shoppingLists, listId, scanned.found?.source ?? null)} checkOff={shopMode} onAdd={addScanned}
      suggestions={detail.suggestions.items} onListKeys={new Set(detail.items.filter(i => !i.done).map(i => itemKey(i.title)))}
      onList={[...detail.items.map(i => ({ ...i, listName: detail.list.name })), ...(detail.alsoAtStore ?? [])]}
      place={shopMode && tripAt ? { store: tripAt, aisles: storeAisles(detail.suggestions, tripAt, aisleOrderMap(detail)), departments: detail.suggestions.categories } : undefined}
      onCheckOff={async it => { setScanned(null); await toggle(it); toast(t('Checked off: {item}', { item: it.title })); announce(t('Checked off {item}', { item: it.title })) }} />
  )
  const scanBtn = detail?.list.kind === 'shopping' && appBarcodeScanner() && (
    <button className="icon-btn list-scan-btn" onClick={scan} aria-label={t('Scan a barcode')}><span aria-hidden="true">📷</span></button>
  )

  // A drag reorders one group's rows; slot them back into the positions that group held in the whole
  // list, so other groups (and done items) keep their places. Shown immediately, then saved.
  const reorderWithin = async (groupIds: string[]) => {
    if (!detail) return
    const all = detail.items.slice().sort((a, b) => a.sort - b.sort).map(i => i.id)
    const moved = new Set(groupIds)
    const queue = [...groupIds]
    const order = all.map(id => (moved.has(id) ? queue.shift()! : id))
    // Sorted too: grouped views keep array order, so without it the move only showed after a refetch.
    setDetail({ ...detail, items: detail.items.map(i => ({ ...i, sort: order.indexOf(i.id) })).sort(compareItems(detail.list.sortBy, todayKey(), { keepChecked: detail.list.keepChecked, aisleOrder: aisleOrderMap(detail), eventDue: eventDueMap(byId) })) })
    try { await api.reorderListItems(listId, order) }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not reorder'), true); load() }
  }

  const toggle = async (item: ListItem) => {
    if (item.listId && item.listId !== listId) { // the other list's, on a combined trip: ticked there
      setDetail(d => d && { ...d, alsoAtStore: d.alsoAtStore?.map(i => (i.id === item.id ? { ...i, done: !item.done } : i)) })
      try { await api.queueUpdateListItem(item.listId, item.id, { done: !item.done }); askAisle(item) }
      catch (e) { toast(e instanceof ApiError ? e.message : t('Could not update item'), true); load() }
      return
    }
    try { showQueued(await api.queueUpdateListItem(listId, item.id, { done: !item.done })); askAisle(item) }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not update item'), true) }
  }
  // Ticking something off while shopping at a store that doesn't know its aisle yet asks where it
  // was found (only the aisle: a tap shouldn't also quiz for the department), so the next trip
  // walks right. Unticking never asks.
  const askAisle = (item: ListItem) => { if (shopMode && !item.done) askPlace(item, true) }

  const setSortBy = async (sortBy: ListSortBy) => {
    try { await api.updateList(listId, { sortBy }); announce(t('Sorted by {sort}', { sort: tm(SORT_LABEL[sortBy]) })); load() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not change sort'), true) }
  }
  const setGroupBy = async (groupBy: ListGroupBy) => {
    try { await api.updateList(listId, { groupBy }); load() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not change grouping'), true) }
  }

  const shopping = shopMode && detail?.list.kind === 'shopping'
  // Opened on its heading (announced as the view's name), and where the aisles were left.
  useLayoutEffect(() => {
    if (!shopping) return
    if (shopList.current) shopList.current.scrollTop = shopScroll.current
    shopHeading.current?.focus({ preventScroll: true })
  }, [shopping])
  // A link to shopping mode for a list that isn't a shopping list: just the list.
  useEffect(() => { if (shopMode && detail && !shopping) location.replace(`#/lists/${listId}`) }, [shopMode, detail, shopping, listId])
  // Straight into shopping mode with no store yet (a link, Siri): the family's default store for this list type, when there is one.
  const defaultStore = detail?.list.id === listId ? detail.suggestions.defaultStore : null
  // Only on the way in from a link: Checkout ends the trip while still in shopping mode, and mustn't
  // start another, and neither does Back or Forward onto shopping mode after the trip ended.
  useEffect(() => { if (shopping && freshLink.current && !trip && storeLink === null && defaultStore) changeTrip(defaultStore) }, [shopping, defaultStore]) // eslint-disable-line react-hooks/exhaustive-deps

  if (error || !detail) {
    const card = <div className="state-card">{error ? t("Couldn't load this list.") : t('Loading…')}</div>
    return shopMode
      ? createPortal(<div className="shop-mode"><div className="shop-bar"><div className="shop-bar-title" /><button className="btn btn-secondary shop-done" onClick={exitShop}>{t('Back')}</button></div>{card}</div>, document.body)
      : <div className="list-detail">{card}</div>
  }

  const { list, groups, suggestions } = detail
  const onList = new Set(detail.items.filter(i => !i.done).map(i => itemKey(i.title))) // not suggested again
  const aisleOrder = aisleOrderMap(detail)
  // A pending Checkout shows as done already: those items gone (or unchecked, for a Reset).
  const shown = deleting ? detail.items.filter(i => i.id !== deleting.id) : detail.items // a swipe-delete waiting on Undo
  const pending = !checkout ? shown
    : checkout.reset ? shown.map(i => (checkout.ids.includes(i.id) ? { ...i, done: false } : i))
    : shown.filter(i => !checkout.ids.includes(i.id))
  // Shopping: an item with no aisle sorts and groups in its store's aisle named like its department
  // (shown, never saved - the editor opens the item as stored).
  const items = list.kind !== 'shopping' ? pending
    : pending.map(i => (i.aisle ? i : { ...i, aisle: departmentAisle(i.category, storeAisles(suggestions, i.store, aisleOrder)) }))
  const openItem = (item: ListItem) => setEditItem(detail.items.find(i => i.id === item.id) ?? item)
  // The other list's items on a combined trip: that list's owners aren't loaded here, so just the item's own.
  const mine = (i: ListItem) => canChangeItem(i, !i.listId || i.listId === listId ? list : { memberIds: [] }, kid)
  const delFor = (i: ListItem) => (parentDevice && (!i.listId || i.listId === listId) ? () => swipeDelete(i) : undefined) // swipe to delete: parent devices, this list's items
  const stores = [...new Set(items.map(i => i.store).filter((v): v is string => !!v))].sort()
  const filtered = selectedStore ? items.filter(i => i.store === selectedStore || i.store === null) : items
  // Keep checked in place: ticked items stay put, crossed off, and the order doesn't move under you.
  const keep = list.keepChecked
  const cmp = compareItems(list.sortBy, todayKey(), { keepChecked: keep, aisleOrder, eventDue: eventDueMap(byId) })
  const openItems = keep ? filtered : filtered.filter(i => !i.done)
  const doneItems = keep ? [] : filtered.filter(i => i.done)
  const checked = filtered.filter(i => i.done && mine(i)) // a kid's device checks out only what it may change
  const groupKind = list.groupBy === 'aisle' ? 'store' : list.groupBy // aisle groups follow the store order
  const groupNamesForOrder = groups.filter(g => g.kind === groupKind).sort((a, b) => a.sort - b.sort).map(g => g.name)
  const groupedOpen = groupItems(openItems, list.groupBy, groupNamesForOrder, list.sortBy, cmp, aisleOrder)
  const manual = list.sortBy === 'manual'
  const reorderable = list.groupBy === 'store' || list.groupBy === 'category'
  const reorderableNames = reorderable ? [...new Set(items.map(i => (list.groupBy === 'store' ? i.store : i.category)).filter((v): v is string => !!v))] : []
  const checkoutLabel = tm(CHECKOUT_LABEL[list.kind])
  // On a trip: everything, walked in that store's aisle order; checked items always stay in place.
  const activeTrip = list.kind === 'shopping' ? trip : null
  const storeLabel = activeTrip === ANY_STORE ? t('Any store') : activeTrip
  const tripAisles = tripAt ? storeAisles(suggestions, tripAt, aisleOrder) : []
  const addSheet = adding && (
    <ItemAddSheet listId={listId} listName={list.name} members={members} suggestions={suggestions} aisleOrder={aisleOrder} trip={tripAt}
      onList={activeTrip ? new Set(items.map(i => itemKey(i.title))) : onList /* on a trip, ticked ones are in the cart: not offered again */}
      onAdded={showQueued} onClose={() => setAdding(false)} />
  )
  // A one-store trip also walks the other list type's items for that store, tagged with their list.
  const also = !tripAt ? [] : (detail.alsoAtStore ?? []).filter(i => !(checkout && !checkout.reset && checkout.ids.includes(i.id)))
  const fromTag = (item: ListItem) => {
    const other = item.listId !== listId && also.find(i => i.id === item.id)
    return other ? <FromTag name={other.listName} catalog={list.catalog === 'shopping' ? 'groceries' : 'shopping'} /> : undefined
  }
  const view = !activeTrip ? null : tripAt ? tripView([...pending, ...also], tripAt, aisleOrder, tripAisles, reversed) : anyStoreView(items, aisleOrder)
  const tripLeft = view ? [...view.aisles.flatMap(g => g.items), ...view.unknown].filter(i => !i.done).length : 0
  const tripChecked = [...items, ...also].filter(i => i.done && mine(i))
  const tripRow = (item: ListItem, other = false) => (
    <ItemRow key={item.id} item={other || !tripAt ? item : { ...item, aisle: aisleAt(item, tripAt, tripAisles) }} kind={list.kind} groupBy={other ? 'none' : tripAt ? 'aisle' : 'store'} members={members}
      event={item.eventId ? byId.get(item.eventId) : undefined} onToggle={() => toggle(item)} from={fromTag(item)} readOnly={!mine(item)} onDelete={delFor(item)}
      onOpen={() => (item.listId !== listId ? (location.hash = `#/lists/${encodeURIComponent(item.listId)}`) : openItem(item))} />
  )
  const tripStores = [...new Set([...suggestions.stores, ...(tripAt ? [tripAt] : [])])]
  // Checkout on a trip: at one store, anything unchecked gets a "Didn't find these?" step first.
  // Checkout goes ahead whatever is picked there (and Undo still undoes it).
  const checkoutTrip = (moved = false) => {
    const left = activeTrip ? tripLeftovers(items, activeTrip) : []
    if (!moved && tripAt && left.length) { setLeftovers(left); return }
    startCheckout(tripChecked, list.kind, activeTrip, left.length)
    if (shopMode) exitShop()
  }
  const finishLeftovers = async (moves: { item: ListItem; store: string | null }[]) => {
    setLeftovers(null)
    for (const { item, store } of moves) {
      // The aisle goes with the store: the one known there, if any.
      try { showQueued(await api.queueUpdateListItem(listId, item.id, { store, aisle: item.places?.find(p => p.store === store)?.aisle ?? null })) }
      catch (e) { toast(e instanceof ApiError ? e.message : t('Could not move {item}', { item: item.title }), true) }
    }
    if (moves.length) announce(tn(moves.length, 'Moved {n} item', 'Moved {n} items'))
    checkoutTrip(true)
  }
  const leftoversSheet = leftovers && tripAt && (
    <LeftoversSheet items={leftovers} trip={tripAt} stores={suggestions.stores} onDone={finishLeftovers} onCancel={() => { setLeftovers(null); announce(t('Still shopping')) }} />
  )
  // End: the trip stops at once, with Undo (the store and its reversed walk come back with it).
  const endTrip = () => {
    const was = trip
    changeTrip(null)
    toast(t('Shopping ended'), false, { label: t('Undo'), run: () => changeTrip(was) })
  }
  const pickStore = (store: string) => {
    if (store !== trip) changeTrip(store)
    setPicking(false)
    if (!shopping) enterShop() // from the list page's Shop button
    else setTimeout(() => shopHeading.current?.focus()) // after the sheet hands focus back
  }
  // Shop: at the family's default store for this list type, or with one store (or none), it starts right away; else it asks first.
  const startShop = () => {
    if (tripStores.length > 1 && !suggestions.defaultStore) { setPicking(true); return }
    changeTrip(suggestions.defaultStore ?? tripStores[0] ?? ANY_STORE); enterShop()
  }
  // No store yet (Shop, or a link straight in): ask first; backing out of shopping mode leaves it.
  const storeSheet = (picking || (shopping && !trip && storeLink === null)) && (
    <Sheet title={t('Where are you shopping?')} onClose={() => { setPicking(false); if (shopping && !trip) exitShop() }}>
      <div className="shop-store-options">
        {[...tripStores, ANY_STORE].map(st => (
          <button key={st} className={`btn ${st === trip ? 'btn-primary' : 'btn-secondary'} btn-block`} aria-pressed={st === trip} onClick={() => pickStore(st)}>
            {st === ANY_STORE ? t('Any store') : st}
          </button>
        ))}
      </div>
      <p className="field-hint">{tripStores.length ? t("Items go in that store's aisle order. Any store goes store by store.") : t('Add stores to items to walk them in aisle order.')}</p>
    </Sheet>
  )

  const siblingIds = items.slice().sort((a, b) => a.sort - b.sort).map(i => i.id)
  const editSheet = editItem && (
    <ItemEditSheet listId={listId} item={editItem} kind={list.kind} readOnly={!mine(editItem)} manual={manual} members={members} suggestions={suggestions} aisleOrder={aisleOrder} trip={tripAt} siblingIds={siblingIds} upcoming={upcoming} byId={byId}
      moveTargets={lists.filter(l => !l.archived && l.id !== listId && listType(l) === listType(list))}
      onClose={() => { setEditItem(null); load() }} onSaved={() => { setEditItem(null); load() }} />
  )

  if (shopping) {
    const row = (item: ListItem, other = false) => <ShopRow key={item.id} item={item} meta={other ? item.store : !tripAt ? item.aisle : null} onToggle={() => toggle(item)} from={fromTag(item)} readOnly={!mine(item)}
      onOpen={!item.listId || item.listId === listId ? () => openItem(item) : undefined /* the other list's, on a combined trip: on its own list */} />
    const group = (title: string, rows: React.ReactNode, className = '') => (
      <section key={title} className={`shop-group ${className}`} aria-label={title}><h3 className="list-group-title" aria-hidden="true">{title}</h3>{rows}</section>
    )
    return createPortal(
      <div className="shop-mode" role="dialog" aria-modal="true" aria-labelledby={`shop-title-${listId}`}>
        <div className="shop-bar">
          <div className="shop-bar-title">
            <h2 id={`shop-title-${listId}`} ref={shopHeading} tabIndex={-1}>{list.name}<span className="sr-only">{t(', shopping mode')}</span></h2>
            <button className="shop-store-btn" onClick={() => setPicking(true)} aria-label={t('Shopping at {store}. Change store', { store: storeLabel ?? t('no store yet') })}>
              <CartIcon width={16} height={16} /><span>{storeLabel ?? t('Pick a store')} <span aria-hidden="true">▾</span></span>
            </button>
          </div>
          {view && <div className="shop-left">{t('{n} left', { n: tripLeft })}{tripAt && reversed && <span className="chip chip-static shop-reversed">{t('Reversed')}</span>}</div>}
          {tripAt && (
            <button className="icon-btn shop-reverse-btn" onClick={flipReverse} aria-pressed={reversed} aria-label={t('Walk the aisles in reverse')}>
              <span aria-hidden="true">⇅</span>
            </button>
          )}
          <button className="btn btn-secondary shop-done" onClick={exitShop} aria-label={t('Back to the list. The trip stays on')}>{t('Back')}</button>
        </div>
        <div className="shop-items scroll-y" ref={shopList} onScroll={saveShopScroll}>
          {items.length === 0 && <div className="empty-card"><span className="emoji">🛒</span>{t('Nothing on the list yet.')}</div>}
          {view?.aisles.map(g => group(g.aisle, g.items.map(i => row(i))))}
          {!!view?.unknown.length && group(t('Aisle unknown'), view.unknown.map(i => row(i)))}
          {!!view?.other.length && group(t('At other stores'), view.other.map(i => row(i, true)), 'list-trip-other')}
        </div>
        <div className="shop-dock">
          <div className="shop-dock-row">
            {scanBtn /* scan to check off (or add) without opening Add an item */}
            <button className="btn btn-secondary shop-add-btn" onClick={() => setAdding(true)} aria-haspopup="dialog" aria-label={t('Add an item')}>
              <PlusIcon width={18} height={18} />{!tripChecked.length && <span aria-hidden="true">{t('Add an item')}</span>}
            </button>
            {tripChecked.length > 0 && (
              <button className="btn btn-primary list-checkout-btn" onClick={() => checkoutTrip()}>
                {t('{label} ({n})', { label: tm(TRIP_DONE_LABEL), n: tripChecked.length })}
              </button>
            )}
          </div>
        </div>
        {storeSheet}
        {leftoversSheet}
        {scanSheet}
        {placeSheet}
        {addSheet}
        {editSheet}
      </div>,
      document.body)
  }

  // View: group, sort and the store filter behind one button, counted when they differ from a new
  // list's, and summed up in one line under it (the Contacts pattern).
  const viewDef = listViewDefaults(list.kind)
  const groupChanged = list.kind === 'shopping' && list.groupBy !== viewDef.groupBy
  const sortChanged = list.sortBy !== viewDef.sortBy
  const viewCount = [groupChanged, sortChanged, !!selectedStore].filter(Boolean).length
  const viewSummary = [
    groupChanged && tm(GROUPED_BY[list.groupBy]),
    sortChanged && tm(SORTED_BY[list.sortBy]),
    selectedStore && t('{store} only', { store: selectedStore }),
  ].filter(Boolean).join(' · ')
  const viewButton = (
    <button className={`icon-btn filter-btn list-view-btn ${viewCount ? 'active' : ''}`} onClick={() => setViewing(true)} aria-haspopup="dialog"
      aria-label={filterSortLabel(viewCount)}>
      <FilterIcon width={20} height={20} />
      {viewCount > 0 && <span className="filter-badge" aria-hidden="true">{viewCount}</span>}
    </button>
  )

  return (
    <div className="list-detail">
      <div className="list-detail-header">
        {isPhone && <button className="icon-btn" onClick={onBack} aria-label={t('Back to lists')}><ChevronLeft width={20} height={20} /></button>}
        <div className="list-detail-emoji" aria-hidden="true">{list.emoji || '📝'}</div>
        <div className="list-detail-title">
          <h2 className="list-detail-name">{list.name}</h2>
          <div className="list-detail-sub">{tm(TYPE_LABEL[listType(list)])} · <CountLine list={list} /></div>
          {lastDoneLine(list, members) && <div className="list-detail-sub list-last-done">{lastDoneLine(list, members)}</div>}
          {taskLink && <TaskSyncLine link={taskLink} />}
        </div>
        {parentDevice && <button className="btn btn-secondary" onClick={() => setEditList(true)} aria-label={t('Edit list {name}', { name: list.name })}>{t('Edit')}</button>} {/* a list's settings, archive and delete are for parent devices; View stays */}
      </div>

      {list.kind !== 'shopping' && (
        <div className="list-add-bar">
          <ItemAddField id={`list-add-${listId}`} value={draft} onChange={setDraft} onAdd={addItem} suggestions={suggestions.items} onList={onList} inputRef={inputRef}
            label={t('Add to {list}', { list: list.name })} placeholder={t('Add something…')} />
          <button className="icon-btn" onClick={() => addItem()} disabled={!draft.trim()} aria-label={t('Add item')}><PlusIcon width={20} height={20} /></button>
          {items.length > 0 && viewButton /* no Shop button to share a row with */}
        </div>
      )}

      {/* Shopping lists: Add (the Add item sheet), scan, Shop (or the trip and End), and View once there's something to view. */}
      {list.kind === 'shopping' && (
        <div className="list-actions">
          <button className={`btn ${activeTrip ? 'btn-secondary' : 'btn-primary'} list-add-btn`} onClick={() => setAdding(true)} aria-haspopup="dialog" aria-label={t('Add an item')}><PlusIcon width={18} height={18} />{t('Add')}</button>
          {scanBtn}
          {activeTrip ? <>
            <button className="btn btn-primary list-shop-btn on-trip" onClick={enterShop} aria-label={t('Shopping at {store}, {n} left. Resume shopping', { store: storeLabel ?? '', n: tripLeft })}>
              <CartIcon width={18} height={18} /><span className="list-shop-label">{storeLabel}<span className="list-shop-sub"> · {t('{n} left', { n: tripLeft })}</span></span>
            </button>
            <button className="btn btn-secondary list-end-btn" onClick={endTrip} aria-label={t('End shopping at {store}', { store: storeLabel ?? '' })}>{t('End')}</button>
          </> : (
            <button className="btn btn-secondary list-shop-btn" onClick={startShop} aria-haspopup={tripStores.length > 1 ? 'dialog' : undefined}>
              <CartIcon width={18} height={18} />{t('Shop')}
            </button>
          )}
          {!activeTrip && <button className="btn btn-secondary list-catalog-btn" onClick={() => setCataloging(true)} aria-haspopup="dialog" aria-label={catalogName(list.catalog ?? 'groceries')}>{t('Catalog')}</button>}
          {!activeTrip && items.length > 0 && viewButton}
        </div>
      )}
      {/* To-do and reusable lists: Get stuff done, the list full screen (shopping lists have Shop). */}
      {list.kind !== 'shopping' && items.length > 0 && (
        <div className="list-actions">
          <button className="btn btn-secondary list-do-btn" onClick={() => setGsd(listId)} aria-haspopup="dialog"><CheckIcon width={18} height={18} />{t('Get stuff done')}</button>
        </div>
      )}
      {doing && <GetStuffDone listId={listId} onClose={() => { setGsd(null); load() }} />}
      {!activeTrip && viewSummary && items.length > 0 && (
        <button className="filter-summary list-view-summary" onClick={() => setViewing(true)} aria-label={t('View: {summary}. Change view', { summary: viewSummary })}>{viewSummary}</button>
      )}

      <div className="list-items scroll-y">
        {items.length === 0 ? (
          <div className="empty-card"><span className="emoji">{list.kind === 'shopping' ? '🛒' : list.kind === 'reusable' ? '🧳' : '📝'}</span>{t('Nothing here yet — add your first item above.')}</div>
        ) : view ? (
          <>
            {view.aisles.map(g => (
              <div key={g.aisle} className="list-group">
                <h3 className="list-group-title" style={{ margin: 0 }}>{g.aisle}</h3>
                {g.items.map(item => tripRow(item))}
              </div>
            ))}
            {view.unknown.length > 0 && (
              <div className="list-group">
                <h3 className="list-group-title" style={{ margin: 0 }}>{t('Aisle unknown')}</h3>
                {view.unknown.map(item => tripRow(item))}
              </div>
            )}
            {view.other.length > 0 && (
              <div className="list-group list-trip-other">
                <h3 className="list-group-title" style={{ margin: 0 }}>{t('At other stores')}</h3>
                {view.other.map(item => tripRow(item, true))}
              </div>
            )}
          </>
        ) : list.groupBy === 'none' ? (
          openItems.length === 0 ? (
            <div className="empty-card"><span className="emoji">✨</span>{t('All done!')}</div>
          ) : (
            <DragList items={openItems.slice().sort(cmp)} onReorder={reorderWithin} fixed={!manual}
              renderRow={(item, handle) => <ItemRow item={item} kind={list.kind} groupBy={list.groupBy} members={members} event={item.eventId ? byId.get(item.eventId) : undefined} onToggle={() => toggle(item)} onOpen={() => openItem(item)} handle={handle} readOnly={!mine(item)} onDelete={delFor(item)} />} />
          )
        ) : groupedOpen.length === 0 ? (
          <div className="empty-card"><span className="emoji">✨</span>{t('All done!')}</div>
        ) : (
          groupedOpen.map(g => (
            <div key={g.name} className="list-group">
              <h3 className="list-group-title" style={{ margin: 0 }}>{g.name}</h3>
              <DragList items={g.items} onReorder={reorderWithin} fixed={!manual}
                renderRow={(item, handle) => <ItemRow item={item} kind={list.kind} groupBy={list.groupBy} members={members} event={item.eventId ? byId.get(item.eventId) : undefined} onToggle={() => toggle(item)} onOpen={() => openItem(item)} handle={handle} readOnly={!mine(item)} onDelete={delFor(item)} />} />
            </div>
          ))
        )}

        {!view && doneItems.length > 0 && (
          <div className="list-done-section">
            {/* Clear/Reset only matter once something is checked, so they live here rather than
                in a permanent footer that cost a phone a row of items. */}
            <div className="list-done-head">
              <button className="list-done-toggle" onClick={() => setShowDone(s => !s)} aria-expanded={showDone}><span aria-hidden="true">{showDone ? '▾' : '▸'}</span> {t('Done ({n})', { n: doneItems.length })}</button>
              <button className="link-btn" onClick={() => startCheckout(doneItems.filter(mine), list.kind)}>{list.kind === 'reusable' ? t('Reset list') : t('Clear checked')}</button>
            </div>
            {showDone && doneItems.slice().sort((a, b) => a.sort - b.sort).map(item => (
              <ItemRow key={item.id} item={item} kind={list.kind} groupBy={list.groupBy} members={members} event={item.eventId ? byId.get(item.eventId) : undefined} onToggle={() => toggle(item)} onOpen={() => openItem(item)} readOnly={!mine(item)} onDelete={delFor(item)} />
            ))}
          </div>
        )}

        {/* Mid-shop: checked items stay crossed off in place; one tap clears (or resets) them all. */}
        {activeTrip ? tripChecked.length > 0 && (
          <div className="list-checkout-bar">
            <button className="btn btn-primary list-checkout-btn" onClick={() => checkoutTrip()}>
              {t('{label} ({n})', { label: tm(TRIP_DONE_LABEL), n: tripChecked.length })}
            </button>
          </div>
        ) : keep && checked.length > 0 && (
          <div className="list-checkout-bar">
            <button className="btn btn-primary list-checkout-btn" onClick={() => startCheckout(checked, list.kind)}>
              {checkoutLabel} ({checked.length})
            </button>
          </div>
        )}
      </div>

      {!shopping && storeSheet}
      {leftoversSheet}
      {checkout && (
        <div className="toast list-undo-toast" role="status">
          <span>{checkout.reset ? tn(checkout.ids.length, 'Reset {n} item', 'Reset {n} items') : checkout.trip ? `${tn(checkout.ids.length, 'Took {n} item off the list.', 'Took {n} items off the list.')}${checkout.left ? ` ${tn(checkout.left, '{n} is left for next time.', '{n} are left for next time.')}` : ''}` : tn(checkout.ids.length, 'Cleared {n} item', 'Cleared {n} items')}</span>
          <button className="list-undo-btn" onClick={undoCheckout}>{t('Undo')}</button>
        </div>
      )}
      {deleting && (
        <div className="toast list-undo-toast" role="status">
          <span>{t('Deleted {item}', { item: deleting.title })}</span>
          <button className="list-undo-btn" onClick={undoDelete}>{t('Undo')}</button>
        </div>
      )}


      {addSheet}
      {editSheet}
      {editList && (
        <ListEditSheet list={list} onClose={() => setEditList(false)}
          onSaved={() => { setEditList(false); load(); onArchivedOrDeleted() }}
          onDeleted={() => { setEditList(false); onArchivedOrDeleted() }} />
      )}
      {scanSheet}
      {viewing && (
        <ListViewSheet list={list} stores={stores} store={selectedStore} onStore={setSelectedStore} onGroupBy={setGroupBy} onSortBy={setSortBy} onClose={() => setViewing(false)}
          onReorder={list.kind === 'shopping' && reorderable && reorderableNames.length > 1 ? () => { setViewing(false); setReorderGroups(true) } : undefined} />
      )}
      {cataloging && <ListCatalogSheet catalog={list.catalog ?? 'groceries'} listId={listId} listName={list.name} onList={onList} suggestions={suggestions} aisleOrder={aisleOrder} onClose={() => setCataloging(false)} onChanged={load} />}
      {reorderGroups && reorderable && (
        <ReorderGroupsSheet listId={listId} groupBy={list.groupBy === 'store' ? 'store' : 'category'} names={groupNamesForOrder.length ? groupNamesForOrder.filter(n => reorderableNames.includes(n)).concat(reorderableNames.filter(n => !groupNamesForOrder.includes(n))) : reorderableNames}
          onClose={() => setReorderGroups(false)} onSaved={() => { setReorderGroups(false); load() }} />
      )}
    </div>
  )
}

/** Collapsed "Archived (n)" section under the list cards: restore or delete for good. */
function ArchivedLists({ lists, onChanged }: { lists: List[]; onChanged: () => void }) {
  const dialog = useDialog()
  const { toast } = useApp()
  if (lists.length === 0) return null
  const restore = async (l: List) => {
    try { await api.updateList(l.id, { archived: false }); announce(t('{name} restored', { name: l.name })); onChanged() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not restore list'), true) }
  }
  const del = async (l: List) => {
    if (!await dialog.confirm({ title: t('Delete “{name}”?', { name: l.name }), body: t('This removes all its items too.'), confirmLabel: t('Delete'), danger: true })) return
    try { await api.deleteList(l.id); announce(t('{name} deleted', { name: l.name })); onChanged() }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not delete list'), true) }
  }
  return (
    <details className="lists-archived">
      <summary>{t('Archived ({n})', { n: lists.length })}</summary>
      {lists.map(l => (
        <div key={l.id} className="lists-archived-row">
          <span className="list-card-emoji" aria-hidden="true">{l.emoji || '📝'}</span>
          <span className="list-card-name">{l.name}</span>
          <button className="btn btn-secondary" onClick={() => restore(l)} aria-label={t('Restore {name}', { name: l.name })}>{t('Restore')}</button>
          <button className="icon-btn" onClick={() => del(l)} aria-label={t('Delete {item}', { item: l.name })}><TrashIcon width={16} height={16} /></button>
        </div>
      ))}
    </details>
  )
}

export default function Lists() {
  const { members, refreshTick, focusMemberId, focusShowsShared, toast, parentDevice } = useApp()
  const isPhone = useIsPhone()
  const [allLists, setLists] = useState<List[]>([])
  // A display pinned to one member shows that member's lists (and the family's, unless hidden).
  // Fetched with archived ones included; they only show in the collapsed "Archived" section.
  const visible = useMemo(() => focusMemberId ? allLists.filter(l => l.memberIds.includes(focusMemberId) || (focusShowsShared && l.memberIds.length === 0)) : allLists,
    [allLists, focusMemberId, focusShowsShared])
  const lists = useMemo(() => visible.filter(l => !l.archived), [visible])
  const archived = useMemo(() => visible.filter(l => l.archived), [visible])
  const sections = useMemo(() => listSections(lists), [lists])
  const [collapsed, setCollapsed] = useState<ListType[]>(readCollapsed)
  const toggleSection = (type: ListType) => {
    const next = collapsed.includes(type) ? collapsed.filter(k => k !== type) : [...collapsed, type]
    setCollapsed(next)
    try { localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next)) } catch { /* private mode */ }
  }
  const [reordering, setReordering] = useState(false) // Edit lists mode: tap a list to edit it, drag or move it to reorder
  // A section's new order (ids): saved for the whole family; everything else keeps its place.
  const reorder = async (ids: string[]) => {
    const order = reorderWithin(allLists, ids)
    setLists(ls => ls.map(l => ({ ...l, sort: order.indexOf(l.id) })))
    try { await api.reorderLists(order) }
    catch (e) { toast(e instanceof ApiError ? e.message : t('Could not reorder lists'), true); load() }
  }
  const nudge = (ids: string[], list: List, dir: -1 | 1) => {
    const i = ids.indexOf(list.id), j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    const next = [...ids]
    ;[next[i], next[j]] = [next[j], next[i]]
    reorder(next)
    announce(t('{item} moved to position {n} of {total}', { item: list.name, n: j + 1, total: ids.length }))
  }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // The address names the open list (listRoute): #/lists/<id>, #/lists/<id>/shop; #/lists is the
  // overview, the open list's history parent on a phone. Old #/lists?list=<id> links move over.
  const route = listRoute(location.hash)
  const [shopId, setShopId] = useState<string | null>(route.shop ? route.id : null)
  const [selectedId, setSelectedId] = useState<string | null>(() => route.id ?? hashQuery(location.hash).get('gsd')) // gsd: Get stuff done open on it before a reload
  const [missing, setMissing] = useState(false) // a link to a list that isn't here anymore
  const [editList, setEditList] = useState<List | 'new' | null>(null)
  const phone = useRef(isPhone)
  phone.current = isPhone
  useEffect(() => {
    const read = () => {
      const r = listRoute(location.hash)
      if (r.redirect) { location.replace(r.redirect); return }
      if (!location.hash.startsWith('#/lists')) return // on the way out
      setShopId(r.shop ? r.id : null)
      setSelectedId(cur => r.id ?? (phone.current ? null : cur)) // the wall keeps one open
      if (r.id) setMissing(false)
    }
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  // A phone steps into a list (Back comes out to the overview); a wide screen shows both, so
  // switching lists replaces the address instead of piling up history.
  const openList = (id: string) => {
    const to = `#/lists/${encodeURIComponent(id)}`
    setMissing(false)
    if (!phone.current) { history.replaceState(history.state, '', to); tellAppHere(); setSelectedId(id); return }
    location.hash = to
    history.replaceState({ ...history.state, kinwallListFrom: true }, '')
  }
  const toOverview = () => { if (history.state?.kinwallListFrom) history.back(); else location.replace('#/lists') }

  const load = () => {
    setLoading(true)
    api.getLists(true).then(l => { setLists(l); setError(false) }).catch(() => setError(true)).finally(() => setLoading(false))
  }
  useEffect(load, [refreshTick])
  // The open list's fresh counts ("3 left") replace its card's, without refetching every list.
  const syncCard = (list: List) => setLists(ls => ls.map(l => (l.id === list.id ? list : l)))

  // Selected list disappeared (archived / deleted elsewhere): drop back to the list-of-lists on a
  // phone; on the wall display there's room for both, so always have one open.
  useEffect(() => {
    if (loading) return
    const gone = selectedId && !lists.find(l => l.id === selectedId)
    if (gone) { setMissing(true); history.replaceState(history.state, '', '#/lists') } // "That list isn't here anymore", and a reload doesn't ask again
    if (gone && shopId === selectedId) { setShopId(null); location.replace('#/lists') }
    if (gone || (!selectedId && !isPhone)) setSelectedId(isPhone ? null : sections[0]?.lists[0]?.id ?? null)
  }, [lists, sections, loading, selectedId, isPhone, shopId])

  if (error) return <div className="content"><div className="state-card">{t("Couldn't load lists.")}</div></div>

  if (!loading && lists.length === 0 && archived.length === 0) {
    return (
      <div className="content">
        <div className="empty-card"><span className="emoji">📝</span>{t('No lists yet — start a shopping list, to-do list, or packing list.')}</div>
        <button className="fab" onClick={() => setEditList('new')} aria-label={t('New list')}><PlusIcon /></button>
        {editList && <ListEditSheet list={editList} onClose={() => setEditList(null)} onSaved={created => { setEditList(null); load(); if (created) openList(created.id) }} onDeleted={() => { setEditList(null); load() }} />}
      </div>
    )
  }

  const cards = (
    <div className="lists-col">
      {missing && <div className="state-card">{t("That isn't here anymore.")}</div>}
      {reordering && (
        <div className="edit-mode-bar" role="status">
          <span>{t('Tap a list to edit it, or drag to reorder.')}</span>
          <button type="button" className="btn btn-primary" onClick={() => setReordering(false)}>{t('Done')}</button>
        </div>
      )}
      {sections.map(s => {
        const open = reordering || !collapsed.includes(s.type)
        const ids = s.lists.map(l => l.id)
        return (
          <section key={s.type} className="lists-section" aria-label={tm(s.label)}>
            <button className="lists-section-head" aria-expanded={open} onClick={() => toggleSection(s.type)} disabled={reordering}>
              <ChevronRight width={18} height={18} aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : undefined }} />
              <span className="lists-section-label">{tm(s.label)}</span>
              <span className="lists-section-count">{s.lists.length}</span>
            </button>
            {open && (reordering
              ? <DragList items={s.lists.map(l => ({ ...l, title: l.name }))} onReorder={reorder}
                  renderRow={(l, handle) => <ReorderCard list={l} handle={handle} first={ids[0] === l.id} last={ids[ids.length - 1] === l.id} onMove={dir => nudge(ids, l, dir)} onEdit={() => setEditList(l)} />} />
              : s.lists.map(l => (
                <ListCard key={l.id} list={l} active={selectedId === l.id} members={members} onSelect={() => openList(l.id)} onEdit={parentDevice ? () => setEditList(l) : undefined} />
              )))}
          </section>
        )
      })}
      {!reordering && (
        <div className="lists-col-actions">
          <button className="btn btn-secondary list-new-btn" onClick={() => setEditList('new')}><PlusIcon width={18} height={18} /> {t('New list')}</button>
          {parentDevice && <button className="btn btn-secondary" onClick={() => setReordering(true)}><EditIcon width={18} height={18} aria-hidden="true" /> {t('Edit lists')}</button>}
        </div>
      )}
      {!reordering && parentDevice && <ArchivedLists lists={archived} onChanged={load} />}
    </div>
  )

  return (
    <div className="content lists-content">
      {isPhone ? (
        selectedId ? (
          <ListDetailPane listId={selectedId} lists={lists} isPhone shopMode={shopId === selectedId} onBack={toOverview} onArchivedOrDeleted={() => { toOverview(); setSelectedId(null); load() }} onLoaded={syncCard} />
        ) : (
          <div className="lists-shell lists-shell-phone">{cards}</div>
        )
      ) : (
        <div className="lists-shell">
          {cards}
          {selectedId
            ? <ListDetailPane listId={selectedId} lists={lists} isPhone={false} shopMode={shopId === selectedId} onBack={toOverview} onArchivedOrDeleted={() => { toOverview(); setSelectedId(null); load() }} onLoaded={syncCard} />
            : <div className="list-detail list-detail-empty"><div className="empty-card"><span className="emoji">👈</span>{t('Pick a list to open it.')}</div></div>}
        </div>
      )}
      {editList && <ListEditSheet list={editList} onClose={() => setEditList(null)} onSaved={created => { setEditList(null); load(); if (created) openList(created.id) }} onDeleted={() => { setEditList(null); load() }} />}
    </div>
  )
}
