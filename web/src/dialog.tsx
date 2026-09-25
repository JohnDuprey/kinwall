// In-app replacements for window.confirm / prompt / alert, built on Sheet (portal, dialog
// semantics, focus trap, Escape, drag-to-dismiss). Native dialogs can't be styled, ignore text
// size and dark mode, and on a wall display in Guided Access can't always be dismissed.
//
//   const dialog = useDialog()
//   if (!await dialog.confirm({ title: 'Delete "Milk"?', confirmLabel: 'Delete', danger: true })) return
import { createContext, useContext, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import Sheet from './Sheet.tsx'

export interface ConfirmOptions { title: string; body?: ReactNode; confirmLabel?: string; cancelLabel?: string; danger?: boolean }
export interface PromptOptions {
  title: string; body?: ReactNode; label: string; placeholder?: string; defaultValue?: string
  type?: 'text' | 'url' | 'email'
  validate?: (value: string) => string | null // error message, or null when valid
  confirmLabel?: string; cancelLabel?: string
}
export interface AlertOptions { title: string; body?: ReactNode; confirmLabel?: string }

interface DialogApi {
  confirm(opts: ConfirmOptions): Promise<boolean>
  prompt(opts: PromptOptions): Promise<string | null>
  alert(opts: AlertOptions): Promise<void>
}

type Request = { id: number } & (
  | { kind: 'confirm'; opts: ConfirmOptions; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOptions; resolve: (v: string | null) => void }
  | { kind: 'alert'; opts: AlertOptions; resolve: () => void })
let nextId = 0

const DialogContext = createContext<DialogApi | null>(null)

export function useDialog(): DialogApi {
  const api = useContext(DialogContext)
  if (!api) throw new Error('useDialog outside DialogProvider')
  return api
}

/** Mount once around the app. Requests queue, so two at once show one after the other. */
export function DialogProvider({ children }: { children: ReactNode }) {
  const [queue, setQueue] = useState<Request[]>([])
  const api = useMemo<DialogApi>(() => ({
    confirm: opts => new Promise(resolve => setQueue(q => [...q, { id: ++nextId, kind: 'confirm', opts, resolve }])),
    prompt: opts => new Promise(resolve => setQueue(q => [...q, { id: ++nextId, kind: 'prompt', opts, resolve }])),
    alert: opts => new Promise(resolve => setQueue(q => [...q, { id: ++nextId, kind: 'alert', opts, resolve }])),
  }), [])
  const current = queue[0]
  return (
    <DialogContext.Provider value={api}>
      {children}
      {current && <DialogView key={current.id} req={current} onDone={() => setQueue(q => q.slice(1))} />}
    </DialogContext.Provider>
  )
}

function DialogView({ req, onDone }: { req: Request; onDone: () => void }) {
  const ids = useId()
  const [value, setValue] = useState(req.kind === 'prompt' ? req.opts.defaultValue ?? '' : '')
  const [edited, setEdited] = useState(false)
  const settled = useRef(false) // Escape, backdrop tap and drag can all fire; resolve once

  const finish = (ok: boolean) => {
    if (settled.current) return
    settled.current = true
    if (req.kind === 'confirm') req.resolve(ok)
    else if (req.kind === 'prompt') req.resolve(ok ? value.trim() : null)
    else req.resolve()
    onDone()
  }

  // Prompt: empty is never OK (like the old `if (!value) return`); validate() adds its own rule.
  const error = req.kind === 'prompt' ? (value.trim() ? req.opts.validate?.(value.trim()) ?? null : '') : null
  const invalid = error !== null
  const { title, body } = req.opts
  const confirmLabel = req.opts.confirmLabel ?? 'OK'
  const cancelLabel = req.kind === 'alert' ? null : req.opts.cancelLabel ?? 'Cancel'
  const danger = req.kind === 'confirm' && req.opts.danger

  return (
    <Sheet title={title} onClose={() => finish(false)} variant="dialog" role={req.kind === 'prompt' ? 'dialog' : 'alertdialog'}
      describedBy={body ? `${ids}-body` : undefined}
      actions={<>
        {cancelLabel && <button className="btn btn-secondary" onClick={() => finish(false)}>{cancelLabel}</button>}
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={() => finish(true)} disabled={invalid}
          data-autofocus={req.kind === 'prompt' ? undefined : true}>{confirmLabel}</button>
      </>}>
      {body && <p className="dialog-body" id={`${ids}-body`}>{body}</p>}
      {req.kind === 'prompt' && (
        <form onSubmit={e => { e.preventDefault(); if (!invalid) finish(true) }}>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor={`${ids}-input`}>{req.opts.label}</label>
            <input id={`${ids}-input`} type={req.opts.type ?? 'text'} value={value} placeholder={req.opts.placeholder} data-autofocus
              autoComplete="off" autoCapitalize={req.opts.type && req.opts.type !== 'text' ? 'off' : undefined} spellCheck={req.opts.type === 'url' || req.opts.type === 'email' ? false : undefined}
              aria-invalid={edited && !!error || undefined} aria-describedby={edited && error ? `${ids}-error` : undefined}
              onChange={e => { setValue(e.target.value); setEdited(true) }} />
            {edited && error && <p className="field-error" id={`${ids}-error`} style={{ margin: '6px 0 0' }}>{error}</p>}
          </div>
        </form>
      )}
    </Sheet>
  )
}
