// The family's library (server: routes/library.ts), a Trackers view: the books the family owns or
// has borrowed (due back on a date; returned ones stay, under Returned), apart from who's reading
// what. Search, the Filters sheet (what, where, whose shelf; filtered here, libraries are small), scan books in one after another
// (the app's camera), add one by lookup or by hand, and "Read it" to start a reading entry for someone
// from a book (data.bookId links them, so the book lists its readers).
import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Segmented } from './a11y.tsx'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import BookLookup from './BookLookup.tsx'
import { useIsPhone } from './useIsPhone.ts'
import { FilterIcon } from './icons.tsx'
import { appBarcodeScanner, scanBarcode, wallCamera } from './native.ts'
import { addDayKeys, bookDetails, existingRead, dueLabel, filterLibrary, genreOptions, isbnFromScan, isOverdue, lentLabel, libraryNeeds, listenLabel, LOAN_DAYS, openLibraryUrl, isAudio, libroUrl, FORMAT_LABEL, ratingLabel, readingLevel, seriesLabel, NO_FILTERS, onShelf, SHELF_LABEL, startShelf, type ShelfPick, SORT_LABEL, sortLibrary, STATUS_LABEL, type LibraryFilters, type LibrarySort, type LibraryStatus } from './library.ts'
import type { LibraryFormat, LibraryShelf as BookShelf } from './types.ts'
import { announce, filterSortLabel } from './a11y.tsx'
import { todayKeyInTz } from './date.ts'
import type { BookResult, LibraryBook, Member, ReadingData, ReadingStatus } from './types.ts'
import { ChipFace } from './Face'
import LibraryShelf from './LibraryShelf.tsx'
import BookCover from './BookCover.tsx'
import { hashPath, hashQuery } from './hashQuery.ts'
import { STATUS_EMOJI } from './reading.ts'
import { msg, t, tm, tn } from './i18n.ts'

// Marked labels (msg): shown with tm().
const STATUS_WORD: Record<ReadingStatus, string> = { want: msg('wants to read'), reading: msg('reading'), finished: msg('read') }
/** A reader chip's tooltip: "Leo reading". */
const STATUS_TITLE: Record<ReadingStatus, string> = { want: msg('{name} wants to read'), reading: msg('{name} reading'), finished: msg('{name} read') }
const SHELF_WORD: Record<BookShelf, string> = { kids: msg('Kids'), grownups: msg('Grown-ups'), everyone: msg('Everyone') }
const LISTEN_WORD: Record<ReadingStatus, string> = { want: msg('wants to listen'), reading: msg('listening'), finished: msg('listened') }
/** Between book scans: long enough to see what was added and pick up the next book. */
const SCAN_PAUSE_MS = 2000
// This device's choice of list or covers (covers until it picks list). The filters aren't kept: a wall that opens on a filtered
// shelf looks like books went missing.
const VIEW_KEY = 'kinwall.libraryView'
const SORT_KEY = 'kinwall.librarySort' // the sort is kept too: it never hides a book
// The shelf (All, Kids, Grown-ups) is kept as well, except while a kid is picked: they get Kids.
const SHELF_KEY = 'kinwall.libraryShelf'
const SHELF_PICKS = Object.keys(SHELF_LABEL) as ShelfPick[]
const STATUSES = Object.keys(STATUS_LABEL) as LibraryStatus[]
const FORMATS = Object.keys(FORMAT_LABEL) as LibraryFormat[]
const SORTS = Object.keys(SORT_LABEL) as LibrarySort[]
const stored = (key: string) => { try { return localStorage.getItem(key) } catch { return null } }
const store = (key: string, v: string) => { try { localStorage.setItem(key, v) } catch { /* storage blocked: just this visit */ } }
const errMsg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback)

export default function Library({ bar, adding, onAdded, onStarted }: {
  bar?: HTMLElement | null // where the search and Filters go (the row with the view picker); null until it's there
  adding: boolean // the + button: Add a book sheet
  onAdded: () => void // closes it
  onStarted: () => void // a reading entry was started: the shelves reload
}) {
  const { members, toast, parentDevice, focusLocked, meMemberId, refreshTick, settings, selectedMemberId } = useApp()
  const today = todayKeyInTz(settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
  const kid = !parentDevice && focusLocked ? meMemberId : null
  // A kid's own device, or a wall with a kid picked in the header, opens on the Kids shelf.
  const kidView = !!kid || members.find(m => m.id === selectedMemberId)?.grownUp === false
  // A pick lasts while it's the same kind of view (picking a kid in the header starts them on Kids again).
  const [picked, setPicked] = useState<{ v: ShelfPick; kidView: boolean } | null>(null)
  const shelf = picked && picked.kidView === kidView ? picked.v : startShelf(stored(SHELF_KEY), kidView)
  const pickShelf = (v: ShelfPick) => { setPicked({ v, kidView }); if (!kidView) store(SHELF_KEY, v) }
  const [all, setAll] = useState<LibraryBook[] | null>(null) // what the filters need, before filtering
  const [q, setQ] = useState('')
  const [filters, setFilters] = useState<LibraryFilters>(NO_FILTERS)
  const [sources, setSources] = useState<string[]>([]) // every place a book was borrowed from, for the pickers
  const [places, setPlaces] = useState<string[]>([]) // every place a book lives, for the filter and the picker
  const [open, setOpen] = useState<LibraryBook | null>(null)
  const [scanning, setScanning] = useState(false)
  const isPhone = useIsPhone()
  const [filtering, setFiltering] = useState(false) // the Filters sheet
  const [view, setView] = useState<'list' | 'covers'>(() => stored(VIEW_KEY) === 'list' ? 'list' : 'covers')
  // null until one is picked: the server's A-Z (Title), or Borrowed alone's soonest due first.
  const [sort, setSort] = useState<LibrarySort | null>(() => { const v = stored(SORT_KEY); return SORTS.includes(v as LibrarySort) ? v as LibrarySort : null })
  const pickSort = (v: LibrarySort) => { setSort(v); store(SORT_KEY, v) }
  // The books we have (search on the server), plus returned ones and the wishlist when a filter asks
  // for them (the server leaves both out otherwise); filterLibrary does the rest.
  const need = libraryNeeds(filters)
  const load = () => Promise.all([{ q }, ...(need.returned ? [{ q, returned: true }] : []), ...(need.wanted ? [{ q, wanted: true }] : [])].map(f => api.getLibrary(f))).then(lists => {
    const b = [...new Map(lists.flat().map(x => [x.id, x])).values()]
    setAll(b)
    const more = (old: string[], add: (string | null)[]) => [...new Set([...old, ...add.filter((l): l is string => !!l)])].sort((a, z) => a.localeCompare(z))
    setPlaces(p => more(p, b.map(x => x.location)))
    setSources(s => more(s, b.map(x => x.borrowedFrom)))
  }).catch(e => { setAll([]); toast(errMsg(e, t("Couldn't load the library")), true) })
  useEffect(() => { const t = setTimeout(load, q ? 250 : 0); return () => clearTimeout(t) }, [q, need.returned, need.wanted, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps
  const shelved = all && all.filter(b => onShelf(b, shelf))
  const books = shelved && (sort ? sortLibrary(filterLibrary(shelved, filters), sort) : filterLibrary(shelved, filters))
  // #/trackers/library?book=<id> (a Reading entry's "Open in the library"): that book's sheet once the
  // library is in, looking among returned and wishlist books too; an unknown id just shows the library.
  // #/trackers/library?add=<title>&author=<author> (the Add to Kinwall Shortcut, when Open Library had no
  // one clear match): the Add a book sheet with what was shared, to look it up and pick.
  const [linkedAdd, setLinkedAdd] = useState<{ title: string; author: string; pages: null; coverUrl: null } | null>(null)
  useEffect(() => {
    const q = hashQuery(location.hash)
    const title = q.get('add')
    if (!title) return
    history.replaceState(history.state, '', hashPath(location.hash))
    setLinkedAdd({ title, author: q.get('author') ?? '', pages: null, coverUrl: null })
  }, [])
  useEffect(() => {
    const id = hashQuery(location.hash).get('book')
    if (!all || !id) return
    history.replaceState(history.state, '', hashPath(location.hash))
    const b = all.find(x => x.id === id)
    if (b) setOpen(b)
    else Promise.all([{ returned: true }, { wanted: true }].map(f => api.getLibrary(f))).then(l => { const f = l.flat().find(x => x.id === id); if (f) setOpen(f) }).catch(() => {})
  }, [all])

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
          if (!isbn) toast(t("That's not a book's barcode"))
          else try { const b = await api.addToLibrary({ isbn }); seen.push(b); toast(t('Added: {title}', { title: b.title })); announce(t('Added {title}', { title: b.title })) }
          catch (e) {
            const have = e instanceof ApiError && e.status === 409
              ? (await Promise.all([{}, { returned: true }, { wanted: true }].map(f => api.getLibrary(f))).catch(() => [[]])).flat().find(b => b.isbn === isbn)
              : undefined
            if (have) { seen.push(have); toast(t('Already in the library: {title}', { title: have.title })) }
            else toast(errMsg(e, t("Couldn't add that book")))
          }
        }
        await new Promise(r => setTimeout(r, SCAN_PAUSE_MS))
      }
    } finally { setScanning(false) }
    if (seen.length) load()
    if (seen.length === 1) setOpen(seen[0])
  }

  const toggle = (k: keyof LibraryFilters, v: string) => setFilters(f => ({ ...f, [k]: (f[k] as string[]).includes(v) ? (f[k] as string[]).filter(x => x !== v) : [...f[k], v] }))
  const people = members
  // What's on, as chips under the search (✕ drops one): Show, then Format, then Where, then Who, then Genre.
  const active = [
    ...filters.show.map(s => ({ k: 'show' as const, v: s as string, label: tm(STATUS_LABEL[s]) })),
    ...filters.formats.map(f => ({ k: 'formats' as const, v: f as string, label: tm(FORMAT_LABEL[f]) })),
    ...filters.places.map(p => ({ k: 'places' as const, v: p, label: `📍 ${p}` })),
    ...filters.who.map(id => ({ k: 'who' as const, v: id, label: people.find(m => m.id === id)?.name ?? t('Family') })),
    ...filters.genres.map(g => ({ k: 'genres' as const, v: g, label: `🏷️ ${g}` })),
  ].map(a => ({ ...a, face: a.k === 'who' ? people.find(m => m.id === a.v) : undefined }))
  const on = active.length
  // The Filters button's badge counts a sort other than Title too: sort and filters share its sheet.
  const sorted = !!sort && sort !== 'title'
  const badge = on + (sorted ? 1 : 0)
  const genres = genreOptions(shelved ?? [], filters.genres)
  const group = (id: string, label: string, chips: ReactNode, hint: string) => (
    <div className="field">
      <label id={id}>{label}</label>
      <div className="chip-row" role="group" aria-labelledby={id}>{chips}</div>
      <p className="field-hint">{hint}</p>
    </div>
  )
  const chip = (k: keyof LibraryFilters, v: string, label: ReactNode, color?: string) => {
    const pressed = (filters[k] as string[]).includes(v)
    return <button key={v} type="button" className={`chip ${pressed ? 'active' : ''}`} aria-pressed={pressed} style={color ? { ['--chip-color' as string]: color } : undefined} onClick={() => toggle(k, v)}>{label}</button>
  }
  const shown = books?.length ?? 0
  const scan = appBarcodeScanner() && <button type="button" className="btn btn-secondary lib-scan" onClick={scanBooks} disabled={scanning} aria-label={isPhone ? t('Scan books') : undefined}>📷{isPhone ? '' : ` ${t('Scan books')}`}</button>
  // One row: the count, small, the filters that are on (wrapping if there are many), and the
  // view switch, icons only on a phone (Library view words from 700px); on a phone 📷 Scan joins it.
  const head = <div className="lib-head">
    <Segmented className="lib-shelf-pick" label={t('Shelf')} value={shelf} onChange={pickShelf} options={SHELF_PICKS.map(k => ({ key: k, label: tm(SHELF_LABEL[k]) }))} />
    <span className="lib-count">{(() => {
      const a = books?.filter(isAudio).length ?? 0, p = shown - a
      const part = (emoji: string, text: string) => <><span className="lib-count-emoji" aria-hidden="true">{emoji} </span>{text}</>
      return <>{(p || !a) && part('📚', tn(p, '{n} book', '{n} books'))}{p > 0 && a > 0 && ' · '}{a > 0 && part('🎧', tn(a, '{n} audiobook', '{n} audiobooks'))}</>
    })()}</span>
    {on > 0 && (
      <div className="chip-row lib-active" role="group" aria-label={t('Sort and filters on')}>
        {active.map(a => <button key={a.k + a.v} type="button" className="chip lib-active-chip" aria-label={t('Remove filter: {filter}', { filter: a.label })} onClick={() => toggle(a.k, a.v)}>{a.face && <ChipFace m={a.face} />}{a.label} <span aria-hidden="true">✕</span></button>)}
      </div>
    )}
    {isPhone && scan}
    <Segmented className="lib-view" label={t('Library view')} value={view} onChange={v => { setView(v); store(VIEW_KEY, v) }}
      options={[
        { key: 'covers', label: <><span aria-hidden="true">📚</span><span className="lib-view-word"> {t('Covers')}</span></>, ariaLabel: t('Covers'), title: t('Covers') },
        { key: 'list', label: <><span aria-hidden="true">☰</span><span className="lib-view-word"> {t('List')}</span></>, ariaLabel: t('List'), title: t('List') },
      ]} />
  </div>
  // The search row; on a phone it goes up beside the view picker (Trackers' bar slot).
  const searchBar = <div className="lib-bar">
    <input type="search" className="lib-search" aria-label={t('Search the library')} placeholder={isPhone ? t('Search the library') : t('Search titles, authors, genres')} value={q} onChange={e => setQ(e.target.value)} />
    <button type="button" className={`icon-btn filter-btn lib-filter-btn ${badge ? 'active' : ''}`} onClick={() => setFiltering(true)} aria-label={filterSortLabel(badge)}>
      <FilterIcon width={20} height={20} />
      {badge > 0 && <span className="filter-badge" aria-hidden="true">{badge}</span>}
    </button>
    {!isPhone && scan}
  </div>
  return (
    <div className="lib">
      {bar === undefined ? searchBar : bar && createPortal(searchBar, bar)}
      {filtering && (
        <Sheet title={t('Filter and sort')} onClose={() => setFiltering(false)} actions={<>
          {on > 0 && <button className="btn btn-secondary" onClick={() => setFilters(NO_FILTERS)}>{t('Clear')}</button>}
          <button className="btn btn-primary" onClick={() => setFiltering(false)}>{t('Done')}</button>
        </>}>
          {group('lib-f-sort', t('Sort by'), SORTS.map(k => {
            const pressed = (sort ?? 'title') === k
            return <button key={k} type="button" className={`chip ${pressed ? 'active' : ''}`} aria-pressed={pressed} onClick={() => pickSort(k)}>{tm(SORT_LABEL[k])}</button>
          }), t('Title keeps a series together, in order. This device remembers the sort.'))}
          {group('lib-f-show', t('Show'), STATUSES.map(s => chip('show', s, tm(STATUS_LABEL[s]))),
            filters.show.length ? t('Books that match any of these.') : t('None picked: the books you have, without returned, wishlist or want-to-read-only ones.'))}
          {group('lib-f-format', t('Format'), FORMATS.map(f => chip('formats', f, tm(FORMAT_LABEL[f]))), t('Paper books, audiobooks, or both.'))}
          {places.length > 0 && group('lib-f-where', t('Where'), places.map(p => chip('places', p, `📍 ${p}`)), t('Where it lives: any of these.'))}
          {people.length > 0 && group('lib-f-who', t('Who'), people.map(m => chip('who', m.id, <><ChipFace m={m} /> {m.name}</>, m.color)), t('On their reading shelf: reading, finished or want to read.'))}
          {genres.length > 0 && group('lib-f-genre', t('Genre'), genres.map(({ genre, count }) => chip('genres', genre, <>{genre} <span className="chip-count">{count}</span></>)), t('Any of these genres. Most common first.'))}
        </Sheet>
      )}
      {head}
      {books === null ? <div className="state-card">{t('Loading…')}</div>
        : view === 'covers' && shown ? <LibraryShelf books={books} members={people} today={today} onOpen={setOpen} split={shelf === 'all'} />
        : !books.length ? (
          <div className="empty-card"><span className="emoji">📚</span>{filters.show.length === 1 && filters.show[0] === 'wishlist' && !q && !on ? t('Nothing on the wishlist. Tap + and pick Wishlist to add a book you want.') : q || on ? t('No books match.') : shelf !== 'all' && all?.length ? t('Nothing on the {shelf} shelf yet. A parent can put a book there from its details.', { shelf: tm(SHELF_LABEL[shelf]) }) : all?.length ? t('Nothing here yet. Open Filters for the wishlist, returned books or want to read.') : t('No books in the library yet. Tap + to add the books you own or borrow, or scan them in.')}</div>
        ) : (
          <ul className="lib-grid">
            {books.map(b => {
              const cover = api.libraryCoverUrl(b)
              const details = bookDetails(b)
              const due = dueLabel(b, today)
              const audio = isAudio(b)
              const narrator = audio ? b.readers.find(r => r.narrator)?.narrator : null
              return (
                <li key={b.id}>
                  <button type="button" className="lib-book" onClick={() => setOpen(b)} aria-label={t('{book}. Details', { book: [b.author ? t('{title} by {author}', { title: b.title, author: b.author }) : b.title, audio ? t('audiobook') : '', b.readers.length ? '' : t('not read yet')].filter(Boolean).join(', ') })}>
                    <BookCover className="lib-cover" src={cover} title={b.title} audio={audio} />
                    <span className="lib-book-text">
                      {/* An audiobook as on the Reading shelves: 🎧 before the title, then who reads it. */}
                      <span className="lib-book-title">{audio && <span aria-hidden="true">🎧 </span>}{b.title}</span>
                      {(b.author || narrator) && <span className="trk-sub">{[b.author, narrator ? t('read by {name}', { name: narrator }) : ''].filter(Boolean).join(' · ')}</span>}
                      {details && <span className="trk-sub">{details}</span>}
                      {!!b.genres.length && <span className="trk-sub lib-genres">{b.genres.join(' · ')}</span>}
                      {b.borrowedFrom && <span className={`trk-sub lib-where ${isOverdue(b, today) ? 'lib-overdue' : ''}`}>{[`📅 ${due ?? t('Borrowed')}`, t('from {place}', { place: b.borrowedFrom })].join(' · ')}</span>}
                      {(b.location || b.lentTo) && <span className="trk-sub lib-where">{[b.lentTo ? `🤝 ${lentLabel(b, today)}` : '', b.location ? `📍 ${b.location}` : ''].filter(Boolean).join(' · ')}</span>}
                      <span className="lib-readers">{b.readers.length
                        ? [...new Map(b.readers.map(r => [r.memberId, r])).values()].slice(0, 4).map(r => { const m = people.find(x => x.id === r.memberId); return <span key={r.entryId} className="chip-static" title={tm(STATUS_TITLE[r.status], { name: m?.name ?? t('Family') })}>{m?.avatar ?? '🏠'} {STATUS_EMOJI[r.status]}</span> })
                        : <span className="trk-tag">{b.wanted ? t('⭐ Wishlist') : t('Not read yet')}</span>}</span>
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
      {linkedAdd && <AddBookSheet places={places} sources={sources} today={today} from={linkedAdd} onClose={() => setLinkedAdd(null)} onAdded={() => { setLinkedAdd(null); load() }} />}
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
    else if (v === 'wanted') save({ wanted: true, ...(book.borrowedFrom && { borrowedFrom: null }) }, t('On the wishlist: {title}', { title: book.title }))
    else if (book.borrowedFrom) save({ borrowedFrom: null }, t('{title} is ours now', { title: book.title }))
    else if (book.wanted) save({ wanted: false }, t('Got it: {title}', { title: book.title }))
  }
  const save = async (changes: Parameters<typeof api.updateLibraryBook>[1], said: string) => {
    try { const b = await api.updateLibraryBook(book.id, changes); toast(said); announce(said); onSaved(b) }
    catch (e) { toast(errMsg(e, t("Couldn't save it")), true) }
  }
  const long = (book.description?.length ?? 0) > 220 // about four lines
  const cover = api.libraryCoverUrl(book)
  const series = seriesLabel(book)
  const facts = [book.year ? t('First published {year}', { year: book.year }) : '', book.pages ? tn(book.pages, '{n} page', '{n} pages') : ''].filter(Boolean).join(' · ')
  const level = readingLevel(book.lexile)
  const listen = listenLabel(book)
  const rating = ratingLabel(book)
  const olUrl = openLibraryUrl(book)
  const audio = isAudio(book)
  const libro = audio ? libroUrl(book) : null
  const [looking, setLooking] = useState(false)
  // A parent's "Look up details": Open Library now, filling only what's empty.
  const lookUp = async () => {
    setLooking(true)
    try { const b = await api.lookUpLibraryBook(book.id); toast(t('Looked up: {title}', { title: b.title })); announce(t('Looked up {title}', { title: b.title })); onSaved(b) }
    catch (e) { toast(errMsg(e, t("Couldn't look it up")), true) }
    finally { setLooking(false) }
  }
  const readIt = async (m: Member) => {
    try {
      // Already reading it (maybe tracked before the book was in the library): link that entry, don't add another.
      const have = existingRead(await api.getTrackers('reading'), m.id, book)
      if (have) {
        const d = have.data as ReadingData
        if (d.bookId === book.id && d.status === 'reading') { toast(t('{name} is already reading {title}', { name: m.name, title: book.title })); return }
        await api.updateTracker(have.id, { data: { bookId: book.id, status: 'reading', ...(!d.coverUrl && book.coverUrl && { coverUrl: book.coverUrl }), ...(!d.totalPages && book.pages && { totalPages: book.pages }) } })
        const said = t('{name} is reading {title}', { name: m.name, title: book.title })
        toast(said); announce(said); onStarted(); return
      }
      await api.addTracker({ kind: 'reading', memberId: m.id, title: book.title, data: {
        format: audio ? 'audiobook' : 'book', status: 'reading', bookId: book.id, ...(book.author && { author: book.author }), ...(!audio && book.pages && { totalPages: book.pages }), ...(book.coverUrl && { coverUrl: book.coverUrl }),
      } })
      const said = t('{name} is reading {title}', { name: m.name, title: book.title })
      toast(said); announce(said); onStarted()
    } catch (e) { toast(errMsg(e, t("Couldn't start it")), true) }
  }
  const remove = async () => {
    try { await api.deleteLibraryBook(book.id); toast(t('Removed: {title}', { title: book.title })); onChanged() }
    catch (e) { toast(errMsg(e, t("Couldn't remove it")), true) }
  }
  return (
    <Sheet title={book.title} onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>{t('Done')}</button>}>
      <div className="lib-detail">
        <BookCover className="lib-detail-cover" src={cover} title={book.title} audio={audio} />
        <div className="lib-detail-text">
          {book.author && <div className="lib-detail-author">{book.author}</div>}
          {series && <div className="lib-detail-series">📚 {series}</div>}
          {facts && <div className="trk-sub">{facts}</div>}
          {level && <div className="trk-sub">{t('Reading level {level}', { level })}</div>}
          {listen && <div className="trk-sub">{listen}</div>}
          {rating && <div className="trk-sub" aria-label={t('Rated {rating} on Open Library', { rating: rating.slice(2) })}>{rating}</div>}
          {!!book.genres.length && <div className="chip-row lib-genre-chips">{book.genres.slice(0, 5).map(g => <span key={g} className="chip chip-static">{g}</span>)}</div>}
        </div>
      </div>
      {book.description && <>
        <p className={`lib-description ${long && !more ? 'lib-description-clamp' : ''}`}>{book.description}</p>
        {long && <button type="button" className="link-btn lib-more" onClick={() => setMore(v => !v)} aria-expanded={more}>{more ? t('Less') : t('More')}</button>}
      </>}
      {(book.isbn || (olUrl && canRemove)) && (
        <p className="trk-sub lib-detail-links">
          {book.isbn && <span>{t('ISBN {isbn}', { isbn: book.isbn })}</span>}
          {libro && canRemove && <a className="text-link" href={libro} target="_blank" rel="noopener noreferrer">{t('🎧 Listen on Libro.fm ↗')}</a>}
          {olUrl && canRemove && <a className="text-link" href={olUrl} target="_blank" rel="noopener noreferrer">{t('View on Open Library ↗')}</a>}{/* parent devices: walls and kids stay in the app */}
        </p>
      )}
      <div className="field">
        <label htmlFor="lib-whose">{t('Whose book')}</label>
        <select id="lib-whose" value={whose} onChange={e => pickWhose(e.target.value)}>
          <option value="ours">{t('Ours')}</option>
          <option value="borrowed">{t('Borrowed')}</option>
          <option value="wanted">{t("Wishlist (don't have it yet)")}</option>
        </select>
        {book.wanted && !picking && <p className="field-hint">{t('Got it? Pick Ours.')}</p>}
      </div>
      <div className="field">
        <label htmlFor="lib-shelf">{t('Shelf')}</label>
        <select id="lib-shelf" value={book.shelf ?? ''} disabled={!canRemove} onChange={e => { const v = (e.target.value || null) as BookShelf | null; save({ shelf: v }, t('Shelf: {shelf}', { shelf: v ? tm(SHELF_WORD[v]) : t('Auto') })) }}>
          <option value="">{book.shelf ? t('Auto') : t('Auto ({shelf})', { shelf: tm(SHELF_WORD[book.effectiveShelf ?? 'grownups']) })}</option>
          {(Object.keys(SHELF_WORD) as BookShelf[]).map(k => <option key={k} value={k}>{tm(SHELF_WORD[k])}</option>)}
        </select>
        <p className="field-hint">{canRemove ? t("Who it's for. Auto goes by its genres, reading level, length and who reads it.") : t("Who it's for. A parent can change it.")}</p>
      </div>
      {picking === 'borrowed' && <BorrowFields sources={sources} today={today} onCancel={() => setPicking(null)}
        onSave={(from, due) => { setPicking(null); save({ borrowedFrom: from, dueOn: due }, t('Borrowed from {place}', { place: from })) }} />}
      {/* An audiobook doesn't live on a shelf or go out on loan. */}
      {!book.wanted && !audio && <PlacePicker value={book.location ?? ''} places={places} onChange={v => save({ location: v || null }, v ? t('Where it lives: {place}', { place: v }) : t('Place cleared: {title}', { title: book.title }))} />}
      {book.wanted || picking ? null : book.borrowedFrom ? (
        <div className="field">
          <label htmlFor="lib-due">{t('Due back to {place}', { place: book.borrowedFrom })}</label>
          {book.returnedOn ? (
            <div className="lib-lent">
              <span>↩️ {dueLabel(book, today)}</span>
              <button type="button" className="btn btn-secondary lib-back" onClick={() => save({ returnedOn: null, dueOn: addDayKeys(today, LOAN_DAYS) }, t('Borrowed {title} again', { title: book.title }))}>{t('Borrow again')}</button>
            </div>
          ) : (
            <div className="lib-lent">
              <input id="lib-due" type="date" aria-label={t('Due back')} value={book.dueOn ?? ''} onChange={e => save({ dueOn: e.target.value || null }, e.target.value ? dueLabel({ ...book, dueOn: e.target.value }, today) ?? '' : t('Due date cleared'))} />
              <button type="button" className="btn btn-secondary lib-back" onClick={() => save({ returnedOn: today }, t('Returned: {title}', { title: book.title }))}>{t('Returned it')}</button>
            </div>
          )}
          {isOverdue(book, today) && <p className="field-hint lib-overdue">{dueLabel(book, today)}</p>}
        </div>
      ) : audio ? null : <div className="field">
        <label htmlFor="lib-lend">{t('Lending')}</label>
        {book.lentTo ? (
          <div className="lib-lent">
            <span>🤝 {lentLabel(book, today)}</span>
            <button type="button" className="btn btn-secondary lib-back" onClick={() => save({ lentTo: null }, t('Back home: {title}', { title: book.title }))}>{t("It's back")}</button>
          </div>
        ) : (
          <div className="weather-search-row">
            <input id="lib-lend" type="text" value={borrower} onChange={e => setBorrower(e.target.value)} placeholder={t('Lend it to… (Grandma, a friend)')} autoComplete="off" maxLength={80}
              onKeyDown={e => { if (e.key === 'Enter' && borrower.trim()) save({ lentTo: borrower.trim() }, t('Lent {title} to {name}', { title: book.title, name: borrower.trim() })) }} />
            <button type="button" className="btn btn-secondary" disabled={!borrower.trim()} onClick={() => save({ lentTo: borrower.trim() }, t('Lent {title} to {name}', { title: book.title, name: borrower.trim() }))}>{t('Lend')}</button>
          </div>
        )}
      </div>}
      <div className="field">
        <label id="lib-readers">{audio ? t('Listened to by') : t('Read by')}</label>
        {book.readers.length ? (
          <ul className="lib-reader-list" aria-labelledby="lib-readers">
            {book.readers.map(r => { const m = everyone.find(x => x.id === r.memberId); return <li key={r.entryId}>{m?.avatar ?? '🏠'} {m?.name ?? t('Family')} <span className="trk-sub">{STATUS_EMOJI[r.status]} {tm((audio ? LISTEN_WORD : STATUS_WORD)[r.status])}</span></li> })}
          </ul>
        ) : <p className="trk-sub">{t('Nobody yet.')}</p>}
      </div>
      <div className="field">
        <label id="lib-read-it">{audio ? t('Listen to it') : t('Read it')}</label>
        <div className="chip-row" role="group" aria-labelledby="lib-read-it">
          {members.map(m => <button key={m.id} type="button" className="chip" style={{ ['--chip-color' as string]: m.color }} onClick={() => readIt(m)}><ChipFace m={m} /> {m.name}</button>)}
        </div>
        <p className="field-hint">{t('Puts it on their Reading shelf, linked to this book.')}</p>
      </div>
      {canRemove && <div className="lib-detail-actions">
        <button type="button" className="btn btn-secondary" onClick={lookUp} disabled={looking}>{looking ? t('Looking up…') : t('🔎 Look up details')}</button>
        <button type="button" className="btn btn-danger" onClick={remove}>{t('Remove from library')}</button>
      </div>}
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
      <label htmlFor="lib-place">{t('Where it lives')}</label>
      {typing ? (
        <div className="weather-search-row">
          <input id="lib-place" type="text" value={draft} onChange={e => setDraft(e.target.value)} placeholder={t("Maya's room, living room shelf…")} autoComplete="off" maxLength={80} autoFocus
            onKeyDown={e => { if (e.key === 'Enter' && draft.trim()) { onChange(draft.trim()); setTyping(false) } }} />
          <button type="button" className="btn btn-secondary" disabled={!draft.trim()} onClick={() => { onChange(draft.trim()); setTyping(false) }}>{t('Save')}</button>
        </div>
      ) : (
        <select id="lib-place" value={value} onChange={e => { if (e.target.value === '\u0000new') { setDraft(''); setTyping(true) } else onChange(e.target.value) }}>
          <option value="">{t('Not set')}</option>
          {options.map(p => <option key={p} value={p}>{p}</option>)}
          <option value={'\u0000new'}>{t('New place…')}</option>
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
        <label htmlFor="lib-from">{t('Borrowed from')}</label>
        <input id="lib-from" type="text" list="lib-sources" value={from} onChange={e => setFrom(e.target.value)} placeholder={t('Town library, a friend…')} autoComplete="off" maxLength={80} />
        <datalist id="lib-sources">{sources.map(s => <option key={s} value={s} />)}</datalist>
      </div>
      <div className="field">
        <label htmlFor="lib-due-new">{t('Due back')}</label>
        <div className="weather-search-row">
          <input id="lib-due-new" type="date" value={due} onChange={e => setDue(e.target.value)} />
        </div>
      </div>
      {onSave && <div className="lib-borrow-actions">
        {onCancel && <button type="button" className="btn btn-secondary" onClick={onCancel}>{t('Cancel')}</button>}
        <button type="button" className="btn btn-primary" disabled={!from.trim()} onClick={() => onSave(from.trim(), due || null)}>{t('Save')}</button>
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
      const said = b.wanted ? t('On the wishlist: {title}', { title: b.title }) : t('Added: {title}', { title: b.title }); toast(said); announce(said); onAdded(b)
    } catch (e) {
      // Already there (the looked-up ISBN): hand back that book, returned ones too.
      const have = e instanceof ApiError && e.status === 409 && picked?.isbn
        ? (await Promise.all([api.getLibrary({ q: title.trim() }), api.getLibrary({ q: title.trim(), returned: true })]).catch(() => [[]])).flat().find(b => b.isbn === picked.isbn)
        : undefined
      if (have) { toast(t('Already in the library: {title}', { title: have.title })); onAdded(have) }
      else toast(errMsg(e, t("Couldn't add it")), true)
    } finally { setBusy(false) }
  }
  return (
    <Sheet title={t('Add a book')} onClose={onClose}
      actions={<button className="btn btn-primary" onClick={add} disabled={!title.trim() || busy || (borrowing && !loan.from)}>{t('Add to library')}</button>}>
      <Segmented label={t('Whose book')} value={whose} onChange={setWhose} options={[{ key: 'ours', label: t('Ours') }, { key: 'borrowed', label: t('Borrowed') }, { key: 'wanted', label: t('Wishlist') }]} />
      <BookLookup initial={title} onPick={b => { setPicked(b); setTitle(b.title); setAuthor(b.author ?? '') }} />
      <div className="field"><label htmlFor="lib-title">{t('Title')}</label><input id="lib-title" type="text" value={title} onChange={e => setTitle(e.target.value)} autoComplete="off" /></div>
      <div className="field"><label htmlFor="lib-author">{t('Author')}</label><input id="lib-author" type="text" value={author} onChange={e => setAuthor(e.target.value)} autoComplete="off" /></div>
      {borrowing && <BorrowFields sources={sources} today={today} onChange={(from, due) => setLoan({ from, due })} />}
      {whose !== 'wanted' && <PlacePicker value={location} places={places} onChange={setLocation} />}
      {picked && picked.title === title.trim() && bookDetails({ series: picked.series ?? null, seriesNumber: picked.seriesNumber ?? null, year: picked.year ?? null, lexile: picked.lexile ?? null, pages: picked.pages ?? null }) && (
        <p className="field-hint">{(d => picked.workKey ? t('{details}. Its description comes too.', { details: d }) : d)(bookDetails({ series: picked.series ?? null, seriesNumber: picked.seriesNumber ?? null, year: picked.year ?? null, lexile: picked.lexile ?? null, pages: picked.pages ?? null }))}</p>
      )}
    </Sheet>
  )
}
