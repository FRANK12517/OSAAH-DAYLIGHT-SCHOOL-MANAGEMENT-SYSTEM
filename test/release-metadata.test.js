import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import test from 'node:test';
import { createApp } from '../src/server.mjs';

function request(port, path) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ port, path }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('release metadata exposes traceability without secrets', async () => {
  const server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, resolve));
  try {
    const result = await request(server.address().port, '/api/release');
    assert.equal(result.status, 200);
    assert.ok(Object.hasOwn(result.body, 'commitSha'));
    assert.ok(Object.hasOwn(result.body, 'deploymentId'));
    assert.ok(Object.hasOwn(result.body, 'environment'));
    assert.equal(Object.hasOwn(result.body, 'DATABASE_URL'), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
