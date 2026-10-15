// Paint: a kids' drawing app, kept on this device (works on display keys and in the demo build; the
// only API calls are the family's coloring pages and "Save to family photos"). One visible canvas
// sized to its box × devicePixelRatio (capped at MAX_PX), plus an offscreen `base` canvas holding the
// drawing at the size it was made, so a resize/rotation rescales from the original instead of
// shrinking the picture a little more every turn. Above it: a `wet` canvas showing a Highlighter
// stroke until it's finished, and a coloring page's lines on their own locked layer (`linesBase`
// keeps them at their own size, like `base`). Brushes, Fill and line art are in paintTools.ts.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { createPortal } from 'react-dom'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { announce } from './a11y.tsx'
import Sheet from './Sheet.tsx'
import { inkFor } from './color.ts'
import { Face, FacePic } from './Face.tsx'
import { CustomColorSwatch } from './ColorSwatch.tsx'
import { IDLE_RESET_EVENT } from './App.tsx'
import { countDrawings, deleteDrawing, getDrawing, listDrawings, putDrawing, type Drawing, type Meta } from './drawings-db.ts'
import { BookIcon, BucketIcon, ChevronLeft, DownloadIcon, EditIcon, EraserIcon, HeartIcon, ImagesIcon, MoreIcon, PlusIcon, PrinterIcon, RedoIcon, TrashIcon, UndoIcon } from './icons.tsx'
import { preparePhoto } from './photos.ts'
import { api, ApiError } from './api.ts'
import { beginStroke, endStroke, floodFill, packRGBA, PAPER, parseSizes, SIZE_NAMES, SIZES, sizeFor, STAMPS, strokeTo, drawStroke, type Brush, type Stroke } from './paintTools.ts'
import ColoringBook from './ColoringBook.tsx'
import { intlLocale, msg, t, tm } from './i18n.ts'

// The Colors sheet, one row each: bright, pastel (the member palette), dark, skin tones and browns,
// grays and extras. Names are what screen readers say.
const PALETTE: [hex: string, name: string][][] = [
  [['#FF3B30', msg('Red')], ['#FF9500', msg('Orange')], ['#FFCC00', msg('Yellow')], ['#34C759', msg('Green')], ['#2FBFB0', msg('Teal')], ['#4DA3FF', msg('Blue')], ['#8E5CF7', msg('Purple')], ['#FF5FA2', msg('Hot pink')]],
  [['#FF9E7A', msg('Peach')], ['#FFD166', msg('Amber')], ['#C7E27A', msg('Lime')], ['#7ED9A6', msg('Mint')], ['#8FE0D6', msg('Aqua')], ['#7AB8FF', msg('Sky blue')], ['#B39DFF', msg('Lavender')], ['#FF8FA3', msg('Pink')]],
  [['#B3261E', msg('Dark red')], ['#C2570C', msg('Rust')], ['#B8860B', msg('Mustard')], ['#1E7B3A', msg('Forest green')], ['#0F766E', msg('Dark teal')], ['#1D4ED8', msg('Royal blue')], ['#5B21B6', msg('Deep purple')], ['#9D174D', msg('Berry')]],
  [['#FDDBB4', msg('Light skin')], ['#E8B98A', msg('Tan')], ['#C68A5A', msg('Caramel')], ['#8D5A3B', msg('Brown skin')], ['#5C3A21', msg('Dark brown')], ['#8B5A2B', msg('Brown')], ['#FFB6D9', msg('Rose')], ['#A0AEC0', msg('Slate')]],
  [['#FFFFFF', msg('White')], ['#D9D9D9', msg('Light gray')], ['#8A8A8A', msg('Gray')], ['#4A4A4A', msg('Dark gray')], ['#222222', msg('Black')], ['#FF6B6B', msg('Coral red')], ['#F5B301', msg('Gold')], ['#1E3A5F', msg('Navy')]],
]
const PRESETS = PALETTE.flat().map(([hex]) => hex)
const nameOf = (hex: string) => tm(PALETTE.flat().find(([h]) => h.toLowerCase() === hex.toLowerCase())?.[1] ?? msg('Your color'))
const RECENT_KEY = 'kinwall.paint.recentColors' // this device's last few "any color" picks
const loadRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') } catch { return [] } }
const MAX_PX = 2048 // longest canvas side: keeps flood fill and PNG encoding quick on an iPad
const MAX_DRAWINGS = 50
const UNDO_DEPTH = 20
const AUTOSAVE_EVERY = 3 // strokes

type Tool = Brush | 'fill'
// The Brushes sheet. Eraser and Fill have their own toolbar buttons.
const BRUSHES: { key: Brush; name: string; emoji: string }[] = [
  { key: 'pencil', name: msg('Pencil'), emoji: '✏️' },
  { key: 'marker', name: msg('Marker'), emoji: '🖊️' },
  { key: 'crayon', name: msg('Crayon'), emoji: '🖍️' },
  { key: 'soft', name: msg('Highlighter'), emoji: '🖌️' },
  { key: 'spray', name: msg('Spray'), emoji: '💨' },
  { key: 'rainbow', name: msg('Rainbow'), emoji: '🌈' },
  { key: 'stamp', name: msg('Stamps'), emoji: '⭐' },
]
const toolName = (tool: Tool, stamp: string) => tool === 'fill' ? t('Fill bucket') : tool === 'eraser' ? t('Eraser')
  : tool === 'stamp' ? t('{name} stamp', { name: tm(STAMPS.find(([s]) => s === stamp)?.[1] ?? msg('Star')) }) : tm(BRUSHES.find(b => b.key === tool)!.name)
/** A stylus's pressure; a finger or mouse has none worth using (they report a flat 0.5 or 0/1). */
const pressureOf = (e: PointerEvent) => e.pointerType === 'pen' && e.pressure > 0 ? e.pressure : undefined
/** One undo step: the paint, and the coloring page's lines at the same size (or none). */
type Step = { paint: Blob; lines: Blob | null }
const ownColor = (tool: Tool) => tool !== 'eraser' && tool !== 'rainbow' // tools that use the chosen color

const ls = {
  get: (k: string) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v) } catch { /* private mode */ } },
}
const CURRENT_KEY = 'kinwall:paint:current'
const SIZES_KEY = 'kinwall:paint:sizes' // each brush's last size on this device
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8) // randomUUID needs https; LAN installs may be http
const COUNT_KEY = 'kinwall:paint:n' // numbers "Drawing 3"; bumped when a drawing is first stored, so blank pages don't use one up
function newMeta(): Meta {
  const n = Number(ls.get(COUNT_KEY) ?? 0) + 1
  return { id: newId(), name: t('Drawing {n}', { n }), memberId: null, created: Date.now(), updated: Date.now() }
}

// ---------- Canvas helpers ----------
const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => c.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), 'image/png'))

/** Paper (or nothing, for the lines layer), then `src` scaled to fit and centered. */
function drawContained(c: HTMLCanvasElement, src?: HTMLCanvasElement | ImageBitmap | HTMLImageElement, paper = true) {
  const ctx = c.getContext('2d')!
  ctx.clearRect(0, 0, c.width, c.height)
  if (paper) { ctx.fillStyle = PAPER; ctx.fillRect(0, 0, c.width, c.height) }
  if (!src?.width) return
  const s = Math.min(c.width / src.width, c.height / src.height)
  const w = src.width * s, h = src.height * s
  ctx.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h)
}

// createImageBitmap needs Safari 15+; older Safari decodes through an <img> instead.
async function loadImage(png: Blob): Promise<(ImageBitmap | HTMLImageElement) & { close?: () => void }> {
  if ('createImageBitmap' in window) return createImageBitmap(png)
  const img = new Image()
  img.src = URL.createObjectURL(png)
  try { await img.decode() } finally { URL.revokeObjectURL(img.src) }
  return img
}

async function makeThumb(png: Blob) {
  const bm = await loadImage(png)
  const c = document.createElement('canvas')
  const s = Math.min(1, 320 / Math.max(bm.width, bm.height))
  c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s)
  c.getContext('2d')!.drawImage(bm, 0, 0, c.width, c.height)
  bm.close?.()
  return toBlob(c)
}

const isIOS = () => /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const fmtDate = (ms: number, long = false) => new Date(ms).toLocaleDateString(intlLocale(), long ? { year: 'numeric', month: 'long', day: 'numeric' } : { month: 'short', day: 'numeric' })

export default function Paint() {
  const { members, toast, selectedMemberId } = useApp()
  const dialog = useDialog()
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [base] = useState(() => { const c = document.createElement('canvas'); c.width = 0; return c })
  const wetRef = useRef<HTMLCanvasElement>(null)
  const linesRef = useRef<HTMLCanvasElement>(null)
  const [linesBase] = useState(() => { const c = document.createElement('canvas'); c.width = 0; return c })
  const [tool, setTool] = useState<Tool>('marker')
  const [stamp, setStamp] = useState(STAMPS[0][0])
  const [brushes, setBrushes] = useState(false)
  const [book, setBook] = useState(false)
  const [color, setColor] = useState('#4DA3FF')
  const [sizes, setSizes] = useState(() => parseSizes(ls.get(SIZES_KEY)))
  const [sizing, setSizing] = useState(false)
  const [meta, setMetaState] = useState<Meta | null>(null)
  const [, setHistTick] = useState(0)
  const [gallery, setGallery] = useState(false)
  const [who, setWho] = useState(false)
  const [colors, setColors] = useState(false)
  const [more, setMore] = useState(false)
  const [recent, setRecent] = useState(loadRecent)
  const [printing, setPrinting] = useState<{ url: string; name: string; date: string } | null>(null)

  // Mutable drawing state lives in refs: pointer handlers and the unmount autosave must see the latest.
  const r = useRef({
    meta: null as Meta | null,
    stored: false,     // this drawing already has a record (so it doesn't count against the cap again)
    fullWarned: false,
    dirty: false,
    sinceSave: 0,
    hist: [] as Step[], idx: -1, // undo steps
    queue: Promise.resolve() as Promise<unknown>, // snapshot encodes, in order
    ratio: 1,          // canvas px per CSS px
    stroke: null as null | { id: number; s: Stroke },
    lastBrush: 'marker' as Brush, // what picking a color goes back to from the eraser or rainbow
    lines: null as Blob | null,   // this drawing's coloring page (linesBase as a PNG, the same size as the paint), or none
    wall: null as Uint8Array | null, // the lines' alpha per canvas pixel, for Fill (rebuilt after a resize)
  }).current
  const setMeta = (m: Meta) => { r.meta = m; setMetaState(m); ls.set(CURRENT_KEY, m.id) }

  /** Canvas → base, then an undo snapshot. toBlob copies the bitmap at call time; only the push waits.
   * A coloring page's lines follow the paint to a new canvas size (after a rotation), so each step's
   * paint and lines are always the same size and line up wherever the drawing is opened next. */
  const snapshot = (edit = true) => {
    const cv = canvasRef.current!
    base.width = cv.width; base.height = cv.height
    base.getContext('2d')!.drawImage(cv, 0, 0)
    let lines: Blob | null | Promise<Blob> = r.lines
    if (r.lines && (linesBase.width !== cv.width || linesBase.height !== cv.height)) {
      linesBase.width = cv.width; linesBase.height = cv.height
      linesBase.getContext('2d')!.drawImage(linesRef.current!, 0, 0)
      lines = toBlob(linesBase)
    }
    const blob = toBlob(cv)
    r.queue = r.queue.then(() => Promise.all([blob, lines])).then(([paint, l]) => {
      r.lines = l
      r.hist = [...r.hist.slice(0, r.idx + 1), { paint, lines: l }].slice(-(UNDO_DEPTH + 1))
      r.idx = r.hist.length - 1
      setHistTick(n => n + 1)
    }).catch(() => {})
    if (!edit) return
    r.dirty = true
    if (++r.sinceSave >= AUTOSAVE_EVERY) save()
  }

  /** Show a stored picture (keeping it at its own size in `base`). */
  const show = async (png: Blob) => {
    const bm = await loadImage(png)
    base.width = bm.width; base.height = bm.height
    base.getContext('2d')!.drawImage(bm, 0, 0)
    bm.close?.()
    if (canvasRef.current) drawContained(canvasRef.current, base)
  }

  /** The coloring page's lines over the paint, or none (`linesBase` holds them at their own size). */
  const showLines = async (lines: Blob | null) => {
    r.lines = lines; r.wall = null
    linesBase.width = 0
    if (lines) {
      const bm = await loadImage(lines)
      linesBase.width = bm.width; linesBase.height = bm.height
      linesBase.getContext('2d')!.drawImage(bm, 0, 0)
      bm.close?.()
    }
    if (linesRef.current) drawContained(linesRef.current, linesBase, false)
  }

  /** A new page's line art (any size), fitted onto the canvas with a little margin. */
  const setPage = async (img: CanvasImageSource & { width: number; height: number }) => {
    const cv = canvasRef.current!
    linesBase.width = cv.width; linesBase.height = cv.height
    const m = Math.min(cv.width, cv.height) * 0.04
    const k = Math.min((cv.width - 2 * m) / img.width, (cv.height - 2 * m) / img.height)
    const w = img.width * k, h = img.height * k
    linesBase.getContext('2d')!.drawImage(img, (cv.width - w) / 2, (cv.height - h) / 2, w, h)
    await showLines(await toBlob(linesBase))
  }

  /** The whole picture: the paint, with the page's lines on top when there are any. */
  const flatten = async ({ paint, lines }: Step) => {
    if (!lines) return paint
    const c = document.createElement('canvas')
    const ctx = c.getContext('2d')!
    for (const blob of [paint, lines]) {
      const bm = await loadImage(blob)
      if (blob === paint) { c.width = bm.width; c.height = bm.height }
      ctx.drawImage(bm, 0, 0, c.width, c.height)
      bm.close?.()
    }
    return toBlob(c)
  }

  const save = async (): Promise<boolean> => {
    const m = r.meta
    if (!m || !r.dirty) return true
    r.dirty = false; r.sinceSave = 0
    try {
      await r.queue
      if (!r.stored && await countDrawings() >= MAX_DRAWINGS) {
        r.dirty = true
        if (!r.fullWarned) toast(t('My drawings is full ({n} pictures). Delete a few to keep this one.', { n: MAX_DRAWINGS }), true)
        r.fullWarned = true
        return false
      }
      const step = r.hist[r.idx]
      const png = await flatten(step)
      const updated = { ...m, updated: Date.now() }
      await putDrawing({ ...updated, png, thumb: await makeThumb(png), ...(step.lines ? { paint: step.paint, lines: step.lines } : {}) })
      if (!r.stored) ls.set(COUNT_KEY, String(Number(ls.get(COUNT_KEY) ?? 0) + 1))
      r.stored = true
      if (r.meta?.id === m.id) r.meta = { ...r.meta, updated: updated.updated }
      return true
    } catch (err) {
      console.warn('Paint: save failed', err)
      r.dirty = true
      toast(t('Could not save the drawing on this device.'), true)
      return false
    }
  }
  const saveRef = useRef(save)
  saveRef.current = save

  // A new drawing asks who's drawing, unless the family is filtered (or the display pinned) to one
  // person, who then becomes the artist.
  const startNew = (name?: string) => {
    const m = newMeta()
    if (name) m.name = name
    if (selectedMemberId) m.memberId = selectedMemberId
    else if (members.length > 0) setWho(true)
    setMeta(m)
    r.stored = false; r.fullWarned = false; r.dirty = false; r.sinceSave = 0
    r.hist = []; r.idx = -1
    base.width = 0
    drawContained(canvasRef.current!)
    void showLines(null)
    snapshot(false)
  }

  const open = async (d: Drawing) => {
    await show(d.paint ?? d.png)
    await showLines(d.lines ?? null)
    setMeta({ id: d.id, name: d.name, memberId: d.memberId, created: d.created, updated: d.updated })
    r.stored = true; r.fullWarned = false; r.dirty = false; r.sinceSave = 0
    r.hist = [{ paint: d.paint ?? d.png, lines: d.lines ?? null }]; r.idx = 0
    setHistTick(n => n + 1)
  }

  // Full screen like an added activity: Kinwall's header, tabs and rail hide (styles.css,
  // data-activity-open); the toolbar's back button leaves.
  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-activity-open', '')
    return () => root.removeAttribute('data-activity-open')
  }, [])

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
      for (const layer of [wetRef.current!, linesRef.current!]) { layer.width = w; layer.height = h }
      drawContained(linesRef.current!, linesBase, false)
      r.wall = null
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

  const showStep = async (st: Step) => { await show(st.paint); if (st.lines !== r.lines) await showLines(st.lines) }
  const undo = async () => {
    await r.queue
    if (r.idx <= 0) return
    r.idx--; r.dirty = true
    await showStep(r.hist[r.idx]); setHistTick(n => n + 1); announce(t('Undone'))
  }
  const redo = async () => {
    await r.queue
    if (r.idx >= r.hist.length - 1) return
    r.idx++; r.dirty = true
    await showStep(r.hist[r.idx]); setHistTick(n => n + 1); announce(t('Redone'))
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
    if (!await dialog.confirm({ title: t('Clear the whole picture?'), body: t('You can still undo this.'), confirmLabel: t('Clear'), danger: true })) return
    drawContained(canvasRef.current!)
    snapshot()
    announce(t('Picture cleared'))
  }

  // ---------- Drawing ----------
  const point = (e: { clientX: number; clientY: number }): [number, number] => {
    const box = canvasRef.current!.getBoundingClientRect()
    return [(e.clientX - box.left) * r.ratio, (e.clientY - box.top) * r.ratio]
  }

  /** Fill, held in by the coloring page's lines (their own layer) when there is one. */
  const fill = (cv: HTMLCanvasElement, [x, y]: number[]) => {
    if (x < 0 || y < 0 || x >= cv.width || y >= cv.height) return
    const ctx = cv.getContext('2d')!
    if (r.lines && !r.wall) {
      const a = linesRef.current!.getContext('2d')!.getImageData(0, 0, cv.width, cv.height).data
      r.wall = new Uint8Array(cv.width * cv.height)
      for (let i = 0; i < r.wall.length; i++) r.wall[i] = a[i * 4 + 3]
    }
    const img = ctx.getImageData(0, 0, cv.width, cv.height)
    if (floodFill(img, x, y, packRGBA(color), 64, r.lines ? r.wall! : undefined)) { ctx.putImageData(img, 0, 0); snapshot() }
  }
  const wet = () => wetRef.current!.getContext('2d')!

  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if ((e.pointerType === 'mouse' && e.button !== 0) || r.stroke) return // one pointer at a time: a resting palm won't scribble
    const cv = e.currentTarget
    const p = point(e)
    if (tool === 'fill') { fill(cv, p.map(Math.floor)); return }
    try { cv.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
    r.stroke = { id: e.pointerId, s: beginStroke(cv.getContext('2d')!, wet(), { brush: tool, color, width: SIZES[sizeFor(sizes, tool)] * r.ratio, ratio: r.ratio, stamp }, p, pressureOf(e.nativeEvent)) }
  }
  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const st = r.stroke
    if (!st || st.id !== e.pointerId) return
    const ctx = e.currentTarget.getContext('2d')!
    // Coalesced events: an Apple Pencil reports ~240 Hz, far more than one per frame.
    const coalesced = e.nativeEvent.getCoalescedEvents?.()
    for (const ev of coalesced?.length ? coalesced : [e.nativeEvent]) strokeTo(ctx, wet(), st.s, point(ev), pressureOf(ev))
  }
  const onUp = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const st = r.stroke
    if (!st || st.id !== e.pointerId) return
    endStroke(e.currentTarget.getContext('2d')!, wet(), st.s)
    r.stroke = null
    snapshot()
  }

  // ---------- Save / share / print ----------
  const current = async () => { await r.queue; return r.hist[r.idx] && flatten(r.hist[r.idx]) }
  const exportPng = async () => {
    const png = await current()
    if (!png || !r.meta) return
    const file = new File([png], `${r.meta.name}.png`, { type: 'image/png' })
    const url = URL.createObjectURL(png)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
    if (!isIOS()) {
      const a = document.createElement('a')
      a.href = url; a.download = file.name; a.click()
      toast(t('Picture downloaded')); return
    }
    // iOS: a download lands in Files, not Photos. The share sheet has "Save Image".
    if (navigator.canShare?.({ files: [file] })) {
      try { await navigator.share({ files: [file], title: r.meta.name }); announce(t('Shared')); return }
      catch (err) { if ((err as Error).name === 'AbortError') return }
    }
    window.open(url, '_blank')
    toast(t('Press and hold the picture, then choose Save to Photos.'), true)
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
      await api.uploadPhoto(blob, width, height, by ? t('{name} by {artist}', { name: r.meta.name, artist: by.name }) : r.meta.name, true, { drawing: true, by: by?.id })
      toast(t('Saved to family photos')); announce(t('Saved to family photos'))
    } catch (e) {
      toast(e instanceof ApiError ? e.message : t('Could not save to family photos'), true)
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
    const name = await dialog.prompt({ title: t('Name this drawing'), label: t('Name'), defaultValue: r.meta.name, confirmLabel: t('Save') })
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
  const pickColor = (c: string) => { setColor(c); if (!ownColor(tool)) setTool(r.lastBrush); setColors(false); announce(nameOf(c)) }
  const pickCustom = (c: string) => {
    setColor(c); if (!ownColor(tool)) setTool(r.lastBrush)
    const next = [c, ...recent.filter(x => x !== c)].slice(0, 7)
    setRecent(next)
    try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)) } catch { /* private mode: just not remembered */ }
  }
  const painting = ownColor(tool)
  const pickTool = (next: Tool, s = stamp) => {
    setTool(next); setStamp(s); setBrushes(false); announce(toolName(next, s))
    if (next !== 'fill' && ownColor(next)) r.lastBrush = next
  }
  const brush = BRUSHES.find(b => b.key === tool)
  // Sizes belong to a brush (the eraser too); Fill has none, so the size button shows the last brush's.
  const sized: Brush = tool === 'fill' ? r.lastBrush : tool
  const size = sizeFor(sizes, sized)
  const pickSize = (i: number) => {
    const next = { ...sizes, [sized]: i }
    setSizes(next); ls.set(SIZES_KEY, JSON.stringify(next))
    setSizing(false); announce(t('{size} {tool}', { size: tm(SIZE_NAMES[i]), tool: toolName(sized, stamp).toLowerCase() }))
  }
  // How wide each brush really draws at a size (the highlighter, spray and stamps go wider than the
  // marker), so the dots match the picture; capped so the biggest still fit the sheet.
  const drawn = (px: number) => Math.min(140, sized === 'soft' ? px * 2.5 : sized === 'spray' ? px * 2.4 : sized === 'stamp' ? Math.max(px * 2.5, 28) : px)
  const dotColor = sized === 'eraser' ? PAPER : sized === 'rainbow' ? 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' : color
  const pickPage = async (name: string, img: CanvasImageSource & { width: number; height: number }) => {
    await save()
    startNew(name)
    await setPage(img)
    r.hist = []; r.idx = -1
    snapshot(false) // the first step has the page, so undo never takes it away
    setBook(false)
    if (tool === 'eraser') setTool('fill')
    announce(t('Coloring page: {name}', { name }))
  }

  return (
    <div className="paint">
      <div className="paint-toolbar" role="toolbar" aria-label={t('Paint tools')}>
        <div className="paint-group">
          <a className="paint-btn" href="#/activities" aria-label={t('Back to activities')}><ChevronLeft /></a>
          <button className={`paint-btn ${brush ? 'active' : ''}`} aria-haspopup="dialog" aria-label={t('Brushes: {name}', { name: brush ? toolName(tool, stamp) : t('pick one') })} title={t('Brushes')}
            onClick={() => setBrushes(true)}>
            <span className="paint-brush-emoji" aria-hidden="true">{tool === 'stamp' ? <span style={{ color }}>{stamp}</span> : (brush ?? BRUSHES.find(b => b.key === r.lastBrush)!).emoji}</span>
          </button>
          <button className={`paint-btn ${tool === 'eraser' ? 'active' : ''}`} aria-pressed={tool === 'eraser'} aria-label={t('Eraser')} title={t('Eraser')} onClick={() => pickTool('eraser')}><EraserIcon /></button>
          <button className={`paint-btn ${tool === 'fill' ? 'active' : ''}`} aria-pressed={tool === 'fill'} aria-label={t('Fill bucket')} title={t('Fill bucket')} onClick={() => pickTool('fill')}><BucketIcon /></button>
          <button className="paint-btn paint-color-btn" aria-label={t('Colors: {name}', { name: nameOf(color) })} title={t('Colors')} aria-haspopup="dialog" onClick={() => setColors(true)}>
            <span className="paint-color-dot" style={{ background: color }} aria-hidden="true" />
          </button>
          <button className="paint-btn" aria-haspopup="dialog" aria-label={tool === 'fill' ? t('Size (Fill has no size)') : t('Size: {name}', { name: tm(SIZE_NAMES[size]) })} title={t('Size')}
            disabled={tool === 'fill'} onClick={() => setSizing(true)}>
            <span className="paint-size-dot" style={{ width: Math.max(4, Math.min(SIZES[size], 34)), height: Math.max(4, Math.min(SIZES[size], 34)), background: dotColor }} aria-hidden="true" />
          </button>
          <button className="paint-btn" aria-haspopup="dialog" aria-label={t('Coloring pages')} title={t('Coloring pages')} onClick={() => setBook(true)}><BookIcon /></button>
        </div>
        <div className="paint-group">
          <button className="paint-btn" aria-label={t('Undo')} title={t('Undo')} disabled={!canUndo} onClick={undo}><UndoIcon /></button>
          <button className="paint-btn" aria-label={t('Redo')} title={t('Redo')} disabled={!canRedo} onClick={redo}><RedoIcon /></button>
          <button className="paint-btn" aria-label={t('Clear picture')} title={t('Clear')} onClick={clear}><TrashIcon /></button>
          <button className="paint-btn" aria-label={t('My drawings')} title={t('My drawings')} onClick={async () => { await save(); setGallery(true) }}><ImagesIcon /></button>
          {/* Phones: Save, Save to family photos and Print go behind More so the actions fit one row. */}
          <span className="paint-extra">
            <button className="paint-btn" aria-label={t('Save picture')} title={t('Save')} onClick={exportPng}><DownloadIcon /></button>
            <button className="paint-btn" aria-label={t('Save to family photos')} title={t('Save to family photos')} disabled={savingPhoto} onClick={saveToPhotos}><HeartIcon /></button>
            <button className="paint-btn" aria-label={t('Print picture')} title={t('Print')} onClick={print}><PrinterIcon /></button>
          </span>
          <button className="paint-btn paint-more" aria-haspopup="dialog" aria-label={t('More: save or print')} title={t('More')} onClick={() => setMore(true)}><MoreIcon /></button>
          {members.length > 0 && (
            <button className={`paint-btn paint-who${member?.picture ? ' face-has-pic' : ''}`} aria-label={member ? t('Drawing by {name} (change)', { name: member.name }) : t("Who's drawing?")} title={t("Who's drawing?")} onClick={() => setWho(true)}
              style={member ? { background: member.color, color: inkFor(member.color) } : undefined}>
              {member ? <>{member.avatar || member.name[0]}<FacePic m={member} /></> : <span aria-hidden="true">🙂</span>}
            </button>
          )}
          <button className="paint-name" onClick={rename} aria-label={t('Rename {name}', { name: meta?.name ?? t('drawing') })}>
            <span>{meta?.name}</span><EditIcon width={18} height={18} />
          </button>
        </div>
      </div>
      <div className="paint-canvas-wrap" ref={wrapRef}>
        <canvas ref={canvasRef} className={`paint-canvas paint-tool-${tool}`} role="img" aria-label={t('Drawing canvas: {name}', { name: meta?.name ?? '' })}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
        <canvas ref={wetRef} className="paint-layer paint-wet" aria-hidden="true" />
        <canvas ref={linesRef} className="paint-layer" aria-hidden="true" />
      </div>

      {brushes && (
        <Sheet title={t('Brushes')} onClose={() => setBrushes(false)}>
          <div className="paint-brushes">
            {BRUSHES.filter(b => b.key !== 'stamp').map(b => (
              <button key={b.key} className={`paint-brush-tile ${tool === b.key ? 'active' : ''}`} aria-pressed={tool === b.key} onClick={() => pickTool(b.key)}>
                <BrushSample brush={b.key} color={color} />
                <span><span aria-hidden="true">{b.emoji}</span> {tm(b.name)}</span>
              </button>
            ))}
          </div>
          <h3 className="paint-palette-title">{t('Stamps')}</h3>
          <div className="paint-stamps">
            {STAMPS.map(([s, name], i) => (
              <button key={s} className={`paint-stamp ${tool === 'stamp' && stamp === s ? 'active' : ''}`} aria-pressed={tool === 'stamp' && stamp === s}
                aria-label={t('{name} stamp', { name: tm(name) })} title={tm(name)} style={i < 4 ? { color } : undefined} onClick={() => pickTool('stamp', s)}>{s}</button>
            ))}
          </div>
          <p className="paint-gallery-note" style={{ marginTop: 12 }}>{t('Tap the picture to stamp. Star, heart, dot and diamond use your color.')}</p>
        </Sheet>
      )}

      {sizing && (
        <Sheet title={t('{tool} size', { tool: toolName(sized, stamp) })} onClose={() => setSizing(false)}>
          <div className="paint-sizes" role="group" aria-label={t('Sizes')}>
            {SIZES.map((px, i) => (
              <button key={px} className={`paint-size ${size === i ? 'active' : ''}`} aria-pressed={size === i} aria-label={tm(SIZE_NAMES[i])} title={tm(SIZE_NAMES[i])} onClick={() => pickSize(i)}>
                <span className="paint-size-dot" style={{ width: drawn(px), height: drawn(px), background: dotColor }} aria-hidden="true" />
              </button>
            ))}
          </div>
          <p className="paint-gallery-note" style={{ marginTop: 12 }}>{t('Each dot shows how big it draws. Every brush, and the eraser, keeps its own size on this device.')}</p>
        </Sheet>
      )}

      {more && (
        <Sheet title={t('Save or print')} onClose={() => setMore(false)}>
          <div style={{ display: 'grid', gap: 10 }}>
            <button className="btn btn-secondary btn-block" onClick={() => { setMore(false); exportPng() }}><DownloadIcon /> {t('Save picture')}</button>
            <button className="btn btn-secondary btn-block" disabled={savingPhoto} onClick={() => { setMore(false); saveToPhotos() }}><HeartIcon /> {t('Save to family photos')}</button>
            <button className="btn btn-secondary btn-block" onClick={() => { setMore(false); print() }}><PrinterIcon /> {t('Print')}</button>
          </div>
        </Sheet>
      )}

      {book && <ColoringBook onClose={() => setBook(false)} onPick={pickPage} />}

      {gallery && <Gallery currentId={meta?.id} onClose={() => setGallery(false)}
        onOpen={async d => { await save(); await open(d); setGallery(false); announce(t('Opened {name}', { name: d.name })) }}
        onNew={async () => { await save(); startNew(); setGallery(false); announce(t('New drawing')) }}
        onColoring={async () => { await save(); setGallery(false); setBook(true) }}
        onDeleted={id => { if (id === r.meta?.id) startNew() }} />}

      {colors && (
        <Sheet title={t('Colors')} onClose={() => setColors(false)}>
          <div className="paint-palette">
            {PALETTE.map((row, i) => (
              <div key={i} className="paint-palette-row" role="group" aria-label={[t('Bright'), t('Pastel'), t('Dark'), t('Skin and browns'), t('Grays')][i]}>
                {row.map(([c, name]) => {
                  const on = painting && color.toLowerCase() === c.toLowerCase()
                  return <button key={c} className={`color-swatch ${on ? 'active' : ''} ${c === '#FFFFFF' ? 'paint-swatch-light' : ''}`} style={{ backgroundColor: c }} aria-pressed={on} aria-label={tm(name)} title={tm(name)} onClick={() => pickColor(c)} />
                })}
              </div>
            ))}
          </div>
          <h3 className="paint-palette-title">{t('Any color')}</h3>
          <div className="paint-palette-row">
            <CustomColorSwatch value={color} presets={PRESETS} onChange={pickCustom} label={t('Pick any color')} />
            {recent.map(c => (
              <button key={c} className={`color-swatch ${painting && color === c ? 'active' : ''}`} style={{ backgroundColor: c }} aria-pressed={painting && color === c}
                aria-label={t('Your color {hex}', { hex: c })} title={c} onClick={() => pickColor(c)} />
            ))}
          </div>
        </Sheet>
      )}

      {who && (
        <Sheet title={t("Who's drawing?")} onClose={() => setWho(false)}>
          <div className="who-grid">
            {members.map(m => (
              <button key={m.id} className={`who-btn ${meta?.memberId === m.id ? 'active' : ''}`} aria-pressed={meta?.memberId === m.id} onClick={() => setMember(m.id)}>
                <Face m={m} className="who-avatar" aria-hidden="true" />
                {m.name}
              </button>
            ))}
          </div>
          <button className="btn btn-secondary btn-block" style={{ marginTop: 12 }} onClick={() => setMember(null)}>{t('Skip')}</button>
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

/** A little stroke drawn by the brush itself, in the current color: the brush's picture in the sheet. */
function BrushSample({ brush, color }: { brush: Brush; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = ref.current!
    const k = window.devicePixelRatio || 1
    c.width = 120 * k; c.height = 48 * k
    const ctx = c.getContext('2d')!
    ctx.fillStyle = PAPER; ctx.fillRect(0, 0, c.width, c.height)
    const pts = Array.from({ length: 25 }, (_, i): [number, number] => [(12 + i * 4) * k, (24 + Math.sin(i / 3.8) * 12) * k])
    drawStroke(ctx, null, { brush, color, width: 8 * k, ratio: k, seed: 3 }, pts)
  }, [brush, color])
  return <canvas ref={ref} className="paint-brush-sample" aria-hidden="true" />
}

function Gallery({ currentId, onClose, onOpen, onNew, onColoring, onDeleted }: {
  currentId?: string; onClose: () => void; onOpen: (d: Drawing) => void; onNew: () => void; onColoring: () => void; onDeleted: (id: string) => void
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
    if ((items?.length ?? 0) >= MAX_DRAWINGS) { toast(t('My drawings is full ({n} pictures). Delete a few first.', { n: MAX_DRAWINGS }), true); return }
    await putDrawing({ ...d, id: newId(), name: t('{name} (copy)', { name: d.name }), created: Date.now(), updated: Date.now() })
    announce(t('Copied {name}', { name: d.name })); setTick(n => n + 1)
  }
  const remove = async (d: Drawing) => {
    if (!await dialog.confirm({ title: t('Delete "{title}"?', { title: d.name }), body: t('This picture will be gone from this device.'), confirmLabel: t('Delete'), danger: true })) return
    await deleteDrawing(d.id)
    onDeleted(d.id)
    announce(t('Deleted {name}', { name: d.name })); setTick(n => n + 1)
  }

  return (
    <Sheet title={t('My drawings')} onClose={onClose}>
      <p className="paint-gallery-note">{items ? t('Saved on this device only · {n} of {max}.', { n: items.length, max: MAX_DRAWINGS }) : t('Saved on this device only.')}</p>
      <div className="paint-gallery-new">
        <button className="btn btn-primary" onClick={onNew}><PlusIcon width={20} height={20} /> {t('New drawing')}</button>
        <button className="btn btn-secondary" onClick={onColoring}><BookIcon width={20} height={20} /> {t('Coloring page')}</button>
      </div>
      {items?.length === 0 && <div className="empty-card"><span className="emoji" aria-hidden="true">🎨</span>{t('No drawings yet')}</div>}
      <ul className="paint-gallery">
        {items?.map(d => {
          const m = members.find(x => x.id === d.memberId)
          return (
            <li key={d.id} className={`paint-gallery-item ${d.id === currentId ? 'current' : ''}`}>
              <button className="paint-gallery-open" onClick={() => onOpen(d)} aria-label={m ? t('Open {name} by {artist}, {date}', { name: d.name, artist: m.name, date: fmtDate(d.updated) }) : t('Open {name}, {date}', { name: d.name, date: fmtDate(d.updated) })}>
                <img src={d.thumbUrl} alt="" />
                <span className="paint-gallery-name">{d.name}</span>
                <span className="paint-gallery-sub">{m ? `${m.avatar || ''} ${m.name} · ` : ''}{fmtDate(d.updated)}</span>
              </button>
              <div className="paint-gallery-actions">
                <button className="btn btn-secondary" onClick={() => duplicate(d)} aria-label={t('Duplicate {name}', { name: d.name })}>{t('Copy')}</button>
                <button className="icon-btn" onClick={() => remove(d)} aria-label={t('Delete {name}', { name: d.name })}><TrashIcon width={20} height={20} /></button>
              </div>
            </li>
          )
        })}
      </ul>
    </Sheet>
  )
}
