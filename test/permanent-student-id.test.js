import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createPermanentStudentIdAllocator, reconcilePermanentStudentIds } from '../src/permanent-student-id.js';
import { createStudentService } from '../src/students.js';
import { discoverMigrations } from '../src/platform/migration-runner.js';

test('yearly allocator issues immutable, non-reusable identifiers sequentially', () => {
  const allocator = createPermanentStudentIdAllocator();
  assert.equal(allocator.reserve(2026), 'OSAAH/2026/001');
  assert.equal(allocator.reserve('2026-09-02'), 'OSAAH/2026/002');
  assert.throws(() => allocator.register('OSAAH/2026/002'), /already exists/);
});

test('backfill preserves valid IDs and flags ambiguous records instead of guessing', () => {
  const allocator = createPermanentStudentIdAllocator();
  allocator.register('OSAAH/2025/0003');
  const students = [{ id: 'valid', permanentStudentId: 'OSAAH/2025/0003' }, { id: 'missing' }, { id: 'unknown' }, { id: 'bad', permanentStudentId: 'manual-id' }];
  const report = reconcilePermanentStudentIds(students, { allocate: (year) => allocator.reserve(year), admissionYear: (student) => student.id === 'missing' ? 2026 : null });
  assert.equal(students[0].permanentStudentId, 'OSAAH/2025/0003');
  assert.equal(students[1].permanentStudentId, 'OSAAH/2026/001');
  assert.deepEqual(report.ambiguities.map((item) => item.studentId), ['unknown', 'bad']);
});

test('promotion/class changes cannot alter a permanent Student ID', () => {
  const students = createStudentService({ now: () => '2026-09-02T00:00:00.000Z' });
  const student = students.createStudent({ firstName: 'Ama', surname: 'Mensah', admissionDate: '2026-09-02', classId: 'Primary 4' });
  const promoted = students.assignClass(student.id, { classId: 'Primary 5', reason: 'PROMOTION' });
  assert.equal(promoted.permanentStudentId, student.permanentStudentId);
  assert.equal(students.findByPermanentStudentId(student.permanentStudentId, { roleKey: 'HEADTEACHER' }).id, student.id);
});

test('migration 089 corrects legacy ID copies with an exact repeat-safe prefix match', async () => {
  const migrations = await discoverMigrations(new URL('../schema/', import.meta.url));
  const migration = migrations.find((item) => item.version === 89);
  assert.ok(migration, 'migration 089 is registered');
  for (const table of ['students', 'student_profiles', 'student_enrollments', 'parent_student_links', 'admission_applications', 'student_id_reservations']) {
    assert.match(migration.sql, new RegExp(`UPDATE ${table}\\s+SET`, 'i'));
  }
  assert.match(migration.sql, /CONCAT\('OSAAH\/',\s*SUBSTRING\(permanent_student_id,\s*6\)\)/i);
  assert.match(migration.sql, /WHERE permanent_student_id LIKE 'OSAA\/%'/i);
  assert.doesNotMatch(migration.sql, /WHERE permanent_student_id LIKE 'OSAAH\/%'/i);
  const profileAdmissionNumberCopies = (migration.sql.match(/UPDATE student_profiles/g) ?? []).length;
  assert.equal(profileAdmissionNumberCopies, 3);
});

test('all active ID allocation paths generate only OSAAH-prefixed IDs', async () => {
  const sources = await Promise.all([
    readFile(new URL('../src/permanent-student-id.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/existing-student-linking.js', import.meta.url), 'utf8'),
    readFile(new URL('../src/internal-student-registration.js', import.meta.url), 'utf8')
  ]);
  assert.match(sources[0], /const permanentStudentId = `OSAAH\/\$\{year\}/);
  assert.match(sources[1], /const permanentStudentId = `OSAAH\/\$\{year\}/);
  assert.match(sources[2], /const permanentStudentId = `OSAAH\/\$\{admissionYear\}/);
  assert.doesNotMatch(sources.join('\n'), /const permanentStudentId = `OSAA\//);
});
