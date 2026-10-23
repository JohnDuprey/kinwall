import type { RoutinePolicy, RoutineState } from './routineMode.ts'
import { routinePolicyKey } from './routineSave.ts'
export type RoutineSaveStatus = { phase: 'idle' | 'pending' | 'saving' | 'saved' | 'invalid' | 'error'; error?: string }
type Dependencies = { initial?: RoutinePolicy; save(policy: RoutinePolicy): Promise<RoutineState>; confirmed(state: RoutineState): void; status(state: RoutineSaveStatus): void }

/** One queue per child. A late response must never replace a more recent edit. */
export class RoutineAutosave {
  private readonly deps: Dependencies
  private version = 0
  private pending: { version: number; read(): RoutinePolicy } | null = null
  private lastRead: (() => RoutinePolicy) | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private running: Promise<void> | null = null
  private confirmedKey: string | undefined
  constructor(deps: Dependencies) { this.deps = deps; this.confirmedKey = deps.initial && routinePolicyKey(deps.initial) }
  matches(policy: RoutinePolicy) { return this.confirmedKey === routinePolicyKey(policy) }
  accept(policy: RoutinePolicy) { this.confirmedKey = routinePolicyKey(policy) }
  edit(read: () => RoutinePolicy, delay = 500) {
    this.lastRead = read
    this.pending = { version: ++this.version, read }
    clearTimeout(this.timer)
    this.deps.status({ phase: 'pending' })
    this.timer = setTimeout(() => { this.timer = undefined; void this.flush(false) }, delay)
  }
  async flush(force = true): Promise<void> {
    if (force) { clearTimeout(this.timer); this.timer = undefined }
    if (this.running) {
      await this.running
      if (force || this.timer === undefined) await this.flush(force)
      return
    }
    const job = this.pending
    if (!job) return
    this.pending = null
    let policy: RoutinePolicy
    try { policy = job.read() }
    catch (e) { if (job.version === this.version) this.deps.status({ phase: 'invalid', error: e instanceof Error ? e.message : String(e) }); return }
    this.deps.status({ phase: 'saving' })
    const task = this.deps.save(policy).then(state => {
      if (job.version !== this.version) return
      this.accept(state)
      this.deps.confirmed(state)
      this.deps.status({ phase: 'saved' })
    }).catch(e => { if (job.version === this.version) this.deps.status({ phase: 'error', error: e instanceof Error ? e.message : String(e) }) })
    this.running = task
    await task
    if (this.running === task) this.running = null
    if (this.pending && this.timer === undefined) await this.flush(false)
  }
  async retry() { if (this.lastRead) { this.edit(this.lastRead, 0); await this.flush() } }
}
