// Route tests control upstream answers through fetch. Each replacement represents a fresh
// upstream fixture; client behavior itself is covered with a deterministic clock in openlibrary.test.
import { OpenLibraryClient } from '../src/openlibrary.ts';
export function testLibraryJson() {
  let upstream: typeof fetch;
  let client: OpenLibraryClient;
  let now = 0;
  return (path: string) => {
    if (upstream !== globalThis.fetch) {
      upstream = globalThis.fetch;
      client = new OpenLibraryClient({ fetch: upstream, now: () => now, sleep: async ms => { now += ms; } });
    }
    return client.json(path);
  };
}
