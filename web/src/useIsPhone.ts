import { useEffect, useState } from 'react'

const QUERY = '(max-width: 600px)'

/** True on narrow (phone) screens. Backed by matchMedia so it updates live on rotation/resize —
 * mirrors the `@media (max-width: 600px)` breakpoint used throughout styles.css. */
export function useIsPhone() {
  const [isPhone, setIsPhone] = useState(() => matchMedia(QUERY).matches)
  useEffect(() => {
    const mql = matchMedia(QUERY)
    const onChange = () => setIsPhone(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])
  return isPhone
}
