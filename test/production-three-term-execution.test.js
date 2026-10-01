import test from 'node:test';
import assert from 'node:assert/strict';
import { executeWithConnectionRetry, isRetryableConnectionError } from '../src/production-three-term-execution.js';

test('only known transient connection errors are retryable', () => {
  assert.equal(isRetryableConnectionError({ code: 'ETIMEDOUT' }), true);
  assert.equal(isRetryableConnectionError({ code: 'ECONNRESET' }), true);
  assert.equal(isRetryableConnectionError({ code: 'ER_DUP_ENTRY' }), false);
  assert.equal(isRetryableConnectionError({ code: 'TERM_CONFLICT' }), false);
});

test('connection initialization retries once and closes each failed adapter before succeeding', async () => {
  const adapters = [];
  let attempts = 0;
  const result = await executeWithConnectionRetry({
    createAdapter: () => {
      const adapter = { closed: 0, async close() { this.closed += 1; } };
      adapters.push(adapter);
      return adapter;
    },
    operation: async (_adapter, attempt) => {
      attempts += 1;
      if (attempt === 1) throw Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
      return { attempt };
    },
    sleep: async () => {}
  });
  assert.deepEqual(result, { attempt: 2 });
  assert.equal(attempts, 2);
  assert.deepEqual(adapters.map((adapter) => adapter.closed), [1, 1]);
});

test('database and preflight errors are not swallowed or retried', async () => {
  let attempts = 0;
  await assert.rejects(() => executeWithConnectionRetry({
    createAdapter: () => ({ async close() {} }),
    operation: async () => { attempts += 1; throw Object.assign(new Error('duplicate'), { code: 'ER_DUP_ENTRY' }); },
    sleep: async () => {}
  }), (error) => error.code === 'ER_DUP_ENTRY');
  assert.equal(attempts, 1);
});
