// Build version, from server/package.json. Only exposed to authenticated clients (GET /api/me, MCP
// initialize) - never on public endpoints, so scanners can't cheaply find vulnerable releases.
import pkg from '../package.json' with { type: 'json' };

export const VERSION: string = pkg.version;
