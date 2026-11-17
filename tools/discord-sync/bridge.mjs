import { hash, sourceHash, marker, extractMarker, chunks, githubBody, discordBody, IMPORT_FORMAT_VERSION } from './format.mjs';

/** Full reconciliation: no event order assumptions, no destructive propagation. */
export class Bridge {
  constructor({ config, store, discord, github, assets, apply = false, guard = () => {}, checkpoint = async () => {} }) {
    Object.assign(this, { config, persistentStore: store, discord, github, assets, apply, guard, checkpoint });
    this.prefix = `kds:${hash([config.repo, config.guildId, config.forumId]).slice(0, 12)}`;
  }
  action(type, key, details = {}) { this.actions.push({ type, key, ...details }); }
  warn(key, error) { this.warnings.push({ key, message: error.message }); }
  ownDiscord(message) { return message.author?.id === this.discord.actor.id; }
  ownGithub(item) { return item.user?.id === this.github.actor.id; }
  async create(key, type, find, write, preview) {
    const matches = await find();
    if (matches.length > 1) throw new Error(`Multiple remote copies for ${key}; manual reconciliation required`);
    const operation = this.store.operation(key);
    if (matches.length === 1) {
      if (!operation) this.store.begin(key, { type });
      this.store.complete(key, matches[0]);
      return matches[0];
    }
    if (operation?.status === 'done') throw new Error(`Previously created destination for ${key} is missing; not recreating it`);
    if (operation) throw new Error(`Uncertain write ${key}; inspect destination, then explicitly retry if absent`);
    this.action(type, key, preview);
    if (!this.apply) return { id: `planned-${key}`, number: `planned-${key}`, ...preview };
    this.guard();
    this.store.begin(key, { type, preview }); // durable intent BEFORE a network write
    await this.checkpoint();
    this.guard();
    const result = await write(); // ambiguous failure remains pending, never blindly POST again
    this.store.complete(key, result);
    await this.checkpoint();
    return result;
  }
  async update(key, type, write, preview = {}) {
    this.action(type, key, preview);
    if (this.apply) { this.guard(); await write(); } // PATCH is idempotent and safe to repeat
  }
  fingerprint(message) { return hash([sourceHash(message), IMPORT_FORMAT_VERSION]); }
  issueBody(thread, starter, files) {
    const text = githubBody(starter, this.discordUrl(thread.id, starter.id), files);
    const related = this.config.relatedIssues?.[thread.id];
    return text + (related ? `\n\nRelated GitHub issue: https://github.com/${this.config.repo}/issues/${related}` : '');
  }
  async files(message) {
    const files = [];
    for (const attachment of message.attachments ?? []) {
      if (!this.apply) {
        const published = this.store.get(`release-attachment:${attachment.id}`);
        if (published) { files.push(published); continue; }
        const cached = this.store.get(`attachment:${attachment.id}`);
        if (cached && this.config.assetBase) { files.push({ ...cached, url: `${this.config.assetBase}/${cached.hash}` }); continue; }
        files.push({ filename: attachment.filename, url: `https://assets.invalid/preview/${attachment.id}`, image: attachment.content_type?.startsWith('image/') });
        this.action('preserve-attachment', attachment.id, { filename: attachment.filename });
      } else files.push(await this.assets.copy(attachment));
    }
    return files;
  }
  async sendParts(thread, messages, key, text, initialIds = []) {
    const parts = chunks(text, `${this.prefix}:${key}`);
    const previous = this.store.get(`copies:${key}`) || initialIds;
    const ids = [];
    for (let index = 0; index < Math.max(parts.length, previous.length); index++) {
      const suffix = `\n-# ${this.prefix}:${key}:${index}`;
      const content = parts[index] ?? `(This continuation was removed by an edit.)${suffix}`;
      const found = messages.filter(m => this.ownDiscord(m) && m.content?.endsWith(suffix));
      if (found.length > 1) throw new Error(`Duplicate Discord markers for ${key}:${index}`);
      let message = found[0];
      if (!message && previous[index] && !String(previous[index]).startsWith('planned-')) throw new Error(`Discord copy ${previous[index]} was deleted; not recreating it`);
      if (!message) {
        message = await this.create(`message:${key}:${index}`, 'create-message', async () => [],
          () => this.discord.createMessage(thread.id, { content, allowed_mentions: { parse: [] }, nonce: hash([this.prefix, key, index]).slice(0, 24), enforce_nonce: true }),
          { content, thread: thread.id });
        messages.push({ ...message, content, author: this.discord.actor });
      } else if (message.content !== content) {
        await this.update(`message:${key}:${index}`, 'edit-message', () => this.discord.updateMessage(thread.id, message.id, { content, allowed_mentions: { parse: [] } }));
        message.content = content;
      }
      const opKey = `message:${key}:${index}`;
      if (this.store.operation(opKey)?.status === 'pending') this.store.complete(opKey, message);
      ids.push(message.id);
    }
    this.store.set(`copies:${key}`, ids);
    return ids;
  }
  labelFor(name) { return Object.hasOwn(this.config.tagMap, name) ? this.config.tagMap[name] : undefined; }
  githubTags(issue, existing = []) {
    const mapped = this.config.tags?.filter(t => this.labelFor(t.name) && (issue.labels || []).some(l => (l.name || l) === this.labelFor(t.name))).map(t => t.id) || [];
    const unmapped = existing.filter(id => !this.labelFor(this.config.tags?.find(t => t.id === id)?.name));
    const result = [...new Set([...unmapped, ...mapped])];
    if (!result.length && this.config.defaultTag) result.push(this.config.defaultTag);
    if (result.length > 5) throw new Error('Mapped labels exceed Discord’s five-tag limit');
    return result;
  }
  tagLabels(thread) {
    return (thread.applied_tags || []).map(id => this.config.tags?.find(t => t.id === id)?.name).map(name => this.labelFor(name)).filter(Boolean).sort();
  }
  async run() {
    this.actions = []; this.warnings = [];
    this.store = this.apply ? this.persistentStore : this.persistentStore.clone();
    try {
      const [issues, threads] = await Promise.all([this.github.issues(), this.discord.threads()]);
      const issueByNumber = new Map(issues.map(i => [i.number, i]));
      const messageMap = new Map();
      for (const thread of threads) {
        try { messageMap.set(thread.id, await this.discord.messages(thread.id)); }
        catch { throw new Error(`Cannot read thread ${thread.id}; stopped before creating any remote records`); }
      }
      // Recover GitHub-origin mappings from bot-owned forum starters even if local state was lost.
      for (const thread of threads) {
        const starter = messageMap.get(thread.id)?.find(m => m.id === thread.id);
        const match = starter?.content?.match(new RegExp(`\\n-# ${this.prefix}:issue:([0-9]+):0$`));
        if (match && this.ownDiscord(starter) && !this.store.get(`thread:${thread.id}`)) {
          const issue = issueByNumber.get(Number(match[1]));
          if (issue) {
            this.store.set(`thread:${thread.id}`, { issue: issue.number, origin: 'github' });
            const key = `thread:${issue.number}`;
            if (this.store.operation(key)?.status === 'pending') this.store.complete(key, thread);
          }
        }
      }
      for (const thread of threads) {
        try {
          const messages = messageMap.get(thread.id);
          if (!messages) continue;
          let binding = this.store.get(`thread:${thread.id}`);
          const starter = messages.find(m => m.id === thread.id);
          if (!binding) {
            if (!starter || starter.author?.bot || this.ownDiscord(starter) || starter.webhook_id) continue;
            if (!starter.content && !(starter.attachments?.length)) throw new Error('Starter content unavailable; check Message Content Intent before importing');
            const threadMarker = marker('discord', thread.id);
            const body = this.issueBody(thread, starter, await this.files(starter));
            const labels = [...new Set([this.config.label, ...this.tagLabels(thread)])];
            const issue = await this.create(`issue:${thread.id}`, 'create-issue', async () => issues.filter(i => this.ownGithub(i) && extractMarker(i.body, 'discord') === thread.id),
              () => this.github.createIssue({ title: thread.name, body, labels }),
              { title: thread.name, body, labels });
            if (issue.body !== undefined && issue.body !== body) throw new Error('Recovered issue differs from the current source; review the copies before continuing');
            if (!String(issue.number).startsWith('planned-') && !issues.some(i => i.number === issue.number)) issues.push(issue);
            issueByNumber.set(issue.number, issue);
            // For recovery after a lost response, establish the remote baseline instead of rewriting it.
            binding = { issue: issue.number, origin: 'discord', dHash: this.fingerprint(starter), dTitle: thread.name, gHash: hash(issue.body ?? body), gTitle: issue.title, tagLabels: this.tagLabels(thread) };
            this.store.set(`thread:${thread.id}`, binding);
            if (!body.includes(threadMarker)) throw new Error('Missing origin marker');
          }
          const issue = issueByNumber.get(binding.issue);
          if (!issue) { this.warn(`issue:${binding.issue}`, new Error('Linked GitHub issue unavailable; retained mapping without recreating it')); continue; }
          const comments = String(issue.number).startsWith('planned-') ? [] : await this.github.comments(issue.number);
          if (binding.origin === 'discord' && starter) {
            const changed = this.fingerprint(starter) !== binding.dHash;
            if (changed || thread.name !== binding.dTitle) {
              const body = this.issueBody(thread, starter, await this.files(starter));
              const title = thread.name;
              if (issue.body === body && issue.title === title) {
                Object.assign(binding, { dHash: this.fingerprint(starter), dTitle: thread.name, gHash: hash(body), gTitle: title });
              } else if (hash(issue.body) !== binding.gHash || (binding.gTitle && issue.title !== binding.gTitle)) {
                this.action('conflict', `issue:${issue.number}`, { body, title });
                this.warn(`issue:${issue.number}`, new Error('Both source and GitHub changed; issue body/title retained for manual conflict resolution'));
              } else {
                await this.update(`issue:${issue.number}`, 'edit-issue', () => this.github.updateIssue(issue.number, { body, title }), { body, title });
                Object.assign(issue, { body, title });
                Object.assign(binding, { dHash: this.fingerprint(starter), dTitle: thread.name, gHash: hash(body), gTitle: title });
              }
            }
            const labels = this.tagLabels(thread);
            if (hash(labels) !== hash(binding.tagLabels || [])) {
              const current = (issue.labels || []).map(l => typeof l === 'string' ? l : l.name).filter(l => !(binding.tagLabels || []).includes(l));
              const merged = [...new Set([...current, ...labels])];
              await this.update(`labels:${issue.number}`, 'edit-labels', () => this.github.updateIssue(issue.number, { labels: merged }));
              binding.tagLabels = labels;
            }
          }
          if (binding.origin === 'github') {
            const tags = this.githubTags(issue, thread.applied_tags || []);
            const title = issue.title.slice(0, 100);
            if (thread.name !== title || hash(tags) !== hash(thread.applied_tags || [])) {
              await this.update(`thread:${thread.id}`, 'edit-thread', () => this.discord.updateThread(thread.id, { name: issue.title.slice(0, 100), applied_tags: tags }));
            }
            await this.sendParts(thread, messages, `issue:${issue.number}`, discordBody(issue), [thread.id]);
          }
          // A bot-owned card provides the reverse link and GitHub status. Never archive or delete.
          await this.sendParts(thread, messages, `status:${issue.number}`, `**${issue.title}**\nGitHub issue: ${issue.html_url || `https://github.com/${this.config.repo}/issues/${issue.number}`}\nStatus: **${issue.state === 'closed' ? 'Closed' : 'Open'}**${binding.origin === 'discord' && hash(issue.body) !== binding.gHash ? `\n\nUpdated on GitHub:\n${issue.body}` : ''}`);
          for (const message of messages) {
            if (message.id === thread.id || message.author?.bot || this.ownDiscord(message) || message.webhook_id) continue;
            try { await this.toGithub(thread, issue, comments, message); }
            catch (error) { this.warn(`discord-message:${message.id}`, error); }
          }
          for (const comment of comments) {
            // Only bot-owned, mapped mirror comments are excluded; ordinary Discord links do not hide replies.
            const mirrored = this.ownGithub(comment) && extractMarker(comment.body, 'discord');
            if (mirrored) continue;
            try { await this.sendParts(thread, messages, `comment:${comment.id}`, discordBody(comment)); }
            catch (error) { this.warn(`github-comment:${comment.id}`, error); }
          }
          this.store.set(`thread:${thread.id}`, binding);
        } catch (error) { this.warn(`thread:${thread.id}`, error); }
      }
      // Only issues explicitly opted in by label become new forum posts. Existing unrelated issues stay out.
      const linked = new Set(this.store.entries('thread:').map(([, b]) => b.issue));
      for (const issue of issues) {
        if (issue.pull_request || linked.has(issue.number) || !(issue.labels || []).some(l => (l.name || l) === this.config.label)) continue;
        try {
          const key = `issue:${issue.number}`;
          const text = discordBody(issue);
          const first = chunks(text, `${this.prefix}:${key}`)[0];
          const candidates = threads.filter(t => messageMap.get(t.id)?.some(m => this.ownDiscord(m) && m.id === t.id && m.content?.endsWith(`\n-# ${this.prefix}:${key}:0`)));
          const thread = await this.create(`thread:${issue.number}`, 'create-thread', async () => candidates,
            () => this.discord.createThread({ name: issue.title.slice(0, 100), applied_tags: this.githubTags(issue), message: { content: first, allowed_mentions: { parse: [] } } }),
            { name: issue.title.slice(0, 100) });
          this.store.set(`thread:${thread.id}`, { issue: issue.number, origin: 'github' });
          // Send continuations and comments in the same pass, not only after the next polling interval.
          const messages = String(thread.id).startsWith('planned-') ? [{ id: thread.id, content: first, author: this.discord.actor }] : await this.discord.messages(thread.id);
          await this.sendParts(thread, messages, key, text, [thread.id]);
          const comments = await this.github.comments(issue.number);
          for (const comment of comments) {
            if (this.ownGithub(comment) && extractMarker(comment.body, 'discord')) continue;
            await this.sendParts(thread, messages, `comment:${comment.id}`, discordBody(comment));
          }
        } catch (error) { this.warn(`issue:${issue.number}`, error); }
      }
      return { actions: this.actions, warnings: this.warnings, pending: this.store.pending() };
    } finally { if (!this.apply) this.store.close(); }
  }
  discordUrl(thread, message) { return `https://discord.com/channels/${this.config.guildId}/${thread}/${message}`; }
  async toGithub(thread, issue, comments, message) {
    const key = `comment:${message.id}`;
    const saved = this.store.get(`discord-message:${message.id}`);
    const fingerprint = this.fingerprint(message);
    if (saved?.hash === fingerprint) return;
    const body = githubBody(message, this.discordUrl(thread.id, message.id), await this.files(message));
    const matches = comments.filter(c => this.ownGithub(c) && extractMarker(c.body, 'discord') === message.id);
    if (matches.length > 1) throw new Error('Duplicate GitHub comment origin markers; manual reconciliation required');
    if (saved) {
      const current = comments.find(c => c.id === saved.id);
      if (!current) throw new Error('GitHub copy was deleted; not recreating it');
      if (current.body === body) { this.store.set(`discord-message:${message.id}`, { id: saved.id, hash: fingerprint, bodyHash: hash(body) }); return; }
      if (hash(current.body) !== saved.bodyHash) { this.action('conflict', key, { body }); throw new Error('Both copies changed; GitHub comment retained for manual conflict resolution'); }
      await this.update(key, 'edit-comment', () => this.github.updateComment(saved.id, body), { body });
      current.body = body;
      this.store.set(`discord-message:${message.id}`, { id: saved.id, hash: fingerprint, bodyHash: hash(body) });
      return;
    }
    const comment = await this.create(key, 'create-comment', async () => matches,
      () => this.github.createComment(issue.number, body), { body, issue: issue.number });
    if (comment.body !== undefined && comment.body !== body) throw new Error('Recovered comment differs from the current source; review the copies before continuing');
    if (!comments.some(c => c.id === comment.id)) comments.push({ ...comment, body, user: this.github.actor });
    this.store.set(`discord-message:${message.id}`, { id: comment.id, hash: fingerprint, bodyHash: hash(comment.body ?? body) });
  }
}
