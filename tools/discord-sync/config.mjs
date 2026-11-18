import { resolve } from 'node:path';
export function configuration(env = process.env) {
  if (!/^\d+$/.test(env.DISCORD_GUILD_ID || '') || !/^\d+$/.test(env.DISCORD_FORUM_ID || '')) throw new Error('Set numeric Discord IDs: DISCORD_GUILD_ID and DISCORD_FORUM_ID');
  const interval = Number(env.SYNC_INTERVAL_SECONDS || 60) * 1000;
  if (!Number.isSafeInteger(interval) || interval < 15000 || interval > 3600000) throw new Error('Sync interval must be between 15 and 3600 seconds');
  const label = env.DISCORD_SYNC_LABEL || 'discord';
  if (!label.trim() || label.length > 50) throw new Error('Invalid DISCORD_SYNC_LABEL');
  const tagMap = JSON.parse(env.SYNC_TAG_MAP || '{}');
  if (!tagMap || Array.isArray(tagMap) || typeof tagMap !== 'object' || Object.values(tagMap).some(v => typeof v !== 'string' || !v.trim() || v.length > 50)) throw new Error('Tag map must map tag names to label names');
  const relatedIssues = JSON.parse(env.SYNC_RELATED_ISSUES || '{}');
  if (!relatedIssues || typeof relatedIssues !== 'object' || Array.isArray(relatedIssues) || Object.entries(relatedIssues).some(([k, v]) => !/^\d+$/.test(k) || !Number.isSafeInteger(v) || v < 1)) throw new Error('Related issues must map Discord thread IDs to positive GitHub issue numbers');
  const port = Number(env.SYNC_PORT || 8098);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid SYNC_PORT');
  const repo = env.GITHUB_REPOSITORY;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new Error('GITHUB_REPOSITORY must be owner/repository');
  return { guildId: env.DISCORD_GUILD_ID, forumId: env.DISCORD_FORUM_ID, repo, label, tagMap, relatedIssues, defaultTag: env.DISCORD_DEFAULT_TAG, interval, port, host: env.SYNC_HOST || '127.0.0.1', dataDir: resolve(env.SYNC_DATA_DIR || 'data/discord-sync'), assetBase: env.PUBLIC_ASSET_BASE_URL };
}
