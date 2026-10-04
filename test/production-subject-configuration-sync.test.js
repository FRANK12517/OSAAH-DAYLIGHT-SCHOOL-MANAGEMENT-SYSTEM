import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateSubjectSyncExecution } from '../src/platform/subject-sync-guards.js';

const script = await readFile(new URL('../scripts/production-subject-configuration-sync.mjs', import.meta.url), 'utf8');
const workflow = await readFile(new URL('../.github/workflows/production-subject-configuration-sync.yml', import.meta.url), 'utf8');
const server = await readFile(new URL('../src/server.mjs', import.meta.url), 'utf8');
const guards = await readFile(new URL('../src/platform/subject-sync-guards.js', import.meta.url), 'utf8');

test('protected workflow pins reviewed release SHA, exact school/year scope and production environment', () => {
  assert.match(workflow, /environment:\s*production/i);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /release_ref:/);
  assert.match(workflow, /academic_year_id:/);
  assert.match(workflow, /git merge-base --is-ancestor/);
  assert.match(workflow, /test "\$\(git rev-parse HEAD\^\{commit\}\)" = "\$RELEASE_REF"/);
  assert.match(workflow, /backup_confirmation:/);
  assert.match(workflow, /APPLY_SUBJECT_CONFIGURATION/);
});

test('DRY_RUN_ONLY script path has zero writes and exact production target checks', () => {
  const dryRunStart = script.indexOf("if (mode === 'dry-run') {");
  const serviceStart = script.indexOf('const service = createDurableAcademicService', dryRunStart);
  assert.ok(dryRunStart >= 0 && serviceStart > dryRunStart);
  const dryRunBlock = script.slice(dryRunStart, serviceStart);
  assert.doesNotMatch(dryRunBlock, /\.execute\s*\(|\.transaction\s*\(/);
  assert.match(dryRunBlock, /productionWrites:\s*0/);
  assert.match(script, /osaahdaylightschool/);
  assert.match(script, /DATABASE_TARGET_MISMATCH/);
  assert.match(script, /SCHOOL_SCOPE_MISMATCH/);
  assert.match(script, /ACADEMIC_YEAR_SCOPE_MISMATCH/);
  assert.match(script, /PREREQUISITE_SCHEMA_MISSING/);
});

test('APPLY requires a distinct token, recoverable backup, transactional sync and unchanged history counts', () => {
  assert.match(guards, /APPLY_SUBJECT_CONFIGURATION/);
  assert.match(guards, /BACKUP_CONFIRMED/);
  assert.match(script, /service\.configureDefaultSubjects[\s\S]*academicYearId/);
  assert.match(script, /HISTORICAL_RECORDS_CHANGED/);
  assert.match(script, /POST_APPLY_VERIFICATION_FAILED/);
  assert.match(script, /duplicateDetection/);
});

test('production score, result and subject routes return a controlled unavailable status without the durable service', () => {
  assert.match(server, /process\.env\.NODE_ENV === 'production' && !durableAcademic && \(durableAcademicEndpoints\.has\(pathname\) \|\| pathname\.startsWith\('\/api\/subjects\/'\)\)/);
  assert.match(server, /Durable academic data is unavailable; apply the required migrations/);
});

test('unauthorized APPLY is rejected unless its distinct token, exact scope, release SHA and backup confirmation are present', () => {
  const base = { mode: 'apply', databaseUrl: 'configured', releaseSha: 'a'.repeat(40), schoolId: 'school-osaah-daylight', academicYearId: 'year-2026', executionToken: 'DRY_RUN_ONLY', backupConfirmation: '' };
  assert.throws(() => validateSubjectSyncExecution(base), { code: 'APPLY_APPROVAL_REQUIRED' });
  assert.throws(() => validateSubjectSyncExecution({ ...base, executionToken: 'APPLY_SUBJECT_CONFIGURATION' }), { code: 'BACKUP_CONFIRMATION_REQUIRED' });
  assert.throws(() => validateSubjectSyncExecution({ ...base, releaseSha: 'not-a-commit-sha', executionToken: 'APPLY_SUBJECT_CONFIGURATION', backupConfirmation: 'BACKUP_CONFIRMED' }), { code: 'RELEASE_SHA_REQUIRED' });
  assert.equal(validateSubjectSyncExecution({ ...base, executionToken: 'APPLY_SUBJECT_CONFIGURATION', backupConfirmation: 'BACKUP_CONFIRMED' }), true);
});
