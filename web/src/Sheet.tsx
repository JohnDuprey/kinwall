import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from './icons.tsx'
import { reducedMotion } from './a11y.tsx'
import { useKeyboard } from './keyboard.ts'
import { sheetHistory, unsavedChanges } from './sheetHistory.ts'
import { useDialogMaybe } from './dialog.tsx'

let nextToken = 0

export default function Sheet({ title, onClose, children, actions, variant, role = 'dialog', describedBy, dismissable = true, onCancel, dirty = false, onGone }: {
  title: string
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
  variant?: 'dialog' | 'full' // dialog: compact card, centered on wide screens (still a bottom sheet on phones) - see dialog.tsx; full: the whole screen (a document viewer)
  role?: 'dialog' | 'alertdialog'
  describedBy?: string
  // false: a stray backdrop tap or drag can't close it (the sheet nudges instead); only the X,
  // Escape and the content's own buttons do. Escape and X call onCancel when given.
  dismissable?: boolean
  onCancel?: () => void
  // Typed work a stray tap would lose: ✕, Escape, a backdrop tap, a swipe down and Back ask
  // "Discard changes?" first. Only on forms with a Save/Add button, never on read-only sheets.
  // 'auto': once anything has been typed, picked or ticked in its fields.
  dirty?: boolean | 'auto'
  onGone?: () => void // after the sheet has closed and its history entry is gone (dialog.tsx)
}) {
  const backdropRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const titleId = useId()
  const [opener] = useState(() => document.activeElement as HTMLElement | null) // at first render, before the sheet takes focus
  onCloseRef.current = onClose
  const [typed, setTyped] = useState(false)
  const changed = unsavedChanges(dirty, typed)
  const dialog = useDialogMaybe() // null for the dialogs themselves' provider-less uses
  const asking = useRef(false)
  // The user asked to close (✕, Escape, backdrop, swipe, Back). Unsaved changes ask first.
  const dismissRef = useRef<(close: (() => void) | undefined) => Promise<void>>(async () => {})
  dismissRef.current = async close => {
    if (!close || asking.current) return
    if (changed && dialog) {
      asking.current = true
      const discard = await dialog.confirm({ title: 'Discard changes?', confirmLabel: 'Discard', cancelLabel: 'Keep editing', danger: true })
      asking.current = false
      if (!discard) return
    }
    close()
  }
  const escape = dismissable ? onClose : onCancel
  const onEscapeRef = useRef<() => void>(() => {})
  onEscapeRef.current = () => void dismissRef.current(escape)

  // Back closes the sheet (sheetHistory.ts). One that stays open (unsaved changes, busy) gets its
  // history entry back, so the next Back still lands here.
  const [token] = useState(() => `s${Date.now().toString(36)}-${++nextToken}`)
  const onBackRef = useRef(() => {})
  onBackRef.current = () => {
    if (changed || !escape) sheetHistory.keep(token)
    void dismissRef.current(escape)
  }
  const onGoneRef = useRef(onGone)
  onGoneRef.current = onGone
  useEffect(() => {
    sheetHistory.opened(token, () => onBackRef.current())
    return () => sheetHistory.closed(token, () => onGoneRef.current?.())
  }, [token])

  // Dialog basics: focus moves in on open and back on close, Escape closes, Tab wraps inside.
  useEffect(() => {
    const sheet = sheetRef.current!
    const focusables = () => [...sheet.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !(el as HTMLButtonElement).disabled)
    // The panel, not its first input (that would pop the keyboard on touch) - unless the content
    // marks the control that should start focused (a dialog's primary button or prompt input).
    ;(sheet.querySelector<HTMLElement>('[data-autofocus]') ?? sheet).focus({ preventScroll: true })
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // An open combobox (Add item's suggestions) closes its list first; a nested control's
        // own Escape (preventDefault) wins too. This native listener runs before React's.
        if (e.defaultPrevented || (e.target as HTMLElement).closest?.('[role="combobox"][aria-expanded="true"]')) return
        e.stopPropagation(); onEscapeRef.current(); return
      }
      if (e.key !== 'Tab') return
      const els = focusables()
      if (!els.length) return
      const first = els[0], last = els[els.length - 1]
      if (e.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    sheet.addEventListener('keydown', onKey)
    return () => { sheet.removeEventListener('keydown', onKey); opener?.focus?.({ preventScroll: true }) }
  }, [opener])

  // Keyboard up (keyboard.ts): the sheet drops its home-indicator padding (the keyboard covers that
  // area) and may use the whole visible height, less the status bar's strip at the top (an iPhone's
  // visible area starts under it).
  const keyboard = useKeyboard().up

  // iOS Safari keeps position:fixed tied to the full layout viewport when the keyboard opens, so a
  // bottom sheet's action buttons end up under the keyboard. Pin the backdrop to the *visible*
  // viewport instead (Safari ignores interactive-widget=resizes-content, so this is the only way).
  useEffect(() => {
    const vv = window.visualViewport
    const el = backdropRef.current
    if (!vv || !el) return
    const fit = () => {
      el.style.top = `${vv.offsetTop}px`
      el.style.height = `${vv.height}px`
      el.style.bottom = 'auto'
    }
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit) }
  }, [])

  // Drag the grabber/header down to dismiss, like a native sheet. The panel follows the finger;
  // letting go past ~80px (or with a quick flick) closes it, otherwise it springs back.
  const drag = useRef<{ y: number; t: number } | null>(null)
  const onDragStart = (e: ReactPointerEvent) => {
    if (!dismissable || (e.pointerType === 'mouse' && e.button !== 0) || (e.target as HTMLElement).closest('button')) return // leave the close button alone
    drag.current = { y: e.clientY, t: e.timeStamp }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    sheetRef.current!.style.transition = 'none'
  }
  const onDragMove = (e: ReactPointerEvent) => {
    if (!drag.current) return
    sheetRef.current!.style.transform = `translateY(${Math.max(0, e.clientY - drag.current.y)}px)`
  }
  const onDragEnd = (e: ReactPointerEvent) => {
    if (!drag.current) return
    const dy = e.clientY - drag.current.y
    const v = dy / Math.max(1, e.timeStamp - drag.current.t)
    drag.current = null
    const sheet = sheetRef.current!
    if ((dy > 80 || v > 0.5) && changed) { // spring back and ask
      sheet.style.transition = reducedMotion() ? 'none' : 'transform 0.2s ease'
      sheet.style.transform = ''
      void dismissRef.current(onCloseRef.current)
      return
    }
    if (dy > 80 || v > 0.5) {
      if (reducedMotion()) { onCloseRef.current(); return } // no slide-away
      sheet.style.transition = 'transform 0.2s ease'
      sheet.style.transform = 'translateY(100%)'; setTimeout(() => onCloseRef.current(), 180)
      return
    }
    sheet.style.transition = reducedMotion() ? 'none' : 'transform 0.2s ease' // spring back
    sheet.style.transform = ''
  }

  const onBackdrop = () => {
    if (dismissable) { void dismissRef.current(onClose); return }
    const sheet = sheetRef.current!
    if (reducedMotion()) return
    sheet.classList.remove('sheet-nudge'); void sheet.offsetWidth; sheet.classList.add('sheet-nudge') // restart the animation
  }

  // Portal to <body>: iOS clips position:fixed to a touch-scrolling ancestor (Settings, Lists), which
  // left the tab bar drawn over the sheet's action buttons.
  return createPortal(
    <div className={`sheet-backdrop ${variant === 'dialog' ? 'sheet-backdrop-dialog' : ''}`} ref={backdropRef} onClick={onBackdrop}>
      <div className={`sheet ${variant ? `sheet-${variant}` : ''}`} ref={sheetRef} role={role} aria-modal="true" aria-labelledby={titleId} aria-describedby={describedBy}
        tabIndex={-1} onClick={e => e.stopPropagation()} onInput={dirty === 'auto' && !typed ? () => setTyped(true) : undefined}
        style={keyboard ? { paddingBottom: 8, maxHeight: 'calc(100% - var(--safe-t))', borderRadius: '20px 20px 0 0' } : undefined}>
        <div className={`sheet-drag ${dismissable ? '' : 'no-drag'}`} onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={onDragEnd} onPointerCancel={onDragEnd}>
          <div className="sheet-grabber" />
          <div className="sheet-header">
            <h2 className="sheet-title" id={titleId}>{title}</h2>
            <button className="icon-btn" onClick={() => void dismissRef.current(onCancel ?? onClose)} aria-label={onCancel ? 'Cancel' : 'Close'}><XIcon width={20} height={20} /></button>
          </div>
        </div>
        <div className="sheet-body scroll-y">{children}</div>
        {actions && <div className="sheet-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}
