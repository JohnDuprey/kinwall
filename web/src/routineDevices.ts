export type RoutineAppSelection = { revision: number; selectedApps: number; selectedCategories: number; allowedApps: number; updatedAt: string | null }
export type RoutineDevice = { id: string; name: string; authorized: boolean; appliedRevision: number; locked: boolean; lastSeenAt: string }
export type RoutineDevices = { selection: RoutineAppSelection | null; devices: RoutineDevice[] }
export type RoutineNativeStatus = { memberId?: string; action?: string; simulator?: boolean; authorized?: boolean; appMode?: 'selected' | 'all'; selected?: number; locked?: boolean; allowedApps?: number; allowedWebsitesOnly?: boolean; error?: string; awaitingSelection?: boolean; role?: 'parent' | 'child'; selectionSaved?: boolean; cancelled?: boolean; revision?: number; selectedApps?: number; selectedCategories?: number }

/** Delivery is a child's last report, never a promise that an offline device is enforcing now. */
export function routineDeviceDelivery(device: RoutineDevice, revision: number, now: number, requiresChoices = true): 'authorization' | 'authorized' | 'choices' | 'pending' | 'offline' | 'received' {
  if (!device.authorized) return 'authorization'
  if (!revision && requiresChoices) return 'choices'
  if (device.appliedRevision < revision) return 'pending'
  const checked = Date.parse(device.lastSeenAt)
  if (!Number.isFinite(checked) || now - checked > 120000) return 'offline'
  return revision ? 'received' : 'authorized'
}
