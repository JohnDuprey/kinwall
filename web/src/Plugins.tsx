// Activity plugins (server/src/routes/plugins.ts): the player that shows one in a sandboxed frame
// and answers its messages, and the admin sheet to install, update, turn off and remove them.
//
// The frame is `sandbox="allow-scripts"` (an opaque origin) and its files carry a CSP with no
// network, so a plugin can't read Kinwall's key, storage or pages, and can't fetch or load anything
// from elsewhere. The bridge below is the only way in: it answers messages from that one frame, for
// the person picked to play. What a sandbox can't stop is a page navigating its own frame to another
// site, and taking what it was told (who's playing, its saved progress) along in the address. So the
// bridge stops for good once the frame loads a second page (pluginFrame.ts), the app's CSP keeps
// the frame from loading any other site (frame-src 'self'), and only reviewed
// plugins can be installed on hosted Kinwall (PLUGINS_CATALOG_ONLY).
//
// Actions: other apps (the REST API, MCP, Home Assistant) can queue requests a plugin declares, like
// "add this spelling list" (POST /api/plugins/{id}/actions/{name}). The bridge hands the player's
// waiting ones to the plugin (Kinwall.actions()), deletes one when the plugin says it's done with it
// (only ones it was given), and nudges it ('actions') when something changed while it's open.
import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import { announce, reducedMotion } from './a11y.tsx'
import { useDialog } from './dialog.tsx'
import { Confetti } from './Chores.tsx'
import { frameLive, frameLoaded, fromPluginFrame } from './pluginFrame.ts'
import { canSpeak, speak, stopSpeaking } from './pluginSpeech.ts'
import { playClock } from './playtime.ts'
import { ActivityRing } from './ActivityRing.tsx'
import { useKeyboard } from './keyboard.ts'
import type { ActivityChoreProgress, Member, Plugin, PluginCatalogEntry } from './types.ts'
import { Face } from './Face'

type Msg = { kinwall: 1; id?: number; type: string; key?: string; value?: unknown; shared?: boolean; text?: unknown; rate?: unknown; lang?: unknown; item?: unknown }

function themeForPlugin() {
  // Resolve each token to a real color: some are expressions (color-mix, var()) a plugin can't use.
  const probe = document.createElement('span')
  document.body.append(probe)
  const color = (name: string) => { probe.style.color = `var(${name})`; return getComputedStyle(probe).color }
  const theme = {
    bg: color('--bg'), card: color('--card'), text: color('--text'), dim: color('--text-dim'),
    accent: color('--accent-strong'), accentInk: color('--accent-ink'), // the pair Kinwall's own buttons use
    border: color('--border'),
    font: getComputedStyle(document.body).fontFamily,
    dark: document.documentElement.getAttribute('data-theme') === 'dark',
  }
  probe.remove()
  return theme
}

// Activity chores: Kinwall times play, not the plugin, in 15-second steps that count only with an
// interaction in them (playtime.ts); the count goes to the server every HEARTBEAT_MS, when the
// chore's time is reached, and when the page hides or the player closes.
const HEARTBEAT_MS = 30_000
const MAX_HEARTBEAT_SECONDS = 45

/** #/activities/plugin/<id>[?member=<id>]: asks who's playing (unless the link names them or the family is filtered to one person), then runs it. */
export function PluginPlayer({ id }: { id: string }) {
  const { members: everyone, selectedMemberId, settings, toast, reloadCore, parentDevice, focusLocked, meMemberId, refreshTick } = useApp()
  // A kid's own device plays only as the kid (the server refuses saving or timing anyone else).
  const members = !parentDevice && focusLocked && meMemberId ? everyone.filter(m => m.id === meMemberId) : everyone
  const [plugin, setPlugin] = useState<Plugin | null | undefined>(undefined)
  // undefined = still asking; null = nobody in particular. Derived, not initial state: the family
  // may still be loading on a fresh page load. A chore's link (?member=) or a filter (or pin) to
  // one person: that's who plays, until Switch.
  const [picked, setPlayer] = useState<Member | null | undefined>(undefined)
  const [presetId, setPresetId] = useState(() => new URLSearchParams(location.hash.split('?')[1] || '').get('member'))
  const preset = members.find(m => m.id === presetId) ?? (selectedMemberId ? members.find(m => m.id === selectedMemberId) : undefined)
  const player = picked !== undefined ? picked : preset ?? (members.length ? undefined : null)
  const frame = useRef<HTMLIFrameElement>(null)
  const keyboard = useKeyboard().covered // px an iPad's on-screen keyboard covers (keyboard.ts): the frame ends above it
  const clock = useRef<ReturnType<typeof playClock> | null>(null) // play time while someone named plays (playtime.ts)
  const [chores, setChores] = useState<ActivityChoreProgress[]>([])
  const [unsent, setUnsent] = useState(0) // seconds counted but not yet in `chores`
  const [stepShown, setStepShown] = useState(0) // the current step's seconds, once it has an interaction: the chip moves every second
  const toGo = useRef(Infinity) // seconds left on the chip's chore, to send the moment it's reached
  const [burst, setBurst] = useState(0) // a completed chore's confetti (keyed, so each one replays)
  // A plugin page that navigates its frame somewhere else has left its package: stop it. Only
  // reopening it from Activities starts it again.
  const [left, setLeft] = useState(false)
  const dialog = useDialog()
  const zeroed = useRef(false) // a parent reset today's time: drop seconds counted but not yet sent
  const leaveRef = useRef(() => {}) // leave without asking (the latest render's)
  const askLeaveRef = useRef(() => {}) // "Leave …?" first (the latest render's, with the chip's time)

  useEffect(() => {
    api.getPlugins().then(list => setPlugin(list.find(p => p.id === id && p.enabled) ?? null)).catch(() => setPlugin(null))
  }, [id])

  useEffect(() => {
    if (!plugin || player === undefined) return
    const member = player?.id ?? ''
    const saves: number[] = [] // times of recent saves, for the rate limit below
    const given = new Set<string>() // action ids handed to this frame: the only ones it may mark done
    // '*': the frame's origin is opaque, so no target origin matches it. Checked at send time (an
    // answer can arrive after the page left), never to a frame that has loaded a second page.
    const send = (data: unknown) => {
      const f = frame.current
      if (f && frameLive(f)) f.contentWindow?.postMessage(data, '*')
    }
    const reply = (msg: Msg, ok: boolean, value?: unknown, error?: string) => send({ kinwall: 1, re: msg.id, ok, value, error })
    const onMessage = async (e: MessageEvent) => {
      // Only this plugin's frame, from its sandbox's opaque origin, until it loads a second page.
      if (!fromPluginFrame(e, frame.current)) return
      const msg = e.data as Msg
      if (!msg || msg.kinwall !== 1) return
      // Playing: a real tap or key inside the activity (kinwall.js), an answer saved or a word
      // spoken. Starting up, loading and actions aren't.
      if (msg.type === 'active' || msg.type === 'save' || msg.type === 'speak') clock.current?.interact(Date.now())
      if (msg.type === 'active') return
      if (msg.type === 'ready') {
        send({
          kinwall: 1, type: 'context',
          context: {
            member: player ? { id: player.id, name: player.name, avatar: player.avatar, color: player.color } : null,
            theme: themeForPlugin(), textScale: settings.textScale, reducedMotion: reducedMotion(), locale: navigator.language,
            // A parent's device (full access), whoever is playing: lets a plugin offer grown-up
            // settings, like a kid's spelling list. Wall screens and kids' devices say false.
            parent: parentDevice,
            // Kinwall.speak works: for a WebView with no speechSynthesis of its own (Android's).
            canSpeak: canSpeak(),
          },
        })
      } else if (msg.type === 'load') {
        api.getPluginData(plugin.id, msg.shared ? '' : member).then(v => reply(msg, true, v), err => reply(msg, false, undefined, String(err)))
      } else if (msg.type === 'save' && typeof msg.key === 'string') {
        // The bridge is a plugin's only way to the server, so this cap holds: 30 saves in 10 seconds.
        const now = Date.now()
        while (saves.length && now - saves[0] > 10_000) saves.shift()
        if (saves.length >= 30) return reply(msg, false, undefined, 'Saving too often; try again in a moment')
        saves.push(now)
        api.savePluginData(plugin.id, msg.shared ? '' : member, msg.key, msg.value).then(() => reply(msg, true), err => reply(msg, false, undefined, err instanceof ApiError ? err.message : String(err)))
      } else if (msg.type === 'actions') {
        api.getPluginActions(plugin.id, msg.shared ? '' : member).then(list => {
          list.forEach(a => given.add(a.id))
          reply(msg, true, list.map(({ id, action, input, createdAt }) => ({ id, action, input, createdAt, shared: !!msg.shared })))
        }, err => reply(msg, false, undefined, String(err)))
      } else if (msg.type === 'done' && typeof msg.item === 'string') {
        if (!given.has(msg.item)) return reply(msg, false, undefined, 'Not an action this activity was given')
        api.donePluginAction(plugin.id, msg.item).then(() => { given.delete(msg.item as string); reply(msg, true) }, err => reply(msg, false, undefined, err instanceof ApiError ? err.message : String(err)))
      } else if (msg.type === 'speak' && typeof msg.text === 'string') {
        // Answered once it's said (or stopped), so a plugin can wait for the word before praise.
        speak(msg.text, typeof msg.rate === 'number' ? msg.rate : 1, typeof msg.lang === 'string' ? msg.lang : 'en-US').then(() => reply(msg, true))
      } else if (msg.type === 'stopSpeaking') {
        stopSpeaking()
      } else if (msg.type === 'close') {
        leaveRef.current() // the activity chose to end: no "Leave?"
      }
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage); stopSpeaking() }
  }, [plugin, player, settings.textScale, parentDevice])

  // Something changed on the server (a queued action among others): tell the open plugin, which can
  // look again with Kinwall.actions(). Not on the first render: the plugin asks on its own at start.
  const firstTick = useRef(refreshTick)
  useEffect(() => {
    const f = frame.current
    if (refreshTick !== firstTick.current && f && frameLive(f)) f.contentWindow?.postMessage({ kinwall: 1, type: 'actions' }, '*')
  }, [refreshTick])

  // Playtime for activity chores: only for a named person, in steps with play in them (playtime.ts).
  const playerId = player?.id
  useEffect(() => {
    if (!plugin || !playerId) return
    const c = playClock(Date.now())
    clock.current = c
    let counted = 0 // seconds counted, not yet sent
    let closed = false
    const take = () => { if (zeroed.current) { counted = 0; c.settle(); zeroed.current = false } }
    const count = (n: number) => { if (n) { counted += n; setUnsent(u => u + n) } }
    const flush = () => {
      take()
      count(c.settle()) // the step so far, if it had play in it
      setStepShown(0)
      const seconds = Math.min(counted, MAX_HEARTBEAT_SECONDS)
      counted = 0
      const sent = () => setUnsent(u => Math.max(0, u - seconds))
      api.sendPlaytime(plugin.id, playerId, seconds).then(list => {
        if (closed) return
        setChores(list); sent()
        const done = list.filter(c => c.justCompleted)
        if (!done.length) return
        const msg = `🎉 ${done.map(c => c.title).join(' and ')} done!`
        toast(msg); announce(msg); setBurst(b => b + 1); reloadCore()
      }).catch(sent) // the next heartbeat carries on; a lost one only costs those seconds
    }
    const anything = () => counted > 0 || c.pending() > 0
    flush() // seconds 0: just today's progress, for the chip
    const tick = setInterval(() => {
      take()
      count(c.tick(Date.now(), document.visibilityState === 'visible'))
      const step = c.pending()
      setStepShown(step)
      if (toGo.current > 0 && counted + step >= toGo.current) flush() // done now, not at the next heartbeat
    }, 1000)
    const beat = setInterval(() => { if (anything()) flush() }, HEARTBEAT_MS)
    const onVisibility = () => { if (document.visibilityState === 'hidden' && anything()) flush() }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      if (anything()) flush()
      closed = true
      clock.current = null
      setChores([]); setUnsent(0); setStepShown(0)
      clearInterval(tick); clearInterval(beat)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [plugin, playerId]) // eslint-disable-line react-hooks/exhaustive-deps
  // The chip shows the first chore still to do, else the last one done.
  const chip = chores.find(c => !c.completed) ?? chores[chores.length - 1]
  const chipDone = chip ? Math.min(chip.needSeconds, chip.doneSeconds + (chip.completed ? 0 : unsent + stepShown)) : 0
  const chipToGo = chip && !chip.completed ? chip.needSeconds - chip.doneSeconds : Infinity
  useEffect(() => { toGo.current = chipToGo }, [chipToGo])
  // Parent devices: tapping the chip resets the player's time for today (they opened it as a kid to
  // check something). A chore the play already completed stays done; unticking it is separate.
  const resetChip = async () => {
    if (!plugin || !player || !chip) return
    if (!await dialog.confirm({
      title: `Reset ${player.name}'s ${plugin.name} time for today?`,
      body: chip.completed ? `"${chip.title}" stays done. Untick it on Chores if it shouldn't count.` : `${Math.floor(chipDone / 60)} of ${chip.needSeconds / 60} min goes back to 0. Time counts again while ${plugin.name} is open.`,
      confirmLabel: 'Reset time',
    })) return
    try {
      zeroed.current = true
      setChores(await api.resetPlaytime(plugin.id, player.id)); setUnsent(0); setStepShown(0)
      toast(`Time reset: ${chip.title}`); announce(`Time reset: ${chip.title}`)
    } catch (e) { toast(e instanceof ApiError ? e.message : 'Could not reset the time', true) }
  }

  // Focus mode: while an activity is open, Kinwall's header, tabs, rail and now/next are hidden
  // (styles.css, data-activity-open), pinch zoom is off, and leaving asks first. Back (browser,
  // Android's hardware button: the app goes back in web history) pops a history entry pushed on
  // open, which is put back while asking. Kinwall.close() and Leave go through leave().
  const playing = !!plugin && player !== undefined && !left
  const asking = useRef(false)
  const leaving = useRef(false)
  useEffect(() => {
    if (!playing) return
    const root = document.documentElement
    const hash = location.hash
    root.setAttribute('data-activity-open', '')
    const viewport = document.querySelector<HTMLMetaElement>('meta[name=viewport]')
    const zoomable = viewport?.content
    if (viewport) viewport.content = `${zoomable}, maximum-scale=1, user-scalable=no`
    const noPinch = (e: Event) => e.preventDefault() // iOS Safari ignores user-scalable=no
    document.addEventListener('gesturestart', noPinch)
    const mark = () => history.pushState({ ...history.state, kinwallActivity: id }, '', location.href)
    if (history.state?.kinwallActivity !== id) mark() // not again after a reload or a re-render
    const onPop = () => {
      if (leaving.current) { location.replace('#/activities'); return }
      if (location.hash !== hash || history.state?.kinwallActivity === id) return // gone elsewhere, or forward
      mark() // still here while asking
      askLeaveRef.current()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('.sheet')) askLeaveRef.current()
    }
    addEventListener('popstate', onPop)
    addEventListener('keydown', onKey)
    leaving.current = false
    return () => {
      root.removeAttribute('data-activity-open')
      if (viewport && zoomable !== undefined) viewport.content = zoomable
      document.removeEventListener('gesturestart', noPinch)
      removeEventListener('popstate', onPop)
      removeEventListener('keydown', onKey)
    }
  }, [playing, id])
  const leave = () => {
    leaving.current = true
    if (history.state?.kinwallActivity === id) history.back() // drop the entry pushed on open; onPop goes on to Activities
    else location.replace('#/activities')
  }
  const askLeave = async () => {
    if (asking.current || !plugin) return
    asking.current = true
    const n = chip && !chip.completed ? chip.needSeconds / 60 : 0
    const ok = await dialog.confirm({
      title: `Leave ${plugin.name}?`,
      body: n ? `Your ${n} minute${n === 1 ? '' : 's'} of ${chip!.title} will stop counting.` : undefined,
      confirmLabel: 'Leave', cancelLabel: 'Stay',
    })
    asking.current = false
    if (ok) leave()
  }
  useEffect(() => { leaveRef.current = leave; askLeaveRef.current = () => void askLeave() })

  if (plugin === undefined) return null
  if (left) return <div className="state-card">{plugin?.name ?? 'This activity'} tried to leave Kinwall, so it was stopped. <a href="#/activities">Back to Activities</a></div>
  if (plugin === null) return <div className="state-card">This activity isn't installed or is turned off. <a href="#/activities">Back to Activities</a></div>
  if (player === undefined) {
    return (
      <Sheet title="Who's playing?" onClose={() => { location.hash = '#/activities' }}>
        <p className="settings-row-sub">{plugin.emoji} {plugin.name} saves progress for each person.</p>
        <div className="who-grid">
          {members.map(m => (
            <button key={m.id} className="who-btn" onClick={() => setPlayer(m)}>
              <Face m={m} className="who-avatar" aria-hidden="true" />
              {m.name}
            </button>
          ))}
        </div>
        <button className="btn btn-secondary btn-block" style={{ marginTop: 12 }} onClick={() => setPlayer(null)}>Just playing</button>
      </Sheet>
    )
  }
  return (
    <div className="plugin-player" style={keyboard ? { paddingBottom: keyboard } : undefined}>
      <div className="plugin-bar">
        <button type="button" className="btn btn-secondary" onClick={() => askLeaveRef.current()}>‹ Activities</button>
        <span className="plugin-bar-title"><span aria-hidden="true">{plugin.emoji}</span> {plugin.name}</span>
        {chip && (() => {
          const inner = <>
            <ActivityRing done={chipDone} need={chip.needSeconds} complete={chip.completed} />
            <span>
              {chip.emoji && <span aria-hidden="true">{chip.emoji} </span>}
              {chip.completed ? `${chip.title}: done ✓` : `${chip.title}: ${Math.floor(chipDone / 60)} of ${chip.needSeconds / 60} min`}
            </span>
            {burst > 0 && <Confetti key={burst} />}
          </>
          const cls = `plugin-chore-chip ${chip.completed ? 'done' : ''}`
          return parentDevice
            ? <button type="button" className={cls} onClick={() => void resetChip()} aria-label={`${chip.title}: ${chip.completed ? 'done' : `${Math.floor(chipDone / 60)} of ${chip.needSeconds / 60} min`}. Reset today's time`}>{inner}</button>
            : <span className={cls} role="status">{inner}</span>
        })()}
        {player && members.length > 1 && <button className="btn btn-secondary" onClick={() => { setPresetId(null); setPlayer(undefined) }}>{player.avatar || ''} {player.name} · Switch</button>}
      </div>
      {/* key: switching players restarts the plugin with the new person's progress */}
      <iframe key={player?.id ?? 'nobody'} ref={frame} className="plugin-frame" title={plugin.name} src={api.pluginUrl(plugin)}
        sandbox="allow-scripts" allow="autoplay" referrerPolicy="no-referrer"
        onLoad={e => { if (frameLoaded(e.currentTarget)) setLeft(true) }} />
    </div>
  )
}

/** Activities → Get more activities (admins): install from GitHub or a package, update, turn off, remove. */
export function PluginsSheet({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { toast } = useApp()
  const dialog = useDialog()
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [catalog, setCatalog] = useState<{ catalogOnly: boolean; plugins: PluginCatalogEntry[] } | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const load = () => { api.getPlugins().then(setPlugins).catch(() => {}) }
  useEffect(load, [])
  useEffect(() => { api.getPluginCatalog().then(setCatalog).catch(() => setCatalog({ catalogOnly: false, plugins: [] })) }, [])
  const reviewed = (p: Plugin) => catalog?.plugins.find(e => e.id === p.id && p.source?.toLowerCase() === e.repo.toLowerCase())

  const run = async (label: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(label)
    try { await fn(); toast(done); announce(done); load(); onChanged() } catch (e) { toast(e instanceof ApiError ? e.message : 'Something went wrong', true) } finally { setBusy(null) }
  }
  return (
    <Sheet title="Get more activities" onClose={onClose}>
      {catalog && catalog.plugins.length > 0 && <>
        <h3 className="plugin-list-title">Reviewed by Kinwall</h3>
        <ul className="plugin-list">
          {catalog.plugins.map(e => {
            const installed = plugins.find(p => p.id === e.id)
            return (
              <li key={e.id} className="plugin-row">
                <span className="plugin-row-icon" aria-hidden="true" style={{ background: e.color ?? 'var(--bg-alt)' }}>{e.emoji}</span>
                <div className="plugin-row-info">
                  <div className="settings-row-label">{e.name} <span className="plugin-version">v{e.version}</span></div>
                  <div className="settings-row-sub">{[e.description, e.ages ? `Ages ${e.ages.min}${e.ages.max ? `–${e.ages.max}` : '+'}` : '', e.categories.join(', ')].filter(Boolean).join(' · ')}</div>
                  <div className="plugin-row-actions">
                    {installed
                      ? <span className="settings-row-sub">✓ Installed</span>
                      : <button className="btn btn-primary" disabled={!!busy} onClick={() => run(e.id, () => api.installPlugin(`https://github.com/${e.repo}`), `${e.name} installed`)}>{busy === e.id ? 'Installing…' : 'Install'}</button>}
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      </>}
      {catalog && !catalog.catalogOnly && <>
        <h3 className="plugin-list-title">From anywhere</h3>
        <p className="settings-row-sub">Any GitHub repository whose release has a <code>kinwall-plugin.zip</code> package can be added. Activities run in a sandbox and see only who's playing and their own saved progress, but these haven't been reviewed: only add ones you trust.</p>
        <form className="plugin-install" onSubmit={e => { e.preventDefault(); if (url.trim()) run('install', async () => { const p = await api.installPlugin(url.trim()); setUrl(''); return p }, 'Activity installed') }}>
          <label htmlFor="plugin-url" className="settings-row-label">GitHub repository</label>
          <div className="plugin-install-row">
            <input id="plugin-url" type="url" inputMode="url" placeholder="https://github.com/owner/kinwall-plugin-name" value={url} onChange={e => setUrl(e.target.value)} />
            <button className="btn btn-primary" disabled={!url.trim() || !!busy}>{busy === 'install' ? 'Installing…' : 'Install'}</button>
          </div>
        </form>
        <div className="plugin-upload">
          <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={e => {
            const f = e.target.files?.[0]; e.target.value = ''
            if (f) run('upload', () => api.uploadPlugin(f), 'Activity installed')
          }} />
          <button className="btn btn-secondary" disabled={!!busy} onClick={() => fileRef.current?.click()}>{busy === 'upload' ? 'Installing…' : 'Upload a kinwall-plugin.zip'}</button>
        </div>
      </>}
      {catalog?.catalogOnly && catalog.plugins.length === 0 && <p className="settings-row-sub">No reviewed activities yet. Check back soon.</p>}

      <h3 className="plugin-list-title">Installed</h3>
      {plugins.length === 0 && <p className="settings-row-sub">None yet.</p>}
      <ul className="plugin-list">
        {plugins.map(p => (
          <li key={p.id} className="plugin-row">
            <span className="plugin-row-icon" aria-hidden="true" style={{ background: p.color ?? 'var(--bg-alt)' }}>{p.emoji}</span>
            <div className="plugin-row-info">
              <div className="settings-row-label">{p.name} <span className="plugin-version">v{p.version}</span></div>
              <div className="settings-row-sub">
                {[p.description, p.ages ? `Ages ${p.ages.min}${p.ages.max ? `–${p.ages.max}` : '+'}` : '', p.categories.join(', '), reviewed(p) ? 'Reviewed' : p.source ? `github.com/${p.source}` : 'Uploaded'].filter(Boolean).join(' · ')}
              </div>
              <div className="plugin-row-actions">
                <div className="toggle-row">
                  <label id={`plugin-on-${p.id}`}>On</label>
                  <button className={`switch ${p.enabled ? 'on' : ''}`} role="switch" aria-checked={p.enabled} aria-labelledby={`plugin-on-${p.id}`} disabled={!!busy}
                    onClick={() => run(p.id, () => api.setPluginEnabled(p.id, !p.enabled), p.enabled ? `${p.name} turned off` : `${p.name} turned on`)}><span className="knob" /></button>
                </div>
                {(() => {
                  // A reviewed plugin updates only to the catalog's version; others to their latest release.
                  const e = reviewed(p)
                  if (e) return e.version !== p.version && <button className="btn btn-primary" disabled={!!busy} onClick={() => run(p.id, () => api.updatePlugin(p.id), `${p.name} updated to v${e.version}`)}>Update to v{e.version}</button>
                  // Reviewed once, now off the list: it never falls back to an unreviewed release.
                  if (p.reviewed && catalog) return <p className="settings-row-sub">Taken off the list of reviewed activities, so it can't be updated. It keeps working as it is.</p>
                  return p.source && !catalog?.catalogOnly && <button className="btn btn-secondary" disabled={!!busy} onClick={() => run(p.id, () => api.updatePlugin(p.id), `${p.name} is up to date`)}>Update</button>
                })()}
                <button className="btn btn-danger" disabled={!!busy} onClick={async () => {
                  if (await dialog.confirm({ title: `Remove ${p.name}?`, body: 'Its saved progress for everyone is deleted too.', confirmLabel: 'Remove', danger: true })) run(p.id, () => api.deletePlugin(p.id), `${p.name} removed`)
                }}>Remove</button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Sheet>
  )
}
