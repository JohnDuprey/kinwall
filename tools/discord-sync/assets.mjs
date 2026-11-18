import { createHash } from 'node:crypto';
import { mkdir, writeFile, rename, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createServer } from 'node:http';

function mediaType(bytes) {
  if (bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (bytes.subarray(0, 3).equals(Buffer.from('ffd8ff', 'hex'))) return 'image/jpeg';
  if (/^GIF8[79]a/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif';
  if (bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return 'application/octet-stream';
}
export class Assets {
  constructor(directory, base, store, { fetcher = fetch, maxBytes = 20 * 1024 * 1024 } = {}) {
    Object.assign(this, { directory, store, fetcher, maxBytes });
    if (base) {
      const url = new URL(base);
      if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname.replace(/\/$/, '') !== '/assets') throw new Error('PUBLIC_ASSET_BASE_URL must be https://host/assets');
      this.base = url.toString().replace(/\/$/, '');
    }
  }
  async verifyPublic() {
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jC1kAAAAASUVORK5CYII=', 'base64');
    const digest = createHash('sha256').update(bytes).digest('hex');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await writeFile(join(this.directory, digest), bytes, { mode: 0o600 });
    this.store.set(`blob:${digest}`, { type: 'image/png', size: bytes.length });
    const response = await this.fetcher(`${this.base}/${digest}`, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error('Public asset verification failed: endpoint is not reachable');
    const parts = []; let size = 0;
    for await (const part of response.body) {
      size += part.length;
      if (size > bytes.length) throw new Error('Public asset verification failed: unexpected content');
      parts.push(part);
    }
    if (!Buffer.concat(parts).equals(bytes)) throw new Error('Public asset verification failed: unexpected content');
  }
  async copy(attachment) {
    if (!this.base) throw new Error('PUBLIC_ASSET_BASE_URL is required before publishing attachments');
    const cached = this.store.get(`attachment:${attachment.id}`);
    if (cached) {
      try {
        await stat(join(this.directory, cached.hash));
        return { ...cached, url: `${this.base}/${cached.hash}` };
      } catch (error) { if (error.code !== 'ENOENT') throw error; } // fresh Actions runners have no local asset cache
    }
    const url = new URL(attachment.url);
    if (url.protocol !== 'https:' || !['cdn.discordapp.com', 'media.discordapp.net'].includes(url.hostname) || url.username || url.password || url.port) throw new Error('Attachment host is not a trusted Discord CDN host');
    if (attachment.size > this.maxBytes) throw new Error('Attachment exceeds size limit');
    const response = await this.fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Attachment download returned HTTP ${response.status}`);
    if (Number(response.headers.get('content-length')) > this.maxBytes) { await response.body?.cancel(); throw new Error('Attachment exceeds size limit'); }
    const parts = []; let length = 0;
    for await (const part of response.body) {
      length += part.length;
      if (length > this.maxBytes) throw new Error('Attachment exceeds size limit');
      parts.push(part);
    }
    const bytes = Buffer.concat(parts);
    const digest = createHash('sha256').update(bytes).digest('hex');
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    const temp = join(this.directory, `${digest}.tmp`);
    await writeFile(temp, bytes, { mode: 0o600 });
    await rename(temp, join(this.directory, digest));
    const type = mediaType(bytes);
    const result = { hash: digest, filename: attachment.filename, type, size: length, image: type.startsWith('image/') };
    this.store.set(`blob:${digest}`, { type, size: length });
    this.store.set(`attachment:${attachment.id}`, result);
    return { ...result, url: `${this.base}/${digest}` };
  }
}
export function assetServer(assets, health) {
  return createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); return response.end(); }
      if (request.url === '/healthz') {
        const status = health(); response.writeHead(status.status === 'ok' ? 200 : 503, { 'Content-Type': 'application/json' });
        return response.end(request.method === 'HEAD' ? undefined : JSON.stringify(status));
      }
      const digest = request.url?.match(/^\/assets\/([a-f0-9]{64})$/)?.[1];
      const info = digest && assets.store.get(`blob:${digest}`);
      if (!info) { response.writeHead(404); return response.end(); }
      const bytes = await readFile(join(assets.directory, digest));
      response.writeHead(200, { 'Content-Type': info.type, 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=31536000, immutable', 'Content-Security-Policy': "default-src 'none'; sandbox", ...(info.type === 'application/octet-stream' ? { 'Content-Disposition': 'attachment' } : {}) });
      response.end(request.method === 'HEAD' ? undefined : bytes);
    } catch { if (!response.headersSent) response.writeHead(500); response.end(); }
  });
}
