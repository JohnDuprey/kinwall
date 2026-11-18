import { randomUUID, createHash } from 'node:crypto';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { Assets } from './assets.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const statePattern = /^state-\d+-[a-f0-9-]+-([a-f0-9]{64})\.sqlite$/;

export class ReleaseStorage {
  constructor(github, tag = 'discord-sync-data') {
    if (!/^[a-z0-9][a-z0-9-]{0,60}$/.test(tag) || tag.startsWith('v')) throw new Error('Storage tag must be a non-version lowercase name');
    Object.assign(this, { github, tag });
  }
  async init(apply, initialize = false) {
    this.release = await this.github.release(this.tag);
    this.created = false;
    if (!this.release && apply) {
      this.release = await this.github.createStorageRelease(this.tag);
      this.created = true;
    }
    if (this.release && (this.release.draft || !this.release.prerelease)) throw new Error('Storage release must be a published prerelease');
    this.assets = this.release ? await this.github.releaseAssets(this.release.id) : [];
    if (apply && this.release && !this.created && !initialize && !this.assets.some(a => statePattern.test(a.name))) throw new Error('Existing storage release is empty; inspect it before explicit initialization');
  }
  async restore(path) {
    const snapshots = this.assets.filter(a => statePattern.test(a.name)).sort((a, b) => Number(b.id) - Number(a.id));
    if (!snapshots.length) return false;
    const latest = snapshots[0];
    if (latest.state !== 'uploaded') throw new Error('Newest state snapshot is incomplete; refusing an older snapshot');
    const bytes = await this.github.downloadAsset(latest.id);
    if (digest(bytes) !== latest.name.match(statePattern)[1]) throw new Error('State checksum failed; refusing an older snapshot');
    await writeFile(path, bytes, { flag: 'wx', mode: 0o600 });
    return true;
  }
  async checkpoint(store, directory) {
    const path = join(directory, `snapshot-${randomUUID()}.sqlite`);
    try {
      store.snapshot(path);
      const bytes = await readFile(path);
      if (bytes.length > 50 * 1024 * 1024) throw new Error('State exceeds the 50 MiB checkpoint limit');
      const name = `state-${Date.now()}-${randomUUID()}-${digest(bytes)}.sqlite`;
      const result = await this.github.uploadAsset(this.release.id, name, bytes);
      if (result.state !== 'uploaded') throw new Error('State checkpoint was not uploaded');
      this.assets.push(result);
    } finally { await unlink(path).catch(() => {}); }
  }
  async prune() {
    const assets = await this.github.releaseAssets(this.release.id);
    const obsolete = assets.filter(a => statePattern.test(a.name) && a.state === 'uploaded').sort((a, b) => Number(b.id) - Number(a.id)).slice(3);
    for (const asset of obsolete) await this.github.deleteAsset(asset.id);
  }
}

export class ReleaseAssets extends Assets {
  constructor(directory, store, remote, options) {
    // The local cache is an implementation detail; URLs returned below always point to GitHub.
    super(directory, 'https://cache.invalid/assets', store, options);
    this.remote = remote;
    this.guard = options?.guard || (() => {});
  }
  async copy(attachment) {
    this.guard();
    const existing = this.store.get(`release-attachment:${attachment.id}`);
    if (existing) return existing;
    const cached = await super.copy(attachment);
    const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[cached.type] || 'bin';
    const name = `attachment-${cached.hash}.${extension}`;
    let asset = this.remote.assets.find(a => a.name === name && a.state === 'uploaded');
    if (!asset) {
      const bytes = await readFile(join(this.directory, cached.hash));
      this.guard();
      asset = await this.remote.github.uploadAsset(this.remote.release.id, name, bytes, cached.type);
      if (asset.state !== 'uploaded') throw new Error('Attachment was not uploaded');
      this.remote.assets.push(asset);
    }
    const url = `https://github.com/${this.remote.github.repo}/releases/download/${encodeURIComponent(this.remote.tag)}/${encodeURIComponent(name)}`;
    const result = { ...cached, url };
    this.store.set(`release-attachment:${attachment.id}`, result);
    return result;
  }
}
