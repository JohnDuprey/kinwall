// Family photos (server: routes/photos.ts): a grid of the family's pictures, which the Board's
// picture card and the screensaver can show. Anyone can look; uploading, captions and deleting need
// an admin key. Photos are shrunk in the browser before upload (photos.ts).
import { useEffect, useRef, useState } from 'react'
import { api, ApiError, getAdminKey, MOCK } from './api.ts'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { announce } from './a11y.tsx'
import { ChevronLeft } from './icons.tsx'
import Sheet from './Sheet.tsx'
import { preparePhoto, PhotoFormatError } from './photos.ts'
import type { Photo, PhotoQuota } from './types.ts'
import { ChipFace } from './Face'
import { intlLocale, t, tn } from './i18n.ts'

const mb = (b: number) => { const v = b / 1048576; return t('{n} MB', { n: new Intl.NumberFormat(intlLocale(), { maximumFractionDigits: v < 10 && v > 0 ? 1 : 0, useGrouping: false }).format(v) }) }
const photoCount = (n: number) => tn(n, '{n} photo', '{n} photos')

export default function Photos() {
  const { members, refreshTick, toast } = useApp()
  const [photos, setPhotos] = useState<Photo[] | null>(null)
  const [quota, setQuota] = useState<PhotoQuota | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const zipInput = useRef<HTMLInputElement>(null)
  const [importing, setImporting] = useState(false)

  useEffect(() => { api.meStrict().then(me => setIsAdmin(me.scope === 'admin' || !!getAdminKey())).catch(() => setIsAdmin(false)) }, [])
  const load = () => Promise.all([api.getPhotos(), api.getPhotoQuota()])
    .then(([p, q]) => { setPhotos(p); setQuota(q) })
    .catch(() => toast(t("Couldn't load photos."), true))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { if (!progress) load() }, [refreshTick])

  const upload = async (files: File[]) => {
    if (!files.length) return
    let added = 0
    const failed: string[] = []
    setProgress({ done: 0, total: files.length })
    for (const [i, file] of files.entries()) {
      try {
        const { blob, width, height } = await preparePhoto(file)
        await api.uploadPhoto(blob, width, height)
        added++
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) { failed.push(e.message); break }
        failed.push(e instanceof PhotoFormatError || e instanceof ApiError ? e.message : `${file.name}: ${e instanceof Error ? e.message : t("couldn't upload")}`)
      }
      setProgress({ done: i + 1, total: files.length })
    }
    setProgress(null)
    await load()
    const msg = [added && tn(added, 'Added {n} photo.', 'Added {n} photos.'), failed[0]].filter(Boolean).join(' ')
    toast(msg || t('Nothing added.'), failed.length > 0)
    announce(msg)
  }

  const importZip = async (file?: File) => {
    if (!file) return
    setImporting(true)
    try {
      const r = await api.importPhotos(file)
      const imported = tn(r.imported, 'Imported {n} photo', 'Imported {n} photos')
      const msg = r.skipped ? t('{imported}, skipped {n} (already here, too large, or storage full).', { imported, n: r.skipped }) : `${imported}.`
      toast(msg, r.skipped > 0)
      announce(msg)
      await load()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t("Couldn't import that zip."), true)
    } finally { setImporting(false) }
  }

  const open = photos?.find(p => p.id === openId) ?? null
  const ready = isAdmin && !!quota && !progress
  const full = !!quota && (quota.count >= quota.maxCount || quota.bytes >= quota.maxBytes)

  return (
    <div className="photos scroll-y">
      <div className="photos-head">
        <a className="paint-btn" href="#/activities" aria-label={t('Back to activities')}><ChevronLeft /></a>
        <div className="photos-title">
          <h2>{t('Photos')}</h2>
          {quota && <span className="photos-quota">{photoCount(quota.count - (quota.memoryPhotos ?? 0))}{quota.memoryPhotos ? ` ${t('(+{n} in memories)', { n: quota.memoryPhotos })}` : ''} · {t('{used} of {total}', { used: mb(quota.bytes), total: mb(quota.maxBytes) })}</span>}
        </div>
        {isAdmin && <>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; upload(f) }} />
          <button className="btn btn-primary" disabled={!ready || full} onClick={() => input.current?.click()}>
            {progress ? t('Uploading {n} of {total}…', { n: Math.min(progress.done + 1, progress.total), total: progress.total }) : t('Add photos')}
          </button>
        </>}
      </div>
      {isAdmin && (
        <div className="photos-backup">
          <button className="btn btn-secondary" onClick={() => MOCK ? toast(t('Downloads are off in the demo.'))
            : api.downloadPhotos().catch(e => toast(e instanceof ApiError ? e.message : t("Couldn't start the download."), true))}>{t('Download all (zip)')}</button>
          <input ref={zipInput} type="file" accept=".zip,application/zip" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; importZip(f) }} />
          <button className="btn btn-secondary" disabled={importing || !!progress} onClick={() => zipInput.current?.click()}>{importing ? t('Importing…') : t('Import zip')}</button>
        </div>
      )}
      {full && isAdmin && <p className="photos-note">{t('Photo storage is full. Delete some photos to add more.')}</p>}

      {photos && photos.length === 0 && (
        <div className="state-card">
          {t('No photos yet.')} {isAdmin ? t('Tap Add photos to pick some — they show up on the Board and the screensaver.') : t('Add some from a phone or computer signed in as a parent.')}
        </div>
      )}
      {photos && photos.length > 0 && (
        <ul className="photo-grid" aria-label={t('Photos')}>
          {photos.map(p => (
            <li key={p.id}>
              <button className="photo-tile" onClick={() => setOpenId(p.id)} aria-label={p.caption || t('Photo from {date}', { date: new Date(p.createdAt).toLocaleDateString(intlLocale()) })}>
                <img src={api.photoImageUrl(p)} alt="" loading="lazy" decoding="async" width={p.width} height={p.height} />
                {p.caption && <span className="photo-tile-caption" aria-hidden="true">{p.caption}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && photos && (
        <PhotoSheet key={open.id} photo={open} isAdmin={isAdmin} members={members} onClose={() => setOpenId(null)} onChanged={load}
          index={photos.findIndex(p => p.id === open.id)} count={photos.length}
          onNav={dir => { const i = photos.findIndex(p => p.id === open.id) + dir; if (photos[i]) setOpenId(photos[i].id) }} />
      )}
    </div>
  )
}

function PhotoSheet({ photo, isAdmin, members, onClose, onChanged, index, count, onNav }: {
  photo: Photo; isAdmin: boolean; members: ReturnType<typeof useApp>['members']; onClose: () => void; onChanged: () => void
  index: number; count: number; onNav: (dir: 1 | -1) => void
}) {
  // Previous / next: arrows, ← →, or a swipe across the picture.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'ArrowRight') onNav(1); else if (e.key === 'ArrowLeft') onNav(-1) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onNav])
  const touchX = useRef<number | null>(null)
  const { toast } = useApp()
  const dialog = useDialog()
  const [caption, setCaption] = useState(photo.caption ?? '')
  const [memberId, setMemberId] = useState(photo.memberId)
  const [busy, setBusy] = useState(false)
  const owner = members.find(m => m.id === photo.memberId)
  const dirty = caption.trim() !== (photo.caption ?? '') || memberId !== photo.memberId

  const save = async () => {
    setBusy(true)
    try { await api.updatePhoto(photo.id, { caption: caption.trim() || null, memberId }); onChanged(); onClose() }
    catch (e) { toast(e instanceof ApiError ? e.message : t("Couldn't save the photo."), true) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!await dialog.confirm({ title: photo.caption ? t('Delete “{name}”?', { name: photo.caption }) : t('Delete this photo?'), body: t("It's removed from the Board and the screensaver too."), confirmLabel: t('Delete'), danger: true })) return
    setBusy(true)
    try { await api.deletePhoto(photo.id); onChanged(); onClose(); announce(t('Photo deleted')) }
    catch (e) { toast(e instanceof ApiError ? e.message : t("Couldn't delete the photo."), true); setBusy(false) }
  }

  return (
    <Sheet title={photo.caption || t('Photo')} onClose={onClose}
      actions={isAdmin ? <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>{t('Save')}</button> : undefined}>
      <div className="photo-stage" onTouchStart={e => { touchX.current = e.touches[0].clientX }}
        onTouchEnd={e => { const x0 = touchX.current; touchX.current = null; if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) onNav(dx < 0 ? 1 : -1) }}>
        <img className="photo-full" src={api.photoImageUrl(photo)} alt={photo.caption ?? ''} width={photo.width} height={photo.height} />
        {count > 1 && <>
          <button className="icon-btn photo-nav photo-nav-prev" onClick={() => onNav(-1)} disabled={index <= 0} aria-label={t('Previous photo')}>‹</button>
          <button className="icon-btn photo-nav photo-nav-next" onClick={() => onNav(1)} disabled={index >= count - 1} aria-label={t('Next photo')}>›</button>
          <span className="photo-counter" aria-live="polite">{index + 1} / {count}</span>
        </>}
      </div>
      {isAdmin ? <>
        <div className="field">
          <label htmlFor="photo-caption">{t('Caption')}</label>
          <input id="photo-caption" type="text" value={caption} maxLength={200} onChange={e => setCaption(e.target.value)} placeholder={t('Add a caption')} autoComplete="off" />
        </div>
        <div className="field">
          <label>{t('For')}</label>
          <div className="chip-row" role="group" aria-label={t('Who is this photo for?')}>
            <button className={`chip ${memberId === null ? 'active' : ''}`} aria-pressed={memberId === null} onClick={() => setMemberId(null)}>{t('Everyone')}</button>
            {members.map(m => (
              <button key={m.id} className={`chip ${memberId === m.id ? 'active' : ''}`} aria-pressed={memberId === m.id}
                style={{ ['--chip-color' as string]: m.color }} onClick={() => setMemberId(m.id)}><ChipFace m={m} /> {m.name}</button>
            ))}
          </div>
        </div>
      </> : owner && <p className="field-hint">{t('For {name}', { name: `${owner.avatar} ${owner.name}` })}</p>}
      <p className="field-hint">{t('Added {date}', { date: new Date(photo.createdAt).toLocaleDateString(intlLocale(), { dateStyle: 'medium' }) })} · {photo.width}×{photo.height} · {t('{n} KB', { n: Math.round(photo.bytes / 1024) })}</p>
      {isAdmin && <div className="sheet-danger-zone"><button className="link-btn link-danger" onClick={remove} disabled={busy}>{t('Delete photo')}</button></div>}
    </Sheet>
  )
}
