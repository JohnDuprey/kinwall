// What changed between two GET /api/rev answers (usePoll in api.ts). `rev` moves on every change;
// newer servers also count changes per area in `revs`, so a change to a list doesn't make every
// screen refetch the settings, members and chores too. Pure, so it's tested in test/revs.test.ts.

export type Revs = { events: number; lists: number; chores: number }
export type RevAnswer = { rev: number; revs?: Revs }
export type Changed = { any: boolean } & Record<keyof Revs, boolean>

/** `any`: something changed (whole-screen refreshes). Per area: that area's data changed; all of
 * them when the server doesn't say which (an older server, or the first answer with areas). The
 * first answer (`prev` null) is only the baseline. */
export function changedAreas(prev: RevAnswer | null, next: RevAnswer): Changed {
  const any = !!prev && next.rev !== prev.rev
  if (!any) return { any, events: false, lists: false, chores: false }
  const a = prev.revs, b = next.revs
  if (!a || !b) return { any, events: true, lists: true, chores: true }
  return { any, events: a.events !== b.events, lists: a.lists !== b.lists, chores: a.chores !== b.chores }
}
