// Smart displays that show Kinwall through a Cast receiver (a Google Nest Hub with Home Assistant's
// DashCast, CATT's cast_site): a 7" or 10" touch screen, 1024×600 or 1280×800, read from across the
// kitchen. "Cast screen" mode (styles.css [data-cast]) draws everything bigger and lets the Board
// share out the short screen instead of scrolling. Pure, so node tests load it.

/** A Cast device's browser says so in its user agent ("… CrKey/1.56.500000 …"). */
export const isCastAgent = (ua: string) => /\bCrKey\//.test(ua)

/** `?screen=cast` turns cast mode on for this device, `?screen=normal` off; anything else leaves it. */
export function screenParam(search: string): boolean | undefined {
  const v = new URLSearchParams(search).get('screen')
  return v === 'cast' ? true : v === 'normal' ? false : undefined
}

/** Whether this device runs as a cast screen: its stored choice (from the link), else its user agent. */
export const castScreen = (saved: boolean | undefined, ua: string) => saved ?? isCastAgent(ua)

/** How much bigger the cast screen's sizes are drawn, from the window's height: 1 on a 600px-tall
 * screen, more when the receiver lays the page out taller (720 or 800), so it looks the same. */
export const castScale = (height: number) => Math.min(1.4, Math.max(1, height / 600))

/** The address without `screen=` (after it's stored), so a reload or a shared link doesn't carry it. */
export function withoutScreenParam(href: string): string {
  const u = new URL(href)
  u.searchParams.delete('screen')
  return u.toString()
}
