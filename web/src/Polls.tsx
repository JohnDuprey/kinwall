// Family polls (docs/using/polls.md; server: routes/polls.ts). Polls have no tab of their own: an open
// poll is a card on the Board, the Polls button on Home's Board lists them all (and starts one), a
// poll tied to a meal shows in that Meals week cell, and the bell's "New poll" opens it
// (#/calendar?poll=<id>, handled in Calendar.tsx). Votes show who picked what, with avatars.
//
// Choices are typed ideas, or (with Meals on) recipes and restaurants from the binder.
//
// Who votes: a kid's own device only for that kid (the server checks too); a shared wall or a
// parent's device for anyone, after picking who. Parents start, close and delete polls; closing
// with Meals on offers "Plan it", which opens that meal (or a new one) with the winner filled in.
import { useCallback, useEffect, useId, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { Face } from './Face'
import { BookIcon, ChevronRight, MealIcon, PlusIcon, XIcon } from './icons.tsx'
import MealSheet, { RecipePicker, type MealDraft } from './MealSheet.tsx'
import { MEAL_SLOTS, SLOT_LABEL } from './meal-date.ts'
import { todayKeyInTz } from './date.ts'
import { leaders, planDraft, pollWhen, suggestedWinner, votedLabel, voteOf } from './polls.ts'
import type { Member, Poll, PollInput, PollOption } from './types.ts'
import type { Meal, MealSlot, Recipe, Restaurant } from './meal-types.ts'

const CHANGED = 'kinwall:polls'
/** Tells every poll card and sheet on this screen to read again (the rev poll catches other screens). */
const changed = () => window.dispatchEvent(new Event(CHANGED))

/** Polls, kept fresh: on a change here, on the app's refresh, and never while polls are off. */
export function usePolls(status?: Poll['status']): Poll[] {
  const { settings, refreshTick } = useApp()
  const on = settings.features.polls !== false
  const [polls, setPolls] = useState<Poll[]>([])
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    window.addEventListener(CHANGED, bump)
    return () => window.removeEventListener(CHANGED, bump)
  }, [])
  useEffect(() => {
    if (!on) return
    let canceled = false
    api.getPolls(status).then(p => { if (!canceled) setPolls(p) }).catch(() => { /* keep the last ones */ })
    return () => { canceled = true }
  }, [on, status, refreshTick, tick])
  return on ? polls : []
}

/** Small overlapping avatars of who picked a choice. */
function Voters({ ids, members }: { ids: string[]; members: Member[] }) {
  const who = members.filter(m => ids.includes(m.id))
  if (!who.length) return null
  return <span className="poll-voters" role="img" aria-label={`Voted: ${who.map(m => m.name).join(', ')}`}>{who.map(m => <Face key={m.id} m={m} />)}</span>
}

/** The Board's card for each open poll: the question, the choices with their votes, a tap to vote. */
export function PollsBoardCards() {
  const { members } = useApp()
  const polls = usePolls('open')
  const [open, setOpen] = useState<string | null>(null)
  // The sheet outlives the card: closing the poll takes the card away, not the sheet with Plan it.
  return <>
    {polls.slice(0, 2).map(p => {
      const top = new Set(leaders(p).map(o => o.id))
      return <section key={p.id} className="board-card board-poll" aria-label={`Poll: ${p.question}`}>
        <button type="button" className="board-poll-btn" aria-haspopup="dialog" onClick={() => setOpen(p.id)}>
          <span className="board-poll-head"><span aria-hidden="true">🗳</span> {pollWhen(p) ? `Poll · ${pollWhen(p)}` : 'Family poll'}<span className="board-poll-count">{votedLabel(p, members.length)}</span></span>
          <strong className="board-poll-q">{p.question}</strong>
          <span className="board-poll-options">{p.options.map(o => <span key={o.id} className={`board-poll-option ${top.has(o.id) ? 'lead' : ''}`}>
            <span className="board-poll-label">{top.has(o.id) && <span aria-label="In the lead">⭐ </span>}{o.label}</span>
            <Voters ids={o.votes} members={members} /><span className="board-poll-n">{o.votes.length}</span>
          </span>)}</span>
          <span className="board-poll-cta">Tap to vote</span>
        </button>
      </section>
    })}
    {open && <PollSheet id={open} onClose={() => setOpen(null)} />}
  </>
}

/** Home's Polls button (Board view): every poll, and New poll for parents. */
export function PollsButton() {
  const [open, setOpen] = useState(false)
  return <>
    <button type="button" className="btn btn-secondary polls-btn" aria-haspopup="dialog" aria-label="Family polls" onClick={() => setOpen(true)}><span aria-hidden="true">🗳</span><span className="polls-btn-label"> Polls</span></button>
    {open && <PollsSheet onClose={() => setOpen(false)} />}
  </>
}

export function PollsSheet({ onClose }: { onClose: () => void }) {
  const { members, parentDevice } = useApp()
  const polls = usePolls()
  const [open, setOpen] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  return <Sheet title="Family polls" onClose={onClose} actions={parentDevice ? <button className="btn btn-primary" onClick={() => setCreating(true)}><PlusIcon /> New poll</button> : undefined}>
    {!polls.length ? <p className="state-card">{parentDevice ? 'No polls yet. Ask the family something, like “Which movie tonight?”' : 'No polls yet. A parent can start one.'}</p>
      : <div className="sheet-links">{polls.map(p => {
        const winner = p.options.find(o => o.id === p.winnerOptionId)
        return <button key={p.id} type="button" className="sheet-link" aria-haspopup="dialog" onClick={() => setOpen(p.id)}>
          <span aria-hidden="true" className="poll-row-emoji">{p.status === 'open' ? '🗳' : '🏆'}</span>
          <span>{p.question}<small>{[pollWhen(p), p.status === 'open' ? `Open · ${votedLabel(p, members.length)}` : `Closed${winner ? ` · ${winner.label}` : ''}`].filter(Boolean).join(' · ')}</small></span>
          <ChevronRight />
        </button>
      })}</div>}
    {open && <PollSheet id={open} onClose={() => setOpen(null)} />}
    {creating && <NewPollSheet onClose={() => setCreating(false)} onCreated={p => { setCreating(false); setOpen(p.id) }} />}
  </Sheet>
}

/** One poll: vote (picking who first on a shared screen), see who picked what, and for parents
 * close it and plan the winner. */
export function PollSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { members, parentDevice, meMemberId, settings, toast, refreshTick } = useApp()
  const dialog = useDialog()
  const [poll, setPoll] = useState<Poll | null>(null)
  const [missing, setMissing] = useState(false)
  const [tick, setTick] = useState(0)
  // A member's own device votes only for them; a parent's device starts on its owner; a wall on nobody.
  const lockedTo = !parentDevice && meMemberId ? meMemberId : null
  const [who, setWho] = useState<string | null>(lockedTo ?? (parentDevice ? meMemberId : null))
  const [busy, setBusy] = useState(false)
  const [closing, setClosing] = useState<string | null>(null) // the winner picked while closing
  const [planning, setPlanning] = useState<{ meal: Meal | null; initial: MealDraft; recipes: Recipe[] } | null>(null)
  const meals = settings.features.meals
  useEffect(() => {
    const bump = () => setTick(t => t + 1)
    window.addEventListener(CHANGED, bump)
    return () => window.removeEventListener(CHANGED, bump)
  }, [])
  useEffect(() => {
    let canceled = false
    api.getPoll(id).then(p => { if (!canceled) setPoll(p) }).catch(() => { if (!canceled) setMissing(true) })
    return () => { canceled = true }
  }, [id, refreshTick, tick])
  const fail = (e: unknown, what: string) => toast(e instanceof Error ? e.message : `Could not ${what}.`, true)
  const name = (memberId: string) => members.find(m => m.id === memberId)?.name ?? 'Someone'

  if (missing) return <Sheet title="Family poll" onClose={onClose}><p className="state-card">This poll isn’t here anymore.</p></Sheet>
  if (!poll) return <Sheet title="Family poll" onClose={onClose}><p role="status">Loading…</p></Sheet>
  const open = poll.status === 'open'
  const mine = voteOf(poll, who)
  const winner = poll.options.find(o => o.id === poll.winnerOptionId)
  const tie = leaders(poll).length > 1

  const vote = async (o: PollOption) => {
    if (!who || busy) return
    const optionId = mine === o.id ? null : o.id // tapping your own vote again takes it back
    setBusy(true)
    try {
      setPoll(await api.votePoll(poll.id, who, optionId)); changed()
      if (!lockedTo && !parentDevice) { toast(optionId ? `${name(who)} voted for ${o.label}` : `${name(who)} took back their vote`); setWho(null) } // a shared wall: ready for the next person
    } catch (e) { fail(e, 'vote') } finally { setBusy(false) }
  }
  const close = async () => {
    setBusy(true)
    try { const p = await api.closePoll(poll.id, closing ?? undefined); setPoll(p); setClosing(null); changed(); toast(`Poll closed: ${p.options.find(o => o.id === p.winnerOptionId)?.label ?? 'no winner'}`) }
    catch (e) { fail(e, 'close the poll') } finally { setBusy(false) }
  }
  // Plan it: the meal it's tied to (linked before, or already planned in that slot) with the winner
  // filled in, else a new meal on the poll's day.
  const plan = async () => {
    if (!winner) return
    setBusy(true)
    try {
      const today = todayKeyInTz(settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone)
      const [recipes, places, dayMeals] = await Promise.all([api.getRecipes(true), winner.restaurantId ? api.getRestaurants() : Promise.resolve([]), poll.date ? api.getMeals(poll.date, poll.date) : Promise.resolve([] as Meal[])])
      const meal = dayMeals.find(m => m.id === poll.mealId) ?? dayMeals.find(m => m.slot === poll.slot) ?? null
      setPlanning({ meal, initial: planDraft(poll, winner, recipes, today, places), recipes })
    } catch (e) { fail(e, 'open the meal') } finally { setBusy(false) }
  }
  const planned = async (saved?: Meal) => {
    setPlanning(null)
    if (saved) try { setPoll(await api.updatePoll(poll.id, { mealId: saved.id })); changed() } catch (e) { fail(e, 'link the meal') }
  }
  const more = async (action: string) => {
    if (action !== 'delete' || !await dialog.confirm({ title: `Delete “${poll.question}”?`, body: 'The poll and everyone’s votes go away.', confirmLabel: 'Delete poll', danger: true })) return
    try { await api.deletePoll(poll.id); changed(); toast('Poll deleted'); onClose() } catch (e) { fail(e, 'delete the poll') }
  }

  const actions = parentDevice ? open
    ? closing === null ? <button className="btn btn-primary" disabled={busy} onClick={() => setClosing(suggestedWinner(poll)?.id ?? '')}>Close poll</button>
      : <><button className="btn btn-secondary" disabled={busy} onClick={() => setClosing(null)}>Keep voting</button><button className="btn btn-primary" disabled={busy || !closing} onClick={() => void close()}>Close poll</button></>
    : meals && winner ? <button className="btn btn-primary" disabled={busy} onClick={() => void plan()}>{poll.mealId ? 'Open the meal' : 'Plan it'}</button> : undefined
    : undefined
  return <Sheet title={poll.question} onClose={onClose} actions={actions}>
    <p className="poll-meta">{[pollWhen(poll), open ? votedLabel(poll, members.length) : 'Closed'].filter(Boolean).join(' · ')}</p>
    {open && (lockedTo ? <p className="poll-voting-as"><Face m={members.find(m => m.id === lockedTo) ?? { name: '?', color: 'var(--bg-alt)' }} /> Voting as {name(lockedTo)}</p>
      : <div className="poll-who">
        <p className="poll-who-label" id={`poll-who-${poll.id}`}>{who ? `Voting as ${name(who)}` : 'Who’s voting? Tap your name.'}</p>
        <div className="poll-who-row" role="group" aria-labelledby={`poll-who-${poll.id}`}>
          {members.map(m => <button key={m.id} type="button" className={`news-who-btn poll-who-btn ${who === m.id ? 'active' : ''}`} aria-pressed={who === m.id} onClick={() => setWho(m.id)}>
            <Face m={m} /><span>{m.name}</span>{voteOf(poll, m.id) && <span className="poll-who-done">✓ voted</span>}
          </button>)}
        </div>
      </div>)}
    {!open && winner && <p className="poll-winner"><span aria-hidden="true">🏆</span> Winner: <strong>{winner.label}</strong>{poll.mealId && meals && <> · <a href={`#/meals?meal=${encodeURIComponent(poll.mealId)}${poll.date ? `&date=${poll.date}` : ''}`} onClick={onClose}>planned</a></>}</p>}
    <ul className="poll-options" aria-label="Choices">
      {poll.options.map(o => {
        const picked = mine === o.id
        const body = <>
          <span className="poll-option-main">
            <span className="poll-option-label">{o.id === poll.winnerOptionId && <span aria-hidden="true">🏆 </span>}<ChoiceIcon c={o} /> {o.label}</span>
            <span className="poll-option-n">{o.votes.length} vote{o.votes.length === 1 ? '' : 's'}{picked && ' · Your vote ✓'}</span>
          </span>
          <Voters ids={o.votes} members={members} />
        </>
        return <li key={o.id}>{open && closing === null
          ? <button type="button" className="poll-option" aria-pressed={picked} disabled={!who || busy} onClick={() => void vote(o)}>{body}</button>
          : <div className={`poll-option ${o.id === poll.winnerOptionId ? 'winner' : ''}`}>{body}</div>}</li>
      })}
    </ul>
    {open && !who && !lockedTo && <p className="field-hint">Pick who’s voting, then tap a choice. Tap it again to take it back.</p>}
    {closing !== null && <div className="field poll-close">
      <label htmlFor={`poll-winner-${poll.id}`}>Winner</label>
      <select id={`poll-winner-${poll.id}`} value={closing} onChange={e => setClosing(e.target.value)}>
        {poll.options.map(o => <option key={o.id} value={o.id}>{o.label} ({o.votes.length} vote{o.votes.length === 1 ? '' : 's'})</option>)}
      </select>
      <p className="field-hint">{tie ? 'It’s a tie: pick the winner.' : 'The choice with the most votes is picked.'} Nobody can vote after it closes.</p>
    </div>}
    {parentDevice && closing === null && <div className="field poll-more">
      <label htmlFor={`poll-more-${poll.id}`} className="sr-only">More</label>
      <select id={`poll-more-${poll.id}`} className="settings-select" value="" onChange={e => void more(e.target.value)}>
        <option value="">More…</option><option value="delete">Delete poll</option>
      </select>
    </div>}
    {planning && <MealSheet meal={planning.meal} initial={planning.initial} recipes={planning.recipes} admin owner={null} onClose={() => setPlanning(null)} onSaved={saved => void planned(saved)} onRecipe={() => {}} />}
  </Sheet>
}

// A typed idea, or a recipe or restaurant (its id, with its name as the label).
type Choice = { key: string; label: string; recipeId?: string; restaurantId?: string }
const blank = (): Choice => ({ key: crypto.randomUUID(), label: '' })
const ChoiceIcon = ({ c }: { c: { recipeId?: string | null; restaurantId?: string | null } }) =>
  c.recipeId ? <BookIcon width={16} height={16} aria-label="Recipe" /> : c.restaurantId ? <MealIcon width={16} height={16} aria-label="Restaurant" /> : null

/** Starting a poll (parents): the question, the meal it decides (with Meals on), and the choices. */
export function NewPollSheet({ onClose, onCreated }: { onClose: () => void; onCreated: (poll: Poll) => void }) {
  const { settings, toast } = useApp()
  const formId = useId()
  const meals = settings.features.meals
  const [question, setQuestion] = useState('')
  const [date, setDate] = useState('')
  const [slot, setSlot] = useState<MealSlot>('dinner')
  const [choices, setChoices] = useState<Choice[]>(() => [blank(), blank()])
  const [recipes, setRecipes] = useState<Recipe[] | null>(null)
  const [places, setPlaces] = useState<Restaurant[] | null>(null)
  const [picking, setPicking] = useState<'recipe' | 'restaurant' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const loadError = (e: unknown) => setError(e instanceof Error ? e.message : 'Could not load the choices.')
  const pick = useCallback((what: 'recipe' | 'restaurant') => {
    setPicking(what)
    if (what === 'recipe' && !recipes) api.getRecipes().then(setRecipes, loadError)
    if (what === 'restaurant' && !places) api.getRestaurants().then(setPlaces, loadError)
  }, [recipes, places])
  const add = (c: Omit<Choice, 'key'>) => { setPicking(null); setChoices(cs => [...cs.filter(x => x.recipeId || x.restaurantId || x.label.trim()), { key: crypto.randomUUID(), ...c }]) }
  const filled = choices.filter(c => c.recipeId || c.restaurantId || c.label.trim())
  const save = async () => {
    if (!question.trim()) { setError('Ask a question.'); return }
    if (filled.length < 2) { setError('Add at least two choices.'); return }
    setBusy(true); setError('')
    const body: PollInput = { question: question.trim(), date: meals && date ? date : null, slot: meals && date ? slot : null, options: filled.map(c => ({ label: c.label.trim(), ...(c.recipeId ? { recipeId: c.recipeId } : {}), ...(c.restaurantId ? { restaurantId: c.restaurantId } : {}) })) }
    try { const p = await api.createPoll(body); changed(); toast('Poll started: everyone gets a notification'); onCreated(p) }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start the poll.') } finally { setBusy(false) }
  }
  const full = choices.length >= 12
  return <Sheet title="New poll" onClose={() => { if (!busy) onClose() }} dismissable={!busy} actions={<>
    <button className="btn btn-secondary" disabled={busy} onClick={onClose}>Cancel</button>
    <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? 'Starting…' : 'Start poll'}</button>
  </>}>
    <form id={formId} onSubmit={e => { e.preventDefault(); void save() }}>
      <fieldset className="meal-fieldset" disabled={busy}>
        <div className="field"><label htmlFor={`${formId}-q`}>Question</label><input id={`${formId}-q`} type="text" required maxLength={200} placeholder="Where are we eating Friday?" value={question} onChange={e => setQuestion(e.target.value)} /></div>
        {meals && <div className="meal-form-row">
          <div className="field"><label htmlFor={`${formId}-date`}>For a meal (optional)</label><input id={`${formId}-date`} type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="field"><label htmlFor={`${formId}-slot`}>Meal slot</label><select id={`${formId}-slot`} disabled={!date} value={slot} onChange={e => setSlot(e.target.value as MealSlot)}>{MEAL_SLOTS.map(s => <option key={s} value={s}>{SLOT_LABEL[s]}</option>)}</select></div>
        </div>}
        <fieldset className="poll-choices"><legend>Choices</legend>
          {choices.map((c, i) => <div key={c.key} className="poll-choice">
            {c.recipeId || c.restaurantId ? <span className="poll-choice-recipe"><ChoiceIcon c={c} /> {c.label}</span>
              : <input type="text" maxLength={120} aria-label={`Choice ${i + 1}`} placeholder={i === 0 ? 'Pizza night' : i === 1 ? 'Tacos' : 'Another idea'} value={c.label} onChange={e => setChoices(cs => cs.map(x => x.key === c.key ? { ...x, label: e.target.value } : x))} />}
            <button type="button" className="icon-btn" aria-label={`Remove ${c.label || `choice ${i + 1}`}`} disabled={choices.length <= 1} onClick={() => setChoices(cs => cs.filter(x => x.key !== c.key))}><XIcon /></button>
          </div>)}
          <div className="meal-actions poll-add">
            <button type="button" className="btn btn-secondary" disabled={full} onClick={() => setChoices(cs => [...cs, blank()])}><PlusIcon /> Add an idea</button>
            {meals && <button type="button" className="btn btn-secondary" aria-haspopup="dialog" disabled={full} onClick={() => pick('recipe')}><BookIcon /> Add a recipe</button>}
            {meals && <button type="button" className="btn btn-secondary" aria-haspopup="dialog" disabled={full} onClick={() => pick('restaurant')}><MealIcon /> Add a restaurant</button>}
          </div>
        </fieldset>
        {error && <p className="field-error" role="alert">{error}</p>}
      </fieldset>
    </form>
    {picking === 'recipe' && (recipes ? <RecipePicker recipes={recipes} currentId={null} saved={null} onClose={() => setPicking(null)} onPick={r => r && add({ label: r.name, recipeId: r.id })} />
      : <Sheet title="Choose a recipe" onClose={() => setPicking(null)}><p role="status">Loading recipes…</p></Sheet>)}
    {picking === 'restaurant' && <Sheet title="Choose a restaurant" onClose={() => setPicking(null)}>
      {!places ? <p role="status">Loading restaurants…</p> : !places.length ? <p className="state-card">No restaurants yet. Add the places you order from in Meals → Restaurants.</p>
        : <div className="sheet-links">{places.map(r => <button key={r.id} type="button" className="sheet-link" onClick={() => add({ label: r.name, restaurantId: r.id })}>
          <MealIcon /><span>{r.name}{r.cuisine && <small>{r.cuisine}</small>}</span>
        </button>)}</div>}
    </Sheet>}
  </Sheet>
}
