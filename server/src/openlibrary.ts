// A bounded metadata client shared by a server, or by a host's singleton Durable Object.
// Only public bibliographic JSON is cached; no family IDs, tokens or request headers.
import type { Env } from './env.ts';
import { words } from './i18n.ts';

export const DEFAULT_OPEN_LIBRARY_CONTACT = 'support@kinwall.family';

export type LibraryState = { next: number; until: number; failures: number };
type Options = {
  contact?: string; fetch?: typeof fetch; now?: () => number; sleep?: (ms: number) => Promise<void>;
  state?: LibraryState; save?: (state: LibraryState) => Promise<void>;
};
export class OpenLibraryClient {
  private cache = new Map<string, { expires: number; value: unknown; bytes: number }>();
  private cachedBytes = 0;
  private pending = new Map<string, Promise<unknown>>();
  private tail: Promise<unknown> = Promise.resolve();
  private state: LibraryState;
  private options: Options;
  constructor(options: Options = {}) {
    this.options = options;
    this.state = options.state ?? { next: 0, until: 0, failures: 0 };
  }
  async json(path: string): Promise<unknown> {
    // Transport errors also appear in logs and MCP; keep them in English.
    const { t } = words('en');
    if (!/^\/search\.json\?[^#]*$/.test(path) && !/^\/works\/OL\d+W\.json$/.test(path)) throw new Error(t('Invalid Open Library API path'));
    const now = this.options.now ?? Date.now;
    const hit = this.cache.get(path);
    if (hit && hit.expires > now()) return structuredClone(hit.value);
    const existing = this.pending.get(path);
    if (existing) return structuredClone(await existing);
    if (this.pending.size >= 10) throw new Error(t('Open Library is busy; try again shortly'));
    // The queue is serialized and capped at ten; discard slots older than three seconds.
    // Cooldowns fail promptly instead of holding requests open during an upstream outage.
    const queuedAt = now();
    const task = this.tail.then(async () => {
      if (this.state.until > now()) throw new Error(t('Open Library is unavailable; try again shortly'));
      const delay = Math.max(0, this.state.next - now());
      if (now() - queuedAt + delay > 3000) throw new Error(t('Open Library is busy; try again shortly'));
      if (delay) await (this.options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(delay);
      const contact = (this.options.contact ?? DEFAULT_OPEN_LIBRARY_CONTACT).trim();
      const identified = !!contact && contact.length <= 200 && !/[\r\n]/.test(contact) && /@/.test(contact);
      this.state.next = now() + (identified ? 334 : 1000);
      await this.options.save?.({ ...this.state });
      let transient = true;
      try {
        const response = await (this.options.fetch ?? fetch)(`https://openlibrary.org${path}`, {
          headers: { 'User-Agent': `Kinwall/1.0 (https://kinwall.family${identified ? `; ${contact}` : ''})`, Accept: 'application/json' },
          signal: AbortSignal.timeout(8000), redirect: 'error',
        });
        if (!response.ok) {
          transient = response.status === 429 || response.status >= 500;
          if (transient) {
            const retry = response.headers.get('Retry-After');
            const seconds = retry && /^\d+$/.test(retry.trim()) ? Number(retry) * 1000 : NaN;
            const deadline = Number.isFinite(seconds) ? now() + seconds : Date.parse(retry ?? '');
            this.state.until = Math.max(this.state.until, Number.isFinite(deadline) ? deadline : 0);
          }
          await response.body?.cancel();
          throw new Error(t('Open Library answered {status}', { status: response.status }));
        }
        // Cap response size as well as entry count. Search results can carry very long ISBN lists.
        const reader = response.body?.getReader();
        if (!reader) throw new Error(t('Open Library returned an empty response'));
        const chunks: Uint8Array[] = [];
        let size = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 1024 * 1024) { await reader.cancel(); throw new Error(t('Open Library response is too large')); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes));
        this.state.failures = 0;
        this.state.until = 0;
        await this.options.save?.({ ...this.state });
        this.cachedBytes -= this.cache.get(path)?.bytes ?? 0;
        this.cache.delete(path);
        this.cachedBytes += size;
        this.cache.set(path, { value, bytes: size, expires: now() + (path.startsWith('/search') ? 3_600_000 : 86_400_000) });
        while (this.cache.size > 50 || this.cachedBytes > 5 * 1024 * 1024) {
          const key = this.cache.keys().next().value!;
          this.cachedBytes -= this.cache.get(key)!.bytes;
          this.cache.delete(key);
        }
        return value;
      } catch (error) {
        if (!transient) throw error;
        this.state.failures = Math.min(this.state.failures + 1, 6);
        this.state.until = Math.max(this.state.until, now() + Math.min(900_000, 30_000 * 2 ** (this.state.failures - 1)));
        await this.options.save?.({ ...this.state });
        throw error;
      }
    });
    this.tail = task.catch(() => {});
    this.pending.set(path, task);
    try { return structuredClone(await task); }
    finally { this.pending.delete(path); }
  }
}

// Node shares one client across all requests. Hosts with multiple isolates must inject a
// coordinated client via OPEN_LIBRARY_JSON (hosted uses one Durable Object for all families).
const clients = new Map<string, OpenLibraryClient>();
export function libraryJson(env: Pick<Env, 'OPEN_LIBRARY_CONTACT' | 'OPEN_LIBRARY_JSON'> | undefined, path: string): Promise<unknown> {
  if (env?.OPEN_LIBRARY_JSON) return env.OPEN_LIBRARY_JSON(path);
  const contact = env?.OPEN_LIBRARY_CONTACT ?? DEFAULT_OPEN_LIBRARY_CONTACT;
  let client = clients.get(contact);
  if (!client) { client = new OpenLibraryClient({ contact }); clients.set(contact, client); }
  return client.json(path);
}
