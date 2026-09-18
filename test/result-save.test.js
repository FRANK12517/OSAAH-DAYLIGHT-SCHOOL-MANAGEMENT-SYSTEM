import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStudentService } from '../src/students.js';
import { createAcademicResultsService } from '../src/academic-results.js';

const manager = { id: 'head-1', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };
const teacher = { id: 'teacher-1', roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', assignedClassIds: ['Primary 1'], permissions: new Set(['marks.write', 'results.read', 'results.publish']) };
function setup() {
  const students = createStudentService();
  const subjects = { get: (id) => ({ id, active: true, classIds: ['Primary 1'] }) };
  const student = students.createStudent({ firstName: 'Ama', surname: 'Save', classId: 'Primary 1', admissionYearId: '2026' });
  const results = createAcademicResultsService({ students, subjects, classes: ['Primary 1'] });
  results.saveScore({ studentId: student.id, classId: 'Primary 1', subjectId: 'Math', academicYear: '2026/2027', term: 'First Term', caScore: 40, examScore: 40 }, teacher);
  return { students, student, results };
}
const complete = (student) => ({ studentId: student.id, permanentStudentId: student.permanentStudentId, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', examination: 'TERMINAL', attendance: { timesPresent: 18, timesAbsent: 2, totalSchoolDays: 20 }, assessment: { conduct: 'Demonstrates exceptional honesty', attitude: 'Shows consistent respect', interest: 'Shows strong interest', classTeacherRemarks: 'A very good term.', headteacherRemarks: 'Promoted to the next class.' } });

test('Save Result reports all missing required components with exact messages', () => {
  const { student, results } = setup();
  const missing = complete(student); missing.attendance = {}; missing.assessment = {};
  assert.throws(() => results.saveResult(missing, teacher), (error) => error.message === 'Attendance: Times Present has not been captured. Attendance: Times Absent has not been captured. Attendance: Total School Days has not been captured. Conduct has not been selected. Attitude has not been selected. Interest has not been selected. Class Teacher Remarks has not been selected. Headteacher Remarks has not been selected.');
});

test('Save Result persists scores, attendance, assessments, and SAVED state across retrieval', () => {
  const { student, results } = setup();
  const saved = results.saveResult(complete(student), teacher);
  assert.equal(saved.status, 'SAVED'); assert.equal(saved.dirty, false); assert.equal(saved.version, 1);
  const refreshed = results.savedResultFor({ studentId: student.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', examination: 'TERMINAL' }, teacher);
  assert.equal(refreshed.assessment.conduct, 'Demonstrates exceptional honesty'); assert.equal(refreshed.attendance.totalSchoolDays, 20); assert.equal(refreshed.status, 'SAVED');
});

test('editing an underlying score makes the saved result dirty and saving again restores SAVED', () => {
  const { student, results } = setup(); results.saveResult(complete(student), teacher);
  results.saveScore({ studentId: student.id, classId: 'Primary 1', subjectId: 'Math', academicYear: '2026/2027', term: 'First Term', caScore: 45, examScore: 40 }, teacher);
  assert.equal(results.savedResultFor({ studentId: student.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', examination: 'TERMINAL' }, teacher).status, 'UNSAVED/INCOMPLETE');
  const savedAgain = results.saveResult(complete(student), teacher); assert.equal(savedAgain.status, 'SAVED'); assert.equal(savedAgain.version, 2);
});

test('invalid attendance is rejected and authorized publication advances SAVED to PUBLISHED', () => {
  const { student, results } = setup();
  const invalid = complete(student); invalid.attendance.timesPresent = 'not-a-number';
  assert.throws(() => results.saveResult(invalid, teacher), /Attendance: Times Present has not been captured/);
  results.saveResult(complete(student), teacher);
  const publication = results.publishResults({ studentId: student.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', examination: 'TERMINAL' }, teacher);
  assert.equal(publication.status, 'PUBLISHED');
  assert.equal(results.savedResultFor({ studentId: student.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', examination: 'TERMINAL' }, teacher).status, 'PUBLISHED');
});

test('Save Result enforces school and student identity authorization', () => {
  const { student, results } = setup();
  assert.throws(() => results.saveResult(complete(student), { ...teacher, schoolId: 'school-other' }), /Forbidden/);
  assert.throws(() => results.saveResult({ ...complete(student), permanentStudentId: 'OSAAH-WRONG' }, teacher), /Permanent Student ID does not match/);
  assert.throws(() => results.saveResult(complete(student), { ...teacher, assignedClassIds: ['Primary 2'] }), /outside your assignment/);
});

test('result page exposes functional Save Result controls and backend validation route contract', () => {
  const html = fs.readFileSync(new URL('../public/results.html', import.meta.url), 'utf8');
  const client = fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8');
  assert.match(client, /api\('\/api\/academic\/results\/save'/); assert.match(client, /Result saved successfully\./); assert.match(client, /Saving…/); assert.match(client, /attendanceField/); assert.match(html, /result-slip/);
});
