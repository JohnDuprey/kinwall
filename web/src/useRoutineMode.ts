import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from './AppContext.tsx'
import { api } from './api.ts'
import type { RoutineState } from './routineMode.ts'

/** Shared state for the routine overview and parent settings; the native shell verifies decisions. */
export function useRoutineMode() {
  const { members, parentDevice, meMemberId, refreshTick, toast, settings } = useApp()
  const children = members.filter(m => !m.grownUp)
  const [picked, setPicked] = useState(children.find(m => m.id === meMemberId)?.id ?? children[0]?.id ?? '')
  const memberId = parentDevice ? picked : meMemberId ?? ''
  const [loaded, setLoaded] = useState<(RoutineState & { forMember: string }) | null>(null)
  const state = loaded?.forMember === memberId ? loaded : null
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const [native, setNative] = useState<{ simulator?: boolean; authorized?: boolean; appMode?: 'selected' | 'all'; selected?: number; locked?: boolean; allowedApps?: number; allowedWebsitesOnly?: boolean; error?: string } | null>(null)
  const post = useCallback((action: string, payload?: unknown) => {
    const w = window as Window & { webkit?: { messageHandlers?: { kinwall?: { postMessage(m: unknown): void } } } }
    w.webkit?.messageHandlers?.kinwall?.postMessage({ type: 'routineMode', action, memberId, payload })
  }, [memberId])
  const generation = useRef(0)
  const load = useCallback(async () => {
    if (!memberId) return
    const request = ++generation.current
    try { const next = await api.getRoutineMode(memberId); if (request === generation.current) { setLoaded({ ...next, forMember: memberId }); setError('') } } catch (e) { if (request === generation.current) setError(String(e instanceof Error ? e.message : e)) }
  }, [memberId, setLoaded, setError])
  useEffect(() => { load(); const timer = setInterval(load, 15000); return () => { clearInterval(timer); generation.current++ } }, [load, refreshTick])
  useEffect(() => { if (state) post('sync', state) }, [state, post]) // hardware fetches its own decision; payload is simulator-only
  useEffect(() => {
    const changed = (event: Event) => setNative((event as CustomEvent).detail)
    window.addEventListener('kinwall:routine', changed)
    return () => window.removeEventListener('kinwall:routine', changed)
  }, [])
  return { children, parentDevice, picked, setPicked, memberId, state, error, setError, busy, setBusy, native, setNative, post, load, settings, toast }
}
