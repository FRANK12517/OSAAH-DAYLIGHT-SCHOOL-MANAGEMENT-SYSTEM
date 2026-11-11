import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthService } from '../../src/auth.js';
import { normalizeGhanaPhone } from '../../src/utils/normalize-phone.js';
import { resolveParentPhoneLoginRows } from '../../src/auth/parent-auth-service.js';
import { createParentLoginDatabase } from '../helpers/parent-login-fixture.js';
import { createConfiguredTestParent, TEST_PARENT_PHONE } from '../../src/test-parent-fixture.js';

const options = { schoolId: 'sch_default_01', sessionSecret: 'test-parent-session-secret-at-least-32-chars' };
const localPhone = `0${TEST_PARENT_PHONE.slice(4)}`;

test('phone normalizer accepts local and +233 formats consistently', () => {
  assert.equal(normalizeGhanaPhone('0247293733'), '+233247293733');
  assert.equal(normalizeGhanaPhone('+233247293733'), '+233247293733');
});

test('parent lookup matches parent_student_links.telephone in both formats', async () => {
  const user = { ...createConfiguredTestParent(options.schoolId), schoolId: options.schoolId, phone: TEST_PARENT_PHONE };
  const { database } = createParentLoginDatabase({ user });
  const auth = createAuthService({ users: [], database, ...options });
  const result = await auth.loginByPhoneFromDatabase({ phone: '+233247293733', ipAddress: 'sql-check' });
  assert.equal(result.ok, true);
  const lookup = database.calls.find(({ sql }) => /FROM users u JOIN schools school/i.test(sql));
  const lookupSql = lookup?.sql ?? '';
  const lookupParams = lookup?.params ?? [];
  assert.match(lookupSql, /psl\.telephone/);
  assert.doesNotMatch(lookupSql, /u\.phone|phone_user\.phone/);
  assert.ok(lookupParams.includes('0247293733'));
  assert.ok(lookupParams.includes('+233247293733'));
});

test('legacy TiDB limiter preserves old rows and carries active phone attempts into the new deterministic bucket', async () => {
  const nowMs = Date.parse('2026-11-10T12:00:00.000Z');
  const oldRecord = {
    id: 'existing-phone-row', phone: '0247293733', attempts: 2,
    firstAttemptAt: new Date(nowMs - 60_000).toISOString(),
    blockedUntil: new Date(nowMs - 60_000).toISOString()
  };
  const user = { ...createConfiguredTestParent(options.schoolId), schoolId: options.schoolId, phone: TEST_PARENT_PHONE };
  const { database, originalLegacyRows, legacyBuckets } = createParentLoginDatabase({ user, rateLimitSchema: 'legacy', legacyRateRows: [oldRecord] });
  const auth = createAuthService({ users: [], database, ...options, now: () => nowMs });
  const allowed = await auth.loginByPhoneFromDatabase({ phone: '0247293733', ipAddress: 'legacy-ip' });
  const blocked = await auth.loginByPhoneFromDatabase({ phone: '0247293733', ipAddress: 'legacy-ip' });
  assert.equal(allowed.ok, true);
  assert.equal(blocked.ok, false);
  assert.equal(blocked.status, 429);
  assert.deepEqual(originalLegacyRows, [oldRecord]);
  assert.deepEqual(database.legacyRateRows, [oldRecord]);
  const phoneBucket = [...legacyBuckets.values()].find((row) => row.phone === '+233247293733');
  assert.equal(phoneBucket.attempts, 1);
  assert.ok(phoneBucket.blockedUntil > phoneBucket.firstAttemptAt);
});

test('active legacy phone block is honored and incomplete limiter layouts fail closed', async () => {
  const nowMs = Date.parse('2026-11-10T12:00:00.000Z');
  const oldRecord = {
    id: 'existing-blocked-phone', phone: '+233247293733', attempts: 1,
    firstAttemptAt: new Date(nowMs - 30_000).toISOString(),
    blockedUntil: new Date(nowMs + 60_000).toISOString()
  };
  const user = { ...createConfiguredTestParent(options.schoolId), schoolId: options.schoolId, phone: TEST_PARENT_PHONE };
  const { database, persisted } = createParentLoginDatabase({ user, rateLimitSchema: 'legacy', legacyRateRows: [oldRecord] });
  const auth = createAuthService({ users: [], database, ...options, now: () => nowMs });
  const result = await auth.loginByPhoneFromDatabase({ phone: '0247293733', ipAddress: 'legacy-blocked-ip' });
  assert.equal(result.ok, false);
  assert.equal(result.status, 429);
  assert.equal(persisted.session, null);

  const incomplete = createParentLoginDatabase({ user, rateLimitSchema: 'partial' });
  const incompleteAuth = createAuthService({ users: [], database: incomplete.database, ...options });
  const unavailable = await incompleteAuth.loginByPhoneFromDatabase({ phone: '0247293733' });
  assert.equal(unavailable.ok, false);
  assert.equal(unavailable.status, 503);
  assert.equal(incomplete.database.calls.some(({ sql }) => /INSERT INTO parent_auth_rate_limits/i.test(sql)), false);
});

test('legacy TiDB limiter serializes parallel attempts and caps the phone window', async () => {
  const user = { ...createConfiguredTestParent(options.schoolId), schoolId: options.schoolId, phone: TEST_PARENT_PHONE };
  const { database, legacyBuckets } = createParentLoginDatabase({ user, rateLimitSchema: 'legacy' });
  const auth = createAuthService({ users: [], database, ...options });
  const outcomes = await Promise.all(Array.from({ length: 5 }, () => auth.loginByPhoneFromDatabase({ phone: '0247293733', ipAddress: 'parallel-legacy-ip' })));
  assert.equal(outcomes.filter((outcome) => outcome.ok).length, 3);
  assert.equal(outcomes.filter((outcome) => outcome.status === 429).length, 2);
  const phoneBucket = [...legacyBuckets.values()].find((row) => row.phone === '+233247293733');
  const ipBucket = [...legacyBuckets.values()].find((row) => row.phone.startsWith('ip:'));
  assert.equal(phoneBucket.attempts, 3);
  assert.equal(ipBucket.attempts, 3);
});

test('legacy TiDB limiter enforces the 10-attempt IP ceiling across distinct phones', async () => {
  const parents = Array.from({ length: 11 }, (_, index) => {
    const phone = `+23320${String(index + 1).padStart(7, '0')}`;
    return { id: `parent-${index + 1}`, schoolId: options.schoolId, status: 'ACTIVE', parentPhone: phone, phoneMatchCount: 1 };
  });
  const user = { ...createConfiguredTestParent(options.schoolId), schoolId: options.schoolId, phone: TEST_PARENT_PHONE };
  const { database, legacyBuckets } = createParentLoginDatabase({ user, rows: parents, rateLimitSchema: 'legacy' });
  const auth = createAuthService({ users: [], database, ...options });
  const outcomes = [];
  for (let index = 0; index < parents.length; index += 1) {
    outcomes.push(await auth.loginByPhoneFromDatabase({ phone: `0${parents[index].parentPhone.slice(4)}`, ipAddress: 'shared-legacy-ip' }));
  }
  assert.equal(outcomes.filter((outcome) => outcome.ok).length, 10);
  assert.equal(outcomes.filter((outcome) => outcome.status === 429).length, 1);
  const ipBucket = [...legacyBuckets.values()].find((row) => row.phone.startsWith('ip:'));
  assert.equal(ipBucket.attempts, 10);
});

for (const phone of [localPhone, TEST_PARENT_PHONE]) {
  test(`parent phone-only login accepts ${phone.startsWith('0') ? 'local' : 'international'} phone`, async () => {
    const user = { ...createConfiguredTestParent(options.schoolId), schoolId: options.schoolId, phone: TEST_PARENT_PHONE };
    const { database } = createParentLoginDatabase({ user });
    const auth = createAuthService({ users: [], database, ...options });
    const result = await auth.loginByPhoneFromDatabase({ phone, ipAddress: `test-${phone}` });
    assert.equal(result.ok, true);
    assert.equal(result.user.role, 'PARENT');
    const claims = JSON.parse(Buffer.from(result.token.split('.')[1], 'base64url').toString());
    assert.equal(String(claims.sub ?? claims.userId ?? claims.id), String(user.id));
    assert.equal(claims.phone, TEST_PARENT_PHONE);
    assert.equal(claims.role, 'PARENT');
  });
}

test('inactive, unlinked, duplicate, and malformed parent rows fail closed', async () => {
  const user = { ...createConfiguredTestParent(options.schoolId), schoolId: options.schoolId, phone: TEST_PARENT_PHONE };
  const inactive = { id: user.id, schoolId: options.schoolId, status: 'INACTIVE', parentPhone: TEST_PARENT_PHONE, phoneMatchCount: 1 };
  assert.equal(resolveParentPhoneLoginRows([inactive], TEST_PARENT_PHONE), null);
  assert.equal(resolveParentPhoneLoginRows([null, undefined], TEST_PARENT_PHONE), null);
  assert.equal(resolveParentPhoneLoginRows([{ ...inactive, status: 'ACTIVE' }, { ...inactive, status: 'ACTIVE', id: 'other' }], TEST_PARENT_PHONE), null);
  const { database, persisted } = createParentLoginDatabase({ user, rows: [] });
  const auth = createAuthService({ users: [], database, ...options });
  const result = await auth.loginByPhoneFromDatabase({ phone: TEST_PARENT_PHONE });
  assert.equal(result.ok, false);
  assert.equal(result.status, 401);
  assert.equal(persisted.session, null);
});

test('unexpected query failure returns a JSON-safe 503 result, not an uncaught exception', async () => {
  const { database } = createParentLoginDatabase({ user: { id: 'p1', schoolId: options.schoolId, phone: TEST_PARENT_PHONE } });
  database.transaction = async () => { throw new Error('query failure'); };
  const auth = createAuthService({ users: [], database, ...options });
  const result = await auth.loginByPhoneFromDatabase({ phone: TEST_PARENT_PHONE });
  assert.deepEqual({ ok: result.ok, status: result.status, error: result.error }, {
    ok: false, status: 503, error: 'Authentication service unavailable.'
  });
});
