// Board view: the calendar as a family bulletin board - clock + weather, today, the week ahead,
// what's due, chores, a rotating picture and a quote or fact. Read-mostly; rows open the same
// things they do elsewhere (an event's detail sheet, the list, the chores tab).
import { boardListTiles } from './listSections.ts'
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useHashParam } from './hashQuery.ts'
import { createPortal } from 'react-dom'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import type { Board as BoardData, EventInstance, List, Member, OnlineTidbits, Redemption, SnapshotEvent, TimedChore } from './types.ts'
import { rewardsOn } from './types.ts'
import { zonedParts } from './date.ts'
import { formatTime } from './timeFormat.ts'
import { durationLabel } from './timers.ts'
import { useDeviceAppearance } from './useTheme.ts'
import { useSlideshowPictures } from './Screensaver.tsx'
import { boardSources, nightFieldsFor } from './saverSources.ts'
import { tidbitCardTitle, tidbitCards, tidbitFor, tidbitQuery, tidbitSlot, type Tidbit } from './tidbits.ts'
import { BirthdayRow, ItemRow, dayName } from './Snapshot.tsx'
import TodaysMeals from './TodaysMeals.tsx'
import { boardGoals } from './tempCheck.ts'
import { TakeNowTile, useDueDoses, useTakeNowSlot } from './TakeNow.tsx'
import Sheet from './Sheet.tsx'
import GetStarted from './GetStarted.tsx'
import GetStuffDone from './GetStuffDone.tsx'
import { usePollSlot } from './Polls.tsx'
import { BasketIcon, CartIcon } from './icons.tsx'
import { boardAreas, boardChores, boardFixed, castFit, boardItems, moreLabel, pollHost, rowsThatFit, slotLayout, tidbitCardsThatFit, chipFit, type ChipFit, tileChips, tileColumns, todayOrder, chipWords, withTimedChores } from './boardFit.ts'
import { cardOn, layoutAreas, layoutFor, type BoardCardId, type CardDensity } from './boardLayout.ts'
import { leadOf, leadText } from './leadTime.ts'
import { onMinute } from './minuteTick.ts'
import { clockTimeZone } from './timezone.ts'
import { Face } from './Face'
import { ChoreTimerButton } from './ChoreTimer.tsx'

const REFRESH_MS = 10 * 60_000
// Auto shows the full Chores and Due soon cards only on a board this big (CSS px); smaller boards get the count tiles.
const FULL_W = 1600, FULL_H = 900
const noop = () => {}

function Avatar({ m }: { m: Pick<Member, 'name' | 'color' | 'avatar' | 'picture'> }) {
  return <Face m={m} className="board-avatar" />
}

/** A card's text size in a layout (boardLayout.ts), as a class. */
const densityClass = (d: CardDensity | undefined) => d && d !== 'normal' ? ` board-density-${d}` : ''

/** `foot`: something right under the rows that always shows (the "in Today" slot), taking its space from them. */
function Card({ title, area, link, density, foot, children }: { title: string; area: string; link?: React.ReactNode; density?: CardDensity; foot?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`board-card board-${area}${densityClass(density)}`} aria-label={title}>
      <h3 className="snap-heading">{title}{link}</h3>
      <FitBody title={title}>{children}</FitBody>
      {foot}
    </section>
  )
}

const ROWS = '.snap-list > li, .snap-day-heading'
const MORE_SPACE = 50 // the More button (44px) and the gap above it
/** A card's body that shows the rows that fit its space and a "+3 more" button for the rest, which
 *  opens the whole card in a sheet. Only a wall or tablet Board gives a card a fixed space; on a phone
 *  the card grows to its rows, so everything fits and nothing is cut. */
function FitBody({ title, rows = ROWS, bodyClass = 'board-body', children }: { title: string; rows?: string; bodyClass?: string; children: React.ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const fit = useCallback(() => {
    const w = wrap.current, b = body.current
    if (!w || !b) return
    const els = [...b.querySelectorAll<HTMLElement>(rows)]
    const days = [...b.querySelectorAll<HTMLElement>('.board-day')]
    for (const e of [...els, ...days]) e.hidden = false
    const top = b.getBoundingClientRect().top
    const info = els.map(e => ({ bottom: e.getBoundingClientRect().bottom - top, heading: e.matches('.snap-day-heading') }))
    // A card with bigger or smaller text is zoomed: measure the space as drawn, like the rows.
    const box = w.getBoundingClientRect(), scale = w.clientHeight ? box.height / w.clientHeight : 1
    // On the fixed board, rows that would sit under the add button (Calendar.tsx) go to More instead.
    const fab = w.closest('[data-fixed]') && document.querySelector('.fab')?.getBoundingClientRect()
    const under = fab && fab.left < box.right && fab.right > box.left && fab.top < box.bottom
    const space = under ? Math.max(0, fab.top - 8 - box.top) : box.height
    const shown = rowsThatFit(info, space, MORE_SPACE * scale)
    els.forEach((e, i) => { e.hidden = i >= shown })
    for (const d of days) d.hidden = !!d.querySelector('.snap-day-heading[hidden]') // a day whose rows all went
    setMore(shown < els.length ? moreLabel(info, shown) : null)
  }, [rows])
  useLayoutEffect(fit) // every render: the rows may have changed
  // The body never stretches, so after a cut its own size can't tell it the space grew: watch the card
  // and what shares it too (the slot under it), again each render since the slot may have just come.
  useEffect(() => {
    const w = wrap.current, card = w?.parentElement
    if (!w || !card) return
    const ro = new ResizeObserver(() => fit())
    for (const e of [w, card, ...card.children]) ro.observe(e)
    return () => ro.disconnect()
  })
  return (
    <div ref={wrap} className="board-fit">
      <div ref={body} className={bodyClass}>{children}</div>
      {more && <button className="btn btn-secondary board-more" aria-haspopup="dialog" onClick={() => setOpen(true)}>{more}</button>}
      {open && <Sheet title={title} onClose={() => setOpen(false)}><div className="board-sheet">{children}</div></Sheet>}
    </div>
  )
}

/** One thing in a card's "in Today" slot: shown whole (`full`), as one tappable row (`row`), or as a
 *  small chip sharing one line with the others when space is very tight (`chip`: its icon, then a
 *  `.board-slot-chip-short` count and a `.board-slot-chip-long` one in words, used when they fit: boardFit.ts chipWords). All plain elements
 *  (their sheets live with their owner), since they're also drawn unseen to measure. */
type SlotItem = { key: string; full: React.ReactNode; row: React.ReactNode; chip: React.ReactNode }

/** The "in Today" slot at the foot of a Board card (Today; Coming up or a strip above the cards for a
 *  poll without Today): the small things about today (Take now, today's chores, what's due today, an
 *  open poll), in that order. The card's own rows come first; each item gets at least its row, always
 *  shown, and goes whole when the room left allows (boardFit.ts slotLayout), so nothing is clipped and
 *  no other card is squeezed. Every item and its row is drawn unseen too, to know their heights.
 *  `fixed`: the Board shares out the screen's height (the three-column wall or tablet board). */
function TodaySlot({ fixed, items }: { fixed: boolean; items: SlotItem[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const card = useRef<HTMLElement | null>(null)
  const [whole, setWhole] = useState('') // '1' per item shown whole, or 'chips' ('words': chips with their words)
  const measure = useCallback(() => {
    const el = ref.current, fit = el?.parentElement?.querySelector<HTMLElement>(':scope > .board-fit')
    const unseen = el?.querySelector<HTMLElement>(':scope > .board-slot-measure')
    card.current = el?.parentElement ?? card.current
    if (!el || !fit || !unseen || !fixed) { setWhole(''); if (card.current) card.current.style.minHeight = ''; return }
    // The card's rows at full length: FitBody may have hidden some, shown just to measure and hidden
    // again before anything paints. All measured as drawn, since a card with bigger text is zoomed.
    const body = fit.firstElementChild as HTMLElement
    const cut = [...body.querySelectorAll<HTMLElement>('[hidden]')]
    for (const e of cut) e.hidden = false
    const top = body.getBoundingClientRect().top
    const scale = fit.clientHeight ? fit.getBoundingClientRect().height / fit.clientHeight : 1
    const rows = Math.max(0, ...[...body.children].map(c => c.getBoundingClientRect().bottom - top))
    // What the card needs to show its first one and two rows (and More, when more are left).
    const own = [...body.querySelectorAll<HTMLElement>(ROWS)].filter(e => !e.matches('.snap-day-heading')).map(e => e.getBoundingClientRect().bottom - top)
    const keep = (k: number) => own.length <= k ? rows : own[k - 1] + MORE_SPACE * scale
    for (const e of cut) e.hidden = true
    const [chipRow, wordRow] = [...unseen.querySelectorAll<HTMLElement>(':scope > .board-slot-chips')]
    const hs = [...unseen.children].filter(c => !c.matches('.board-slot-chips')).map(c => c.getBoundingClientRect().height)
    const chips = chipRow.getBoundingClientRect().height, wordsH = wordRow.getBoundingClientRect().height
    const sizes = Array.from({ length: hs.length / 2 }, (_, i) => ({ full: hs[2 * i], row: hs[2 * i + 1] }))
    // The rows don't stretch (the slot follows them), so their space is the card's, under its heading.
    const c = el.parentElement!, box = c.getBoundingClientRect(), padBottom = parseFloat(getComputedStyle(c).paddingBottom)
    const space = box.bottom - padBottom * scale - fit.getBoundingClientRect().top
    const how = slotLayout({ fixed, rows, space, items: sizes, chips, keep: [keep(1), keep(2)] })
    const words = how.chips && chipWords(chips, wordsH, space, keep(1))
    setWhole(how.chips ? (words ? 'words' : 'chips') : how.whole.map(b => b ? '1' : '0').join(''))
    // Never too short for that: the card's rows grow (a grid row grows to a minimum only as a length).
    c.style.minHeight = `${Math.ceil((top - box.top + how.need + (words ? wordsH - chips : 0)) / scale + padBottom)}px`
  }, [fixed])
  useLayoutEffect(measure) // every render: the items or the card's rows may have changed
  useEffect(() => {
    const card = ref.current?.parentElement
    if (!card) return
    const ro = new ResizeObserver(() => measure())
    ro.observe(card)
    return () => ro.disconnect()
  }, [measure])
  if (!items.length) return null
  return (
    <div ref={ref} className="board-slot">
      {whole === 'chips' || whole === 'words' ? <div className={`board-slot-item board-slot-chips ${whole === 'words' ? 'board-slot-words' : ''}`}>{items.map(it => <Fragment key={it.key}>{it.chip}</Fragment>)}</div>
        : items.map((it, i) => <div key={it.key} className="board-slot-item">{whole[i] === '1' ? it.full : it.row}</div>)}
      <div className="board-slot-measure" aria-hidden="true" {...{ inert: '' }}>
        {items.map(it => [<div key={`${it.key}:full`} className="board-slot-item">{it.full}</div>, <div key={`${it.key}:row`} className="board-slot-item">{it.row}</div>])}
        <div className="board-slot-item board-slot-chips">{items.map(it => <Fragment key={it.key}>{it.chip}</Fragment>)}</div>
        <div className="board-slot-item board-slot-chips board-slot-words">{items.map(it => <Fragment key={it.key}>{it.chip}</Fragment>)}</div>
      </div>
    </div>
  )
}

type CountTile = { key: string; href: string; icon: React.ReactNode; name: string; value: string; count: string }

/** The Board's one or two count tiles as chips on the toolbar (`host`, boardFit.ts tileChips): with
 *  their names when they all fit whole, else each its icon and count, else (a phone on its side at a
 *  large text size) the toolbar's Family wall, Polls and Outings buttons drop to their icons too, else (a narrow
 *  portrait tablet) the chips take a row of their own (boardFit.ts chipFit). */
function ToolbarChips({ host, tiles }: { host: HTMLElement | null | undefined; tiles: CountTile[] }) {
  const [fit, setFit] = useState<ChipFit>('names')
  const text = tiles.map(t => t.name + t.count).join()
  useLayoutEffect(() => {
    const bar = host?.parentElement
    if (!host || !bar) return
    // A hidden name or button word still measures its text as scrollWidth. A chip's gaps are 6px with
    // its name, 3px without (styles.css .board-chip), and a button's word sits 8px from its icon.
    const check = () => {
      const chips = [...host.querySelectorAll<HTMLElement>('.board-chip')].map(c => {
        const n = c.querySelector<HTMLElement>('.board-chip-name')
        const named = !!n && n.clientWidth > 0
        return { full: c.offsetWidth + (n && !named ? n.scrollWidth + 6 : 0), short: c.offsetWidth - (n && named ? n.clientWidth + 6 : 0) }
      })
      // The toolbar buttons' words: Family wall's, and Polls' and Outings' (both .polls-btn-label).
      const words = [...bar.querySelectorAll<HTMLElement>('.board-layout-pick > span, .polls-btn-label')]
      const was = (bar.dataset.chips ?? 'names') as ChipFit
      // On their own row, the room is what the toolbar row's other items leave.
      const gap = parseFloat(getComputedStyle(bar).columnGap) || 8
      const others = [...bar.children].filter(c => c !== host && (c as HTMLElement).offsetWidth > 0) as HTMLElement[]
      const row = was === 'wrap' ? bar.clientWidth - parseFloat(getComputedStyle(bar).paddingLeft) * 2 - others.reduce((n, c) => n + c.offsetWidth + gap, 0) : host.clientWidth
      const next = chipFit(chips.map(c => c.full), chips.map(c => c.short), row, words.reduce((n, w) => n + w.scrollWidth + 8, 0), was)
      if (next === 'tight' || next === 'wrap') bar.dataset.chips = next; else delete bar.dataset.chips
      setFit(next === 'wrap' ? chipFit(chips.map(c => c.full), chips.map(c => c.short), host.clientWidth, 0) : next)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(host)
    return () => { ro.disconnect(); delete bar.dataset.chips }
  }, [host, text])
  const names = fit === 'names'
  return host && createPortal(tiles.map(t => (
    <a key={t.key} className={`btn btn-secondary board-chip ${names ? '' : 'board-chip-short'}`} href={t.href} aria-label={`${t.name}: ${t.value}`}>
      <span aria-hidden="true" className="board-chip-icon">{t.icon}</span><span aria-hidden="true" className="board-chip-name">{t.name}</span><span aria-hidden="true" className="board-chip-count">{t.count}</span>
    </a>
  )), host)
}

/** `show`: the calendar's member/category filter, so a focused display's board matches its calendar.
 *  `chipHost`: a spot on the toolbar for one or two count tiles as chips (boardFit.ts tileChips). */
export default function Board({ show, onTap, chipHost }: { show: (e: EventInstance) => boolean; onTap: (e: EventInstance) => void; chipHost?: HTMLElement | null }) {
  const { settings, members, refreshTick, selectedMemberId, focusMemberId, focusShowsShared, parentDevice, meMemberId } = useApp()
  const kidDevice = !parentDevice && !!meMemberId && members.find(m => m.id === meMemberId)?.grownUp === false
  const device = useDeviceAppearance()
  const tz = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const [now, setNow] = useState(() => new Date())
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const stopClock = onMinute(() => setNow(new Date()))
    const refresh = setInterval(() => setTick(t => t + 1), REFRESH_MS)
    return () => { stopClock(); clearInterval(refresh) }
  }, [])
  const [data, setData] = useState<BoardData | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let canceled = false
    api.getBoard(7)
      .then(b => { if (!canceled) { setData(b); setError(false) } })
      .catch(() => { if (!canceled) setError(true) }) // keep showing the last board, if any
    return () => { canceled = true }
  }, [refreshTick, tick])
  // For the tiles: grocery lists' open items and reward requests waiting for a parent.
  const f = settings.features
  const rewards = rewardsOn(settings)
  const [lists, setLists] = useState<List[]>([])
  const [earlierOpen, setEarlierOpen] = useState(false) // Today's events that are over, in a sheet
  const [doing, setDoing] = useHashParam('gsd') // the Checklist card's list, in Get stuff done (in the link: back after a reload)
  const [redemptions, setRedemptions] = useState<Redemption[]>([])
  useEffect(() => {
    let canceled = false
    if (f.lists) api.getLists().then(l => { if (!canceled) setLists(l) }).catch(() => { /* keep the last count */ })
    if (rewards) api.getRedemptions({ status: 'pending' }).then(r => { if (!canceled) setRedemptions(r) }).catch(() => { /* likewise */ })
    return () => { canceled = true }
  }, [refreshTick, tick, f.lists, rewards])
  // Auto: measure the board to decide between full lists and counts.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [big, setBig] = useState(false)
  const [roomFor, setRoomFor] = useState(1) // tidbit cards
  const [boardW, setBoardW] = useState(0)
  const [fixed, setFixed] = useState(false) // the three-column board that shares out the screen's height (styles.css)
  const cast = !!device.cast
  const loaded = !!data
  const meds = useDueDoses()
  const medsSlot = useTakeNowSlot(meds)
  const pollSlot = usePollSlot()
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => {
      setBig(e.contentRect.width >= FULL_W && e.contentRect.height >= FULL_H)
      setRoomFor(tidbitCardsThatFit(e.contentRect.width, e.contentRect.height))
      setBoardW(e.contentRect.width)
      setFixed(boardFixed(e.contentRect.width, matchMedia('(min-height: 700px)').matches, cast))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [loaded, cast])
  // The clock is never squeezed on the fixed board: it's as tall as the time, date and weather it
  // shows (the forecast only where styles.css has room for it), and the other cards give up the space.
  // A grid row grows to an item's minimum only when it's a length, so it's measured.
  const clockRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    const c = clockRef.current
    if (!c) return
    const set = () => {
      const box = c.getBoundingClientRect(), scale = c.offsetHeight ? box.height / c.offsetHeight : 1
      const bottom = Math.max(0, ...[...c.children].map(e => e.getBoundingClientRect().bottom - box.top))
      c.style.minHeight = fixed && bottom ? `${Math.ceil(bottom / scale + parseFloat(getComputedStyle(c).paddingBottom))}px` : ''
    }
    set()
    const ro = new ResizeObserver(set)
    for (const e of c.children) ro.observe(e)
    return () => ro.disconnect()
  }, [fixed, loaded, data?.weather, device.boardLayout, device.boardCustom])
  // A cast screen (a Nest Hub) can't be scrolled from across the room: when the cards' smallest sizes
  // (the clock, Today with its counts) are still taller than the screen, the whole Board is drawn a
  // little smaller (boardFit.ts castFit, --board-fit in styles.css). Measured at full size each time.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const set = () => {
      el.style.removeProperty('--board-fit')
      if (!cast || !fixed) return
      const z = castFit(el.clientHeight, el.scrollHeight)
      if (z < 1) el.style.setProperty('--board-fit', String(z))
    }
    set()
    const ro = new ResizeObserver(set)
    for (const e of el.querySelectorAll(':scope > *, :scope > .board > *')) ro.observe(e)
    return () => ro.disconnect()
  })

  const p = zonedParts(now.toISOString(), tz)
  // Tidbit cards: the family's one (Settings → Quotes & facts) or this device's own (Settings →
  // This display). Online sources are fetched when the day or the choice changes: the family's
  // with no params, as before, and each own card with its sources and categories (one at a time,
  // so a free API isn't asked twice at once). Keyed by query; '' is the family's.
  const own = !!device.tidbitCards?.length
  // A layout (Settings -> This display -> Board layout) places its cards itself; the default arrangement
  // takes as many quote cards as the screen has room for.
  const layout = layoutFor(device.boardLayout, device.boardCustom, settings.boardPresets ?? [])
  const placed = new Set(layout?.columns.flat().map(c => c.id))
  const cards = tidbitCards(settings.tidbits, device.tidbitCards).slice(0, layout ? 3 : roomFor)
  const queries = [...new Set(cards.map(c => tidbitQuery(c) === null ? null : own ? tidbitQuery(c)! : ''))].filter((q): q is string => q !== null)
  const dayKey = `${p.year}-${p.month}-${p.day}`
  const [online, setOnline] = useState<Record<string, OnlineTidbits>>({})
  useEffect(() => {
    let canceled = false
    void (async () => {
      for (const q of queries) {
        try {
          const t = await api.getTidbits(q || undefined)
          if (canceled) return
          setOnline(o => ({ ...o, [q]: t }))
        } catch { /* offline: the built-in lists fill in */ }
      }
    })()
    return () => { canceled = true }
  }, [dayKey, queries.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
  const slot = tidbitSlot(p.hour, p.minute, !!device.lowStim)
  const tidbits = cards.map((c, i) => {
    const q = tidbitQuery(c)
    return tidbitFor(new Date(p.year, p.month - 1, p.day), slot, c, q === null ? null : online[own ? q : ''] ?? null, i)
  })
  const tidbitAreas = ['tidbit', 'tidbit2', 'tidbit3']

  if (!data) return error ? <div className="state-card" role="alert">Couldn't load the board. Check your connection. <button className="btn btn-secondary" onClick={() => setTick(t => t + 1)}>Try again</button></div> : null
  const byId = new Map(members.map(m => [m.id, m]))
  const today = data.today
  const events = data.events.filter(show)
  const w = data.weather
  const wToday = w?.days.find(d => d.date === today)
  const booksDue = data.booksDue ?? [] // an older server sends none
  const later = [...new Set([...events.map(e => e.date), ...data.birthdays.map(b => b.date), ...booksDue.map(b => b.date)])].filter(d => d > today).sort()
  // A borrowed library book due back that day (overdue ones stay on today); opens the library.
  const bookRows = (d: string) => booksDue.filter(b => b.date === d).map(b => (
    <li key={`book:${b.id}`} className={`board-book-due ${b.overdue ? 'lib-overdue' : ''}`}><a href="#/trackers/library"><span aria-hidden="true">📚</span> Return {b.title} to {b.borrowedFrom}{b.overdue ? ' (overdue)' : ''}</a></li>
  ))

  // Due soon and reward requests follow who's shown, like the chores below (a kid's device: only theirs).
  const items = boardItems(data.items, lists, selectedMemberId, focusMemberId, focusShowsShared)
  const rewardRequests = boardChores(redemptions, selectedMemberId, focusMemberId, focusShowsShared).length
  const full = device.boardLists === 'full' || (device.boardLists !== 'counts' && big)
  const listTiles = boardListTiles(lists.filter(l => !focusMemberId || l.memberIds.includes(focusMemberId) || (focusShowsShared && !l.memberIds.length)))
  // Take now shows whenever doses are due, Full lists too: then it's the tiles row's only tile (after the clock on a phone).
  // In a layout, the Chores and Due soon tiles stand in for their cards when those aren't placed.
  const choresTile = f.chores && (layout ? !placed.has('chores') : !full), dueTile = f.lists && (layout ? !placed.has('due') : !full)
  // The tiles about today (Take now, Chores, Due soon) move into Today's slot when the Board shows Today
  // (and the tiles at all: a layout without them, like Kids, keeps them off).
  const todayOn = !layout || placed.has('today')
  const todayTiles = todayOn && (!layout || layout.tiles)
  const tiles = [
    !todayTiles && meds.doses.length > 0 && 'meds', !todayTiles && choresTile && 'chores', !todayTiles && dueTile && 'due', ...(f.lists ? listTiles.map(t => t.type) : []), rewards && rewardRequests > 0 && 'rewards',
  ].filter((t): t is string => !!t)
  // One or two of them (Groceries, Rewards) go on the toolbar as chips rather than stretch across a row.
  const chips = tileChips(tiles, !!chipHost)
  // Whose chores count: a kid's device (or a picked person) sees only theirs, like the Chores tab.
  const chores = boardChores(data.chores, selectedMemberId, focusMemberId, focusShowsShared)
  // Saving for a reward: shown on the person's chores row, or a row of its own when they have no chores today.
  const goalsOnly = !rewards ? [] : members.filter(m => m.rewardGoal && (!selectedMemberId || m.id === selectedMemberId) && !chores.some(c => c.memberId === m.id))
  // What can show at all: a feature that's off, or a quote card with nothing to say, takes its card away.
  // The picture card stays with family photos off: Google Photos or nature pictures (saverSources.ts).
  // The Checklist card: its list, else the first reusable one; gone (or none), the card goes too.
  const checklistId = layout?.columns.flat().find(c => c.id === 'checklist')?.listId
  const checklist = lists.find(l => l.id === checklistId) ?? (checklistId ? undefined : lists.find(l => l.kind === 'reusable'))
  const can = (a: BoardCardId | 'tiles') => a === 'tiles' ? tiles.length > 0 && !chips : !cardOn(a, f) ? false
    : a === 'checklist' ? !!checklist : tidbitAreas.includes(a) ? !!tidbits[tidbitAreas.indexOf(a)] : true
  const custom = layout && layoutAreas(layout, can)
  const shown = custom ? custom.shown : ['clock', 'tiles', 'today', 'meals', 'photo', 'coming', 'due', 'chores', ...tidbitAreas].filter(a =>
    a === 'due' ? f.lists && full : a === 'chores' ? f.chores && full : can(a as BoardCardId | 'tiles'))
  const has = (a: string) => shown.includes(a)
  const dense = (a: string) => custom?.density.get(a)
  const choresLeft = chores.reduce((n, c) => n + c.remaining, 0)
  // Chores with a start time or a timer are rows of their own on Today (withTimedChores), so its
  // summary counts the rest; the Chores card and tiles still count them all.
  const timed = boardChores(data.timedChores ?? [], selectedMemberId, focusMemberId, focusShowsShared)
  const restChores = !timed.length ? chores : chores.map(c => {
    const own = timed.filter(t => t.memberId === c.memberId)
    return { ...c, remaining: c.remaining - own.filter(t => !t.done).length, total: c.total - own.length }
  }).filter(c => c.total > 0)
  const restLeft = restChores.reduce((n, c) => n + c.remaining, 0)
  const overdue = items.filter(i => i.overdue).length
  const dueWeek = items.filter(i => !i.overdue && i.dueDate).length
  const dueToday = items.filter(i => i.overdue || i.dueDate === today)
  const dueLater = items.filter(i => !i.overdue && i.dueDate && i.dueDate > today).length
  const dueSummary = [overdue > 0 && `${overdue} overdue`, dueToday.length - overdue > 0 && `${dueToday.length - overdue} due today`, dueLater > 0 && `${dueLater} later this week`].filter(Boolean).join(' · ')
  const choresPeople = restChores.length > 0 && <span className="board-tile-people">
    {restChores.map(c => (
      <span key={c.memberId ?? 'anyone'} className={`board-tile-person ${c.remaining ? '' : 'done'}`} aria-label={`${c.name ?? 'Anyone'}: ${c.remaining ? `${c.remaining} left` : 'done'}`}>
        <Avatar m={{ name: c.name ?? 'Anyone', color: c.color ?? 'var(--bg)', avatar: c.avatar ?? '⭐', picture: c.memberId ? byId.get(c.memberId)?.picture : null }} />
        <span aria-hidden="true">{c.remaining || '✓'}</span>
      </span>
    ))}
  </span>
  const choresText = restLeft ? `${restLeft} left today` : 'All done ✓'
  const choresName = timed.length ? 'Other chores' : 'Chores'
  const dueRow = <a className="board-slot-row" href="#/lists"><span aria-hidden="true">📝</span><span className="board-slot-row-text">{dueSummary}</span></a>
  // Today's slot, in order: Take now, today's chores, what's due today (the week's still a tap away), an open poll.
  const todaySlot = [
    todayTiles && medsSlot.item,
    todayTiles && choresTile && restChores.length > 0 && {
      key: 'chores',
      chip: <a className="board-slot-chip" href="#/chores" aria-label={`${choresName}: ${choresText}`}><span aria-hidden="true">✅</span><span aria-hidden="true" className="board-slot-chip-text board-slot-chip-short">{restLeft || '✓'}</span><span aria-hidden="true" className="board-slot-chip-text board-slot-chip-long">{!restLeft ? 'All done' : restLeft === 1 ? '1 chore' : `${restLeft} chores`}</span></a>,
      row: <a className="board-slot-row" href="#/chores" aria-label={`${choresName}: ${choresText}`}><span aria-hidden="true">✅</span><span className="board-slot-row-text">{choresName} · {choresText}</span></a>,
      full: <a className="board-slot-full" href="#/chores"><span className="board-slot-head"><span aria-hidden="true">✅</span>{choresName} · {choresText}</span>{choresPeople}</a>,
    },
    todayTiles && dueTile && items.length > 0 && dueSummary && {
      key: 'due',
      chip: <a className="board-slot-chip" href="#/lists" aria-label={`Due: ${dueSummary}`}><span aria-hidden="true">📝</span><span aria-hidden="true" className={`board-slot-chip-text board-slot-chip-short ${overdue ? 'snap-overdue' : ''}`}>{dueToday.length || dueLater}</span><span aria-hidden="true" className={`board-slot-chip-text board-slot-chip-long ${overdue ? 'snap-overdue' : ''}`}>{overdue && overdue === dueToday.length ? `${overdue} overdue` : dueToday.length ? `${dueToday.length} due` : `${dueLater} due soon`}</span></a>,
      row: dueRow,
      full: !dueToday.length ? dueRow : <div className="board-slot-due">
        <a className="board-slot-head board-slot-head-link" href="#/lists"><span aria-hidden="true">📝</span>Due today<span className="board-slot-row-meta">{dueLater > 0 ? `${dueLater} later this week ›` : 'All lists ›'}</span></a>
        <ul className="snap-list">{dueToday.map(i => <ItemRow key={i.id} i={i} today={today} close={noop} />)}</ul>
      </div>,
    },
    pollHost(shown) === 'today' && pollSlot.item,
  ].filter(Boolean) as SlotItem[]
  // Without Today, an open poll goes to the foot of Coming up, else a slim strip above the cards; the
  // other tiles stay in the tile row.
  const pollAlone = pollHost(shown) !== 'today' && pollSlot.item ? [pollSlot.item] : []

  // Groceries, and Shopping while a Shopping list has something on it (one list opens it, several the
  // Lists page), and reward requests: a tile each, or a chip on the toolbar.
  const countTiles: CountTile[] = [
    ...listTiles.filter(t => tiles.includes(t.type)).map(({ type, lists: ls, open }) => {
      const Icon = type === 'groceries' ? BasketIcon : CartIcon
      return {
        key: type, href: ls.length === 1 ? `#/lists?list=${encodeURIComponent(ls[0].id)}` : '#/lists',
        icon: ls.length === 1 && ls[0].emoji ? <span className="emoji-plate" aria-hidden="true">{ls[0].emoji}</span> : <Icon width={16} height={16} aria-hidden="true" />,
        name: ls.length === 1 ? ls[0].name : type === 'groceries' ? 'Groceries' : 'Shopping',
        value: open ? `${open} on the list` : 'Nothing needed', count: open ? `${open}` : '✓',
      }
    }),
    ...(tiles.includes('rewards') ? [{ key: 'rewards', href: '#/rewards', icon: <span aria-hidden="true">🎁 </span>, name: 'Rewards', value: `${rewardRequests} waiting`, count: `${rewardRequests}` }] : []),
  ]

  return (
    <div className="board-scroll" ref={scrollRef} data-fixed={fixed || undefined}>
      <ToolbarChips host={chips ? chipHost : null} tiles={countTiles} />
      <GetStarted />
      {pollHost(shown) === 'strip' && pollAlone.length > 0 && <div className="board-polls"><TodaySlot fixed={false} items={pollAlone} /></div>}
      {medsSlot.sheets}{pollSlot.sheets}
      <div className="board" style={custom ? custom.style : boardAreas(shown)}>
        {has('tiles') && (
          <nav className="board-tiles" aria-label="At a glance" style={{ '--tile-cols': tileColumns(boardW, tiles.length) } as React.CSSProperties}>
            {tiles.includes('meds') && <TakeNowTile {...meds} />}
            {tiles.includes('chores') && (
              <a className="board-tile" href="#/chores">
                <span className="board-tile-label">✅ Chores</span>
                <span className="board-tile-value">{choresLeft ? `${choresLeft} left today` : chores.length ? 'All done ✓' : 'None today'}</span>
                {chores.length > 0 && (
                  <span className="board-tile-people">
                    {chores.map(c => (
                      <span key={c.memberId ?? 'anyone'} className={`board-tile-person ${c.remaining ? '' : 'done'}`} aria-label={`${c.name ?? 'Anyone'}: ${c.remaining ? `${c.remaining} left` : 'done'}`}>
                        <Avatar m={{ name: c.name ?? 'Anyone', color: c.color ?? 'var(--bg)', avatar: c.avatar ?? '⭐', picture: c.memberId ? byId.get(c.memberId)?.picture : null }} />
                        <span aria-hidden="true">{c.remaining || '✓'}</span>
                      </span>
                    ))}
                  </span>
                )}
              </a>
            )}
            {tiles.includes('due') && (
              <a className="board-tile" href="#/lists">
                <span className="board-tile-label">📝 Due soon</span>
                <span className="board-tile-value">
                  {!overdue && !dueWeek ? 'All caught up' : <>{overdue > 0 && <span className="snap-overdue">{overdue} overdue</span>}{overdue > 0 && dueWeek > 0 && ' · '}{dueWeek > 0 && <span>{dueWeek} due this week</span>}</>}
                </span>
              </a>
            )}
            {countTiles.map(t => (
              <a key={t.key} className="board-tile" href={t.href}>
                <span className="board-tile-label">{t.icon}{t.name}</span>
                <span className="board-tile-value">{t.value}</span>
              </a>
            ))}
          </nav>
        )}
        {has('clock') && <section ref={clockRef} className={`board-card board-clock${densityClass(dense('clock'))}`} aria-label="Time and weather">
          {/* A phone puts today's weather beside the time (styles.css); everywhere else it stacks below. */}
          <div className="board-clock-top">
            <div className="board-clock-when">
              <div className="board-time">{formatTime(now, clockTimeZone(tz, device))}</div>
              <div className="board-date">{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: clockTimeZone(tz, device) }).format(now)}</div>
            </div>
            {w && (
              <div className="board-weather" role="group" aria-label={`Weather in ${w.location}`}>
                <div className="board-wx-where snap-dim">{w.location}</div>
                <div className="board-weather-now">
                  {w.now && <><span className="board-wx-now"><span className="board-wx-emoji board-wx-big" aria-hidden="true">{w.now.emoji}</span><strong className="board-wx-temp">{w.now.temp}°</strong></span> <span className="board-wx-text">{w.now.text}</span></>}
                  {wToday && <span className="snap-dim board-wx-range"><span className="board-wx-sep" aria-hidden="true"> · </span><span className="board-wx-unit"><span className="sr-only">high </span>{wToday.high}° / <span className="sr-only">low </span>{wToday.low}°</span>{wToday.rainChance ? <><span className="board-wx-sep" aria-hidden="true"> ·</span> <span className="board-wx-unit">💧{wToday.rainChance}%</span></> : ''}</span>}
                </div>
              </div>
            )}
          </div>
          {w && (
            <ul className="board-forecast" aria-label="Forecast">
              {w.days.filter(d => d.date > today).slice(0, 4).map(d => (
                <li key={d.date}>
                  <span className="board-forecast-day">{dayName(d.date, { weekday: 'short' })}</span>
                  <span className="board-wx-emoji" aria-hidden="true">{d.emoji}</span>
                  <span className="sr-only">{d.text}, </span>
                  <span>{d.high}° <span className="snap-dim">{d.low}°</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>}

        {has('today') && <Card title="Today" area="today" density={dense('today')} foot={<TodaySlot fixed={fixed} items={todaySlot} />}>
          {(() => {
            const bdays = data.birthdays.filter(b => b.date === today)
            const todays = todayOrder(events.filter(e => e.date === today), now.getTime())
            // Temp check goals, for the people who chose to show theirs.
            const goals = !f.checkIns ? [] : boardGoals(members, focusMemberId, { selected: selectedMemberId, kidDevice }).map(m => (
              <li key={`goal:${m.id}`} className="board-goal-line"><Avatar m={m} /><span><span className="sr-only">{m.name}'s goal: </span>🎯 {m.todayGoal}</span></li>
            ))
            const books = bookRows(today)
            // Chores with a start time or a timer, among the events by time (boardFit.ts withTimedChores).
            const startOf = (e: SnapshotEvent) => { const z = zonedParts(e.start, tz); return e.allDay || `${z.year}-${String(z.month).padStart(2, '0')}-${String(z.day).padStart(2, '0')}` < today ? -1 : z.hour * 60 + z.minute }
            const rows = withTimedChores(todays.shown, startOf, timed)
            if (!bdays.length && !rows.length && !todays.earlier.length && !books.length) return <>{goals.length > 0 && <ul className="snap-list">{goals}</ul>}<p className="snap-empty">Nothing on the calendar today.</p></>
            return (
              <ul className="snap-list">
                {goals}
                {bdays.map(b => <BirthdayRow key={`${b.memberId ?? b.eventId}`} b={b} you="" close={noop} />)}
                {books}
                {rows.map(r => 'event' in r
                  ? <EventLine key={`${r.event.id}:${r.event.start}`} e={r.event} tz={tz} byId={byId} onTap={onTap} />
                  : <ChoreLine key={`chore:${r.chore.id}`} c={r.chore} who={byId.get(r.chore.memberId ?? selectedMemberId ?? '')} />)}
                {todays.earlier.length > 0 && <li><button className="snap-row board-earlier" aria-haspopup="dialog" onClick={() => setEarlierOpen(true)}>
                  {todays.earlier.length === 1 ? '1 event earlier today' : `${todays.earlier.length} events earlier today`}<span aria-hidden="true"> ›</span>
                </button></li>}
              </ul>
            )
          })()}
        </Card>}

        {earlierOpen && <Sheet title="Earlier today" onClose={() => setEarlierOpen(false)}>
          <ul className="snap-list board-sheet">{todayOrder(events.filter(e => e.date === today), now.getTime()).earlier.map(e =>
            <EventLine key={`${e.id}:${e.start}`} e={e} tz={tz} byId={byId} onTap={ev => { setEarlierOpen(false); onTap(ev) }} past />)}</ul>
        </Sheet>}

        {has('meals') && <Card title="Today’s meals" area="meals" density={dense('meals')}><TodaysMeals now={now} meals={data.meals.filter(m => m.date === today)} /></Card>}

        {has('coming') && <Card title="Coming up" area="coming" density={dense('coming')} foot={pollHost(shown) === 'coming' && <TodaySlot fixed={fixed} items={pollAlone} />}>
          {later.length === 0 ? <p className="snap-empty">Nothing planned this week.</p> : later.map(d => {
            const wd = w?.days.find(x => x.date === d)
            const label = dayName(d, { weekday: 'long', month: 'short', day: 'numeric' })
            return (
              <section key={d} className="board-day" aria-label={label}>
                <h4 className="snap-heading snap-day-heading">
                  <span>{label}</span>
                  {wd && <span className="snap-day-weather"><span aria-hidden="true">{wd.emoji}</span><span className="sr-only">{wd.text}, </span> {wd.high}°/{wd.low}°</span>}
                </h4>
                <ul className="snap-list">
                  {data.birthdays.filter(b => b.date === d).map(b => <BirthdayRow key={`${b.memberId ?? b.eventId}`} b={b} you="" close={noop} />)}
                  {bookRows(d)}
                  {events.filter(e => e.date === d).map(e => <EventLine key={`${e.id}:${e.start}`} e={e} tz={tz} byId={byId} onTap={onTap} />)}
                </ul>
              </section>
            )
          })}
        </Card>}

        {has('due') && <Card title="Due soon" area="due" density={dense('due')}>
          {items.length === 0 ? <p className="snap-empty">Nothing due — all caught up.</p> : (
            <ul className="snap-list">
              {items.map(i => {
                const owner = i.memberId ? byId.get(i.memberId) : undefined
                return <ItemRow key={i.id} i={i} today={today} close={noop} after={owner && <span className="board-avatars" aria-label={owner.name}><Avatar m={owner} /></span>} />
              })}
            </ul>
          )}
        </Card>}

        {has('chores') && <Card title="Chores today" area="chores" density={dense('chores')} link={rewards && <a className="board-card-link" href="#/rewards">🎁 Rewards</a>}>
          {chores.length === 0 && !goalsOnly.length ? <p className="snap-empty">No chores today.</p> : (
            <ul className="snap-list">
              {chores.map(c => {
                const done = c.total - c.remaining
                const name = c.name ?? 'Anyone'
                const waiting = c.pending ? `${c.pending} waiting for OK` : '' // ticked, not counted until a parent approves
                const goal = rewards && c.memberId ? goalText(byId.get(c.memberId)) : null
                return (
                  <li key={c.memberId ?? 'anyone'}>
                    <button className="snap-row board-chore" onClick={() => { location.hash = '#/chores' }} aria-label={`${name}: ${c.remaining ? `${c.remaining} of ${c.total} chores left` : 'all chores done'}${waiting ? `, ${waiting}` : ''}${goal ? `, ${goal.label}` : ''}`}>
                      <Avatar m={{ name, color: c.color ?? 'var(--bg)', avatar: c.avatar ?? '⭐', picture: c.memberId ? byId.get(c.memberId)?.picture : null }} />
                      <span className="snap-main">
                        <span className="snap-title">{name}</span>
                        <span className="board-meter" aria-hidden="true"><span style={{ width: `${(done / c.total) * 100}%`, background: c.color ?? 'var(--accent)' }} /></span>
                        {goal && <span className="snap-meta board-goal" aria-hidden="true">{goal.text}</span>}
                      </span>
                      <span className="board-chore-count" aria-hidden="true">{c.remaining ? `${c.remaining} left` : '🎉'}{c.pending ? ` · ${c.pending} ⏳` : ''}</span>
                    </button>
                  </li>
                )
              })}
              {goalsOnly.map(m => {
                const goal = goalText(m)!
                return (
                  <li key={m.id}>
                    <button className="snap-row board-chore" onClick={() => { location.hash = `#/rewards/${m.id}` }} aria-label={`${m.name}: ${goal.label}`}>
                      <Avatar m={m} />
                      <span className="snap-main" aria-hidden="true">
                        <span className="snap-title">{m.name}</span>
                        <span className="snap-meta board-goal">{goal.text}</span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>}

        {has('checklist') && checklist && (() => {
          const done = checklist.itemCount - checklist.openCount, total = checklist.itemCount
          return <Card title="Get stuff done" area="checklist" density={dense('checklist')}>
            <ul className="snap-list">
              <li>
                <button className="snap-row board-chore" onClick={() => setDoing(checklist.id)} aria-haspopup="dialog" aria-label={`Get stuff done: ${checklist.name}, ${done} of ${total} done`}>
                  <span className="board-avatar board-checklist-emoji" aria-hidden="true">{checklist.emoji || '📝'}</span>
                  <span className="snap-main" aria-hidden="true">
                    <span className="snap-title">{checklist.name} · {done} of {total}</span>
                    <span className="board-meter"><span style={{ width: `${total ? done / total * 100 : 0}%`, background: checklist.color ?? 'var(--accent)' }} /></span>
                  </span>
                  <span className="board-chore-count" aria-hidden="true">{total && done === total ? '🎉' : 'Start ›'}</span>
                </button>
              </li>
            </ul>
          </Card>
        })()}
        {doing && <GetStuffDone listId={doing} onClose={() => { setDoing(null); setTick(t => t + 1) }} />}

        {has('photo') && <PhotoCard density={dense('photo')} />}

        {tidbits.map((t, i) => t && has(tidbitAreas[i]) && (
          <TidbitCard density={dense(tidbitAreas[i])} key={`${i}:${t.kind === 'trivia' ? t.question : t.text}`} tidbit={t} area={tidbitAreas[i]} title={own ? tidbitCardTitle(cards[i]) : undefined} heading={cards[i].sources.length > 1} />
        ))}
      </div>
    </div>
  )
}

/** "🍿 Movie night 40 / 100" (or "Ready!" once they have enough) for someone saving for a reward. */
function goalText(m: Member | undefined): { text: string; label: string } | null {
  const g = m?.rewardGoal
  if (!m || !g) return null
  const name = g.emoji ? `${g.emoji} ${g.title}` : g.title
  const ready = m.balance >= g.cost
  return {
    text: ready ? `${name} · Ready!` : `${name} ${Math.max(0, m.balance)} / ${g.cost}`,
    label: ready ? `saving for ${g.title}, has enough points` : `saving for ${g.title}, ${m.balance} of ${g.cost} points`,
  }
}

function TidbitBody({ trivia, fitKey, title, children }: { trivia: boolean; fitKey: string; title: string; children: React.ReactNode }) {
  if (trivia) return <div className="board-fit"><div className="board-tidbit-body board-trivia-body">{children}</div></div>
  return <FitBody key={fitKey} title={title} rows=".board-tidbit-body > *" bodyClass="board-tidbit-body">{children}</FitBody>
}

/** A quote / fact card. Trivia shows its question as tappable choices: a tap marks that guess
 *  right or wrong and highlights the answer, and Try again resets it for the next person. Online
 *  tidbits credit their source. With several cards each has a `title` from what it shows, shown
 *  as a `heading` when the card mixes sources; `area` is its grid slot (tidbit, tidbit2, tidbit3). */
function TidbitCard({ tidbit, area, title, heading, density }: { tidbit: Tidbit; area: string; title?: string; heading: boolean; density?: CardDensity }) {
  const [guess, setGuess] = useState<string | null>(null) // resets with each tidbit: the parent keys the card by it
  const key = tidbit.kind === 'trivia' ? tidbit.question : tidbit.text
  const label = tidbit.kind === 'quote' ? 'Quote' : tidbit.kind === 'trivia' ? 'Trivia' : tidbit.kind === 'onthisday' ? 'On this day' : tidbit.kind === 'tip' ? 'Try this' : 'Did you know?'
  return (
    <section className={`board-card board-tidbit ${area === 'tidbit' ? '' : 'board-tidbit-extra'}${densityClass(density)}`} style={{ gridArea: area }} aria-label={title ?? label}>
      {title && heading && <h3 className="snap-heading">{title}</h3>}{/* one source: its tag already says what it is */}
      {/* Trivia keeps its answers on the card (answering happens right here), so it never trims rows
          into a "+N more" sheet; when space is tight its body scrolls instead. */}
      <TidbitBody trivia={tidbit.kind === 'trivia'} fitKey={key} title={title ?? label}>
        {tidbit.kind === 'quote' && <blockquote><p>“{tidbit.text}”</p><footer>— {tidbit.by}</footer></blockquote>}
        {tidbit.kind === 'fact' && <p><span className="board-tidbit-tag">💡 Did you know?</span> {tidbit.text}</p>}
        {tidbit.kind === 'tip' && <p><span className="board-tidbit-tag">🌱 Try this</span> {tidbit.text}</p>}
        {tidbit.kind === 'onthisday' && <>
          <p><span className="board-tidbit-tag">{tidbit.type === 'holidays' ? '🎉 Today is' : tidbit.type === 'births' ? `🎂 Born on this day${tidbit.year ? ` in ${tidbit.year}` : ''}` : `📜 On this day${tidbit.year ? ` in ${tidbit.year}` : ''}`}</span> {tidbit.text}</p>
          <p className="board-tidbit-source">From Wikipedia</p>
        </>}
        {tidbit.kind === 'trivia' && <>
          <p><span className="board-tidbit-tag">🧠 Trivia · {tidbit.category}</span> {tidbit.question}</p>
          <ul className="board-trivia-choices">
            {tidbit.choices.map(c => (
              <li key={c}>
                <button type="button" disabled={guess !== null} onClick={() => setGuess(c)}
                  className={guess === null ? '' : c === tidbit.answer ? 'correct' : c === guess ? 'wrong' : ''}>
                  {guess !== null && c === tidbit.answer && <span aria-hidden="true">✓ </span>}
                  {guess === c && c !== tidbit.answer && <span aria-hidden="true">✗ </span>}
                  {c}
                </button>
              </li>
            ))}
          </ul>
          <p className="board-tidbit-source" role="status">
            {guess === null ? 'Tap an answer · ' : guess === tidbit.answer ? '🎉 That’s right! · ' : `Not quite: it’s ${tidbit.answer} · `}From Open Trivia DB
          </p>
          {guess !== null && <button className="btn btn-secondary" onClick={() => setGuess(null)}>Try again</button>}
        </>}
      </TidbitBody>
    </section>
  )
}

/** One event: a bar in the member's color (stripes for several), time, title, avatars. */
function EventLine({ e, tz, byId, onTap, past }: { e: SnapshotEvent; tz: string; byId: Map<string, Member>; onTap: (e: EventInstance) => void; past?: boolean }) {
  const who = e.memberIds.map(id => byId.get(id)).filter((m): m is Member => !!m)
  const bar = who.length > 1
    ? `linear-gradient(${who.map((m, i) => `${m.color} ${(i * 100) / who.length}% ${((i + 1) * 100) / who.length}%`).join(', ')})`
    : who[0]?.color ?? e.color
  const when = e.allDay ? 'All day' : formatTime(e.start, tz)
  return (
    <li>
      <button className={`snap-row board-event ${past ? 'past' : ''}${e.busy === false ? ' ev-free-row' : ''}`} onClick={() => onTap(e)}
        aria-label={[`${when} ${e.title}`, e.busy === false && 'free', who.map(m => m.name).join(' and '), past && 'finished'].filter(Boolean).join(', ')}>
        <span className="board-bar" style={{ background: bar }} aria-hidden="true" />
        <span className="snap-main" aria-hidden="true">
          <span className="board-when">{when}</span>
          <span className="snap-title">{e.busy === false && <span className="ev-free-mark">Free ·</span>}{e.title}</span>
          {(leadOf(e) || e.location) && <span className="snap-meta">{[leadText(e, t => formatTime(t, tz)), e.location && `📍 ${e.location.split('\n')[0]}`].filter(Boolean).join(' · ')}</span>}
        </span>
        {who.length > 0 && <span className="board-avatars" aria-hidden="true">{who.map(m => <Avatar key={m.id} m={m} />)}</span>}
      </button>
    </li>
  )
}

/** A chore with a start time or a timer on Today, like an event: "4:00 PM · 20 min", "🎹 Practice
 *  piano", whose it is, and Start for its timer (ChoreTimer.tsx). Without a timer it opens the Chores tab. */
function ChoreLine({ c, who }: { c: TimedChore; who?: Member }) {
  const when = [c.dueTime ? formatTime(c.dueTime) : 'Today', c.timerMinutes && durationLabel(c.timerMinutes)].filter(Boolean).join(' · ')
  const main = <>
    <span className="board-bar" style={{ background: who?.color ?? 'var(--border)' }} aria-hidden="true" />
    <span className="snap-main" aria-hidden="true">
      <span className="board-when">{when}</span>
      <span className="snap-title">{c.emoji && <span>{c.emoji}</span>}{c.title}</span>
    </span>
    {who && <span className="board-avatars" aria-hidden="true"><Avatar m={who} /></span>}
  </>
  const label = `Chore: ${[c.dueTime && formatTime(c.dueTime), c.title, c.timerMinutes && `${durationLabel(c.timerMinutes)} timer`, who?.name ?? (!c.memberId && 'anyone')].filter(Boolean).join(', ')}`
  if (!c.timerMinutes) return <li><a className="snap-row board-event board-chore-line" href="#/chores" aria-label={label}>{main}</a></li>
  return (
    <li><div className="snap-row board-event board-chore-line" role="group" aria-label={label}>
      {main}
      <ChoreTimerButton chore={c} who={who?.name} />
    </div></li>
  )
}

/** The screensaver's pictures, a new one every minute: this display's sources, or if none are picked
 * the family's own (Google Photos and family photos; nature photos until there are some). */
function PhotoCard({ density }: { density?: CardDensity }) {
  const device = useDeviceAppearance()
  const { refreshTick, settings } = useApp()
  const [hasPhotos, setHasPhotos] = useState(false)
  const nightPicks = nightFieldsFor(device, settings.nightLook).saverSources ?? [] // this screen's Night screen, or the family's
  const picked = nightPicks.length > 0
  useEffect(() => { if (!picked) api.getPhotoQuota().then(q => setHasPhotos(q.count - (q.memoryPhotos ?? 0) > 0)).catch(() => {}) }, [picked, refreshTick])
  const { pics, failed } = useSlideshowPictures(boardSources(nightPicks, { photos: settings.features.photos, paint: settings.features.paint, googlePhotos: settings.googlePhotos }, hasPhotos), 60)
  const current = pics[pics.length - 1]
  return (
    <section className={`board-card board-photo${densityClass(density)}`} aria-label="Picture">
      {!failed && current ? (
        <>
          {/* The whole picture, never cropped (drawings and tall photos lose too much to cover), over a
              blurred, cropped copy of itself so the leftover space isn't empty bars. */}
          {pics.map(p => (
            <div key={p.key} className="board-photo-frame">
              <img className="board-photo-fill" src={p.src} alt="" aria-hidden="true" />
              <img className="board-photo-img" src={p.src} alt={p.caption ?? ''} />
            </div>
          ))}
          {/* The same caption the Night screen shows under its clock; the image's alt already reads it. */}
          {current.caption && <div key={current.key} className="board-caption" aria-hidden="true"><span>{current.caption}</span></div>}
        </>
      ) : <div className="board-photo-empty" aria-hidden="true">🖼️</div>}
    </section>
  )
}
