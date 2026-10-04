// "Change picture": a member's emoji, or a profile picture from the family photos, a drawing, the
// camera or a file, cropped to a circle (picture.ts does the math) and saved as a 256 px square
// (PUT /api/members/{id}/picture). Parents' devices for anyone, a kid's own device for themselves
// (Profile.tsx); wall screens never show it. With Photos off, the album choices are hidden; taking or
// uploading a photo still works, since the picture belongs to the person, not the album.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import Sheet from './Sheet.tsx'
import { AvatarPicker } from './AnyEmojiField.tsx'
import { isValidAvatar } from './emoji.ts'
import { listDrawings } from './drawings-db.ts'
import { PhotoFormatError } from './photos.ts'
import { clampCrop, PICTURE_SIZE, sourceRect, startCrop, zoomTo, type Crop } from './picture.ts'
import type { Member, Photo } from './types.ts'

type Mode = 'emoji' | 'photos' | 'drawings' | 'upload'
type Source = { src: string; from?: string; revoke?: boolean }
type Thumb = { key: string; src: string; label: string; source: Source }

/** withEmoji: offer the emoji too (a profile); the member editor has its own emoji grid. */
export function PictureSheet({ member, onClose, withEmoji = false }: { member: Member; onClose: () => void; withEmoji?: boolean }) {
  const { settings, reloadCore, toast } = useApp()
  const f = settings.features
  const modes: { key: Mode; label: string }[] = [
    ...(withEmoji ? [{ key: 'emoji' as const, label: 'Emoji' }] : []),
    ...(f.photos ? [{ key: 'photos' as const, label: 'From family photos' }] : []),
    ...(f.photos || f.paint ? [{ key: 'drawings' as const, label: 'From drawings' }] : []),
    { key: 'upload', label: 'Take or upload a photo' },
  ]
  const [mode, setMode] = useState<Mode>(modes[0].key)
  const [avatar, setAvatar] = useState(member.avatar || member.name[0])
  const [source, setSource] = useState<Source | null>(null)
  const [busy, setBusy] = useState(false)
  const fail = (e: unknown, what: string) => { toast(e instanceof ApiError || e instanceof PhotoFormatError ? e.message : what, true); setBusy(false) }

  const saveEmoji = async () => {
    setBusy(true)
    try {
      if (avatar !== member.avatar) await api.setMemberAvatar(member.id, avatar)
      if (member.picture) await api.clearMemberPicture(member.id)
      reloadCore()
      onClose()
    } catch (e) { fail(e, "Couldn't change the avatar.") }
  }
  const remove = async () => {
    setBusy(true)
    try {
      await api.clearMemberPicture(member.id)
      reloadCore()
      onClose()
    } catch (e) { fail(e, "Couldn't remove the picture.") }
  }
  const savePicture = async (blob: Blob) => {
    setBusy(true)
    try {
      await api.setMemberPicture(member.id, blob, PICTURE_SIZE, source?.from)
      reloadCore()
      toast(`Saved: ${member.name}'s picture`)
      onClose()
    } catch (e) { fail(e, "Couldn't save the picture.") }
  }
  useEffect(() => () => { if (source?.revoke) URL.revokeObjectURL(source.src) }, [source])

  if (source) return <CropSheet source={source} member={member} busy={busy} onBack={() => setSource(null)} onSave={savePicture} onError={e => { fail(e, "Couldn't open that picture."); setSource(null) }} />

  return (
    <Sheet title="Change picture" onClose={onClose}
      actions={mode === 'emoji' ? <button className="btn btn-primary" onClick={saveEmoji} disabled={busy || !isValidAvatar(avatar)}>Save</button> : undefined}>
      <div className="field">
        <label htmlFor="picture-mode">Picture</label>
        <select id="picture-mode" className="settings-select" value={mode} onChange={e => setMode(e.target.value as Mode)}>
          {modes.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>
      {mode === 'emoji' && <AvatarPicker value={avatar} onChange={setAvatar} />}
      {(mode === 'photos' || mode === 'drawings') && <Album drawings={mode === 'drawings'} onPick={setSource} />}
      {mode === 'upload' && <Upload onPick={setSource} />}
      {mode !== 'emoji' && <p className="field-hint">Shows wherever {member.name}'s avatar does, in a ring of their color.</p>}
      {member.picture && <button className="btn btn-secondary picture-remove" onClick={remove} disabled={busy}>Remove picture</button>}
    </Sheet>
  )
}

/** Family photos (or drawings: saved to the album with Photos on, and this device's own with Paint on). */
function Album({ drawings, onPick }: { drawings: boolean; onPick: (s: Source) => void }) {
  const { settings } = useApp()
  const [thumbs, setThumbs] = useState<Thumb[] | null>(null)
  useEffect(() => {
    let live = true
    const urls: string[] = []
    const album = settings.features.photos ? api.getPhotos().catch(() => [] as Photo[]) : Promise.resolve([] as Photo[])
    const device = drawings && settings.features.paint ? listDrawings().catch(() => []) : Promise.resolve([])
    Promise.all([album, device]).then(([photos, local]) => {
      if (!live) return
      const fromAlbum = photos.filter(p => !!p.drawing === drawings).map((p): Thumb => {
        const src = api.photoImageUrl(p)
        return { key: p.id, src, label: p.caption || (drawings ? 'Drawing' : 'Photo'), source: { src, from: p.id } }
      })
      const fromDevice = local.slice(0, 24).map((d): Thumb => {
        const thumb = URL.createObjectURL(d.thumb), full = URL.createObjectURL(d.png)
        urls.push(thumb, full)
        return { key: d.id, src: thumb, label: d.name || 'Drawing', source: { src: full } }
      })
      setThumbs([...fromDevice, ...fromAlbum].filter(t => t.src))
    })
    return () => { live = false; urls.forEach(u => URL.revokeObjectURL(u)) }
  }, [drawings, settings.features.photos, settings.features.paint])
  if (!thumbs) return <p className="snap-empty">Loading…</p>
  if (!thumbs.length) return <p className="snap-empty">{drawings ? 'No drawings yet. Draw one in Paint!' : 'No family photos yet.'}</p>
  return (
    <ul className="trk-photo-grid picture-album" aria-label={drawings ? 'Drawings' : 'Family photos'}>
      {thumbs.map(t => (
        <li key={t.key}>
          <button type="button" className="photo-tile" onClick={() => onPick(t.source)} aria-label={`Use ${t.label}`}>
            <img src={t.src} alt="" loading="lazy" />
          </button>
        </li>
      ))}
    </ul>
  )
}

function Upload({ onPick }: { onPick: (s: Source) => void }) {
  const camera = useRef<HTMLInputElement>(null)
  const file = useRef<HTMLInputElement>(null)
  const take = (f: File | undefined) => { if (f) onPick({ src: URL.createObjectURL(f), revoke: true }) }
  // A camera input only means something on a phone or tablet; elsewhere it's just another file picker.
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches
  return (
    <div className="picture-upload">
      {touch && <button type="button" className="btn btn-secondary" onClick={() => camera.current?.click()}>📷 Take a photo</button>}
      <button type="button" className="btn btn-secondary" onClick={() => file.current?.click()}>🖼️ Choose a photo</button>
      <input ref={camera} type="file" accept="image/*" capture="user" hidden onChange={e => { take(e.target.files?.[0]); e.target.value = '' }} />
      <input ref={file} type="file" accept="image/*" hidden onChange={e => { take(e.target.files?.[0]); e.target.value = '' }} />
    </div>
  )
}

/** Drag to move, pinch (or the slider, or a mouse wheel) to zoom; the circle is what's kept. */
function CropSheet({ source, member, busy, onBack, onSave, onError }: { source: Source; member: Member; busy: boolean; onBack: () => void; onSave: (b: Blob) => void; onError: (e: unknown) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [v, setV] = useState(0) // the viewport's side, CSS px
  const [crop, setCrop] = useState<Crop>({ x: 0, y: 0, scale: 1 })
  const pointers = useRef(new Map<number, { x: number; y: number }>())

  useEffect(() => {
    let live = true
    const el = new Image()
    el.crossOrigin = 'anonymous' // the demo's photos come from elsewhere; a tainted canvas can't be saved
    el.src = source.src
    el.decode().then(() => {
      if (!live) return
      const side = box.current?.clientWidth ?? 280
      setV(side)
      setImg(el)
      setCrop(startCrop(el.naturalWidth, el.naturalHeight, side))
    }, () => live && onError(new PhotoFormatError()))
    return () => { live = false }
  }, [source.src]) // eslint-disable-line react-hooks/exhaustive-deps

  const size = img ? { w: img.naturalWidth, h: img.naturalHeight } : { w: 1, h: 1 }
  const min = v / Math.min(size.w, size.h)
  const local = (e: { clientX: number; clientY: number }) => { const r = box.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top } }

  const down = (e: ReactPointerEvent) => { e.currentTarget.setPointerCapture(e.pointerId); pointers.current.set(e.pointerId, local(e)) }
  const up = (e: ReactPointerEvent) => { pointers.current.delete(e.pointerId) }
  const move = (e: ReactPointerEvent) => {
    const ps = pointers.current
    const before = ps.get(e.pointerId)
    if (!before || !img) return
    const now = local(e)
    if (ps.size === 1) {
      setCrop(c => clampCrop({ ...c, x: c.x + now.x - before.x, y: c.y + now.y - before.y }, size, v))
    } else {
      const other = [...ps.entries()].find(([id]) => id !== e.pointerId)![1]
      const d0 = Math.hypot(before.x - other.x, before.y - other.y), d1 = Math.hypot(now.x - other.x, now.y - other.y)
      if (d0 > 0) setCrop(c => zoomTo(c, c.scale * (d1 / d0), (now.x + other.x) / 2, (now.y + other.y) / 2, size, v))
    }
    ps.set(e.pointerId, now)
  }
  const wheel = (e: React.WheelEvent) => { const p = local(e); setCrop(c => zoomTo(c, c.scale * Math.exp(-e.deltaY / 500), p.x, p.y, size, v)) }

  const save = () => {
    if (!img) return
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = PICTURE_SIZE
    const ctx = canvas.getContext('2d')!
    ctx.imageSmoothingQuality = 'high'
    const { sx, sy, size: s } = sourceRect(crop, v)
    ctx.drawImage(img, sx, sy, s, s, 0, 0, PICTURE_SIZE, PICTURE_SIZE)
    // Safari < 17 can't encode WebP and quietly hands back a PNG: JPEG then (photos.ts does the same).
    canvas.toBlob(b => {
      if (b?.type === 'image/webp') return onSave(b)
      canvas.toBlob(j => (j ? onSave(j) : onError(new Error('encode'))), 'image/jpeg', 0.88)
    }, 'image/webp', 0.86)
  }

  return (
    <Sheet title={`${member.name}'s picture`} onClose={onBack}
      actions={<><button className="btn btn-secondary" onClick={onBack}>Back</button><button className="btn btn-primary" onClick={save} disabled={busy || !img}>Save</button></>}>
      <div ref={box} className="picture-crop" style={{ ['--m' as string]: member.color }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}
        role="img" aria-label="Drag to move the picture, pinch to zoom. What's inside the circle is kept.">
        {img && <img src={img.src} alt="" draggable={false} style={{ left: crop.x, top: crop.y, width: size.w * crop.scale, height: size.h * crop.scale }} />}
        <span className="picture-crop-ring" aria-hidden="true" />
      </div>
      <div className="field picture-zoom">
        <label htmlFor="picture-zoom">Zoom</label>
        <input id="picture-zoom" type="range" min={1} max={6} step={0.01} value={min ? crop.scale / min : 1} disabled={!img}
          onChange={e => setCrop(c => zoomTo(c, min * Number(e.target.value), v / 2, v / 2, size, v))} />
      </div>
    </Sheet>
  )
}
