import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAIAuditLogger } from '../src/ai/audit-logger.js';
import { createDatabaseAIAuditSink, createDatabaseAIActionStore, selectAIPersistence } from '../src/ai/durable-stores.js';
import { createHumanControlledActions } from '../src/ai/human-controlled-actions.js';

const key = 'durable-action-integrity-test-key';
const actor = (id = 'leader-1', schoolId = 'school-a') => ({ id, schoolId, roleKey: 'HEADTEACHER', permissions: new Set(['ai.actions.prepare', 'ai.actions.approve', 'ai.actions.review']) });

function adapterFor(storage = { audit: [], actions: new Map() }, { unavailable = false, failNextUpdate = false } = {}) {
  let failUpdate = failNextUpdate;
  const columns = (sql) => sql.slice(sql.indexOf('(') + 1, sql.indexOf(')')).split(',').map((item) => item.trim());
  const adapter = {
    storage,
    async healthCheck() { return { healthy: !unavailable, durable: true }; },
    async query(sql, params) {
      if (unavailable) throw new Error('private database detail');
      if (sql.includes('ai_audit_logs')) {
        let rows = storage.audit.filter((row) => row.school_id === params[0]);
        const allowed = params.slice(1, -1); if (allowed.length) rows = rows.filter((row) => allowed.includes(row.event_type));
        return structuredClone(rows.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at)).slice(0, params.at(-1)));
      }
      const rows = [...storage.actions.values()];
      if (sql.includes('idempotency_key')) return structuredClone(rows.filter((row) => row.school_id === params[0] && row.idempotency_key === params[1]).slice(0, 1));
      if (sql.includes('id = ?')) return structuredClone(rows.filter((row) => row.id === params[0] && row.school_id === params[1]).slice(0, 1));
      return structuredClone(rows.filter((row) => row.school_id === params[0]).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, params[1]));
    },
    async execute(sql, params) {
      if (unavailable) throw new Error('private database detail');
      if (sql.startsWith('INSERT INTO ai_audit_logs')) { storage.audit.push(Object.fromEntries(columns(sql).map((name, index) => [name, params[index]]))); return { changes: 1 }; }
      if (sql.startsWith('INSERT INTO ai_human_controlled_actions')) { const row = Object.fromEntries(columns(sql).map((name, index) => [name, params[index]])); storage.actions.set(row.id, row); return { changes: 1 }; }
      if (failUpdate) { failUpdate = false; throw new Error('private update detail'); }
      const target = storage.actions.get(params.at(-3));
      if (!target || target.school_id !== params.at(-2) || target.version !== params.at(-1)) return { changes: 0 };
      const assignments = sql.slice(sql.indexOf('SET ') + 4, sql.indexOf(' WHERE')).split(',').map((item) => item.trim().split('=')[0]);
      assignments.forEach((name, index) => { target[name] = params[index]; });
      return { changes: 1 };
    },
    async transaction(work) {
      const snapshot = { audit: structuredClone(storage.audit), actions: structuredClone(storage.actions) };
      try { return await work(adapter); } catch (error) { storage.audit.splice(0, storage.audit.length, ...snapshot.audit); storage.actions.clear(); for (const [id, row] of snapshot.actions) storage.actions.set(id, row); throw error; }
    }
  };
  return adapter;
}

function service(adapter, extra = {}) {
  return createHumanControlledActions({ store: createDatabaseAIActionStore({ adapter }), integrityKey: key, adapters: { DRAFT_SCHOOL_NOTICE: async () => ({ id: 'notice-1', status: 'CREATED' }) }, ...extra });
}
async function pending(svc) { const draft = await svc.prepare({ actor: actor(), actionType: 'DRAFT_SCHOOL_NOTICE', proposedChange: 'Draft reopening notice', payload: { title: 'Reopening', body: 'Monday', audience: 'ALL' }, idempotencyKey: 'key-1' }); return svc.submit({ actor: actor(), id: draft.id, expectedVersion: draft.version }); }

test('durable AI audit and action persistence', async (t) => {
  await t.test('stores and reloads audit events through schema 018 fields', async () => { const adapter = adapterFor(), logger = createAIAuditLogger({ sink: createDatabaseAIAuditSink({ adapter }) }); await logger.record({ eventType: 'AI_REQUEST_COMPLETED', requestId: 'r1', correlationId: 'c1', schoolId: 'school-a', requestStatus: 'COMPLETED' }); const rows = await logger.recentAsync({ schoolId: 'school-a' }); assert.equal(rows[0].requestId, 'r1'); assert.equal(adapter.storage.audit[0].request_id, 'r1'); });
  await t.test('bounds and school-scopes audit reads', async () => { const adapter = adapterFor(), logger = createAIAuditLogger({ sink: createDatabaseAIAuditSink({ adapter }) }); for (let i = 0; i < 105; i++) await logger.record({ eventType: 'AI_REQUEST_COMPLETED', requestId: `r${i}`, correlationId: `c${i}`, schoolId: i === 104 ? 'school-b' : 'school-a', requestStatus: 'COMPLETED' }); assert.equal((await logger.recentAsync({ schoolId: 'school-a', limit: 1000 })).length, 100); assert.equal((await logger.recentAsync({ schoolId: 'school-b' })).length, 1); });
  await t.test('persists prepared actions in schema 022 fields', async () => { const adapter = adapterFor(), draft = await service(adapter).prepare({ actor: actor(), actionType: 'DRAFT_SCHOOL_NOTICE', proposedChange: 'Draft notice', payload: { title: 'A' }, idempotencyKey: 'persist-1' }); assert.equal(adapter.storage.actions.get(draft.id).sanitized_payload, '{"title":"A"}'); });
  await t.test('survives service restart with integrity intact', async () => { const storage = { audit: [], actions: new Map() }, first = service(adapterFor(storage)), item = await pending(first), restarted = service(adapterFor(storage)); assert.equal((await restarted.get({ actor: actor(), id: item.id })).status, 'PENDING_APPROVAL'); });
  await t.test('preserves approval state across restart', async () => { const storage = { audit: [], actions: new Map() }, first = service(adapterFor(storage)), item = await pending(first), approved = await first.approve({ actor: actor('leader-2'), id: item.id, expectedVersion: item.version }), restarted = service(adapterFor(storage)); assert.equal((await restarted.get({ actor: actor('leader-2'), id: approved.id })).status, 'APPROVED'); });
  await t.test('executes approved action exactly once after restart', async () => { const storage = { audit: [], actions: new Map() }, first = service(adapterFor(storage)), item = await pending(first), approved = await first.approve({ actor: actor('leader-2'), id: item.id, expectedVersion: item.version }); let calls = 0; const restarted = service(adapterFor(storage), { adapters: { DRAFT_SCHOOL_NOTICE: async () => { calls++; return { id: 'notice-1' }; } } }); const done = await restarted.execute({ actor: actor('leader-2'), id: approved.id, expectedVersion: approved.version }); await restarted.execute({ actor: actor('leader-2'), id: approved.id, expectedVersion: done.version }); assert.equal(calls, 1); });
  await t.test('rejects duplicate idempotency keys durably', async () => { const svc = service(adapterFor()), input = { actor: actor(), actionType: 'DRAFT_SCHOOL_NOTICE', proposedChange: 'Draft notice', payload: { title: 'A' }, idempotencyKey: 'same' }; await svc.prepare(input); await assert.rejects(() => svc.prepare(input), { code: 'IDEMPOTENCY_CONFLICT' }); });
  await t.test('uses optimistic concurrency for simultaneous approval', async () => { const svc = service(adapterFor()), item = await pending(svc), results = await Promise.allSettled([svc.approve({ actor: actor('leader-2'), id: item.id, expectedVersion: item.version }), svc.approve({ actor: actor('leader-3'), id: item.id, expectedVersion: item.version })]); assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1); });
  await t.test('prevents cross-school durable reads', async () => { const svc = service(adapterFor()), item = await pending(svc); await assert.rejects(() => svc.get({ actor: actor('leader-b', 'school-b'), id: item.id }), { code: 'ACTION_NOT_FOUND' }); });
  await t.test('rolls back failed state transitions', async () => { const storage = { audit: [], actions: new Map() }, stable = service(adapterFor(storage)), item = await pending(stable), failing = service(adapterFor(storage, { failNextUpdate: true })); await assert.rejects(() => failing.approve({ actor: actor('leader-2'), id: item.id, expectedVersion: item.version }), { code: 'ACTION_PERSISTENCE_FAILED' }); assert.equal((await stable.get({ actor: actor(), id: item.id })).status, 'PENDING_APPROVAL'); });
  await t.test('surfaces sanitized audit database failure', async () => { const logger = createAIAuditLogger({ sink: createDatabaseAIAuditSink({ adapter: adapterFor(undefined, { unavailable: true }) }), onFailure: () => {} }); await assert.rejects(() => logger.record({ eventType: 'AI_REQUEST_FAILED', requestId: 'r', correlationId: 'c', schoolId: 'school-a', requestStatus: 'FAILED' }), (error) => error.code === 'AI_AUDIT_UNAVAILABLE' && !error.message.includes('private')); });
  await t.test('surfaces sanitized action database failure', async () => { await assert.rejects(() => service(adapterFor(undefined, { unavailable: true })).list({ actor: actor() }), (error) => error.code === 'ACTION_READ_FAILED' && !error.message.includes('private')); });
  await t.test('reports durable health', async () => { const chosen = selectAIPersistence({ databaseAdapter: adapterFor(), environment: 'production' }); assert.equal(chosen.durable, true); assert.equal((await chosen.auditSink.healthCheck()).healthy, true); });
  await t.test('fails production selection closed without database', () => { assert.throws(() => selectAIPersistence({ environment: 'production' }), { code: 'DURABLE_PERSISTENCE_REQUIRED' }); });
  await t.test('allows explicit in-memory persistence only outside production', () => { const chosen = selectAIPersistence({ environment: 'test', allowMemory: true }); assert.equal(chosen.durable, false); });
  await t.test('never exposes a database adapter through stores or services', () => { const adapter = adapterFor(), chosen = selectAIPersistence({ databaseAdapter: adapter, environment: 'production' }), svc = service(adapter); assert.equal('adapter' in chosen.auditSink, false); assert.equal('adapter' in chosen.actionStore, false); assert.equal('store' in svc, false); });
});
