import { useId, useState, type KeyboardEvent, type ReactNode } from 'react'
import Sheet from './Sheet.tsx'
import { loadFont } from './useTheme.ts'
import type { Typeface } from './types.ts'
import { findSkin, getSkin, SCHEME_BLURBS, SCHEME_GROUPS, seasonalNote, seasonalSkinId, tokensFor, type CustomScheme, type Skin } from './skins.ts'

/** A scheme's light and dark look as a tiny Board: background, a card, two lines of text and an
 * accent pill, drawn from the same tokens the app applies (tokensFor). */
function SchemeMini({ skin }: { skin: Skin }) {
  return (
    <span className="scheme-card-preview" aria-hidden="true">
      {[false, true].map(dark => {
        const t = tokensFor(skin, dark)
        return (
          <span key={String(dark)} className="scheme-mini" style={{ background: t.bg }}>
            <span className="scheme-mini-card" style={{ background: t.card, borderColor: t.border }}>
              <span className="scheme-mini-line" style={{ background: t.text }} />
              <span className="scheme-mini-line short" style={{ background: t.textDim }} />
              <span className="scheme-mini-pill" style={{ background: t.accentStrong }} />
            </span>
          </span>
        )
      })}
    </span>
  )
}

function SchemeCard({ skin, name, desc, selected, onPick }: { skin: Skin; name: string; desc: string; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" className="scheme-card" aria-pressed={selected} onClick={onPick}>
      <SchemeMini skin={skin} />
      {selected && <span className="scheme-card-check" aria-hidden="true">✓</span>}
      <span className="scheme-card-name">{name}</span>
      <span className="scheme-card-desc">{desc}</span>
    </button>
  )
}

/** Arrow keys move between cards: left/right in reading order, up/down to the nearest card in the row above or below. */
function onArrows(e: KeyboardEvent<HTMLDivElement>) {
  const dir = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -2, ArrowDown: 2 } as Record<string, number>)[e.key]
  if (!dir) return
  const cards = [...e.currentTarget.querySelectorAll<HTMLElement>('.scheme-card')]
  const i = cards.indexOf(document.activeElement as HTMLElement)
  if (i < 0) return
  e.preventDefault()
  if (Math.abs(dir) === 1) { cards[i + dir]?.focus(); return }
  const r = cards[i].getBoundingClientRect()
  const [next] = cards.map(c => c.getBoundingClientRect())
    .map((q, j) => ({ j, dy: (q.top - r.top) * Math.sign(dir), dx: Math.abs(q.left - r.left) }))
    .filter(c => c.dy > 4).sort((a, b) => a.dy - b.dy || a.dx - b.dx)
  if (next) cards[next.j].focus()
}

/** The Color scheme sheet: every scheme as a light+dark preview card, grouped. Tapping one applies
 * it right away (the app is the live preview) and the sheet stays open to compare. On a device,
 * `family` adds "Use the family's scheme" first and `value` undefined means that one. */
export function SchemePickerSheet({ value, family, customs, familyScheme, onPick, onClose, customActions, footer }: {
  value: string | undefined
  family?: { name: string; skin: Skin }
  customs: CustomScheme[]
  familyScheme: string // marks the family's own saved scheme
  onPick: (id: string | undefined) => void
  onClose: () => void
  customActions: ReactNode // Manage / New scheme, under Your schemes
  footer: ReactNode // the quiet reset at the bottom
}) {
  return (
    <Sheet title="Color scheme" onClose={onClose} actions={<button className="btn btn-primary btn-block" onClick={onClose}>Done</button>}>
      <div className="scheme-groups" onKeyDown={onArrows}>
        {family && (
          <section className="scheme-group" aria-label="Follow the family">
            <h3 className="scheme-group-title">Follow the family</h3>
            <div className="scheme-grid">
              <SchemeCard skin={family.skin} name="🏠 Use the family's scheme" desc={`Now: ${family.name}`} selected={value === undefined} onPick={() => onPick(undefined)} />
            </div>
          </section>
        )}
        {SCHEME_GROUPS.map(g => (
          <section key={g.label} className="scheme-group" aria-label={g.label}>
            <h3 className="scheme-group-title">{g.label}</h3>
            <div className="scheme-grid">
              {g.ids.map(id => id === 'seasonal'
                ? <SchemeCard key={id} skin={getSkin(seasonalSkinId())} name="🗓️ Seasonal" desc={seasonalNote()} selected={value === id} onPick={() => onPick(id)} />
                : <SchemeCard key={id} skin={getSkin(id)} name={`${getSkin(id).emoji} ${getSkin(id).name}`} desc={SCHEME_BLURBS[id]} selected={value === id} onPick={() => onPick(id)} />)}
            </div>
          </section>
        ))}
        <section className="scheme-group" aria-label="Your schemes">
          <h3 className="scheme-group-title">Your schemes</h3>
          {customs.length > 0
            ? <div className="scheme-grid">
                {customs.map(c => <SchemeCard key={c.id} skin={findSkin(c.id, customs)} name={`${c.emoji || '🎨'} ${c.name}`}
                  desc={c.id === familyScheme ? "The family's own scheme" : 'Saved by the family'} selected={value === c.id} onPick={() => onPick(c.id)} />)}
              </div>
            : <p className="settings-row-sub">Make your own from the scheme you're on.</p>}
          <div className="scheme-actions">{customActions}</div>
        </section>
      </div>
      <div className="scheme-sheet-foot">{footer}</div>
    </Sheet>
  )
}

const SAMPLE = 'Soccer at 4:00 · Tacos for dinner'

/** Typeface row and sheet, for the family or (with `family`) this device: the row shows the typeface
 * in effect in itself; the sheet has one card per typeface with a sample line set in it. On a device,
 * "Use the family's typeface" comes first and `value` undefined means that one. Opening the sheet
 * loads every typeface so the samples are real. Tapping applies it live; Done closes. */
export function TypefaceRow({ options, value, family, onPick }: {
  options: { key: Typeface; label: string; desc: string }[]
  value: Typeface | undefined
  family?: Typeface // set on a device: the family's typeface, offered first
  onPick: (key: Typeface | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const valueId = useId()
  const labelOf = (k: Typeface | undefined) => (options.find(o => o.key === k) ?? options[0]).label
  const shown = value ?? family ?? 'default'
  const rowValue = value || !family ? labelOf(value) : `🏠 Household (${labelOf(family).split(' (')[0]})`
  const card = (key: Typeface | undefined, font: Typeface, name: string, desc: string) => (
    <button key={key ?? 'family'} type="button" className="scheme-card" aria-pressed={key === value} onClick={() => onPick(key)}>
      {key === value && <span className="scheme-card-check" aria-hidden="true">✓</span>}
      <span className="scheme-card-name typeface-name" style={{ fontFamily: loadFont(font) }}>{name}</span>
      <span className="typeface-sample" style={{ fontFamily: loadFont(font) }}>{SAMPLE}</span>
      <span className="scheme-card-desc">{desc}</span>
    </button>
  )
  return (
    <div className="device-pref-row">
      <span aria-hidden="true">Typeface</span>
      <button type="button" className="settings-select scheme-row" aria-label={family ? 'Typeface on this device' : 'Typeface'} aria-describedby={valueId} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <span id={valueId} className="scheme-row-name" style={{ fontFamily: loadFont(shown) }}>{rowValue}</span>
      </button>
      {open && (
        <Sheet title="Typeface" onClose={() => setOpen(false)} actions={<button className="btn btn-primary btn-block" onClick={() => setOpen(false)}>Done</button>}>
          <div className="scheme-groups" onKeyDown={onArrows}>
            <div className="scheme-grid">
              {family && card(undefined, family, "🏠 Use the family's typeface", `Now: ${labelOf(family)}`)}
              {options.map(o => card(o.key, o.key, o.label, o.desc))}
            </div>
          </div>
        </Sheet>
      )}
    </div>
  )
}
