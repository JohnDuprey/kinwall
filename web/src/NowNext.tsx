// Time-awareness helpers for the calendar: the Now / Next card and full-screen-ish transition
// warnings ("Soccer Practice in 10 minutes"). Both work from today's already-loaded instances.
import { useEffect, useRef, useState } from 'react'
import type { EventInstance, Settings } from './types.ts'
import { formatTime } from './date.ts'
import { announce } from './a11y.tsx'
import { inTimeWindow } from './useTheme.ts'

const MIN = 60000

/** Date.now(), refreshed every `ms`. */
function useNow(ms: number) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [ms])
  return now
}

/** "42 min" / "1 h 10 min" / "2 h". */
export function durationLabel(ms: number): string {
  const m = Math.max(1, Math.ceil(ms / MIN))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60), r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

const timed = (evs: EventInstance[]) => evs.filter(e => !e.allDay)

/** "Now: Soccer Practice · ends in 42 min" / "Next: Piano at 5:00 PM · in 1 h 10 min · leave by 4:40 PM".
 * `events` = today's timed + all-day instances; hidden when nothing is on or left today. */
export function NowNextCard({ events, tz }: { events: EventInstance[]; tz: string }) {
  const now = useNow(30000)
  const list = timed(events)
  const current = list.filter(e => Date.parse(e.start) <= now && now < Date.parse(e.end)).sort((a, b) => a.end.localeCompare(b.end))[0]
  const next = list.filter(e => Date.parse(e.start) > now).sort((a, b) => a.start.localeCompare(b.start))[0]

  // The card itself isn't a live region (it re-renders every 30 s); a screen reader hears the
  // countdown only once the next start or leave-by is 10 minutes out or less, once per minute.
  const target = next && (next.leaveAt && Date.parse(next.leaveAt) > now ? { at: Date.parse(next.leaveAt), what: `Leave for ${next.title}` } : { at: Date.parse(next.start), what: next.title })
  const mins = target ? Math.ceil((target.at - now) / MIN) : null
  const lastSaid = useRef<string | null>(null)
  useEffect(() => {
    if (!target || mins === null || mins > 10) return
    const msg = `${target.what} in ${mins} minute${mins === 1 ? '' : 's'}`
    if (msg !== lastSaid.current) { lastSaid.current = msg; announce(msg) }
  }, [target?.what, mins]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!current && !next) return null
  return (
    <section className="now-next" aria-label="Now and next">
      {current && (
        <div className="now-next-row">
          <span className="now-next-tag">Now</span>
          <span className="now-next-title">{current.title}</span>
          <span className="now-next-meta">· ends in {durationLabel(Date.parse(current.end) - now)}</span>
        </div>
      )}
      {next && (
        <div className="now-next-row">
          <span className="now-next-tag next">Next</span>
          <span className="now-next-title">{next.title}</span>
          <span className="now-next-meta">at {formatTime(next.start, tz)} · in {durationLabel(Date.parse(next.start) - now)}</span>
          {next.leaveAt && <span className="now-next-meta">· 🚗 leave by {formatTime(next.leaveAt, tz)}</span>}
        </div>
      )}
    </section>
  )
}

/** A soft two-note chime from Web Audio (no asset). Best effort: autoplay rules may block it. */
function chime() {
  try {
    const ctx = new AudioContext()
    const t = ctx.currentTime
    ;[523.25, 659.25].forEach((hz, i) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = hz
      gain.gain.setValueAtTime(0, t + i * 0.25)
      gain.gain.linearRampToValueAtTime(0.18, t + i * 0.25 + 0.04)
      gain.gain.exponentialRampToValueAtTime(0.001, t + i * 0.25 + 0.9)
      osc.connect(gain).connect(ctx.destination)
      osc.start(t + i * 0.25)
      osc.stop(t + i * 0.25 + 1)
    })
    setTimeout(() => ctx.close(), 1600)
  } catch { /* no audio */ }
}

const BANNER_MS = 30000

/** Shows a calm banner when an event (or its leave-by) is exactly one of `minutes` away. One at a
 * time, never during quiet hours, gone after 30 s or on tap. */
export function TransitionWarnings({ events, minutes, sound, settings }: { events: EventInstance[]; minutes: number[]; sound: boolean; settings: Settings }) {
  const now = useNow(15000)
  const fired = useRef(new Set<string>())
  const [banner, setBanner] = useState<{ msg: string; until: number } | null>(null)

  useEffect(() => {
    if (!minutes.length) return
    const quiet = !!settings.quietFrom && !!settings.quietTo && inTimeWindow(settings.quietFrom, settings.quietTo, new Date(now))
    for (const e of timed(events)) {
      const targets = [{ at: Date.parse(e.start), label: e.title }]
      if (e.leaveAt) targets.push({ at: Date.parse(e.leaveAt), label: `Leave for ${e.title}` })
      for (const t of targets) {
        for (const m of minutes) {
          const key = `${e.id}:${t.at}:${m}`
          const due = t.at - m * MIN
          // Inside the minute the warning is for; fired once, even if skipped (quiet/stacked).
          if (now < due || now >= due + MIN || fired.current.has(key)) continue
          fired.current.add(key)
          if (quiet || (banner && banner.until > now)) continue
          const msg = `${t.label} in ${m} minute${m === 1 ? '' : 's'}`
          setBanner({ msg, until: now + BANNER_MS })
          announce(msg)
          if (sound) chime()
        }
      }
    }
  }, [now, events, minutes.join(), sound]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!banner) return
    const id = setTimeout(() => setBanner(null), Math.max(0, banner.until - Date.now()))
    return () => clearTimeout(id)
  }, [banner])

  if (!banner) return null
  return (
    <button type="button" className="transition-banner" onClick={() => setBanner(null)} aria-label={`${banner.msg}. Dismiss`}>
      <span className="transition-banner-msg">{banner.msg}</span>
      <span className="transition-banner-hint" aria-hidden="true">Tap to dismiss</span>
    </button>
  )
}
