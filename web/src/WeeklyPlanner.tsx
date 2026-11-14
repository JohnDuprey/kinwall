import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { useApp } from './AppContext.tsx'
import { api, ApiError, MOCK } from './api.ts'
import Sheet from './Sheet.tsx'
import { Face } from './Face.tsx'
import { useDialog } from './dialog.tsx'
import { DAY, formatDate, msg, t, tm, tn } from './i18n.ts'
import { formatTime } from './timeFormat.ts'
import { onMinute } from './minuteTick.ts'
import { dateKey, zonedDayKey } from './date.ts'
import { dinnerCount, dinnerNeedsApply, planConflicts, planningDay, planningDays, type PlanningDinner, type PlanningDraft, type PlanningPrep, type WeeklyPlanning } from './weekly-planning.ts'

const steps = [msg('The week ahead'), msg('A few decisions'), msg('Ready for the week')]
const labelDate = (key: string) => formatDate(new Date(`${key}T12:00:00Z`), DAY, 'UTC')
const shiftDay = (key: string, offset: number) => { const day = new Date(`${key}T12:00:00`); day.setDate(day.getDate() + offset); return dateKey(day) }
const previousDay = (key: string) => shiftDay(key, -1)

export default function WeeklyPlanner({ home }: { home: boolean }) {
  const { parentDevice, settings, refreshTick } = useApp()
  const [data, setData] = useState<WeeklyPlanning | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!parentDevice) return
    let live = true
    api.getWeeklyPlanning().then(value => { if (live) { setData(value); setError('') } }).catch(() => { if (live) setError(t('Could not load next week. Try again.')) })
    return () => { live = false }
  }, [parentDevice, settings.weekStart, settings.timezone, refreshTick, retry])
  useEffect(() => {
    const timezone = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
    let day = zonedDayKey(new Date().toISOString(), timezone)
    return onMinute(() => { const next = zonedDayKey(new Date().toISOString(), timezone); if (next !== day) { day = next; setRetry(n => n + 1) } })
  }, [settings.timezone])
  if (!parentDevice) return null
  return <>
    {home ? <div className="weekly-invite">
      <span className="weekly-invite-icon" aria-hidden="true">☀️</span>
      <div><strong>{t('A look at next week')}</strong><p>{error || (data ? data.features.meals ? tn(dinnerCount(data), '{n} dinner to decide', '{n} dinners to decide') : t('Make a little room for next week.') : t('Loading next week…'))}</p></div>
      <button className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setOpen(true)}>{t('Plan the week →')}</button>
    </div> : <button className="btn btn-secondary weekly-calendar-button" aria-haspopup="dialog" onClick={() => setOpen(true)}>{t('Plan the week')}</button>}
    {open && (data ? <Planner initial={data} onClose={() => setOpen(false)} onSaved={setData} /> : <Sheet title={t('Plan the week')} onClose={() => setOpen(false)}><p role="status">{error || t('Loading next week…')}</p>{error && <button className="btn btn-secondary" onClick={() => setRetry(n => n + 1)}>{t('Try again')}</button>}</Sheet>)}
  </>
}
function Planner({ initial, onClose, onSaved }: { initial: WeeklyPlanning; onClose: () => void; onSaved: (plan: WeeklyPlanning) => void }) {
  const { members, reloadCore } = useApp()
  const dialog = useDialog()
  const [source, setSource] = useState(initial)
  const [draft, setDraft] = useState(() => structuredClone(initial.draft))
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial.draft))
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [status, setStatus] = useState('')
  const [recipeDay, setRecipeDay] = useState<string | null>(null)
  const [replaceMealId, setReplaceMealId] = useState<string | undefined>()
  const chooseDinner = (date: string, mealId?: string) => { setReplaceMealId(mealId); setRecipeDay(date) }
  const [prepOpen, setPrepOpen] = useState(false)
  const body = useRef<HTMLDivElement>(null)
  const applyRequest = useRef<{ signature: string; id: string } | null>(null)
  useLayoutEffect(() => { body.current?.closest('.sheet-body')?.scrollTo(0, 0) }, [step])
  const dirty = baseline !== JSON.stringify(draft)
  const conflicts = planConflicts(source, draft)
  const change = (next: PlanningDraft) => { setDraft(next); setStatus(''); setError('') }
  const dinner = (date: string, choice?: PlanningDinner) => change({ ...draft, dinners: [...draft.dinners.filter(m => m.date !== date), ...(choice ? [choice] : [])] })
  const appliedDinner = (date: string) => source.applied.dinners[date]
  const isNewMeal = (choice: PlanningDinner) => dinnerNeedsApply(source, choice) && choice.kind === 'meal' && !choice.replaceMealId
  const isSwap = (choice: PlanningDinner) => dinnerNeedsApply(source, choice) && choice.kind === 'meal' && !!choice.replaceMealId
  const isNewPrep = (prep: PlanningPrep) => !source.applied.prep[prep.id]
  const refresh = async () => {
    setBusy(true)
    try {
      const next = await api.getWeeklyPlanning(source.weekStart)
      if (next.revision !== source.revision) {
        if (!await dialog.confirm({ title: t('Use the saved draft?'), body: t('Another parent saved changes. Your unsaved choices will be replaced.'), confirmLabel: t('Use saved draft') })) return
        setDraft(structuredClone(next.draft)); setBaseline(JSON.stringify(next.draft))
      }
      setSource(next); onSaved(next); setError(''); setStatus(t('Week refreshed. Review your choices before adding them.')); setStep(2)
    } catch { setError(t('Could not refresh the week. Try again.')) }
    finally { setBusy(false) }
  }
  const openMeals = async () => {
    if (dirty && !await dialog.confirm({ title: t('Discard changes?'), confirmLabel: t('Discard'), cancelLabel: t('Keep editing'), danger: true })) return
    onClose(); window.location.hash = '/meals'
  }
  const save = async (apply: boolean) => {
    setBusy(true); setError(''); setStatus('')
    try {
      const signature = JSON.stringify({ revision: source.revision, sourceVersion: source.sourceVersion, draft })
      if (!applyRequest.current || applyRequest.current.signature !== signature) applyRequest.current = { signature, id: crypto.randomUUID() }
      const next = apply ? await api.applyWeeklyPlan(source.weekStart, { revision: source.revision, sourceVersion: source.sourceVersion, requestId: applyRequest.current.id, draft }) : await api.saveWeeklyDraft(source.weekStart, source.revision, draft)
      setSource(next); setDraft(structuredClone(next.draft)); setBaseline(JSON.stringify(next.draft)); onSaved(next)
      setStatus(apply ? t('Saved: your week’s meals, preparation and open choices.') : t('Draft saved. Meals and to-dos have not been added.'))
      if (apply) void reloadCore()
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('Could not save your plan. Try again.'))
    } finally { setBusy(false) }
  }
  return <Sheet title={t('Plan the week')} onClose={() => { if (!busy) onClose() }} dirty={dirty} dismissable={!busy} actions={<>
    {step > 0 && <button className="btn btn-secondary" disabled={busy} onClick={() => setStep(step - 1)}>{t('Back')}</button>}
    {step < 2 ? <button className="btn btn-primary" disabled={busy} onClick={() => setStep(step + 1)}>{step === 0 ? t('Make a few decisions') : t('Review plan')}</button> : <>
      <button className="btn btn-secondary" disabled={busy} onClick={() => void save(false)}>{t('Save draft')}</button>
      <button className="btn btn-primary" disabled={busy || conflicts.length > 0 || draft.dinners.some(m => m.kind === 'meal' && !m.title.trim())} onClick={() => void save(true)}>{busy ? t('Saving…') : t('Add to the week')}</button>
    </>}
  </>}>
    <div className="weekly-plan" ref={body}>
      {MOCK && <p className="weekly-note">{t('Demo · Changes stay in this page until reload. Nothing is sent.')}</p>}
      <ol className="weekly-steps">{steps.map((label, i) => <li key={label} aria-current={i === step ? 'step' : undefined}><span>{i + 1}</span>{tm(label)}</li>)}</ol>
      <div className="weekly-heading"><div><span className="weekly-eyebrow">{t('{start} – {end}', { start: labelDate(source.dates[0]), end: labelDate(source.dates[6]) })}</span><h2>{tm(steps[step])}</h2><p>{step === 0 ? t('A little planning. More room for family.') : step === 1 ? t('Choose a few dinners and prepare for what’s coming.') : t('Review what will be added before saving.')}</p></div>
        <div className="weekly-family">{members.map(member => <div key={member.id}><Face m={member} /><small>{member.name}</small></div>)}</div>
      </div>
      {error && <div className="weekly-alert" role="alert"><p>{error}</p><button className="btn btn-secondary" disabled={busy} onClick={() => void refresh()}>{t('Refresh week and review')}</button></div>}
      {status && <p className="weekly-note" role="status">{status}</p>}
      {step === 0 && <div className="weekly-days">{planningDays(source).map(day => <article key={day.date} className={`weekly-day ${day.overlap || day.events.length >= 4 ? 'weekly-day-busy' : ''}`}>
        <span className="weekly-eyebrow">{labelDate(day.date)}</span><h3>{day.overlap ? t('Overlapping plans') : day.events.length >= 4 ? t('A fuller day') : day.events.length || day.tasks.length || day.jobs.length ? t('Coming up') : t('Room to breathe')}</h3>
        {day.events.map(event => <p key={`${event.id}:${event.start}`}><strong>{event.allDay ? t('All day') : formatTime(event.start, source.timezone)}</strong>{' · '}{event.title}<span className="weekly-event-people">{event.memberIds.map(id => members.find(m => m.id === id)?.name).filter(Boolean).join(', ')}</span></p>)}
        {day.meals.map(meal => <p key={meal.id}>{t('Meal: {name}', { name: meal.title })}</p>)}
        {draft.dinners.filter(choice => choice.date === day.date && isSwap(choice)).map(choice => <p key={choice.date}>{choice.kind === 'meal' && t('Swap planned: {name}', { name: choice.title })}</p>)}
        {day.tasks.map(task => <p key={task.id}>{t('To-do: {name}', { name: task.title })}</p>)}
        {source.pantry.filter(item => item.useBy === day.date).map(item => <p key={item.id}>{t('Use by today: {food}', { food: item.title })}</p>)}
        {day.jobs.map(job => <p key={job.id}>{job.date < source.weekStart ? t('Overdue: {name}', { name: job.title }) : t('Upkeep: {name}', { name: job.title })}</p>)}
        {source.features.meals && !day.meals.some(m => m.slot === 'dinner') && <p>{draft.dinners.some(m => m.date === day.date && m.kind === 'open') ? t('Dinner intentionally open') : draft.dinners.some(m => m.date === day.date) ? t('Dinner chosen in draft') : t('Dinner still open')}</p>}
        {!day.events.length && !day.tasks.length && !day.jobs.length && <p>{t('No commitments to juggle.')}</p>}
      </article>)}</div>}
      {step === 1 && <>
        {source.features.meals && <><h3>{t('Dinners')}</h3><div className="weekly-decisions">{source.dates.map(date => {
          const meals = source.meals.filter(m => m.date === date && m.slot === 'dinner'), choice = draft.dinners.find(m => m.date === date)
          return <article className="weekly-card" key={date}><span className="weekly-eyebrow">{labelDate(date)}</span>{meals.length ? <>{meals.map(meal => <div key={meal.id}>
            <h3>{meal.title}</h3><p>{t('Already on your meal plan.')}</p>
            {choice?.kind === 'meal' && choice.replaceMealId === meal.id && isSwap(choice) ? <>
              <p><strong>{t('Swap to: {name}', { name: choice.title })}</strong></p>
              <div className="weekly-swap-actions"><button className="btn btn-secondary" onClick={() => chooseDinner(date, meal.id)}>{t('Choose another meal')}</button>
              <button className="btn btn-secondary" onClick={() => dinner(date)}>{t('Keep {name}', { name: meal.title })}</button></div>
            </> : meal.canSwap ? <button className="btn btn-secondary" onClick={() => chooseDinner(date, meal.id)}>{t('Swap dinner')}</button> : <>
              <p className="weekly-note">{t('Change cooked meals, order nights and meals with their own calendar event in Meals.')}</p>
              <button className="btn btn-secondary" onClick={() => void openMeals()}>{t('Open Meals')}</button>
            </>}
          </div>)}</> : appliedDinner(date) ? <p>{t('A meal was already added from this plan. Make further changes in Meals.')}</p> : <>
            <label className="field">{t('Dinner')}<select className="settings-select" value={choice?.kind ?? 'later'} onChange={e => { if (e.target.value === 'meal') chooseDinner(date); else dinner(date, e.target.value === 'open' ? { date, kind: 'open' } : undefined) }}><option value="later">{t('Decide later')}</option><option value="open">{t('Leave dinner open on purpose')}</option><option value="meal">{t('Plan a meal')}</option></select></label>
            {choice?.kind === 'meal' && <><h3>{choice.title}</h3><button className="btn btn-secondary" onClick={() => chooseDinner(date)}>{t('Choose another meal')}</button></>}
          </>}</article>
        })}</div></>}
        {source.features.lists && <section className="weekly-prep"><h3>{t('Preparation')}</h3><p className="weekly-note">{t('Add a to-do linked to an event. Choose a due date; this does not schedule a timed alert.')}</p>
          {draft.prep.map(prep => <article className="weekly-card" key={prep.id}><h3>{prep.title}</h3><p>{t('Due {date} · {list}', { date: labelDate(prep.dueDate), list: source.lists.find(l => l.id === prep.listId)?.name ?? t('List unavailable') })}</p>{isNewPrep(prep) ? <button className="btn btn-secondary" onClick={() => change({ ...draft, prep: draft.prep.filter(p => p.id !== prep.id) })}>{t('Leave out of plan')}</button> : <p>{t('Already added to its to-do list.')}</p>}</article>)}
          {source.lists.length > 0 && source.events.length > 0 ? <button className="btn btn-secondary" onClick={() => setPrepOpen(true)}>{t('Add preparation')}</button> : <p>{source.lists.length === 0 ? t('Create a to-do list in Lists to add preparation here.') : t('Add an event to Calendar to plan preparation for it.')}</p>}
        </section>}
        {!source.features.meals && !source.features.lists && <p>{t('Meals and Lists are turned off. You can still look over the week ahead.')}</p>}
      </>}
      {step === 2 && <>
        <div className="weekly-highlight"><span aria-hidden="true">☀️</span><div><strong>{t('A plan you can come back to')}</strong><p>{tn(draft.dinners.filter(isNewMeal).length, '{n} dinner will be added to Meals.', '{n} dinners will be added to Meals.')}</p>{draft.dinners.some(isSwap) && <p>{tn(draft.dinners.filter(isSwap).length, '{n} dinner will be swapped.', '{n} dinners will be swapped.')}</p>}<p>{tn(draft.prep.filter(isNewPrep).length, '{n} preparation to-do will be added.', '{n} preparation to-dos will be added.')}</p></div></div>
        <div className="weekly-review">{source.features.meals && <article className="weekly-card"><h3>{t('Dinners')}</h3>{source.dates.map(date => {
          const meals = source.meals.filter(m => m.date === date && m.slot === 'dinner'), choice = draft.dinners.find(m => m.date === date)
          return <p key={date}><strong>{labelDate(date)}</strong>{' · '}{choice?.kind === 'meal' && isSwap(choice) ? t('Swap {before} → {after}', { before: meals.find(m => m.id === choice.replaceMealId)?.title ?? t('Dinner unavailable'), after: choice.title }) : meals.length ? t('Already planned: {name}', { name: meals.map(m => m.title).join(', ') }) : appliedDinner(date) ? t('Previously added. Check Meals for changes.') : choice?.kind === 'open' ? t('Intentionally open · decided') : choice?.kind === 'meal' ? t('Add: {name}', { name: choice.title }) : t('Still undecided')}</p>
        })}</article>}{source.features.lists && <article className="weekly-card"><h3>{t('Preparation')}</h3>{draft.prep.map(prep => <p key={prep.id}>{source.applied.prep[prep.id] ? t('Already added: {name}', { name: prep.title }) : t('Add: {name}', { name: prep.title })}<br />{t('Due {date} · {list}', { date: labelDate(prep.dueDate), list: source.lists.find(l => l.id === prep.listId)?.name ?? t('List unavailable') })}</p>)}{!draft.prep.length && <p>{t('No preparation to add.')}</p>}</article>}</div>
        {conflicts.map(conflict => <div className="weekly-alert" key={conflict.id}><p>{conflict.kind === 'dinner' ? t('Dinner changed or can no longer be swapped for {date}. Leave out this choice and review the current meal.', { date: labelDate(conflict.id) }) : t('A preparation event or list is no longer available. Leave this to-do out of the plan.')}</p><button className="btn btn-secondary" onClick={() => conflict.kind === 'dinner' ? dinner(conflict.id) : change({ ...draft, prep: draft.prep.filter(p => p.id !== conflict.id) })}>{t('Leave out of plan')}</button></div>)}
        <p className="weekly-note">{t('Save draft keeps these choices for later. Add to the week adds meals and to-dos, swaps the dinners shown above and remembers dinners left open. Other meals stay as they are. No pickup requests or timed alerts are sent.')}</p>
      </>}
    </div>
    {recipeDay && <MealPicker source={source} date={recipeDay} onClose={() => setRecipeDay(null)} onChoose={choice => { dinner(recipeDay, choice.kind === 'meal' && replaceMealId ? { ...choice, replaceMealId } : choice); setRecipeDay(null) }} />}
    {prepOpen && <PrepPicker source={source} onClose={() => setPrepOpen(false)} onAdd={prep => { change({ ...draft, prep: [...draft.prep, prep] }); setPrepOpen(false) }} />}
  </Sheet>
}

function MealPicker({ source, date, onClose, onChoose }: { source: WeeklyPlanning; date: string; onClose: () => void; onChoose: (choice: PlanningDinner) => void }) {
  const formId = useId()
  const [search, setSearch] = useState(''), [title, setTitle] = useState('')
  const suggested = new Set(source.suggestions.filter(s => s.uses.some(i => !i.useBy || date <= i.useBy)).map(r => r.id))
  return <Sheet title={t('Choose dinner for {date}', { date: labelDate(date) })} onClose={onClose} dirty={!!title.trim()}>
    <div className="weekly-meal-picker">
      <section className="weekly-picker-custom">
        <div className="field"><label htmlFor={`${formId}-dinner`}>{t('Plan something simple')}</label><input id={`${formId}-dinner`} aria-describedby={`${formId}-hint`} type="text" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} /><p className="field-hint" id={`${formId}-hint`}>{t('Leftovers, takeout, or anything without a recipe')}</p></div>
        <button className="btn btn-primary" disabled={!title.trim()} onClick={() => onChoose({ date, kind:'meal', title:title.trim() })}>{t('Use this dinner')}</button>
      </section>
      <section className="weekly-picker-recipes">
        <div className="field"><label htmlFor={`${formId}-search`}>{t('Or choose a recipe')}</label><input id={`${formId}-search`} type="search" value={search} onChange={e => setSearch(e.target.value)} /></div>
        <div className="weekly-recipe-list">{source.recipes.filter(r => r.name.toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a,b) => Number(suggested.has(b.id)) - Number(suggested.has(a.id))).map(recipe => {
      const suggestion = source.suggestions.find(s => s.id === recipe.id)
      const usable = suggestion?.uses.filter(i => !i.useBy || date <= i.useBy)
      return <button className="btn btn-secondary weekly-recipe" key={recipe.id} onClick={() => onChoose({ date,kind:'meal',title:recipe.name,recipeId:recipe.id })}><strong>{recipe.name}</strong>{recipe.totalMinutes != null && <span>{tn(recipe.totalMinutes, '{n} minute', '{n} minutes')}</span>}{usable?.map(item => <span key={`${item.title}:${item.useBy}`}>{t('Use {food} by {date}', { food:item.title,date:labelDate(item.useBy!) })}</span>)}</button>
        })}</div>
      </section>
    </div>
  </Sheet>
}
function PrepPicker({ source, onClose, onAdd }: { source: WeeklyPlanning; onClose: () => void; onAdd: (prep: PlanningPrep) => void }) {
  const formId = useId()
  const [event, setEvent] = useState<WeeklyPlanning['events'][number] | null>(null)
  const [title, setTitle] = useState(''), [dueDate, setDueDate] = useState(source.weekStart)
  const [listId, setListId] = useState(source.lists[0]?.id ?? '')
  const [pickingList, setPickingList] = useState(false)
  return <Sheet title={t('Prepare for an event')} onClose={onClose} dirty={!!event} actions={event && <button className="btn btn-primary" disabled={!title.trim() || !dueDate || !listId || dueDate > planningDay(event, source.timezone) || dueDate < shiftDay(source.weekStart, -7)} onClick={() => onAdd({ id:crypto.randomUUID(),eventId:event.id,occurrenceStart:event.occurrenceStart,title:title.trim(),dueDate,listId })}>{t('Add to draft')}</button>}>
    {!event ? <div className="weekly-recipe-list">{source.events.map(e => <button className="btn btn-secondary weekly-recipe" key={`${e.id}:${e.start}`} onClick={() => { setEvent(e); setTitle(t('Prepare for {event}', { event:e.title })); setDueDate(previousDay(planningDay(e,source.timezone))) }}><strong>{e.title}</strong><span>{labelDate(planningDay(e,source.timezone))}</span></button>)}</div> : <div className="weekly-prep-picker">
      <h3>{event.title}</h3>
      <div className="field"><label htmlFor={`${formId}-title`}>{t('What needs doing?')}</label><input id={`${formId}-title`} type="text" value={title} maxLength={200} onChange={e => setTitle(e.target.value)} /></div>
      <div className="field"><label htmlFor={`${formId}-date`}>{t('Due date')}</label><input id={`${formId}-date`} type="date" value={dueDate} min={shiftDay(source.weekStart, -7)} max={planningDay(event,source.timezone)} onChange={e => setDueDate(e.target.value)} /></div>
      <button className="btn btn-secondary" onClick={() => setPickingList(true)}>{t('To-do list: {name}', { name:source.lists.find(l => l.id === listId)?.name ?? t('Choose a list') })}</button>
      <p className="weekly-note">{t('This creates a linked to-do with a due date. It does not set a timed reminder.')}</p>
    </div>}
    {pickingList && <Sheet title={t('Choose a to-do list')} onClose={() => setPickingList(false)}><div className="weekly-recipe-list">{source.lists.map(list => <button key={list.id} className="btn btn-secondary" onClick={() => { setListId(list.id); setPickingList(false) }}>{list.name}</button>)}</div></Sheet>}
  </Sheet>
}
