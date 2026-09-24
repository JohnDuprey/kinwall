import { useEffect, useState } from 'react'
import { useIsPhone } from './useIsPhone.ts'

const KEY = 'kinwall.nav'
const RAIL_QUERY = '(min-width: 900px) and (orientation: landscape)'
export const NAV_PREF_EVENT = 'kinwall:nav-pref'

export type NavPref = 'auto' | 'bottom' | 'left' | 'right'
export type NavMode = 'bottom' | 'left' | 'right'

function readPref(): NavPref {
  try {
    const v = localStorage.getItem(KEY)
    if (v === 'bottom' || v === 'left' || v === 'right' || v === 'auto') return v
  } catch { /* ignore */ }
  return 'auto'
}

/** Per-device nav position (not synced — deliberately a plain localStorage value, not a
 * setting). Changing it dispatches a same-tab event since 'storage' only fires in other tabs. */
export function setNavPref(pref: NavPref) {
  try { localStorage.setItem(KEY, pref) } catch { /* ignore */ }
  window.dispatchEvent(new Event(NAV_PREF_EVENT))
}

/** Resolves the stored preference to an actual layout: phones always get the bottom bar;
 * 'auto' picks the side rail on a landscape display >= 900px wide (the wall iPad), else bottom. */
export function useNavMode(): { mode: NavMode; pref: NavPref } {
  const isPhone = useIsPhone()
  const [pref, setPref] = useState<NavPref>(readPref)
  const [railOk, setRailOk] = useState(() => matchMedia(RAIL_QUERY).matches)

  useEffect(() => {
    const mql = matchMedia(RAIL_QUERY)
    const onChange = () => setRailOk(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const onPref = () => setPref(readPref())
    window.addEventListener(NAV_PREF_EVENT, onPref)
    window.addEventListener('storage', onPref)
    return () => { window.removeEventListener(NAV_PREF_EVENT, onPref); window.removeEventListener('storage', onPref) }
  }, [])

  if (isPhone) return { mode: 'bottom', pref }
  const mode = pref === 'auto' ? (railOk ? 'right' : 'bottom') : pref
  return { mode, pref }
}
