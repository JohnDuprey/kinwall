// A plugin is one page. Its frame's first load is that page; any later load means the page
// navigated its frame somewhere else (a sandbox can't prevent that), so the bridge
// (web/src/Plugins.tsx) never answers or posts to that frame again.
const loads = new WeakMap<object, number>()

/** Call from the frame's load event. True once it has loaded a second page: it left its package. */
export function frameLoaded(frame: object): boolean {
  const n = (loads.get(frame) ?? 0) + 1
  loads.set(frame, n)
  return n > 1
}

/** Whether the bridge may still talk to this frame: only until it loads a second page. */
export function frameLive(frame: object): boolean {
  return (loads.get(frame) ?? 0) <= 1
}
