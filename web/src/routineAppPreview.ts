/** Demo-only policy illustration. Apple applies the real policy using opaque tokens on the device. */
export function previewAppAccess(mode: 'selected' | 'all', categories: string[], selected: string[], allowed: string[], websiteList: boolean, apps: { id: string; category: string }[]): Record<string, boolean> {
  return Object.fromEntries(apps.map(app => [app.id, app.id === 'kinwall' || (websiteList && app.id === 'safari') || allowed.includes(app.id) || !(mode === 'all' || categories.includes(app.category) || selected.includes(app.id))]))
}
