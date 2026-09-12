import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudentService } from '../src/students.js';
import { createAcademicResultsService } from '../src/academic-results.js';
import { createTranscriptService } from '../src/transcripts.js';

const manager = { id: 'head', schoolId: 'school-osaah-daylight', roleKey: 'HEADTEACHER', permissions: new Set(['*']) };
test('published transcript snapshots are immutable and verifiable', async () => {
  const students = createStudentService({ now: () => '2026-09-01T00:00:00.000Z' });
  const student = students.createStudent({ firstName: 'Ama', surname: 'Mensah', admissionDate: '2026-09-01', classId: 'Primary 4' });
  const subjects = { get: (id) => ({ id, active: true, classIds: ['Primary 4'] }) };
  const results = createAcademicResultsService({ students, subjects });
  const teacher = { ...manager, roleKey: 'TEACHER', permissions: new Set(['marks.write', 'results.read']), assignedClassIds: ['Primary 4'] };
  results.saveScore({ studentId: student.id, classId: 'Primary 4', subjectId: 'math', academicYear: '2026', term: 'TERM_1', caScore: 40, examScore: 45 }, teacher);
  results.publishResults({ classId: 'Primary 4', academicYear: '2026', term: 'TERM_1' }, manager);
  const transcripts = createTranscriptService({ students, academicResults: results, schoolProfile: { name: 'OSAAH DAYLIGHT SCHOOL COMPLEX' } });
  const draft = transcripts.generate({ permanentStudentId: student.permanentStudentId, academicYears: ['2026'] }, manager);
  const published = transcripts.publish(draft.id, manager);
  assert.equal(published.version.status, 'PUBLISHED');
  const verified = transcripts.verify(published.transcriptReference, published.version.verificationToken);
  assert.equal(verified.status, 'VALID');
  const parent = { id: 'parent', schoolId: manager.schoolId, portal: 'parent', roleKey: 'PARENT', children: [{ id: student.id }] };
  assert.equal(transcripts.getForStudent(student.permanentStudentId, parent).version.versionNumber, 1);
  assert.equal((await transcripts.pdf(published.id, 1, parent)).content.subarray(0, 4).toString(), '%PDF');
  const v2 = transcripts.generate({ permanentStudentId: student.permanentStudentId, academicYears: ['2026'], regenerationReason: 'Correction' }, manager);
  assert.equal(v2.version.versionNumber, 2);
  assert.equal(transcripts.verify(published.transcriptReference, published.version.verificationToken).status, 'VALID');
});

test('unknown transcript verification is not found and unrelated parent is denied', () => {
  const students = createStudentService();
  const transcripts = createTranscriptService({ students, academicResults: { publicationFor: () => null } });
  assert.equal(transcripts.verify('OSAAH/TR/2026/000001', 'bad').status, 'NOT FOUND');
  assert.throws(() => transcripts.getForStudent('OSAAH/2026/9999', { portal: 'parent', children: [] }), /Forbidden/);
});
