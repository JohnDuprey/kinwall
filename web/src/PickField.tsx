import { useState, type KeyboardEvent, type ReactNode } from 'react'
import Sheet from './Sheet.tsx'
import { CheckIcon, ChevronRight } from './icons.tsx'
import { pickMatches, pickSummary, type Pickable } from './pick.ts'

export type PickOption = Pickable & { lead?: ReactNode } // lead: a color swatch, emoji or avatar

/** A leading color dot for a pick row (a category's color). */
export const PickSwatch = ({ color }: { color: string }) => <span className="pick-swatch" style={{ background: color }} aria-hidden="true" />

/** Choosing from a list in a sheet, instead of a long or multiple <select>: a row that shows the
 * current choice and opens a sheet of checkable rows (like the meal sheet's recipe picker).
 * Single choice picks and closes; multiple toggles, with Clear and Done. Search shows for long
 * lists. `top` rows (a detected timezone) are listed first, with the rest in `options` order. */
export default function PickField({ id, label, title = label, options: given, value, onChange, multiple = false, search, placeholder = 'Search', none = 'None', summary }: {
  id?: string
  label: string // what the row is for, read with its value: "Categories: Medical, School"
  title?: string
  options: PickOption[] | (() => PickOption[]) // a function: built only while the sheet is open (give `summary`)
  value: string[]
  onChange: (value: string[]) => void
  multiple?: boolean
  search?: boolean
  placeholder?: string
  none?: string // what an empty choice says
  summary?: string // the row's text, when the options' labels don't say it best
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const options = typeof given === 'function' ? (open ? given() : []) : given
  const searchable = search ?? options.length > 8
  const shown = options.filter(o => pickMatches(o, query))
  const text = summary ?? pickSummary(options, value, none)
  const lead = !multiple ? options.find(o => o.value === value[0])?.lead : null
  const close = () => { setOpen(false); setQuery('') }
  const choose = (v: string) => {
    if (!multiple) { onChange([v]); close(); return }
    onChange(value.includes(v) ? value.filter(x => x !== v) : options.filter(o => o.value === v || value.includes(o.value)).map(o => o.value))
  }
  // Arrows move between the search field and the rows, as in the recipe picker.
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...e.currentTarget.querySelectorAll<HTMLElement>('input, .sheet-link')]
    const next = items[items.indexOf(document.activeElement as HTMLElement) + (e.key === 'ArrowDown' ? 1 : -1)]
    if (next) { e.preventDefault(); next.focus() }
  }
  return <>
    <button id={id} type="button" className="sheet-link pick-btn" aria-haspopup="dialog" aria-label={`${label}: ${text}`} onClick={() => setOpen(true)}>
      {lead}<span className="pick-text">{text}</span><ChevronRight />
    </button>
    {open && <Sheet title={title} onClose={close} actions={<>
      {multiple && <button type="button" className="btn btn-secondary" disabled={!value.length} onClick={() => onChange([])}>Clear</button>}
      <button type="button" className="btn btn-primary" onClick={close}>Done</button>
    </>}>
      <div className={searchable ? 'pick-sheet pick-sheet-search' : 'pick-sheet'} onKeyDown={onKey}>
        {searchable && <div className="field"><input type="search" aria-label={`Search ${title.toLocaleLowerCase()}`} placeholder={placeholder} value={query} onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); choose(shown[0].value) } }} /></div>}
        <div className="sheet-links">
          {shown.map(o => {
            const on = value.includes(o.value)
            return <button key={o.value} type="button" className="sheet-link" aria-pressed={on} onClick={() => choose(o.value)}>
              {o.lead}<span>{o.label}{o.detail && <small>{o.detail}</small>}</span>{on && <CheckIcon className="pick-check" />}
            </button>
          })}
        </div>
        {!shown.length && <p className="state-card">{options.length ? 'Nothing matches' : 'Nothing to choose yet'}</p>}
      </div>
    </Sheet>}
  </>
}
