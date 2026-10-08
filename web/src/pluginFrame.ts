// A plugin is one page. Its frame's first load is that page; any later load means the page
// navigated its frame somewhere else (a sandbox can't prevent that), so the bridge
// (web/src/Plugins.tsx) never answers or posts to that frame again. A page that leaves before its
// own load event isn't counted that way, so the app's CSP (frame-src 'self', server/src/app.ts)
// is what stops a frame reaching another site at all, and every message is checked here too.
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

/** Whether a message is from this plugin's own page: sent by its frame's window, from the opaque
 * origin ('null') every page in a sandboxed frame has (a page that got out of the sandbox, or any
 * other window, has a real one), while the frame is still live. */
export function fromPluginFrame(e: { source: unknown; origin: string }, frame: { contentWindow: unknown } | null): boolean {
  return !!frame && !!e.source && e.source === frame.contentWindow && e.origin === 'null' && frameLive(frame)
}
