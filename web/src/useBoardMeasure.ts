import { useEffect, useLayoutEffect, useMemo, type RefObject } from 'react'

/** Coalesce resize notifications from a card, its rows and its siblings. Content changes can
 * measure before paint instead, replacing any resize measurement already queued for that frame. */
export function frameMeasure(measure: () => void, requestFrame: (callback: FrameRequestCallback) => number = requestAnimationFrame, cancelFrame: (id: number) => void = cancelAnimationFrame) {
  let frame: number | null = null
  const cancel = () => { if (frame !== null) { cancelFrame(frame); frame = null } }
  return {
    schedule() {
      if (frame !== null) return
      frame = requestFrame(() => { frame = null; measure() })
    },
    flush() { cancel(); measure() },
    cancel,
  }
}

/** Fit only new content before paint; fitting state must not trigger another synchronous fit.
 * Keep observers attached across renders and track siblings added or removed by conditional slots. */
export function useBoardMeasure(ref: RefObject<HTMLElement | null>, measure: () => void, content: unknown, enabled = true) {
  const queued = useMemo(() => frameMeasure(measure), [measure])
  useLayoutEffect(() => { queued.flush() }, [queued, content])
  useEffect(() => {
    const root = ref.current, card = root?.parentElement
    if (!enabled || !root || !card) return
    let active = true
    const schedule = () => { if (active) queued.schedule() }
    const resize = new ResizeObserver(schedule)
    let observed = new Set<Element>()
    const watch = () => {
      const next = new Set<Element>([root, card, ...card.children])
      for (const element of observed) if (!next.has(element)) resize.unobserve(element)
      for (const element of next) if (!observed.has(element)) resize.observe(element)
      observed = next
    }
    watch()
    const children = new MutationObserver(() => { watch(); schedule() })
    children.observe(card, { childList: true })
    return () => { active = false; children.disconnect(); resize.disconnect(); queued.cancel() }
  }, [ref, queued, enabled])
}
