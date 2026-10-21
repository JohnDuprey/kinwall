import { msg } from './i18n.ts'
import type { Features } from './types.ts'

export type FeatureRow = { key: keyof Features; label: string; sub: string; section: 'Everyday' | 'Spaces'; group?: string }

/** Every household feature has one row here, so the settings list and its summary stay complete.
 * Two headings: Everyday (the small things used daily) and Nooks (areas of their own with several
 * parts inside). "Nooks" is only ever a heading; the tabs keep their own names. */
export const FEATURE_ROWS: readonly FeatureRow[] = [
  { key: 'chores', section: 'Everyday', label: msg('Chores & points'), sub: msg('The Chores tab and chore library, points, rewards and the sticker book. The leaderboard, sticker shop and rewards have their own switches in Family → Chores.') },
  { key: 'lists', section: 'Everyday', label: msg('Lists'), sub: msg('The Lists tab with Groceries and shopping mode, “Due soon” and list counts on the Board, and tasks on events.') },
  { key: 'notes', section: 'Everyday', label: msg('Notes'), sub: msg('Discussions on events and list items. An item’s own notes still show.') },
  { key: 'messages', section: 'Everyday', label: msg('Family messages'), sub: msg('Sending a message from the bell. Messages already sent still show.') },
  { key: 'polls', section: 'Everyday', label: msg('Family polls'), sub: msg('Polls everyone votes in, like “Which movie tonight?”, on the Board and in the bell. With Meals on, choices can be recipes and a poll can plan the meal.') },
  { key: 'checkIns', section: 'Everyday', label: msg('Check-ins & journal'), sub: msg('Temp check, goal checks, the energy battery, journals and Insights. Who gets them is set per person in Family.') },
  { key: 'meals', section: 'Spaces', label: msg('Meals'), sub: msg('The Meals tab with recipes, cooking mode, the restaurant binder, order nights and the week’s plan, and today’s meals on the Board and in the daily summary.') },
  { key: 'outings', section: 'Spaces', label: msg('Outings'), sub: msg('Things to do and places to go, who wants to go, and ticket dates. The Outings tab and its button on the Board.') },
  { key: 'trackersReading', section: 'Spaces', group: msg('Trackers'), label: msg('Reading'), sub: msg('Books and audiobooks with progress and ratings, the library and its due dates, and the reading line in someone’s day.') },
  { key: 'trackersMemories', section: 'Spaces', group: msg('Trackers'), label: msg('Memories'), sub: msg('Moments and photos for each person or the family.') },
  { key: 'trackersHealth', section: 'Spaces', group: msg('Trackers'), label: msg('Health'), sub: msg('Doctor and dentist visits, and medicine reminders. Health stays on phones and computers, never on the wall screen.') },
  { key: 'paint', section: 'Spaces', group: msg('Activities'), label: msg('Paint'), sub: msg('Drawing and coloring in Activities.') },
  { key: 'photos', section: 'Spaces', group: msg('Activities'), label: msg('Photos'), sub: msg('Family photos in Activities, Newscast and memories, and on the Board and Night screen. Google Photos and nature pictures still show.') },
  { key: 'contacts', section: 'Spaces', label: msg('Contacts'), sub: msg('The household contacts directory.') },
  { key: 'upkeep', section: 'Spaces', label: msg('Home upkeep'), sub: msg('The things you look after, the jobs that keep them working and when each was last done. Reminders, kids’ upkeep chores and supplies for the shopping list.') },
  { key: 'newscast', section: 'Spaces', label: msg('Newscast'), sub: msg('Home’s Newscast tab: chores done, rewards, photos and drawings, books, memories, birthdays and announcements, with reactions.') },
]
