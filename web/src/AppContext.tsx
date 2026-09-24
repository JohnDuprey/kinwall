import { createContext, useContext } from 'react'
import type { Category, Member, Settings } from './types.ts'

export interface AppCtx {
  settings: Settings
  members: Member[]
  categories: Category[]
  selectedMemberId: string | null
  setSelectedMemberId: (id: string | null) => void
  refreshTick: number
  reloadCore: () => void
  toast: (msg: string) => void
}

export const AppContext = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp outside provider')
  return ctx
}
