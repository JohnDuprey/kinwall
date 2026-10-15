// The energy battery (docs/using/battery.md): today's level with everything behind it and any
// heads-up, and on the Insights page (full) the week and the days ahead. The server works it all
// out (server/src/battery.ts) and refuses anyone but their own device and parents' devices; callers
// only show it there, never on a shared wall, the Board or a profile.
import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { dayLabel, drainedOf, levelWord, reasonLine, soon } from './battery.ts'
import { t, tm } from './i18n.ts'
import type { Battery, Member } from './types.ts'

export default function BatteryCard({ member, full = false }: { member: Member; full?: boolean }) {
  const { refreshTick } = useApp()
  const [b, setB] = useState<Battery | null>(null)
  const [pick, setPick] = useState('') // the day shown in detail (full); '' = today
  useEffect(() => {
    let canceled = false
    api.getBattery(member.id).then(x => { if (!canceled) setB(x) }).catch(() => { if (!canceled) setB(null) }) // nothing rather than an error
    return () => { canceled = true }
  }, [member.id, refreshTick])
  const shown = b?.memberId === member.id ? b : null
  const day = shown?.days.find(d => d.date === (pick || shown.today))
  if (!shown?.on || !day) return null
  const isToday = day.date === shown.today
  // Their day: heads-ups for today and tomorrow. Insights: every one ahead.
  const warnings = full ? shown.warnings : shown.warnings.filter(w => soon(w.date, shown.today))
  const label = (date: string) => dayLabel(date, shown.today)
  const body = (
    <>
      {full && (
        <>
          <label htmlFor={`battery-day-${member.id}`} className="sr-only">{t('Day')}</label>
          <select id={`battery-day-${member.id}`} className="settings-select" value={pick || shown.today} onChange={e => setPick(e.target.value)}>
            {shown.days.map(d => <option key={d.date} value={d.date}>{d.forecast ? t('{day} (a guess)', { day: label(d.date) }) : label(d.date)}</option>)}
          </select>
        </>
      )}
      <p className="battery-now">
        <span className="battery-level">{day.level}%</span>
        <span className="snap-meta">{isToday ? t('{level} by this evening', { level: levelWord(day.level) }) : t('{level} by evening', { level: levelWord(day.level) })} · {t('started at {n}%', { n: day.start })}</span>
      </p>
      <span className="board-meter battery-meter" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={day.level} aria-label={t("{name}'s battery by evening", { name: member.name })}>
        <span style={{ width: `${day.level}%`, background: member.color }} />
      </span>
      {day.reasons.length > 0 && <ul className="chip-row battery-reasons" aria-label={t('Why')}>{day.reasons.map(r => <li key={r.text} className="chip chip-static">{reasonLine([r])}</li>)}</ul>}
      {warnings.map(w => (
        <div key={w.date} className="battery-warning" role="note">
          <strong>{w.text}</strong>
          <ul>{w.suggestions.map(s => <li key={s}>{s}</li>)}</ul>
        </div>
      ))}
      {full && (
        <>
          <div className="insights-bars" role="img" aria-label={t('By evening each day: {days}.', { days: shown.days.map(d => d.forecast ? t('{day} {n}% (a guess)', { day: label(d.date), n: d.level }) : t('{day} {n}%', { day: label(d.date), n: d.level })).join(', ') })}>
            {shown.days.map(d => (
              <span key={d.date} className="insights-col">
                <span className={`insights-seg ${d.forecast ? 'forecast' : 'met'}`} style={{ height: `${Math.max(2, d.level)}%` }}><span className="insights-val">{d.level}</span></span>
              </span>
            ))}
          </div>
          <div className="battery-days" aria-hidden="true">{shown.days.map(d => <span key={d.date} className={d.date === shown.today ? 'today' : ''}>{dayLabel(d.date, shown.today, true)}</span>)}</div>
          {shown.days.some(d => d.felt) && (
            <div className="battery-days battery-felt" role="img" aria-label={t('How drained {name} felt: {days}.', { name: member.name, days: shown.days.filter(d => d.felt).map(d => `${label(d.date)} ${tm(drainedOf(d.felt)!.label)}`).join(', ') })}>
              {shown.days.map(d => <span key={d.date}>{drainedOf(d.felt)?.emoji ?? ''}</span>)}
            </div>
          )}
          <ul className="insights-legend" aria-hidden="true"><li><span className="insights-seg met" />{t('The last week')}</li><li><span className="insights-seg forecast" />{t('Days ahead (a guess)')}</li></ul>
          <p className="profile-note">{t('A rough guide from sleep, feelings and how full each day is, not a measurement. Pick a day to see what went into it.')}{shown.days.some(d => d.felt) ? ` ${t('The faces are how drained {name} said they felt that evening.', { name: member.name })}` : ''}</p>
        </>
      )}
    </>
  )
  return full ? (
    <section className="board-card profile-card insights-card profile-wide battery" aria-labelledby="in-battery">
      <h3 id="in-battery" className="snap-heading">🔋 {t('Battery')} <span>{t('last week and 3 days ahead')}</span></h3>
      {body}
    </section>
  ) : (
    <section className="snap-section battery" aria-label={t("{name}'s battery", { name: member.name })} style={{ ['--m' as string]: member.color }}>
      <h3 className="snap-heading">🔋 {t('Battery')} · 🔒 {t('Private')}</h3>
      {body}
    </section>
  )
}
