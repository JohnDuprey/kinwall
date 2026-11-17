import { Store } from '../store.mjs';
import { Bridge } from '../bridge.mjs';
export function fixture() {
  const messages = new Map([['100', [{ id: '100', content: 'Track activities', timestamp: '2026-01-01', author: { id: '20', username: 'Sam' }, attachments: [] }, { id: '101', content: 'Reply', timestamp: '2026-01-02', author: { id: '21', username: 'Alex' }, attachments: [] }]]]);
  const threads = [{ id: '100', name: 'Activity log', parent_id: '2', thread_metadata: { archived: false }, applied_tags: [] }];
  const issues = [];
  const comments = new Map();
  let next = 1000;
  const writes = [];
  const discord = {
    actor: { id: '99' }, threads: async () => structuredClone(threads), messages: async id => structuredClone(messages.get(id) || []),
    createThread: async payload => { writes.push(['thread', payload]); const id = String(++next); const t = { id, name: payload.name, parent_id: '2', thread_metadata: { archived: false }, applied_tags: [] }; threads.push(t); messages.set(id, [{ id, content: payload.message.content, author: { id: '99', bot: true }, attachments: [] }]); return t; },
    createMessage: async (id, payload) => { writes.push(['message', id, payload]); const m = { id: String(++next), content: payload.content, author: { id: '99', bot: true }, attachments: [] }; messages.get(id).push(m); return m; },
    updateMessage: async (threadId, id, payload) => { writes.push(['edit-message', threadId, id, payload]); Object.assign(messages.get(threadId).find(m => m.id === id), payload); },
    updateThread: async (id, payload) => { writes.push(['edit-thread', id, payload]); Object.assign(threads.find(t => t.id === id), payload); },
  };
  const github = {
    actor: { id: 99 }, issues: async () => structuredClone(issues), comments: async id => structuredClone(comments.get(id) || []),
    createIssue: async payload => { writes.push(['issue', payload]); const i = { ...payload, id: ++next, number: next, user: { id: 99, login: 'bridge' }, html_url: `https://github.com/example/repo/issues/${next}`, state: 'open' }; issues.push(i); comments.set(i.number, []); return structuredClone(i); },
    updateIssue: async (id, payload) => { writes.push(['edit-issue', id, payload]); Object.assign(issues.find(i => i.number === id), payload); },
    createComment: async (id, body) => { writes.push(['comment', id, body]); const c = { id: ++next, body, user: { id: 99, login: 'bridge' }, html_url: 'https://github.com/example/repo/issues/1#issuecomment-2' }; comments.get(id).push(c); return structuredClone(c); },
    updateComment: async (id, body) => { writes.push(['edit-comment', id, body]); for (const list of comments.values()) { const c = list.find(c => c.id === id); if (c) c.body = body; } },
  };
  const config = { guildId: '1', forumId: '2', repo: 'example/repo', label: 'discord', tagMap: {}, terms: [] };
  const store = new Store(':memory:', 'scope');
  const bridge = new Bridge({ config, store, discord, github, assets: { copy: async a => ({ ...a, url: 'https://files.example/a' }) }, apply: true });
  return { bridge, store, discord, github, config, threads, messages, issues, comments, writes };
}

export function fakeGithub() {
  const files = [];
  let release; let next = 0;
  return {
    actor: { id: 99 }, repo: 'example/kinwall',
    release: async () => release,
    createStorageRelease: async tag => (release = { id: 1, tag_name: tag, prerelease: true, draft: false }),
    releaseAssets: async () => files.map(({ bytes, ...f }) => f),
    uploadAsset: async (_, name, bytes, type) => { const f = { id: ++next, name, bytes: Buffer.from(bytes), state: 'uploaded', content_type: type, browser_download_url: `https://github.com/example/kinwall/releases/download/discord-sync-data/${name}` }; files.push(f); return { ...f, bytes: undefined }; },
    downloadAsset: async id => files.find(f => f.id === id).bytes,
    deleteAsset: async id => { files.splice(files.findIndex(f => f.id === id), 1); }, files,
  };
}
