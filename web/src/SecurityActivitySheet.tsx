// Settings → Access → Security activity → View: every event by day, searched and filtered on the
// server (so it covers the whole year, not just the pages loaded), loading more as you scroll.
import { useEffect, useId, useRef, useState } from 'react'
import { useApp } from './AppContext.tsx'
import { api } from './api.ts'
import Sheet from './Sheet.tsx'
import { formatTime } from './timeFormat.ts'
import { SECURITY_FILTERS, SECURITY_PAGE, groupByDay, securityLine, type SecurityFilter } from './securityActivity.ts'
import type { SecurityEvent } from './types.ts'

export default function SecurityActivitySheet({ onClose }: { onClose: () => void }) {
  const { members } = useApp()
  const searchId = useId()
  const [query, setQuery] = useState('')
  const [q, setQ] = useState('') // query, once typing pauses
  useEffect(() => { const t = setTimeout(() => setQ(query.trim()), 250); return () => clearTimeout(t) }, [query])
  const [filter, setFilter] = useState<SecurityFilter>('all')
  const kinds = SECURITY_FILTERS.find(f => f.key === filter)!.kinds
  const [events, setEvents] = useState<SecurityEvent[] | null>(null)
  const [more, setMore] = useState(false)

  // A new search or filter starts over from the newest; answers to an older one are dropped.
  const run = useRef(0)
  const loading = useRef(false)
  useEffect(() => {
    const mine = ++run.current
    loading.current = false
    setEvents(null)
    setMore(false)
    api.getSecurityEvents({ q, kinds })
      .then(page => { if (mine === run.current) { setEvents(page); setMore(page.length === SECURITY_PAGE) } })
      .catch(() => { if (mine === run.current) setEvents([]) })
  }, [q, filter]) // eslint-disable-line react-hooks/exhaustive-deps -- kinds follows filter

  const loadMore = () => {
    const last = events?.at(-1)
    if (!last || !more || loading.current) return
    const mine = run.current
    loading.current = true
    api.getSecurityEvents({ q, kinds, before: last.id })
      .then(page => { if (mine === run.current) { setEvents(e => [...(e ?? []), ...page]); setMore(page.length === SECURITY_PAGE) } })
      .catch(() => {})
      .finally(() => { if (mine === run.current) loading.current = false })
  }

  // The Load more button doubles as the scroll sentinel: near the bottom, it loads itself.
  const sentinel = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) loadMore() }, { rootMargin: '200px' })
    io.observe(el)
    return () => io.disconnect()
  }, [events, more]) // eslint-disable-line react-hooks/exhaustive-deps -- loadMore reads only these

  const narrowed = q !== '' || filter !== 'all'
  const status = events === null ? 'Loading…'
    : events.length === 0 ? (narrowed ? 'Nothing matches' : 'No security activity yet')
    : `${events.length}${more ? '+' : ''} ${events.length === 1 ? 'event' : 'events'}`

  return (
    <Sheet title="Security activity" onClose={onClose}>
      <div className="field">
        <label htmlFor={searchId} className="sr-only">Search security activity</label>
        <input id={searchId} type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Search names, devices, passkeys…" autoComplete="off" />
      </div>
      <div className="chip-row security-filters" role="group" aria-label="Show">
        {SECURITY_FILTERS.map(f => (
          <button key={f.key} type="button" className={`chip ${filter === f.key ? 'active' : ''}`} aria-pressed={filter === f.key} onClick={() => setFilter(f.key)}>{f.label}</button>
        ))}
      </div>
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      {/* Tall enough that a short result doesn't shrink the sheet and move the search box while typing. */}
      <div className="security-results">
      {events?.length === 0 && <p className="settings-row-sub">{status}</p>}
      {events && groupByDay(events).map(g => (
        <section key={g.day} aria-label={g.day}>
          <h3 className="settings-row-label device-kind-title">{g.day}</h3>
          <ul className="security-list">
            {g.events.map(e => {
              const line = securityLine(e, members)
              return (
                <li key={e.id} className="key-item">
                  <span className="security-icon" aria-hidden>{line.icon}</span>
                  <div className="key-item-info">
                    <div className="settings-row-label">{line.text}</div>
                    <div className="settings-row-sub"><time dateTime={e.at}>{formatTime(e.at)}</time></div>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
      {more && <button ref={sentinel} type="button" className="btn btn-secondary" onClick={loadMore}>Load more</button>}
      </div>
    </Sheet>
  )
}
