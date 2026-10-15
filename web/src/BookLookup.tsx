import BookCover from './BookCover.tsx'
import { useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { announce } from './a11y.tsx'
import { appBarcodeScanner, scanBarcode, wallCamera } from './native.ts'
import type { BookResult } from './types.ts'
import { t, tn } from './i18n.ts'

/** Look up a book (GET /api/books/search: Open Library, through the server) to fill the form. */
export default function BookLookup({ initial, onPick }: { initial: string; onPick: (b: BookResult) => void }) {
  const { toast, parentDevice, focusLocked, meMemberId } = useApp()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<BookResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const search = async (query = q) => {
    if (query.trim().length < 2) return
    setBusy(true)
    try {
      const r = await api.searchBooks(query.trim())
      setResults(r)
      announce(r.length ? tn(r.length, '{n} book found', '{n} books found') : t('No books found'))
    } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not search for books'), true) } finally { setBusy(false) }
  }
  // In the iPhone/Android app: the camera reads the ISBN off the back of the book.
  const scan = async () => {
    const code = await scanBarcode(wallCamera({ parentDevice, focusLocked, meMemberId }))
    if (!code) return
    setQ(code); setOpen(true); search(code)
  }
  const scanBtn = appBarcodeScanner() && <button type="button" className="btn btn-secondary trk-lookup-btn" onClick={scan}>{t('📷 Scan')}</button>
  if (!open) return (
    <div className="trk-lookup-row">
      <button type="button" className="btn btn-secondary trk-lookup-btn" onClick={() => { setQ(initial); setOpen(true) }}>{t('🔍 Look up a book')}</button>
      {scanBtn}
    </div>
  )
  return (
    <div className="weather-search">
      <div className="weather-search-row">
        <input type="search" aria-label={t('Title, author or ISBN')} placeholder={t('Title, author or ISBN')} value={q} autoFocus
          onChange={e => setQ(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); search() } }} />
        <button type="button" className="btn btn-primary" onClick={() => search()} disabled={busy || q.trim().length < 2}>{busy ? t('Searching…') : t('Search')}</button>
      </div>
      {results && (results.length === 0
        ? <p className="settings-row-sub">{t('No books match. Try fewer words, or type it in below.')}</p>
        : <ul className="weather-results">{results.map((r, i) => {
          const thumb = api.bookThumbUrl(r)
          return (
            <li key={i}>
              <button type="button" className="btn btn-secondary btn-block trk-book-result" onClick={() => { onPick(r); setOpen(false); setResults(null); announce(t('Filled in {title}', { title: r.title })) }}>
                <BookCover className="trk-cover" src={thumb} title={r.title} />
                <span className="trk-book-text">
                  <span className="trk-book-title">{r.title}</span>
                  <span className="trk-sub">{[r.author, r.year, r.pages ? tn(r.pages, '{n} page', '{n} pages') : ''].filter(Boolean).join(' · ')}</span>
                </span>
              </button>
            </li>
          )
        })}</ul>)}
      <p className="settings-row-sub">{t('Looked up by your Kinwall server from Open Library; only what you type is sent.')}</p>
      <div className="trk-lookup-row">
        <button type="button" className="btn btn-secondary trk-lookup-btn" onClick={() => { setOpen(false); setResults(null) }}>{t('Cancel')}</button>
        {scanBtn}
      </div>
    </div>
  )
}
