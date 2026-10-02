import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist'
import { openPdf } from './pdf.ts'
import { api } from './api.ts'
import Sheet from './Sheet.tsx'
import { ExternalIcon, MinusIcon, PlusIcon } from './icons.tsx'

const ZOOMS = [1, 1.5, 2, 3]
const MAX_CANVAS_PIXELS = 16_000_000 // iOS refuses to draw a bigger canvas


/** A meal kit's PDF recipe card, fetched through the server (`path`, e.g. api/recipes/{id}/source.pdf). */
export default function RecipeCardSheet({ path, url, title, onClose }: { path: string; url: string; title: string; onClose: () => void }) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(0)
  const [width, setWidth] = useState(0)
  const bodyRef = useRef<HTMLDivElement>(null)
  const canvases = useRef<(HTMLCanvasElement | null)[]>([])

  useEffect(() => {
    let live = true
    let task: PDFDocumentLoadingTask | null = null
    api.recipeCardPdf(path).then(openPdf).then(t => { task = t; if (!live) void t.destroy(); return t.promise }).then(d => { if (live) setDoc(d) })
      .catch(e => { if (live) setError(e instanceof Error && e.message ? e.message : 'Could not open the recipe card.') })
    return () => { live = false; void task?.destroy() }
  }, [path])

  // Fit to the viewer's width; follow rotation and window resizes.
  useEffect(() => {
    const body = bodyRef.current?.closest('.sheet-body')
    if (!body) return
    const measure = () => setWidth(body.clientWidth - 24) // .pdf-pages padding
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(body)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    if (!doc || width <= 0) return
    const tasks: { cancel: () => void }[] = []
    let live = true
    ;(async () => {
      for (let n = 1; n <= doc.numPages && live; n++) {
        const page = await doc.getPage(n)
        const canvas = canvases.current[n - 1]
        if (!canvas || !live) return
        const base = page.getViewport({ scale: 1 })
        const cssWidth = width * ZOOMS[zoom]
        const scale = Math.min(cssWidth / base.width * (window.devicePixelRatio || 1), Math.sqrt(MAX_CANVAS_PIXELS / (base.width * base.height)))
        const viewport = page.getViewport({ scale })
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        canvas.style.width = `${cssWidth}px`
        canvas.style.height = `${cssWidth * base.height / base.width}px`
        const task = page.render({ canvas, viewport })
        tasks.push(task)
        await task.promise.catch(() => {}) // cancelled by a newer zoom
      }
    })().catch(e => { if (live) setError(e instanceof Error ? e.message : 'Could not show the recipe card.') })
    return () => { live = false; tasks.forEach(t => t.cancel()) }
  }, [doc, width, zoom])

  const browser = <a className="btn btn-secondary" href={url} target="_blank" rel="noopener noreferrer"><ExternalIcon width={18} height={18} /> Open in browser</a>
  return <Sheet title={title} onClose={onClose} variant="full" actions={error ? undefined : <div className="pdf-toolbar">
    <button className="icon-btn" aria-label="Zoom out" disabled={!doc || zoom === 0} onClick={() => setZoom(z => z - 1)}><MinusIcon width={20} height={20} /></button>
    <button className="icon-btn" aria-label="Zoom in" disabled={!doc || zoom === ZOOMS.length - 1} onClick={() => setZoom(z => z + 1)}><PlusIcon width={20} height={20} /></button>
    <span className="pdf-count" aria-live="polite">{doc ? `${doc.numPages} page${doc.numPages === 1 ? '' : 's'}${zoom ? ` · ${ZOOMS[zoom] * 100}%` : ''}` : ''}</span>
    {browser}
  </div>}>
    <div ref={bodyRef}>
      {error ? <div className="pdf-state" role="alert"><p>This recipe card couldn’t be shown here ({error}).</p>{browser}</div>
        : !doc ? <p className="pdf-state" role="status">Loading recipe card…</p>
        : <div className="pdf-pages" onDoubleClick={() => setZoom(z => z ? 0 : 2)}>
          {Array.from({ length: doc.numPages }, (_, i) => <canvas key={i} ref={el => { canvases.current[i] = el }} role="img" aria-label={`Page ${i + 1} of ${doc.numPages}`} />)}
        </div>}
    </div>
  </Sheet>
}
