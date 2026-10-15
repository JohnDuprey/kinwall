import { useEffect, useReducer, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { announce } from './a11y.tsx'
import { IDLE_RESET_EVENT } from './App.tsx'
import { PauseIcon, PlayIcon, ResetIcon, TimerIcon, XIcon } from './icons.tsx'
import { timerActivity, timerName } from './liveActivity.ts'
import { endAppActivity, inNativeApp, tellAppActivity } from './native.ts'
import Sheet from './Sheet.tsx'
import { t } from './i18n.ts'
import {
  cancelTimer, chimeDue, choreOfTimer, clock, durationLabel, forgetCancel, lastCancelled, undoCancel, getTimers, isRunning, pauseTimer, phase, resetTimer, resumeTimer, ringDue,
  startTimer, stopTimer, subscribeTimers, timerWords, untilNext, type NewTimer, type Timer,
} from './timers.ts'

export const useTimers = () => useSyncExternalStore(subscribeTimers, getTimers)

/** The time now, every half second while `on`. */
export function useNow(on: boolean) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    if (!on) return
    const tick = setInterval(() => setNow(Date.now()), 500)
    return () => clearInterval(tick)
  }, [on])
  return now
}

// Browsers only allow sound after a tap: a timer's Start opens it, or (after a reload with timers
// running) the first tap anywhere. It's started inside the tap (that's what allows it) and suspended as
// soon as it has: a running AudioContext holds the iPhone's audio (AirPods switch to it, music
// elsewhere pauses), so it runs only while a beep plays.
let audio: AudioContext | null = null
let quiet: ReturnType<typeof setTimeout> | undefined
function unlockSound() {
  try { audio ??= new AudioContext(); void audio.resume().then(() => { if (!quiet) return audio?.suspend() }).catch(() => {}) } catch { /* no Web Audio: banner and vibration only */ }
}
/** Three loud beeps when a timer's up; `soft`: one quiet one when a range's time to check. */
function beep(soft = false) {
  if (!audio) return
  void audio.resume()
  for (let i = 0; i < (soft ? 1 : 3); i++) {
    const t = audio.currentTime + i * 0.35, osc = audio.createOscillator(), gain = audio.createGain()
    osc.frequency.value = soft ? 660 : 880
    gain.gain.setValueAtTime(0.0001, t); gain.gain.exponentialRampToValueAtTime(soft ? 0.12 : 0.3, t + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25)
    osc.connect(gain).connect(audio.destination); osc.start(t); osc.stop(t + 0.3)
  }
  clearTimeout(quiet)
  quiet = setTimeout(() => { quiet = undefined; void audio?.suspend() }, 1500)
}

/** Starts a timer from a tap (so it can beep) and says so. */
export function start(x: NewTimer) {
  unlockSound()
  startTimer(x)
  announce(t('{name} timer started', { name: x.label }))
}

const about = (t: Timer) => [t.title, t.detail].filter(Boolean).join(' · ')

const RING_AGAIN_MS = 5000

/** Every timer rings here, wherever the app is (cooking mode, a sheet, the night screen): sound,
 * vibration, a banner over everything, and a notification when the page is in the background.
 * Also the iPhone app's Live Activity for the soonest one. Mounted once, in App. */
export function TimerHost() {
  const timers = useTimers()
  const now = useNow(timers.some(isRunning))
  const any = timers.length > 0
  useEffect(() => {
    if (!any) return
    window.addEventListener('pointerdown', unlockSound, { once: true, capture: true })
    return () => window.removeEventListener('pointerdown', unlockSound, { capture: true })
  }, [any])
  useEffect(() => {
    // A range at its low end: a short, soft chime and "Check it"; it keeps running to its end.
    const check = chimeDue(Date.now())
    if (check.length) {
      beep(true); navigator.vibrate?.(150)
      announce(t('Check it: {timers}', { timers: check.map(x => [x.label, about(x)].filter(Boolean).join(', ')).join('; ') }))
      if (document.hidden && !inNativeApp() && 'Notification' in window && Notification.permission === 'granted') {
        void navigator.serviceWorker?.ready.then(reg => reg.showNotification(t('Check it: {timers}', { timers: check.map(x => timerName(x.label)).join(', ') }), { body: about(check[0]), tag: 'kinwall-timer-check', silent: true })).catch(() => {})
      }
    }
    const up = ringDue(Date.now())
    if (!up.length) return
    beep(); navigator.vibrate?.([300, 150, 300])
    announce(t('Timer done: {timers}', { timers: up.map(x => [x.label, about(x)].filter(Boolean).join(', ')).join('; ') }), true)
    // In another tab or app: a notification, if this device already allows them (never asks here).
    // Inside the iPhone/Android app the app rings them itself (the Live Activity's alarms).
    if (document.hidden && !inNativeApp() && 'Notification' in window && Notification.permission === 'granted') {
      void navigator.serviceWorker?.ready.then(reg => reg.showNotification(t("Time's up: {timers}", { timers: up.map(x => timerName(x.label)).join(', ') }), { body: about(up[0]), tag: 'kinwall-timer' })).catch(() => {})
    }
  }, [now, timers])
  // It keeps ringing, every few seconds, until someone taps OK.
  const ringing = timers.some(t => t.done)
  useEffect(() => {
    if (!ringing) return
    const again = setInterval(() => { beep(); navigator.vibrate?.([300, 150, 300]) }, RING_AGAIN_MS)
    return () => clearInterval(again)
  }, [ringing])
  // The soonest timer on the Lock Screen and in the Dynamic Island, "Done" once it rings, gone when dismissed.
  useEffect(() => {
    const a = timerActivity(timers.map(t => ({ ...t, paused: t.left !== undefined })))
    if (a) tellAppActivity('cooking', a); else endAppActivity('cooking')
  }, [timers])

  // Cancel's Undo, for a few seconds: here, over everything, so it works in cooking mode too.
  const gone = lastCancelled(), [, rerender] = useReducer((n: number) => n + 1, 0)
  useEffect(() => {
    if (!gone) return
    const forget = setTimeout(() => { forgetCancel(); rerender() }, 8000)
    return () => clearTimeout(forget)
  }, [gone])

  const rang = timers.filter(t => t.done)
  // The banner's height, so cooking mode moves down under it instead of hiding its ✕ (meals.css).
  useEffect(() => {
    const banner = document.querySelector<HTMLElement>('.timer-alarm'), root = document.documentElement.style
    if (!banner) { root.removeProperty('--alarm-h'); return }
    const fit = new ResizeObserver(() => root.setProperty('--alarm-h', `${banner.offsetHeight}px`))
    fit.observe(banner)
    return () => { fit.disconnect(); root.removeProperty('--alarm-h') }
  }, [rang.length > 0])
  // One recipe's timers don't need its name on each.
  const oneRecipe = rang.every(t => t.title && t.title === rang[0].title)
  const undo = gone && createPortal(
    <div className="toast toast-with-action timer-undo" role="status">{t('Timer canceled')}<button type="button" className="toast-action" onClick={() => { undoCancel(); announce(t('{name} timer back', { name: gone.label })) }}>{t('Undo')}</button></div>,
    document.body)
  if (!rang.length) return undo || null
  return <>{undo}{createPortal(
    <div className="timer-alarm">
      {/* A row and an OK each, so one can be silenced while another keeps ringing. */}
      {rang.map(x => <div key={x.id} className="timer-alarm-row">
        <span>⏰ {t("Time's up: {timers}", { timers: oneRecipe && rang.length > 1 ? x.label : [x.label, about(x)].filter(Boolean).join(', ') })}</span>
        {/* A chore's timer offers to mark it done: the Chores tab ticks it (who did it, a checklist, a parent's OK as usual). */}
        <div className="timer-alarm-actions">
          {choreOfTimer(x) && <button type="button" className="btn" onClick={() => { stopTimer(x.id); location.hash = `#/chores?done=${encodeURIComponent(choreOfTimer(x)!)}&sure=1` }}>{t('Mark done')}</button>}
          <button type="button" className="btn" aria-label={rang.length > 1 ? t('OK, {name}', { name: timerName(x.label) }) : undefined} onClick={() => stopTimer(x.id)}>{t('OK')}</button>
        </div>
      </div>)}
    </div>,
    document.body,
  )}</>
}

/** The timers that haven't rung, each with Pause/Resume, Reset and Cancel. `recipe`: cooking mode's,
 * whose name its own timers leave off (just the step). */
export function TimerList({ timers, now, className = '', recipe }: { timers: Timer[]; now: number; className?: string; recipe?: string }) {
  return (
    <ul className={`timer-bar ${className}`} aria-label={t('Running timers')}>
      {timers.filter(x => !x.done).map(x => {
        const paused = x.left !== undefined, name = [x.label, x.detail].filter(Boolean).join(', ')
        const [words, more] = timerWords(x, now), checking = phase(x, now) === 'check'
        return <li key={x.id} className={checking ? 'timer-checking' : undefined}>
          <span className="timer-bar-label">{words}{more && <small className="timer-more">{more}</small>}{(x.title === recipe ? x.detail : about(x)) && <small>{x.title === recipe ? x.detail : about(x)}</small>}</span>
          <strong className={`timer-clock ${paused ? 'timer-clock-paused' : ''}`}>{clock(untilNext(x, now))}{paused && <span className="sr-only">{t(', paused')}</span>}</strong>
          {/* A range past its check: it's ready when it looks ready. */}
          {checking && <button type="button" className="btn btn-secondary timer-done" aria-label={t('{name} is ready', { name })} onClick={() => stopTimer(x.id)}>{t('Ready')}</button>}
          {paused
            ? <button type="button" className="icon-btn" aria-label={t('Resume {name} timer', { name })} onClick={() => resumeTimer(x.id)}><PlayIcon width={18} height={18} /></button>
            : <button type="button" className="icon-btn" aria-label={t('Pause {name} timer', { name })} onClick={() => pauseTimer(x.id)}><PauseIcon width={18} height={18} /></button>}
          <button type="button" className="icon-btn" aria-label={t('Reset {name} timer', { name })} onClick={() => resetTimer(x.id)}><ResetIcon width={18} height={18} /></button>
          <button type="button" className="icon-btn timer-cancel" aria-label={t('Cancel {name} timer', { name })} onClick={() => cancelTimer(x.id)}><XIcon width={18} height={18} /></button>
        </li>
      })}
    </ul>
  )
}

const PRESETS = [0.5, 1, 2, 5, 10, 15, 20, 30, 60]

/** Header button: a quick timer for homework, a chore, brushing teeth. While one runs it shows the
 * soonest one's time left. */
export function TimerButton() {
  const timers = useTimers()
  const [open, setOpen] = useState(false)
  const now = useNow(timers.some(isRunning))
  const next = timers.filter(isRunning).sort((a, b) => untilNext(a, now) - untilNext(b, now))[0]
  useEffect(() => {
    const close = () => setOpen(false) // an idle wall goes back to the plain calendar; the timers keep going
    window.addEventListener(IDLE_RESET_EVENT, close)
    return () => window.removeEventListener(IDLE_RESET_EVENT, close)
  }, [])
  const left = next && clock(untilNext(next, now))
  return (
    <>
      <button className={`icon-btn header-bell ${next ? 'header-timer-on' : ''}`} onClick={() => setOpen(true)} aria-label={next ? t('Timers, {name} has {time} left', { name: timerName(next.label), time: left! }) : t('Timer')}>
        <TimerIcon width={22} height={22} />
        {next && <span className="header-timer-clock" aria-hidden="true">{left}</span>}
      </button>
      {open && <TimerSheet onClose={() => setOpen(false)} />}
    </>
  )
}

function TimerSheet({ onClose }: { onClose: () => void }) {
  const timers = useTimers()
  const now = useNow(timers.some(isRunning))
  const [name, setName] = useState('')
  const [minutes, setMinutes] = useState('')
  const custom = Number(minutes.replace(',', '.'))
  const valid = custom > 0 && custom <= 24 * 60
  const go = (min: number) => {
    const dur = durationLabel(min)
    start({ label: name.trim() ? `${name.trim()} · ${dur}` : dur, seconds: Math.round(min * 60) })
    setName(''); setMinutes('')
  }
  const waiting = timers.filter(t => !t.done)
  return (
    <Sheet title={t('Timers')} onClose={onClose}>
      {waiting.length > 0 && <TimerList timers={waiting} now={now} className="timer-bar-stack" />}
      <div className="field">
        <label htmlFor="timer-name">{t('Name (optional)')}</label>
        <input id="timer-name" type="text" value={name} maxLength={40} placeholder={t('Pasta, reading…')} onChange={e => setName(e.target.value)} />
      </div>
      <div className="chip-row timer-presets" role="group" aria-label={t('Start a timer')}>
        {PRESETS.map(m => <button key={m} type="button" className="chip" onClick={() => go(m)}>{durationLabel(m)}</button>)}
      </div>
      <form className="field timer-custom" onSubmit={e => { e.preventDefault(); if (valid) go(custom) }}>
        <label htmlFor="timer-minutes">{t('Other time (minutes)')}</label>
        <div className="timer-custom-row">
          <input id="timer-minutes" type="text" inputMode="decimal" value={minutes} placeholder="25" onChange={e => setMinutes(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={!valid} aria-describedby={valid ? undefined : 'timer-start-hint'}>{t('Start')}</button>
        </div>
        {!valid && <p id="timer-start-hint" className="field-hint">{minutes.trim() ? t('Type a number of minutes, up to 1440 (a day).') : t('Type how many minutes to start it, or tap a time above.')}</p>}
      </form>
    </Sheet>
  )
}
