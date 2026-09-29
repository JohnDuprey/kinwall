// node --test test/ (npm test). Trackers → Health's person switcher: who it starts on, and whose entries show.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { forPerson, personIn, startPerson } from '../src/trackerPerson.ts'

const ids = ['m1', 'm2', 'm3']

test('starts from the header filter when it is set, even over this device’s last pick', () => {
  assert.equal(startPerson('m2', 'm3'), 'm2')
  assert.equal(startPerson(null, 'm3'), 'm3')
  assert.equal(startPerson(null, null), null)
  assert.equal(startPerson(null, ''), null, 'everyone, as stored')
})

test('a pick counts while that person is still in the family', () => {
  assert.equal(personIn('m3', ids), 'm3')
  assert.equal(personIn('gone', ids), null, 'a removed member falls back to everyone')
  assert.equal(personIn(null, ids), null)
})

test('one person’s entries plus the family’s; everyone shows all of them', () => {
  const e = (id: string, memberId: string | null, formerMember: string | null = null) => ({ id, memberId, formerMember })
  const all = [e('a', 'm1'), e('b', 'm2'), e('fam', null), e('old', null, 'Leo')]
  assert.deepEqual(forPerson(all, 'm1').map(x => x.id), ['a', 'fam'])
  assert.deepEqual(forPerson(all, null).map(x => x.id), ['a', 'b', 'fam', 'old'])
})
