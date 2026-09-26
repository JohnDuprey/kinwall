import { useEffect, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import type { ChoreDay, Member, Snapshot, SnapshotBirthday, SnapshotChore, SnapshotEvent, SnapshotItem, WeatherDay } from './types.ts'
import { ChecklistSheet } from './Chores.tsx'
import { CheckIcon } from './icons.tsx'
import Sheet from './Sheet.tsx'
import { Segmented, announce } from './a11y.tsx'
import { inkFor } from './color.ts'
import { formatTime, todayKeyInTz } from './date.ts'

type Range = 'day' | 'week'
const PRIORITY_LABEL = { low: 'Low', normal: 'Normal', high: 'Important', urgent: 'Urgent' } as const

// First look at a member's day on this device, today: the greeting adds "Here's your day".
const SEEN_KEY = 'kinwall.snapshotSeen'
function readSeen(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(SEEN_KEY) || '{}') } catch { return {} }
}
function markSeen(memberId: string, today: string) {
  try { localStorage.setItem(SEEN_KEY, JSON.stringify({ ...readSeen(), [memberId]: today })) } catch { /* private mode */ }
}

export const dayName = (date: string, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat(undefined, { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`))

/** Deep links: close the sheet, then go where a tap in the app would. */
function go(hash: string, close: () => void) { close(); location.hash = hash }
const eventHash = (e: SnapshotEvent) => `#/calendar?event=${encodeURIComponent(e.id)}&at=${encodeURIComponent(e.start)}`

/** Header avatar tap: one member's day (or week) - weather, their events, chores, due items, birthdays. */
export default function SnapshotSheet({ member, onClose }: { member: Member; onClose: () => void }) {
  const { settings, refreshTick, selectedMemberId, setSelectedMemberId, focusMemberId, reloadCore, toast } = useApp()
  const tz = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const [range, setRange] = useState<Range>('day')
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [error, setError] = useState('')
  const [today] = useState(() => todayKeyInTz(tz))
  const [hello] = useState(() => readSeen()[member.id] !== today)
  useEffect(() => markSeen(member.id, today), [member.id, today])

  useEffect(() => {
    let canceled = false
    api.getSnapshot(member.id, range)
      .then(s => { if (!canceled) { setSnap(s); setError('') } })
      .catch(e => { if (!canceled) setError(e instanceof ApiError ? e.message : "Couldn't load this snapshot.") })
    return () => { canceled = true }
  }, [member.id, range, refreshTick])

  const filtered = selectedMemberId === member.id
  const toggleFilter = () => {
    setSelectedMemberId(filtered ? null : member.id)
    announce(filtered ? 'Calendar shows everyone' : `Calendar shows only ${member.name}`)
  }
  const shown = snap?.range === range ? snap : null // no flash of the other range's data

  // Chores tick off right here, like on the Chores tab. An "Anyone" chore done from someone's day
  // counts for them. The server refuses a chore whose checklist has open items (409): open the
  // checklist instead, and complete the chore from there.
  const [checklistFor, setChecklistFor] = useState<ChoreDay | null>(null)
  const setDone = (id: string, done: boolean) => setSnap(s => s && { ...s, chores: s.chores.map(x => x.id === id ? { ...x, done } : x) })
  const toggleChore = async (c: SnapshotChore) => {
    setDone(c.id, !c.done)
    try {
      if (c.done) await api.uncompleteChore(c.id, c.date)
      else await api.completeChore(c.id, c.date, member.id)
      announce(c.done ? `${c.title} not done` : `${c.title} done, ${c.points} point${c.points === 1 ? '' : 's'}`)
      reloadCore()
    } catch (e) {
      setDone(c.id, c.done)
      if (e instanceof ApiError && e.status === 409) {
        const day = await api.getChoresDay(c.date).catch(() => [] as ChoreDay[])
        const full = day.find(x => x.id === c.id)
        if (full?.checklist) { setChecklistFor(full); return }
      }
      toast(e instanceof ApiError ? e.message : 'Could not update chore', true)
    }
  }

  return (
    <Sheet title={range === 'day' ? `${member.name}'s day` : `${member.name}'s week`} onClose={onClose}>
      <div className="snap-hero">
        <span className="snap-avatar" aria-hidden="true" style={{ background: member.color, color: inkFor(member.color) }}>{member.avatar || member.name[0]}</span>
        <div>
          <p className="snap-greeting">{shown?.greeting ?? ' '}</p>
          {hello && range === 'day' && <p className="snap-sub">☀️ Here's your day</p>}
        </div>
      </div>
      <Segmented label="Show" value={range} onChange={setRange} className="snap-range"
        options={[{ key: 'day', label: 'Day' }, { key: 'week', label: 'Week' }]} />
      {error && <p className="snap-empty" role="alert">{error}</p>}
      {!shown && !error && <p className="snap-empty">Loading…</p>}
      {shown && (range === 'day' ? <DayView snap={shown} tz={tz} close={onClose} onToggle={toggleChore} /> : <WeekView snap={shown} tz={tz} close={onClose} />)}
      {!focusMemberId && (
        <div className="toggle-row snap-filter">
          <label id={`snap-filter-${member.id}`}>Show only {member.name} on the calendar</label>
          <button className={`switch ${filtered ? 'on' : ''}`} role="switch" aria-checked={filtered} aria-labelledby={`snap-filter-${member.id}`} onClick={toggleFilter}><span className="knob" /></button>
        </div>
      )}
      {checklistFor?.checklist && (
        <ChecklistSheet chore={checklistFor} onClose={() => setChecklistFor(null)}
          onComplete={async () => {
            const c = checklistFor; setChecklistFor(null)
            await toggleChore({ id: c.id, title: c.title, emoji: c.emoji, points: c.points, dueTime: c.dueTime, date: today, done: false, shared: !c.memberId })
          }} />
      )}
    </Sheet>
  )
}

function WeatherStrip({ snap }: { snap: Snapshot }) {
  const w = snap.weather
  const today = w?.days.find(d => d.date === snap.from)
  if (!w || !today) return null
  const deg = '°'
  return (
    <div className="snap-weather" role="group" aria-label={`Weather in ${w.location}`}>
      {w.now && <span className="snap-weather-now"><span className="snap-emoji" aria-hidden="true">{w.now.emoji}</span> <strong>{w.now.temp}{deg}</strong> <span className="snap-dim">now · {w.now.text}</span></span>}
      <span><span className="snap-emoji" aria-hidden="true">{today.emoji}</span> <span className="sr-only">{today.text}, </span>High {today.high}{deg} · Low {today.low}{deg}</span>
      {today.rainChance != null && today.rainChance > 0 && <span>💧 {today.rainChance}% rain</span>}
      <span className="snap-dim snap-weather-where">{w.location}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="snap-section" aria-label={title}>
      <h3 className="snap-heading">{title}</h3>
      {children}
    </section>
  )
}

function EventRow({ e, tz, close }: { e: SnapshotEvent; tz: string; close: () => void }) {
  return (
    <li>
      <button className="snap-row" onClick={() => go(eventHash(e), close)}>
        <span className="snap-time">{e.allDay ? 'All day' : formatTime(e.start, tz)}</span>
        <span className="snap-main">
          <span className="snap-title"><span className="snap-swatch" aria-hidden="true" style={{ background: e.color }} />{e.title}</span>
          {(e.leaveAt || e.location) && (
            <span className="snap-meta">{[e.leaveAt && `🚗 Leave by ${formatTime(e.leaveAt, tz)}`, e.location && `📍 ${e.location.split('\n')[0]}`].filter(Boolean).join(' · ')}</span>
          )}
        </span>
      </button>
    </li>
  )
}

function ChoreRow({ c, onToggle }: { c: SnapshotChore; onToggle: (c: SnapshotChore) => void }) {
  return (
    <li>
      <button className={`snap-row snap-chore ${c.done ? 'done' : ''}`} role="checkbox" aria-checked={c.done} onClick={() => onToggle(c)}
        aria-label={[c.title, c.shared && 'anyone', c.points > 0 && `${c.points} points`].filter(Boolean).join(', ')}>
        <span className="snap-time snap-emoji" aria-hidden="true">{c.emoji || '⭐'}</span>
        <span className="snap-main" aria-hidden="true">
          <span className="snap-title">{c.title}</span>
          <span className="snap-meta">{[c.shared && 'Anyone', c.points > 0 && `${c.points} pts`].filter(Boolean).join(' · ')}</span>
        </span>
        <span className={`chore-check ${c.done ? 'done' : ''}`} aria-hidden="true">{c.done && <CheckIcon width={18} height={18} />}</span>
      </button>
    </li>
  )
}

function dueText(i: SnapshotItem, today: string): string | null {
  if (!i.dueDate) return null
  if (i.overdue) return `Overdue (${dayName(i.dueDate, { month: 'short', day: 'numeric' })})`
  if (i.dueDate === today) return 'Due today'
  return `Due ${dayName(i.dueDate, { weekday: 'short', month: 'short', day: 'numeric' })}`
}

/** `after`: extra content at the row's end (the Board puts the owner's avatar there). */
export function ItemRow({ i, today, close, after }: { i: SnapshotItem; today: string; close: () => void; after?: React.ReactNode }) {
  const prio = i.priority !== 'normal' ? i.priority : null
  return (
    <li>
      <button className="snap-row" onClick={() => go(`#/lists?list=${encodeURIComponent(i.listId)}`, close)}>
        <span className="snap-time snap-emoji" aria-hidden="true">{i.listEmoji || '📝'}</span>
        <span className="snap-main">
          <span className="snap-title">{prio && <span className={`prio-dot prio-${prio}`} role="img" aria-label={PRIORITY_LABEL[prio]} />}{i.title}</span>
          <span className={`snap-meta ${i.overdue ? 'snap-overdue' : ''}`}>{[dueText(i, today), i.listName, i.stepsTotal > 0 && `${i.stepsDone}/${i.stepsTotal} steps`].filter(Boolean).join(' · ')}</span>
        </span>
        {after}
      </button>
    </li>
  )
}

function birthdayLine(b: SnapshotBirthday, you?: string) {
  const who = b.memberId === you ? 'Your birthday 🎉' : b.memberId ? `${b.name}'s birthday` : b.name
  return `${b.avatar ? `${b.avatar} ` : ''}${who}${b.age != null ? ` — ${b.memberId === you ? "you're" : 'turns'} ${b.age}` : ''}`
}
export function BirthdayRow({ b, you, close }: { b: SnapshotBirthday; you: string; close: () => void }) {
  const text = <><span className="snap-time snap-emoji" aria-hidden="true">🎂</span><span className="snap-main"><span className="snap-title">{birthdayLine(b, you)}</span></span></>
  return <li>{b.eventId ? <button className="snap-row" onClick={() => go(`#/calendar?event=${encodeURIComponent(b.eventId!)}&at=${b.date}`, close)}>{text}</button> : <div className="snap-row">{text}</div>}</li>
}

function DayView({ snap, tz, close, onToggle }: { snap: Snapshot; tz: string; close: () => void; onToggle: (c: SnapshotChore) => void }) {
  const today = snap.from
  const t = snap.tomorrow
  const tw = snap.weather?.days.find(d => d.date === t?.date)
  const glance = t ? [
    tw && `${tw.emoji} ${tw.text}, ${tw.high}°/${tw.low}°${tw.rainChance ? ` · 💧 ${tw.rainChance}%` : ''}`,
    ...t.birthdays.map(b => `🎂 ${birthdayLine(b, snap.member.id)}`),
    t.events.length ? `🗓 ${t.events.slice(0, 3).map(e => `${e.allDay ? '' : `${formatTime(e.start, tz)} `}${e.title}`).join(', ')}${t.events.length > 3 ? ` +${t.events.length - 3} more` : ''}` : '🗓 Nothing on the calendar',
    t.items.length > 0 && `📝 Due: ${t.items.slice(0, 3).map(i => i.title).join(', ')}${t.items.length > 3 ? ` +${t.items.length - 3} more` : ''}`,
  ].filter(Boolean) as string[] : []
  const openChores = snap.chores.filter(c => !c.done).length
  return (
    <>
      <WeatherStrip snap={snap} />
      <Section title="Today">
        {snap.events.length === 0
          ? <p className="snap-empty">Nothing on the calendar — enjoy it.</p>
          : <ul className="snap-list">{snap.events.map(e => <EventRow key={`${e.id}:${e.start}`} e={e} tz={tz} close={close} />)}</ul>}
      </Section>
      <Section title={snap.chores.length ? `Chores · ${openChores ? `${openChores} left` : 'all done 🎉'}` : 'Chores'}>
        {snap.chores.length === 0
          ? <p className="snap-empty">No chores today.</p>
          : <ul className="snap-list">{snap.chores.map(c => <ChoreRow key={c.id} c={c} onToggle={onToggle} />)}</ul>}
      </Section>
      <Section title="To do">
        {snap.items.length === 0
          ? <p className="snap-empty">Nothing due — all caught up.</p>
          : <ul className="snap-list">{snap.items.map(i => <ItemRow key={i.id} i={i} today={today} close={close} />)}</ul>}
      </Section>
      {snap.birthdays.length > 0 && (
        <Section title="Birthdays 🎂">
          <ul className="snap-list">{snap.birthdays.map(b => <BirthdayRow key={`${b.memberId ?? b.eventId}`} b={b} you={snap.member.id} close={close} />)}</ul>
        </Section>
      )}
      {t && (
        <Section title="Tomorrow at a glance">
          <ul className="snap-glance">{glance.map((line, i) => <li key={i}>{line}</li>)}</ul>
        </Section>
      )}
    </>
  )
}

function WeekView({ snap, tz, close }: { snap: Snapshot; tz: string; close: () => void }) {
  const today = snap.from
  const dates: string[] = []
  for (let d = new Date(`${snap.from}T12:00:00Z`); d.toISOString().slice(0, 10) <= snap.to; d.setUTCDate(d.getUTCDate() + 1)) dates.push(d.toISOString().slice(0, 10))
  const undated = snap.items.filter(i => !i.dueDate || i.overdue) // important with no date, or already late
  return (
    <>
      {undated.length > 0 && (
        <Section title="Keep in mind">
          <ul className="snap-list">{undated.map(i => <ItemRow key={i.id} i={i} today={today} close={close} />)}</ul>
        </Section>
      )}
      {dates.map(date => {
        const w: WeatherDay | undefined = snap.weather?.days.find(d => d.date === date)
        const events = snap.events.filter(e => e.date === date)
        const items = snap.items.filter(i => i.dueDate === date)
        const birthdays = snap.birthdays.filter(b => b.date === date)
        const chores = snap.chores.filter(c => c.date === date)
        const label = date === today ? 'Today' : dayName(date, { weekday: 'long', month: 'short', day: 'numeric' })
        const empty = !events.length && !items.length && !birthdays.length
        return (
          <section key={date} className="snap-section snap-weekday" aria-label={label}>
            <h3 className="snap-heading snap-day-heading">
              <span>{label}</span>
              {w && <span className="snap-day-weather"><span aria-hidden="true">{w.emoji}</span><span className="sr-only">{w.text}, </span> {w.high}°/{w.low}°{w.rainChance ? <span className="snap-dim"> · 💧{w.rainChance}%</span> : null}</span>}
            </h3>
            <ul className="snap-list">
              {birthdays.map(b => <BirthdayRow key={`${b.memberId ?? b.eventId}`} b={b} you={snap.member.id} close={close} />)}
              {events.map(e => <EventRow key={`${e.id}:${e.start}`} e={e} tz={tz} close={close} />)}
              {items.map(i => <ItemRow key={i.id} i={i} today={today} close={close} />)}
            </ul>
            {empty && <p className="snap-empty snap-empty-sm">Nothing planned.</p>}
            {chores.length > 0 && (
              <button className="snap-chores-line" onClick={() => go('#/chores', close)}>
                {chores.slice(0, 4).map(c => c.emoji || '⭐').join(' ')} {chores.length} chore{chores.length === 1 ? '' : 's'}
              </button>
            )}
          </section>
        )
      })}
    </>
  )
}
