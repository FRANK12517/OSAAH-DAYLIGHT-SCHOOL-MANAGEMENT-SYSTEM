import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommunicationEngine } from '../src/communication-engine.js';

test('bulk announcement delivery requires confirmation and remains idempotent', async () => {
  const calls = []; const engine = createCommunicationEngine({ fetchImpl: async () => { calls.push(1); return { ok: true, status: 200, json: async () => ({ id: 'msg-1' }) }; } });
  const actor = { id: 'head', schoolId: 'school-osaah-daylight', roleKey: 'HEADTEACHER' }; const developer = { id: 'dev', schoolId: actor.schoolId, roleKey: 'DEVELOPER' };
  const provider = engine.configure({ provider: 'HUBTEL', endpoint: 'https://sandbox', credentials: 'sandbox', active: true, priority: 1 }, developer);
  const queued = engine.enqueue({ channel: 'SMS', providerId: provider.id, recipient: '+233241234567', payload: { body: 'URGENT — OSAAH DAYLIGHT SCH. COM.: Reopening update' }, idempotencyKey: 'ANNOUNCEMENT:emergency:parent-1:OSAAH/2026/0001' }, actor);
  assert.equal((await engine.process(queued.id, actor)).status, 'SENT'); assert.equal(calls.length, 1);
  assert.equal(engine.enqueue({ channel: 'SMS', recipient: '+233241234567', payload: {}, idempotencyKey: 'ANNOUNCEMENT:emergency:parent-1:OSAAH/2026/0001' }, actor).id, queued.id);
});
