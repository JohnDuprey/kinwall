import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { addDays, format } from 'date-fns'
import { useApp } from './AppContext.tsx'
import { api, ApiError } from './api.ts'
import { applyListOps, type Op } from './outbox.ts'
import type { EventInstance, List, ListDetail, ListGroupBy, ListItem, ListItemPriority, ListItemStep, ListKind, ListSortBy, Member } from './types.ts'
import { aisleOrderMap, compareAisles, compareItems, LIST_EMOJI, MEMBER_PALETTE, type AisleOrder } from './types.ts'
import { dateKey } from './date.ts'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { MemberPicker } from './MemberPicker.tsx'
import { isSingleEmoji } from './emoji.ts'
import { colorName, inkFor } from './color.ts'
import { useIsPhone } from './useIsPhone.ts'
import { CalendarIcon, CheckIcon, ChevronLeft, NoteIcon, PlusIcon, TrashIcon } from './icons.tsx'
import { announce, pressable, Segmented } from './a11y.tsx'
import { useDialog } from './dialog.tsx'
import { CustomColorSwatch } from './ColorSwatch.tsx'
import NotesThread from './NotesThread.tsx'

const KIND_LABEL: Record<ListKind, string> = { todo: 'To-do', shopping: 'Shopping', reusable: 'Reusable' }

/** "3 left" / "All done" summary shown on a list card, per SPEC. */
function countLabel(list: List) {
  if (list.itemCount === 0) return 'Empty'
  if (list.openCount === 0) return 'All done'
  return `${list.openCount} left`
}

const PRIORITY_LABEL: Record<ListItemPriority, string> = { low: 'Low', normal: 'Normal', high: 'High', urgent: 'Urgent' }
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
        <div className="list-card-sub">{countLabel(list)}</div>
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

function ListEditSheet({ list, onClose, onSaved, onDeleted, onManage }: {
  list: List | 'new'; onClose: () => void; onSaved: () => void; onDeleted: () => void
  onManage?: () => void // shopping lists: open "Stores & categories"
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
          <label>Stores &amp; categories</label>
          <button className="btn btn-secondary btn-block" onClick={onManage}>Rename stores, categories and aisles, or set aisle order</button>
        </div>
      )}
    </Sheet>
  )
}

const NEW_VALUE = '\u0000new'

/** A real dropdown of the household's values (a native select: the iPhone wheel, a big list on a
 * wall screen), plus "None" and "New …", which reveals a text field for a value not seen before. */
function ValuePicker({ id, label, value, options, onChange, newLabel, placeholder }: {
  id: string; label: string; value: string; options: string[]; onChange: (v: string) => void; newLabel: string; placeholder: string
}) {
  const [adding, setAdding] = useState(false)
  const typing = adding || (!!value && !options.includes(value)) // a value from elsewhere shows as typed
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={typing ? NEW_VALUE : value}
        onChange={e => { const v = e.target.value; setAdding(v === NEW_VALUE); onChange(v === NEW_VALUE ? '' : v) }}>
        <option value="">None</option>
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

function ItemEditSheet({ listId, item, kind, manual, members, suggestions, aisleOrder, siblingIds, upcoming, byId, onClose, onSaved }: {
  listId: string; item: ListItem; kind: ListKind; manual: boolean; members: Member[]
  suggestions: ListDetail['suggestions']; aisleOrder: AisleOrder
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
  const [aisle, setAisle] = useState(item.aisle ?? '')
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
      ...(kind === 'shopping' ? { store: store.trim() || null, category: category.trim() || null, aisle: aisle.trim() || null } : {}),
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
              // An aisle belongs to a store: keep it only if the new store has it too.
              if (aisle && !storeAisles(suggestions, v.trim() || null, aisleOrder).includes(aisle)) setAisle('')
            }} />
          <ValuePicker id="item-aisle" label={store.trim() ? `Aisle at ${store.trim()}` : 'Aisle'} value={aisle}
            options={storeAisles(suggestions, store.trim() || null, aisleOrder)} newLabel="New aisle…" placeholder="e.g. Aisle 4, Produce, Back wall" onChange={setAisle} />
          <ValuePicker id="item-category" label="Category" value={category} options={suggestions.categories} newLabel="New category…" placeholder="e.g. Produce" onChange={setCategory} />
        </>
      )}
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
      <div className="field">
        <label id="item-priority-label">Priority</label>
        <Segmented className="priority-seg" label="Priority" value={priority} onChange={setPriority}
          options={(['low', 'normal', 'high', 'urgent'] as ListItemPriority[]).map(p => ({
            key: p, label: <>{p !== 'normal' && <span className={`prio-dot prio-${p}`} aria-hidden="true" />}{PRIORITY_LABEL[p]}</>,
          }))} />
      </div>
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
        <textarea value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
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

function SortSheet({ value, kind, onChange, onClose }: { value: ListSortBy; kind: ListKind; onChange: (v: ListSortBy) => void; onClose: () => void }) {
  return (
    <Sheet title="Sort items" onClose={onClose} variant="dialog" actions={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <Segmented className="sort-options" label="Sort items by" value={value} onChange={onChange}
        options={(Object.keys(SORT_LABEL) as ListSortBy[]).filter(k => k !== 'aisle' || kind === 'shopping' || value === 'aisle').map(k => ({
          key: k, label: <><span className="sort-option-name">{SORT_LABEL[k]}</span><span className="sort-option-hint">{SORT_HINT[k]}</span></>,
        }))} />
      {value !== 'manual' && <p className="list-item-meta" style={{ marginTop: 10 }}>Switch to Manual to drag items into your own order.</p>}
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
  // A category that just repeats the aisle ("Produce · Produce") isn't shown twice.
  const showCategory = kind === 'shopping' && groupBy !== 'category' && item.category && item.category !== item.aisle
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
          {prio && <span className={`prio-dot prio-${prio}`} role="img" aria-label={PRIORITY_LABEL[prio]} />}
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

/** Rows reorderable by dragging their grip (mouse, touch or pen). The grip alone starts a drag, so
 * tapping the row still ticks/opens it and swiping elsewhere still scrolls. The dragged row follows
 * the pointer and a line marks where it will land; dropping reports the new order of these ids.
 * Keyboard: focus the grip, Alt+Up/Down moves the item one place (announced). */
function DragList<T extends { id: string; title: string }>({ items, renderRow, onReorder, locked }: {
  items: T[]
  renderRow: (item: T, handle: React.ReactNode) => React.ReactNode
  onReorder: (ids: string[]) => void
  locked?: () => void // set when the order isn't hand-set: the grip only explains why it won't drag
}) {
  const rowsRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: string; startY: number; dy: number; mids: number[]; from: number; to: number } | null>(null)
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
    setDrag({ id, startY: e.clientY, dy: 0, mids, from, to: from })
  }
  const move = (e: React.PointerEvent) => {
    if (!drag) return
    const y = drag.mids[drag.from] + (e.clientY - drag.startY)
    // Slot = how many other rows' midpoints the dragged row's midpoint is below.
    const to = drag.mids.filter((m, i) => i !== drag.from && m < y).length
    setDrag({ ...drag, dy: e.clientY - drag.startY, to })
  }
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

/** "Stores & categories": rename or remove a store, category or aisle everywhere (every list and
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
  const aisles = override?.store === store ? override.aisles : storeAisles(suggestions, store, aisleOrder)

  const rename = async (field: Field, from: string, to: string | null) => {
    try {
      const { updated } = await api.renameListValue({ field, from, to, ...(field === 'aisle' ? { store } : {}) })
      announce(to ? `Renamed ${from} to ${to}${updated ? `, ${updated} item${updated === 1 ? '' : 's'} updated` : ''}` : `Removed ${from}`)
      setEditing(null); setOverride(null); onChanged()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save', true) }
  }
  const remove = async (field: Field, value: string) => {
    if (!await dialog.confirm({ title: `Remove "${value}"?`, body: `Items that use it keep everything else; this ${field} is cleared from them and forgotten.`, confirmLabel: 'Remove', danger: true })) return
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
    <Sheet title="Stores & categories" onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <p className="field-hint">Renaming changes every item that uses the name, on every list. Removing clears it from those items.</p>
      <h3 className="manage-head">Stores</h3>
      {suggestions.stores.length ? suggestions.stores.map(v => row('store', v)) : <p className="list-item-meta">No stores yet. Pick one on an item.</p>}
      <h3 className="manage-head">Categories</h3>
      {suggestions.categories.length ? suggestions.categories.map(v => row('category', v)) : <p className="list-item-meta">No categories yet.</p>}
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
    </Sheet>
  )
}

function ListDetailPane({ listId, isPhone, onBack, onArchivedOrDeleted, onLoaded }: {
  listId: string; isPhone: boolean; onBack: () => void; onArchivedOrDeleted: () => void; onLoaded: (list: List) => void
}) {
  const { members, toast, refreshTick } = useApp()
  const [detail, setDetail] = useState<ListDetail | null>(null)
  const [error, setError] = useState(false)
  const [editItem, setEditItem] = useState<ListItem | null>(null)
  const [editList, setEditList] = useState(false)
  const [reorderGroups, setReorderGroups] = useState(false)
  const [sorting, setSorting] = useState(false)
  const [managing, setManaging] = useState(false)
  const [showDone, setShowDone] = useState(false)
  const [selectedStore, setSelectedStore] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const { upcoming, byId } = useEventWindow(refreshTick)

  const load = () => api.getList(listId).then(d => { setDetail(d); setError(false); onLoaded(d.list) }).catch(() => setError(true))
  useEffect(() => { setSelectedStore(null); setShowDone(false) }, [listId])

  // Checkout / Reset: the checked items go (or uncheck) at once on screen, and the server hears about
  // it after a few seconds unless Undo is tapped. Leaving the list sends it straight away.
  const [checkout, setCheckout] = useState<{ ids: string[]; reset: boolean } | null>(null)
  const pendingCheckout = useRef<(() => void) | null>(null)
  const checkoutTimer = useRef<ReturnType<typeof setTimeout>>()
  const commitCheckout = () => { clearTimeout(checkoutTimer.current); const run = pendingCheckout.current; pendingCheckout.current = null; run?.() }
  useEffect(() => commitCheckout, [listId]) // eslint-disable-line react-hooks/exhaustive-deps
  const startCheckout = (checked: ListItem[], kind: ListKind) => {
    if (!checked.length) return
    commitCheckout()
    const ids = checked.map(i => i.id), reset = kind === 'reusable'
    setCheckout({ ids, reset })
    pendingCheckout.current = async () => {
      try { await (reset ? api.resetList(listId, ids) : api.clearListCompleted(listId, ids)) }
      catch (e) { toast(e instanceof ApiError ? e.message : reset ? 'Could not reset the list' : 'Could not clear checked items', true) }
      setCheckout(null); load()
    }
    checkoutTimer.current = setTimeout(commitCheckout, 5000)
  }
  const undoCheckout = () => { clearTimeout(checkoutTimer.current); pendingCheckout.current = null; setCheckout(null); announce('Undone') }
  useEffect(() => { load() }, [listId, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps
  // Adds, ticks, edits and deletes are queued (api.queue*): shown at once, sent in order, kept
  // offline. A refresh after they sync clears their pending mark (App bumps refreshTick).
  const showQueued = (op: Op | null) => { if (op) setDetail(d => d && applyListOps(d, [op])); else load() }

  const addItem = async () => {
    const title = draft.trim()
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

  if (error) return <div className="list-detail"><div className="state-card">Couldn't load this list.</div></div>
  if (!detail) return <div className="list-detail"><div className="state-card">Loading…</div></div>

  const { list, groups, suggestions } = detail
  const aisleOrder = aisleOrderMap(detail)
  // A pending Checkout shows as done already: those items gone (or unchecked, for a Reset).
  const items = !checkout ? detail.items
    : checkout.reset ? detail.items.map(i => (checkout.ids.includes(i.id) ? { ...i, done: false } : i))
    : detail.items.filter(i => !checkout.ids.includes(i.id))
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

  const siblingIds = items.slice().sort((a, b) => a.sort - b.sort).map(i => i.id)

  return (
    <div className="list-detail">
      <div className="list-detail-header">
        {isPhone && <button className="icon-btn" onClick={onBack} aria-label="Back to lists"><ChevronLeft width={20} height={20} /></button>}
        <div className="list-detail-emoji" aria-hidden="true">{list.emoji || '📝'}</div>
        <div className="list-detail-title">
          <h2 className="list-detail-name">{list.name}</h2>
          <div className="list-detail-sub">{KIND_LABEL[list.kind]} · {countLabel(list)}</div>
        </div>
        <button className="btn btn-secondary" onClick={() => setEditList(true)} aria-label={`Edit list ${list.name}`}>Edit</button>
      </div>

      <div className="list-add-bar">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addItem() }}
          placeholder={list.kind === 'shopping' ? 'Add an item…' : 'Add something…'}
          aria-label={`Add to ${list.name}`}
          enterKeyHint="done"
        />
        <button className="icon-btn" onClick={addItem} disabled={!draft.trim()} aria-label="Add item"><PlusIcon width={20} height={20} /></button>
      </div>

      <div className="list-toolbar">
        {list.kind === 'shopping' && (
          <Segmented className="list-groupby" label="Group by" value={list.groupBy} onChange={setGroupBy}
            options={(['store', 'category', 'aisle', 'none'] as ListGroupBy[]).map(g => ({ key: g, label: GROUP_LABEL[g] }))} />
        )}
        {list.kind === 'shopping' && reorderable && reorderableNames.length > 1 && (
          <button className="link-btn" onClick={() => setReorderGroups(true)}>Reorder {list.groupBy === 'store' ? 'stores' : 'categories'}</button>
        )}
        <button className="chip list-sort-chip" onClick={() => setSorting(true)} aria-haspopup="dialog" aria-label={`Sort: ${SORT_LABEL[list.sortBy]}. Change sort`}>
          <span aria-hidden="true">⇅</span> Sort: {SORT_LABEL[list.sortBy]}
        </button>
      </div>
      {list.kind === 'shopping' && (
        <>
          {stores.length > 0 && (
            <div className="chip-row list-store-chips" role="group" aria-label="Show store">
              <button className={`chip ${selectedStore === null ? 'active' : ''}`} aria-pressed={selectedStore === null} onClick={() => setSelectedStore(null)}>All</button>
              {stores.map(s => <button key={s} className={`chip ${selectedStore === s ? 'active' : ''}`} aria-pressed={selectedStore === s} onClick={() => setSelectedStore(s)}>{s}</button>)}
            </div>
          )}
        </>
      )}

      <div className="list-items scroll-y">
        {items.length === 0 ? (
          <div className="empty-card"><span className="emoji">{list.kind === 'shopping' ? '🛒' : list.kind === 'reusable' ? '🧳' : '📝'}</span>Nothing here yet — add your first item above.</div>
        ) : list.groupBy === 'none' ? (
          openItems.length === 0 ? (
            <div className="empty-card"><span className="emoji">✨</span>All done!</div>
          ) : (
            <DragList items={openItems.slice().sort(cmp)} onReorder={reorderWithin} locked={locked}
              renderRow={(item, handle) => <ItemRow item={item} kind={list.kind} groupBy={list.groupBy} members={members} event={item.eventId ? byId.get(item.eventId) : undefined} onToggle={() => toggle(item)} onOpen={() => setEditItem(item)} handle={handle} />} />
          )
        ) : groupedOpen.length === 0 ? (
          <div className="empty-card"><span className="emoji">✨</span>All done!</div>
        ) : (
          groupedOpen.map(g => (
            <div key={g.name} className="list-group">
              <h3 className="list-group-title" style={{ margin: 0 }}>{g.name}</h3>
              <DragList items={g.items} onReorder={reorderWithin} locked={locked}
                renderRow={(item, handle) => <ItemRow item={item} kind={list.kind} groupBy={list.groupBy} members={members} event={item.eventId ? byId.get(item.eventId) : undefined} onToggle={() => toggle(item)} onOpen={() => setEditItem(item)} handle={handle} />} />
            </div>
          ))
        )}

        {doneItems.length > 0 && (
          <div className="list-done-section">
            {/* Clear/Reset only matter once something is checked, so they live here rather than
                in a permanent footer that cost a phone a row of items. */}
            <div className="list-done-head">
              <button className="list-done-toggle" onClick={() => setShowDone(s => !s)} aria-expanded={showDone}><span aria-hidden="true">{showDone ? '▾' : '▸'}</span> Done ({doneItems.length})</button>
              <button className="link-btn" onClick={() => startCheckout(doneItems, list.kind)}>{list.kind === 'reusable' ? 'Reset list' : 'Clear checked'}</button>
            </div>
            {showDone && doneItems.slice().sort((a, b) => a.sort - b.sort).map(item => (
              <ItemRow key={item.id} item={item} kind={list.kind} groupBy={list.groupBy} members={members} event={item.eventId ? byId.get(item.eventId) : undefined} onToggle={() => toggle(item)} onOpen={() => setEditItem(item)} />
            ))}
          </div>
        )}

        {/* Mid-shop: checked items stay crossed off in place; one tap clears (or resets) them all. */}
        {keep && checked.length > 0 && (
          <div className="list-checkout-bar">
            <button className="btn btn-primary list-checkout-btn" onClick={() => startCheckout(checked, list.kind)}>
              {checkoutLabel} ({checked.length})
            </button>
          </div>
        )}
      </div>

      {checkout && (
        <div className="toast list-undo-toast" role="status">
          <span>{checkout.reset ? `Reset ${checkout.ids.length} item${checkout.ids.length === 1 ? '' : 's'}` : list.kind === 'shopping' ? `Checked out ${checkout.ids.length} item${checkout.ids.length === 1 ? '' : 's'}` : `Cleared ${checkout.ids.length} item${checkout.ids.length === 1 ? '' : 's'}`}</span>
          <button className="list-undo-btn" onClick={undoCheckout}>Undo</button>
        </div>
      )}


      {editItem && (
        <ItemEditSheet listId={listId} item={editItem} kind={list.kind} manual={manual} members={members} suggestions={suggestions} aisleOrder={aisleOrder} siblingIds={siblingIds} upcoming={upcoming} byId={byId}
          onClose={() => { setEditItem(null); load() }} onSaved={() => { setEditItem(null); load() }} />
      )}
      {editList && (
        <ListEditSheet list={list} onClose={() => setEditList(false)} onManage={() => { setEditList(false); setManaging(true) }}
          onSaved={() => { setEditList(false); load(); onArchivedOrDeleted() }}
          onDeleted={() => { setEditList(false); onArchivedOrDeleted() }} />
      )}
      {sorting && <SortSheet value={list.sortBy} kind={list.kind} onChange={setSortBy} onClose={() => setSorting(false)} />}
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
  const { members, refreshTick, focusMemberId, focusShowsShared } = useApp()
  const isPhone = useIsPhone()
  const [allLists, setLists] = useState<List[]>([])
  // A display pinned to one member shows that member's lists (and the family's, unless hidden).
  // Fetched with archived ones included; they only show in the collapsed "Archived" section.
  const visible = useMemo(() => focusMemberId ? allLists.filter(l => l.memberIds.includes(focusMemberId) || (focusShowsShared && l.memberIds.length === 0)) : allLists,
    [allLists, focusMemberId, focusShowsShared])
  const lists = useMemo(() => visible.filter(l => !l.archived), [visible])
  const archived = useMemo(() => visible.filter(l => l.archived), [visible])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  // #/lists?list=<id> (a tap in a member's snapshot): open that list.
  const listParam = () => new URLSearchParams(location.hash.split('?')[1] || '').get('list')
  const [selectedId, setSelectedId] = useState<string | null>(listParam)
  const [editList, setEditList] = useState<List | 'new' | null>(null)
  useEffect(() => {
    const read = () => {
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
    if (gone || (!selectedId && !isPhone)) setSelectedId(isPhone ? null : lists[0]?.id ?? null)
  }, [lists, loading, selectedId, isPhone])

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
      {lists.map(l => (
        <ListCard key={l.id} list={l} active={selectedId === l.id} members={members} onSelect={() => setSelectedId(l.id)} onEdit={() => setEditList(l)} />
      ))}
      <button className="btn btn-secondary btn-block list-new-btn" onClick={() => setEditList('new')}><PlusIcon width={18} height={18} /> New list</button>
      <ArchivedLists lists={archived} onChanged={load} />
    </div>
  )

  return (
    <div className="content lists-content">
      {isPhone ? (
        selectedId ? (
          <ListDetailPane listId={selectedId} isPhone onBack={() => setSelectedId(null)} onArchivedOrDeleted={() => { setSelectedId(null); load() }} onLoaded={syncCard} />
        ) : (
          <div className="lists-shell lists-shell-phone">{cards}</div>
        )
      ) : (
        <div className="lists-shell">
          {cards}
          {selectedId
            ? <ListDetailPane listId={selectedId} isPhone={false} onBack={() => setSelectedId(null)} onArchivedOrDeleted={() => { setSelectedId(null); load() }} onLoaded={syncCard} />
            : <div className="list-detail list-detail-empty"><div className="empty-card"><span className="emoji">👈</span>Pick a list to open it.</div></div>}
        </div>
      )}
      {editList && <ListEditSheet list={editList} onClose={() => setEditList(null)} onSaved={() => { setEditList(null); load() }} onDeleted={() => { setEditList(null); load() }} />}
    </div>
  )
}
