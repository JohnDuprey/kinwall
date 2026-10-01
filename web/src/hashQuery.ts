// Links into the app are #/<path>?<query> (notifications, Siri, Spotlight, widgets). Pure, so
// web/test/hashQuery.test.ts covers it.

/** The link's query: `#/meals?recipe=r1` → recipe=r1. */
export const hashQuery = (hash: string) => new URLSearchParams(hash.split('?')[1] ?? '')

/** The link without its query. Put back with history.replaceState once handled, so a reload doesn't run it again. */
export const hashPath = (hash: string) => hash.split('?')[0]

/** #/home is the Home screen's own name; underneath it's still #/calendar, which old links (pushes,
 * widgets, Home Assistant) use. Returns the #/calendar link to swap in, or null for any other link. */
export const homeAlias = (hash: string) => /^#\/home(?=$|\?)/.test(hash) ? '#/calendar' + hash.slice(6) : null
