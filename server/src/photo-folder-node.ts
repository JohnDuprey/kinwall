// Node only. The photo folder node.ts hands routes/photo-folder.ts as PHOTO_FOLDER: a folder on the
// server (PHOTO_FOLDER=/photos, a read-only Docker volume) whose pictures the Night screen and the
// Board show without copying them into Kinwall. Subfolders count; hidden ones (".thumbs", NAS
// thumbnail folders like "@eaDir") don't. Nothing is ever written.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import type { PhotoFolder } from './routes/photo-folder.ts';

// Pictures every browser can show (HEIC and RAW can't be shown in most).
const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif' };
const LIST_MS = 3600_000; // the folder is read again at most hourly: new pictures join within the hour
const hidden = (rel: string) => rel.split(path.sep).some((part) => /^[.@#]/.test(part));

const shuffle = <T>(a: T[]) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export function photoFolder(root: string): PhotoFolder {
  let files: string[] = []; // paths relative to root
  let listedAt = -Infinity;
  let queue: string[] = []; // this pass, taken from the end

  async function list() {
    if (Date.now() - listedAt < LIST_MS) return;
    // ponytail: one recursive read of the whole folder per hour; fine for tens of thousands of pictures.
    const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch((err) => {
      console.error(`Photo folder ${root}: ${(err as Error).message}`);
      return [];
    });
    files = entries
      .filter((e) => e.isFile() && TYPES[path.extname(e.name).toLowerCase()])
      .map((e) => path.relative(root, path.join(e.parentPath, e.name)))
      .filter((rel) => !hidden(rel));
    listedAt = Date.now();
    const still = new Set(files);
    queue = queue.filter((f) => still.has(f));
  }

  return {
    async next() {
      await list();
      for (let tries = 0; tries < 2; tries++) {
        if (!queue.length) queue = shuffle([...files]);
        while (queue.length) {
          const rel = queue.pop()!;
          const bytes = await readFile(path.join(root, rel)).catch(() => null); // deleted since the list was read
          if (!bytes) { listedAt = -Infinity; continue; }
          const dir = path.dirname(rel);
          return { bytes, type: TYPES[path.extname(rel).toLowerCase()], caption: dir === '.' ? undefined : path.basename(dir) };
        }
        await list(); // every picture in the list was gone: read the folder again once
      }
      return null;
    },
  };
}
