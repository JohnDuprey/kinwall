/** The HTML carries this build's deferred files, so an old open page never caches a newer
 * build's chunks by mistake. Only assets below this app's own base may enter its shell cache. */
export function shellAssetUrls(serialized: string | null, base: string, legacy: boolean): string[] {
  try {
    const files: unknown = JSON.parse(serialized ?? '{}')[legacy ? 'legacy' : 'modern']
    if (!Array.isArray(files)) return []
    const prefix = new URL('assets/', base).href
    return files.filter((file): file is string => typeof file === 'string' && file.startsWith('assets/'))
      .map(file => new URL(file, base).href).filter(url => url.startsWith(prefix))
  } catch { return [] }
}
