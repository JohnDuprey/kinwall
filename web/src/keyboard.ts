// The on-screen keyboard, app-wide. Android's web view shrinks the page when it opens (a 10" tablet on
// its side drops from ~690 to ~330 CSS px); an iPad's covers the page instead and only the visual
// viewport shrinks. Either way: it's up while something you type into has focus and the visible
// height fell well below the tallest seen at this width (a rotation changes the width). While it's
// up, <html> carries data-keyboard (the header, tab bar and rail give way, styles.css), --kbd, the
// px it covers at the bottom of the page (0 on Android, which resizes instead), and --kbd-top, how far
// an iPad scrolled the page up to show the field: a full-screen mode with top/bottom set to those
// fits the part you can see, like a sheet (Sheet.tsx). Pure helpers first,
// so node tests load them.
import { useSyncExternalStore } from 'react'

const NO_KEYS = new Set(['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image', 'hidden'])

/** Does focusing this element bring up the keyboard? Text fields, contenteditable, and an activity's
 * frame (its own fields are inside it). */
export function typesText(el: { tagName: string; type?: string; isContentEditable?: boolean } | null): boolean {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'TEXTAREA' || tag === 'IFRAME' || el.isContentEditable) return true
  return tag === 'INPUT' && !NO_KEYS.has((el.type || 'text').toLowerCase())
}

/** Up: typing, and the visible height is under 75% of the tallest seen at this width. */
export const keyboardUp = (typing: boolean, visible: number, tallest: number) => typing && visible < tallest * 0.75

/** Px the keyboard covers at the bottom of the layout viewport (an iPad); 0 when the page shrank. */
export const coveredPx = (layoutHeight: number, vvTop: number, vvHeight: number) => Math.max(0, Math.round(layoutHeight - vvTop - vvHeight))

let state = { up: false, covered: 0, top: 0 }
const listeners = new Set<() => void>()
const tallest = new Map<number, number>()

function check() {
  const vv = window.visualViewport
  if (!vv) return
  const root = document.documentElement
  const w = Math.round(innerWidth), most = Math.max(tallest.get(w) ?? 0, innerHeight, vv.height)
  tallest.set(w, most)
  const up = keyboardUp(typesText(document.activeElement as HTMLElement | null), vv.height, most)
  const covered = up ? coveredPx(root.clientHeight, vv.offsetTop, vv.height) : 0
  const top = up ? Math.max(0, Math.round(vv.offsetTop)) : 0 // an iPad scrolls the page up to the field
  if (up === state.up && covered === state.covered && top === state.top) return
  const was = state.up
  state = { up, covered, top }
  root.toggleAttribute('data-keyboard', up)
  root.style.setProperty('--kbd', `${covered}px`)
  root.style.setProperty('--kbd-top', `${top}px`)
  listeners.forEach(l => l())
  // The header and tabs just gave way (styles.css): keep the field where you can see it.
  if (up && !was) requestAnimationFrame(() => (document.activeElement as HTMLElement | null)?.scrollIntoView?.({ block: 'nearest' }))
}

let started = false
/** Starts watching (main.tsx, once). Focus changes settle a frame later, after the keyboard moves. */
export function watchKeyboard() {
  const vv = window.visualViewport
  if (started || !vv) return
  started = true
  const soon = () => requestAnimationFrame(check)
  vv.addEventListener('resize', check)
  vv.addEventListener('scroll', check)
  addEventListener('resize', check)
  addEventListener('focusin', soon)
  addEventListener('focusout', soon)
  addEventListener('blur', soon) // focus moved into an activity's frame
  addEventListener('focus', soon)
  check()
}

const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l) } }
const snapshot = () => state

/** { up, covered, top } for components that need it in JS (the activity player, layout media queries). */
export const useKeyboard = () => useSyncExternalStore(subscribe, snapshot, snapshot)
