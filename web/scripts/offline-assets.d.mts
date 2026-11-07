export function offlineAssetManifest(bundle: Record<string, { type: string; fileName: string; name?: string; code?: string }>): { modern: string[]; legacy: string[] }
