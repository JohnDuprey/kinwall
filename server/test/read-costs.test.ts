import '../src/app.ts';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { POINT_TOTALS_SQL } from '../src/stickers.ts';
import { loadMedications, sealMedication, sealLog } from '../src/routes/medications.ts';

const dir = new URL('../migrations/', import.meta.url);
const reference = `SELECT m.id AS member_id,
 (SELECT coalesce(sum(points_awarded),0) FROM chore_completions WHERE member_id=m.id) +
 (SELECT coalesce(sum(amount),0) FROM point_entries WHERE member_id=m.id AND amount>0 AND reason<>'reward_refund') AS earned,
 (SELECT coalesce(-sum(amount),0) FROM point_entries WHERE member_id=m.id AND (amount<0 OR reason='reward_refund')) AS spent FROM members m`;
function seed(db: ReturnType<typeof openDb>) {
 for (const id of ['m1','m2']) db.prepare("INSERT INTO members(id,name,color,created_at) VALUES(?,?,'#123456','2026-01-01')").bind(id,id).run();
 db.prepare("INSERT INTO chores(id,title,created_at) VALUES('c','Fixture chore','2026-01-01')").run();
}
function same(db: ReturnType<typeof openDb>) {
 assert.deepEqual(db.prepare(POINT_TOTALS_SQL).all().results, db.prepare(reference).all().results);
}
test('point totals backfill existing history and follow edits, transfers, refunds and cascades', () => {
 const db=openDb(':memory:');
 for (const f of readdirSync(dir).filter(f=>f.endsWith('.sql') && f<'0137').sort()) db.exec(readFileSync(new URL(f,dir),'utf8'));
 seed(db);
 db.prepare("INSERT INTO chore_completions(id,chore_id,date,member_id,completed_at,points_awarded) VALUES('cc','c','2026-01-01','m1','2026-01-01',5)").run();
 db.prepare("INSERT INTO point_entries(id,member_id,amount,reason,at) VALUES('p','m1',-3,'reward','2026-01-01')").run();
 db.exec(readFileSync(new URL('0137_refresh_reads.sql',dir),'utf8'));
 same(db);
 for (const sql of [
  "UPDATE chore_completions SET member_id='m2',points_awarded=8 WHERE id='cc'",
  "UPDATE chore_completions SET member_id=NULL,points_awarded=NULL WHERE id='cc'",
  "UPDATE chore_completions SET member_id='m1',points_awarded=2 WHERE id='cc'",
  "UPDATE point_entries SET member_id='m2',amount=3,reason='reward_refund' WHERE id='p'",
  "UPDATE point_entries SET amount=4,reason='bonus' WHERE id='p'",
  "INSERT INTO point_entries(id,member_id,amount,reason,at) VALUES('q','m1',7,'bonus','2026-01-01')",
  "DELETE FROM chores WHERE id='c'",
  "DELETE FROM point_entries WHERE id='q'",
  "DELETE FROM members WHERE id='m2'",
 ]) {db.prepare(sql).run();same(db);}
});
test('point totals and recent goals avoid history scans', () => {
 const db=openDb(':memory:');applyMigrations(db,fileURLToPath(dir));
 const plan=(sql:string)=>db.prepare('EXPLAIN QUERY PLAN '+sql).all<{detail:string}>().results.map(r=>r.detail).join('\n');
 assert.doesNotMatch(plan(POINT_TOTALS_SQL),/chore_completions|point_entries/);
 assert.match(plan("SELECT member_id,date,goal FROM temp_checks WHERE date BETWEEN '2026-01-01' AND '2026-01-03' AND goal IS NOT NULL"),/SEARCH temp_checks USING INDEX idx_temp_checks_goals/);
});
test('limited-course counts reuse history until a log changes, including direct imports and deletes', async () => {
 const db=openDb(':memory:');applyMigrations(db,fileURLToPath(dir));seed(db);
 const env={DB:db,ENCRYPTION_KEY:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='};
 const med={id:'med',memberId:'m1',name:'Fixture medicine',dose:'1',times:['08:00'],days:[0,1,2,3,4,5,6],totalDoses:5};
 db.prepare("INSERT INTO medications(id,member_id,data,created_at,updated_at) VALUES('med','m1',?,'2026-01-01','2026-01-01')").bind(await sealMedication(env,med)).run();
 let reads=0;const prepare=db.prepare.bind(db);
 db.prepare=(sql:string)=>{if(sql==='SELECT * FROM medication_log WHERE medication_id = ?') reads++;return prepare(sql);};
 assert.equal((await loadMedications(env))[0].dosesLeft,5);
 assert.equal((await loadMedications(env))[0].dosesLeft,5);assert.equal(reads,1);
 const log=await sealLog(env,'med','2026-01-01',{'08:00':{status:'taken'}});
 db.prepare("INSERT INTO medication_log(medication_id,date,log,updated_at) VALUES('med','2026-01-01',?,'2026-01-01')").bind(log).run();
 assert.equal((await loadMedications(env))[0].dosesLeft,4);assert.equal(reads,2);
 db.prepare("UPDATE medication_log SET log=? WHERE medication_id='med'").bind(await sealLog(env,'med','2026-01-01',{'08:00':{status:'skipped'}})).run();
 assert.equal((await loadMedications(env))[0].dosesLeft,5);assert.equal(reads,3);
 db.prepare("DELETE FROM medication_log WHERE medication_id='med'").run();
 assert.equal((await loadMedications(env))[0].dosesLeft,5);assert.equal(reads,4);
});
