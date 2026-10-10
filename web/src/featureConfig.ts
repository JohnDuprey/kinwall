import type { Features } from './types.ts'

export type FeatureRow = { key: keyof Features; label: string; sub: string; section: 'Everyday' | 'Nooks'; group?: string }

/** Every household feature has one row here, so the settings list and its summary stay complete.
 * Two headings: Everyday (the small things used daily) and Nooks (spaces of their own with several
 * parts inside). "Nooks" is only ever a heading; the tabs keep their own names. */
export const FEATURE_ROWS: readonly FeatureRow[] = [
  { key: 'chores', section: 'Everyday', label: 'Chores & points', sub: 'The Chores tab and chore library, points, rewards and the sticker book. The leaderboard, sticker shop and rewards have their own switches in Family → Chores.' },
  { key: 'lists', section: 'Everyday', label: 'Lists', sub: 'The Lists tab with Groceries and shopping mode, “Due soon” and list counts on the Board, and tasks on events.' },
  { key: 'notes', section: 'Everyday', label: 'Notes', sub: 'Discussions on events and list items. An item’s own notes still show.' },
  { key: 'messages', section: 'Everyday', label: 'Family messages', sub: 'Sending a message from the bell. Messages already sent still show.' },
  { key: 'polls', section: 'Everyday', label: 'Family polls', sub: 'Polls everyone votes in, like “Which movie tonight?”, on the Board and in the bell. With Meals on, choices can be recipes and a poll can plan the meal.' },
  { key: 'checkIns', section: 'Everyday', label: 'Check-ins & journal', sub: 'Temp check, goal checks, the energy battery, journals and Insights. Who gets them is set per person in Family.' },
  { key: 'meals', section: 'Nooks', label: 'Meals', sub: 'The Meals tab with recipes, cooking mode, the restaurant binder, order nights and the week’s plan, and today’s meals on the Board and in the daily summary.' },
  { key: 'outings', section: 'Nooks', label: 'Outings', sub: 'Things to do and places to go, who wants to go, and ticket dates. The Outings tab and its button on the Board.' },
  { key: 'trackersReading', section: 'Nooks', group: 'Trackers', label: 'Reading', sub: 'Books and audiobooks with progress and ratings, the library and its due dates, and the reading line in someone’s day.' },
  { key: 'trackersMemories', section: 'Nooks', group: 'Trackers', label: 'Memories', sub: 'Moments and photos for each person or the family.' },
  { key: 'trackersHealth', section: 'Nooks', group: 'Trackers', label: 'Health', sub: 'Doctor and dentist visits, and medicine reminders. Health stays on phones and computers, never on the wall screen.' },
  { key: 'paint', section: 'Nooks', group: 'Activities', label: 'Paint', sub: 'Drawing and coloring in Activities.' },
  { key: 'photos', section: 'Nooks', group: 'Activities', label: 'Photos', sub: 'Family photos in Activities, Newscast and memories, and on the Board and Night screen. Google Photos and nature pictures still show.' },
  { key: 'contacts', section: 'Nooks', label: 'Contacts', sub: 'The household contacts directory.' },
  { key: 'newscast', section: 'Nooks', label: 'Newscast', sub: 'Home’s Newscast tab: chores done, rewards, photos and drawings, books, memories, birthdays and announcements, with reactions.' },
]
