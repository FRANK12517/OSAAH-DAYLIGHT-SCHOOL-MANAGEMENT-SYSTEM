import test from 'node:test';
import assert from 'node:assert/strict';
import { createArkeselGateway, createDurableSmsService, estimateSmsSegments } from '../src/durable-sms.js';

const allowed = (roleKey = 'HEADTEACHER') => ({ id: 'staff-1', schoolId: 'school-osaah-daylight', roleKey, permissions: new Set(['messages.sms.send']) });
const records = [
  { parentId: 'p1', parentName: 'parent.one', telephone: '024 123 4567', studentId: 's1', permanentStudentId: 'STU-1', className: 'Primary 1' },
  { parentId: 'p1', parentName: 'parent.one', telephone: '+233241234567', studentId: 's2', permanentStudentId: 'STU-2', className: 'Primary 2' },
  { parentId: 'p2', parentName: 'parent.two', telephone: '0551234567', studentId: 's3', permanentStudentId: 'STU-3', className: 'JHS 1' },
  { parentId: 'user-test-parent-sample', parentName: 'test', telephone: '+233247293733', studentId: 'test-student', permanentStudentId: 'OSAAH-DEMO-001', className: 'Primary 1' }
];
function mockDb() {
  const executed = [];
  const recipientRows = [...records];
  const db = {
    executed,
    recipientRows,
    async query(sql, params = []) {
      if (sql.includes('academic_years ay JOIN terms')) return [{ academicYearId: 'year-1', termId: 'term-1' }];
      if (sql.includes('FROM parent_student_links psl')) return recipientRows.filter((row) => !sql.includes('psl.parent_user_id IN (') || params.slice(3).includes(row.parentId));
      if (sql.includes('SELECT id,status,message_body,recipient_mode,recipient_count,created_at,updated_at,sent_at,provider_key FROM sms_campaigns WHERE school_id=? AND idempotency_key=?')) return [];
      if (sql.includes('SELECT id,campaign_id FROM sms_campaign_recipients')) return [{ id: 'recipient-row', campaign_id: 'campaign-1' }];
      if (sql.includes('SELECT COUNT(*) AS total')) return [{ total: 1, delivered: 1, failed: 0, pending: 0 }];
      if (sql.includes('SELECT id,created_by,status FROM sms_campaigns')) return [];
      return [];
    },
    async execute(sql, params = []) { executed.push({ sql, params }); return { affectedRows: 1 }; },
    async transaction(callback) { return callback({ execute: this.execute.bind(this) }); }
  };
  return db;
}
const actorFor = (roleKey, permission = true) => ({ ...allowed(roleKey), permissions: new Set(permission ? ['messages.sms.send'] : []) });

test('Ghana SMS estimates use GSM-7 and UCS-2 segment sizes', () => {
  assert.deepEqual(estimateSmsSegments('Hello'), { characters: 5, encoding: 'GSM-7', segments: 1, perSegment: 160 });
  assert.equal(estimateSmsSegments('a'.repeat(161)).segments, 2);
  assert.equal(estimateSmsSegments('🙂').encoding, 'UCS-2');
  assert.equal(estimateSmsSegments('🙂'.repeat(71)).segments, 2);
});

test('Arkesel adapter uses the documented API contract without exposing provider secrets', async () => {
  let request;
  const gateway = createArkeselGateway({ environment: { VERCEL_ENV: 'production', ARKESEL_API_KEY: 'test-private-key', ARKESEL_SENDER_ID: 'OSAAH', ARKESEL_CALLBACK_TOKEN: 'test-callback-token', PUBLIC_BASE_URL: 'https://school.example' }, fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, async json() { return { status: 'success', data: [{ recipient: '+233241234567', id: 'provider-id' }] }; } }; } });
  assert.equal(gateway.configured, true);
  assert.equal(JSON.stringify(gateway).includes('test-private-key'), false);
  assert.equal(gateway.validateCallbackToken('test-callback-token'), true);
  const result = await gateway.send({ message: 'Hello', recipients: ['+233241234567'] });
  assert.equal(request.url, 'https://sms.arkesel.com/api/v2/sms/send');
  assert.equal(request.options.headers['api-key'], 'test-private-key');
  assert.deepEqual(JSON.parse(request.options.body).recipients, ['+233241234567']);
  assert.match(JSON.parse(request.options.body).callback_url, /token=test-callback-token/);
  assert.equal(result[0].id, 'provider-id');
  const previewGateway = createArkeselGateway({ environment: { VERCEL_ENV: 'preview', ARKESEL_API_KEY: 'test-private-key', ARKESEL_SENDER_ID: 'OSAAH', ARKESEL_CALLBACK_TOKEN: 'test-callback-token' }, fetchImpl: async () => { throw new Error('Preview must never call live gateway'); } });
  assert.equal(previewGateway.configured, false);
});

test('only Proprietor, School Admin and Headteacher with the dedicated permission may preview', async () => {
  const db = mockDb(); const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway: { configured: false } });
  for (const role of ['PROPRIETOR', 'SCHOOL_ADMIN', 'HEADTEACHER']) await assert.doesNotReject(() => service.preview({ message: 'Hello', recipientMode: 'ALL_PARENTS' }, actorFor(role)));
  for (const role of ['ASSISTANT_HEADTEACHER', 'TEACHER', 'PARENT', 'ADMIN']) await assert.rejects(() => service.preview({ message: 'Hello', recipientMode: 'ALL_PARENTS' }, actorFor(role)), { status: 403 });
  await assert.rejects(() => service.preview({ message: 'Hello', recipientMode: 'ALL_PARENTS' }, actorFor('HEADTEACHER', false)), { status: 403 });
});

test('recipient preview excludes the controlled test parent and demo students and deduplicates normalized Ghana numbers', async () => {
  const db = mockDb(); const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway: { configured: false } });
  const result = await service.preview({ message: 'School opens tomorrow', recipientMode: 'ALL_PARENTS' }, allowed());
  assert.equal(result.recipientCount, 2);
  assert.deepEqual(result.recipients.map((item) => item.parentId), ['p1', 'p2']);
  assert.ok(!JSON.stringify(result).includes('024 123 4567'));
  assert.ok(!JSON.stringify(result).includes('+233247293733'));
  assert.equal(result.costCurrency, null);
});

test('cost is estimated only from an explicitly configured segment price', async () => {
  const db = mockDb(); const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway: { configured: false, costPerSegmentGhs: 0.25 } });
  const result = await service.preview({ message: 'Hello', recipientMode: 'ALL_PARENTS' }, allowed());
  assert.equal(result.totalEstimatedSegments, 2);
  assert.equal(result.estimatedCost, 0.5);
  assert.equal(result.costCurrency, 'GHS');
});

test('selected class audiences require a real school academic context', async () => {
  const db = mockDb(); db.recipientRows.push({ parentId: 'p4', parentName: 'parent.four', telephone: '0261234567', studentId: 's4', permanentStudentId: 'STU-4', className: 'Basic 1' }); const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway: { configured: false } });
  const result = await service.preview({ message: 'Hello', recipientMode: 'PARENTS_BY_CLASS', className: 'Primary 1', academicYearId: 'year-1', termId: 'term-1' }, allowed());
  assert.equal(result.context.className, 'Primary 1');
  assert.deepEqual(result.recipients.map((item) => item.parentId), ['p1', 'p4']);
  await assert.rejects(() => service.preview({ message: 'Hello', recipientMode: 'PARENTS_BY_CLASS', className: 'Fake', academicYearId: 'year-1', termId: 'term-1' }, allowed()), /Choose a class/);
});

test('drafts persist without provider credentials and require no send side effect', async () => {
  const db = mockDb(); const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway: { configured: false } });
  const result = await service.saveDraft({ message: 'Remember the PTA meeting', recipientMode: 'ALL_PARENTS' }, allowed());
  assert.equal(result.status, 'DRAFT');
  assert.ok(db.executed.some((item) => item.sql.includes('INSERT INTO sms_campaigns')));
  await assert.rejects(() => service.send({ message: 'Real send', recipientMode: 'ALL_PARENTS', confirm: true, idempotencyKey: 'key' }, allowed()), { status: 503, code: 'SMS_PROVIDER_NOT_CONFIGURED' });
  await assert.rejects(() => service.send({ message: 'Real send', recipientMode: 'ALL_PARENTS', idempotencyKey: 'key' }, allowed()), { code: 'SMS_CONFIRMATION_REQUIRED' });
});

test('mocked provider acceptance is SENT, and only the authenticated callback marks delivery', async () => {
  const db = mockDb(); let providerCalls = 0;
  const gateway = { provider: 'MOCK', configured: true, async send({ recipients }) { providerCalls += 1; return recipients.map((recipient, index) => ({ recipient, id: `provider-${index}` })); }, validateCallbackToken: (value) => value === 'callback-secret' };
  const service = createDurableSmsService({ database: db, schoolId: 'school-osaah-daylight', gateway });
  const sent = await service.send({ message: 'Hello parents', recipientMode: 'ALL_PARENTS', confirm: true, idempotencyKey: 'once-1' }, allowed());
  assert.equal(sent.status, 'SENT');
  assert.equal(sent.deliveryStatus, 'PENDING_PROVIDER_CONFIRMATION');
  assert.equal(providerCalls, 1);
  assert.ok(db.executed.some((item) => item.sql.includes("SET status='SENT'")));
  await assert.rejects(() => service.deliveryCallback({ token: 'wrong', smsId: 'provider-0', status: 'DELIVERED' }), { status: 401 });
  const delivery = await service.deliveryCallback({ token: 'callback-secret', smsId: 'provider-0', status: 'DELIVERED' });
  assert.deepEqual(delivery, { accepted: true, status: 'DELIVERED' });
  assert.ok(db.executed.some((item) => item.sql.includes("SET status=?,last_error=?,delivered_at=?")));
});
