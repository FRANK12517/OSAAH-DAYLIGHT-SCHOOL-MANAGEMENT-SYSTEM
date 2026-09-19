import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gradeForTotal } from '../src/grading.js';
import { createStudentService } from '../src/students.js';
import { createSubjectService } from '../src/subjects.js';
import { createAcademicResultsService } from '../src/academic-results.js';
import { createSampleResultWorkflow } from '../src/sample-result-workflow.js';

const schoolId = 'school-osaah-daylight';
const actor = { id: 'teacher-score', roleKey: 'TEACHER', schoolId, assignedClassIds: ['JHS 1', 'Primary 1'], permissions: new Set(['marks.write', 'results.read', 'results.generate']) };

test('score persistence recomputes total and rejects out-of-range CA or Exam values', () => {
  const students = createStudentService({ schoolId }); const student = students.createStudent({ firstName: 'Ama', surname: 'Score', classId: 'Primary 1', admissionYearId: '2026' }); const subjects = createSubjectService(); const subject = subjects.list({}, actor)[0]; const results = createAcademicResultsService({ schoolId, students, subjects, classes: ['Primary 1'] });
  const saved = results.saveScore({ studentId: student.id, classId: 'Primary 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', caScore: 45, examScore: 35, totalScore: 999 }, actor);
  assert.equal(saved.totalScore, 80); assert.equal(saved.grade, 'A'); assert.throws(() => results.saveScore({ studentId: student.id, classId: 'Primary 1', subjectId: subject.id, academicYear: '2026/2027', term: 'First Term', caScore: 51, examScore: 0 }, actor), /between 0 and 50/);
});

test('JHS terminal grading uses the single authoritative 1–9 scale', () => {
  assert.deepEqual(gradeForTotal(80, { classId: 'JHS 1', examination: 'TERMINAL' }), [1, 'HIGHEST']);
  assert.deepEqual(gradeForTotal(55, { classId: 'JHS 1', examination: 'TERMINAL' }), [4, 'HIGH AVERAGE']);
  assert.deepEqual(gradeForTotal(34, { classId: 'JHS 1', examination: 'TERMINAL' }), [9, 'LOWEST']);
});

test('sample generation seeds deterministic scores for every sample student in a configured class', () => {
  const students = createStudentService({ schoolId }); const roster = students.seedSampleStudents().filter((student) => student.classId === 'Primary 1'); const subjects = createSubjectService(); const results = createAcademicResultsService({ schoolId, students, subjects, classes: ['Primary 1'] }); const workflow = createSampleResultWorkflow({ students, subjects, academicResults: results, schoolId });
  workflow.generate({ studentId: roster[0].id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }, actor);
  for (const sample of roster) { const report = results.result({ studentId: sample.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term', sample: true }, actor); assert.ok(report.subjects.length > 0); assert.ok(report.subjects.every((row) => row.isTestRecord && row.totalScore === row.caScore + row.examScore)); }
});

test('Score Entry exposes complete columns, immediate grade calculation, and debounced autosave states', () => {
  const html = fs.readFileSync(new URL('../public/examinations.html', import.meta.url), 'utf8'); const js = fs.readFileSync(new URL('../public/score-entry.js', import.meta.url), 'utf8');
  for (const header of ['OSAAH STUDENT INDEX', 'STUDENT NAME', 'CA / 50', 'Exam / 50', 'TOTAL', 'GRADE', 'SAVE STATUS']) assert.match(html, new RegExp(header));
  assert.match(js, /setTimeout\(\(\) => save/); assert.match(js, /Saving/); assert.match(js, /Saved/); assert.match(js, /Error saving/); assert.match(js, /totalCell\.textContent/); assert.match(js, /gradeCell\.textContent/); assert.match(js, /min="0" max="50"/);
});

test('generated results include every active subject configured for the selected class', () => {
  const students = createStudentService({ schoolId }); const student = students.createStudent({ firstName: 'Full', surname: 'Subject', classId: 'Primary 1', admissionYearId: '2026' }); const subjects = createSubjectService(); const configured = subjects.list({ classId: 'Primary 1' }, actor); const results = createAcademicResultsService({ schoolId, students, subjects, classes: ['Primary 1'] });
  results.saveScore({ studentId: student.id, classId: 'Primary 1', subjectId: configured[0].id, academicYear: '2026/2027', term: 'First Term', caScore: 40, examScore: 40 }, actor);
  const result = results.result({ studentId: student.id, classId: 'Primary 1', academicYear: '2026/2027', term: 'First Term' }, actor);
  assert.deepEqual(result.subjects.map((row) => row.subjectId).sort(), configured.map((subject) => subject.id).sort());
});
