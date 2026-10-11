import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAdmissionMigrationService } from '../src/admission-migration-service.js';

const record = (id, changes = {}) => ({
  id, school_id: 'school-1', permanent_student_id: null, first_name: `Name${id}`, last_name: 'Student',
  date_of_birth: '2017-03-02', admission_date: '2020-09-01', profile_count: 1,
  profile_id: `profile-${id}`, profile_master_id: id, profile_student_id: null,
  profile_legacy_id: null, enrollment_count: 1, ...changes
});

function memoryDatabase(initial = [record('student-1')]) {
  const state = { students: structuredClone(initial), sequence: 1, batches: [], items: [], writes: 0, calls: [] };
  const byId = (id) => state.students.find((item) => item.id === id);
  const api = {
    async query(sql, params = []) {
      state.calls.push(['query', sql]);
      if (sql.includes('FROM admission_migration_batches')) return state.batches.filter((item) => item.school_id === params[0] && item.request_key === params[1]).map((item) => ({ ...item }));
      if (sql.includes('FROM admission_migration_items')) return state.items.filter((item) => item.batch_id === params[0] && item.source_student_id === params[1]).map((item) => ({ ...item }));
      if (sql.includes('FROM student_id_sequences')) return [{ next_sequence: state.sequence }];
      if (sql.includes('SELECT permanent_student_id FROM students')) return state.students.filter((item) => item.school_id === params[0] && String(item.permanent_student_id ?? '').startsWith(params[1].slice(0, -1))).filter((item) => item.permanent_student_id).map((item) => ({ permanent_student_id: item.permanent_student_id }));
      if (sql.includes('SELECT student_id,permanent_student_id FROM student_profiles')) return state.students.filter((item) => item.school_id === params[0] && (String(item.profile_student_id ?? '').startsWith(params[1].slice(0, -1)) || String(item.profile_legacy_id ?? '').startsWith(params[2].slice(0, -1)))).flatMap((item) => [item.profile_student_id, item.profile_legacy_id].filter(Boolean).map((value) => ({ student_id: value, permanent_student_id: null })));
      if (sql.includes('SELECT id FROM students WHERE school_id=')) return state.students.filter((item) => item.school_id === params[0] && item.first_name.trim().toLowerCase() === params[1].trim().toLowerCase() && item.last_name.trim().toLowerCase() === params[2].trim().toLowerCase() && item.date_of_birth === params[3]).map((item) => ({ id: item.id }));
      if (sql.includes('SELECT s.id,s.school_id,s.permanent_student_id')) {
        const item = byId(params[1]);
        return item && item.school_id === params[0] ? [{ ...item }] : [];
      }
      if (sql.includes('FROM students s') && sql.includes('LEFT JOIN')) {
        const schoolId = params.at(-1);
        return state.students.filter((item) => item.school_id === schoolId).map((item) => ({ ...item }));
      }
      return [];
    },
    async execute(sql, params = []) {
      state.calls.push(['execute', sql]);
      state.writes += 1;
      if (sql.startsWith('INSERT INTO student_id_sequences')) return { affectedRows: 1 };
      if (sql.startsWith('UPDATE student_id_sequences')) { state.sequence = params[0]; return { affectedRows: 1 }; }
      if (sql.startsWith('INSERT INTO admission_migration_batches')) {
        const [, school_id, request_key, preview_fingerprint, selection_fingerprint, actor_user_id, , created_at, updated_at] = params;
        if (!state.batches.some((item) => item.school_id === school_id && item.request_key === request_key)) state.batches.push({ id: params[0], school_id, request_key, preview_fingerprint, selection_fingerprint, actor_user_id, status: 'RUNNING', created_at, updated_at });
        return { affectedRows: 1 };
      }
      if (sql.startsWith('UPDATE students SET permanent_student_id')) {
        const item = byId(params[3]); if (!item || item.permanent_student_id) return { affectedRows: 0 };
        item.permanent_student_id = params[0]; return { affectedRows: 1 };
      }
      if (sql.startsWith('UPDATE student_profiles SET student_id=')) {
        const item = byId(params[5]); if (!item || item.profile_id !== params[3]) return { affectedRows: 0 };
        item.profile_student_id ??= params[0]; item.profile_legacy_id ??= params[1]; return { affectedRows: 1 };
      }
      if (sql.startsWith('INSERT INTO admission_migration_items')) {
        const [, batch_id, school_id, source_student_id, target_student_id, permanent_student_id, outcome, reason_code, actor_user_id, created_at, updated_at] = params;
        const current = state.items.find((item) => item.batch_id === batch_id && item.source_student_id === source_student_id);
        const value = { id: params[0], batch_id, school_id, source_student_id, target_student_id, permanent_student_id, outcome, reason_code, actor_user_id, created_at, updated_at };
        if (current) Object.assign(current, value); else state.items.push(value);
        return { affectedRows: 1 };
      }
      if (sql.startsWith('UPDATE admission_migration_batches')) {
        const item = state.batches.find((value) => value.id === params[4]); if (item) Object.assign(item, { status: params[0], completed_count: params[1], review_count: params[2] });
        return { affectedRows: item ? 1 : 0 };
      }
      return { affectedRows: 1 };
    },
    async transaction(work) { return work(api); }
  };
  return { api, state };
}

test('database preview is read-only, scoped, privacy-minimal and flags canonical relationship defects', async () => {
  const { api, state } = memoryDatabase([
    record('eligible'),
    record('valid-id', { permanent_student_id: 'OSAAH/2020/0008', profile_student_id: 'OSAAH/2020/0008', profile_legacy_id: 'OSAAH/2020/0008' }),
    record('missing-profile', { profile_count: 0, profile_id: null, profile_master_id: null }),
    record('bad-year', { admission_date: null })
  ]);
  const result = await createAdmissionMigrationService({ database: api }).preview({ schoolId: 'school-1' });
  assert.equal(result.dryRun, true);
  assert.equal(result.writesPerformed, 0);
  assert.deepEqual(result.counts, { total: 4, eligible: 1, alreadyHasId: 1, blocked: 2, duplicate: 0, invalidId: 0, unverifiedYear: 1, needsPermanentId: 3, manualReview: 2, skipped: 2 });
  assert.ok(result.records.find((item) => item.studentRef === 'missing-profile').reasons.includes('MISSING_STUDENT_PROFILE'));
  assert.ok(result.records.find((item) => item.studentRef === 'bad-year').reasons.includes('UNVERIFIED_ADMISSION_YEAR'));
  assert.ok(result.records.every((item) => !('first_name' in item) && !('last_name' in item)));
  assert.equal(state.writes, 0);
  assert.ok(state.calls.every(([kind]) => kind === 'query'));
});

test('migration requires a matching dry-run and writes a missing four-digit ID atomically with resumable audit state', async () => {
  const { api, state } = memoryDatabase([record('student-1')]);
  let id = 0;
  const service = createAdmissionMigrationService({ database: api, idFactory: () => `uuid-${++id}`, clock: () => '2026-10-11T00:00:00.000Z' });
  const preview = await service.preview({ schoolId: 'school-1' });
  await assert.rejects(service.execute({ schoolId: 'school-1', actorId: 'operator-1', requestKey: 'migration-1', previewFingerprint: '0'.repeat(64), studentRefs: ['student-1'] }), { code: 'PREVIEW_STALE' });
  assert.equal(state.writes, 0);
  const result = await service.execute({ schoolId: 'school-1', actorId: 'operator-1', requestKey: 'migration-1', previewFingerprint: preview.fingerprint, studentRefs: ['student-1'] });
  assert.deepEqual(result.summary, { total: 1, migrated: 1, preserved: 0, needsReview: 0, failed: 0 });
  assert.equal(state.students[0].permanent_student_id, 'OSAAH/2020/0001');
  assert.equal(state.students[0].profile_student_id, 'OSAAH/2020/0001');
  assert.equal(state.sequence, 2);
  assert.equal(state.items[0].outcome, 'MIGRATED');
  assert.equal(state.batches[0].status, 'COMPLETED');
  const retry = await service.execute({ schoolId: 'school-1', actorId: 'operator-1', requestKey: 'migration-1', previewFingerprint: preview.fingerprint, studentRefs: ['student-1'] });
  assert.equal(retry.items[0].permanentStudentId, 'OSAAH/2020/0001');
  assert.equal(state.students.length, 1);
  assert.equal(state.items.length, 1);
  assert.equal(state.sequence, 2);
});

test('migration rejects ambiguous identities and never changes source identity or enrollment records', async () => {
  const first = record('same-a'); const second = record('same-b', { first_name: first.first_name, last_name: first.last_name, date_of_birth: first.date_of_birth });
  const { api, state } = memoryDatabase([first, second]);
  const service = createAdmissionMigrationService({ database: api });
  const preview = await service.preview({ schoolId: 'school-1' });
  assert.equal(preview.counts.eligible, 0);
  assert.equal(preview.counts.duplicate, 2);
  assert.ok(preview.records.every((item) => item.reasons.includes('POSSIBLE_DUPLICATE_IDENTITY')));
  await assert.rejects(service.execute({ schoolId: 'school-1', actorId: 'operator-1', requestKey: 'migration-dup', previewFingerprint: preview.fingerprint, studentRefs: ['same-a'] }), { code: 'MIGRATION_SELECTION_INVALID' });
  assert.equal(state.writes, 0);
  assert.equal(state.students.length, 2);
  assert.equal(state.sequence, 1);
});

test('database read failures return a safe schema-unavailable error', async () => {
  const database = { transaction: async (work) => work(database), query: async () => { throw new Error('private SQL detail'); } };
  await assert.rejects(createAdmissionMigrationService({ database }).preview({ schoolId: 'school-1' }), (error) => error.code === 'ADMISSION_SCHEMA_UNAVAILABLE' && !error.message.includes('private'));
});

test('migration DDL adds only resumable audit tables and request uniqueness', async () => {
  const sql = await readFile(new URL('../schema/081_admission_migration_audit.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS admission_migration_batches/);
  assert.match(sql, /uq_admission_migration_request \(school_id, request_key\)/);
  assert.match(sql, /uq_admission_migration_batch_student \(batch_id, source_student_id\)/);
  assert.doesNotMatch(sql, /\b(?:DROP|DELETE|TRUNCATE)\s+/i);
});
