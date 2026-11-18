// Calendar feed downloads stop at a size cap and an overall timeout, like recipe and image downloads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchIcsConditional } from '../src/providers/ics.ts';
import { MAX_FEED_BYTES } from '../src/outbound.ts';

const URL_ = 'https://town.example/calendar.ics';
const env = (body: () => ReadableStream<Uint8Array>, headers: Record<string, string> = {}) => ({
  OUTBOUND_FETCH: async (_: unknown, init?: RequestInit) => new Response(body(), { headers: { 'content-type': 'text/calendar', ...headers } }),
});

test('feeds: a calendar bigger than the cap is refused, even without a content-length', async () => {
  const chunk = new Uint8Array(1024 * 1024).fill(65);
  let sent = 0;
  const endless = () => new ReadableStream<Uint8Array>({ pull(ctl) { sent++; ctl.enqueue(chunk); } });
  await assert.rejects(fetchIcsConditional(env(endless), URL_, null, null), /larger than \d+ MB/);
  assert.ok(sent <= MAX_FEED_BYTES / chunk.byteLength + 2, 'stopped reading at the cap');
  await assert.rejects(fetchIcsConditional(env(() => new ReadableStream({ start(c) { c.close(); } }), { 'content-length': String(MAX_FEED_BYTES + 1) }), URL_, null, null), /larger than/);
});

test('feeds: a download that never finishes stops at the timeout', async () => {
  // Sends one line, then nothing; the abort ends the stream.
  const OUTBOUND_FETCH = async (_: unknown, init?: RequestInit) => new Response(new ReadableStream<Uint8Array>({
    start(ctl) { ctl.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR\r\n')); init?.signal?.addEventListener('abort', () => ctl.error(init.signal!.reason)); },
  }));
  await assert.rejects(fetchIcsConditional({ OUTBOUND_FETCH }, URL_, null, null, 50), /took longer than/);
});

test('feeds: a normal calendar still reads', async () => {
  const text = 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n';
  const r = await fetchIcsConditional(env(() => new Response(text).body!, { etag: '"1"' }), URL_, null, null);
  assert.deepEqual(r, { notModified: false, text, etag: '"1"', lastModified: null });
});
