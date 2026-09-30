import type { ListCatalog, ListKind } from './types.ts'

/** What the Lists page and the edit sheet call a list's kind: a shopping list is Groceries or
 * Shopping by its catalog (an older server sends none: groceries). */
export type ListType = 'groceries' | 'shopping' | 'todo' | 'reusable'
type Typed = { kind: ListKind; catalog?: ListCatalog | null }
type Ordered = { id: string; sort: number; createdAt: string }
type Sortable = Typed & Ordered

export const listType = (l: Typed): ListType => (l.kind === 'shopping' ? l.catalog ?? 'groceries' : l.kind)
/** A type as the list's API fields. */
export const typeFields = (t: ListType): { kind: ListKind; catalog?: ListCatalog } =>
  t === 'groceries' || t === 'shopping' ? { kind: 'shopping', catalog: t } : { kind: t }

export const TYPE_LABEL: Record<ListType, string> = { groceries: 'Groceries', shopping: 'Shopping', todo: 'To-do', reusable: 'Reusable' }
const SECTIONS: { type: ListType; label: string }[] = [
  { type: 'groceries', label: 'Groceries' },
  { type: 'shopping', label: 'Shopping' },
  { type: 'todo', label: 'To-dos' },
  { type: 'reusable', label: 'Reusable' },
]

/** The family order (sort, then oldest first - same as GET /api/lists). */
export const byListOrder = (a: Ordered, b: Ordered) => a.sort - b.sort || a.createdAt.localeCompare(b.createdAt)

/** The Lists page's sections: one per type in a fixed order, each in the family order; empty ones left out. */
export function listSections<T extends Sortable>(lists: T[]): { type: ListType; label: string; lists: T[] }[] {
  const sorted = [...lists].sort(byListOrder)
  return SECTIONS.map(s => ({ ...s, lists: sorted.filter(l => listType(l) === s.type) })).filter(s => s.lists.length > 0)
}

/** The whole family order after one section is reordered to `ids`: those lists fill the slots they
 * already had, so every other list (other sections, archived, another member's) keeps its place. */
export function reorderWithin(all: Ordered[], ids: string[]): string[] {
  const next = [...ids]
  return [...all].sort(byListOrder).map(l => (ids.includes(l.id) ? next.shift()! : l.id))
}
