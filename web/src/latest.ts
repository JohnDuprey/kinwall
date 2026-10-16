/** Keeps only the newest of overlapping loads of the same thing: an older request that answers after
 * a newer one is dropped (its promise never settles), so a slow answer from before a change can't
 * overwrite the one from after it (points after a chore: App.tsx loadCore, the Chores leaderboard). */
export function latestOnly() {
  let n = 0
  return <T,>(p: Promise<T>): Promise<T> => {
    const mine = ++n
    const never = new Promise<T>(() => {})
    return p.then(v => (mine === n ? v : never), e => (mine === n ? Promise.reject(e) : never))
  }
}
