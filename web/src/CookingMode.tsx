import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { announce } from './a11y.tsx'
import { cookingSteps, saveStep, savedStep, stepIngredients, stepTimers } from './cooking.ts'
import { CheckIcon, ChevronLeft, ChevronRight, XIcon } from './icons.tsx'
import { servingsLabel } from './meal-date.ts'
import type { Recipe, RecipeStep } from './meal-types.ts'
import { IngredientList } from './RecipeSheet.tsx'
import RecipePhoto from './RecipePhoto.tsx'
import { holdAwake } from './wakeLock.ts'
import { start, TimerList, useNow, useTimers } from './Timers.tsx'
import { clock, isRunning, remaining } from './timers.ts'

/** Full-screen cooking: one step at a time in big type, its ingredients (scaled to `servings`) and
 * timers. Back/Next, swipes or arrow keys move; the step is remembered per recipe on this device.
 * A step's ingredient made from a basic (found in `library`) has "Make it": the basic's own cooking
 * mode opens on top, and closing it comes back to this step. Timers are the app's (Timers.tsx):
 * they keep running, and ring, after cooking mode closes. */
export default function CookingMode({ recipe, steps, servings, library = [], onClose }: { recipe: Recipe; steps: RecipeStep[]; servings: number; library?: Recipe[]; onClose: () => void }) {
  const titleId = useId(), drawerId = useId()
  const [index, setIndex] = useState(() => Math.min(savedStep(recipe.id), steps.length - 1))
  const [showAll, setShowAll] = useState(false)
  const timers = useTimers()
  const now = useNow(timers.some(isRunning))
  const [basic, setBasic] = useState<Recipe | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const heading = useRef<HTMLHeadingElement>(null)
  const backBtn = useRef<HTMLButtonElement>(null)
  const nextBtn = useRef<HTMLButtonElement>(null)
  const allBtn = useRef<HTMLButtonElement>(null)
  const drawer = useRef<HTMLDivElement>(null)
  const swipe = useRef<{ x: number; y: number } | null>(null)
  const [opener] = useState(() => document.activeElement as HTMLElement | null)
  const step = steps[index], last = index === steps.length - 1

  const go = (to: number) => {
    const i = Math.max(0, Math.min(steps.length - 1, to))
    if (i === index) return
    if (i === 0 && document.activeElement === backBtn.current) nextBtn.current?.focus() // Back is about to be disabled
    setIndex(i); saveStep(recipe.id, i)
    announce(`Step ${i + 1} of ${steps.length}. ${[steps[i].title, steps[i].text].filter(Boolean).join('. ')}`)
  }
  const finish = () => { saveStep(recipe.id, null); onClose() }

  // Screen on, the recipe sheet and app behind out of reach, focus in; all undone on the way out.
  useEffect(() => {
    holdAwake(`cooking-mode:${recipe.id}`, true)
    // Only what isn't inert yet: a basic's cooking mode over this one leaves this one's setup alone.
    const behind = [...document.querySelectorAll<HTMLElement>('.app-shell, .sheet-backdrop, .cook-mode')].filter(el => el !== root.current && !el.hasAttribute('inert'))
    behind.forEach(el => el.setAttribute('inert', ''))
    const ownsMode = !('fullscreenMode' in document.documentElement.dataset)
    document.documentElement.dataset.fullscreenMode = '' // hides the update banner, which sits in the (now inert) app behind
    heading.current?.focus({ preventScroll: true })
    return () => { holdAwake(`cooking-mode:${recipe.id}`, false); behind.forEach(el => el.removeAttribute('inert')); if (ownsMode) delete document.documentElement.dataset.fullscreenMode; opener?.focus?.({ preventScroll: true }) }
  }, [opener, recipe.id])

  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = e => {
    if (basic || e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'Escape') { e.preventDefault(); if (showAll) closeDrawer(); else onClose() }
    else if (!showAll && e.key === 'ArrowRight') { e.preventDefault(); go(index + 1) }
    else if (!showAll && e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1) }
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keys.current(e)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const openDrawer = () => { setShowAll(true); setTimeout(() => drawer.current?.focus()) }
  const closeDrawer = () => { setShowAll(false); allBtn.current?.focus() }

  const stepLine = (i: number) => `Step ${i + 1}${steps[i]?.title ? ` · ${steps[i].title}` : ''}`
  const timerKey = (label: string) => `${recipe.id}:${index}:${label}`

  const onPointerDown = (e: ReactPointerEvent) => { swipe.current = e.pointerType === 'mouse' ? null : { x: e.clientX, y: e.clientY } }
  const onPointerUp = (e: ReactPointerEvent) => {
    if (!swipe.current) return
    const dx = e.clientX - swipe.current.x, dy = e.clientY - swipe.current.y
    swipe.current = null
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1))
  }

  const used = stepIngredients(step, recipe.ingredients)
  const durations = stepTimers(step)
  const ingredients = used.length > 0 && <section className="cook-ingredients" aria-label="This step's ingredients">
    <h4>This step's ingredients</h4>
    <IngredientList recipe={{ ...recipe, ingredients: used }} servings={servings} makeIt onBasic={id => setBasic(library.find(r => r.id === id) ?? null)} />
  </section>
  // A basic without steps still opens, on one step that points at its ingredients.
  const basicSteps = basic ? cookingSteps(basic) : []
  return createPortal(
    <div ref={root} className="cook-mode" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="cook-bar">
        <button type="button" className="icon-btn" aria-label="Exit cooking mode" onClick={onClose}><XIcon width={24} height={24} /></button>
        <h2 id={titleId} className="cook-title">{recipe.name}</h2>
        <button type="button" ref={allBtn} className="btn btn-secondary cook-all-btn" aria-expanded={showAll} aria-controls={drawerId} onClick={() => showAll ? closeDrawer() : openDrawer()}>All ingredients</button>
      </header>
      <div className="cook-progress" aria-hidden="true"><div style={{ width: `${(index + 1) / steps.length * 100}%` }} /></div>
      {/* Every running timer, a quick one from the header too: the app's header is out of view here. */}
      {timers.some(t => !t.done) && <TimerList timers={timers} now={now} className="cook-timer-bar" />}
      <div className="cook-main scroll-y" onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={() => { swipe.current = null }}>
        <div className="cook-step">
          {/* This step's ingredients right under the photo (beside the text when there's room), so they're in view without scrolling. */}
          {step.imageUrl && <div className="cook-step-side">
            <RecipePhoto key={index} id={recipe.id} step={{ n: index + 1, v: recipe.updatedAt }} className="cook-photo" />
            {ingredients}
          </div>}
          <div className="cook-step-body">
            <div className="cook-step-head">
              <h3 ref={heading} tabIndex={-1} className="cook-step-num">Step {index + 1} of {steps.length}</h3>
              {index > 0 && <button type="button" className="link-btn" onClick={() => go(0)}>Start over</button>}
            </div>
            {/* The step's timers sit on its title line, where you look first. */}
            {(step.title || durations.length > 0) && <div className="cook-title-row">
              {step.title && <h4 className="cook-step-title">{step.title}</h4>}
              {durations.length > 0 && <div className="cook-timers">{durations.map(d => {
                const on = timers.find(t => !t.done && t.key === timerKey(d.label))
                return <button key={d.label} type="button" className="cook-timer-chip" disabled={!!on} aria-label={on ? undefined : `Start ${d.label} timer`} onClick={() => start({ label: d.label, seconds: d.seconds, title: recipe.name, detail: stepLine(index), key: timerKey(d.label) })}>
                  ⏱ {on ? <>{d.label} · {clock(remaining(on, now))} {on.left !== undefined ? 'paused' : 'left'}</> : d.label}
                </button>
              })}</div>}
            </div>}
            {!step.imageUrl && ingredients}
            {step.text && <p className={`cook-step-text ${step.text.length > 200 ? 'long' : ''}`}>{step.text}</p>}
            {step.bullets.length > 0 && <ul className="cook-bullets">{step.bullets.map((b, i) => <li key={i}>{b}</li>)}</ul>}
          </div>
        </div>
      </div>
      <footer className="cook-nav">
        <button type="button" ref={backBtn} className="btn btn-secondary" disabled={index === 0} onClick={() => go(index - 1)}><ChevronLeft width={24} height={24} /> Back</button>
        <button type="button" ref={nextBtn} className="btn btn-primary" onClick={() => last ? finish() : go(index + 1)}>
          {last ? <><CheckIcon width={24} height={24} /> Done</> : <>Next <ChevronRight width={24} height={24} /></>}
        </button>
      </footer>
      {showAll && <div className="cook-drawer scroll-y" id={drawerId} ref={drawer} tabIndex={-1} role="region" aria-label="All ingredients">
        <div className="cook-drawer-head">
          <h3>All ingredients <small>{servingsLabel(servings)}</small></h3>
          <button type="button" className="icon-btn" aria-label="Close ingredients" onClick={closeDrawer}><XIcon width={20} height={20} /></button>
        </div>
        <IngredientList recipe={recipe} servings={servings} />
      </div>}
      {basic && <CookingMode key={basic.id} recipe={basic} steps={basicSteps.length ? basicSteps : [{ text: 'No steps written yet. Its ingredients are under All ingredients.', bullets: [] }]} servings={basic.defaultServings} library={library} onClose={() => setBasic(null)} />}
    </div>,
    document.body,
  )
}
