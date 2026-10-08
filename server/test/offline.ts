// Loaded before every test file (package.json "test"): Open Library is never called for real. A book
// added without details is looked up in the background (book-details.ts); unless a test mocks
// fetch, that lookup fails here and nothing is recorded.
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const host = new URL(url).hostname;
  if (host === 'openlibrary.org' || host.endsWith('.openlibrary.org')) throw new Error('no network in tests');
  return realFetch(input, init);
}) as typeof fetch;
