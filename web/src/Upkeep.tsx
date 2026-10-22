// Home upkeep (docs/using/upkeep.md; server: routes/upkeep.ts): the things the family looks after,
// the jobs that keep them working and a log of every time one was done. Three views: Due (what's
// late, due soon and later), Things (by area, with warranties) and History (newest first, with what
// each year cost). Each job opens a sheet with its schedule, steps and history and a big Done.
//
// Who does what: a parent's device everything; a kid's own device sees and marks its kid's jobs and
// its own history; a shared wall marks the jobs shown on it done for whoever picks themselves. Costs,
// serials, notes and files only reach a parent's device (the server leaves them out).
import { useEffect, useId, useLayoutEffect, useState, type ReactNode } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { actingMember } from './actingAs.ts'
import { useDialog } from './dialog.tsx'
import { LoadError, Segmented } from './a11y.tsx'
import Sheet from './Sheet.tsx'
import { Face } from './Face'
import { ChevronRight, PlusIcon } from './icons.tsx'
import { todayKeyInTz } from './date.ts'
import { DAY, formatDate, t, tn } from './i18n.ts'
import { hashQuery, withHashParam } from './hashQuery.ts'
import { tellAppHere } from './native.ts'
import { addDays, nextDue } from './upkeep-rules.ts'
import { ALL_MONTHS, dueLabel, dueSections, historyYears, lines, money, monthName, parseCents, repeatLabel, thingSections, warrantyLabel } from './upkeep.ts'
import type { Contact } from './contact-types.ts'
import type { CalendarEntry, List, Member, UpkeepArea, UpkeepEntry, UpkeepJob, UpkeepJobInput, UpkeepStarter, UpkeepThing, UpkeepThingInput } from './types.ts'
import './meals.css'
import './outings.css'
import './upkeep.css'

const CHANGED = 'kinwall:upkeep'
/** Tells every upkeep list and sheet on this screen to read again. */
const changed = () => window.dispatchEvent(new Event(CHANGED))
const longDay = (d: string) => formatDate(new Date(`${d}T12:00:00`), DAY)
const err = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

function useChanged() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(n => n + 1)
    window.addEventListener(CHANGED, bump)
    return () => window.removeEventListener(CHANGED, bump)
  }, [])
  return [tick, () => setTick(n => n + 1)] as const
}

/** Jobs, things and areas, kept fresh: on a change here, on the app's refresh, never while off. */
export function useUpkeep() {
  const { settings, refreshTick } = useApp()
  const on = settings.features.upkeep !== false
  const [data, setData] = useState<{ jobs: UpkeepJob[]; putAway: UpkeepJob[]; things: UpkeepThing[]; areas: UpkeepArea[] } | null>(null)
  const [error, setError] = useState('')
  const [tick, retry] = useChanged()
  useEffect(() => {
    if (!on) return
    let canceled = false
    // Put-away jobs and sold-or-gone things too, so they can be found and put back.
    Promise.all([api.getUpkeepJobs(), api.getArchivedUpkeepJobs(), api.getUpkeepThings(true), api.getUpkeepAreas()])
      .then(([jobs, putAway, things, areas]) => { if (!canceled) { setData({ jobs, putAway, things, areas }); setError('') } })
      .catch(e => { if (!canceled) setError(err(e, t('Could not load home upkeep.'))) })
    return () => { canceled = true }
  }, [on, refreshTick, tick])
  const all = data?.things ?? []
  return { jobs: data?.jobs ?? [], putAway: data?.putAway ?? [], things: all.filter(x => !x.archived), gone: all.filter(x => x.archived), loaded: !!data, error, retry, areas: data?.areas ?? [] }
}

/** Jobs due soon or late for the Board's Due soon (a wall gets the ones shown on it). */
export function useUpkeepDue(): UpkeepJob[] {
  const { settings, refreshTick } = useApp()
  const on = settings.features.upkeep !== false
  const [jobs, setJobs] = useState<UpkeepJob[]>([])
  const [tick] = useChanged()
  useEffect(() => {
    if (!on) return
    let canceled = false
    api.getUpkeepJobs('overdue,due,soon').then(x => { if (!canceled) setJobs(x) }).catch(() => { /* keep the last ones */ })
    return () => { canceled = true }
  }, [on, refreshTick, tick])
  return on ? jobs : []
}

/** What this device may do: a parent everything; a kid's own device its own jobs; a wall marks done. */
function useWho() {
  const { members, parentDevice, meMemberId, settings } = useApp()
  const kidId = !parentDevice && meMemberId && members.find(m => m.id === meMemberId)?.grownUp === false ? meMemberId : null
  const today = todayKeyInTz(settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
  return { parent: parentDevice, kidId, history: parentDevice || !!kidId, today }
}

/** A link into Upkeep (#/upkeep?job=<id>, ?thing=<id>): what it opens. */
function readLink(): { job: string | null; thing: string | null } {
  if (!location.hash.startsWith('#/upkeep')) return { job: null, thing: null }
  const q = hashQuery(location.hash)
  return { job: q.get('job'), thing: q.get('thing') }
}
/** Takes the link out of the address once it's read. Left in, closing the sheet steps back
 * (sheetHistory.ts) onto the entry that still has it, and the job opens again: you could never leave
 * it. Called before the sheet's own history entry is made (a layout effect, or the hashchange). A
 * tap opens a sheet without touching the address. */
function dropLink() {
  const l = readLink()
  if (!l.job && !l.thing) return
  history.replaceState(history.state, '', withHashParam(withHashParam(location.hash, 'job', null), 'thing', null))
  tellAppHere()
}

const jobEmoji = (j: UpkeepJob) => j.emoji || '🔧'
const thingEmoji = (x: UpkeepThing) => x.emoji || '🏠'
const personName = (members: Member[], id: string | null) => members.find(m => m.id === id)?.name ?? null

export default function Upkeep() {
  const who = useWho()
  const { members } = useApp()
  const { jobs, putAway, things, gone, areas, loaded, error, retry } = useUpkeep()
  const [view, setView] = useState<'due' | 'things' | 'history'>('due')
  const [link] = useState(readLink)
  const [openJob, setOpenJob] = useState<string | null>(link.job)
  const [openThing, setOpenThing] = useState<string | null>(link.thing)
  useLayoutEffect(dropLink, []) // before the opened sheet's history entry (Sheet's useEffect)
  const [doing, setDoing] = useState<UpkeepJob | null>(null)
  const [editJob, setEditJob] = useState<UpkeepJob | 'new' | null>(null)
  const [editThing, setEditThing] = useState<UpkeepThing | 'new' | null>(null)
  const [starters, setStarters] = useState(false)
  // A link while Upkeep is open (the bell, the Board) opens that job or thing too.
  useEffect(() => {
    const read = () => { const l = readLink(); dropLink(); if (l.job) setOpenJob(l.job); if (l.thing) setOpenThing(l.thing) }
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])
  const sections = dueSections(jobs)
  const thingName = (id: string | null) => [...things, ...gone].find(x => x.id === id)?.name ?? null
  const tabs = [{ key: 'due' as const, label: t('Due') }, { key: 'things' as const, label: t('Things') }, ...(who.history ? [{ key: 'history' as const, label: t('History') }] : [])]
  return <div className="meals-view outings-view upkeep-view scroll-y">
    <div className="meals-heading"><div><h1>{t('Home upkeep')}</h1><p className="field-hint">{t('The jobs that keep the house and car working, and when each was last done.')}</p></div>
      {who.parent && <div className="meal-actions">
        {view === 'things'
          ? <button className="btn btn-primary" onClick={() => setEditThing('new')}><PlusIcon /> {t('Add a thing')}</button>
          : <button className="btn btn-primary" onClick={() => setEditJob('new')}><PlusIcon /> {t('Add a job')}</button>}
      </div>}
    </div>
    <Segmented tabs idBase="upkeep-tab" label={t('Home upkeep sections')} value={view} onChange={setView} options={tabs} />
    {error && <LoadError what="upkeep" error={error} onRetry={retry} />}
    {!loaded && !error ? <p role="status">{t('Loading home upkeep…')}</p> : view === 'due' ? <section role="tabpanel" aria-labelledby="upkeep-tab-due">
      {!jobs.length && <div className="state-card">
        <p>{who.parent ? t('Keep the jobs that come round every few months here: the furnace filter, smoke alarms, the oil change.') : who.kidId ? t('No upkeep jobs for you right now.') : t('Nothing to look after right now.')}</p>
        {who.parent && <button className="btn btn-secondary" onClick={() => setStarters(true)}>{t('Add common jobs')}</button>}
      </div>}
      {sections.map(s => <section key={s.key} className="outing-section" aria-labelledby={`upkeep-sec-${s.key}`}>
        <h2 id={`upkeep-sec-${s.key}`}>{s.title} <small>({s.jobs.length})</small></h2>
        <div className="outing-list">{s.jobs.map(j => <JobRow key={j.id} j={j} thing={thingName(j.thingId)} today={who.today} members={members} onOpen={() => setOpenJob(j.id)} onDone={() => setDoing(j)} />)}</div>
      </section>)}
      {who.parent && putAway.length > 0 && <details className="settings-disclosure upkeep-put-away">
        <summary>{tn(putAway.length, '{n} job put away', '{n} jobs put away')}</summary>
        <div className="outing-list">{putAway.map(j => <JobRow key={j.id} j={j} thing={thingName(j.thingId)} today={who.today} members={members} onOpen={() => setOpenJob(j.id)} onDone={() => setDoing(j)} />)}</div>
      </details>}
      {who.parent && jobs.length > 0 && <p><button type="button" className="link-btn" onClick={() => setStarters(true)}>{t('Add common jobs')}</button></p>}
    </section> : view === 'things' ? <section role="tabpanel" aria-labelledby="upkeep-tab-things">
      {!things.length && <p className="state-card">{t('Add the things you look after, like the furnace, the fridge or the car, to keep their model, part sizes and warranty in one place.')}</p>}
      {thingSections(things, areas).map(s => <section key={s.key} className="outing-section" aria-labelledby={`upkeep-area-${s.key}`}>
        <h2 id={`upkeep-area-${s.key}`}>{s.title}</h2>
        <div className="outing-list">{s.things.map(x => {
          const next = jobs.find(j => j.thingId === x.id && j.nextDue)
          const warranty = warrantyLabel(x.warrantyUntil, who.today)
          return <button key={x.id} type="button" className="outing-row" aria-haspopup="dialog" onClick={() => setOpenThing(x.id)}>
            <span className="outing-emoji" aria-hidden="true">{thingEmoji(x)}</span>
            <span className="outing-row-main">
              <strong>{x.name}</strong>
              <span className="outing-row-meta">{[x.room, next && `${next.title}: ${dueLabel(next, who.today)}`].filter(Boolean).join(' · ')}</span>
              {warranty && <span className="outing-tags"><span className="chip chip-static">🧾 {warranty}</span></span>}
            </span>
            <ChevronRight />
          </button>
        })}</div>
      </section>)}
      {who.parent && gone.length > 0 && <details className="settings-disclosure upkeep-put-away">
        <summary>{tn(gone.length, '{n} sold or gone', '{n} sold or gone')}</summary>
        <div className="outing-list">{gone.map(x => <button key={x.id} type="button" className="outing-row outing-row-compact" aria-haspopup="dialog" onClick={() => setOpenThing(x.id)}>
          <span className="outing-emoji" aria-hidden="true">{thingEmoji(x)}</span><span className="outing-row-main"><strong>{x.name}</strong></span><ChevronRight />
        </button>)}</div>
      </details>}
    </section> : <section role="tabpanel" aria-labelledby="upkeep-tab-history"><History /></section>}
    {openJob && <JobSheet id={openJob} things={[...things, ...gone]} onClose={() => setOpenJob(null)} onDone={setDoing} onEdit={j => setEditJob(j)} />}
    {openThing && <ThingSheet id={openThing} jobs={[...jobs, ...putAway]} onClose={() => setOpenThing(null)} onOpenJob={id => { setOpenThing(null); setOpenJob(id) }} onEdit={x => setEditThing(x)} />}
    {doing && <DoneSheet job={doing} onClose={() => setDoing(null)} />}
    {editJob && <JobEditSheet job={editJob === 'new' ? null : editJob} things={things} areas={areas} onClose={() => setEditJob(null)} onSaved={j => { setEditJob(null); setOpenJob(j.id) }} />}
    {editThing && <ThingEditSheet thing={editThing === 'new' ? null : editThing} areas={areas} onClose={() => setEditThing(null)} onSaved={x => { setEditThing(null); setView('things'); setOpenThing(x.id) }} />}
    {starters && <StartersSheet onClose={() => setStarters(false)} />}
  </div>
}

/** A job: what, when and who, and a Done button right on the row. */
function JobRow({ j, thing, today, members, onOpen, onDone }: { j: UpkeepJob; thing: string | null; today: string; members: Member[]; onOpen: () => void; onDone: () => void }) {
  const person = members.find(m => m.id === j.memberId)
  const late = j.status === 'overdue'
  return <div className="upkeep-row">
    <button type="button" className="outing-row upkeep-row-main" aria-haspopup="dialog" onClick={onOpen}>
      <span className="outing-emoji" aria-hidden="true">{jobEmoji(j)}</span>
      <span className="outing-row-main">
        <strong>{j.title}</strong>
        <span className="outing-row-meta"><span className={late ? 'snap-overdue' : ''}>{j.archived ? t('Put away') : dueLabel(j, today)}</span>{thing && ` · ${thing}`}{j.lastDone && ` · ${t('Last done {date}', { date: longDay(j.lastDone.doneOn) })}`}</span>
      </span>
      {person && <span className="outing-faces" aria-label={t('{name} usually does it', { name: person.name })}><Face m={person} /></span>}
      <ChevronRight />
    </button>
    {j.nextDue && <button type="button" className="btn btn-secondary upkeep-done-btn" onClick={onDone} aria-label={t('Mark done: {title}', { title: j.title })}><span aria-hidden="true">✓</span><span className="upkeep-done-word"> {t('Done')}</span></button>}
  </div>
}

/** Done: when and who; on a parent's device the cost, a reading, notes and a receipt. */
function DoneSheet({ job, onClose }: { job: UpkeepJob; onClose: () => void }) {
  const { members, meMemberId, actingMemberId, toast } = useApp()
  const who = useWho()
  const id = useId()
  const [doneOn, setDoneOn] = useState(who.today)
  const [memberId, setMemberId] = useState<string>(() => who.kidId ?? (who.parent ? meMemberId : actingMember(actingMemberId, members)?.id) ?? '')
  const [cost, setCost] = useState(job.usualCostCents != null ? (job.usualCostCents / 100).toFixed(job.usualCostCents % 100 ? 2 : 0) : '')
  const [reading, setReading] = useState('')
  const [unit, setUnit] = useState<'mi' | 'km' | 'h'>('mi')
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const preview = nextDue({ ...job, snoozedUntil: null, skippedUntil: null, createdOn: job.createdAt.slice(0, 10) }, doneOn)
  const save = async () => {
    const cents = parseCents(cost)
    if (cents === undefined) { setError(t('Check the cost: a number like 15 or 12.50.')); return }
    if (reading && !/^\d+$/.test(reading.replace(/,/g, ''))) { setError(t('The reading is a whole number, like 48210.')); return }
    setBusy(true); setError('')
    try {
      const r = await api.markUpkeepDone(job.id, { doneOn, memberId: memberId || null, ...(who.parent ? { costCents: cents, reading: reading ? Number(reading.replace(/,/g, '')) : null, readingUnit: reading ? unit : null, notes: notes.trim() || null } : {}) })
      if (!r.entry) { changed(); onClose(); toast(t('Waiting for a grown-up')); return }
      const entryId = r.entry.id
      if (file) await api.uploadUpkeepFile({ entry: entryId }, file, file.name).catch(e => toast(err(e, t('Could not add the file.')), true))
      changed(); onClose()
      toast(t('Done: {title}', { title: job.title }), false, { label: t('Undo'), run: () => { void api.deleteUpkeepEntry(entryId).then(changed).catch(e => toast(err(e, t('Could not undo.')), true)) } })
    } catch (e) { setError(err(e, t('Could not save.'))) } finally { setBusy(false) }
  }
  return <Sheet title={`${jobEmoji(job)} ${job.title}`} onClose={() => { if (!busy) onClose() }} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" type="submit" form={id} disabled={busy}>{busy ? t('Saving…') : t('Mark done')}</button>
  </>}>
    <form id={id} onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-day`}>{t('When')}</label><input id={`${id}-day`} type="date" required max={who.today} min={who.parent ? undefined : addDays(who.today, -7)} value={doneOn} onChange={e => setDoneOn(e.target.value || who.today)} /></div>
          {!who.kidId && <div className="field"><label htmlFor={`${id}-who`}>{t('Who did it')}</label><select id={`${id}-who`} value={memberId} onChange={e => setMemberId(e.target.value)}><option value="">{t('Someone else')}</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>}
        </div>
        {who.parent && <>
          <div className="meal-form-row">
            <div className="field"><label htmlFor={`${id}-cost`}>{t('Cost')}</label><input id={`${id}-cost`} type="text" inputMode="decimal" maxLength={12} placeholder="54.99" value={cost} onChange={e => setCost(e.target.value)} /></div>
            <div className="field"><label htmlFor={`${id}-reading`}>{t('Reading (optional)')}</label><input id={`${id}-reading`} type="text" inputMode="numeric" maxLength={12} placeholder={t('Odometer or hours')} value={reading} onChange={e => setReading(e.target.value)} /></div>
            {reading && <div className="field"><label htmlFor={`${id}-unit`}>{t('In')}</label><select id={`${id}-unit`} value={unit} onChange={e => setUnit(e.target.value as 'mi' | 'km' | 'h')}><option value="mi">{t('Miles')}</option><option value="km">{t('Kilometers')}</option><option value="h">{t('Hours')}</option></select></div>}
          </div>
          <div className="field"><label htmlFor={`${id}-notes`}>{t('Notes')}</label><textarea id={`${id}-notes`} maxLength={10000} placeholder={t('What was used, what to do next time…')} value={notes} onChange={e => setNotes(e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-file`}>{t('Receipt or photo (optional)')}</label><input id={`${id}-file`} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={e => setFile(e.target.files?.[0] ?? null)} /></div>
        </>}
        <p className="field-hint" role="status">{preview ? t('Next due: {date}', { date: longDay(preview) }) : t('A one-off: it’s done after this.')}</p>
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Sheet>
}

/** One job: when it's due, how it repeats, who does it, the steps and supplies, and its history. */
function JobSheet({ id, things, onClose, onDone, onEdit }: { id: string; things: UpkeepThing[]; onClose: () => void; onDone: (j: UpkeepJob) => void; onEdit: (j: UpkeepJob) => void }) {
  const { members, toast, refreshTick } = useApp()
  const who = useWho()
  const dialog = useDialog()
  const [j, setJ] = useState<UpkeepJob | null>(null)
  const [log, setLog] = useState<UpkeepEntry[]>([])
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [calendar, setCalendar] = useState(false)
  const [tick] = useChanged()
  useEffect(() => {
    let canceled = false
    Promise.all([api.getUpkeepJob(id), who.history ? api.getUpkeepLog({ job: id }) : Promise.resolve([])])
      .then(([x, l]) => { if (!canceled) { setJ(x); setLog(l) } }).catch(() => { if (!canceled) setMissing(true) })
    return () => { canceled = true }
  }, [id, refreshTick, tick, who.history])
  if (missing) return <Sheet title={t('Upkeep job')} onClose={onClose}><p className="state-card">{t('This job isn’t here anymore.')}</p></Sheet>
  if (!j) return <Sheet title={t('Upkeep job')} onClose={onClose}><p role="status">{t('Loading…')}</p></Sheet>
  const thing = things.find(x => x.id === j.thingId)
  const run = async (work: () => Promise<UpkeepJob | null>, done: string) => {
    setBusy(true)
    try { const saved = await work(); if (saved) setJ(saved); changed(); toast(done) } catch (e) { toast(err(e, t('Could not save.')), true) } finally { setBusy(false) }
  }
  // "Not this week" is for a job due within the week or late: a week on from then (or from today when late).
  const soon = !!j.nextDue && (j.status === 'overdue' || j.status === 'due' || j.status === 'soon')
  const snoozeTo = addDays(j.nextDue && j.nextDue > who.today ? j.nextDue : who.today, 7)
  const more = async (action: string) => {
    if (action === 'edit') onEdit(j)
    if (action === 'snooze') void run(() => api.snoozeUpkeepJob(j.id, snoozeTo), t('Moved to {date}', { date: longDay(snoozeTo) }))
    if (action === 'unsnooze') void run(() => api.snoozeUpkeepJob(j.id, null), t('Back on its usual day'))
    if (action === 'skip') void run(() => api.skipUpkeepJob(j.id), t('Skipped this time'))
    if (action === 'calendar') setCalendar(true)
    if (action === 'archive') void run(() => api.updateUpkeepJob(j.id, { archived: !j.archived }), j.archived ? t('Back on the list') : t('Put away. Its history stays.'))
    if (action === 'delete' && await dialog.confirm({ title: t('Delete “{title}”?', { title: j.title }), body: t('The job goes away. What was done stays in the history.'), confirmLabel: t('Delete job'), danger: true })) {
      void run(async () => { await api.deleteUpkeepJob(j.id); onClose(); return null }, t('Job deleted'))
    }
  }
  const options = who.parent ? [
    <option key="edit" value="edit">{t('Edit')}</option>,
    soon && !j.snoozedUntil && <option key="snooze" value="snooze">{t('Not this week')}</option>,
    j.snoozedUntil && <option key="unsnooze" value="unsnooze">{t('Back to its usual day')}</option>,
    j.nextDue && j.repeatKind !== 'once' && <option key="skip" value="skip">{t('Skip this time')}</option>,
    j.nextDue && !j.calendarEventId && <option key="calendar" value="calendar">{t('Add to the calendar…')}</option>,
    <option key="archive" value="archive">{j.archived ? t('Put it back') : t('Put it away')}</option>,
    <option key="delete" value="delete">{t('Delete job…')}</option>,
  ].filter(Boolean) : []
  const pro = j.contactId ? t('Done by a pro') : null
  const facts: [string, ReactNode][] = [
    ['📅', j.nextDue ? <span key="due" className={j.status === 'overdue' ? 'snap-overdue' : ''}>{`${dueLabel(j, who.today)} · ${longDay(j.nextDue)}`}</span> : t('Done')],
    ['🔁', repeatLabel(j)],
    ...(thing ? [['🏠', [thing.name, thing.room].filter(Boolean).join(' · ')] as [string, ReactNode]] : []),
    ...(j.memberId || pro ? [['👤', [personName(members, j.memberId) && t('{name} usually does it', { name: personName(members, j.memberId)! }), pro].filter(Boolean).join(' · ')] as [string, ReactNode]] : []),
    ...(j.chorePoints != null && j.memberId ? [['⭐', tn(j.chorePoints, 'A chore on the day, worth {n} point', 'A chore on the day, worth {n} points')] as [string, ReactNode]] : []),
    ...(j.usualCostCents != null ? [['💵', t('Usually {cost}', { cost: money(j.usualCostCents) })] as [string, ReactNode]] : []),
    ...(j.calendarEventId && j.calendarEventStart ? [['🗓', <a key="cal" href={`#/calendar?event=${encodeURIComponent(j.calendarEventId)}&at=${j.calendarEventStart.slice(0, 10)}`} onClick={onClose}>{t('On the calendar: {date}', { date: longDay(j.calendarEventStart.slice(0, 10)) })}</a>] as [string, ReactNode]] : []),
  ]
  return <Sheet title={`${jobEmoji(j)} ${j.title}`} onClose={onClose} actions={<>
    {options.length > 0 && <select className="settings-select actions-select" aria-label={t('Job actions')} value="" disabled={busy} onChange={e => void more(e.target.value)}><option value="" disabled hidden>{t('More…')}</option>{options}</select>}
    {j.nextDue && <button className="btn btn-primary" disabled={busy} onClick={() => onDone(j)}>{t('Mark done')}</button>}
  </>}>
    <ul className="outing-facts">{facts.map(([icon, text], i) => <li key={i}><span aria-hidden="true">{icon}</span><span>{text}</span></li>)}</ul>
    {j.steps.length > 0 && <section className="restaurant-section"><h3>{t('How to')}</h3><ol className="upkeep-steps">{j.steps.map((s, i) => <li key={i}>{s}</li>)}</ol></section>}
    {j.supplies.length > 0 && <section className="restaurant-section"><h3>{t('Supplies')}</h3><p className="meal-prose">{j.supplies.map(s => s.name).join(', ')}</p>
      <p className="field-hint">{tn(j.suppliesDays, 'They go on the shopping list {n} day before it’s due.', 'They go on the shopping list {n} days before it’s due.')}</p></section>}
    {who.history && <section className="restaurant-section"><h3>{t('History')}</h3>
      {log.length ? <ul className="upkeep-log">{log.map(e => <EntryRow key={e.id} e={e} members={members} />)}</ul> : <p className="field-hint">{t('Not done yet.')}</p>}
    </section>}
    {calendar && <CalendarSheet job={j} onClose={() => setCalendar(false)} onSaved={x => { setJ(x); changed(); setCalendar(false) }} />}
  </Sheet>
}

/** One Done in a history list: the day, who, the cost and notes, and its files. */
function EntryRow({ e, members, withTitle = false }: { e: UpkeepEntry; members: Member[]; withTitle?: boolean }) {
  const name = personName(members, e.memberId)
  const reading = e.reading != null ? `${e.reading.toLocaleString()} ${e.readingUnit === 'km' ? t('km') : e.readingUnit === 'h' ? t('hours') : t('mi')}` : null
  return <li className="upkeep-entry">
    <span className="upkeep-entry-day">{longDay(e.doneOn)}</span>
    <span className="upkeep-entry-main">
      {withTitle && <strong>{e.title}</strong>}
      <span>{[name && t('by {name}', { name }), e.costCents != null && money(e.costCents), reading].filter(Boolean).join(' · ')}</span>
      {e.notes && <span className="field-hint">{e.notes}</span>}
      {e.files.length > 0 && <span className="upkeep-files">{e.files.map(f => <a key={f.id} href={api.upkeepFileUrl(f.id) || undefined} target="_blank" rel="noopener noreferrer">📎 {f.name}</a>)}</span>}
    </span>
  </li>
}

/** History: every Done, newest first, by year with what the year cost; a parent searches. */
function History() {
  const { members } = useApp()
  const who = useWho()
  const [entries, setEntries] = useState<UpkeepEntry[] | null>(null)
  const [q, setQ] = useState('')
  const [error, setError] = useState('')
  const [tick, retry] = useChanged()
  useEffect(() => {
    let canceled = false
    const timer = setTimeout(() => { api.getUpkeepLog(q.trim() ? { q: q.trim() } : {}).then(x => { if (!canceled) { setEntries(x); setError('') } }).catch(e => { if (!canceled) setError(err(e, t('Could not load home upkeep.'))) }) }, q ? 250 : 0)
    return () => { canceled = true; clearTimeout(timer) }
  }, [q, tick])
  const id = useId()
  return <>
    {who.parent && <div className="field"><label htmlFor={id}>{t('Search the history')}</label><input id={id} type="search" maxLength={200} placeholder={t('Filter, oil, plumber…')} value={q} onChange={e => setQ(e.target.value)} /></div>}
    {error && <LoadError what="upkeep" error={error} onRetry={retry} />}
    {!entries ? <p role="status">{t('Loading…')}</p> : !entries.length ? <p className="state-card">{q ? t('Nothing matches that.') : t('Nothing done yet. Each time a job is marked done, it shows here.')}</p>
      : historyYears(entries).map(y => <section key={y.year} className="outing-section" aria-labelledby={`upkeep-year-${y.year}`}>
        <h2 id={`upkeep-year-${y.year}`}>{y.year} <small>{who.parent && y.priced ? t('{cost} on {n} jobs', { cost: money(y.costCents), n: y.entries.length }) : tn(y.entries.length, '{n} job', '{n} jobs')}</small></h2>
        <ul className="upkeep-log">{y.entries.map(e => <EntryRow key={e.id} e={e} members={members} withTitle />)}</ul>
      </section>)}
  </>
}

/** One thing: its details, warranty and files (a parent's device), its jobs and history. */
function ThingSheet({ id, jobs, onClose, onOpenJob, onEdit }: { id: string; jobs: UpkeepJob[]; onClose: () => void; onOpenJob: (id: string) => void; onEdit: (x: UpkeepThing) => void }) {
  const { members, toast, refreshTick } = useApp()
  const who = useWho()
  const dialog = useDialog()
  const fileId = useId()
  const [x, setX] = useState<UpkeepThing | null>(null)
  const [log, setLog] = useState<UpkeepEntry[]>([])
  const [missing, setMissing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tick] = useChanged()
  useEffect(() => {
    let canceled = false
    Promise.all([api.getUpkeepThings(true).then(all => all.find(y => y.id === id) ?? null), who.history ? api.getUpkeepLog({ thing: id }) : Promise.resolve([])])
      .then(([y, l]) => { if (canceled) return; if (!y) setMissing(true); else { setX(y); setLog(l) } }).catch(() => { if (!canceled) setMissing(true) })
    return () => { canceled = true }
  }, [id, refreshTick, tick, who.history])
  if (missing) return <Sheet title={t('Thing')} onClose={onClose}><p className="state-card">{t('This isn’t here anymore.')}</p></Sheet>
  if (!x) return <Sheet title={t('Thing')} onClose={onClose}><p role="status">{t('Loading…')}</p></Sheet>
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true)
    try { await work(); changed(); toast(done) } catch (e) { toast(err(e, t('Could not save.')), true) } finally { setBusy(false) }
  }
  const more = async (action: string) => {
    if (action === 'edit') onEdit(x)
    if (action === 'archive') void run(() => api.updateUpkeepThing(x.id, { archived: !x.archived }), x.archived ? t('Back on the list') : t('Marked sold or gone. Its history stays.'))
    if (action === 'delete' && await dialog.confirm({ title: t('Delete “{title}”?', { title: x.name }), body: t('It and its files go away. Its jobs and history stay.'), confirmLabel: t('Delete'), danger: true })) {
      void run(async () => { await api.deleteUpkeepThing(x.id); onClose() }, t('Deleted'))
    }
  }
  const mine = jobs.filter(j => j.thingId === x.id)
  const warranty = warrantyLabel(x.warrantyUntil, who.today)
  const facts: [string, ReactNode][] = [
    ...(x.room ? [['📍', x.room] as [string, ReactNode]] : []),
    ...(x.brand || x.model ? [['🏷', [x.brand, x.model].filter(Boolean).join(' ')] as [string, ReactNode]] : []),
    ...(x.serial ? [['#️⃣', t('Serial {serial}', { serial: x.serial })] as [string, ReactNode]] : []),
    ...(x.partNotes ? [['🛒', x.partNotes] as [string, ReactNode]] : []),
    ...(x.boughtOn || x.priceCents != null ? [['💵', [x.boughtOn && t('Bought {date}', { date: longDay(x.boughtOn) }), x.priceCents != null && money(x.priceCents)].filter(Boolean).join(' · ')] as [string, ReactNode]] : []),
    ...(warranty ? [['🧾', warranty] as [string, ReactNode]] : []),
    ...(x.manualUrl ? [['📖', <a key="manual" href={x.manualUrl} target="_blank" rel="noopener noreferrer">{t('The manual')}</a>] as [string, ReactNode]] : []),
  ]
  const upload = async (file: File | undefined) => {
    if (!file) return
    void run(() => api.uploadUpkeepFile({ thing: x.id }, file, file.name), t('Added: {name}', { name: file.name }))
  }
  return <Sheet title={`${thingEmoji(x)} ${x.name}`} onClose={onClose} actions={who.parent ? <select className="settings-select actions-select" aria-label={t('Thing actions')} value="" disabled={busy} onChange={e => void more(e.target.value)}>
    <option value="" disabled hidden>{t('More…')}</option>
    <option value="edit">{t('Edit')}</option>
    <option value="archive">{x.archived ? t('Put it back on the list') : t('Sold or gone')}</option>
    <option value="delete">{t('Delete…')}</option>
  </select> : undefined}>
    {facts.length > 0 && <ul className="outing-facts">{facts.map(([icon, text], i) => <li key={i}><span aria-hidden="true">{icon}</span><span>{text}</span></li>)}</ul>}
    {x.notes && <p className="meal-prose">{x.notes}</p>}
    <section className="restaurant-section"><h3>{t('Jobs')}</h3>
      {mine.length ? <div className="outing-list">{mine.map(j => <button key={j.id} type="button" className="outing-row outing-row-compact" onClick={() => onOpenJob(j.id)}>
        <span className="outing-emoji" aria-hidden="true">{jobEmoji(j)}</span>
        <span className="outing-row-main"><strong>{j.title}</strong><span className="outing-row-meta">{[dueLabel(j, who.today), repeatLabel(j)].join(' · ')}</span></span>
        <ChevronRight />
      </button>)}</div> : <p className="field-hint">{t('No jobs for it yet.')}</p>}
    </section>
    {who.parent && <section className="restaurant-section"><h3>{t('Receipts and manuals')}</h3>
      {x.files.length > 0 && <ul className="upkeep-file-list">{x.files.map(f => <li key={f.id}>
        <a href={api.upkeepFileUrl(f.id) || undefined} target="_blank" rel="noopener noreferrer">📎 {f.name}</a>
        <button type="button" className="link-btn" disabled={busy} onClick={() => void run(() => api.deleteUpkeepFile(f.id), t('Removed: {name}', { name: f.name }))} aria-label={t('Remove {name}', { name: f.name })}>{t('Remove')}</button>
      </li>)}</ul>}
      <div className="field"><label htmlFor={fileId}>{t('Add a receipt, manual or photo (up to 2 MB)')}</label><input id={fileId} type="file" disabled={busy} accept="image/png,image/jpeg,image/webp,application/pdf" onChange={e => { void upload(e.target.files?.[0]); e.target.value = '' }} /></div>
    </section>}
    {who.history && log.length > 0 && <section className="restaurant-section"><h3>{t('History')}</h3><ul className="upkeep-log">{log.map(e => <EntryRow key={e.id} e={e} members={members} withTitle />)}</ul></section>}
  </Sheet>
}

type JobDraft = { title: string; emoji: string; thingId: string; areaId: string; repeatKind: UpkeepJob['repeatKind']; every: string; unit: NonNullable<UpkeepJob['unit']>; onMonths: number[]; onDay: string
  startOn: string; dueOn: string; headsUpDays: string; memberId: string; contactId: string; cost: string; steps: string; supplies: string; suppliesListId: string; suppliesDays: string; chore: boolean; chorePoints: string; wallVisible: boolean }
const jobDraft = (j: UpkeepJob | null): JobDraft => ({
  title: j?.title ?? '', emoji: j?.emoji ?? '', thingId: j?.thingId ?? '', areaId: j?.areaId ?? '', repeatKind: j?.repeatKind ?? 'after', every: String(j?.every ?? 3), unit: j?.unit ?? 'month',
  onMonths: j?.onMonths ?? [], onDay: String(j?.onDay ?? 1), startOn: j?.startOn ?? '', dueOn: j?.dueOn ?? '', headsUpDays: String(j?.headsUpDays ?? 7), memberId: j?.memberId ?? '', contactId: j?.contactId ?? '',
  cost: j?.usualCostCents != null ? (j.usualCostCents / 100).toFixed(j.usualCostCents % 100 ? 2 : 0) : '', steps: (j?.steps ?? []).join('\n'), supplies: (j?.supplies ?? []).map(s => s.name).join('\n'),
  suppliesListId: j?.suppliesListId ?? '', suppliesDays: String(j?.suppliesDays ?? 7), chore: j?.chorePoints != null, chorePoints: String(j?.chorePoints ?? 5), wallVisible: j?.wallVisible ?? true,
})

/** Add or edit a job: what, how it repeats, who, and the extras (steps, supplies, a kid's chore). */
function JobEditSheet({ job, things, areas, onClose, onSaved }: { job: UpkeepJob | null; things: UpkeepThing[]; areas: UpkeepArea[]; onClose: () => void; onSaved: (j: UpkeepJob) => void }) {
  const { members, toast } = useApp()
  const id = useId()
  const [d, setD] = useState<JobDraft>(() => jobDraft(job))
  const [contacts, setContacts] = useState<Contact[]>([])
  const [lists, setLists] = useState<List[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    api.getContacts().then(setContacts).catch(() => { /* no pros to pick */ })
    api.getLists().then(l => setLists(l.filter(x => x.kind === 'shopping'))).catch(() => { /* the family's first shopping list */ })
  }, [])
  const set = <K extends keyof JobDraft>(k: K, v: JobDraft[K]) => setD(x => ({ ...x, [k]: v }))
  const kid = members.find(m => m.id === d.memberId && !m.grownUp)
  const num = (s: string) => (s.trim() && /^\d+$/.test(s.trim()) ? Number(s) : null)
  const save = async () => {
    if (!d.title.trim()) { setError(t('Give it a name.')); return }
    const cents = parseCents(d.cost)
    if (cents === undefined) { setError(t('Check the cost: a number like 15 or 12.50.')); return }
    if (d.repeatKind === 'after' && !num(d.every)) { setError(t('Say how often: every how many days, weeks, months or years.')); return }
    if (d.repeatKind === 'on' && !d.onMonths.length) { setError(t('Pick the months and the day it comes round.')); return }
    const body: UpkeepJobInput & { title: string } = {
      title: d.title.trim(), emoji: d.emoji.trim() || null, thingId: d.thingId || null, areaId: d.areaId || (things.find(x => x.id === d.thingId)?.areaId ?? null), repeatKind: d.repeatKind,
      every: d.repeatKind === 'after' ? num(d.every) : null, unit: d.repeatKind === 'after' ? d.unit : null, onMonths: d.repeatKind === 'on' ? d.onMonths : [], onDay: d.repeatKind === 'on' ? num(d.onDay) ?? 1 : null,
      startOn: d.repeatKind === 'once' ? null : d.startOn || null, dueOn: d.repeatKind === 'once' ? d.dueOn || null : null, headsUpDays: Math.min(60, num(d.headsUpDays) ?? 7),
      memberId: d.memberId || null, contactId: d.contactId || null, usualCostCents: cents, steps: lines(d.steps), supplies: lines(d.supplies).map(name => ({ name })),
      suppliesListId: d.suppliesListId || null, suppliesDays: Math.min(60, num(d.suppliesDays) ?? 7), chorePoints: kid && d.chore ? num(d.chorePoints) ?? 0 : null, wallVisible: d.wallVisible,
    }
    setBusy(true); setError('')
    try {
      const saved = job ? await api.updateUpkeepJob(job.id, body) : await api.createUpkeepJob(body)
      changed(); toast(t('Saved: {title}', { title: saved.title })); onSaved(saved)
    } catch (e) { setError(err(e, t('Could not save.'))) } finally { setBusy(false) }
  }
  const close = () => { if (!busy) onClose() }
  return <Sheet title={job ? t('Edit {title}', { title: job.title }) : t('Add a job')} onClose={close} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={close}>{t('Cancel')}</button>
    <button className="btn btn-primary" type="submit" form={id} disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
  </>}>
    <form id={id} onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="meal-form-row upkeep-name-row">
          <div className="field"><label htmlFor={`${id}-emoji`}>{t('Emoji')}</label><input id={`${id}-emoji`} type="text" maxLength={8} placeholder="🔧" value={d.emoji} onChange={e => set('emoji', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-title`}>{t('Job')}</label><input id={`${id}-title`} type="text" required maxLength={200} placeholder={t('Change the furnace filter')} value={d.title} onChange={e => set('title', e.target.value)} /></div>
        </div>
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-thing`}>{t('For')}</label><select id={`${id}-thing`} value={d.thingId} onChange={e => set('thingId', e.target.value)}><option value="">{t('Nothing in particular')}</option>{things.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          {!d.thingId && <div className="field"><label htmlFor={`${id}-area`}>{t('Area')}</label><select id={`${id}-area`} value={d.areaId} onChange={e => set('areaId', e.target.value)}><option value="">{t('None')}</option>{areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>}
        </div>
        <h3>{t('How often')}</h3>
        <div className="field"><label htmlFor={`${id}-kind`}>{t('Repeats')}</label><select id={`${id}-kind`} value={d.repeatKind} onChange={e => set('repeatKind', e.target.value as UpkeepJob['repeatKind'])}>
          <option value="after">{t('Every so often, from the last time')}</option><option value="on">{t('On set dates each year')}</option><option value="once">{t('Just once')}</option>
        </select></div>
        {d.repeatKind === 'after' && <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-every`}>{t('Every')}</label><input id={`${id}-every`} type="number" min={1} max={1000} inputMode="numeric" value={d.every} onChange={e => set('every', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-unit`}>{t('Unit')}</label><select id={`${id}-unit`} value={d.unit} onChange={e => set('unit', e.target.value as JobDraft['unit'])}><option value="day">{t('days')}</option><option value="week">{t('weeks')}</option><option value="month">{t('months')}</option><option value="year">{t('years')}</option></select></div>
        </div>}
        {d.repeatKind === 'on' && <>
          <fieldset className="upkeep-months"><legend>{t('Months')}</legend>{ALL_MONTHS.map(m => <label key={m} className="meal-check"><input type="checkbox" checked={d.onMonths.includes(m)} onChange={e => set('onMonths', e.target.checked ? [...d.onMonths, m].sort((a, b) => a - b) : d.onMonths.filter(x => x !== m))} /> {monthName(m)}</label>)}</fieldset>
          <div className="field"><label htmlFor={`${id}-day`}>{t('Day of the month')}</label><input id={`${id}-day`} type="number" min={1} max={31} inputMode="numeric" value={d.onDay} onChange={e => set('onDay', e.target.value)} /></div>
        </>}
        {d.repeatKind === 'once'
          ? <div className="field"><label htmlFor={`${id}-due`}>{t('Due')}</label><input id={`${id}-due`} type="date" value={d.dueOn} onChange={e => set('dueOn', e.target.value)} /></div>
          : <div className="field"><label htmlFor={`${id}-start`}>{t('First time it’s due')}</label><input id={`${id}-start`} type="date" value={d.startOn} onChange={e => set('startOn', e.target.value)} /><p className="field-hint">{t('Left empty: it’s due now, until it’s marked done.')}</p></div>}
        <div className="field"><label htmlFor={`${id}-heads`}>{t('Heads-up, days before')}</label><input id={`${id}-heads`} type="number" min={0} max={60} inputMode="numeric" value={d.headsUpDays} onChange={e => set('headsUpDays', e.target.value)} /></div>
        <h3>{t('Who')}</h3>
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-who`}>{t('Usually done by')}</label><select id={`${id}-who`} value={d.memberId} onChange={e => set('memberId', e.target.value)}><option value="">{t('Any grown-up')}</option>{members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
          {contacts.length > 0 && <div className="field"><label htmlFor={`${id}-pro`}>{t('Pro who does it')}</label><select id={`${id}-pro`} value={d.contactId} onChange={e => set('contactId', e.target.value)}><option value="">{t('None')}</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        </div>
        {kid && <>
          <label className="meal-check"><input type="checkbox" checked={d.chore} onChange={e => set('chore', e.target.checked)} /> {t('Make it {name}’s chore on the day it’s due', { name: kid.name })}</label>
          {d.chore && <div className="field"><label htmlFor={`${id}-pts`}>{t('Points')}</label><input id={`${id}-pts`} type="number" min={0} max={1000} inputMode="numeric" value={d.chorePoints} onChange={e => set('chorePoints', e.target.value)} /></div>}
        </>}
        <label className="meal-check"><input type="checkbox" checked={d.wallVisible} onChange={e => set('wallVisible', e.target.checked)} /> {t('Show it on wall screens')}</label>
        <h3>{t('Details')}</h3>
        <div className="field"><label htmlFor={`${id}-cost`}>{t('Usual cost')}</label><input id={`${id}-cost`} type="text" inputMode="decimal" maxLength={12} placeholder="25" value={d.cost} onChange={e => set('cost', e.target.value)} /></div>
        <div className="field"><label htmlFor={`${id}-steps`}>{t('How to, one step per line')}</label><textarea id={`${id}-steps`} maxLength={9000} value={d.steps} onChange={e => set('steps', e.target.value)} /></div>
        <div className="field"><label htmlFor={`${id}-sup`}>{t('Supplies to buy, one per line')}</label><textarea id={`${id}-sup`} maxLength={4000} placeholder={t('Furnace filter 16x25x1')} value={d.supplies} onChange={e => set('supplies', e.target.value)} /></div>
        {lines(d.supplies).length > 0 && <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-list`}>{t('Put them on')}</label><select id={`${id}-list`} value={d.suppliesListId} onChange={e => set('suppliesListId', e.target.value)}><option value="">{t('The first shopping list')}</option>{lists.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</select></div>
          <div className="field"><label htmlFor={`${id}-sd`}>{t('Days before it’s due')}</label><input id={`${id}-sd`} type="number" min={0} max={60} inputMode="numeric" value={d.suppliesDays} onChange={e => set('suppliesDays', e.target.value)} /></div>
        </div>}
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Sheet>
}

type ThingDraft = { name: string; emoji: string; areaId: string; room: string; brand: string; model: string; serial: string; partNotes: string; boughtOn: string; price: string; warrantyUntil: string; manualUrl: string; contactId: string; notes: string }
const thingDraft = (x: UpkeepThing | null): ThingDraft => ({
  name: x?.name ?? '', emoji: x?.emoji ?? '', areaId: x?.areaId ?? '', room: x?.room ?? '', brand: x?.brand ?? '', model: x?.model ?? '', serial: x?.serial ?? '', partNotes: x?.partNotes ?? '',
  boughtOn: x?.boughtOn ?? '', price: x?.priceCents != null ? (x.priceCents / 100).toFixed(x.priceCents % 100 ? 2 : 0) : '', warrantyUntil: x?.warrantyUntil ?? '', manualUrl: x?.manualUrl ?? '', contactId: x?.contactId ?? '', notes: x?.notes ?? '',
})

/** Add or edit a thing: where it is, what it is, what to buy for it, its warranty. */
function ThingEditSheet({ thing, areas, onClose, onSaved }: { thing: UpkeepThing | null; areas: UpkeepArea[]; onClose: () => void; onSaved: (x: UpkeepThing) => void }) {
  const { toast } = useApp()
  const id = useId()
  const [d, setD] = useState<ThingDraft>(() => thingDraft(thing))
  const [contacts, setContacts] = useState<Contact[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { api.getContacts().then(setContacts).catch(() => { /* no pros to pick */ }) }, [])
  const set = <K extends keyof ThingDraft>(k: K, v: ThingDraft[K]) => setD(x => ({ ...x, [k]: v }))
  const save = async () => {
    if (!d.name.trim()) { setError(t('Give it a name.')); return }
    const cents = parseCents(d.price)
    if (cents === undefined) { setError(t('Check the price: a number like 650 or 649.99.')); return }
    if (d.manualUrl.trim() && !/^https?:\/\//i.test(d.manualUrl.trim())) { setError(t('The manual’s link starts with http:// or https://.')); return }
    const o = (s: string) => s.trim() || null
    const body: UpkeepThingInput & { name: string } = {
      name: d.name.trim(), emoji: o(d.emoji), areaId: d.areaId || null, room: o(d.room), brand: o(d.brand), model: o(d.model), serial: o(d.serial), partNotes: o(d.partNotes),
      boughtOn: d.boughtOn || null, priceCents: cents, warrantyUntil: d.warrantyUntil || null, manualUrl: o(d.manualUrl), contactId: d.contactId || null, notes: o(d.notes),
    }
    setBusy(true); setError('')
    try {
      const saved = thing ? await api.updateUpkeepThing(thing.id, body) : await api.createUpkeepThing(body)
      changed(); toast(t('Saved: {title}', { title: saved.name })); onSaved(saved)
    } catch (e) { setError(err(e, t('Could not save.'))) } finally { setBusy(false) }
  }
  const text = (k: 'room' | 'brand' | 'model' | 'serial' | 'partNotes', label: string, placeholder = '') =>
    <div className="field"><label htmlFor={`${id}-${k}`}>{label}</label><input id={`${id}-${k}`} type="text" maxLength={k === 'partNotes' ? 500 : 100} placeholder={placeholder} value={d[k]} onChange={e => set(k, e.target.value)} /></div>
  const close = () => { if (!busy) onClose() }
  return <Sheet title={thing ? t('Edit {title}', { title: thing.name }) : t('Add a thing')} onClose={close} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={close}>{t('Cancel')}</button>
    <button className="btn btn-primary" type="submit" form={id} disabled={busy}>{busy ? t('Saving…') : t('Save')}</button>
  </>}>
    <form id={id} onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="meal-form-row upkeep-name-row">
          <div className="field"><label htmlFor={`${id}-emoji`}>{t('Emoji')}</label><input id={`${id}-emoji`} type="text" maxLength={8} placeholder="🏠" value={d.emoji} onChange={e => set('emoji', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-name`}>{t('Name')}</label><input id={`${id}-name`} type="text" required maxLength={200} placeholder={t('Furnace, fridge, the blue van…')} value={d.name} onChange={e => set('name', e.target.value)} /></div>
        </div>
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-area`}>{t('Area')}</label><select id={`${id}-area`} value={d.areaId} onChange={e => set('areaId', e.target.value)}><option value="">{t('None')}</option>{areas.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div>
          {text('room', t('Where it is'), t('Basement, garage…'))}
        </div>
        <div className="meal-form-row">{text('brand', t('Brand'))}{text('model', t('Model'))}</div>
        {text('serial', t('Serial number'))}
        {text('partNotes', t('What to buy for it'), t('Filter 16x25x1, 9V batteries…'))}
        <div className="meal-form-row">
          <div className="field"><label htmlFor={`${id}-bought`}>{t('Bought')}</label><input id={`${id}-bought`} type="date" value={d.boughtOn} onChange={e => set('boughtOn', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-price`}>{t('Price')}</label><input id={`${id}-price`} type="text" inputMode="decimal" maxLength={12} value={d.price} onChange={e => set('price', e.target.value)} /></div>
          <div className="field"><label htmlFor={`${id}-war`}>{t('Warranty until')}</label><input id={`${id}-war`} type="date" value={d.warrantyUntil} onChange={e => set('warrantyUntil', e.target.value)} /></div>
        </div>
        <div className="field"><label htmlFor={`${id}-manual`}>{t('Link to the manual')}</label><input id={`${id}-manual`} type="url" maxLength={2000} value={d.manualUrl} onChange={e => set('manualUrl', e.target.value)} /></div>
        {contacts.length > 0 && <div className="field"><label htmlFor={`${id}-pro`}>{t('Who services it')}</label><select id={`${id}-pro`} value={d.contactId} onChange={e => set('contactId', e.target.value)}><option value="">{t('None')}</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
        <div className="field"><label htmlFor={`${id}-notes`}>{t('Notes')}</label><textarea id={`${id}-notes`} maxLength={10000} value={d.notes} onChange={e => set('notes', e.target.value)} /><p className="field-hint">{t('Don’t save codes or passwords here.')}</p></div>
      </fieldset>
      {error && <p className="field-error" role="alert">{error}</p>}
    </form>
  </Sheet>
}

/** Common jobs to tick and add, each with its usual schedule. Nothing is added unless ticked. */
function StartersSheet({ onClose }: { onClose: () => void }) {
  const { toast } = useApp()
  const [starters, setStarters] = useState<UpkeepStarter[] | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { api.getUpkeepStarters().then(setStarters).catch(e => toast(err(e, t('Could not load home upkeep.')), true)) }, [toast])
  const add = async () => {
    setBusy(true)
    try { const jobs = await api.addUpkeepStarters(picked); changed(); toast(tn(jobs.length, 'Added {n} job', 'Added {n} jobs')); onClose() } catch (e) { toast(err(e, t('Could not save.')), true) } finally { setBusy(false) }
  }
  return <Sheet title={t('Add common jobs')} onClose={() => { if (!busy) onClose() }} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" disabled={busy || !picked.length} onClick={() => void add()}>{tn(picked.length, 'Add {n} job', 'Add {n} jobs')}</button>
  </>}>
    <p className="field-hint">{t('Usual schedules to start from. Check your manual, and change any of them later.')}</p>
    {!starters ? <p role="status">{t('Loading…')}</p> : !starters.length ? <p className="state-card">{t('You’ve added all of them.')}</p>
      : <fieldset className="meal-fieldset" disabled={busy}>{starters.map(s => <label key={s.key} className="meal-check upkeep-starter">
        <input type="checkbox" checked={picked.includes(s.key)} onChange={e => setPicked(p => e.target.checked ? [...p, s.key] : p.filter(k => k !== s.key))} />
        <span><span aria-hidden="true">{s.emoji}</span> {s.title} <small className="field-hint">{repeatLabel({ ...s, dueOn: null })}</small></span>
      </label>)}</fieldset>}
  </Sheet>
}

/** Add to the calendar, for a pro's visit: the day, the time and the calendar. */
function CalendarSheet({ job, onClose, onSaved }: { job: UpkeepJob; onClose: () => void; onSaved: (j: UpkeepJob) => void }) {
  const { toast } = useApp()
  const id = useId()
  const [calendars, setCalendars] = useState<CalendarEntry[] | null>(null)
  const [calendarId, setCalendarId] = useState('')
  const [date, setDate] = useState(job.nextDue ?? '')
  const [allDay, setAllDay] = useState(true)
  const [start, setStart] = useState('09:00')
  const [end, setEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    let canceled = false
    api.getCalendars().then(cals => {
      if (canceled) return
      const writable = cals.filter(c => c.writable && c.enabled && c.canEditEvents !== false)
      setCalendars(writable); setCalendarId((writable.find(c => c.default) ?? writable[0])?.id ?? '')
    }).catch(e => { if (!canceled) setError(err(e, t('Could not load calendars.'))) })
    return () => { canceled = true }
  }, [])
  const save = async () => {
    if (!date) { setError(t('Pick a day.')); return }
    setBusy(true); setError('')
    try {
      const saved = await api.addUpkeepToCalendar(job.id, { date, startTime: allDay ? null : start, endTime: allDay || !end ? null : end, ...(calendarId ? { calendarId } : {}) })
      toast(t('On the calendar: {title}', { title: saved.title })); onSaved(saved)
    } catch (e) { setError(err(e, t('Could not add it to the calendar.'))) } finally { setBusy(false) }
  }
  return <Sheet title={t('Add to the calendar')} onClose={() => { if (!busy) onClose() }} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>{t('Cancel')}</button>
    <button className="btn btn-primary" disabled={busy || !calendars} onClick={() => void save()}>{busy ? t('Adding…') : t('Add to calendar')}</button>
  </>}>
    <p>{job.title}</p>
    <fieldset className="meal-fieldset" disabled={busy}>
      <div className="field"><label htmlFor={`${id}-day`}>{t('Day')}</label><input id={`${id}-day`} type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
      <label className="meal-check"><input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} /> {t('All day')}</label>
      {!allDay && <div className="meal-form-row">
        <div className="field"><label htmlFor={`${id}-t1`}>{t('Starts')}</label><input id={`${id}-t1`} type="time" value={start} onChange={e => setStart(e.target.value)} /></div>
        <div className="field"><label htmlFor={`${id}-t2`}>{t('Ends')}</label><input id={`${id}-t2`} type="time" value={end} onChange={e => setEnd(e.target.value)} /></div>
      </div>}
      {calendars && calendars.length > 1 && <div className="field"><label htmlFor={`${id}-cal`}>{t('Calendar')}</label><select id={`${id}-cal`} value={calendarId} onChange={e => setCalendarId(e.target.value)}>{calendars.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>}
    </fieldset>
    {!calendars && !error && <p role="status">{t('Loading calendars…')}</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
  </Sheet>
}
