// Chores → Library (parent devices): saved chores that aren't on a schedule, due-ish ones on top.
// Tap one → who → when → it's a normal one-off chore; "Again" hands it to the last person today;
// "Make it repeat" opens the chore editor with it filled in.
import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { useApp } from './AppContext.tsx'
import { api, ApiError } from './api.ts'
import type { LibraryChore, LibraryUnit, List } from './types.ts'
import { MEMBER_EMOJI } from './types.ts'
import { dateKey } from './date.ts'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isSingleEmoji } from './emoji.ts'
import { useDialog } from './dialog.tsx'
import { libraryStatus, sortLibrary, whenDate, type WhenPick } from './choreLibrary.ts'
import { Face } from './Face'

/** What "Make it repeat" hands the chore editor. */
export type RepeatDraft = { item: LibraryChore; memberId: string | null; date: string }

export function ChoreLibrarySheet({ onClose, onAssigned, onRepeat }: { onClose: () => void; onAssigned: (date: string) => void; onRepeat: (d: RepeatDraft) => void }) {
  const { members, toast, refreshTick } = useApp()
  const [items, setItems] = useState<LibraryChore[] | null>(null)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<LibraryChore | null>(null)
  const [editing, setEditing] = useState<LibraryChore | 'new' | null>(null)
  const load = () => api.getChoreLibrary().then(setItems).catch(() => setItems([]))
  useEffect(() => { void load() }, [refreshTick])
  const today = dateKey(new Date())
  const nameOf = (id: string | null) => (id ? members.find(m => m.id === id)?.name ?? 'someone' : 'Anyone')
  const rows = useMemo(() => {
    const q = query.trim().toLocaleLowerCase()
    return sortLibrary((items ?? []).filter(i => !q || i.title.toLocaleLowerCase().includes(q) || i.notes?.toLocaleLowerCase().includes(q)), today)
  }, [items, query, today])

  const again = async (item: LibraryChore) => {
    try {
      await api.assignLibraryChore(item.id, { date: today, memberId: item.lastMemberId })
      toast(`Added: ${item.title} for ${nameOf(item.lastMemberId)} today`)
      onAssigned(today); void load()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add the chore', true) }
  }

  if (editing) return <LibraryEditSheet item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setPicked(null); void load() }} />
  if (picked) return <AssignSheet item={picked} onBack={() => setPicked(null)} onEdit={() => setEditing(picked)}
    onAssigned={date => { setPicked(null); onAssigned(date); void load() }} onRepeat={onRepeat} />

  return (
    <Sheet title="Chore library" onClose={onClose}
      actions={<button className="btn btn-primary" onClick={() => setEditing('new')}>New library chore</button>}>
      <p className="settings-row-sub lib-intro">Jobs that don't fit a schedule. Tap one to hand it out.</p>
      {(items?.length ?? 0) > 5 && (
        <div className="field"><input type="search" aria-label="Search the library" placeholder="Search the library" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" /></div>
      )}
      {items === null ? <p className="settings-row-sub">Loading…</p>
        : items.length === 0 ? <div className="empty-card"><span className="emoji">🧰</span>Nothing saved yet. Add a job you do now and then, or save one from a chore's More… menu.</div>
        : rows.length === 0 ? <p className="settings-row-sub">Nothing matches "{query}".</p>
        : (
          <ul className="lib-list">
            {rows.map(({ item, dueIsh }) => (
              <li key={item.id} className="lib-row">
                <button type="button" className="sheet-link lib-pick" onClick={() => setPicked(item)}>
                  <span className="lib-emoji" aria-hidden="true">{item.emoji ?? '⭐'}</span>
                  <span>
                    {item.title}
                    <small>{item.points} pts · {libraryStatus(item, today, nameOf)}</small>
                    {dueIsh && <small className="lib-due">⏰ Due-ish</small>}
                  </span>
                </button>
                {item.timesAssigned > 0 && !item.open && (
                  <button type="button" className="btn btn-secondary lib-again" onClick={() => again(item)} aria-label={`Again: ${item.title} for ${nameOf(item.lastMemberId)} today`}>Again</button>
                )}
              </li>
            ))}
          </ul>
        )}
    </Sheet>
  )
}

const WHEN: [WhenPick | 'date', string][] = [['today', 'Today'], ['tomorrow', 'Tomorrow'], ['weekend', 'This weekend'], ['date', 'Pick a date']]

function AssignSheet({ item, onBack, onEdit, onAssigned, onRepeat }: { item: LibraryChore; onBack: () => void; onEdit: () => void; onAssigned: (date: string) => void; onRepeat: (d: RepeatDraft) => void }) {
  const { members, toast } = useApp()
  const [memberId, setMemberId] = useState<string | null>(item.timesAssigned ? item.lastMemberId : item.memberId)
  const [when, setWhen] = useState<WhenPick | 'date'>('today')
  const [date, setDate] = useState(dateKey(new Date()))
  const day = when === 'date' ? date : whenDate(when)
  const who = members.find(m => m.id === memberId)

  const assign = async () => {
    try {
      await api.assignLibraryChore(item.id, { date: day, memberId })
      toast(`Added: ${item.title} for ${who?.name ?? 'anyone'}, ${format(new Date(`${day}T00:00:00`), 'EEE, MMM d')}`)
      onAssigned(day)
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add the chore', true) }
  }

  return (
    <Sheet title={`${item.emoji ?? '⭐'} ${item.title}`} onClose={onBack}
      actions={
        <>
          <select className="settings-select actions-select" aria-label="Library chore actions" value="" onChange={e => { if (e.target.value === 'repeat') onRepeat({ item, memberId, date: day }); if (e.target.value === 'edit') onEdit() }}>
            <option value="" disabled hidden>More…</option>
            <option value="repeat">Make it repeat…</option>
            <option value="edit">Edit library chore…</option>
          </select>
          <button className="btn btn-primary" onClick={assign}>Add chore</button>
        </>
      }>
      <p className="settings-row-sub lib-intro">{item.points} pts{item.listId ? ' · with its checklist' : ''}{item.notes ? ` · ${item.notes}` : ''}</p>
      <div className="field">
        <label id="lib-who">Who</label>
        <div className="who-grid" role="group" aria-labelledby="lib-who">
          {members.map(m => (
            <button key={m.id} type="button" className={`who-btn ${memberId === m.id ? 'active' : ''}`} aria-pressed={memberId === m.id} onClick={() => setMemberId(m.id)}>
              <Face m={m} className="who-avatar" aria-hidden="true" />
              {m.name}
            </button>
          ))}
          <button type="button" className={`who-btn ${memberId === null ? 'active' : ''}`} aria-pressed={memberId === null} onClick={() => setMemberId(null)}>
            <span className="who-avatar" aria-hidden="true" style={{ background: 'var(--bg)' }}>🌟</span>
            Anyone
          </button>
        </div>
      </div>
      <div className="field">
        <label htmlFor="lib-when">When</label>
        <select id="lib-when" value={when} onChange={e => setWhen(e.target.value as WhenPick | 'date')}>
          {WHEN.map(([v, label]) => <option key={v} value={v}>{label}{v !== 'date' ? ` (${format(new Date(`${whenDate(v)}T00:00:00`), 'EEE, MMM d')})` : ''}</option>)}
        </select>
        {when === 'date' && <input type="date" aria-label="Date" value={date} min={dateKey(new Date())} onChange={e => setDate(e.target.value || dateKey(new Date()))} style={{ marginTop: 8 }} />}
      </div>
    </Sheet>
  )
}

const UNITS: [LibraryUnit, string][] = [['day', 'days'], ['week', 'weeks'], ['month', 'months']]

/** Add or edit a library chore. Saving doesn't change chores already handed out. */
export function LibraryEditSheet({ item, onClose, onSaved }: { item: LibraryChore | null; onClose: () => void; onSaved: () => void }) {
  const { members, toast } = useApp()
  const dialog = useDialog()
  const [title, setTitle] = useState(item?.title ?? '')
  const [emoji, setEmoji] = useState(item?.emoji ?? MEMBER_EMOJI[0])
  const [points, setPoints] = useState(item?.points ?? 10)
  const [memberId, setMemberId] = useState<string | null>(item?.memberId ?? null)
  const [listId, setListId] = useState<string | null>(item?.listId ?? null)
  const [lists, setLists] = useState<List[]>([])
  useEffect(() => { api.getLists().then(setLists).catch(() => { /* picker just stays empty */ }) }, [])
  const [everyN, setEveryN] = useState(item?.everyN ?? 1)
  const [unit, setUnit] = useState<LibraryUnit | ''>(item?.everyUnit ?? '')
  const [needsApproval, setNeedsApproval] = useState<boolean | null>(item?.needsApproval ?? null)
  const [notes, setNotes] = useState(item?.notes ?? '')
  const ok = !!title.trim() && isSingleEmoji(emoji)

  const save = async () => {
    if (!ok) return
    const body = { title: title.trim(), emoji, points, memberId, listId, everyN: unit ? Math.max(1, everyN) : null, everyUnit: unit || null, needsApproval, notes: notes.trim() || null }
    try {
      if (item) await api.updateLibraryChore(item.id, body)
      else await api.createLibraryChore(body)
      toast(`Saved: ${body.title}`); onSaved()
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save', true) }
  }
  const remove = async () => {
    if (!item || !await dialog.confirm({ title: `Remove "${item.title}" from the library?`, body: 'Chores already handed out stay.', confirmLabel: 'Remove', danger: true })) return
    try { await api.deleteLibraryChore(item.id); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not remove it', true) }
  }

  return (
    <Sheet title={item ? 'Edit library chore' : 'New library chore'} onClose={onClose}
      actions={
        <>
          {item && <select className="settings-select actions-select" aria-label="Library chore actions" value="" onChange={e => { if (e.target.value === 'delete') void remove() }}>
            <option value="" disabled hidden>More…</option>
            <option value="delete">Remove from library…</option>
          </select>}
          <button className="btn btn-primary" onClick={save} disabled={!ok}>Save</button>
        </>
      }>
      <div className="field">
        <label htmlFor="lib-title">Title</label>
        <input id="lib-title" type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Clean out the car" autoComplete="off" autoFocus={!item} />
      </div>
      <div className="field">
        <label>Emoji</label>
        <div className="emoji-swatch-row">
          {['🚗', '🪟', '🧊', '🛏️', '🧰', '🍂', '🧽', '🛁'].map(e => (
            <button key={e} type="button" className={`emoji-swatch ${emoji === e ? 'active' : ''}`} aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>
          ))}
        </div>
        <AnyEmojiField value={emoji} onChange={setEmoji} />
      </div>
      <div className="field">
        <label htmlFor="lib-points">Points</label>
        <input id="lib-points" type="text" inputMode="numeric" value={points} onChange={e => setPoints(Number(e.target.value.replace(/\D/g, '')) || 0)} />
      </div>
      <div className="field">
        <label htmlFor="lib-every">About every (optional)</label>
        <div className="lib-every">
          {unit && <input id="lib-every-n" type="number" inputMode="numeric" min={1} max={365} aria-label="How many" value={everyN} onChange={e => setEveryN(Math.min(365, Number(e.target.value.replace(/\D/g, '')) || 0))} onBlur={() => setEveryN(n => Math.max(1, n))} />}
          <select id="lib-every" value={unit} onChange={e => setUnit(e.target.value as LibraryUnit | '')}>
            <option value="">No set time</option>
            {UNITS.map(([u, label]) => <option key={u} value={u}>{label}</option>)}
          </select>
        </div>
        <p className="field-hint">Not a schedule: once it's been about that long, it moves to the top of the library.</p>
      </div>
      <div className="field">
        <label htmlFor="lib-member">Usually goes to</label>
        <select id="lib-member" value={memberId ?? ''} onChange={e => setMemberId(e.target.value || null)}>
          <option value="">Anyone</option>
          {members.map(m => <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="lib-checklist">Checklist (optional)</label>
        <select id="lib-checklist" value={listId ?? ''} onChange={e => setListId(e.target.value || null)}>
          <option value="">None</option>
          {lists.filter(l => !l.archived || l.id === listId).map(l => <option key={l.id} value={l.id}>{l.emoji ? `${l.emoji} ` : ''}{l.name}{l.kind === 'reusable' ? '' : ` (${l.kind})`}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="lib-approval">Needs a parent's OK</label>
        <select id="lib-approval" value={needsApproval === null ? 'default' : needsApproval ? 'yes' : 'no'} onChange={e => setNeedsApproval(e.target.value === 'default' ? null : e.target.value === 'yes')}>
          <option value="default">Default (the person's setting)</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="lib-notes">Notes (optional)</label>
        <textarea id="lib-notes" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Vacuum the mats too" />
      </div>
    </Sheet>
  )
}
