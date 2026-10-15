// A member's profile (#/profile/{memberId}): what they've been up to - chores and points by period,
// streak, books, sticker book, activity time, badges, birthday. Opened from a leaderboard pill, a
// header avatar's day sheet, or "Me" on a member's own device. About one person only: no sibling
// rankings, just "vs your own last week". Health data never shows here. Their journal (and goals met
// this week) and Insights only on their own device and parents' devices.
import { useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { PictureSheet } from './MemberPicture.tsx'
import { Segmented } from './a11y.tsx'
import { todayKeyInTz } from './date.ts'
import { hoursMinutes } from './reading.ts'
import { useIsPhone } from './useIsPhone.ts'
import { goalsThisWeek } from './journal.ts'
import { birthdayText, chartLabels, compareText, duration, periodWord, unknownMember, weekdayName } from './profile.ts'
import { formatDate, intlLocale, msg, t, tc, tm, tn } from './i18n.ts'
import type { ChoreDay, Member, MemberStats, StatsPeriod } from './types.ts'
import { rewardsOn } from './types.ts'
import type { PointEntry } from './types.ts'
import { GivePoints } from './GivePoints.tsx'
import { useDialog } from './dialog.tsx'
import { bonusLine } from './bonus.ts'
import { Face } from './Face'

const PERIODS: { key: StatsPeriod; label: string }[] = [
  { key: 'today', label: msg('Today') }, { key: 'week', label: msg('Week') }, { key: 'month', label: msg('Month') }, { key: 'year', label: msg('Year') }, { key: 'all', label: msg('All time') },
]
const SPINES = ['#F7B2A0', '#A9D8F5', '#C7E6A3', '#F8D57E', '#D5B8F2', '#F5A9C9', '#9FE0D0', '#FFC48C']
/** Journal, insights and medicines: a kid's are hidden from the other kids; a grown-up's from everyone else. */
const privateTag = (m: Member) => m.grownUp ? t('Private') : t("Private (other kids can't see)")

export default function Profile({ memberId }: { memberId?: string }) {
  const { members, settings, refreshTick, meMemberId, parentDevice } = useApp()
  const isPhone = useIsPhone()
  const member = members.find(m => m.id === memberId) ?? members.find(m => m.id === meMemberId) ?? members[0]
  const unknown = unknownMember(memberId, members)
  // A bad link: say so, and take the id out of the address so a reload opens the viewer's own.
  useEffect(() => { if (unknown) history.replaceState(history.state, '', '#/profile') }, [unknown])
  const [period, setPeriod] = useState<StatsPeriod>('week')
  const [stats, setStats] = useState<MemberStats | null>(null)
  const [error, setError] = useState('')
  const [picking, setPicking] = useState(false)

  useEffect(() => {
    if (!member) return
    let canceled = false
    api.getMemberStats(member.id, period)
      .then(s => { if (!canceled) { setStats(s); setError('') } })
      .catch(e => { if (!canceled) setError(e instanceof ApiError ? e.message : t("Couldn't load this profile.")) })
    return () => { canceled = true }
  }, [member?.id, period, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  if (unknown) return <div className="state-card">{t("That isn't here anymore.")}</div>
  if (!member) return <div className="state-card">{t('No one in the family yet.')}</div>
  // Parents change anyone's picture; a kid's own device, theirs. Never a wall screen.
  const canChange = parentDevice || meMemberId === member.id
  const own = meMemberId === member.id
  const shown = stats?.memberId === member.id && stats.period === period ? stats : null
  const f = settings.features

  return (
    <div className="profile scroll-y" style={{ ['--m' as string]: member.color }}>
      {!isPhone && members.length > 1 && (
        <div className="profile-people" role="group" aria-label={t('Whose profile')}>
          {members.map(m => (
            <a key={m.id} href={`#/profile/${m.id}`} className={`profile-person ${m.id === member.id ? 'active' : ''}`} aria-current={m.id === member.id ? 'page' : undefined}>
              <Face m={m} className="member-avatar-sm" aria-hidden="true" />
              {m.name}
            </a>
          ))}
        </div>
      )}
      <section className="profile-top">
        <div className="profile-hero">
          {canChange
            ? <button className="profile-avatar-btn" onClick={() => setPicking(true)} aria-label={own ? t('Change your picture') : t("Change {name}'s picture", { name: member.name })}>
                <Face m={member} className="profile-avatar" aria-hidden="true" />
                <span className="profile-avatar-edit" aria-hidden="true">✏️</span>
              </button>
            : <Face m={member} className="profile-avatar" aria-hidden="true" />}
          <div>
            <h2 className="profile-name">{member.name}</h2>
            <p className="profile-meta">
              {shown?.birthday && birthdayText(shown.birthday) && <>{birthdayText(shown.birthday)}<br /></>}
              {shown && t('On Kinwall since {month}', { month: formatDate(new Date(Number(shown.joined.slice(0, 4)), Number(shown.joined.slice(5, 7)) - 1, 1), { month: 'long', year: 'numeric' }) })}
            </p>
          </div>
        </div>
        {f.chores && <Segmented className="profile-period" label={t('Period')} value={period} onChange={setPeriod} options={PERIODS.map(p => ({ ...p, label: tm(p.label) }))} />}
      </section>
      {error && <p className="snap-empty" role="alert">{error}</p>}
      {!shown && !error && <p className="snap-empty">{t('Loading…')}</p>}
      {shown && <ProfileBody member={member} s={shown} />}
      {picking && <PictureSheet member={member} withEmoji onClose={() => setPicking(false)} />}
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
          <Tile label={t('Chores done')} value={s.choresDone.toLocaleString()} note={compareText(s.choresDone, s.previous, s.period, s.joined)} up={!!s.previous && s.choresDone > s.previous.choresDone} />
          <Tile label={t('Points earned')} value={s.pointsEarned.toLocaleString()} note={word} />
        </>}
        {books && <Tile label={t('Books finished')} value={String(s.books.finished)} note={[s.books.pages ? tn(s.books.pages, '{n} page', '{n} pages') : '', s.books.minutesListened ? t('{time} listened', { time: hoursMinutes(s.books.minutesListened) }) : ''].filter(Boolean).join(' · ') || word} />}
        {f.chores && <Tile label={t('Streak')} value={<>🔥 {s.streak.current} <small>{s.streak.current === 1 ? tc('streak', 'day') : tc('streak', 'days')}</small></>} note={t('Best ever: {days}', { days: tn(s.streak.best, '{n} day', '{n} days') })} />}
        {f.chores && f.checkIns && (settings.checkInPoints > 0 || s.checkIns > 0) && <Tile label={t('Check-ins')} value={<>☀️ {s.checkIns}</>} note={word} />}
      </div>
      <div className="profile-grid">
        {/* Their journal and insights lead: the reason most people open a profile. */}
        {f.checkIns && (parentDevice || meMemberId === member.id) && <JournalCard member={member} />}
        {f.checkIns && (parentDevice || meMemberId === member.id) && <InsightsCard member={member} />}
        {f.chores && <ChoresCard member={member} s={s} />}
        {f.chores && <PointsCard member={member} s={s} word={word} />}
        {books && <BooksCard s={s} />}
        {s.activities.length > 0 && (
          <section className="board-card profile-card" aria-labelledby="pf-activities">
            <h3 id="pf-activities" className="snap-heading">{t('Activities')} <span>{duration(s.activities.reduce((sum, a) => sum + a.seconds, 0))} {word}</span></h3>
            {s.activities.map(a => <Bar key={a.pluginId} label={`${a.emoji ?? '🎮'} ${a.name}`} value={a.seconds} max={s.activities[0].seconds} text={duration(a.seconds)} />)}
          </section>
        )}
        <section className="board-card profile-card" aria-labelledby="pf-badges">
          <h3 id="pf-badges" className="snap-heading">{t('Badges')} <span>{t('{done} of {total}', { done: earned, total: s.badges.length })}</span></h3>
          <ul className="profile-badges">
            {s.badges.map(b => (
              <li key={b.id} className={`profile-badge ${b.earned ? '' : 'locked'}`}>
                <span className="profile-badge-emoji" aria-hidden="true">{b.emoji}</span>{b.title}{!b.earned && <span className="sr-only">{t(' (not yet)')}</span>}
              </li>
            ))}
          </ul>
        </section>
        {stickers && (
          <section className="board-card profile-card" aria-labelledby="pf-stickers">
            <h3 id="pf-stickers" className="snap-heading">{t('Sticker book')} <span>{t('{done} of {total} packs', { done: s.stickers.packsOwned, total: s.stickers.packsTotal })}</span></h3>
            <span className="board-meter profile-meter" aria-hidden="true"><span style={{ width: `${(s.stickers.packsOwned / s.stickers.packsTotal) * 100}%`, background: member.color }} /></span>
            <p className="profile-note">{tn(s.stickers.placed, '{n} sticker on the page.', '{n} stickers on the page.')}</p>
            <a className="btn btn-secondary profile-link" href="#/activities/stickers">{t('Open the sticker book')}</a>
          </section>
        )}
        {parentDevice && f.chores && <WaitingCard member={member} />}
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

export function Bar({ label, value, max, text, color }: { label: string; value: number; max: number; text: string; color?: string }) {
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
        <h3 id="pf-chores" className="snap-heading">{t("Today's chores")} {today && <span>{t('{done} of {total}', { done: today.filter(c => c.completed).length, total: today.length })}</span>}</h3>
        {today && today.length === 0 && <p className="profile-note">{t('Nothing due today.')}</p>}
        <ul className="profile-today">
          {today?.map(c => (
            <li key={c.id}>
              <span className={`profile-check ${c.completed ? 'done' : ''}`} aria-hidden="true">{c.completed ? '✓' : ''}</span>
              <span className="profile-today-title">{c.emoji} {c.title}<span className="sr-only">{c.completed ? t(', done') : c.pending ? t(', waiting for a grown-up') : t(', not yet')}</span></span>
              <span className="profile-today-pts">{c.completed ? tn(c.points, '+{n} pt', '+{n} pts') : tn(c.points, '{n} pt', '{n} pts')}</span>
            </li>
          ))}
        </ul>
      </section>
    )
  }
  const perDay = s.period === 'week' || s.period === 'month'
  return (
    <section className="board-card profile-card profile-wide" aria-labelledby="pf-chores">
      <h3 id="pf-chores" className="snap-heading">{t('Chores done')} <span>{perDay ? t('per day') : t('per month')}</span></h3>
      <Chart values={s.chart.map(b => b.count)} labels={chartLabels(s.chart.map(b => b.key), s.period)} color={member.color}
        label={perDay ? t('Chores done per day: {counts}', { counts: s.chart.map(b => b.count).join(', ') }) : t('Chores done per month: {counts}', { counts: s.chart.map(b => b.count).join(', ') })} />
      {s.favoriteChore && (
        <div className="profile-facts">
          {s.busiestWeekday !== null && <span className="profile-fact">{t('Busiest day: {day}', { day: weekdayName(s.busiestWeekday) })}</span>}
          <span className="profile-fact">{t('Favorite: {chore} ×{count}', { chore: `${s.favoriteChore.emoji} ${s.favoriteChore.title}`, count: s.favoriteChore.count })}</span>
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
  const rewards = rewardsOn(useApp().settings)
  const max = Math.max(1, s.pointsEarned, s.pointsSpent.stickers, s.pointsSpent.rewards)
  const goal = rewards ? member.rewardGoal : null
  return (
    <section className="board-card profile-card" aria-labelledby="pf-points">
      <h3 id="pf-points" className="snap-heading">{t('Points')} <span>{word}</span></h3>
      <Bar label={t('Earned')} value={s.pointsEarned} max={max} text={s.pointsEarned.toLocaleString()} />
      <Bar label={t('Stickers')} value={s.pointsSpent.stickers} max={max} text={s.pointsSpent.stickers.toLocaleString()} color="var(--accent)" />
      {rewards && <Bar label={t('Rewards')} value={s.pointsSpent.rewards} max={max} text={s.pointsSpent.rewards.toLocaleString()} color="var(--prio-high)" />}
      {goal ? (
        <a className="profile-goal" href={`#/rewards/${member.id}`}>
          <span className="profile-goal-emoji" aria-hidden="true">{goal.emoji ?? '🎁'}</span>
          <span className="profile-goal-text">
            {t('Saving for {title}: {done} of {total}', { title: goal.title, done: Math.min(member.balance, goal.cost), total: goal.cost })}
            <span className="board-meter" aria-hidden="true"><span style={{ width: `${Math.min(100, (Math.max(0, member.balance) / goal.cost) * 100)}%`, background: 'var(--accent)' }} /></span>
          </span>
        </a>
      ) : <p className="profile-note">{tn(member.balance, '{n} point to spend.', '{n} points to spend.')}</p>}
      <BonusList member={member} />
    </section>
  )
}

/** Bonus points a parent gave (their own device, parents' devices and wall screens see them; a
 * sibling's device gets none from the server). A parent can give more, or tap one to take it back. */
function BonusList({ member }: { member: Member }) {
  const { parentDevice, refreshTick, reloadCore, toast } = useApp()
  const dialog = useDialog()
  const [bonus, setBonus] = useState<PointEntry[]>([])
  useEffect(() => {
    let canceled = false
    api.getMemberPoints(member.id).then(p => { if (!canceled) setBonus(p.entries.filter(e => e.reason === 'bonus').slice(0, 5)) }).catch(() => { if (!canceled) setBonus([]) })
    return () => { canceled = true }
  }, [member.id, refreshTick])
  const takeBack = async (e: PointEntry) => {
    if (!await dialog.confirm({ title: tn(e.amount, 'Take back {n} point from {name}?', 'Take back {n} points from {name}?', { name: member.name }), body: e.note ?? undefined, confirmLabel: t('Take back'), danger: true })) return
    try {
      await api.deletePointAward(e.id)
      setBonus(list => list.filter(x => x.id !== e.id))
      reloadCore()
    } catch (err) {
      toast(err instanceof ApiError ? err.message : t("Couldn't take those points back."), true)
    }
  }
  if (!parentDevice && bonus.length === 0) return null
  return (
    <div className="profile-bonus">
      {bonus.length > 0 && <h4 className="profile-bonus-head">{t('Bonus points')}</h4>}
      {bonus.length > 0 && (
        <ul className="profile-bonus-list">
          {bonus.map(e => (
            <li key={e.id}>
              {parentDevice
                ? <button type="button" className="profile-bonus-row" onClick={() => takeBack(e)} aria-label={t('{bonus}. Take back', { bonus: bonusLine({ points: e.amount, note: e.note ?? null }) })}>🎉 {bonusLine({ points: e.amount, note: e.note ?? null })}</button>
                : <span className="profile-bonus-row">🎉 {bonusLine({ points: e.amount, note: e.note ?? null })}</span>}
            </li>
          ))}
        </ul>
      )}
      {parentDevice && <GivePoints memberId={member.id} className="btn btn-secondary profile-link" label={t('Give {name} points', { name: member.name })}>⭐ {t('Give points')}</GivePoints>}
    </div>
  )
}

function BooksCard({ s }: { s: MemberStats }) {
  const shelf = s.books.shelf
  const rated = shelf.filter(b => b.rating)
  const loved = [...shelf].reverse().find(b => b.rating === 5)
  return (
    <section className="board-card profile-card" aria-labelledby="pf-books">
      <h3 id="pf-books" className="snap-heading">{t('Bookshelf')} <span>{s.books.shelfScope === 'year' ? tn(shelf.length, 'This year: {n} book', 'This year: {n} books') : tn(shelf.length, 'All time: {n} book', 'All time: {n} books')}</span></h3>
      <ul className="profile-shelf" aria-label={shelf.length ? t('Books: {titles}', { titles: shelf.map(b => b.title).join(', ') }) : t('No books finished yet')}>
        {shelf.length === 0 && <li className="profile-note">{t('No books finished yet.')}</li>}
        {shelf.map((b, i) => <li key={b.id} className="profile-spine" title={b.title} style={{ height: 46 + Math.min(40, (b.pages ?? 100) / 5), background: SPINES[i % SPINES.length] }} />)}
      </ul>
      <div className="profile-facts">
        {shelf.some(b => b.pages) && <span className="profile-fact">{tn(shelf.reduce((sum, b) => sum + (b.pages ?? 0), 0), '{n} page', '{n} pages')}</span>}
        {shelf.some(b => b.minutes) && <span className="profile-fact">{t('{time} listened', { time: hoursMinutes(shelf.reduce((sum, b) => sum + (b.minutes ?? 0), 0)) })}</span>}
        {rated.length > 0 && <span className="profile-fact">{t('Avg {rating} ★', { rating: (rated.reduce((sum, b) => sum + (b.rating ?? 0), 0) / rated.length).toLocaleString(intlLocale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}</span>}
        {loved && <span className="profile-fact">{t('Loved: {title}', { title: loved.title })}</span>}
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
  const { refreshTick, settings } = useApp()
  const rewards = rewardsOn(settings)
  const [counts, setCounts] = useState<[number, number] | null>(null)
  useEffect(() => {
    Promise.all([api.getPendingApprovals(), rewards ? api.getRedemptions({ memberId: member.id, status: 'pending' }) : []])
      .then(([c, r]) => setCounts([c.filter(x => x.memberId === member.id).length, r.length])).catch(() => setCounts(null))
  }, [member.id, refreshTick, rewards])
  if (!counts || counts[0] + counts[1] === 0) return null
  return (
    <section className="board-card profile-card" aria-labelledby="pf-waiting">
      <h3 id="pf-waiting" className="snap-heading">{t('Waiting for your OK')} <span>{t('Grown-ups only')}</span></h3>
      <p className="profile-note">{counts[0] && counts[1]
        ? t('{chores} and {rewards} from {name}.', { chores: tn(counts[0], '{n} chore', '{n} chores'), rewards: tn(counts[1], '{n} reward', '{n} rewards'), name: member.name })
        : t('{things} from {name}.', { things: counts[0] ? tn(counts[0], '{n} chore', '{n} chores') : tn(counts[1], '{n} reward', '{n} rewards'), name: member.name })}</p>
      <a className="btn btn-secondary profile-link" href={counts[0] ? '#/chores' : `#/rewards/${member.id}`}>{counts[0] ? t('Open Chores') : t('Open Rewards')}</a>
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
      <h3 id="pf-journal" className="snap-heading">{t('Journal')} <span>🔒 {privateTag(member)}</span></h3>
      {evening && week && week.of > 0 && <p className="profile-note">🎯 {t('Goals met this week:')} <strong>{t('{done} of {total}', { done: week.met, total: week.of })}</strong></p>}
      <p className="profile-note">{t("Check-ins, goals and {name}'s own notes, day by day.", { name: member.name })}</p>
      <a className="btn btn-secondary profile-link" href={`#/journal/${member.id}`}>{t('Open the journal')}</a>
    </section>
  )
}

/** Their own device and parents' devices only: a way into their insights (nothing from them on the profile itself). */
function InsightsCard({ member }: { member: Member }) {
  return (
    <section className="board-card profile-card" aria-labelledby="pf-insights">
      <h3 id="pf-insights" className="snap-heading">{t('Insights')} <span>🔒 {privateTag(member)}</span></h3>
      <p className="profile-note">{t('How sleep, feelings and goals have been going, next to chores and busy days.')}</p>
      <a className="btn btn-secondary profile-link" href={`#/insights/${member.id}`}>{t('Open insights')}</a>
    </section>
  )
}

/** Their own device and parents' devices only: a way into their medicines page (no names or doses here). */
function MedicationsCard({ member }: { member: Member }) {
  return (
    <section className="board-card profile-card" aria-labelledby="pf-meds">
      <h3 id="pf-meds" className="snap-heading">{t('Medicines')} <span>🔒 {privateTag(member)}</span></h3>
      <p className="profile-note">{t("Today's doses and the last 7 days.")}</p>
      <a className="btn btn-secondary profile-link" href={`#/medications/${member.id}`}>{t('Open medicines')}</a>
    </section>
  )
}
