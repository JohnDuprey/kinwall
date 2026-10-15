// The one help affordance, in the same place on every screen (WCAG 2.2 SC 3.2.6 Consistent Help):
// a "?" button at the top right that opens a small sheet - docs, where to report a problem, the
// version - rather than navigating a wall display away from the calendar.
import { useEffect, useState } from 'react'
import Sheet from './Sheet.tsx'
import { api } from './api.ts'
import { getKey } from './api.ts'
import { HelpIcon } from './icons.tsx'
import { helpPath } from './helpPage.ts'
import { t } from './i18n.ts'

export const DOCS_URL = 'https://docs.kinwall.family'
export const ISSUES_URL = 'https://github.com/JohnDuprey/kinwall/issues'
// The issue forms in .github/ISSUE_TEMPLATE; a bug report arrives with this version filled in.
const newIssue = (template: string, version?: string) =>
  `${ISSUES_URL}/new?template=${template}${version ? `&version=${encodeURIComponent(version)}` : ''}`

export function HelpButton({ className = '' }: { className?: string }) {
  const [open, setOpen] = useState(false)
  const [me, setMe] = useState<{ version?: string; hostPortalUrl?: string } | null>(null)
  // Version and hosting link come from /api/me; before sign-in (gate, wizard) there's no key, so skip.
  useEffect(() => { if (open && !me && getKey()) api.meStrict().then(setMe).catch(() => {}) }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const version = me?.version, hostPortalUrl = me?.hostPortalUrl
  const here = open ? helpPath(location.hash) : null
  return (
    <>
      <button className={`icon-btn help-btn ${className}`} onClick={() => setOpen(true)} aria-label={t('Help')} aria-haspopup="dialog">
        <HelpIcon width={22} height={22} />
      </button>
      {open && (
        <Sheet title={t('Help')} onClose={() => setOpen(false)} variant="dialog">
          <ul className="help-links">
            {here && <li><a className="help-link" href={`${DOCS_URL}/${here}`} target="_blank" rel="noopener"><strong>{t('Help with this page')}</strong><span>{t('How this screen works, in the docs.')}</span></a></li>}
            <li><a className="help-link" href={DOCS_URL} target="_blank" rel="noopener"><strong>{t('Docs & guides')}</strong><span>{t('Setting up, connecting calendars, chores, lists, the wall display.')}</span></a></li>
            <li><a className="help-link" href={`${DOCS_URL}/contributing/accessibility`} target="_blank" rel="noopener"><strong>{t('Accessibility')}</strong><span>{t("Keyboard, screen readers, low-stimulation mode, what's still missing.")}</span></a></li>
            <li><a className="help-link" href={newIssue('bug_report.yml', version)} target="_blank" rel="noopener"><strong>{t('Report a problem')}</strong><span>{t("Something isn't working. Opens a short form on GitHub.")}</span></a></li>
            <li><a className="help-link" href={newIssue('feature_request.yml')} target="_blank" rel="noopener"><strong>{t('Suggest a feature')}</strong><span>{t('An idea for your family. Opens a short form on GitHub.')}</span></a></li>
            {hostPortalUrl && <li><a className="help-link" href={hostPortalUrl} target="_blank" rel="noopener"><strong>{t('Your hosting')}</strong><span>{t("Manage or delete your family's instance.")}</span></a></li>}
          </ul>
          {version && <p className="field-hint">{t('Kinwall v{version}', { version })}</p>}
        </Sheet>
      )}
    </>
  )
}
