import { SCHOOL_KINDS as KINDS, schoolKindLabel as kindLabel } from './schoolwork.ts'
// School (docs/using/school.md; server: routes/school.ts): subjects, which kids are in school, and
// the time each kid spends learning. One week at a time: each kid's minutes by subject, then what
// was logged, newest first. Log time opens a sheet for one kid or several; one save is one log per
// kid, shown here as one entry. Its own feature switch, off until a family turns it on.
//
// Who does what: a parent's device everything (Set up, fix or delete a log, approve, the CSV). A
// wall logs time for any kid in school; a kid's own device only for its kid. Time a kid logs that
// their school settings say to check waits for a grown-up and doesn't count until approved.
import { Fragment, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import { useMediaQuery } from './useIsPhone.ts'
import { preparePhoto } from './photos.ts'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { LoadError, Segmented } from './a11y.tsx'
import { PointsStepper } from './ChoreSuggest.tsx'
import { ChoreScheduleFields } from './ChoreScheduleFields.tsx'
import { rruleToForm, scheduleBody, validSchedule, type ScheduleForm } from './choreSchedule.ts'
import { validGoal, type ChoreGoal } from './choreGoal.ts'
import { durationLabel } from './timers.ts'
import Sheet from './Sheet.tsx'
import { ChipFace, Face } from './Face'
import { ChevronDown, ChevronLeft, ChevronRight, MinusIcon, PlusIcon } from './icons.tsx'
import { todayKeyInTz } from './date.ts'
import { addDayKeys } from './library.ts'
import { DAY, formatDate, intlLocale, msg, t, tm, tn } from './i18n.ts'
import { hoursMinutes } from './reading.ts'
import { csv, DEFAULT_YEAR_START, groups, kidTotals, onDay, schoolYearOf, schoolYears, weekOf, type LogGroup } from './school.ts'
import PickField from './PickField.tsx'
import { formatTime } from './timeFormat.ts'
import type { Contact, ContactCategory } from './contact-types.ts'
import { ContactForm } from './Contacts.tsx'
import type { CalendarEntry, ChoreDay, EventInstance, Member, SchoolDay, SchoolDayKind, SchoolDayRule, SchoolDays, SchoolGrade, SchoolRecords, SchoolKid, SchoolKind, SchoolLog, SchoolMode, SchoolSettings, SchoolSubject } from './types.ts'
import './meals.css'
import './outings.css'
import './school.css'

const CHANGED = 'kinwall:school'
const changed = () => window.dispatchEvent(new Event(CHANGED))
const err = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)
const longDay = (d: string) => formatDate(new Date(`${d}T12:00:00`), { weekday: 'long', month: 'short', day: 'numeric' })
const shortDay = (d: string) => formatDate(new Date(`${d}T12:00:00`), DAY)
const LESSON_DAYS = 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'
const dayKeys = (from: string) => Array.from({ length: 7 }, (_, i) => addDayKeys(from, i))
const COLORS = ['#5B8DEF', '#E86A92', '#C8610F', '#2BAE8E', '#B07A3B', '#A06BE0', '#3B9FC8', '#E0A431']

function useTick() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(n => n + 1)
    window.addEventListener(CHANGED, bump)
    return () => window.removeEventListener(CHANGED, bump)
  }, [])
  return tick
}

/** What this device may do: a parent everything; a kid's own device logs for its kid; a wall logs for anyone. */
function useWho() {
  const { members, parentDevice, meMemberId, settings } = useApp()
  const kidId = !parentDevice && meMemberId && members.find(m => m.id === meMemberId)?.grownUp === false ? meMemberId : null
  return { parent: parentDevice, kidId, today: todayKeyInTz(settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone) }
}

export default function School() {
  const { members, settings, refreshTick, toast } = useApp()
  const who = useWho()
  const tick = useTick()
  const dialog = useDialog()
  const [day, setDay] = useState(who.today)
  const week = weekOf(day, settings.weekStart ?? 0)
  const tz = settings.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone
  const [data, setData] = useState<{ subjects: SchoolSubject[]; kids: SchoolKid[]; logs: SchoolLog[]; waiting: SchoolLog[] } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)
  const [logging, setLogging] = useState(false)
  const [editing, setEditing] = useState<LogGroup | null>(null)
  const [setup, setSetup] = useState(false)
  const [view, setView] = useState<'today' | 'week' | 'log' | 'grades' | 'records'>('today')
  const narrow = useMediaQuery('(max-width:900px)') // Week: a list by day on a phone or portrait tablet, the grid when seven days fit
  const [work, setWork] = useState<ChoreDay | 'new' | null>(null)
  const [marking, setMarking] = useState<string | null>(null) // the day a grown-up is marking (no school, a half day)
  // Schoolwork is chores with a subject: the shown week's days, and today, each with what's done.
  const [days, setDays] = useState<Record<string, ChoreDay[]>>({})
  // Today's school day: each linked school calendar's events, the lunch, and the school and teachers.
  const [dayInfo, setDayInfo] = useState<{ events: Record<string, EventInstance[]>; lunch: string[]; contacts: Contact[]; school: SchoolDays }>({ events: {}, lunch: [], contacts: [], school: { days: [], left: [] } })
  const kidsKey = JSON.stringify(data?.kids.map(k => [k.calendarIds, k.schoolContactId, k.contactIds, k.mode, k.lastDay, k.schoolDays, k.yearStart]) ?? [])
  useEffect(() => {
    if (!data) return
    let canceled = false
    const cals = [...new Set(data.kids.flatMap(k => k.calendarIds))]
    // The shown week and today: Today's card and the Week grid both show the school calendar.
    const first = who.today < week.from ? who.today : week.from, last = who.today > week.to ? who.today : week.to
    const from = new Date(`${first}T00:00:00`), to = new Date(`${last}T23:59:59`)
    Promise.all([
      Promise.all(cals.map(c => api.getEvents(from.toISOString(), to.toISOString(), undefined, c).then(es => [c, es] as const).catch(() => [c, []] as const))),
      data.kids.some(k => k.mode === 'enrolled') && settings.features.meals ? api.getMeals(who.today, who.today).then(ms => ms.filter(m => m.slot === 'lunch').map(m => m.title)).catch(() => []) : Promise.resolve([]),
      data.kids.some(k => k.contactIds.length || k.schoolContactId) && settings.features.contacts !== false ? api.getContacts().catch(() => []) : Promise.resolve([]),
      api.getSchoolDays(first, last).catch(() => ({ days: [], left: [] })),
    ]).then(([events, lunch, contacts, school]) => { if (!canceled) setDayInfo({ events: Object.fromEntries(events), lunch, contacts, school }) })
    return () => { canceled = true }
  }, [kidsKey, who.today, week.from, week.to, refreshTick, tick]) // eslint-disable-line react-hooks/exhaustive-deps -- kidsKey stands for data.kids
  useEffect(() => {
    let canceled = false
    const dates = [...new Set([who.today, ...dayKeys(week.from)])]
    Promise.all([api.getSchoolSubjects(true), api.getSchoolKids(), api.getSchoolLogs({ from: week.from, to: week.to }), who.parent ? api.getSchoolLogs({ pending: true }) : Promise.resolve([])])
      .then(([subjects, kids, logs, waiting]) => { if (!canceled) { setData({ subjects, kids, logs, waiting }); setError(null) } })
      .then(() => Promise.all(dates.map(d => api.getChoresDay(d).then(cs => [d, cs.filter(c => c.schoolKind)] as const))))
      .then(all => { if (!canceled && all) setDays(Object.fromEntries(all)) })
      .catch(e => { if (!canceled) setError(e) })
    return () => { canceled = true }
  }, [week.from, week.to, who.parent, who.today, refreshTick, tick, retry])

  if (error && !data) return <div className="meals-view scroll-y"><LoadError what={t('school')} error={error} onRetry={() => setRetry(n => n + 1)} /></div>
  if (!data) return <div className="meals-view scroll-y" aria-busy="true" />
  const subject = (id: string | null) => data.subjects.find(s => s.id === id)
  const member = (id: string) => members.find(m => m.id === id)
  // A kid's school calendars' events on a day (one copy of an event both calendars have), and what kind of day it is.
  const kidEvents = (k: SchoolKid | undefined, d: string) => [...new Map((k?.calendarIds ?? []).flatMap(c => dayInfo.events[c] ?? []).filter(e => onDay(e, d, tz)).map(e => [e.id + (e.occurrenceStart ?? ''), e])).values()]
  const dayOf = (memberId: string, d: string) => dayInfo.school.days.find(x => x.memberId === memberId && x.date === d)
  const inSchool = data.kids.map(k => member(k.memberId)).filter((m): m is Member => !!m)
  const totals = kidTotals(data.logs)
  const byDay = groups(data.logs).reduce<[string, LogGroup[]][]>((out, g) => {
    const last = out[out.length - 1]
    if (last?.[0] === g.first.date) last[1].push(g); else out.push([g.first.date, [g]])
    return out
  }, [])
  const thisWeek = week.from <= who.today && who.today <= week.to

  const download = async () => {
    try {
      const all = await api.getSchoolLogs()
      const text = csv(all, l => (l.memberId ? member(l.memberId)?.name : null) ?? (l.formerMember ? t('{name} (removed)', { name: l.formerMember }) : t('Removed')), id => subject(id)?.name ?? '', [t('Date'), t('Kid'), t('Subject'), t('Minutes'), t('What you did'), t('Notes'), t('Waiting for approval')], [t('Yes'), t('No')])
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
      a.download = ['kinwall-school', who.today].join('-') + '.csv'
      a.click()
      setTimeout(() => URL.revokeObjectURL(a.href), 1000)
    } catch (e) { toast(err(e, t('Could not download the school time.')), true) }
  }
  const approve = async (g: LogGroup) => {
    try { await Promise.all(g.logs.filter(l => l.pending).map(l => api.approveSchoolLog(l.id))); changed(); toast(t('Approved')) } catch (e) { toast(err(e, t('Could not approve.')), true) }
  }
  const toggle = async (c: ChoreDay, date: string) => {
    try {
      if (c.completed || c.pending) await api.uncompleteChore(c.id, date)
      else { const r = await api.completeChore(c.id, date, c.memberId ?? undefined) as { pending?: boolean }; toast(r?.pending ? t('Done. A grown-up will check it.') : t('Done: {title}', { title: c.title })) }
      changed()
    } catch (e) { toast(err(e, t('Could not save.')), true) }
  }
  const remove = async (g: LogGroup) => {
    if (!(await dialog.confirm({ title: t('Delete “{title}”?', { title: entryTitle(g.first, subject(g.first.subjectId)) }), body: tn(g.logs.length, 'The time comes off this kid’s total.', 'The time comes off all {n} kids’ totals.'), confirmLabel: t('Delete'), danger: true }))) return
    try { await api.deleteSchoolLog(g.first.id, true); changed(); setEditing(null) } catch (e) { toast(err(e, t('Could not delete.')), true) }
  }

  return <div className="meals-view outings-view school-view scroll-y">
    <div className="meals-heading"><div><h1>{t('School')}</h1><p className="field-hint">{t('Each kid’s lessons and homework, and the time they spend learning.')}</p></div>
      <div className="meal-actions">
        {who.parent && <button className="btn btn-secondary" onClick={() => setSetup(true)}>{t('Set up')}</button>}
        {who.parent && inSchool.length > 0 && view !== 'log' && <button className="btn btn-secondary" onClick={() => setWork('new')}><PlusIcon /> {t('Add schoolwork')}</button>}
        {inSchool.length > 0 && <button className="btn btn-primary" onClick={() => setLogging(true)}><PlusIcon /> {t('Log time')}</button>}
      </div>
    </div>

    {!inSchool.length ? <div className="state-card">
      <p>{who.parent ? t('Pick which kids are in school, and whether they’re homeschooled or go to a school.') : t('A grown-up can pick which kids are in school.')}</p>
      {who.parent && <button className="btn btn-primary" onClick={() => setSetup(true)}>{t('Set up School')}</button>}
    </div> : <>
      <Segmented tabs idBase="school-tab" label={t('School views')} value={view} onChange={setView} options={[{ key: 'today', label: t('Today') }, { key: 'week', label: t('Week') }, { key: 'log', label: t('Time') }, ...(who.parent && data.kids.some(k => k.mode === 'enrolled') ? [{ key: 'grades' as const, label: t('Grades') }] : []), ...(who.parent ? [{ key: 'records' as const, label: t('Records') }] : [])]} />

      {who.parent && data.waiting.length > 0 && <section className="outing-section school-waiting" aria-labelledby="school-waiting">
        <h2 id="school-waiting">{t('Waiting for a grown-up')} <small>({data.waiting.length})</small></h2>
        <div className="outing-list">{groups(data.waiting).map(g => <div key={g.groupId} className="school-row">
          <LogRow g={g} subject={subject(g.first.subjectId)} members={members} withDay onOpen={() => setEditing(g)} />
          <button type="button" className="btn btn-secondary school-approve" onClick={() => void approve(g)}>{t('Approve')}</button>
        </div>)}</div>
      </section>}

      {view === 'today' && <div className="school-totals">{inSchool.map(m => {
        const k = data.kids.find(x => x.memberId === m.id)!
        const mine = (days[who.today] ?? []).filter(c => c.memberId === m.id)
        const logged = data.logs.filter(l => l.memberId === m.id && l.date === who.today && !l.pending).reduce((n, l) => n + l.minutes, 0)
        const today = dayOf(m.id, who.today)
        const half = today?.kind === 'half'
        const schoolDay = k.mode === 'enrolled' && (today ? today.kind === 'school' || half : k.schoolDays.includes(new Date(`${who.today}T12:00:00`).getDay()))
        const left = dayInfo.school.left.find(l => l.memberId === m.id)
        const events = kidEvents(k, who.today)
        const school = k.schoolContactId ? dayInfo.contacts.find(c => c.id === k.schoolContactId) : undefined
        const people = k.contactIds.filter(cid => cid !== k.schoolContactId).map(cid => dayInfo.contacts.find(c => c.id === cid)).filter((c): c is Contact => !!c)
        return <div key={m.id} className="school-total">
          <div className="school-total-head"><Face m={m} /><strong>{m.name}</strong><span className="field-hint">{modeLine(k)}</span><span className="school-total-time">{k.dailyGoalMinutes ? t('{time} of {goal}', { time: hoursMinutes(logged), goal: hoursMinutes(k.dailyGoalMinutes) }) : logged ? hoursMinutes(logged) : t('Nothing yet')}</span></div>
          {(today || left) && <DayNote day={today} left={left} />}
          {(schoolDay && (k.dayStart && k.dayEnd || k.toSchoolBy || k.fromSchoolBy) || events.length > 0 || (schoolDay && dayInfo.lunch.length > 0) || people.length > 0 || school || k.teacherName) && <ul className="school-day">
            {schoolDay && <Leg by={k.toSchoolBy} time={k.toSchoolTime} members={members} bus={time => t('Bus at {time}', { time })} grownUp={(name, time) => t('{name} drops off at {time}', { name, time })} />}
            {schoolDay && k.dayStart && (half ? k.halfDayEnd : k.dayEnd) && <li><span aria-hidden="true">🕗</span> {t('School {start} to {end}', { start: formatTime(k.dayStart), end: formatTime((half ? k.halfDayEnd : k.dayEnd)!) })}</li>}
            {schoolDay && (!half || k.halfFromSchoolTime) && <Leg by={k.fromSchoolBy} time={half ? k.halfFromSchoolTime : k.fromSchoolTime} members={members} bus={time => t('Bus home at {time}', { time })} grownUp={(name, time) => t('{name} picks up at {time}', { name, time })} />}
            {schoolDay && half && k.fromSchoolBy && !k.halfFromSchoolTime && <li><span aria-hidden="true">⚠️</span> {t('Early release: check the time home. Set it in Set up.')}</li>}
            {events.map(e => <li key={e.id + (e.occurrenceStart ?? '')}><span aria-hidden="true">📅</span> {e.title}</li>)}
            {schoolDay && dayInfo.lunch.map((l, i) => <li key={i}><span aria-hidden="true">🍽️</span> {t('Lunch: {meal}', { meal: l })}</li>)}
            {(school || k.teacherName) && <li><span aria-hidden="true">{k.teacherName ? '🧑‍🏫' : '🏫'}</span> {k.teacherName && school ? t('{teacher}, {school}', { teacher: k.teacherName, school: school.name }) : k.teacherName ? t('Teacher: {name}', { name: k.teacherName }) : school!.name}{school && <Phone c={school} />}</li>}
            {k.teacherName && (k.teacherEmail || k.teacherLink) && <li><span aria-hidden="true">💬</span> {t('Reach {name}:', { name: k.teacherName })}{' '}
              {k.teacherEmail && <a href={`mailto:${k.teacherEmail}`}>{k.teacherEmail}</a>}{k.teacherEmail && k.teacherLink && ' · '}
              {k.teacherLink && <a href={k.teacherLink} target="_blank" rel="noreferrer">{linkName(k.teacherLink)}</a>}</li>}
            {people.map(c => <li key={c.id}><span aria-hidden="true">📇</span> {c.name}<Phone c={c} /></li>)}
          </ul>}
          {mine.length ? <div className="school-today">{mine.map(c => <WorkRow key={c.id} c={c} subject={subject(c.schoolSubjectId ?? null)} onToggle={() => void toggle(c, who.today)} onEdit={who.parent ? () => setWork(c) : undefined} />)}</div>
            : <p className="field-hint">{today && (today.kind === 'off' || today.kind === 'summer') ? t('No school today.') : t('No schoolwork today.')}</p>}
        </div>
      })}</div>}
      {view === 'today' && who.parent && <p><button type="button" className="btn btn-secondary school-mark" onClick={() => setMarking(who.today)}>{t('Change today')}</button> <span className="field-hint">{t('A snow day, a make-up day or an early release the calendars don’t have.')}</span></p>}

      {view === 'records' && who.parent && <Records kids={data.kids} members={members} subjects={data.subjects} today={who.today} />}
      {view === 'grades' && who.parent && <Grades kids={data.kids.filter(k => k.mode === 'enrolled')} members={members} subjects={data.subjects} today={who.today} />}

      {(view === 'week' || view === 'log') && <div className="school-week" role="group" aria-label={t('Week')}>
        <button type="button" className="icon-btn" aria-label={t('Previous week')} onClick={() => setDay(addDayKeys(week.from, -7))}><ChevronLeft /></button>
        <strong>{thisWeek ? t('This week') : t('{from} to {to}', { from: shortDay(week.from), to: shortDay(week.to) })}</strong>
        <button type="button" className="icon-btn" aria-label={t('Next week')} disabled={thisWeek && view === 'log'} onClick={() => setDay(addDayKeys(week.from, 7))}><ChevronRight /></button>
        {!thisWeek && <button type="button" className="btn btn-secondary" onClick={() => setDay(who.today)}>{t('This week')}</button>}
      </div>}

      {view === 'week' && narrow && <div className="school-plan-list">{dayKeys(week.from).map(d => {
        const rows = inSchool.map(m => {
          const k = data.kids.find(x => x.memberId === m.id)
          const events = kidEvents(k, d)
          const work = (days[d] ?? []).filter(c => c.memberId === m.id)
          const day = dayOf(m.id, d)
          return { m, events, work, day }
        }).filter(r => r.events.length || r.work.length || noteworthy(r.day))
        return <section key={d} className={`school-plan-list-day ${d === who.today ? 'today' : ''}`} aria-labelledby={`school-wk-${d}`}>
          <div className="school-plan-list-head"><h2 id={`school-wk-${d}`}>{longDay(d)}{d === who.today && <small> · {t('Today')}</small>}</h2>{who.parent && <button type="button" className="btn btn-secondary school-mark" aria-label={t('Change {day}', { day: longDay(d) })} onClick={() => setMarking(d)}>{t('Change day')}</button>}</div>
          {!rows.length ? <p className="field-hint">{t('Nothing planned.')}</p> : rows.map(({ m, events, work, day }) => <div key={m.id} className="school-plan-list-kid">
            <span className="school-plan-kid"><Face m={m} /> {m.name}</span>
            {noteworthy(day) && <DayChip day={day!} />}
            {events.map(e => <span key={e.id + (e.occurrenceStart ?? '')} className="school-plan-event"><span aria-hidden="true">📅</span> {e.title}</span>)}
            {work.map(c => <WorkRow key={c.id} c={c} compact subject={subject(c.schoolSubjectId ?? null)} onToggle={() => void toggle(c, d)} onEdit={who.parent ? () => setWork(c) : undefined} />)}
          </div>)}
        </section>
      })}</div>}
      {view === 'week' && !narrow && <div className="school-plan-wrap"><div className="school-plan" style={{ gridTemplateColumns: `minmax(72px, auto) repeat(7, minmax(92px, 1fr))` }}>
        <span />
        {dayKeys(week.from).map(d => who.parent
          ? <button key={d} type="button" className={`school-plan-day ${d === who.today ? 'today' : ''}`} aria-label={t('Change {day}', { day: longDay(d) })} onClick={() => setMarking(d)}>{shortDay(d)}</button>
          : <strong key={d} className={`school-plan-day ${d === who.today ? 'today' : ''}`}>{shortDay(d)}</strong>)}
        {inSchool.map(m => <Fragment key={m.id}>
          <span className="school-plan-kid"><Face m={m} /> {m.name}</span>
          {dayKeys(week.from).map(d => <div key={d} className={`school-plan-cell ${d === who.today ? 'today' : ''}`}>
            {noteworthy(dayOf(m.id, d)) && <DayChip day={dayOf(m.id, d)!} />}
            {kidEvents(data.kids.find(k => k.memberId === m.id), d)
              .map(e => <span key={e.id + (e.occurrenceStart ?? '')} className="school-plan-event"><span aria-hidden="true">📅</span> {e.title}</span>)}
            {(days[d] ?? []).filter(c => c.memberId === m.id).map(c => <WorkRow key={c.id} c={c} compact subject={subject(c.schoolSubjectId ?? null)} onToggle={() => void toggle(c, d)} onEdit={who.parent ? () => setWork(c) : undefined} />)}
          </div>)}
        </Fragment>)}
      </div></div>}

      {view === 'log' && <><div className="school-totals">{inSchool.map(m => {
        const k = data.kids.find(x => x.memberId === m.id)!
        const total = totals.find(x => x.memberId === m.id)
        return <div key={m.id} className="school-total">
          <div className="school-total-head"><Face m={m} /><strong>{m.name}</strong><span className="field-hint">{modeLine(k)}</span><span className="school-total-time">{total ? hoursMinutes(total.total) : t('Nothing yet')}</span></div>
          {total && <>
            <div className="school-bar" aria-hidden="true">{total.bySubject.map(s => <i key={s.subjectId ?? 'none'} style={{ flexGrow: s.minutes, background: subject(s.subjectId)?.color ?? 'var(--text-dim)' }} />)}</div>
            <ul className="school-legend">{total.bySubject.map(s => { const x = subject(s.subjectId); return <li key={s.subjectId ?? 'none'}><span className="school-dot" style={{ background: x?.color ?? 'var(--text-dim)' }} aria-hidden="true" />{x ? `${x.emoji ?? ''} ${x.name}`.trim() : t('No subject')} <b>{hoursMinutes(s.minutes)}</b></li> })}</ul>
          </>}
        </div>
      })}</div>

      {!byDay.length && <p className="state-card">{t('No school time logged this week.')}</p>}
      {byDay.map(([d, gs]) => <section key={d} className="outing-section" aria-labelledby={`school-day-${d}`}>
        <h2 id={`school-day-${d}`}>{longDay(d)}</h2>
        <div className="outing-list">{gs.map(g => <LogRow key={g.groupId} g={g} subject={subject(g.first.subjectId)} members={members} onOpen={who.parent ? () => setEditing(g) : undefined} />)}</div>
      </section>)}

      {who.parent && <p><button type="button" className="btn btn-secondary school-download" onClick={() => void download()}>{t('Download all school time (CSV)')}</button></p>}
      </>}
    </>}

    {logging && <LogSheet kids={inSchool} subjects={data.subjects.filter(s => !s.archived)} onClose={() => setLogging(false)} />}
    {editing && <LogSheet kids={inSchool} subjects={data.subjects.filter(s => !s.archived || s.id === editing.first.subjectId)} editing={editing} onDelete={() => void remove(editing)} onClose={() => setEditing(null)} />}
    {work && <WorkSheet kids={inSchool} subjects={data.subjects.filter(s => !s.archived || (work !== 'new' && s.id === work.schoolSubjectId))} work={work === 'new' ? null : work} onClose={() => setWork(null)} />}
    {setup && <SetupSheet subjects={data.subjects} kids={data.kids} onClose={() => setSetup(false)} />}
    {marking && <MarkDaySheet date={marking} kids={inSchool} days={dayInfo.school.days.filter(x => x.date === marking)} onClose={() => setMarking(null)} />}
  </div>
}

const longDate = (d: string) => formatDate(new Date(`${d}T12:00:00`), { month: 'short', day: 'numeric', year: 'numeric' })
const monthName = (m: string) => formatDate(new Date(`${m}-15T12:00:00`), { month: 'long', year: 'numeric' })

/** Parents only: each kid's school year from what was logged: hours and days against their goals,
 * each subject against its goal, month by month, the photo portfolio and report card photos. Print
 * makes a year-end report of one kid (only the report prints, like Paint's picture). */
function Records({ kids, members, subjects, today }: { kids: SchoolKid[]; members: Member[]; subjects: SchoolSubject[]; today: string }) {
  const { toast, refreshTick } = useApp()
  const id = useId()
  const tick = useTick()
  const [year, setYear] = useState(schoolYearOf(today, kids[0]?.yearStart))
  const [records, setRecords] = useState<Record<string, SchoolRecords>>({})
  const [printing, setPrinting] = useState<string | null>(null)
  useEffect(() => {
    let canceled = false
    Promise.all(kids.map(k => api.getSchoolRecords(k.memberId, year).then(r => [k.memberId, r] as const)))
      .then(all => { if (!canceled) setRecords(Object.fromEntries(all)) })
      .catch(e => { if (!canceled) toast(err(e, t('Could not load records.')), true) })
    return () => { canceled = true }
  }, [year, tick, refreshTick, JSON.stringify(kids.map(k => [k.memberId, k.yearStart]))]) // eslint-disable-line react-hooks/exhaustive-deps -- toast is new each render
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(null)
    window.addEventListener('afterprint', done)
    const timer = setTimeout(() => window.print(), 300) // once the report's photos have a moment to load
    return () => { clearTimeout(timer); window.removeEventListener('afterprint', done) }
  }, [printing])
  const setCard = async (memberId: string, term: number, file: File | undefined | null) => {
    try {
      let photoId: string | null = null
      if (file) { const { blob, width, height } = await preparePhoto(file); photoId = (await api.uploadPhoto(blob, width, height, undefined, false)).id }
      await api.putSchoolReportCard({ memberId, year, term, photoId }); changed()
    } catch (e) { toast(err(e, t('Could not save the report card.')), true) }
  }
  const printed = printing ? kids.find(k => k.memberId === printing) : undefined
  return <div className="school-grades">
    <div className="field school-grades-year"><label htmlFor={`${id}-year`}>{t('School year')}</label>
      <PickField id={`${id}-year`} label={t('School year')} search value={[String(year)]} options={schoolYears(today).map(y => ({ value: String(y), label: yearLabel(y) }))} onChange={ys => { if (ys[0]) setYear(Number(ys[0])) }} /></div>
    <p className="field-hint">{t('Each kid’s school year starts on the day set for them in Set up. A day counts as a school day when there’s approved time logged for it.')}</p>
    {kids.map(k => {
      const kid = members.find(m => m.id === k.memberId), r = records[k.memberId]
      if (!kid || !r) return null
      return <section key={k.memberId} className="school-total">
        <div className="school-total-head"><Face m={kid} /><strong>{kid.name}</strong><span className="field-hint">{t('{from} to {to}', { from: longDate(r.from), to: longDate(r.to) })}</span>
          <button type="button" className="btn btn-secondary school-print-btn" onClick={() => setPrinting(k.memberId)}>{t('Print report')}</button></div>
        <RecordBody k={k} r={r} subjects={subjects} onCard={(term, file) => void setCard(k.memberId, term, file)} />
      </section>
    })}
    {printed && records[printed.memberId] && createPortal(<div className="school-print">
      <h1>{t('{name} · School year {year}', { name: members.find(m => m.id === printed.memberId)?.name ?? '', year: yearLabel(year) })}</h1>
      <p>{modeLine(printed)} · {t('{from} to {to}', { from: longDate(records[printed.memberId].from), to: longDate(records[printed.memberId].to) })}</p>
      <RecordBody k={printed} r={records[printed.memberId]} subjects={subjects} print />
    </div>, document.body)}
  </div>
}

/** One kid's year: the totals against goals, subjects, months, portfolio and report cards. `print`: no controls. */
function RecordBody({ k, r, subjects, print, onCard }: { k: SchoolKid; r: SchoolRecords; subjects: SchoolSubject[]; print?: boolean; onCard?: (term: number, file: File | null) => void }) {
  const subject = (sid: string | null) => subjects.find(x => x.id === sid)
  const meter = (label: string, value: string, have: number, goal: number | null | undefined, color?: string) => <div className="school-meter">
    <div className="school-meter-label"><span>{label}</span><b>{goal ? t('{have} of {goal}', { have: value, goal: label === t('Days') ? String(goal) : hoursMinutes(goal * 60) }) : value}</b></div>
    {goal ? <div className="school-meter-track" role="img" aria-label={t('{n}% of the goal', { n: Math.min(100, Math.round(have / goal * 100)) })}><i style={{ width: `${Math.min(100, have / goal * 100)}%`, background: color ?? 'var(--accent)' }} /></div> : null}
  </div>
  const subjectRows = [...r.bySubject, ...subjects.filter(sub => sub.goalHours && !sub.archived && !r.bySubject.some(b => b.subjectId === sub.id)).map(sub => ({ subjectId: sub.id, minutes: 0 }))]
  return <div className="school-record">
    <div className="school-record-totals">
      {meter(t('Hours'), hoursMinutes(r.minutes), r.minutes / 60, k.yearGoalHours)}
      {meter(t('Days'), String(r.days), r.days, k.yearGoalDays)}
    </div>
    {subjectRows.length > 0 && <div className="school-record-subjects">{subjectRows.map(b => { const sub = subject(b.subjectId)
      return <div key={b.subjectId ?? 'none'}>{meter(sub ? `${sub.emoji ?? ''} ${sub.name}`.trim() : t('No subject'), hoursMinutes(b.minutes), b.minutes / 60, sub?.goalHours, sub?.color)}</div> })}</div>}
    {r.byMonth.length > 0 && <table className="school-grades-table school-record-months">
      <thead><tr><th scope="col">{t('Month')}</th><th scope="col">{t('Days')}</th><th scope="col">{t('Time')}</th></tr></thead>
      <tbody>{r.byMonth.map(m => <tr key={m.month}><th scope="row">{monthName(m.month)}</th><td>{m.days}</td><td>{hoursMinutes(m.minutes)}</td></tr>)}</tbody>
    </table>}
    {!r.minutes && <p className="field-hint">{t('No school time logged this school year yet.')}</p>}
    {r.photos.length > 0 && <><h3>{t('Portfolio')}</h3>
      <div className="school-portfolio">{r.photos.map(p => <figure key={p.logId}><img src={api.photoImageUrlById(p.photoId)} alt={p.title ?? subject(p.subjectId)?.name ?? t('School time')} loading={print ? 'eager' : 'lazy'} />
        <figcaption>{p.title ?? subject(p.subjectId)?.name ?? ''} · {shortDay(p.date)}</figcaption></figure>)}</div></>}
    {k.mode === 'enrolled' && (!print || r.reportCards.length > 0) && <><h3>{t('Report cards')}</h3>
      <div className="school-portfolio">{Array.from({ length: k.terms }, (_, i) => i + 1).map(term => { const card = r.reportCards.find(c => c.term === term)
        if (print && !card) return null
        return <figure key={term}>{card ? <img src={api.photoImageUrlById(card.photoId)} alt={t('Term {n} report card', { n: term })} loading={print ? 'eager' : 'lazy'} /> : <div className="school-card-empty">{t('No photo yet')}</div>}
          <figcaption>{t('Term {n}', { n: term })}</figcaption>
          {!print && onCard && (card ? <button type="button" className="link-btn link-danger" onClick={() => onCard(term, null)}>{t('Remove photo')}</button>
            : <label className="btn btn-secondary school-card-add">{t('Add a photo')}<input type="file" accept="image/*" className="sr-only" onChange={e => { const f = e.target.files?.[0]; if (f) onCard(term, f) }} /></label>)}
        </figure> })}</div></>}
  </div>
}

/** One way to or from school on Today: "Bus at 7:35 AM", "Alex picks up at 3:05 PM". Nothing when it isn't set. */
function Leg({ by, time, members, bus, grownUp }: { by?: string | null; time?: string | null; members: Member[]; bus: (time: string) => string; grownUp: (name: string, time: string) => string }) {
  if (!by) return null
  const who = by === 'bus' ? null : members.find(m => m.id === by)
  if (by !== 'bus' && !who) return null
  const when = time ? formatTime(time) : t('a time not set')
  return <li><span aria-hidden="true">{by === 'bus' ? '🚌' : '🚗'}</span> {by === 'bus' ? bus(when) : grownUp(who!.name, when)}</li>
}

// ---- School days (server: school-days.ts) --------------------------------------------------------

/** A day worth a label: no school, a half day, summer, or the last day. Weekends and plain school days aren't. */
const noteworthy = (d?: SchoolDay) => !!d && (d.kind === 'off' || d.kind === 'half' || d.kind === 'summer' || d.last)
const DAY_EMOJI: Record<SchoolDayKind, string> = { school: '🎒', half: '⏰', off: '🏖️', weekend: '🛋️', summer: '☀️' }
const dayLabel = (d: SchoolDay) => d.last && (d.kind === 'school' || d.kind === 'half') ? t('Last day of school') : d.kind === 'half' ? t('Early release') : d.kind === 'off' ? t('No school') : d.kind === 'summer' ? t('Summer break') : d.kind === 'weekend' ? t('Not a school day') : t('School day')

/** A day's label in a Week cell: "🏖️ No school", "⏰ Early release". */
function DayChip({ day }: { day: SchoolDay }) {
  return <span className={`school-day-chip school-day-${day.kind}`} title={day.reason ?? undefined}><span aria-hidden="true">{day.last ? '🎉' : DAY_EMOJI[day.kind]}</span> {dayLabel(day)}</span>
}

/** Today's note on a kid's card: what kind of day it is (and why), and the school days left this year. */
function DayNote({ day, left }: { day?: SchoolDay; left?: { left: number } }) {
  const show = noteworthy(day)
  if (!show && !left) return null
  return <p className="school-day-note">
    {show && <DayChip day={day!} />}
    {show && day!.reason && <span className="field-hint"> {day!.reason}</span>}
    {show && day!.marked && <span className="field-hint"> {t('(marked by a grown-up)')}</span>}
    {left && day?.kind !== 'summer' && <span className="school-days-left">{tn(left.left, '{n} school day left', '{n} school days left')}</span>}
  </p>
}

/** A grown-up marks one day for each kid: a school day, early release or no school, over what the calendars say (a snow day). */
function MarkDaySheet({ date, kids, days, onClose }: { date: string; kids: Member[]; days: SchoolDay[]; onClose: () => void }) {
  const { toast } = useApp()
  const id = useId()
  const mark = async (m: Member, kind: string) => {
    try { await api.markSchoolDay(m.id, date, (kind || null) as 'school' | 'half' | 'off' | null); changed() } catch (e) { toast(err(e, t('Could not save.')), true) }
  }
  return <Sheet title={longDay(date)} onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>{t('Done')}</button>}>
    <p className="field-hint">{t('For a snow day, a make-up day or an early release the calendars don’t have.')}</p>
    {kids.map(m => {
      const d = days.find(x => x.memberId === m.id)
      return <div key={m.id} className="field"><label htmlFor={`${id}-${m.id}`}><ChipFace m={m} /> {m.name}</label>
        <select id={`${id}-${m.id}`} className="settings-select" value={d?.marked ? d.kind : ''} onChange={e => void mark(m, e.target.value)}>
          <option value="">{d && !d.marked ? t('As the calendars say: {kind}', { kind: dayLabel(d) }) : t('As the calendars say')}</option>
          <option value="school">{t('School day')}</option><option value="half">{t('Early release')}</option><option value="off">{t('No school')}</option>
        </select></div>
    })}
  </Sheet>
}

const RULE_KINDS = [{ key: 'off', label: msg('No school') }, { key: 'half', label: msg('Early release') }, { key: 'last', label: msg('Last day of school') }] as const
const LEAD_MINUTES = [5, 10, 15, 20, 30, 45, 60]
/** The family's day rules (settings.school): words in a school calendar's event that make it a day off, a half day or the last day; and reminder times. */
function DayRules() {
  const { settings, reloadCore, toast } = useApp()
  const id = useId()
  const school: SchoolSettings = settings.school ?? { rules: [], busMinutes: 10, pickupMinutes: 15 }
  const [words, setWords] = useState('')
  const [kind, setKind] = useState<SchoolDayRule['kind']>('off')
  const save = async (patch: Partial<SchoolSettings>) => {
    try { await api.updateSettings({ school: { ...school, ...patch } }); reloadCore() } catch (e) { toast(err(e, t('Could not save.')), true) }
  }
  const add = () => { const w = words.trim(); if (!w) return; void save({ rules: [...school.rules, { words: w, kind }] }); setWords('') }
  return <>
    <h3>{t('Days off and early release')}</h3>
    <p className="field-hint school-rules-hint">{t('An event on a kid’s school calendars with these words makes that day no school, early release or the last day of school. Schoolwork is skipped on days with no school, and so are bus and pickup reminders.')}</p>
    {RULE_KINDS.map(rk => <div key={rk.key} className="field"><label id={`${id}-${rk.key}`}>{tm(rk.label)}</label>
      <div className="chip-row" role="group" aria-labelledby={`${id}-${rk.key}`}>{school.rules.map((r, i) => r.kind === rk.key && <button key={i} type="button" className="chip school-rule" aria-label={t('Remove “{words}”', { words: r.words })} onClick={() => void save({ rules: school.rules.filter((_, j) => j !== i) })}>{r.words} <span aria-hidden="true">×</span></button>)}</div>
    </div>)}
    <form className="school-rule-add" onSubmit={e => { e.preventDefault(); add() }}>
      <div className="field"><label htmlFor={`${id}-words`}>{t('Add words')}</label>
        <input id={`${id}-words`} type="text" placeholder={t('Words, like Snow Day')} maxLength={60} value={words} onChange={e => setWords(e.target.value)} /></div>
      <div className="meal-form-row school-half-row">
        <div className="field"><label htmlFor={`${id}-means`}>{t('What they mean')}</label>
          <select id={`${id}-means`} className="settings-select" value={kind} onChange={e => setKind(e.target.value as SchoolDayRule['kind'])}>{RULE_KINDS.map(rk => <option key={rk.key} value={rk.key}>{tm(rk.label)}</option>)}</select></div>
        <div className="field"><button type="submit" className="btn btn-secondary" disabled={!words.trim()}><PlusIcon /> {t('Add')}</button></div>
      </div>
    </form>
    <h3>{t('Bus and pickup reminders')}</h3>
    <div className="meal-form-row school-half-row">
      <div className="field"><label htmlFor={`${id}-bus`}>{t('Before the bus')}</label>
        <select id={`${id}-bus`} className="settings-select" value={school.busMinutes ?? ''} onChange={e => void save({ busMinutes: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{t('No reminder')}</option>{LEAD_MINUTES.map(n => <option key={n} value={n}>{t('{n} min before', { n })}</option>)}</select></div>
      <div className="field"><label htmlFor={`${id}-pickup`}>{t('Before a drop-off or pickup')}</label>
        <select id={`${id}-pickup`} className="settings-select" value={school.pickupMinutes ?? ''} onChange={e => void save({ pickupMinutes: e.target.value ? Number(e.target.value) : null })}>
          <option value="">{t('No reminder')}</option>{LEAD_MINUTES.map(n => <option key={n} value={n}>{t('{n} min before', { n })}</option>)}</select></div>
    </div>
    <p className="field-hint">{t('Kids on the same bus at the same time get one reminder. The bus reminder goes to grown-ups and the kids’ own devices; a pickup goes to the grown-up doing it. On iPhone, the Kinwall app can show a countdown on the Lock Screen.')}</p>
  </>
}

/** A link's site, for its label: https://www.classdojo.com/… → classdojo.com. */
const linkName = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

/** A contact's first phone number, as a link to call it when it looks like one. */
function Phone({ c }: { c: Contact }) {
  const phone = c.phones[0]?.value
  if (!phone) return null
  const tel = phone.trim().replace(/[\s().-]/g, '')
  return <> · {/^\+?[0-9]{7,15}$/.test(tel) ? <a href={`tel:${tel}`}>{phone}</a> : phone}</>
}

const modeLine = (k: SchoolKid) => {
  const where = k.mode === 'home' ? t('Homeschool') : t('Goes to school')
  return k.grade ? t('{where} · {grade} grade', { where, grade: k.grade }) : where
}
/** One piece of schoolwork: its tick (any device), and on a parent's device a tap on the rest edits it. */
function WorkRow({ c, subject, compact, onToggle, onEdit }: { c: ChoreDay; subject: SchoolSubject | undefined; compact?: boolean; onToggle: () => void; onEdit?: () => void }) {
  const done = c.completed || !!c.pending
  // In a Week cell there's no room for a 44px tick beside the name: the whole row is one button.
  if (compact) return <button type="button" className={`school-work compact ${done ? 'done' : ''}`} style={{ ['--chip-color' as string]: subject?.color }}
    aria-haspopup={onEdit ? 'dialog' : undefined} aria-pressed={onEdit ? undefined : done} onClick={onEdit ?? onToggle}
    aria-label={onEdit ? t('Change {title}', { title: c.title }) : done ? t('Not done yet: {title}', { title: c.title }) : t('Mark done: {title}', { title: c.title })}>
    <span className="school-work-mark" aria-hidden="true">{done ? '✓' : subject?.emoji ?? c.emoji}</span><span className="school-work-title">{c.title}</span>
  </button>
  const label = <><span className="outing-emoji" aria-hidden="true">{subject?.emoji ?? c.emoji}</span>
    <span className="outing-row-main"><strong>{c.title}</strong>{!compact && <span className="outing-row-meta">{[subject?.name, kindLabel(c.schoolKind), c.schoolMinutes ? hoursMinutes(c.schoolMinutes) : null].filter(Boolean).join(' · ')}{c.pending && <> · <span className="school-pending">⏳ {t('Waiting for a grown-up')}</span></>}</span>}</span></>
  return <div className={`school-work ${done ? 'done' : ''} ${compact ? 'compact' : ''}`} style={{ ['--chip-color' as string]: subject?.color }}>
    <button type="button" className="school-work-check" aria-pressed={done} aria-label={done ? t('Not done yet: {title}', { title: c.title }) : t('Mark done: {title}', { title: c.title })} onClick={onToggle}>{done && '✓'}</button>
    {onEdit ? <button type="button" className="school-work-main" aria-haspopup="dialog" onClick={onEdit}>{label}</button> : <span className="school-work-main">{label}</span>}
  </div>
}

/** Opens the School editor from Chores, loading its subjects and kids only when needed. */
export function SchoolworkEditor({ work, onClose }: { work: ChoreDay; onClose: () => void }) {
  const { members } = useApp()
  const [data, setData] = useState<{ subjects: SchoolSubject[]; kids: SchoolKid[] } | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let canceled = false
    Promise.all([api.getSchoolSubjects(true), api.getSchoolKids()])
      .then(([subjects, kids]) => { if (!canceled) { setData({ subjects, kids }); setError(null) } })
      .catch(e => { if (!canceled) setError(e) })
    return () => { canceled = true }
  }, [retry])
  if (!data) return <Sheet title={t('Change schoolwork')} onClose={onClose}>
    {error ? <LoadError what={t('school')} error={error} onRetry={() => setRetry(n => n + 1)} /> : <div aria-busy="true" />}
  </Sheet>
  return <WorkSheet work={work} onClose={onClose} kids={members.filter(m => data.kids.some(k => k.memberId === m.id))}
    subjects={data.subjects.filter(s => !s.archived || s.id === work.schoolSubjectId)} />
}

/** Parents: add or change schoolwork (a chore with a subject). Its schedule, start time, timer and
 * approval are the chore sheet's own controls (ChoreScheduleFields), so schoolwork can repeat any way a
 * chore can; on top of that, its subject, kind, the school time it counts for and its points. */
function WorkSheet({ kids, subjects, work, onClose }: { kids: Member[]; subjects: SchoolSubject[]; work: ChoreDay | null; onClose: () => void }) {
  const { toast, settings } = useApp()
  const who = useWho()
  const dialog = useDialog()
  const id = useId()
  const [title, setTitle] = useState(work?.title ?? '')
  const [subjectId, setSubjectId] = useState<string | null>(work?.schoolSubjectId ?? subjects[0]?.id ?? null)
  const [kind, setKind] = useState<SchoolKind>(work?.schoolKind ?? 'lesson')
  const [picked, setPicked] = useState<string[]>(work ? [work.memberId].filter((x): x is string => !!x) : kids.length === 1 ? [kids[0].id] : [])
  const [minutes, setMinutes] = useState(work?.schoolMinutes ?? 30)
  const [points, setPoints] = useState(work?.points ?? 0)
  // The schedule, like ChoreEditSheet: untouched sends the stored rule back as-is (keeps custom rules).
  const [dueDate, setDueDate] = useState(work ? work.dueDate ?? '' : who.today)
  const [repeatGoal, setRepeatGoal] = useState<ChoreGoal | null>(work?.repeatGoal ?? null)
  const [sched, setSched] = useState<ScheduleForm>(() => work ? rruleToForm(work.rrule) : { ...rruleToForm(LESSON_DAYS), weekStart: settings.weekStart ?? 0 }) // a new lesson: school days
  const [schedTouched, setSchedTouched] = useState(false)
  const editSched = (patch: Partial<ScheduleForm>) => { setSched(f => ({ ...f, ...patch, custom: false })); setSchedTouched(true) }
  const [startTime, setStartTime] = useState(work?.dueTime && /^\d{2}:\d{2}$/.test(work.dueTime) ? work.dueTime : '')
  const [timerMinutes, setTimerMinutes] = useState<number | null>(work?.timerMinutes ?? null)
  const [needsApproval, setNeedsApproval] = useState<boolean | null>(work?.needsApproval ?? null)
  const [daysOff, setDaysOff] = useState(!!work?.schoolDaysOff)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const subject = subjects.find(s => s.id === subjectId)
  const scheduleValid = validSchedule(sched, dueDate) && (!repeatGoal || !!dueDate && validGoal(repeatGoal))
  const chooseKind = (k: SchoolKind) => {
    setKind(k)
    // A new one: lessons repeat on school days, homework, tests and projects are due once.
    if (!work && !schedTouched) setSched(f => ({ ...rruleToForm(k === 'lesson' ? LESSON_DAYS : null), weekStart: f.weekStart, days: k === 'lesson' ? f.days : [new Date(`${dueDate || who.today}T12:00:00`).getDay()] }))
  }
  const save = async () => {
    if (!title.trim()) { setError(t('Give it a name, like “Math lesson”.')); return }
    if (!subjectId) { setError(t('Pick a subject.')); return }
    if (!work && !picked.length) { setError(t('Pick who it’s for.')); return }
    if (!scheduleValid) { setError(t('Check when it’s due.')); return }
    setBusy(true); setError('')
    const schedule = scheduleBody({ rrule: work ? work.rrule : LESSON_DAYS, dueDate: work?.dueDate ?? who.today }, sched, schedTouched || !work, dueDate)
    const body = { title: title.trim(), emoji: subject?.emoji ?? '🎒', schoolSubjectId: subjectId, schoolKind: kind, schoolMinutes: minutes, schoolDaysOff: daysOff, points, ...schedule, repeatGoal, dueTime: startTime || null, timerMinutes, needsApproval }
    try {
      if (work) await api.updateChore(work.id, body)
      else await api.createChore({ ...body, memberIds: picked })
      changed(); onClose(); toast(t('Saved: {title}', { title: body.title }))
    } catch (e) { setError(err(e, t('Could not save.'))) } finally { setBusy(false) }
  }
  const remove = async () => {
    if (!work || !(await dialog.confirm({ title: t('Delete “{title}”?', { title: work.title }), body: t('It comes off every kid’s schoolwork. Time already logged for it stays.'), confirmLabel: t('Delete'), danger: true }))) return
    try { await api.deleteChore(work.id); changed(); onClose() } catch (e) { toast(err(e, t('Could not delete.')), true) }
  }
  return <Sheet title={work ? t('Change schoolwork') : t('Add schoolwork')} onClose={() => { if (!busy) onClose() }} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" type="submit" form={id} disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
  </>}>
    <form id={id} onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="field"><label htmlFor={`${id}-title`}>{t('What')}</label><input id={`${id}-title`} type="text" maxLength={200} placeholder={t('Math lesson, spelling test…')} value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div className="field"><label id={`${id}-subject`}>{t('Subject')}</label>
          <div className="chip-row" role="group" aria-labelledby={`${id}-subject`}>{subjects.map(s => <button key={s.id} type="button" className={`chip ${subjectId === s.id ? 'active' : ''}`} aria-pressed={subjectId === s.id} style={{ ['--chip-color' as string]: s.color }} onClick={() => setSubjectId(s.id)}>{s.emoji} {s.name}</button>)}</div>
        </div>
        <div className="field"><label htmlFor={`${id}-kind`}>{t('Kind')}</label>
          <select id={`${id}-kind`} className="settings-select" value={kind} onChange={e => chooseKind(e.target.value as SchoolKind)}>{KINDS.map(k => <option key={k.key} value={k.key}>{tm(k.label)}</option>)}</select></div>
        {!work && <div className="field"><label id={`${id}-who`}>{t('Who it’s for')}</label>
          <div className="chip-row" role="group" aria-labelledby={`${id}-who`}>{kids.map(m => <button key={m.id} type="button" className={`chip ${picked.includes(m.id) ? 'active' : ''}`} aria-pressed={picked.includes(m.id)} style={{ ['--chip-color' as string]: m.color }} onClick={() => setPicked(picked.includes(m.id) ? picked.filter(x => x !== m.id) : [...picked, m.id])}><ChipFace m={m} /> {m.name}</button>)}</div>
        </div>}
        {work?.groupId && <p className="field-hint">{t('Changes apply to every kid who has it.')}</p>}
        <ChoreScheduleFields value={sched} goal={repeatGoal} onGoal={setRepeatGoal} start={dueDate} today={who.today} onChange={editSched} onStart={setDueDate} />
        <label className="school-check"><input type="checkbox" checked={daysOff} onChange={e => setDaysOff(e.target.checked)} /> {t('Still due on days off')}</label>
        <p className="field-hint">{t('Otherwise it’s skipped on a day with no school, like a holiday or summer break.')}</p>
        <div className="field"><label id={`${id}-min`}>{t('School time it counts for, in minutes')}</label>
          <div className="suggest-stepper school-stepper" role="group" aria-labelledby={`${id}-min`}>
            <button type="button" className="icon-btn" aria-label={t('5 minutes less')} disabled={minutes <= 5} onClick={() => setMinutes(Math.max(5, minutes - 5))}><MinusIcon width={20} height={20} /></button>
            <input className="stepper-value" type="text" inputMode="numeric" aria-label={t('Minutes')} value={minutes} onChange={e => setMinutes(Math.min(1440, Number(e.target.value.replace(/\D/g, '')) || 0))} />
            <button type="button" className="icon-btn" aria-label={t('5 minutes more')} disabled={minutes >= 1440} onClick={() => setMinutes(Math.min(1440, minutes + 5))}><PlusIcon width={20} height={20} /></button>
          </div>
          <p className="field-hint">{t('Finishing it logs this much time under its subject.')}</p>
        </div>
        <div className="field"><label id={`${id}-pts`}>{t('Points')}</label><PointsStepper label={t('Points')} value={points} max={100} onChange={setPoints} /><p className="field-hint">{t('Optional. With points, finishing it counts toward rewards like a chore.')}</p></div>
        <details className="settings-disclosure" open={!!work && !!(startTime || timerMinutes || needsApproval !== null) || undefined}>
          <summary>{t('More options')}</summary>
          <div className="field">
            <label htmlFor={`${id}-start`}>{t('Start time (optional)')}</label>
            <div className="timer-custom-row">
              <input id={`${id}-start`} type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
              {startTime && <button type="button" className="btn btn-secondary" onClick={() => setStartTime('')}>{t('No start time')}</button>}
            </div>
            <p className="field-hint">{t("When it should start, every day it's due. It shows on Today on the Board.")}</p>
          </div>
          <div className="field">
            <label htmlFor={`${id}-timer`}>{t('Timer (optional)')}</label>
            <select id={`${id}-timer`} value={timerMinutes ?? ''} onChange={e => setTimerMinutes(e.target.value ? Number(e.target.value) : null)}>
              <option value="">{t('None')}</option>
              {[...new Set([5, 10, 15, 20, 25, 30, 45, 60, 90, 120, ...(timerMinutes ? [timerMinutes] : [])])].sort((a, b) => a - b).map(m => <option key={m} value={m}>{durationLabel(m)}</option>)}
            </select>
            <p className="field-hint">{t('Tap the chore to start a timer this long. When it rings, it offers to mark the chore done.')}</p>
          </div>
          <div className="field">
            <label htmlFor={`${id}-approval`}>{t("Needs a parent's OK")}</label>
            <select id={`${id}-approval`} value={needsApproval === null ? 'default' : needsApproval ? 'yes' : 'no'} onChange={e => setNeedsApproval(e.target.value === 'default' ? null : e.target.value === 'yes')}>
              <option value="default">{t('Default')}</option><option value="yes">{t('Yes')}</option><option value="no">{t('No')}</option>
            </select>
            <p className="field-hint">{t("Ticks from wall screens and kids' devices wait for a parent to approve before the points count.")}</p>
          </div>
        </details>
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
      {work && <div className="sheet-danger-zone"><button type="button" className="link-btn link-danger" disabled={busy} onClick={() => void remove()}>{t('Delete schoolwork')}</button></div>}
    </form>
  </Sheet>
}

/** A school year's name from its first calendar year: 2026 → 2026–27. */
const yearLabel = (y: number) => `${y}–${String((y + 1) % 100).padStart(2, '0')}`

/** Parents only: each kid's report card grades, one row per subject and a column per term. Free
 * text, saved as you leave a box. A term can go on Newscast, only if a parent chooses to. */
function Grades({ kids, members, subjects, today }: { kids: SchoolKid[]; members: Member[]; subjects: SchoolSubject[]; today: string }) {
  const { toast, refreshTick } = useApp()
  const id = useId()
  const [year, setYear] = useState(schoolYearOf(today, kids[0]?.yearStart))
  const [grades, setGrades] = useState<Record<string, SchoolGrade[]>>({})
  const [sharing, setSharing] = useState<{ kid: Member; term: number; text: string } | null>(null)
  const tick = useTick()
  useEffect(() => {
    let canceled = false
    Promise.all(kids.map(k => api.getSchoolGrades(k.memberId, year).then(g => [k.memberId, g] as const)))
      .then(all => { if (!canceled) setGrades(Object.fromEntries(all)) })
      .catch(e => { if (!canceled) toast(err(e, t('Could not load grades.')), true) })
    return () => { canceled = true }
  }, [year, tick, refreshTick, JSON.stringify(kids.map(k => [k.memberId, k.yearStart]))]) // eslint-disable-line react-hooks/exhaustive-deps -- toast is new each render
  const save = async (memberId: string, term: number, subjectId: string, grade: string) => {
    try { await api.putSchoolGrade({ memberId, year, term, subjectId, grade: grade.trim() }); changed() } catch (e) { toast(err(e, t('Could not save.')), true) }
  }
  return <div className="school-grades">
    <div className="field school-grades-year"><label htmlFor={`${id}-year`}>{t('School year')}</label>
      <PickField id={`${id}-year`} label={t('School year')} search value={[String(year)]} options={schoolYears(today).map(y => ({ value: String(y), label: yearLabel(y) }))} onChange={ys => { if (ys[0]) setYear(Number(ys[0])) }} /></div>
    <p className="field-hint">{t('Only grown-ups see grades. They never show on a wall screen or a kid’s device.')}</p>
    {kids.map(k => {
      const kid = members.find(m => m.id === k.memberId)
      if (!kid) return null
      const mine = grades[k.memberId] ?? []
      const rows = subjects.filter(sub => !sub.archived || mine.some(g => g.subjectId === sub.id))
      const terms = Array.from({ length: k.terms }, (_, i) => i + 1)
      const shareText = (term: number) => {
        const list = mine.filter(g => g.term === term).map(g => `${subjects.find(x => x.id === g.subjectId)?.name ?? ''} ${g.grade}`).join(', ')
        return t('{name}’s report card, term {n}: {grades}', { name: kid.name, n: term, grades: list })
      }
      return <section key={k.memberId} className="school-total">
        <div className="school-total-head"><Face m={kid} /><strong>{kid.name}</strong><span className="field-hint">{modeLine(k)}</span></div>
        <div className="school-grades-wrap"><table className="school-grades-table">
          <thead><tr><th scope="col">{t('Subject')}</th>{terms.map(n => <th key={n} scope="col">{t('Term {n}', { n })}</th>)}</tr></thead>
          <tbody>{rows.map(sub => <tr key={sub.id}>
            <th scope="row"><span aria-hidden="true">{sub.emoji}</span> {sub.name}</th>
            {terms.map(n => { const g = mine.find(x => x.term === n && x.subjectId === sub.id)
              return <td key={`${n}-${g?.grade ?? ''}`}><input type="text" maxLength={20} aria-label={t('{subject}, term {n}', { subject: sub.name, n })} defaultValue={g?.grade ?? ''}
                onBlur={e => { if (e.target.value.trim() !== (g?.grade ?? '')) void save(k.memberId, n, sub.id, e.target.value) }} /></td> })}
          </tr>)}</tbody>
        </table></div>
        <div className="chip-row">{terms.filter(n => mine.some(g => g.term === n)).map(n => <button key={n} type="button" className="btn btn-secondary school-share" onClick={() => setSharing({ kid, term: n, text: shareText(n) })}>{t('Share term {n} on Newscast…', { n })}</button>)}</div>
      </section>
    })}
    {sharing && <ShareSheet kid={sharing.kid} text={sharing.text} onClose={() => setSharing(null)} />}
  </div>
}

/** A parent chooses to share a report card on Newscast: they can change the words, and pick who sees it. */
function ShareSheet({ kid, text: start, onClose }: { kid: Member; text: string; onClose: () => void }) {
  const { toast, members, meMemberId } = useApp()
  const id = useId()
  // A person's own device posts as them; any other parent device says which grown-up is posting (like Newscast).
  const grownUps = members.filter(m => m.grownUp)
  const [poster, setPoster] = useState(grownUps[0]?.id ?? '')
  const [text, setText] = useState(start.slice(0, 280))
  const [audience, setAudience] = useState<'grownups' | 'everyone'>('grownups')
  const [busy, setBusy] = useState(false)
  const post = async () => {
    setBusy(true)
    try { await api.postNewscast({ text: text.trim(), emoji: '🎓', audience, ...(meMemberId ? {} : { memberId: poster }) }); onClose(); toast(t('Shared on Newscast')) } catch (e) { toast(err(e, t('Could not share it.')), true) } finally { setBusy(false) }
  }
  return <Sheet title={t('Share {name}’s report card', { name: kid.name })} onClose={() => { if (!busy) onClose() }} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" type="submit" form={id} disabled={busy || !text.trim() || (!meMemberId && !poster)}>{busy ? t('Sharing…') : t('Share')}</button>
  </>}>
    <form id={id} onSubmit={e => { e.preventDefault(); void post() }}>
      <div className="field"><label htmlFor={`${id}-text`}>{t('Post')}</label><textarea id={`${id}-text`} maxLength={280} value={text} onChange={e => setText(e.target.value)} /></div>
      {!meMemberId && <div className="field"><label htmlFor={`${id}-poster`}>{t('Posting as')}</label>
        <select id={`${id}-poster`} className="settings-select" value={poster} onChange={e => setPoster(e.target.value)}>{grownUps.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>}
      <div className="field"><label htmlFor={`${id}-who`}>{t('Who sees it')}</label>
        <select id={`${id}-who`} className="settings-select" value={audience} onChange={e => setAudience(e.target.value as 'grownups' | 'everyone')}><option value="grownups">{t('Grown-ups')}</option><option value="everyone">{t('Everyone, on every screen')}</option></select></div>
      <p className="field-hint">{t('This is the only way a grade leaves this screen.')}</p>
    </form>
  </Sheet>
}

const entryTitle = (l: SchoolLog, s: SchoolSubject | undefined) => l.title || s?.name || t('School time')

function LogRow({ g, subject, members, withDay, onOpen }: { g: LogGroup; subject: SchoolSubject | undefined; members: Member[]; withDay?: boolean; onOpen?: () => void }) {
  const kids = g.memberIds.map(id => members.find(m => m.id === id)).filter((m): m is Member => !!m)
  const names = [...kids.map(m => m.name), ...g.removed.map(name => t('{name} (removed)', { name }))].join(', ')
  const meta = [withDay ? shortDay(g.first.date) : null, g.first.title && subject ? subject.name : null, names, hoursMinutes(g.first.minutes)].filter(Boolean).join(' · ')
  const inner = <>
    <span className="outing-emoji" aria-hidden="true">{subject?.emoji ?? '🎒'}</span>
    <span className="outing-row-main">
      <strong>{entryTitle(g.first, subject)}</strong>
      <span className="outing-row-meta">{meta}{g.pending && <> · <span className="school-pending">⏳ {t('Waiting for a grown-up')}</span></>}</span>
      {g.first.notes && <span className="outing-row-meta">{g.first.notes}</span>}
    </span>
    <span className="outing-faces" aria-hidden="true">{kids.map(m => <Face key={m.id} m={m} />)}</span>
  </>
  return onOpen
    ? <button type="button" className="outing-row" aria-haspopup="dialog" onClick={onOpen}>{inner}<ChevronRight /></button>
    : <div className="outing-row">{inner}</div>
}

/** Log time (or, with `editing`, change a log for every kid on it): subject, kids, minutes, day, what and notes. */
function LogSheet({ kids, subjects, editing, onDelete, onClose }: { kids: Member[]; subjects: SchoolSubject[]; editing?: LogGroup; onDelete?: () => void; onClose: () => void }) {
  const { toast } = useApp()
  const who = useWho()
  const id = useId()
  const first = editing?.first
  const [subjectId, setSubjectId] = useState<string | null>(first?.subjectId ?? null)
  const [picked, setPicked] = useState<string[]>(editing?.memberIds ?? (who.kidId ? [who.kidId] : kids.length === 1 ? [kids[0].id] : []))
  const [minutes, setMinutes] = useState(first?.minutes ?? 30)
  const [date, setDate] = useState(first?.date ?? who.today)
  const [title, setTitle] = useState(first?.title ?? '')
  const [notes, setNotes] = useState(first?.notes ?? '')
  const [photoId, setPhotoId] = useState<string | null>(first?.photoId ?? null)
  const [uploading, setUploading] = useState(false)
  const addPhoto = async (file: File | undefined) => {
    if (!file) return
    setUploading(true); setError('')
    try { const { blob, width, height } = await preparePhoto(file); setPhotoId((await api.uploadPhoto(blob, width, height, undefined, false)).id) } catch (e) { setError(err(e, t('Could not add the photo.'))) } finally { setUploading(false) }
  }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const shown = who.kidId ? kids.filter(k => k.id === who.kidId) : kids
  const save = async () => {
    if (!picked.length) { setError(t('Pick who took part.')); return }
    if (!minutes) { setError(t('Say how long, in minutes.')); return }
    setBusy(true); setError('')
    try {
      const body = { subjectId, date, minutes, title: title.trim() || null, notes: notes.trim() || null, photoId }
      if (editing) { await api.updateSchoolLog(editing.first.id, body, true); changed(); onClose(); toast(t('Saved')); return }
      const { logs } = await api.logSchool({ ...body, memberIds: picked })
      changed(); onClose()
      toast(logs.some(l => l.pending) ? t('Logged. A grown-up will check it.') : tn(logs.length, 'Logged {time} for {name}', 'Logged {time} for {n} kids', { time: hoursMinutes(minutes), name: kids.find(k => k.id === picked[0])?.name ?? '' }))
    } catch (e) { setError(err(e, t('Could not save.'))) } finally { setBusy(false) }
  }
  return <Sheet title={editing ? t('Change school time') : t('Log school time')} onClose={() => { if (!busy) onClose() }} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" type="submit" form={id} disabled={busy || uploading}>{busy ? t('Saving…') : t('Save')}</button>
  </>}>
    <form id={id} onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="field"><label id={`${id}-subject`}>{t('Subject')}</label>
          <div className="chip-row" role="group" aria-labelledby={`${id}-subject`}>{subjects.map(s => <button key={s.id} type="button" className={`chip ${subjectId === s.id ? 'active' : ''}`} aria-pressed={subjectId === s.id} style={{ ['--chip-color' as string]: s.color }} onClick={() => setSubjectId(subjectId === s.id ? null : s.id)}>{s.emoji} {s.name}</button>)}</div>
        </div>
        {!editing && <div className="field"><label id={`${id}-who`}>{t('Who took part')}</label>
          <div className="chip-row" role="group" aria-labelledby={`${id}-who`}>{shown.map(m => <button key={m.id} type="button" className={`chip ${picked.includes(m.id) ? 'active' : ''}`} aria-pressed={picked.includes(m.id)} style={{ ['--chip-color' as string]: m.color }} disabled={!!who.kidId}
            onClick={() => setPicked(picked.includes(m.id) ? picked.filter(x => x !== m.id) : [...picked, m.id])}><ChipFace m={m} /> {m.name}</button>)}</div>
        </div>}
        {editing && editing.logs.length > 1 && <p className="field-hint">{t('Changes apply to everyone on this entry.')}</p>}
        <div className="meal-form-row">
          <div className="field"><label id={`${id}-min`}>{t('Minutes')}</label>
            <div className="suggest-stepper school-stepper" role="group" aria-labelledby={`${id}-min`}>
              <button type="button" className="icon-btn" aria-label={t('5 minutes less')} disabled={minutes <= 5} onClick={() => setMinutes(Math.max(5, minutes - 5))}><MinusIcon width={20} height={20} /></button>
              <input className="stepper-value" type="text" inputMode="numeric" aria-label={t('Minutes')} value={minutes} onChange={e => setMinutes(Math.min(1440, Number(e.target.value.replace(/\D/g, '')) || 0))} />
              <button type="button" className="icon-btn" aria-label={t('5 minutes more')} disabled={minutes >= 1440} onClick={() => setMinutes(Math.min(1440, minutes + 5))}><PlusIcon width={20} height={20} /></button>
            </div>
          </div>
          <div className="field"><label htmlFor={`${id}-day`}>{t('When')}</label><input id={`${id}-day`} type="date" required max={who.today} value={date} onChange={e => setDate(e.target.value || who.today)} /></div>
        </div>
        <div className="field"><label htmlFor={`${id}-title`}>{t('What you did (optional)')}</label><input id={`${id}-title`} type="text" maxLength={200} placeholder={t('Fractions with pizza slices')} value={title} onChange={e => setTitle(e.target.value)} /></div>
        <div className="field"><label htmlFor={`${id}-notes`}>{t('Notes (optional)')}</label><textarea id={`${id}-notes`} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></div>
        <div className="field"><label htmlFor={`${id}-photo`}>{t('Photo (optional)')}</label>
          {photoId ? <div className="school-photo-pick"><img src={api.photoImageUrlById(photoId)} alt={t('The photo for this school time')} /><button type="button" className="btn btn-secondary" onClick={() => setPhotoId(null)}>{t('Remove photo')}</button></div>
            : <label className="btn btn-secondary school-card-add" aria-disabled={uploading || undefined}>{uploading ? t('Adding the photo…') : t('Add a photo')}<input id={`${id}-photo`} type="file" accept="image/*" className="sr-only" disabled={uploading} onChange={e => void addPhoto(e.target.files?.[0])} /></label>}
          <p className="field-hint">{t('It goes in the portfolio in Records. It stays out of the family photos.')}</p>
        </div>
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
      {editing && onDelete && <div className="sheet-danger-zone"><button type="button" className="link-btn link-danger" disabled={busy} onClick={onDelete}>{t('Delete school time')}</button></div>}
    </form>
  </Sheet>
}

/** Parents: which kids are in school (homeschooled or at a school, grade, check what they log) and the subjects. */
function SetupSheet({ subjects, kids, onClose }: { subjects: SchoolSubject[]; kids: SchoolKid[]; onClose: () => void }) {
  const { members, toast } = useApp()
  const dialog = useDialog()
  const id = useId()
  const [newName, setNewName] = useState('')
  const children = members.filter(m => !m.grownUp)
  // Each kid's settings fold away; with one kid it starts open.
  const [open, setOpen] = useState<Set<string>>(() => new Set(children.length === 1 ? [children[0].id] : []))
  const { settings } = useApp()
  const weekOrder = Array.from({ length: 7 }, (_, i) => (i + (settings.weekStart ?? 0)) % 7)
  const [calendars, setCalendars] = useState<CalendarEntry[]>([])
  const [contacts, setContacts] = useState<Contact[]>([])
  useEffect(() => {
    api.getCalendars().then(setCalendars).catch(() => { /* none to offer */ })
    api.getContacts().then(cs => setContacts([...cs].sort((a, b) => a.name.localeCompare(b.name)))).catch(() => { /* none to offer */ })
  }, [])
  const run = async (p: Promise<unknown>) => { try { await p; changed() } catch (e) { toast(err(e, t('Could not save.')), true) } }
  // A new contact made from the school or other-contacts picker (Contacts' own form), picked for that kid once saved.
  const [newContact, setNewContact] = useState<{ m: Member; k: SchoolKid; role: 'school' | 'other'; name: string } | null>(null)
  const [categories, setCategories] = useState<ContactCategory[]>([])
  useEffect(() => { if (newContact && !categories.length) api.getContactCategories().then(setCategories).catch(() => { /* none to offer */ }) }, [newContact, categories.length])
  const contactSaved = (c: Contact) => {
    if (!newContact) return
    const { m, k, role } = newContact
    setContacts(cs => [...cs.filter(x => x.id !== c.id), c].sort((a, b) => a.name.localeCompare(b.name)))
    void run(api.putSchoolKid(m.id, role === 'school' ? { mode: k.mode, schoolContactId: c.id } : { mode: k.mode, contactIds: [...k.contactIds, c.id] }))
    setNewContact(null)
  }
  // Fewer report cards a year hides the later terms: say so first when one has grades or a photo saved.
  const setTerms = async (m: Member, k: SchoolKid, terms: number) => {
    if (terms < k.terms) {
      const { highestTerm } = await api.getSchoolTermsUsed(m.id).catch(() => ({ highestTerm: 0 }))
      if (highestTerm > terms && !(await dialog.confirm({
        title: tn(terms, 'Show {n} report card a year?', 'Show {n} report cards a year?'),
        body: highestTerm === terms + 1
          ? t('{name} has grades or report card photos saved for term {n}. They’ll be kept but hidden, and come back if you change this back.', { name: m.name, n: highestTerm })
          : t('{name} has grades or report card photos saved for terms {from} to {to}. They’ll be kept but hidden, and come back if you change this back.', { name: m.name, from: terms + 1, to: highestTerm }),
        confirmLabel: t('Hide them'),
      }))) return
    }
    await run(api.putSchoolKid(m.id, { mode: k.mode, terms }))
  }
  // Other kids at the same school (the same school contact): they share its schedule (routes/school.ts shareSchool).
  const sameSchool = (k: SchoolKid) => k.schoolContactId ? kids.filter(x => x.memberId !== k.memberId && x.mode === 'enrolled' && x.schoolContactId === k.schoolContactId) : []
  const setMode = (m: Member, value: SchoolMode | '') => run(value ? api.putSchoolKid(m.id, { mode: value }) : api.deleteSchoolKid(m.id))
  const addSubject = async () => {
    const name = newName.trim()
    if (!name) return
    await run(api.createSchoolSubject({ name, color: COLORS[subjects.length % COLORS.length] }))
    setNewName('')
  }
  const subjectAction = async (s: SchoolSubject, action: string) => {
    if (action === 'archive') await run(api.updateSchoolSubject(s.id, { archived: true }))
    if (action === 'delete' && await dialog.confirm({ title: t('Delete “{title}”?', { title: s.name }), body: t('Time logged under it stays, with no subject. To keep its name on that time, put it away instead.'), confirmLabel: t('Delete'), danger: true })) await run(api.deleteSchoolSubject(s.id))
  }
  const active = subjects.filter(s => !s.archived), away = subjects.filter(s => s.archived)
  return <><Sheet title={t('Set up School')} onClose={onClose} actions={<button className="btn btn-primary" onClick={onClose}>{t('Done')}</button>}>
    <h3>{t('Kids')}</h3>
    {!children.length && <p className="field-hint">{t('Add your kids in Family first.')}</p>}
    <div className="school-setup-kids">{children.map(m => {
      const k = kids.find(x => x.memberId === m.id)
      const isOpen = open.has(m.id)
      const school = k?.schoolContactId ? contacts.find(c => c.id === k.schoolContactId)?.name : undefined
      return <div key={m.id} className={`school-setup-kid ${isOpen ? 'open' : ''}`}>
        <button type="button" className="school-kid-toggle" aria-expanded={isOpen} aria-controls={`${id}-${m.id}-body`} onClick={() => setOpen(o => { const n = new Set(o); if (n.has(m.id)) n.delete(m.id); else n.add(m.id); return n })}>
          <Face m={m} /><span className="school-kid-name"><strong>{m.name}</strong><span className="field-hint">{!k ? t('Not in school') : school ? t('{line} · {school}', { line: modeLine(k), school }) : modeLine(k)}</span></span>
          <ChevronDown className="settings-acc-chevron" width={18} height={18} aria-hidden="true" />
        </button>
        {isOpen && <div id={`${id}-${m.id}-body`} className="school-setup-kid-body">
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-${m.id}-mode`}>{t('School')}</label>
            <select id={`${id}-${m.id}-mode`} className="settings-select" value={k?.mode ?? ''} onChange={e => void setMode(m, e.target.value as SchoolMode | '')}>
              <option value="">{t('Not in school')}</option><option value="home">{t('Homeschooled')}</option><option value="enrolled">{t('Goes to a school')}</option>
            </select></div>
          {k && <div className="field"><label htmlFor={`${id}-${m.id}-grade`}>{t('Grade')}</label>
            <input id={`${id}-${m.id}-grade`} type="text" maxLength={30} placeholder={t('3rd')} defaultValue={k.grade ?? ''} onBlur={e => { if ((e.target.value.trim() || null) !== k.grade) void run(api.putSchoolKid(m.id, { mode: k.mode, grade: e.target.value.trim() || null })) }} /></div>}
        </div>
        {k && <div className="field"><label htmlFor={`${id}-${m.id}-school`}>{t('Which school')}</label>
            <PickField id={`${id}-${m.id}-school`} label={t('Which school')} search value={k.schoolContactId ? [k.schoolContactId] : []} none={t('None')}
              options={[{ value: '', label: t('None') }, ...contacts.map(c => ({ value: c.id, label: c.name }))]} onChange={ids => void run(api.putSchoolKid(m.id, { mode: k.mode, schoolContactId: ids[0] || null }))}
              add={{ label: t('New school…'), onAdd: name => setNewContact({ m, k, role: 'school', name }) }} />
            <p className="field-hint">{k.mode === 'enrolled' && !sameSchool(k).length ? t('From Contacts, or add a new one. Its number is the one to call, for the teacher too. Kids at the same school share its hours and bus times.') : t('From Contacts, or add a new one. Its number is the one to call, for the teacher too.')}</p></div>}
        {k && <label className="school-check"><input type="checkbox" checked={k.approveLogs} onChange={e => void run(api.putSchoolKid(m.id, { mode: k.mode, approveLogs: e.target.checked }))} /> {t('A grown-up checks the time {name} logs', { name: m.name })}</label>}
        {k?.mode === 'enrolled' && <>
          {sameSchool(k).length > 0 && <p className="field-hint">{t('Goes to the same school as {names}: its hours, early release, school days, calendars, school year and bus times are shared. Pickups and drop-offs stay each kid’s own.', { names: new Intl.ListFormat(intlLocale(), { type: 'conjunction' }).format(sameSchool(k).map(x => members.find(mm => mm.id === x.memberId)?.name ?? '')) })}</p>}
          <div className="meal-form-row">
            <div className="field"><label htmlFor={`${id}-${m.id}-start`}>{t('School starts')}</label><input key={k.dayStart ?? ''} id={`${id}-${m.id}-start`} type="time" defaultValue={k.dayStart ?? ''} onBlur={e => { if ((e.target.value || null) !== k.dayStart) void run(api.putSchoolKid(m.id, { mode: k.mode, dayStart: e.target.value || null })) }} /></div>
            <div className="field"><label htmlFor={`${id}-${m.id}-end`}>{t('School ends')}</label><input key={k.dayEnd ?? ''} id={`${id}-${m.id}-end`} type="time" defaultValue={k.dayEnd ?? ''} onBlur={e => { if ((e.target.value || null) !== k.dayEnd) void run(api.putSchoolKid(m.id, { mode: k.mode, dayEnd: e.target.value || null })) }} /></div>
            <div className="field"><label htmlFor={`${id}-${m.id}-terms`}>{t('Report cards a year')}</label>
              <select id={`${id}-${m.id}-terms`} className="settings-select" value={k.terms} onChange={e => void setTerms(m, k, Number(e.target.value))}>{[2, 3, 4, 6].map(n => <option key={n} value={n}>{n}</option>)}</select></div>
          </div>
          {([['toSchool', 'toSchoolBy', 'toSchoolTime', t('Getting to school'), t('Drops off')], ['fromSchool', 'fromSchoolBy', 'fromSchoolTime', t('Getting home'), t('Picks up')]] as const).map(([leg, byKey, timeKey, label, verb]) => {
            const by = k[byKey] ?? '', time = k[timeKey] ?? ''
            return <div key={leg} className="meal-form-row">
              <div className="field"><label htmlFor={`${id}-${m.id}-${leg}`}>{label}</label>
                <select id={`${id}-${m.id}-${leg}`} className="settings-select" value={by} onChange={e => void run(api.putSchoolKid(m.id, { mode: k.mode, [byKey]: e.target.value || null }))}>
                  <option value="">{t('Not set')}</option><option value="bus">{t('The bus')}</option>
                  {members.filter(g => g.grownUp).map(g => <option key={g.id} value={g.id}>{t('{name}: {verb}', { name: g.name, verb })}</option>)}
                </select></div>
              {by && <div className="field"><label htmlFor={`${id}-${m.id}-${leg}-time`}>{t('At')}</label><input key={time} id={`${id}-${m.id}-${leg}-time`} type="time" defaultValue={time}
                onBlur={e => { if ((e.target.value || null) !== (k[timeKey] ?? null)) void run(api.putSchoolKid(m.id, { mode: k.mode, [timeKey]: e.target.value || null })) }} /></div>}
            </div>
          })}
          <div className="meal-form-row school-half-row">
            <div className="field"><label htmlFor={`${id}-${m.id}-hend`}>{t('Early release ends')}</label><input key={k.halfDayEnd ?? ''} id={`${id}-${m.id}-hend`} type="time" defaultValue={k.halfDayEnd ?? ''} onBlur={e => { if ((e.target.value || null) !== (k.halfDayEnd ?? null)) void run(api.putSchoolKid(m.id, { mode: k.mode, halfDayEnd: e.target.value || null })) }} /></div>
            {k.fromSchoolBy && <div className="field"><label htmlFor={`${id}-${m.id}-hhome`}>{k.fromSchoolBy === 'bus' ? t('Early release bus') : t('Early release pickup')}</label><input key={k.halfFromSchoolTime ?? ''} id={`${id}-${m.id}-hhome`} type="time" defaultValue={k.halfFromSchoolTime ?? ''} onBlur={e => { if ((e.target.value || null) !== (k.halfFromSchoolTime ?? null)) void run(api.putSchoolKid(m.id, { mode: k.mode, halfFromSchoolTime: e.target.value || null })) }} /></div>}
          </div>
          <div className="field"><label id={`${id}-${m.id}-days`}>{t('School days')}</label>
            <div className="chip-row" role="group" aria-labelledby={`${id}-${m.id}-days`}>{weekOrder.map(d => <button key={d} type="button" className={`chip ${k.schoolDays.includes(d) ? 'active' : ''}`} aria-pressed={k.schoolDays.includes(d)}
              onClick={() => void run(api.putSchoolKid(m.id, { mode: k.mode, schoolDays: k.schoolDays.includes(d) ? k.schoolDays.filter(x => x !== d) : [...k.schoolDays, d] }))}>{formatDate(new Date(2023, 0, 1 + d), { weekday: 'short' })}</button>)}</div>
          </div>
        </>}
        {k && <div className="field"><label id={`${id}-${m.id}-ys`}>{t('School year starts')}</label>
          <div className="meal-form-row" role="group" aria-labelledby={`${id}-${m.id}-ys`}>
            <select className="settings-select" aria-label={t('Month')} value={(k.yearStart ?? DEFAULT_YEAR_START).slice(0, 2)} onChange={e => { const day = Math.min(Number((k.yearStart ?? DEFAULT_YEAR_START).slice(3)), new Date(2001, Number(e.target.value), 0).getDate()); void run(api.putSchoolKid(m.id, { mode: k.mode, yearStart: `${e.target.value}-${String(day).padStart(2, '0')}` })) }}>
              {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(mm => <option key={mm} value={mm}>{formatDate(new Date(2001, Number(mm) - 1, 1), { month: 'long' })}</option>)}</select>
            <select className="settings-select" aria-label={t('Day')} value={(k.yearStart ?? DEFAULT_YEAR_START).slice(3)} onChange={e => void run(api.putSchoolKid(m.id, { mode: k.mode, yearStart: `${(k.yearStart ?? DEFAULT_YEAR_START).slice(0, 2)}-${e.target.value}` }))}>
              {Array.from({ length: new Date(2001, Number((k.yearStart ?? DEFAULT_YEAR_START).slice(0, 2)), 0).getDate() }, (_, i) => String(i + 1).padStart(2, '0')).map(dd => <option key={dd} value={dd}>{Number(dd)}</option>)}</select>
          </div>
          <p className="field-hint">{t('Records and grades count a school year from this day to the day before it comes round again.')}</p></div>}
        {k?.mode === 'home' && <div className="meal-form-row">
          {([['yearGoalHours', t('Hours a year'), 5000], ['yearGoalDays', t('School days a year'), 366], ['dailyGoalMinutes', t('Minutes a day'), 1440]] as const).map(([key, label, max]) =>
            <div key={key} className="field"><label htmlFor={`${id}-${m.id}-${key}`}>{label}</label><input id={`${id}-${m.id}-${key}`} type="number" inputMode="numeric" min={1} max={max} placeholder={t('No goal')} defaultValue={k[key] ?? ''}
              onBlur={e => { const v = e.target.value ? Math.min(max, Math.max(1, Math.round(Number(e.target.value)))) : null; if (v !== (k[key] ?? null)) void run(api.putSchoolKid(m.id, { mode: k.mode, [key]: v })) }} /></div>)}
        </div>}
        {k && <>
          <div className="field"><label htmlFor={`${id}-${m.id}-cal`}>{t('School calendars')}</label>
            <PickField id={`${id}-${m.id}-cal`} label={t('School calendars')} multiple value={k.calendarIds} none={t('None')}
              options={calendars.map(c => ({ value: c.id, label: c.name }))} onChange={ids => void run(api.putSchoolKid(m.id, { mode: k.mode, calendarIds: ids }))} />
            <p className="field-hint">{t('The school’s and the district’s. Their events show on {name}’s School day, and days off and early release come from them.', { name: m.name })}</p></div>
          <div className="field"><label htmlFor={`${id}-${m.id}-last`}>{t('Last day of school (optional)')}</label>
            <input key={k.lastDay ?? ''} id={`${id}-${m.id}-last`} type="date" defaultValue={k.lastDay ?? ''} onBlur={e => { if ((e.target.value || null) !== (k.lastDay ?? null)) void run(api.putSchoolKid(m.id, { mode: k.mode, lastDay: e.target.value || null })) }} />
            <p className="field-hint">{t('Leave it empty to use a “Last day of school” event on the calendars.')}</p></div>
          <div className="field"><label htmlFor={`${id}-${m.id}-teacher`}>{t('Teacher')}</label>
            <input id={`${id}-${m.id}-teacher`} type="text" maxLength={80} placeholder={t('Ms. Okafor')} defaultValue={k.teacherName ?? ''}
              onBlur={e => { if ((e.target.value.trim() || null) !== (k.teacherName ?? null)) void run(api.putSchoolKid(m.id, { mode: k.mode, teacherName: e.target.value.trim() || null })) }} /></div>
          {k.teacherName && <>
            <div className="field"><label htmlFor={`${id}-${m.id}-temail`}>{t('Teacher’s email (optional)')}</label>
              <input id={`${id}-${m.id}-temail`} type="email" inputMode="email" maxLength={200} placeholder={t('teacher@school.org')} defaultValue={k.teacherEmail ?? ''}
                onBlur={e => { if ((e.target.value.trim() || null) !== (k.teacherEmail ?? null)) void run(api.putSchoolKid(m.id, { mode: k.mode, teacherEmail: e.target.value.trim() || null })) }} /></div>
            <div className="field"><label htmlFor={`${id}-${m.id}-tlink`}>{t('Another way to reach them (optional)')}</label>
              <input id={`${id}-${m.id}-tlink`} type="url" inputMode="url" maxLength={500} placeholder={t('A ClassDojo, Seesaw or Remind link')} defaultValue={k.teacherLink ?? ''}
                onBlur={e => { if ((e.target.value.trim() || null) !== (k.teacherLink ?? null)) void run(api.putSchoolKid(m.id, { mode: k.mode, teacherLink: e.target.value.trim() || null })) }} /></div>
          </>}
          {k.teacherName && <p className="field-hint">{t('Only grown-ups’ phones and computers show these, not the wall or a kid’s device.')}</p>}
          <div className="field"><label htmlFor={`${id}-${m.id}-contacts`}>{t('Other contacts')}</label>
            <PickField id={`${id}-${m.id}-contacts`} label={t('Other contacts')} multiple search value={k.contactIds} none={t('None')}
              options={contacts.map(c => ({ value: c.id, label: c.name }))} onChange={ids => void run(api.putSchoolKid(m.id, { mode: k.mode, contactIds: ids }))}
              add={{ label: t('New contact…'), onAdd: name => setNewContact({ m, k, role: 'other', name }) }} />
            <p className="field-hint">{t('A tutor, a coach, a carpool: from Contacts.')}</p></div>
        </>}
        </div>}
      </div>
    })}</div>

    {kids.length > 0 && <DayRules />}

    <h3>{t('Subjects')}</h3>
    <div className="school-subjects">{active.map(s => <div key={s.id} className="school-subject">
      <input type="color" aria-label={t('Color for {name}', { name: s.name })} value={s.color} onChange={e => void run(api.updateSchoolSubject(s.id, { color: e.target.value }))} />
      <input type="text" className="school-subject-emoji" aria-label={t('Emoji for {name}', { name: s.name })} maxLength={16} defaultValue={s.emoji ?? ''} onBlur={e => { if ((e.target.value.trim() || null) !== s.emoji) void run(api.updateSchoolSubject(s.id, { emoji: e.target.value.trim() || null })) }} />
      <input type="text" aria-label={t('Name')} maxLength={60} defaultValue={s.name} onBlur={e => { const v = e.target.value.trim(); if (v && v !== s.name) void run(api.updateSchoolSubject(s.id, { name: v })) }} />
      <input type="number" className="school-subject-goal" inputMode="numeric" min={1} max={2000} aria-label={t('Hours a year for {name}', { name: s.name })} placeholder={t('h/yr')} defaultValue={s.goalHours ?? ''}
        onBlur={e => { const v = e.target.value ? Math.min(2000, Math.max(1, Math.round(Number(e.target.value)))) : null; if (v !== (s.goalHours ?? null)) void run(api.updateSchoolSubject(s.id, { goalHours: v })) }} />
      <select className="settings-select" aria-label={t('More for {name}', { name: s.name })} value="" onChange={e => void subjectAction(s, e.target.value)}>
        <option value="">{t('More…')}</option><option value="archive">{t('Put away')}</option><option value="delete">{t('Delete…')}</option>
      </select>
    </div>)}</div>
    <form className="school-subject-add" onSubmit={e => { e.preventDefault(); void addSubject() }}>
      <input type="text" aria-label={t('New subject')} placeholder={t('New subject, like Latin')} maxLength={60} value={newName} onChange={e => setNewName(e.target.value)} />
      <button type="submit" className="btn btn-secondary" disabled={!newName.trim()}><PlusIcon /> {t('Add')}</button>
    </form>
    {away.length > 0 && <>
      <h3>{t('Put away')}</h3>
      <div className="outing-list">{away.map(s => <div key={s.id} className="school-subject"><span>{s.emoji} {s.name}</span><button type="button" className="btn btn-secondary" onClick={() => void run(api.updateSchoolSubject(s.id, { archived: false }))}>{t('Bring back')}</button></div>)}</div>
    </>}
  </Sheet>
  {newContact && <ContactForm initial={null} draft={newContact.role === 'school' ? { name: newContact.name, kind: 'organization', relationship: t('School') } : { name: newContact.name }} categories={categories} members={members} onClose={() => setNewContact(null)} onSaved={contactSaved} />}
  </>
}
