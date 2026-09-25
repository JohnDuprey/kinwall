import { Fragment, useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { useApp } from './AppContext.tsx'
import { api, ApiError } from './api.ts'
import type { Member, Note, NoteTarget } from './types.ts'
import { inkFor, readableOn } from './color.ts'
import { announce } from './a11y.tsx'
import { useDialog } from './dialog.tsx'

const POST_AS_KEY = 'kinwall.notePostAs' // member the last note was posted as
const MAX = 2000

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' })
function relTime(iso: string): string {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return rtf.format(-min, 'minute')
  if (min < 24 * 60) return rtf.format(-Math.round(min / 60), 'hour')
  if (min < 7 * 24 * 60) return rtf.format(-Math.round(min / 1440), 'day')
  return format(new Date(iso), 'MMM d')
}

// Plain text with http(s) links made clickable. React escapes the text, so nothing in a note is ever HTML.
const URL_RE = /(https?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'])/g
function Linkified({ text }: { text: string }) {
  return <>{text.split(URL_RE).map((part, i) => i % 2
    ? <a key={i} href={part} target="_blank" rel="noopener noreferrer nofollow">{part}</a>
    : <Fragment key={i}>{part}</Fragment>)}</>
}

function readPostAs(): string | null {
  try { return localStorage.getItem(POST_AS_KEY) } catch { return null }
}

/** The notes thread on an event or list item: who said what, in their colour. Tap a note to edit or
 * delete it; "+ Add note" (folded, like "+ Add task") posts a new one as the chosen member. */
export default function NotesThread({ target, title = 'Notes' }: { target: NoteTarget; title?: string }) {
  const { members, selectedMemberId, refreshTick, toast } = useApp()
  const dialog = useDialog()
  const [notes, setNotes] = useState<Note[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [postAs, setPostAs] = useState<string | null>(() => {
    const last = readPostAs()
    return selectedMemberId ?? (members.some(m => m.id === last) ? last : null)
  })
  const addBtnRef = useRef<HTMLButtonElement>(null)
  const byId = new Map(members.map(m => [m.id, m]))
  // Names are drawn in the member's colour, darkened/lightened just enough to read on the sheet.
  const cardBg = getComputedStyle(document.documentElement).getPropertyValue('--card').trim()
  const nameInk = (m: Member | undefined) => m && /^#[0-9a-f]{6}$/i.test(cardBg) ? readableOn(m.color, cardBg) : undefined
  const who = (n: Note) => byId.get(n.memberId ?? '')?.name ?? 'Someone'

  const load = () => api.getNotes(target).then(setNotes).catch(() => setNotes([]))
  useEffect(() => { load() }, [target, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (e: unknown, what: string) => toast(e instanceof ApiError ? e.message : `Could not ${what}`, true)
  const collapse = () => { setAdding(false); setDraft(''); setTimeout(() => addBtnRef.current?.focus()) }
  const post = async () => {
    const body = draft.trim()
    if (!body) return
    try {
      await api.addNote(target, body, postAs)
      try { if (postAs) localStorage.setItem(POST_AS_KEY, postAs) } catch { /* private mode */ }
      collapse(); load()
      announce(`Note posted${postAs ? ` as ${byId.get(postAs)?.name}` : ''}`)
    } catch (e) { fail(e, 'post note') }
  }
  const startEdit = (n: Note) => { setEditing(n.id); setEditDraft(n.body) }
  // Leaving edit mode removes the focused textarea: put focus back on that note's Edit (or, once
  // deleted, "+ Add note") so keyboard users - and the sheet's Escape - don't lose their place.
  const threadRef = useRef<HTMLElement>(null)
  const stopEdit = (id: string) => {
    setEditing(null)
    setTimeout(() => (threadRef.current?.querySelector<HTMLElement>(`[data-note="${id}"] .note-edit`) ?? addBtnRef.current)?.focus())
  }
  const saveEdit = async (n: Note) => {
    const body = editDraft.trim()
    if (!body) return
    try { await api.updateNote(n.id, body); stopEdit(n.id); load(); announce('Note saved') }
    catch (e) { fail(e, 'save note') }
  }
  const remove = async (n: Note) => {
    if (!await dialog.confirm({ title: 'Delete this note?', body: `${who(n)}: “${n.body.length > 80 ? n.body.slice(0, 80) + '…' : n.body}”`, confirmLabel: 'Delete', danger: true })) return
    try { await api.deleteNote(n.id); stopEdit(n.id); load(); announce('Note deleted') }
    catch (e) { fail(e, 'delete note') }
  }
  const escape = (fn: () => void) => (e: React.KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); fn() } } // before the sheet's own Escape

  const formId = `notes-add-${target}`
  return (
    <section ref={threadRef} className="notes-thread" aria-label={title}>
      {notes.length > 0 && <h3 className="notes-title">{title}</h3>}
      {notes.length > 0 && (
        <ul className="notes-list">
          {notes.map(n => {
            const m = byId.get(n.memberId ?? '')
            const edited = n.updatedAt > n.createdAt
            return (
              <li key={n.id} data-note={n.id} className="note" style={{ ['--note-color' as string]: m?.color ?? 'var(--border)' }}
                onClick={e => { if (editing !== n.id && !(e.target as HTMLElement).closest('a, button')) startEdit(n) }}>
                <div className="note-head">
                  <span className="note-avatar" aria-hidden="true" style={m ? { background: m.color, color: inkFor(m.color) } : undefined}>{m ? (m.avatar || m.name[0]) : '?'}</span>
                  <span className="note-name" style={{ color: nameInk(m) }}>{who(n)}</span>
                  <span className="note-time"><time dateTime={n.createdAt} title={new Date(n.createdAt).toLocaleString()}>{relTime(n.createdAt)}</time>{edited && ' · edited'}</span>
                  {editing !== n.id && <button type="button" className="link-btn note-edit" onClick={() => startEdit(n)} aria-label={`Edit note by ${who(n)}`}>Edit</button>}
                </div>
                {editing === n.id ? (
                  <div className="note-form" onKeyDownCapture={escape(() => stopEdit(n.id))}>
                    <textarea value={editDraft} onChange={e => setEditDraft(e.target.value)} maxLength={MAX} autoFocus aria-label={`Edit note by ${who(n)}`} rows={3} />
                    <div className="note-actions">
                      <button type="button" className="btn btn-danger" onClick={() => remove(n)}>Delete</button>
                      <span style={{ flex: 1 }} />
                      <button type="button" className="btn btn-secondary" onClick={() => stopEdit(n.id)}>Cancel</button>
                      <button type="button" className="btn btn-primary" onClick={() => saveEdit(n)} disabled={!editDraft.trim()}>Save</button>
                    </div>
                  </div>
                ) : (
                  <div className="note-body"><Linkified text={n.body} /></div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {!adding ? (
        <button ref={addBtnRef} type="button" className="link-btn" style={{ alignSelf: 'flex-start' }} aria-expanded={false} aria-controls={formId}
          onClick={() => { setPostAs(p => selectedMemberId ?? p); setAdding(true) }}>+ Add note</button>
      ) : (
        <div id={formId} className="note-form" onKeyDownCapture={escape(collapse)}>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} maxLength={MAX} autoFocus rows={3} placeholder="Add a note" aria-label="New note" />
          {members.length > 0 && (
            <div className="chip-row note-post-as" role="radiogroup" aria-label="Post as">
              <span className="note-post-as-label" aria-hidden="true">Post as</span>
              {members.map(m => (
                <button key={m.id} type="button" role="radio" aria-checked={postAs === m.id} className={`chip ${postAs === m.id ? 'active' : ''}`}
                  style={{ ['--chip-color' as string]: m.color }} onClick={() => setPostAs(m.id)}>{m.avatar} {m.name}</button>
              ))}
              <button type="button" role="radio" aria-checked={postAs === null} className={`chip ${postAs === null ? 'active' : ''}`} onClick={() => setPostAs(null)}>Someone</button>
            </div>
          )}
          <div className="note-actions">
            <span style={{ flex: 1 }} />
            <button type="button" className="btn btn-secondary" onClick={collapse}>Cancel</button>
            <button type="button" className="btn btn-primary" onClick={post} disabled={!draft.trim()}>Post</button>
          </div>
        </div>
      )}
    </section>
  )
}
