import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { clearOldChecked, checkedDays } from '../src/checked-cleanup.ts';

test('ticked items on grocery and shopping lists go after the chosen days; other lists keep theirs', async () => {
  const db = openDb(':memory:'); applyMigrations(db, join(import.meta.dirname, '..', 'migrations'));
  const run = (sql: string) => db.prepare(sql).run();
  run("INSERT INTO lists(id,name,kind,created_at) VALUES('g','Groceries','shopping','2026-01-01'),('t','To do','todo','2026-01-01')");
  const item = (id: string, list: string, done: number, doneAt: string | null) =>
    run(`INSERT INTO list_items(id,list_id,title,done,done_at,created_at,updated_at) VALUES('${id}','${list}','${id}',${done},${doneAt ? `'${doneAt}'` : 'NULL'},'2026-10-01','2026-10-01')`);
  item('old', 'g', 1, '2026-10-29T12:00:00.000Z');  // 8 days before
  item('recent', 'g', 1, '2026-11-01T12:00:00.000Z'); // 5 days before
  item('open', 'g', 0, null);
  item('legacy', 'g', 1, null);                      // ticked before done_at existed: its last update counts
  item('todo', 't', 1, '2026-10-01T12:00:00.000Z');
  run("INSERT INTO notes(id,target_type,target_id,body,created_at,updated_at) VALUES('n1','list_item','old','x','2026-10-01','2026-10-01')");
  const now = new Date('2026-11-06T12:00:00.000Z');
  assert.deepEqual(await clearOldChecked(db, now), ['g']);
  const left = () => db.prepare('SELECT id FROM list_items ORDER BY id').all<{ id: string }>().results.map(r => r.id);
  assert.deepEqual(left(), ['open', 'recent', 'todo']);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM notes WHERE target_id = 'old'").first<{ n: number }>()!.n, 0);
  run("INSERT INTO settings(key,value) VALUES('clearCheckedAfterDays','1')");
  assert.deepEqual(await clearOldChecked(db, now), ['g']);
  assert.deepEqual(left(), ['open', 'todo']);
  assert.deepEqual(await clearOldChecked(db, now), [], 'nothing left: nothing changes');
});

test('the setting stays within 1 to 30 days, 7 by default', () => {
  assert.equal(checkedDays(undefined), 7);
  assert.equal(checkedDays('0'), 1);
  assert.equal(checkedDays('45'), 30);
  assert.equal(checkedDays('nonsense'), 7);
  assert.equal(checkedDays('14'), 14);
});
