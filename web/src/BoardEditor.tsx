// The Board layout editor (boardLayout.ts): a screen's own layout, or a family preset. Cards sit in
// columns, each as tall as its share of the column, so the editor is a small picture of the Board.
// Drag a card by its grip to another place or column, or use its arrow buttons; a keyboard and a
// screen reader get the same moves from the buttons.
import { useEffect, useId, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { announce } from './a11y.tsx'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { setDeviceAppearance, useDeviceAppearance, type DeviceAppearance } from './useTheme.ts'
import {
  addCard, BUILT_IN_PRESETS, cardOn, CARD_DENSITIES, CUSTOM, layoutFor, MAX_PRESETS, CARD_NAMES, CARD_SIZES, DEFAULT_LAYOUT, DENSITY_NAMES, MAX_COLUMNS, MAX_PER_COLUMN, moveCard,
  normalizeLayout, removeCard, setColumnCount, SIZE_NAMES, unplaced, updateCard, type BoardLayout, type BoardPreset, type CardDensity,
  type CardSize, type Spot,
} from './boardLayout.ts'
import { XIcon } from './icons.tsx'
import type { List } from './types.ts'
import Sheet from './Sheet.tsx'
import { msg, t, tm } from './i18n.ts'

const grip = (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
    {[3, 8, 13].flatMap(y => [5, 11].map(x => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.5" />))}
  </svg>
)

type Drag = { from: Spot; x0: number; y0: number; dx: number; dy: number; to: Spot | null }

/** `name`: a preset's name, edited here too (undefined for a screen's own layout). `onDelete`: a
 * saved preset's Delete, at the bottom. `presets`: the family's, to start from. */
export default function BoardEditor({ title, start, name: startName, presets, onSave, onClose, onDelete }: {
  title: string
  start: BoardLayout
  name?: string
  presets: BoardPreset[]
  onSave: (layout: BoardLayout, name: string) => void
  onClose: () => void
  onDelete?: () => void
}) {
  const [layout, setLayout] = useState(start)
  const { settings } = useApp()
  // The Checklist card's list picker: to-do and reusable lists (shopping lists have Shopping mode).
  const [lists, setLists] = useState<List[]>([])
  useEffect(() => { if (settings.features.lists) api.getLists().then(l => setLists(l.filter(x => x.kind !== 'shopping'))).catch(() => { /* first reusable list it is */ }) }, [settings.features.lists])
  const addable = unplaced(layout).filter(id => cardOn(id, settings.features)) // nothing for a feature that's off
  const [name, setName] = useState(startName ?? '')
  const [drag, setDrag] = useState<Drag | null>(null)
  const cols = useRef<HTMLDivElement>(null)
  const nameId = useId()
  const isPreset = startName !== undefined
  const n = layout.columns.length

  const where = (at: Spot) => t('column {col}, {i} of {n}', { col: at.col + 1, i: at.i + 1, n: layout.columns[at.col].length })
  const move = (from: Spot, to: Spot) => {
    const next = moveCard(layout, from, to)
    if (next === layout) { announce(t('Column {n} is full', { n: to.col + 1 })); return }
    setLayout(next)
    const card = layout.columns[from.col][from.i]
    const i = next.columns[to.col].indexOf(card)
    announce(t('{card}: column {col}, {i} of {n}', { card: tm(CARD_NAMES[card.id]), col: to.col + 1, i: i + 1, n: next.columns[to.col].length }))
  }

  // Dragging: where the pointer is decides the column (by its box) and the place (how many other
  // cards' middles are above it). The card follows the pointer; a line shows where it will land.
  const onGripDown = (e: ReactPointerEvent, from: Spot) => {
    if (e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDrag({ from, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0, to: null })
  }
  const onGripMove = (e: ReactPointerEvent) => {
    if (!drag) return
    const colEls = [...cols.current?.querySelectorAll<HTMLElement>('.board-editor-col') ?? []]
    const ci = colEls.findIndex(el => { const r = el.getBoundingClientRect(); return e.clientX >= r.left && e.clientX <= r.right })
    let to: Spot | null = null
    if (ci >= 0) {
      const mids = [...colEls[ci].querySelectorAll<HTMLElement>('.board-editor-card:not(.dragging)')].map(el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2 })
      to = { col: ci, i: mids.filter(m => m < e.clientY).length }
    }
    setDrag({ ...drag, dx: e.clientX - drag.x0, dy: e.clientY - drag.y0, to })
  }
  const onGripUp = () => {
    if (drag?.to && (drag.to.col !== drag.from.col || drag.to.i !== drag.from.i)) move(drag.from, drag.to)
    setDrag(null)
  }
  useEffect(() => {
    if (!drag) return
    const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setDrag(null) } }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [drag])

  const startFrom = (id: string) => {
    const p = id === 'default' ? DEFAULT_LAYOUT : [...BUILT_IN_PRESETS, ...presets].find(x => x.id === id)?.layout
    if (!p) return
    setLayout(normalizeLayout(p))
    announce(t('Layout replaced'))
  }
  const canSave = !isPreset || name.trim().length > 0
  const drop = drag?.to && !(drag.to.col === drag.from.col && drag.to.i === drag.from.i) ? drag.to : null

  return (
    <Sheet title={title} variant="full" onClose={onClose} dismissable={false} onCancel={onClose}
      actions={<>
        <button type="button" className="btn btn-secondary" onClick={onClose}>{t('Cancel')}</button>
        <button type="button" className="btn btn-primary" disabled={!canSave} onClick={() => onSave(layout, name.trim())}>{t('Save')}</button>
      </>}>
      <div className="board-editor-page">
      {isPreset && (
        <div className="field">
          <label htmlFor={nameId}>{t('Name')}</label>
          <input id={nameId} type="text" value={name} maxLength={40} placeholder={t('Hallway')} onChange={e => setName(e.target.value)} />
        </div>
      )}
      <div className="board-editor-options">
        <div className="device-pref-row">
          <span>{t('Start from')}</span>
          <select className="settings-select" aria-label={t('Start from')} value="" onChange={e => startFrom(e.target.value)}>
            <option value="" disabled>{t('Choose…')}</option>
            <option value="default">{t('Family wall (default)')}</option>
            {BUILT_IN_PRESETS.map(p => <option key={p.id} value={p.id}>{tm(p.name)}</option>)}
            {presets.map(p => <option key={p.id} value={p.id}>{p.name} 🏠</option>)}
          </select>
        </div>
        <div className="device-pref-row">
          <span>{t('Columns')}</span>
          <select className="settings-select" aria-label={t('Columns')} value={n} onChange={e => setLayout(setColumnCount(layout, Number(e.target.value)))}>
            {Array.from({ length: MAX_COLUMNS }, (_, i) => <option key={i} value={i + 1}>{i + 1}</option>)}
          </select>
        </div>
        <div className="toggle-row">
          <label id="board-tiles-label">{t('Count tiles across the top')}</label>
          <button type="button" className={`switch ${layout.tiles ? 'on' : ''}`} role="switch" aria-checked={layout.tiles} aria-labelledby="board-tiles-label"
            onClick={() => setLayout({ ...layout, tiles: !layout.tiles })}><span className="knob" /></button>
        </div>
      </div>
      <p className="field-hint">{t('Drag a card by its grip, or use its arrows. A taller card takes more of its column. Phones and narrow screens show the cards in order, column by column.')}</p>

      <div ref={cols} className="board-editor" style={{ '--board-editor-cols': n } as React.CSSProperties}>
        {layout.columns.map((col, ci) => (
          <section key={ci} className="board-editor-col" aria-label={t('Column {n}', { n: ci + 1 })}>
            <h4 className="board-editor-col-title">{t('Column {n}', { n: ci + 1 })}</h4>
            {col.length === 0 && !drop && <p className="snap-empty">{t('Empty: this column is left out.')}</p>}
            {col.map((card, i) => {
              const at = { col: ci, i }, dragging = drag?.from.col === ci && drag.from.i === i
              // The line before the card the dragged one would land in front of (counting without it).
              const others = drag && drag.from.col === ci ? i - (i > drag.from.i ? 1 : 0) : i
              const lineBefore = drop && drop.col === ci && !dragging && drop.i === others
              return (
                <div key={card.id} className={`board-editor-card board-editor-${card.size} ${dragging ? 'dragging' : ''} ${lineBefore ? 'drop-before' : ''}`}
                  style={dragging ? { transform: `translate(${drag!.dx}px, ${drag!.dy}px)` } : undefined}>
                  <div className="board-editor-card-head">
                    <button type="button" className="list-item-grip" aria-label={t('Move {card}: drag, or use the arrow buttons', { card: tm(CARD_NAMES[card.id]) })}
                      onPointerDown={e => onGripDown(e, at)} onPointerMove={onGripMove} onPointerUp={onGripUp} onPointerCancel={() => setDrag(null)}>{grip}</button>
                    <strong className="board-editor-card-name">{tm(CARD_NAMES[card.id])}</strong>
                    <button type="button" className="icon-btn" aria-label={t('Remove {card}', { card: tm(CARD_NAMES[card.id]) })} onClick={() => { setLayout(removeCard(layout, at)); announce(t('{card} removed', { card: tm(CARD_NAMES[card.id]) })) }}><XIcon width={18} height={18} /></button>
                  </div>
                  <div className="board-editor-card-controls">
                    <select className="settings-select" aria-label={t('{card} height', { card: tm(CARD_NAMES[card.id]) })} value={card.size} onChange={e => setLayout(updateCard(layout, at, { size: e.target.value as CardSize }))}>
                      {CARD_SIZES.map(s => <option key={s} value={s}>{tm(SIZE_NAMES[s])}</option>)}
                    </select>
                    <select className="settings-select" aria-label={t('{card} text size', { card: tm(CARD_NAMES[card.id]) })} value={card.density} onChange={e => setLayout(updateCard(layout, at, { density: e.target.value as CardDensity }))}>
                      {CARD_DENSITIES.map(d => <option key={d} value={d}>{tm(DENSITY_NAMES[d])}</option>)}
                    </select>
                    {card.id === 'checklist' && (
                      <select className="settings-select" aria-label={t("Get stuff done card's list")} value={card.listId ?? ''} onChange={e => setLayout(updateCard(layout, at, { listId: e.target.value || undefined }))}>
                        <option value="">{t('First reusable list')}</option>
                        {lists.map(l => <option key={l.id} value={l.id}>{l.emoji ? `${l.emoji} ` : ''}{l.name}</option>)}
                      </select>
                    )}
                  </div>
                  <div className="board-editor-moves" role="group" aria-label={t('Move {card}, now {where}', { card: tm(CARD_NAMES[card.id]), where: where(at) })}>
                    <button type="button" className="icon-btn" aria-label={t('Up')} disabled={i === 0} onClick={() => move(at, { col: ci, i: i - 1 })}>↑</button>
                    <button type="button" className="icon-btn" aria-label={t('Down')} disabled={i === col.length - 1} onClick={() => move(at, { col: ci, i: i + 1 })}>↓</button>
                    <button type="button" className="icon-btn" aria-label={t('To the column on the left')} disabled={ci === 0} onClick={() => move(at, { col: ci - 1, i })}>←</button>
                    <button type="button" className="icon-btn" aria-label={t('To the column on the right')} disabled={ci === n - 1} onClick={() => move(at, { col: ci + 1, i })}>→</button>
                  </div>
                </div>
              )
            })}
            {drop && drop.col === ci && drop.i >= col.length - (drag!.from.col === ci ? 1 : 0) && <div className="board-editor-drop" aria-hidden="true" />}
            {col.length >= MAX_PER_COLUMN && <p className="field-hint">{t('Full: {n} cards at most.', { n: MAX_PER_COLUMN })}</p>}
          </section>
        ))}
      </div>

      {addable.length > 0 && (
        <div className="device-pref-row board-editor-add">
          <span>{t('Add a card')}</span>
          <select className="settings-select" aria-label={t('Add a card')} value="" onChange={e => {
            const id = e.target.value as keyof typeof CARD_NAMES
            const next = addCard(layout, id)
            if (next === layout) { announce(t('Every column is full')); return }
            setLayout(next); announce(t('{card} added', { card: tm(CARD_NAMES[id]) }))
          }}>
            <option value="" disabled>{t('Choose…')}</option>
            {addable.map(id => <option key={id} value={id}>{tm(CARD_NAMES[id])}</option>)}
          </select>
        </div>
      )}
      <p className="field-hint">{t("A card for something the family turned off (like Meals) stays hidden, and a quote card shows only when there's one to show: set them up under Quotes & facts.")}</p>
      {onDelete && <button type="button" className="btn btn-danger board-editor-delete" onClick={onDelete}>{t('Delete this preset')}</button>}
      </div>
    </Sheet>
  )
}

/** The layouts a screen can pick, as <option>s: the default, the built-in ones, the family's (🏠),
 * and this screen's own (`own`: its label, or left out). */
function LayoutOptions({ presets, own }: { presets: BoardPreset[]; own?: string }) {
  return <>
    <option value="">{t('Family wall (default)')}</option>
    {BUILT_IN_PRESETS.map(p => <option key={p.id} value={p.id}>{tm(p.name)}</option>)}
    {presets.map(p => <option key={p.id} value={p.id}>{p.name} 🏠</option>)}
    {own && <option value={CUSTOM}>{own}</option>}
  </>
}

/** This screen's layout choice, '' for the default (also when its preset is gone). */
function useLayoutChoice() {
  const { settings } = useApp()
  const device = useDeviceAppearance()
  const presets = settings.boardPresets ?? []
  const v = device.boardLayout
  const choice = v && (v === CUSTOM ? !!device.boardCustom : [...BUILT_IN_PRESETS, ...presets].some(p => p.id === v)) ? v : ''
  const pick = (id: string) => {
    setDeviceAppearance({ ...device, boardLayout: id || undefined })
    const built = BUILT_IN_PRESETS.find(p => p.id === id)
    announce(t('Board layout: {name}', { name: id === CUSTOM ? t('own layout') : built ? tm(built.name) : presets.find(p => p.id === id)?.name ?? t('family wall') }))
  }
  return { device, presets, choice, pick }
}

/** Home's Layout and filter sheet: this screen's Board layout as chips (the Board changes behind the
 * sheet), the picked one's line under them, its own layout's editor, and Manage layouts in Settings. */
export function LayoutChips({ onLeave }: { onLeave: () => void }) {
  const { parentDevice } = useApp()
  const { device, presets, choice, pick } = useLayoutChoice()
  const [editing, setEditing] = useState(false)
  const set = (patch: DeviceAppearance) => setDeviceAppearance({ ...device, ...patch })
  const options = [
    { id: '', name: t('Family wall'), detail: t('The default: fits the cards to the screen') },
    ...BUILT_IN_PRESETS.map(p => ({ id: p.id, name: tm(p.name), detail: tm(PRESET_DETAIL[p.id]) })),
    ...presets.map(p => ({ id: p.id, name: `${p.name} 🏠`, detail: t('The family’s preset') })),
    { id: CUSTOM, name: device.boardCustom ? t('Own layout') : t('Own layout…'), detail: t('Made on this screen') },
  ]
  return (
    <>
      <div className="chip-row" role="group" aria-label={t('Layout on this screen')}>
        {options.map(o => (
          <button key={o.id || 'default'} type="button" className={`chip ${o.id === choice ? 'active' : ''}`} aria-pressed={o.id === choice}
            onClick={() => { if (o.id === CUSTOM && !device.boardCustom) setEditing(true); else pick(o.id) }}>{o.name}</button>
        ))}
      </div>
      <p className="settings-row-sub layout-detail">{options.find(o => o.id === choice)?.detail}</p>
      <div className="layout-links">
        {choice === CUSTOM && <button type="button" className="btn btn-secondary" aria-haspopup="dialog" onClick={() => setEditing(true)}>{t('Edit this screen’s layout')}</button>}
        <a className="btn btn-secondary" href={`#/settings?tab=general&section=${parentDevice ? 'board-presets' : 'board-layout'}`} onClick={onLeave}>{t('Manage layouts')}</a>
      </div>
      {editing && <BoardEditor title={t('This screen’s Board')} start={normalizeLayout(device.boardCustom ?? layoutFor(device.boardLayout, null, presets) ?? DEFAULT_LAYOUT)} presets={presets}
        onClose={() => setEditing(false)}
        onSave={layout => { set({ boardLayout: CUSTOM, boardCustom: layout }); setEditing(false); announce(t('Saved: this screen’s layout')) }} />}
    </>
  )
}

const PRESET_DETAIL: Record<string, string> = { kids: msg('Big text: today, chores, a picture'), kitchen: msg('Meals up front'), parents: msg('Small text: more on the screen'), simple: msg('Clock, a picture and today') }

/** Settings → This display: which layout this screen's Board uses, and its own layout's editor. */
export function DeviceBoardLayoutRows() {
  const { device, presets, choice, pick } = useLayoutChoice()
  const [editing, setEditing] = useState(false)
  const set = (patch: DeviceAppearance) => setDeviceAppearance({ ...device, ...patch })
  return (
    <>
      <div className="device-pref-row" id="board-layout">
        <span>{t('Board layout')}</span>
        <select className="settings-select" aria-label={t('Board layout')} value={choice} onChange={e => {
          const v = e.target.value
          // Own layout: start from what's showing now, and open the editor.
          if (v === CUSTOM && !device.boardCustom) setEditing(true); else pick(v)
        }}>
          <LayoutOptions presets={presets} own={device.boardCustom ? t('Own layout') : t('Own layout…')} />
        </select>
      </div>
      {choice === CUSTOM && <button type="button" className="btn btn-secondary board-layout-edit" aria-haspopup="dialog" onClick={() => setEditing(true)}>{t('Edit this screen’s layout')}</button>}
      <div className="settings-row-sub">{choice === CUSTOM ? t('This screen’s own layout, kept on this device.') : choice ? t('A preset: pick Own layout to change it just here.') : t('Fits the cards to the screen by itself.')}</div>
      {editing && <BoardEditor title={t('This screen’s Board')} start={normalizeLayout(device.boardCustom ?? layoutFor(device.boardLayout, null, presets) ?? DEFAULT_LAYOUT)} presets={presets}
        onClose={() => setEditing(false)}
        onSave={layout => { set({ boardLayout: CUSTOM, boardCustom: layout }); setEditing(false); announce(t('Saved: this screen’s layout')) }} />}
    </>
  )
}

/** Settings → For the whole family (parents): Board presets every screen can pick. */
export function BoardPresetRows({ toast }: { toast: (m: string, persist?: boolean) => void }) {
  const { settings, reloadCore } = useApp()
  const dialog = useDialog()
  const presets = settings.boardPresets ?? []
  const [editing, setEditing] = useState<BoardPreset | 'new' | null>(null)
  const save = async (next: BoardPreset[], said: string) => {
    try { await api.updateSettings({ boardPresets: next }); reloadCore(); setEditing(null); toast(said) } catch (e) { toast(e instanceof ApiError ? e.message : t('Could not save the preset'), true) }
  }
  const current = editing === 'new' ? null : editing
  return (
    <>
      {presets.length === 0 ? <div className="settings-row-sub">{t('None yet. Every screen can also pick Kids, Kitchen, Parents or Simple, or make its own.')}</div> : presets.map(p => (
        <div key={p.id} className="tidbit-card-row">
          <span>
            <span className="settings-row-label">{p.name}</span>
            <span className="settings-row-sub">{p.layout.columns.flat().map(c => tm(CARD_NAMES[c.id])).join(', ') || t('No cards')}</span>
          </span>
          <button type="button" className="btn btn-secondary tidbit-card-edit" aria-haspopup="dialog" aria-label={t('Edit {name}', { name: p.name })} onClick={() => setEditing(p)}>{t('Edit')}</button>
        </div>
      ))}
      {presets.length < MAX_PRESETS && <button type="button" className="btn btn-secondary board-layout-edit" aria-haspopup="dialog" onClick={() => setEditing('new')}>{t('Add a preset')}</button>}
      {editing && <BoardEditor title={current ? t('Preset: {name}', { name: current.name }) : t('New Board preset')} start={current?.layout ?? DEFAULT_LAYOUT} name={current?.name ?? ''} presets={presets}
        onClose={() => setEditing(null)}
        onSave={(layout, name) => void save(current ? presets.map(p => p.id === current.id ? { ...p, name, layout } : p) : [...presets, { id: `p_${Date.now().toString(36)}`, name, layout }], t('Saved: {name}', { name }))}
        onDelete={current ? async () => {
          if (!await dialog.confirm({ title: t('Delete {name}?', { name: current.name }), body: t('Screens using it go back to the family wall layout.'), confirmLabel: t('Delete'), danger: true })) return
          await save(presets.filter(p => p.id !== current.id), t('Deleted: {name}', { name: current.name }))
        } : undefined} />}
    </>
  )
}
