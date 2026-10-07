import type { Features } from './types.ts'

export type FeatureRow = { key: keyof Features; label: string; sub: string; group?: string }

/** Every household feature has one row here, so the settings list and its summary stay complete. */
export const FEATURE_ROWS: readonly FeatureRow[] = [
  { key: 'chores', label: 'Chores & points', sub: 'The Chores tab and chore library, points, rewards and the sticker book. The leaderboard, sticker shop and rewards have their own switches in Family → Chores.' },
  { key: 'lists', label: 'Lists', sub: 'The Lists tab with Groceries and shopping mode, “Due soon” and list counts on the Board, and tasks on events.' },
  { key: 'contacts', label: 'Contacts', sub: 'The household contacts directory.' },
  { key: 'paint', label: 'Paint', sub: 'Drawing and coloring in Activities.' },
  { key: 'photos', label: 'Photos', sub: 'Family photos in Activities, Newscast and memories, and on the Board and Night screen. Google Photos and nature pictures still show.' },
  { key: 'notes', label: 'Notes', sub: 'Discussions on events and list items. An item’s own notes still show.' },
  { key: 'meals', label: 'Meals', sub: 'The Meals tab with recipes, cooking mode, the restaurant binder, order nights and the week’s plan, and today’s meals on the Board and in the daily summary.' },
  { key: 'messages', label: 'Family messages', sub: 'Sending a message from the bell. Messages already sent still show.' },
  { key: 'newscast', label: 'Newscast', sub: 'Home’s Newscast tab: chores done, rewards, photos and drawings, books, memories, birthdays and announcements, with reactions.' },
  { key: 'checkIns', label: 'Check-ins & journal', sub: 'Temp check, goal checks, the energy battery, journals and Insights. Who gets them is set per person in Family.' },
  { key: 'trackersReading', group: 'Trackers', label: 'Reading', sub: 'Books and audiobooks with progress and ratings, the library and its due dates, and the reading line in someone’s day.' },
  { key: 'trackersMemories', group: 'Trackers', label: 'Memories', sub: 'Moments and photos for each person or the family.' },
  { key: 'trackersHealth', group: 'Trackers', label: 'Health', sub: 'Doctor and dentist visits, and medicine reminders. Health stays on phones and computers, never on the wall screen.' },
]
