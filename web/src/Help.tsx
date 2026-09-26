// The one help affordance, in the same place on every screen (WCAG 2.2 SC 3.2.6 Consistent Help):
// a "?" button at the top right that opens a small sheet - docs, where to report a problem, the
// version - rather than navigating a wall display away from the calendar.
import { useEffect, useState } from 'react'
import Sheet from './Sheet.tsx'
import { api } from './api.ts'
import { getKey } from './api.ts'
import { HelpIcon } from './icons.tsx'

export const DOCS_URL = 'https://docs.kinwall.family'
export const ISSUES_URL = 'https://github.com/JohnDuprey/kinwall/issues'

export function HelpButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [me, setMe] = useState<{ version?: string; hostPortalUrl?: string } | null>(null)
  // Version and hosting link come from /api/me; before sign-in (gate, wizard) there's no key, so skip.
  useEffect(() => { if (open && !me && getKey()) api.meStrict().then(setMe).catch(() => {}) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const version = me?.version, hostPortalUrl = me?.hostPortalUrl
  return (
    <>
      <button className={`icon-btn help-btn ${className}`} onClick={() => setOpen(true)} aria-label="Help" aria-haspopup="dialog">
        <HelpIcon width={22} height={22} />
      </button>
      {open && (
        <Sheet title="Help" onClose={() => setOpen(false)} variant="dialog">
          <ul className="help-links">
            <li><a className="help-link" href={DOCS_URL} target="_blank" rel="noopener"><strong>Docs &amp; guides</strong><span>Setting up, connecting calendars, chores, lists, the wall display.</span></a></li>
            <li><a className="help-link" href={`${DOCS_URL}/contributing/accessibility`} target="_blank" rel="noopener"><strong>Accessibility</strong><span>Keyboard, screen readers, low-stimulation mode, what's still missing.</span></a></li>
            <li><a className="help-link" href={ISSUES_URL} target="_blank" rel="noopener"><strong>Report a problem or ask a question</strong><span>Opens the project's issue tracker.</span></a></li>
            {hostPortalUrl && <li><a className="help-link" href={hostPortalUrl} target="_blank" rel="noopener"><strong>Your hosting</strong><span>Manage or delete your family's instance.</span></a></li>}
          </ul>
          {version && <p className="field-hint">Kinwall v{version}</p>}
        </Sheet>
      )}
    </>
  )
}
