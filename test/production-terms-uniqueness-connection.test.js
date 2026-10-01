import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createDatabaseAdapter } from '../src/ai/tidb-database-adapter.js';
import { runProductionTermsUniquenessCommand } from '../scripts/production-terms-uniqueness-migrate.mjs';

const migrationCliSource = await readFile(new URL('../scripts/migrate.mjs', import.meta.url), 'utf8');
const preflightCliSource = await readFile(new URL('../scripts/production-terms-uniqueness-migrate.mjs', import.meta.url), 'utf8');
const adapterSource = await readFile(new URL('../src/ai/tidb-database-adapter.js', import.meta.url), 'utf8');

test('ledger validation and Migration 060 both select the canonical TiDB adapter', () => {
  assert.match(migrationCliSource, /resolve\(process\.cwd\(\), 'src\/ai\/tidb-database-adapter\.js'\)/);
  assert.match(migrationCliSource, /createDatabaseAdapter\?\.\(\{ environment: process\.env \}\)/);
  assert.match(preflightCliSource, /from '\.\.\/src\/ai\/tidb-database-adapter\.js'/);
  assert.match(preflightCliSource, /adapterFactory = createDatabaseAdapter/);
  assert.doesNotMatch(preflightCliSource, /mysql2\/promise/);
  assert.match(adapterSource, /uri: connectionString/);
});

test('canonical TiDB adapter uses strict TLS and retains the configured DATABASE_URL', async () => {
  const environment = { DATABASE_URL: 'mysql://private-user:private-password@db.example.test/osaah' };
  let options;
  let closeCount = 0;
  const adapter = createDatabaseAdapter({
    environment,
    poolFactory: (poolOptions) => {
      options = poolOptions;
      return { async end() { closeCount += 1; } };
    }
  });
  assert.equal(options.uri, environment.DATABASE_URL);
  assert.deepEqual(options.ssl, { minVersion: 'TLSv1.2', rejectUnauthorized: true });
  assert.equal(options.waitForConnections, true);
  await adapter.close();
  assert.equal(closeCount, 1);
});

for (const code of ['HANDSHAKE_SSL_ERROR', 'ETIMEDOUT']) {
  test(`${code} before connection establishment sends zero SQL and closes the adapter once`, async () => {
    const events = [];
    const attemptedSql = [];
    let executedSql = 0;
    let mutationAttempts = 0;
    let closeCount = 0;
    let connectionEstablished = false;
    const sensitiveUrl = 'mysql://private-user:private-password@db.example.test/osaah';
    const adapter = {
      async query(sql) {
        attemptedSql.push(sql);
        events.push('connect-start');
        await new Promise((resolve) => setTimeout(resolve, 2));
        events.push('connect-failed');
        throw Object.assign(new Error(`TLS failed at ${sensitiveUrl}; password=private-password`), {
          code,
          details: { databaseUrl: sensitiveUrl, password: 'private-password', explanation: 'connection failure' }
        });
      },
      async execute() { mutationAttempts += 1; executedSql += 1; },
      async transaction() { mutationAttempts += 1; },
      async recordApplied() { mutationAttempts += 1; },
      async close() {
        events.push('close');
        closeCount += 1;
        assert.equal(connectionEstablished, false);
      }
    };
    const stderr = { value: '', write(text) { this.value += text; } };
    const stdout = { value: '', write(text) { this.value += text; } };
    const environment = { DATABASE_URL: sensitiveUrl };

    const result = await runProductionTermsUniquenessCommand({
      mode: 'dry-run',
      environment,
      adapterFactory: ({ environment: received }) => {
        assert.equal(received, environment);
        return adapter;
      },
      stderr,
      stdout
    });

    assert.equal(result.exitCode, 1);
    assert.equal(result.error.code, code);
    assert.equal(attemptedSql.length, 1, 'only the initial read may be attempted before a failed handshake');
    assert.equal(executedSql, 0, 'a failed handshake must send no SQL to the database');
    assert.equal(mutationAttempts, 0, 'no transaction, DDL, or ledger operation may run');
    assert.deepEqual(events, ['connect-start', 'connect-failed', 'close']);
    assert.equal(closeCount, 1, 'adapter cleanup must run exactly once');
    assert.doesNotMatch(stderr.value, /private-user|private-password|mysql:\/\//);
    assert.deepEqual(JSON.parse(stderr.value).error.details, {
      databaseUrl: '[redacted]',
      password: '[redacted]',
      explanation: 'connection failure'
    });
    assert.equal(stdout.value, '');
  });
}

test('Migration 060 command does not close the pool while preflight work is still pending', async () => {
  const events = [];
  const adapter = {
    async close() { events.push('close'); }
  };
  const result = await runProductionTermsUniquenessCommand({
    mode: 'dry-run',
    environment: { DATABASE_URL: 'configured' },
    adapterFactory: () => adapter,
    migrationRunner: async ({ adapter: supplied }) => {
      assert.equal(supplied, adapter);
      events.push('preflight-start');
      await new Promise((resolve) => setTimeout(resolve, 5));
      events.push('preflight-finish');
      return { ok: true, productionWrites: 'NONE' };
    },
    stdout: { write() {} },
    stderr: { write() {} }
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(events, ['preflight-start', 'preflight-finish', 'close']);
});
