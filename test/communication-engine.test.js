import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunicationEngine } from '../src/communication-engine.js';
const developer = { id: 'dev', roleKey: 'DEVELOPER', schoolId: 'school-osaah-daylight' };
test('communication engine protects secrets, queues idempotently, and fails over', async () => {
  const calls = []; const engine = createCommunicationEngine({ fetchImpl: async (url) => { calls.push(url); if (url.includes('primary')) return { ok: false, status: 503, json: async () => ({}) }; return { ok: true, status: 200, json: async () => ({ messageId: 'hubtel-1' }) }; } });
  const primary = engine.configure({ provider: 'ARKESEL', endpoint: 'https://primary', credentials: 'secret', active: true, isDefault: true, priority: 1 }, developer);
  const fallback = engine.configure({ provider: 'HUBTEL', endpoint: 'https://fallback', credentials: 'secret2', active: true, fallbackProviderId: null, priority: 2 }, developer);
  engine.configure({ id: primary.id, provider: 'ARKESEL', endpoint: 'https://primary', credentials: 'secret', active: true, isDefault: true, priority: 1, fallbackProviderId: fallback.id }, developer);
  assert.equal(engine.listProviders(developer)[0].credentialsConfigured, true); assert.equal(Object.hasOwn(engine.listProviders(developer)[0], 'credentials'), false);
  const first = engine.enqueue({ recipient: '+233200000000', payload: { body: 'Hello' }, idempotencyKey: 'msg-1' }, developer); const duplicate = engine.enqueue({ recipient: '+233200000000', payload: { body: 'Hello' }, idempotencyKey: 'msg-1' }, developer); assert.equal(first.id, duplicate.id);
  const result = await engine.process(first.id, developer); assert.equal(result.status, 'RETRYING'); assert.equal(calls.length, 1);
  const retry = await engine.process(first.id, developer); assert.equal(retry.status, 'SENT'); assert.equal(calls.length, 2);
  assert.throws(() => engine.listProviders({ roleKey: 'TEACHER', schoolId: developer.schoolId }), /Developer authorization/);
});
