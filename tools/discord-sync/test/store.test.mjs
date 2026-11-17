import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../store.mjs';

test('mappings and pending operations survive a process restart', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discord-sync-'));
  try {
    let store = new Store(join(dir, 'state.db'), 'scope');
    store.set('thread:123', { issue: 42, source: 'discord' });
    store.begin('create:123', { kind: 'issue' });
    store.close();
    store = new Store(join(dir, 'state.db'), 'scope');
    assert.equal(store.get('thread:123').issue, 42);
    assert.equal(store.operation('create:123').status, 'pending');
    assert.throws(() => new Store(join(dir, 'state.db'), 'different-scope'), /scope/);
    store.close();
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('lease prevents simultaneous writers and permits recovery after expiry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'discord-sync-'));
  const path = join(dir, 'state.db');
  const a = new Store(path, 'scope');
  const b = new Store(path, 'scope');
  try {
    a.acquire('a', 100, 1000);
    assert.throws(() => b.acquire('b', 101, 1000), /another/);
    b.acquire('b', 1101, 1000);
    assert.throws(() => a.assertLease('a', 1102), /lease/);
  } finally { a.close(); b.close(); rmSync(dir, { recursive: true, force: true }); }
});
