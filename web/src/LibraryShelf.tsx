// The library's cover view (Library.tsx): the books standing on wooden shelves, covers only. A book
// with no cover (or one that won't load) gets a cloth cover with its title. Borrowed books carry a
// library-card due tag, wishlist books a ⭐ ribbon (on their own shelf at the end), and a book someone
// is reading has a bookmark with their face. "Pick a book for me" scans the shelf and lands on one.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api } from './api.ts'
import { announce, reducedMotion } from './a11y.tsx'
import { Face } from './Face'
import { bookLean, clothColor, dueTag, pickBook } from './library.ts'
import type { LibraryBook, Member } from './types.ts'

const SCAN_STEPS = 12
const SCAN_STEP_MS = 90
const LAND_MS = 900 // the picked book glows this long before its sheet opens

export default function LibraryShelf({ head, books, wish, members, today, onOpen }: {
  head: ReactNode // the count and view toggles; Pick a book joins them
  books: LibraryBook[]; wish: LibraryBook[]; members: Member[]; today: string; onOpen: (b: LibraryBook) => void
}) {
  const [lit, setLit] = useState<string | null>(null) // the book the scan is on
  const [picked, setPicked] = useState<string | null>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach(clearTimeout), [])
  const later = (fn: () => void, ms: number) => { timers.current.push(window.setTimeout(fn, ms)) }

  const pick = () => {
    const shelf = books.filter(b => !b.wanted && !b.returnedOn)
    const chosen = pickBook(shelf)
    if (!chosen) return
    timers.current.forEach(clearTimeout); timers.current = []
    setPicked(null)
    const land = () => {
      setLit(null); setPicked(chosen.id); announce(`Picked: ${chosen.title}`)
      document.getElementById(`lib-shelf-${chosen.id}`)?.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' })
      later(() => { setPicked(null); onOpen(chosen) }, LAND_MS)
    }
    if (reducedMotion() || shelf.length < 2) { land(); return }
    for (let i = 0; i < SCAN_STEPS; i++) later(() => setLit(shelf[(i * 5 + Math.floor(Math.random() * 3)) % shelf.length].id), i * SCAN_STEP_MS * (1 + i / SCAN_STEPS))
    later(land, SCAN_STEPS * SCAN_STEP_MS * 2)
  }

  const book = (b: LibraryBook) => <ShelfBook key={b.id} b={b} members={members} today={today} lit={lit === b.id} picked={picked === b.id} onOpen={onOpen} />
  return (
    <div className="lib-shelves">
      <div className="lib-head">
        {head}
        {books.some(b => !b.wanted && !b.returnedOn) && (
          <button type="button" className="btn btn-secondary lib-pick-btn" onClick={pick} disabled={!!lit}>🎲 Pick a book for me</button>
        )}
      </div>
      {!!books.length && <ul className="lib-shelf" aria-label="Books">{books.map(book)}</ul>}
      {!!wish.length && <>
        <h3 className="lib-shelf-name">⭐ Wishlist</h3>
        <ul className="lib-shelf" aria-label="Wishlist">{wish.map(book)}</ul>
      </>}
    </div>
  )
}

function ShelfBook({ b, members, today, lit, picked, onOpen }: {
  b: LibraryBook; members: Member[]; today: string; lit: boolean; picked: boolean; onOpen: (b: LibraryBook) => void
}) {
  const [broken, setBroken] = useState(false)
  const cover = broken ? null : api.libraryCoverUrl(b)
  const { tilt, height } = bookLean(b.id)
  const due = dueTag(b, today)
  const readers = [...new Set(b.readers.filter(r => r.status === 'reading').map(r => r.memberId))]
    .map(id => members.find(m => m.id === id)).filter((m): m is Member => !!m).slice(0, 2)
  const name = [
    `${b.title}${b.author ? ` by ${b.author}` : ''}`,
    due, b.wanted ? 'on the wishlist' : null,
    readers.length ? `${readers.map(m => m.name).join(' and ')} ${readers.length > 1 ? 'are' : 'is'} reading it` : null,
  ].filter(Boolean).join(', ')
  return (
    <li id={`lib-shelf-${b.id}`} className="lib-slot">
      <button type="button" className={`lib-spine ${lit ? 'lit' : ''} ${picked ? 'picked' : ''}`} aria-label={name} onClick={() => onOpen(b)}
        style={{ ['--tilt' as string]: `${tilt}deg`, ['--h' as string]: height / 100 }}>
        {cover
          ? <img className="lib-spine-cover" src={cover} alt="" loading="lazy" onError={() => setBroken(true)} />
          : (
            <span className="lib-spine-cover lib-cloth" style={{ background: clothColor(b.title) }} aria-hidden="true">
              <span className="lib-cloth-title">{b.title}</span>
              {b.author && <span className="lib-cloth-author">{b.author}</span>}
            </span>
          )}
        {readers.length > 0 && (
          <span className="lib-marks" aria-hidden="true">
            {readers.map(m => <span key={m.id} className="lib-mark" style={{ background: m.color }}><Face m={m} className="lib-mark-face" /></span>)}
          </span>
        )}
        {b.wanted && <span className="lib-ribbon" aria-hidden="true">⭐</span>}
        {due && <span className={`lib-card-tag ${due === 'Overdue' ? 'lib-overdue' : ''}`} aria-hidden="true">{due}</span>}
      </button>
    </li>
  )
}
