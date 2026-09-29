// Settings → Family → Members: a calm note when two people's colors would look alike (to someone
// with color blindness, or at a glance), with a palette color that stands out for one of them.
import { api, ApiError } from './api.ts'
import { useApp } from './AppContext.tsx'
import { colorName, inkFor } from './color.ts'
import { alikeUnder, firstClash, suggestColor, VISION_WORDS } from './colorVision.ts'
import { MEMBER_PALETTE, type Member } from './types.ts'

const Swatch = ({ m, color, label }: { m: Member; color: string; label: string }) => (
  <span className="color-clash-swatch">
    <span className="member-avatar-sm" aria-hidden="true" style={{ background: color, color: inkFor(color) }}>{m.avatar || m.name[0]}</span>{label}
  </span>
)

/** Under the member list. "Use the suggestion" (parents) changes the second person's color. */
export function ColorClashNote({ members, canManage, onChanged, toast }: { members: Member[]; canManage: boolean; onChanged: () => void; toast: (m: string, persist?: boolean) => void }) {
  const clash = firstClash(members)
  if (!clash) return null
  const [a, b, vision] = clash
  const pick = suggestColor(members.filter(m => m.id !== b.id).map(m => m.color), MEMBER_PALETTE)
  const use = async () => {
    if (!pick) return
    try { await api.updateMember(b.id, { color: pick }); toast(`${b.name} is now ${colorName(pick)}`); onChanged() }
    catch (e) { toast(e instanceof ApiError ? e.message : 'Could not change the color', true) }
  }
  return (
    <div className="color-clash" role="note">
      <p><strong>{a.name} and {b.name} may look alike</strong> {VISION_WORDS[vision]}. Their avatars still tell them apart, but a different color helps on the calendar.</p>
      {pick && <>
        <div className="color-clash-swatches">
          <Swatch m={a} color={a.color} label={a.name} />
          <Swatch m={b} color={b.color} label={`${b.name} now`} />
          <Swatch m={b} color={pick} label={`Suggested for ${b.name}: ${colorName(pick)}`} />
        </div>
        {canManage && <button className="btn btn-primary" onClick={use}>Use the suggestion</button>}
      </>}
    </div>
  )
}

/** In the member editor, under the swatches: the picked color looks like someone else's. */
export function ColorClashHint({ color, memberId, onPick }: { color: string; memberId: string | null; onPick: (hex: string) => void }) {
  const others = useApp().members.filter(m => m.id !== memberId)
  const like = others.map(m => ({ m, v: alikeUnder(color, m.color) })).find(x => x.v)
  if (!like) return null
  const pick = suggestColor(others.map(m => m.color), MEMBER_PALETTE)
  return (
    <div className="color-clash" role="status">
      <p>May look like {like.m.name}'s color {VISION_WORDS[like.v!]}.</p>
      {pick && <button type="button" className="btn btn-secondary" onClick={() => onPick(pick)}>Use {colorName(pick)}</button>}
    </div>
  )
}
