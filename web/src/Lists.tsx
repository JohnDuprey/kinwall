import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { useApp } from './AppContext.tsx'
import { api, ApiError } from './api.ts'
import type { List, ListDetail, ListGroupBy, ListItem, ListKind, Member } from './types.ts'
import { LIST_EMOJI, MEMBER_PALETTE } from './types.ts'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { MemberPicker } from './MemberPicker.tsx'
import { isSingleEmoji } from './emoji.ts'
import { inkFor } from './color.ts'
import { useIsPhone } from './useIsPhone.ts'
import { ChevronLeft, PlusIcon, TrashIcon } from './icons.tsx'

const KIND_LABEL: Record<ListKind, string> = { todo: 'To-do', shopping: 'Shopping', reusable: 'Reusable' }

/** "3 left" / "All done" summary shown on a list card, per SPEC. */
function countLabel(list: List) {
  if (list.itemCount === 0) return 'Empty'
  if (list.openCount === 0) return 'All done'
  return `${list.openCount} left`
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
  return (
    <div className={`list-card ${active ? 'active' : ''}`}
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

function ListEditSheet({ list, onClose, onSaved, onDeleted }: {
  list: List | 'new'; onClose: () => void; onSaved: () => void; onDeleted: () => void
}) {
  const { members, toast } = useApp()
  const existing = list === 'new' ? null : list
  const [name, setName] = useState(existing?.name ?? '')
  const [kind, setKind] = useState<ListKind>(existing?.kind ?? 'todo')
  const [emoji, setEmoji] = useState(existing?.emoji ?? LIST_EMOJI[0])
  const [color, setColor] = useState(existing?.color ?? MEMBER_PALETTE[0])
  const [memberIds, setMemberIds] = useState<string[]>(existing?.memberIds ?? [])

  const submit = async () => {
    if (!name.trim() || !isSingleEmoji(emoji)) return
    const body = { name: name.trim(), kind, emoji, color, memberIds }
    try {
      if (existing) await api.updateList(existing.id, body)
      else await api.createList(body)
      onSaved()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save list') }
  }
  const archive = async () => {
    if (!existing) return
    try { await api.updateList(existing.id, { archived: !existing.archived }); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not archive list') }
  }
  const del = async () => {
    if (!existing) return
    if (!confirm(`Delete "${existing.name}"? This removes all its items too.`)) return
    try { await api.deleteList(existing.id); onDeleted() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete list') }
  }

  return (
    <Sheet title={existing ? 'Edit list' : 'New list'} onClose={onClose}
      actions={
        <>
          {existing && <button className="btn btn-danger" onClick={del} aria-label="Delete"><TrashIcon width={18} height={18} /></button>}
          <button className="btn btn-primary" onClick={submit} disabled={!name.trim() || !isSingleEmoji(emoji)}>{existing ? 'Save' : 'Create list'}</button>
        </>
      }>
      <div className="field">
        <label>Name</label>
        <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="List name" autoComplete="off" autoFocus={!existing} />
      </div>
      <div className="field">
        <label>Kind</label>
        <div className="segmented">
          {(['todo', 'shopping', 'reusable'] as ListKind[]).map(k => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Emoji</label>
        <div className="emoji-swatch-row">
          {LIST_EMOJI.map(e => <button key={e} className={`emoji-swatch ${emoji === e ? 'active' : ''}`} onClick={() => setEmoji(e)}>{e}</button>)}
        </div>
        <AnyEmojiField value={emoji} onChange={setEmoji} />
      </div>
      <div className="field">
        <label>Color</label>
        <div className="color-swatch-row">
          {MEMBER_PALETTE.map(c => <button key={c} className={`color-swatch ${color === c ? 'active' : ''}`} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Color ${c}`} />)}
          <input type="color" className="color-swatch" value={/^#[0-9a-f]{6}$/i.test(color) ? color : '#888888'}
            onChange={e => setColor(e.target.value)} style={{ padding: 0, border: '2px solid var(--border)', cursor: 'pointer' }} aria-label="Custom list color" />
        </div>
      </div>
      <MemberPicker members={members} selected={memberIds} onChange={setMemberIds} label="Owners (nobody = whole family)" />
      {existing && (
        <button className="btn btn-secondary btn-block" onClick={archive}>{existing.archived ? 'Unarchive' : 'Archive'}</button>
      )}
    </Sheet>
  )
}

function ItemEditSheet({ listId, item, kind, members, suggestions, siblingIds, onClose, onSaved }: {
  listId: string; item: ListItem; kind: ListKind; members: Member[]
  suggestions: { stores: string[]; categories: string[] }
  siblingIds: string[] // items in current sort order, for up/down reorder
  onClose: () => void; onSaved: () => void
}) {
  const { toast } = useApp()
  const [title, setTitle] = useState(item.title)
  const [quantity, setQuantity] = useState(item.quantity ?? '')
  const [notes, setNotes] = useState(item.notes ?? '')
  const [store, setStore] = useState(item.store ?? '')
  const [category, setCategory] = useState(item.category ?? '')
  const [memberId, setMemberId] = useState<string | null>(item.memberId)
  const [dueDate, setDueDate] = useState(item.dueDate ?? '')

  const submit = async () => {
    if (!title.trim()) return
    const body = {
      title: title.trim(), quantity: quantity.trim() || null, notes: notes.trim() || null,
      ...(kind === 'shopping' ? { store: store.trim() || null, category: category.trim() || null } : {}),
      // Assignees on to-do and reusable lists (a routine has each person's jobs); due dates are to-do only.
      ...(kind !== 'shopping' ? { memberId } : {}),
      ...(kind === 'todo' ? { dueDate: dueDate || null } : {}),
    }
    try { await api.updateListItem(listId, item.id, body); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save item') }
  }
  const del = async () => {
    if (!confirm(`Delete "${item.title}"?`)) return
    try { await api.deleteListItem(listId, item.id); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete item') }
  }
  const move = async (dir: -1 | 1) => {
    const i = siblingIds.indexOf(item.id)
    if (i < 0) return
    const j = i + dir
    if (j < 0 || j >= siblingIds.length) return
    const next = [...siblingIds]
    ;[next[i], next[j]] = [next[j], next[i]]
    try { await api.reorderListItems(listId, next); onSaved() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not reorder') }
  }

  return (
    <Sheet title="Edit item" onClose={onClose}
      actions={<>
        <button className="btn btn-danger" onClick={del} aria-label="Delete"><TrashIcon width={18} height={18} /></button>
        <button className="btn btn-primary" onClick={submit} disabled={!title.trim()}>Save</button>
      </>}>
      <div className="field">
        <label>Title</label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label>Quantity</label>
        <input type="text" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="e.g. 2, 1 lb, x3" />
      </div>
      {kind === 'shopping' && (
        <>
          <div className="field">
            <label>Store</label>
            <input type="text" list="list-store-suggestions" value={store} onChange={e => setStore(e.target.value)} placeholder="Any store" />
            <datalist id="list-store-suggestions">{suggestions.stores.map(s => <option key={s} value={s} />)}</datalist>
          </div>
          <div className="field">
            <label>Category</label>
            <input type="text" list="list-category-suggestions" value={category} onChange={e => setCategory(e.target.value)} placeholder="e.g. Produce" />
            <datalist id="list-category-suggestions">{suggestions.categories.map(c => <option key={c} value={c} />)}</datalist>
          </div>
        </>
      )}
      {kind !== 'shopping' && (
          <div className="field">
            <label>Assign to</label>
            <div className="chip-row">
              <button className={`chip ${memberId === null ? 'active' : ''}`} onClick={() => setMemberId(null)}>Nobody</button>
              {members.map(m => (
                <button key={m.id} className={`chip ${memberId === m.id ? 'active' : ''}`} style={{ ['--chip-color' as string]: m.color }} onClick={() => setMemberId(m.id)}>{m.avatar} {m.name}</button>
              ))}
            </div>
          </div>
      )}
      {kind === 'todo' && (
          <div className="field">
            <label>Due date</label>
            <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
          </div>
      )}
      <div className="field">
        <label>Notes</label>
        <textarea value={notes} onChange={e => setNotes(e.target.value)} />
      </div>
      <div className="field">
        <label>Order</label>
        <div className="chip-row">
          <button className="btn btn-secondary" onClick={() => move(-1)} disabled={siblingIds.indexOf(item.id) <= 0}>Move up</button>
          <button className="btn btn-secondary" onClick={() => move(1)} disabled={siblingIds.indexOf(item.id) >= siblingIds.length - 1}>Move down</button>
        </div>
      </div>
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
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save order') }
  }
  return (
    <Sheet title={`Reorder ${groupBy === 'store' ? 'stores' : 'categories'}`} onClose={onClose}
      actions={<button className="btn btn-primary" onClick={save}>Save order</button>}>
      {order.map((name, i) => (
        <div key={name} className="settings-row">
          <div className="settings-row-label">{name}</div>
          <div className="chip-row">
            <button className="icon-btn" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">▲</button>
            <button className="icon-btn" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label="Move down">▼</button>
          </div>
        </div>
      ))}
    </Sheet>
  )
}

function ItemRow({ item, kind, groupBy, members, onToggle, onOpen, handle }: {
  item: ListItem; kind: ListKind; groupBy: ListGroupBy; members: Member[]; onToggle: () => void; onOpen: () => void
  handle?: React.ReactNode
}) {
  const assignee = kind !== 'shopping' && item.memberId ? members.find(m => m.id === item.memberId) : null
  const showStore = kind === 'shopping' && groupBy !== 'store' && item.store
  const showCategory = kind === 'shopping' && groupBy !== 'category' && item.category
  return (
    <div className={`list-item-row ${item.done ? 'done' : ''}`}>
      <button className={`list-item-check ${item.done ? 'done' : ''}`} onClick={onToggle} aria-label={item.done ? 'Mark not done' : 'Mark done'} />
      <div className="list-item-body" onClick={onOpen}>
        <div className="list-item-title">{item.title}</div>
        {(showStore || showCategory) && (
          <div className="list-item-meta">{[showStore ? item.store : null, showCategory ? item.category : null].filter(Boolean).join(' · ')}</div>
        )}
      </div>
      {item.quantity && <div className="list-item-chip">{item.quantity}</div>}
      {kind === 'todo' && item.dueDate && <div className="list-item-chip list-item-due">{format(new Date(item.dueDate + 'T00:00:00'), 'EEE, MMM d')}</div>}
      {assignee && <div className="member-avatar-sm" style={{ background: assignee.color, color: inkFor(assignee.color) }}>{assignee.avatar || assignee.name[0]}</div>}
      {handle}
    </div>
  )
}

/** Rows reorderable by dragging their grip (mouse, touch or pen). The grip alone starts a drag, so
 * tapping the row still ticks/opens it and swiping elsewhere still scrolls. The dragged row follows
 * the pointer and a line marks where it will land; dropping reports the new order of these ids. */
function DragList({ items, renderRow, onReorder }: {
  items: ListItem[]
  renderRow: (item: ListItem, handle: React.ReactNode) => React.ReactNode
  onReorder: (ids: string[]) => void
}) {
  const rowsRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<{ id: string; startY: number; dy: number; mids: number[]; from: number; to: number } | null>(null)

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
        const handle = (
          <button className="list-item-grip" aria-label={`Drag to reorder ${item.title}`}
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

/** Groups open items by list.groupBy (store/category), ordered by the saved ListGroup order then
 * alphabetically, with null-valued items last under "Other". Sub-orders store groups by category,
 * per SPEC. Returns [] (flat) when groupBy is 'none'. */
function groupItems(items: ListItem[], groupBy: ListGroupBy, savedOrder: string[]): { name: string; items: ListItem[] }[] {
  if (groupBy === 'none') return []
  const field = groupBy === 'store' ? 'store' : 'category'
  const byName = new Map<string, ListItem[]>()
  for (const item of items) {
    const name = (item[field] as string | null) ?? OTHER_GROUP
    if (!byName.has(name)) byName.set(name, [])
    byName.get(name)!.push(item)
  }
  if (groupBy === 'store') {
    for (const list of byName.values()) list.sort((a, b) => (a.category ?? '￿').localeCompare(b.category ?? '￿') || a.sort - b.sort)
  }
  const names = [...byName.keys()]
  names.sort((a, b) => {
    if (a === OTHER_GROUP) return 1
    if (b === OTHER_GROUP) return -1
    const ia = savedOrder.indexOf(a), ib = savedOrder.indexOf(b)
    if (ia >= 0 && ib >= 0) return ia - ib
    if (ia >= 0) return -1
    if (ib >= 0) return 1
    return a.localeCompare(b)
  })
  return names.map(name => ({ name, items: byName.get(name)! }))
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
  const [showDone, setShowDone] = useState(false)
  const [selectedStore, setSelectedStore] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const load = () => api.getList(listId).then(d => { setDetail(d); setError(false); onLoaded(d.list) }).catch(() => setError(true))
  useEffect(() => { setSelectedStore(null); setShowDone(false); load() }, [listId, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const addItem = async () => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    try { await api.addListItems(listId, { title }); load() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add item') }
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
    setDetail({ ...detail, items: detail.items.map(i => ({ ...i, sort: order.indexOf(i.id) })) })
    try { await api.reorderListItems(listId, order) }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not reorder'); load() }
  }

  const toggle = async (item: ListItem) => {
    try { await api.updateListItem(listId, item.id, { done: !item.done }); load() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update item') }
  }

  const clearChecked = async () => {
    try { await api.clearListCompleted(listId); load() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not clear checked items') }
  }
  const reset = async () => {
    try { await api.resetList(listId); load() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not reset list') }
  }
  const setGroupBy = async (groupBy: ListGroupBy) => {
    try { await api.updateList(listId, { groupBy }); load() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not change grouping') }
  }

  if (error) return <div className="list-detail"><div className="state-card">Couldn't load this list.</div></div>
  if (!detail) return <div className="list-detail"><div className="state-card">Loading…</div></div>

  const { list, items, groups, suggestions } = detail
  const stores = [...new Set(items.map(i => i.store).filter((v): v is string => !!v))].sort()
  const filtered = selectedStore ? items.filter(i => i.store === selectedStore || i.store === null) : items
  const openItems = filtered.filter(i => !i.done)
  const doneItems = filtered.filter(i => i.done)
  const groupNamesForOrder = groups.filter(g => g.kind === list.groupBy).sort((a, b) => a.sort - b.sort).map(g => g.name)
  const groupedOpen = groupItems(openItems, list.groupBy, groupNamesForOrder)
  const reorderableNames = [...new Set(items.map(i => (list.groupBy === 'store' ? i.store : i.category)).filter((v): v is string => !!v))]

  const siblingIds = items.slice().sort((a, b) => a.sort - b.sort).map(i => i.id)

  return (
    <div className="list-detail">
      <div className="list-detail-header">
        {isPhone && <button className="icon-btn" onClick={onBack} aria-label="Back"><ChevronLeft width={20} height={20} /></button>}
        <div className="list-detail-emoji">{list.emoji || '📝'}</div>
        <div className="list-detail-title">
          <div className="list-detail-name">{list.name}</div>
          <div className="list-detail-sub">{KIND_LABEL[list.kind]} · {countLabel(list)}</div>
        </div>
        <button className="btn btn-secondary" onClick={() => setEditList(true)}>Edit</button>
      </div>

      <div className="list-add-bar">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addItem() }}
          placeholder={list.kind === 'shopping' ? 'Add an item…' : 'Add something…'}
          enterKeyHint="done"
        />
        <button className="icon-btn" onClick={addItem} aria-label="Add item"><PlusIcon width={20} height={20} /></button>
      </div>

      {list.kind === 'shopping' && (
        <>
          <div className="list-toolbar">
            <div className="segmented list-groupby">
              {(['store', 'category', 'none'] as ListGroupBy[]).map(g => (
                <button key={g} className={list.groupBy === g ? 'active' : ''} onClick={() => setGroupBy(g)}>{g === 'store' ? 'Store' : g === 'category' ? 'Category' : 'None'}</button>
              ))}
            </div>
            {list.groupBy !== 'none' && reorderableNames.length > 1 && (
              <button className="link-btn" onClick={() => setReorderGroups(true)}>Reorder</button>
            )}
          </div>
          {stores.length > 0 && (
            <div className="chip-row list-store-chips">
              <button className={`chip ${selectedStore === null ? 'active' : ''}`} onClick={() => setSelectedStore(null)}>All</button>
              {stores.map(s => <button key={s} className={`chip ${selectedStore === s ? 'active' : ''}`} onClick={() => setSelectedStore(s)}>{s}</button>)}
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
            <DragList items={openItems.slice().sort((a, b) => a.sort - b.sort)} onReorder={reorderWithin}
              renderRow={(item, handle) => <ItemRow item={item} kind={list.kind} groupBy={list.groupBy} members={members} onToggle={() => toggle(item)} onOpen={() => setEditItem(item)} handle={handle} />} />
          )
        ) : groupedOpen.length === 0 ? (
          <div className="empty-card"><span className="emoji">✨</span>All done!</div>
        ) : (
          groupedOpen.map(g => (
            <div key={g.name} className="list-group">
              <div className="list-group-title">{g.name}</div>
              <DragList items={g.items} onReorder={reorderWithin}
                renderRow={(item, handle) => <ItemRow item={item} kind={list.kind} groupBy={list.groupBy} members={members} onToggle={() => toggle(item)} onOpen={() => setEditItem(item)} handle={handle} />} />
            </div>
          ))
        )}

        {doneItems.length > 0 && (
          <div className="list-done-section">
            {/* Clear/Reset only matter once something is checked, so they live here rather than
                in a permanent footer that cost a phone a row of items. */}
            <div className="list-done-head">
              <button className="list-done-toggle" onClick={() => setShowDone(s => !s)}>{showDone ? '▾' : '▸'} Done ({doneItems.length})</button>
              {list.kind === 'reusable'
                ? <button className="link-btn" onClick={reset}>Reset list</button>
                : <button className="link-btn" onClick={clearChecked}>Clear checked</button>}
            </div>
            {showDone && doneItems.slice().sort((a, b) => a.sort - b.sort).map(item => (
              <ItemRow key={item.id} item={item} kind={list.kind} groupBy={list.groupBy} members={members} onToggle={() => toggle(item)} onOpen={() => setEditItem(item)} />
            ))}
          </div>
        )}
      </div>


      {editItem && (
        <ItemEditSheet listId={listId} item={editItem} kind={list.kind} members={members} suggestions={suggestions} siblingIds={siblingIds}
          onClose={() => setEditItem(null)} onSaved={() => { setEditItem(null); load() }} />
      )}
      {editList && (
        <ListEditSheet list={list} onClose={() => setEditList(false)}
          onSaved={() => { setEditList(false); load(); onArchivedOrDeleted() }}
          onDeleted={() => { setEditList(false); onArchivedOrDeleted() }} />
      )}
      {reorderGroups && list.groupBy !== 'none' && (
        <ReorderGroupsSheet listId={listId} groupBy={list.groupBy} names={groupNamesForOrder.length ? groupNamesForOrder.filter(n => reorderableNames.includes(n)).concat(reorderableNames.filter(n => !groupNamesForOrder.includes(n))) : reorderableNames}
          onClose={() => setReorderGroups(false)} onSaved={() => { setReorderGroups(false); load() }} />
      )}
    </div>
  )
}

export default function Lists() {
  const { members, refreshTick } = useApp()
  const isPhone = useIsPhone()
  const [lists, setLists] = useState<List[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editList, setEditList] = useState<List | 'new' | null>(null)

  const load = () => {
    setLoading(true)
    api.getLists().then(l => { setLists(l); setError(false) }).catch(() => setError(true)).finally(() => setLoading(false))
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

  if (!loading && lists.length === 0) {
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
