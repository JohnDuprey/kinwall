// node --test test/ (npm test). Newscast's day sections, family totals, "New: N" and "You".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PER_DAY, asYou, daySections, newCount, pictureAlt, weekDigest } from '../src/newscast.ts'
import type { NewscastItem } from '../src/types.ts'

const item = (key: string, date: string, kind: NewscastItem['kind'] = 'chores', extra: Partial<NewscastItem> = {}): NewscastItem => ({
  key, kind, date, at: null, memberId: 'm4', emoji: '✅', title: 'Leo finished Make bed', detail: null, count: 1, photos: [], post: null, reactions: [], ...extra,
})
const today = '2026-10-01' // a Thursday

test('daySections: Today, Yesterday, weekdays this week, then dates; newest first', () => {
  const s = daySections([item('a', '2026-10-01'), item('b', '2026-09-30'), item('c', '2026-09-28'), item('d', '2026-09-20'), item('e', '2026-10-01')], today)
  assert.deepEqual(s.map(d => d.label), ['Today', 'Yesterday', 'Monday', 'Sunday, September 20'])
  assert.deepEqual(s.map(d => d.long), ['Thursday, October 1', 'Wednesday, September 30', 'Monday, September 28', 'Sunday, September 20'])
  assert.deepEqual(s[0].items.map(i => i.key), ['a', 'e'])
})

test('daySections: about 8 a day, the rest behind "Show all" for that day', () => {
  const many = Array.from({ length: 11 }, (_, i) => item(`k${i}`, today))
  const [day] = daySections(many, today)
  assert.equal(day.items.length, PER_DAY)
  assert.equal(day.more, 3)
  const [all] = daySections(many, today, new Set([today]))
  assert.deepEqual([all.items.length, all.more], [11, 0])
})

test('weekDigest: family totals for the last 7 days, counting grouped chores and pictures', () => {
  const d = weekDigest([
    item('c1', today, 'chores', { count: 4 }), item('c2', '2026-09-26', 'chores', { count: 2 }), item('c3', '2026-09-24', 'chores', { count: 9 }), // 8 days ago: not this week
    item('b', '2026-09-30', 'book'), item('p', today, 'photos', { count: 3 }), item('dr', today, 'drawings'), item('r', today, 'reward'), item('x', today, 'post'),
  ], today)
  assert.deepEqual(d, { chores: 6, books: 1, pictures: 4, rewards: 1 })
})

test('newCount: what a fresh load has that the screen does not', () => {
  const shown = [item('a', today), item('b', today)]
  assert.equal(newCount(shown, [item('c', today), ...shown]), 1)
  assert.equal(newCount(shown, shown), 0)
  assert.equal(newCount(shown, [item('a', today)]), 0, 'something going away is not new')
})

test('asYou: on their own device, a person reads "You"', () => {
  assert.equal(asYou(item('a', today, 'chores', { title: 'Leo finished 4 chores' }), 'm4', 'Leo'), 'You finished 4 chores')
  assert.equal(asYou(item('a', today, 'chores', { title: 'Leo finished 4 chores' }), 'm3', 'Leo'), 'Leo finished 4 chores')
  assert.equal(asYou(item('a', today, 'birthday', { title: 'Happy birthday, Leo!' }), 'm4', 'Leo'), 'Happy birthday, Leo!')
  assert.equal(asYou(item('a', today, 'post', { title: 'Leo is the best' }), 'm4', 'Leo'), 'Leo is the best', "a post's words stay as written")
})

test('pictureAlt: names the picture for its full-size view, a drawing by its title', () => {
  assert.equal(pictureAlt(item('d', today, 'drawings', { title: 'Maya saved a drawing: “Our garden at night”' })), 'Maya saved a drawing: Our garden at night')
  assert.equal(pictureAlt(item('p', today, 'photos', { detail: '“Beach day”' })), 'Beach day')
  assert.equal(pictureAlt(item('x', today, 'post')), 'Family photo')
})
