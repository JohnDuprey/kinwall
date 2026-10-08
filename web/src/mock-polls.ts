// In-memory family polls for VITE_MOCK only (the server: routes/polls.ts). The demo family: one open
// poll about Friday's dinner (a restaurant and two recipes from mock-meals.ts) with Maya, Leo and Sam's
// votes, and last week's movie night, closed.
import { dateKey } from './date.ts'
import { suggestedWinner } from './polls.ts'
import type { Poll, PollInput } from './types.ts'

const day = (n: number) => dateKey(new Date(Date.now() + n * 86_400_000))
const friday = day((5 - new Date().getDay() + 7) % 7) // this Friday (today, on a Friday)
const opt = (id: string, label: string, votes: string[], recipeId: string | null = null, sort = 0, restaurantId: string | null = null) => ({ id, label, recipeId, restaurantId, sort, votes })

let polls: Poll[] = [
  {
    id: 'poll-friday', question: 'Where are we eating Friday?', date: friday, slot: 'dinner', status: 'open', winnerOptionId: null, mealId: null,
    createdBy: 'm1', createdAt: `${day(-1)}T18:00:00.000Z`, closedAt: null,
    options: [opt('pf-1', 'Corner Slice', ['m3', 'm4'], null, 0, 'demo-corner-slice'), opt('pf-2', 'Tuesday Tacos', ['m2'], 'demo-tacos', 1), opt('pf-3', 'Spaghetti Bolognese', [], 'demo-pasta', 2)],
  },
  {
    id: 'poll-movie', question: 'Which movie on Saturday?', date: null, slot: null, status: 'closed', winnerOptionId: 'pm-2', mealId: null,
    createdBy: 'm2', createdAt: `${day(-6)}T17:00:00.000Z`, closedAt: `${day(-5)}T19:00:00.000Z`,
    options: [opt('pm-1', 'Paddington', ['m1'], null, 0), opt('pm-2', 'Moana', ['m2', 'm3', 'm4'], null, 1)],
  },
]

const order = (list: Poll[]) => [...list].sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'open' ? -1 : 1))
const copy = (p: Poll): Poll => structuredClone(p)

export async function mockPollRequest(path: string, options: RequestInit): Promise<unknown> {
  const url = new URL(path, 'https://demo.invalid/')
  const [, , rawId, action] = url.pathname.slice(1).split('/')
  const id = rawId ? decodeURIComponent(rawId) : undefined
  const method = options.method ?? 'GET'
  const body = options.body ? JSON.parse(String(options.body)) : {}
  if (!id) {
    if (method === 'GET') { const status = url.searchParams.get('status'); return order(polls).filter(p => !status || p.status === status).map(copy) }
    const input = body as PollInput
    const poll: Poll = {
      id: crypto.randomUUID(), question: input.question, date: input.date ?? null, slot: input.date ? input.slot ?? null : null, status: 'open', winnerOptionId: null, mealId: null,
      createdBy: 'm1', createdAt: new Date().toISOString(), closedAt: null,
      options: input.options.map((o, sort) => opt(crypto.randomUUID(), o.label ?? 'Choice', [], o.recipeId ?? null, sort, o.restaurantId ?? null)), // the app sends each choice's name
    }
    polls.push(poll); return copy(poll)
  }
  const poll = polls.find(p => p.id === id)
  if (!poll) throw new Error('poll not found')
  if (method === 'DELETE') { polls = polls.filter(p => p.id !== id); return { ok: true } }
  if (action === 'vote') {
    if (poll.status !== 'open') throw new Error('Voting on this poll has ended.')
    for (const o of poll.options) o.votes = o.votes.filter(m => m !== body.memberId)
    if (body.optionId) poll.options.find(o => o.id === body.optionId)!.votes.push(body.memberId)
  } else if (action === 'close') {
    poll.status = 'closed'; poll.winnerOptionId = body.optionId ?? suggestedWinner(poll)?.id ?? null; poll.closedAt ??= new Date().toISOString()
  } else if (method === 'PATCH') {
    if (body.question) poll.question = body.question
    if (body.mealId !== undefined) poll.mealId = body.mealId
  }
  return copy(poll)
}
