import { useEffect, useState } from 'react'
import { useKeyboard } from './keyboard.ts'

/** Live matchMedia: updates on rotation/resize, but holds still while the on-screen keyboard is up.
 * Android shrinks the page for the keyboard, and a tablet on its side would otherwise turn into a
 * "phone on its side" mid-word (the rail jumping sides, the calendar's hours shrinking). */
export function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => matchMedia(query).matches)
  const typing = useKeyboard().up
  useEffect(() => {
    if (typing) return
    const mql = matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query, typing])
  return matches
}

/** True on narrow (phone) screens — mirrors the `@media (max-width: 600px)` breakpoint used
 * throughout styles.css. */
export const useIsPhone = () => useMediaQuery('(max-width: 600px)')

/** The phone's one-row header (family button, buttons, no clock): phones, and tablets standing up
 * (a 10" tablet at its Auto screen scale, an iPad in portrait), which are too narrow for the wall
 * header's clock, date, faces and buttons side by side. Landscape tablets and walls keep that one. */
export const PHONE_HEADER = '(max-width: 600px), (orientation: portrait) and (max-width: 900px)'
export const usePhoneHeader = () => useMediaQuery(PHONE_HEADER)

/** A phone on its side: too short for the bottom bar and the tall header. Mirrors the
 * `@media (max-height: 500px) and (orientation: landscape)` block in styles.css. */
export const SHORT_LANDSCAPE = '(max-height: 500px) and (orientation: landscape)'

/** A tablet on its side that's short of a wall iPad (a 10" tablet at its Auto screen scale): compact
 * sizes whatever the density. Mirrors the 501-760px landscape block at the top of styles.css. */
export const SHORT_TABLET = '(orientation: landscape) and (min-width: 601px) and (min-height: 501px) and (max-height: 760px)'
