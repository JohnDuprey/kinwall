import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';

// Preserve the existing CI optimization.
if (process.env.KINWALL_WEB_PREBUILT) {
  console.log('Using prebuilt web assets.');
  process.exit(0);
}

const commands = [
  ['ci', '--prefix', 'web'],
  ['run', 'build', '--prefix', 'web'],
  ['ci', '--prefix', 'server']
];

for (const args of commands) {
  console.log(`Running npm ${args.join(' ')}`);

  const command = WIN ? (process.env.ComSpec || 'cmd.exe') : 'npm';
  const commandArgs = WIN
    ? ['/d', '/c', `npm ${args.join(' ')}`]
    : args;

  const result = spawnSync(command, commandArgs, {
    cwd: ROOT,
    stdio: 'inherit'
  });

  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}