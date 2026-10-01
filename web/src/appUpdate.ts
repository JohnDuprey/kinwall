/** Is a freshly fetched app shell a newer build than the page showing? Only when it is Kinwall's
 * shell (it loads a script from /assets/) and that script isn't `mine`. Anything else, like Home
 * Assistant's own page answering a wrong path, says nothing about Kinwall. */
export function shellIsNewer(html: string, mine: string): boolean {
  return /<script[^>]+src="[^"]*\/assets\/[^"]+\.js"/.test(html) && !html.includes(mine)
}

/** Where this page's app shell lives: its own base, which isn't the site root behind a proxy path
 * (Home Assistant's ingress serves Kinwall under /api/hassio_ingress/<token>/). */
export const shellUrl = () => new URL('.', document.baseURI).href
