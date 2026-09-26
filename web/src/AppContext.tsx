import { createContext, useContext } from 'react'
import type { Category, Member, Settings } from './types.ts'

export interface AppCtx {
  settings: Settings
  members: Member[]
  categories: Category[]
  selectedMemberId: string | null
  setSelectedMemberId: (id: string | null) => void
  focusMemberId: string | null // this display is pinned to one member (selectedMemberId is then that member)
  focusShowsShared: boolean // ...and still shows events/chores/lists assigned to nobody
  focusLocked: boolean // an admin set who this device belongs to, so it can't pick its own
  refreshTick: number
  reloadCore: () => void
  toast: (msg: string, persist?: boolean) => void // persist: stays until tapped (errors, results)
}

export const AppContext = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside provider')
  return ctx
}
