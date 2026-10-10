import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FEATURE_ROWS } from '../src/featureConfig.ts'

test('feature settings include every household feature', () => {
  assert.deepEqual(FEATURE_ROWS.map(feature => feature.key), [
    'chores', 'lists', 'notes', 'messages', 'polls', 'checkIns',
    'meals', 'outings', 'trackersReading', 'trackersMemories', 'trackersHealth', 'paint', 'photos', 'contacts', 'newscast',
  ])
  assert.deepEqual([...new Set(FEATURE_ROWS.map(feature => feature.section))], ['Everyday', 'Nooks'], 'two headings, each once')
})
