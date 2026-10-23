import { goalLabel, goalProgressLabel, validGoal } from './choreGoal.ts'
import type { ChoreGoal, GoalProgress } from './choreGoal.ts'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useHashParam } from './hashQuery.ts'
import { addDays, isSameDay } from 'date-fns'
import { GivePoints } from './GivePoints.tsx'
import { useIsPhone } from './useIsPhone.ts'
import { useApp } from './AppContext.tsx'
import { actingMember } from './actingAs.ts'
import { api, ApiError } from './api.ts'
import type { Chore, ChoreDay, ChoreSuggestion, LeaderboardEntry, LeaderboardPeriod, List, PendingApproval, Plugin, Redemption } from './types.ts'
import { MEMBER_EMOJI, rewardsOn } from './types.ts'
import { dateKey, todayKeyInTz } from './date.ts'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isSingleEmoji } from './emoji.ts'
import { CheckIcon, EditIcon, PlusIcon } from './icons.tsx'
import { ActivityRing } from './ActivityRing.tsx'
import { IDLE_RESET_EVENT } from './App.tsx'
import { announce } from './a11y.tsx'
import { useDialog } from './dialog.tsx'
import { ChoreLibrarySheet, type RepeatDraft } from './ChoreLibrary.tsx'
import GetStuffDone from './GetStuffDone.tsx'
import { intervalRrule } from './choreLibrary.ts'
import { rruleToForm, scheduleBody, scheduleDates, scheduleText, validSchedule } from './choreSchedule.ts'
import type { ScheduleForm } from './choreSchedule.ts'
import { ChoreScheduleFields } from './ChoreScheduleFields.tsx'
import { Face, type FaceMember, ChipFace } from './Face'
import { ChoreTimerText, startChoreTimer } from './ChoreTimer.tsx'
import { formatTime } from './timeFormat.ts'
import { durationLabel } from './timers.ts'
import { PointsStepper, SuggestChoreSheet, SuggestionAnswerSheet, SuggestionCards } from './ChoreSuggest.tsx'
import { NOT_NOW, suggestionDetails } from './choreSuggest.ts'
import { shareText } from './rewardSplit.ts'
import { choreOrder, earnedText, isLate, pointsEarned, pointsGivenOut, waitsForOk } from './choreDay.ts'
import { latestOnly } from './latest.ts'
import { DAY, formatDate, LONG_DAY, msg, t, tn, tm } from './i18n.ts'

function updatedGoalProgress(progress: GoalProgress, doneDelta: number, pendingDelta: number): GoalProgress {
  const done = Math.max(0, progress.done + doneDelta), pending = Math.max(0, progress.pending + pendingDelta)
  return { ...progress, done, pending, full: done + pending >= progress.target }
}

const CONFETTI_COLORS = ['#FF9E7A', '#FFD166', '#7ED9A6', '#7AB8FF', '#B39DFF', '#FF8FA3']

const LB_PERIOD_STORAGE = 'kinwall.leaderboardPeriod'
const LB_PERIODS: LeaderboardPeriod[] = ['today', 'week', 'month']

function loadLbPeriod(): LeaderboardPeriod {
  try {
    const v = localStorage.getItem(LB_PERIOD_STORAGE)
    return (LB_PERIODS as string[]).includes(v ?? '') ? (v as LeaderboardPeriod) : 'week'
  } catch { return 'week' }
}
function saveLbPeriod(p: LeaderboardPeriod) {
  try { localStorage.setItem(LB_PERIOD_STORAGE, p) } catch { /* ignore */ }
}

const LB_PERIOD_LABEL: Record<LeaderboardPeriod, string> = { today: msg('Today'), week: msg('This week'), month: msg('This month') }

/** The pills, led by the period they count (Today / This week / This month). The period only
 * changes the leaderboard, so it lives here rather than above the chores. */
function Leaderboard() {
  const [period, setPeriod] = useState<LeaderboardPeriod>(loadLbPeriod)
  useEffect(() => { saveLbPeriod(period) }, [period])
  const { refreshTick, members } = useApp()
  // Spendable balance (all-time earned minus what's been spent) next to the period's earned points.
  const spendable = (id: string) => members.find(m => m.id === id)?.balance ?? null
  const [board, setBoard] = useState<LeaderboardEntry[]>([])
  const prevLeaderId = useRef<string | null | undefined>(undefined) // undefined = not loaded yet, don't bounce on first paint
  const [bounceId, setBounceId] = useState<string | null>(null)

  const fresh = useRef(latestOnly()).current // newest answer wins (latest.ts)
  useEffect(() => {
    fresh(api.getLeaderboard(period)).then(list => {
      setBoard(list)
      const leader = list.find(e => e.rank === 1 && e.points > 0)?.memberId ?? null
      if (prevLeaderId.current !== undefined && leader && leader !== prevLeaderId.current) {
        setBounceId(leader)
        setTimeout(() => setBounceId(null), 650)
      }
      prevLeaderId.current = leader
    }).catch(() => { /* leave the last-known board up rather than blanking it on a transient error */ })
  }, [period, refreshTick, fresh])

  if (board.length === 0) return null
  const maxPoints = Math.max(1, ...board.map(e => e.points))

  return (
    <div className="leaderboard-strip">
      <select className="settings-select lb-period" aria-label={t('Leaderboard period')} value={period} onChange={e => setPeriod(e.target.value as LeaderboardPeriod)}>
        {LB_PERIODS.map(p => <option key={p} value={p}>{tm(LB_PERIOD_LABEL[p])}</option>)}
      </select>
      <div className="leaderboard-pills" role="list" aria-label={t('Leaderboard')}>
        {board.map(e => (
          <div key={e.memberId} role="listitem" className="leaderboard-item">
          <a className="leaderboard-pill" href={`#/profile/${e.memberId}`}
            aria-label={[e.points > 0 ? tn(e.points, '{name}, rank {rank}, {n} point', '{name}, rank {rank}, {n} points', { name: e.name, rank: e.rank }) : t('{name}, no points yet', { name: e.name }), e.rank === 1 && e.points > 0 && t('leader'), e.streak >= 2 && t('{n} day streak', { n: e.streak }), spendable(e.memberId) !== null && t('{n} to spend', { n: spendable(e.memberId) ?? 0 })].filter(Boolean).join(', ')}>
            <div className="lb-rank">{e.points > 0 && `#${e.rank}`}</div>{/* no rank until they have points, not everyone "#1" at 0 */}
            <Face
              m={{ ...e, picture: members.find(m => m.id === e.memberId)?.picture }}
              className={`lb-avatar ${bounceId === e.memberId ? 'crown-bounce' : ''}`}
              style={{ ['--lb-color' as string]: e.color }}
            />
            <div className="lb-info">
              <div className="lb-name-row">
                <span className="lb-name">{e.name}</span>
                {e.rank === 1 && e.points > 0 && <span className="lb-crown" aria-label={t('Leader')}>👑</span>}
                {e.streak >= 2 && <span className="lb-streak" aria-label={t('{n} day streak', { n: e.streak })}>🔥{e.streak}</span>}
              </div>
              <div className="lb-bar-track"><div className="lb-bar-fill" style={{ width: `${(e.points / maxPoints) * 100}%`, background: e.color }} /></div>
              {spendable(e.memberId) !== null && <div className="lb-spend" aria-hidden="true">{t('{n} to spend', { n: spendable(e.memberId) ?? 0 })}</div>}
            </div>
            <div className="lb-points">{t('{n} pts', { n: e.points })}</div>
          </a>
          </div>
        ))}
      </div>
    </div>
  )
}

export function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 14 }, () => ({
    dx: (Math.random() - 0.5) * 160,
    dy: (Math.random() - 0.8) * 140,
    rot: Math.random() * 360,
    color: CONFETTI_COLORS[Math.floor(Math.random() * CONFETTI_COLORS.length)],
    delay: Math.random() * 60,
  })), [])
  return (
    <>
      {pieces.map((p, i) => (
        <span key={i} className="confetti-piece" style={{
          ['--dx' as string]: `${p.dx}px`, ['--dy' as string]: `${p.dy}px`, ['--rot' as string]: `${p.rot}deg`,
          background: p.color, animationDelay: `${p.delay}ms`,
        }} />
      ))}
    </>
  )
}

function ProgressRing({ pct, m, label }: { pct: number; m: FaceMember; label: string }) {
  const color = m.color
  const r = 27, c = 2 * Math.PI * r
  return (
    <div className="progress-ring-wrap" role="img" aria-label={label}>
      <svg viewBox="0 0 64 64" width="100%" height="100%" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--border)" strokeWidth="5" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset 0.4s ease' }} />
      </svg>
      <Face m={m} className="avatar" style={{ width: '69%', height: '69%', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }} />
    </div>
  )
}

function ChoreCard({ chore, editing, late, onToggle, onEdit }: { chore: ChoreDay; editing: boolean; late?: boolean; onToggle: () => void; onEdit: () => void }) {
  const { members, selectedMemberId, parentDevice } = useApp()
  const schedule = chore.repeatGoal ? goalLabel(chore.repeatGoal) : scheduleText(chore.rrule)
  // An Anyone chore says who got the points once it's done.
  const by = !chore.memberId && chore.completed ? (members.find(m => m.id === chore.completedBy)?.name ?? t('nobody in particular')) : null
  // Waiting for a parent's OK: ticked (tapping unticks it) but not done.
  const pending = !!chore.pending
  const ticked = chore.completed || pending
  const goalBlocked = !!chore.goalProgress?.full && !ticked
  const goalProgress = chore.goalProgress
  const goalText = goalProgress && chore.repeatGoal ? goalProgressLabel(chore.repeatGoal, goalProgress.done) : ''
  const notYet = !ticked && chore.rejection ? (chore.rejection.note ? t('Not yet: {note}', { note: chore.rejection.note }) : t('Not yet')) : ''
  const cl = chore.checklist
  const checklist = cl && !ticked ? `☑ ${cl.done}/${cl.total} ${cl.name}` : '' // a reusable list resets once done: "0/1" would look unfinished
  // A linked activity: tapping the card plays it (as the chore's person), the check still ticks it.
  // Removed or turned off, it's a plain chore that says so.
  const act = chore.activity?.available ? chore.activity : null
  const actLabel = act ? `${act.emoji ?? ''} ${t('{n} min of {name}', { n: act.needSeconds / 60, name: act.name ?? t('activity') })}`.trim() : chore.activity ? activityGoneText(chore.activity, parentDevice) : ''
  const actProgress = act && !chore.completed && act.doneSeconds > 0 ? t('{done} of {need} min', { done: Math.floor(act.doneSeconds / 60), need: act.needSeconds / 60 }) : ''
  const player = chore.memberId ?? selectedMemberId
  const play = () => { location.hash = `#/activities/plugin/${act!.pluginId}${player ? `?member=${player}` : ''}` }
  // A timer (not on an activity chore, which times itself): tapping the card starts it, the check ticks it.
  const timer = !act && !ticked && chore.timerMinutes ? chore.timerMinutes : 0
  const startsAt = chore.dueTime && /^\d{2}:\d{2}$/.test(chore.dueTime) ? late && !ticked ? t('{time} (late)', { time: formatTime(chore.dueTime) }) : formatTime(chore.dueTime) : ''
  const [burst, setBurst] = useState(false)
  // Toggle on click, not pointerup: a sheet the toggle opens (Who did it?, a checklist) would
  // otherwise catch the click a touch sends right after lifting the finger.
  const handleClick = () => {
    if (!ticked) setBurst(true)
    onToggle()
  }
  const info = (
    <>
      <div className="chore-emoji" aria-hidden="true">{chore.emoji}</div>
      <div className="chore-info">
        <div className={`chore-title ${chore.completed ? 'done' : ''}`}>{chore.title}</div>
        <div className="chore-pts">{[startsAt, by && t('Done by {name}', { name: by }), t('{n} pts', { n: chore.points }), schedule, checklist].filter(Boolean).join(' · ')}</div>
        {goalText && <div className="chore-pts">{goalText}</div>}
        {goalBlocked && <div className="chore-waiting">{goalProgress!.done >= goalProgress!.target ? t('Goal reached') : t('Waiting for OK')}</div>}
        {goalProgress && goalProgress.pending > 0 && <div className="chore-waiting">{t('{n} waiting for OK this interval', { n: goalProgress.pending })}</div>}
        {timer > 0 && <div className="chore-pts chore-activity"><ChoreTimerText chore={chore} /></div>}
        {pending && <div className="chore-waiting">{t('Waiting for OK')}</div>}
        {notYet && <div className="chore-notyet">{notYet}</div>}
        {actLabel && <div className="chore-pts chore-activity">{actLabel}</div>}
        {actProgress && <div className="chore-pts chore-activity-progress"><ActivityRing done={act!.doneSeconds} need={act!.needSeconds} />{actProgress}</div>}
      </div>
    </>
  )
  const check = <div className={`chore-check ${chore.completed ? 'done' : pending ? 'pending' : ''}`}>{chore.completed ? <CheckIcon width={18} height={18} /> : pending && <span aria-hidden="true">⏳</span>}</div>
  const said = [pending && t("waiting for a parent's OK"), notYet].filter(Boolean)
  const editOnRightClick = (e: React.MouseEvent) => { e.preventDefault(); onEdit() }
  // Edit chores mode (parent devices): the whole card opens the editor, a pencil where the check was.
  if (editing) {
    return (
      <button type="button" className="chore-card chore-card-edit" aria-haspopup="dialog" aria-label={t('Edit {title}', { title: chore.title })} onClick={onEdit}>
        {info}
        <span className="chore-edit-mark" aria-hidden="true"><EditIcon width={18} height={18} /></span>
      </button>
    )
  }
  if (goalBlocked) return <div className="chore-card chore-card-goal-met" onContextMenu={editOnRightClick}>
    {info}
    {parentDevice && <button type="button" className="icon-btn" aria-label={t('Edit {title}', { title: chore.title })} onClick={onEdit}><EditIcon width={18} height={18} /></button>}
  </div>
  if (act || timer) {
    // Two controls: play or start the timer (the card) and done (the check). Right-click still edits.
    return (
      <>
        <div className={`chore-card ${chore.completed ? 'done' : ''}`} onContextMenu={editOnRightClick}>
          <button className="chore-play" aria-label={act ? [t('Play {activity} for {chore}', { activity: act.name ?? t('activity'), chore: chore.title }), actLabel, actProgress && t('{progress} played', { progress: actProgress })].filter(Boolean).join(', ') : [t('Start a {time} timer for {chore}', { time: durationLabel(timer), chore: chore.title }), startsAt && t('starts at {time}', { time: startsAt })].filter(Boolean).join(', ')}
            onClick={() => { if (act) play(); else startChoreTimer(chore, members.find(m => m.id === player)?.name) }}>{info}</button>
          <button className="chore-check-btn" role="checkbox" aria-checked={pending ? 'mixed' : chore.completed}
            aria-label={[t('{title} done', { title: chore.title }), by && t('by {name}', { name: by }), tn(chore.points, '{n} point', '{n} points'), ...said].filter(Boolean).join(', ')} onClick={handleClick}>{check}</button>
          {burst && <Confetti />}
        </div>
        {parentDevice && <button className="btn btn-secondary focus-reveal" onClick={onEdit}>{t('Edit {title}', { title: chore.title })}</button>}
      </>
    )
  }

  // Tap/Space/Enter toggles it (a checkbox to assistive tech); Edit chores mode, right-click/Menu key
  // or the Edit button that appears when tabbed to opens the editor.
  const toggleByKey = (e: React.KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()
    if (!ticked) setBurst(true)
    onToggle()
  }
  return (
    <>
      <div className={`chore-card ${chore.completed ? 'done' : ''}`} role="checkbox" aria-checked={pending ? 'mixed' : chore.completed} tabIndex={0}
        aria-label={[chore.title, startsAt && t('starts at {time}', { time: startsAt }), by && t('done by {name}', { name: by }), tn(chore.points, '{n} point', '{n} points'), schedule, goalText, checklist && t('checklist {name} {done} of {total} done', { name: cl!.name, done: cl!.done, total: cl!.total }), actLabel, ...said].filter(Boolean).join(', ')}
        onKeyDown={toggleByKey} onContextMenu={editOnRightClick} onClick={handleClick}>
        {info}
        {check}
        {burst && <Confetti />}
      </div>
      {parentDevice && <button className="btn btn-secondary focus-reveal" onClick={onEdit}>{t('Edit {title}', { title: chore.title })}</button>}
      {chore.activity && !act && parentDevice && <a className="chore-activity-fix" href="#/activities?more=1">{chore.activity.name ? t('Turn it on in Get more activities') : t('Install it from Get more activities')}</a>}
    </>
  )
}

/** What an activity chore says when its activity was removed or turned off. A parent gets a link
 * to fix it; anyone else can still do it and tick it, and a parent okays it (the server holds it). */
function activityGoneText(a: NonNullable<ChoreDay['activity']>, parentDevice: boolean): string {
  if (parentDevice) return a.name ? t('{name} is turned off.', { name: a.name }) : t("This chore's activity isn't installed.")
  return a.name
    ? t("{name} isn't here right now. Do it with a grown-up, and a parent will okay it.", { name: a.name })
    : t("This chore's activity isn't here right now. Do it with a grown-up, and a parent will okay it.")
}

/** Parent devices: chores ticked on a wall screen or kid's device that wait for an OK. Approve
 * awards the points; Not yet sends it back unticked with an optional note the kid sees. Rewards
 * redeemed there wait here too (Approve / Not this time), and approved ones until they're Given.
 * The Rewards screen shows the same queue with `only="rewards"`. */
export function ApprovalQueue({ onChanged = () => {}, only }: { onChanged?: () => void; only?: 'rewards' }) {
  const { members, toast, reloadCore, refreshTick, settings } = useApp()
  const rewardsShown = rewardsOn(settings)
  const [items, setItems] = useState<PendingApproval[]>([])
  const [rewards, setRewards] = useState<Redemption[]>([])
  const [notYet, setNotYet] = useState<PendingApproval | null>(null)
  const [notThisTime, setNotThisTime] = useState<Redemption | null>(null)
  const [note, setNote] = useState('')
  const [ideas, setIdeas] = useState<ChoreSuggestion[]>([]) // chores kids suggested
  const [answer, setAnswer] = useState<{ s: ChoreSuggestion; mode: 'yes' | 'no' } | null>(null)
  const fetchItems = () => {
    if (!only) api.getPendingApprovals().then(setItems).catch(() => { /* the section just stays as it was */ })
    if (!only) api.getChoreSuggestions().then(l => setIdeas(l.filter(s => s.status === 'pending'))).catch(() => { /* likewise */ })
    if (rewardsShown) api.getRedemptions({ status: 'pending,approved' }).then(setRewards).catch(() => { /* likewise */ })
    else setRewards([]) // Rewards turned off: requests wait, out of sight
  }
  useEffect(fetchItems, [refreshTick, rewardsShown]) // eslint-disable-line react-hooks/exhaustive-deps
  const name = (p: { memberId: string | null }) => members.find(m => m.id === p.memberId)?.name ?? t('Someone')
  const decide = async (r: Redemption, action: 'approve' | 'decline' | 'given', done: string, note?: string) => {
    setRewards(list => action === 'approve' ? list.map(x => x === r ? { ...x, status: 'approved' } : x) : list.filter(x => x !== r)) // optimistic
    try {
      await api.decideRedemption(r.id, action, note)
      toast(done)
      announce(done)
      reloadCore()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('Could not update reward'), true)
      fetchItems()
    }
  }
  const sendRewardBack = () => {
    const r = notThisTime!
    setNotThisTime(null)
    decide(r, 'decline', r.shares ? t('{title}: points back to everyone', { title: r.title }) : t('{title}: points back to {name}', { title: r.title, name: name(r) }), note.trim() || undefined)
  }
  const whenR = (r: Redemption) => r.date === dateKey(new Date()) ? '' : formatDate(new Date(r.requestedAt), DAY)
  const count = items.length + ideas.length + rewards.filter(r => r.status === 'pending').length
  // On Chores, two rows and "Show all (N)", so a busy day doesn't push the chores off screen.
  const SHOWN = only ? Infinity : 2
  const total = items.length + ideas.length + rewards.length
  const [showAll, setShowAll] = useState(false)
  const when = (p: PendingApproval) => {
    if (p.date === dateKey(new Date())) return ''
    const [y, m, d] = p.date.split('-').map(Number)
    return formatDate(new Date(y, m - 1, d), DAY)
  }
  const act = async (p: PendingApproval, call: () => Promise<unknown>, done: string) => {
    setItems(list => list.filter(x => x !== p)) // optimistic
    try {
      await call()
      toast(done)
      announce(done)
      onChanged()
      reloadCore()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('Could not update chore'), true)
      fetchItems()
    }
  }
  const sendBack = () => {
    const p = notYet!
    setNotYet(null)
    act(p, () => api.rejectChore(p.choreId, p.date, note.trim() || undefined), t('{title} sent back to {name}', { title: p.title, name: name(p) }))
  }
  return (
    <>
      {(items.length > 0 || ideas.length > 0 || rewards.length > 0) && (
        <section className="approve-card" aria-labelledby="approve-heading">
          <h3 id="approve-heading" className="approve-heading">{only ? t('Reward requests') : t('To approve')} {count > 0 && <span className="approve-count">{count}</span>}</h3>
          <ul className="approve-list">
            {[...items.map(p => (
              <li key={`${p.choreId}:${p.date}`} className="approve-row">
                <span className="approve-emoji" aria-hidden="true">{p.emoji}</span>
                <div className="approve-info">
                  <div className="approve-title">{p.title}</div>
                  <div className="approve-sub">{[name(p), when(p), t('{n} pts', { n: p.points })].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="approve-actions">
                  <button className="btn btn-secondary" onClick={() => { setNote(''); setNotYet(p) }} aria-label={t('Not yet: {title} by {name}', { title: p.title, name: name(p) })}>{t('Not yet')}</button>
                  <button className="btn btn-primary" onClick={() => act(p, () => api.approveChore(p.choreId, p.date), t('Approved: +{points} for {name}', { points: p.points, name: name(p) }))} aria-label={t('Approve {title} by {name}', { title: p.title, name: name(p) })}>{t('Approve')}</button>
                </div>
              </li>
            )), ...ideas.map(s => (
              <li key={s.id} className="approve-row">
                <span className="approve-emoji" aria-hidden="true">{s.emoji ?? '💡'}</span>
                <div className="approve-info">
                  <div className="approve-title">{s.title}</div>
                  <div className="approve-sub">{[t("{name}'s idea", { name: name(s) }), t('asks {n} pts', { n: s.points }), suggestionDetails(s)].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="approve-actions">
                  <button className="btn btn-secondary" onClick={() => setAnswer({ s, mode: 'no' })} aria-label={t("Not this time: {title}, {name}'s idea", { title: s.title, name: name(s) })}>{t('Not this time')}</button>
                  <button className="btn btn-primary" onClick={() => setAnswer({ s, mode: 'yes' })} aria-label={t("Say yes to {title}, {name}'s idea", { title: s.title, name: name(s) })}>{t('Say yes…')}</button>
                </div>
              </li>
            )), ...rewards.map(r => (
              <li key={r.id} className="approve-row">
                <span className="approve-emoji" aria-hidden="true">{r.emoji ?? '🎁'}</span>
                <div className="approve-info">
                  <div className="approve-title">{r.title}</div>
                  <div className="approve-sub">{[r.shares ? t('Split: {shares}', { shares: shareText(r.shares, id => name({ memberId: id })) }) : name(r), whenR(r), t('{n} pts', { n: r.cost }), r.status === 'approved' && t('approved, not given yet')].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="approve-actions">
                  {r.status === 'pending' ? <>
                    <button className="btn btn-secondary" onClick={() => { setNote(''); setNotThisTime(r) }} aria-label={t('Not this time: {title} for {name}', { title: r.title, name: name(r) })}>{t('Not this time')}</button>
                    <button className="btn btn-primary" onClick={() => decide(r, 'approve', t('Approved: {title} for {name}', { title: r.title, name: name(r) }))} aria-label={t('Approve {title} for {name}', { title: r.title, name: name(r) })}>{t('Approve')}</button>
                  </> : <>
                    <button className="btn btn-secondary" onClick={() => { setNote(''); setNotThisTime(r) }} aria-label={t('Cancel {title} for {name} and give the points back', { title: r.title, name: name(r) })}>{t('Cancel')}</button>
                    <button className="btn btn-primary" onClick={() => decide(r, 'given', t('Given: {title} to {name}', { title: r.title, name: name(r) }))} aria-label={t('{title} given to {name}', { title: r.title, name: name(r) })}>{t('Given')}</button>
                  </>}
                </div>
              </li>
            ))].filter((_, i) => showAll || i < SHOWN)}
          </ul>
          {total > SHOWN && (
            <button type="button" className="link-btn approve-more" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}>{showAll ? t('Show fewer') : t('Show all ({n})', { n: total })}</button>
          )}
        </section>
      )}
      {answer && (
        <SuggestionAnswerSheet s={answer.s} mode={answer.mode} onClose={() => setAnswer(null)}
          onDone={msg => { setIdeas(l => l.filter(x => x.id !== answer.s.id)); setAnswer(null); toast(msg); announce(msg); onChanged(); reloadCore() }} />
      )}
      {notThisTime && (
        <Sheet title={notThisTime.status === 'pending' ? t('Not this time') : t('Cancel reward')} onClose={() => setNotThisTime(null)} actions={<button className="btn btn-primary" onClick={sendRewardBack}>{t('Give points back')}</button>}>
          <p className="settings-row-sub" style={{ margin: '0 0 12px' }}>{notThisTime.emoji} {notThisTime.shares ? t("{title}: everyone chipping in gets their points back. They'll see your note.", { title: notThisTime.title }) : t("{title}: {name} gets their {n} points back. They'll see your note.", { title: notThisTime.title, name: name(notThisTime), n: notThisTime.cost })}</p>
          <div className="field">
            <label htmlFor="notthistime-note">{t('Note (optional)')}</label>
            <div className="chip-row suggest-praise">
              {NOT_NOW.map(p => <button key={p} type="button" className="chip" onClick={() => setNote(tm(p))}>{tm(p)}</button>)}
            </div>
            <input id="notthistime-note" type="text" maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder={t("Let's do it on Saturday")} autoComplete="off"
              onKeyDown={e => { if (e.key === 'Enter') sendRewardBack() }} />
          </div>
        </Sheet>
      )}
      {notYet && (
        <Sheet title={t('Not yet')} onClose={() => setNotYet(null)} actions={<button className="btn btn-primary" onClick={sendBack}>{t('Send back')}</button>}>
          <p className="settings-row-sub" style={{ margin: '0 0 12px' }}>{notYet.emoji} {t("{title} goes back to {name}, unticked. They'll see your note on the chore.", { title: notYet.title, name: name(notYet) })}</p>
          <div className="field">
            <label htmlFor="notyet-note">{t('Note (optional)')}</label>
            <input id="notyet-note" type="text" maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder={t('Please make the bed properly')} autoComplete="off"
              onKeyDown={e => { if (e.key === 'Enter') sendBack() }} />
          </div>
        </Sheet>
      )}
    </>
  )
}

export default function Chores() {
  const isPhone = useIsPhone()
  const { members, selectedMemberId, focusMemberId, focusShowsShared, settings, toast, reloadCore, refreshTick, parentDevice, meMemberId } = useApp()
  const dialog = useDialog()
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [chores, setChores] = useState<ChoreDay[]>([])
  const [loadedKey, setLoadedKey] = useState<string | null>(null) // the day `chores` holds
  const [error, setError] = useState(false)
  const [editChore, setEditChore] = useState<Chore | 'new' | null>(null)
  const [editing, setEditing] = useState(false) // Edit chores mode: a tap opens a chore's editor instead of ticking it
  // The chore whose checklist is open in Get stuff done, by id in the link (#/chores?checklist=<id>) so a reload reopens it.
  const [checklistId, setChecklistId] = useHashParam('checklist')
  const checklistFor = chores.find(c => c.id === checklistId) ?? null
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [repeatDraft, setRepeatDraft] = useState<RepeatDraft | null>(null) // the library's "Make it repeat", in the chore editor
  // Kids suggest chores: off a parent's device, for the person shown (else a wall asks who first).
  const [suggestFor, setSuggestFor] = useState<string | 'who' | null>(null)
  const canSuggest = !parentDevice && settings.features.chores && settings.kidChoreSuggestions
  // Kids suggest chores (grown-ups when there are no kids): a picked grown-up still gets asked who.
  const suggester = actingMember(selectedMemberId ?? focusMemberId, members, m => !m.grownUp || !members.some(x => !x.grownUp))?.id ?? null
  const [sentTick, setSentTick] = useState(0) // a new idea shows on its card straight away

  const key = dateKey(selectedDate)
  // Loading only while a new day's chores are on their way. A refresh of the same day (a sheet
  // saved, the rev moved) keeps what's on screen, so the columns don't collapse and jump back.
  const loading = loadedKey !== key
  // Keep the selected chip visible when the day changes programmatically (e.g. after adding a chore).
  useEffect(() => { document.querySelector('.date-chip.active')?.scrollIntoView({ inline: 'center', block: 'nearest' }) }, [key])

  const keyRef = useRef(key)
  keyRef.current = key
  const load = () => {
    const k = key
    api.getChoresDay(k).then(c => { if (keyRef.current === k) { setChores(c); setError(false); setLoadedKey(k) } })
      .catch(() => { if (keyRef.current === k) { setError(true); setLoadedKey(k) } })
  }
  useEffect(load, [key, refreshTick])

  useEffect(() => {
    const onIdle = () => { setSelectedDate(new Date()); setEditChore(null); setEditing(false); setChecklistId(null); setLibraryOpen(false); setRepeatDraft(null); setSuggestFor(null) }
    window.addEventListener(IDLE_RESET_EVENT, onIdle)
    return () => window.removeEventListener(IDLE_RESET_EVENT, onIdle)
  }, [])

  const strip = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(new Date(), i - 4)), [])

  // Parent devices: clear a person's counted play for an activity chore's day (someone opened it as
  // a kid to check something). A chore the play already completed stays done; unticking is separate.
  const editDay = editChore && editChore !== 'new' ? chores.find(c => c.id === editChore.id) : undefined
  const resetMember = parentDevice && editDay?.activity && editDay.activity.doneSeconds > 0 ? editDay.memberId ?? selectedMemberId : null
  const isToday = key === dateKey(new Date())
  const now = new Date().toTimeString().slice(0, 5) // late start times, as of this render (refreshTick re-renders)
  const resetTime = async (c: ChoreDay, member: string) => {
    const act = c.activity!
    const who = members.find(m => m.id === member)?.name ?? t('Someone')
    if (!await dialog.confirm({
      title: isToday
        ? t("Reset {name}'s {activity} time for today?", { name: who, activity: act.name ?? t('activity') })
        : t("Reset {name}'s {activity} time for {date}?", { name: who, activity: act.name ?? t('activity'), date: formatDate(selectedDate, DAY) }),
      body: c.completed ? t('"{title}" stays done. Untick it if it shouldn\'t count.', { title: c.title }) : t('{done} of {need} min goes back to 0.', { done: Math.floor(act.doneSeconds / 60), need: act.needSeconds / 60 }),
      confirmLabel: t('Reset time'),
    })) return
    try {
      await api.resetPlaytime(act.pluginId, member, key)
      setEditChore(null); load()
      toast(t('Time reset: {title}', { title: c.title })); announce(t('Time reset: {title}', { title: c.title }))
    } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not reset the time'), true) }
  }

  // "Who did it?" for an Anyone chore when the tab isn't filtered or pinned to one person.
  const [whoFor, setWhoFor] = useState<ChoreDay | null>(null)
  const toggle = async (c: ChoreDay, doneBy?: string | null) => {
    if (c.goalProgress?.full && !c.completed && !c.pending) return
    const ticked = c.completed || !!c.pending // a pending tick unticks like a done one
    // Unticking is deliberate: a stray tap on a done chore shouldn't quietly take points back.
    if (ticked && !await dialog.confirm({
      title: t('Mark "{title}" not done?', { title: c.title }),
      body: c.pending ? t('It goes back on the list, and the parent approval request is withdrawn.') : t('It goes back on the list, and the points it earned come off.'),
      confirmLabel: t('Mark not done'),
    })) return
    // A checklist with open items gates completion: open it here to tick off instead.
    if (!ticked && c.checklist && c.checklist.done < c.checklist.total) { setChecklistId(c.id); return }
    // An Anyone chore credits the filtered (or pinned) person; otherwise ask who did it.
    // `doneBy` null = "Nobody in particular" was picked.
    const picked = !ticked && !c.memberId && doneBy === undefined ? actingMember(selectedMemberId, members) : null
    if (!ticked && !c.memberId && doneBy === undefined) {
      if (picked) doneBy = picked.id
      else if (members.length > 0) { setWhoFor(c); return }
    }
    const creditTo = c.memberId ?? doneBy ?? undefined
    // Off a parent's device it's approved at once; otherwise the chore (or the person's default) says.
    // An activity chore whose activity is gone always waits off a parent's device (as on the server).
    const waits = !ticked && waitsForOk(c, members.find(m => m.id === creditTo), parentDevice)
    setChores(list => list.map(x => x.id === c.id ? { ...x, completed: !ticked && !waits, pending: waits, rejection: null, completedBy: ticked ? null : creditTo ?? null, goalProgress: x.goalProgress ? updatedGoalProgress(x.goalProgress, ticked ? -(c.completed ? 1 : 0) : waits ? 0 : 1, ticked ? -(c.pending ? 1 : 0) : waits ? 1 : 0) : null } : x)) // optimistic
    // Ticked off for a past day: earns the household's late-completion share (rounded like the server).
    const late = !ticked && key < dateKey(new Date())
    const pts = late ? Math.round(c.points * settings.lateCompletionCredit / 100) : c.points
    const who = !c.memberId && creditTo ? members.find(m => m.id === creditTo)?.name : undefined
    announce(ticked ? t('{title} not done', { title: c.title })
      : waits ? (who ? t("{title} done by {name}, waiting for a parent's OK", { title: c.title, name: who }) : t("{title} done, waiting for a parent's OK", { title: c.title }))
      : (who ? tn(pts, '{title} done by {name}, {n} point', '{title} done by {name}, {n} points', { title: c.title, name: who }) : tn(pts, '{title} done, {n} point', '{title} done, {n} points', { title: c.title })) + (late ? t(', late') : ''))
    try {
      // Queued, so a tick works offline and syncs later; replays are idempotent (complete/undo for a date).
      if (ticked) await api.queueUncompleteChore(c.id, key)
      else await api.queueCompleteChore(c.id, key, creditTo)
      // Credited to the picked person without asking: say who, with a way back.
      if (picked) toast(`${waits ? t('Sent for a parent’s OK') : t('Done!')} ✓ ${picked.name}${late && !waits ? ` · ${t('+{n} (late)', { n: pts })}` : ''}`, false, { label: t('Undo'), run: () => { void api.queueUncompleteChore(c.id, key).then(() => { load(); reloadCore() }, () => toast(t('Could not undo that'), true)) } })
      else if (late && !waits) toast(t('+{n} (late)', { n: pts }))
      reloadCore()
    } catch (e) {
      setChores(list => list.map(x => x.id === c.id ? { ...x, completed: c.completed, pending: c.pending, rejection: c.rejection, goalProgress: c.goalProgress } : x)) // revert
      toast(e instanceof ApiError ? e.message : t('Could not update chore'), true)
    }
  }

  // A checklist chore completes itself on its last tick when it knows who gets the points (its person,
  // or the person picked); an Anyone chore that would ask Who did it? waits for a tap instead.
  const checklistDone = (c: ChoreDay) => {
    const who = members.find(m => m.id === (c.memberId ?? actingMember(selectedMemberId, members)?.id))
    if (!who || c.completed || c.pending) return null
    const late = key < dateKey(new Date())
    return earnedText(late ? Math.round(c.points * settings.lateCompletionCredit / 100) : c.points, who.name, waitsForOk(c, who, parentDevice))
  }

  // #/chores?done=<id> (from the app's Chores widget): tap that chore once it's loaded, so it asks
  // "Who did it?" or opens its checklist, just like a tap here. A link can come from anywhere, so a
  // chore that would be ticked off straight away asks first.
  const [hashTick, setHashTick] = useState(0) // the app may set the link while this tab is already open
  useEffect(() => {
    const onHash = () => setHashTick(n => n + 1)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    const params = new URLSearchParams(location.hash.split('?')[1] || '')
    const id = params.get('done')
    if (!id || loading) return
    if (key !== dateKey(new Date())) { setSelectedDate(new Date()); return } // the widget shows today
    history.replaceState(history.state, '', '#/chores')
    const c = chores.find(x => x.id === id)
    if (!c || c.completed || c.pending) return
    const opensSheet = (c.checklist && c.checklist.done < c.checklist.total) || (!c.memberId && !selectedMemberId && members.length > 0)
    // sure=1: "Mark done" on the chore's own timer, which already asked.
    if (opensSheet || params.get('sure') === '1') { toggle(c); return }
    const who = members.find(m => m.id === (c.memberId ?? selectedMemberId))?.name
    dialog.confirm({ title: who ? t('Mark "{title}" done for {name}?', { title: c.title, name: who }) : t('Mark "{title}" done?', { title: c.title }), confirmLabel: t('Mark done') }).then(ok => { if (ok) toggle(c) })
  }, [loading, chores, hashTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const columns = [...members, { id: '__anyone', name: t('Anyone'), color: '#C7B8A8', avatar: '🌟', pointsToday: 0, pointsWeek: 0, sort: 999 }]
  const visibleColumns = selectedMemberId
    // Anyone's chores stay beside the filtered person; only a display pinned to someone can hide them.
    ? columns.filter(m => m.id === selectedMemberId || (m.id === '__anyone' && (!focusMemberId || focusShowsShared)))
    : columns
  // Columns share the width equally down to a 110px floor (below which a card's contents stop
  // being legible - .chore-card switches to a stacked layout under that via a container query).
  // Past the floor the row overflows and .chore-columns' overflow-x/scroll-snap take over.
  // Someone with nothing due gets a compact chip under the columns rather than a whole blank
  // column, so the people with chores get the width (capped, so two columns aren't a mile wide).
  const hasChores = (id: string) => chores.some(c => id === '__anyone' ? !c.memberId : c.memberId === id)
  const idle = !loading ? visibleColumns.filter(m => !hasChores(m.id)) : []
  const active = visibleColumns.filter(m => !idle.includes(m))
  const columnsGridStyle = { gridTemplateColumns: `repeat(${Math.max(1, active.length)}, minmax(110px, calc(480px * var(--screen-k))))` }
  const leaderboard = settings.leaderboardEnabled && <Leaderboard />
  const rewardsShown = rewardsOn(settings)

  return (
    <div className="content">
      {/* Scrolls the whole view as one, the day strip pinned (styles.css). */}
      <div className="chores-scroll">
      <div className="chores-header">
        {(parentDevice || meMemberId) && <a className="btn btn-secondary chores-rewards-btn" href="#/routine">{t('Free time')}</a>}
        {/* The date and the buttons share a row (a phone: short date and short words, wrapping
            when they don't fit). Off a phone the leaderboard takes the next row. */}
        <h2 className="period-label" aria-label={formatDate(selectedDate, LONG_DAY)}>{formatDate(selectedDate, isPhone ? DAY : LONG_DAY)}</h2>
        {!isPhone && leaderboard}
        {parentDevice && <GivePoints memberId={selectedMemberId} className="btn btn-secondary chores-rewards-btn chores-library-btn" label={t('Give points')}><span aria-hidden="true">⭐</span> <span className="chores-rewards-label">{t('Give points')}</span><span className="chores-short-label">{t('Give')}</span></GivePoints>}
        {parentDevice && <button type="button" className={`btn chores-rewards-btn chores-library-btn ${editing ? 'btn-primary' : 'btn-secondary'}`} aria-pressed={editing} aria-label={t('Edit chores')} onClick={() => setEditing(e => !e)}><span aria-hidden="true">✏️</span> <span className="chores-rewards-label">{t('Edit chores')}</span><span className="chores-short-label">{t('Edit')}</span></button>}
        {parentDevice && <button type="button" className="btn btn-secondary chores-rewards-btn chores-library-btn" onClick={() => setLibraryOpen(true)}><span aria-hidden="true">🧰</span> <span className="chores-rewards-label">{t('Library')}</span><span className="chores-short-label">{t('Library')}</span></button>}
        {canSuggest && <button type="button" className="btn btn-secondary chores-rewards-btn" onClick={() => setSuggestFor(suggester ?? 'who')}><span aria-hidden="true">💡</span> <span className="chores-rewards-label">{t('Suggest a chore')}</span><span className="chores-short-label">{t('Idea')}</span></button>}
        {rewardsShown && <a className="btn btn-secondary chores-rewards-btn" href={selectedMemberId ? `#/rewards/${selectedMemberId}` : '#/rewards'}><span aria-hidden="true">🎁</span> <span className="chores-rewards-label">{t('Rewards')}</span><span className="chores-short-label">{t('Rewards')}</span></a>}
      </div>
      <div className="date-strip" role="group" aria-label={t('Day')}>
        {strip.map(d => (
          <button key={d.toISOString()} className={`date-chip ${isSameDay(d, selectedDate) ? 'active' : ''}`} aria-pressed={isSameDay(d, selectedDate)} aria-label={formatDate(d, LONG_DAY)} onClick={() => setSelectedDate(d)}>
            <div className="wd">{formatDate(d, { weekday: 'short' })}</div>
            <div className="dn">{d.getDate()}</div>
          </button>
        ))}
      </div>

      {parentDevice && <ApprovalQueue onChanged={load} />}
      {!parentDevice && <SuggestionCards key={sentTick} memberId={suggester} />}

      {isPhone && leaderboard}

      {editing && (
        <div className="edit-mode-bar chores-edit-bar" role="status">
          <span>{t('Tap a chore to edit it.')}</span>
          <button type="button" className="btn btn-primary" onClick={() => setEditing(false)}>{t('Done')}</button>
        </div>
      )}

      {error ? (
        <div className="state-card">{t("Couldn't load chores.")}</div>
      ) : !loading && chores.length === 0 ? (
        <div className="empty-card"><span className="emoji">✨</span>{t('No chores for this day.')}</div>
      ) : (
        <div className="chore-columns" style={columnsGridStyle}>
          {active.map(col => {
            const list = choreOrder(chores.filter(c => col.id === '__anyone' ? !c.memberId : c.memberId === col.id))
            const done = list.filter(c => c.completed || c.goalProgress?.full).length
            const pct = list.length ? done / list.length : 0
            return (
              <div key={col.id} className="chore-column">
                <div className="chore-col-head">
                  <ProgressRing pct={pct} m={col} label={t('{name}: {done} of {total} done', { name: col.name, done, total: list.length })} />
                  <h3 className="chore-col-name" style={{ margin: 0 }}>{col.name}</h3>
                  <div className="chore-col-pts">{col.id === '__anyone' ? t('{n} pts given out', { n: pointsGivenOut(list) }) : isToday ? t('{n} pts today', { n: pointsEarned(chores, col.id) }) : t('{n} pts', { n: pointsEarned(chores, col.id) })}</div>
                  {rewardsShown && col.id !== '__anyone' && 'balance' in col && (
                    <a className="chore-col-spend" href={`#/rewards/${col.id}`} aria-label={t('{name} has {n} points to spend. See rewards', { name: col.name, n: col.balance })}>⭐ {t('{n} to spend', { n: col.balance })}</a>
                  )}
                </div>
                {list.map(c => (
                  <ChoreCard key={c.id} chore={c} editing={editing && parentDevice} late={isToday && isLate(c.dueTime, now)} onToggle={() => toggle(c)} onEdit={() => { if (parentDevice) setEditChore(c) }} />
                ))}
              </div>
            )
          })}
          {idle.length > 0 && (
            <ul className="chores-idle" aria-label={t('Nothing due')}>
              {idle.map(m => (
                <li key={m.id} className="chores-idle-item">
                  <Face m={m} className="chores-idle-avatar" aria-hidden="true" />
                  <span><span className="chores-idle-name">{m.name}</span> · {t('nothing due')}</span>
                  {rewardsShown && m.id !== '__anyone' && 'balance' in m && (
                    <a className="chore-col-spend" href={`#/rewards/${m.id}`} aria-label={t('{name} has {n} points to spend. See rewards', { name: m.name, n: m.balance })}>⭐ {t('{n} to spend', { n: m.balance })}</a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      </div>

      {parentDevice && <button className="fab" onClick={() => setEditChore('new')} aria-label={t('Add chore')}><PlusIcon /></button>}

      {suggestFor === 'who' && (
        <Sheet title={t('Who has an idea?')} onClose={() => setSuggestFor(null)}>
          <div className="who-grid">
            {(members.some(m => !m.grownUp) ? members.filter(m => !m.grownUp) : members).map(m => (
              <button key={m.id} className="who-btn" onClick={() => setSuggestFor(m.id)}>
                <Face m={m} className="who-avatar" aria-hidden="true" />
                {m.name}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {suggestFor && suggestFor !== 'who' && <SuggestChoreSheet memberId={suggestFor} onClose={() => setSuggestFor(null)} onSent={() => { setSuggestFor(null); setSentTick(t => t + 1) }} />}
      {whoFor && (
        <Sheet title={t('Who did it?')} onClose={() => setWhoFor(null)}>
          <p className="settings-row-sub" style={{ margin: '0 0 12px' }}>{whoFor.emoji} {t('{title} · {n} pts go to whoever you pick.', { title: whoFor.title, n: whoFor.points })}</p>
          <div className="who-grid">
            {members.map(m => (
              <button key={m.id} className="who-btn" onClick={() => { const c = whoFor; setWhoFor(null); toggle(c, m.id) }}>
                <Face m={m} className="who-avatar" aria-hidden="true" />
                {m.name}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 12 }} onClick={() => { const c = whoFor; setWhoFor(null); toggle(c, null) }}>{t('Nobody in particular')}</button>
        </Sheet>
      )}
      {/* A chore's checklist opens straight into Get stuff done; all ticked, it completes the chore here. */}
      {checklistFor?.checklist && (
        <GetStuffDone listId={checklistFor.checklist.listId} onClose={() => { setChecklistId(null); load() }}
          chore={{ memberId: checklistFor.memberId, title: checklistFor.title, points: checklistFor.points, done: checklistDone(checklistFor), onComplete: () => { const c = checklistFor; void toggle({ ...c, checklist: null }) } }} />
      )}
      {libraryOpen && parentDevice && (
        <ChoreLibrarySheet onClose={() => setLibraryOpen(false)}
          onAssigned={date => { if (date !== key) setSelectedDate(new Date(`${date}T00:00:00`)); load(); reloadCore() }}
          onRepeat={d => { setLibraryOpen(false); setRepeatDraft(d) }} />
      )}
      {(editChore || repeatDraft) && (
        <ChoreEditSheet
          chore={editChore && editChore !== 'new' ? editChore : null}
          draft={repeatDraft}
          resetTime={resetMember && editDay ? { label: isToday ? t("Reset today's time…") : t("Reset this day's time…"), run: () => void resetTime(editDay, resetMember) } : undefined}
          onClose={() => { setEditChore(null); setRepeatDraft(null) }}
          onSaved={first => {
            setEditChore(null); setRepeatDraft(null)
            // A new chore that isn't scheduled for the day on screen would otherwise vanish on save.
            if (first && !isSameDay(first, selectedDate)) { setSelectedDate(first); toast(t('Added — first on {date}', { date: formatDate(first, DAY) })) }
            load(); reloadCore()
          }}
        />
      )}
    </div>
  )
}

/** Add or edit a chore. `draft` (the library's "Make it repeat") fills a new chore from a library
 * item, repeating at its "about every" interval from the picked day. */
function ChoreEditSheet({ chore, draft, resetTime, onClose, onSaved }: { chore: Chore | null; draft?: RepeatDraft | null; resetTime?: { label: string; run: () => void }; onClose: () => void; onSaved: (firstDate?: Date) => void }) {
  const dialog = useDialog()
  const { members, toast, settings } = useApp()
  const [repeatGoal, setRepeatGoal] = useState<ChoreGoal | null>(chore?.repeatGoal ?? null)
  const from = draft?.item
  const draftRrule = from ? intervalRrule(from.everyN, from.everyUnit) : null
  const storedRrule = chore ? chore.rrule : draftRrule // sent back as-is unless the schedule is edited
  const [title, setTitle] = useState(chore?.title ?? from?.title ?? '')
  const [emoji, setEmoji] = useState(chore?.emoji ?? from?.emoji ?? MEMBER_EMOJI[0])
  const [points, setPoints] = useState(chore?.points ?? from?.points ?? 5)
  const [memberId, setMemberId] = useState<string | null>(chore?.memberId ?? (draft ? draft.memberId : null))
  const [listId, setListId] = useState<string | null>(chore?.listId ?? from?.listId ?? null)
  const [lists, setLists] = useState<List[]>([])
  useEffect(() => { api.getLists().then(setLists).catch(() => { /* picker just stays empty */ }) }, [])
  const [pluginId, setPluginId] = useState<string | null>(chore?.pluginId ?? null)
  const [minutes, setMinutes] = useState(chore?.pluginMinutes ?? 5)
  const [needsApproval, setNeedsApproval] = useState<boolean | null>(chore?.needsApproval ?? from?.needsApproval ?? null)
  const [approveTimedPlay, setApproveTimedPlay] = useState(!!chore?.approveTimedPlay)
  const [timerMinutes, setTimerMinutes] = useState<number | null>(chore?.timerMinutes ?? null)
  const [startTime, setStartTime] = useState(chore?.dueTime && /^\d{2}:\d{2}$/.test(chore.dueTime) ? chore.dueTime : '') // an older free-text one isn't kept
  const [plugins, setPlugins] = useState<Plugin[]>([])
  useEffect(() => { api.getPlugins().then(setPlugins).catch(() => { /* no activities to offer */ }) }, [])
  // The family's activities that are on, plus the linked one even if it's off (so saving keeps it).
  const activities = plugins.filter(p => p.enabled || p.id === pluginId)
  const today = todayKeyInTz(settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)
  const [dueDate, setDueDate] = useState(chore ? chore.dueDate ?? '' : draft?.date ?? today)
  const [sched, setSched] = useState(() => {
    const f = rruleToForm(storedRrule)
    return chore || draft ? f : { ...f, weekStart: settings.weekStart, days: [new Date(`${today}T12:00:00`).getDay()] } // new chore: preselect today, the day it anchors on
  })
  const [schedTouched, setSchedTouched] = useState(false) // untouched = send the stored rrule back as-is (keeps custom rules)
  const editSched = (patch: Partial<ScheduleForm>) => { setSched(s => ({ ...s, ...patch, custom: false })); setSchedTouched(true) }
  const scheduleValid = validSchedule(sched, dueDate) && (!repeatGoal || !!dueDate && validGoal(repeatGoal))
  const assignee = members.find(m => m.id === memberId)
  const defaultApproval = !!assignee?.needsApproval

  const submit = async () => {
    if (!title.trim() || !isSingleEmoji(emoji) || !scheduleValid) return
    const schedule = scheduleBody({ rrule: storedRrule, dueDate: chore?.dueDate ?? draft?.date ?? today }, sched, schedTouched || (!chore && !draft), dueDate)
    const body = { title: title.trim(), emoji, points, memberId, ...schedule, repeatGoal, listId, pluginId, ...(pluginId ? { pluginMinutes: Math.min(60, Math.max(1, minutes)) } : {}), needsApproval, approveTimedPlay: !!pluginId && approveTimedPlay, timerMinutes: pluginId ? null : timerMinutes, dueTime: startTime || null, ...(from ? { libraryId: from.id } : {}) }
    try {
      if (chore) await api.updateChore(chore.id, body)
      else await api.createChore(body)
      const first = scheduleDates(schedule.rrule, dueDate || today, schedule.rrule && dueDate < today ? today : dueDate || today, 1)[0]
      onSaved(chore || !first ? undefined : new Date(`${first}T12:00:00`))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('Could not save chore'), true)
    }
  }
  const saveToLibrary = async () => {
    if (!chore) return
    try { await api.createLibraryChore({ fromChoreId: chore.id }); toast(t('Saved to the library: {title}', { title: chore.title })) } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not save it to the library'), true) }
  }
  const del = async () => {
    if (!chore) return
    if (!await dialog.confirm({ title: t('Delete "{title}"?', { title: chore.title }), body: t('It leaves the list. Points already earned from it stay.'), confirmLabel: t('Delete'), danger: true })) return
    try { await api.deleteChore(chore.id); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not delete chore'), true) }
  }

  return (
    <Sheet title={chore ? t('Edit chore') : draft ? t('Make it repeat') : t('New chore')} onClose={onClose} dirty="auto"
      actions={
        <>
          {chore && <select className="settings-select actions-select" aria-label={t('Chore actions')} value="" onChange={e => { if (e.target.value === 'delete') void del(); if (e.target.value === 'library') void saveToLibrary(); if (e.target.value === 'reset') resetTime?.run() }}>
            <option value="" disabled hidden>{t('More…')}</option>
            {!chore.libraryId && <option value="library">{t('Save to library')}</option>}
            {resetTime && <option value="reset">{resetTime.label}</option>}
            <option value="delete">{t('Delete chore…')}</option>
          </select>}
          <button className="btn btn-primary" onClick={submit} disabled={!title.trim() || !isSingleEmoji(emoji) || !scheduleValid}>{chore ? t('Save') : t('Add chore')}</button>
        </>
      }>
      <div className="field">
        <label>{t('Title')}</label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder={t('Chore title')} autoComplete="off" autoFocus={!chore} />
      </div>
      <div className="field">
        <label>{t('Emoji')}</label>
        <div className="emoji-swatch-row">
          {['🛏️', '🐕', '🗑️', '🪴', '🧹', '🍽️', '🧺', '📚', '🧼', '🚿'].map(e => (
            <button key={e} className={`emoji-swatch ${emoji === e ? 'active' : ''}`} aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>
          ))}
        </div>
        <AnyEmojiField value={emoji} onChange={setEmoji} />
      </div>
      <div className="field">
        <label>{t('Points')}</label>
        <PointsStepper value={points} max={1000} onChange={setPoints} label={t('Points')} />
      </div>
      <div className="field">
        <label>{t('Assign to')}</label>
        <div className="chip-row">
          <button className={`chip ${memberId === null ? 'active' : ''}`} aria-pressed={memberId === null} onClick={() => setMemberId(null)}>🌟 {t('Anyone')}</button>
          {members.map(m => (
            <button key={m.id} className={`chip ${memberId === m.id ? 'active' : ''}`} aria-pressed={memberId === m.id} style={{ ['--chip-color' as string]: m.color }} onClick={() => setMemberId(m.id)}><ChipFace m={m} /> {m.name}</button>
          ))}
        </div>
      </div>
      {settings.features.lists && <div className="field">
        <label htmlFor="chore-checklist">{t('Checklist (optional)')}</label>
        <select id="chore-checklist" value={listId ?? ''} onChange={e => setListId(e.target.value || null)}>
          <option value="">{t('None')}</option>
          {lists.filter(l => !l.archived || l.id === listId).map(l => <option key={l.id} value={l.id}>{l.emoji ? `${l.emoji} ` : ''}{l.name}{l.kind === 'reusable' ? '' : ` (${t(l.kind === 'todo' ? 'todo' : 'shopping')})`}</option>)}
        </select>
        <p className="field-hint">{t('Every item on the list has to be ticked before this chore can be completed. A reusable list resets once it is.')}</p>
      </div>}
      {(activities.length > 0 || pluginId) && (
        <div className="field">
          <label htmlFor="chore-activity">{t('Do an activity (optional)')}</label>
          <select id="chore-activity" value={pluginId ?? ''} onChange={e => setPluginId(e.target.value || null)}>
            <option value="">{t('None')}</option>
            {activities.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.enabled ? p.name : t('{name} (off)', { name: p.name })}</option>)}
            {pluginId && !activities.some(p => p.id === pluginId) && <option value={pluginId}>{t('Activity not available')}</option>}
          </select>
          {pluginId && (
            <div className="chore-minutes">
              <label htmlFor="chore-minutes">{t('Minutes')}</label>
              <input id="chore-minutes" type="number" inputMode="numeric" min={1} max={60} value={minutes}
                onChange={e => setMinutes(Math.min(60, Number(e.target.value.replace(/\D/g, '')) || 0))} onBlur={() => setMinutes(m => Math.max(1, m))} />
            </div>
          )}
          <p className="field-hint">{t("Playing it in Kinwall counts: once the day's active play reaches the minutes, the chore completes itself. It can still be ticked by hand.")}</p>
          {pluginId && (
            <div className="toggle-row">
              <label id="chore-approve-play-label">{t("Needs a parent's OK even for timed play")}</label>
              <button className={`switch ${approveTimedPlay ? 'on' : ''}`} role="switch" aria-checked={approveTimedPlay} aria-labelledby="chore-approve-play-label" onClick={() => setApproveTimedPlay(v => !v)}><span className="knob" /></button>
            </div>
          )}
        </div>
      )}
      <div className="field">
        <label htmlFor="chore-start">{t('Start time (optional)')}</label>
        <div className="timer-custom-row">
          <input id="chore-start" type="time" value={startTime} aria-describedby="chore-start-hint" onChange={e => setStartTime(e.target.value)} />
          {startTime && <button type="button" className="btn btn-secondary" onClick={() => setStartTime('')}>{t('No start time')}</button>}
        </div>
        <p className="field-hint" id="chore-start-hint">{t("When it should start, every day it's due. It shows on Today on the Board.")}</p>
      </div>
      {!pluginId && <div className="field">
        <label htmlFor="chore-timer">{t('Timer (optional)')}</label>
        <select id="chore-timer" value={timerMinutes ?? ''} onChange={e => setTimerMinutes(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{t('None')}</option>
          {[...new Set([5, 10, 15, 20, 25, 30, 45, 60, 90, 120, ...(timerMinutes ? [timerMinutes] : [])])].sort((a, b) => a - b).map(m => <option key={m} value={m}>{durationLabel(m)}</option>)}
        </select>
        <p className="field-hint">{t('Tap the chore to start a timer this long. When it rings, it offers to mark the chore done.')}</p>
      </div>}
      <div className="field">
        <label htmlFor="chore-approval">{t("Needs a parent's OK")}</label>
        <select id="chore-approval" value={needsApproval === null ? 'default' : needsApproval ? 'yes' : 'no'} onChange={e => setNeedsApproval(e.target.value === 'default' ? null : e.target.value === 'yes')}>
          <option value="default">{assignee ? (defaultApproval ? t('Default (yes)') : t('Default (no)')) : t('Default')}</option>
          <option value="yes">{t('Yes')}</option>
          <option value="no">{t('No')}</option>
        </select>
        <p className="field-hint">{t("Ticks from wall screens and kids' devices wait for a parent to approve before the points count.")} {assignee
          ? (pluginId ? t("Default follows {name}'s setting in Settings → Family; timed play approves itself unless the switch above is on.", { name: assignee.name }) : t("Default follows {name}'s setting in Settings → Family.", { name: assignee.name }))
          : (pluginId ? t('Default follows the setting of whoever does it in Settings → Family; timed play approves itself unless the switch above is on.') : t('Default follows the setting of whoever does it in Settings → Family.'))}</p>
      </div>
      <ChoreScheduleFields value={sched} goal={repeatGoal} onGoal={setRepeatGoal} start={dueDate} today={today} onChange={editSched} onStart={setDueDate} />
    </Sheet>
  )
}
