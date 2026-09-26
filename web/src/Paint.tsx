// Paint: a kids' drawing app, entirely on this device (no API calls, works on display keys and in
// the demo build). One visible canvas sized to its box × devicePixelRatio (capped at MAX_PX), plus
// an offscreen `base` canvas holding the drawing at the size it was made, so a resize/rotation
// rescales from the original instead of shrinking the picture a little more every turn.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { announce } from './a11y.tsx'
import Sheet from './Sheet.tsx'
import { MEMBER_PALETTE } from './types.ts'
import { colorName, inkFor } from './color.ts'
import { IDLE_RESET_EVENT } from './App.tsx'
import { countDrawings, deleteDrawing, getDrawing, listDrawings, putDrawing, type Drawing, type Meta } from './drawings-db.ts'
import { BrushIcon, BucketIcon, ChevronLeft, DownloadIcon, EditIcon, EraserIcon, HeartIcon, ImagesIcon, PlusIcon, PrinterIcon, RedoIcon, TrashIcon, UndoIcon } from './icons.tsx'
import { preparePhoto } from './photos.ts'
import { api, ApiError } from './api.ts'

const COLORS = [...MEMBER_PALETTE, '#FF6B6B', '#4DA3FF', '#222222', '#FFFFFF', '#8B5A2B', '#8A8A8A']
const SIZES = [3, 6, 10, 16, 24, 36, 52] // CSS px
const SIZE_NAMES = ['Tiny', 'Small', 'Medium', 'Big', 'Bigger', 'Huge', 'Giant']
const MAX_PX = 2048 // longest canvas side: keeps flood fill and PNG encoding quick on an iPad
const MAX_DRAWINGS = 50
const UNDO_DEPTH = 20
const AUTOSAVE_EVERY = 3 // strokes
const PAPER = '#FFFFFF'

type Tool = 'brush' | 'rainbow' | 'eraser' | 'fill'
const TOOLS: { key: Tool; label: string; Icon?: typeof BrushIcon }[] = [
  { key: 'brush', label: 'Brush', Icon: BrushIcon },
  { key: 'rainbow', label: 'Rainbow brush' },
  { key: 'eraser', label: 'Eraser', Icon: EraserIcon },
  { key: 'fill', label: 'Fill bucket', Icon: BucketIcon },
]

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}
const CURRENT_KEY = 'kinwall:paint:current'
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8) // randomUUID needs https; LAN installs may be http
const COUNT_KEY = 'kinwall:paint:n' // numbers "Drawing 3"; bumped when a drawing is first stored, so blank pages don't use one up
function newMeta(): Meta {
  const n = Number(ls.get(COUNT_KEY) ?? 0) + 1
  return { id: newId(), name: `Drawing ${n}`, memberId: null, created: Date.now(), updated: Date.now() }
}

// ---------- Canvas helpers ----------
const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png'))

/** Paper, then `src` scaled to fit and centered. */
function drawContained(c: HTMLCanvasElement, src?: HTMLCanvasElement | ImageBitmap) {
  const ctx = c.getContext('2d')!
  ctx.fillStyle = PAPER
  ctx.fillRect(0, 0, c.width, c.height)
  if (!src?.width) return
  const s = Math.min(c.width / src.width, c.height / src.height)
  const w = src.width * s, h = src.height * s
  ctx.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h)
}

async function makeThumb(png: Blob) {
  const bm = await createImageBitmap(png)
  const c = document.createElement('canvas')
  const s = Math.min(1, 320 / Math.max(bm.width, bm.height))
  c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s)
  c.getContext('2d')!.drawImage(bm, 0, 0, c.width, c.height)
  bm.close()
  return toBlob(c)
}

const packRGBA = (hex: string) => {
  const n = parseInt(hex.slice(1), 16)
  return ((255 << 24) | ((n & 255) << 16) | (n & 0xff00) | (n >> 16)) >>> 0 // little-endian ABGR
}

/** Scanline flood fill in place. `tol`: largest per-channel difference from the start pixel that
 * still counts as the same area (soaks up anti-aliased stroke edges). Returns false if nothing changed. */
function floodFill(img: ImageData, x0: number, y0: number, rgba: number, tol = 64): boolean {
  const { width: w, height: h } = img
  const px = new Uint32Array(img.data.buffer)
  const start = px[y0 * w + x0]
  if (start === rgba) return false
  const sr = start & 255, sg = (start >>> 8) & 255, sb = (start >>> 16) & 255
  const same = (v: number) => Math.abs((v & 255) - sr) <= tol && Math.abs(((v >>> 8) & 255) - sg) <= tol && Math.abs(((v >>> 16) & 255) - sb) <= tol
  const done = new Uint8Array(w * h)
  const stack = [x0, y0]
  while (stack.length) {
    const y = stack.pop()!, x = stack.pop()!
    const row = y * w
    if (done[row + x] || !same(px[row + x])) continue
    let l = x, r = x
    while (l > 0 && !done[row + l - 1] && same(px[row + l - 1])) l--
    while (r < w - 1 && !done[row + r + 1] && same(px[row + r + 1])) r++
    let up = false, down = false // push one seed per run above/below, not one per pixel
    for (let i = l; i <= r; i++) {
      done[row + i] = 1
      px[row + i] = rgba
      if (y > 0) { const ok = !done[row - w + i] && same(px[row - w + i]); if (ok && !up) stack.push(i, y - 1); up = ok }
      if (y < h - 1) { const ok = !done[row + w + i] && same(px[row + w + i]); if (ok && !down) stack.push(i, y + 1); down = ok }
    }
  }
  return true
}

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const fmtDate = (t: number, long = false) => new Date(t).toLocaleDateString(undefined, long ? { year: 'numeric', month: 'long', day: 'numeric' } : { month: 'short', day: 'numeric' })

export default function Paint() {
  const { members, toast, selectedMemberId } = useApp()
  const dialog = useDialog()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [base] = useState(() => { const c = document.createElement('canvas'); c.width = 0; return c })
  const [tool, setTool] = useState<Tool>('brush')
  const [color, setColor] = useState('#4DA3FF')
  const [size, setSize] = useState(2)
  const [meta, setMetaState] = useState<Meta | null>(null)
  const [, setHistTick] = useState(0)
  const [gallery, setGallery] = useState(false)
  const [who, setWho] = useState(false)
  const [printing, setPrinting] = useState<{ url: string; name: string; date: string } | null>(null)

  // Mutable drawing state lives in refs: pointer handlers and the unmount autosave must see the latest.
  const r = useRef({
    meta: null as Meta | null,
    stored: false,     // this drawing already has a record (so it doesn't count against the cap again)
    fullWarned: false,
    dirty: false,
    sinceSave: 0,
    hist: [] as Blob[], idx: -1,
    queue: Promise.resolve() as Promise<unknown>, // snapshot encodes, in order
    ratio: 1,          // canvas px per CSS px
    stroke: null as null | { id: number; last: [number, number]; mid: [number, number]; hue: number },
  }).current
  const setMeta = (m: Meta) => { r.meta = m; setMetaState(m); ls.set(CURRENT_KEY, m.id) }

  /** Canvas → base, then an undo snapshot. toBlob copies the bitmap at call time; only the push waits. */
  const snapshot = (edit = true) => {
    const cv = canvasRef.current!
    base.width = cv.width; base.height = cv.height
    base.getContext('2d')!.drawImage(cv, 0, 0)
    const blob = toBlob(cv)
    r.queue = r.queue.then(() => blob).then(b => {
      r.hist = [...r.hist.slice(0, r.idx + 1), b].slice(-(UNDO_DEPTH + 1))
      r.idx = r.hist.length - 1
      setHistTick(t => t + 1)
    }).catch(() => {})
    if (!edit) return
    r.dirty = true
    if (++r.sinceSave >= AUTOSAVE_EVERY) save()
  }

  /** Show a stored picture (keeping it at its own size in `base`). */
  const show = async (png: Blob) => {
    const bm = await createImageBitmap(png)
    base.width = bm.width; base.height = bm.height
    base.getContext('2d')!.drawImage(bm, 0, 0)
    bm.close()
    if (canvasRef.current) drawContained(canvasRef.current, base)
  }

  const save = async (): Promise<boolean> => {
    const m = r.meta
    if (!m || !r.dirty) return true
    r.dirty = false; r.sinceSave = 0
    try {
      await r.queue
      if (!r.stored && await countDrawings() >= MAX_DRAWINGS) {
        r.dirty = true
        if (!r.fullWarned) toast(`My drawings is full (${MAX_DRAWINGS} pictures). Delete a few to keep this one.`, true)
        r.fullWarned = true
        return false
      }
      const png = r.hist[r.idx]
      const updated = { ...m, updated: Date.now() }
      await putDrawing({ ...updated, png, thumb: await makeThumb(png) })
      if (!r.stored) ls.set(COUNT_KEY, String(Number(ls.get(COUNT_KEY) ?? 0) + 1))
      r.stored = true
      if (r.meta?.id === m.id) r.meta = { ...r.meta, updated: updated.updated }
      return true
    } catch (err) {
      console.warn('Paint: save failed', err)
      r.dirty = true
      toast('Could not save the drawing on this device.', true)
      return false
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  // A new drawing asks who's drawing, unless the family is filtered (or the display pinned) to one
  // person, who then becomes the artist.
  const startNew = () => {
    const m = newMeta()
    if (selectedMemberId) m.memberId = selectedMemberId
    else if (members.length > 0) setWho(true)
    setMeta(m)
    r.stored = false; r.fullWarned = false; r.dirty = false; r.sinceSave = 0
    r.hist = []; r.idx = -1
    base.width = 0
    drawContained(canvasRef.current!)
    snapshot(false)
  }

  const open = async (d: Drawing) => {
    await show(d.png)
    setMeta({ id: d.id, name: d.name, memberId: d.memberId, created: d.created, updated: d.updated })
    r.stored = true; r.fullWarned = false; r.dirty = false; r.sinceSave = 0
    r.hist = [d.png]; r.idx = 0
    setHistTick(t => t + 1)
  }

  // Size the canvas to its box; rescale the drawing from `base` rather than clearing it.
  useEffect(() => {
    const wrap = wrapRef.current!, cv = canvasRef.current!
    const fit = () => {
      const box = wrap.getBoundingClientRect()
      const dpr = window.devicePixelRatio || 1
      const k = Math.min(1, MAX_PX / (Math.max(box.width, box.height) * dpr))
      const w = Math.round(box.width * dpr * k), h = Math.round(box.height * dpr * k)
      if (w < 1 || h < 1) return
      r.ratio = w / box.width
      if (cv.width === w && cv.height === h) return
      cv.width = w; cv.height = h
      drawContained(cv, base)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(wrap)
    // Reopen the last drawing on this device, else start a fresh one.
    const id = ls.get(CURRENT_KEY)
    ;(id ? getDrawing(id) : Promise.resolve(undefined)).catch(() => undefined).then(d => d ? open(d) : startNew())
    return () => ro.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Autosave on leaving (tab change unmounts us), idle reset, and the app going to the background.
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') saveRef.current() }
    const onIdle = () => { saveRef.current(); setGallery(false); setWho(false) }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener(IDLE_RESET_EVENT, onIdle)
    return () => {
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener(IDLE_RESET_EVENT, onIdle)
      saveRef.current()
    }
  }, [])

  const undo = async () => {
    await r.queue
    if (r.idx <= 0) return
    r.idx--; r.dirty = true
    await show(r.hist[r.idx]); setHistTick(t => t + 1); announce('Undone')
  }
  const redo = async () => {
    await r.queue
    if (r.idx >= r.hist.length - 1) return
    r.idx++; r.dirty = true
    await show(r.hist[r.idx]); setHistTick(t => t + 1); announce('Redone')
  }
  const undoRef = useRef({ undo, redo })
  undoRef.current = { undo, redo }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || document.querySelector('.sheet') || (e.target as HTMLElement).matches?.('input, textarea')) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undoRef.current.undo() }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); undoRef.current.redo() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const clear = async () => {
    if (!await dialog.confirm({ title: 'Clear the whole picture?', body: 'You can still undo this.', confirmLabel: 'Clear', danger: true })) return
    drawContained(canvasRef.current!)
    snapshot()
    announce('Picture cleared')
  }

  // ---------- Drawing ----------
  const point = (e: { clientX: number; clientY: number }): [number, number] => {
    const box = canvasRef.current!.getBoundingClientRect()
    return [(e.clientX - box.left) * r.ratio, (e.clientY - box.top) * r.ratio]
  }
  const ink = (hue: number) => tool === 'eraser' ? PAPER : tool === 'rainbow' ? `hsl(${hue} 90% 55%)` : color

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || r.stroke) return // one pointer at a time: a resting palm won't scribble
    const cv = e.currentTarget
    const p = point(e)
    if (tool === 'fill') {
      const ctx = cv.getContext('2d')!
      const [x, y] = p.map(Math.floor)
      if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return
      const img = ctx.getImageData(0, 0, cv.width, cv.height)
      if (floodFill(img, x, y, packRGBA(color))) { ctx.putImageData(img, 0, 0); snapshot() }
      return
    }
    try { cv.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    const hue = Math.random() * 360
    r.stroke = { id: e.pointerId, last: p, mid: p, hue }
    const ctx = cv.getContext('2d')!
    ctx.fillStyle = ink(hue)
    ctx.beginPath(); ctx.arc(p[0], p[1], SIZES[size] * r.ratio / 2, 0, Math.PI * 2); ctx.fill() // a tap makes a dot
  }
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = r.stroke
    if (!s || s.id !== e.pointerId) return
    const ctx = e.currentTarget.getContext('2d')!
    ctx.lineWidth = SIZES[size] * r.ratio
    ctx.lineCap = ctx.lineJoin = 'round'
    // Coalesced events: an Apple Pencil reports ~240 Hz, far more than one per frame.
    const coalesced = e.nativeEvent.getCoalescedEvents?.()
    for (const ev of coalesced?.length ? coalesced : [e.nativeEvent]) {
      const p = point(ev)
      const mid: [number, number] = [(s.last[0] + p[0]) / 2, (s.last[1] + p[1]) / 2]
      // Smooth: a quadratic from the previous midpoint, through the last point, to the new midpoint.
      ctx.strokeStyle = ink(s.hue)
      ctx.beginPath(); ctx.moveTo(s.mid[0], s.mid[1]); ctx.quadraticCurveTo(s.last[0], s.last[1], mid[0], mid[1]); ctx.stroke()
      s.hue = (s.hue + Math.hypot(p[0] - s.last[0], p[1] - s.last[1]) / r.ratio / 3) % 360
      s.last = p; s.mid = mid
    }
  }
  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = r.stroke
    if (!s || s.id !== e.pointerId) return
    const ctx = e.currentTarget.getContext('2d')!
    ctx.strokeStyle = ink(s.hue)
    ctx.beginPath(); ctx.moveTo(s.mid[0], s.mid[1]); ctx.lineTo(s.last[0], s.last[1]); ctx.stroke()
    r.stroke = null
    snapshot()
  }

  // ---------- Save / share / print ----------
  const current = async () => { await r.queue; return r.hist[r.idx] }
  const exportPng = async () => {
    const png = await current()
    if (!png || !r.meta) return
    const file = new File([png], `${r.meta.name}.png`, { type: 'image/png' })
    const url = URL.createObjectURL(png)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    if (!isIOS()) {
      const a = document.createElement('a')
      a.href = url; a.download = file.name; a.click()
      toast('Picture downloaded'); return
    }
    // iOS: a download lands in Files, not Photos. The share sheet has "Save Image".
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: r.meta.name }); announce('Shared'); return }
      catch (err) { if ((err as Error).name === 'AbortError') return }
    }
    window.open(url, '_blank')
    toast('Press and hold the picture, then choose Save to Photos.', true)
  }
  // The family photo library lives on the server, so this is how a drawing leaves this device:
  // same downscale/WebP path as an upload, captioned with the picture's name and artist.
  const [savingPhoto, setSavingPhoto] = useState(false)
  const saveToPhotos = async () => {
    if (!r.meta || savingPhoto) return
    setSavingPhoto(true)
    try {
      const png = await current()
      const { blob, width, height } = await preparePhoto(new File([png], `${r.meta.name}.png`, { type: 'image/png' }))
      const by = members.find(x => x.id === r.meta?.memberId)
      await api.uploadPhoto(blob, width, height, by ? `${r.meta.name} by ${by.name}` : r.meta.name)
      toast('Saved to family photos'); announce('Saved to family photos')
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Could not save to family photos', true)
    } finally { setSavingPhoto(false) }
  }
  const print = async () => {
    const png = await current()
    if (!png || !r.meta) return
    setPrinting({ url: URL.createObjectURL(png), name: r.meta.name, date: fmtDate(Date.now(), true) })
  }
  useEffect(() => {
    if (!printing) return
    const done = () => setPrinting(null)
    window.addEventListener('afterprint', done)
    return () => { window.removeEventListener('afterprint', done); URL.revokeObjectURL(printing.url) }
  }, [printing])

  const rename = async () => {
    if (!r.meta) return
    const name = await dialog.prompt({ title: 'Name this drawing', label: 'Name', defaultValue: r.meta.name, confirmLabel: 'Save' })
    if (!name) return
    setMeta({ ...r.meta, name })
    if (r.stored) { r.dirty = true; save() }
  }
  const setMember = (memberId: string | null) => {
    if (!r.meta) return
    setMeta({ ...r.meta, memberId })
    if (r.stored) { r.dirty = true; save() }
    setWho(false)
  }

  const member = members.find(m => m.id === meta?.memberId)
  const canUndo = r.idx > 0, canRedo = r.idx < r.hist.length - 1
  const pickColor = (c: string) => { setColor(c); if (tool !== 'fill') setTool('brush') }

  return (
    <div className="paint">
      <div className="paint-toolbar" role="toolbar" aria-label="Paint tools">
        <div className="paint-group">
          <a className="paint-btn" href="#/activities" aria-label="Back to activities"><ChevronLeft /></a>
          {TOOLS.map(t => (
            <button key={t.key} className={`paint-btn ${tool === t.key ? 'active' : ''}`} aria-pressed={tool === t.key} aria-label={t.label} title={t.label}
              onClick={() => { setTool(t.key); announce(t.label) }}>
              {t.Icon ? <t.Icon /> : <span className="paint-rainbow-dot" aria-hidden="true" />}
            </button>
          ))}
        </div>
        <div className="paint-group" role="group" aria-label="Brush size">
          {SIZES.map((s, i) => (
            <button key={s} className={`paint-btn ${size === i ? 'active' : ''}`} aria-pressed={size === i} aria-label={`${SIZE_NAMES[i]} brush`} title={SIZE_NAMES[i]} onClick={() => setSize(i)}>
              <span className="paint-size-dot" style={{ width: Math.min(s, 34), height: Math.min(s, 34), background: tool === 'eraser' || tool === 'rainbow' ? 'var(--text)' : color }} aria-hidden="true" />
            </button>
          ))}
        </div>
        <div className="paint-group">
          <button className="paint-btn" aria-label="Undo" title="Undo" disabled={!canUndo} onClick={undo}><UndoIcon /></button>
          <button className="paint-btn" aria-label="Redo" title="Redo" disabled={!canRedo} onClick={redo}><RedoIcon /></button>
          <button className="paint-btn" aria-label="Clear picture" title="Clear" onClick={clear}><TrashIcon /></button>
          <button className="paint-btn" aria-label="My drawings" title="My drawings" onClick={async () => { await save(); setGallery(true) }}><ImagesIcon /></button>
          <button className="paint-btn" aria-label="Save picture" title="Save" onClick={exportPng}><DownloadIcon /></button>
          <button className="paint-btn" aria-label="Save to family photos" title="Save to family photos" disabled={savingPhoto} onClick={saveToPhotos}><HeartIcon /></button>
          <button className="paint-btn" aria-label="Print picture" title="Print" onClick={print}><PrinterIcon /></button>
          {members.length > 0 && (
            <button className="paint-btn paint-who" aria-label={member ? `Drawing by ${member.name} (change)` : "Who's drawing?"} title="Who's drawing?" onClick={() => setWho(true)}
              style={member ? { background: member.color, color: inkFor(member.color) } : undefined}>
              {member ? (member.avatar || member.name[0]) : <span aria-hidden="true">🙂</span>}
            </button>
          )}
          <button className="paint-name" onClick={rename} aria-label={`Rename ${meta?.name ?? 'drawing'}`}>
            <span>{meta?.name}</span><EditIcon width={18} height={18} />
          </button>
        </div>
        <div className="paint-group paint-colors color-swatch-row" role="group" aria-label="Colors">
          {COLORS.map(c => (
            <button key={c} className={`color-swatch ${color === c && tool !== 'eraser' && tool !== 'rainbow' ? 'active' : ''}`} style={{ backgroundColor: c }}
              aria-pressed={color === c && tool !== 'eraser' && tool !== 'rainbow'} aria-label={colorName(c)} title={colorName(c)} onClick={() => pickColor(c)} />
          ))}
        </div>
      </div>
      <div className="paint-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className={`paint-canvas paint-tool-${tool}`} role="img" aria-label={`Drawing canvas: ${meta?.name ?? ''}`}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      </div>

      {gallery && <Gallery currentId={meta?.id} onClose={() => setGallery(false)}
        onOpen={async d => { await save(); await open(d); setGallery(false); announce(`Opened ${d.name}`) }}
        onNew={async () => { await save(); startNew(); setGallery(false); announce('New drawing') }}
        onDeleted={id => { if (id === r.meta?.id) startNew() }} />}

      {who && (
        <Sheet title="Who's drawing?" onClose={() => setWho(false)}>
          <div className="who-grid">
            {members.map(m => (
              <button key={m.id} className={`who-btn ${meta?.memberId === m.id ? 'active' : ''}`} aria-pressed={meta?.memberId === m.id} onClick={() => setMember(m.id)}>
                <span className="who-avatar" aria-hidden="true" style={{ background: m.color, color: inkFor(m.color) }}>{m.avatar || m.name[0]}</span>
                {m.name}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 12 }} onClick={() => setMember(null)}>Skip</button>
        </Sheet>
      )}

      {printing && createPortal(
        <div className="paint-print">
          <img src={printing.url} alt="" onLoad={() => window.print()} />
          <p>{printing.name} · {printing.date}</p>
        </div>, document.body)}
    </div>
  )
}

function Gallery({ currentId, onClose, onOpen, onNew, onDeleted }: {
  currentId?: string; onClose: () => void; onOpen: (d: Drawing) => void; onNew: () => void; onDeleted: (id: string) => void
}) {
  const { members, toast } = useApp()
  const dialog = useDialog()
  const [items, setItems] = useState<(Drawing & { thumbUrl: string })[] | null>(null)
  const [tick, setTick] = useState(0)
  useEffect(() => {
    let urls: string[] = []
    listDrawings().then(all => {
      const withUrls = all.map(d => ({ ...d, thumbUrl: URL.createObjectURL(d.thumb) }))
      urls = withUrls.map(d => d.thumbUrl)
      setItems(withUrls)
    }).catch(() => setItems([]))
    return () => urls.forEach(u => URL.revokeObjectURL(u))
  }, [tick])

  const duplicate = async (d: Drawing) => {
    if ((items?.length ?? 0) >= MAX_DRAWINGS) { toast(`My drawings is full (${MAX_DRAWINGS} pictures). Delete a few first.`, true); return }
    await putDrawing({ ...d, id: newId(), name: `${d.name} (copy)`, created: Date.now(), updated: Date.now() })
    announce(`Copied ${d.name}`); setTick(t => t + 1)
  }
  const remove = async (d: Drawing) => {
    if (!await dialog.confirm({ title: `Delete "${d.name}"?`, body: 'This picture will be gone from this device.', confirmLabel: 'Delete', danger: true })) return
    await deleteDrawing(d.id)
    onDeleted(d.id)
    announce(`Deleted ${d.name}`); setTick(t => t + 1)
  }

  return (
    <Sheet title="My drawings" onClose={onClose}>
      <p className="paint-gallery-note">Saved on this device only{items ? ` · ${items.length} of ${MAX_DRAWINGS}` : ''}.</p>
      <button className="btn btn-primary btn-block" onClick={onNew}><PlusIcon width={20} height={20} /> New drawing</button>
      {items?.length === 0 && <div className="empty-card"><span className="emoji" aria-hidden="true">🎨</span>No drawings yet</div>}
      <ul className="paint-gallery">
        {items?.map(d => {
          const m = members.find(x => x.id === d.memberId)
          return (
            <li key={d.id} className={`paint-gallery-item ${d.id === currentId ? 'current' : ''}`}>
              <button className="paint-gallery-open" onClick={() => onOpen(d)} aria-label={`Open ${d.name}${m ? ` by ${m.name}` : ''}, ${fmtDate(d.updated)}`}>
                <img src={d.thumbUrl} alt="" />
                <span className="paint-gallery-name">{d.name}</span>
                <span className="paint-gallery-sub">{m ? `${m.avatar || ''} ${m.name} · ` : ''}{fmtDate(d.updated)}</span>
              </button>
              <div className="paint-gallery-actions">
                <button className="btn btn-secondary" onClick={() => duplicate(d)} aria-label={`Duplicate ${d.name}`}>Copy</button>
                <button className="icon-btn" onClick={() => remove(d)} aria-label={`Delete ${d.name}`}><TrashIcon width={20} height={20} /></button>
              </div>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
