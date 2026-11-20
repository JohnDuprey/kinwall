// Room for what families upload into the database (photos, upkeep files). The host sets the limit
// (env STORAGE_LIMIT_BYTES; hosted does); unset means no limit, so a self-hosted server can fill its disk.
import type { Env } from './env.ts';
import { stored } from './i18n.ts';

export const STORAGE_FULL = stored('error', 'Storage is full — delete some photos or files first');
// The server's own disk ran out (self-hosted): SQLite refuses every write until there's room again.
export const DISK_FULL = stored('error', "The server's disk is full. Free up space on it, then try again.");

export function storageLimit(env: Env): number | null {
  const n = Number(env.STORAGE_LIMIT_BYTES);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export const USED_SQL = '(SELECT COALESCE(SUM(bytes), 0) FROM photos) + (SELECT COALESCE(SUM(bytes), 0) FROM upkeep_files)';

// The tail of an INSERT ... SELECT, so two uploads racing can't both squeeze past the limit.
export const ROOM_SQL = `WHERE ? IS NULL OR ${USED_SQL} + ? <= ?`;
export const roomArgs = (env: Env, bytes: number) => {
  const limit = storageLimit(env);
  return [limit, bytes, limit] as const;
};
