// A person's insights (#/insights/{memberId}): their check-ins over time next to chores, activity
// and how busy their calendar was, with plain summaries and, after about 3 weeks, connections.
// Everything is worked out on the server (server/src/insights.ts); this page only draws it. Hand-rolled
// charts, to scale, in the member's color. Opens on their own device and parents' devices only; the
// server refuses everyone else (403), and this page says so kindly.
import { useEffect, useState, type ReactNode } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { inkFor } from './color.ts'
import { SLEEP } from './tempCheck.ts'
import { duration } from './profile.ts'
import { Bar } from './Profile.tsx'
import BatteryCard from './Battery.tsx'
import { batteryOn } from './battery.ts'
import { chartMax, confidenceLabel, keepCheckingIn, RANGES, shortDate, sleepPath, weekly, type Week } from './insights.ts'
import type { InsightDay, InsightRange, Insights as InsightsData, Member } from './types.ts'

export default function Insights({ memberId }: { memberId?: string }) {
  const { members, meMemberId, refreshTick } = useApp()
  const member = members.find(m => m.id === memberId) ?? members.find(m => m.id === meMemberId)
  const [range, setRange] = useState<InsightRange>('4w')
  const [data, setData] = useState<InsightsData | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!member) return
    let canceled = false
    api.getInsights(member.id, range)
      .then(d => { if (!canceled) { setData(d); setError('') } })
      .catch(e => { if (!canceled) setError(e instanceof ApiError && e.status === 403 ? `${member.name}'s insights are private. They open on ${member.name}'s own device and parents' devices.` : e instanceof ApiError ? e.message : "Couldn't load insights.") })
    return () => { canceled = true }
  }, [member?.id, range, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!member) return <div className="state-card">No one in the family yet.</div>
  const shown = data?.memberId === member.id && data.range === range ? data : null
  return (
    <div className="profile insights scroll-y" style={{ ['--m' as string]: member.color }}>
      <section className="profile-top">
        <div className="profile-hero">
          <span className="profile-avatar" style={{ background: member.color, color: inkFor(member.color) }} aria-hidden="true">{member.avatar || member.name[0]}</span>
          <div>
            <h2 className="profile-name">{member.name}'s insights</h2>
            <p className="profile-meta">🔒 {member.grownUp ? `Private to ${member.name}'s own devices and parent devices.` : `Just for ${member.name}, and parents can see it too.`}</p>
          </div>
        </div>
        {!error && (
          <div className="insights-range">
            <label htmlFor="insights-range" className="sr-only">Time range</label>
            <select id="insights-range" className="settings-select" value={range} onChange={e => setRange(e.target.value as InsightRange)}>
              {RANGES.map(r => <option key={r.key} value={r.key}>{r.label}</option>)}
            </select>
          </div>
        )}
      </section>
      {error && <p className="snap-empty" role="alert">{error}</p>}
      {!shown && !error && <p className="snap-empty">Loading…</p>}
      {shown && <Body member={member} d={shown} />}
    </div>
  )
}

function Body({ member, d }: { member: Member; d: InsightsData }) {
  const weeks = weekly(d.days)
  const any = (f: (x: InsightDay) => boolean) => d.days.some(f)
  const c = d.connections
  return (
    <div className="profile-grid">
      {batteryOn(member.tempCheck) && <BatteryCard member={member} full />}
      <Card id="in-summary" title="In short" note={`${shortDate(d.from)} to today`}>
        <ul className="insights-summary">{d.summary.map(s => <li key={s.id}>{s.text}</li>)}</ul>
        {!member.tempCheck?.on && !any(x => x.checkedIn) && <p className="profile-note">Temp check is off for {member.name}. A parent can turn it on in Settings → Family.</p>}
      </Card>
      {(member.tempCheck?.on || c.daysWithCheckIns > 0) && <Card id="in-connections" title="Connections" note={c.ready && c.list.length ? `${c.daysWithCheckIns} days with check-ins` : undefined}>
        {!c.ready && <p className="insights-wait">🌱 {keepCheckingIn(c.daysWithCheckIns)}</p>}
        {c.ready && c.list.length === 0 && <p className="insights-wait">No clear connections yet. They show up here when a difference is big enough to notice.</p>}
        {c.list.length > 0 && (
          <ul className="insights-connections">
            {c.list.map(x => (
              <li key={x.id}>
                <span className={`insights-confidence ${x.confidence}`}>{confidenceLabel(x.confidence)}</span>
                <strong>{x.text}</strong>
                <span className="profile-note">{x.detail}</span>
              </li>
            ))}
          </ul>
        )}
        {c.list.length > 0 && <p className="profile-note">These are things that happened together, not proof that one causes the other.</p>}
      </Card>}
      {any(x => !!x.sleep) && <Card id="in-sleep" title="Sleep" wide><SleepChart days={d.days} /></Card>}
      {d.topFeelings.length > 0 && <Card id="in-feelings" title="Feelings"><Feelings d={d} weeks={weeks} /></Card>}
      {any(x => x.goalSet) && <Card id="in-goals" title="Goals" note="per week"><GoalWeeks weeks={weeks} /></Card>}
      {any(x => x.chores > 0) && (
        <Card id="in-chores" title="Chores done" note="per week">
          <WeekBars weeks={weeks} value={w => w.chores} label={n => `${n} ${n === 1 ? 'chore' : 'chores'}`} />
        </Card>
      )}
      {any(x => x.activityMinutes > 0) && (
        <Card id="in-activity" title="Activity time" note="per week">
          <WeekBars weeks={weeks} value={w => w.activityMinutes} label={n => duration(n * 60)} />
        </Card>
      )}
      {any(x => x.events > 0) && <Card id="in-busy" title="Busy days" note="events per day" wide><BusyChart days={d.days} /></Card>}
    </div>
  )
}

function Card({ id, title, note, wide = false, children }: { id: string; title: string; note?: string; wide?: boolean; children: ReactNode }) {
  return (
    <section className={`board-card profile-card insights-card ${wide ? 'profile-wide' : ''}`} aria-labelledby={id}>
      <h3 id={id} className="snap-heading">{title} {note && <span>{note}</span>}</h3>
      {children}
    </section>
  )
}

/** First and last day under a chart. */
function Axis({ from, to }: { from: string; to: string }) {
  return <div className="insights-axis" aria-hidden="true"><span>{from}</span><span>{to}</span></div>
}

const SLEEP_W = 1000
const SLEEP_ROW = 32 // px per sleep answer; the plot is drawn 1:1 vertically

function SleepChart({ days }: { days: InsightDay[] }) {
  const answered = days.filter(x => x.sleep)
  const well = answered.filter(x => x.sleep === 'great' || x.sleep === 'good').length
  const h = SLEEP_ROW * 5
  return (
    <>
      <div className="insights-sleep">
        <ul className="insights-sleep-axis" aria-hidden="true">{SLEEP.map(s => <li key={s.key} style={{ height: SLEEP_ROW }}>{s.emoji} {s.label}</li>)}</ul>
        <svg className="insights-plot" viewBox={`0 0 ${SLEEP_W} ${h}`} preserveAspectRatio="none" style={{ height: h }} role="img"
          aria-label={`Sleep over ${days.length} days: well or great on ${well} of ${answered.length} nights answered.`}>
          {SLEEP.map((s, i) => <line key={s.key} x1="0" x2={SLEEP_W} y1={SLEEP_ROW / 2 + i * SLEEP_ROW} y2={SLEEP_ROW / 2 + i * SLEEP_ROW} />)}
          <path d={sleepPath(days, SLEEP_W, h - SLEEP_ROW)} transform={`translate(0 ${SLEEP_ROW / 2})`} />
        </svg>
      </div>
      <Axis from={shortDate(days[0].date)} to="Today" />
    </>
  )
}

function Feelings({ d, weeks }: { d: InsightsData; weeks: Week[] }) {
  const top = d.topFeelings
  const trend = top.slice(0, 4)
  return (
    <>
      {top.map(f => <Bar key={f.feeling} label={f.feeling} value={f.days} max={top[0].days} text={`${f.days} ${f.days === 1 ? 'day' : 'days'}`} />)}
      {weeks.length > 1 && (
        <>
          <p className="profile-note">Each week</p>
          <div className="insights-trend">
            {trend.map(f => (
              <div key={f.feeling} className="insights-trend-row" role="img" aria-label={`${f.feeling}, days each week: ${weeks.map(w => w.feelings[f.feeling] ?? 0).join(', ')}`}>
                <span className="insights-trend-label">{f.feeling}</span>
                <span className="insights-mini">{weeks.map(w => <span key={w.from} style={{ height: `${((w.feelings[f.feeling] ?? 0) / 7) * 100}%` }} />)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  )
}

const OUTCOME_PARTS = [
  { key: 'met', label: 'Met', cls: 'met' },
  { key: 'partly', label: 'Partly', cls: 'partly' },
  { key: 'no', label: 'Not this time', cls: 'no' },
  { key: 'open', label: 'No check', cls: 'open' },
] as const

function GoalWeeks({ weeks }: { weeks: Week[] }) {
  const set = weeks.reduce((s, w) => s + w.goals.set, 0)
  return (
    <>
      <div className="insights-bars" role="img" aria-label={`Goals set each week, out of 7 days: ${weeks.map(w => `${w.goals.set} set, ${w.goals.met} met`).join('; ')}. ${set} in all.`}>
        {weeks.map(w => (
          <span key={w.from} className="insights-col">
            <span className="insights-stack">
              {OUTCOME_PARTS.map(p => w.goals[p.key] > 0 && <span key={p.key} className={`insights-seg ${p.cls}`} style={{ height: `${(w.goals[p.key] / 7) * 100}%` }} />)}
            </span>
          </span>
        ))}
      </div>
      <Axis from={shortDate(weeks[0].from)} to="This week" />
      <ul className="insights-legend" aria-hidden="true">{OUTCOME_PARTS.map(p => <li key={p.key}><span className={`insights-seg ${p.cls}`} />{p.label}</li>)}</ul>
    </>
  )
}

function WeekBars({ weeks, value, label }: { weeks: Week[]; value: (w: Week) => number; label: (n: number) => string }) {
  const max = chartMax(Math.max(...weeks.map(value)))
  const few = weeks.length <= 13
  return (
    <>
      <div className="insights-bars" role="img" aria-label={`Each week: ${weeks.map(w => label(value(w))).join(', ')}.`}>
        {weeks.map(w => (
          <span key={w.from} className="insights-col">
            <span className="insights-seg met" style={{ height: `${(value(w) / max) * 100}%` }}>{few && value(w) > 0 && <span className="insights-val">{value(w)}</span>}</span>
          </span>
        ))}
      </div>
      <Axis from={shortDate(weeks[0].from)} to="This week" />
    </>
  )
}

function BusyChart({ days }: { days: InsightDay[] }) {
  const max = chartMax(Math.max(...days.map(x => x.events)))
  const lates = days.filter(x => x.lastEventEnd && x.lastEventEnd > '20:00').length
  const w = 1000 / days.length
  const H = 100
  return (
    <>
      <svg className="insights-plot insights-busy" viewBox={`0 0 1000 ${H + 12}`} preserveAspectRatio="none" role="img"
        aria-label={`Events each day, up to ${Math.max(...days.map(x => x.events))}. ${lates} ${lates === 1 ? 'evening' : 'evenings'} with an event ending after 8 PM.`}>
        <line x1="0" x2="1000" y1={H} y2={H} />
        {days.map((x, i) => x.events > 0 && <rect key={x.date} className="bar" x={i * w + w * 0.15} width={w * 0.7} y={H - (x.events / max) * H} height={(x.events / max) * H} />)}
        {days.map((x, i) => x.lastEventEnd && x.lastEventEnd > '20:00' && <rect key={`l${x.date}`} className="late" x={i * w + w * 0.15} width={w * 0.7} y={H + 4} height={8} />)}
      </svg>
      <Axis from={shortDate(days[0].date)} to="Today" />
      <ul className="insights-legend" aria-hidden="true">
        <li><span className="insights-seg met" />Events (top: {max})</li>
        <li><span className="insights-seg late" />Ended after 8 PM</li>
      </ul>
    </>
  )
}
