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
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
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
  assert.equal(database.calls.some(({ sql }) => sql.includes('UPDATE subjects SET is_active=1')), false, 'a year-scoped assignment must not globally reactivate the subject record');
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

test('Score Entry options use the authoritative production classes table without requiring levels.level_id', async () => {
  const calls = [];
  const database = {
    async query(sql, params = []) {
      calls.push({ sql, params });
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027', isCurrent: 1 }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term', isCurrent: 1 }];
      if (sql.includes('FROM classes c WHERE c.school_id')) return [{ id: 'class-basic-1', name: 'Basic 1', displayOrder: 1, levelName: 'PRIMARY' }];
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  const result = await service.options(manager);
  assert.deepEqual(result.classes, [{ id: 'class-basic-1', name: 'Basic 1', displayOrder: 1, levelName: 'PRIMARY' }]);
  assert.equal(calls.some(({ sql }) => sql.includes('JOIN levels')), false);
});

test('Score Entry options survive production class tables without optional ordering metadata', async () => {
  const calls = [];
  const database = {
    async query(sql) {
      calls.push(sql);
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM terms')) return [{ id: 'term-1', academicYearId: 'year-2026', name: 'First Term' }];
      if (sql.includes('c.sort_order')) throw new Error("Unknown column 'c.sort_order' in 'field list'");
      if (sql.includes('SELECT c.id,c.name FROM classes')) return [{ id: 'class-basic-1', name: 'Basic 1' }];
      throw new Error(`Unexpected query: ${sql}`);
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  const result = await service.options(manager);
  assert.deepEqual(result.classes, [{ id: 'class-basic-1', name: 'Basic 1' }]);
  assert.equal(calls.some((sql) => sql.includes('c.level_id')), false);
});

test('year-scoped subject configuration prefers a year override, displays inactive assignments and excludes other years', async () => {
  const assignments = [
    { assignmentId: 'global-english', id: 'subject-english', code: 'ENG', name: 'English Language', departmentId: null, subjectType: 'CORE', isScoring: 1, subjectActive: 1, classId: 'class-primary-1', className: 'Primary 1', academicYearId: null, assignmentActive: 1 },
    { assignmentId: 'year-english', id: 'subject-english', code: 'ENG', name: 'English Language', departmentId: null, subjectType: 'CORE', isScoring: 1, subjectActive: 1, classId: 'class-primary-1', className: 'Primary 1', academicYearId: 'year-2026', assignmentActive: 0 },
    { assignmentId: 'other-year-math', id: 'subject-math', code: 'MATH', name: 'Mathematics', departmentId: null, subjectType: 'CORE', isScoring: 1, subjectActive: 1, classId: 'class-primary-1', className: 'Primary 1', academicYearId: 'year-2027', assignmentActive: 1 }
  ];
  const database = {
    async query(sql, params = []) {
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('FROM classes WHERE school_id')) return [{ id: 'class-primary-1', name: 'Primary 1' }];
      if (sql.includes('FROM subjects WHERE school_id=? ORDER BY name,id')) return [
        { id: 'subject-english', code: 'ENG', name: 'English Language', departmentId: null, subjectType: 'CORE', isScoring: 1, isActive: 1, assessmentComponentsJson: '[]' },
        { id: 'subject-history', code: 'HIST', name: 'History', departmentId: null, subjectType: 'CORE', isScoring: 1, isActive: 1, assessmentComponentsJson: '[]' },
        { id: 'subject-jhs-only', code: 'CAREER', name: 'Career Technology', departmentId: null, subjectType: 'CORE', isScoring: 1, isActive: 1, assessmentComponentsJson: '[]' }
      ];
      if (sql.includes('SELECT a.subject_id AS subjectId,a.class_id AS classId,a.active,c.name AS className')) return [];
      if (sql.includes('FROM subject_class_assignments a JOIN subjects s')) return assignments.filter((row) => row.classId === params[1] && (row.academicYearId == null || row.academicYearId === params[2]));
      if (sql.includes('FROM subject_class_assignments WHERE school_id=? AND class_id=?')) return assignments.filter((row) => row.classId === params[1]).map((row) => ({ id: row.id }));
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  const result = await service.subjectConfiguration(manager, { academicYearId: 'year-2026', classId: 'class-primary-1' });
  assert.equal(result.academicYear, '2026/2027');
  assert.equal(result.className, 'Primary 1');
  assert.deepEqual(result.subjects.map((subject) => subject.name), ['English Language', 'History']);
  assert.equal(result.subjects[0].active, false, 'the selected year override wins over the active school default');
  assert.equal(result.subjects[0].mandatory, true);
  assert.equal(result.subjects[0].subjectType, 'CORE');
  const history = result.subjects.find((subject) => subject.id === 'subject-history');
  assert.equal(history.assigned, false);
  assert.equal(history.active, false);
  assert.equal(history.subjectType, 'CORE');
  assert.equal(result.subjects.some((subject) => subject.name === 'Career Technology'), false, 'subjects from a different class band are not offered here');
  await assert.rejects(() => service.subjectConfiguration({ ...manager, schoolId: 'sch_other_02' }, { academicYearId: 'year-2026', classId: 'class-primary-1' }), /Forbidden/);
});

test('legacy class_subjects mapping remains an authoritative subject source when normalized assignments are unavailable', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('subject_class_assignments')) throw new Error("Table 'subject_class_assignments' doesn't exist");
      if (sql.includes('class_subjects')) return [{ id: 'subject-math', code: 'MATH', name: 'Mathematics', departmentId: null, classId: 'class-basic-1' }];
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  assert.deepEqual(await service.listSubjects({ classId: 'class-basic-1' }, manager), [{ id: 'subject-math', code: 'MATH', name: 'Mathematics', departmentId: null, classId: 'class-basic-1', active: true, subjectActive: true }]);
});

test('legacy class_subjects mapping is used when normalized assignments exist but contain no active rows', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('FROM academic_years')) return [{ id: 'year-2026', name: '2026/2027' }];
      if (sql.includes('subject_class_assignments')) return [];
      if (sql.includes('class_subjects')) return [{ id: 'subject-english', code: 'ENG', name: 'English Language', departmentId: null, classId: 'class-basic-1' }];
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  assert.deepEqual(await service.listSubjects({ classId: 'class-basic-1', academicYearId: 'year-2026' }, manager), [{ id: 'subject-english', code: 'ENG', name: 'English Language', departmentId: null, classId: 'class-basic-1', active: true, subjectActive: true }]);
});
test('inactive normalized assignments do not leak back through legacy class_subjects rows', async () => {
  const database = {
    async query(sql) {
      if (sql.includes('subject_class_assignments')) return [{ id: 'subject-math', code: 'MATH', name: 'Mathematics', departmentId: null, classId: 'class-basic-1', assignmentActive: 0 }];
      if (sql.includes('class_subjects')) return [{ id: 'subject-math', code: 'MATH', name: 'Mathematics', departmentId: null, classId: 'class-basic-1' }];
      return [];
    },
    async execute() { return { affectedRows: 1 }; }
  };
  const service = createDurableAcademicService({ database, schoolId });
  assert.deepEqual(await service.listSubjects({ classId: 'class-basic-1' }, manager), []);
});
