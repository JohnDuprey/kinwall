const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export class Api {
  constructor(base, headers, { fetcher = fetch, sleep: sleeper = sleep } = {}) { Object.assign(this, { base, headers, fetcher, sleep: sleeper }); }
  async request(method, path, body, contentType) {
    if (!path.startsWith('/') || path.startsWith('//')) throw new Error('Invalid API path');
    for (let attempt = 0; attempt < 5; attempt++) {
      let response;
      try {
        response = await this.fetcher(`${this.base}${path}`, { method, headers: { ...this.headers, 'Content-Type': contentType || 'application/json', 'User-Agent': 'Kinwall-Discord-Sync' }, body: body === undefined ? undefined : contentType ? body : JSON.stringify(body), redirect: 'error', signal: AbortSignal.timeout(30000) });
      } catch {
        if (method === 'GET' && attempt < 4) { await this.sleep(1000 * 2 ** attempt); continue; }
        throw new Error(`${method} ${path.split('?')[0]}: network request failed`);
      }
      if (response.status === 429 || (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0')) {
        let seconds = Number(response.headers.get('retry-after'));
        if (!seconds && response.status === 429) { try { seconds = Number((await response.json()).retry_after); } catch { /* use fallback */ } }
        if (!seconds) seconds = Math.max(1, Number(response.headers.get('x-ratelimit-reset')) - Date.now() / 1000) || 1;
        // Long limits leave the operation pending rather than blocking shutdown for minutes.
        if (seconds <= 30 && attempt < 4) { await this.sleep(seconds * 1000); continue; }
      }
      if (method === 'GET' && response.status >= 500 && attempt < 4) { await this.sleep(1000 * 2 ** attempt); continue; }
      if (!response.ok) { const error = new Error(`${method} ${path.split('?')[0]} returned HTTP ${response.status}`); error.status = response.status; throw error; }
      if (response.status === 204) return undefined;
      try { return await response.json(); } catch { throw new Error(`${method} ${path.split('?')[0]} returned invalid JSON`); }
    }
    throw new Error('API retry limit reached');
  }
  async pages(path) {
    const rows = [];
    for (let page = 1; page <= 100; page++) {
      const batch = await this.request('GET', `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('Expected an API list');
      rows.push(...batch);
      if (batch.length < 100) return rows;
    }
    throw new Error('API pagination safety limit reached; refusing a partial snapshot');
  }
}
export class Github {
  constructor(token, repo, { actorLogin } = {}) {
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('GITHUB_REPOSITORY must be owner/repository');
    this.repo = repo; this.actorLogin = actorLogin;
    this.path = `/repos/${repo}`;
    this.api = new Api('https://api.github.com', { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' });
  }
  async init() {
    /* /user also supports an ordinary account token. Installation tokens use /installation/repositories
    // and a bot login supplied by GitHub's app identity; Actions uses its fixed bot identity rather than the PAT-only /user endpoint. */
    this.actor = await this.api.request('GET', this.actorLogin ? `/users/${encodeURIComponent(this.actorLogin)}` : '/user');
    const repo = await this.api.request('GET', this.path);
    if (!repo.has_issues) throw new Error('GitHub Issues must be enabled');
    this.permissions = repo.permissions;
    return repo;
  }
  async issues() { return (await this.api.pages(`${this.path}/issues?state=all&sort=created&direction=asc`)).filter(i => !i.pull_request); }
  comments(number) { return this.api.pages(`${this.path}/issues/${number}/comments`); }
  createIssue(body) { return this.api.request('POST', `${this.path}/issues`, body); }
  updateIssue(number, body) { return this.api.request('PATCH', `${this.path}/issues/${number}`, body); }
  createComment(number, body) { return this.api.request('POST', `${this.path}/issues/${number}/comments`, { body }); }
  updateComment(id, body) { return this.api.request('PATCH', `${this.path}/issues/comments/${id}`, { body }); }
  async release(tag) {
    try { return await this.api.request('GET', `${this.path}/releases/tags/${encodeURIComponent(tag)}`); }
    catch (error) { if (error.status === 404) return undefined; throw error; }
  }
  createStorageRelease(tag) {
    return this.api.request('POST', `${this.path}/releases`, { tag_name: tag, name: 'Discord synchronization data', prerelease: true, make_latest: 'false', body: 'Persistent forum/issue mappings and immutable community attachments. Managed by the Discord sync workflow. This is not an application release. Do not delete its assets.' });
  }
  releaseAssets(id) { return this.api.pages(`${this.path}/releases/${id}/assets`); }
  uploadAsset(id, name, bytes, type = 'application/octet-stream') {
    const uploads = new Api('https://uploads.github.com', this.api.headers, { fetcher: this.api.fetcher });
    return uploads.request('POST', `${this.path}/releases/${id}/assets?name=${encodeURIComponent(name)}`, bytes, type);
  }
  deleteAsset(id) { return this.api.request('DELETE', `${this.path}/releases/assets/${id}`); }
  async downloadAsset(id, maxBytes = 50 * 1024 * 1024) {
    let url = `https://api.github.com${this.path}/releases/assets/${id}`;
    for (let step = 0; step < 4; step++) {
      const headers = step === 0 ? { ...this.api.headers, Accept: 'application/octet-stream' } : {};
      const response = await this.api.fetcher(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(30000) });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const next = new URL(response.headers.get('location'), url);
        if (next.protocol !== 'https:' || next.username || next.password || !(next.hostname === 'githubusercontent.com' || next.hostname.endsWith('.githubusercontent.com'))) throw new Error('Untrusted state download redirect');
        await response.body?.cancel(); url = next.toString(); continue;
      }
      if (!response.ok) throw new Error(`State download returned HTTP ${response.status}`);
      const parts = []; let size = 0;
      for await (const part of response.body) { size += part.length; if (size > maxBytes) throw new Error('State exceeds download limit'); parts.push(part); }
      return Buffer.concat(parts);
    }
    throw new Error('Too many state download redirects');
  }
  async ensureLabel(name) {
    try { await this.api.request('GET', `${this.path}/labels/${encodeURIComponent(name)}`); }
    catch (error) {
      if (error.status !== 404) throw error;
      await this.api.request('POST', `${this.path}/labels`, { name, color: '5865F2', description: 'Shared with the Discord community forum' });
    }
  }
}
export class Discord {
  constructor(token, guildId, forumId) {
    if (![guildId, forumId].every(id => /^\d+$/.test(id))) throw new Error('Discord IDs must be numeric strings');
    Object.assign(this, { guildId, forumId });
    this.api = new Api('https://discord.com/api/v10', { Authorization: `Bot ${token}` });
  }
  async init() {
    this.actor = await this.api.request('GET', '/users/@me');
    this.forum = await this.api.request('GET', `/channels/${this.forumId}`);
    if (this.forum.type !== 15 || this.forum.guild_id !== this.guildId) throw new Error('Channel is not the configured server forum');
    return this.forum;
  }
  async threads() {
    const { threads } = await this.api.request('GET', `/guilds/${this.guildId}/threads/active`);
    const all = new Map(threads.filter(t => t.parent_id === this.forumId).map(t => [t.id, t]));
    let before;
    for (let page = 0; page < 100; page++) {
      const result = await this.api.request('GET', `/channels/${this.forumId}/threads/archived/public?limit=100${before ? `&before=${encodeURIComponent(before)}` : ''}`);
      for (const thread of result.threads) if (thread.parent_id === this.forumId) all.set(thread.id, thread);
      if (!result.has_more) return [...all.values()];
      const next = result.threads.at(-1)?.thread_metadata?.archive_timestamp;
      if (!next || next === before) throw new Error('Archived thread pagination did not advance');
      before = next;
    }
    throw new Error('Archived thread safety limit reached; refusing a partial snapshot');
  }
  async messages(thread) {
    const messages = [];
    let before;
    for (let page = 0; page < 100; page++) {
      const batch = await this.api.request('GET', `/channels/${thread}/messages?limit=100${before ? `&before=${before}` : ''}`);
      messages.push(...batch);
      if (batch.length < 100) return messages.reverse();
      const next = batch.at(-1)?.id;
      if (!next || next === before) throw new Error('Message pagination did not advance');
      before = next;
    }
    throw new Error('Message safety limit reached; refusing a partial snapshot');
  }
  createThread(body) { return this.api.request('POST', `/channels/${this.forumId}/threads`, body); }
  createMessage(thread, body) { return this.api.request('POST', `/channels/${thread}/messages`, body); }
  updateMessage(thread, id, body) { return this.api.request('PATCH', `/channels/${thread}/messages/${id}`, body); }
  updateThread(id, body) { return this.api.request('PATCH', `/channels/${id}`, body); }
}
