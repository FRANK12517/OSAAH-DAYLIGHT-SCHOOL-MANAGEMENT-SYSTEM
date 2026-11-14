import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertMigration085Release, protectedMainFetchArgs } from '../scripts/verify-migration-085-release.mjs';

const releaseSha = 'a'.repeat(40);
const mainSha = '2'.repeat(40);

test('Migration 085 accepts an exact full reviewed SHA reachable from protected main', () => {
  assert.deepEqual(assertMigration085Release({ releaseRef: releaseSha, checkedOutSha: releaseSha, protectedMainSha: mainSha, isAncestor: true }), {
    releaseSha,
    protectedMainSha: mainSha
  });
});

test('Migration 085 rejects missing, abbreviated, uppercase, or malformed release references', () => {
  for (const releaseRef of [undefined, '', releaseSha.slice(0, 12), releaseSha.toUpperCase(), 'not-a-commit']) {
    assert.throws(() => assertMigration085Release({ releaseRef, checkedOutSha: releaseSha, protectedMainSha: mainSha, isAncestor: true }), /full lowercase 40-character commit SHA/);
  }
});

test('Migration 085 rejects a checked-out commit that differs from the reviewed release', () => {
  assert.throws(() => assertMigration085Release({ releaseRef: releaseSha, checkedOutSha: '3'.repeat(40), protectedMainSha: mainSha, isAncestor: true }), /does not match reviewed release/);
});

test('Migration 085 rejects a reviewed commit that is not reachable from protected main', () => {
  assert.throws(() => assertMigration085Release({ releaseRef: releaseSha, checkedOutSha: releaseSha, protectedMainSha: mainSha, isAncestor: false }), /not reachable from protected main/);
});

test('Migration 085 fetches the protected main refspec and can unshallow when required', () => {
  assert.deepEqual(protectedMainFetchArgs(false), ['fetch', '--no-tags', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
  assert.deepEqual(protectedMainFetchArgs(true), ['fetch', '--no-tags', '--unshallow', 'origin', '+refs/heads/main:refs/remotes/origin/main']);
});

test('Migration 085 workflow retains exact-main execution, Production approval, and DRY_RUN_ONLY gating', async () => {
  const workflow = await readFile(new URL('../.github/workflows/production-global-student-id-unique-migration-085.yml', import.meta.url), 'utf8');
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /fetch-depth: 0/);
  assert.match(workflow, /node scripts\/verify-migration-085-release\.mjs/);
  assert.match(workflow, /execution_token == 'DRY_RUN_ONLY'[\s\S]*production-global-student-id-unique-migrate-085\.mjs dry-run/);
  assert.match(workflow, /execution_token == 'APPLY_GLOBAL_STUDENT_ID_UNIQUE_085'[\s\S]*production-global-student-id-unique-migrate-085\.mjs apply/);
  assert.doesNotMatch(workflow, /merge-base --is-ancestor origin\/main/);
});
