// node --test test/ (npm test). The calendar filter's settings preview and keyword list.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FILTER_PRESETS, NO_FILTER, hideLikeThis, parseKeywordList, previewFilter, type CalendarFilter } from '../src/calendarFilter.ts'

const school = FILTER_PRESETS.find(p => p.id === 'school')!.filter
const ev = (title: string, allDay = true, hidden: 'filter' | null = null) => ({ title, allDay, categoryId: null, hidden })

test('keywords: split on commas, trimmed, blanks and repeats (any case) dropped', () => {
  assert.deepEqual(parseKeywordList(' no school, Half Day,,half day , break '), ['no school', 'Half Day', 'break'])
  assert.deepEqual(parseKeywordList(''), [])
})

test('preview: the draft filter decides, not what the server said about the saved one', () => {
  const events = [ev('Winter Break – No School'), ev('Breakfast with Principal', false, 'filter'), ev('Half Day - Early Release'), ev('Science Fair')]
  const { shown, hidden } = previewFilter(events, school)
  assert.deepEqual(shown.map(e => e.title), ['Winter Break – No School', 'Half Day - Early Release'])
  assert.deepEqual(hidden.map(e => e.title), ['Breakfast with Principal', 'Science Fair'])
  // Switching the draft back to all events shows what the saved filter hides.
  assert.equal(previewFilter(events, NO_FILTER).shown.length, 4)
})

test('presets: Hide birthdays hides only birthdays; every preset has something to match', () => {
  const birthdays = FILTER_PRESETS.find(p => p.id === 'birthdays')!.filter
  const { hidden } = previewFilter([ev("Sam's Birthday"), ev('Soccer')], birthdays)
  assert.deepEqual(hidden.map(e => e.title), ["Sam's Birthday"])
  for (const p of FILTER_PRESETS) assert.ok(p.filter.keywords.length > 0 && p.filter.mode !== 'all', p.id)
  const holidays: CalendarFilter = FILTER_PRESETS.find(p => p.id === 'holidays')!.filter
  assert.deepEqual(previewFilter([ev('Thanksgiving'), ev('Dentist', false)], holidays).shown.map(e => e.title), ['Thanksgiving'])
})

test('Hide events like this: starts an except filter, or adds the title to one', () => {
  const fair = { title: 'Science Fair', allDay: false, categoryId: null }
  assert.deepEqual(hideLikeThis(NO_FILTER, fair), { mode: 'except', keywords: ['Science Fair'], allDay: 'any', categoryIds: [] })
  const except: CalendarFilter = { mode: 'except', keywords: ['birthday'], allDay: 'any', categoryIds: [] }
  assert.deepEqual(hideLikeThis(except, fair)!.keywords, ['birthday', 'Science Fair'])
  assert.deepEqual(hideLikeThis({ ...except, keywords: ['science fair'] }, fair)!.keywords, ['science fair'], 'no repeat, in any case')
  // "All events" keeps a leftover rule; hiding like this starts fresh rather than reviving it.
  assert.deepEqual(hideLikeThis({ mode: 'all', keywords: ['x'], allDay: 'allDay', categoryIds: ['c'] }, fair)!.keywords, ['Science Fair'])
})

test("Hide events like this: can't when it would show other events or can't hide this one", () => {
  const fair = { title: 'Science Fair', allDay: false, categoryId: null }
  assert.equal(hideLikeThis(school, fair), null, 'an only filter')
  assert.equal(hideLikeThis({ mode: 'except', keywords: [], allDay: 'allDay', categoryIds: [] }, { ...fair, allDay: true }), null, 'a keyword would narrow "except all-day"')
  assert.equal(hideLikeThis({ mode: 'except', keywords: ['birthday'], allDay: 'allDay', categoryIds: [] }, fair), null, 'a timed event never matches this rule')
})
