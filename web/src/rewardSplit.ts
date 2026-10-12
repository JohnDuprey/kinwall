// Splitting a reward between several people (server: routes/rewards.ts, shares).
import type { RewardShare } from './types.ts'

/** Points each person chips in: as even as their balances allow (whoever has less gives what they
 * have, the rest share the remainder). Adds up to less than cost only when they can't cover it together. */
export function evenSplit(cost: number, people: { id: string; balance: number }[]): Record<string, number> {
  const out: Record<string, number> = {}
  let left = cost
  const byBalance = [...people].sort((a, b) => a.balance - b.balance)
  byBalance.forEach((p, i) => {
    const n = Math.min(Math.max(0, p.balance), Math.ceil(left / (byBalance.length - i)))
    out[p.id] = n
    left -= n
  })
  return out
}

/** "Leo 60 + Maya 40" for a split's shares. */
export const shareText = (shares: RewardShare[], nameOf: (id: string) => string) => shares.map(s => `${nameOf(s.memberId)} ${s.points}`).join(' + ')
