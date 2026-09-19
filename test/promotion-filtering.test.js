import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CORE_LEVELS, createStudentService } from '../src/students.js';
import { PROMOTION_DECISIONS, createExaminationService } from '../src/examinations.js';

test('promotion options filter by school, academic year, class, and term', () => {
  const students = createStudentService();
  const exams = createExaminationService({ students, classes: CORE_LEVELS });
  const actor = { id: 'head', userId: 'head', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight' };
  const nursery = students.createStudent({ firstName: 'Ama', surname: 'Nursery', classId: 'Nursery 1', academicYearId: '2026/2027', termId: 'First Term' });
  students.assignClass(nursery.id, { classId: 'Nursery 1', academicYearId: '2026/2027', termId: 'Second Term' });
  const wrongClass = students.createStudent({ firstName: 'Kojo', surname: 'JHS', classId: 'JHS 3', academicYearId: '2026/2027', termId: 'First Term' });
  const wrongYear = students.createStudent({ firstName: 'Esi', surname: 'OldYear', classId: 'Nursery 1', academicYearId: '2025/2026', termId: 'First Term' });
  const wrongTerm = students.createStudent({ firstName: 'Yaw', surname: 'ThirdTerm', classId: 'Nursery 1', academicYearId: '2026/2027', termId: 'Third Term' });
  const first = exams.promotionOptions({ academicYearId: '2026/2027', classId: 'Nursery 1', termId: 'First Term' }, actor);
  assert.equal(first.students.length, 1); assert.equal(first.students[0].id, nursery.id); assert.equal(first.students[0].permanentStudentId, nursery.permanentStudentId);
  assert.ok(!first.students.some((s) => [wrongClass.id, wrongYear.id, wrongTerm.id].includes(s.id)));
  assert.deepEqual(first.classes, CORE_LEVELS); assert.deepEqual(first.terms, ['First Term', 'Second Term', 'Third Term']);
  assert.ok(PROMOTION_DECISIONS.includes('PROMOTED'));
});

test('Nursery promotion validates each term and preserves permanent identity', () => {
  const students = createStudentService(); const exams = createExaminationService({ students, classes: CORE_LEVELS });
  const actor = { id: 'head', userId: 'head', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight' };
  const student = students.createStudent({ firstName: 'Ama', surname: 'Nursery', classId: 'Nursery 1', academicYearId: '2026/2027', termId: 'First Term' });
  const permanentId = student.permanentStudentId;
  for (const termId of ['First Term', 'Second Term', 'Third Term']) {
    if (termId !== 'First Term') students.assignClass(student.id, { classId: 'Nursery 1', academicYearId: '2026/2027', termId });
    const record = exams.promote(student.id, '2026/2027', 'PROMOTED', actor, `${termId} decision`, { classId: 'Nursery 1', termId });
    assert.equal(record.termId, termId); assert.equal(record.classId, 'Nursery 1');
  }
  assert.equal(students.getStudent(student.id).permanentStudentId, permanentId);
  assert.throws(() => exams.promote(student.id, '2026/2027', 'PROMOTED', actor, null, { classId: 'JHS 3', termId: 'First Term' }), /not enrolled/);
});

test('sample records cannot be promoted into production enrollment', () => {
  const students = createStudentService(); const sample = students.seedSampleStudents().find((item) => item.classId === 'Nursery 1');
  const exams = createExaminationService({ students, classes: CORE_LEVELS }); const actor = { id: 'head', userId: 'head', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight' };
  assert.throws(() => exams.promote(sample.id, '2026/2027', 'PROMOTED', actor, null, { classId: 'Nursery 1', termId: 'First Term' }), /Sample students/);
  const testOptions = exams.promotionOptions({ academicYearId: '2026/2027', classId: 'Nursery 1', termId: 'First Term', isSample: true }, actor);
  assert.equal(testOptions.students.length, 0);
});

test('promotion page has one class selector, one term selector, filtered student identity, and explicit save', () => {
  const html = fs.readFileSync(new URL('../public/promotion.html', import.meta.url), 'utf8');
  assert.equal((html.match(/id="promotion-class"/g) ?? []).length, 1); assert.equal((html.match(/id="promotion-term"/g) ?? []).length, 1); assert.match(html, /Student<select/); assert.match(html, /permanentStudentId/); assert.match(html, /Save Promotion Decision/); assert.match(html, /api\/examinations\/promotion\/options/); assert.match(html, /api\/examinations\/promotion'/);
});
