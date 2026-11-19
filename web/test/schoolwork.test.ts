import { test } from 'node:test'
import assert from 'node:assert/strict'
import { choreCategory } from '../src/schoolwork.ts'
import type { SchoolKind } from '../src/types.ts'

test('all kinds of schoolwork share the Schoolwork category; ordinary chores keep their category', () => {
  for (const schoolKind of ['homework', 'lesson', 'test', 'project'] as SchoolKind[]) {
    assert.equal(choreCategory({ schoolKind, category: null }), 'Schoolwork')
    assert.equal(choreCategory({ schoolKind, category: 'Other' }), 'Schoolwork')
  }
  assert.equal(choreCategory({ schoolKind: null, category: 'Kitchen' }), 'Kitchen')
  assert.equal(choreCategory({}), '')
})
