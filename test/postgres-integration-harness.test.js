import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const node = process.execPath;
const runner = resolve('scripts/run-postgres-integration.mjs');
const ack = 'I_ACKNOWLEDGE_THIS_IS_A_NEW_DISPOSABLE_LOCAL_DATABASE';
const invoke = (overrides = {}) => {
  const env = { ...process.env, OSAAH_PG_INTEGRATION_URL: '', OSAAH_PG_INTEGRATION_DISPOSABLE: '', ...overrides };
  return spawnSync(node, [runner], { encoding: 'utf8', env, timeout: 10000 });
};

test('real PostgreSQL harness requires its separate URL and explicit disposable acknowledgement', () => {
  const missingUrl = invoke({ OSAAH_PG_INTEGRATION_DISPOSABLE: ack });
  assert.equal(missingUrl.status, 1);
  assert.match(missingUrl.stderr, /INTEGRATION_URL_REQUIRED/);
  const missingAck = invoke({ OSAAH_PG_INTEGRATION_URL: 'postgresql://user:secret@localhost:5432/osaah_test_local01' });
  assert.equal(missingAck.status, 1);
  assert.match(missingAck.stderr, /DISPOSABLE_ACK_REQUIRED/);
  assert.doesNotMatch(missingUrl.stderr + missingAck.stderr, /secret|postgresql:\/\//i);
});

test('real PostgreSQL harness rejects remote or production-shaped targets before connection', () => {
  for (const [url, code] of [
    ['postgresql://user:secret@db.example.test:5432/osaah_test_local01', 'REMOTE_HOST_REFUSED'],
    ['postgresql://user:secret@localhost:5432/osaah_test_production01', 'PRODUCTION_TARGET_REFUSED'],
    ['postgresql://user:secret@localhost:5432/osaah', 'DATABASE_NAME_REFUSED']
  ]) {
    const result = invoke({ OSAAH_PG_INTEGRATION_URL: url, OSAAH_PG_INTEGRATION_DISPOSABLE: ack });
    assert.equal(result.status, 1, `${code} should exit nonzero`);
    assert.match(result.stderr, new RegExp(code));
    assert.doesNotMatch(result.stderr, /secret|postgresql:\/\//i);
  }
});
