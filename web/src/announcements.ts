export type AnnouncementInput = { title: string; details: string; startsAt: string; expiresAt: string; priority: 'normal' | 'important' }
export type Announcement = AnnouncementInput & { id: string; createdAt: string; updatedAt: string }
export type Announcements = { announcements: Announcement[]; nextChangeAt: string | null }
export const activeAnnouncements = (items: Announcement[], now = Date.now()) => items.filter(a => Date.parse(a.startsAt) <= now && now < Date.parse(a.expiresAt))
export const announcementStatus = (a: Announcement, now = Date.now()) => now < Date.parse(a.startsAt) ? 'scheduled' : now >= Date.parse(a.expiresAt) ? 'expired' : 'active'

/** datetime-local is explicitly labeled with this device's timezone in the editor. */
export function announcementLocalInput(iso: string): string {
  const d = new Date(iso), pad = (n: number) => String(n).padStart(2, '0')
  if (Number.isNaN(d.getTime())) return ''
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
export function announcementTimestamp(input: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) return null
  const d = new Date(input)
  if (Number.isNaN(d.getTime())) return null
  const iso = d.toISOString()
  return announcementLocalInput(iso) === input ? iso : null // reject missing DST times and rolled-over dates
}
