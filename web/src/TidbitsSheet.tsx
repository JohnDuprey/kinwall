// Settings → For the whole family → Quotes & facts: which sources the Board's quote / fact card
// draws from, and the categories within each. A sheet of its own so the settings list stays short.
// The same sheet edits a device's own cards (Settings → This display, DeviceTidbitRows below).
import { useState } from 'react'
import Sheet from './Sheet.tsx'
import { announce } from './a11y.tsx'
import { setDeviceAppearance, useDeviceAppearance } from './useTheme.ts'
import { useApp } from './AppContext.tsx'
import { FACT_CATEGORY_LABELS, MAX_TIDBIT_CARDS, SOURCE_TITLES, TIP_CATEGORY_LABELS, tidbitCardTitle, tidbitSummary } from './tidbits.ts'
import type { FactCategory, OnThisDayKind, TidbitSettings, TidbitSource, TipCategory } from './types.ts'

// Open Trivia DB categories that suit a family wall (ids from opentdb.com/api_category.php).
const TRIVIA_CATEGORIES: { id: number; label: string }[] = [
  { id: 27, label: '🐾 Animals' }, { id: 17, label: '🔬 Science & nature' }, { id: 22, label: '🌍 Geography' },
  { id: 9, label: '💡 General knowledge' }, { id: 23, label: '🏛️ History' }, { id: 19, label: '➗ Math' },
  { id: 20, label: '🐉 Mythology' }, { id: 21, label: '⚽ Sports' }, { id: 25, label: '🎨 Art' },
  { id: 10, label: '📚 Books' }, { id: 11, label: '🎬 Movies' }, { id: 12, label: '🎵 Music' },
  { id: 32, label: '📺 Cartoons' }, { id: 15, label: '🎮 Video games' }, { id: 16, label: '🎲 Board games' },
  { id: 18, label: '💻 Computers' }, { id: 28, label: '🚗 Vehicles' },
]
const DIFFICULTIES: { key: 'easy' | 'medium' | 'hard'; label: string }[] = [{ key: 'easy', label: '🙂 Easy' }, { key: 'medium', label: '🤔 Medium' }, { key: 'hard', label: '🧐 Hard' }]
const ON_THIS_DAY: { key: OnThisDayKind; label: string }[] = [
  { key: 'holidays', label: '🎉 Holidays & observances' }, { key: 'births', label: '🎂 Birthdays' }, { key: 'events', label: '📜 History' },
]
const SOURCES: { key: TidbitSource; sub: string }[] = [
  { key: 'quotes', sub: 'Built in: authors, scientists and storytellers.' },
  { key: 'facts', sub: 'Built in, for all ages.' },
  { key: 'tips', sub: 'Built in: small, practical ideas for routines, focus and feelings that help neurodivergent kids and grown-ups, and everyone else too.' },
  { key: 'onthisday', sub: 'From Wikipedia: today’s holidays, birthdays and history.' },
  { key: 'trivia', sub: 'From Open Trivia DB, multiple choice. Tap an answer to see if it’s right; Try again resets it.' },
]

const FAMILY_INTRO = 'The Board’s quote card takes turns through what’s on here, changing every half hour. Every screen on the family’s choice shows the same one. Turn everything off to hide the card.'

/** `title`, `intro`, `onRemove`: for one of a device's own cards (DeviceTidbitRows). */
export default function TidbitsSheet({ value, onClose, onSave, title = 'Quotes & facts', intro = FAMILY_INTRO, onRemove }: {
  value: TidbitSettings; onClose: () => void; onSave: (t: TidbitSettings) => Promise<void>; title?: string; intro?: string; onRemove?: () => void
}) {
  const [t, setT] = useState(value)
  const [busy, setBusy] = useState(false)
  const toggle = <K,>(list: K[], k: K) => (list.includes(k) ? list.filter(x => x !== k) : [...list, k])
  const on = (s: TidbitSource) => t.sources.includes(s)
  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button key={label} type="button" className={`chip ${active ? 'active' : ''}`} aria-pressed={active} onClick={onClick}>{label}</button>
  )
  const valid = t.onThisDay.length > 0 && t.triviaCategories.length > 0 && t.triviaDifficulties.length > 0
  return (
    <Sheet title={title} onClose={onClose}
      actions={<button className="btn btn-primary" disabled={!valid || busy} onClick={async () => { setBusy(true); try { await onSave(t) } finally { setBusy(false) } }}>Save</button>}>
      <p className="settings-row-sub">{intro}</p>
      {SOURCES.map(s => (
        <div key={s.key} className="tidbit-source">
          <div className="toggle-row">
            <div>
              <label id={`tidbit-${s.key}`}>{SOURCE_TITLES[s.key]}</label>
              <div className="settings-row-sub">{s.sub}</div>
            </div>
            <button className={`switch ${on(s.key) ? 'on' : ''}`} role="switch" aria-checked={on(s.key)} aria-labelledby={`tidbit-${s.key}`}
              onClick={() => setT(x => ({ ...x, sources: toggle(x.sources, s.key) }))}><span className="knob" /></button>
          </div>
          {s.key === 'facts' && on('facts') && (
            <div className="chip-row" role="group" aria-label="Fact categories">
              {chip(t.factCategories.length === 0, '✨ All', () => setT(x => ({ ...x, factCategories: [] })))}
              {(Object.keys(FACT_CATEGORY_LABELS) as FactCategory[]).map(c =>
                chip(t.factCategories.includes(c), FACT_CATEGORY_LABELS[c], () => setT(x => ({ ...x, factCategories: toggle(x.factCategories, c) }))))}
            </div>
          )}
          {s.key === 'tips' && on('tips') && (
            <div className="chip-row" role="group" aria-label="Tip categories">
              {chip(!t.tipCategories?.length, '✨ All', () => setT(x => ({ ...x, tipCategories: [] })))}
              {(Object.keys(TIP_CATEGORY_LABELS) as TipCategory[]).map(c =>
                chip(!!t.tipCategories?.includes(c), TIP_CATEGORY_LABELS[c], () => setT(x => ({ ...x, tipCategories: toggle(x.tipCategories ?? [], c) }))))}
            </div>
          )}
          {s.key === 'onthisday' && on('onthisday') && <>
            <div className="chip-row" role="group" aria-label="On this day">
              {ON_THIS_DAY.map(k => chip(t.onThisDay.includes(k.key), k.label, () => setT(x => ({ ...x, onThisDay: toggle(x.onThisDay, k.key) }))))}
            </div>
            {t.onThisDay.length === 0 && <p className="settings-row-sub">Pick at least one.</p>}
            {t.onThisDay.includes('births') && (
              <div className="settings-row">
                <label className="settings-row-label" htmlFor="births-after">Birthdays of people born</label>
                <select id="births-after" className="settings-select" value={t.birthsAfter ?? ''}
                  onChange={e => { const v = e.target.value; setT(x => ({ ...x, birthsAfter: v === '' ? null : Number(v) })) }}>
                  {[1800, 1900, 1950, 1970, 1990].map(y => <option key={y} value={y}>Since {y}</option>)}
                  <option value="">Any time</option>
                </select>
              </div>
            )}
            {t.onThisDay.includes('events') && <p className="settings-row-sub">History leaves out wars, disasters and crimes, but it’s the least kid-proof of the three.</p>}
          </>}
          {s.key === 'trivia' && on('trivia') && <>
            <div className="chip-row" role="group" aria-label="Trivia categories">
              {TRIVIA_CATEGORIES.map(c => chip(t.triviaCategories.includes(c.id), c.label, () => setT(x => ({ ...x, triviaCategories: toggle(x.triviaCategories, c.id) }))))}
            </div>
            {t.triviaCategories.length === 0 && <p className="settings-row-sub">Pick at least one. One category is used each day, taking turns.</p>}
            <div className="chip-row" role="group" aria-label="Difficulty">
              {DIFFICULTIES.map(d => chip(t.triviaDifficulties.includes(d.key), d.label, () => setT(x => ({ ...x, triviaDifficulties: toggle(x.triviaDifficulties, d.key) }))))}
            </div>
            {t.triviaDifficulties.length === 0 && <p className="settings-row-sub">Pick at least one difficulty.</p>}
          </>}
        </div>
      ))}
      {(on('onthisday') || on('trivia')) && (
        <p className="settings-row-sub">Your Kinwall server fetches these once a day. Nothing about your family is sent, and screens never contact Wikipedia or Open Trivia DB themselves. When they can’t be reached, the built-in quotes and facts fill in.</p>
      )}
      {onRemove && <button className="btn btn-secondary tidbit-remove" onClick={onRemove}>Remove this card</button>}
    </Sheet>
  )
}

/** "Trivia: 🐾 Animals, 🔬 Science & nature · 🙂 Easy", one line per source that's on. */
function cardDetail(c: TidbitSettings): string {
  const labels = <K,>(all: { key: K; label: string }[], picked: K[]) => all.filter(x => picked.includes(x.key)).map(x => x.label).join(', ')
  const parts = c.sources.map(s =>
    s === 'facts' ? `${SOURCE_TITLES.facts}: ${c.factCategories.length ? c.factCategories.map(k => FACT_CATEGORY_LABELS[k]).join(', ') : 'all'}`
    : s === 'tips' ? `Tips: ${c.tipCategories?.length ? c.tipCategories.map(k => TIP_CATEGORY_LABELS[k]).join(', ') : 'all'}`
    : s === 'onthisday' ? `${SOURCE_TITLES.onthisday}: ${labels(ON_THIS_DAY, c.onThisDay)}`
    : s === 'trivia' ? `Trivia: ${labels(TRIVIA_CATEGORIES.map(t => ({ key: t.id, label: t.label })), c.triviaCategories)} · ${labels(DIFFICULTIES, c.triviaDifficulties)}`
    : SOURCE_TITLES[s])
  return parts.length ? parts.join('. ') : 'Off: this card is hidden.'
}

/** Settings → This display: the Board's quote / fact cards on this device. The family's choice
 *  (default), or up to MAX_TIDBIT_CARDS cards of this device's own, each with its own sources. */
export function DeviceTidbitRows() {
  const { settings } = useApp()
  const device = useDeviceAppearance()
  const cards = device.tidbitCards ?? []
  const [editing, setEditing] = useState<number | null>(null)
  const save = (next: TidbitSettings[] | undefined) => setDeviceAppearance({ ...device, tidbitCards: next?.length ? next : undefined })
  const name = (c: TidbitSettings) => c.sources.length ? tidbitCardTitle(c) : 'Nothing on'
  return (
    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div className="device-pref-row">
        <span>Board quotes &amp; facts</span>
        <select className="settings-select" aria-label="Board quotes and facts" value={cards.length ? 'own' : ''}
          onChange={e => {
            if (e.target.value) { save([{ ...settings.tidbits }]); announce('This device picks its own quotes and facts') }
            else { save(undefined); announce("This device follows the family's quotes and facts") }
          }}>
          <option value="">Family’s choice</option>
          <option value="own">Own picks</option>
        </select>
      </div>
      {!cards.length ? <div className="settings-row-sub">This screen shows the family’s quote card ({tidbitSummary(settings.tidbits)}).</div> : <>
        <div className="settings-row-sub">Up to {MAX_TIDBIT_CARDS} cards, each taking turns through its own picks. A phone, or a tablet on its side, shows the first one.</div>
        {cards.map((c, i) => (
          <div key={i} className="tidbit-card-row">
            <span>
              <span className="settings-row-label">{i + 1}. {name(c)}</span>
              <span className="settings-row-sub">{cardDetail(c)}</span>
            </span>
            <button className="btn btn-secondary tidbit-card-edit" aria-haspopup="dialog" aria-label={`Change card ${i + 1}, ${name(c)}`} onClick={() => setEditing(i)}>Change</button>
          </div>
        ))}
        {cards.length < MAX_TIDBIT_CARDS && (
          <button className="btn btn-secondary tidbit-card-add" aria-haspopup="dialog"
            onClick={() => { save([...cards, { ...settings.tidbits, sources: ['trivia'] }]); setEditing(cards.length) }}>Add a card</button>
        )}
      </>}
      {editing !== null && cards[editing] && (
        <TidbitsSheet value={{ ...settings.tidbits, ...cards[editing] }} title={`Card ${editing + 1} on this device`}
          intro="This card takes turns through what’s on here. Only this screen changes. Turn everything off to hide the card."
          onClose={() => setEditing(null)}
          onSave={async t => { save(cards.map((c, i) => i === editing ? t : c)); setEditing(null); announce(`Saved: ${name(t)}`) }}
          onRemove={cards.length > 1 ? () => { save(cards.filter((_, i) => i !== editing)); setEditing(null); announce('Card removed') } : undefined} />
      )}
    </div>
  )
}
