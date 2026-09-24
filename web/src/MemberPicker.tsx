import type { Member } from './types.ts'

/** Multi-select toggle chips for assigning a calendar to family members. "Nobody" clears the
 * selection. Reuses the existing `.chip`/`--chip-color` styling (see RemoteCalendarPicker). */
export function MemberPicker({ members, selected, onChange, label = 'Who is this for?' }: {
  members: Pick<Member, 'id' | 'name' | 'color' | 'avatar'>[]
  selected: string[]
  onChange: (ids: string[]) => void
  label?: string
}) {
  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id])
  }
  return (
    <div className="field">
      <label>{label}</label>
      <div className="chip-row">
        <button type="button" className={`chip ${selected.length === 0 ? 'active' : ''}`} onClick={() => onChange([])}>Nobody</button>
        {members.map(m => (
          <button key={m.id} type="button" className={`chip ${selected.includes(m.id) ? 'active' : ''}`}
            style={{ ['--chip-color' as string]: m.color }} onClick={() => toggle(m.id)}>{m.avatar} {m.name}</button>
        ))}
      </div>
    </div>
  )
}
