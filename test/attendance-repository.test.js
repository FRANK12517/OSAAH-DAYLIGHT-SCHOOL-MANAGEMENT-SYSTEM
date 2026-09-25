import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAttendanceRepository } from '../src/attendance-repository.js';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../schema/049_production_schema_reconciliation.sql', import.meta.url), 'utf8');

test('049 uses the production canonical date columns for attendance indexes', () => {
  assert.match(migration, /idx_student_attendance_scope ON student_attendance\([^)]*\bdate\b[^)]*\)/i);
  assert.match(migration, /uq_student_attendance_scope_identity ON student_attendance\([^)]*\bdate\b[^)]*\)/i);
  assert.doesNotMatch(migration, /student_attendance\([^)]*\battendance_date\b[^)]*\)/i);
  assert.match(migration, /idx_staff_attendance_scope ON staff_attendance\([^)]*\battendance_date\b[^)]*\)/i);
});

test('durable student attendance repository uses date while retaining the date API', async () => {
  const executed = [];
  const adapter = {
    async query(sql) {
      executed.push(sql);
      if (/SELECT .* FROM student_attendance WHERE id=/s.test(sql)) return [{ id: 'attendance-1', schoolId: 'school-1', academicYear: '2026/2027', term: '1st Term', date: '2026-09-24', classId: 'class-1', studentId: 'student-1', subjectId: null, status: 'PRESENT', method: 'MANUAL', version: 1, enteredBy: 'user-1', enteredAt: '2026-09-24T00:00:00.000Z', recordedBy: 'user-1', recordedAt: '2026-09-24T00:00:00.000Z', updatedBy: 'user-1', updatedAt: '2026-09-24T00:00:00.000Z', source: 'MANUAL' }];
      return [];
    },
    async execute(sql) { executed.push(sql); return { affectedRows: 1 }; }
  };
  const repository = createAttendanceRepository({ adapter, now: () => '2026-09-24T00:00:00.000Z' });
  const record = await repository.saveStudentAttendance({ academicYear: '2026/2027', term: '1st Term', date: '2026-09-24', classId: 'class-1', studentId: 'student-1', status: 'PRESENT', method: 'MANUAL' }, { schoolId: 'school-1', userId: 'user-1' });
  assert.equal(record.date, '2026-09-24');
  const studentSql = executed.filter((sql) => /student_attendance/.test(sql)).join('\n');
  assert.match(studentSql, /\bdate\b/);
  assert.doesNotMatch(studentSql, /student_attendance[^;]*attendance_date/i);
});
