import { useCallback, useState } from 'react'
// Links into the app are #/<path>?<query> (notifications, Siri, Spotlight, widgets). The helpers
// are pure (web/test/hashQuery.test.ts), all but the useHashParam hook.

/** The link's query: `#/meals?recipe=r1` → recipe=r1. */
export const hashQuery = (hash: string) => new URLSearchParams(hash.split('?')[1] ?? '')

/** The link without its query. Put back with history.replaceState once handled, so a reload doesn't run it again. */
export const hashPath = (hash: string) => hash.split('?')[0]

/** #/home is the Home screen's own name; underneath it's still #/calendar, which old links (pushes,
 * widgets, Home Assistant) use. Returns the #/calendar link to swap in, or null for any other link. */
export const homeAlias = (hash: string) => /^#\/home(?=$|\?)/.test(hash) ? '#/calendar' + hash.slice(6) : null

/** `hash` with `key` set to `value` (null takes it out), keeping the path and the rest of the query. */
export const withHashParam = (hash: string, key: string, value: string | null) => {
  const q = hashQuery(hash)
  if (value === null) q.delete(key); else q.set(key, value)
  const s = q.toString()
  return (hashPath(hash) || '#/calendar') + (s ? `?${s}` : '')
}

/** An open full-screen mode (Get stuff done, cooking) kept in the link, so a reload or the app
 * restarting its web view opens it again: `#/lists?gsd=<id>`. replaceState: no hashchange, no history entry. */
export function useHashParam(key: string) {
  const [value, setValue] = useState(() => hashQuery(location.hash).get(key))
  const set = useCallback((next: string | null) => {
    history.replaceState(null, '', withHashParam(location.hash, key, next))
    setValue(next)
  }, [key])
  return [value, set] as const
}
