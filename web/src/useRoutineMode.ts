import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from './AppContext.tsx'
import { api } from './api.ts'
import type { RoutineState } from './routineMode.ts'
import type { RoutineNativeStatus } from './routineDevices.ts'

/** Shared state for the routine overview and parent settings; the native shell verifies decisions. */
export function useRoutineMode() {
  const { members, parentDevice, meMemberId, refreshTick, toast, settings } = useApp()
  const children = members.filter(m => !m.grownUp)
  const [picked, setPicked] = useState(children.find(m => m.id === meMemberId)?.id ?? children[0]?.id ?? '')
  const memberId = parentDevice ? picked : meMemberId ?? ''
  // Keep each visited child's state and mounted editor separate. A save or late response for
  // Maya must neither replace Leo's form nor discard his pending edits.
  const [states, setStates] = useState<Record<string, RoutineState>>({})
  const state = states[memberId] ?? null
  const [errors, setErrors] = useState<Record<string, string>>({}), [busy, setBusy] = useState(false)
  const error = errors[memberId] ?? ''
  const setError = useCallback((message: string) => setErrors(previous => ({ ...previous, [memberId]: message })), [memberId])
  const [nativeStates, setNativeStates] = useState<Record<string, RoutineNativeStatus | null>>({})
  const native = nativeStates[memberId] ?? null
  const [nativeBusy, setNativeBusy] = useState(false)
  const setNative = useCallback((value: RoutineNativeStatus | null) => setNativeStates(previous => ({ ...previous, [memberId]: value })), [memberId])
  const post = useCallback((action: string, payload?: unknown) => {
    const w = window as Window & { webkit?: { messageHandlers?: { kinwall?: { postMessage(m: unknown): void } } } }
    const bridge = w.webkit?.messageHandlers?.kinwall
    if (!bridge) return
    if (action === 'chooseApps' || action === 'authorize') { setNativeBusy(true); setNativeStates(previous => ({ ...previous, [memberId]: null })) }
    bridge.postMessage({ type: 'routineMode', action, memberId, payload })
  }, [memberId])
  const generation = useRef(new Map<string, number>())
  const remember = useCallback((id: string, next: RoutineState) => {
    generation.current.set(id, (generation.current.get(id) ?? 0) + 1)
    setStates(previous => ({ ...previous, [id]: next }))
    setErrors(previous => ({ ...previous, [id]: '' }))
  }, [])
  const load = useCallback(async (id = memberId) => {
    if (!id) return
    const request = (generation.current.get(id) ?? 0) + 1
    generation.current.set(id, request)
    try { const next = await api.getRoutineMode(id); if (request === generation.current.get(id)) { setStates(previous => ({ ...previous, [id]: next })); setErrors(previous => ({ ...previous, [id]: '' })) } } catch (e) { if (request === generation.current.get(id)) setErrors(previous => ({ ...previous, [id]: String(e instanceof Error ? e.message : e) })) }
  }, [memberId])
  useEffect(() => { load(); const timer = setInterval(load, 15000); return () => clearInterval(timer) }, [load, refreshTick])
  useEffect(() => { if (state) post('sync', state) }, [state, post]) // hardware fetches its own decision; payload is simulator-only
  useEffect(() => {
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<RoutineNativeStatus>).detail
      const id = detail?.memberId ?? memberId // older clients do not tag responses
      if (!id || !detail) return
      setNativeStates(previous => ({ ...previous, [id]: detail }))
      if (detail.action === 'chooseApps' || detail.action === 'authorize') setNativeBusy(false)
    }
    window.addEventListener('kinwall:routine', changed)
    return () => window.removeEventListener('kinwall:routine', changed)
  }, [memberId])
  return { children, parentDevice, picked, setPicked, memberId, state, states, error, setError, busy, setBusy, nativeBusy, native, setNative, post, load, remember, settings, toast }
}
