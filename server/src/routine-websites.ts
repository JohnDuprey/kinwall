/** Store hosts only, never credentials, query strings, wildcard rules or whole URLs. */
export function schoolDomain(input: string): string | null {
  try {
    const url = new URL(input.includes('://') ? input.trim() : `https://${input.trim()}`);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash || host.length > 253) return null;
    const labels = host.split('.');
    if (labels.length < 2 || !labels.every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) || !/^[a-z][a-z0-9-]+$/.test(labels.at(-1)!)) return null;
    return host;
  } catch { return null; }
}
