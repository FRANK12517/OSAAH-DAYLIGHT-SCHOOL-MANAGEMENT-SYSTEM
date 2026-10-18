import test from 'node:test';
import assert from 'node:assert/strict';
import { validatedTarget } from '../scripts/run-postgres-integration.mjs';
const ack = 'I_ACKNOWLEDGE_THIS_IS_A_NEW_DISPOSABLE_LOCAL_DATABASE';
const target = (url, acknowledgement = ack) => ({
  OSAAH_PG_INTEGRATION_URL: url,
  OSAAH_PG_INTEGRATION_DISPOSABLE: acknowledgement
});
const expectGuard = (environment, code) => {
  assert.throws(() => validatedTarget(environment), (error) => {
    assert.equal(error.code, code);
    assert.doesNotMatch(error.message, /secret|postgresql:\/\//i);
    return true;
  });
};

test('real PostgreSQL harness requires its separate URL and explicit disposable acknowledgement', () => {
  expectGuard(target('', ack), 'INTEGRATION_URL_REQUIRED');
  expectGuard(target('postgresql://user:secret@localhost:5432/osaah_test_local01', ''), 'DISPOSABLE_ACK_REQUIRED');
});

test('real PostgreSQL harness rejects remote or production-shaped targets before connection', () => {
  for (const [url, code] of [
    ['postgresql://user:secret@db.example.test:5432/osaah_test_local01', 'REMOTE_HOST_REFUSED'],
    ['postgresql://user:secret@localhost:5432/osaah_test_production01', 'PRODUCTION_TARGET_REFUSED'],
    ['postgresql://user:secret@localhost:5432/osaah', 'DATABASE_NAME_REFUSED']
  ]) {
    expectGuard(target(url), code);
  }
});
