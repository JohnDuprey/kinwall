import type { Settings } from './types.ts'
import { BrushIcon, ImagesIcon, StickerIcon } from './icons.tsx'
import { msg } from './i18n.ts'

// Activities for the wall (everything here works with a display key). Add a card here and a
// sub-route below for the next one.
const ACTIVITIES = [
  { key: 'paint', title: msg('Paint'), blurb: msg('Draw, color in and save your pictures'), Icon: BrushIcon, color: '#FF9E7A' },
  { key: 'stickers', title: msg('Sticker book'), blurb: msg('Decorate your page with stickers bought with chore points'), Icon: StickerIcon, color: '#B39DFF' },
  { key: 'photos', title: msg('Photos'), blurb: msg('Family pictures for the board and the screensaver'), Icon: ImagesIcon, color: '#7ED9A6' },
] as const

/** The built-in activities this family has on: Paint and Photos have their own feature switches;
 * the sticker book needs chore points and its own switch. None left and no added activity on = no
 * Activities tab (App.tsx). Rewards are their own screen (#/rewards), not an activity. */
export function shownActivities(s: Settings) {
  return ACTIVITIES.filter(a => a.key === 'stickers' ? s.features.chores && s.stickersEnabled : s.features[a.key])
}
