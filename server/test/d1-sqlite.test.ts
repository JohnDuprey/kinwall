// The Node/Docker database connection's settings (d1-sqlite.ts openDb).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/d1-sqlite.ts';

test('openDb: WAL, synchronous NORMAL (no fsync per write), a busy timeout and foreign keys', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kinwall-db-'));
  try {
    const db = openDb(join(dir, 'k.sqlite'));
    const one = async (pragma: string) => Object.values((await db.prepare(`PRAGMA ${pragma}`).first()) as object)[0];
    assert.equal(await one('journal_mode'), 'wal');
    assert.equal(await one('synchronous'), 1); // NORMAL: safe with WAL, survives crashes, only a power cut can lose the last writes
    assert.equal(await one('busy_timeout'), 5000);
    assert.equal(await one('foreign_keys'), 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
