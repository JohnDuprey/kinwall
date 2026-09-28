import type { ListKind } from './types.ts'

type Sortable = { id: string; kind: ListKind; sort: number; createdAt: string }

const SECTIONS: { kind: ListKind; label: string }[] = [
  { kind: 'shopping', label: 'Shopping' },
  { kind: 'todo', label: 'To-dos' },
  { kind: 'reusable', label: 'Reusable' },
]

/** The family order (sort, then oldest first - same as GET /api/lists). */
export const byListOrder = (a: Sortable, b: Sortable) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt)

/** The Lists page's sections: one per kind in a fixed order, each in the family order; empty ones left out. */
export function listSections<T extends Sortable>(lists: T[]): { kind: ListKind; label: string; lists: T[] }[] {
  const sorted = [...lists].sort(byListOrder)
  return SECTIONS.map(s => ({ ...s, lists: sorted.filter(l => l.kind === s.kind) })).filter(s => s.lists.length > 0)
}

/** The whole family order after one section is reordered to `ids`: those lists fill the slots they
 * already had, so every other list (other sections, archived, another member's) keeps its place. */
export function reorderWithin(all: Sortable[], ids: string[]): string[] {
  const next = [...ids]
  return [...all].sort(byListOrder).map(l => (ids.includes(l.id) ? next.shift()! : l.id))
}
