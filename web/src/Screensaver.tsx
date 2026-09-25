// Quiet-hours screensaver: a dim slideshow shown inside QuietOverlay (App.tsx) instead of the bare
// clock. Mounted only while the overlay is up, so nothing is fetched or animated otherwise.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { drawingIds, getDrawing } from './drawings-db.ts'
import type { DeviceAppearance, SaverSource } from './useTheme.ts'

interface Pic { key: number; src: string; caption?: string; revoke?: boolean }
type Source = () => Promise<Omit<Pic, 'key'> | null> // null = nothing to show (no drawings)

const shuffle = <T,>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] } return a }

// Drawings: one shuffled pass over this device's gallery, then reshuffle. One PNG in memory at a time.
function drawingsSource(): Source {
  let queue: string[] = []
  return async () => {
    if (!queue.length) queue = shuffle(await drawingIds())
    const d = await getDrawing(queue.pop()!).catch(() => undefined)
    return d ? { src: URL.createObjectURL(d.png), revoke: true } : null
  }
}

// The Met open-access API (CC0, no key): one search per night for the ~950 highlighted paintings
// with images, shuffled; then one object lookup + one image per change. Objects that aren't public
// domain or have no web image are skipped (a few tries, then the clock until the next change).
const MET = 'https://collectionapi.metmuseum.org/public/collection/v1'
let metIds: { at: number; ids: number[] } | null = null
async function artNext(): Promise<Omit<Pic, 'key'>> {
  for (let tries = 0; tries < 5; tries++) {
    if (!metIds?.ids.length || Date.now() - metIds.at > 12 * 3600_000) {
      const res = await fetch(`${MET}/search?hasImages=true&isHighlight=true&medium=Paintings&q=painting`, { referrerPolicy: 'no-referrer' })
      if (!res.ok) throw new Error(`Met search ${res.status}`)
      metIds = { at: Date.now(), ids: shuffle(((await res.json()).objectIDs ?? []) as number[]) }
      if (!metIds.ids.length) throw new Error('Met: no results')
    }
    const res = await fetch(`${MET}/objects/${metIds.ids.pop()}`, { referrerPolicy: 'no-referrer' })
    if (!res.ok) continue
    const o = await res.json() as { isPublicDomain?: boolean; primaryImageSmall?: string; title?: string; artistDisplayName?: string; objectDate?: string }
    if (o.isPublicDomain !== true || !o.primaryImageSmall) continue
    return { src: o.primaryImageSmall, caption: [o.title, o.artistDisplayName, o.objectDate].filter(Boolean).join(' · ') }
  }
  throw new Error('Met: no public-domain image in 5 tries')
}

// Lorem Picsum (Unsplash photos, free to use): one request per picture, sized to the screen.
let picsumN = 0
async function natureNext(): Promise<Omit<Pic, 'key'>> {
  const scale = Math.min(1, 1920 / (Math.max(innerWidth, innerHeight) * devicePixelRatio)) * devicePixelRatio
  return { src: `https://picsum.photos/${Math.round(innerWidth * scale)}/${Math.round(innerHeight * scale)}?random=${Date.now()}${picsumN++}` }
}

const SOURCES: Record<SaverSource, () => Source> = { drawings: drawingsSource, art: () => artNext, nature: () => natureNext }

const loggedFailure = new Set<SaverSource>() // one console line per source per page load

/** Settings → This display → Preview: App's QuietOverlay shows itself for 20 s on any device. */
export const SAVER_PREVIEW_EVENT = 'kinwall:screensaver-preview'

/** Decodes the image before it's put on screen, so a change never flashes an empty frame. */
function preload(src: string) {
  const img = new Image()
  img.src = src
  return img.decode()
}

export default function Slideshow({ sources, device, clock }: { sources: SaverSource[]; device: DeviceAppearance; clock: (small: boolean) => ReactNode }) {
  const [pics, setPics] = useState<Pic[]>([]) // current + the one fading out; never more than two
  const [failed, setFailed] = useState(false)
  const [n, setN] = useState(0) // picture count: picks the clock corner
  const [drift, setDrift] = useState({ x: 0, y: 0 })
  const every = (device.saverEvery ?? 5) * 60_000
  const reduced = useRef(matchMedia('(prefers-reduced-motion: reduce)').matches).current

  const sourceKey = sources.join(',')
  useEffect(() => {
    // Round-robin over the enabled sources; each keeps its own queue/cache. A source with nothing
    // to show (no drawings) or that fails is skipped for this change; all failing = the clock.
    const list = sourceKey.split(',') as SaverSource[]
    const nexts = list.map(k => SOURCES[k]())
    let turn = 0
    let cancelled = false
    let busy = false
    const change = async () => {
      if (busy || document.hidden) return // pause while the screen is off / tab hidden
      busy = true
      let pic: Omit<Pic, 'key'> | null = null
      for (let i = 0; i < list.length && !pic && !cancelled; i++) {
        const k = turn++ % list.length
        try {
          pic = await nexts[k]()
          if (pic) await preload(pic.src)
        } catch (e) {
          if (!loggedFailure.has(list[k])) { console.warn(`Screensaver: ${list[k]} failed, skipping it this time`, e); loggedFailure.add(list[k]) }
          if (pic?.revoke) URL.revokeObjectURL(pic.src)
          pic = null
        }
      }
      busy = false
      if (cancelled) { if (pic?.revoke) URL.revokeObjectURL(pic.src); return }
      setFailed(!pic) // try again next change: a wifi blip shouldn't end the slideshow for the night
      if (!pic) return
      const key = Date.now()
      setPics(p => [...p.slice(-1), { ...pic, key }])
      setN(c => c + 1)
      if (!reduced) setDrift({ x: (Math.random() - 0.5) * 3, y: (Math.random() - 0.5) * 3 })
    }
    change()
    const id = setInterval(change, every)
    const onVis = () => { if (!document.hidden) change() }
    document.addEventListener('visibilitychange', onVis)
    return () => { cancelled = true; clearInterval(id); document.removeEventListener('visibilitychange', onVis) }
  }, [sourceKey, every, reduced])

  // Drop (and free) the picture underneath once the crossfade is done.
  useEffect(() => {
    if (pics.length < 2) return
    const id = setTimeout(() => setPics(p => { const [old, ...rest] = p; if (old.revoke) URL.revokeObjectURL(old.src); return rest }), reduced ? 0 : 2500)
    return () => clearTimeout(id)
  }, [pics, reduced])
  // Free whatever is still showing on unmount.
  const picsRef = useRef(pics)
  picsRef.current = pics
  useEffect(() => () => picsRef.current.forEach(p => p.revoke && URL.revokeObjectURL(p.src)), [])

  if (failed || !pics.length) return <>{clock(false)}</>
  const current = pics[pics.length - 1]
  const brightness = device.saverBright === 'medium' ? 0.7 : 0.45
  return (
    <>
      <div className="saver-stage" style={{ transform: `translate(${drift.x}%, ${drift.y}%)` }}>
        {pics.map(p => <img key={p.key} className="saver-img" src={p.src} alt="" style={{ filter: `brightness(${brightness})` }} />)}
      </div>
      {(device.saverClock !== false || current.caption) && (
        <div className={`saver-corner saver-corner-${n % 4}`}>
          {device.saverClock !== false && clock(true)}
          {current.caption && <div className="saver-caption">{current.caption}</div>}
        </div>
      )}
    </>
  )
}
