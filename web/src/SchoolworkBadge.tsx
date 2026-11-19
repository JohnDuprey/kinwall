import { schoolKindLabel } from './schoolwork.ts'
import type { SchoolKind } from './types.ts'

export function SchoolworkBadge({ kind }: { kind?: SchoolKind | null }) {
  return kind ? <span className="schoolwork-badge"><span aria-hidden="true">🎒</span> {schoolKindLabel(kind)}</span> : null
}
