import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStudentService } from '../src/students.js';
import { createSubjectService } from '../src/subjects.js';
import { createAcademicResultsService } from '../src/academic-results.js';

test('JHS mock accepts Total/100 only and uses canonical grade boundaries', () => {
  const students = createStudentService(); const subjects = createSubjectService(); const results = createAcademicResultsService({ students, subjects });
  const teacher = { id: 'teacher', roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', assignedClassIds: ['JHS 3'], permissions: new Set(['mock.scores.write', 'mock.scores.read']) };
  const student = students.createStudent({ firstName: 'Ama', surname: 'Mock', classId: 'JHS 3', admissionYearId: '2026' });
  const english = subjects.list({ classId: 'JHS 3' }, teacher).find((item) => item.name === 'English Language');
  const saved = results.saveMockScore({ studentId: student.id, classId: 'JHS 3', subjectId: english.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', totalScore: 75 }, teacher);
  assert.equal(saved.totalScore, 75); assert.equal(saved.grade, 2); assert.equal(saved.caScore, null); assert.equal(saved.examScore, null);
  assert.throws(() => results.saveMockScore({ studentId: student.id, classId: 'JHS 3', subjectId: english.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', caScore: 30, examScore: 40 }, teacher), /Total Score \/ 100 only/);
  assert.throws(() => results.saveMockScore({ studentId: student.id, classId: 'JHS 3', subjectId: english.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', totalScore: 101 }, teacher), /between 0 and 100/);
});

test('mock subject positions, JHS best-six aggregate, and class positions are cohort-scoped', () => {
  const students = createStudentService(); const subjects = createSubjectService(); const results = createAcademicResultsService({ students, subjects });
  const teacher = { id: 'teacher', roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', assignedClassIds: ['JHS 3'], permissions: new Set(['mock.scores.write', 'mock.scores.read']) };
  const a = students.createStudent({ firstName: 'Ama', surname: 'A', classId: 'JHS 3', admissionYearId: '2026' }); const b = students.createStudent({ firstName: 'Kojo', surname: 'B', classId: 'JHS 3', admissionYearId: '2026' });
  const chosen = ['English Language', 'Mathematics', 'Science', 'Social Studies', 'Religious and Moral Education', 'Creative Arts']; const records = subjects.list({ classId: 'JHS 3' }, teacher); const score = (name, student) => student === a ? ({ 'English Language': 75, Mathematics: 80, Science: 70, 'Social Studies': 65, 'Religious and Moral Education': 90, 'Creative Arts': 85 }[name]) : 50;
  for (const student of [a, b]) for (const name of chosen) { const subject = records.find((item) => item.name === name); results.saveMockScore({ studentId: student.id, classId: 'JHS 3', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', totalScore: score(name, student) }, teacher); }
  const reportA = results.result({ studentId: a.id, classId: 'JHS 3', academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock' }, teacher, { mock: true }); const reportB = results.result({ studentId: b.id, classId: 'JHS 3', academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock' }, teacher, { mock: true });
  assert.equal(reportA.resultType, 'MOCK'); assert.equal(reportA.aggregate, 10); assert.equal(reportA.aggregateSubjects.length, 6); assert.equal(reportA.subjects.find((row) => row.subjectName === 'English Language').subjectPosition, '1st'); assert.equal(reportB.classPosition, '2nd'); assert.equal(reportA.classPosition, '1st'); assert.equal(reportA.subjects.find((row) => row.subjectName === 'English Language').grade, 2);
});

test('sample and production mock cohorts never rank together', () => {
  const students = createStudentService(); const subjects = createSubjectService(); const results = createAcademicResultsService({ students, subjects });
  const teacher = { id: 'teacher', roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', assignedClassIds: ['JHS 3'], permissions: new Set(['mock.scores.write', 'mock.scores.read', 'mock.results.read']) };
  const real = students.createStudent({ firstName: 'Real', surname: 'Student', classId: 'JHS 3', admissionYearId: '2026' }); const sample = students.seedSampleStudents().find((item) => item.classId === 'JHS 3'); const english = subjects.list({ classId: 'JHS 3' }, teacher).find((item) => item.name === 'English Language');
  for (const student of [real, sample]) results.saveMockScore({ studentId: student.id, classId: 'JHS 3', subjectId: english.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', totalScore: student === real ? 40 : 99 }, teacher);
  const report = results.result({ studentId: real.id, classId: 'JHS 3', academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock' }, teacher, { mock: true }); assert.equal(report.classPosition, '1st'); assert.equal(report.isSample, false);
  const rows = results.broadsheet({ classId: 'JHS 3', academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock' }, teacher, { mock: true }); assert.equal(rows.length, 1); assert.equal(rows[0].permanentStudentId, real.permanentStudentId); assert.equal(rows[0].isSample, false);
});

test('mock UI and renderer contain Total/100-only contract and preserve non-score sections', () => {
  const page = fs.readFileSync(new URL('../public/mock-examinations.html', import.meta.url), 'utf8'); const client = fs.readFileSync(new URL('../public/mock-score-entry.js', import.meta.url), 'utf8'); const renderer = fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8'); const broadsheet = fs.readFileSync(new URL('../public/mock-broadsheet.html', import.meta.url), 'utf8') + fs.readFileSync(new URL('../public/mock-broadsheet.js', import.meta.url), 'utf8');
  assert.match(page, /TOTAL SCORE \/ 100/); assert.doesNotMatch(page, /CA \/ 50/); assert.doesNotMatch(page, /Exam \/ 50/); assert.match(client, /totalScore/); assert.match(client, /grade/); assert.match(renderer, /x\.resultType === 'MOCK'/); assert.match(renderer, /GES Teacher Assessment/); assert.match(renderer, /Attendance/); assert.match(renderer, /signatureBlock/); assert.match(renderer, /Grade.*Subject Position/); assert.match(broadsheet, /TOTAL SCORE/); assert.match(broadsheet, /AGGREGATE/); assert.match(broadsheet, /CLASS POSITION/);
});


test('mock results use the existing complete Save then Publish lifecycle', () => {
  const students = createStudentService(); const subjects = createSubjectService(); const results = createAcademicResultsService({ students, subjects });
  const teacher = { id: 'teacher', roleKey: 'TEACHER', schoolId: 'school-osaah-daylight', assignedClassIds: ['JHS 3'], permissions: new Set(['mock.scores.write', 'mock.scores.read', 'mock.results.read', 'results.write', 'results.publish']) };
  const student = students.createStudent({ firstName: 'Lifecycle', surname: 'Mock', classId: 'JHS 3', admissionYearId: '2026' }); const subject = subjects.list({ classId: 'JHS 3' }, teacher)[0];
  results.saveMockScore({ studentId: student.id, classId: 'JHS 3', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', mockLabel: '1st Mock', totalScore: 75 }, teacher);
  const saved = results.saveResult({ studentId: student.id, permanentStudentId: student.permanentStudentId, classId: 'JHS 3', academicYear: '2026/2027', term: 'First Term', examination: 'MOCK', attendance: { timesPresent: 10, timesAbsent: 0, totalSchoolDays: 10 }, assessment: { conduct: 'Good', attitude: 'Good', interest: 'Good', classTeacherRemarks: 'Good progress', headteacherRemarks: 'Approved' } }, teacher);
  assert.equal(saved.status, 'SAVED'); const published = results.publishResults({ studentId: student.id, classId: 'JHS 3', academicYear: '2026/2027', term: 'First Term', examination: 'MOCK', expectedVersion: saved.version, attendance: saved.attendance, assessment: saved.assessment }, teacher); assert.equal(published.status, 'PUBLISHED');
});
