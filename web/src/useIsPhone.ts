import { useEffect, useState } from 'react'

/** Live matchMedia: updates on rotation/resize. */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mql = matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** True on narrow (phone) screens — mirrors the `@media (max-width: 600px)` breakpoint used
 * throughout styles.css. */
export const useIsPhone = () => useMediaQuery('(max-width: 600px)')

/** A phone on its side: too short for the bottom bar and the tall header. Mirrors the
 * `@media (max-height: 500px) and (orientation: landscape)` block in styles.css. */
export const SHORT_LANDSCAPE = '(max-height: 500px) and (orientation: landscape)'

/** A tablet on its side that's short of a wall iPad (a 10" tablet at its Auto screen scale): compact
 * sizes whatever the density. Mirrors the 501-760px landscape block at the top of styles.css. */
export const SHORT_TABLET = '(orientation: landscape) and (min-width: 601px) and (min-height: 501px) and (max-height: 760px)'
