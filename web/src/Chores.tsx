import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, isSameDay } from 'date-fns'
import { useIsPhone } from './useIsPhone.ts'
import { useApp } from './AppContext.tsx'
import { api, ApiError } from './api.ts'
import type { Chore, ChoreDay, LeaderboardEntry, LeaderboardPeriod, List, ListItem } from './types.ts'
import { MEMBER_EMOJI } from './types.ts'
import { dateKey } from './date.ts'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isSingleEmoji } from './emoji.ts'
import { inkFor } from './color.ts'
import { CheckIcon, PlusIcon } from './icons.tsx'
import { IDLE_RESET_EVENT } from './App.tsx'
import { announce, Segmented } from './a11y.tsx'
import { useDialog } from './dialog.tsx'

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

function Leaderboard() {
  const { refreshTick, members, settings } = useApp()
  // Spendable balance (all-time earned minus sticker purchases) next to the period's earned points.
  const spendable = (id: string) => settings.stickersEnabled ? members.find(m => m.id === id)?.balance ?? null : null
  const [period, setPeriod] = useState<LeaderboardPeriod>(loadLbPeriod)
  const [board, setBoard] = useState<LeaderboardEntry[]>([])
  const prevLeaderId = useRef<string | null | undefined>(undefined) // undefined = not loaded yet, don't bounce on first paint
  const [bounceId, setBounceId] = useState<string | null>(null)

  useEffect(() => { saveLbPeriod(period) }, [period])

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
      <Segmented className="leaderboard-segmented" label="Leaderboard period" value={period} onChange={setPeriod}
        options={LB_PERIODS.map(p => ({ key: p, label: p[0].toUpperCase() + p.slice(1) }))} />
      <div className="leaderboard-pills" role="list" aria-label="Leaderboard">
        {board.map(e => (
          <div key={e.memberId} className="leaderboard-pill" role="listitem"
            aria-label={[`${e.name}, rank ${e.rank}, ${e.points} points`, e.rank === 1 && e.points > 0 && 'leader', e.streak >= 2 && `${e.streak} day streak`, spendable(e.memberId) !== null && `${spendable(e.memberId)} to spend`].filter(Boolean).join(', ')}>
            <div className="lb-rank">#{e.rank}</div>
            <div
              className={`lb-avatar ${bounceId === e.memberId ? 'crown-bounce' : ''}`}
              style={{ background: e.color, color: inkFor(e.color), ['--lb-color' as string]: e.color }}
            >{e.avatar}</div>
            <div className="lb-info">
              <div className="lb-name-row">
                <span className="lb-name">{e.name}</span>
                {e.rank === 1 && e.points > 0 && <span className="lb-crown" aria-label="Leader">👑</span>}
                {e.streak >= 2 && <span className="lb-streak" aria-label={`${e.streak} day streak`}>🔥{e.streak}</span>}
              </div>
              <div className="lb-bar-track"><div className="lb-bar-fill" style={{ width: `${(e.points / maxPoints) * 100}%`, background: e.color }} /></div>
              {spendable(e.memberId) !== null && <div className="lb-spend" aria-hidden="true">{spendable(e.memberId)} to spend</div>}
            </div>
            <div className="lb-points">{e.points}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function Confetti() {
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

function ProgressRing({ pct, color, avatar, label }: { pct: number; color: string; avatar: string; label: string }) {
  const r = 27, c = 2 * Math.PI * r
  return (
    <div className="progress-ring-wrap" role="img" aria-label={label}>
      <svg width="64" height="64" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--border)" strokeWidth="5" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset 0.4s ease' }} />
      </svg>
      <div className="avatar" style={{ background: color, color: inkFor(color), width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{avatar}</div>
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
  const { members } = useApp()
  const schedule = scheduleLabel(chore.rrule)
  // An Anyone chore says who got the points once it's done.
  const by = !chore.memberId && chore.completed ? (members.find(m => m.id === chore.completedBy)?.name ?? 'nobody in particular') : null
  const cl = chore.checklist
  const checklist = cl ? `☑ ${cl.done}/${cl.total} ${cl.name}` : ''
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
    if (!chore.completed) setBurst(true)
    onToggle()
  }

  // Tap/Space/Enter toggles it (a checkbox to assistive tech); long-press, right-click/Menu key or
  // the Edit button that appears when tabbed to opens the editor.
  const toggleByKey = (e: React.KeyboardEvent) => {
    if (e.key !== ' ' && e.key !== 'Enter') return
    e.preventDefault()
    if (!chore.completed) setBurst(true)
    onToggle()
  }
  return (
    <>
      <div className={`chore-card ${chore.completed ? 'done' : ''}`} role="checkbox" aria-checked={chore.completed} tabIndex={0}
        aria-label={[chore.title, by && `done by ${by}`, `${chore.points} points`, schedule, cl ? `checklist ${cl.name} ${cl.done} of ${cl.total} done` : ''].filter(Boolean).join(', ')}
        onKeyDown={toggleByKey} onContextMenu={e => { e.preventDefault(); onEdit() }}
        onPointerDown={handleDown} onPointerUp={handleUp} onPointerLeave={() => clearTimeout(pressTimer.current)} onClick={handleClick}>
        <div className="chore-emoji" aria-hidden="true">{chore.emoji}</div>
        <div className="chore-info">
          <div className={`chore-title ${chore.completed ? 'done' : ''}`}>{chore.title}</div>
          <div className="chore-pts">{[by && `Done by ${by}`, `${chore.points} pts`, schedule, checklist].filter(Boolean).join(' · ')}</div>
        </div>
        <div className={`chore-check ${chore.completed ? 'done' : ''}`}>
          {chore.completed && <CheckIcon width={18} height={18} />}
        </div>
        {burst && <Confetti />}
      </div>
      <button className="btn btn-secondary focus-reveal" onClick={onEdit}>Edit {chore.title}</button>
    </>
  )
}

export default function Chores() {
  const isPhone = useIsPhone()
  const { members, selectedMemberId, focusMemberId, focusShowsShared, settings, toast, reloadCore, refreshTick } = useApp()
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [chores, setChores] = useState<ChoreDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [editChore, setEditChore] = useState<Chore | 'new' | null>(null)
  const [checklistFor, setChecklistFor] = useState<ChoreDay | null>(null) // the chore whose checklist sheet is open

  const key = dateKey(selectedDate)
  // Keep the selected chip visible when the day changes programmatically (e.g. after adding a chore).
  useEffect(() => { document.querySelector('.date-chip.active')?.scrollIntoView({ inline: 'center', block: 'nearest' }) }, [key])

  const load = () => {
    setLoading(true)
    api.getChoresDay(key).then(c => { setChores(c); setError(false) }).catch(() => setError(true)).finally(() => setLoading(false))
  }
  useEffect(load, [key, refreshTick])

  useEffect(() => {
    const onIdle = () => { setSelectedDate(new Date()); setEditChore(null); setChecklistFor(null) }
    window.addEventListener(IDLE_RESET_EVENT, onIdle)
    return () => window.removeEventListener(IDLE_RESET_EVENT, onIdle)
  }, [])

  const strip = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(new Date(), i - 4)), [])

  // "Who did it?" for an Anyone chore when the tab isn't filtered or pinned to one person.
  const [whoFor, setWhoFor] = useState<ChoreDay | null>(null)
  const toggle = async (c: ChoreDay, doneBy?: string | null) => {
    // A checklist with open items gates completion: open it here to tick off instead.
    if (!c.completed && c.checklist && c.checklist.done < c.checklist.total) { setChecklistFor(c); return }
    // An Anyone chore credits the filtered (or pinned) person; otherwise ask who did it.
    // `doneBy` null = "Nobody in particular" was picked.
    if (!c.completed && !c.memberId && doneBy === undefined) {
      if (selectedMemberId) doneBy = selectedMemberId
      else if (members.length > 0) { setWhoFor(c); return }
    }
    const creditTo = c.memberId ?? doneBy ?? undefined
    setChores(list => list.map(x => x.id === c.id ? { ...x, completed: !x.completed, completedBy: x.completed ? null : creditTo ?? null } : x)) // optimistic
    // Ticked off for a past day: earns the household's late-completion share (rounded like the server).
    const late = !c.completed && key < dateKey(new Date())
    const pts = late ? Math.round(c.points * settings.lateCompletionCredit / 100) : c.points
    const who = !c.memberId && creditTo ? members.find(m => m.id === creditTo)?.name : undefined
    announce(c.completed ? `${c.title} not done` : `${c.title} done${who ? ` by ${who}` : ''}, ${pts} point${pts === 1 ? '' : 's'}${late ? ', late' : ''}`)
    try {
      if (c.completed) await api.uncompleteChore(c.id, key)
      else await api.completeChore(c.id, key, creditTo)
      if (late) toast(`+${pts} (late)`)
      reloadCore()
    } catch (e) {
      setChores(list => list.map(x => x.id === c.id ? { ...x, completed: c.completed } : x)) // revert
      toast(e instanceof ApiError ? e.message : 'Could not update chore', true)
    }
  }

  const columns = [...members, { id: '__anyone', name: 'Anyone', color: '#C7B8A8', avatar: '🌟', pointsToday: 0, pointsWeek: 0, sort: 999 }]
  const visibleColumns = selectedMemberId
    // Anyone's chores stay beside the filtered person; only a display pinned to someone can hide them.
    ? columns.filter(m => m.id === selectedMemberId || (m.id === '__anyone' && (!focusMemberId || focusShowsShared)))
    : columns
  // Columns share the width equally down to a 110px floor (below which a card's contents stop
  // being legible - .chore-card switches to a stacked layout under that via a container query).
  // Past the floor the row overflows and .chore-columns' overflow-x/scroll-snap take over.
  const columnsGridStyle = { gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(110px, 1fr))` }
  // Phone stacks members vertically, so an empty member would be a whole blank card - list them on one line instead.
  const hasChores = (id: string) => chores.some(c => id === '__anyone' ? !c.memberId : c.memberId === id)
  const idle = isPhone && !loading ? visibleColumns.filter(m => !hasChores(m.id)) : []

  return (
    <div className="content">
      <div className="chores-header">
        <h2 className="period-label">{format(selectedDate, 'EEEE, MMMM d')}</h2>
      </div>
      <div className="date-strip" role="group" aria-label="Day">
        {strip.map(d => (
          <button key={d.toISOString()} className={`date-chip ${isSameDay(d, selectedDate) ? 'active' : ''}`} aria-pressed={isSameDay(d, selectedDate)} aria-label={format(d, 'EEEE, MMMM d')} onClick={() => setSelectedDate(d)}>
            <div className="wd">{format(d, 'EEE')}</div>
            <div className="dn">{format(d, 'd')}</div>
          </button>
        ))}
      </div>

      {settings.leaderboardEnabled && <Leaderboard />}

      {error ? (
        <div className="state-card">Couldn't load chores.</div>
      ) : !loading && chores.length === 0 ? (
        <div className="empty-card"><span className="emoji">✨</span>No chores for this day.</div>
      ) : (
        <div className="chore-columns" style={columnsGridStyle}>
          {visibleColumns.filter(m => !idle.includes(m)).map(col => {
            const list = chores.filter(c => col.id === '__anyone' ? !c.memberId : c.memberId === col.id)
            const done = list.filter(c => c.completed).length
            const pct = list.length ? done / list.length : 0
            return (
              <div key={col.id} className="chore-column">
                <div className="chore-col-head">
                  <ProgressRing pct={pct} color={col.color} avatar={col.avatar} label={`${col.name}: ${done} of ${list.length} done`} />
                  <h3 className="chore-col-name" style={{ margin: 0 }}>{col.name}</h3>
                  <div className="chore-col-pts">{list.reduce((s, c) => s + (c.completed ? c.points : 0), 0)} pts today</div>
                </div>
                {list.map(c => (
                  <ChoreCard key={c.id} chore={c} onToggle={() => toggle(c)} onEdit={() => setEditChore(c)} />
                ))}
              </div>
            )
          })}
          {/* Tap toggles done (kid-friendly), so editing is a long press - say so on phones,
              where an admin is the one looking. On the iPad grid this would become a column. */}
          {idle.length > 0 && <p className="chores-hint">Nothing due: {idle.map(m => m.name).join(', ')}</p>}
          {isPhone && <p className="chores-hint">Press and hold a chore to edit it.</p>}
        </div>
      )}

      <button className="fab" onClick={() => setEditChore('new')} aria-label="Add chore"><PlusIcon /></button>

      {whoFor && (
        <Sheet title="Who did it?" onClose={() => setWhoFor(null)}>
          <p className="settings-row-sub" style={{ margin: '0 0 12px' }}>{whoFor.emoji} {whoFor.title} · {whoFor.points} pts go to whoever you pick.</p>
          <div className="who-grid">
            {members.map(m => (
              <button key={m.id} className="who-btn" onClick={() => { const c = whoFor; setWhoFor(null); toggle(c, m.id) }}>
                <span className="who-avatar" aria-hidden="true" style={{ background: m.color, color: inkFor(m.color) }}>{m.avatar || m.name[0]}</span>
                {m.name}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 12 }} onClick={() => { const c = whoFor; setWhoFor(null); toggle(c, null) }}>Nobody in particular</button>
        </Sheet>
      )}
      {checklistFor?.checklist && (
        <ChecklistSheet chore={checklistFor} onClose={() => { setChecklistFor(null); load() }}
          onComplete={async () => { const c = checklistFor; setChecklistFor(null); await toggle({ ...c, checklist: null }) }} />
      )}
      {editChore && (
        <ChoreEditSheet
          chore={editChore === 'new' ? null : editChore}
          onClose={() => setEditChore(null)}
          onSaved={first => {
            setEditChore(null)
            // A new chore that isn't scheduled for the day on screen would otherwise vanish on save.
            if (first && !isSameDay(first, selectedDate)) { setSelectedDate(first); toast(`Added — first on ${format(first, 'EEE, MMM d')}`) }
            load(); reloadCore()
          }}
        />
      )}
    </div>
  )
}

/** A chore's checklist, in place: the linked list's items for this chore's member plus the
 * unassigned ones (an "anyone" chore sees the whole list). Ticks land on the list items
 * themselves - an unassigned item is genuinely shared between siblings' routines - and the
 * Complete button unlocks once nothing here is left open. Closing leaves the chore as it was. */
export function ChecklistSheet({ chore, onClose, onComplete }: { chore: ChoreDay; onClose: () => void; onComplete: () => void }) {
  const { members, toast } = useApp()
  const listId = chore.checklist!.listId
  const name = chore.checklist?.name ?? 'Checklist'
  const [items, setItems] = useState<ListItem[] | null>(null)
  const [draft, setDraft] = useState('')
  const mine = (i: ListItem) => !chore.memberId || !i.memberId || i.memberId === chore.memberId
  const load = () => api.getList(listId).then(d => setItems(d.items.filter(mine))).catch(() => toast('Could not load the checklist', true))
  useEffect(() => { load() }, [listId]) // eslint-disable-line react-hooks/exhaustive-deps
  const open = items ? items.filter(i => !i.done).length : 1
  const tick = async (item: ListItem) => {
    setItems(list => list && list.map(i => i.id === item.id ? { ...i, done: !i.done } : i))
    try { await api.updateListItem(listId, item.id, { done: !item.done }) } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not update', true); load() }
  }
  const add = async () => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    try { await api.addListItems(listId, { title, memberId: chore.memberId }); load() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not add', true) }
  }
  return (
    <Sheet title={`${chore.emoji ? `${chore.emoji} ` : ''}${chore.title}`} onClose={onClose}
      actions={<button className="btn btn-primary" onClick={onComplete} disabled={open > 0}>{open > 0 ? `${open} left on ${name}` : `Complete ${chore.title}`}</button>}>
      <p className="field-hint checklist-hint">Tick everything on <strong>{name}</strong> to complete this chore.</p>
      <div className="list-add-bar">
        <input value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} placeholder="Add a step…" aria-label="Add a step" />
        <button className="icon-btn" onClick={add} disabled={!draft.trim()} aria-label="Add step"><PlusIcon width={20} height={20} /></button>
      </div>
      {items === null ? <div className="state-card">Loading…</div>
        : items.length === 0 ? <div className="empty-card"><span className="emoji">📝</span>Nothing on this checklist yet.</div>
        : (
          <div className="checklist-rows" role="group" aria-label={name}>
            {items.map(item => {
              const who = item.memberId ? members.find(m => m.id === item.memberId) : null
              return (
                <div key={item.id} className={`list-item-row ${item.done ? 'done' : ''}`}>
                  <button className={`list-item-check ${item.done ? 'done' : ''}`} onClick={() => tick(item)} role="checkbox" aria-checked={item.done} aria-label={item.title}>
                    {item.done && <CheckIcon width={20} height={20} />}
                  </button>
                  <div className="list-item-body"><div className="list-item-title-row"><div className="list-item-title">{item.title}</div></div></div>
                  {who && <div className="member-avatar-sm" role="img" aria-label={`For ${who.name}`} style={{ background: who.color, color: inkFor(who.color) }}>{who.avatar || who.name[0]}</div>}
                </div>
              )
            })}
          </div>
        )}
      <a className="text-link checklist-edit" href={`#/lists?list=${listId}`} onClick={onClose}>Edit the {name} list</a>
    </Sheet>
  )
}

function ChoreEditSheet({ chore, onClose, onSaved }: { chore: Chore | null; onClose: () => void; onSaved: (firstDate?: Date) => void }) {
  const dialog = useDialog()
  const { members, toast, settings } = useApp()
  const [title, setTitle] = useState(chore?.title ?? '')
  const [emoji, setEmoji] = useState(chore?.emoji ?? MEMBER_EMOJI[0])
  const [points, setPoints] = useState(chore?.points ?? 5)
  const [memberId, setMemberId] = useState<string | null>(chore?.memberId ?? null)
  const [listId, setListId] = useState<string | null>(chore?.listId ?? null)
  const [lists, setLists] = useState<List[]>([])
  useEffect(() => { api.getLists().then(setLists).catch(() => { /* picker just stays empty */ }) }, [])
  const [dueDate, setDueDate] = useState(chore?.dueDate ?? dateKey(new Date()))
  const [sched, setSched] = useState(() => {
    const f = rruleToForm(chore?.rrule ?? null)
    return chore ? f : { ...f, days: [new Date().getDay()] } // new chore: preselect today, the day it anchors on
  })
  const [schedTouched, setSchedTouched] = useState(false) // untouched = send the stored rrule back as-is (keeps custom rules)
  const editSched = (patch: Partial<ScheduleForm>) => { setSched(s => ({ ...s, ...patch, custom: false })); setSchedTouched(true) }
  const repeat = sched.custom ? null : sched.repeat
  const weekOrder = Array.from({ length: 7 }, (_, i) => (i + settings.weekStart) % 7)
  const today = dateKey(new Date())

  const submit = async () => {
    if (!title.trim() || !isSingleEmoji(emoji)) return
    const rrule = schedTouched || !chore ? formToRrule(sched) : chore.rrule
    const body = { title: title.trim(), emoji, points, memberId, rrule, dueDate: rrule ? null : dueDate, listId }
    try {
      if (chore) await api.updateChore(chore.id, body)
      else await api.createChore(body)
      onSaved(chore ? undefined : firstScheduledDay(sched, dueDate))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save chore', true)
    }
  }
  const del = async () => {
    if (!chore) return
    if (!await dialog.confirm({ title: `Delete "${chore.title}"?`, body: 'Its history and points go with it.', confirmLabel: 'Delete', danger: true })) return
    try { await api.deleteChore(chore.id); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete chore', true) }
  }

  return (
    <Sheet title={chore ? 'Edit chore' : 'New chore'} onClose={onClose}
      actions={
        <>
          {chore && <button className="btn btn-danger" onClick={del}>Delete</button>}
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
            <button key={m.id} className={`chip ${memberId === m.id ? 'active' : ''}`} aria-pressed={memberId === m.id} style={{ ['--chip-color' as string]: m.color }} onClick={() => setMemberId(m.id)}>{m.avatar} {m.name}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label htmlFor="chore-checklist">Checklist (optional)</label>
        <select id="chore-checklist" value={listId ?? ''} onChange={e => setListId(e.target.value || null)}>
          <option value="">None</option>
          {lists.filter(l => !l.archived || l.id === listId).map(l => <option key={l.id} value={l.id}>{l.emoji ? `${l.emoji} ` : ''}{l.name}{l.kind === 'reusable' ? '' : ` (${l.kind})`}</option>)}
        </select>
        <p className="field-hint">Every item on the list has to be ticked before this chore can be completed. A reusable list resets once it is.</p>
      </div>
      <div className="field">
        <label>Repeat</label>
        <Segmented className="chore-repeat" label="Repeat" value={repeat} onChange={r => editSched({ repeat: r })}
          options={(['once', 'daily', 'weekly'] as const).map(r => ({ key: r, label: r[0].toUpperCase() + r.slice(1) }))} />
        {sched.custom && <p className="field-hint">Custom schedule ({chore?.rrule}). Picking an option replaces it.</p>}
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
      {repeat === 'once' && (
        <div className="field">
          <label>Due date</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
      )}
    </Sheet>
  )
}
