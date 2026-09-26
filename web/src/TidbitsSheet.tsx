// Settings → For the whole family → Quotes & facts: which sources the Board's quote / fact card
// draws from, and the categories within each. A sheet of its own so the settings list stays short.
import { useState } from 'react'
import Sheet from './Sheet.tsx'
import { Segmented } from './a11y.tsx'
import { FACT_CATEGORY_LABELS, SOURCE_TITLES } from './tidbits.ts'
import type { FactCategory, OnThisDayKind, TidbitSettings, TidbitSource } from './types.ts'

// Open Trivia DB categories that suit a family wall (ids from opentdb.com/api_category.php).
const TRIVIA_CATEGORIES: { id: number; label: string }[] = [
  { id: 27, label: '🐾 Animals' }, { id: 17, label: '🔬 Science & nature' }, { id: 22, label: '🌍 Geography' },
  { id: 9, label: '💡 General knowledge' }, { id: 23, label: '🏛️ History' }, { id: 19, label: '➗ Math' },
  { id: 20, label: '🐉 Mythology' }, { id: 21, label: '⚽ Sports' }, { id: 25, label: '🎨 Art' },
  { id: 10, label: '📚 Books' }, { id: 11, label: '🎬 Movies' }, { id: 12, label: '🎵 Music' },
  { id: 32, label: '📺 Cartoons' }, { id: 15, label: '🎮 Video games' }, { id: 16, label: '🎲 Board games' },
  { id: 18, label: '💻 Computers' }, { id: 28, label: '🚗 Vehicles' },
]
const ON_THIS_DAY: { key: OnThisDayKind; label: string }[] = [
  { key: 'holidays', label: '🎉 Holidays & observances' }, { key: 'births', label: '🎂 Birthdays' }, { key: 'events', label: '📜 History' },
]
const SOURCES: { key: TidbitSource; sub: string }[] = [
  { key: 'quotes', sub: 'Built in: authors, scientists and storytellers.' },
  { key: 'facts', sub: 'Built in, for all ages.' },
  { key: 'onthisday', sub: 'From Wikipedia: today’s holidays, birthdays and history.' },
  { key: 'trivia', sub: 'From Open Trivia DB, multiple choice. Tap to show the answer, and again to hide it.' },
]

export default function TidbitsSheet({ value, onClose, onSave }: { value: TidbitSettings; onClose: () => void; onSave: (t: TidbitSettings) => Promise<void> }) {
  const [t, setT] = useState(value)
  const [busy, setBusy] = useState(false)
  const toggle = <K,>(list: K[], k: K) => (list.includes(k) ? list.filter(x => x !== k) : [...list, k])
  const on = (s: TidbitSource) => t.sources.includes(s)
  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button key={label} type="button" className={`chip ${active ? 'active' : ''}`} aria-pressed={active} onClick={onClick}>{label}</button>
  )
  const valid = t.onThisDay.length > 0 && t.triviaCategories.length > 0
  return (
    <Sheet title="Quotes & facts" onClose={onClose}
      actions={<button className="btn btn-primary" disabled={!valid || busy} onClick={async () => { setBusy(true); try { await onSave(t) } finally { setBusy(false) } }}>Save</button>}>
      <p className="settings-row-sub">The Board’s quote card takes turns through what’s on here, changing every half hour. Every screen shows the same one. Turn everything off to hide the card.</p>
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
            <Segmented label="Difficulty" value={t.triviaDifficulty} onChange={v => setT(x => ({ ...x, triviaDifficulty: v }))}
              options={[{ key: 'easy', label: 'Easy' }, { key: 'medium', label: 'Medium' }, { key: 'hard', label: 'Hard' }, { key: 'any', label: 'Mixed' }]} />
          </>}
        </div>
      ))}
      {(on('onthisday') || on('trivia')) && (
        <p className="settings-row-sub">Your Kinwall server fetches these once a day. Nothing about your family is sent, and screens never contact Wikipedia or Open Trivia DB themselves. When they can’t be reached, the built-in quotes and facts fill in.</p>
      )}
    </Sheet>
  )
}
