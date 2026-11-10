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
