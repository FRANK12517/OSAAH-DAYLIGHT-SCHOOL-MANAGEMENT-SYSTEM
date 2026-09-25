import test from 'node:test';
import assert from 'node:assert/strict';
import { createDurableAcademicService } from '../src/durable-academic.js';

const schoolId = 'sch_default_01';
const manager = { id: 'manager-1', schoolId, roleKey: 'SCHOOL_ADMIN', permissions: new Set(['subjects.manage', 'subjects.read', 'marks.write', 'academics.read']) };

function fakeDatabase() {
  const assignments = [];
  const calls = [];
  return {
    assignments,
    calls,
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027', startsOn: '2026-09-01', endsOn: '2027-07-31', isCurrent: 1 }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('FROM classes c JOIN levels')) return [{ id: 'class-basic-1', name: 'Basic 1', displayOrder: 1, levelName: 'LOWER_PRIMARY' }];
      if (sql.includes('FROM subjects WHERE')) return [{ id: 'subject-math', name: 'Mathematics' }];
      if (sql.includes('SELECT c.id,c.name FROM classes')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      if (sql.includes('FROM subject_class_assignments') && sql.includes('JOIN subjects')) {
        return assignments.filter((item) => (!params[1] || item.subjectId === params[1]) && (!params[2] || item.classId === params[2]));
      }
      if (sql.includes('SELECT id,active FROM subject_class_assignments')) {
        return assignments.filter((item) => item.subjectId === params[1] && item.classId === params[2] && item.academicYearId === params[3]);
      }
      return [];
    },
    async execute(sql, params = []) {
      calls.push({ sql, params });
      if (sql.startsWith('INSERT INTO subject_class_assignments')) {
        assignments.push({ id: params[0], schoolId: params[1], subjectId: params[2], classId: params[3], academicYearId: params[4], active: 1 });
        return { affectedRows: 1 };
      }
      return { affectedRows: 1 };
    }
  };
}

test('production durable academic service requires a database adapter', () => {
  assert.throws(() => createDurableAcademicService({ schoolId }), /database is unavailable/i);
});

test('empty durable mappings return no subjects rather than every subject', async () => {
  const database = fakeDatabase();
  const service = createDurableAcademicService({ database, schoolId, idFactory: () => 'assignment-1' });
  assert.deepEqual(await service.listSubjects({ classId: 'class-basic-1', academicYearId: 'year-2026' }, manager), []);
});

test('authorized subject assignment is tenant-scoped and idempotent', async () => {
  const database = fakeDatabase();
  const service = createDurableAcademicService({ database, schoolId, idFactory: () => 'assignment-1', clock: () => '2026-09-25T00:00:00.000Z' });
  const first = await service.assignSubject({ subjectId: 'subject-math', classId: 'class-basic-1', academicYearId: 'year-2026' }, manager);
  const second = await service.assignSubject({ subjectId: 'subject-math', classId: 'class-basic-1', academicYearId: 'year-2026' }, manager);
  assert.equal(first.created, true);
  assert.equal(second.created, false);
  assert.equal(database.assignments.length, 1);
  assert.equal((await service.listAssignments('subject-math', manager)).length, 1);
});

test('durable score validation rejects values outside CA and Exam limits', async () => {
  const database = fakeDatabase();
  const service = createDurableAcademicService({ database, schoolId });
  await assert.rejects(() => service.saveScore({ classId: 'class-basic-1', subjectId: 'subject-math', studentId: 'student-1', academicYear: '2026/2027', term: 'First Term', caScore: 51, examScore: 0 }, manager), /CA score must be between 0 and 50/);
  await assert.rejects(() => service.saveScore({ classId: 'class-basic-1', subjectId: 'subject-math', studentId: 'student-1', academicYear: '2026/2027', term: 'First Term', caScore: 0, examScore: -1 }, manager), /Exam score must be between 0 and 50/);
});

test('cross-school durable academic access is rejected', async () => {
  const database = fakeDatabase();
  const service = createDurableAcademicService({ database, schoolId });
  await assert.rejects(() => service.options({ ...manager, schoolId: 'sch_other_02' }), /Forbidden/);
  await assert.rejects(() => service.assignSubject({ subjectId: 'subject-math', classId: 'class-basic-1' }, { ...manager, schoolId: 'sch_other_02' }), /Forbidden/);
});
