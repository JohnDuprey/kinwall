// Photo prep before upload: decode (honoring EXIF rotation), shrink to 1280 px on the long edge and
// re-encode as WebP (JPEG where the browser can't encode WebP), stepping the quality down until it
// fits the server's 600 KB cap. A 12 MP phone photo ends up around 150-300 KB.
const MAX_EDGE = 1280
export const MAX_PHOTO_BYTES = 600 * 1024

export class PhotoFormatError extends Error {
  constructor() { super("This photo format can't be read here — pick it from Photos (iPhone converts it) or export as JPEG") }
}

async function decode(file: File): Promise<{ src: CanvasImageSource; width: number; height: number; close: () => void }> {
  if ('createImageBitmap' in window) {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' })
      return { src: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() }
    } catch { /* fall through: older Safari rejects the options bag */ }
  }
  // An <img> applies EXIF orientation by default in every current browser.
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.src = url
  try {
    await img.decode()
  } catch {
    URL.revokeObjectURL(url)
    throw new PhotoFormatError()
  }
  return { src: img, width: img.naturalWidth, height: img.naturalHeight, close: () => URL.revokeObjectURL(url) }
}

const toBlob = (canvas: HTMLCanvasElement, type: string, quality: number) =>
  new Promise<Blob | null>(res => canvas.toBlob(res, type, quality))

export async function preparePhoto(file: File): Promise<{ blob: Blob; width: number; height: number }> {
  const img = await decode(file)
  const scale = Math.min(1, MAX_EDGE / Math.max(img.width, img.height))
  const width = Math.max(1, Math.round(img.width * scale)), height = Math.max(1, Math.round(img.height * scale))
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img.src, 0, 0, width, height)
  img.close()

  // Safari < 17 can't encode WebP: toBlob quietly returns a PNG instead, so check the type.
  const probe = await toBlob(canvas, 'image/webp', 0.82)
  const type = probe?.type === 'image/webp' ? 'image/webp' : 'image/jpeg'
  let blob = type === 'image/webp' ? probe : await toBlob(canvas, type, 0.85)
  for (const q of [0.7, 0.55, 0.4]) {
    if (blob && blob.size <= MAX_PHOTO_BYTES) break
    blob = await toBlob(canvas, type, q)
  }
  if (!blob) throw new Error("Couldn't prepare that photo")
  if (blob.size > MAX_PHOTO_BYTES) throw new Error('That photo is still too large after shrinking it')
  return { blob, width, height }
}
