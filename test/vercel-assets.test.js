import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createApp } from '../src/server.mjs';

test('Vercel bundles public assets and the configured AI adapter with the serverless app', async () => {
  const config = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
  const serverBuild = config.builds.find((build) => build.src === 'src/server.mjs');
  assert.ok(serverBuild);
  assert.deepEqual(serverBuild.config?.includeFiles, ['public/**', 'src/ai/**']);
});

test('public logo and gallery assets are served as image files', async () => {
  const server = createServer(createApp({ aiEnabled: false }));
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  const get = (path) => new Promise((resolve, reject) => {
    const request = httpRequest({ port, path }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ statusCode: response.statusCode, contentType: response.headers['content-type'], body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
    request.end();
  });

  try {
    for (const [path, contentType] of [
      ['/assets/osaah-daylight-school-complex-logo.png', 'image/png'],
      ['/assets/login-gallery/01-school-pride.jpg', 'image/jpeg'],
      ['/assets/login-gallery/08-school-community-event.png', 'image/png']
    ]) {
      const response = await get(path);
      assert.equal(response.statusCode, 200, path);
      assert.equal(response.contentType, contentType, path);
      assert.ok(response.body.length > 100, path);
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
