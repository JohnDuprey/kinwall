import { createHash } from 'node:crypto';
export const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const marker = (kind, id) => `<!-- kinwall-discord-sync:${kind}:${id} -->`;
export const sourceHash = message => hash({ content: message.content, attachments: (message.attachments ?? []).map(a => [a.id, a.filename]) });
export const neutral = value => String(value ?? '').replaceAll('@', '@\u200b');
export const cleanName = value => neutral(value).replace(/[\[\]<>*_`\r\n]/g, '');
export function redact(value, terms = []) {
  let text = String(value ?? '');
  for (const term of terms.filter(Boolean)) text = text.replace(new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[redacted]');
  return text;
}
export function githubBody(message, url, attachments = [], terms = []) {
  const files = attachments.map(a => `${a.image ? '!' : ''}[${cleanName(a.filename)}](${a.url})`).join('\n');
  return `**${cleanName(message.author.global_name || message.author.username)}** · ${message.timestamp}\n[Original Discord message](${url})\n\n${neutral(redact(message.content, terms))}${files ? `\n\n${files}` : ''}\n\n${marker('discord', message.id)}`;
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
