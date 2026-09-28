import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { announce } from './a11y.tsx'
import { saveStep, savedStep, stepIngredients, stepTimers } from './cooking.ts'
import { CheckIcon, ChevronLeft, ChevronRight, XIcon } from './icons.tsx'
import { servingsLabel } from './meal-date.ts'
import type { Recipe, RecipeStep } from './meal-types.ts'
import { IngredientList } from './RecipeSheet.tsx'
import RecipePhoto from './RecipePhoto.tsx'
import { holdAwake } from './wakeLock.ts'

interface Timer { id: number; label: string; step: number; endsAt: number; done: boolean }

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`
}

// Created on the first timer's tap (browsers only allow sound after a user gesture).
let audio: AudioContext | null = null
function beep() {
  if (!audio) return
  void audio.resume()
  for (let i = 0; i < 3; i++) {
    const t = audio.currentTime + i * 0.35, osc = audio.createOscillator(), gain = audio.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
    osc.connect(gain).connect(audio.destination); osc.start(t); osc.stop(t + 0.3)
  }
}

/** Full-screen cooking: one step at a time in big type, its ingredients (scaled to `servings`) and
 * timers. Back/Next, swipes or arrow keys move; the step is remembered per recipe on this device. */
export default function CookingMode({ recipe, steps, servings, onClose }: { recipe: Recipe; steps: RecipeStep[]; servings: number; onClose: () => void }) {
  const titleId = useId(), drawerId = useId()
  const [index, setIndex] = useState(() => Math.min(savedStep(recipe.id), steps.length - 1))
  const [showAll, setShowAll] = useState(false)
  const [timers, setTimers] = useState<Timer[]>([])
  const [now, setNow] = useState(Date.now)
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
    holdAwake('cooking-mode', true)
    const behind = [...document.querySelectorAll<HTMLElement>('.app-shell, .sheet-backdrop')]
    behind.forEach(el => el.setAttribute('inert', ''))
    document.documentElement.dataset.cooking = '' // hides the update banner, which sits in the (now inert) app behind
    heading.current?.focus({ preventScroll: true })
    return () => { holdAwake('cooking-mode', false); behind.forEach(el => el.removeAttribute('inert')); delete document.documentElement.dataset.cooking; opener?.focus?.({ preventScroll: true }) }
  }, [opener])

  const keys = useRef<(e: KeyboardEvent) => void>(() => {})
  keys.current = e => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
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

  // Timers keep running across steps; each rings once (sound, vibration, banner) when it's up.
  const running = timers.some(t => !t.done)
  useEffect(() => {
    if (!running) return
    const tick = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(tick)
  }, [running])
  useEffect(() => {
    const up = timers.filter(t => !t.done && t.endsAt <= now)
    if (!up.length) return
    setTimers(ts => ts.map(t => up.some(u => u.id === t.id) ? { ...t, done: true } : t))
    beep(); navigator.vibrate?.([300, 150, 300])
    announce(`Timer done: ${up.map(t => `${t.label}, step ${t.step + 1}`).join('; ')}`, true)
  }, [now, timers])
  const start = (label: string, seconds: number) => {
    try { audio ??= new AudioContext(); void audio.resume() } catch { /* no Web Audio: banner and vibration only */ }
    const at = Date.now()
    setNow(at)
    setTimers(ts => [...ts, { id: at, label, step: index, endsAt: at + seconds * 1000, done: false }])
    announce(`${label} timer started`)
  }
  const stop = (id: number) => setTimers(ts => ts.filter(t => t.id !== id))
  const rang = timers.filter(t => t.done)

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
    <IngredientList recipe={{ ...recipe, ingredients: used }} servings={servings} />
  </section>
  return createPortal(
    <div className={`cook-mode ${rang.length ? 'cook-ringing' : ''}`} role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <header className="cook-bar">
        <button type="button" className="icon-btn" aria-label="Exit cooking mode" onClick={onClose}><XIcon width={24} height={24} /></button>
        <h2 id={titleId} className="cook-title">{recipe.name}</h2>
        <button type="button" ref={allBtn} className="btn btn-secondary cook-all-btn" aria-expanded={showAll} aria-controls={drawerId} onClick={() => showAll ? closeDrawer() : openDrawer()}>All ingredients</button>
      </header>
      <div className="cook-progress" aria-hidden="true"><div style={{ width: `${(index + 1) / steps.length * 100}%` }} /></div>
      {rang.length > 0 && <div className="cook-alarm">
        <span>⏰ Time's up: {rang.map(t => `${t.label} (step ${t.step + 1})`).join(', ')}</span>
        <button type="button" className="btn btn-primary" onClick={() => setTimers(ts => ts.filter(t => !t.done))}>OK</button>
      </div>}
      {running && <ul className="cook-timer-bar" aria-label="Running timers">
        {timers.filter(t => !t.done).map(t => <li key={t.id}>
          <span>Step {t.step + 1} · {t.label}</span><strong className="cook-clock">{clock(t.endsAt - now)}</strong>
          <button type="button" className="icon-btn" aria-label={`Cancel ${t.label} timer, step ${t.step + 1}`} onClick={() => stop(t.id)}><XIcon width={18} height={18} /></button>
        </li>)}
      </ul>}
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
                const on = timers.find(t => !t.done && t.step === index && t.label === d.label)
                return <button key={d.label} type="button" className="cook-timer-chip" disabled={!!on} aria-label={on ? undefined : `Start ${d.label} timer`} onClick={() => start(d.label, d.seconds)}>
                  ⏱ {on ? <>{d.label} · {clock(on.endsAt - now)} left</> : d.label}
                </button>
              })}</div>}
            </div>}
            {!step.imageUrl && ingredients}
            {step.text && <p className="cook-step-text">{step.text}</p>}
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
    </div>,
    document.body,
  )
}
