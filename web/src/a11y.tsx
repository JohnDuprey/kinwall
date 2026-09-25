// Shared accessibility plumbing: screen-reader announcements, arrow-key movement inside picker
// rows, label <-> field wiring for the `.field` pattern, the segmented control, roving focus for
// the calendar's day cells, and keyboard activation for tappable non-button elements.
import { useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// Two hidden live regions created at load, before any content: a region that is inserted along
// with its text is often not read, so messages always go into these long-lived ones. Reused by id,
// so a dev hot-reload of this module doesn't stack up duplicates (or double listeners, below).
const firstLoad = typeof document !== 'undefined' && !document.getElementById('kw-live-status')
function region(role: 'status' | 'alert') {
  const existing = document.getElementById(`kw-live-${role}`)
  if (existing) return existing
  const el = document.createElement('div')
  el.id = `kw-live-${role}`
  el.className = 'sr-only'
  el.setAttribute('role', role)
  el.setAttribute('aria-live', role === 'alert' ? 'assertive' : 'polite')
  document.body.appendChild(el)
  return el
}
const regions = typeof document !== 'undefined' ? { polite: region('status'), assertive: region('alert') } : null

/** Reads `msg` to screen readers without showing anything. Clearing first lets the same text
 * (e.g. two "Saved"s in a row) be read again. */
export function announce(msg: string, urgent = false) {
  const el = regions?.[urgent ? 'assertive' : 'polite']
  if (!el) return
  el.textContent = ''
  setTimeout(() => { el.textContent = msg }, 60)
}

const NAV_KEYS = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End']

/** Moves focus to the previous/next/first/last `selector` inside `container` for an arrow/Home/End
 * key. Returns the newly focused element, or null when the key wasn't a navigation key. */
function stepFocus(e: { key: string; target: EventTarget | null; preventDefault(): void }, container: Element, selector: string): HTMLElement | null {
  if (!NAV_KEYS.includes(e.key)) return null
  const items = [...container.querySelectorAll<HTMLElement>(selector)]
  const i = items.indexOf(e.target as HTMLElement)
  if (i < 0) return null
  const back = e.key === 'ArrowLeft' || e.key === 'ArrowUp'
  const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (back ? -1 : 1) + items.length) % items.length
  e.preventDefault()
  items[j].focus()
  return items[j]
}

/** Segmented control as a radio group (or a tab list with `tabs`): one Tab stop, arrow keys move
 * and select like native radios, `aria-checked`/`aria-selected` carry the state. */
export function Segmented<T extends string | number>({ label, value, options, onChange, tabs, idBase, className = '', style, disabled }: {
  label: string
  value: T | null
  options: readonly { key: T; label: ReactNode }[]
  onChange: (v: T) => void
  tabs?: boolean
  idBase?: string // tabs: each tab gets id `${idBase}-${key}`, for a panel's aria-labelledby
  className?: string
  style?: CSSProperties
  disabled?: boolean
}) {
  const on = options.findIndex(o => o.key === value)
  return (
    <div className={`segmented ${className}`} style={style} role={tabs ? 'tablist' : 'radiogroup'} aria-label={label}
      onKeyDown={e => stepFocus(e, e.currentTarget, 'button:not(:disabled)')?.click()}>
      {options.map((o, i) => (
        <button key={String(o.key)} type="button" id={idBase ? `${idBase}-${o.key}` : undefined}
          role={tabs ? 'tab' : 'radio'} aria-selected={tabs ? i === on : undefined} aria-checked={tabs ? undefined : i === on}
          tabIndex={i === (on < 0 ? 0 : on) ? 0 : -1} className={i === on ? 'active' : ''} disabled={disabled}
          onClick={() => onChange(o.key)}>{o.label}</button>
      ))}
    </div>
  )
}

/** Roving tabindex over the `[data-roving]` cells of a grid `cols` wide: one Tab stop, arrow keys
 * move a day (left/right) or a week (up/down), Home/End jump to the ends. */
export function useRovingGrid(cols: number, initial: number) {
  const [active, setActive] = useState(Math.max(0, initial))
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-roving]')]
    const i = items.indexOf(e.target as HTMLElement)
    const step: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -cols, ArrowDown: cols }
    if (i < 0 || !(e.key in step || e.key === 'Home' || e.key === 'End')) return
    e.preventDefault()
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : i + step[e.key]
    if (j < 0 || j >= items.length) return
    setActive(j)
    items[j].focus()
  }
  return { onKeyDown, tabIndex: (i: number) => (i === active ? 0 : -1) }
}

/** Props that make a non-button element (an event block, a list row) focusable and operable with
 * Enter/Space like a button. Stops propagation so a tap never also hits the slot/cell behind it. */
export function pressable(onPress: () => void) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    onClick: (e: { stopPropagation(): void }) => { e.stopPropagation(); onPress() },
    onKeyDown: (e: KeyboardEvent) => {
      if (e.target !== e.currentTarget || (e.key !== 'Enter' && e.key !== ' ')) return
      e.preventDefault(); e.stopPropagation(); onPress()
    },
  }
}

if (firstLoad) {
  // Picker rows (colour/emoji swatches, chips, day toggles, member avatars): arrow keys move focus
  // along the row, Enter/Space picks as usual. One listener instead of a handler on every row.
  document.addEventListener('keydown', e => {
    if (e.altKey || e.ctrlKey || e.metaKey || !(e.target instanceof HTMLElement)) return
    if (!(e.target instanceof HTMLButtonElement || e.target.matches('input[type="color"]'))) return
    const row = e.target.closest('.chip-row, .color-swatch-row, .emoji-swatch-row, .day-toggles, .member-filter-row, .date-strip')
    if (row) stepFocus(e, row, 'button:not(:disabled), input[type="color"]')
  })

  // `.field > label` sits next to its control without for/id; wire them up after each render so
  // the label is the control's accessible name (and clicking it focuses the control). A field
  // holding a row of buttons (chips, swatches) gets role=group named by the label instead.
  // ponytail: DOM pass, not per-field ids in JSX - add explicit htmlFor where a field needs more.
  let seq = 0
  let queued = false
  const link = () => {
    queued = false
    for (const label of document.querySelectorAll<HTMLLabelElement>('.field > label:not([for])')) {
      const field = label.parentElement!
      const ctl = field.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea')
      if (ctl && !ctl.closest('label') && !ctl.hasAttribute('aria-label')) {
        ctl.id ||= `kw-field-${++seq}`
        label.htmlFor = ctl.id
        continue
      }
      const group = label.nextElementSibling
      if (group instanceof HTMLDivElement && (!group.hasAttribute('role') || group.getAttribute('role') === 'group')) {
        label.id ||= `kw-label-${++seq}`
        group.setAttribute('role', 'group')
        group.setAttribute('aria-labelledby', label.id)
      }
    }
  }
  new MutationObserver(() => { if (!queued) { queued = true; queueMicrotask(link) } })
    .observe(document.body, { childList: true, subtree: true })
}
