import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addDays, format } from 'date-fns'
import { useApp } from './AppContext.tsx'
import { api, ApiError } from './api.ts'
import { applyListOps, type Op } from './outbox.ts'
import type { EventInstance, ItemSuggestion, List, ListCatalog, ListDetail, ListGroupBy, ListItem, ListItemPriority, ListItemStep, ListKind, ListSortBy, Member, RememberedItem, BarcodeLookup } from './types.ts'
import { aisleOrderMap, compareAisles, compareItems, LIST_EMOJI, MEMBER_PALETTE, type AisleOrder } from './types.ts'
import { dateKey } from './date.ts'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { MemberPicker } from './MemberPicker.tsx'
import { isSingleEmoji } from './emoji.ts'
import { colorName } from './color.ts'
import { useIsPhone } from './useIsPhone.ts'
import { BasketIcon, CalendarIcon, CartIcon, CheckIcon, ChevronLeft, ChevronRight, FilterIcon, NoteIcon, PlusIcon, RepeatIcon, TrashIcon, XIcon } from './icons.tsx'
import { announce, pressable, Segmented } from './a11y.tsx'
import { useDialog } from './dialog.tsx'
import { CustomColorSwatch } from './ColorSwatch.tsx'
import { PRIORITY_LABEL, PRIORITY_MARK, PriorityBadge } from './PriorityBadge.tsx'
import NotesThread from './NotesThread.tsx'
import { actorName, byLine, nowrap, whenLabel } from './addedBy.ts'
import { aisleAt, ANY_STORE, anyStoreView, departmentAisle, placeNeeds, setShoppingModeList, setTripReverse, setTripStore, tripLeftovers, tripReverse, tripStore, tripStoreFor, tripView } from './trip.ts'
import { hashPath, hashQuery } from './hashQuery.ts'
import { holdAwake } from './wakeLock.ts'
import GetStuffDone from './GetStuffDone.tsx'
import { shoppingActivity } from './liveActivity.ts'
import { appBarcodeScanner, endAppActivity, scanBarcode, tellAppActivity, wallCamera } from './native.ts'
import { itemKey, matchItems } from './itemSuggest.ts'
import { SWIPE_REVEAL, swipeAxis, swipeEnd, swipeOffset } from './swipe.ts'
import { canChangeItem, listSections, listType, reorderWithin, TYPE_LABEL, typeFields, type ListType } from './listSections.ts'
import { activeCatalogFilters, boughtLabel, CATALOG_GROUP_LABELS, CATALOG_SORT_LABELS, catalogDepartments, catalogFilterSummary, catalogStores, catalogTags, catalogView, filterCatalog, groupCatalog, placeLabel, placesFor, placesInput, scanMatch, scanTarget, setCatalogView, sortCatalog, STARTER_TAGS, tagsInput, type CatalogGroup, type CatalogSort } from './catalog.ts'
import { Face, ChipFace } from './Face'

// The list types in the edit sheet, each with its icon (Groceries first among the shopping ones).
const TYPE_ICON: Record<ListType, typeof CartIcon> = { todo: CheckIcon, groceries: BasketIcon, shopping: CartIcon, reusable: RepeatIcon }
const TYPE_ORDER: ListType[] = ['todo', 'groceries', 'shopping', 'reusable']
/** A shopping list's catalog, by type: "Grocery catalog" / "Shopping catalog". */
const catalogName = (catalog: ListCatalog) => (catalog === 'groceries' ? 'Grocery catalog' : 'Shopping catalog')

/** "3 left" / "All done" summary shown on a list card, per SPEC. */
function countLabel(list: List) {
  if (list.itemCount === 0) return 'Empty'
  if (list.openCount === 0) return 'All done'
  return `${list.openCount} left${list.overdueCount ? `, ${list.overdueCount} overdue` : ''}`
}
/** "3 left · ⚠ 2 overdue": the overdue part in the danger color with an icon, so it's not color alone. */
function CountLine({ list }: { list: List }) {
  if (!list.overdueCount || list.openCount === 0) return <>{countLabel(list)}</>
  return <>{list.openCount} left · <span className="list-overdue">⚠ {list.overdueCount} overdue</span></>
}

const SORT_LABEL: Record<ListSortBy, string> = { manual: 'Manual', added: 'Date added', due: 'Due date', priority: 'Priority', alpha: 'A–Z', aisle: 'Aisle' }
const SORT_HINT: Record<ListSortBy, string> = {
  manual: 'Your order, urgent and important first',
  added: 'Newest first',
  due: 'Soonest first, no date last',
  priority: 'Urgent first, then by due date',
  alpha: 'Alphabetical',
  aisle: 'By store, in the order you walk the aisles',
}
const GROUP_LABEL: Record<ListGroupBy, string> = { store: 'Store', category: 'Category', aisle: 'Aisle', none: 'None' }
/** What a new list of this kind starts with (the server's defaults); anything else counts on the View button. */
const listViewDefaults = (kind: ListKind): { groupBy: ListGroupBy; sortBy: ListSortBy } =>
  kind === 'shopping' ? { groupBy: 'aisle', sortBy: 'aisle' } : { groupBy: 'none', sortBy: 'manual' }
/** Reset on a reusable list (unchecks for next time), else Clear checked. A shopping trip's own
 * checkout says "Done shopping" instead (TRIP_DONE_LABEL). */
const CHECKOUT_LABEL: Record<ListKind, string> = { shopping: 'Clear checked', reusable: 'Reset', todo: 'Clear checked' }
const TRIP_DONE_LABEL = 'Done shopping'
const todayKey = () => dateKey(new Date())

/** "Due today" / "Due Fri, Oct 3" / "Overdue · Sep 22" (open items only). */
function dueLabel(item: ListItem): { text: string; overdue: boolean } | null {
  if (!item.dueDate) return null
  const today = todayKey()
  const d = new Date(item.dueDate + 'T00:00:00')
  if (item.dueDate === today) return { text: 'Due today', overdue: false }
  if (item.dueDate < today && !item.done) return { text: `Overdue · ${format(d, 'MMM d')}`, overdue: true }
  return { text: `Due ${format(d, 'EEE, MMM d')}`, overdue: false }
}

const eventDay = (e: EventInstance) => new Date(e.allDay ? e.start + 'T00:00:00' : e.start)
const eventLabel = (e: EventInstance) => `${format(eventDay(e), 'EEE, MMM d')} · ${e.title}`

/** Events from 30 days back to 30 ahead: `upcoming` (next occurrence per id, for the picker) and
 * `byId` (a linked item's event - its next occurrence, else a past one). */
function useEventWindow(dep: unknown) {
  const [events, setEvents] = useState<EventInstance[]>([])
  useEffect(() => {
    const now = new Date()
    api.getEvents(addDays(now, -30).toISOString(), addDays(now, 30).toISOString())
      .then(evs => setEvents(evs.sort((a, b) => eventDay(a).getTime() - eventDay(b).getTime()))).catch(() => setEvents([]))
  }, [dep])
  const now = Date.now()
  const byId = new Map<string, EventInstance>()
  for (const e of events) if (new Date(e.allDay ? e.end + 'T00:00:00' : e.end).getTime() > now && !byId.has(e.id)) byId.set(e.id, e)
  const upcoming = [...byId.values()]
  for (const e of events) if (!byId.has(e.id)) byId.set(e.id, e)
  return { upcoming, byId }
}

function ownersOf(list: List, members: Member[]) {
  return list.memberIds.map(id => members.find(m => m.id === id)).filter((m): m is Member => !!m)
}

function ListCard({ list, active, members, onSelect, onEdit }: {
  list: List; active: boolean; members: Member[]; onSelect: () => void; onEdit?: () => void
}) {
  // Long-press to edit (parent devices only: no onEdit elsewhere), short tap to open - same interaction as ChoreCard.
  const pressTimer = useRef<ReturnType<typeof setTimeout>>()
  const longPressed = useRef(false)
  const handleDown = () => {
    longPressed.current = false
    if (onEdit) pressTimer.current = setTimeout(() => { longPressed.current = true; onEdit() }, 500)
  }
  const handleUp = () => {
    clearTimeout(pressTimer.current)
    if (!longPressed.current) onSelect()
  }
  const owners = ownersOf(list, members)
  // Keyboard: Enter/Space opens it (pointer taps go through handleUp); the open list's Edit button edits.
  const { role, tabIndex, onKeyDown } = pressable(onSelect)
  return (
    <div className={`list-card ${active ? 'active' : ''}`} role={role} tabIndex={tabIndex} onKeyDown={onKeyDown}
      aria-current={active || undefined} onContextMenu={onEdit && (e => { e.preventDefault(); onEdit() })}
      aria-label={[list.name, countLabel(list), list.isDefault ? `default ${TYPE_LABEL[listType(list)]} list` : '', owners.length ? `for ${owners.map(m => m.name).join(' and ')}` : ''].filter(Boolean).join(', ')}
      style={{ ['--list-color' as string]: list.color || 'var(--accent)' }}
      onPointerDown={handleDown} onPointerUp={handleUp} onPointerLeave={() => clearTimeout(pressTimer.current)}>
      <div className="list-card-accent" />
      <div className="list-card-emoji">{list.emoji || '📝'}</div>
      <div className="list-card-body">
        <div className="list-card-name">{list.name}</div>
        <div className="list-card-sub"><CountLine list={list} />{list.isDefault && <span className="list-card-default"> · ⭐ Default</span>}</div>
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

/** A list card in Reorder mode: drag it by the grip, or Move up / Move down. */
function ReorderCard({ list, handle, first, last, onMove }: { list: List; handle: React.ReactNode; first: boolean; last: boolean; onMove: (dir: -1 | 1) => void }) {
  return (
    <div className="list-card list-card-reorder" style={{ ['--list-color' as string]: list.color || 'var(--accent)' }}>
      <div className="list-card-accent" />
      {handle}
      <div className="list-card-emoji" aria-hidden="true">{list.emoji || '📝'}</div>
      <div className="list-card-body"><div className="list-card-name">{list.name}</div></div>
      <button className="icon-btn" onClick={() => onMove(-1)} disabled={first} aria-label={`Move ${list.name} up`}><ChevronRight width={20} height={20} style={{ transform: 'rotate(-90deg)' }} /></button>
      <button className="icon-btn" onClick={() => onMove(1)} disabled={last} aria-label={`Move ${list.name} down`}><ChevronRight width={20} height={20} style={{ transform: 'rotate(90deg)' }} /></button>
    </div>
  )
}

const COLLAPSED_KEY = 'kinwall.listsCollapsed' // this device's folded sections on the Lists page
function readCollapsed(): ListType[] {
  try { return JSON.parse(localStorage.getItem(COLLAPSED_KEY) || '[]') } catch { return [] }
}

function ListEditSheet({ list, onClose, onSaved, onDeleted, onManage }: {
  list: List | 'new'; onClose: () => void; onSaved: () => void; onDeleted: () => void
  onManage?: () => void // shopping lists: open "Stores & departments"
}) {
  const dialog = useDialog()
  const { members, toast } = useApp()
  const existing = list === 'new' ? null : list
  const [name, setName] = useState(existing?.name ?? '')
  const [type, setType] = useState<ListType>(existing ? listType(existing) : 'todo')
  const kind = typeFields(type).kind
  const [emoji, setEmoji] = useState(existing?.emoji ?? LIST_EMOJI[0])
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
      if (existing) await api.updateList(existing.id, body)
      else await api.createList(body)
      onSaved()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save list', true) }
  }
  const archive = async () => {
    if (!existing) return
    try { await api.updateList(existing.id, { archived: true }); announce(`${existing.name} archived`); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not archive list', true) }
  }
  const del = async () => {
    if (!existing) return
    if (!await dialog.confirm({ title: `Delete "${existing.name}"?`, body: 'This removes all its items too.', confirmLabel: 'Delete', danger: true })) return
    try { await api.deleteList(existing.id); onDeleted() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete list', true) }
  }

  return (
    <Sheet title={existing ? 'Edit list' : 'New list'} onClose={onClose}
      actions={
        <>
          {existing && <button className="btn btn-danger" onClick={del} aria-label="Delete"><TrashIcon width={18} height={18} /></button>}
          {existing && <button className="btn btn-secondary" onClick={archive}>Archive</button>}
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim() || !isSingleEmoji(emoji)}>{existing ? 'Save' : 'Create list'}</button>
        </>
      }>
      <div className="field">
        <label>Name</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="List name" autoComplete="off" autoFocus={!existing} />
      </div>
      <div className="field">
        <label>Type</label>
        <Segmented label="Type" className="list-type-seg" value={type} onChange={setType}
          options={TYPE_ORDER.map(t => { const Icon = TYPE_ICON[t]; return { key: t, label: <><Icon width={20} height={20} aria-hidden="true" />{TYPE_LABEL[t]}</> } })} />
        {(type === 'groceries' || type === 'shopping') && (
          <p className="field-hint">{type === 'groceries' ? 'Food and household groceries. Meals add ingredients here.' : 'Hardware, clothes, gifts and other shopping.'} It has its own catalog of things you buy.</p>
        )}
      </div>
      <div className="field">
        <div className="steps-head">
          <label id="list-keep-checked">Keep checked items in place</label>
          <button className={`switch ${keepChecked ? 'on' : ''}`} role="switch" aria-checked={keepChecked} aria-labelledby="list-keep-checked" aria-describedby="list-keep-checked-hint"
            onClick={() => setKeep(!keepChecked)}><span className="knob" /></button>
        </div>
        <p className="field-hint" id="list-keep-checked-hint">{keepChecked
          ? `Checked items stay where they are, crossed off, until you tap ${CHECKOUT_LABEL[kind]}.`
          : 'Checked items move to a Done section at the bottom.'}</p>
      </div>
      {defaultable && (
        <div className="field">
          <div className="steps-head">
            <label id="list-default">Default {TYPE_LABEL[type]} list</label>
            <button className={`switch ${isDefault ? 'on' : ''}`} role="switch" aria-checked={isDefault} aria-labelledby="list-default" aria-describedby="list-default-hint"
              onClick={() => setDefault(!isDefault)}><span className="knob" /></button>
          </div>
          <p className="field-hint" id="list-default-hint">{type === 'groceries'
            ? "Scanned food, meal ingredients, and the app's widgets, Siri and tiles use this list."
            : 'Scanned household and beauty items go to this list.'} Turning it on here turns it off on your other {TYPE_LABEL[type]} lists.</p>
        </div>
      )}
      <div className="field">
        <label>Emoji</label>
        <div className="emoji-swatch-row">
          {LIST_EMOJI.map(e => <button key={e} className={`emoji-swatch ${emoji === e ? 'active' : ''}`} aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>)}
        </div>
        <AnyEmojiField value={emoji} onChange={setEmoji} />
      </div>
      <div className="field">
        <label>Color</label>
        <div className="color-swatch-row">
          {MEMBER_PALETTE.map(c => <button key={c} className={`color-swatch ${color === c ? 'active' : ''}`} aria-pressed={color === c} style={{ background: c }} onClick={() => setColor(c)} aria-label={colorName(c)} />)}
          <CustomColorSwatch value={color} presets={MEMBER_PALETTE} onChange={hex => setColor(hex)} label="Custom list color" />
        </div>
      </div>
      <MemberPicker members={members} selected={memberIds} onChange={setMemberIds} label="Owners (nobody = whole family)" />
      {onManage && existing?.kind === 'shopping' && (
        <div className="field">
          <label>Stores &amp; departments</label>
          <button className="btn btn-secondary btn-block" onClick={onManage}>Rename stores, departments and aisles, or set aisle order</button>
        </div>
      )}
    </Sheet>
  )
}

const NEW_VALUE = '\u0000new'

/** A real dropdown of the household's values (a native select: the iPhone wheel, a big list on a
 * wall screen), plus "None" and "New …", which reveals a text field for a value not seen before. */
function ValuePicker({ id, label, value, options, onChange, newLabel, placeholder, noneLabel = 'None' }: {
  id: string; label: string; value: string; options: string[]; onChange: (v: string) => void; newLabel: string; placeholder: string; noneLabel?: string
}) {
  const [adding, setAdding] = useState(false)
  const typing = adding || (!!value && !options.includes(value)) // a value from elsewhere shows as typed
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={typing ? NEW_VALUE : value}
        onChange={e => { const v = e.target.value; setAdding(v === NEW_VALUE); onChange(v === NEW_VALUE ? '' : v) }}>
        <option value="">{noneLabel}</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
        <option value={NEW_VALUE}>{newLabel}</option>
      </select>
      {typing && (
        <input type="text" className="value-picker-new" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
          aria-label={`${label} name`} autoFocus={adding} maxLength={60} autoComplete="off" />
      )}
    </div>
  )
}

/** A store's known aisles in walking order (its custom order, then natural order). */
function storeAisles(suggestions: ListDetail['suggestions'], store: string | null, order: AisleOrder): string[] {
  return suggestions.aisles.filter(a => a.store === store).map(a => a.aisle).sort((a, b) => compareAisles(store, a, b, order))
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
    try { await api.moveListItems(listId, [item.id], to.id); announce(`Moved ${item.title} to ${to.name}`); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not move it', true) }
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
  const deptAisle = departmentAisle(category, storeAisles(suggestions, aisleStore, aisleOrder)) // shown, not saved
  const [memberId, setMemberId] = useState<string | null>(item.memberId)
  const [dueDate, setDueDate] = useState(item.dueDate ?? '')
  const [eventId, setEventId] = useState<string | null>(item.eventId)
  const [priority, setPriority] = useState(item.priority)
  const [live, setLive] = useState(item) // steps save as they change; this holds the latest item from the server
  const [pickingEvent, setPickingEvent] = useState(false)
  const linked = eventId ? byId.get(eventId) : undefined
  const showDue = kind === 'todo' || !!item.dueDate // due dates are a to-do thing, but one set elsewhere (API, MCP) stays editable

  const submit = async () => {
    if (!title.trim()) return
    const body = {
      title: title.replace(/\s+/g, ' ').trim(), quantity: quantity.trim() || null, notes: notes.trim() || null, priority,
      ...(kind === 'shopping' ? { store: store.trim() || null, category: category.trim() || null } : {}),
      // On a trip the aisle is the trip store's (sent only when changed, so an untouched one isn't remembered).
      ...(kind === 'shopping' && !trip ? { aisle: aisle.trim() || null } : {}),
      ...(kind === 'shopping' && trip && aisle.trim() !== initialAisle ? { aisle: aisle.trim() || null, aisleStore: trip } : {}),
      // Assignees on to-do and reusable lists (a routine has each person's jobs); due dates are to-do only.
      ...(kind !== 'shopping' ? { memberId } : {}),
      ...(showDue ? { dueDate: dueDate || null } : {}),
      ...(eventId !== item.eventId ? { eventId } : {}), // only when changed: a link to a since-deleted event still saves
    }
    try { await api.queueUpdateListItem(listId, item.id, body); onSaved() } // offline too: syncs when back
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save item', true) }
  }
  const del = async () => {
    if (!await dialog.confirm({ title: `Delete "${item.title}"?`, confirmLabel: 'Delete', danger: true })) return
    try { await api.queueDeleteListItem(listId, item.id); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete item', true) }
  }
  const move = async (dir: -1 | 1) => {
    const i = siblingIds.indexOf(item.id)
    if (i < 0) return
    const j = i + dir
    if (j < 0 || j >= siblingIds.length) return
    const next = [...siblingIds]
    ;[next[i], next[j]] = [next[j], next[i]]
    try { await api.reorderListItems(listId, next); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not reorder', true) }
  }

  const quantityAndPlace = (
    <>
      <div className="field">
        <label>Quantity</label>
        <input type="text" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="e.g. 2, 1 lb, x3" />
      </div>
      {kind === 'shopping' && (
        <>
          <ValuePicker id="item-store" label="Store" value={store} options={suggestions.stores} newLabel="New store…" placeholder="Store name"
            onChange={v => {
              setStore(v)
              // An aisle belongs to a store: keep it only if the new store has it too (a trip's stays the trip store's).
              if (!trip && aisle && !storeAisles(suggestions, v.trim() || null, aisleOrder).includes(aisle)) setAisle('')
            }} />
          {!store.trim() && lastStore && (
            <p className="field-hint item-last-store">Last bought at {lastStore}. <button type="button" className="link-btn" onClick={() => setStore(lastStore)}>Plan to buy it there</button></p>
          )}
          <ValuePicker id="item-aisle" label={aisleStore ? `Aisle at ${aisleStore}` : 'Aisle'} value={aisle}
            options={storeAisles(suggestions, aisleStore, aisleOrder)} newLabel="New aisle…" placeholder="e.g. Aisle 4, Produce, Back wall" onChange={setAisle} />
          {!aisle.trim() && deptAisle && <p className="field-hint item-dept-aisle">{deptAisle}, from its department</p>}
        </>
      )}
    </>
  )

  const priorityField = (
    <div className="field">
      <label id="item-priority-label">Priority</label>
      <Segmented className="priority-seg" label="Priority" value={priority} onChange={setPriority}
        options={(['low', 'normal', 'high', 'urgent'] as ListItemPriority[]).map(p => ({
          key: p, label: <>{p !== 'normal' && <span className={`prio-mark prio-${p}`} aria-hidden="true">{PRIORITY_MARK[p]}</span>}{PRIORITY_LABEL[p]}</>,
        }))} />
    </div>
  )
  const eventAndNotes = (
    <>
      <div className="field">
        <label>Linked event</label>
        <button className="btn btn-secondary btn-block" style={{ justifyContent: 'flex-start', minHeight: 44 }} onClick={() => setPickingEvent(v => !v)} aria-expanded={pickingEvent}
          aria-label={`Linked event: ${eventId ? (linked ? eventLabel(linked) : 'an event outside the next 30 days') : 'none'}`}>
          <CalendarIcon width={16} height={16} />{eventId ? (linked ? eventLabel(linked) : 'An event outside the next 30 days') : 'None'}
        </button>
        {pickingEvent && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 240, overflowY: 'auto', marginTop: 6 }}>
            <button className={`chip ${eventId === null ? 'active' : ''}`} aria-pressed={eventId === null} style={{ minHeight: 44 }} onClick={() => { setEventId(null); setPickingEvent(false) }}>None</button>
            {upcoming.map(e => (
              <button key={e.id} className={`chip ${eventId === e.id ? 'active' : ''}`} aria-pressed={eventId === e.id} style={{ minHeight: 44, justifyContent: 'flex-start', ['--chip-color' as string]: e.color }}
                onClick={() => { setEventId(e.id); setPickingEvent(false) }}>{eventLabel(e)}</button>
            ))}
            {upcoming.length === 0 && <div className="list-item-meta">No events in the next 30 days</div>}
          </div>
        )}
      </div>
      <div className="field">
        <label>Notes</label>
        <textarea className="item-notes-input" value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
    </>
  )

  return (
    <Sheet title={readOnly ? 'Item' : 'Edit item'} onClose={onClose}
      actions={readOnly ? <button className="btn btn-primary" onClick={onClose}>Done</button> : <>
        <button className="btn btn-danger" onClick={del} aria-label="Delete"><TrashIcon width={18} height={18} /></button>
        <button className="btn btn-primary" onClick={submit} disabled={!title.trim()}>Save</button>
      </>}>
      {readOnly && <p className="field-hint item-read-only">{`This one is ${members.find(m => m.id === item.memberId)?.name ?? 'someone else'}'s.`}</p>}
      {/* Read-only: every field and button inside is disabled; the discussion below stays open. */}
      <fieldset className="item-sheet-fields" disabled={readOnly}>
      <div className="field">
        <label htmlFor="item-title">Title</label>
        {/* A textarea so a long title shows in full; Enter doesn't add a line break. */}
        <textarea id="item-title" className="item-title-input" rows={2} value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }} />
        <ItemByLines item={live} members={members} />
      </div>
      {kind === 'shopping' && quantityAndPlace /* on a shopping list, where it goes comes first */}
      {kind !== 'shopping' && priorityField}
      <StepsEditor listId={listId} item={live} onChange={setLive} />
      {kind !== 'shopping' && quantityAndPlace}
      {moveTargets.length > 0 && (
        <div className="field">
          <button className="btn btn-secondary btn-block" onClick={() => setMoving(true)} aria-haspopup="dialog">Move to another list…</button>
        </div>
      )}
      {moving && (
        <Sheet title="Move to…" onClose={() => setMoving(false)}>
          <p className="field-hint">{item.title} keeps everything on it: notes, steps and discussion.</p>
          <div className="shop-store-options">
            {moveTargets.map(l => <button key={l.id} className="btn btn-secondary btn-block" onClick={() => moveTo(l)}>{l.emoji ? `${l.emoji} ` : ''}{l.name}</button>)}
          </div>
        </Sheet>
      )}
      {kind !== 'shopping' && (
          <div className="field">
            <label>Assign to</label>
            <div className="chip-row">
              <button className={`chip ${memberId === null ? 'active' : ''}`} aria-pressed={memberId === null} onClick={() => setMemberId(null)}>Nobody</button>
              {members.map(m => (
                <button key={m.id} className={`chip ${memberId === m.id ? 'active' : ''}`} aria-pressed={memberId === m.id} style={{ ['--chip-color' as string]: m.color }} onClick={() => setMemberId(m.id)}><ChipFace m={m} /> {m.name}</button>
              ))}
            </div>
          </div>
      )}
      {showDue && (
          <div className="field">
            <label htmlFor="item-due">Due date</label>
            <div className="due-field">
              <input id="item-due" type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
              {dueDate && <button type="button" className="btn btn-secondary" onClick={() => { setDueDate(''); announce('Due date cleared') }} aria-label="Clear due date">Clear</button>}
            </div>
          </div>
      )}
      {kind === 'shopping' ? (
        // Groceries: where it goes stays up front; the rest folds away, with what's set in the summary.
        <details className="settings-disclosure item-more">
          <summary>{['More', category.trim(), priority !== 'normal' && `${PRIORITY_LABEL[priority]} priority`, eventId && 'Event', notes.trim() && 'Notes'].filter(Boolean).join(' · ')}</summary>
          <ValuePicker id="item-category" label="Department" value={category} options={suggestions.categories} newLabel="New department…" placeholder="e.g. Produce" onChange={setCategory} />
          {priorityField}
          {eventAndNotes}
        </details>
      ) : eventAndNotes}
      </fieldset>
      {settings.features.notes && <NotesThread target={`list_item:${item.id}`} title="Discussion" />}
      {manual && !readOnly && (
        <div className="field">
          <label>Order</label>
          <div className="chip-row">
            <button className="btn btn-secondary" onClick={() => move(-1)} disabled={siblingIds.indexOf(item.id) <= 0}>Move up</button>
            <button className="btn btn-secondary" onClick={() => move(1)} disabled={siblingIds.indexOf(item.id) >= siblingIds.length - 1}>Move down</button>
          </div>
        </div>
      )}
    </Sheet>
  )
}

/** "Added by Maya · Tue 4:12 PM" and, once ticked, "Checked off by Leo · 5:02 PM"; nothing when nobody is known. */
function ItemByLines({ item, members }: { item: ListItem; members: Member[] }) {
  const lines = [byLine('Added by', item.addedBy, item.createdAt, members), item.done ? byLine('Checked off by', item.checkedBy, item.doneAt, members) : null].filter(l => l !== null)
  if (lines.length === 0) return null
  return <div className="item-by-lines">{lines.map(l => <div key={l}>{l}</div>)}</div>
}

/** "Last done: Maya · Tue 8:10 PM" on a reusable list; nothing until it's been done. */
function lastDoneLine(list: List, members: Member[]): string | null {
  if (list.kind !== 'reusable' || !list.lastDoneAt) return null
  const who = actorName(list.lastDoneBy, members)
  return `Last done: ${who ? `${who} · ` : ''}${nowrap(whenLabel(list.lastDoneAt))}`
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

  const run = async (req: Promise<ListItem>, what: string) => {
    try { const next = await req; onChange(next); return next }
    catch (e) { toast(e instanceof ApiError ? e.message : `Could not ${what}`, true); return null }
  }
  const tick = async (step: ListItemStep) => {
    const wasDone = step.done, itemWasDone = item.done // read first: the demo's mock updates objects in place
    const next = await run(api.updateListItemStep(listId, item.id, step.id, { done: !wasDone }), 'update step')
    if (!next) return
    const upNext = next.steps.find(st => !st.done)
    if (next.done && !itemWasDone) announce(`${step.title} done. All steps finished: ${item.title} is done`)
    else if (!next.done && itemWasDone) announce(`${step.title} not done. ${item.title} is open again`)
    else if (wasDone) announce(`${step.title} not done, ${next.stepsDone} of ${next.stepsTotal}`)
    else announce(`${step.title} done, ${next.stepsDone} of ${next.stepsTotal}${oneAtATime && upNext ? `. Next: ${upNext.title}` : ''}`)
  }
  const add = async () => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    if (await run(api.addListItemStep(listId, item.id, title), 'add step')) announce(`Added step ${title}`)
  }
  const remove = async (step: ListItemStep) => {
    if (await run(api.deleteListItemStep(listId, item.id, step.id), 'delete step')) announce(`Deleted step ${step.title}`)
  }
  const reorder = (ids: string[]) => {
    onChange({ ...item, steps: ids.map(id => steps.find(st => st.id === id)!) }) // shown at once, then saved
    run(api.reorderListItemSteps(listId, item.id, ids), 'reorder steps')
  }

  return (
    <div className="field">
      <div className="steps-head">
        <label id={`steps-${item.id}`}>Steps{steps.length > 0 && ` · ${item.stepsDone} of ${item.stepsTotal}`}</label>
        {steps.length > 1 && (
          <div className="steps-mode">
            <span id={`steps-one-${item.id}`}>One at a time</span>
            <button className={`switch ${oneAtATime ? 'on' : ''}`} role="switch" aria-checked={oneAtATime} aria-labelledby={`steps-one-${item.id}`}
              onClick={() => setOneAtATime(v => !v)}><span className="knob" /></button>
          </div>
        )}
      </div>
      {oneAtATime && steps.length > 1 ? (
        nextStep ? (
          <div className="step-focus">
            <div className="step-focus-count">Step {steps.indexOf(nextStep) + 1} of {steps.length}</div>
            <div className="step-focus-title">{nextStep.title}</div>
            <button className="btn btn-primary step-focus-btn" onClick={() => tick(nextStep)}>
              {steps.filter(st => !st.done).length === 1 ? 'Done — finish' : 'Done → next'}
            </button>
          </div>
        ) : (
          <div className="step-focus"><div className="step-focus-title"><span aria-hidden="true">✨ </span>All steps done!</div></div>
        )
      ) : (
        <div role="group" aria-labelledby={`steps-${item.id}`}>
          <DragList items={steps} onReorder={reorder} renderRow={(st, handle) => (
            <div className={`list-item-row step-row ${st.done ? 'done' : ''}`}>
              <button className={`list-item-check ${st.done ? 'done' : ''}`} onClick={() => tick(st)} role="checkbox" aria-checked={st.done} aria-label={st.title}>
                {st.done && <CheckIcon width={20} height={20} />}
              </button>
              <div className="list-item-body step-body"><div className="list-item-title">{st.title}</div></div>
              <button className="icon-btn" onClick={() => remove(st)} aria-label={`Delete step ${st.title}`}><TrashIcon width={16} height={16} /></button>
              {handle}
            </div>
          )} />
        </div>
      )}
      <div className="list-add-bar step-add">
        <input type="text" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }}
          placeholder="Add a step…" aria-label={`Add a step to ${item.title}`} enterKeyHint="done" />
        <button className="icon-btn" onClick={add} disabled={!draft.trim()} aria-label="Add step"><PlusIcon width={20} height={20} /></button>
      </div>
    </div>
  )
}

const OPEN_FACTS_NAMES: Partial<Record<BarcodeLookup['source'], string>> = {
  openfoodfacts: 'Open Food Facts', openproductsfacts: 'Open Products Facts', openbeautyfacts: 'Open Beauty Facts', openpetfoodfacts: 'Open Pet Food Facts',
}

/** After scanning a product the catalog doesn't know: where its name came from, the name to add,
 * and whether to save the barcode to the catalog (off unless chosen; the next scan then adds it at
 * once). Kids' own devices don't change the catalog, so they don't see the switch. */
function ScanSheet({ code, found, canSave, lists, target: suggested, checkOff, onAdd, onClose }: {
  code: string; found: BarcodeLookup | null; canSave: boolean; lists: List[]; target: string; checkOff: boolean // shopping: it's in the cart
  onAdd: (title: string, save: boolean, target: string) => void; onClose: () => void
}) {
  const [title, setTitle] = useState(found?.title ?? '')
  const [save, setSave] = useState(false)
  const [target, setTarget] = useState(suggested)
  const name = title.trim()
  const add = () => { if (name) onAdd(name, canSave && save, target) }
  return (
    <Sheet variant="dialog" title="Scanned product" onClose={onClose}
      actions={<>
        <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" onClick={add} disabled={!name}>{checkOff ? 'Add and check off' : 'Add to list'}</button>
      </>}>
      <p className="scan-source">
        {found ? `Name from ${OPEN_FACTS_NAMES[found.source] ?? 'Open Food Facts'}. Check it before adding.` : "The Open Food Facts databases don't know this one. Type its name."}
        {' '}<span className="scan-code">Barcode {code}</span>
      </p>
      <div className="field">
        <label htmlFor="scan-title">Name</label>
        <input id="scan-title" type="text" value={title} onChange={e => setTitle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} autoComplete="off" enterKeyHint="done" data-autofocus />
      </div>
      {lists.length > 1 && (
        <div className="field">
          <label htmlFor="scan-list">Add to</label>
          <select id="scan-list" className="settings-select" value={target} onChange={e => setTarget(e.target.value)}>
            {lists.map(l => <option key={l.id} value={l.id}>{l.emoji ? `${l.emoji} ` : ''}{l.name}</option>)}
          </select>
        </div>
      )}
      {canSave && (
        <div className="scan-save">
          <div>
            <div id="scan-save-label" className="settings-row-label">Also save to catalog</div>
            <div className="settings-row-sub">Next time, scanning it adds {name ? `"${name}"` : 'it'} right away.</div>
          </div>
          <button className={`switch ${save ? 'on' : ''}`} role="switch" aria-checked={save} aria-labelledby="scan-save-label" onClick={() => setSave(v => !v)}><span className="knob" /></button>
        </div>
      )}
    </Sheet>
  )
}

/** "Where did you find it?" after a scan while shopping: the item's aisle at this store and its
 * department, whichever it's missing. Skip leaves it as it is. */
function PlaceSheet({ title, store, need, category: initialCategory, aisles, departments, onSave, onClose }: {
  title: string; store: string | null; need: { aisle: boolean; department: boolean }; category: string
  aisles: string[]; departments: string[]; onSave: (aisle: string, category: string) => void; onClose: () => void
}) {
  const [aisle, setAisle] = useState('')
  const [category, setCategory] = useState(initialCategory)
  return (
    <Sheet variant="dialog" title="Where did you find it?" onClose={onClose}
      actions={<>
        <button className="btn btn-secondary" onClick={onClose}>Skip</button>
        <button className="btn btn-primary" onClick={() => onSave(aisle.trim(), category.trim())} disabled={!aisle.trim() && !category.trim()}>Save</button>
      </>}>
      <p className="scan-source">{title}: so it's in the right place next time.</p>
      {need.aisle && store && <ValuePicker id="place-aisle" label={`Aisle at ${store}`} value={aisle} options={aisles} newLabel="New aisle…" placeholder="e.g. Aisle 4, Produce, Back wall" onChange={setAisle} noneLabel="Pick an aisle" />}
      {need.department && <ValuePicker id="place-dept" label="Department" value={category} options={departments} newLabel="New department…" placeholder="e.g. Dairy, Pantry" onChange={setCategory} noneLabel="Pick a department" />}
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
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save order', true) }
  }
  return (
    <Sheet title={`Reorder ${groupBy === 'store' ? 'stores' : 'categories'}`} onClose={onClose}
      actions={<button className="btn btn-primary" onClick={save}>Save order</button>}>
      {order.map((name, i) => (
        <div key={name} className="settings-row">
          <div className="settings-row-label">{name}</div>
          <div className="chip-row">
            <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${name} up`}>▲</button>
            <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`Move ${name} down`}>▼</button>
          </div>
        </div>
      ))}
    </Sheet>
  )
}

/** Group, Sort and Show store for the list page (Filters button; Contacts uses the same pattern). */
function ListViewSheet({ list, stores, store, onStore, onGroupBy, onSortBy, onReorder, onClose }: {
  list: List; stores: string[]; store: string | null; onStore: (s: string | null) => void
  onGroupBy: (g: ListGroupBy) => void; onSortBy: (s: ListSortBy) => void; onReorder?: () => void; onClose: () => void
}) {
  const shopping = list.kind === 'shopping'
  const def = listViewDefaults(list.kind)
  const changed = list.groupBy !== def.groupBy || list.sortBy !== def.sortBy || store !== null
  return (
    <Sheet title="View" onClose={onClose} actions={<>
      <button className="btn btn-secondary" disabled={!changed} onClick={() => { if (shopping && list.groupBy !== def.groupBy) onGroupBy(def.groupBy); if (list.sortBy !== def.sortBy) onSortBy(def.sortBy); onStore(null) }}>Reset</button>
      <button className="btn btn-primary" onClick={onClose}>Done</button>
    </>}>
      {shopping && (
        <div className="field">
          <label htmlFor={`list-group-${list.id}`}>Group by</label>
          <select id={`list-group-${list.id}`} value={list.groupBy} onChange={e => onGroupBy(e.target.value as ListGroupBy)}>
            {(['store', 'aisle', 'none'] as ListGroupBy[]).map(g => <option key={g} value={g}>{GROUP_LABEL[g]}</option>) /* no category: a department fills in the aisle */}
          </select>
          {onReorder && <button className="link-btn" onClick={onReorder}>Reorder {list.groupBy === 'store' ? 'stores' : 'categories'}</button>}
        </div>
      )}
      <div className="field">
        <label htmlFor={`list-sort-${list.id}`}>Sort</label>
        <select id={`list-sort-${list.id}`} value={list.sortBy} onChange={e => onSortBy(e.target.value as ListSortBy)}>
          {(Object.keys(SORT_LABEL) as ListSortBy[]).filter(k => k !== 'aisle' || shopping || list.sortBy === 'aisle').map(k => <option key={k} value={k}>{SORT_LABEL[k]}</option>)}
        </select>
        <p className="field-hint">{SORT_HINT[list.sortBy]}{list.sortBy !== 'manual' && '. Switch to Manual to drag items into your own order.'}</p>
      </div>
      {shopping && stores.length > 0 && (
        <div className="field">
          <label htmlFor={`list-store-${list.id}`}>Show store</label>
          <select id={`list-store-${list.id}`} value={store ?? ''} onChange={e => onStore(e.target.value || null)}>
            <option value="">All stores</option>
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
  const showStore = kind === 'shopping' && groupBy !== 'store' && groupBy !== 'aisle' && item.store
  const showAisle = kind === 'shopping' && groupBy !== 'aisle' && item.aisle
  // A department that just repeats the aisle ("Produce · Produce") isn't shown twice.
  const showCategory = kind === 'shopping' && groupBy !== 'category' && item.category && item.category.toLowerCase() !== item.aisle?.toLowerCase()
  const due = dueLabel(item)
  const prio = item.priority !== 'normal' ? item.priority : null
  const notesOn = useApp().settings.features.notes // off: an item's own notes still show, its thread's count doesn't
  const row = (
    <div className={`list-item-row ${item.done ? 'done' : ''} ${prio === 'urgent' && !item.done ? 'urgent' : ''} ${item.pending ? 'pending' : ''}`} title={item.pending ? 'Not synced yet' : undefined}>
      <button className={`list-item-check ${item.done ? 'done' : ''} ${readOnly ? 'read-only' : ''}`} onClick={readOnly ? undefined : onToggle} role="checkbox" aria-checked={item.done} aria-disabled={readOnly || undefined}
        aria-label={item.pending ? `${item.title}, not synced yet` : readOnly && assignee ? `${item.title}, ${assignee.name}'s` : item.title}>
        {item.done && <CheckIcon width={20} height={20} />}
      </button>
      <div className="list-item-body" {...pressable(onOpen)}
        aria-label={[`Edit ${item.title}`, item.done && 'checked off', prio && `${PRIORITY_LABEL[prio]} priority`, due?.text, (item.notes || (notesOn && item.noteCount)) && 'has notes', item.stepsTotal > 0 && `${item.stepsDone} of ${item.stepsTotal} steps done`].filter(Boolean).join(', ')}>
        <div className="list-item-title-row">
          {prio && <PriorityBadge p={prio} />}
          <div className="list-item-title">{item.title}</div>
          {from}
          {(item.notes || (notesOn && !!item.noteCount)) && <NoteIcon className="list-item-note" width={14} height={14} aria-hidden={false} role="img" aria-label="Has notes" />}
        </div>
        {due && <div className={`list-item-meta list-item-due ${due.overdue ? 'overdue' : ''}`} aria-hidden="true">{due.text}</div>}
        {item.stepsTotal > 0 && (
          <div className="list-item-steps" aria-hidden="true">
            <span>{item.stepsDone} of {item.stepsTotal}</span>
            <div className="list-item-progress"><div style={{ width: `${(item.stepsDone / item.stepsTotal) * 100}%` }} /></div>
          </div>
        )}
        {(showStore || showAisle || showCategory) && (
          <div className="list-item-meta">{[showStore ? item.store : null, showAisle ? item.aisle : null, showCategory ? item.category : null].filter(Boolean).join(' · ')}</div>
        )}
        {!!item.meals?.length && <div className="list-item-meta list-item-meals"><span aria-hidden="true">🍽️ </span>For {item.meals.join(', ')}</div>}
        {event && <div className="list-item-meta" style={{ display: 'flex', alignItems: 'center', gap: 4 }}><CalendarIcon width={12} height={12} style={{ flexShrink: 0 }} />{eventLabel(event)}</div>}
      </div>
      {item.quantity && <div className="list-item-chip">{item.quantity}</div>}
      {assignee && <Face m={assignee} className="member-avatar-sm" role="img" aria-label={`For ${assignee.name}`} />}
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
          <button className="swipe-delete" style={{ width: Math.max(SWIPE_REVEAL, -offset) }} onClick={() => { settle('closed'); onDelete() }} aria-label={`Delete ${title}`}>
            <TrashIcon width={20} height={20} /><span>Delete</span>
          </button>
        )}
      </div>
    </div>
  )
}

/** On a combined trip, which other list an item is on: that type's icon and the list's name. */
function FromTag({ name, catalog }: { name: string; catalog: ListCatalog }) {
  const Icon = catalog === 'groceries' ? BasketIcon : CartIcon
  return <span className="list-from-tag"><Icon width={12} height={12} aria-hidden="true" /><span className="sr-only">On </span>{name}</span>
}

/** A row in shopping mode: the whole row ticks the item (no editing mid-aisle). */
function ShopRow({ item, meta, onToggle, from, readOnly }: { item: ListItem; meta?: string | null; onToggle: () => void; from?: React.ReactNode; readOnly?: boolean }) {
  const sub = [meta, item.notes?.split('\n')[0]].filter(Boolean).join(' · ')
  return (
    <button className={`shop-row ${item.done ? 'done' : ''} ${item.pending ? 'pending' : ''} ${readOnly ? 'read-only' : ''}`} role="checkbox" aria-checked={item.done} aria-disabled={readOnly || undefined}
      onClick={readOnly ? undefined : onToggle} title={item.pending ? 'Not synced yet' : undefined}>
      <span className="shop-check" aria-hidden="true">{item.done && <CheckIcon width={20} height={20} />}</span>
      <span className="shop-row-body">
        <span className="shop-row-title">{item.title}</span>
        {from}
        {sub && <span className="shop-row-note">{sub}</span>}
      </span>
      {item.quantity && <span className="list-item-chip">{item.quantity}</span>}
    </button>
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
    if (to < 0 || to >= ids.length) { announce(`${item.title} is already ${to < 0 ? 'first' : 'last'}`); return }
    ids.splice(from, 1); ids.splice(to, 0, item.id)
    refocus.current = item.id
    onReorder(ids)
    announce(`${item.title} moved to position ${to + 1} of ${ids.length}`)
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
          <button className="list-item-grip" data-grip={item.id} aria-label={`Reorder ${item.title}: drag, or Alt+Up and Alt+Down arrow`}
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

const OTHER_GROUP = 'Other'

/** Groups items by list.groupBy, ordered by the saved ListGroup order then alphabetically, with
 * null-valued items last under "Other"; each group in `cmp` order. Store groups in manual order keep
 * a store's categories together, per SPEC. Aisle groups are per store ("Market · Produce"), in store
 * order then the store's aisle order. Returns [] (flat) when groupBy is 'none'. */
function groupItems(items: ListItem[], groupBy: ListGroupBy, savedOrder: string[], sortBy: ListSortBy, cmp: (a: ListItem, b: ListItem) => number, aisleOrder: AisleOrder): { name: string; items: ListItem[] }[] {
  if (groupBy === 'none') return []
  const keyOf = (i: ListItem) => groupBy === 'aisle' ? (i.aisle ? `${i.store ?? ''}\u0000${i.aisle}` : null) : i[groupBy]
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
    if (groupBy !== 'aisle' || key === OTHER_GROUP) return key
    const [store, aisle] = key.split('\u0000')
    return store ? `${store} · ${aisle}` : aisle
  }
  return keys.map(key => ({ name: label(key), items: byKey.get(key)! }))
}

/** "Stores & departments": rename or remove a store, department (the category field) or aisle everywhere (every list and
 * what's remembered), and drag a store's aisles into the order you walk them. */
function ManageValuesSheet({ catalog, suggestions, aisleOrder, onClose, onChanged, onCatalog }: {
  catalog: ListCatalog // departments are renamed in this list type's catalog; stores and aisles are shared
  suggestions: ListDetail['suggestions']; aisleOrder: AisleOrder; onClose: () => void; onChanged: () => void
  onCatalog?: () => void // shopping lists: open the list type's catalog
}) {
  const dialog = useDialog()
  const { toast } = useApp()
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
      const { updated } = await api.renameListValue({ field, from, to, ...(field === 'aisle' ? { store } : {}), ...(field === 'category' ? { catalog } : {}) })
      announce(to ? `Renamed ${from} to ${to}${updated ? `, ${updated} item${updated === 1 ? '' : 's'} updated` : ''}` : `Removed ${from}`)
      setEditing(null); setOverride(null); onChanged()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save', true) }
  }
  const remove = async (field: Field, value: string) => {
    if (!await dialog.confirm({ title: `Remove "${value}"?`, body: `Items that use it keep everything else; this ${field === 'category' ? 'department' : field} is cleared from them and forgotten.`, confirmLabel: 'Remove', danger: true })) return
    rename(field, value, null)
  }
  const saveOrder = async (next: string[]) => {
    setOverride({ store, aisles: next })
    try { await api.setStoreAisles(store, next); onChanged() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save the aisle order', true); setOverride(null) }
  }
  const addAisle = () => {
    const name = newAisle.trim()
    if (!name || aisles.includes(name)) return
    setNewAisle('')
    saveOrder([...aisles, name])
  }

  const row = (field: Field, value: string, handle?: React.ReactNode) => editing?.field === field && editing.from === value ? (
    <div className="manage-row" key={value}>
      <input type="text" value={draft} onChange={e => setDraft(e.target.value)} aria-label={`New name for ${value}`} maxLength={60} autoFocus
        onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) rename(field, value, draft.trim()); if (e.key === 'Escape') setEditing(null) }} />
      <button className="btn btn-primary" disabled={!draft.trim() || draft.trim() === value} onClick={() => rename(field, value, draft.trim())}>Save</button>
      <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
    </div>
  ) : (
    <div className="manage-row" key={value}>
      <span className="manage-row-name">{value}</span>
      <button className="link-btn" onClick={() => { setEditing({ field, from: value }); setDraft(value) }} aria-label={`Rename ${value}`}>Rename</button>
      <button className="icon-btn" onClick={() => remove(field, value)} aria-label={`Remove ${value}`}><TrashIcon width={16} height={16} /></button>
      {handle}
    </div>
  )

  return (
    <Sheet title="Stores & departments" onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <p className="field-hint">Renaming changes every item that uses the name, on every list. Removing clears it from those items.</p>
      <h3 className="manage-head">Stores</h3>
      {suggestions.stores.length ? suggestions.stores.map(v => row('store', v)) : <p className="list-item-meta">No stores yet. Pick one on an item.</p>}
      <h3 className="manage-head">Departments</h3>
      <p className="field-hint">An item with no aisle at a store goes in the aisle named like its department, if the store has one.</p>
      {suggestions.categories.length ? suggestions.categories.map(v => row('category', v)) : <p className="list-item-meta">No departments yet.</p>}
      <h3 className="manage-head">Aisles</h3>
      {aisleStores.length > 1 && (
        <div className="field">
          <label htmlFor="manage-aisle-store">Store</label>
          <select id="manage-aisle-store" value={store ?? ''} onChange={e => { setStore(e.target.value || null); setEditing(null) }}>
            {aisleStores.map(st => <option key={st ?? ''} value={st ?? ''}>{st ?? 'No store'}</option>)}
          </select>
        </div>
      )}
      <p className="field-hint">Drag the aisles into the order you walk {store ?? 'the store'}. Aisle sort follows it.</p>
      <DragList items={aisles.map(a => ({ id: a, title: a }))} onReorder={saveOrder} renderRow={(a, handle) => row('aisle', a.id, handle)} />
      <div className="list-add-bar step-add">
        <input type="text" value={newAisle} onChange={e => setNewAisle(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') addAisle() }} maxLength={60}
          placeholder={`Add an aisle${store ? ` at ${store}` : ''}…`} aria-label={`Add an aisle${store ? ` at ${store}` : ''}`} enterKeyHint="done" />
        <button className="icon-btn" onClick={addAisle} disabled={!newAisle.trim()} aria-label="Add aisle"><PlusIcon width={20} height={20} /></button>
      </div>
      {onCatalog && <>
        <h3 className="manage-head">Items</h3>
        <p className="field-hint">Everything you've bought before, where it's found at each store, and its department.</p>
        <button className="btn btn-secondary btn-block" onClick={onCatalog}>Open the {catalogName(catalog).toLowerCase()}</button>
      </>}
    </Sheet>
  )
}

/** A list type's catalog (Grocery or Shopping): everything the family has bought before on lists of that type, its department, the family's own
 * categories and where it's found at each store. Search; filter by store, category and department
 * (they combine) and sort and group (kept per device) in the Filter & sort sheet, which applies live over it;
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
  const [filtering, setFiltering] = useState(false) // the Filter & sort sheet, over this one
  const [editing, setEditing] = useState<RememberedItem | 'new' | 'tags' | null>(null)
  const load = () => api.getRemembered(catalog).then(setItems).catch(() => { setItems([]); toast('Could not load the catalog', true) })
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const all = items ?? []
  const stores = catalogStores(all), tags = catalogTags(all), departments = catalogDepartments(all)
  const atStore = store && stores.includes(store) ? store : null
  const onlyTag = tags.find(t => t.name === tag)?.name ?? null
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
    try { await api.queueAddListItem(listId, { title: i.title, ...(atStore ? { store: atStore } : {}) }); announce(`Added ${i.title} to ${listName}`); onChanged() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add item', true) }
  }
  const saved = () => { setEditing(null); load(); onChanged() }
  const chip = (label: string, on: boolean, pick: () => void, count?: number) => (
    <button key={label} className={`chip ${on ? 'active' : ''}`} aria-pressed={on} onClick={pick}>
      {label}{count !== undefined && <span className="chip-count">{count}</span>}
    </button>
  )

  if (editing === 'tags') return <CatalogTagsSheet catalog={catalog} tags={tags} onClose={() => setEditing(null)} onChanged={() => { load(); onChanged() }} />
  if (editing) return (
    <CatalogItemSheet catalog={catalog} item={editing === 'new' ? null : editing} newTitle={query.trim()} suggestions={suggestions} aisleOrder={aisleOrder} familyTags={tags.map(t => t.name)}
      onClose={() => setEditing(null)} onSaved={saved} />
  )
  const row = (i: RememberedItem) => (
    <div className="catalog-row" key={i.key}>
      <button className="catalog-row-main" onClick={kid ? undefined : () => setEditing(i)} disabled={kid} aria-label={kid ? i.title : `Edit ${i.title}`}>
        <span className="catalog-row-title">{i.title}</span>
        <span className="catalog-row-meta">{[i.category, i.tags.length ? `🏷️ ${i.tags.join(', ')}` : null, boughtLabel(i.uses)].filter(Boolean).join(' · ')}</span>
        {i.places.length > 0 && (
          <span className="catalog-row-places">
            {placesFor(i, atStore).map(p => <span key={p.store} className="chip chip-static">{placeLabel(p)}</span>)}
          </span>
        )}
      </button>
      {onList.has(i.key)
        ? <span className="catalog-on-list"><CheckIcon width={16} height={16} aria-hidden="true" />On list</span>
        : <button className="icon-btn catalog-add" onClick={() => add(i)} aria-label={`Add ${i.title} to ${listName}`} title={`Add to ${listName}`}><PlusIcon width={20} height={20} /></button>}
    </div>
  )
  return (
    <Sheet title={catalogName(catalog)} onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <div className="catalog-bar">
        <input type="search" className="manage-find" value={query} onChange={e => setQuery(e.target.value)} placeholder="Find an item…" aria-label="Find an item" autoComplete="off" />
        <button className="btn btn-secondary catalog-options-btn" onClick={() => setFiltering(true)} aria-haspopup="dialog" title="Filter & sort"
          aria-label={`Filter and sort${active ? `, ${active} ${active === 1 ? 'filter' : 'filters'} on` : ''}`}>
          <FilterIcon width={18} height={18} /><span className="catalog-options-label">Filter & sort</span>{active > 0 && <span className="catalog-options-on" aria-hidden="true">{active}</span>}
        </button>
        {!kid && <button className="btn btn-secondary" onClick={() => setEditing('new')}><PlusIcon width={18} height={18} />New</button>}
      </div>
      {summary && (
        <div className="catalog-summary">
          <button className="filter-summary" onClick={() => setFiltering(true)} aria-label={`Filters: ${summary}. Change filters`}>{summary}</button>
          <button className="link-btn" onClick={clearFilters}>Clear</button>
        </div>
      )}
      {filtering && (
        <Sheet title="Filter & sort" onClose={() => setFiltering(false)} actions={<>
          <button className="btn btn-secondary" disabled={!active && sort === 'alpha' && view.group === 'none'} onClick={() => { clearFilters(); changeView({ sort: 'alpha', group: 'none' }) }}>Reset</button>
          <button className="btn btn-primary" onClick={() => setFiltering(false)}>Done</button>
        </>}>
          {stores.length > 0 && <>
            <h3 className="manage-head">Store</h3>
            <div className="chip-row" role="group" aria-label="Store">
              {[null, ...stores].map(st => chip(st ?? 'All stores', atStore === st, () => setStore(st)))}
            </div>
          </>}
          {tags.length > 0 && <>
            <h3 className="manage-head">Category</h3>
            <div className="chip-row" role="group" aria-label="Category">
              {chip('All categories', !onlyTag, () => setTag(null))}
              {tags.map(t => chip(t.name, onlyTag === t.name, () => setTag(onlyTag === t.name ? null : t.name), t.count))}
            </div>
          </>}
          {departments.length > 0 && <>
            <h3 className="manage-head">Department</h3>
            <div className="chip-row" role="group" aria-label="Department">
              {chip('All departments', !onlyDept, () => setDepartment(null))}
              {departments.map(d => chip(d.name, onlyDept === d.name, () => setDepartment(onlyDept === d.name ? null : d.name), d.count))}
            </div>
          </>}
          <div className="catalog-view">
            <div className="field">
              <label htmlFor="catalog-sort">Sort</label>
              <select id="catalog-sort" className="settings-select" value={sort} onChange={e => changeView({ sort: e.target.value as CatalogSort })}>
                {(Object.keys(CATALOG_SORT_LABELS) as CatalogSort[]).filter(k => k !== 'aisle' || atStore).map(k =>
                  <option key={k} value={k}>{k === 'aisle' ? `Aisle at ${atStore}` : CATALOG_SORT_LABELS[k]}</option>)}
              </select>
            </div>
            <div className="field">
              <label htmlFor="catalog-group">Group by</label>
              <select id="catalog-group" className="settings-select" value={view.group} onChange={e => changeView({ group: e.target.value as CatalogGroup })}>
                {(Object.keys(CATALOG_GROUP_LABELS) as CatalogGroup[]).map(k => <option key={k} value={k}>{CATALOG_GROUP_LABELS[k]}</option>)}
              </select>
            </div>
          </div>
          {parentDevice && <button className="link-btn" onClick={() => { setFiltering(false); setEditing('tags') }}>Edit categories</button>} {/* renaming or removing one everywhere is parents only */}
        </Sheet>
      )}
      {items === null ? <p className="list-item-meta">Loading…</p>
        : !shown.length ? <p className="list-item-meta">{items.length ? (query.trim() ? 'Nothing by that name.' : 'Nothing matches these filters.') : 'Nothing yet. Items you add to a shopping list show up here.'}</p>
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
      announce(to ? `Renamed ${from} to ${to}` : `Removed ${from}`)
      setList(to ? list.filter(t => t.name !== from && t.name.toLowerCase() !== to.toLowerCase()).concat({ name: to, count: 0 }).sort((a, b) => a.name.localeCompare(b.name)) : list.filter(t => t.name !== from))
      setEditing(null); onChanged()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save', true) }
  }
  const remove = async (t: string) => {
    if (await dialog.confirm({ title: `Remove "${t}"?`, body: 'Items keep everything else; this category is taken off them.', confirmLabel: 'Remove', danger: true })) rename(t, null)
  }
  return (
    <Sheet title="Categories" onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <p className="field-hint">Renaming changes every catalog item in the category. Removing takes it off them.</p>
      {!list.length && <p className="list-item-meta">No categories yet. Add one to an item.</p>}
      {list.map(({ name }) => editing === name ? (
        <div className="manage-row" key={name}>
          <input type="text" value={draft} onChange={e => setDraft(e.target.value)} aria-label={`New name for ${name}`} maxLength={40} autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) rename(name, draft.trim()); if (e.key === 'Escape') setEditing(null) }} />
          <button className="btn btn-primary" disabled={!draft.trim() || draft.trim() === name} onClick={() => rename(name, draft.trim())}>Save</button>
          <button className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
        </div>
      ) : (
        <div className="manage-row" key={name}>
          <span className="manage-row-name">{name}</span>
          <button className="link-btn" onClick={() => { setEditing(name); setDraft(name) }} aria-label={`Rename ${name}`}>Rename</button>
          <button className="icon-btn" onClick={() => remove(name)} aria-label={`Remove ${name}`}><TrashIcon width={16} height={16} /></button>
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
  const has = (t: string) => tags.some(x => x.toLowerCase() === t.toLowerCase())
  const toggleTag = (t: string) => setTags(has(t) ? tags.filter(x => x.toLowerCase() !== t.toLowerCase()) : tagsInput([...tags, t], familyTags).slice(0, 10))
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
      announce(`Saved ${body.title}`); onSaved()
    } catch (e) { toast(e instanceof Error && e.message ? e.message : 'Could not save', true) }
  }
  const forget = async () => {
    if (!item || !await dialog.confirm({ title: `Forget "${item.title}"?`, body: 'It leaves the catalog, stops being suggested as you add, and where it goes is forgotten. Items on lists keep it.', confirmLabel: 'Forget', danger: true })) return
    try { await api.forgetItemName(catalog, item.key); announce(`Forgot ${item.title}`); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not forget it', true) }
  }
  return (
    <Sheet title={item ? 'Edit catalog item' : 'New catalog item'} onClose={onClose}
      actions={<>
        <button className="btn btn-secondary" onClick={onClose}>Back</button>
        <button className="btn btn-primary" onClick={save} disabled={!title.trim()}>Save</button>
      </>}>
      <div className="field">
        <label htmlFor="catalog-title">Name</label>
        <input id="catalog-title" type="text" value={title} onChange={e => setTitle(e.target.value)} maxLength={200} autoComplete="off" autoFocus={!item} placeholder="e.g. Oat milk" />
      </div>
      <ValuePicker id="catalog-category" label="Department" value={category} options={suggestions.categories} newLabel="New department…" placeholder="e.g. Produce" onChange={setCategory} />
      <h3 className="manage-head">Categories</h3>
      <p className="field-hint catalog-hint">{starters ? 'Your own groupings, like Breakfast or Lunchbox. Tap any that fit, or add your own.' : 'Your own groupings. Tap any that fit, or add a new one.'}</p>
      <div className="chip-row catalog-tag-picks" role="group" aria-label="Categories">
        {tagOptions.map(t => (
          <button key={t} className={`chip ${has(t) ? 'active' : ''}`} aria-pressed={has(t)} onClick={() => toggleTag(t)} disabled={!has(t) && tags.length >= 10}>
            {!has(t) && <PlusIcon width={14} height={14} aria-hidden="true" />}{t}
          </button>
        ))}
      </div>
      <div className="catalog-place">
        <div className="field">
          <label htmlFor="catalog-new-tag">New category</label>
          <input id="catalog-new-tag" type="text" value={newTag} onChange={e => setNewTag(e.target.value)} maxLength={40} list="catalog-tag-list" autoComplete="off"
            placeholder="e.g. Snacks" enterKeyHint="done" onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag() } }} />
          <datalist id="catalog-tag-list">{familyTags.filter(t => !has(t)).map(t => <option key={t} value={t} />)}</datalist>
        </div>
        <button className="btn btn-secondary" onClick={addTag} disabled={!newTag.trim() || tags.length >= 10}>Add</button>
      </div>
      <h3 className="manage-head">Stores</h3>
      <p className="field-hint catalog-hint">Where it's found. Adding it to a list at one of these stores puts it in that aisle.</p>
      {rows.map((r, n) => (
        <div className="catalog-place" key={r.store}>
          <ValuePicker id={`catalog-aisle-${n}`} label={`Aisle at ${r.store}`} value={r.aisle} noneLabel="Not known" options={storeAisles(suggestions, r.store, aisleOrder)}
            newLabel="New aisle…" placeholder="e.g. Aisle 4, Produce, Back wall" onChange={v => setRows(rows.map((x, i) => i === n ? { ...x, aisle: v } : x))} />
          <button className="icon-btn" onClick={() => setRows(rows.filter((_, i) => i !== n))} aria-label={`Remove ${r.store}`}><TrashIcon width={18} height={18} /></button>
        </div>
      ))}
      <div className="catalog-place">
        <ValuePicker key={pickerKey} id="catalog-add-store" label="Add a store" value={newStore} options={otherStores} noneLabel="Pick a store…" newLabel="New store…" placeholder="Store name"
          onChange={v => otherStores.includes(v) ? addStore(v) : setNewStore(v)} />
        {newStore.trim() && <button className="btn btn-secondary" onClick={() => addStore(newStore)}>Add</button>}
      </div>
      {item && <>
        <p className="field-hint catalog-stats">{boughtLabel(item.uses)}{item.lastStore ? `, last at ${item.lastStore}` : ''}.</p>
        <div className="catalog-forget">
          <button className="btn btn-danger btn-block" onClick={forget}><TrashIcon width={18} height={18} />Forget this item</button>
        </div>
      </>}
    </Sheet>
  )
}

/** Checkout with items left over at one store: "Didn't find these?" - pick another store (or
 * Anywhere) for any of them, or leave them as they are. Either way Checkout goes ahead after. */
function LeftoversSheet({ items, trip, stores, onDone }: {
  items: ListItem[]; trip: string; stores: string[]; onDone: (moves: { item: ListItem; store: string | null }[]) => void
}) {
  const [picked, setPicked] = useState<Record<string, string>>(() => Object.fromEntries(items.map(i => [i.id, i.store ?? ''])))
  const moves = items.filter(i => picked[i.id].trim() !== (i.store ?? '')).map(item => ({ item, store: picked[item.id].trim() || null }))
  const leave = () => onDone([])
  return (
    <Sheet title="Didn't find these?" onClose={leave} actions={<>
      <button className="btn btn-secondary" onClick={leave}>Leave them as they are</button>
      {moves.length > 0 && <button className="btn btn-primary" onClick={() => onDone(moves)}>Move {moves.length}</button>}
    </>}>
      <p className="field-hint">Still on the list after {trip}. Pick where to look for them next time.</p>
      {items.map(i => (
        <ValuePicker key={i.id} id={`leftover-${i.id}`} label={i.title} value={picked[i.id]} options={stores} newLabel="New store…" placeholder="Store name" noneLabel="Anywhere"
          onChange={v => setPicked(p => ({ ...p, [i.id]: v }))} />
      ))}
    </Sheet>
  )
}

/** The add field. On a shopping list it autocompletes (a combobox): up to 6 remembered names as you
 * type, with where each goes; ↑/↓ and Enter or a tap adds one straight away, Enter with none
 * highlighted adds what's typed, Escape closes the list. `above` opens it above the field (Shopping
 * mode's bottom dock, clear of the on-screen keyboard), where an empty field also offers "Buy again". */
function ItemAddField({ id, value, onChange, onAdd, suggestions, onList, inputRef, above, buyAgain, label, placeholder, autoFocus, onEscape }: {
  id: string; value: string; onChange: (v: string) => void; onAdd: (title: string) => void
  suggestions?: ItemSuggestion[]; onList: Set<string> // keys of the open items, not suggested
  inputRef: React.RefObject<HTMLInputElement>; above?: boolean; buyAgain?: boolean
  label: string; placeholder: string; autoFocus?: boolean; onEscape?: (e: React.KeyboardEvent) => void
}) {
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [active, setActive] = useState(-1)
  const matches = open && suggestions ? matchItems(value, suggestions, onList) : []
  const again = buyAgain && focused && !value.trim() && suggestions ? suggestions.filter(s => s.uses > 0 && !onList.has(s.key)).slice(0, 6) : []
  const listId = `${id}-suggest`
  const pick = (title: string) => { setOpen(false); setActive(-1); onAdd(title) }
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
      <input ref={inputRef} id={id} type="text" value={value} placeholder={placeholder} aria-label={label} enterKeyHint="done" autoFocus={autoFocus}
        // The browser's autofill stays off (the item suggestions below replace it); the keyboard's
        // spell check and autocorrect stay on, so a new item doesn't go in with a typo.
        autoComplete="off" autoCorrect="on" autoCapitalize="sentences" spellCheck
        onChange={e => { onChange(e.target.value); setOpen(true); setActive(-1) }} onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setOpen(false); setActive(-1) }}
        {...(suggestions ? {
          role: 'combobox', 'aria-autocomplete': 'list' as const, 'aria-expanded': matches.length > 0,
          'aria-controls': matches.length ? listId : undefined, 'aria-activedescendant': active >= 0 && matches[active] ? `${listId}-${active}` : undefined,
        } : {})} />
      {matches.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Suggestions" className="item-suggest">
          {matches.map((s, i) => (
            <li key={s.key} id={`${listId}-${i}`} role="option" aria-selected={i === active} className={i === active ? 'active' : undefined}
              onMouseDown={keepFocus} onClick={() => pick(s.title)}>
              <span className="item-suggest-name">{s.title}</span>
              {hint(s) && <span className="item-suggest-hint">{hint(s)}</span>}
            </li>
          ))}
        </ul>
      )}
      {again.length > 0 && (
        <div className="item-again" role="group" aria-label="Buy again">
          <span className="item-again-label" aria-hidden="true">Buy again</span>
          {again.map(s => <button key={s.key} type="button" className="chip" onMouseDown={keepFocus} onClick={() => pick(s.title)} aria-label={`Add ${s.title}`}>{s.title}</button>)}
        </div>
      )}
    </div>
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
  const [managing, setManaging] = useState(false)
  const [cataloging, setCataloging] = useState(false) // the list type's catalog
  const [showDone, setShowDone] = useState(false)
  const [selectedStore, setSelectedStore] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [scanned, setScanned] = useState<{ code: string; found: BarcodeLookup | null } | null>(null) // a new product's scan sheet
  const [doing, setDoing] = useState(false) // Get stuff done (GetStuffDone.tsx), over the list
  const inputRef = useRef<HTMLInputElement>(null)
  const { upcoming, byId } = useEventWindow(refreshTick)

  // On a one-store trip, the other list type's items for that store come too (alsoAtStore).
  const load = () => {
    const at = tripStore(listId)
    return api.getList(listId, at && at !== ANY_STORE ? at : undefined).then(d => { setDetail(d); setError(false); onLoaded(d.list) }).catch(() => setError(true))
  }
  // "Shopping at": a trip in one store, kept on this device only, until Checkout (or End).
  const [trip, setTrip] = useState<string | null>(() => tripStore(listId))
  useEffect(() => { setSelectedStore(null); setShowDone(false); setTrip(tripStore(listId)) }, [listId])
  const changeTrip = (store: string | null) => {
    setTripStore(listId, store); setTrip(store); shopScroll.current = 0
    announce(store ? `Shopping at ${store === ANY_STORE ? 'any store' : store}` : 'Shopping ended')
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
    history.replaceState(null, '', hashPath(location.hash)) // handled: a reload doesn't start it again
  }, [storeLink, shopMode, detail, listId]) // eslint-disable-line react-hooks/exhaustive-deps
  const [reversed, setReversed] = useState(() => !!trip && trip !== ANY_STORE && tripReverse(trip))
  useEffect(() => setReversed(!!trip && trip !== ANY_STORE && tripReverse(trip)), [trip])
  const flipReverse = () => {
    if (!trip || trip === ANY_STORE) return
    setTripReverse(trip, !reversed); setReversed(!reversed)
    announce(reversed ? 'Aisles in walking order' : 'Aisles reversed')
  }

  // Shopping mode: the trip alone, full screen. "Back" leaves it with the trip still on
  // (Shopping at on the list comes back to it); only Done shopping (the checkout) or End ends the trip.
  const enterShop = () => { location.hash = `#/lists/${listId}/shop` }
  const exitShop = () => { location.hash = '#/lists' }
  const [picking, setPicking] = useState(false) // the store step
  const [adding, setAdding] = useState(false) // its "Add an item" field
  const [leftovers, setLeftovers] = useState<ListItem[] | null>(null) // Checkout's "Didn't find these?" step
  const shopScroll = useRef(0) // where the aisles were, for going back to the trip
  const shopList = useRef<HTMLDivElement>(null)
  const shopHeading = useRef<HTMLHeadingElement>(null)
  const saveShopScroll = (e: React.UIEvent<HTMLElement>) => { shopScroll.current = e.currentTarget.scrollTop }
  // Kept for a relaunch, the screen stays on, and the app behind is out of reach (the view covers it).
  useEffect(() => {
    if (!shopMode) return
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
      catch (e) { toast(e instanceof ApiError ? e.message : reset ? 'Could not reset the list' : 'Could not clear checked items', true) }
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
      api.queueDeleteListItem(item.listId || listId, item.id).catch(e => { toast(e instanceof ApiError ? e.message : 'Could not delete item', true); load() })
    }
    deleteTimer.current = setTimeout(commitDelete, 5000)
  }
  const undoDelete = () => { clearTimeout(deleteTimer.current); pendingDelete.current = null; setDeleting(null); announce('Undone') }
  const undoCheckout = () => {
    clearTimeout(checkoutTimer.current); pendingCheckout.current = null
    if (checkout?.trip) { setTripStore(listId, checkout.trip); setTrip(checkout.trip) }
    if (checkout?.shop) enterShop() // back to the aisles
    setCheckout(null); announce('Undone')
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
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add item', true); return null }
    if (!checkOff) inputRef.current?.focus() // keep the keyboard open for the next item
    return id
  }

  // After a scan while shopping: "Where did you find it?" for what the item is missing, its aisle at
  // this store and its department (placeNeeds). Saving teaches them, so the next one walks right.
  const [placing, setPlacing] = useState<{ listId: string; id: string; title: string; category: string; need: { aisle: boolean; department: boolean } } | null>(null)
  const askPlace = (item: { id: string; listId?: string; title: string; store?: string | null; aisle?: string | null; category?: string | null; places?: ListItem['places'] }, onlyAisle = false) => {
    if (!detail) return
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
    try { const op = await api.queueUpdateListItem(placing.listId, placing.id, body); if (placing.listId === listId) showQueued(op); announce(`Saved where ${placing.title} goes`) }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save it', true) }
  }
  const placeSheet = placing && detail && (
    <PlaceSheet title={placing.title} store={trip && trip !== ANY_STORE ? trip : null} need={placing.need} category={placing.category}
      aisles={trip && trip !== ANY_STORE ? storeAisles(detail.suggestions, trip, aisleOrderMap(detail)) : []} departments={detail.suggestions.categories}
      onSave={savePlace} onClose={() => setPlacing(null)} />
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
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not look that up', true) }
    if (shopMode && found) {
      const hit = scanMatch([...(detail?.items ?? []), ...(detail?.alsoAtStore ?? [])], found.title)
      if (hit) { await toggle(hit); toast(`Checked off: ${hit.title}`); announce(`Checked off ${hit.title}`); askPlace(hit); return }
      if (found.source === 'family') {
        const id = await addItem(found.title, code, { checkOff: true })
        toast(`Added and checked off: ${found.title}`); announce(`Added and checked off ${found.title}`)
        if (id) askPlace({ id, title: found.title })
        return
      }
    }
    if (found?.source === 'family') {
      if (detail?.items.some(i => !i.done && itemKey(i.title) === itemKey(found.title))) {
        toast(`${found.title} is already on the list`); announce(`${found.title} is already on the list`)
        return
      }
      await addItem(found.title, code)
      toast(`Added: ${found.title}`); announce(`Added ${found.title}`)
      return
    }
    setScanned({ code, found })
  }
  const shoppingLists = lists.filter(l => l.kind === 'shopping' && !l.archived)
  // A product found in another list type's database goes there by default (scanTarget): paper towels
  // scanned on Groceries start out headed for the Shopping list.
  const addScanned = async (title: string, save: boolean, target: string) => {
    if (!scanned) return
    const barcode = save ? scanned.code : undefined
    setScanned(null)
    const id = await addItem(title, barcode, { checkOff: shopMode, to: target })
    if (id && shopMode && target === listId) askPlace({ id, title })
    const where = target === listId ? '' : ` to ${shoppingLists.find(l => l.id === target)?.name ?? 'the other list'}`
    const said = `${shopMode ? 'Added and checked off' : 'Added'}${where}: ${title}`
    toast(said); announce(said)
  }
  const scanSheet = scanned && (
    <ScanSheet code={scanned.code} found={scanned.found} canSave={!kid} onClose={() => setScanned(null)}
      lists={shoppingLists} target={scanTarget(shoppingLists, listId, scanned.found?.source ?? null)} checkOff={shopMode} onAdd={addScanned} />
  )
  const scanBtn = detail?.list.kind === 'shopping' && appBarcodeScanner() && (
    <button className="icon-btn list-scan-btn" onClick={scan} aria-label="Scan a barcode"><span aria-hidden="true">📷</span></button>
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
    setDetail({ ...detail, items: detail.items.map(i => ({ ...i, sort: order.indexOf(i.id) })).sort(compareItems(detail.list.sortBy, todayKey(), { keepChecked: detail.list.keepChecked, aisleOrder: aisleOrderMap(detail) })) })
    try { await api.reorderListItems(listId, order) }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not reorder', true); load() }
  }

  const toggle = async (item: ListItem) => {
    if (item.listId && item.listId !== listId) { // the other list's, on a combined trip: ticked there
      setDetail(d => d && { ...d, alsoAtStore: d.alsoAtStore?.map(i => (i.id === item.id ? { ...i, done: !item.done } : i)) })
      try { await api.queueUpdateListItem(item.listId, item.id, { done: !item.done }); askAisle(item) }
      catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update item', true); load() }
      return
    }
    try { showQueued(await api.queueUpdateListItem(listId, item.id, { done: !item.done })); askAisle(item) }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update item', true) }
  }
  // Ticking something off while shopping at a store that doesn't know its aisle yet asks where it
  // was found (only the aisle: a tap shouldn't also quiz for the department), so the next trip
  // walks right. Unticking never asks.
  const askAisle = (item: ListItem) => { if (shopMode && !item.done) askPlace(item, true) }

  const setSortBy = async (sortBy: ListSortBy) => {
    try { await api.updateList(listId, { sortBy }); announce(`Sorted by ${SORT_LABEL[sortBy]}`); load() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not change sort', true) }
  }
  const setGroupBy = async (groupBy: ListGroupBy) => {
    try { await api.updateList(listId, { groupBy }); load() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not change grouping', true) }
  }

  const shopping = shopMode && detail?.list.kind === 'shopping'
  // Opened on its heading (announced as the view's name), and where the aisles were left.
  useLayoutEffect(() => {
    if (!shopping) return
    if (shopList.current) shopList.current.scrollTop = shopScroll.current
    shopHeading.current?.focus({ preventScroll: true })
  }, [shopping])
  // A link to shopping mode for a list that isn't a shopping list: just the list.
  useEffect(() => { if (shopMode && detail && !shopping) location.replace('#/lists') }, [shopMode, detail, shopping])

  if (error || !detail) {
    const card = <div className="state-card">{error ? "Couldn't load this list." : 'Loading…'}</div>
    return shopMode
      ? createPortal(<div className="shop-mode"><div className="shop-bar"><div className="shop-bar-title" /><button className="btn btn-secondary shop-done" onClick={exitShop}>Back</button></div>{card}</div>, document.body)
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
  const cmp = compareItems(list.sortBy, todayKey(), { keepChecked: keep, aisleOrder })
  const openItems = keep ? filtered : filtered.filter(i => !i.done)
  const doneItems = keep ? [] : filtered.filter(i => i.done)
  const checked = filtered.filter(i => i.done && mine(i)) // a kid's device checks out only what it may change
  const groupKind = list.groupBy === 'aisle' ? 'store' : list.groupBy // aisle groups follow the store order
  const groupNamesForOrder = groups.filter(g => g.kind === groupKind).sort((a, b) => a.sort - b.sort).map(g => g.name)
  const groupedOpen = groupItems(openItems, list.groupBy, groupNamesForOrder, list.sortBy, cmp, aisleOrder)
  const manual = list.sortBy === 'manual'
  const reorderable = list.groupBy === 'store' || list.groupBy === 'category'
  const reorderableNames = reorderable ? [...new Set(items.map(i => (list.groupBy === 'store' ? i.store : i.category)).filter((v): v is string => !!v))] : []
  const checkoutLabel = CHECKOUT_LABEL[list.kind]
  // On a trip: everything, walked in that store's aisle order; checked items always stay in place.
  const activeTrip = list.kind === 'shopping' ? trip : null
  const tripAt = activeTrip === ANY_STORE ? null : activeTrip // one store: its aisles, in its order
  const storeLabel = activeTrip === ANY_STORE ? 'Any store' : activeTrip
  const tripAisles = tripAt ? storeAisles(suggestions, tripAt, aisleOrder) : []
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
      onOpen={() => (item.listId !== listId ? (location.hash = `#/lists?list=${encodeURIComponent(item.listId)}`) : openItem(item))} />
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
      catch (e) { toast(e instanceof ApiError ? e.message : `Could not move ${item.title}`, true) }
    }
    if (moves.length) announce(`Moved ${moves.length} item${moves.length === 1 ? '' : 's'}`)
    checkoutTrip(true)
  }
  const leftoversSheet = leftovers && tripAt && (
    <LeftoversSheet items={leftovers} trip={tripAt} stores={suggestions.stores} onDone={finishLeftovers} />
  )
  const pickStore = (store: string) => {
    if (store !== trip) changeTrip(store)
    setPicking(false)
    if (!shopping) enterShop() // from the list page's Shop button
    else setTimeout(() => shopHeading.current?.focus()) // after the sheet hands focus back
  }
  // Shop: with one store (or none) it starts right away; with more, it asks first.
  const startShop = () => {
    if (tripStores.length > 1) { setPicking(true); return }
    changeTrip(tripStores[0] ?? ANY_STORE); enterShop()
  }
  // No store yet (Shop, or a link straight in): ask first; backing out of shopping mode leaves it.
  const storeSheet = (picking || (shopping && !trip && storeLink === null)) && (
    <Sheet title="Where are you shopping?" onClose={() => { setPicking(false); if (shopping && !trip) exitShop() }}>
      <div className="shop-store-options">
        {[...tripStores, ANY_STORE].map(st => (
          <button key={st} className={`btn ${st === trip ? 'btn-primary' : 'btn-secondary'} btn-block`} aria-pressed={st === trip} onClick={() => pickStore(st)}>
            {st === ANY_STORE ? 'Any store' : st}
          </button>
        ))}
      </div>
      <p className="field-hint">{tripStores.length ? "Items go in that store's aisle order. Any store goes store by store." : 'Add stores to items to walk them in aisle order.'}</p>
    </Sheet>
  )

  if (shopping) {
    const row = (item: ListItem, other = false) => <ShopRow key={item.id} item={item} meta={other ? item.store : !tripAt ? item.aisle : null} onToggle={() => toggle(item)} from={fromTag(item)} readOnly={!mine(item)} />
    const group = (title: string, rows: React.ReactNode, className = '') => (
      <section key={title} className={`shop-group ${className}`} aria-label={title}><h3 className="list-group-title" aria-hidden="true">{title}</h3>{rows}</section>
    )
    return createPortal(
      <div className="shop-mode" role="dialog" aria-modal="true" aria-labelledby={`shop-title-${listId}`}>
        <div className="shop-bar">
          <div className="shop-bar-title">
            <h2 id={`shop-title-${listId}`} ref={shopHeading} tabIndex={-1}>{list.name}<span className="sr-only">, shopping mode</span></h2>
            <button className="shop-store-btn" onClick={() => setPicking(true)} aria-label={`Shopping at ${storeLabel ?? 'no store yet'}. Change store`}>
              <CartIcon width={16} height={16} />{storeLabel ?? 'Pick a store'} <span aria-hidden="true">▾</span>
            </button>
          </div>
          {view && <div className="shop-left">{tripLeft} left{tripAt && reversed && <span className="chip chip-static shop-reversed">Reversed</span>}</div>}
          {tripAt && (
            <button className="icon-btn shop-reverse-btn" onClick={flipReverse} aria-pressed={reversed} aria-label="Walk the aisles in reverse">
              <span aria-hidden="true">⇅</span>
            </button>
          )}
          <button className="btn btn-secondary shop-done" onClick={exitShop} aria-label="Back to the list. The trip stays on">Back</button>
        </div>
        <div className="shop-items scroll-y" ref={shopList} onScroll={saveShopScroll}>
          {items.length === 0 && <div className="empty-card"><span className="emoji">🛒</span>Nothing on the list yet.</div>}
          {view?.aisles.map(g => group(g.aisle, g.items.map(i => row(i))))}
          {!!view?.unknown.length && group('Aisle unknown', view.unknown.map(i => row(i)))}
          {!!view?.other.length && group('At other stores', view.other.map(i => row(i, true)), 'list-trip-other')}
        </div>
        <div className="shop-dock">
          {adding && (
            <div className="list-add-bar shop-add">
              <ItemAddField id={`shop-add-${listId}`} value={draft} onChange={setDraft} onAdd={addItem} suggestions={suggestions.items} onList={onList} inputRef={inputRef}
                above buyAgain autoFocus label={`Add to ${list.name}`} placeholder="Add an item…" onEscape={e => { e.stopPropagation(); setAdding(false) }} />
              <button className="icon-btn" onClick={() => addItem()} disabled={!draft.trim()} aria-label="Add item"><PlusIcon width={20} height={20} /></button>
            </div>
          )}
          <div className="shop-dock-row">
            {scanBtn /* scan to check off (or add) without opening Add an item */}
            <button className="btn btn-secondary shop-add-btn" onClick={() => setAdding(a => !a)} aria-expanded={adding} aria-label={adding ? 'Close Add an item' : 'Add an item'}>
              {adding ? <XIcon width={18} height={18} /> : <PlusIcon width={18} height={18} />}{!tripChecked.length && <span aria-hidden="true">{adding ? 'Close' : 'Add an item'}</span>}
            </button>
            {tripChecked.length > 0 && (
              <button className="btn btn-primary list-checkout-btn" onClick={() => checkoutTrip()}>
                {TRIP_DONE_LABEL} ({tripChecked.length})
              </button>
            )}
          </div>
        </div>
        {storeSheet}
        {leftoversSheet}
        {scanSheet}
        {placeSheet}
      </div>,
      document.body)
  }

  const siblingIds = items.slice().sort((a, b) => a.sort - b.sort).map(i => i.id)
  // View: group, sort and the store filter behind one button, counted when they differ from a new
  // list's, and summed up in one line under it (the Contacts pattern).
  const viewDef = listViewDefaults(list.kind)
  const groupChanged = list.kind === 'shopping' && list.groupBy !== viewDef.groupBy
  const sortChanged = list.sortBy !== viewDef.sortBy
  const viewCount = [groupChanged, sortChanged, !!selectedStore].filter(Boolean).length
  const viewSummary = [
    groupChanged && (list.groupBy === 'none' ? 'Not grouped' : `Grouped by ${GROUP_LABEL[list.groupBy].toLowerCase()}`),
    sortChanged && (list.sortBy === 'manual' ? 'Your order' : `Sorted by ${SORT_LABEL[list.sortBy].replace(/^[A-Z](?=[a-z])/, c => c.toLowerCase())}`),
    selectedStore && `${selectedStore} only`,
  ].filter(Boolean).join(' · ')
  const viewButton = (
    <button className={`icon-btn filter-btn list-view-btn ${viewCount ? 'active' : ''}`} onClick={() => setViewing(true)} aria-haspopup="dialog"
      aria-label={viewCount ? `View options, ${viewCount} changed` : 'View options'}>
      <FilterIcon width={20} height={20} />
      {viewCount > 0 && <span className="filter-badge" aria-hidden="true">{viewCount}</span>}
    </button>
  )

  return (
    <div className="list-detail">
      <div className="list-detail-header">
        {isPhone && <button className="icon-btn" onClick={onBack} aria-label="Back to lists"><ChevronLeft width={20} height={20} /></button>}
        <div className="list-detail-emoji" aria-hidden="true">{list.emoji || '📝'}</div>
        <div className="list-detail-title">
          <h2 className="list-detail-name">{list.name}</h2>
          <div className="list-detail-sub">{TYPE_LABEL[listType(list)]} · <CountLine list={list} /></div>
          {lastDoneLine(list, members) && <div className="list-detail-sub list-last-done">{lastDoneLine(list, members)}</div>}
        </div>
        {parentDevice && <button className="btn btn-secondary" onClick={() => setEditList(true)} aria-label={`Edit list ${list.name}`}>Edit</button>} {/* a list's settings, archive and delete are for parent devices; View stays */}
      </div>

      <div className="list-add-bar">
        <ItemAddField id={`list-add-${listId}`} value={draft} onChange={setDraft} onAdd={addItem} suggestions={suggestions.items} onList={onList} inputRef={inputRef}
          label={`Add to ${list.name}`} placeholder={list.kind === 'shopping' ? 'Add an item…' : 'Add something…'} />
        <button className="icon-btn" onClick={() => addItem()} disabled={!draft.trim()} aria-label="Add item"><PlusIcon width={20} height={20} /></button>
        {scanBtn}
        {list.kind !== 'shopping' && items.length > 0 && viewButton /* no Shop button to share a row with */}
      </div>

      {/* Shopping lists: Shop (or the trip and End), and View once there's something to view. */}
      {list.kind === 'shopping' && (
        <div className="list-actions">
          {activeTrip ? <>
            <button className="btn btn-primary list-shop-btn on-trip" onClick={enterShop} aria-label={`Shopping at ${storeLabel}, ${tripLeft} left. Resume shopping`}>
              <CartIcon width={18} height={18} /><span className="list-shop-label">Shopping at {storeLabel}<span className="list-shop-sub"> · {tripLeft} left</span></span>
            </button>
            <button className="btn btn-secondary list-end-btn" onClick={() => changeTrip(null)} aria-label={`End shopping at ${storeLabel}`}>End</button>
          </> : (
            <button className="btn btn-secondary list-shop-btn" onClick={startShop} aria-haspopup={tripStores.length > 1 ? 'dialog' : undefined}>
              <CartIcon width={18} height={18} />Shop
            </button>
          )}
          {!activeTrip && <button className="btn btn-secondary list-catalog-btn" onClick={() => setCataloging(true)} aria-haspopup="dialog" aria-label={catalogName(list.catalog ?? 'groceries')}>Catalog</button>}
          {!activeTrip && items.length > 0 && viewButton}
        </div>
      )}
      {/* To-do and reusable lists: Get stuff done, the list full screen (shopping lists have Shop). */}
      {list.kind !== 'shopping' && items.length > 0 && (
        <div className="list-actions">
          <button className="btn btn-secondary list-do-btn" onClick={() => setDoing(true)} aria-haspopup="dialog"><CheckIcon width={18} height={18} />Get stuff done</button>
        </div>
      )}
      {doing && <GetStuffDone listId={listId} onClose={() => { setDoing(false); load() }} />}
      {!activeTrip && viewSummary && items.length > 0 && (
        <button className="filter-summary list-view-summary" onClick={() => setViewing(true)} aria-label={`View: ${viewSummary}. Change view`}>{viewSummary}</button>
      )}

      <div className="list-items scroll-y">
        {items.length === 0 ? (
          <div className="empty-card"><span className="emoji">{list.kind === 'shopping' ? '🛒' : list.kind === 'reusable' ? '🧳' : '📝'}</span>Nothing here yet — add your first item above.</div>
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
                <h3 className="list-group-title" style={{ margin: 0 }}>Aisle unknown</h3>
                {view.unknown.map(item => tripRow(item))}
              </div>
            )}
            {view.other.length > 0 && (
              <div className="list-group list-trip-other">
                <h3 className="list-group-title" style={{ margin: 0 }}>At other stores</h3>
                {view.other.map(item => tripRow(item, true))}
              </div>
            )}
          </>
        ) : list.groupBy === 'none' ? (
          openItems.length === 0 ? (
            <div className="empty-card"><span className="emoji">✨</span>All done!</div>
          ) : (
            <DragList items={openItems.slice().sort(cmp)} onReorder={reorderWithin} fixed={!manual}
              renderRow={(item, handle) => <ItemRow item={item} kind={list.kind} groupBy={list.groupBy} members={members} event={item.eventId ? byId.get(item.eventId) : undefined} onToggle={() => toggle(item)} onOpen={() => openItem(item)} handle={handle} readOnly={!mine(item)} onDelete={delFor(item)} />} />
          )
        ) : groupedOpen.length === 0 ? (
          <div className="empty-card"><span className="emoji">✨</span>All done!</div>
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
              <button className="list-done-toggle" onClick={() => setShowDone(s => !s)} aria-expanded={showDone}><span aria-hidden="true">{showDone ? '▾' : '▸'}</span> Done ({doneItems.length})</button>
              <button className="link-btn" onClick={() => startCheckout(doneItems.filter(mine), list.kind)}>{list.kind === 'reusable' ? 'Reset list' : 'Clear checked'}</button>
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
              {TRIP_DONE_LABEL} ({tripChecked.length})
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
          <span>{checkout.reset ? `Reset ${checkout.ids.length} item${checkout.ids.length === 1 ? '' : 's'}` : checkout.trip ? `Took ${checkout.ids.length} item${checkout.ids.length === 1 ? '' : 's'} off the list.${checkout.left ? ` ${checkout.left} ${checkout.left === 1 ? 'is' : 'are'} left for next time.` : ''}` : `Cleared ${checkout.ids.length} item${checkout.ids.length === 1 ? '' : 's'}`}</span>
          <button className="list-undo-btn" onClick={undoCheckout}>Undo</button>
        </div>
      )}
      {deleting && (
        <div className="toast list-undo-toast" role="status">
          <span>Deleted {deleting.title}</span>
          <button className="list-undo-btn" onClick={undoDelete}>Undo</button>
        </div>
      )}


      {editItem && (
        <ItemEditSheet listId={listId} item={editItem} kind={list.kind} readOnly={!mine(editItem)} manual={manual} members={members} suggestions={suggestions} aisleOrder={aisleOrder} trip={tripAt} siblingIds={siblingIds} upcoming={upcoming} byId={byId}
          moveTargets={lists.filter(l => !l.archived && l.id !== listId && listType(l) === listType(list))}
          onClose={() => { setEditItem(null); load() }} onSaved={() => { setEditItem(null); load() }} />
      )}
      {editList && (
        <ListEditSheet list={list} onClose={() => setEditList(false)} onManage={() => { setEditList(false); setManaging(true) }}
          onSaved={() => { setEditList(false); load(); onArchivedOrDeleted() }}
          onDeleted={() => { setEditList(false); onArchivedOrDeleted() }} />
      )}
      {scanSheet}
      {viewing && (
        <ListViewSheet list={list} stores={stores} store={selectedStore} onStore={setSelectedStore} onGroupBy={setGroupBy} onSortBy={setSortBy} onClose={() => setViewing(false)}
          onReorder={list.kind === 'shopping' && reorderable && reorderableNames.length > 1 ? () => { setViewing(false); setReorderGroups(true) } : undefined} />
      )}
      {managing && <ManageValuesSheet catalog={list.catalog ?? 'groceries'} suggestions={suggestions} aisleOrder={aisleOrder} onClose={() => setManaging(false)} onChanged={load}
        onCatalog={list.kind === 'shopping' ? () => { setManaging(false); setCataloging(true) } : undefined} />}
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
    try { await api.updateList(l.id, { archived: false }); announce(`${l.name} restored`); onChanged() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not restore list', true) }
  }
  const del = async (l: List) => {
    if (!await dialog.confirm({ title: `Delete "${l.name}"?`, body: 'This removes all its items too.', confirmLabel: 'Delete', danger: true })) return
    try { await api.deleteList(l.id); announce(`${l.name} deleted`); onChanged() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete list', true) }
  }
  return (
    <details className="lists-archived">
      <summary>Archived ({lists.length})</summary>
      {lists.map(l => (
        <div key={l.id} className="lists-archived-row">
          <span className="list-card-emoji" aria-hidden="true">{l.emoji || '📝'}</span>
          <span className="list-card-name">{l.name}</span>
          <button className="btn btn-secondary" onClick={() => restore(l)} aria-label={`Restore ${l.name}`}>Restore</button>
          <button className="icon-btn" onClick={() => del(l)} aria-label={`Delete ${l.name}`}><TrashIcon width={16} height={16} /></button>
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
  const [reordering, setReordering] = useState(false)
  // A section's new order (ids): saved for the whole family; everything else keeps its place.
  const reorder = async (ids: string[]) => {
    const order = reorderWithin(allLists, ids)
    setLists(ls => ls.map(l => ({ ...l, sort: order.indexOf(l.id) })))
    try { await api.reorderLists(order) }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not reorder lists', true); load() }
  }
  const nudge = (ids: string[], list: List, dir: -1 | 1) => {
    const i = ids.indexOf(list.id), j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    const next = [...ids]
    ;[next[i], next[j]] = [next[j], next[i]]
    reorder(next)
    announce(`${list.name} moved to position ${j + 1} of ${ids.length}`)
  }
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // #/lists?list=<id> (a tap in a member's snapshot): open that list.
  const listParam = () => new URLSearchParams(location.hash.split('?')[1] || '').get('list')
  // #/lists/<id>/shop: that list in shopping mode.
  const shopParam = () => /^#\/lists\/([^/?]+)\/shop/.exec(location.hash)?.[1] ?? null
  const [shopId, setShopId] = useState<string | null>(shopParam)
  const [selectedId, setSelectedId] = useState<string | null>(() => listParam() ?? shopParam())
  const [editList, setEditList] = useState<List | 'new' | null>(null)
  useEffect(() => {
    const read = () => {
      const shop = shopParam()
      setShopId(shop)
      if (shop) setSelectedId(shop)
      const id = listParam()
      if (!id) return
      setSelectedId(id)
      history.replaceState(null, '', '#/lists')
    }
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])

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
    if (gone && shopId === selectedId) location.replace('#/lists')
    if (gone || (!selectedId && !isPhone)) setSelectedId(isPhone ? null : sections[0]?.lists[0]?.id ?? null)
  }, [lists, sections, loading, selectedId, isPhone, shopId])

  if (error) return <div className="content"><div className="state-card">Couldn't load lists.</div></div>

  if (!loading && lists.length === 0 && archived.length === 0) {
    return (
      <div className="content">
        <div className="empty-card"><span className="emoji">📝</span>No lists yet — start a shopping list, to-do list, or packing list.</div>
        <button className="fab" onClick={() => setEditList('new')} aria-label="New list"><PlusIcon /></button>
        {editList && <ListEditSheet list={editList} onClose={() => setEditList(null)} onSaved={() => { setEditList(null); load() }} onDeleted={() => { setEditList(null); load() }} />}
      </div>
    )
  }

  const cards = (
    <div className="lists-col">
      {sections.map(s => {
        const open = reordering || !collapsed.includes(s.type)
        const ids = s.lists.map(l => l.id)
        return (
          <section key={s.type} className="lists-section" aria-label={s.label}>
            <button className="lists-section-head" aria-expanded={open} onClick={() => toggleSection(s.type)} disabled={reordering}>
              <ChevronRight width={18} height={18} aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : undefined }} />
              <span className="lists-section-label">{s.label}</span>
              <span className="lists-section-count">{s.lists.length}</span>
            </button>
            {open && (reordering
              ? <DragList items={s.lists.map(l => ({ ...l, title: l.name }))} onReorder={reorder}
                  renderRow={(l, handle) => <ReorderCard list={l} handle={handle} first={ids[0] === l.id} last={ids[ids.length - 1] === l.id} onMove={dir => nudge(ids, l, dir)} />} />
              : s.lists.map(l => (
                <ListCard key={l.id} list={l} active={selectedId === l.id} members={members} onSelect={() => setSelectedId(l.id)} onEdit={parentDevice ? () => setEditList(l) : undefined} />
              )))}
          </section>
        )
      })}
      {reordering
        ? <button className="btn btn-primary btn-block list-new-btn" onClick={() => setReordering(false)}>Done</button>
        : (
          <div className="lists-col-actions">
            <button className="btn btn-secondary list-new-btn" onClick={() => setEditList('new')}><PlusIcon width={18} height={18} /> New list</button>
            {parentDevice && sections.some(s => s.lists.length > 1) && <button className="btn btn-secondary" onClick={() => setReordering(true)}>Reorder</button>}
          </div>
        )}
      {!reordering && parentDevice && <ArchivedLists lists={archived} onChanged={load} />}
    </div>
  )

  return (
    <div className="content lists-content">
      {isPhone ? (
        selectedId ? (
          <ListDetailPane listId={selectedId} lists={lists} isPhone shopMode={shopId === selectedId} onBack={() => setSelectedId(null)} onArchivedOrDeleted={() => { setSelectedId(null); load() }} onLoaded={syncCard} />
        ) : (
          <div className="lists-shell lists-shell-phone">{cards}</div>
        )
      ) : (
        <div className="lists-shell">
          {cards}
          {selectedId
            ? <ListDetailPane listId={selectedId} lists={lists} isPhone={false} shopMode={shopId === selectedId} onBack={() => setSelectedId(null)} onArchivedOrDeleted={() => { setSelectedId(null); load() }} onLoaded={syncCard} />
            : <div className="list-detail list-detail-empty"><div className="empty-card"><span className="emoji">👈</span>Pick a list to open it.</div></div>}
        </div>
      )}
      {editList && <ListEditSheet list={editList} onClose={() => setEditList(null)} onSaved={() => { setEditList(null); load() }} onDeleted={() => { setEditList(null); load() }} />}
    </div>
  )
}
