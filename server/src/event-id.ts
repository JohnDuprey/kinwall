// Deterministic ids for synced (remote-kind) event rows, so an event keeps the same Kinwall id
// across syncs (the row itself is still deleted/reinserted wholesale - only the id is stable),
// letting the UI/API/MCP/HA track it. id = 'e_' + first 24 hex chars of sha256(calendarId + '\n'
// + externalId). Used by every insert path: full sync, chunked sync ticks, and the write-through
// create in routes/events.ts.
export async function deterministicEventId(calendarId: string, externalId: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${calendarId}\n${externalId}`));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `e_${hex.slice(0, 24)}`;
}

// A duplicate externalId within one sync batch (rare, but providers don't guarantee uniqueness
// within a window) would otherwise collide on the id PK - suffix like ICS's own '#n' scheme.
export async function deterministicEventIds(calendarId: string, externalIds: string[]): Promise<string[]> {
  const seen = new Map<string, number>();
  return Promise.all(
    externalIds.map((externalId) => {
      const n = seen.get(externalId) ?? 0;
      seen.set(externalId, n + 1);
      return deterministicEventId(calendarId, n === 0 ? externalId : `${externalId}#${n}`);
    }),
  );
}
