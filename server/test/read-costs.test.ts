import '../src/app.ts';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { openDb, applyMigrations } from '../src/d1-sqlite.ts';
import { POINT_TOTALS_SQL } from '../src/stickers.ts';
import { PERIOD_POINTS_SQL } from '../src/routes/members.ts';
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

test('stored list counts follow adds, ticks, moves and deletes', () => {
  const db = openDb(':memory:'); applyMigrations(db, fileURLToPath(dir));
  const run = (sql: string) => db.prepare(sql).run();
  run("INSERT INTO lists(id,name,kind,created_at) VALUES('a','A','todo','2026-01-01'),('b','B','todo','2026-01-01')");
  for (const [id, list, done] of [['1','a',0],['2','a',1],['3','a',0],['4','b',0]] as const) run(`INSERT INTO list_items(id,list_id,title,done,created_at,updated_at) VALUES('${id}','${list}','x',${done},'2026-01-01','2026-01-01')`);
  const counts = () => db.prepare('SELECT list_id, items, open FROM list_item_counts ORDER BY list_id').all().results;
  const reference = () => db.prepare('SELECT l.id AS list_id, COUNT(li.id) AS items, COALESCE(SUM(li.done = 0), 0) AS open FROM lists l LEFT JOIN list_items li ON li.list_id = l.id GROUP BY l.id ORDER BY l.id').all().results;
  assert.deepEqual(counts(), reference());
  run("UPDATE list_items SET done = 1 WHERE id = '1'");
  run("UPDATE list_items SET list_id = 'b' WHERE id = '3'");
  run("UPDATE list_items SET title = 'renamed' WHERE id = '4'");
  run("DELETE FROM list_items WHERE id = '2'");
  assert.deepEqual(counts(), reference());
  run("DELETE FROM lists WHERE id = 'b'");
  assert.deepEqual(counts(), reference().filter((r: any) => r.list_id !== 'b'));
});

test("daily point totals match this week's completions and bonuses through edits and deletes", () => {
  const db = openDb(':memory:'); applyMigrations(db, fileURLToPath(dir)); seed(db);
  // What GET /api/members computed before the daily totals.
  const reference = `SELECT member_id, COALESCE(SUM(CASE WHEN date = ?1 THEN points ELSE 0 END), 0) AS today, COALESCE(SUM(points), 0) AS week
    FROM (SELECT cc.member_id AS member_id, cc.date AS date, cc.points_awarded AS points FROM chore_completions cc JOIN chores c ON c.id = cc.chore_id
            WHERE cc.member_id IS NOT NULL AND cc.date >= ?2 AND cc.date <= ?1
          UNION ALL SELECT member_id, ref, amount FROM point_entries WHERE reason = 'bonus' AND ref >= ?2 AND ref <= ?1)
    GROUP BY member_id ORDER BY member_id`;
  const check = () => {
    for (const [today, from] of [['2026-11-06', '2026-11-02'], ['2026-11-04', '2026-11-02'], ['2026-11-06', '2026-10-01']]) {
      const got = db.prepare(`SELECT * FROM (${PERIOD_POINTS_SQL}) WHERE week != 0 OR today != 0 ORDER BY member_id`).bind(today, from).all().results;
      const want = db.prepare(reference).bind(today, from).all().results.filter((r: any) => r.week !== 0 || r.today !== 0);
      assert.deepEqual(got, want, `${today} from ${from}`);
    }
  };
  const run = (sql: string) => db.prepare(sql).run();
  run("INSERT INTO chores(id,title,created_at) VALUES('c2','Fixture chore','2026-01-01'),('c3','Fixture chore','2026-01-01')");
  run("INSERT INTO chore_completions(id,chore_id,date,member_id,completed_at,points_awarded) VALUES('a','c','2026-11-06','m1','x',5),('b','c','2026-11-04','m1','x',3),('d','c2','2026-11-05','m2','x',2),('e','c2','2026-10-20','m2','x',9),('f','c3','2026-11-06',NULL,'x',4)");
  run("INSERT INTO point_entries(id,member_id,amount,reason,ref,at) VALUES('p1','m1',10,'bonus','2026-11-06','x'),('p2','m2',4,'bonus','2026-11-03','x'),('p3','m1',-6,'reward','r1','x')");
  check();
  run("UPDATE chore_completions SET points_awarded = 7 WHERE id = 'a'");
  run("UPDATE chore_completions SET member_id = 'm2' WHERE id = 'b'");
  run("UPDATE chore_completions SET date = '2026-11-06' WHERE id = 'd'");
  run("UPDATE chore_completions SET member_id = 'm1' WHERE id = 'f'");
  run("UPDATE point_entries SET ref = '2026-11-05' WHERE id = 'p2'");
  run("UPDATE point_entries SET reason = 'adjust' WHERE id = 'p1'");
  check();
  run("DELETE FROM chore_completions WHERE id = 'a'");
  run("DELETE FROM point_entries WHERE id = 'p2'");
  check();
  run("DELETE FROM chores WHERE id = 'c'"); // cascades to its completions
  check();
});

test('single recipe reads use indexes for recipes and their related rows', async () => {
  const { readRecipes } = await import('../src/meals.ts');
  const db = openDb(':memory:'); applyMigrations(db, fileURLToPath(dir));
  db.prepare("INSERT INTO recipes(id,name,default_servings,created_at,updated_at) VALUES('tacos','Tacos',4,'2026-11-06','2026-11-06')").run();
  db.prepare("INSERT INTO recipes(id,name,default_servings,created_at,updated_at) VALUES('soup','Soup',4,'2026-11-06','2026-11-06')").run();
  db.prepare("INSERT INTO members(id,name,color,created_at) VALUES('maya','Maya','#123456','2026-11-06')").run();
  for (const id of ['tacos', 'soup']) {
    db.prepare("INSERT INTO recipe_ingredients(id,recipe_id,name,normalized_name) VALUES(?,?,?,?)").bind(id, id, id, id).run();
    db.prepare('INSERT INTO recipe_ratings(recipe_id,member_id,stars) VALUES(?,?,?)').bind(id, 'maya', id === 'tacos' ? 5 : 2).run();
    db.prepare('INSERT INTO recipe_favorites(recipe_id,member_id) VALUES(?,?)').bind(id, 'maya').run();
  }
  const prepare = db.prepare.bind(db);
  const plans: string[] = [];
  db.prepare = (sql: string) => {
    const statement = prepare(sql);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values: unknown[]) => {
      if (sql.startsWith('SELECT')) plans.push(prepare('EXPLAIN QUERY PLAN ' + sql).bind(...values).all<{ detail: string }>().results.map(r => r.detail).join('\n'));
      return bind(...values);
    };
    return statement;
  };
  const recipes = await readRecipes(db, { id: 'tacos', archived: true });
  assert.equal(recipes.length, 1);
  assert.equal(recipes[0].name, 'Tacos');
  assert.deepEqual(recipes[0].ingredients.map(i => i.id), ['tacos']);
  assert.deepEqual(recipes[0].rating, { average: 5, count: 1, byMember: { maya: 5 } });
  assert.deepEqual(recipes[0].favoritedBy, ['maya']);
  assert.equal(plans.length, 5);
  for (const plan of plans) assert.doesNotMatch(plan, /SCAN (recipes|i|recipe_ratings|recipe_favorites|meals)\b/, plan);
  assert.deepEqual(await readRecipes(db, { id: 'missing' }), []);
});
