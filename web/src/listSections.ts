import { msg } from './i18n.ts'
import type { ListCatalog, ListKind, ListPurpose } from './types.ts'

/** What the Lists page and the edit sheet call a list's kind: a shopping list is Groceries or
 * Shopping by its catalog (an older server sends none: groceries), and a to-do list with purpose
 * pantry is a Pantry list. */
export type ListType = 'groceries' | 'shopping' | 'pantry' | 'todo' | 'reusable'
type Typed = { kind: ListKind; catalog?: ListCatalog | null; purpose?: ListPurpose | null }
type Ordered = { id: string; sort: number; createdAt: string }
type Sortable = Typed & Ordered

export const listType = (l: Typed): ListType => (l.kind === 'shopping' ? l.catalog ?? 'groceries' : l.kind === 'todo' && l.purpose === 'pantry' ? 'pantry' : l.kind)
/** A type as the list's API fields. A plain to-do list says purpose null, so a pantry list changed to To-do stops being one. */
export const typeFields = (t: ListType): { kind: ListKind; catalog?: ListCatalog; purpose?: ListPurpose | null } =>
  t === 'groceries' || t === 'shopping' ? { kind: 'shopping', catalog: t } : t === 'pantry' ? { kind: 'todo', purpose: 'pantry' } : t === 'todo' ? { kind: 'todo', purpose: null } : { kind: t }
/** How a list's items behave: by kind, with a pantry list's own (use-by dates, where it's kept). */
export type ItemKind = ListKind | 'pantry'
export const itemKind = (l: Typed): ItemKind => (l.kind === 'todo' && l.purpose === 'pantry' ? 'pantry' : l.kind)

export const TYPE_LABEL: Record<ListType, string> = { groceries: msg('Groceries'), shopping: msg('Shopping'), pantry: msg('Pantry'), todo: msg('To-do'), reusable: msg('Reusable') }
const SECTIONS: { type: ListType; label: string }[] = [
  { type: 'groceries', label: 'Groceries' },
  { type: 'shopping', label: 'Shopping' },
  { type: 'pantry', label: 'Pantry' },
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

/** The Board's list tiles: Groceries whenever the family has a Groceries list, and Shopping only
 * while a Shopping list has open items (so a hardware run doesn't show as groceries). */
export function boardListTiles<T extends Typed & { openCount: number }>(lists: T[]): { type: 'groceries' | 'shopping'; lists: T[]; open: number }[] {
  return (['groceries', 'shopping'] as const)
    .map(type => { const of = lists.filter(l => listType(l) === type); return { type, lists: of, open: of.reduce((n, l) => n + l.openCount, 0) } })
    .filter(t => t.lists.length > 0 && (t.type === 'groceries' || t.open > 0))
}

/** On a kid's own device (`kid`: its owner; null anywhere else), the items it may tick, edit or delete:
 * theirs, nobody's, or any on a list that's theirs. The server's rule (routes/lists.ts itemOwnerBlock). */
export const canChangeItem = (item: { memberId: string | null }, list: { memberIds: string[] }, kid: string | null) =>
  !kid || !item.memberId || item.memberId === kid || list.memberIds.includes(kid)

/** A list grouped by aisle (Lists.tsx groupItems): "store\0aisle"; with no aisle known (no store
 * picked yet), its department as a store-less group, so a new Groceries list shows Dairy, Produce, …
 * rather than one Other heap; null (Other) when neither is known. */
export const aisleGroup = (i: { store: string | null; aisle: string | null; category: string | null }): string | null =>
  i.aisle ? `${i.store ?? ''}\u0000${i.aisle}` : i.category ? `\u0000${i.category}` : null
