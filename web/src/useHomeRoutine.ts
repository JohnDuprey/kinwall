import { useEffect, useState } from 'react'
import { api, getKey } from './api.ts'
import { routinePoller } from './routinePolling.ts'
import type { RoutineState } from './routineMode.ts'
export type HomeRoutine = { id: string; name: string; state: RoutineState; unavailable: boolean }

/** One read loop for Home, shared by the compact and full chore layouts. */
export function useHomeRoutine(members: { id: string; name: string }[], refreshTick: number): HomeRoutine[] {
  const [states, setStates] = useState<Record<string, { state: RoutineState; unavailable: boolean }>>({})
  const ids = members.map(m => m.id).join(',')
  useEffect(() => {
    let active = true
    const key = getKey()
    const poller = routinePoller(ids.split(',').filter(Boolean), async id => {
      try {
        const state = await api.getRoutineMode(id)
        if (active && key === getKey()) setStates(previous => ({ ...previous, [id]: { state, unavailable: false } }))
        return state
      } catch {
        if (active && key === getKey()) setStates(previous => previous[id] ? ({ ...previous, [id]: { ...previous[id], unavailable: true } }) : previous)
      }
    }, () => document.visibilityState === 'visible')
    void poller.refresh()
    const timer = setInterval(() => { void poller.poll() }, 15000)
    const visible = () => { if (document.visibilityState === 'visible') void poller.refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => { active = false; poller.stop(); clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [ids, refreshTick])
  return members.flatMap(member => states[member.id] ? [{ ...member, ...states[member.id]! }] : [])
}
