// A member's profile (#/profile/{memberId}): what they've been up to - chores and points by period,
// streak, books, sticker book, activity time, badges, birthday. Opened from a leaderboard pill, a
// header avatar's day sheet, or "Me" on a member's own device. About one person only: no sibling
// rankings, just "vs your own last week". Health data never shows here. Their journal (and goals met
// this week) only on their own device and parents' devices.
import { useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { Segmented } from './a11y.tsx'
import { inkFor } from './color.ts'
import { todayKeyInTz } from './date.ts'
import { hoursMinutes } from './reading.ts'
import { useIsPhone } from './useIsPhone.ts'
import { goalsThisWeek } from './journal.ts'
import { birthdayText, chartLabels, compareText, duration, periodWord, WEEKDAYS } from './profile.ts'
import type { ChoreDay, Member, MemberStats, StatsPeriod } from './types.ts'

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: 'today', label: 'Today' }, { key: 'week', label: 'Week' }, { key: 'month', label: 'Month' }, { key: 'year', label: 'Year' }, { key: 'all', label: 'All time' },
]
const SPINES = ['#F7B2A0', '#A9D8F5', '#C7E6A3', '#F8D57E', '#D5B8F2', '#F5A9C9', '#9FE0D0', '#FFC48C']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const plural = (n: number, w: string) => `${n.toLocaleString()} ${w}${n === 1 ? '' : 's'}`

export default function Profile({ memberId }: { memberId?: string }) {
  const { members, settings, refreshTick, meMemberId } = useApp()
  const isPhone = useIsPhone()
  const member = members.find(m => m.id === memberId) ?? members.find(m => m.id === meMemberId) ?? members[0]
  const [period, setPeriod] = useState<StatsPeriod>('week')
  const [stats, setStats] = useState<MemberStats | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!member) return
    let canceled = false
    api.getMemberStats(member.id, period)
      .then(s => { if (!canceled) { setStats(s); setError('') } })
      .catch(e => { if (!canceled) setError(e instanceof ApiError ? e.message : "Couldn't load this profile.") })
    return () => { canceled = true }
  }, [member?.id, period, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!member) return <div className="state-card">No one in the family yet.</div>
  const shown = stats?.memberId === member.id && stats.period === period ? stats : null
  const f = settings.features

  return (
    <div className="profile scroll-y" style={{ ['--m' as string]: member.color }}>
      {!isPhone && members.length > 1 && (
        <div className="profile-people" role="group" aria-label="Whose profile">
          {members.map(m => (
            <a key={m.id} href={`#/profile/${m.id}`} className={`profile-person ${m.id === member.id ? 'active' : ''}`} aria-current={m.id === member.id ? 'page' : undefined}>
              <span className="member-avatar-sm" style={{ background: m.color, color: inkFor(m.color) }} aria-hidden="true">{m.avatar || m.name[0]}</span>
              {m.name}
            </a>
          ))}
        </div>
      )}
      <section className="profile-top">
        <div className="profile-hero">
          <span className="profile-avatar" style={{ background: member.color, color: inkFor(member.color) }} aria-hidden="true">{member.avatar || member.name[0]}</span>
          <div>
            <h2 className="profile-name">{member.name}</h2>
            <p className="profile-meta">
              {shown?.birthday && birthdayText(shown.birthday) && <>{birthdayText(shown.birthday)}<br /></>}
              {shown && <>On Kinwall since {MONTHS[Number(shown.joined.slice(5, 7)) - 1]} {shown.joined.slice(0, 4)}</>}
            </p>
          </div>
        </div>
        {f.chores && <Segmented className="profile-period" label="Period" value={period} onChange={setPeriod} options={PERIODS} />}
      </section>
      {error && <p className="snap-empty" role="alert">{error}</p>}
      {!shown && !error && <p className="snap-empty">Loading…</p>}
      {shown && <ProfileBody member={member} s={shown} />}
    </div>
  )
}

function ProfileBody({ member, s }: { member: Member; s: MemberStats }) {
  const { settings, parentDevice, meMemberId } = useApp()
  const f = settings.features
  const word = periodWord(s.period, s.to)
  const books = f.trackersReading && (s.books.shelf.length > 0 || s.books.reading.length > 0 || s.books.finished > 0)
  const stickers = f.chores && settings.stickersEnabled && (s.stickers.placed > 0 || s.stickers.packsOwned > 1)
  const earned = s.badges.filter(b => b.earned).length
  return (
    <>
      <div className="profile-tiles">
        {f.chores && <>
          <Tile label="Chores done" value={s.choresDone.toLocaleString()} note={compareText(s.choresDone, s.previous, s.period, s.joined)} up={!!s.previous && s.choresDone > s.previous.choresDone} />
          <Tile label="Points earned" value={s.pointsEarned.toLocaleString()} note={word} />
        </>}
        {books && <Tile label="Books finished" value={String(s.books.finished)} note={[s.books.pages ? plural(s.books.pages, 'page') : '', s.books.minutesListened ? `${hoursMinutes(s.books.minutesListened)} listened` : ''].filter(Boolean).join(' · ') || word} />}
        {f.chores && <Tile label="Streak" value={<>🔥 {s.streak.current} <small>{s.streak.current === 1 ? 'day' : 'days'}</small></>} note={`Best ever: ${plural(s.streak.best, 'day')}`} />}
        {(settings.checkInPoints > 0 || s.checkIns > 0) && <Tile label="Check-ins" value={<>☀️ {s.checkIns}</>} note={word} />}
      </div>
      <div className="profile-grid">
        {f.chores && <ChoresCard member={member} s={s} />}
        {f.chores && <PointsCard member={member} s={s} word={word} />}
        {books && <BooksCard s={s} />}
        {s.activities.length > 0 && (
          <section className="board-card profile-card" aria-labelledby="pf-activities">
            <h3 id="pf-activities" className="snap-heading">Activities <span>{duration(s.activities.reduce((t, a) => t + a.seconds, 0))} {word}</span></h3>
            {s.activities.map(a => <Bar key={a.pluginId} label={`${a.emoji ?? '🎮'} ${a.name}`} value={a.seconds} max={s.activities[0].seconds} text={duration(a.seconds)} />)}
          </section>
        )}
        <section className="board-card profile-card" aria-labelledby="pf-badges">
          <h3 id="pf-badges" className="snap-heading">Badges <span>{earned} of {s.badges.length}</span></h3>
          <ul className="profile-badges">
            {s.badges.map(b => (
              <li key={b.id} className={`profile-badge ${b.earned ? '' : 'locked'}`}>
                <span className="profile-badge-emoji" aria-hidden="true">{b.emoji}</span>{b.title}{!b.earned && <span className="sr-only"> (not yet)</span>}
              </li>
            ))}
          </ul>
        </section>
        {stickers && (
          <section className="board-card profile-card" aria-labelledby="pf-stickers">
            <h3 id="pf-stickers" className="snap-heading">Sticker book <span>{s.stickers.packsOwned} of {s.stickers.packsTotal} packs</span></h3>
            <span className="board-meter profile-meter" aria-hidden="true"><span style={{ width: `${(s.stickers.packsOwned / s.stickers.packsTotal) * 100}%`, background: member.color }} /></span>
            <p className="profile-note">{plural(s.stickers.placed, 'sticker')} on the page.</p>
            <a className="btn btn-secondary profile-link" href="#/activities/stickers">Open the sticker book</a>
          </section>
        )}
        {parentDevice && f.chores && <WaitingCard member={member} />}
        {(parentDevice || meMemberId === member.id) && <JournalCard member={member} />}
        {settings.medications && (parentDevice || meMemberId === member.id) && <MedicationsCard member={member} />}
      </div>
    </>
  )
}

function Tile({ label, value, note, up = false }: { label: string; value: ReactNode; note: string; up?: boolean }) {
  return (
    <div className="profile-tile">
      <span className="profile-tile-label">{label}</span>
      <span className="profile-tile-value">{value}</span>
      <span className={`profile-tile-note ${up ? 'up' : ''}`}>{note}</span>
    </div>
  )
}

function Bar({ label, value, max, text, color }: { label: string; value: number; max: number; text: string; color?: string }) {
  return (
    <div className="profile-bar">
      <span className="profile-bar-label">{label}</span>
      <span className="board-meter" aria-hidden="true"><span style={{ width: `${max ? (value / max) * 100 : 0}%`, background: color ?? 'var(--m)' }} /></span>
      <b>{text}</b>
    </div>
  )
}

function ChoresCard({ member, s }: { member: Member; s: MemberStats }) {
  const { settings, refreshTick } = useApp()
  const [today, setToday] = useState<ChoreDay[] | null>(null)
  useEffect(() => {
    if (s.period !== 'today') return
    api.getChoresDay(todayKeyInTz(settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone))
      .then(day => setToday(day.filter(c => c.memberId === member.id || c.completedBy === member.id))).catch(() => setToday([]))
  }, [s.period, member.id, settings.timezone, refreshTick])
  if (s.period === 'today') {
    return (
      <section className="board-card profile-card profile-wide" aria-labelledby="pf-chores">
        <h3 id="pf-chores" className="snap-heading">Today's chores {today && <span>{today.filter(c => c.completed).length} of {today.length}</span>}</h3>
        {today && today.length === 0 && <p className="profile-note">Nothing due today.</p>}
        <ul className="profile-today">
          {today?.map(c => (
            <li key={c.id}>
              <span className={`profile-check ${c.completed ? 'done' : ''}`} aria-hidden="true">{c.completed ? '✓' : ''}</span>
              <span className="profile-today-title">{c.emoji} {c.title}<span className="sr-only">{c.completed ? ', done' : c.pending ? ', waiting for a grown-up' : ', not yet'}</span></span>
              <span className="profile-today-pts">{c.completed ? `+${c.points}` : c.points} pts</span>
            </li>
          ))}
        </ul>
      </section>
    )
  }
  const perDay = s.period === 'week' || s.period === 'month'
  return (
    <section className="board-card profile-card profile-wide" aria-labelledby="pf-chores">
      <h3 id="pf-chores" className="snap-heading">Chores done <span>{perDay ? 'per day' : 'per month'}</span></h3>
      <Chart values={s.chart.map(b => b.count)} labels={chartLabels(s.chart.map(b => b.key), s.period)} color={member.color}
        label={`Chores done per ${perDay ? 'day' : 'month'}: ${s.chart.map(b => b.count).join(', ')}`} />
      {s.favoriteChore && (
        <div className="profile-facts">
          {s.busiestWeekday !== null && <span className="profile-fact">Busiest day: {WEEKDAYS[s.busiestWeekday]}</span>}
          <span className="profile-fact">Favorite: {s.favoriteChore.emoji} {s.favoriteChore.title} ×{s.favoriteChore.count}</span>
        </div>
      )}
    </section>
  )
}

/** Bars with a light grid; the numbers are in the aria-label too. */
function Chart({ values, labels, color, label }: { values: number[]; labels: string[]; color: string; label: string }) {
  const W = 340, H = 132, L = 26, B = 20, T = 8, R = 4
  const max = Math.max(1, ...values)
  const step = max <= 5 ? 1 : max <= 10 ? 2 : max <= 25 ? 5 : max <= 50 ? 10 : max <= 100 ? 25 : max <= 250 ? 50 : 100
  const top = Math.ceil(max / step) * step
  const y = (v: number) => T + (H - T - B) * (1 - v / top)
  const bw = (W - L - R) / values.length, gap = Math.min(6, bw * 0.28)
  const grid = []
  for (let v = 0; v <= top; v += step) if (!(top / step > 4 && (v / step) % 2)) grid.push(v)
  return (
    <svg className="profile-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
      {grid.map(v => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} /><text x={L - 6} y={y(v) + 3.5} textAnchor="end">{v}</text></g>)}
      {values.map((v, i) => v > 0 && <rect key={i} x={L + i * bw + gap / 2} y={y(v)} width={bw - gap} height={y(0) - y(v)} rx={Math.min(4, (bw - gap) / 2)} fill={color} />)}
      {labels.map((t, i) => t && <text key={`l${i}`} x={L + i * bw + bw / 2} y={H - 5} textAnchor="middle">{t}</text>)}
    </svg>
  )
}

function PointsCard({ member, s, word }: { member: Member; s: MemberStats; word: string }) {
  const max = Math.max(1, s.pointsEarned, s.pointsSpent.stickers, s.pointsSpent.rewards)
  const goal = member.rewardGoal
  return (
    <section className="board-card profile-card" aria-labelledby="pf-points">
      <h3 id="pf-points" className="snap-heading">Points <span>{word}</span></h3>
      <Bar label="Earned" value={s.pointsEarned} max={max} text={s.pointsEarned.toLocaleString()} />
      <Bar label="Stickers" value={s.pointsSpent.stickers} max={max} text={s.pointsSpent.stickers.toLocaleString()} color="var(--accent)" />
      <Bar label="Rewards" value={s.pointsSpent.rewards} max={max} text={s.pointsSpent.rewards.toLocaleString()} color="var(--prio-high)" />
      {goal ? (
        <a className="profile-goal" href={`#/rewards/${member.id}`}>
          <span className="profile-goal-emoji" aria-hidden="true">{goal.emoji ?? '🎁'}</span>
          <span className="profile-goal-text">
            Saving for {goal.title}: {Math.min(member.balance, goal.cost)} of {goal.cost}
            <span className="board-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, (Math.max(0, member.balance) / goal.cost) * 100)}%`, background: 'var(--accent)' }} /></span>
          </span>
        </a>
      ) : <p className="profile-note">{plural(member.balance, 'point')} to spend.</p>}
    </section>
  )
}

function BooksCard({ s }: { s: MemberStats }) {
  const shelf = s.books.shelf
  const rated = shelf.filter(b => b.rating)
  const loved = [...shelf].reverse().find(b => b.rating === 5)
  return (
    <section className="board-card profile-card" aria-labelledby="pf-books">
      <h3 id="pf-books" className="snap-heading">Bookshelf <span>{s.books.shelfScope === 'year' ? 'This year' : 'All time'}: {plural(shelf.length, 'book')}</span></h3>
      <ul className="profile-shelf" aria-label={shelf.length ? `Books: ${shelf.map(b => b.title).join(', ')}` : 'No books finished yet'}>
        {shelf.length === 0 && <li className="profile-note">No books finished yet.</li>}
        {shelf.map((b, i) => <li key={b.id} className="profile-spine" title={b.title} style={{ height: 46 + Math.min(40, (b.pages ?? 100) / 5), background: SPINES[i % SPINES.length] }} />)}
      </ul>
      <div className="profile-facts">
        {shelf.some(b => b.pages) && <span className="profile-fact">{plural(shelf.reduce((t, b) => t + (b.pages ?? 0), 0), 'page')}</span>}
        {shelf.some(b => b.minutes) && <span className="profile-fact">{hoursMinutes(shelf.reduce((t, b) => t + (b.minutes ?? 0), 0))} listened</span>}
        {rated.length > 0 && <span className="profile-fact">Avg {(rated.reduce((t, b) => t + (b.rating ?? 0), 0) / rated.length).toFixed(1)} ★</span>}
        {loved && <span className="profile-fact">Loved: {loved.title}</span>}
      </div>
      {s.books.reading.map(b => (
        <div key={b.id} className="profile-bar">
          <span className="profile-bar-label">📖 {b.title}</span>
          {b.percent !== null && <><span className="board-meter" aria-hidden="true"><span style={{ width: `${b.percent}%`, background: 'var(--m)' }} /></span><b>{b.percent}%</b></>}
        </div>
      ))}
    </section>
  )
}

/** Parent devices only: this person's chores and rewards waiting for an OK. */
function WaitingCard({ member }: { member: Member }) {
  const { refreshTick } = useApp()
  const [counts, setCounts] = useState<[number, number] | null>(null)
  useEffect(() => {
    Promise.all([api.getPendingApprovals(), api.getRedemptions({ memberId: member.id, status: 'pending' })])
      .then(([c, r]) => setCounts([c.filter(x => x.memberId === member.id).length, r.length])).catch(() => setCounts(null))
  }, [member.id, refreshTick])
  if (!counts || counts[0] + counts[1] === 0) return null
  return (
    <section className="board-card profile-card" aria-labelledby="pf-waiting">
      <h3 id="pf-waiting" className="snap-heading">Waiting for your OK <span>Grown-ups only</span></h3>
      <p className="profile-note">{[counts[0] && plural(counts[0], 'chore'), counts[1] && plural(counts[1], 'reward')].filter(Boolean).join(' and ')} from {member.name}.</p>
      <a className="btn btn-secondary profile-link" href={counts[0] ? '#/chores' : `#/rewards/${member.id}`}>{counts[0] ? 'Open Chores' : 'Open Rewards'}</a>
    </section>
  )
}

/** Their own device and parents' devices only: a way into their journal, and goals met this week. */
function JournalCard({ member }: { member: Member }) {
  const { settings, refreshTick } = useApp()
  const [week, setWeek] = useState<{ met: number; of: number } | null>(null)
  const evening = !!(member.tempCheck?.on && member.tempCheck.goal && member.tempCheck.evening)
  useEffect(() => {
    if (!evening) return
    const today = todayKeyInTz(settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
    api.getJournal(member.id, { days: 7 }).then(j => setWeek(goalsThisWeek(j.days, today))).catch(() => setWeek(null))
  }, [member.id, evening, settings.timezone, refreshTick])
  return (
    <section className="board-card profile-card" aria-labelledby="pf-journal">
      <h3 id="pf-journal" className="snap-heading">Journal <span>🔒 Private</span></h3>
      {evening && week && week.of > 0 && <p className="profile-note">🎯 Goals met this week: <strong>{week.met} of {week.of}</strong></p>}
      <p className="profile-note">Check-ins, goals and {member.name}'s own notes, day by day.</p>
      <a className="btn btn-secondary profile-link" href={`#/journal/${member.id}`}>Open the journal</a>
    </section>
  )
}

/** Their own device and parents' devices only: a way into their medicines page (no names or doses here). */
function MedicationsCard({ member }: { member: Member }) {
  return (
    <section className="board-card profile-card" aria-labelledby="pf-meds">
      <h3 id="pf-meds" className="snap-heading">Medicines <span>🔒 Private</span></h3>
      <p className="profile-note">Today's doses and the last 7 days.</p>
      <a className="btn btn-secondary profile-link" href={`#/medications/${member.id}`}>Open medicines</a>
    </section>
  )
}
