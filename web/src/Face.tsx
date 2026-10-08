// A member's avatar everywhere: their profile picture inside a ring of their color (color-coding
// stays), or their emoji / initial on their color. The emoji sits under the picture and shows
// instead of it when it can't load (offline, removed): faceOf in picture.ts.
import { Fragment, useState, type HTMLAttributes } from 'react'
import { api } from './api'
import { inkFor } from './color'
import { faceOf } from './picture'

export type FaceMember = { name: string; color: string; avatar?: string | null; picture?: string | null }

/** Just the picture, for an avatar that is its own element (the header's buttons): null without one.
 * Its parent needs a position (Face's .face-has-pic). */
export function FacePic({ m }: { m: FaceMember }) {
  const [broken, setBroken] = useState<string | null>(null)
  const { src } = faceOf(m, api.pictureUrl, !!m.picture && broken === m.picture)
  return src ? <img className="face-pic" src={src} alt="" draggable={false} onError={() => setBroken(m.picture ?? null)} /> : null
}

export function Face({ m, className = 'member-avatar-sm', style, ...rest }: { m: FaceMember } & HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={`${className}${m.picture ? ' face-has-pic' : ''}`} style={{ background: m.color, color: inkFor(m.color), ...style }} {...rest}>
      {m.avatar || m.name[0]}
      <FacePic m={m} />
    </span>
  )
}

/** Inline avatars after a title (calendar events): a picture as a small circle, else the emoji as text. */
export function InlineFaces({ who, className = 'event-avatars' }: { who: (FaceMember & { id: string })[]; className?: string }) {
  return <span className={className}>{who.map((m, i) => <Fragment key={m.id}>{i > 0 && ' '}{m.picture ? <Face m={m} className="inline-face" /> : <span className="inline-emoji">{m.avatar || m.name[0]}</span>}</Fragment>)}</span>
}

/** A member's avatar at the start of a chip or button label: a small picture, else the emoji. */
export const ChipFace = ({ m }: { m: FaceMember }) => (m.picture ? <Face m={m} className="inline-face" aria-hidden="true" /> : <>{m.avatar}</>)
