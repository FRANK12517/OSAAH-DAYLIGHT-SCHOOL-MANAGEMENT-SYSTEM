import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DURABLE_AI_INFRASTRUCTURE, SYSTEM_OF_RECORD_DURABILITY, assertProductionAISystemOfRecordReady, systemOfRecordReadiness } from '../src/ai/system-of-record-readiness.js';

test('system-of-record audit classifies every AI source from runtime storage, not schema presence', () => {
  const names = SYSTEM_OF_RECORD_DURABILITY.map((item) => item.domain);
  for (const required of ['Students', 'Parent/student linkage', 'Academic years, terms, classes, subjects', 'Scores and results', 'Student and staff attendance', 'Admissions', 'Staff and workforce', 'Fee Hub, payments, expenses and income', 'Transport, hostel and welfare operations', 'Inventory, assets, procurement and maintenance', 'Communication and academic calendar', 'Official documents', 'Admission prospectus', 'School profile']) assert.ok(names.includes(required));
  assert.ok(SYSTEM_OF_RECORD_DURABILITY.every((item) => ['TRANSIENT_ONLY', 'NOT_PRODUCTION_READY'].includes(item.classification) && item.restartPersistence === false));
  assert.deepEqual(DURABLE_AI_INFRASTRUCTURE.map((item) => item.classification), ['DURABLE_PRODUCTION', 'DURABLE_PRODUCTION']);
});

test('production AI fails closed while business systems of record are transient', () => {
  assert.throws(() => assertProductionAISystemOfRecordReady({ environment: 'production', aiEnabled: true }), { code: 'SYSTEM_OF_RECORD_PERSISTENCE_REQUIRED' });
  assert.doesNotThrow(() => assertProductionAISystemOfRecordReady({ environment: 'production', aiEnabled: false }));
  assert.equal(systemOfRecordReadiness().state, 'UNAVAILABLE');
});
