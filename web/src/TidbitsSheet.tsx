// Settings → For the whole family → Quotes & facts: which sources the Board's quote / fact card
// draws from, and the categories within each. A sheet of its own so the settings list stays short.
// The same sheet edits a device's own cards (Settings → This display, DeviceTidbitRows below).
import { useState } from 'react'
import Sheet from './Sheet.tsx'
import { announce } from './a11y.tsx'
import { setDeviceAppearance, useDeviceAppearance } from './useTheme.ts'
import { useApp } from './AppContext.tsx'
import { FACT_CATEGORY_LABELS, MAX_TIDBIT_CARDS, SOURCE_TITLES, TIP_CATEGORY_LABELS, tidbitCardTitle, tidbitSummary } from './tidbits.ts'
import { msg, t, tm } from './i18n.ts'
import type { FactCategory, OnThisDayKind, TidbitSettings, TidbitSource, TipCategory } from './types.ts'

// Open Trivia DB categories that suit a family wall (ids from opentdb.com/api_category.php).
const TRIVIA_CATEGORIES: { id: number; label: string }[] = [
  { id: 27, label: msg('🐾 Animals') }, { id: 17, label: msg('🔬 Science & nature') }, { id: 22, label: msg('🌍 Geography') },
  { id: 9, label: msg('💡 General knowledge') }, { id: 23, label: msg('🏛️ History') }, { id: 19, label: msg('➗ Math') },
  { id: 20, label: msg('🐉 Mythology') }, { id: 21, label: msg('⚽ Sports') }, { id: 25, label: msg('🎨 Art') },
  { id: 10, label: msg('📚 Books') }, { id: 11, label: msg('🎬 Movies') }, { id: 12, label: msg('🎵 Music') },
  { id: 32, label: msg('📺 Cartoons') }, { id: 15, label: msg('🎮 Video games') }, { id: 16, label: msg('🎲 Board games') },
  { id: 18, label: msg('💻 Computers') }, { id: 28, label: msg('🚗 Vehicles') },
]
const DIFFICULTIES: { key: 'easy' | 'medium' | 'hard'; label: string }[] = [{ key: 'easy', label: msg('🙂 Easy') }, { key: 'medium', label: msg('🤔 Medium') }, { key: 'hard', label: msg('🧐 Hard') }]
const ON_THIS_DAY: { key: OnThisDayKind; label: string }[] = [
  { key: 'holidays', label: msg('🎉 Holidays & observances') }, { key: 'births', label: msg('🎂 Birthdays') }, { key: 'events', label: msg('📜 History') },
]
const SOURCES: { key: TidbitSource; sub: string }[] = [
  { key: 'quotes', sub: msg('Built in: authors, scientists and storytellers.') },
  { key: 'facts', sub: msg('Built in, for all ages.') },
  { key: 'tips', sub: msg('Built in: small, practical ideas for routines, focus and feelings that help neurodivergent kids and grown-ups, and everyone else too.') },
  { key: 'onthisday', sub: msg('From Wikipedia: today’s holidays, birthdays and history.') },
  { key: 'trivia', sub: msg('From Open Trivia DB, multiple choice. Tap an answer to see if it’s right; Try again resets it.') },
]

const FAMILY_INTRO = msg('The Board’s quote card takes turns through what’s on here, changing every half hour. Every screen on the family’s choice shows the same one. Turn everything off to hide the card.')

/** `title`, `intro`, `onRemove`: for one of a device's own cards (DeviceTidbitRows). */
export default function TidbitsSheet({ value, onClose, onSave, title, intro, onRemove }: {
  value: TidbitSettings; onClose: () => void; onSave: (t: TidbitSettings) => Promise<void>; title?: string; intro?: string; onRemove?: () => void
}) {
  const [cfg, setT] = useState(value)
  const [busy, setBusy] = useState(false)
  const toggle = <K,>(list: K[], k: K) => (list.includes(k) ? list.filter(x => x !== k) : [...list, k])
  const on = (s: TidbitSource) => cfg.sources.includes(s)
  const chip = (active: boolean, label: string, onClick: () => void) => (
    <button key={label} type="button" className={`chip ${active ? 'active' : ''}`} aria-pressed={active} onClick={onClick}>{label}</button>
  )
  const valid = cfg.onThisDay.length > 0 && cfg.triviaCategories.length > 0 && cfg.triviaDifficulties.length > 0
  return (
    <Sheet title={title ?? t('Quotes & facts')} onClose={onClose}
      actions={<button className="btn btn-primary" disabled={!valid || busy} onClick={async () => { setBusy(true); try { await onSave(cfg) } finally { setBusy(false) } }}>{t('Save')}</button>}>
      <p className="settings-row-sub">{intro ?? tm(FAMILY_INTRO)}</p>
      {SOURCES.map(s => (
        <div key={s.key} className="tidbit-source">
          <div className="toggle-row">
            <div>
              <label id={`tidbit-${s.key}`}>{tm(SOURCE_TITLES[s.key])}</label>
              <div className="settings-row-sub">{tm(s.sub)}</div>
            </div>
            <button className={`switch ${on(s.key) ? 'on' : ''}`} role="switch" aria-checked={on(s.key)} aria-labelledby={`tidbit-${s.key}`}
              onClick={() => setT(x => ({ ...x, sources: toggle(x.sources, s.key) }))}><span className="knob" /></button>
          </div>
          {s.key === 'facts' && on('facts') && (
            <div className="chip-row" role="group" aria-label={t('Fact categories')}>
              {chip(cfg.factCategories.length === 0, t('✨ All'), () => setT(x => ({ ...x, factCategories: [] })))}
              {(Object.keys(FACT_CATEGORY_LABELS) as FactCategory[]).map(c =>
                chip(cfg.factCategories.includes(c), tm(FACT_CATEGORY_LABELS[c]), () => setT(x => ({ ...x, factCategories: toggle(x.factCategories, c) }))))}
            </div>
          )}
          {s.key === 'tips' && on('tips') && (
            <div className="chip-row" role="group" aria-label={t('Tip categories')}>
              {chip(!cfg.tipCategories?.length, t('✨ All'), () => setT(x => ({ ...x, tipCategories: [] })))}
              {(Object.keys(TIP_CATEGORY_LABELS) as TipCategory[]).map(c =>
                chip(!!cfg.tipCategories?.includes(c), tm(TIP_CATEGORY_LABELS[c]), () => setT(x => ({ ...x, tipCategories: toggle(x.tipCategories ?? [], c) }))))}
            </div>
          )}
          {s.key === 'onthisday' && on('onthisday') && <>
            <div className="chip-row" role="group" aria-label={t('On this day')}>
              {ON_THIS_DAY.map(k => chip(cfg.onThisDay.includes(k.key), tm(k.label), () => setT(x => ({ ...x, onThisDay: toggle(x.onThisDay, k.key) }))))}
            </div>
            {cfg.onThisDay.length === 0 && <p className="settings-row-sub">{t('Pick at least one.')}</p>}
            {cfg.onThisDay.includes('births') && (
              <div className="settings-row">
                <label className="settings-row-label" htmlFor="births-after">{t('Birthdays of people born')}</label>
                <select id="births-after" className="settings-select" value={cfg.birthsAfter ?? ''}
                  onChange={e => { const v = e.target.value; setT(x => ({ ...x, birthsAfter: v === '' ? null : Number(v) })) }}>
                  {[1800, 1900, 1950, 1970, 1990].map(y => <option key={y} value={y}>{t('Since {year}', { year: y })}</option>)}
                  <option value="">{t('Any time')}</option>
                </select>
              </div>
            )}
            {cfg.onThisDay.includes('events') && <p className="settings-row-sub">{t('History leaves out wars, disasters and crimes, but it’s the least kid-proof of the three.')}</p>}
          </>}
          {s.key === 'trivia' && on('trivia') && <>
            <div className="chip-row" role="group" aria-label={t('Trivia categories')}>
              {TRIVIA_CATEGORIES.map(c => chip(cfg.triviaCategories.includes(c.id), tm(c.label), () => setT(x => ({ ...x, triviaCategories: toggle(x.triviaCategories, c.id) }))))}
            </div>
            {cfg.triviaCategories.length === 0 && <p className="settings-row-sub">{t('Pick at least one. One category is used each day, taking turns.')}</p>}
            <div className="chip-row" role="group" aria-label={t('Difficulty')}>
              {DIFFICULTIES.map(d => chip(cfg.triviaDifficulties.includes(d.key), tm(d.label), () => setT(x => ({ ...x, triviaDifficulties: toggle(x.triviaDifficulties, d.key) }))))}
            </div>
            {cfg.triviaDifficulties.length === 0 && <p className="settings-row-sub">{t('Pick at least one difficulty.')}</p>}
          </>}
        </div>
      ))}
      {(on('onthisday') || on('trivia')) && (
        <p className="settings-row-sub">{t('Your Kinwall server fetches these once a day. Nothing about your family is sent, and screens never contact Wikipedia or Open Trivia DB themselves. When they can’t be reached, the built-in quotes and facts fill in.')}</p>
      )}
      {onRemove && <button className="btn btn-secondary tidbit-remove" onClick={onRemove}>{t('Remove this card')}</button>}
    </Sheet>
  )
}

/** "Trivia: 🐾 Animals, 🔬 Science & nature · 🙂 Easy", one line per source that's on. */
function cardDetail(c: TidbitSettings): string {
  const labels = <K,>(all: { key: K; label: string }[], picked: K[]) => all.filter(x => picked.includes(x.key)).map(x => tm(x.label)).join(', ')
  const parts = c.sources.map(s =>
    s === 'facts' ? t('{source}: {list}', { source: tm(SOURCE_TITLES.facts), list: c.factCategories.length ? c.factCategories.map(k => tm(FACT_CATEGORY_LABELS[k])).join(', ') : t('all') })
    : s === 'tips' ? t('Tips: {list}', { list: c.tipCategories?.length ? c.tipCategories.map(k => tm(TIP_CATEGORY_LABELS[k])).join(', ') : t('all') })
    : s === 'onthisday' ? t('{source}: {list}', { source: tm(SOURCE_TITLES.onthisday), list: labels(ON_THIS_DAY, c.onThisDay) })
    : s === 'trivia' ? t('Trivia: {list}', { list: `${labels(TRIVIA_CATEGORIES.map(x => ({ key: x.id, label: x.label })), c.triviaCategories)} · ${labels(DIFFICULTIES, c.triviaDifficulties)}` })
    : tm(SOURCE_TITLES[s]))
  return parts.length ? parts.join('. ') : t('Off: this card is hidden.')
}

/** Settings → This display: the Board's quote / fact cards on this device. The family's choice
 *  (default), or up to MAX_TIDBIT_CARDS cards of this device's own, each with its own sources. */
export function DeviceTidbitRows() {
  const { settings } = useApp()
  const device = useDeviceAppearance()
  const cards = device.tidbitCards ?? []
  const [editing, setEditing] = useState<number | null>(null)
  const save = (next: TidbitSettings[] | undefined) => setDeviceAppearance({ ...device, tidbitCards: next?.length ? next : undefined })
  const name = (c: TidbitSettings) => c.sources.length ? tidbitCardTitle(c) : t('Nothing on')
  return (
    <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 10 }}>
      <div className="device-pref-row">
        <span>{t('Board quotes & facts')}</span>
        <select className="settings-select" aria-label={t('Board quotes and facts')} value={cards.length ? 'own' : ''}
          onChange={e => {
            if (e.target.value) { save([{ ...settings.tidbits }]); announce(t('This device picks its own quotes and facts')) }
            else { save(undefined); announce(t("This device follows the family's quotes and facts")) }
          }}>
          <option value="">{t('Family’s choice')}</option>
          <option value="own">{t('Own picks')}</option>
        </select>
      </div>
      {!cards.length ? <div className="settings-row-sub">{t('This screen shows the family’s quote card ({summary}).', { summary: tidbitSummary(settings.tidbits) })}</div> : <>
        <div className="settings-row-sub">{t('Up to {n} cards, each taking turns through its own picks. A phone, or a tablet on its side, shows the first one.', { n: MAX_TIDBIT_CARDS })}</div>
        {cards.map((c, i) => (
          <div key={i} className="tidbit-card-row">
            <span>
              <span className="settings-row-label">{i + 1}. {name(c)}</span>
              <span className="settings-row-sub">{cardDetail(c)}</span>
            </span>
            <button className="btn btn-secondary tidbit-card-edit" aria-haspopup="dialog" aria-label={t('Change card {n}, {name}', { n: i + 1, name: name(c) })} onClick={() => setEditing(i)}>{t('Change')}</button>
          </div>
        ))}
        {cards.length < MAX_TIDBIT_CARDS && (
          <button className="btn btn-secondary tidbit-card-add" aria-haspopup="dialog"
            onClick={() => { save([...cards, { ...settings.tidbits, sources: ['trivia'] }]); setEditing(cards.length) }}>{t('Add a card')}</button>
        )}
      </>}
      {editing !== null && cards[editing] && (
        <TidbitsSheet value={{ ...settings.tidbits, ...cards[editing] }} title={t('Card {n} on this device', { n: editing + 1 })}
          intro={t('This card takes turns through what’s on here. Only this screen changes. Turn everything off to hide the card.')}
          onClose={() => setEditing(null)}
          onSave={async next => { save(cards.map((c, i) => i === editing ? next : c)); setEditing(null); announce(t('Saved: {name}', { name: name(next) })) }}
          onRemove={cards.length > 1 ? () => { save(cards.filter((_, i) => i !== editing)); setEditing(null); announce(t('Card removed')) } : undefined} />
      )}
    </div>
  )
}
