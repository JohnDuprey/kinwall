import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { addDays, format } from 'date-fns'
import { useApp } from './AppContext.tsx'
import { api, ApiError } from './api.ts'
import { applyListOps, type Op } from './outbox.ts'
import type { EventInstance, ItemSuggestion, List, ListDetail, ListGroupBy, ListItem, ListItemPriority, ListItemStep, ListKind, ListSortBy, Member } from './types.ts'
import { aisleOrderMap, compareAisles, compareItems, LIST_EMOJI, MEMBER_PALETTE, type AisleOrder } from './types.ts'
import { dateKey } from './date.ts'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { MemberPicker } from './MemberPicker.tsx'
import { isSingleEmoji } from './emoji.ts'
import { colorName, inkFor } from './color.ts'
import { useIsPhone } from './useIsPhone.ts'
import { CalendarIcon, CartIcon, CheckIcon, ChevronLeft, ChevronRight, FilterIcon, NoteIcon, PlusIcon, TrashIcon, XIcon } from './icons.tsx'
import { announce, pressable, Segmented } from './a11y.tsx'
import { useDialog } from './dialog.tsx'
import { CustomColorSwatch } from './ColorSwatch.tsx'
import { PRIORITY_LABEL, PRIORITY_MARK, PriorityBadge } from './PriorityBadge.tsx'
import NotesThread from './NotesThread.tsx'
import { aisleAt, ANY_STORE, anyStoreView, departmentAisle, setShoppingModeList, setTripReverse, setTripStore, tripLeftovers, tripReverse, tripStore, tripStoreFor, tripView } from './trip.ts'
import { hashPath, hashQuery } from './hashQuery.ts'
import { holdAwake } from './wakeLock.ts'
import { shoppingActivity } from './liveActivity.ts'
import { endAppActivity, tellAppActivity } from './native.ts'
import { itemKey, matchItems } from './itemSuggest.ts'
import { listSections, reorderWithin } from './listSections.ts'

const KIND_LABEL: Record<ListKind, string> = { todo: 'To-do', shopping: 'Shopping', reusable: 'Reusable' }

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
/** Checkout on a shopping list, Reset on a reusable one (unchecks for next time), else Clear checked. */
const CHECKOUT_LABEL: Record<ListKind, string> = { shopping: 'Checkout', reusable: 'Reset', todo: 'Clear checked' }
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
  list: List; active: boolean; members: Member[]; onSelect: () => void; onEdit: () => void
}) {
  // Long-press to edit, short tap to open - same interaction as ChoreCard.
  const pressTimer = useRef<ReturnType<typeof setTimeout>>()
  const longPressed = useRef(false)
  const handleDown = () => {
    longPressed.current = false
    pressTimer.current = setTimeout(() => { longPressed.current = true; onEdit() }, 500)
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
      aria-current={active || undefined} onContextMenu={e => { e.preventDefault(); onEdit() }}
      aria-label={[list.name, countLabel(list), owners.length ? `for ${owners.map(m => m.name).join(' and ')}` : ''].filter(Boolean).join(', ')}
      style={{ ['--list-color' as string]: list.color || 'var(--accent)' }}
      onPointerDown={handleDown} onPointerUp={handleUp} onPointerLeave={() => clearTimeout(pressTimer.current)}>
      <div className="list-card-accent" />
      <div className="list-card-emoji">{list.emoji || '📝'}</div>
      <div className="list-card-body">
        <div className="list-card-name">{list.name}</div>
        <div className="list-card-sub"><CountLine list={list} /></div>
      </div>
      {owners.length > 0 && (
        <div className="list-card-owners">
          {owners.map(m => (
            <div key={m.id} className="member-avatar-sm" style={{ background: m.color, color: inkFor(m.color) }}>{m.avatar || m.name[0]}</div>
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
function readCollapsed(): ListKind[] {
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
  const [kind, setKind] = useState<ListKind>(existing?.kind ?? 'todo')
  const [emoji, setEmoji] = useState(existing?.emoji ?? LIST_EMOJI[0])
  const [color, setColor] = useState(existing?.color ?? MEMBER_PALETTE[0])
  const [memberIds, setMemberIds] = useState<string[]>(existing?.memberIds ?? [])
  // null = not touched: the kind's default (the server applies it on create and on a kind change).
  const [keepTouched, setKeep] = useState<boolean | null>(null)
  const keepChecked = keepTouched ?? (existing && kind === existing.kind ? existing.keepChecked : kind !== 'todo')

  const submit = async () => {
    if (!name.trim() || !isSingleEmoji(emoji)) return
    const body = { name: name.trim(), kind, emoji, color, memberIds, ...(keepTouched !== null ? { keepChecked } : {}) }
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
        <label>Kind</label>
        <Segmented label="Kind" value={kind} onChange={setKind} options={(['todo', 'shopping', 'reusable'] as ListKind[]).map(k => ({ key: k, label: KIND_LABEL[k] }))} />
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

function ItemEditSheet({ listId, item, kind, manual, members, suggestions, aisleOrder, trip, siblingIds, upcoming, byId, onClose, onSaved }: {
  listId: string; item: ListItem; kind: ListKind; manual: boolean; members: Member[]
  suggestions: ListDetail['suggestions']; aisleOrder: AisleOrder
  trip: string | null // shopping at this store: the aisle picker is this store's
  upcoming: EventInstance[]; byId: Map<string, EventInstance> // for the "Linked event" picker
  siblingIds: string[] // items in current sort order, for up/down reorder
  onClose: () => void; onSaved: () => void
}) {
  const dialog = useDialog()
  const { toast, settings } = useApp()
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
    <Sheet title="Edit item" onClose={onClose}
      actions={<>
        <button className="btn btn-danger" onClick={del} aria-label="Delete"><TrashIcon width={18} height={18} /></button>
        <button className="btn btn-primary" onClick={submit} disabled={!title.trim()}>Save</button>
      </>}>
      <div className="field">
        <label htmlFor="item-title">Title</label>
        {/* A textarea so a long title shows in full; Enter doesn't add a line break. */}
        <textarea id="item-title" className="item-title-input" rows={2} value={title} onChange={e => setTitle(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') e.preventDefault() }} />
      </div>
      {kind === 'shopping' && quantityAndPlace /* on a shopping list, where it goes comes first */}
      {kind !== 'shopping' && priorityField}
      <StepsEditor listId={listId} item={live} onChange={setLive} />
      {kind !== 'shopping' && quantityAndPlace}
      {kind !== 'shopping' && (
          <div className="field">
            <label>Assign to</label>
            <div className="chip-row">
              <button className={`chip ${memberId === null ? 'active' : ''}`} aria-pressed={memberId === null} onClick={() => setMemberId(null)}>Nobody</button>
              {members.map(m => (
                <button key={m.id} className={`chip ${memberId === m.id ? 'active' : ''}`} aria-pressed={memberId === m.id} style={{ ['--chip-color' as string]: m.color }} onClick={() => setMemberId(m.id)}>{m.avatar} {m.name}</button>
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
      {settings.features.notes && <NotesThread target={`list_item:${item.id}`} title="Discussion" />}
      {manual && (
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

function ItemRow({ item, kind, groupBy, members, event, onToggle, onOpen, handle }: {
  item: ListItem; kind: ListKind; groupBy: ListGroupBy; members: Member[]; event?: EventInstance; onToggle: () => void; onOpen: () => void
  handle?: React.ReactNode
}) {
  const assignee = kind !== 'shopping' && item.memberId ? members.find(m => m.id === item.memberId) : null
  const showStore = kind === 'shopping' && groupBy !== 'store' && groupBy !== 'aisle' && item.store
  const showAisle = kind === 'shopping' && groupBy !== 'aisle' && item.aisle
  // A department that just repeats the aisle ("Produce · Produce") isn't shown twice.
  const showCategory = kind === 'shopping' && groupBy !== 'category' && item.category && item.category.toLowerCase() !== item.aisle?.toLowerCase()
  const due = dueLabel(item)
  const prio = item.priority !== 'normal' ? item.priority : null
  const notesOn = useApp().settings.features.notes // off: an item's own notes still show, its thread's count doesn't
  return (
    <div className={`list-item-row ${item.done ? 'done' : ''} ${prio === 'urgent' && !item.done ? 'urgent' : ''} ${item.pending ? 'pending' : ''}`} title={item.pending ? 'Not synced yet' : undefined}>
      <button className={`list-item-check ${item.done ? 'done' : ''}`} onClick={onToggle} role="checkbox" aria-checked={item.done} aria-label={item.pending ? `${item.title}, not synced yet` : item.title}>
        {item.done && <CheckIcon width={20} height={20} />}
      </button>
      <div className="list-item-body" {...pressable(onOpen)}
        aria-label={[`Edit ${item.title}`, item.done && 'checked off', prio && `${PRIORITY_LABEL[prio]} priority`, due?.text, (item.notes || (notesOn && item.noteCount)) && 'has notes', item.stepsTotal > 0 && `${item.stepsDone} of ${item.stepsTotal} steps done`].filter(Boolean).join(', ')}>
        <div className="list-item-title-row">
          {prio && <PriorityBadge p={prio} />}
          <div className="list-item-title">{item.title}</div>
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
      {assignee && <div className="member-avatar-sm" role="img" aria-label={`For ${assignee.name}`} style={{ background: assignee.color, color: inkFor(assignee.color) }}>{assignee.avatar || assignee.name[0]}</div>}
      {handle}
    </div>
  )
}

/** A row in shopping mode: the whole row ticks the item (no editing mid-aisle). */
function ShopRow({ item, meta, onToggle }: { item: ListItem; meta?: string | null; onToggle: () => void }) {
  const sub = [meta, item.notes?.split('\n')[0]].filter(Boolean).join(' · ')
  return (
    <button className={`shop-row ${item.done ? 'done' : ''} ${item.pending ? 'pending' : ''}`} role="checkbox" aria-checked={item.done} onClick={onToggle} title={item.pending ? 'Not synced yet' : undefined}>
      <span className="shop-check" aria-hidden="true">{item.done && <CheckIcon width={20} height={20} />}</span>
      <span className="shop-row-body">
        <span className="shop-row-title">{item.title}</span>
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
function DragList<T extends { id: string; title: string }>({ items, renderRow, onReorder, locked }: {
  items: T[]
  renderRow: (item: T, handle: React.ReactNode) => React.ReactNode
  onReorder: (ids: string[]) => void
  locked?: () => void // set when the order isn't hand-set: the grip only explains why it won't drag
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
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
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
        const handle = locked ? (
          <button className="list-item-grip locked" aria-disabled="true" aria-label={`Reorder ${item.title}: switch to Manual to drag`} title="Switch to Manual to drag" onClick={locked}>
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
              {[3, 8, 13].flatMap(y => [5, 11].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}
            </svg>
          </button>
        ) : (
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
function ManageValuesSheet({ suggestions, aisleOrder, onClose, onChanged }: {
  suggestions: ListDetail['suggestions']; aisleOrder: AisleOrder; onClose: () => void; onChanged: () => void
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
  const [findItem, setFindItem] = useState('')
  const forget = async (s: ItemSuggestion) => {
    if (!await dialog.confirm({ title: `Forget "${s.title}"?`, body: 'It stops being suggested as you add, and where it goes is forgotten. Items on lists keep it.', confirmLabel: 'Forget', danger: true })) return
    try { await api.forgetItemName(s.key); announce(`Forgot ${s.title}`); onChanged() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not forget it', true) }
  }
  const aisles = override?.store === store ? override.aisles : storeAisles(suggestions, store, aisleOrder)

  const rename = async (field: Field, from: string, to: string | null) => {
    try {
      const { updated } = await api.renameListValue({ field, from, to, ...(field === 'aisle' ? { store } : {}) })
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
      {suggestions.items && <>
        <h3 className="manage-head">Items</h3>
        <p className="field-hint">Names you've added are suggested as you type. Find one to forget it.</p>
        <input type="search" className="manage-find" value={findItem} onChange={e => setFindItem(e.target.value)} placeholder="Find an item…" aria-label="Find a remembered item" autoComplete="off" />
        {findItem.trim() && (() => {
          const found = matchItems(findItem, suggestions.items.filter(s => s.uses > 0), new Set(), 20)
          return found.length ? found.map(s => (
            <div className="manage-row" key={s.key}>
              <span className="manage-row-name">{s.title}</span>
              <button className="icon-btn" onClick={() => forget(s)} aria-label={`Forget ${s.title}`}><TrashIcon width={16} height={16} /></button>
            </div>
          )) : <p className="list-item-meta">Nothing remembered by that name.</p>
        })()}
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
        autoComplete="off" autoCorrect="off" autoCapitalize="sentences" spellCheck={false}
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

function ListDetailPane({ listId, isPhone, shopMode, onBack, onArchivedOrDeleted, onLoaded }: {
  listId: string; isPhone: boolean; onBack: () => void; onArchivedOrDeleted: () => void; onLoaded: (list: List) => void
  shopMode: boolean // #/lists/<id>/shop: shopping mode, full screen
}) {
  const { members, toast, refreshTick } = useApp()
  const [detail, setDetail] = useState<ListDetail | null>(null)
  const [error, setError] = useState(false)
  const [editItem, setEditItem] = useState<ListItem | null>(null)
  const [editList, setEditList] = useState(false)
  const [reorderGroups, setReorderGroups] = useState(false)
  const [viewing, setViewing] = useState(false) // the View sheet: group, sort, show store
  const [managing, setManaging] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [selectedStore, setSelectedStore] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { upcoming, byId } = useEventWindow(refreshTick)

  const load = () => api.getList(listId).then(d => { setDetail(d); setError(false); onLoaded(d.list) }).catch(() => setError(true))
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

  // Shopping mode: the trip alone, full screen. "Done" leaves it with the trip still on (Shopping at
  // on the list comes back to it); only Checkout or End ends the trip.
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
    commitCheckout()
    const ids = checked.map(i => i.id), reset = kind === 'reusable'
    setCheckout({ ids, reset, trip, shop: shopMode, left })
    if (trip) { setTripStore(listId, null); setTrip(null); shopScroll.current = 0 } // Checkout ends the trip
    pendingCheckout.current = async () => {
      try { await (reset ? api.resetList(listId, ids) : api.clearListCompleted(listId, ids, trip && trip !== ANY_STORE ? trip : undefined)) }
      catch (e) { toast(e instanceof ApiError ? e.message : reset ? 'Could not reset the list' : 'Could not clear checked items', true) }
      setCheckout(null); load()
    }
    checkoutTimer.current = setTimeout(commitCheckout, 5000)
  }
  const undoCheckout = () => {
    clearTimeout(checkoutTimer.current); pendingCheckout.current = null
    if (checkout?.trip) { setTripStore(listId, checkout.trip); setTrip(checkout.trip) }
    if (checkout?.shop) enterShop() // back to the aisles
    setCheckout(null); announce('Undone')
  }
  useEffect(() => { load() }, [listId, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps
  // The iPhone app's Live Activity for the trip (liveActivity.ts): what's left and what's next, in the
  // same walking order as the aisles below, on every change; End or Checkout ends it.
  const hadTrip = useRef<string | null>(null) // the list whose trip it's showing
  useEffect(() => {
    if (!detail || detail.list.id !== listId || detail.list.kind !== 'shopping') return
    if (!trip) { if (hadTrip.current === listId) endAppActivity('shopping'); hadTrip.current = null; return }
    hadTrip.current = listId
    const order = aisleOrderMap(detail)
    const pending = checkout && !checkout.reset ? detail.items.filter(i => !checkout.ids.includes(i.id)) : detail.items
    const items = trip !== ANY_STORE ? pending : pending.map(i => (i.aisle ? i : { ...i, aisle: departmentAisle(i.category, storeAisles(detail.suggestions, i.store, order)) }))
    tellAppActivity('shopping', { list: detail.list.name, ...shoppingActivity(listId, trip, items, order, trip !== ANY_STORE ? storeAisles(detail.suggestions, trip, order) : [], reversed) })
  }, [detail, trip, checkout, listId, reversed])
  // Adds, ticks, edits and deletes are queued (api.queue*): shown at once, sent in order, kept
  // offline. A refresh after they sync clears their pending mark (App bumps refreshTick).
  const showQueued = (op: Op | null) => { if (op) setDetail(d => d && applyListOps(d, [op])); else load() }

  const addItem = async (text = draft) => {
    const title = text.trim()
    if (!title) return
    setDraft('')
    try { showQueued(await api.queueAddListItem(listId, { title })) }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add item', true) }
    inputRef.current?.focus() // keep the keyboard open for the next item
  }

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
    try { showQueued(await api.queueUpdateListItem(listId, item.id, { done: !item.done })) }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update item', true) }
  }

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
      ? createPortal(<div className="shop-mode"><div className="shop-bar"><div className="shop-bar-title" /><button className="btn btn-secondary shop-done" onClick={exitShop}>Done</button></div>{card}</div>, document.body)
      : <div className="list-detail">{card}</div>
  }

  const { list, groups, suggestions } = detail
  const onList = new Set(detail.items.filter(i => !i.done).map(i => itemKey(i.title))) // not suggested again
  const aisleOrder = aisleOrderMap(detail)
  // A pending Checkout shows as done already: those items gone (or unchecked, for a Reset).
  const pending = !checkout ? detail.items
    : checkout.reset ? detail.items.map(i => (checkout.ids.includes(i.id) ? { ...i, done: false } : i))
    : detail.items.filter(i => !checkout.ids.includes(i.id))
  // Shopping: an item with no aisle sorts and groups in its store's aisle named like its department
  // (shown, never saved - the editor opens the item as stored).
  const items = list.kind !== 'shopping' ? pending
    : pending.map(i => (i.aisle ? i : { ...i, aisle: departmentAisle(i.category, storeAisles(suggestions, i.store, aisleOrder)) }))
  const openItem = (item: ListItem) => setEditItem(detail.items.find(i => i.id === item.id) ?? item)
  const stores = [...new Set(items.map(i => i.store).filter((v): v is string => !!v))].sort()
  const filtered = selectedStore ? items.filter(i => i.store === selectedStore || i.store === null) : items
  // Keep checked in place: ticked items stay put, crossed off, and the order doesn't move under you.
  const keep = list.keepChecked
  const cmp = compareItems(list.sortBy, todayKey(), { keepChecked: keep, aisleOrder })
  const openItems = keep ? filtered : filtered.filter(i => !i.done)
  const doneItems = keep ? [] : filtered.filter(i => i.done)
  const checked = filtered.filter(i => i.done)
  const groupKind = list.groupBy === 'aisle' ? 'store' : list.groupBy // aisle groups follow the store order
  const groupNamesForOrder = groups.filter(g => g.kind === groupKind).sort((a, b) => a.sort - b.sort).map(g => g.name)
  const groupedOpen = groupItems(openItems, list.groupBy, groupNamesForOrder, list.sortBy, cmp, aisleOrder)
  const manual = list.sortBy === 'manual'
  const locked = manual ? undefined : () => toast('Switch to Manual to drag')
  const reorderable = list.groupBy === 'store' || list.groupBy === 'category'
  const reorderableNames = reorderable ? [...new Set(items.map(i => (list.groupBy === 'store' ? i.store : i.category)).filter((v): v is string => !!v))] : []
  const checkoutLabel = CHECKOUT_LABEL[list.kind]
  // On a trip: everything, walked in that store's aisle order; checked items always stay in place.
  const activeTrip = list.kind === 'shopping' ? trip : null
  const tripAt = activeTrip === ANY_STORE ? null : activeTrip // one store: its aisles, in its order
  const storeLabel = activeTrip === ANY_STORE ? 'Any store' : activeTrip
  const tripAisles = tripAt ? storeAisles(suggestions, tripAt, aisleOrder) : []
  const view = !activeTrip ? null : tripAt ? tripView(pending, tripAt, aisleOrder, tripAisles, reversed) : anyStoreView(items, aisleOrder)
  const tripLeft = view ? [...view.aisles.flatMap(g => g.items), ...view.unknown].filter(i => !i.done).length : 0
  const tripChecked = items.filter(i => i.done)
  const tripRow = (item: ListItem, other = false) => (
    <ItemRow key={item.id} item={other || !tripAt ? item : { ...item, aisle: aisleAt(item, tripAt, tripAisles) }} kind={list.kind} groupBy={other ? 'none' : tripAt ? 'aisle' : 'store'} members={members}
      event={item.eventId ? byId.get(item.eventId) : undefined} onToggle={() => toggle(item)} onOpen={() => openItem(item)} />
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
    const row = (item: ListItem, other = false) => <ShopRow key={item.id} item={item} meta={other ? item.store : !tripAt ? item.aisle : null} onToggle={() => toggle(item)} />
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
          <button className="btn btn-secondary shop-done" onClick={exitShop}>Done</button>
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
            <button className="btn btn-secondary shop-add-btn" onClick={() => setAdding(a => !a)} aria-expanded={adding} aria-label={adding ? 'Close Add an item' : 'Add an item'}>
              {adding ? <XIcon width={18} height={18} /> : <PlusIcon width={18} height={18} />}{!tripChecked.length && <span aria-hidden="true">{adding ? 'Close' : 'Add an item'}</span>}
            </button>
            {tripChecked.length > 0 && (
              <button className="btn btn-primary list-checkout-btn" onClick={() => checkoutTrip()}>
                {checkoutLabel} ({tripChecked.length})
              </button>
            )}
          </div>
        </div>
        {storeSheet}
        {leftoversSheet}
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
          <div className="list-detail-sub">{KIND_LABEL[list.kind]} · <CountLine list={list} /></div>
        </div>
        <button className="btn btn-secondary" onClick={() => setEditList(true)} aria-label={`Edit list ${list.name}`}>Edit</button>
      </div>

      <div className="list-add-bar">
        <ItemAddField id={`list-add-${listId}`} value={draft} onChange={setDraft} onAdd={addItem} suggestions={suggestions.items} onList={onList} inputRef={inputRef}
          label={`Add to ${list.name}`} placeholder={list.kind === 'shopping' ? 'Add an item…' : 'Add something…'} />
        <button className="icon-btn" onClick={() => addItem()} disabled={!draft.trim()} aria-label="Add item"><PlusIcon width={20} height={20} /></button>
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
          {!activeTrip && items.length > 0 && viewButton}
        </div>
      )}
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
            <DragList items={openItems.slice().sort(cmp)} onReorder={reorderWithin} locked={locked}
              renderRow={(item, handle) => <ItemRow item={item} kind={list.kind} groupBy={list.groupBy} members={members} event={item.eventId ? byId.get(item.eventId) : undefined} onToggle={() => toggle(item)} onOpen={() => openItem(item)} handle={handle} />} />
          )
        ) : groupedOpen.length === 0 ? (
          <div className="empty-card"><span className="emoji">✨</span>All done!</div>
        ) : (
          groupedOpen.map(g => (
            <div key={g.name} className="list-group">
              <h3 className="list-group-title" style={{ margin: 0 }}>{g.name}</h3>
              <DragList items={g.items} onReorder={reorderWithin} locked={locked}
                renderRow={(item, handle) => <ItemRow item={item} kind={list.kind} groupBy={list.groupBy} members={members} event={item.eventId ? byId.get(item.eventId) : undefined} onToggle={() => toggle(item)} onOpen={() => openItem(item)} handle={handle} />} />
            </div>
          ))
        )}

        {!view && doneItems.length > 0 && (
          <div className="list-done-section">
            {/* Clear/Reset only matter once something is checked, so they live here rather than
                in a permanent footer that cost a phone a row of items. */}
            <div className="list-done-head">
              <button className="list-done-toggle" onClick={() => setShowDone(s => !s)} aria-expanded={showDone}><span aria-hidden="true">{showDone ? '▾' : '▸'}</span> Done ({doneItems.length})</button>
              <button className="link-btn" onClick={() => startCheckout(doneItems, list.kind)}>{list.kind === 'reusable' ? 'Reset list' : 'Clear checked'}</button>
            </div>
            {showDone && doneItems.slice().sort((a, b) => a.sort - b.sort).map(item => (
              <ItemRow key={item.id} item={item} kind={list.kind} groupBy={list.groupBy} members={members} event={item.eventId ? byId.get(item.eventId) : undefined} onToggle={() => toggle(item)} onOpen={() => openItem(item)} />
            ))}
          </div>
        )}

        {/* Mid-shop: checked items stay crossed off in place; one tap clears (or resets) them all. */}
        {activeTrip ? tripChecked.length > 0 && (
          <div className="list-checkout-bar">
            <button className="btn btn-primary list-checkout-btn" onClick={() => checkoutTrip()}>
              {checkoutLabel} ({tripChecked.length})
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
          <span>{checkout.reset ? `Reset ${checkout.ids.length} item${checkout.ids.length === 1 ? '' : 's'}` : list.kind === 'shopping' ? `Checked out ${checkout.ids.length} item${checkout.ids.length === 1 ? '' : 's'}${checkout.left ? `. ${checkout.left} left for next time.` : ''}` : `Cleared ${checkout.ids.length} item${checkout.ids.length === 1 ? '' : 's'}`}</span>
          <button className="list-undo-btn" onClick={undoCheckout}>Undo</button>
        </div>
      )}


      {editItem && (
        <ItemEditSheet listId={listId} item={editItem} kind={list.kind} manual={manual} members={members} suggestions={suggestions} aisleOrder={aisleOrder} trip={tripAt} siblingIds={siblingIds} upcoming={upcoming} byId={byId}
          onClose={() => { setEditItem(null); load() }} onSaved={() => { setEditItem(null); load() }} />
      )}
      {editList && (
        <ListEditSheet list={list} onClose={() => setEditList(false)} onManage={() => { setEditList(false); setManaging(true) }}
          onSaved={() => { setEditList(false); load(); onArchivedOrDeleted() }}
          onDeleted={() => { setEditList(false); onArchivedOrDeleted() }} />
      )}
      {viewing && (
        <ListViewSheet list={list} stores={stores} store={selectedStore} onStore={setSelectedStore} onGroupBy={setGroupBy} onSortBy={setSortBy} onClose={() => setViewing(false)}
          onReorder={list.kind === 'shopping' && reorderable && reorderableNames.length > 1 ? () => { setViewing(false); setReorderGroups(true) } : undefined} />
      )}
      {managing && <ManageValuesSheet suggestions={suggestions} aisleOrder={aisleOrder} onClose={() => setManaging(false)} onChanged={load} />}
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
  const { members, refreshTick, focusMemberId, focusShowsShared, toast } = useApp()
  const isPhone = useIsPhone()
  const [allLists, setLists] = useState<List[]>([])
  // A display pinned to one member shows that member's lists (and the family's, unless hidden).
  // Fetched with archived ones included; they only show in the collapsed "Archived" section.
  const visible = useMemo(() => focusMemberId ? allLists.filter(l => l.memberIds.includes(focusMemberId) || (focusShowsShared && l.memberIds.length === 0)) : allLists,
    [allLists, focusMemberId, focusShowsShared])
  const lists = useMemo(() => visible.filter(l => !l.archived), [visible])
  const archived = useMemo(() => visible.filter(l => l.archived), [visible])
  const sections = useMemo(() => listSections(lists), [lists])
  const [collapsed, setCollapsed] = useState<ListKind[]>(readCollapsed)
  const toggleSection = (kind: ListKind) => {
    const next = collapsed.includes(kind) ? collapsed.filter(k => k !== kind) : [...collapsed, kind]
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
        const open = reordering || !collapsed.includes(s.kind)
        const ids = s.lists.map(l => l.id)
        return (
          <section key={s.kind} className="lists-section" aria-label={s.label}>
            <button className="lists-section-head" aria-expanded={open} onClick={() => toggleSection(s.kind)} disabled={reordering}>
              <ChevronRight width={18} height={18} aria-hidden="true" style={{ transform: open ? 'rotate(90deg)' : undefined }} />
              <span className="lists-section-label">{s.label}</span>
              <span className="lists-section-count">{s.lists.length}</span>
            </button>
            {open && (reordering
              ? <DragList items={s.lists.map(l => ({ ...l, title: l.name }))} onReorder={reorder}
                  renderRow={(l, handle) => <ReorderCard list={l} handle={handle} first={ids[0] === l.id} last={ids[ids.length - 1] === l.id} onMove={dir => nudge(ids, l, dir)} />} />
              : s.lists.map(l => (
                <ListCard key={l.id} list={l} active={selectedId === l.id} members={members} onSelect={() => setSelectedId(l.id)} onEdit={() => setEditList(l)} />
              )))}
          </section>
        )
      })}
      {reordering
        ? <button className="btn btn-primary btn-block list-new-btn" onClick={() => setReordering(false)}>Done</button>
        : (
          <div className="lists-col-actions">
            <button className="btn btn-secondary list-new-btn" onClick={() => setEditList('new')}><PlusIcon width={18} height={18} /> New list</button>
            {sections.some(s => s.lists.length > 1) && <button className="btn btn-secondary" onClick={() => setReordering(true)}>Reorder</button>}
          </div>
        )}
      {!reordering && <ArchivedLists lists={archived} onChanged={load} />}
    </div>
  )

  return (
    <div className="content lists-content">
      {isPhone ? (
        selectedId ? (
          <ListDetailPane listId={selectedId} isPhone shopMode={shopId === selectedId} onBack={() => setSelectedId(null)} onArchivedOrDeleted={() => { setSelectedId(null); load() }} onLoaded={syncCard} />
        ) : (
          <div className="lists-shell lists-shell-phone">{cards}</div>
        )
      ) : (
        <div className="lists-shell">
          {cards}
          {selectedId
            ? <ListDetailPane listId={selectedId} isPhone={false} shopMode={shopId === selectedId} onBack={() => setSelectedId(null)} onArchivedOrDeleted={() => { setSelectedId(null); load() }} onLoaded={syncCard} />
            : <div className="list-detail list-detail-empty"><div className="empty-card"><span className="emoji">👈</span>Pick a list to open it.</div></div>}
        </div>
      )}
      {editList && <ListEditSheet list={editList} onClose={() => setEditList(null)} onSaved={() => { setEditList(null); load() }} onDeleted={() => { setEditList(null); load() }} />}
    </div>
  )
}
