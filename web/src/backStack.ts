// Android's Back button in the Kinwall app: the app (kinwall-mobile src/WebShell.tsx) dispatches a
// cancelable `kinwall:back` event on window before doing anything itself. The topmost open overlay
// (a Sheet, shopping mode, cooking mode, Get stuff done, an activity, the Night screen) closes the
// way its own ✕ or Escape would, unsaved-changes question included, and the event is canceled so the
// app neither goes back nor leaves. With nothing open it isn't canceled, and the app goes back.
// Overlays register in mount order, so one opened over another is on top. Pure part first (tested).
import { useEffect, useRef } from 'react'

export const BACK_EVENT = 'kinwall:back'

export function createBackStack() {
  const open: (() => void)[] = []
  return {
    /** An overlay opened; returns its removal. */
    push(close: () => void): () => void {
      open.push(close)
      return () => { const i = open.lastIndexOf(close); if (i >= 0) open.splice(i, 1) }
    },
    /** Back: closes the top one. False when nothing is open. */
    back(): boolean {
      const top = open[open.length - 1]
      if (!top) return false
      top()
      return true
    },
  }
}

export const backStack = createBackStack()
if (typeof window !== 'undefined') window.addEventListener(BACK_EVENT, e => { if (backStack.back()) e.preventDefault() })

/** While `open`, Back calls the latest `close`. */
export function useBackClose(close: () => void, open = true) {
  const ref = useRef(close)
  ref.current = close
  useEffect(() => (open ? backStack.push(() => ref.current()) : undefined), [open])
}
