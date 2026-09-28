// Board view: the calendar as a family bulletin board - clock + weather, today, the week ahead,
// what's due, chores, a rotating picture and a quote or fact. Read-mostly; rows open the same
// things they do elsewhere (an event's detail sheet, the list, the chores tab).
import { useEffect, useRef, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import type { Board as BoardData, EventInstance, List, Member, OnlineTidbits, SnapshotEvent } from './types.ts'
import { inkFor } from './color.ts'
import { formatTime, zonedParts } from './date.ts'
import { useDeviceAppearance } from './useTheme.ts'
import { useSlideshowPictures } from './Screensaver.tsx'
import { tidbitFor, type Tidbit } from './tidbits.ts'
import { BirthdayRow, ItemRow, dayName } from './Snapshot.tsx'
import TodaysMeals from './TodaysMeals.tsx'

const REFRESH_MS = 10 * 60_000
// Auto shows the full Chores and Due soon cards only on a board this big (CSS px); smaller boards get the count tiles.
const FULL_W = 1600, FULL_H = 900
const noop = () => {}

function Avatar({ m }: { m: Pick<Member, 'name' | 'color' | 'avatar'> }) {
  return <span className="board-avatar" style={{ background: m.color, color: inkFor(m.color) }}>{m.avatar || m.name[0]}</span>
}

function Card({ title, area, link, children }: { title: string; area: string; link?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className={`board-card board-${area}`} aria-label={title}>
      <h3 className="snap-heading">{title}{link}</h3>
      <div className="board-body">{children}</div>
    </section>
  )
}

/** `show`: the calendar's member/category filter, so a focused display's board matches its calendar. */
export default function Board({ show, onTap }: { show: (e: EventInstance) => boolean; onTap: (e: EventInstance) => void }) {
  const { settings, members, refreshTick, focusMemberId, focusShowsShared } = useApp()
  const device = useDeviceAppearance()
  const tz = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const [now, setNow] = useState(() => new Date())
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const clock = setInterval(() => setNow(new Date()), 15_000)
    const refresh = setInterval(() => setTick(t => t + 1), REFRESH_MS)
    return () => { clearInterval(clock); clearInterval(refresh) }
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
  const [lists, setLists] = useState<List[]>([])
  const [rewardRequests, setRewardRequests] = useState(0)
  useEffect(() => {
    let canceled = false
    if (f.lists) api.getLists().then(l => { if (!canceled) setLists(l) }).catch(() => { /* keep the last count */ })
    if (f.chores) api.getRedemptions({ status: 'pending' }).then(r => { if (!canceled) setRewardRequests(r.length) }).catch(() => { /* likewise */ })
    return () => { canceled = true }
  }, [refreshTick, tick, f.lists, f.chores])
  // Auto: measure the board to decide between full lists and counts.
  const scrollRef = useRef<HTMLDivElement>(null)
  const [big, setBig] = useState(false)
  const loaded = !!data
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBig(e.contentRect.width >= FULL_W && e.contentRect.height >= FULL_H))
    ro.observe(el)
    return () => ro.disconnect()
  }, [loaded])

  const p = zonedParts(now.toISOString(), tz)
  // Online tidbits (Settings → Quotes & facts): fetched when the day or the settings change.
  const onlineOn = settings.tidbits.sources.some(s => s === 'onthisday' || s === 'trivia')
  const dayKey = `${p.year}-${p.month}-${p.day}`
  const [online, setOnline] = useState<OnlineTidbits | null>(null)
  useEffect(() => {
    if (!onlineOn) return
    let canceled = false
    api.getTidbits().then(t => { if (!canceled) setOnline(t) }).catch(() => { /* offline: the built-in lists fill in */ })
    return () => { canceled = true }
  }, [onlineOn, dayKey, JSON.stringify(settings.tidbits)]) // eslint-disable-line react-hooks/exhaustive-deps
  const tidbit = tidbitFor(new Date(p.year, p.month - 1, p.day), Math.floor((p.hour * 60 + p.minute) / 30), settings.tidbits, onlineOn ? online : null)

  if (!data) return error ? <div className="state-card">Couldn't load the board. Check your connection.</div> : null
  const byId = new Map(members.map(m => [m.id, m]))
  const today = data.today
  const events = data.events.filter(show)
  const w = data.weather
  const wToday = w?.days.find(d => d.date === today)
  const later = [...new Set([...events.map(e => e.date), ...data.birthdays.map(b => b.date)])].filter(d => d > today).sort()

  const full = device.boardLists === 'full' || (device.boardLists !== 'counts' && big)
  const groceries = lists.filter(l => l.kind === 'shopping' && (!focusMemberId || l.memberIds.includes(focusMemberId) || (focusShowsShared && !l.memberIds.length)))
  const tiles = [
    f.chores && !full && 'chores', f.lists && !full && 'due', f.lists && groceries.length > 0 && 'groceries', f.chores && rewardRequests > 0 && 'rewards',
  ].filter((t): t is string => !!t)
  // Saving for a reward: shown on the person's chores row, or a row of its own when they have no chores today.
  const goalsOnly = members.filter(m => m.rewardGoal && !data.chores.some(c => c.memberId === m.id))
  const shown = ['tiles', 'clock', 'today', 'meals', 'photo', 'coming', 'due', 'chores', 'tidbit'].filter(a =>
    a === 'tiles' ? tiles.length > 0 : a === 'photo' ? f.photos : a === 'due' ? f.lists && full : a === 'chores' ? f.chores && full : a === 'meals' ? f.meals : a === 'tidbit' ? !!tidbit : true)
  const has = (a: string) => shown.includes(a)
  const choresLeft = data.chores.reduce((n, c) => n + c.remaining, 0)
  const overdue = data.items.filter(i => i.overdue).length
  const dueWeek = data.items.filter(i => !i.overdue && i.dueDate).length
  const groceryCount = groceries.reduce((n, l) => n + l.openCount, 0)

  return (
    <div className="board-scroll" ref={scrollRef}>
      <div className="board" style={boardAreas(shown)}>
        {has('tiles') && (
          <nav className="board-tiles" aria-label="At a glance">
            {tiles.includes('chores') && (
              <a className="board-tile" href="#/chores">
                <span className="board-tile-label">✅ Chores</span>
                <span className="board-tile-value">{choresLeft ? `${choresLeft} left today` : data.chores.length ? 'All done ✓' : 'None today'}</span>
                {data.chores.length > 0 && (
                  <span className="board-tile-people">
                    {data.chores.map(c => (
                      <span key={c.memberId ?? 'anyone'} className={`board-tile-person ${c.remaining ? '' : 'done'}`} aria-label={`${c.name ?? 'Anyone'}: ${c.remaining ? `${c.remaining} left` : 'done'}`}>
                        <Avatar m={{ name: c.name ?? 'Anyone', color: c.color ?? 'var(--bg)', avatar: c.avatar ?? '⭐' }} />
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
            {tiles.includes('groceries') && (
              <a className="board-tile" href={groceries.length === 1 ? `#/lists?list=${encodeURIComponent(groceries[0].id)}` : '#/lists'}>
                <span className="board-tile-label">{groceries.length === 1 ? `${groceries[0].emoji ?? '🛒'} ${groceries[0].name}` : '🛒 Groceries'}</span>
                <span className="board-tile-value">{groceryCount ? `${groceryCount} on the list` : 'Nothing needed'}</span>
              </a>
            )}
            {tiles.includes('rewards') && (
              <a className="board-tile" href="#/rewards">
                <span className="board-tile-label">🎁 Rewards</span>
                <span className="board-tile-value">{rewardRequests} waiting</span>
              </a>
            )}
          </nav>
        )}
        {/* The header already shows the clock and date, so this card is the forecast alone. */}
        <section className="board-card board-clock" aria-label="Time and weather">
          <div className="board-time">{new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', timeZone: tz }).format(now)}</div>
          <div className="board-date">{new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric', timeZone: tz }).format(now)}</div>
          {w && <div className="board-wx-where snap-dim">{w.location}</div>}
          {w && (
            <div className="board-weather" role="group" aria-label={`Weather in ${w.location}`}>
              <div className="board-weather-now">
                {w.now && <><span className="board-wx-emoji board-wx-big" aria-hidden="true">{w.now.emoji}</span><strong className="board-wx-temp">{w.now.temp}°</strong> <span className="board-wx-text">{w.now.text}</span></>}
                {wToday && <span className="snap-dim"> · <span className="sr-only">high </span>{wToday.high}° / <span className="sr-only">low </span>{wToday.low}°{wToday.rainChance ? ` · 💧${wToday.rainChance}%` : ''}</span>}
              </div>
              <ul className="board-forecast">
                {w.days.filter(d => d.date > today).slice(0, 4).map(d => (
                  <li key={d.date}>
                    <span className="board-forecast-day">{dayName(d.date, { weekday: 'short' })}</span>
                    <span className="board-wx-emoji" aria-hidden="true">{d.emoji}</span>
                    <span className="sr-only">{d.text}, </span>
                    <span>{d.high}° <span className="snap-dim">{d.low}°</span></span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <Card title="Today" area="today">
          {(() => {
            const bdays = data.birthdays.filter(b => b.date === today)
            const todays = events.filter(e => e.date === today)
            if (!bdays.length && !todays.length) return <p className="snap-empty">Nothing on the calendar today.</p>
            return (
              <ul className="snap-list">
                {bdays.map(b => <BirthdayRow key={`${b.memberId ?? b.eventId}`} b={b} you="" close={noop} />)}
                {todays.map(e => <EventLine key={`${e.id}:${e.start}`} e={e} tz={tz} byId={byId} onTap={onTap} past={!e.allDay && Date.parse(e.end) < now.getTime()} />)}
              </ul>
            )
          })()}
        </Card>

        {f.meals && <TodaysMeals now={now} today={today} meals={data.meals.filter(m => m.date === today)} />}

        <Card title="Coming up" area="coming">
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
                  {events.filter(e => e.date === d).map(e => <EventLine key={`${e.id}:${e.start}`} e={e} tz={tz} byId={byId} onTap={onTap} />)}
                </ul>
              </section>
            )
          })}
        </Card>

        {has('due') && <Card title="Due soon" area="due">
          {data.items.length === 0 ? <p className="snap-empty">Nothing due — all caught up.</p> : (
            <ul className="snap-list">
              {data.items.map(i => {
                const owner = i.memberId ? byId.get(i.memberId) : undefined
                return <ItemRow key={i.id} i={i} today={today} close={noop} after={owner && <span className="board-avatars" aria-label={owner.name}><Avatar m={owner} /></span>} />
              })}
            </ul>
          )}
        </Card>}

        {has('chores') && <Card title="Chores today" area="chores" link={<a className="board-card-link" href="#/rewards">🎁 Rewards</a>}>
          {data.chores.length === 0 && !goalsOnly.length ? <p className="snap-empty">No chores today.</p> : (
            <ul className="snap-list">
              {data.chores.map(c => {
                const done = c.total - c.remaining
                const name = c.name ?? 'Anyone'
                const waiting = c.pending ? `${c.pending} waiting for OK` : '' // ticked, not counted until a parent approves
                const goal = c.memberId ? goalText(byId.get(c.memberId)) : null
                return (
                  <li key={c.memberId ?? 'anyone'}>
                    <button className="snap-row board-chore" onClick={() => { location.hash = '#/chores' }} aria-label={`${name}: ${c.remaining ? `${c.remaining} of ${c.total} chores left` : 'all chores done'}${waiting ? `, ${waiting}` : ''}${goal ? `, ${goal.label}` : ''}`}>
                      <Avatar m={{ name, color: c.color ?? 'var(--bg)', avatar: c.avatar ?? '⭐' }} />
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

        {f.photos && <PhotoCard />}

        {tidbit && <TidbitCard key={tidbit.kind === 'trivia' ? tidbit.question : tidbit.text} tidbit={tidbit} />}
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

/** grid-template-areas for the cards actually on the Board, one per layout (styles.css picks one
 * per container width), so a card that's turned off leaves no hole. `shown` is in phone order. */
function boardAreas(shown: string[]): React.CSSProperties {
  const has = (a: string) => shown.includes(a)
  // Two columns: rows of two cards; a card whose partner is off spans the row.
  const two = [['tiles'], ['clock', 'photo'], ['today', 'coming'], ['due', 'chores'], ['meals', 'tidbit']]
    .map(row => row.filter(has)).filter(row => row.length).map(([a, b = a]) => `"${a} ${b}"`)
  // Three full-height columns: a missing card's rows go to the card above it.
  const cols = [['clock', 'photo', 'photo', 'tidbit'], ['today', 'today', 'chores', 'meals'], ['coming', 'coming', 'due', 'due']]
    .map(col => col.reduce<string[]>((out, a) => [...out, has(a) ? a : out[out.length - 1]], []))
  const three = [...(has('tiles') ? ['"tiles tiles tiles"'] : []), ...[0, 1, 2, 3].map(r => `"${cols.map(c => c[r]).join(' ')}"`)]
  return {
    // The last row is capped so a long meals or tidbit card can't squeeze the photo. The full Chores and Due soon
    // cards need more height than a small wall screen has, so there the board scrolls rather than cut a card to its heading.
    ['--board-rows-3' as string]: `${has('tiles') ? 'auto ' : ''}auto minmax(40px, 1fr) minmax(40px, 1fr) fit-content(24%)`,
    ['--board-min-h-3' as string]: has('chores') || has('due') ? '740px' : '0px',
    ['--board-areas-1' as string]: shown.map(a => `"${a}"`).join(' '),
    ['--board-areas-2' as string]: two.join(' '),
    ['--board-areas-3' as string]: three.join(' '),
  }
}

/** The quote / fact card. Trivia shows its question as tappable choices: a tap marks that guess
 *  right or wrong and highlights the answer, and Try again resets it for the next person. Online
 *  tidbits credit their source. */
function TidbitCard({ tidbit }: { tidbit: Tidbit }) {
  const [guess, setGuess] = useState<string | null>(null) // resets with each tidbit: the parent keys the card by it
  const key = tidbit.kind === 'trivia' ? tidbit.question : tidbit.text
  const label = tidbit.kind === 'quote' ? 'Quote' : tidbit.kind === 'trivia' ? 'Trivia' : tidbit.kind === 'onthisday' ? 'On this day' : tidbit.kind === 'tip' ? 'Try this' : 'Did you know?'
  return (
    <section className="board-card board-tidbit" aria-label={label}>
      <div key={key} className="board-tidbit-body">
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
      </div>
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
      <button className={`snap-row board-event ${past ? 'past' : ''}`} onClick={() => onTap(e)}
        aria-label={[`${when} ${e.title}`, who.map(m => m.name).join(' and '), past && 'finished'].filter(Boolean).join(', ')}>
        <span className="board-bar" style={{ background: bar }} aria-hidden="true" />
        <span className="snap-main" aria-hidden="true">
          <span className="board-when">{when}</span>
          <span className="snap-title">{e.title}</span>
          {(e.leaveAt || e.location) && <span className="snap-meta">{[e.leaveAt && `🚗 Leave by ${formatTime(e.leaveAt, tz)}`, e.location && `📍 ${e.location.split('\n')[0]}`].filter(Boolean).join(' · ')}</span>}
        </span>
        {who.length > 0 && <span className="board-avatars" aria-hidden="true">{who.map(m => <Avatar key={m.id} m={m} />)}</span>}
      </button>
    </li>
  )
}

/** The screensaver's pictures, a new one every minute: this display's sources, or if none are picked
 * the family's photos (nature photos until there are some). */
function PhotoCard() {
  const device = useDeviceAppearance()
  const { refreshTick } = useApp()
  const [hasPhotos, setHasPhotos] = useState(false)
  const picked = !!device.saverSources?.length
  useEffect(() => { if (!picked) api.getPhotoQuota().then(q => setHasPhotos(q.count - (q.memoryPhotos ?? 0) > 0)).catch(() => {}) }, [picked, refreshTick])
  const { pics, failed } = useSlideshowPictures(picked ? device.saverSources! : [hasPhotos ? 'photos' : 'nature'], 60)
  const current = pics[pics.length - 1]
  return (
    <section className="board-card board-photo" aria-label="Picture">
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
          {current.caption && <div className="board-caption">{current.caption}</div>}
        </>
      ) : <div className="board-photo-empty" aria-hidden="true">🖼️</div>}
    </section>
  )
}
