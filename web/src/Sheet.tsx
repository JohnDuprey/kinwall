import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { XIcon } from './icons.tsx'

export default function Sheet({ title, onClose, children, actions }: {
  title: string
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
}) {
  const backdropRef = useRef<HTMLDivElement>(null)
  // Keyboard up: the visible viewport is much shorter than the window. The sheet then drops its
  // home-indicator padding (the keyboard covers that area) and may use the whole visible height.
  const [keyboard, setKeyboard] = useState(false)

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
      setKeyboard(document.documentElement.clientHeight - vv.height > 120) // layout height; iOS shrinks innerHeight too
    }
    fit()
    vv.addEventListener('resize', fit)
    vv.addEventListener('scroll', fit)
    return () => { vv.removeEventListener('resize', fit); vv.removeEventListener('scroll', fit) }
  }, [])

  // Portal to <body>: iOS clips position:fixed to a touch-scrolling ancestor (Settings, Lists), which
  // left the tab bar drawn over the sheet's action buttons.
  return createPortal(
    <div className="sheet-backdrop" ref={backdropRef} onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}
        style={keyboard ? { paddingBottom: 8, maxHeight: '100%', borderRadius: '20px 20px 0 0' } : undefined}>
        <div className="sheet-grabber" />
        <div className="sheet-header">
          <div className="sheet-title">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><XIcon width={20} height={20} /></button>
        </div>
        <div className="sheet-body scroll-y">{children}</div>
        {actions && <div className="sheet-actions">{actions}</div>}
      </div>
    </div>,
    document.body,
  )
}
