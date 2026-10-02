// The family's library (server: routes/library.ts), the Reading tab's second view: the books the
// family owns, apart from who's reading what. Search, "Not read yet", scan books in one after another
// (the app's camera), add one by lookup or by hand, and "Read it" to start a reading entry for someone
// from a book (data.bookId links them, so the book lists its readers).
import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { announce } from './a11y.tsx'
import Sheet from './Sheet.tsx'
import BookLookup from './BookLookup.tsx'
import { appBarcodeScanner, scanBarcode, wallCamera } from './native.ts'
import { bookDetails, isbnFromScan } from './library.ts'
import type { BookResult, LibraryBook, Member, ReadingStatus } from './types.ts'

const STATUS_WORD: Record<ReadingStatus, string> = { want: 'wants to read', reading: 'reading', finished: 'read' }
const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

export default function Library({ adding, onAdded, onStarted }: {
  adding: boolean // the + button: Add a book sheet
  onAdded: () => void // closes it
  onStarted: () => void // a reading entry was started: the shelves reload
}) {
  const { members, toast, parentDevice, focusLocked, meMemberId, refreshTick } = useApp()
  const kid = !parentDevice && focusLocked ? meMemberId : null
  const [books, setBooks] = useState<LibraryBook[] | null>(null)
  const [q, setQ] = useState('')
  const [unread, setUnread] = useState(false)
  const [open, setOpen] = useState<LibraryBook | null>(null)
  const [scanning, setScanning] = useState(false)
  const load = () => api.getLibrary({ q, unread }).then(setBooks).catch(e => { setBooks([]); toast(msg(e, "Couldn't load the library"), true) })
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t) }, [q, unread, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scan books in one after another: each barcode adds its book (looked up by ISBN); Cancel stops.
  const scanBooks = async () => {
    setScanning(true)
    let added = 0
    for (;;) {
      const code = await scanBarcode(wallCamera({ parentDevice, focusLocked, meMemberId }))
      if (!code) break
      const isbn = isbnFromScan(code)
      if (!isbn) { toast("That's not a book's barcode"); continue }
      try { const b = await api.addToLibrary({ isbn }); added++; toast(`Added: ${b.title}`); announce(`Added ${b.title}`) }
      catch (e) { toast(msg(e, "Couldn't add that book")) }
    }
    setScanning(false)
    if (added) { announce(`${added} book${added === 1 ? '' : 's'} added`); load() }
  }

  const people = members
  return (
    <div className="lib">
      <div className="lib-bar">
        <input type="search" className="lib-search" aria-label="Search the library" placeholder="Search titles, authors, series, genres" value={q} onChange={e => setQ(e.target.value)} />
        <button type="button" className={`chip ${unread ? 'active' : ''}`} aria-pressed={unread} onClick={() => setUnread(v => !v)}>Not read yet</button>
        {appBarcodeScanner() && <button type="button" className="btn btn-secondary lib-scan" onClick={scanBooks} disabled={scanning}>📷 Scan books</button>}
      </div>
      {books === null ? <div className="state-card">Loading…</div>
        : !books.length ? (
          <div className="empty-card"><span className="emoji">📚</span>{q || unread ? 'No books match.' : 'No books in the library yet. Tap + to add the books you own, or scan them in.'}</div>
        ) : (
          <ul className="lib-grid">
            {books.map(b => {
              const cover = api.libraryCoverUrl(b)
              const details = bookDetails(b)
              return (
                <li key={b.id}>
                  <button type="button" className="lib-book" onClick={() => setOpen(b)} aria-label={`${b.title}${b.author ? ` by ${b.author}` : ''}${b.readers.length ? '' : ', not read yet'}. Details`}>
                    {cover ? <img className="lib-cover" src={cover} alt="" loading="lazy" onError={e => { e.currentTarget.hidden = true }} /> : <span className="lib-cover lib-cover-blank" aria-hidden="true">📖</span>}
                    <span className="lib-book-text">
                      <span className="lib-book-title">{b.title}</span>
                      {b.author && <span className="trk-sub">{b.author}</span>}
                      {details && <span className="trk-sub">{details}</span>}
                      {!!b.genres.length && <span className="trk-sub lib-genres">{b.genres.join(' · ')}</span>}
                      <span className="lib-readers">{b.readers.length
                        ? [...new Map(b.readers.map(r => [r.memberId, r])).values()].slice(0, 4).map(r => { const m = people.find(x => x.id === r.memberId); return <span key={r.entryId} className="chip-static" title={`${m?.name ?? 'Family'} ${STATUS_WORD[r.status]}`}>{m?.avatar ?? '🏠'} {r.status === 'finished' ? '✓' : r.status === 'reading' ? '📖' : '⭐'}</span> })
                        : <span className="trk-tag">Not read yet</span>}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      {open && <BookSheet book={open} members={kid ? members.filter(m => m.id === kid) : members} canRemove={parentDevice} onClose={() => setOpen(null)}
        onChanged={() => { setOpen(null); load() }} onStarted={() => { setOpen(null); load(); onStarted() }} />}
      {adding && <AddBookSheet onClose={onAdded} onAdded={() => { onAdded(); load() }} />}
    </div>
  )
}

/** A library book: its details, who has read it, "Read it" for someone, and Remove (parent devices). */
function BookSheet({ book, members, canRemove, onClose, onChanged, onStarted }: {
  book: LibraryBook; members: Member[]; canRemove: boolean; onClose: () => void; onChanged: () => void; onStarted: () => void
}) {
  const { toast, members: everyone } = useApp()
  const cover = api.libraryCoverUrl(book)
  const details = bookDetails(book)
  const readIt = async (m: Member) => {
    try {
      await api.addTracker({ kind: 'reading', memberId: m.id, title: book.title, data: {
        format: 'book', status: 'reading', bookId: book.id, ...(book.author && { author: book.author }), ...(book.pages && { totalPages: book.pages }), ...(book.coverUrl && { coverUrl: book.coverUrl }),
      } })
      toast(`${m.name} is reading ${book.title}`); announce(`${m.name} is reading ${book.title}`); onStarted()
    } catch (e) { toast(msg(e, "Couldn't start it"), true) }
  }
  const remove = async () => {
    try { await api.deleteLibraryBook(book.id); toast(`Removed: ${book.title}`); onChanged() }
    catch (e) { toast(msg(e, "Couldn't remove it"), true) }
  }
  return (
    <Sheet title={book.title} onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>Done</button>}>
      <div className="lib-detail">
        {cover && <img className="lib-detail-cover" src={cover} alt="" onError={e => { e.currentTarget.hidden = true }} />}
        <div>
          {book.author && <div className="lib-detail-author">{book.author}</div>}
          {details && <div className="trk-sub">{details}</div>}
          {!!book.genres.length && <div className="chip-row lib-genre-chips">{book.genres.map(g => <span key={g} className="chip-static">{g}</span>)}</div>}
        </div>
      </div>
      {book.description && <p className="lib-description">{book.description}</p>}
      <div className="field">
        <label id="lib-readers">Read by</label>
        {book.readers.length ? (
          <ul className="lib-reader-list" aria-labelledby="lib-readers">
            {book.readers.map(r => { const m = everyone.find(x => x.id === r.memberId); return <li key={r.entryId}>{m?.avatar ?? '🏠'} {m?.name ?? 'Family'} <span className="trk-sub">{STATUS_WORD[r.status]}</span></li> })}
          </ul>
        ) : <p className="trk-sub">Nobody yet.</p>}
      </div>
      <div className="field">
        <label id="lib-read-it">Read it</label>
        <div className="chip-row" role="group" aria-labelledby="lib-read-it">
          {members.map(m => <button key={m.id} type="button" className="chip" style={{ ['--chip-color' as string]: m.color }} onClick={() => readIt(m)}>{m.avatar} {m.name}</button>)}
        </div>
        <p className="field-hint">Puts it on their Reading shelf, linked to this book.</p>
      </div>
      {canRemove && <button type="button" className="btn btn-danger lib-remove" onClick={remove}>Remove from library</button>}
    </Sheet>
  )
}

/** Add a book you own: look it up (fills everything, the description too), or type it in. */
function AddBookSheet({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { toast } = useApp()
  const [picked, setPicked] = useState<BookResult | null>(null)
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      const fromLookup = picked && picked.title === title.trim() ? { isbn: picked.isbn, pages: picked.pages, coverUrl: picked.coverUrl, year: picked.year, series: picked.series, seriesNumber: picked.seriesNumber, lexile: picked.lexile, genres: picked.genres, workKey: picked.workKey } : {}
      const b = await api.addToLibrary({ title: title.trim(), author: author.trim() || null, ...Object.fromEntries(Object.entries(fromLookup).filter(([, v]) => v !== undefined)) })
      toast(`Added: ${b.title}`); announce(`Added ${b.title} to the library`); onAdded()
    } catch (e) { toast(msg(e, "Couldn't add it"), true) } finally { setBusy(false) }
  }
  return (
    <Sheet title="Add a book you own" onClose={onClose}
      actions={<button className="btn btn-primary" onClick={add} disabled={!title.trim() || busy}>Add to library</button>}>
      <BookLookup initial={title} onPick={b => { setPicked(b); setTitle(b.title); setAuthor(b.author ?? '') }} />
      <div className="field"><label htmlFor="lib-title">Title</label><input id="lib-title" type="text" value={title} onChange={e => setTitle(e.target.value)} autoComplete="off" /></div>
      <div className="field"><label htmlFor="lib-author">Author</label><input id="lib-author" type="text" value={author} onChange={e => setAuthor(e.target.value)} autoComplete="off" /></div>
      {picked && picked.title === title.trim() && bookDetails({ series: picked.series ?? null, seriesNumber: picked.seriesNumber ?? null, year: picked.year ?? null, lexile: picked.lexile ?? null, pages: picked.pages ?? null }) && (
        <p className="field-hint">{bookDetails({ series: picked.series ?? null, seriesNumber: picked.seriesNumber ?? null, year: picked.year ?? null, lexile: picked.lexile ?? null, pages: picked.pages ?? null })}{picked.workKey ? '. Its description comes too.' : ''}</p>
      )}
    </Sheet>
  )
}
