import type { ReactNode } from 'react'
import { XIcon } from './icons.tsx'

export default function Sheet({ title, onClose, children, actions }: {
  title: string
  onClose: () => void
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-grabber" />
        <div className="sheet-header">
          <div className="sheet-title">{title}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><XIcon width={20} height={20} /></button>
        </div>
        <div className="sheet-body scroll-y">{children}</div>
        {actions && <div className="sheet-actions">{actions}</div>}
      </div>
    </div>
  )
}
