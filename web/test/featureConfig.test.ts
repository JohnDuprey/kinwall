import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FEATURE_ROWS } from '../src/featureConfig.ts'

test('feature settings include every household feature', () => {
  assert.deepEqual(FEATURE_ROWS.map(feature => feature.key), [
    'chores', 'lists', 'contacts', 'paint', 'photos', 'notes', 'meals', 'messages',
    'trackersReading', 'trackersMemories', 'trackersHealth',
  ])
})
