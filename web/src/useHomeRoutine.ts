import { useEffect, useState } from 'react'
import { api, getKey } from './api.ts'
import type { RoutineState } from './routineMode.ts'
export type HomeRoutine = { id: string; name: string; state: RoutineState; unavailable: boolean }

/** One read loop for Home, shared by the compact and full chore layouts. */
export function useHomeRoutine(members: { id: string; name: string }[], refreshTick: number): HomeRoutine[] {
  const [states, setStates] = useState<Record<string, { state: RoutineState; unavailable: boolean }>>({})
  const ids = members.map(m => m.id).join(',')
  useEffect(() => {
    let active = true
    const key = getKey()
    const load = async () => {
      await Promise.all(ids.split(',').filter(Boolean).map(async id => {
        try {
          const state = await api.getRoutineMode(id)
          if (active && key === getKey()) setStates(previous => ({ ...previous, [id]: { state, unavailable: false } }))
        } catch {
          if (active && key === getKey()) setStates(previous => previous[id] ? ({ ...previous, [id]: { ...previous[id], unavailable: true } }) : previous)
        }
      }))
    }
    void load()
    const timer = setInterval(load, 15000)
    const visible = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', visible)
    return () => { active = false; clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [ids, refreshTick])
  return members.flatMap(member => states[member.id] ? [{ ...member, ...states[member.id]! }] : [])
}
