import { useEffect, useMemo, useRef, useState } from 'react'
import { useHashParam } from './hashQuery.ts'
import { addDays, format, isSameDay } from 'date-fns'
import { GivePoints } from './GivePoints.tsx'
import { useIsPhone } from './useIsPhone.ts'
import { useApp } from './AppContext.tsx'
import { api, ApiError } from './api.ts'
import type { Chore, ChoreDay, LeaderboardEntry, LeaderboardPeriod, List, PendingApproval, Plugin, Redemption } from './types.ts'
import { MEMBER_EMOJI, rewardsOn } from './types.ts'
import { dateKey } from './date.ts'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isSingleEmoji } from './emoji.ts'
import { CheckIcon, PlusIcon } from './icons.tsx'
import { ActivityRing } from './ActivityRing.tsx'
import { IDLE_RESET_EVENT } from './App.tsx'
import { announce } from './a11y.tsx'
import { useDialog } from './dialog.tsx'
import { ChoreLibrarySheet, type RepeatDraft } from './ChoreLibrary.tsx'
import GetStuffDone from './GetStuffDone.tsx'
import { intervalRrule, repeatText } from './choreLibrary.ts'
import { Face, type FaceMember, ChipFace } from './Face'
import { ChoreTimerText, startChoreTimer } from './ChoreTimer.tsx'
import { formatTime } from './timeFormat.ts'
import { durationLabel } from './timers.ts'

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

const LB_PERIOD_LABEL: Record<LeaderboardPeriod, string> = { today: 'Today', week: 'This week', month: 'This month' }

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

  useEffect(() => {
    api.getLeaderboard(period).then(list => {
      setBoard(list)
      const leader = list.find(e => e.rank === 1 && e.points > 0)?.memberId ?? null
      if (prevLeaderId.current !== undefined && leader && leader !== prevLeaderId.current) {
        setBounceId(leader)
        setTimeout(() => setBounceId(null), 650)
      }
      prevLeaderId.current = leader
    }).catch(() => { /* leave the last-known board up rather than blanking it on a transient error */ })
  }, [period, refreshTick])

  if (board.length === 0) return null
  const maxPoints = Math.max(1, ...board.map(e => e.points))

  return (
    <div className="leaderboard-strip">
      <select className="settings-select lb-period" aria-label="Leaderboard period" value={period} onChange={e => setPeriod(e.target.value as LeaderboardPeriod)}>
        {LB_PERIODS.map(p => <option key={p} value={p}>{LB_PERIOD_LABEL[p]}</option>)}
      </select>
      <div className="leaderboard-pills" role="list" aria-label="Leaderboard">
        {board.map(e => (
          <div key={e.memberId} role="listitem" className="leaderboard-item">
          <a className="leaderboard-pill" href={`#/profile/${e.memberId}`}
            aria-label={[e.points > 0 ? `${e.name}, rank ${e.rank}, ${e.points} points` : `${e.name}, no points yet`, e.rank === 1 && e.points > 0 && 'leader', e.streak >= 2 && `${e.streak} day streak`, spendable(e.memberId) !== null && `${spendable(e.memberId)} to spend`].filter(Boolean).join(', ')}>
            <div className="lb-rank">{e.points > 0 && `#${e.rank}`}</div>{/* no rank until they have points, not everyone "#1" at 0 */}
            <Face
              m={{ ...e, picture: members.find(m => m.id === e.memberId)?.picture }}
              className={`lb-avatar ${bounceId === e.memberId ? 'crown-bounce' : ''}`}
              style={{ ['--lb-color' as string]: e.color }}
            />
            <div className="lb-info">
              <div className="lb-name-row">
                <span className="lb-name">{e.name}</span>
                {e.rank === 1 && e.points > 0 && <span className="lb-crown" aria-label="Leader">👑</span>}
                {e.streak >= 2 && <span className="lb-streak" aria-label={`${e.streak} day streak`}>🔥{e.streak}</span>}
              </div>
              <div className="lb-bar-track"><div className="lb-bar-fill" style={{ width: `${(e.points / maxPoints) * 100}%`, background: e.color }} /></div>
              {spendable(e.memberId) !== null && <div className="lb-spend" aria-hidden="true">{spendable(e.memberId)} to spend</div>}
            </div>
            <div className="lb-points">{e.points} pts</div>
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

// Chore schedule <-> rrule. Only the subset the sheet edits: FREQ=DAILY|WEEKLY, BYDAY, date-only UNTIL.
// Anything else (INTERVAL, COUNT, MONTHLY - e.g. set via MCP) is reported as `custom` and left untouched.
const RR_DAYS = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
type Repeat = 'once' | 'daily' | 'weekly'
type ScheduleForm = { repeat: Repeat; days: number[]; until: string; custom: boolean }

function rruleToForm(rrule: string | null): ScheduleForm {
  const form: ScheduleForm = { repeat: 'once', days: [], until: '', custom: false }
  if (!rrule) return form
  for (const part of rrule.replace(/^RRULE:/i, '').split(';')) {
    const [k, v = ''] = part.split('=').map(x => x.trim().toUpperCase())
    if (k === 'FREQ' && (v === 'DAILY' || v === 'WEEKLY')) form.repeat = v.toLowerCase() as Repeat
    else if (k === 'BYDAY' && v.split(',').every(d => RR_DAYS.includes(d))) form.days = v.split(',').map(d => RR_DAYS.indexOf(d)).sort()
    else if (k === 'UNTIL' && /^\d{8}/.test(v)) form.until = `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`
    else form.custom = true
  }
  if (form.repeat === 'once') form.custom = true // had an rrule but not one we can show
  return form
}

/** Empty `days` on weekly = plain FREQ=WEEKLY, which the server anchors on the creation weekday. */
function formToRrule(f: ScheduleForm): string | null {
  if (f.repeat === 'once') return null
  let r = `FREQ=${f.repeat.toUpperCase()}`
  if (f.repeat === 'weekly' && f.days.length) r += `;BYDAY=${[...f.days].sort().map(d => RR_DAYS[d]).join(',')}`
  if (f.until) r += `;UNTIL=${f.until.replaceAll('-', '')}`
  return r
}

/** The first day a new chore shows up on, from the form: its due date, today for daily, or the
 * next selected weekday (today counts). Undefined when the form can't tell (custom rrule). */
function firstScheduledDay(f: ScheduleForm, dueDate: string): Date | undefined {
  const today = new Date()
  if (f.custom) return undefined
  if (f.repeat === 'once') return new Date(`${dueDate}T00:00:00`)
  if (f.repeat === 'daily' || !f.days.length) return today
  const offset = Math.min(...f.days.map(d => (d - today.getDay() + 7) % 7))
  return addDays(today, offset)
}

function scheduleLabel(rrule: string | null): string {
  const f = rruleToForm(rrule)
  if (f.repeat === 'once') return f.custom ? 'Repeats' : ''
  const what = f.repeat === 'daily' || f.days.length === 7 ? 'Daily'
    : !f.days.length ? 'Weekly'
    : f.days.length <= 3 ? f.days.map(d => DAY_SHORT[d]).join(', ') : `${f.days.length}×/wk`
  if (!f.until) return what
  const [y, m, d] = f.until.split('-').map(Number)
  return `${what} · until ${format(new Date(y, m - 1, d), 'MMM d')}`
}

function ChoreCard({ chore, onToggle, onEdit }: { chore: ChoreDay; onToggle: () => void; onEdit: () => void }) {
  const { members, selectedMemberId, parentDevice } = useApp()
  const schedule = scheduleLabel(chore.rrule)
  // An Anyone chore says who got the points once it's done.
  const by = !chore.memberId && chore.completed ? (members.find(m => m.id === chore.completedBy)?.name ?? 'nobody in particular') : null
  // Waiting for a parent's OK: ticked (tapping unticks it) but not done.
  const pending = !!chore.pending
  const ticked = chore.completed || pending
  const notYet = !ticked && chore.rejection ? `Not yet${chore.rejection.note ? `: ${chore.rejection.note}` : ''}` : ''
  const cl = chore.checklist
  const checklist = cl ? `☑ ${cl.done}/${cl.total} ${cl.name}` : ''
  // A linked activity: tapping the card plays it (as the chore's person), the check still ticks it.
  // Removed or turned off, it's a plain chore that says so.
  const act = chore.activity?.available ? chore.activity : null
  const actLabel = act ? `${act.emoji ?? ''} ${act.needSeconds / 60} min of ${act.name}`.trim() : chore.activity ? activityGoneText(chore.activity, parentDevice) : ''
  const actProgress = act && !chore.completed && act.doneSeconds > 0 ? `${Math.floor(act.doneSeconds / 60)} of ${act.needSeconds / 60} min` : ''
  const player = chore.memberId ?? selectedMemberId
  const play = () => { location.hash = `#/activities/plugin/${act!.pluginId}${player ? `?member=${player}` : ''}` }
  // A timer (not on an activity chore, which times itself): tapping the card starts it, the check ticks it.
  const timer = !act && !ticked && chore.timerMinutes ? chore.timerMinutes : 0
  const startsAt = chore.dueTime && /^\d{2}:\d{2}$/.test(chore.dueTime) ? formatTime(chore.dueTime) : ''
  const [burst, setBurst] = useState(false)
  const pressTimer = useRef<ReturnType<typeof setTimeout>>()
  const longPressed = useRef(false)

  const handleDown = () => {
    longPressed.current = false
    pressTimer.current = setTimeout(() => { longPressed.current = true; onEdit() }, 500)
  }
  const handleUp = () => clearTimeout(pressTimer.current)
  // Toggle on click, not pointerup: a sheet the toggle opens (Who did it?, a checklist) would
  // otherwise catch the click a touch sends right after lifting the finger.
  const handleClick = () => {
    if (longPressed.current) { longPressed.current = false; return }
    if (!ticked) setBurst(true)
    onToggle()
  }
  const info = (
    <>
      <div className="chore-emoji" aria-hidden="true">{chore.emoji}</div>
      <div className="chore-info">
        <div className={`chore-title ${chore.completed ? 'done' : ''}`}>{chore.title}</div>
        <div className="chore-pts">{[startsAt, by && `Done by ${by}`, `${chore.points} pts`, schedule, checklist].filter(Boolean).join(' · ')}</div>
        {timer > 0 && <div className="chore-pts chore-activity"><ChoreTimerText chore={chore} /></div>}
        {pending && <div className="chore-waiting">Waiting for OK</div>}
        {notYet && <div className="chore-notyet">{notYet}</div>}
        {actLabel && <div className="chore-pts chore-activity">{actLabel}</div>}
        {actProgress && <div className="chore-pts chore-activity-progress"><ActivityRing done={act!.doneSeconds} need={act!.needSeconds} />{actProgress}</div>}
      </div>
    </>
  )
  const check = <div className={`chore-check ${chore.completed ? 'done' : pending ? 'pending' : ''}`}>{chore.completed ? <CheckIcon width={18} height={18} /> : pending && <span aria-hidden="true">⏳</span>}</div>
  const said = [pending && "waiting for a parent's OK", notYet].filter(Boolean)
  if (act || timer) {
    // Two controls: play or start the timer (the card) and done (the check). Long-press/right-click still edits.
    return (
      <>
        <div className={`chore-card ${chore.completed ? 'done' : ''}`} onContextMenu={e => { e.preventDefault(); onEdit() }}
          onPointerDown={handleDown} onPointerUp={handleUp} onPointerLeave={() => clearTimeout(pressTimer.current)}>
          <button className="chore-play" aria-label={act ? [`Play ${act.name} for ${chore.title}`, actLabel, actProgress && `${actProgress} played`].filter(Boolean).join(', ') : [`Start a ${durationLabel(timer)} timer for ${chore.title}`, startsAt && `starts at ${startsAt}`].filter(Boolean).join(', ')}
            onClick={() => { if (longPressed.current) { longPressed.current = false; return } if (act) play(); else startChoreTimer(chore, members.find(m => m.id === player)?.name) }}>{info}</button>
          <button className="chore-check-btn" role="checkbox" aria-checked={pending ? 'mixed' : chore.completed}
            aria-label={[`${chore.title} done`, by && `by ${by}`, `${chore.points} points`, ...said].filter(Boolean).join(', ')} onClick={handleClick}>{check}</button>
          {burst && <Confetti />}
        </div>
        <button className="btn btn-secondary focus-reveal" onClick={onEdit}>Edit {chore.title}</button>
      </>
    )
  }

  // Tap/Space/Enter toggles it (a checkbox to assistive tech); long-press, right-click/Menu key or
  // the Edit button that appears when tabbed to opens the editor.
  const toggleByKey = (e: React.KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()
    if (!ticked) setBurst(true)
    onToggle()
  }
  return (
    <>
      <div className={`chore-card ${chore.completed ? 'done' : ''}`} role="checkbox" aria-checked={pending ? 'mixed' : chore.completed} tabIndex={0}
        aria-label={[chore.title, startsAt && `starts at ${startsAt}`, by && `done by ${by}`, `${chore.points} points`, schedule, cl ? `checklist ${cl.name} ${cl.done} of ${cl.total} done` : '', actLabel, ...said].filter(Boolean).join(', ')}
        onKeyDown={toggleByKey} onContextMenu={e => { e.preventDefault(); onEdit() }}
        onPointerDown={handleDown} onPointerUp={handleUp} onPointerLeave={() => clearTimeout(pressTimer.current)} onClick={handleClick}>
        {info}
        {check}
        {burst && <Confetti />}
      </div>
      <button className="btn btn-secondary focus-reveal" onClick={onEdit}>Edit {chore.title}</button>
      {chore.activity && !act && parentDevice && <a className="chore-activity-fix" href="#/activities?more=1">{chore.activity.name ? 'Turn it on in Get more activities' : 'Install it from Get more activities'}</a>}
    </>
  )
}

/** What an activity chore says when its activity was removed or turned off. A parent gets a link
 * to fix it; anyone else can still do it and tick it, and a parent okays it (the server holds it). */
function activityGoneText(a: NonNullable<ChoreDay['activity']>, parentDevice: boolean): string {
  if (parentDevice) return a.name ? `${a.name} is turned off.` : "This chore's activity isn't installed."
  return `${a.name ? `${a.name} isn't` : "This chore's activity isn't"} here right now. Do it with a grown-up, and a parent will okay it.`
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
  const fetchItems = () => {
    if (!only) api.getPendingApprovals().then(setItems).catch(() => { /* the section just stays as it was */ })
    if (rewardsShown) api.getRedemptions({ status: 'pending,approved' }).then(setRewards).catch(() => { /* likewise */ })
    else setRewards([]) // Rewards turned off: requests wait, out of sight
  }
  useEffect(fetchItems, [refreshTick, rewardsShown]) // eslint-disable-line react-hooks/exhaustive-deps
  const name = (p: { memberId: string | null }) => members.find(m => m.id === p.memberId)?.name ?? 'Someone'
  const decide = async (r: Redemption, action: 'approve' | 'decline' | 'given', done: string, note?: string) => {
    setRewards(list => action === 'approve' ? list.map(x => x === r ? { ...x, status: 'approved' } : x) : list.filter(x => x !== r)) // optimistic
    try {
      await api.decideRedemption(r.id, action, note)
      toast(done)
      announce(done)
      reloadCore()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not update reward', true)
      fetchItems()
    }
  }
  const sendRewardBack = () => {
    const r = notThisTime!
    setNotThisTime(null)
    decide(r, 'decline', `${r.title}: points back to ${name(r)}`, note.trim() || undefined)
  }
  const whenR = (r: Redemption) => r.date === dateKey(new Date()) ? '' : format(new Date(r.requestedAt), 'EEE, MMM d')
  const count = items.length + rewards.filter(r => r.status === 'pending').length
  const when = (p: PendingApproval) => {
    if (p.date === dateKey(new Date())) return ''
    const [y, m, d] = p.date.split('-').map(Number)
    return format(new Date(y, m - 1, d), 'EEE, MMM d')
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
      toast(e instanceof ApiError ? e.message : 'Could not update chore', true)
      fetchItems()
    }
  }
  const sendBack = () => {
    const p = notYet!
    setNotYet(null)
    act(p, () => api.rejectChore(p.choreId, p.date, note.trim() || undefined), `${p.title} sent back to ${name(p)}`)
  }
  return (
    <>
      {(items.length > 0 || rewards.length > 0) && (
        <section className="approve-card" aria-labelledby="approve-heading">
          <h3 id="approve-heading" className="approve-heading">{only ? 'Reward requests' : 'To approve'} {count > 0 && <span className="approve-count">{count}</span>}</h3>
          <ul className="approve-list">
            {items.map(p => (
              <li key={`${p.choreId}:${p.date}`} className="approve-row">
                <span className="approve-emoji" aria-hidden="true">{p.emoji}</span>
                <div className="approve-info">
                  <div className="approve-title">{p.title}</div>
                  <div className="approve-sub">{[name(p), when(p), `${p.points} pts`].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="approve-actions">
                  <button className="btn btn-secondary" onClick={() => { setNote(''); setNotYet(p) }} aria-label={`Not yet: ${p.title} by ${name(p)}`}>Not yet</button>
                  <button className="btn btn-primary" onClick={() => act(p, () => api.approveChore(p.choreId, p.date), `Approved: +${p.points} for ${name(p)}`)} aria-label={`Approve ${p.title} by ${name(p)}`}>Approve</button>
                </div>
              </li>
            ))}
            {rewards.map(r => (
              <li key={r.id} className="approve-row">
                <span className="approve-emoji" aria-hidden="true">{r.emoji ?? '🎁'}</span>
                <div className="approve-info">
                  <div className="approve-title">{r.title}</div>
                  <div className="approve-sub">{[name(r), whenR(r), `${r.cost} pts`, r.status === 'approved' && 'approved, not given yet'].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="approve-actions">
                  {r.status === 'pending' ? <>
                    <button className="btn btn-secondary" onClick={() => { setNote(''); setNotThisTime(r) }} aria-label={`Not this time: ${r.title} for ${name(r)}`}>Not this time</button>
                    <button className="btn btn-primary" onClick={() => decide(r, 'approve', `Approved: ${r.title} for ${name(r)}`)} aria-label={`Approve ${r.title} for ${name(r)}`}>Approve</button>
                  </> : <>
                    <button className="btn btn-secondary" onClick={() => { setNote(''); setNotThisTime(r) }} aria-label={`Cancel ${r.title} for ${name(r)} and give the points back`}>Cancel</button>
                    <button className="btn btn-primary" onClick={() => decide(r, 'given', `Given: ${r.title} to ${name(r)}`)} aria-label={`${r.title} given to ${name(r)}`}>Given</button>
                  </>}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
      {notThisTime && (
        <Sheet title={notThisTime.status === 'pending' ? 'Not this time' : 'Cancel reward'} onClose={() => setNotThisTime(null)} actions={<button className="btn btn-primary" onClick={sendRewardBack}>Give points back</button>}>
          <p className="settings-row-sub" style={{ margin: '0 0 12px' }}>{notThisTime.emoji} {notThisTime.title}: {name(notThisTime)} gets their {notThisTime.cost} points back. They'll see your note.</p>
          <div className="field">
            <label htmlFor="notthistime-note">Note (optional)</label>
            <input id="notthistime-note" type="text" maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="Let's do it on Saturday" autoComplete="off"
              onKeyDown={e => { if (e.key === 'Enter') sendRewardBack() }} />
          </div>
        </Sheet>
      )}
      {notYet && (
        <Sheet title="Not yet" onClose={() => setNotYet(null)} actions={<button className="btn btn-primary" onClick={sendBack}>Send back</button>}>
          <p className="settings-row-sub" style={{ margin: '0 0 12px' }}>{notYet.emoji} {notYet.title} goes back to {name(notYet)}, unticked. They'll see your note on the chore.</p>
          <div className="field">
            <label htmlFor="notyet-note">Note (optional)</label>
            <input id="notyet-note" type="text" maxLength={200} value={note} onChange={e => setNote(e.target.value)} placeholder="Please make the bed properly" autoComplete="off"
              onKeyDown={e => { if (e.key === 'Enter') sendBack() }} />
          </div>
        </Sheet>
      )}
    </>
  )
}

export default function Chores() {
  const isPhone = useIsPhone()
  const { members, selectedMemberId, focusMemberId, focusShowsShared, settings, toast, reloadCore, refreshTick, parentDevice } = useApp()
  const dialog = useDialog()
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [chores, setChores] = useState<ChoreDay[]>([])
  const [loadedKey, setLoadedKey] = useState<string | null>(null) // the day `chores` holds
  const [error, setError] = useState(false)
  const [editChore, setEditChore] = useState<Chore | 'new' | null>(null)
  // The chore whose checklist is open in Get stuff done, by id in the link (#/chores?checklist=<id>) so a reload reopens it.
  const [checklistId, setChecklistId] = useHashParam('checklist')
  const checklistFor = chores.find(c => c.id === checklistId) ?? null
  const [libraryOpen, setLibraryOpen] = useState(false)
  const [repeatDraft, setRepeatDraft] = useState<RepeatDraft | null>(null) // the library's "Make it repeat", in the chore editor

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
    const onIdle = () => { setSelectedDate(new Date()); setEditChore(null); setChecklistId(null); setLibraryOpen(false); setRepeatDraft(null) }
    window.addEventListener(IDLE_RESET_EVENT, onIdle)
    return () => window.removeEventListener(IDLE_RESET_EVENT, onIdle)
  }, [])

  const strip = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(new Date(), i - 4)), [])

  // Parent devices: clear a person's counted play for an activity chore's day (someone opened it as
  // a kid to check something). A chore the play already completed stays done; unticking is separate.
  const editDay = editChore && editChore !== 'new' ? chores.find(c => c.id === editChore.id) : undefined
  const resetMember = parentDevice && editDay?.activity && editDay.activity.doneSeconds > 0 ? editDay.memberId ?? selectedMemberId : null
  const isToday = key === dateKey(new Date())
  const resetTime = async (c: ChoreDay, member: string) => {
    const act = c.activity!
    const who = members.find(m => m.id === member)?.name ?? 'Someone'
    if (!await dialog.confirm({
      title: `Reset ${who}'s ${act.name ?? 'activity'} time ${isToday ? 'for today' : `for ${format(selectedDate, 'EEE, MMM d')}`}?`,
      body: c.completed ? `"${c.title}" stays done. Untick it if it shouldn't count.` : `${Math.floor(act.doneSeconds / 60)} of ${act.needSeconds / 60} min goes back to 0.`,
      confirmLabel: 'Reset time',
    })) return
    try {
      await api.resetPlaytime(act.pluginId, member, key)
      setEditChore(null); load()
      toast(`Time reset: ${c.title}`); announce(`Time reset: ${c.title}`)
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not reset the time', true) }
  }

  // "Who did it?" for an Anyone chore when the tab isn't filtered or pinned to one person.
  const [whoFor, setWhoFor] = useState<ChoreDay | null>(null)
  const toggle = async (c: ChoreDay, doneBy?: string | null) => {
    const ticked = c.completed || !!c.pending // a pending tick unticks like a done one
    // Unticking is deliberate: a stray tap on a done chore shouldn't quietly take points back.
    if (ticked && !await dialog.confirm({
      title: `Mark "${c.title}" not done?`,
      body: c.pending ? 'It goes back on the list, and the parent approval request is withdrawn.' : 'It goes back on the list, and the points it earned come off.',
      confirmLabel: 'Mark not done',
    })) return
    // A checklist with open items gates completion: open it here to tick off instead.
    if (!ticked && c.checklist && c.checklist.done < c.checklist.total) { setChecklistId(c.id); return }
    // An Anyone chore credits the filtered (or pinned) person; otherwise ask who did it.
    // `doneBy` null = "Nobody in particular" was picked.
    if (!ticked && !c.memberId && doneBy === undefined) {
      if (selectedMemberId) doneBy = selectedMemberId
      else if (members.length > 0) { setWhoFor(c); return }
    }
    const creditTo = c.memberId ?? doneBy ?? undefined
    // Off a parent's device it's approved at once; otherwise the chore (or the person's default) says.
    // An activity chore whose activity is gone always waits off a parent's device (as on the server).
    const activityGone = !!c.activity && !c.activity.available
    const waits = !ticked && !parentDevice && (activityGone || !!(c.needsApproval ?? members.find(m => m.id === creditTo)?.needsApproval))
    setChores(list => list.map(x => x.id === c.id ? { ...x, completed: !ticked && !waits, pending: waits, rejection: null, completedBy: ticked ? null : creditTo ?? null } : x)) // optimistic
    // Ticked off for a past day: earns the household's late-completion share (rounded like the server).
    const late = !ticked && key < dateKey(new Date())
    const pts = late ? Math.round(c.points * settings.lateCompletionCredit / 100) : c.points
    const who = !c.memberId && creditTo ? members.find(m => m.id === creditTo)?.name : undefined
    announce(ticked ? `${c.title} not done` : waits ? `${c.title} done${who ? ` by ${who}` : ''}, waiting for a parent's OK` : `${c.title} done${who ? ` by ${who}` : ''}, ${pts} point${pts === 1 ? '' : 's'}${late ? ', late' : ''}`)
    try {
      // Queued, so a tick works offline and syncs later; replays are idempotent (complete/undo for a date).
      if (ticked) await api.queueUncompleteChore(c.id, key)
      else await api.queueCompleteChore(c.id, key, creditTo)
      if (late && !waits) toast(`+${pts} (late)`)
      reloadCore()
    } catch (e) {
      setChores(list => list.map(x => x.id === c.id ? { ...x, completed: c.completed, pending: c.pending, rejection: c.rejection } : x)) // revert
      toast(e instanceof ApiError ? e.message : 'Could not update chore', true)
    }
  }

  // #/chores?done=<id> (from the app's Chores widget): tap that chore once it's loaded, so it asks
  // "Who did it?" or opens its checklist, just like a tap here. A link can come from anywhere, so a
  // chore that would be ticked off straight away asks first.
  const [hashTick, setHashTick] = useState(0) // the app may set the link while this tab is already open
  useEffect(() => {
    const onHash = () => setHashTick(t => t + 1)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  useEffect(() => {
    const params = new URLSearchParams(location.hash.split('?')[1] || '')
    const id = params.get('done')
    if (!id || loading) return
    if (key !== dateKey(new Date())) { setSelectedDate(new Date()); return } // the widget shows today
    history.replaceState(null, '', '#/chores')
    const c = chores.find(x => x.id === id)
    if (!c || c.completed || c.pending) return
    const opensSheet = (c.checklist && c.checklist.done < c.checklist.total) || (!c.memberId && !selectedMemberId && members.length > 0)
    // sure=1: "Mark done" on the chore's own timer, which already asked.
    if (opensSheet || params.get('sure') === '1') { toggle(c); return }
    const who = members.find(m => m.id === (c.memberId ?? selectedMemberId))?.name
    dialog.confirm({ title: `Mark "${c.title}" done${who ? ` for ${who}` : ''}?`, confirmLabel: 'Mark done' }).then(ok => { if (ok) toggle(c) })
  }, [loading, chores, hashTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const columns = [...members, { id: '__anyone', name: 'Anyone', color: '#C7B8A8', avatar: '🌟', pointsToday: 0, pointsWeek: 0, sort: 999 }]
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
      {/* display: contents, except on a phone on its side, where it scrolls the whole view as one. */}
      <div className="chores-scroll">
      <div className="chores-header">
        {/* Date and Rewards share one row (a phone: short date, icon-only Rewards).
            Off a phone the leaderboard joins that row when it fits, else takes the next one. */}
        <h2 className="period-label" aria-label={format(selectedDate, 'EEEE, MMMM d')}>{format(selectedDate, isPhone ? 'EEE, MMM d' : 'EEEE, MMMM d')}</h2>
        {!isPhone && leaderboard}
        {parentDevice && <GivePoints memberId={selectedMemberId} className="btn btn-secondary chores-rewards-btn chores-library-btn" label="Give points"><span aria-hidden="true">⭐</span> <span className="chores-rewards-label">Give points</span></GivePoints>}
        {parentDevice && <button type="button" className="btn btn-secondary chores-rewards-btn chores-library-btn" onClick={() => setLibraryOpen(true)}><span aria-hidden="true">🧰</span> <span className="chores-rewards-label">Library</span></button>}
        {rewardsShown && <a className="btn btn-secondary chores-rewards-btn" href={selectedMemberId ? `#/rewards/${selectedMemberId}` : '#/rewards'}><span aria-hidden="true">🎁</span> <span className="chores-rewards-label">Rewards</span></a>}
      </div>
      <div className="date-strip" role="group" aria-label="Day">
        {strip.map(d => (
          <button key={d.toISOString()} className={`date-chip ${isSameDay(d, selectedDate) ? 'active' : ''}`} aria-pressed={isSameDay(d, selectedDate)} aria-label={format(d, 'EEEE, MMMM d')} onClick={() => setSelectedDate(d)}>
            <div className="wd">{format(d, 'EEE')}</div>
            <div className="dn">{format(d, 'd')}</div>
          </button>
        ))}
      </div>

      {parentDevice && <ApprovalQueue onChanged={load} />}

      {isPhone && leaderboard}

      {error ? (
        <div className="state-card">Couldn't load chores.</div>
      ) : !loading && chores.length === 0 ? (
        <div className="empty-card"><span className="emoji">✨</span>No chores for this day.</div>
      ) : (
        <div className="chore-columns" style={columnsGridStyle}>
          {active.map(col => {
            const list = chores.filter(c => col.id === '__anyone' ? !c.memberId : c.memberId === col.id)
            const done = list.filter(c => c.completed).length
            const pct = list.length ? done / list.length : 0
            return (
              <div key={col.id} className="chore-column">
                <div className="chore-col-head">
                  <ProgressRing pct={pct} m={col} label={`${col.name}: ${done} of ${list.length} done`} />
                  <h3 className="chore-col-name" style={{ margin: 0 }}>{col.name}</h3>
                  <div className="chore-col-pts">{list.reduce((s, c) => s + (c.completed ? c.points : 0), 0)} pts today</div>
                  {rewardsShown && col.id !== '__anyone' && 'balance' in col && (
                    <a className="chore-col-spend" href={`#/rewards/${col.id}`} aria-label={`${col.name} has ${col.balance} points to spend. See rewards`}>⭐ {col.balance} to spend</a>
                  )}
                </div>
                {list.map(c => (
                  <ChoreCard key={c.id} chore={c} onToggle={() => toggle(c)} onEdit={() => { if (parentDevice) setEditChore(c) }} />
                ))}
              </div>
            )
          })}
          {idle.length > 0 && (
            <ul className="chores-idle" aria-label="Nothing due">
              {idle.map(m => (
                <li key={m.id} className="chores-idle-item">
                  <Face m={m} className="chores-idle-avatar" aria-hidden="true" />
                  <span><span className="chores-idle-name">{m.name}</span> · nothing due</span>
                  {rewardsShown && m.id !== '__anyone' && 'balance' in m && (
                    <a className="chore-col-spend" href={`#/rewards/${m.id}`} aria-label={`${m.name} has ${m.balance} points to spend. See rewards`}>⭐ {m.balance} to spend</a>
                  )}
                </li>
              ))}
            </ul>
          )}
          {/* Tap toggles done (kid-friendly), so editing is a long press - say so on phones,
              where an admin is the one looking. */}
          {isPhone && parentDevice && <p className="chores-hint">Press and hold a chore to edit it.</p>}
        </div>
      )}
      </div>

      {parentDevice && <button className="fab" onClick={() => setEditChore('new')} aria-label="Add chore"><PlusIcon /></button>}

      {whoFor && (
        <Sheet title="Who did it?" onClose={() => setWhoFor(null)}>
          <p className="settings-row-sub" style={{ margin: '0 0 12px' }}>{whoFor.emoji} {whoFor.title} · {whoFor.points} pts go to whoever you pick.</p>
          <div className="who-grid">
            {members.map(m => (
              <button key={m.id} className="who-btn" onClick={() => { const c = whoFor; setWhoFor(null); toggle(c, m.id) }}>
                <Face m={m} className="who-avatar" aria-hidden="true" />
                {m.name}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 12 }} onClick={() => { const c = whoFor; setWhoFor(null); toggle(c, null) }}>Nobody in particular</button>
        </Sheet>
      )}
      {/* A chore's checklist opens straight into Get stuff done; all ticked, it completes the chore here. */}
      {checklistFor?.checklist && (
        <GetStuffDone listId={checklistFor.checklist.listId} onClose={() => { setChecklistId(null); load() }}
          chore={{ memberId: checklistFor.memberId, title: checklistFor.title, onComplete: () => { const c = checklistFor; void toggle({ ...c, checklist: null }) } }} />
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
          resetTime={resetMember && editDay ? { label: `Reset ${isToday ? "today's" : "this day's"} time…`, run: () => void resetTime(editDay, resetMember) } : undefined}
          onClose={() => { setEditChore(null); setRepeatDraft(null) }}
          onSaved={first => {
            setEditChore(null); setRepeatDraft(null)
            // A new chore that isn't scheduled for the day on screen would otherwise vanish on save.
            if (first && !isSameDay(first, selectedDate)) { setSelectedDate(first); toast(`Added — first on ${format(first, 'EEE, MMM d')}`) }
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
  const [dueDate, setDueDate] = useState(chore?.dueDate ?? draft?.date ?? dateKey(new Date()))
  const [sched, setSched] = useState(() => {
    const f = rruleToForm(storedRrule)
    return chore || draft ? f : { ...f, days: [new Date().getDay()] } // new chore: preselect today, the day it anchors on
  })
  const [schedTouched, setSchedTouched] = useState(false) // untouched = send the stored rrule back as-is (keeps custom rules)
  const editSched = (patch: Partial<ScheduleForm>) => { setSched(s => ({ ...s, ...patch, custom: false })); setSchedTouched(true) }
  const repeat = sched.custom ? null : sched.repeat
  const weekOrder = Array.from({ length: 7 }, (_, i) => (i + settings.weekStart) % 7)
  const today = dateKey(new Date())
  const assignee = members.find(m => m.id === memberId)
  const defaultApproval = !!assignee?.needsApproval

  const submit = async () => {
    if (!title.trim() || !isSingleEmoji(emoji)) return
    const rrule = schedTouched || (!chore && !draft) ? formToRrule(sched) : storedRrule
    // A repeat from the library starts on the day picked there (its anchor); others on their creation day.
    const body = { title: title.trim(), emoji, points, memberId, rrule, dueDate: rrule && !draft ? null : dueDate, listId, pluginId, ...(pluginId ? { pluginMinutes: Math.min(60, Math.max(1, minutes)) } : {}), needsApproval, approveTimedPlay: !!pluginId && approveTimedPlay, timerMinutes: pluginId ? null : timerMinutes, dueTime: startTime || null, ...(from ? { libraryId: from.id } : {}) }
    try {
      if (chore) await api.updateChore(chore.id, body)
      else await api.createChore(body)
      onSaved(chore ? undefined : firstScheduledDay(sched, dueDate))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save chore', true)
    }
  }
  const saveToLibrary = async () => {
    if (!chore) return
    try { await api.createLibraryChore({ fromChoreId: chore.id }); toast(`Saved to the library: ${chore.title}`) } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not save it to the library', true) }
  }
  const del = async () => {
    if (!chore) return
    if (!await dialog.confirm({ title: `Delete "${chore.title}"?`, body: 'It leaves the list. Points already earned from it stay.', confirmLabel: 'Delete', danger: true })) return
    try { await api.deleteChore(chore.id); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete chore', true) }
  }

  return (
    <Sheet title={chore ? 'Edit chore' : draft ? 'Make it repeat' : 'New chore'} onClose={onClose}
      actions={
        <>
          {chore && <select className="settings-select actions-select" aria-label="Chore actions" value="" onChange={e => { if (e.target.value === 'delete') void del(); if (e.target.value === 'library') void saveToLibrary(); if (e.target.value === 'reset') resetTime?.run() }}>
            <option value="" disabled hidden>More…</option>
            {!chore.libraryId && <option value="library">Save to library</option>}
            {resetTime && <option value="reset">{resetTime.label}</option>}
            <option value="delete">Delete chore…</option>
          </select>}
          <button className="btn btn-primary" onClick={submit} disabled={!title.trim() || !isSingleEmoji(emoji)}>{chore ? 'Save' : 'Add chore'}</button>
        </>
      }>
      <div className="field">
        <label>Title</label>
        <input type="text" value={title} onChange={e => setTitle(e.target.value)} placeholder="Chore title" autoComplete="off" autoFocus={!chore} />
      </div>
      <div className="field">
        <label>Emoji</label>
        <div className="emoji-swatch-row">
          {['🛏️', '🐕', '🗑️', '🪴', '🧹', '🍽️', '🧺', '📚', '🧼', '🚿'].map(e => (
            <button key={e} className={`emoji-swatch ${emoji === e ? 'active' : ''}`} aria-pressed={emoji === e} onClick={() => setEmoji(e)}>{e}</button>
          ))}
        </div>
        <AnyEmojiField value={emoji} onChange={setEmoji} />
      </div>
      <div className="field">
        <label>Points</label>
        <input type="text" inputMode="numeric" value={points} onChange={e => setPoints(Number(e.target.value.replace(/\D/g, '')) || 0)} />
      </div>
      <div className="field">
        <label>Assign to</label>
        <div className="chip-row">
          <button className={`chip ${memberId === null ? 'active' : ''}`} aria-pressed={memberId === null} onClick={() => setMemberId(null)}>🌟 Anyone</button>
          {members.map(m => (
            <button key={m.id} className={`chip ${memberId === m.id ? 'active' : ''}`} aria-pressed={memberId === m.id} style={{ ['--chip-color' as string]: m.color }} onClick={() => setMemberId(m.id)}><ChipFace m={m} /> {m.name}</button>
          ))}
        </div>
      </div>
      {settings.features.lists && <div className="field">
        <label htmlFor="chore-checklist">Checklist (optional)</label>
        <select id="chore-checklist" value={listId ?? ''} onChange={e => setListId(e.target.value || null)}>
          <option value="">None</option>
          {lists.filter(l => !l.archived || l.id === listId).map(l => <option key={l.id} value={l.id}>{l.emoji ? `${l.emoji} ` : ''}{l.name}{l.kind === 'reusable' ? '' : ` (${l.kind})`}</option>)}
        </select>
        <p className="field-hint">Every item on the list has to be ticked before this chore can be completed. A reusable list resets once it is.</p>
      </div>}
      {(activities.length > 0 || pluginId) && (
        <div className="field">
          <label htmlFor="chore-activity">Do an activity (optional)</label>
          <select id="chore-activity" value={pluginId ?? ''} onChange={e => setPluginId(e.target.value || null)}>
            <option value="">None</option>
            {activities.map(p => <option key={p.id} value={p.id}>{p.emoji} {p.name}{p.enabled ? '' : ' (off)'}</option>)}
            {pluginId && !activities.some(p => p.id === pluginId) && <option value={pluginId}>Activity not available</option>}
          </select>
          {pluginId && (
            <div className="chore-minutes">
              <label htmlFor="chore-minutes">Minutes</label>
              <input id="chore-minutes" type="number" inputMode="numeric" min={1} max={60} value={minutes}
                onChange={e => setMinutes(Math.min(60, Number(e.target.value.replace(/\D/g, '')) || 0))} onBlur={() => setMinutes(m => Math.max(1, m))} />
            </div>
          )}
          <p className="field-hint">Playing it in Kinwall counts: once the day's active play reaches the minutes, the chore completes itself. It can still be ticked by hand.</p>
          {pluginId && (
            <div className="toggle-row">
              <label id="chore-approve-play-label">Needs a parent's OK even for timed play</label>
              <button className={`switch ${approveTimedPlay ? 'on' : ''}`} role="switch" aria-checked={approveTimedPlay} aria-labelledby="chore-approve-play-label" onClick={() => setApproveTimedPlay(v => !v)}><span className="knob" /></button>
            </div>
          )}
        </div>
      )}
      <div className="field">
        <label htmlFor="chore-start">Start time (optional)</label>
        <div className="timer-custom-row">
          <input id="chore-start" type="time" value={startTime} aria-describedby="chore-start-hint" onChange={e => setStartTime(e.target.value)} />
          {startTime && <button type="button" className="btn btn-secondary" onClick={() => setStartTime('')}>No start time</button>}
        </div>
        <p className="field-hint" id="chore-start-hint">When it should start, every day it's due. It shows on Today on the Board.</p>
      </div>
      {!pluginId && <div className="field">
        <label htmlFor="chore-timer">Timer (optional)</label>
        <select id="chore-timer" value={timerMinutes ?? ''} onChange={e => setTimerMinutes(e.target.value ? Number(e.target.value) : null)}>
          <option value="">None</option>
          {[...new Set([5, 10, 15, 20, 25, 30, 45, 60, 90, 120, ...(timerMinutes ? [timerMinutes] : [])])].sort((a, b) => a - b).map(m => <option key={m} value={m}>{durationLabel(m)}</option>)}
        </select>
        <p className="field-hint">Tap the chore to start a timer this long. When it rings, it offers to mark the chore done.</p>
      </div>}
      <div className="field">
        <label htmlFor="chore-approval">Needs a parent's OK</label>
        <select id="chore-approval" value={needsApproval === null ? 'default' : needsApproval ? 'yes' : 'no'} onChange={e => setNeedsApproval(e.target.value === 'default' ? null : e.target.value === 'yes')}>
          <option value="default">{assignee ? `Default (${defaultApproval ? 'yes' : 'no'})` : 'Default'}</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
        <p className="field-hint">Ticks from wall screens and kids' devices wait for a parent to approve before the points count. Default follows {assignee ? `${assignee.name}'s setting` : 'the setting of whoever does it'} in Settings → Family{pluginId ? '; timed play approves itself unless the switch above is on' : ''}.</p>
      </div>
      <div className="field">
        <label htmlFor="chore-repeat">Repeat</label>
        <select id="chore-repeat" value={repeat ?? 'custom'} onChange={e => editSched({ repeat: e.target.value as NonNullable<typeof repeat> })}>
          {repeat === null && <option value="custom" disabled>Custom</option>}
          {(['once', 'daily', 'weekly'] as const).map(r => <option key={r} value={r}>{r[0].toUpperCase() + r.slice(1)}</option>)}
        </select>
        {sched.custom && <p className="field-hint">Custom schedule ({repeatText(storedRrule)}). Picking an option replaces it.</p>}
      </div>
      {repeat === 'weekly' && (
        <div className="field">
          <label id="chore-days-label">On</label>
          <div className="day-toggles" role="group" aria-labelledby="chore-days-label">
            {weekOrder.map(d => {
              const on = sched.days.includes(d)
              return (
                <button key={d} type="button" className={on ? 'active' : ''} aria-pressed={on} aria-label={DAY_LONG[d]}
                  onClick={() => editSched({ days: on ? sched.days.filter(x => x !== d) : [...sched.days, d] })}>{DAY_SHORT[d][0]}</button>
              )
            })}
          </div>
          {!sched.days.length && <p className="field-hint">No days picked: repeats on the weekday it was created.</p>}
        </div>
      )}
      {(repeat === 'daily' || repeat === 'weekly') && (
        <div className="field">
          <label htmlFor="chore-until">Ends (optional)</label>
          <input id="chore-until" type="date" value={sched.until} min={today} onChange={e => editSched({ until: e.target.value })} />
        </div>
      )}
      {(repeat === 'once' || (draft && !schedTouched)) && (
        <div className="field">
          <label>{repeat === 'once' ? 'Due date' : 'Starts'}</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
      )}
    </Sheet>
  )
}
