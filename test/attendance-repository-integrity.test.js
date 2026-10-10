import test from 'node:test';
import assert from 'node:assert/strict';
import { createAttendanceRepository } from '../src/attendance-repository.js';

const actor = { id: 'teacher-1', schoolId: 'school-1' };
const entry = (studentId, overrides = {}) => ({ schoolId: 'school-1', academicYear: '2026/2027', term: 'First Term', date: '2026-10-10', classId: 'class-1', studentId, status: 'PRESENT', method: 'MANUAL', source: 'MANUAL', ...overrides });

function database({ transactions = true } = {}) {
  const records = new Map();
  const audits = [];
  const executeLog = [];
  function makeAdapter(withTransaction) {
    const adapter = {
      async query(sql, params = []) {
        if (!sql.includes('FROM student_attendance')) return [];
        if (sql.includes('WHERE id=? AND school_id=?')) {
          const record = records.get(params[0]);
          return record?.schoolId === params[1] ? [{ ...record }] : [];
        }
        if (sql.includes('WHERE school_id=? AND academic_year=?')) {
          return [...records.values()].filter((record) => record.schoolId === params[0] && record.academicYear === params[1] && record.term === params[2] && record.date === params[3] && record.classId === params[4] && record.studentId === params[5] && record.subjectKey === params[6]).map((record) => ({ ...record }));
        }
        return [];
      },
      async execute(sql, params = []) {
        executeLog.push({ sql, params });
        if (sql.startsWith('INSERT INTO student_attendance')) {
          const [id, schoolId, academicYear, term, date, classId, studentId, subjectId, subjectKey, status, method, arrivalTime, departureTime, reason, version, enteredBy, enteredAt, recordedBy, recordedAt, updatedBy, updatedAt, source] = params;
          records.set(id, { id, schoolId, academicYear, term, date, classId, studentId, subjectId, subjectKey, status, method, arrivalTime, departureTime, reason, version, enteredBy, enteredAt, recordedBy, recordedAt, updatedBy, updatedAt, source });
          return { affectedRows: 1 };
        }
        if (sql.startsWith('UPDATE student_attendance')) {
          const [status, method, arrivalTime, departureTime, reason, updatedBy, updatedAt, source, id, schoolId, expectedVersion] = params;
          const current = records.get(id);
          if (!current || current.schoolId !== schoolId || current.version !== expectedVersion) return { affectedRows: 0 };
          records.set(id, { ...current, status, method, arrivalTime, departureTime, reason, version: current.version + 1, updatedBy, updatedAt, source });
          return { affectedRows: 1 };
        }
        if (sql.startsWith('INSERT INTO attendance_audit_history')) { audits.push(params); return { affectedRows: 1 }; }
        return { affectedRows: 1 };
      }
    };
    if (withTransaction) adapter.transaction = async (work) => {
      const recordsBefore = new Map([...records].map(([key, value]) => [key, structuredClone(value)]));
      const auditsBefore = audits.length;
      try { return await work(makeAdapter(false)); }
      catch (error) { records.clear(); for (const item of recordsBefore) records.set(...item); audits.splice(auditsBefore); throw error; }
    };
    return adapter;
  }
  return { adapter: makeAdapter(transactions), records, audits, executeLog };
}

test('durable attendance batches are transaction-backed and audit only committed records', async () => {
  const db = database();
  const repository = createAttendanceRepository({ adapter: db.adapter, now: () => '2026-10-10T10:00:00.000Z' });
  const saved = await repository.saveStudentAttendanceBatch([entry('student-1'), entry('student-2')], actor);
  assert.equal(saved.length, 2);
  assert.equal(db.records.size, 2);
  assert.equal(db.audits.length, 2);
  assert.equal(db.executeLog.filter(({ sql }) => sql.startsWith('INSERT INTO student_attendance')).length, 2);
});
test('a validation failure rolls back an earlier row from the same attendance batch', async () => {
  const db = database();
  const repository = createAttendanceRepository({ adapter: db.adapter });
  await assert.rejects(repository.saveStudentAttendanceBatch([entry('student-1'), entry('student-2', { status: 'NOT_A_STATUS' })], actor), /Invalid attendance status/);
  assert.equal(db.records.size, 0);
  assert.equal(db.audits.length, 0);
});
test('duplicate attendance is rejected and a correction requires the exact current version', async () => {
  const db = database();
  const repository = createAttendanceRepository({ adapter: db.adapter, now: () => '2026-10-10T10:00:00.000Z' });
  const [saved] = await repository.saveStudentAttendanceBatch([entry('student-1')], actor);
  await assert.rejects(repository.saveStudentAttendance(entry('student-1'), actor), (error) => error.status === 409 || /already recorded/.test(error.message));
  await assert.rejects(repository.saveStudentAttendance(entry('student-1', { status: 'LATE', reason: 'Traffic' }), actor, { correction: true }), (error) => error.code === 'ATTENDANCE_VERSION_REQUIRED');
  await assert.rejects(repository.saveStudentAttendance(entry('student-1', { status: 'LATE', reason: 'Traffic' }), actor, { correction: true, expectedVersion: saved.version - 1 }), (error) => error.code === 'ATTENDANCE_VERSION_CONFLICT');
  const corrected = await repository.saveStudentAttendance(entry('student-1', { status: 'LATE', reason: 'Traffic' }), actor, { correction: true, expectedVersion: saved.version });
  assert.equal(corrected.version, 2);
  assert.equal(corrected.status, 'LATE');
  assert.equal(db.records.size, 1);
  assert.equal(db.audits.length, 2);
  db.records.clear();
  await assert.rejects(repository.saveStudentAttendance(entry('student-1', { status: 'PRESENT' }), actor, { correction: true, expectedVersion: 2 }), (error) => error.code === 'ATTENDANCE_VERSION_CONFLICT');
  assert.equal(db.records.size, 0);
  assert.equal(db.executeLog.filter(({ sql }) => sql.startsWith('INSERT INTO student_attendance')).length, 1);
});
test('multiple saves refuse to proceed when the database adapter cannot guarantee transactions', async () => {
  const db = database({ transactions: false });
  const repository = createAttendanceRepository({ adapter: db.adapter });
  await assert.rejects(repository.saveStudentAttendanceBatch([entry('student-1'), entry('student-2')], actor), (error) => error.code === 'ATTENDANCE_TRANSACTION_UNAVAILABLE' && error.status === 503);
  assert.equal(db.records.size, 0);
  const [saved] = await repository.saveStudentAttendanceBatch([entry('student-1')], actor);
  assert.equal(saved.studentId, 'student-1');
  assert.equal(db.records.size, 1);
});
