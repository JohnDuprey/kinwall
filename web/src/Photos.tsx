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

const mb = (b: number) => { const v = b / 1048576; return `${v < 10 && v > 0 ? v.toFixed(1).replace(/\.0$/, '') : Math.round(v)} MB` }
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

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
    .catch(() => toast("Couldn't load photos.", true))
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
        failed.push(e instanceof PhotoFormatError || e instanceof ApiError ? e.message : `${file.name}: ${e instanceof Error ? e.message : "couldn't upload"}`)
      }
      setProgress({ done: i + 1, total: files.length })
    }
    setProgress(null)
    await load()
    const msg = [added && `Added ${plural(added, 'photo')}.`, failed[0]].filter(Boolean).join(' ')
    toast(msg || 'Nothing added.', failed.length > 0)
    announce(msg)
  }

  const importZip = async (file?: File) => {
    if (!file) return
    setImporting(true)
    try {
      const r = await api.importPhotos(file)
      const msg = `Imported ${plural(r.imported, 'photo')}${r.skipped ? `, skipped ${r.skipped} (already here, too large, or storage full)` : ''}.`
      toast(msg, r.skipped > 0)
      announce(msg)
      await load()
    } catch (e) {
      toast(e instanceof ApiError ? e.message : "Couldn't import that zip.", true)
    } finally { setImporting(false) }
  }

  const open = photos?.find(p => p.id === openId) ?? null
  const ready = isAdmin && !!quota && !progress
  const full = !!quota && (quota.count >= quota.maxCount || quota.bytes >= quota.maxBytes)

  return (
    <div className="photos scroll-y">
      <div className="photos-head">
        <a className="paint-btn" href="#/activities" aria-label="Back to activities"><ChevronLeft /></a>
        <div className="photos-title">
          <h2>Photos</h2>
          {quota && <span className="photos-quota">{plural(quota.count, 'photo')} · {mb(quota.bytes)} of {mb(quota.maxBytes)}</span>}
        </div>
        {isAdmin && <>
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; upload(f) }} />
          <button className="btn btn-primary" disabled={!ready || full} onClick={() => input.current?.click()}>
            {progress ? `Uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…` : 'Add photos'}
          </button>
        </>}
      </div>
      {isAdmin && (
        <div className="photos-backup">
          <a className="btn btn-secondary" href={MOCK ? undefined : api.photoExportUrl()} download
            onClick={e => { if (MOCK) { e.preventDefault(); toast('Downloads are off in the demo.') } }}>Download all (zip)</a>
          <input ref={zipInput} type="file" accept=".zip,application/zip" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; importZip(f) }} />
          <button className="btn btn-secondary" disabled={importing || !!progress} onClick={() => zipInput.current?.click()}>{importing ? 'Importing…' : 'Import zip'}</button>
        </div>
      )}
      {full && isAdmin && <p className="photos-note">Photo storage is full. Delete some photos to add more.</p>}

      {photos && photos.length === 0 && (
        <div className="state-card">
          No photos yet.{isAdmin ? ' Tap Add photos to pick some — they show up on the Board and the screensaver.' : ' Add some from a phone or computer signed in as a parent.'}
        </div>
      )}
      {photos && photos.length > 0 && (
        <ul className="photo-grid" aria-label="Photos">
          {photos.map(p => (
            <li key={p.id}>
              <button className="photo-tile" onClick={() => setOpenId(p.id)} aria-label={p.caption || `Photo from ${new Date(p.createdAt).toLocaleDateString()}`}>
                <img src={api.photoImageUrl(p)} alt="" loading="lazy" decoding="async" width={p.width} height={p.height} />
                {p.caption && <span className="photo-tile-caption" aria-hidden="true">{p.caption}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && <PhotoSheet key={open.id} photo={open} isAdmin={isAdmin} members={members} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  )
}

function PhotoSheet({ photo, isAdmin, members, onClose, onChanged }: {
  photo: Photo; isAdmin: boolean; members: ReturnType<typeof useApp>['members']; onClose: () => void; onChanged: () => void
}) {
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
    catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't save the photo.", true) }
    finally { setBusy(false) }
  }
  const remove = async () => {
    if (!await dialog.confirm({ title: 'Delete this photo?', body: "It's removed from the Board and the screensaver too.", confirmLabel: 'Delete', danger: true })) return
    setBusy(true)
    try { await api.deletePhoto(photo.id); onChanged(); onClose(); announce('Photo deleted') }
    catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't delete the photo.", true); setBusy(false) }
  }

  return (
    <Sheet title={photo.caption || 'Photo'} onClose={onClose}
      actions={isAdmin ? <>
        <button className="btn btn-danger" onClick={remove} disabled={busy}>Delete</button>
        <button className="btn btn-primary" onClick={save} disabled={busy || !dirty}>Save</button>
      </> : undefined}>
      <img className="photo-full" src={api.photoImageUrl(photo)} alt={photo.caption ?? ''} width={photo.width} height={photo.height} />
      {isAdmin ? <>
        <div className="field">
          <label htmlFor="photo-caption">Caption</label>
          <input id="photo-caption" type="text" value={caption} maxLength={200} onChange={e => setCaption(e.target.value)} placeholder="Add a caption" autoComplete="off" />
        </div>
        <div className="field">
          <label>For</label>
          <div className="chip-row" role="group" aria-label="Who is this photo for?">
            <button className={`chip ${memberId === null ? 'active' : ''}`} aria-pressed={memberId === null} onClick={() => setMemberId(null)}>Everyone</button>
            {members.map(m => (
              <button key={m.id} className={`chip ${memberId === m.id ? 'active' : ''}`} aria-pressed={memberId === m.id}
                style={{ ['--chip-color' as string]: m.color }} onClick={() => setMemberId(m.id)}>{m.avatar} {m.name}</button>
            ))}
          </div>
        </div>
      </> : owner && <p className="field-hint">For {owner.avatar} {owner.name}</p>}
      <p className="field-hint">Added {new Date(photo.createdAt).toLocaleDateString(undefined, { dateStyle: 'medium' })} · {photo.width}×{photo.height} · {Math.round(photo.bytes / 1024)} KB</p>
    </Sheet>
  )
}
