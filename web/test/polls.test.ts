import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leaders, planDraft, suggestedWinner, votedLabel, voteOf } from '../src/polls.ts'

const opt = (id: string, votes: string[], recipeId: string | null = null) => ({ id, label: id, recipeId, sort: 0, votes })

test('polls: leaders, ties, and the winner a parent starts on', () => {
  assert.deepEqual(leaders({ options: [opt('a', []), opt('b', [])] }), [])
  assert.equal(suggestedWinner({ options: [opt('a', []), opt('b', [])] })?.id, 'a', 'no votes: the first choice')
  assert.deepEqual(leaders({ options: [opt('a', ['m1']), opt('b', ['m2', 'm3'])] }).map(o => o.id), ['b'])
  const tie = { options: [opt('a', ['m1']), opt('b', ['m2'])] }
  assert.deepEqual(leaders(tie).map(o => o.id), ['a', 'b'])
  assert.equal(suggestedWinner(tie)?.id, 'a')
})

test('polls: who voted, in words', () => {
  const poll = { options: [opt('a', ['m1']), opt('b', ['m2', 'm3'])] }
  assert.equal(votedLabel({ options: [opt('a', [])] }, 4), 'No votes yet')
  assert.equal(votedLabel(poll, 4), '3 of 4 voted')
  assert.equal(votedLabel(poll, 3), 'Everyone voted')
  assert.equal(voteOf(poll, 'm3'), 'b')
  assert.equal(voteOf(poll, 'm4'), null)
  assert.equal(voteOf(poll, null), null)
})

test('polls: Plan it uses the poll\'s meal and the winner\'s recipe, else its name', () => {
  const recipes = [{ id: 'r1', name: 'Tacos' }]
  assert.deepEqual(planDraft({ date: '2026-10-09', slot: 'lunch' }, { label: 'Tacos', recipeId: 'r1' }, recipes, '2026-10-07'), { date: '2026-10-09', slot: 'lunch', recipe: recipes[0] })
  assert.deepEqual(planDraft({ date: null, slot: null }, { label: 'Pizza night', recipeId: null }, recipes, '2026-10-07'), { date: '2026-10-07', slot: 'dinner', title: 'Pizza night' })
  assert.deepEqual(planDraft({ date: null, slot: null }, { label: 'Old recipe', recipeId: 'gone' }, recipes, '2026-10-07'), { date: '2026-10-07', slot: 'dinner', title: 'Old recipe' })
})
