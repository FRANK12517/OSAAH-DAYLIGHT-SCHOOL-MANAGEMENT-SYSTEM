import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const testDirectory = resolve('test');
const files = (await readdir(testDirectory, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.test\.(?:js|mjs|cjs)$/.test(entry.name))
  .map((entry) => resolve(testDirectory, entry.name))
  .sort();

if (!files.length) {
  process.stderr.write('No maintained tests found in test/.\n');
  process.exit(1);
}
process.stdout.write(`Running ${files.length} maintained test files from test/ only.\n`);
for (const file of files) process.stdout.write(` - ${file.slice(testDirectory.length + 1)}\n`);
const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
