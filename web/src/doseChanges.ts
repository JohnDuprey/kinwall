// Successful dose writes must reach the card and Lock Screen together, before a toast or cheer
// finishes. A revision also rejects a due-dose response fetched before that write succeeded.
export type DoseChange = { medicationId: string; date: string; time: string; action: 'taken' | 'skipped' | 'snooze' | 'unmark' }
export const sameDose = (a: Pick<DoseChange, 'medicationId' | 'date' | 'time'>, b: Pick<DoseChange, 'medicationId' | 'date' | 'time'>) =>
  a.medicationId === b.medicationId && a.date === b.date && a.time === b.time

export class DoseChanges {
  revision = 0
  private listeners = new Set<(change: DoseChange) => void>()
  listen(listener: (change: DoseChange) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  current(revision: number) { return revision === this.revision }
  async saved<T>(request: Promise<T>, change: DoseChange): Promise<T> {
    const result = await request
    this.revision++
    // A failed consumer must not turn a successful server write into an apparent failed save.
    for (const listener of this.listeners) { try { listener(change) } catch { /* another consumer can still update */ } }
    return result
  }
}
export const doseChanges = new DoseChanges()
