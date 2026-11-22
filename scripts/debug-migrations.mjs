
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { sqlStatements } from '../server/src/migrate.ts';

const folder = new URL('../server/migrations/', import.meta.url);
const db = new DatabaseSync(':memory:');

const files = readdirSync(folder)
  .filter(name => name.endsWith('.sql'))
  .sort();

console.log(`Checking ${files.length} migration files`);

for (const file of files) {
  const sql = readFileSync(new URL(file, folder), 'utf8');
  const statements = sqlStatements(sql);

  console.log(`\n${file}: ${statements.length} statements`);

  for (const [index, statement] of statements.entries()) {
    try {
      db.exec(statement);
    } catch (error) {
      console.error(`\nFAILED: ${file}, statement ${index + 1}`);
      console.error(`Error: ${error.message}`);
      console.error('\nGenerated SQL:');
      console.error(statement);
      process.exit(1);
    }
  }

  console.log('OK');
}

db.close();
console.log('\nAll migrations passed local SQLite validation.');
