import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, format, isSameDay } from 'date-fns'
import { useIsPhone } from './useIsPhone.ts'
import { useApp } from './AppContext.tsx'
import { api, ApiError } from './api.ts'
import type { Chore, ChoreDay, LeaderboardEntry, LeaderboardPeriod } from './types.ts'
import { MEMBER_EMOJI } from './types.ts'
import { dateKey } from './date.ts'
import Sheet from './Sheet.tsx'
import { AnyEmojiField } from './AnyEmojiField.tsx'
import { isSingleEmoji } from './emoji.ts'
import { inkFor } from './color.ts'
import { CheckIcon, PlusIcon } from './icons.tsx'
import { IDLE_RESET_EVENT } from './App.tsx'

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
  const { refreshTick } = useApp()
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
      <div className="segmented leaderboard-segmented">
        {LB_PERIODS.map(p => (
          <button key={p} className={period === p ? 'active' : ''} onClick={() => setPeriod(p)}>{p[0].toUpperCase() + p.slice(1)}</button>
        ))}
      </div>
      <div className="leaderboard-pills">
        {board.map(e => (
          <div key={e.memberId} className="leaderboard-pill">
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

function ProgressRing({ pct, color, avatar }: { pct: number; color: string; avatar: string }) {
  const r = 27, c = 2 * Math.PI * r
  return (
    <div className="progress-ring-wrap">
      <svg width="64" height="64" style={{ position: 'absolute', transform: 'rotate(-90deg)' }}>
        <circle cx="32" cy="32" r={r} fill="none" stroke="var(--border)" strokeWidth="5" />
        <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c * (1 - pct)} style={{ transition: 'stroke-dashoffset 0.4s ease' }} />
      </svg>
      <div className="avatar" style={{ background: color, color: inkFor(color), width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{avatar}</div>
    </div>
  )
}

function ChoreCard({ chore, onToggle, onEdit }: { chore: ChoreDay; onToggle: () => void; onEdit: () => void }) {
  const [burst, setBurst] = useState(false)
  const pressTimer = useRef<ReturnType<typeof setTimeout>>()
  const longPressed = useRef(false)

  const handleDown = () => {
    longPressed.current = false
    pressTimer.current = setTimeout(() => { longPressed.current = true; onEdit() }, 500)
  }
  const handleUp = () => {
    clearTimeout(pressTimer.current)
    if (longPressed.current) return
    if (!chore.completed) setBurst(true)
    onToggle()
  }

  return (
    <div className={`chore-card ${chore.completed ? 'done' : ''}`}
      onPointerDown={handleDown} onPointerUp={handleUp} onPointerLeave={() => clearTimeout(pressTimer.current)}>
      <div className="chore-emoji">{chore.emoji}</div>
      <div className="chore-info">
        <div className={`chore-title ${chore.completed ? 'done' : ''}`}>{chore.title}</div>
        <div className="chore-pts">{chore.points} pts</div>
      </div>
      <div className={`chore-check ${chore.completed ? 'done' : ''}`}>
        {chore.completed && <CheckIcon width={18} height={18} />}
      </div>
      {burst && <Confetti />}
    </div>
  )
}

export default function Chores() {
  const isPhone = useIsPhone()
  const { members, selectedMemberId, toast, reloadCore, refreshTick } = useApp()
  const [selectedDate, setSelectedDate] = useState(() => new Date())
  const [chores, setChores] = useState<ChoreDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [editChore, setEditChore] = useState<Chore | 'new' | null>(null)

  const key = dateKey(selectedDate)

  const load = () => {
    setLoading(true)
    api.getChoresDay(key).then(c => { setChores(c); setError(false) }).catch(() => setError(true)).finally(() => setLoading(false))
  }
  useEffect(load, [key, refreshTick])

  useEffect(() => {
    const onIdle = () => { setSelectedDate(new Date()); setEditChore(null) }
    window.addEventListener(IDLE_RESET_EVENT, onIdle)
    return () => window.removeEventListener(IDLE_RESET_EVENT, onIdle)
  }, [])

  const strip = useMemo(() => Array.from({ length: 14 }, (_, i) => addDays(new Date(), i - 4)), [])

  const toggle = async (c: ChoreDay) => {
    setChores(list => list.map(x => x.id === c.id ? { ...x, completed: !x.completed } : x)) // optimistic
    try {
      if (c.completed) await api.uncompleteChore(c.id, key)
      else await api.completeChore(c.id, key, c.memberId ?? undefined)
      reloadCore()
    } catch (e) {
      setChores(list => list.map(x => x.id === c.id ? { ...x, completed: c.completed } : x)) // revert
      toast(e instanceof ApiError ? e.message : 'Could not update chore')
    }
  }

  const columns = [...members, { id: '__anyone', name: 'Anyone', color: '#C7B8A8', avatar: '🌟', pointsToday: 0, pointsWeek: 0, sort: 999 }]
  const visibleColumns = selectedMemberId ? columns.filter(m => m.id === selectedMemberId) : columns
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
        <div className="period-label">{format(selectedDate, 'EEEE, MMMM d')}</div>
      </div>
      <div className="date-strip">
        {strip.map(d => (
          <button key={d.toISOString()} className={`date-chip ${isSameDay(d, selectedDate) ? 'active' : ''}`} onClick={() => setSelectedDate(d)}>
            <div className="wd">{format(d, 'EEE')}</div>
            <div className="dn">{format(d, 'd')}</div>
          </button>
        ))}
      </div>

      <Leaderboard />

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
                  <ProgressRing pct={pct} color={col.color} avatar={col.avatar} />
                  <div className="chore-col-name">{col.name}</div>
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

      {editChore && (
        <ChoreEditSheet
          chore={editChore === 'new' ? null : editChore}
          onClose={() => setEditChore(null)}
          onSaved={() => { setEditChore(null); load(); reloadCore() }}
        />
      )}
    </div>
  )
}

function ChoreEditSheet({ chore, onClose, onSaved }: { chore: Chore | null; onClose: () => void; onSaved: () => void }) {
  const { members, toast } = useApp()
  const [title, setTitle] = useState(chore?.title ?? '')
  const [emoji, setEmoji] = useState(chore?.emoji ?? MEMBER_EMOJI[0])
  const [points, setPoints] = useState(chore?.points ?? 5)
  const [memberId, setMemberId] = useState<string | null>(chore?.memberId ?? null)
  const [repeat, setRepeat] = useState<'' | 'daily' | 'weekly'>(chore?.rrule?.includes('DAILY') ? 'daily' : chore?.rrule?.includes('WEEKLY') ? 'weekly' : '')
  const [dueDate, setDueDate] = useState(chore?.dueDate ?? dateKey(new Date()))

  const submit = async () => {
    if (!title.trim() || !isSingleEmoji(emoji)) return
    const rrule = repeat === 'daily' ? 'FREQ=DAILY' : repeat === 'weekly' ? 'FREQ=WEEKLY' : null
    const body = { title: title.trim(), emoji, points, memberId, rrule, dueDate: rrule ? null : dueDate }
    try {
      if (chore) await api.updateChore(chore.id, body)
      else await api.createChore(body)
      onSaved()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save chore')
    }
  }
  const del = async () => {
    if (!chore) return
    if (!confirm(`Delete "${chore.title}"? Its history and points go with it.`)) return
    try { await api.deleteChore(chore.id); onSaved() } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not delete chore') }
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
            <button key={e} className={`emoji-swatch ${emoji === e ? 'active' : ''}`} onClick={() => setEmoji(e)}>{e}</button>
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
          <button className={`chip ${memberId === null ? 'active' : ''}`} onClick={() => setMemberId(null)}>🌟 Anyone</button>
          {members.map(m => (
            <button key={m.id} className={`chip ${memberId === m.id ? 'active' : ''}`} style={{ ['--chip-color' as string]: m.color }} onClick={() => setMemberId(m.id)}>{m.avatar} {m.name}</button>
          ))}
        </div>
      </div>
      <div className="field">
        <label>Repeat</label>
        <select value={repeat} onChange={e => setRepeat(e.target.value as typeof repeat)}>
          <option value="">One-off</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
        </select>
      </div>
      {!repeat && (
        <div className="field">
          <label>Due date</label>
          <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} />
        </div>
      )}
    </Sheet>
  )
}
