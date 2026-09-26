// Just enough ZIP for the photo export/import (routes/photos.ts), no dependencies. Writing: STORE
// only (photos are already compressed), streamed one file at a time. Reading: STORE and DEFLATE, so
// a zip re-saved by a desktop tool still imports. No ZIP64: the photo quota keeps us far below 4 GB.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export type ZipFile = { name: string; data: Uint8Array; modified: Date };

function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(1980, d.getUTCFullYear());
  return {
    time: (d.getUTCHours() << 11) | (d.getUTCMinutes() << 5) | (d.getUTCSeconds() >> 1),
    date: ((year - 1980) << 9) | ((d.getUTCMonth() + 1) << 5) | d.getUTCDate(),
  };
}

// Each file is already in memory when it's written, so its CRC and size go straight into the local
// header. That's why there's no data descriptor: it only exists for writers that don't know them
// yet, and STORE plus a descriptor breaks streaming readers (e.g. Java's ZipInputStream).
function header(sig: number, size: number, fill: (v: DataView) => void): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(size);
  const v = new DataView(b.buffer);
  v.setUint32(0, sig, true);
  fill(v);
  return b;
}

/** Streams a zip of the files `next` hands out one at a time (null = done), so only one file's
 * bytes are held at once, never the whole archive. */
export function zipStream(next: () => Promise<ZipFile | null>): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  const central: Uint8Array[] = [];
  let offset = 0;
  let count = 0;
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const file = await next();
      if (!file) {
        const cdSize = central.reduce((n, c) => n + c.length, 0);
        for (const c of central) ctrl.enqueue(c);
        ctrl.enqueue(header(0x06054b50, 22, (v) => {
          v.setUint16(8, count, true);
          v.setUint16(10, count, true);
          v.setUint32(12, cdSize, true);
          v.setUint32(16, offset, true);
        }));
        ctrl.close();
        return;
      }
      const name = enc.encode(file.name);
      const crc = crc32(file.data);
      const { time, date } = dosDateTime(file.modified);
      // Shared fields: version needed, flags (bit 11 = UTF-8 names), method 0 = STORE, time, date, crc, sizes, name length.
      const common = (v: DataView, at: number) => {
        v.setUint16(at, 20, true);
        v.setUint16(at + 2, 0x0800, true);
        v.setUint16(at + 4, 0, true);
        v.setUint16(at + 6, time, true);
        v.setUint16(at + 8, date, true);
        v.setUint32(at + 10, crc, true);
        v.setUint32(at + 14, file.data.length, true);
        v.setUint32(at + 18, file.data.length, true);
        v.setUint16(at + 22, name.length, true);
      };
      const local = header(0x04034b50, 30 + name.length, (v) => common(v, 4));
      local.set(name, 30);
      const cd = header(0x02014b50, 46 + name.length, (v) => {
        v.setUint16(4, 20, true); // version made by
        common(v, 6);
        v.setUint32(42, offset, true);
      });
      cd.set(name, 46);
      central.push(cd);
      ctrl.enqueue(local);
      ctrl.enqueue(file.data);
      offset += local.length + file.data.length;
      count++;
    },
  });
}

export type ZipEntry = { name: string; size: number; read: (max?: number) => Promise<Uint8Array | null> };

/** Lists a zip's entries from its central directory; `read()` returns the bytes, or null when the
 * entry is encrypted, uses another method, or is past `cap` bytes (`read(max)` overrides it; a zip
 * bomb stops inflating there). */
export function readZip(zip: Uint8Array, cap: number): ZipEntry[] {
  const v = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 22 - 65535); i--) {
    if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file');
  const dec = new TextDecoder();
  const entries: ZipEntry[] = [];
  let p = v.getUint32(eocd + 16, true);
  for (let n = v.getUint16(eocd + 10, true); n > 0; n--) {
    if (p + 46 > zip.length || v.getUint32(p, true) !== 0x02014b50) throw new Error('damaged zip central directory');
    const flags = v.getUint16(p + 8, true);
    const method = v.getUint16(p + 10, true);
    const csize = v.getUint32(p + 20, true);
    const usize = v.getUint32(p + 24, true);
    const nameLen = v.getUint16(p + 28, true);
    const skip = nameLen + v.getUint16(p + 30, true) + v.getUint16(p + 32, true);
    const localAt = v.getUint32(p + 42, true);
    const name = dec.decode(zip.subarray(p + 46, p + 46 + nameLen));
    p += 46 + skip;
    entries.push({
      name,
      size: usize,
      read: async (max = cap) => {
        if (flags & 1 || localAt + 30 > zip.length || v.getUint32(localAt, true) !== 0x04034b50) return null;
        const start = localAt + 30 + v.getUint16(localAt + 26, true) + v.getUint16(localAt + 28, true);
        const data = zip.subarray(start, start + csize);
        if (data.length < csize) return null;
        if (method === 0) return data.length <= max ? data : null;
        if (method === 8) return inflateRaw(data, max);
        return null;
      },
    });
  }
  return entries;
}

async function inflateRaw(data: Uint8Array, cap: number): Promise<Uint8Array | null> {
  const reader = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > cap) { await reader.cancel(); return null; }
      parts.push(value);
    }
  } catch {
    return null; // corrupt deflate data
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
