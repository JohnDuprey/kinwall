import { useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import Sheet from './Sheet.tsx'
import { CheckIcon, ChevronRight, PlusIcon } from './icons.tsx'
import { pickMatches, pickSummary, type Pickable } from './pick.ts'
import { lang, t } from './i18n.ts'
import { Segmented } from './a11y.tsx'

export type PickOption = Pickable & { lead?: ReactNode; disabled?: boolean; lang?: string } // lead: a color swatch, emoji or avatar

/** A leading color dot for a pick row (a category's color). */
export const PickSwatch = ({ color }: { color: string }) => <span className="pick-swatch" style={{ background: color }} aria-hidden="true" />

/** Choosing from a list in a sheet: a row that shows the
 * current choice and opens a sheet of checkable rows (like the meal sheet's recipe picker).
 * Single choice picks and closes; multiple toggles, with Clear and Done. Search shows for long
 * lists. `top` rows (a detected timezone) are listed first, with the rest in `options` order.
 * `add`: a first row to make a new one ("New school…"); it closes the sheet and hands over the search text. */
export default function PickField({ id, label, title = label, options: given, value, onChange, multiple = false, search, placeholder = t('Search'), none = t('None'), summary, add, maxSelections, hint, disabled, 'aria-describedby': describedBy, 'aria-labelledby': labelledBy }: {
  id?: string
  label: string // what the row is for, read with its value: 'Categories: Medical, School'
  title?: string
  options: PickOption[] | (() => PickOption[]) // a function: built only while the sheet is open (give `summary`)
  value: string[]
  onChange: (value: string[]) => void
  multiple?: boolean
  search?: boolean
  placeholder?: string
  none?: string // what an empty choice says
  summary?: string // the row's text, when the options' labels don't say it best
  maxSelections?: number
  hint?: string
  disabled?: boolean
  'aria-describedby'?: string
  'aria-labelledby'?: string
  add?: { label: string; onAdd: (query: string) => void }
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const textId = useId()
  const options = typeof given === 'function' ? (open ? given() : []) : given
  const searchable = search ?? options.length > 8
  const shown = options.filter(o => pickMatches(o, query))
  const text = summary ?? pickSummary(options, value, none)
  const lead = !multiple ? options.find(o => o.value === value[0])?.lead : null
  const close = () => { setOpen(false); setQuery('') }
  const atLimit = multiple && maxSelections !== undefined && value.length >= maxSelections
  const choose = (v: string) => {
    if (disabled || options.find(o => o.value === v)?.disabled) return
    if (atLimit && !value.includes(v)) return
    if (!multiple) { onChange([v]); close(); return }
    onChange(value.includes(v) ? value.filter(x => x !== v) : options.filter(o => o.value === v || value.includes(o.value)).map(o => o.value))
  }
  // Arrows move between the search field and the rows, as in the recipe picker.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('input, .sheet-link:not(:disabled)')]
    const next = items[items.indexOf(document.activeElement as HTMLElement) + (e.key === 'ArrowDown' ? 1 : -1)]
    if (next) { e.preventDefault(); next.focus() }
  }
  return <>
    <button id={id} type="button" className="sheet-link pick-btn" disabled={disabled} aria-haspopup="dialog" aria-label={`${label}: ${text}`} aria-describedby={describedBy} aria-labelledby={labelledBy ? `${labelledBy} ${textId}` : undefined} onClick={() => setOpen(true)}>
      {lead && <span className="pick-lead">{lead}</span>}<span id={textId} className="pick-text">{text}</span><ChevronRight />
    </button>
    {open && <Sheet title={title} onClose={close} actions={<>
      {multiple && <button type="button" className="btn btn-secondary" disabled={disabled || !value.length} onClick={() => onChange([])}>{t('Clear')}</button>}
      <button type="button" className="btn btn-primary" onClick={close}>{t('Done')}</button>
    </>}>
      <div className={searchable ? 'pick-sheet pick-sheet-search' : 'pick-sheet'} onKeyDown={onKey}>
        {searchable && <div className="field"><input type="search" aria-label={t('Search {what}', { what: lang() === 'de' ? title : title.toLocaleLowerCase() })} placeholder={placeholder} value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { const first = shown.find(o => !o.disabled); if (e.key === 'Enter' && first) { e.preventDefault(); choose(first.value) } }} /></div>}
        {hint && <p className="field-hint">{hint}</p>}
        {atLimit && <p className="field-hint" role="status">{t('You can choose up to {n}.', { n: maxSelections! })}</p>}
        <div className="sheet-links">
          {add && <button type="button" className="sheet-link pick-add" onClick={() => { const q = query.trim(); close(); add.onAdd(q) }}><PlusIcon aria-hidden="true" /><span>{add.label}</span></button>}
          {shown.map(o => {
            const on = value.includes(o.value)
            return <button key={o.value} type="button" className="sheet-link" lang={o.lang} disabled={disabled || o.disabled || (atLimit && !on)} aria-pressed={on} onClick={() => choose(o.value)}>
              {o.lead && <span className="pick-lead">{o.lead}</span>}<span>{o.label}{o.detail && <small>{o.detail}</small>}</span>{on && <CheckIcon className="pick-check" />}
            </button>
          })}
        </div>
        {!shown.length && !add && <p className="state-card">{options.length ? t('Nothing matches') : t('Nothing to choose yet')}</p>}
      </div>
    </Sheet>}
  </>
}

/** One choice: a few short labels fit a segmented control; longer or growing lists open a sheet.
 * `hideLabel` keeps an existing field/row label. `name` also supplies the value to native forms. */
export function Choose<T extends string | number>({ id: givenId, label, value: controlled, defaultValue, options, onChange, none, disabled, hint, hideLabel = false, sheet = false, name, className = '', style, 'aria-describedby': describedBy, 'aria-labelledby': labelledBy }: {
  id?: string
  label: string
  value?: T
  defaultValue?: T
  options: { value: T; label: string | number; emoji?: string; disabled?: boolean; hidden?: boolean; detail?: string; lang?: string }[]
  onChange?: (value: T) => void
  none?: string
  disabled?: boolean
  hint?: string
  hideLabel?: boolean
  sheet?: boolean
  name?: string
  className?: string
  style?: CSSProperties
  'aria-describedby'?: string
  'aria-labelledby'?: string
}) {
  const generatedId = useId()
  const id = givenId ?? generatedId
  const control = useRef<HTMLDivElement>(null)
  const formValue = useRef<HTMLInputElement>(null)
  const [local, setLocal] = useState(defaultValue ?? options[0]?.value)
  const value = controlled ?? local
  const change = (next: T) => {
    if (next === value) return
    // Keep FormData current before a form observes the committed choice. Sheets with dirty="auto"
    // also observe this input event, including choices made in a nested picker.
    if (formValue.current) formValue.current.value = String(next)
    const source = formValue.current ?? control.current
    source?.dispatchEvent(new Event('input', { bubbles: true }))
    setLocal(next); onChange?.(next)
  }
  const visible = options.filter(o => !o.hidden)
  const short = !sheet && visible.length > 0 && visible.length <= 3 && visible.reduce((n, o) => n + String(o.label).length, 0) <= 40
  const selected = options.find(o => String(o.value) === String(value))
  const picks = visible.map(o => {
    const text = String(o.label)
    const leading = o.emoji ?? text.match(/^(\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*)\s+/u)?.[1]
    return { ...o, value: String(o.value), label: leading && text.startsWith(leading) ? text.slice(leading.length).trimStart() : text, lead: leading && <span aria-hidden="true">{leading}</span> }
  })
  return <div ref={control} className={`${hideLabel ? 'choose-control' : 'field choose-field'} ${className}`} style={style}>
    {!hideLabel && <label htmlFor={id}>{label}</label>}
    {name && <input ref={formValue} type="hidden" name={name} value={value ?? ''} disabled={disabled} />}
    {short ? <Segmented id={id} label={label} value={value ?? null} disabled={disabled} onChange={change} aria-describedby={describedBy} aria-labelledby={labelledBy}
        options={visible.map(o => ({ key: o.value, label: o.emoji ? <><span aria-hidden="true">{o.emoji} </span>{o.label}</> : o.label, disabled: o.disabled }))} />
    : <PickField id={id} label={label} value={value === undefined ? [] : [String(value)]} none={none} disabled={disabled}
      aria-describedby={describedBy} aria-labelledby={labelledBy} hint={hint} summary={picks.find(o => o.value === String(value))?.label ?? (selected ? String(selected.label) : none)}
      onChange={v => { const option = options.find(o => String(o.value) === v[0]); if (option) change(option.value) }} options={picks} />}
    {short && hint && <p className="field-hint">{hint}</p>}
  </div>
}
