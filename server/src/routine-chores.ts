/** Names are exact after whitespace/case normalization, never fuzzy or shared across children. */
export const cleanRoutineChoreName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/gu, ' ');
export const routineChoreName = (name: string) => cleanRoutineChoreName(name).toLowerCase();
export function routineChoreNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map(cleanRoutineChoreName).filter(name => {
    const key = routineChoreName(name);
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}
type Chore = { id: string; title: string; rrule?: string | null; repeat_goal?: string | null };
export const oneTimeRoutineChore = (chore: Chore) => !chore.rrule && !chore.repeat_goal;
/** Convert selected one-time IDs to durable name rules; recurring chores retain their IDs. */
export function routineChoreSelection(ids: string[] | null, names: string[], chores: Chore[]) {
  if (ids === null) return { requiredChoreIds: null, requiredOneTimeChoreNames: [] };
  const oneTime = chores.filter(chore => ids.includes(chore.id) && oneTimeRoutineChore(chore));
  const replaced = new Set(oneTime.map(chore => chore.id));
  return { requiredChoreIds: ids.filter(id => !replaced.has(id)), requiredOneTimeChoreNames: routineChoreNames([...names, ...oneTime.map(chore => chore.title)]) };
}
