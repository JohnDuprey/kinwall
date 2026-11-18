// The quick-capture inbox, at the top of a parent's screen (App.tsx Header, lazy): jot a thought
// down, then later make it a task, an event or a note on the family board. The server keeps it
// (routes/inbox.ts) and makes what it becomes; inbox.ts has the screen's state and rules.
import { useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import { EventEditSheet } from './Calendar.tsx'
import { relTime } from './NotesThread.tsx'
import { ChevronRight, InboxIcon } from './icons.tsx'
import { formatDate, msg, t, tm, tn } from './i18n.ts'
import { cleaned, cleared, createInboxStore, openItems, organize, suggest, upsert, whereHref, ymd, type InboxItem, type InboxKind, type InboxSort, type InboxTarget } from './inbox.ts'
import type { CalendarEntry, EventInstance, List } from './types.ts'

const store = createInboxStore({ items: [], saving: [] })
const useInbox = () => useSyncExternalStore(store.subscribe, store.get)
const reload = () => api.getInbox().then(({ items }) => store.set({ ...store.get(), items }))
const keep = (item: InboxItem) => store.set(upsert(store.get(), item))
const failed = (e: unknown, fallback: string) => e instanceof ApiError ? e.message : fallback

const KINDS: { key: InboxKind; label: string }[] = [
  { key: 'task', label: msg('A task on a list') },
  { key: 'event', label: msg('An event on the calendar') },
  { key: 'note', label: msg('A note on the family board') },
]
const localDay = (day: string) => new Date(day + 'T00:00:00')
const plusDays = (day: string, n: number) => { const d = localDay(day); d.setDate(d.getDate() + n); return ymd(d) }
const todayYmd = () => ymd(new Date())
const longDay = (day: string) => formatDate(localDay(day), { weekday: 'long', month: 'short', day: 'numeric' })

function whereText(w: InboxTarget): string {
  if (!w.id) return t('Didn’t finish saving. Put it back to try again.')
  return w.kind === 'task' ? t('Went to the {list} list', { list: w.label ?? '' }) : w.kind === 'event' ? t('Went to the calendar') : t('Went to the family board')
}

/** The header's Inbox button (beside the bell, on every screen), with how many thoughts are waiting:
 * a quiet count, not the bell's red, since nothing in it is urgent. */
export default function InboxButton() {
  const { parentDevice, settings, refreshTick } = useApp()
  const waiting = openItems(useInbox()).length
  const [open, setOpen] = useState(false)
  const on = parentDevice && settings.features.inbox !== false
  useEffect(() => { if (on) reload().catch(() => {}) }, [on, refreshTick]) // and when another device changes it
  if (!on) return null
  return <>
    <button type="button" className="icon-btn header-inbox" aria-haspopup="dialog" onClick={() => setOpen(true)}
      aria-label={waiting ? tn(waiting, 'Inbox: {n} thing to sort', 'Inbox: {n} things to sort') : t('Inbox')}>
      <InboxIcon />{waiting > 0 && <span className="bell-badge inbox-badge" aria-hidden="true">{waiting > 9 ? '9+' : waiting}</span>}
    </button>
    {open && <InboxSheet onClose={() => setOpen(false)} />}
  </>
}

function InboxSheet({ onClose }: { onClose: () => void }) {
  const { parentDevice, toast } = useApp()
  const inbox = useInbox()
  const [text, setText] = useState('')
  const [saved, setSaved] = useState('')
  const [picked, setPicked] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { reload().catch(e => toast(failed(e, t('Could not load the inbox')), true)) }, [toast])
  if (!parentDevice) return null
  const waiting = openItems(inbox), done = cleared(inbox)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    input.current?.focus() // ready for the next thought
    const words = cleaned(text)
    if (!words) return
    setText('')
    try {
      keep(await api.addToInbox({ id: crypto.randomUUID(), text: words }))
      setSaved(t('Saved: {text}', { text: words }))
    } catch (err) {
      setText(now => now || words) // nothing lost: the words go back in the box
      toast(failed(err, t('Could not save that. It’s still in the box.')), true)
    }
  }
  const putBack = async (id: string) => {
    try { keep(await api.setInboxStatus(id, 'open')) } catch (e) { toast(failed(e, t('Could not put that back')), true) }
  }
  return <Sheet title={`📥 ${t('Inbox')}`} onClose={onClose} dirty={text.trim() !== ''}
    actions={<button type="button" className="btn btn-primary" onClick={onClose}>{t('Done')}</button>}>
    <form className="inbox-capture" onSubmit={e => void save(e)}>
      <div className="field">
        <label htmlFor="inbox-text">{t('Jot it down')}</label>
        <div className="inbox-capture-row">
          <input id="inbox-text" ref={input} type="text" value={text} onChange={e => setText(e.target.value)} data-autofocus
            placeholder={t('Permission slip for Friday')} enterKeyHint="done" autoComplete="off" maxLength={200} />
          <button type="submit" className="btn btn-primary" disabled={!text.trim()}>{t('Save')}</button>
        </div>
        <p className="field-hint" role="status">{saved || t('No need to pick a day, person or list yet. Sort it out later.')}</p>
      </div>
    </form>

    {waiting.length ? <><h3 className="scheme-group-title">{tn(waiting.length, '{n} to sort', '{n} to sort')}</h3><div className="inbox-list">
      {waiting.map(i => <button key={i.id} type="button" className="sheet-link" onClick={() => setPicked(i.id)} aria-haspopup="dialog">
        <span>{i.text}<small>{inbox.saving.includes(i.id) ? t('Saving…') : t('Saved {when}', { when: relTime(i.createdAt) })}</small></span>
        <ChevronRight />
      </button>)}
    </div></> : <p className="state-card">{t('All sorted. Jot something down whenever it comes to mind.')}</p>}

    {done.length > 0 && <>
      <h3 className="scheme-group-title sheet-group-gap">{t('Recently sorted')}</h3>
      <div className="inbox-list">
        {done.map(i => {
          const href = whereHref(i.target)
          return href
            ? <a key={i.id} className="sheet-link" href={href} onClick={onClose}><span>{i.text}<small>{whereText(i.target!)}</small></span><ChevronRight /></a>
            : <button key={i.id} type="button" className="sheet-link" onClick={() => void putBack(i.id)}>
                <span>{i.text}<small>{i.target ? whereText(i.target) : t('Not needed')}</small></span><span className="inbox-put-back">{t('Put back')}</span></button>
        })}
      </div>
    </>}
    {picked && <OrganizeSheet id={picked} onClose={() => setPicked(null)} />}
  </Sheet>
}

/** One thought: what it becomes and where, nothing made until the button is tapped. */
function OrganizeSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { parentDevice, members, categories, settings, toast, reloadCore } = useApp()
  const inbox = useInbox()
  const item = inbox.items.find(i => i.id === id)
  const [hint] = useState(() => suggest(item?.text ?? '', new Date()))
  const notesOn = settings.features.announcements !== false, tasksOn = settings.features.lists !== false
  const [kind, setKind] = useState<InboxKind>(() => (hint.kind === 'note' && !notesOn) || (hint.kind === 'task' && !tasksOn) ? 'event' : hint.kind)
  const [title, setTitle] = useState(item?.text ?? '')
  const [date, setDate] = useState(hint.date ?? '')
  const [lists, setLists] = useState<List[] | null>(tasksOn ? null : [])
  const [listId, setListId] = useState('')
  const [calendars, setCalendars] = useState<CalendarEntry[]>([])
  const [eventForm, setEventForm] = useState(false)
  useEffect(() => {
    if (tasksOn) api.getLists().then(ls => {
      const todo = ls.filter(l => l.kind === 'todo' && l.purpose !== 'pantry' && !l.archived)
      setLists(todo); setListId((todo.find(l => l.isDefault) ?? todo[0])?.id ?? '')
    }).catch(() => setLists([]))
    api.getCalendars().then(cs => setCalendars(cs.filter(c => c.writable && c.enabled && c.canEditEvents !== false))).catch(() => {})
  }, [tasksOn])
  if (!parentDevice || !item) return null
  const busy = inbox.saving.includes(id)
  const words = title.trim()

  // The server makes it and only then takes it out of the inbox; a second tap sends nothing (inbox.ts organize).
  const make = async (body: InboxSort) => {
    try {
      if (await organize(store, id, () => api.sortInboxItem(id, body)) !== 'done') return
      const target = store.get().items.find(i => i.id === id)?.target ?? null, href = whereHref(target)
      reloadCore()
      if (target?.kind === 'note') window.dispatchEvent(new Event('kinwall:announcements-changed')) // the Board shows it now
      setEventForm(false); onClose()
      const said = target?.kind === 'task' ? t('Added to {list}', { list: target.label ?? '' }) : target?.kind === 'event' ? t('Added to the calendar') : t('Put on the family board')
      toast(said, false, href ? { label: t('View'), run: () => { location.hash = href } } : undefined)
    } catch (e) {
      toast(failed(e, t('Could not save that. It’s still in the inbox.')), true)
    }
  }
  const addTask = () => { if (listId && words) void make({ kind: 'task', listId, title: words, dueDate: date || null }) }
  const postNote = () => {
    if (!words) return
    const until = date || plusDays(todayYmd(), 3)
    void make({ kind: 'note', title: words, details: words === item.text ? '' : item.text, expiresAt: new Date(`${until}T23:59:00`).toISOString() })
  }
  const notNeeded = async () => {
    try {
      keep(await api.setInboxStatus(id, 'cleared'))
      onClose()
      toast(t('Cleared from the inbox'), false, { label: t('Undo'), run: () => { api.setInboxStatus(id, 'open').then(keep).catch(e => toast(failed(e, t('Could not put that back')), true)) } })
    } catch (e) { toast(failed(e, t('Could not clear that')), true) }
  }

  const shown = KINDS.filter(k => (k.key !== 'note' || notesOn) && (k.key !== 'task' || tasksOn))
  const primary = kind === 'task' ? { label: t('Add task'), run: addTask, ok: !!words && !!listId }
    : kind === 'event' ? { label: t('Next: event details'), run: () => setEventForm(true), ok: !!words && calendars.length > 0 }
    : { label: t('Put on the board'), run: postNote, ok: !!words }
  return <Sheet title={t('Sort it out')} onClose={onClose}
    actions={<>
      <button type="button" className="btn btn-secondary" onClick={onClose}>{t('Later')}</button>
      <button type="button" className="btn btn-primary" onClick={primary.run} disabled={busy || !primary.ok}>{busy ? t('Saving…') : primary.label}</button>
    </>}>
    <p className="inbox-original">{t('You wrote: “{text}”', { text: item.text })}</p>
    <div className="field">
      <label htmlFor="inbox-kind">{t('Make it')}</label>
      <select id="inbox-kind" value={kind} onChange={e => setKind(e.target.value as InboxKind)}>
        {shown.map(k => <option key={k.key} value={k.key}>{tm(k.label)}</option>)}
      </select>
    </div>
    <div className="field">
      <label htmlFor="inbox-title">{kind === 'note' ? t('Note') : kind === 'event' ? t('Event title') : t('Task')}</label>
      <input id="inbox-title" type="text" value={title} onChange={e => setTitle(e.target.value)} maxLength={kind === 'note' ? 160 : 200} />
    </div>
    {kind === 'task' && <div className="field">
      <label htmlFor="inbox-list">{t('List')}</label>
      {lists && !lists.length ? <p className="field-hint">{t('Make a to-do list in Lists first.')}</p>
        : <select id="inbox-list" value={listId} onChange={e => setListId(e.target.value)} disabled={!lists}>
          {(lists ?? []).map(l => <option key={l.id} value={l.id}>{l.emoji ? `${l.emoji} ${l.name}` : l.name}</option>)}
        </select>}
    </div>}
    {kind === 'event' && !calendars.length && <p className="field-hint">{t('Add a calendar that takes new events in Settings → Calendars first.')}</p>}
    <div className="field">
      <label htmlFor="inbox-date">{kind === 'task' ? t('Due (optional)') : kind === 'event' ? t('Day') : t('Show on the board until')}</label>
      <input id="inbox-date" type="date" value={date} onChange={e => setDate(e.target.value)} min={kind === 'note' ? todayYmd() : undefined} />
      <p className="field-hint">{hint.date && hint.dateWord && date === hint.date
        ? t('It says “{word}”, so this starts as {day}. Change it if that’s not right.', { word: hint.dateWord, day: longDay(hint.date) })
        : kind === 'event' ? t('You can set the time and who it’s for next.')
        : kind === 'note' ? t('Everyone sees it on Home. With no day, it shows for three days.') : t('Leave it empty for no due date.')}</p>
    </div>
    <div className="sheet-danger-zone"><button type="button" className="link-btn link-danger" onClick={() => void notNeeded()} disabled={busy}>{t('Not needed')}</button></div>
    {eventForm && <EventEditSheet event={null} calendars={calendars} offerNewLocal={false} members={members} categories={categories}
      prefill={{ title: words, description: words === item.text ? undefined : item.text, allDay: true, start: date || todayYmd(), end: plusDays(date || todayYmd(), 1) }}
      onClose={() => setEventForm(false)} onSave={(body: Partial<EventInstance>) => void make({ kind: 'event', event: body })} />}
  </Sheet>
}
