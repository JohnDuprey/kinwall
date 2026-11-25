import { useEffect, useState } from 'react'
import { Choose } from './PickField.tsx'
import { api, MOCK } from './api.ts'
import { useApp } from './AppContext.tsx'
import { t } from './i18n.ts'
import type { EventInstance } from './types.ts'

/** A personal choice, including on imported read-only calendars. */
export function EventFollow({ event }: { event: EventInstance }) {
  const { meMemberId, refreshTick } = useApp()
  const [choice, setChoice] = useState({
    enabled: false,
    minutes: 15,
    scope: 'occurrence' as 'occurrence' | 'series',
  })
  const [scope, setScope] = useState<'occurrence' | 'series'>('occurrence')
  const [busy, setBusy] = useState(false),
    [ready, setReady] = useState(false),
    [error, setError] = useState('')
  useEffect(() => {
    let active = true
    setReady(false)
    api
      .getEventFollow(event.id, event.occurrenceStart)
      .then((c) => {
        if (active) {
          setChoice(c)
          setReady(true)
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [event.id, event.occurrenceStart, refreshTick])
  if ((!meMemberId && !MOCK) || event.allDay || event.hidden || Date.parse(event.end) <= Date.now())
    return null
  const save = async (enabled: boolean, showNow = false, minutes = choice.minutes) => {
    setBusy(true)
    setError('')
    try {
      const c = await api.setEventFollow(event.id, {
        enabled,
        minutes,
        scope: showNow ? 'occurrence' : scope,
        occurrenceStart: event.occurrenceStart,
        showNow,
      })
      setChoice(c)
      window.dispatchEvent(new Event('kinwalleventfollow'))
    } catch (e) {
      setError(e instanceof Error ? e.message : t('Could not save this choice.'))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="notes-thread" aria-label={t('Follow this event')}>
      <h3 className="notes-title">{t('Follow this event')}</h3>
      <p className="settings-row-sub">
        {t(
          'Show a countdown on your own phones before and during this event. The event title and location may be visible on the Lock Screen.',
        )}
      </p>
      {(event.rrule || event.seriesId) && (
        <label className="field">
          {t('Apply to')}
          <Choose hideLabel label={t('Apply to')} value={scope} onChange={next => setScope(next as 'occurrence' | 'series')}
            options={[
              { value: 'occurrence', label: t('Just this event') },
              { value: 'series', label: t('Every occurrence') },
            ]} />
        </label>
      )}
      <label className="field">
        {t('Show countdown')}
        <Choose hideLabel label={t('Show countdown')} value={choice.minutes} disabled={busy || !ready} onChange={next => {
            const minutes = next
            setChoice({ ...choice, minutes })
            if (choice.enabled) void save(true, false, minutes)
          }}
          options={[
            { value: 0, label: t('At the start') },
            { value: 5, label: t('5 minutes before') },
            { value: 15, label: t('15 minutes before') },
            { value: 30, label: t('30 minutes before') },
            { value: 60, label: t('60 minutes before') },
          ]} />
      </label>
      <p className="settings-row-sub">
        {t('When travel or prep time is set, the countdown begins before that time.')}
      </p>
      <div className="chip-row">
        <button
          className="btn btn-secondary"
          disabled={busy || !ready}
          onClick={() => void save(!choice.enabled)}
          aria-pressed={choice.enabled}
        >
          {choice.enabled ? t('Stop following') : t('Follow this event')}
        </button>
        {scope === 'occurrence' && Date.parse(event.start) <= Date.now() + 3600000 && (
          <button
            className="btn btn-secondary"
            disabled={busy || !ready}
            onClick={() => void save(true, true)}
          >
            {t('Show now')}
          </button>
        )}
      </div>
      {choice.enabled && (
        <p role="status" className="settings-row-sub">
          {choice.scope === 'series'
            ? t('Following every occurrence on your phones.')
            : t('Following this occurrence on your phones.')}
        </p>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
