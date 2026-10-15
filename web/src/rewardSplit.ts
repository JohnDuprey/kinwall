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

/** A split's −/+ on one person: up to `delta` points onto them (or off them), taken from (or given to)
 * the others so it still adds up to `cost`. Nobody goes below 1 or past their balance. While the
 * total is short (or over), + (or −) just adds (or takes) instead. */
export function movePoints(points: Record<string, number>, people: { id: string; balance: number }[], id: string, delta: number, cost: number): Record<string, number> {
  const out = { ...points }
  const me = people.find(p => p.id === id)
  if (!me || !delta) return out
  const others = people.filter(p => p.id !== id)
  const sum = () => people.reduce((n, p) => n + (out[p.id] ?? 0), 0)
  let left = Math.abs(delta)
  while (left > 0) {
    if (delta > 0) {
      if ((out[id] ?? 0) >= me.balance) break
      if (sum() < cost) { out[id] = (out[id] ?? 0) + 1; left--; continue }
      // From whoever's giving the most (and has more than 1).
      const from = others.filter(p => (out[p.id] ?? 0) > 1).sort((a, b) => out[b.id] - out[a.id])[0]
      if (!from) break
      out[from.id]--; out[id] = (out[id] ?? 0) + 1; left--
    } else {
      if ((out[id] ?? 0) <= 1) break
      out[id]--; left--
      if (sum() >= cost) continue // was over: just less
      // To whoever has the most room left, else it's short by one.
      const to = others.filter(p => (out[p.id] ?? 0) < p.balance).sort((a, b) => (b.balance - out[b.id]) - (a.balance - out[a.id]))[0]
      if (to) out[to.id]++
    }
  }
  return out
}
