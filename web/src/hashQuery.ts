import { useCallback, useState } from 'react'
import { tellAppHere } from './native.ts'
// Links into the app are #/<path>?<query> (notifications, Siri, Spotlight, widgets). The helpers
// are pure (web/test/hashQuery.test.ts), all but the useHashParam hook.

/** The link's query: `#/meals?recipe=r1` → recipe=r1. */
export const hashQuery = (hash: string) => new URLSearchParams(hash.split('?')[1] ?? '')

/** The link without its query. Put back with history.replaceState once handled, so a reload doesn't run it again. */
export const hashPath = (hash: string) => hash.split('?')[0]

/** `hash` with `key` set to `value` (null takes it out), keeping the path and the rest of the query. */
export const withHashParam = (hash: string, key: string, value: string | null) => {
  const q = hashQuery(hash)
  if (value === null) q.delete(key); else q.set(key, value)
  const s = q.toString()
  return (hashPath(hash) || '#/home') + (s ? `?${s}` : '')
}

/** Lists' address: #/lists (the overview), #/lists/<id> (a list), #/lists/<id>/shop (shopping
 * mode). #/lists?list=<id> is the old link to a list; `redirect` is where it lives now. */
export function listRoute(hash: string): { id: string | null; shop: boolean; redirect: string | null } {
  const m = /^#\/lists\/([^/?]+)(\/shop)?/.exec(hash)
  if (m) return { id: decodeURIComponent(m[1]), shop: !!m[2], redirect: null }
  const old = hashPath(hash) === '#/lists' ? hashQuery(hash).get('list') : null
  return { id: old, shop: false, redirect: old ? `#/lists/${encodeURIComponent(old)}` : null }
}

/** An open full-screen mode (Get stuff done, cooking) kept in the link, so a reload or the app
 * restarting its web view opens it again: `#/lists?gsd=<id>`. replaceState: no hashchange, no history entry. */
export function useHashParam(key: string) {
  const [value, setValue] = useState(() => hashQuery(location.hash).get(key))
  const set = useCallback((next: string | null) => {
    history.replaceState(history.state, '', withHashParam(location.hash, key, next))
    tellAppHere() // replaceState fires no hashchange
    setValue(next)
  }, [key])
  return [value, set] as const
}
