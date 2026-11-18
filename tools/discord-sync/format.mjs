import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const marker = (kind, id) => `<!-- kinwall-discord-sync:${kind}:${id} -->`;
export const sourceHash = message => hash({ content: message.content, attachments: (message.attachments ?? []).map(a => [a.id, a.filename]) });
export const neutral = value => String(value ?? '').replaceAll('@', '@\u200b');
export const cleanName = value => neutral(value).replace(/[\[\]<>*_`\r\n]/g, '');
// Bump when attribution formatting changes so existing bridge-owned copies refresh in place.
export const IMPORT_FORMAT_VERSION = 2;
const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', year: 'numeric', month: 'short', day: 'numeric' });
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
export function formatTimestamp(value) {
  const date = value ? new Date(value) : undefined;
  return date && Number.isFinite(date.getTime()) ? `${dateFormat.format(date)} at ${timeFormat.format(date)}` : '';
}
export function githubBody(message, url, attachments = []) {
  const files = attachments.map(a => `${a.image ? '!' : ''}[${cleanName(a.filename)}](${a.url})`).join('\n');
  const timestamp = formatTimestamp(message.timestamp);
  return `**${cleanName(message.author.global_name || message.author.username)}**${timestamp ? ` · ${timestamp}` : ''}\n[Original Discord message](${url})\n\n${neutral(message.content)}${files ? `\n\n${files}` : ''}\n\n${marker('discord', message.id)}`;
}
export function discordBody(item) {
  return `**${cleanName(item.user?.login || 'GitHub')}** (GitHub) · ${item.html_url}\n\n${neutral(item.body || '(No description)')}`;
}
export function chunks(text, key) {
  const result = [];
  let remaining = text;
  do {
    const suffix = `\n-# ${key}:${result.length}`;
    const limit = 2000 - suffix.length;
    if (limit < 2) throw new Error('Message marker exceeds Discord limit');
    let take = Math.min(limit, remaining.length);
    if (take < remaining.length && /[\uD800-\uDBFF]/.test(remaining[take - 1])) take--;
    result.push(remaining.slice(0, take) + suffix);
    remaining = remaining.slice(take);
  } while (remaining.length);
  return result;
}
export function extractMarker(body, kind) {
  const escaped = kind.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...String(body ?? '').matchAll(new RegExp(`<!-- kinwall-discord-sync:${escaped}:([0-9]+) -->`, 'g'))].at(-1)?.[1];
}
