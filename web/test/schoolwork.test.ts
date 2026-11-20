import { test } from 'node:test'
import assert from 'node:assert/strict'
import { choreCategory, schoolworkGroups } from '../src/schoolwork.ts'
import type { SchoolKind } from '../src/types.ts'

test('all kinds of schoolwork share the Schoolwork category; ordinary chores keep their category', () => {
  for (const schoolKind of ['homework', 'lesson', 'test', 'project'] as SchoolKind[]) {
    assert.equal(choreCategory({ schoolKind, category: null }), 'Schoolwork')
    assert.equal(choreCategory({ schoolKind, category: 'Other' }), 'Schoolwork')
  }
  assert.equal(choreCategory({ schoolKind: null, category: 'Kitchen' }), 'Kitchen')
  assert.equal(choreCategory({}), '')
})

test('schoolwork forms one section after ordinary chores without changing either order', () => {
  const chores = [
    { id: 'math', schoolKind: 'lesson' as const },
    { id: 'cat', schoolKind: null },
    { id: 'reading', schoolKind: 'homework' as const },
    { id: 'bedtime', schoolKind: null },
    { id: 'test', schoolKind: 'test' as const },
    { id: 'project', schoolKind: 'project' as const },
  ]
  const before = [...chores]
  assert.deepEqual(schoolworkGroups(chores).map(g => [g.schoolwork, g.chores.map(c => c.id)]), [
    [false, ['cat', 'bedtime']],
    [true, ['math', 'reading', 'test', 'project']],
  ])
  assert.deepEqual(chores, before, 'grouping must not mutate the source order')
  assert.equal(schoolworkGroups(chores)[1].chores[0], chores[0], 'retain completion and timer data on the original cards')
})

test('filtered and empty lists do not produce empty sections', () => {
  assert.deepEqual(schoolworkGroups([]), [])
  assert.deepEqual(schoolworkGroups([{ schoolKind: 'homework' }]).map(g => g.schoolwork), [true])
  assert.deepEqual(schoolworkGroups([{ schoolKind: null }]).map(g => g.schoolwork), [false])
})
