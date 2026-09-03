import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('Vercel bundles every public gallery asset with the serverless app', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const serverBuild = config.builds.find((build) => build.src === 'src/server.mjs');
  assert.ok(serverBuild);
  assert.deepEqual(serverBuild.config?.includeFiles, ['public/**']);
});
