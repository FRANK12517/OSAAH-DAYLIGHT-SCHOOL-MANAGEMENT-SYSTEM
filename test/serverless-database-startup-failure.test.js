import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('serverless login returns JSON 503 when required TiDB startup configuration is missing', () => {
  const projectRoot = fileURLToPath(new URL('../', import.meta.url));
  const script = `
    import { Readable } from 'node:stream';
    import app from './src/server.mjs';
    const body = JSON.stringify({ portal: 'school', username: 'nobody@example.invalid', password: 'invalid' });
    const request = Readable.from([body]);
    Object.assign(request, { method: 'POST', url: '/api/auth/login', headers: { 'content-type': 'application/json' }, socket: {} });
    let responseData;
    const response = {
      writeHead(status, headers) { responseData = { status, headers }; },
      end(payload) { responseData.body = payload; }
    };
    await app(request, response);
    process.stdout.write('\\nRESULT:' + JSON.stringify({ status: responseData.status, type: responseData.headers['Content-Type'], body: JSON.parse(responseData.body) }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 30_000,
    env: {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: 'production',
      VERCEL: '1',
      OSAAH_DATABASE_ADAPTER: 'tidb',
      OSAAH_AI_ENABLED: 'false',
      OSAAH_SESSION_SECRET: 'isolated-test-session-secret-at-least-32-chars'
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout.match(/RESULT:(\{[^\r\n]*\})/);
  assert.ok(output, result.stdout);
  const response = JSON.parse(output[1]);
  assert.equal(response.status, 503);
  assert.match(response.type, /^application\/json\b/);
  assert.deepEqual(response.body, { error: 'Authentication service unavailable.' });
});
