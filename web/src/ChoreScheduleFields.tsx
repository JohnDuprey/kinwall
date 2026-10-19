import { goalLabel, goalPeriod, maxGoalTimes, validGoal } from './choreGoal.ts'
import type { ChoreGoal } from './choreGoal.ts'
import { useState } from 'react'
import { dateParts, dayName, formToRrule, ordinalDay, rruleToForm, scheduleDates, scheduleText, validDate, validSchedule } from './choreSchedule.ts'
import type { Repeat, ScheduleForm } from './choreSchedule.ts'
import { formatDate, msg, t, tm } from './i18n.ts'

const REPEATS = { once: msg('Once'), daily: msg('Daily'), weekly: msg('Weekly') }
const UNITS = { daily: msg('Days'), weekly: msg('Weeks'), monthly: msg('Months'), yearly: msg('Years') }
const ORDINALS = [msg('First'), msg('Second'), msg('Third'), msg('Fourth'), msg('Fifth')]

export function ChoreScheduleFields({ value: f, start, today, onChange, onStart, goal, onGoal }: {
  value: ScheduleForm; start: string; today: string; goal: ChoreGoal | null; onGoal: (goal: ChoreGoal | null) => void
  onChange: (patch: Partial<ScheduleForm>) => void; onStart: (date: string) => void
}) {
  const [advanced, setAdvanced] = useState(f.custom || f.interval > 1 || f.repeat === 'monthly' || f.repeat === 'yearly' || f.end === 'after')
  const order = Array.from({ length: 7 }, (_, i) => (i + f.weekStart) % 7)
  const parts = dateParts(start || today)
  const goalDates = goal && validGoal(goal) && validDate(start) ? goalPeriod(goal, start, start > today ? start : today) : null
  const dates = !f.custom && validSchedule(f, start) && start ? scheduleDates(formToRrule(f), start, start > today ? start : today) : []
  const chooseRepeat = (choice: string) => {
    if (choice === 'goal') {
      onGoal({ times: 3, every: 1, unit: 'week', weekStart: f.weekStart });
      onChange({ ...rruleToForm(null), repeat: 'daily', end: f.end === 'on' ? 'on' : 'never', until: f.until });
      if (!start) onStart(today);
      return
    }
    onGoal(null)
    setAdvanced(choice === 'custom')
    if (choice === 'custom') {
      onChange(f.custom || f.repeat === 'once' ? { ...rruleToForm(null), ...dateDefaults(), weekStart: f.weekStart, repeat: 'weekly' } : {})
    } else onChange({ ...(f.custom ? rruleToForm(null) : {}), repeat: choice as Repeat, interval: 1 })
  }
  const dateDefaults = () => ({ days: [parts.weekday], monthDay: null, monthWeekday: parts.weekday, ordinal: parts.ordinal })
  return <>
    <div className="field">
      <label htmlFor="chore-repeat">{t('Repeat')}</label>
      <select id="chore-repeat" value={goal ? 'goal' : f.custom ? 'stored' : advanced && f.repeat !== 'once' ? 'custom' : f.repeat} onChange={e => chooseRepeat(e.target.value)}>
        {f.custom && <option value="stored" disabled>{t('Custom schedule')}</option>}
        {(['once', 'daily', 'weekly'] as const).map(r => <option key={r} value={r}>{tm(REPEATS[r])}</option>)}
        <option value="custom">{t('Custom…')}</option>
        <option value="goal">{t('Times per interval…')}</option>
      </select>
      {f.custom && <p className="field-hint">{t('This schedule has options this editor cannot change. It stays as it is unless you pick another repeat option.')}</p>}
    </div>
    {goal && <>
      <div className="field"><label htmlFor="chore-goal-times">{t('Times')}</label><input id="chore-goal-times" type="number" min={1} max={maxGoalTimes(goal)} step={1} value={goal.times || ''} onChange={e => onGoal({ ...goal, times: Number(e.target.value) })} /></div>
      <div className="field"><label htmlFor="chore-goal-every">{t('Every')}</label><div className="chore-repeat-interval"><input id="chore-goal-every" type="number" min={1} max={365} step={1} value={goal.every || ''} onChange={e => onGoal({ ...goal, every: Number(e.target.value) })} /><select aria-label={t('Goal interval')} value={goal.unit} onChange={e => onGoal({ ...goal, unit: e.target.value as ChoreGoal['unit'] })}><option value="day">{t('Days')}</option><option value="week">{t('Weeks')}</option><option value="month">{t('Months')}</option></select></div></div>
      {goal.unit === 'week' && <div className="field"><label htmlFor="chore-goal-week">{t('Weeks begin on')}</label><select id="chore-goal-week" value={goal.weekStart} onChange={e => onGoal({ ...goal, weekStart: Number(e.target.value) })}>{order.map(d => <option key={d} value={d}>{dayName(d, 'long')}</option>)}</select></div>}
      <p className="field-hint">{t('Choose any days in the interval. Counts at most once per day, with points for each completion. Pending approvals reserve a place in the goal.')}</p>
      {!validGoal(goal) && <p className="field-hint" role="alert">{t('Choose whole numbers and enough days for this goal. Monthly goals allow up to 28 completions per month so every month has enough days.')}</p>}
    </>}
    {!goal && !f.custom && advanced && f.repeat !== 'once' && <>
      <div className="field">
        <label htmlFor="chore-interval">{t('Repeat every')}</label>
        <div className="chore-repeat-interval">
          <input id="chore-interval" type="number" min={1} max={9999} step={1} value={f.interval || ''} onChange={e => onChange({ interval: Number(e.target.value) })} />
          <select aria-label={t('Repeat unit')} value={f.repeat} onChange={e => onChange({ repeat: e.target.value as Repeat })}>
            {(['daily', 'weekly', 'monthly', 'yearly'] as const).map(r => <option key={r} value={r}>{tm(UNITS[r])}</option>)}
          </select>
        </div>
      </div>
    </>}
    {!f.custom && f.repeat === 'weekly' && <><div className="field">
      <label id="chore-days-label">{t('On')}</label>
      <div className="day-toggles" role="group" aria-labelledby="chore-days-label">
        {order.map(d => <button key={d} type="button" className={f.days.includes(d) ? 'active' : ''} aria-pressed={f.days.includes(d)} aria-label={dayName(d, 'long')}
          onClick={() => onChange({ days: f.days.includes(d) ? f.days.filter(x => x !== d) : [...f.days, d] })}>{dayName(d, 'short')}</button>)}
      </div>
      {!f.days.length && <p className="field-hint">{t('No days picked: repeats on the weekday of its start date.')}</p>}
    </div>
      {advanced && <div className="field">
        <label htmlFor="chore-week-start">{t('Weeks begin on')}</label>
        <select id="chore-week-start" value={f.weekStart} onChange={e => onChange({ weekStart: Number(e.target.value) })}>
          {order.map(d => <option key={d} value={d}>{dayName(d, 'long')}</option>)}
        </select>
        {f.interval === 2 && <p className="field-hint">{t('For alternating weeks, select all seven days and start on the first day of the week. Add a chore for the other person starting one week later.')}</p>}
      </div>}
    </>}
    {!f.custom && f.repeat === 'monthly' && <>
      <div className="field">
        <label htmlFor="chore-monthly">{t('Repeat on')}</label>
        <select id="chore-monthly" value={f.monthly} onChange={e => onChange({ monthly: e.target.value as ScheduleForm['monthly'], monthWeekday: parts.weekday, ordinal: parts.ordinal })}>
          <option value="date">{t('Day of the month')}</option>
          <option value="weekday">{t('Weekday of the month')}</option>
        </select>
      </div>
      {f.monthly === 'date' ? <div className="field">
        <label htmlFor="chore-month-day">{t('Day of the month')}</label>
        <select id="chore-month-day" value={f.monthDay ?? ''} onChange={e => onChange({ monthDay: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{t('Day of start date')}</option>
          {Array.from({ length: 31 }, (_, i) => i + 1).map(day => <option key={day} value={day}>{day}</option>)}
        </select>
        <p className="field-hint">{t('Months without this day are skipped.')}</p>
      </div> : <div className="field">
        <label htmlFor="chore-month-ordinal">{t('Which week')}</label>
        <select id="chore-month-ordinal" value={f.ordinal} onChange={e => onChange({ ordinal: Number(e.target.value) })}>
          {ORDINALS.map((label, i) => <option key={i} value={i + 1}>{tm(label)}</option>)}
          <option value={-1}>{t('Last')}</option>
        </select>
        <label htmlFor="chore-month-weekday">{t('Weekday')}</label>
        <select id="chore-month-weekday" value={f.monthWeekday} onChange={e => onChange({ monthWeekday: Number(e.target.value) })}>
          {order.map(d => <option key={d} value={d}>{dayName(d, 'long')}</option>)}
        </select>
        <p className="field-hint">{ordinalDay(f.ordinal, f.monthWeekday)}</p>
      </div>}
    </>}
    {!f.custom && <div className="field">
      <label htmlFor="chore-start-date">{f.repeat === 'once' ? t('Due date') : t('Starts')}</label>
      <input id="chore-start-date" type="date" required={!!goal || f.repeat === 'once'} value={start} onChange={e => onStart(e.target.value)} />
      {!goal && !start && f.repeat !== 'once' && <p className="field-hint">{t('With no start date, repeats from the day this chore was created.')}</p>}
      {f.repeat === 'yearly' && <p className="field-hint">{t('Repeats on the month and day of the start date. February 29 repeats only in leap years.')}</p>}
    </div>}
    {!f.custom && f.repeat !== 'once' && <>
      <div className="field">
        <label htmlFor="chore-end">{t('Ends')}</label>
        <select id="chore-end" value={f.end} onChange={e => onChange({ end: e.target.value as ScheduleForm['end'], until: f.until || start || today })}>
          <option value="never">{t('Never')}</option><option value="on">{t('On a date')}</option>{!goal && <option value="after">{t('After a number of occurrences')}</option>}
        </select>
      </div>
      {f.end === 'on' && <div className="field">
        <label htmlFor="chore-until">{t('Last date')}</label>
        <input id="chore-until" type="date" value={f.until} min={start || undefined} onChange={e => onChange({ until: e.target.value })} />
      </div>}
      {f.end === 'after' && <div className="field">
        <label htmlFor="chore-count">{t('Occurrences')}</label>
        <input id="chore-count" type="number" min={1} max={9999} step={1} value={f.count || ''} onChange={e => onChange({ count: Number(e.target.value) })} />
        <p className="field-hint">{t('Counts scheduled dates from the start, including dates already passed.')}</p>
      </div>}
      <div className="field" aria-live="polite">
        <p className="field-hint">{goal ? goalLabel(goal) : scheduleText(formToRrule(f))}</p>
        {goalDates && <p className="field-hint">{t('Interval: {from} to {to}', { from: formatDate(new Date(`${goalDates.from}T12:00:00`), { month: 'short', day: 'numeric', year: 'numeric' }), to: formatDate(new Date(`${goalDates.to}T12:00:00`), { month: 'short', day: 'numeric', year: 'numeric' }) })}</p>}
        {!goal && start && validDate(start) && validSchedule(f, start) && <p className="field-hint">{dates.length
          ? t('Next dates: {dates}', { dates: dates.map(date => formatDate(new Date(`${date}T12:00:00`), { month: 'short', day: 'numeric', year: 'numeric' })).join(' · ') })
          : t('No upcoming dates with these settings.')}</p>}
      </div>
    </>}
    {goal && !validDate(start) && <p className="field-hint" role="alert">{t('Choose a start date for this goal.')}</p>}
    {!validSchedule(f, start) && <p role="alert" className="field-hint">{t('Check the start date, repeat interval, and end condition. Use whole numbers from 1 to 9999 and end on or after the start date.')}</p>}
  </>
}
