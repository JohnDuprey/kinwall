// The family's library (server: routes/library.ts), a Trackers view: the books the family owns or
// has borrowed (due back on a date; returned ones stay, under Returned), apart from who's reading
// what. Search, "Not read yet", scan books in one after another
// (the app's camera), add one by lookup or by hand, and "Read it" to start a reading entry for someone
// from a book (data.bookId links them, so the book lists its readers).
import { useEffect, useState } from 'react'
import { Segmented } from './a11y.tsx'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import BookLookup from './BookLookup.tsx'
import { useIsPhone } from './useIsPhone.ts'
import { FilterIcon } from './icons.tsx'
import { appBarcodeScanner, scanBarcode, wallCamera } from './native.ts'
import { addDayKeys, bookDetails, existingRead, dueLabel, isbnFromScan, isOverdue, lentLabel, LOAN_DAYS } from './library.ts'
import { announce } from './a11y.tsx'
import { todayKeyInTz } from './date.ts'
import type { BookResult, LibraryBook, Member, ReadingData, ReadingStatus } from './types.ts'
import { ChipFace } from './Face'

const STATUS_WORD: Record<ReadingStatus, string> = { want: 'wants to read', reading: 'reading', finished: 'read' }
/** Between book scans: long enough to see what was added and pick up the next book. */
const SCAN_PAUSE_MS = 2000
const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

export default function Library({ adding, onAdded, onStarted }: {
  adding: boolean // the + button: Add a book sheet
  onAdded: () => void // closes it
  onStarted: () => void // a reading entry was started: the shelves reload
}) {
  const { members, toast, parentDevice, focusLocked, meMemberId, refreshTick, settings } = useApp()
  const today = todayKeyInTz(settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
  const kid = !parentDevice && focusLocked ? meMemberId : null
  const [books, setBooks] = useState<LibraryBook[] | null>(null)
  const [q, setQ] = useState('')
  const [unread, setUnread] = useState(false)
  const [lent, setLent] = useState(false)
  const [borrowed, setBorrowed] = useState(false)
  const [returned, setReturned] = useState(false)
  const [wanted, setWanted] = useState(false) // the wishlist (off the shelf otherwise)
  const [sources, setSources] = useState<string[]>([]) // every place a book was borrowed from, for the pickers
  const [place, setPlace] = useState('') // '' = anywhere
  const [places, setPlaces] = useState<string[]>([]) // every place a book lives, for the filter and the picker
  const [open, setOpen] = useState<LibraryBook | null>(null)
  const [scanning, setScanning] = useState(false)
  const isPhone = useIsPhone()
  const [filtering, setFiltering] = useState(false) // a phone: the filters in a sheet, behind one button
  const load = () => api.getLibrary({ q, unread, lent, borrowed, returned, wanted, location: place || undefined }).then(b => {
    setBooks(b)
    const more = (old: string[], add: (string | null)[]) => [...new Set([...old, ...add.filter((l): l is string => !!l)])].sort((a, z) => a.localeCompare(z))
    setPlaces(p => more(p, b.map(x => x.location)))
    setSources(s => more(s, b.map(x => x.borrowedFrom)))
  }).catch(e => { setBooks([]); toast(msg(e, "Couldn't load the library"), true) })
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t) }, [q, unread, lent, borrowed, returned, wanted, place, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  // Scan books one after another: each barcode adds its book (looked up by ISBN), then a pause
  // (SCAN_PAUSE_MS) to see what was added and reach for the next book before the camera opens again;
  // Cancel stops. The same barcode twice in a row (the book still in view) is skipped. Scanning just
  // one opens its sheet, to say where it lives or whose it is.
  const scanBooks = async () => {
    setScanning(true)
    const seen: LibraryBook[] = []
    let last = ''
    try {
      for (;;) {
        const code = await scanBarcode(wallCamera({ parentDevice, focusLocked, meMemberId }))
        if (!code) break
        if (code !== last) {
          last = code
          const isbn = isbnFromScan(code)
          if (!isbn) toast("That's not a book's barcode")
          else try { const b = await api.addToLibrary({ isbn }); seen.push(b); toast(`Added: ${b.title}`); announce(`Added ${b.title}`) }
          catch (e) {
            const have = e instanceof ApiError && e.status === 409
              ? (await Promise.all([{}, { returned: true }, { wanted: true }].map(f => api.getLibrary(f))).catch(() => [[]])).flat().find(b => b.isbn === isbn)
              : undefined
            if (have) { seen.push(have); toast(`Already in the library: ${have.title}`) }
            else toast(msg(e, "Couldn't add that book"))
          }
        }
        await new Promise(r => setTimeout(r, SCAN_PAUSE_MS))
      }
    } finally { setScanning(false) }
    if (seen.length) load()
    if (seen.length === 1) setOpen(seen[0])
  }

  // Not read yet, Lent out, Borrowed, Returned and a place: in the bar, or (a phone) the Filters sheet.
  const on = [unread, lent, borrowed, returned, wanted, !!place].filter(Boolean).length
  const filters = <>
        <button type="button" className={`chip ${unread ? 'active' : ''}`} aria-pressed={unread} onClick={() => setUnread(v => !v)}>Not read yet</button>
        <button type="button" className={`chip ${lent ? 'active' : ''}`} aria-pressed={lent} onClick={() => setLent(v => !v)}>Lent out</button>
        <button type="button" className={`chip ${borrowed ? 'active' : ''}`} aria-pressed={borrowed} onClick={() => setBorrowed(v => !v)}>Borrowed</button>
        <button type="button" className={`chip ${returned ? 'active' : ''}`} aria-pressed={returned} onClick={() => setReturned(v => !v)}>Returned</button>
        <button type="button" className={`chip ${wanted ? 'active' : ''}`} aria-pressed={wanted} onClick={() => setWanted(v => !v)}>⭐ Wishlist</button>
        {places.length > 0 && (
          <select className="settings-select lib-place-filter" aria-label="Where it lives" value={place} onChange={e => setPlace(e.target.value)}>
            <option value="">Anywhere</option>
            {places.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
  </>
  const people = members
  return (
    <div className="lib">
      <div className="lib-bar">
        <input type="search" className="lib-search" aria-label="Search the library" placeholder={isPhone ? 'Search the library' : 'Search titles, authors, series, genres'} value={q} onChange={e => setQ(e.target.value)} />
        {isPhone && (
          <button type="button" className={`icon-btn filter-btn lib-filter-btn ${on ? 'active' : ''}`} onClick={() => setFiltering(true)} aria-label={on ? `Filters, ${on} on` : 'Filters'}>
            <FilterIcon width={20} height={20} />
            {on > 0 && <span className="filter-badge" aria-hidden="true">{on}</span>}
          </button>
        )}
        {!isPhone && filters}
        {appBarcodeScanner() && <button type="button" className="btn btn-secondary lib-scan" onClick={scanBooks} disabled={scanning} aria-label={isPhone ? 'Scan books' : undefined}>📷{isPhone ? '' : ' Scan books'}</button>}
      </div>
      {filtering && (
        <Sheet title="Filters" onClose={() => setFiltering(false)} actions={<>
          {on > 0 && <button className="btn btn-secondary" onClick={() => { setUnread(false); setLent(false); setBorrowed(false); setReturned(false); setWanted(false); setPlace('') }}>Clear</button>}
          <button className="btn btn-primary" onClick={() => setFiltering(false)}>Done</button>
        </>}>
          <div className="lib-bar lib-filter-sheet">{filters}</div>
        </Sheet>
      )}
      {books === null ? <div className="state-card">Loading…</div>
        : !books.length ? (
          <div className="empty-card"><span className="emoji">📚</span>{wanted && !q ? 'Nothing on the wishlist. Tap + and pick Wishlist to add a book you want.' : q || unread || lent || borrowed || returned || wanted || place ? 'No books match.' : 'No books in the library yet. Tap + to add the books you own or borrow, or scan them in.'}</div>
        ) : (
          <ul className="lib-grid">
            {books.map(b => {
              const cover = api.libraryCoverUrl(b)
              const details = bookDetails(b)
              const due = dueLabel(b, today)
              return (
                <li key={b.id}>
                  <button type="button" className="lib-book" onClick={() => setOpen(b)} aria-label={`${b.title}${b.author ? ` by ${b.author}` : ''}${b.readers.length ? '' : ', not read yet'}. Details`}>
                    {cover ? <img className="lib-cover" src={cover} alt="" loading="lazy" onError={e => { e.currentTarget.hidden = true }} /> : <span className="lib-cover lib-cover-blank" aria-hidden="true">📖</span>}
                    <span className="lib-book-text">
                      <span className="lib-book-title">{b.title}</span>
                      {b.author && <span className="trk-sub">{b.author}</span>}
                      {details && <span className="trk-sub">{details}</span>}
                      {!!b.genres.length && <span className="trk-sub lib-genres">{b.genres.join(' · ')}</span>}
                      {b.borrowedFrom && <span className={`trk-sub lib-where ${isOverdue(b, today) ? 'lib-overdue' : ''}`}>{[`📅 ${due ?? 'Borrowed'}`, `from ${b.borrowedFrom}`].join(' · ')}</span>}
                      {(b.location || b.lentTo) && <span className="trk-sub lib-where">{[b.lentTo ? `🤝 ${lentLabel(b, today)}` : '', b.location ? `📍 ${b.location}` : ''].filter(Boolean).join(' · ')}</span>}
                      <span className="lib-readers">{b.readers.length
                        ? [...new Map(b.readers.map(r => [r.memberId, r])).values()].slice(0, 4).map(r => { const m = people.find(x => x.id === r.memberId); return <span key={r.entryId} className="chip-static" title={`${m?.name ?? 'Family'} ${STATUS_WORD[r.status]}`}>{m?.avatar ?? '🏠'} {r.status === 'finished' ? '✓' : r.status === 'reading' ? '📖' : '⭐'}</span> })
                        : <span className="trk-tag">{b.wanted ? '⭐ Wishlist' : 'Not read yet'}</span>}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      {open && <BookSheet book={open} members={kid ? members.filter(m => m.id === kid) : members} canRemove={parentDevice} places={places} sources={sources} today={today} onClose={() => setOpen(null)}
        onSaved={b => { setOpen(b); load() }} onChanged={() => { setOpen(null); load() }} onStarted={() => { setOpen(null); load(); onStarted() }} />}
      {adding && <AddBookSheet places={places} sources={sources} today={today} onClose={onAdded} onAdded={() => { onAdded(); load() }} />}
    </div>
  )
}

/** A library book: its details, who has read it, "Read it" for someone, and Remove (parent devices). */
function BookSheet({ book, members, canRemove, places, sources, today, onClose, onSaved, onChanged, onStarted }: {
  book: LibraryBook; members: Member[]; canRemove: boolean; places: string[]; sources: string[]; today: string
  onClose: () => void; onSaved: (b: LibraryBook) => void; onChanged: () => void; onStarted: () => void
}) {
  const { toast, members: everyone } = useApp()
  const [more, setMore] = useState(false)
  const [borrower, setBorrower] = useState('')
  // Whose book: ours, borrowed or on the wishlist. Picking Borrowed asks where from and when it's due first.
  const [picking, setPicking] = useState<'borrowed' | null>(null)
  const whose = picking ?? (book.borrowedFrom ? 'borrowed' : book.wanted ? 'wanted' : 'ours')
  const pickWhose = (v: string) => {
    setPicking(null)
    if (v === 'borrowed') { if (!book.borrowedFrom) setPicking('borrowed') }
    else if (v === 'wanted') save({ wanted: true, ...(book.borrowedFrom && { borrowedFrom: null }) }, `On the wishlist: ${book.title}`)
    else if (book.borrowedFrom) save({ borrowedFrom: null }, `${book.title} is ours now`)
    else if (book.wanted) save({ wanted: false }, `Got it: ${book.title}`)
  }
  const save = async (changes: Parameters<typeof api.updateLibraryBook>[1], said: string) => {
    try { const b = await api.updateLibraryBook(book.id, changes); toast(said); announce(said); onSaved(b) }
    catch (e) { toast(msg(e, "Couldn't save it"), true) }
  }
  const long = (book.description?.length ?? 0) > 320
  const cover = api.libraryCoverUrl(book)
  const details = bookDetails(book)
  const readIt = async (m: Member) => {
    try {
      // Already reading it (maybe tracked before the book was in the library): link that entry, don't add another.
      const have = existingRead(await api.getTrackers('reading'), m.id, book)
      if (have) {
        const d = have.data as ReadingData
        if (d.bookId === book.id && d.status === 'reading') { toast(`${m.name} is already reading ${book.title}`); return }
        await api.updateTracker(have.id, { data: { bookId: book.id, status: 'reading', ...(!d.coverUrl && book.coverUrl && { coverUrl: book.coverUrl }), ...(!d.totalPages && book.pages && { totalPages: book.pages }) } })
        toast(`${m.name} is reading ${book.title}`); announce(`${m.name} is reading ${book.title}`); onStarted(); return
      }
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
      {book.description && <>
        <p className={`lib-description ${long && !more ? 'lib-description-clamp' : ''}`}>{book.description}</p>
        {long && <button type="button" className="link-btn lib-more" onClick={() => setMore(v => !v)} aria-expanded={more}>{more ? 'Show less' : 'Show more'}</button>}
      </>}
      <div className="field">
        <label htmlFor="lib-whose">Whose book</label>
        <select id="lib-whose" value={whose} onChange={e => pickWhose(e.target.value)}>
          <option value="ours">Ours</option>
          <option value="borrowed">Borrowed</option>
          <option value="wanted">Wishlist (don't have it yet)</option>
        </select>
        {book.wanted && !picking && <p className="field-hint">Got it? Pick Ours.</p>}
      </div>
      {picking === 'borrowed' && <BorrowFields sources={sources} today={today} onCancel={() => setPicking(null)}
        onSave={(from, due) => { setPicking(null); save({ borrowedFrom: from, dueOn: due }, `Borrowed from ${from}`) }} />}
      {!book.wanted && <PlacePicker value={book.location ?? ''} places={places} onChange={v => save({ location: v || null }, v ? `Where it lives: ${v}` : `Place cleared: ${book.title}`)} />}
      {book.wanted || picking ? null : book.borrowedFrom ? (
        <div className="field">
          <label htmlFor="lib-due">Due back to {book.borrowedFrom}</label>
          {book.returnedOn ? (
            <div className="lib-lent">
              <span>↩️ {dueLabel(book, today)}</span>
              <button type="button" className="btn btn-secondary lib-back" onClick={() => save({ returnedOn: null, dueOn: addDayKeys(today, LOAN_DAYS) }, `Borrowed ${book.title} again`)}>Borrow again</button>
            </div>
          ) : (
            <div className="lib-lent">
              <input id="lib-due" type="date" aria-label="Due back" value={book.dueOn ?? ''} onChange={e => save({ dueOn: e.target.value || null }, e.target.value ? `Due back: ${dueLabel({ ...book, dueOn: e.target.value }, today)?.replace(/^Due back /, '')}` : 'Due date cleared')} />
              <button type="button" className="btn btn-secondary lib-back" onClick={() => save({ returnedOn: today }, `Returned: ${book.title}`)}>Returned it</button>
            </div>
          )}
          {isOverdue(book, today) && <p className="field-hint lib-overdue">{dueLabel(book, today)}</p>}
        </div>
      ) : <div className="field">
        <label htmlFor="lib-lend">Lending</label>
        {book.lentTo ? (
          <div className="lib-lent">
            <span>🤝 {lentLabel(book, today)}</span>
            <button type="button" className="btn btn-secondary lib-back" onClick={() => save({ lentTo: null }, `Back home: ${book.title}`)}>It's back</button>
          </div>
        ) : (
          <div className="weather-search-row">
            <input id="lib-lend" type="text" value={borrower} onChange={e => setBorrower(e.target.value)} placeholder="Lend it to… (Grandma, a friend)" autoComplete="off" maxLength={80}
              onKeyDown={e => { if (e.key === 'Enter' && borrower.trim()) save({ lentTo: borrower.trim() }, `Lent ${book.title} to ${borrower.trim()}`) }} />
            <button type="button" className="btn btn-secondary" disabled={!borrower.trim()} onClick={() => save({ lentTo: borrower.trim() }, `Lent ${book.title} to ${borrower.trim()}`)}>Lend</button>
          </div>
        )}
      </div>}
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
          {members.map(m => <button key={m.id} type="button" className="chip" style={{ ['--chip-color' as string]: m.color }} onClick={() => readIt(m)}><ChipFace m={m} /> {m.name}</button>)}
        </div>
        <p className="field-hint">Puts it on their Reading shelf, linked to this book.</p>
      </div>
      {canRemove && <button type="button" className="btn btn-danger lib-remove" onClick={remove}>Remove from library</button>}
    </Sheet>
  )
}

/** Where a book lives: a place it's been before, or a new one. */
function PlacePicker({ value, places, onChange }: { value: string; places: string[]; onChange: (v: string) => void }) {
  const [typing, setTyping] = useState(false)
  const [draft, setDraft] = useState('')
  const options = [...new Set([...places, ...(value ? [value] : [])])]
  return (
    <div className="field">
      <label htmlFor="lib-place">Where it lives</label>
      {typing ? (
        <div className="weather-search-row">
          <input id="lib-place" type="text" value={draft} onChange={e => setDraft(e.target.value)} placeholder="Maya's room, living room shelf…" autoComplete="off" maxLength={80} autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) { onChange(draft.trim()); setTyping(false) } }} />
          <button type="button" className="btn btn-secondary" disabled={!draft.trim()} onClick={() => { onChange(draft.trim()); setTyping(false) }}>Save</button>
        </div>
      ) : (
        <select id="lib-place" value={value} onChange={e => { if (e.target.value === '\u0000new') { setDraft(''); setTyping(true) } else onChange(e.target.value) }}>
          <option value="">Not set</option>
          {options.map(p => <option key={p} value={p}>{p}</option>)}
          <option value={'\u0000new'}>New place…</option>
        </select>
      )}
    </div>
  )
}

/** Where a borrowed book came from (one from before, or typed) and when it's due back. With onSave:
 * its own Save button; without, it reports each change (onChange), for the Add sheet. */
function BorrowFields({ sources, today, onSave, onCancel, onChange }: { sources: string[]; today: string; onSave?: (from: string, due: string | null) => void; onCancel?: () => void; onChange?: (from: string, due: string | null) => void }) {
  const [from, setFrom] = useState(sources[0] ?? '')
  const [due, setDue] = useState(addDayKeys(today, LOAN_DAYS))
  useEffect(() => { onChange?.(from.trim(), due || null) }, [from, due]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <div className="field">
        <label htmlFor="lib-from">Borrowed from</label>
        <input id="lib-from" type="text" list="lib-sources" value={from} onChange={e => setFrom(e.target.value)} placeholder="Town library, a friend…" autoComplete="off" maxLength={80} />
        <datalist id="lib-sources">{sources.map(s => <option key={s} value={s} />)}</datalist>
      </div>
      <div className="field">
        <label htmlFor="lib-due-new">Due back</label>
        <div className="weather-search-row">
          <input id="lib-due-new" type="date" value={due} onChange={e => setDue(e.target.value)} />
        </div>
      </div>
      {onSave && <div className="lib-borrow-actions">
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>Cancel</button>}
        <button type="button" className="btn btn-primary" disabled={!from.trim()} onClick={() => onSave(from.trim(), due || null)}>Save</button>
      </div>}
    </>
  )
}

/** Add a book you own or borrowed: look it up (fills everything, the description too), or type it in.
 * `from`: a book someone's reading (Trackers' Save to library), its details to start with; a book
 * that's already in the library (same ISBN) comes back as that one, so the entry links to it. */
export function AddBookSheet({ places, sources, today, from, onClose, onAdded }: {
  places: string[]; sources: string[]; today: string; from?: { title: string; author: string; pages: number | null; coverUrl: string | null }
  onClose: () => void; onAdded: (b: LibraryBook) => void
}) {
  const { toast } = useApp()
  const [picked, setPicked] = useState<BookResult | null>(null)
  const [title, setTitle] = useState(from?.title ?? '')
  const [author, setAuthor] = useState(from?.author ?? '')
  const [location, setLocation] = useState('')
  const [whose, setWhose] = useState<'ours' | 'borrowed' | 'wanted'>('ours')
  const [loan, setLoan] = useState<{ from: string; due: string | null }>({ from: '', due: null })
  const [busy, setBusy] = useState(false)
  const borrowing = whose === 'borrowed'
  const add = async () => {
    if (!title.trim() || busy || (borrowing && !loan.from)) return
    setBusy(true)
    try {
      const fromLookup = picked && picked.title === title.trim() ? { isbn: picked.isbn, pages: picked.pages, coverUrl: picked.coverUrl, year: picked.year, series: picked.series, seriesNumber: picked.seriesNumber, lexile: picked.lexile, genres: picked.genres, workKey: picked.workKey } : {}
      const fromEntry = from ? { pages: from.pages, coverUrl: from.coverUrl } : {}
      const b = await api.addToLibrary({ title: title.trim(), author: author.trim() || null, ...(location ? { location } : {}), ...(borrowing ? { borrowedFrom: loan.from, dueOn: loan.due } : {}), ...(whose === 'wanted' ? { wanted: true } : {}), ...Object.fromEntries(Object.entries({ ...fromEntry, ...fromLookup }).filter(([, v]) => v !== undefined && v !== null)) })
      const said = b.wanted ? `On the wishlist: ${b.title}` : `Added: ${b.title}`; toast(said); announce(said); onAdded(b)
    } catch (e) {
      // Already there (the looked-up ISBN): hand back that book, returned ones too.
      const have = e instanceof ApiError && e.status === 409 && picked?.isbn
        ? (await Promise.all([api.getLibrary({ q: title.trim() }), api.getLibrary({ q: title.trim(), returned: true })]).catch(() => [[]])).flat().find(b => b.isbn === picked.isbn)
        : undefined
      if (have) { toast(`Already in the library: ${have.title}`); onAdded(have) }
      else toast(msg(e, "Couldn't add it"), true)
    } finally { setBusy(false) }
  }
  return (
    <Sheet title="Add a book" onClose={onClose}
      actions={<button className="btn btn-primary" onClick={add} disabled={!title.trim() || busy || (borrowing && !loan.from)}>Add to library</button>}>
      <Segmented label="Whose book" value={whose} onChange={setWhose} options={[{ key: 'ours', label: 'Ours' }, { key: 'borrowed', label: 'Borrowed' }, { key: 'wanted', label: 'Wishlist' }]} />
      <BookLookup initial={title} onPick={b => { setPicked(b); setTitle(b.title); setAuthor(b.author ?? '') }} />
      <div className="field"><label htmlFor="lib-title">Title</label><input id="lib-title" type="text" value={title} onChange={e => setTitle(e.target.value)} autoComplete="off" /></div>
      <div className="field"><label htmlFor="lib-author">Author</label><input id="lib-author" type="text" value={author} onChange={e => setAuthor(e.target.value)} autoComplete="off" /></div>
      {borrowing && <BorrowFields sources={sources} today={today} onChange={(from, due) => setLoan({ from, due })} />}
      {whose !== 'wanted' && <PlacePicker value={location} places={places} onChange={setLocation} />}
      {picked && picked.title === title.trim() && bookDetails({ series: picked.series ?? null, seriesNumber: picked.seriesNumber ?? null, year: picked.year ?? null, lexile: picked.lexile ?? null, pages: picked.pages ?? null }) && (
        <p className="field-hint">{bookDetails({ series: picked.series ?? null, seriesNumber: picked.seriesNumber ?? null, year: picked.year ?? null, lexile: picked.lexile ?? null, pages: picked.pages ?? null })}{picked.workKey ? '. Its description comes too.' : ''}</p>
      )}
    </Sheet>
  )
}
