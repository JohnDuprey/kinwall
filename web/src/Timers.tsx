import { useEffect, useState, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'
import { announce } from './a11y.tsx'
import { IDLE_RESET_EVENT } from './App.tsx'
import { PauseIcon, PlayIcon, ResetIcon, TimerIcon, XIcon } from './icons.tsx'
import { timerActivity, timerName } from './liveActivity.ts'
import { endAppActivity, inNativeApp, tellAppActivity } from './native.ts'
import Sheet from './Sheet.tsx'
import {
  clock, dismissRung, durationLabel, getTimers, isRunning, pauseTimer, remaining, resetTimer, resumeTimer, ringDue,
  startTimer, stopTimer, subscribeTimers, type NewTimer, type Timer,
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
// running) the first tap anywhere.
let audio: AudioContext | null = null
function unlockSound() {
  try { audio ??= new AudioContext(); void audio.resume() } catch { /* no Web Audio: banner and vibration only */ }
}
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

/** Starts a timer from a tap (so it can beep) and says so. */
export function start(t: NewTimer) {
  unlockSound()
  startTimer(t)
  announce(`${t.label} timer started`)
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
    const up = ringDue(Date.now())
    if (!up.length) return
    beep(); navigator.vibrate?.([300, 150, 300])
    announce(`Timer done: ${up.map(t => [t.label, about(t)].filter(Boolean).join(', ')).join('; ')}`, true)
    // In another tab or app: a notification, if this device already allows them (never asks here).
    // Inside the iPhone/Android app the app rings them itself (the Live Activity's alarms).
    if (document.hidden && !inNativeApp() && 'Notification' in window && Notification.permission === 'granted') {
      void navigator.serviceWorker?.ready.then(reg => reg.showNotification(`Time's up: ${up.map(t => timerName(t.label)).join(', ')}`, { body: about(up[0]), tag: 'kinwall-timer' })).catch(() => {})
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

  const rang = timers.filter(t => t.done)
  if (!rang.length) return null
  return createPortal(
    <div className="timer-alarm">
      <span>⏰ Time's up: {rang.map(t => [t.label, about(t)].filter(Boolean).join(', ')).join('; ')}</span>
      <button type="button" className="btn" onClick={dismissRung}>OK</button>
    </div>,
    document.body,
  )
}

/** The timers that haven't rung, each with Pause/Resume, Reset and Cancel. */
export function TimerList({ timers, now, className = '' }: { timers: Timer[]; now: number; className?: string }) {
  return (
    <ul className={`timer-bar ${className}`} aria-label="Running timers">
      {timers.filter(t => !t.done).map(t => {
        const paused = t.left !== undefined, name = [t.label, t.detail].filter(Boolean).join(', ')
        return <li key={t.id}>
          <span className="timer-bar-label">{t.label}{about(t) && <small>{about(t)}</small>}</span>
          <strong className={`timer-clock ${paused ? 'timer-clock-paused' : ''}`}>{clock(remaining(t, now))}{paused && <span className="sr-only">, paused</span>}</strong>
          {paused
            ? <button type="button" className="icon-btn" aria-label={`Resume ${name} timer`} onClick={() => resumeTimer(t.id)}><PlayIcon width={18} height={18} /></button>
            : <button type="button" className="icon-btn" aria-label={`Pause ${name} timer`} onClick={() => pauseTimer(t.id)}><PauseIcon width={18} height={18} /></button>}
          <button type="button" className="icon-btn" aria-label={`Reset ${name} timer`} onClick={() => resetTimer(t.id)}><ResetIcon width={18} height={18} /></button>
          <button type="button" className="icon-btn" aria-label={`Cancel ${name} timer`} onClick={() => stopTimer(t.id)}><XIcon width={18} height={18} /></button>
        </li>
      })}
    </ul>
  )
}

const PRESETS = [1, 2, 5, 10, 15, 20, 30, 60]

/** Header button: a quick timer for homework, a chore, brushing teeth. While one runs it shows the
 * soonest one's time left. */
export function TimerButton() {
  const timers = useTimers()
  const [open, setOpen] = useState(false)
  const next = timers.filter(isRunning).sort((a, b) => a.endsAt - b.endsAt)[0]
  const now = useNow(!!next)
  useEffect(() => {
    const close = () => setOpen(false) // an idle wall goes back to the plain calendar; the timers keep going
    window.addEventListener(IDLE_RESET_EVENT, close)
    return () => window.removeEventListener(IDLE_RESET_EVENT, close)
  }, [])
  const left = next && clock(remaining(next, now))
  return (
    <>
      <button className={`icon-btn header-bell ${next ? 'header-timer-on' : ''}`} onClick={() => setOpen(true)} aria-label={next ? `Timers, ${timerName(next.label)} has ${left} left` : 'Timer'}>
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
    <Sheet title="Timers" onClose={onClose}>
      {waiting.length > 0 && <TimerList timers={waiting} now={now} className="timer-bar-stack" />}
      <div className="field">
        <label htmlFor="timer-name">Name (optional)</label>
        <input id="timer-name" type="text" value={name} maxLength={40} placeholder="Homework" onChange={e => setName(e.target.value)} />
      </div>
      <div className="chip-row timer-presets" role="group" aria-label="Start a timer">
        {PRESETS.map(m => <button key={m} type="button" className="chip" onClick={() => go(m)}>{durationLabel(m)}</button>)}
      </div>
      <form className="field timer-custom" onSubmit={e => { e.preventDefault(); if (valid) go(custom) }}>
        <label htmlFor="timer-minutes">Other time (minutes)</label>
        <div className="timer-custom-row">
          <input id="timer-minutes" type="text" inputMode="decimal" value={minutes} placeholder="25" onChange={e => setMinutes(e.target.value)} />
          <button type="submit" className="btn btn-primary" disabled={!valid}>Start</button>
        </div>
      </form>
    </Sheet>
  )
}
