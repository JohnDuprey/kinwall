// Top of the Board on a parent's phone or computer: what's still missing after setup (getStarted.ts).
// Rows drop off as they're done and the card goes when none are left; "Not now" hides it on this
// device for 30 days. Never on wall screens or kids' devices, which can't act on it.
import { useEffect, useState } from 'react'
import { api } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDeviceAppearance } from './useTheme.ts'
import { GET_STARTED_KEY, getStartedItems, getStartedSnoozed, type GetStartedCounts, type GetStartedItem } from './getStarted.ts'

const ROWS: Record<GetStartedItem, { emoji: string; title: string; why: string; href: string }> = {
  calendar: { emoji: '📆', title: 'Connect a calendar', why: 'Google, Outlook, iCloud or a calendar link.', href: '#/settings?tab=calendars' },
  wall: { emoji: '🖼️', title: 'Put Kinwall on the wall', why: 'Open it on the wall tablet and pair it with a code.', href: '#/settings?tab=access&section=paired-devices' },
  family: { emoji: '👪', title: 'Add your family', why: "Everyone gets a color, so the wall shows who's doing what.", href: '#/settings?tab=family&section=members' },
  secondWayIn: { emoji: '🔑', title: 'Add a second way in', why: 'Recovery codes or another passkey, in case you lose this phone.', href: '#/settings?tab=access&section=recovery-codes' },
}

const snoozed = () => { try { return getStartedSnoozed(localStorage.getItem(GET_STARTED_KEY), Date.now()) } catch { return false } }
const count = <T,>(p: Promise<T[]>) => p.then(a => a.length).catch(() => null)

export default function GetStarted() {
  const { members, parentDevice, refreshTick } = useApp()
  const device = useDeviceAppearance()
  const [hidden, setHidden] = useState(snoozed)
  const [counts, setCounts] = useState<Omit<GetStartedCounts, 'members'> | null>(null)
  const active = parentDevice && !device.wallScreen && !hidden

  useEffect(() => {
    if (!active) return
    let gone = false
    Promise.all([
      count(api.getCalendars()),
      count(api.getKeys().then(keys => keys.filter(k => k.scope === 'display' && k.kind !== 'widgets'))),
      count(api.getPasskeys()),
      api.getRecoveryCodes().then(r => r.remaining).catch(() => null),
    ]).then(([calendars, displays, passkeys, recoveryCodes]) => { if (!gone) setCounts({ calendars, displays, passkeys, recoveryCodes }) })
    return () => { gone = true }
  }, [active, refreshTick])

  if (!active || !counts) return null
  const items = getStartedItems({ ...counts, members: members.length })
  if (!items.length) return null
  const notNow = () => {
    try { localStorage.setItem(GET_STARTED_KEY, String(Date.now())) } catch { /* storage blocked */ }
    setHidden(true)
  }
  return (
    <section className="get-started" aria-labelledby="get-started-title">
      <div className="get-started-head">
        <h2 id="get-started-title">Finish setting up Kinwall</h2>
        <span className="get-started-count">{items.length} left</span>
      </div>
      <p className="get-started-sub">A few things make the wall useful from day one.</p>
      <ul className="get-started-list">
        {items.map(id => {
          const r = ROWS[id]
          return (
            <li key={id}>
              <a className="get-started-item" href={r.href}>
                <span className="get-started-emoji" aria-hidden="true">{r.emoji}</span>
                <span className="get-started-text"><span className="get-started-title">{r.title}</span><span className="get-started-why">{r.why}</span></span>
                <span className="get-started-go" aria-hidden="true">›</span>
              </a>
            </li>
          )
        })}
      </ul>
      <div className="get-started-foot"><button className="link-btn" onClick={notNow}>Not now</button></div>
    </section>
  )
}
