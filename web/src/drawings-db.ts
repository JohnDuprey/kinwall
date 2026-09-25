// Paint's drawings, stored only on this device (IndexedDB 'kinwall-paint'). Shared by Paint and the
// quiet-hours screensaver.
export interface Meta { id: string; name: string; memberId: string | null; created: number; updated: number }
export interface Drawing extends Meta { png: Blob; thumb: Blob }

// IndexedDB, not localStorage: a drawing is a 100-500 KB PNG, and localStorage's ~5 MB cap (strings
// only, so base64 on top) would hold just a handful.
let dbPromise: Promise<IDBDatabase> | null = null
function store<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('kinwall-paint', 1)
    req.onupgradeneeded = () => req.result.createObjectStore('drawings', { keyPath: 'id' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => { dbPromise = null; reject(req.error) }
  })
  return dbPromise.then(db => new Promise<T>((resolve, reject) => {
    const r = fn(db.transaction('drawings', mode).objectStore('drawings'))
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  }))
}
export const listDrawings = () => store<Drawing[]>('readonly', s => s.getAll()).then(all => all.sort((a, b) => b.updated - a.updated))
export const getDrawing = (id: string) => store<Drawing | undefined>('readonly', s => s.get(id))
export const countDrawings = () => store<number>('readonly', s => s.count())
export const putDrawing = (d: Drawing) => store('readwrite', s => s.put(d))
export const deleteDrawing = (id: string) => store('readwrite', s => s.delete(id))
/** Just the ids - the screensaver loads one PNG at a time instead of every drawing at once. */
export const drawingIds = () => store<string[]>('readonly', s => s.getAllKeys() as IDBRequest<string[]>)
