import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStudentService } from '../src/students.js';
import { createSubjectService } from '../src/subjects.js';
import { createAcademicResultsService } from '../src/academic-results.js';

const schoolId = 'school-osaah-daylight';
const actor = { id: 'proprietor-qa', roleKey: 'PROPRIETOR', schoolId, permissions: new Set(['mock.scores.write', 'mock.scores.read', 'results.read', 'results.generate']) };
const context = { academicYear: '2026/2027', term: 'First Term' };

function setup() {
  const students = createStudentService({ schoolId });
  const subjects = createSubjectService({ schoolId });
  const results = createAcademicResultsService({ schoolId, students, subjects });
  return { students, subjects, results };
}

function enrolled(students, classId, year = context.academicYear, term = context.term) {
  const student = students.createStudent({ firstName: 'Roster', surname: classId.replace(/ /g, ''), classId: null });
  return students.assignClass(student.id, { classId, academicYearId: year, termId: term });
}

test('fallback Mock roster is limited to the selected JHS class and academic context', () => {
  const { students, subjects, results } = setup();
  const jhs1 = enrolled(students, 'JHS 1');
  const jhs2 = enrolled(students, 'JHS 2');
  const subject = subjects.list({ classId: 'JHS 1' }, actor)[0];
  results.saveMockScore({ ...context, classId: 'JHS 1', subjectId: subject.id, studentId: jhs1.id, mockLabel: '1st Mock', totalScore: 75 }, actor);
  const roster = results.mockScoreEntryRoster({ ...context, classId: 'JHS 1', subjectId: subject.id, mockLabel: '1st Mock' }, actor);
  assert.deepEqual(roster.map((row) => row.studentId), [jhs1.id]);
  const otherRoster = results.mockScoreEntryRoster({ ...context, classId: 'JHS 2', subjectId: subjects.list({ classId: 'JHS 2' }, actor)[0].id, mockLabel: '1st Mock' }, actor);
  assert.deepEqual(otherRoster.map((row) => row.studentId), [jhs2.id]);
  assert.notEqual(jhs1.id, jhs2.id);
});

test('fallback direct Mock Result access rejects cross-class and cross-term requests', () => {
  const { students, subjects, results } = setup();
  const student = enrolled(students, 'JHS 1');
  const subject = subjects.list({ classId: 'JHS 1' }, actor)[0];
  results.saveMockScore({ ...context, classId: 'JHS 1', subjectId: subject.id, studentId: student.id, mockLabel: '1st Mock', totalScore: 80 }, actor);
  assert.doesNotThrow(() => results.result({ ...context, classId: 'JHS 1', studentId: student.id, mockLabel: '1st Mock' }, actor, { mock: true }));
  assert.throws(() => results.result({ ...context, classId: 'JHS 2', studentId: student.id, mockLabel: '1st Mock' }, actor, { mock: true }), /not enrolled in the selected class/);
  assert.throws(() => results.result({ academicYear: context.academicYear, term: 'Second Term', classId: 'JHS 1', studentId: student.id, mockLabel: '1st Mock' }, actor, { mock: true }), /selected academic context/);
});

test('Mock Result UI normalizes durable class objects and requests a context-scoped roster', () => {
  const page = fs.readFileSync(new URL('../public/mock-results.html', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../public/mock-result-view.js', import.meta.url), 'utf8');
  assert.match(page, /name="sampleMode"/);
  assert.match(client, /classNameOf/);
  assert.match(client, /JHS\.has\(classNameOf\(c\)\)/);
  assert.match(client, /\/api\/academic\/result-students/);
  assert.match(client, /sampleMode/);
  assert.match(client, /No students found for this academic context/);
});
