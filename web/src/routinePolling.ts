/** Home checks every child once, then polls enabled routines only. A change or return to the
 * page checks everyone again, including children whose routine was switched off last time. */
export function routinePoller(ids: string[], load: (id: string) => Promise<{ enabled: boolean } | undefined>, visible: () => boolean) {
  const enabled = new Map<string, boolean>()
  const pending = new Set<string>()
  let stopped = false
  const check = async (force: boolean) => {
    if (stopped || !visible()) return
    await Promise.all(ids.filter(id => !pending.has(id) && (force || enabled.get(id) !== false)).map(async id => {
      pending.add(id)
      try {
        const state = await load(id)
        if (!stopped) {
          if (state) enabled.set(id, state.enabled)
          else enabled.delete(id) // retry an unavailable decision, even if it used to be disabled
        }
      } finally { pending.delete(id) }
    }))
  }
  return { refresh: () => check(true), poll: () => check(false), stop: () => { stopped = true } }
}
