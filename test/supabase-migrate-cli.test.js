import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

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

test('static migration validator rejects a trailing literal backslash-n but allows escaped SQL strings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'osaah-supabase-validator-'));
  const migrationDirectory = join(root, 'supabase', 'migrations');
  const setupDirectory = join(root, 'supabase');
  const scriptDirectory = join(root, 'scripts');
  const migration = join(migrationDirectory, '202610150001_osaah_daylight_schema.sql');
  try {
    await mkdir(migrationDirectory, { recursive: true });
    await mkdir(scriptDirectory, { recursive: true });
    await copyFile(resolve('scripts/validate-supabase-migration.mjs'), join(scriptDirectory, 'validate-supabase-migration.mjs'));
    await copyFile(resolve('supabase/osaah_supabase_setup.sql'), join(setupDirectory, 'osaah_supabase_setup.sql'));
    const canonical = await readFile(resolve('supabase/migrations/202610150001_osaah_daylight_schema.sql'), 'utf8');

    await writeFile(migration, `${canonical}\\n`, 'utf8');
    const invalid = spawnSync(process.execPath, [join(scriptDirectory, 'validate-supabase-migration.mjs')], { cwd: root, encoding: 'utf8' });
    assert.equal(invalid.status, 1, invalid.stdout);
    assert.match(invalid.stderr, /stray literal/);

    const validWithEscapedString = canonical.replace(/\ncommit;\s*$/i, "\nSELECT E'\\\\n';\ncommit;\n");
    await writeFile(migration, validWithEscapedString, 'utf8');
    const valid = spawnSync(process.execPath, [join(scriptDirectory, 'validate-supabase-migration.mjs')], { cwd: root, encoding: 'utf8' });
    assert.equal(valid.status, 0, valid.stderr);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
