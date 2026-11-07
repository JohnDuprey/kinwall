// Screens are downloaded by the service worker after startup, without executing them. Keep the
// two browser builds separate, and leave the existing optional PDF viewer and language download
// on demand. Files already used by the page are included separately by main.tsx.
export function offlineAssetManifest(bundle) {
  const result = { modern: new Set(), legacy: new Set() }
  for (const file of Object.values(bundle)) {
    if (file.type === 'asset') {
      if (file.fileName.endsWith('.css') || file.fileName.endsWith('/legacy-guard.js')) {
        result.modern.add(file.fileName); result.legacy.add(file.fileName)
      }
      continue
    }
    if (file.name.startsWith('pdf') || /^de(?:-legacy)?$/.test(file.name)) continue
    const target = result[file.fileName.includes('-legacy-') ? 'legacy' : 'modern']
    target.add(file.fileName)
    // Guard imports have distinct query strings for Safari 15; cache those exact URLs too.
    for (const match of file.code.matchAll(/['"]\.\/legacy-guard\.js\?([^'"]+)['"]/g)) target.add(`assets/legacy-guard.js?${match[1]}`)
  }
  return Object.fromEntries(Object.entries(result).map(([key, values]) => [key, [...values].sort()]))
}
