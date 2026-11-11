import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const isolatedEnvironment = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  VERCEL: '1',
  OSAAH_AI_ENABLED: 'false',
  OSAAH_SESSION_SECRET: 'isolated-test-session-secret-at-least-32-chars'
};

function runIsolated(script, environment) {
  return spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: projectRoot,
    encoding: 'utf8',
    timeout: 30_000,
    env: { ...isolatedEnvironment, ...environment }
  });
}

function parseResult(result) {
  assert.equal(result.status, 0, result.stderr);
  const output = result.stdout.match(/RESULT:(\{[^\r\n]*\})/);
  assert.ok(output, result.stdout);
  return JSON.parse(output[1]);
}

test('serverless login returns JSON 503 when required TiDB startup configuration is missing', () => {
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
  const response = parseResult(runIsolated(script, {
    NODE_ENV: 'production',
    OSAAH_DATABASE_ADAPTER: 'tidb'
  }));
  assert.equal(response.status, 503);
  assert.match(response.type, /^application\/json\b/);
  assert.deepEqual(response.body, { error: 'Authentication service unavailable.' });
});

test('a TiDB query outage makes health and login fail closed with JSON 503 responses', () => {
  const script = `
    import { Readable } from 'node:stream';
    import { createApp } from './src/server.mjs';
    const database = {
      supportsDurableAuthSessions: true,
      async query() { throw Object.assign(new Error('simulated socket outage'), { code: 'ECONNRESET' }); }
    };
    const app = createApp({ database, aiEnabled: false });
    async function call(path, method, body = '') {
      const request = Readable.from(body ? [body] : []);
      Object.assign(request, { method, url: path, headers: { 'content-type': 'application/json' }, socket: {} });
      let data;
      const response = { writeHead(status, headers) { data = { status, headers }; }, end(payload) { data.body = payload; } };
      await app(request, response);
      return { status: data.status, type: data.headers['Content-Type'], body: JSON.parse(data.body) };
    }
    const login = await call('/api/auth/login', 'POST', JSON.stringify({ portal: 'school', username: 'nobody@example.invalid', password: 'invalid' }));
    const health = await call('/api/health', 'GET');
    process.stdout.write('\\nRESULT:' + JSON.stringify({ login, health }));
  `;
  const result = parseResult(runIsolated(script, { NODE_ENV: 'test' }));
  assert.equal(result.login.status, 503);
  assert.match(result.login.type, /^application\/json\b/);
  assert.deepEqual(result.login.body, { error: 'Authentication service unavailable.' });
  assert.equal(result.health.status, 503);
  assert.match(result.health.type, /^application\/json\b/);
  assert.deepEqual({ ok: result.health.body.ok, db: result.health.body.db, sessionStore: result.health.body.sessionStore }, {
    ok: false,
    db: 'down',
    sessionStore: 'down'
  });
});
