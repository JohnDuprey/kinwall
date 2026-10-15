// Home → Newscast (docs/using/newscast.md): what the family did and shared, a day at a time.
// Calm by design: no unread badge, no pushes, no jumping. A fresh load with new items waits behind
// a quiet "New: N · Show"; it's asked for only while this tab is showing and /api/rev moved
// (refreshTick). Reactions show faces, never counts. Low-stimulation mode drops the pictures.
import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from './AppContext.tsx'
import { actingMember } from './actingAs.ts'
import { api, ApiError } from './api.ts'
import type { Member, Newscast, NewscastItem, NewscastReaction } from './types.ts'
import { rewardsOn } from './types.ts'
import { daySections, newCount, pictureAlt, weekDigest } from './newscast.ts'
import { formatTime } from './timeFormat.ts'
import { useMediaQuery } from './useIsPhone.ts'
import { useDeviceAppearance } from './useTheme.ts'
import { preparePhoto, safeImageSrc } from './photos.ts'
import { announce, LoadError } from './a11y.tsx'
import { useDialog } from './dialog.tsx'
import Sheet from './Sheet.tsx'
import { MoreIcon } from './icons.tsx'
import { Face as MemberFace } from './Face'
import { msg, t, tm, tn } from './i18n.ts'

const REACTIONS: { emoji: NewscastReaction; label: string }[] = [{ emoji: '👏', label: msg('Clap') }, { emoji: '❤️', label: msg('Love') }, { emoji: '🎉', label: msg('Celebrate') }]
const EMOJI = ['📣', '🎉', '❤️', '🍕', '⚽', '🎂', '✈️', '🏠', '🐶', '📚', '🎨', '🦷']
const MAX = 280

function Face({ m, size = 'md' }: { m: Pick<Member, 'color' | 'avatar' | 'name' | 'picture'> | undefined; size?: 'sm' | 'md' }) {
  if (m) return <MemberFace m={m} className={`news-face news-face-${size}`} aria-hidden="true" />
  return <span className={`news-face news-face-${size}`} aria-hidden="true">🏠</span>
}

export default function NewscastView() {
  const { settings, members, meMemberId, actingMemberId, parentDevice, refreshTick, toast, reloadCore } = useApp()
  const dialog = useDialog()
  const calm = !!useDeviceAppearance().lowStim
  const wide = useMediaQuery('(min-width: 900px)')
  const tz = settings.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  const byId = useMemo(() => new Map(members.map(m => [m.id, m])), [members])
  const [feed, setFeed] = useState<Newscast | null>(null)
  const [fresh, setFresh] = useState<Newscast | null>(null) // a newer load with new items, waiting behind "New: N · Show"
  const [older, setOlder] = useState<NewscastItem[] | null>(null) // Earlier this month, once asked for
  const [showAll, setShowAll] = useState<Set<string>>(new Set())
  const [error, setError] = useState(false)
  const [composing, setComposing] = useState(false)
  const [reacting, setReacting] = useState<{ item: NewscastItem; emoji: NewscastReaction } | null>(null) // a wall's "Who's reacting?"
  const feedRef = useRef(feed) // what's on screen, for comparing a fresh load against
  useEffect(() => { feedRef.current = feed }, [feed])

  const load = (show = false) => api.getNewscast().then(next => {
    setError(false)
    const cur = feedRef.current
    if (show || !cur || cur.today !== next.today || newCount(cur.items, next.items) === 0) { setFeed(next); setFresh(null) }
    else setFresh(next)
  }, () => { if (!feedRef.current) setError(true) })
  useEffect(() => { load() }, [refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (e: unknown, fallback: string) => toast(e instanceof ApiError ? e.message : fallback, true)
  const patchItem = (key: string, reactions: NewscastItem['reactions']) => {
    const fix = (items: NewscastItem[]) => items.map(i => i.key === key ? { ...i, reactions } : i)
    setFeed(f => f && { ...f, items: fix(f.items) })
    setOlder(o => o && fix(o))
  }
  const acting = actingMember(actingMemberId, members)?.id // the wall's picked person (actingAs.ts)
  const react = async (item: NewscastItem, emoji: NewscastReaction, memberId: string) => {
    const on = !item.reactions.find(r => r.emoji === emoji)?.memberIds.includes(memberId)
    try {
      patchItem(item.key, (await api.reactNewscast({ itemKey: item.key, emoji, on, ...(meMemberId ? {} : { memberId }) })).reactions)
      const reaction = tm(REACTIONS.find(r => r.emoji === emoji)?.label ?? '')
      const name = byId.get(memberId)?.name ?? ''
      const said = meMemberId
        ? (on ? t('Reacted {reaction}', { reaction }) : t('Took back {reaction}', { reaction }))
        : (on ? t('Reacted {reaction} as {name}', { reaction, name }) : t('Took back {reaction} as {name}', { reaction, name }))
      if (!meMemberId && memberId === acting) toast(`${emoji} ${said}`) // a wall acting as its picked person says so
      else announce(said)
    } catch (e) { fail(e, t('Could not react')) }
  }
  // A person's own device reacts as them; a wall screen as the person picked in its header (until it
  // goes idle), else it asks who, every time.
  const tapReaction = (item: NewscastItem, emoji: NewscastReaction) => meMemberId ? react(item, emoji, meMemberId) : acting ? react(item, emoji, acting) : setReacting({ item, emoji })

  const setList = async (key: 'newscastNotFeatured' | 'newscastPostingPaused', id: string, on: boolean) => {
    const cur = settings[key] ?? []
    try { await api.updateSettings({ [key]: on ? [...cur.filter(x => x !== id), id] : cur.filter(x => x !== id) }); reloadCore(); load(true) }
    catch (e) { fail(e, t('Could not change that')) }
  }
  const moderate = async (item: NewscastItem, action: string) => {
    const name = byId.get(item.memberId ?? '')?.name ?? t('them')
    if (action === 'delete' || action === 'remove' || action === 'removePhoto') {
      const mine = action === 'delete'
      const ok = await dialog.confirm({
        title: mine ? t('Delete your post?') : t("Remove {name}'s post?", { name }),
        body: mine ? t('It goes for everyone.') : action === 'removePhoto' ? t('The post goes for everyone, and its photo is deleted from family photos.') : t('{name} sees "Removed by a parent" in its place. The photo stays in family photos.', { name }),
        confirmLabel: mine ? t('Delete') : t('Remove'), danger: true,
      })
      if (!ok) return
      try { await api.removeNewscastPost(item.post!.id, action === 'removePhoto'); load(true); announce(mine ? t('Post deleted') : t('Post removed')) } catch (e) { fail(e, t('Could not remove the post')) }
    } else if (action === 'pause' || action === 'resume') {
      await setList('newscastPostingPaused', item.memberId!, action === 'pause')
      toast(action === 'pause' ? t("{name} can't post for now", { name }) : t('{name} can post again', { name }))
    } else if (action === 'unfeature') {
      if (!await dialog.confirm({ title: t('Leave {name} out of Newscast?', { name }), body: t('Their chores, rewards, photos, books and memories stop showing here. Their own posts still show. Turn it back on in Settings → Family → {name}.', { name }), confirmLabel: t('Leave out') })) return
      await setList('newscastNotFeatured', item.memberId!, true)
    }
  }

  if (error) return <LoadError what="Newscast" onRetry={() => load(true)} />
  if (!feed) return <div className="news-loading" aria-busy="true" />

  const all = [...feed.items, ...(older ?? [])]
  const sections = daySections(all, feed.today, showAll)
  const pending = fresh ? newCount(feed.items, fresh.items) : 0
  const digest = weekDigest(feed.items, feed.today)
  const composer = (inSheet: boolean) => <Composer inSheet={inSheet} onPosted={() => { setComposing(false); load(true) }} />
  const week = (
    <section className="news-card news-week" aria-labelledby="news-week-title">
      <h3 id="news-week-title">{t('This week, together')}</h3>
      <ul>
        {settings.features.chores && <li><span>{t('✅ Chores done')}</span><b>{digest.chores}</b></li>}
        {settings.features.trackersReading && <li><span>{t('📚 Books finished')}</span><b>{digest.books}</b></li>}
        {settings.features.photos && <li><span>{t('📸 Photos and drawings')}</span><b>{digest.pictures}</b></li>}
        {rewardsOn(settings) && <li><span>{t('🎁 Rewards')}</span><b>{digest.rewards}</b></li>}
      </ul>
      <p className="news-note">{t('Family totals only. No one is ranked here.')}</p>
    </section>
  )

  return (
    <div className="newscast">
      <div className="news-feed">
        {!wide && (
          <button type="button" className="news-share" onClick={() => setComposing(true)}>
            <Face m={byId.get(meMemberId ?? '')} /><span>{t('Share something…')}</span><span className="news-share-go" aria-hidden="true">📣</span>
          </button>
        )}
        {pending > 0 && <div className="news-new"><button type="button" className="btn btn-secondary" onClick={() => { setFeed(fresh); setFresh(null); announce(t('{n} new', { n: pending })) }}>{t('New: {n}', { n: pending })} · {t('Show')}</button></div>}
        {sections.length === 0 && <div className="empty-card"><span className="emoji">📣</span>{t('Nothing yet this week. Chores done, new photos, books finished and announcements show up here.')}</div>}
        {sections.map(day => (
          <section key={day.date} className="news-day" aria-labelledby={`news-day-${day.date}`}>
            <h3 className="news-day-head" id={`news-day-${day.date}`}>{day.label}{day.label !== day.long && <span>{day.long}</span>}</h3>
            {day.items.map(item => (
              <NewsItem key={item.key} item={item} byId={byId} me={meMemberId} parent={parentDevice} calm={calm} tz={tz}
                paused={(settings.newscastPostingPaused ?? []).includes(item.memberId ?? '')} onReact={tapReaction} onModerate={moderate} />
            ))}
            {day.more > 0 && <button type="button" className="btn btn-secondary news-more" onClick={() => setShowAll(s => new Set(s).add(day.date))}>{t('Show all for {day} (+{n})', { day: day.label, n: day.more })}</button>}
          </section>
        ))}
        {feed.earlier && !older && (
          <button type="button" className="btn btn-secondary news-more" onClick={() => api.getNewscast({ before: feed.from, days: 30 }).then(e => setOlder(e.items), e => fail(e, t('Could not load earlier days')))}>{t('Earlier this month')}</button>
        )}
        {!wide && sections.length > 0 && week}
      </div>
      {wide && <aside className="news-side">{composer(false)}{week}</aside>}
      {composing && !wide && <Sheet title={t('📣 Share something')} onClose={() => setComposing(false)}>{composer(true)}</Sheet>}
      {reacting && (
        <Sheet title={t("Who's reacting?")} variant="dialog" onClose={() => setReacting(null)}>
          <div className="news-who" role="group" aria-label={t("Who's reacting?")}>
            {members.map(m => {
              const already = reacting.item.reactions.find(r => r.emoji === reacting.emoji)?.memberIds.includes(m.id)
              return (
                <button key={m.id} type="button" className={`news-who-btn ${already ? 'active' : ''}`} aria-pressed={!!already}
                  onClick={() => { react(reacting.item, reacting.emoji, m.id); setReacting(null) }}>
                  <Face m={m} /><span>{m.name}</span>
                </button>
              )
            })}
          </div>
          <p className="news-note">{reacting.emoji} {t('Tap again to take it back.')}</p>
        </Sheet>
      )}
    </div>
  )
}

function NewsItem({ item, byId, me, parent, calm, tz, paused, onReact, onModerate }: {
  item: NewscastItem; byId: Map<string, Member>; me: string | null; parent: boolean; calm: boolean; tz: string; paused: boolean
  onReact: (item: NewscastItem, emoji: NewscastReaction) => void; onModerate: (item: NewscastItem, action: string) => void
}) {
  const m = byId.get(item.memberId ?? '')
  const post = item.post
  const mine = !!me && item.memberId === me
  const [menu, setMenu] = useState(false)
  const [big, setBig] = useState<NewscastItem['photos'][number] | null>(null) // a picture open full size
  if (post?.removed) {
    return (
      <article className="news-item news-removed">
        <Face m={m} />
        <p>{mine ? t('A parent took this post down. Only you and parents see this note.') : t('Removed by a parent. Only {name} and parents see this note.', { name: m?.name ?? t('the author') })}</p>
      </article>
    )
  }
  const alt = pictureAlt(item)
  // "More…": the author deletes their own post; a parent removes any, pauses posting, or leaves someone out.
  const actions: [string, string][] = [
    ...(post && mine ? [['delete', t('Delete my post')]] as [string, string][] : []),
    ...(post && parent && !mine ? [['remove', t('Remove post')], ...(item.photos.length ? [['removePhoto', t('Remove post and its photo')]] : []), ...(m && !m.grownUp ? [[paused ? 'resume' : 'pause', paused ? t('Let {name} post again', { name: m.name }) : t('Pause posting for {name}', { name: m.name })]] : [])] as [string, string][] : []),
    ...(!post && parent && m ? [['unfeature', t('Leave {name} out of Newscast', { name: m.name })]] as [string, string][] : []),
  ]
  return (
    <article className={`news-item ${post ? 'news-post' : ''}`} style={post && m ? { ['--news-color' as string]: m.color } : undefined}>
      <div className="news-head">
        <Face m={m} />
        <div className="news-body">
          {post ? <>
            <div className="news-kind">📣 {mine ? t('You') : m?.name ?? t('Someone')}{post.audience === 'grownups' && <span className="chip chip-static news-audience">{t('Grown-ups only')}</span>}</div>
            <p className="news-say">{post.emoji && <span aria-hidden="true">{post.emoji} </span>}{post.text}</p>
          </> : <>
            <div className="news-title"><span aria-hidden="true">{item.emoji} </span>{item.title}</div>
            {item.detail && <div className="news-detail">{item.detail}</div>}
          </>}
          {calm && item.photos.length > 0 && <div className="news-detail">📸 {tn(item.photos.length, 'A picture in family photos', '{n} pictures in family photos')}</div>}
        </div>
        {item.at && <time className="news-when" dateTime={item.at}>{formatTime(item.at, tz)}</time>}
      </div>
      {!calm && item.photos.length > 0 && (
        <div className="news-photos">
          {item.photos.slice(0, 3).map(p => (
            <button key={p.id} type="button" className="news-photo" aria-haspopup="dialog" aria-label={t('Show full size: {name}', { name: alt })} onClick={() => setBig(p)}>
              <img src={api.photoImageUrl(p)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
      <div className="news-foot">
        <div className="news-reacts" role="group" aria-label={t('Reactions')}>
          {REACTIONS.map(({ emoji, label }) => {
            const ids = item.reactions.find(r => r.emoji === emoji)?.memberIds ?? []
            const names = ids.map(id => byId.get(id)?.name).filter(Boolean)
            const pressed = !!me && ids.includes(me)
            return (
              <button key={emoji} type="button" className={`news-react ${pressed ? 'mine' : ''}`} aria-pressed={me ? pressed : undefined}
                aria-label={names.length ? t('{reaction}, from {names}', { reaction: tm(label), names: names.join(', ') }) : tm(label)} onClick={() => onReact(item, emoji)}>
                <span aria-hidden="true">{emoji}</span>
                {ids.length > 0 && <span className="news-react-faces" aria-hidden="true">{ids.slice(0, 5).map(id => <Face key={id} m={byId.get(id)} size="sm" />)}</span>}
              </button>
            )
          })}
        </div>
        {actions.length > 0 && (
          <button type="button" className="icon-btn news-more-btn" aria-label={post ? t('More for this post') : t('More for this item')} aria-haspopup="dialog" onClick={() => setMenu(true)}>
            <MoreIcon width={20} height={20} />
          </button>
        )}
      </div>
      {big && (
        <Sheet title={alt} variant="full" onClose={() => setBig(null)}>
          <button type="button" className="news-photo-full" aria-label={t('Close')} onClick={() => setBig(null)}>
            <img src={api.photoImageUrl(big)} alt={alt} />
          </button>
        </Sheet>
      )}
      {menu && (
        <Sheet title={post ? (mine ? t('Your post') : t("{name}'s post", { name: m?.name ?? t('Someone') })) : item.title} variant="dialog" onClose={() => setMenu(false)}>
          <div className="news-menu">
            {actions.map(([v, l]) => (
              <button key={v} type="button" className={`btn ${v.startsWith('remove') || v === 'delete' ? 'btn-danger' : 'btn-secondary'}`} onClick={() => { setMenu(false); onModerate(item, v) }}>{l}</button>
            ))}
          </div>
        </Sheet>
      )}
    </article>
  )
}

/** Share an announcement: 280 characters, an optional emoji and one photo. A person's own device
 * posts as them; a wall screen picks who. Grown-ups can keep one to grown-ups only. */
function Composer({ inSheet, onPosted }: { inSheet: boolean; onPosted: () => void }) {
  const { members, meMemberId, actingMemberId, settings, toast } = useApp()
  const [text, setText] = useState('')
  const [emoji, setEmoji] = useState('')
  const [picked, setAs] = useState(meMemberId ?? '')
  const as = picked || actingMember(actingMemberId, members)?.id || '' // a wall starts on its picked person
  const [audience, setAudience] = useState<'everyone' | 'grownups'>('everyone')
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null) // uploaded on Share, so a dropped one never lands in family photos
  const [busy, setBusy] = useState(false)
  const who = members.find(m => m.id === (meMemberId ?? as))
  const paused = !!who && (settings.newscastPostingPaused ?? []).includes(who.id)
  const pickPhoto = (file: File | undefined) => {
    if (photo) URL.revokeObjectURL(photo.url)
    setPhoto(file ? { file, url: URL.createObjectURL(file) } : null)
  }
  const share = async () => {
    if (!text.trim() || !who) return
    setBusy(true)
    try {
      let photoId: string | null = null
      if (photo) {
        const { blob, width, height } = await preparePhoto(photo.file)
        photoId = (await api.uploadPhoto(blob, width, height, undefined, true, { by: meMemberId ? undefined : who.id })).id
      }
      await api.postNewscast({ text: text.trim(), emoji: emoji || null, photoId, audience: who.grownUp ? audience : 'everyone', ...(meMemberId ? {} : { memberId: who.id }) })
      setText(''); setEmoji(''); pickPhoto(undefined); setAudience('everyone')
      toast(meMemberId ? t('Shared') : t('Shared ✓ {name}', { name: who.name })); onPosted()
    } catch (e) { toast(e instanceof Error ? e.message : t('Could not share that'), true) } finally { setBusy(false) }
  }
  return (
    <section className={inSheet ? 'news-compose' : 'news-card news-compose'} aria-label={t('Share something')}>
      {!inSheet && <h3>{t('📣 Share something')}</h3>}
      {paused ? <p className="news-note">{t('{name} is taking a break from posting for now. A parent can turn it back on in Settings. Reactions still work.', { name: who!.name })}</p> : <>
        <textarea value={text} onChange={e => setText(e.target.value)} maxLength={MAX} rows={3} placeholder={t('Tell the family…')} aria-label={t('Announcement')} aria-describedby="news-count" />
        <div className="news-count" id="news-count">{tn(MAX - text.length, '{n} left', '{n} left')}</div>
        <div className="news-row">
          {!meMemberId && (
            <select className="settings-select" aria-label={t('Post as')} value={as} onChange={e => setAs(e.target.value)}>
              <option value="">{t('Post as…')}</option>
              {members.map(m => <option key={m.id} value={m.id}>{m.avatar} {m.name}</option>)}
            </select>
          )}
          {who?.grownUp && (
            <select className="settings-select" aria-label={t('Who sees it')} value={audience} onChange={e => setAudience(e.target.value as 'everyone' | 'grownups')}>
              <option value="everyone">{t('👪 Everyone')}</option>
              <option value="grownups">{t('🔒 Grown-ups only')}</option>
            </select>
          )}
          <select className="settings-select" aria-label={t('Emoji')} value={emoji} onChange={e => setEmoji(e.target.value)}>
            <option value="">{t('No emoji')}</option>
            {EMOJI.map(x => <option key={x} value={x}>{x}</option>)}
          </select>
        </div>
        {photo && (
          <div className="news-photo-pick">
            <img src={safeImageSrc(photo.url)} alt={t('The photo to share')} />
            <button type="button" className="btn btn-secondary" onClick={() => pickPhoto(undefined)}>{t('Leave out the photo')}</button>
          </div>
        )}
        <div className="news-row">
          {!photo && settings.features.photos && (
            <label className="btn btn-secondary news-photo-btn">
              {t('📷 Add a photo')}
              <input type="file" accept="image/*" hidden onChange={e => { pickPhoto(e.target.files?.[0]); e.target.value = '' }} />
            </label>
          )}
          <span className="spacer" />
          <button type="button" className="btn btn-primary" onClick={share} disabled={busy || !text.trim() || !who}>{t('Share')}</button>
        </div>
        <p className="news-note">{audience === 'grownups' && who?.grownUp ? t("Only grown-ups' own devices see it, for 30 days.") : t('Everyone sees it here for 30 days.')}{photo ? ` ${t('The photo is also in family photos.')}` : ''}</p>
      </>}
    </section>
  )
}
