// Family polls (Polls.tsx): the counting and wording, pure so web/test/polls.test.ts covers it.
import type { Poll, PollOption } from './types.ts'
import { SLOT_LABEL, mealDayLabel } from './meal-date.ts'

/** "Friday dinner", "Friday", or nothing. */
export const pollWhen = (p: Pick<Poll, 'date' | 'slot'>) => p.date ? `${mealDayLabel(p.date, { weekday: 'long' })}${p.slot ? ` ${SLOT_LABEL[p.slot].toLowerCase()}` : ''}` : ''

/** The choices with the most votes (several on a tie, none before anyone votes). */
export function leaders(poll: Pick<Poll, 'options'>): PollOption[] {
  const top = Math.max(0, ...poll.options.map(o => o.votes.length))
  return top ? poll.options.filter(o => o.votes.length === top) : []
}

/** The choice a parent closing the poll starts on: the leader, the first listed on a tie. */
export const suggestedWinner = (poll: Pick<Poll, 'options'>): PollOption | undefined => leaders(poll)[0] ?? poll.options[0]

export const votedCount = (poll: Pick<Poll, 'options'>) => poll.options.reduce((n, o) => n + o.votes.length, 0)

/** "3 of 4 voted" (members: the family's size). */
export const votedLabel = (poll: Pick<Poll, 'options'>, members: number) => {
  const n = votedCount(poll)
  return n === 0 ? 'No votes yet' : n >= members ? 'Everyone voted' : `${n} of ${members} voted`
}

/** The choice this member picked, if any. */
export const voteOf = (poll: Pick<Poll, 'options'>, memberId: string | null | undefined) =>
  memberId ? poll.options.find(o => o.votes.includes(memberId))?.id ?? null : null

/** The new meal "Plan it" opens: the poll's date and slot (else today's dinner), the winner's recipe
 * when it's one from the book that's still there, else the winner as the meal's name. */
export function planDraft<R extends { id: string }>(poll: Pick<Poll, 'date' | 'slot'>, winner: Pick<PollOption, 'label' | 'recipeId'>, recipes: R[], today: string) {
  const recipe = recipes.find(r => r.id === winner.recipeId)
  return { date: poll.date ?? today, slot: poll.slot ?? 'dinner' as const, ...(recipe ? { recipe } : { title: winner.label }) }
}
