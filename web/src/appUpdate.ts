/** Is a freshly fetched app shell a newer build than the page showing? Only when it is Kinwall's
 * shell (it loads a script from /assets/) and that script isn't `mine`. Anything else, like Home
 * Assistant's own page answering a wrong path, says nothing about Kinwall. */
export function shellIsNewer(html: string, mine: string): boolean {
  return /<script[^>]+src="[^"]*\/assets\/[^"]+\.js"/.test(html) && !html.includes(mine)
}

/** Where this page's app shell lives: its own base, which isn't the site root behind a proxy path
 * (Home Assistant's ingress serves Kinwall under /api/hassio_ingress/<token>/). */
export const shellUrl = () => new URL('.', document.baseURI).href

/** The app didn't start (its script failed to load, e.g. a dropped connection at launch or a build
 * replaced mid-load, or it crashed): reload once to fetch it fresh. Not again within a minute, so a
 * page that keeps failing shows its Reload button instead of reloading forever. */
export function retryBoot(storage: Pick<Storage, 'getItem' | 'setItem'>, now = Date.now()): boolean {
  if (now - (Number(storage.getItem('kinwall.bootRetry')) || 0) < 60_000) return false
  storage.setItem('kinwall.bootRetry', String(now))
  return true
}
