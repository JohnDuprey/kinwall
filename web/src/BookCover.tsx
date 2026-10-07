// A book's cover, the same wherever a book shows (Reading shelves, the library list and sheets, lookup
// results): the picture, or (no cover, or one that won't load) its cloth color, the one its spine has
// on the library's Covers shelf (clothColor). An audiobook's is square, like its sleeve in the crate.
import { useState } from 'react'
import { clothColor } from './library.ts'

export default function BookCover({ src, title, audio, className }: { src: string | null | undefined; title: string; audio?: boolean; className: string }) {
  const [failed, setFailed] = useState<string | null>(null)
  const cls = `book-cover ${className}${audio ? ' book-cover-square' : ''}`
  return src && failed !== src
    ? <img className={cls} src={src} alt="" loading="lazy" onError={() => setFailed(src)} />
    : <span className={`${cls} book-cover-cloth`} style={{ background: clothColor(title) }} aria-hidden="true">{audio ? '🎧' : '📖'}</span>
}
