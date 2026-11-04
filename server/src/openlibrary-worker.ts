// One object for the whole hosted service, so families share pacing, cache and cooldown.
import { DurableObject } from 'cloudflare:workers';
import { msg } from './i18n.ts';
import { OpenLibraryClient, type LibraryState } from './openlibrary.ts';

export class OpenLibrary extends DurableObject<{ OPEN_LIBRARY_CONTACT?: string }> {
  private client: OpenLibraryClient;
  constructor(ctx: DurableObjectState, env: { OPEN_LIBRARY_CONTACT?: string }) {
    super(ctx, env);
    this.client = new OpenLibraryClient({
      contact: env.OPEN_LIBRARY_CONTACT,
      state: ctx.storage.kv.get<LibraryState>('state'),
      // Retain spacing and cooldown through eviction; the bounded public metadata cache is ephemeral.
      save: async state => { ctx.storage.kv.put('state', state); },
    });
  }
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try { return Response.json(await this.client.json(url.pathname + url.search)); }
    catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : msg('Open Library is unavailable') }, { status: 502 });
    }
  }
}
