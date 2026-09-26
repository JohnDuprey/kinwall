// Board view: the calendar as a family bulletin board - clock + weather, today, the week ahead,
// what's due, chores, a rotating picture and a quote or fact. Read-mostly; rows open the same
// things they do elsewhere (an event's detail sheet, the list, the chores tab).
import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import type { Board as BoardData, EventInstance, Member, SnapshotEvent } from './types.ts'
import { inkFor } from './color.ts'
import { formatTime, zonedParts } from './date.ts'
import { useDeviceAppearance } from './useTheme.ts'
import { useSlideshowPictures } from './Screensaver.tsx'
import { tidbitFor } from './tidbits.ts'
import { BirthdayRow, ItemRow, dayName } from './Snapshot.tsx'

const REFRESH_MS = 10 * 60_000
const noop = () => {}

function Avatar({ m }: { m: Pick<Member, 'name' | 'color' | 'avatar'> }) {
  return <span className="board-avatar" style={{ background: m.color, color: inkFor(m.color) }}>{m.avatar || m.name[0]}</span>
}

function Card({ title, area, children }: { title: string; area: string; children: React.ReactNode }) {
  return (
    <section className={`board-card board-${area}`} aria-label={title}>
      <h3 className="snap-heading">{title}</h3>
      <div className="board-body">{children}</div>
    </section>
  )
}

/** `show`: the calendar's member/category filter, so a focused display's board matches its calendar. */
export default function Board({ show, onTap }: { show: (e: EventInstance) => boolean; onTap: (e: EventInstance) => void }) {
  const { settings, members, refreshTick } = useApp()
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
    let cancelled = false
    api.getBoard(7)
      .then(b => { if (!cancelled) { setData(b); setError(false) } })
      .catch(() => { if (!cancelled) setError(true) }) // keep showing the last board, if any
    return () => { cancelled = true }
  }, [refreshTick, tick])

  const p = zonedParts(now.toISOString(), tz)
  const tidbit = tidbitFor(new Date(p.year, p.month - 1, p.day), Math.floor((p.hour * 60 + p.minute) / 30))

  if (!data) return error ? <div className="state-card">Couldn't load the board. Check your connection.</div> : null
  const byId = new Map(members.map(m => [m.id, m]))
  const today = data.today
  const events = data.events.filter(show)
  const w = data.weather
  const wToday = w?.days.find(d => d.date === today)
  const later = [...new Set([...events.map(e => e.date), ...data.birthdays.map(b => b.date)])].filter(d => d > today).sort()

  return (
    <div className="board-scroll">
      <div className="board">
        {/* The header already shows the clock and date, so this card is the forecast alone. */}
        <section className="board-card board-clock" aria-label="Weather">
          <h3 className="board-card-title">Weather{w ? <span className="snap-dim"> · {w.location}</span> : ''}</h3>
          {w ? (
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
          ) : <p className="snap-empty">No forecast — set the family's location in Settings → General.</p>}
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

        <Card title="Due soon" area="due">
          {data.items.length === 0 ? <p className="snap-empty">Nothing due — all caught up.</p> : (
            <ul className="snap-list">
              {data.items.map(i => {
                const owner = i.memberId ? byId.get(i.memberId) : undefined
                return <ItemRow key={i.id} i={i} today={today} close={noop} after={owner && <span className="board-avatars" aria-label={owner.name}><Avatar m={owner} /></span>} />
              })}
            </ul>
          )}
        </Card>

        <Card title="Chores today" area="chores">
          {data.chores.length === 0 ? <p className="snap-empty">No chores today.</p> : (
            <ul className="snap-list">
              {data.chores.map(c => {
                const done = c.total - c.remaining
                const name = c.name ?? 'Anyone'
                return (
                  <li key={c.memberId ?? 'anyone'}>
                    <button className="snap-row board-chore" onClick={() => { location.hash = '#/chores' }} aria-label={`${name}: ${c.remaining ? `${c.remaining} of ${c.total} chores left` : 'all chores done'}`}>
                      <Avatar m={{ name, color: c.color ?? 'var(--bg)', avatar: c.avatar ?? '⭐' }} />
                      <span className="snap-main">
                        <span className="snap-title">{name}</span>
                        <span className="board-meter" aria-hidden="true"><span style={{ width: `${(done / c.total) * 100}%`, background: c.color ?? 'var(--accent)' }} /></span>
                      </span>
                      <span className="board-chore-count" aria-hidden="true">{c.remaining ? `${c.remaining} left` : '🎉'}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </Card>

        <PhotoCard />

        <section className="board-card board-tidbit" aria-label={tidbit.kind === 'quote' ? 'Quote' : 'Did you know?'}>
          <div key={tidbit.text} className="board-tidbit-body">
            {tidbit.kind === 'quote'
              ? <blockquote><p>“{tidbit.text}”</p><footer>— {tidbit.by}</footer></blockquote>
              : <p><span className="board-tidbit-tag">💡 Did you know?</span> {tidbit.text}</p>}
          </div>
        </section>
      </div>
    </div>
  )
}

/** One event: a bar in the member's colour (stripes for several), time, title, avatars. */
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

/** The screensaver's pictures (this display's sources, or nature photos if none are picked), a new one every minute. */
function PhotoCard() {
  const device = useDeviceAppearance()
  const { pics, failed } = useSlideshowPictures(device.saverSources?.length ? device.saverSources : ['nature'], 60)
  const current = pics[pics.length - 1]
  return (
    <section className="board-card board-photo" aria-label="Picture">
      {!failed && current ? (
        <>
          {pics.map(p => <img key={p.key} className={`board-photo-img ${p.caption ? 'art' : ''}`} src={p.src} alt={p.caption ?? ''} />)}
          {current.caption && <div className="board-caption">{current.caption}</div>}
        </>
      ) : <div className="board-photo-empty" aria-hidden="true">🖼️</div>}
    </section>
  )
}
