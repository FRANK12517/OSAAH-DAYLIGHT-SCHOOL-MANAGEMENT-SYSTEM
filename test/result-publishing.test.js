import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStudentService } from '../src/students.js';
import { createAcademicResultsService } from '../src/academic-results.js';

const teacher = { id: 'teacher-publish', roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', assignedClassIds: ['Primary 1'], permissions: new Set(['marks.write', 'results.read', 'results.publish']) };
function setup() {
  const students = createStudentService();
  const subjects = { get: (id) => ({ id, active: true, classIds: ['Primary 1'] }) };
  const student = students.createStudent({ firstName: 'Ama', surname: 'Publish', classId: 'Primary 1', admissionYearId: '2026' });
  const results = createAcademicResultsService({ students, subjects, classes: ['Primary 1'] });
  results.saveScore({ studentId: student.id, classId: 'Primary 1', subjectId: 'Math', academicYear: '2026/2027', term: 'First Term', caScore: 40, examScore: 40 }, teacher);
  return { student, results };
}
const complete = (student, interest = 'Shows strong interest') => ({ studentId: student.id, permanentStudentId: student.permanentStudentId, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', examination: 'TERMINAL', attendance: { timesPresent: 18, timesAbsent: 2, totalSchoolDays: 20 }, assessment: { conduct: 'Demonstrates exceptional honesty', attitude: 'Shows consistent respect', interest, classTeacherRemarks: 'A very good term.', headteacherRemarks: 'Promoted to the next class.' } });

test('production publication is blocked before Save Result and reports the exact save checkpoint', () => {
  const { student, results } = setup();
  assert.throws(() => results.publishResults({ studentId: student.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', examination: 'TERMINAL' }, teacher), /Save this result before publishing\./);
  assert.equal(results.publicationFor({ studentId: student.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }), null);
});

test('publication compares current assessment/version and only exposes a published result after a current save', () => {
  const { student, results } = setup();
  const saved = results.saveResult(complete(student), teacher);
  assert.throws(() => results.publishResults({ ...complete(student, 'Shows limited interest'), expectedVersion: saved.version }, teacher), /unsaved changes/);
  assert.throws(() => results.publishResults({ ...complete(student), expectedVersion: saved.version + 1 }, teacher), /unsaved changes/);
  assert.equal(results.publicationFor({ classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }), null);
  const savedAgain = results.saveResult(complete(student, 'Shows limited interest'), teacher);
  const published = results.publishResults({ ...complete(student, 'Shows limited interest'), expectedVersion: savedAgain.version }, teacher);
  assert.equal(published.status, 'PUBLISHED');
  assert.equal(results.publicationFor({ classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }).status, 'PUBLISHED');
  assert.equal(results.savedResultFor({ studentId: student.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', examination: 'TERMINAL' }, teacher).status, 'PUBLISHED');
});

test('final result slip keeps publication controls and all required visible sections', () => {
  const html = fs.readFileSync(new URL('../public/results.html', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8');
  for (const text of ['Examination Results', 'Class Score', 'Exam Score', 'Total Score', 'Subject Position', 'Grade', 'Remark', 'Conduct', 'Attitude', 'Interest', 'Class Teacher Remarks', 'Headteacher Remarks', 'Times Present', 'Times Absent', 'Total School Days', 'CLASS_TEACHER', 'HEADTEACHER']) assert.match(client, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(client, /Publish Result/); assert.match(client, /expectedVersion/); assert.match(html, /result-slip/); assert.match(html, /border:2px solid #102a43/); assert.match(html, /border:2px solid #d4a72c/);
});
