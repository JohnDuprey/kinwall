// Paint's coloring book: the built-in pages (coloringPages.ts) and the family's own, which a parent's
// device adds from a picture (PNG, JPEG, SVG or a PDF's first page) turned into line art. The pages
// live with the family's photos on the server (routes/photos.ts), kept out of the photo library.
import { useEffect, useRef, useState } from 'react'
import { useApp } from './AppContext.tsx'
import { useDialog } from './dialog.tsx'
import { announce } from './a11y.tsx'
import Sheet from './Sheet.tsx'
import { api, ApiError } from './api.ts'
import { COLORING_PAGES, pageUrl } from './coloringPages.ts'
import { lineArt } from './paintTools.ts'
import { MAX_PHOTO_BYTES } from './photos.ts'
import { openPdf } from './pdf.ts'
import { PlusIcon, TrashIcon } from './icons.tsx'
import type { FamilyColoringPage } from './types.ts'

type Img = HTMLImageElement & { width: number; height: number }

/** An <img> that a canvas can read back (crossOrigin only for another origin, or it'd be refused). */
async function loadUrl(url: string): Promise<Img> {
  const img = new Image()
  if (/^https?:/.test(url) && new URL(url).origin !== location.origin) img.crossOrigin = 'anonymous'
  img.src = url
  await img.decode()
  return img
}

export default function ColoringBook({ onClose, onPick }: { onClose: () => void; onPick: (name: string, img: Img) => void }) {
  const { parentDevice, toast } = useApp()
  const dialog = useDialog()
  const [pages, setPages] = useState<FamilyColoringPage[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState(false)
  const [tick, setTick] = useState(0)
  useEffect(() => { api.getColoringPages().then(setPages).catch(() => setPages([])) }, [tick])

  const choose = async (name: string, url: string) => {
    if (busy) return
    setBusy(true)
    try { onPick(name, await loadUrl(url)) } catch { toast("Couldn't open that page. Try again.", true) } finally { setBusy(false) }
  }
  const remove = async (p: FamilyColoringPage) => {
    if (!await dialog.confirm({ title: `Delete "${p.name}"?`, body: 'Pictures already colored on it keep their lines.', confirmLabel: 'Delete', danger: true })) return
    try { await api.deleteColoringPage(p.id); announce(`Deleted ${p.name}`); setTick(t => t + 1) }
    catch (e) { toast(e instanceof ApiError ? e.message : "Couldn't delete that page", true) }
  }

  if (adding) return <AddPage onClose={() => setAdding(false)} onAdded={p => { setAdding(false); setTick(t => t + 1); toast(`Added: ${p.name}`) }} />
  return (
    <Sheet title="Coloring pages" onClose={onClose}>
      <p className="paint-gallery-note">Pick a page to color. Its lines stay on top, and Fill stays inside them.</p>
      <ul className="paint-gallery paint-pages">
        {COLORING_PAGES.map(p => (
          <li key={p.id} className="paint-gallery-item">
            <button className="paint-gallery-open" disabled={busy} onClick={() => choose(p.name, pageUrl(p.svg))} aria-label={`Color the ${p.name} page`}>
              <img src={pageUrl(p.svg)} alt="" />
              <span className="paint-gallery-name"><span aria-hidden="true">{p.emoji}</span> {p.name}</span>
            </button>
          </li>
        ))}
      </ul>
      {!!pages?.length && <>
        <h3 className="paint-palette-title">Our pages</h3>
        <ul className="paint-gallery paint-pages">
          {pages.map(p => (
            <li key={p.id} className="paint-gallery-item">
              <button className="paint-gallery-open" disabled={busy} onClick={() => choose(p.name, api.photoImageUrl(p))} aria-label={`Color the ${p.name} page`}>
                <img src={api.photoImageUrl(p)} alt="" />
                <span className="paint-gallery-name">{p.name}</span>
              </button>
              {parentDevice && (
                <div className="paint-gallery-actions">
                  <button className="icon-btn" onClick={() => remove(p)} aria-label={`Delete ${p.name}`}><TrashIcon width={20} height={20} /></button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </>}
      {parentDevice && (
        <button className="btn btn-secondary btn-block" style={{ marginTop: 16 }} onClick={() => setAdding(true)}>
          <PlusIcon width={20} height={20} /> Add a page from a picture
        </button>
      )}
    </Sheet>
  )
}

// ---------- Adding a page (parent devices) ----------

const MAX_EDGE = 1400 // px: crisp on a wall screen, small enough to clean up quickly on an iPad
const CLEANUP = [0, 12, 40, 120, 300] // smallest speck kept, in pixels
const CLEANUP_NAMES = ['Off', 'Light', 'Medium', 'Strong', 'Strongest']
const INK = [0x22, 0x22, 0x22]

const canvasOf = (w: number, h: number) => {
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h))
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.fillStyle = '#fff'
  ctx.fillRect(0, 0, c.width, c.height)
  return { c, ctx }
}

/** The picture on white paper, at most MAX_EDGE on its long side (an SVG is drawn at that size). */
async function decodeFile(file: File): Promise<ImageData> {
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) {
    const task = await openPdf(await file.arrayBuffer())
    try {
      const doc = await task.promise
      const page = await doc.getPage(1)
      const one = page.getViewport({ scale: 1 })
      const viewport = page.getViewport({ scale: MAX_EDGE / Math.max(one.width, one.height) })
      const { c, ctx } = canvasOf(viewport.width, viewport.height)
      await page.render({ canvas: c, viewport }).promise
      return ctx.getImageData(0, 0, c.width, c.height)
    } finally { void task.destroy() }
  }
  const url = URL.createObjectURL(file)
  try {
    const img = await loadUrl(url)
    const svg = file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)
    const w = img.naturalWidth || 1200, h = img.naturalHeight || 900
    const k = svg ? MAX_EDGE / Math.max(w, h) : Math.min(1, MAX_EDGE / Math.max(w, h))
    const { c, ctx } = canvasOf(w * k, h * k)
    ctx.drawImage(img, 0, 0, c.width, c.height)
    return ctx.getImageData(0, 0, c.width, c.height)
  } finally { URL.revokeObjectURL(url) }
}

/** Line art onto `c`: dark ink where the picture's lines are, clear everywhere else. */
function drawLineArt(c: HTMLCanvasElement, src: ImageData, level: number, cleanup: number) {
  const { width: w, height: h } = src
  const alpha = lineArt(src.data, w, h, level, cleanup)
  c.width = w; c.height = h
  const out = new ImageData(w, h)
  for (let i = 0; i < alpha.length; i++) {
    out.data[i * 4] = INK[0]; out.data[i * 4 + 1] = INK[1]; out.data[i * 4 + 2] = INK[2]; out.data[i * 4 + 3] = alpha[i]
  }
  c.getContext('2d')!.putImageData(out, 0, 0)
}

const pngOf = (c: HTMLCanvasElement) => new Promise<Blob | null>(res => c.toBlob(res, 'image/png'))

function AddPage({ onClose, onAdded }: { onClose: () => void; onAdded: (p: FamilyColoringPage) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const preview = useRef<HTMLCanvasElement>(null)
  const [src, setSrc] = useState<ImageData | null>(null)
  const [name, setName] = useState('')
  const [level, setLevel] = useState(150)
  const [clean, setClean] = useState(2)
  const [error, setError] = useState('')
  const [working, setWorking] = useState(false)

  // Redraw the preview a moment after a slider stops moving (cleaning up a big page takes a beat).
  useEffect(() => {
    if (!src || !preview.current) return
    const t = setTimeout(() => drawLineArt(preview.current!, src, level, CLEANUP[clean]), 120)
    return () => clearTimeout(t)
  }, [src, level, clean])

  const pick = async (file?: File) => {
    if (!file) return
    setError(''); setWorking(true)
    try {
      setSrc(await decodeFile(file))
      const base = file.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim().slice(0, 60)
      setName(n => n || base.charAt(0).toUpperCase() + base.slice(1))
    } catch {
      setError("That file can't be read here. Try a PNG, JPEG, SVG or PDF.")
    } finally { setWorking(false) }
  }

  const save = async () => {
    if (!src || working) return
    setWorking(true); setError('')
    try {
      const c = document.createElement('canvas')
      drawLineArt(c, src, level, CLEANUP[clean])
      let png = await pngOf(c), out = c
      // Too big for the photo limit: shrink it a step at a time (line art stays sharp enough).
      for (let k = 0.8; png && png.size > MAX_PHOTO_BYTES && k > 0.3; k -= 0.15) {
        out = document.createElement('canvas')
        out.width = Math.round(c.width * k); out.height = Math.round(c.height * k)
        out.getContext('2d')!.drawImage(c, 0, 0, out.width, out.height)
        png = await pngOf(out)
      }
      if (!png || png.size > MAX_PHOTO_BYTES) throw new Error('That page has too much detail to save. Try a stronger clean up.')
      onAdded(await api.addColoringPage(png, out.width, out.height, name.trim() || 'Coloring page'))
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add that page")
    } finally { setWorking(false) }
  }

  return (
    <Sheet title="Add a coloring page" onClose={onClose}
      actions={src ? <button className="btn btn-primary btn-block" disabled={working} onClick={save}>{working ? 'Saving…' : 'Add page'}</button> : undefined}>
      <p className="paint-gallery-note">Pick a picture with clear outlines: a printed coloring page, a photo of one, a drawing, or a PDF (its first page). Only the dark lines are kept.</p>
      <input ref={input} type="file" accept="image/png,image/jpeg,image/svg+xml,application/pdf,.pdf,.svg" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void pick(f) }} />
      <button className="btn btn-secondary btn-block" disabled={working} onClick={() => input.current?.click()}>{src ? 'Choose a different picture' : 'Choose a picture'}</button>
      {error && <p className="field-error" role="alert" style={{ marginTop: 12 }}>{error}</p>}
      {src && <>
        <canvas ref={preview} className="paint-page-preview" role="img" aria-label="Preview of the coloring page" />
        <div className="field">
          <label htmlFor="cp-name">Name</label>
          <input id="cp-name" type="text" maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="Coloring page" />
        </div>
        <div className="field">
          <label htmlFor="cp-lines">Lines</label>
          <input id="cp-lines" className="paint-range" type="range" min={70} max={230} step={5} value={level} onChange={e => setLevel(+e.target.value)}
            aria-valuetext={level < 130 ? 'Only dark lines' : level > 180 ? 'Light lines too' : 'Most lines'} />
          <p className="field-hint">Slide right to keep lighter lines, left for only the darkest.</p>
        </div>
        <div className="field">
          <label htmlFor="cp-clean">Clean up: {CLEANUP_NAMES[clean]}</label>
          <input id="cp-clean" className="paint-range" type="range" min={0} max={CLEANUP.length - 1} step={1} value={clean} onChange={e => setClean(+e.target.value)} aria-valuetext={CLEANUP_NAMES[clean]} />
          <p className="field-hint">Removes specks and smudges. Too strong can drop small details.</p>
        </div>
      </>}
    </Sheet>
  )
}
