import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const script = resolve('scripts/supabase-migrate.mjs');
function run(command, overrides = {}) {
  const environment = { ...process.env };
  delete environment.OSAAH_POSTGRES_URL;
  delete environment.OSAAH_ALLOW_LOCAL_SUPABASE_APPLY;
  Object.assign(environment, overrides);
  return spawnSync(process.execPath, [script, command], { encoding: 'utf8', env: environment });
}

test('Supabase migration validation command delegates to the static checker', () => {
  const result = run('validate');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /159 tables, 6 views/);
});

test('Supabase migration status refuses absent and remote PostgreSQL targets before connecting', () => {
  const missing = run('status');
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /POSTGRES_URL_REQUIRED/);
  const remote = run('status', { OSAAH_POSTGRES_URL: 'postgresql://user:secret@db.example.supabase.co:5432/postgres' });
  assert.equal(remote.status, 1);
  assert.match(remote.stderr, /REMOTE_TARGET_REFUSED/);
  assert.doesNotMatch(remote.stderr, /secret/);
});

test('Supabase migration apply requires explicit acknowledgement before any connection', () => {
  const result = run('apply', { OSAAH_POSTGRES_URL: 'postgresql://user:secret@localhost:5432/postgres' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /APPLY_ACKNOWLEDGEMENT_REQUIRED/);
});
