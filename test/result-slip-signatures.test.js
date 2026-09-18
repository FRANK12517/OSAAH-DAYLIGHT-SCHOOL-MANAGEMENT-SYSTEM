import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createStudentService } from '../src/students.js';
import { createStaffService } from '../src/staff.js';
import { createSignatureService } from '../src/signatures.js';
import { createSubjectService } from '../src/subjects.js';
import { createAcademicResultsService } from '../src/academic-results.js';
import { averageScore } from '../src/result-slip.js';

const manager = { id: 'head-1', roleKey: 'HEADTEACHER', schoolId: 'school-osaah-daylight', permissions: new Set(['*']) };

test('result signatures resolve to the assigned class teacher and school headteacher only', () => {
  const students = createStudentService();
  const staff = createStaffService();
  const teacherA = staff.createProfile({ fullName: 'Teacher A', roleKey: 'TEACHER' });
  const teacherB = staff.createProfile({ fullName: 'Teacher B', roleKey: 'TEACHER' });
  const head = staff.createProfile({ fullName: 'Headteacher One', roleKey: 'HEADTEACHER' });
  staff.assign(teacherA.id, { classId: 'Primary 1', academicYearId: '2026/2027', termId: 'First Term' });
  staff.assign(teacherB.id, { classId: 'Primary 2', academicYearId: '2026/2027', termId: 'First Term' });
  const student = students.createStudent({ firstName: 'Ama', surname: 'One', classId: 'Primary 1', admissionYearId: '2026' });
  const signatures = createSignatureService({ staff });
  signatures.upload({ signatoryRole: 'CLASS_TEACHER', classId: 'Primary 1', teacherId: teacherA.id, academicYear: '2026/2027', term: 'First Term', mimeType: 'image/png', size: 10, storageKey: 'signatures/a.png' }, manager);
  signatures.upload({ signatoryRole: 'CLASS_TEACHER', classId: 'Primary 2', teacherId: teacherB.id, academicYear: '2026/2027', term: 'First Term', mimeType: 'image/png', size: 10, storageKey: 'signatures/b.png' }, manager);
  signatures.upload({ signatoryRole: 'HEADTEACHER', academicYear: '2026/2027', term: 'First Term', mimeType: 'image/png', size: 10, storageKey: 'signatures/head.png' }, manager);
  const resolved = signatures.resolveForStudent(student, { academicYear: '2026/2027', term: 'First Term' });
  assert.equal(resolved.classTeacher.name, 'Teacher A');
  assert.equal(resolved.classTeacher.signature.storageKey, 'signatures/a.png');
  assert.equal(resolved.headteacher.name, head.fullName);
  assert.equal(resolved.headteacher.signature.storageKey, 'signatures/head.png');
  assert.notEqual(resolved.classTeacher.signature.storageKey, 'signatures/b.png');
});

test('missing signatures are non-blocking and cross-school signatures do not resolve', () => {
  const students = createStudentService();
  const staff = createStaffService();
  const teacher = staff.createProfile({ fullName: 'Teacher A', roleKey: 'TEACHER' });
  staff.assign(teacher.id, { classId: 'Primary 1', academicYearId: '2026/2027', termId: 'First Term' });
  const student = students.createStudent({ firstName: 'Ama', surname: 'One', classId: 'Primary 1', admissionYearId: '2026' });
  const signatures = createSignatureService({ staff });
  const resolved = signatures.resolveForStudent(student, { academicYear: '2026/2027', term: 'First Term' });
  assert.equal(resolved.classTeacher.name, 'Teacher A');
  assert.equal(resolved.classTeacher.signature, null);
  assert.equal(resolved.headteacher.signature, null);
  const otherSchool = createSignatureService({ staff, schoolId: 'school-other' });
  assert.equal(otherSchool.activeFor('HEADTEACHER', { academicYear: '2026/2027', term: 'First Term' }), null);
});

test('signature renderer keeps both roles below attendance inside the single bordered slip and protects image sources', () => {
  const html = fs.readFileSync(new URL('../public/results.html', import.meta.url), 'utf8');
  const renderer = fs.readFileSync(new URL('../public/result-view.js', import.meta.url), 'utf8');
  assert.ok(renderer.indexOf('Attendance') < renderer.indexOf('signature-grid'));
  assert.match(renderer, /signatureBlock\('CLASS_TEACHER'/);
  assert.match(renderer, /signatureBlock\('HEADTEACHER'/);
  assert.match(renderer, /Signature not uploaded/);
  assert.match(renderer, /function signatureSrc/);
  assert.match(html, /\.signature-grid\{[^}]*grid-template-columns:1fr 1fr[^}]*break-inside:avoid/);
  assert.match(html, /\.result-slip::after\{[^}]*border:2px solid #d4a72c/);
});

test('signature integration leaves result calculations unchanged', () => {
  const students = createStudentService();
  const subjects = createSubjectService();
  const results = createAcademicResultsService({ students, subjects });
  assert.equal(averageScore([{ subjectId: 'Math', totalScore: 80 }, { subjectId: 'English', totalScore: 60 }]), 70);
  assert.equal(typeof results.result, 'function');
});
