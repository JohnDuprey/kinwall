// Which devices act as a wall screen, and when their Night screen shows. Pure, so node tests load it.

/** A tap keeps the Night screen away this long during quiet hours. */
export const WAKE_MS = 5 * 60 * 1000

/** Is `now` inside the [from, to) HH:MM window (device-local clock time)? Handles ranges that
 * cross midnight (e.g. 20:00 -> 07:00). Used by scheduled dark mode and display quiet hours. */
export function inTimeWindow(from: string, to: string, now = new Date()): boolean {
  const [fh, fm] = from.split(':').map(Number)
  const [th, tm] = to.split(':').map(Number)
  if ([fh, fm, th, tm].some(Number.isNaN)) return false
  const cur = now.getHours() * 60 + now.getMinutes()
  const start = fh * 60 + fm
  const end = th * 60 + tm
  if (start === end) return false
  return start < end ? cur >= start && cur < end : cur >= start || cur < end
}

/** A paired display (display key) always is one; any other device when its own "Use as a wall
 * screen" switch is on. Display purposes only: it never changes what the device may do. */
export const isWallScreen = (scope: string, device: { wallScreen?: boolean }) => scope === 'display' || !!device.wallScreen

/** Default for "Keep the screen on" and "Back to the calendar when idle" when this device hasn't
 * set them: on for wall screens and kids' devices, off for a parent's own phone or computer. */
export const wallDefaultsOn = (parentDevice: boolean, device: { wallScreen?: boolean }) => !parentDevice || !!device.wallScreen

/** Quiet hours on a wall screen: the Night screen shows once nobody has touched it for WAKE_MS. */
export function nightScreenDue(o: { wall: boolean; quietFrom: string | null; quietTo: string | null; now: Date; lastActive: number }): boolean {
  return o.wall && !!o.quietFrom && !!o.quietTo && inTimeWindow(o.quietFrom, o.quietTo, o.now) && o.now.getTime() - o.lastActive > WAKE_MS
}

/** The remote Night screen from GET /api/rev (Home Assistant, a parent, a connected app): on, or null. */
export type RemoteNight = { on: boolean; since: string; until: string } | null

/** What identifies one remote "on": its start time. '' = off. */
export const remoteNightKey = (remote: RemoteNight) => (remote?.on ? remote.since : '')

/** What a wall screen does when a poll brings the remote state. `seen` is the key it last acted on
 * (undefined before the first poll). It acts only on a change, so after a local tap wakes it while
 * the remote state is still on, it stays awake until the next remote change (or quiet hours). */
export function remoteNightAction(seen: string | undefined, remote: RemoteNight | undefined, wall: boolean): 'start' | 'stop' | null {
  if (!wall || remote === undefined) return null
  const key = remoteNightKey(remote)
  if (key === (seen ?? '')) return null
  return key ? 'start' : 'stop'
}

/** What a device is (server auth.ts deviceKindOwner): a paired device is the family's wall screen
 * or a kid's own device; 'grownup' is a parent's own full-access device. A paired device found
 * with a grown-up owner (paired before that was refused) reads 'grownup' here: it needs a fix. */
export type DeviceKind = 'wall' | 'kid' | 'grownup'

/** A device's kind: the one saved on it, else what its owner says (older keys). Null when nobody's said. */
export function deviceKindOf(key: { kind?: DeviceKind | null; owner?: string | null }, members: { id: string; grownUp?: boolean }[]): DeviceKind | null {
  if (key.kind) return key.kind
  if (!key.owner) return null
  if (key.owner === 'shared') return 'wall'
  return members.find(m => m.id === key.owner)?.grownUp ? 'grownup' : 'kid'
}

/** The pairing picker's value: 'wall' or kid:memberId. '' when nobody's said, or it needs a fix. */
export function deviceKindValue(key: { kind?: DeviceKind | null; owner?: string | null }, members: { id: string; grownUp?: boolean }[]): string {
  const kind = deviceKindOf(key, members)
  return kind === 'wall' ? 'wall' : kind === 'kid' ? `kid:${key.owner}` : ''
}

export function parseDeviceKind(value: string): { kind: DeviceKind; owner?: string } {
  const [kind, owner] = value.split(':')
  return owner ? { kind: kind as DeviceKind, owner } : { kind: kind as DeviceKind }
}
