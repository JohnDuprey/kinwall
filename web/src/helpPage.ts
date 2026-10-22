// Help → "Help with this page": the docs page for the screen that's open (#/meals → using/meals).

const PAGES = new Set(['activities', 'calendar', 'chores', 'contacts', 'insights', 'journal', 'lists', 'meals', 'medications', 'newscast', 'outings', 'photos', 'upkeep', 'polls', 'rewards', 'trackers'])
const ALIASES: Record<string, string> = { home: 'calendar', board: 'calendar', profile: 'profiles', recipes: 'meals', restaurants: 'meals', stickers: 'activities', paint: 'activities' }
const TABS = new Set(['general', 'family', 'calendars', 'access'])

/** The docs path for a hash, or null when there's no page for it (the docs home is linked already). */
export function helpPath(hash: string): string | null {
  const [path, query = ''] = hash.replace(/^#\/?/, '').split('?')
  const first = path.split('/')[0] || 'home'
  if (first === 'settings') {
    const tab = new URLSearchParams(query).get('tab') ?? 'general'
    return `settings/${TABS.has(tab) ? tab : 'general'}`
  }
  const page = ALIASES[first] ?? first
  return PAGES.has(page) || page === 'profiles' ? `using/${page}` : null
}
