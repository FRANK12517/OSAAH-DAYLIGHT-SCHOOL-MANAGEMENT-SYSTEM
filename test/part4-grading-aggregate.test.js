import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateAggregate, calculateClassPositions, calculateStudentResult } from '../src/result-calculation.js';
import { gradeForTotal } from '../src/grading.js';
import { createStudentService } from '../src/students.js';
import { createSubjectService } from '../src/subjects.js';
import { createAcademicResultsService } from '../src/academic-results.js';

const row = (subjectName, totalScore, extra = {}) => ({ subjectId: subjectName.toLowerCase().replace(/\s+/g, '-'), subjectName, totalScore, ...extra });
const primaryRows = (electives = []) => [row('English Language', 80), row('Mathematics', 70), row('Science', 60), row('History', 55), ...electives];
const jhsRows = (electives = []) => [row('English Language', 80), row('Mathematics', 70), row('Integrated Science', 60), row('Social Studies', 50), ...electives];

test('Primary grading covers every canonical boundary and point gap', () => {
  for (const [mark, point, remark] of [[100,1,'HIGHEST'],[80,1,'HIGHEST'],[79,2,'HIGHER'],[70,2,'HIGHER'],[69,3,'HIGH'],[60,3,'HIGH'],[59,4,'HIGH AVERAGE'],[55,4,'HIGH AVERAGE'],[54,5,'AVERAGE'],[50,5,'AVERAGE'],[49,6,'LOW AVERAGE'],[40,6,'LOW AVERAGE'],[39,8,'LOWER'],[35,8,'LOWER'],[34,9,'LOWEST'],[0,9,'LOWEST']]) assert.deepEqual(gradeForTotal(mark, { classId: 'Primary 4' }), [point, remark]);
});

test('JHS terminal and Mock share the canonical scale and remarks', () => {
  for (const examination of ['TERMINAL', 'MOCK']) {
    assert.deepEqual(gradeForTotal(80, { classId: 'JHS 1', examination }), [1, 'EXCELLENT / HIGHEST']);
    assert.deepEqual(gradeForTotal(50, { classId: 'JHS 1', examination }), [4, 'CREDIT / HIGH AVERAGE']);
    assert.deepEqual(gradeForTotal(35, { classId: 'JHS 1', examination }), [7, 'PASS / LOW']);
    assert.deepEqual(gradeForTotal(24, { classId: 'JHS 1', examination }), [9, 'FAIL / LOWEST']);
  }
});

test('KG uses raw scoring totals and never produces a Best Six aggregate', () => {
  const result = calculateStudentResult([row('Language and Literacy', 90), row('Numeracy', 80), row('Our World, Our People', 70), row('Creative Arts', 60)], { classId: 'KG1' });
  assert.equal(result.totalScore, 300); assert.equal(result.average, 75); assert.equal(result.aggregate, null); assert.equal(result.subjectsSat, 4);
  const positions = calculateClassPositions([{ studentId: 'a', totalScore: 301 }, { studentId: 'b', totalScore: 300 }], { classId: 'KG1' });
  assert.equal(positions.get('a'), '1st'); assert.equal(positions.get('b'), '2nd');
});

test('Lower Primary aggregate is four core plus exactly best two electives', () => {
  const result = calculateAggregate(primaryRows([row('RME', 90), row('Creative Arts', 80)]), { classId: 'Primary 1' });
  assert.equal(result.qualifying, true); assert.equal(result.aggregateSubjects.length, 6); assert.equal(result.aggregate, 1 + 2 + 3 + 4 + 1 + 1);
});

test('Upper Primary uses Integrated Science, History, and best two of more than two electives', () => {
  const result = calculateAggregate([row('English Language', 80), row('Mathematics', 80), row('Integrated Science', 80), row('History', 80), row('RME', 70), row('Computing', 60), row('Career Technology', 90), row('French', 50)], { classId: 'Primary 4' });
  assert.deepEqual(result.aggregateSubjects.map((item) => item.subjectName), ['English Language', 'Mathematics', 'Integrated Science', 'History', 'Career Technology', 'RME']);
});

test('Elective ties are deterministic, inactive rows and PE are excluded, and new electives are eligible', () => {
  const result = calculateAggregate(jhsRows([row('RME', 70), row('Creative Arts and Design', 70), row('French', 95), row('Physical Education', 100), row('New Elective', 90, { isScoring: false }), row('Career Technology', 70, { active: false })]), { classId: 'JHS 2', examination: 'MOCK' });
  assert.equal(result.aggregateSubjects.length, 6);
  assert.ok(!result.aggregateSubjects.some((item) => ['Physical Education', 'New Elective', 'Career Technology'].includes(item.subjectName)));
  assert.deepEqual(result.aggregateSubjects.slice(-2).map((item) => item.subjectName), ['French', 'Creative Arts and Design']);
});

test('Primary class positions use aggregate then selected-score tie-breakers without changing tie ranks', () => {
  const positions = calculateClassPositions([
    { studentId: 'a', aggregate: 10, aggregateTotal: 500, aggregateCoreGradeSum: 8, totalScore: 600 },
    { studentId: 'b', aggregate: 10, aggregateTotal: 490, aggregateCoreGradeSum: 8, totalScore: 610 },
    { studentId: 'c', aggregate: 12, aggregateTotal: 600, aggregateCoreGradeSum: 9, totalScore: 700 }
  ], { classId: 'Primary 4' });
  assert.equal(positions.get('a'), '1st'); assert.equal(positions.get('b'), '2nd'); assert.equal(positions.get('c'), '3rd');
});

test('Mock subject positions isolate 1st Mock from 2nd Mock', () => {
  const students = createStudentService(); const subjects = createSubjectService(); const results = createAcademicResultsService({ students, subjects });
  const actor = { id: 'teacher', roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', assignedClassIds: ['JHS 1'], permissions: new Set(['mock.scores.read', 'mock.scores.write']) };
  const first = students.createStudent({ firstName: 'First', surname: 'Mock', classId: 'JHS 1', admissionYearId: '2026' });
  const second = students.createStudent({ firstName: 'Second', surname: 'Mock', classId: 'JHS 1', admissionYearId: '2026' });
  const subject = subjects.list({ classId: 'JHS 1' }, actor).find((item) => item.name === 'English Language');
  results.saveMockScore({ studentId: first.id, classId: 'JHS 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', totalScore: 60 }, actor);
  results.saveMockScore({ studentId: second.id, classId: 'JHS 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', totalScore: 90 }, actor);
  results.saveMockScore({ studentId: first.id, classId: 'JHS 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '2nd Mock', totalScore: 10 }, actor);
  const report = results.result({ studentId: first.id, classId: 'JHS 1', academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock' }, actor, { mock: true });
  assert.equal(report.subjects.find((item) => item.subjectId === subject.id).subjectPosition, '2nd');
});
