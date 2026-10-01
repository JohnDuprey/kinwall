import type { Features } from './types.ts'

export type FeatureRow = { key: keyof Features; label: string; sub: string; group?: string }

/** Every household feature has one row here, so the settings list and its summary stay complete. */
export const FEATURE_ROWS: readonly FeatureRow[] = [
  { key: 'chores', label: 'Chores & points', sub: 'The Chores tab, points and the sticker book. The leaderboard and sticker shop have their own switches in Family → Chores.' },
  { key: 'lists', label: 'Lists', sub: 'The Lists tab, “Due soon” on the Board and tasks on events.' },
  { key: 'contacts', label: 'Contacts', sub: 'The household contacts directory.' },
  { key: 'paint', label: 'Paint', sub: 'Drawing and coloring in Activities.' },
  { key: 'photos', label: 'Photos', sub: 'Family photos in Activities and the Board’s picture card.' },
  { key: 'notes', label: 'Notes', sub: 'Notes and discussions on events and list items.' },
  { key: 'meals', label: 'Meals', sub: 'The Meals tab with recipes and the week’s plan, and today’s meals on the Board.' },
  { key: 'messages', label: 'Family messages', sub: 'Sending a message from the bell. Messages already sent still show.' },
  { key: 'newscast', label: 'Newscast', sub: 'Home’s Newscast tab: chores done, rewards, photos, books and announcements, with reactions.' },
  { key: 'trackersReading', group: 'Trackers', label: 'Reading', sub: 'Books with progress and ratings, and the reading line in someone’s day.' },
  { key: 'trackersMemories', group: 'Trackers', label: 'Memories', sub: 'The family journal.' },
  { key: 'trackersHealth', group: 'Trackers', label: 'Health', sub: 'Doctor and dentist visits. Health stays on phones and computers, never on the wall screen.' },
]
