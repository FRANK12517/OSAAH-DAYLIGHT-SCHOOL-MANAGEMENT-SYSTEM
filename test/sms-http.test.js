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
async function withServer(t, identity, allowSmsNonProduction = false) {
  let current = identity;
  const auth = { async authenticateAsync() { return current; }, authenticate() { return current; } };
  const server = createServer(createApp({ auth, database: fixtureDatabase(), aiEnabled: false, allowSmsNonProduction }));
  await new Promise((resolve) => server.listen(0, resolve));
  t.after(() => new Promise((resolve) => { server.closeAllConnections(); server.close(resolve); }));
  return { setIdentity(value) { current = value; }, request(path, method = 'GET', body = undefined) { return fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { authorization: 'Bearer test-session', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); } };
}
const identity = (roleKey, permissions) => ({ id: `user-${roleKey.toLowerCase()}`, roleKey, portal: roleKey === 'PARENT' ? 'parent' : 'school', schoolId, permissions: new Set(permissions) });

test('SMS API and Messages page are denied to teachers with broad in-app messaging permission only', async (t) => {
  const server = await withServer(t, identity('TEACHER', ['messages.read', 'messages.write']));
  assert.equal((await server.request('/api/sms/options')).status, 403);
  assert.equal((await server.request('/communication/messages')).status, 403);
});

test('local SMS storage API is disabled by default even for an authorized Headteacher', async (t) => {
  const server = await withServer(t, identity('HEADTEACHER', ['messages.sms.send']));
  assert.equal((await server.request('/api/sms/options')).status, 503);
});

test('authorized Headteacher can use an explicitly injected isolated fixture while the provider remains disabled', async (t) => {
  const server = await withServer(t, identity('HEADTEACHER', ['messages.sms.send', 'messages.read']), true);
  const page = await server.request('/communication/messages');
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Compose SMS/);
  const response = await server.request('/api/sms/options');
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.deepEqual(result.parents, []);
  assert.equal(result.provider.configured, false);
});

test('only Proprietor, Administrator, and Headteacher can call SMS APIs when an isolated fixture is injected', async (t) => {
  const server = await withServer(t, identity('HEADTEACHER', ['messages.sms.send']), true);
  for (const role of ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER']) {
    server.setIdentity(identity(role, ['messages.sms.send']));
    assert.equal((await server.request('/api/sms/options')).status, 200, role);
  }
  for (const role of ['ASSISTANT_HEADTEACHER', 'ACCOUNTANT', 'TEACHER', 'PARENT']) {
    server.setIdentity(identity(role, ['messages.sms.send', 'messages.read', 'messages.write']));
    assert.equal((await server.request('/api/sms/options')).status, 403, role);
  }
  server.setIdentity(identity('HEADTEACHER', ['messages.read', 'messages.write']));
  assert.equal((await server.request('/api/sms/options')).status, 403);
});

test('Parent keeps distinct In-App Messages and existing teacher messaging without any SMS route access', async (t) => {
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
