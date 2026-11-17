import { DatabaseSync } from 'node:sqlite';

export class Store {
  constructor(path = ':memory:', scope) {
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (key TEXT PRIMARY KEY, status TEXT NOT NULL, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS lease (id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, expires INTEGER);`);
    const previous = this.get('scope');
    if (previous && previous !== scope) { this.db.close(); throw new Error('State belongs to a different repository/forum scope'); }
    this.set('scope', scope);
  }
  get(key) { const row = this.db.prepare('SELECT value FROM kv WHERE key=?').get(key); return row ? JSON.parse(row.value) : undefined; }
  set(key, value) { this.db.prepare('INSERT INTO kv VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value)); }
  entries(prefix) { return this.db.prepare('SELECT key,value FROM kv WHERE substr(key,1,?)=?').all(prefix.length, prefix).map(r => [r.key, JSON.parse(r.value)]); }
  operation(key) { const row = this.db.prepare('SELECT status,value FROM operations WHERE key=?').get(key); return row && { status: row.status, ...JSON.parse(row.value) }; }
  begin(key, value) { this.db.prepare('INSERT INTO operations VALUES (?,?,?)').run(key, 'pending', JSON.stringify(value)); }
  complete(key, result) { this.db.prepare('UPDATE operations SET status=?,value=? WHERE key=?').run('done', JSON.stringify({ result }), key); }
  reset(key) { this.db.prepare('DELETE FROM operations WHERE key=? AND status!=?').run(key, 'done'); }
  pending() { return this.db.prepare('SELECT key,status FROM operations WHERE status!=?').all('done'); }
  clone() {
    const copy = new Store(':memory:', this.get('scope'));
    for (const [key, value] of this.entries('')) copy.set(key, value);
    for (const row of this.db.prepare('SELECT * FROM operations').all()) copy.db.prepare('INSERT INTO operations VALUES (?,?,?)').run(row.key, row.status, row.value);
    return copy;
  }
  acquire(owner, now = Date.now(), ttl = 120000) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const current = this.db.prepare('SELECT * FROM lease WHERE id=1').get();
      if (current && current.owner !== owner && current.expires > now) throw new Error('State is locked by another bridge process');
      this.db.prepare('INSERT INTO lease VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,expires=excluded.expires').run(owner, now + ttl);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  assertLease(owner, now = Date.now()) {
    const row = this.db.prepare('SELECT * FROM lease WHERE id=1').get();
    if (!row || row.owner !== owner || row.expires <= now) throw new Error('Writer lease expired or was lost');
  }
  release(owner) { this.db.prepare('DELETE FROM lease WHERE owner=?').run(owner); }
  snapshot(path) { this.db.prepare('VACUUM INTO ?').run(path); }
  close() { this.db.close(); }
}
