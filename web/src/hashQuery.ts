// Links into the app are #/<path>?<query> (notifications, Siri, Spotlight, widgets). Pure, so
// web/test/hashQuery.test.ts covers it.

/** The link's query: `#/meals?recipe=r1` → recipe=r1. */
export const hashQuery = (hash: string) => new URLSearchParams(hash.split('?')[1] ?? '')

/** The link without its query. Put back with history.replaceState once handled, so a reload doesn't run it again. */
export const hashPath = (hash: string) => hash.split('?')[0]
