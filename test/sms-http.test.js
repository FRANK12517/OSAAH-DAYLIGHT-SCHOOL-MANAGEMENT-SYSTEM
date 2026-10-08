import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createApp } from '../src/server.mjs';

const schoolId = 'sch_default_01';
function fixtureDatabase() {
  return {
    async query() { return []; },
    async execute() { return { affectedRows: 1 }; },
    async transaction(work) { return work(this); }
  };
}
async function withServer(t, identity, allowSmsNonProduction = true) {
  let current = identity;
  const auth = { async authenticateAsync() { return current; }, authenticate() { return current; } };
  const server = createServer(createApp({ auth, database: fixtureDatabase(), aiEnabled: false, allowSmsNonProduction }));
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return { setIdentity(value) { current = value; }, request(path, method = 'GET', body = undefined) { return fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { authorization: 'Bearer test-session', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); } };
}
const identity = (roleKey, permissions) => ({ id: `user-${roleKey.toLowerCase()}`, roleKey, portal: roleKey === 'PARENT' ? 'parent' : 'school', schoolId, permissions: new Set(permissions) });

test('SMS API and Messages page are denied to teachers without the official SMS role', async (t) => {
  const server = await withServer(t, identity('TEACHER', ['messages.read', 'messages.write']));
  assert.equal((await server.request('/api/sms/options')).status, 403);
  assert.equal((await server.request('/communication/messages')).status, 403);
});

test('Preview SMS API is disabled by default even for an authorized Headteacher', async (t) => {
  const server = await withServer(t, identity('HEADTEACHER', ['messages.sms.send']), false);
  assert.equal((await server.request('/api/sms/options')).status, 503);
});

test('authorized Headteacher can open the Messages page and read roster options, but no provider submission is invoked', async (t) => {
  const server = await withServer(t, identity('HEADTEACHER', ['messages.sms.send', 'messages.read']));
  const page = await server.request('/communication/messages');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Compose SMS/);
  const response = await server.request('/api/sms/options');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.parents, []);
  assert.equal(result.provider.configured, false);
});

test('Parent keeps the distinct In-App Messages page and existing message API while seeing no SMS route', async (t) => {
  const server = await withServer(t, identity('PARENT', ['messages.read', 'messages.write']));
  const page = await server.request('/communication/in-app-messages');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /In-App Messages/);
  assert.equal((await server.request('/communication/messages')).status, 403);
  server.setIdentity(identity('TEACHER', ['messages.read', 'messages.write']));
  const messages = await server.request('/api/communication/messages');
  assert.equal(messages.status, 200);
  assert.deepEqual((await messages.json()).messages, []);
  assert.equal((await server.request('/api/sms/options')).status, 403);
});
