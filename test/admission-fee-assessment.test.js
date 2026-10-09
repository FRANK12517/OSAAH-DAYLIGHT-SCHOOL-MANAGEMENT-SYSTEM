import assert from 'node:assert/strict';
import test from 'node:test';
import { assessAdmissionFees } from '../src/admission-fee-assessment.js';

test('admission fee assessment uses only matching published Fee Setup structures and never implies payment', () => {
  const structures = [
    { id: 'admission-1', schoolId: 'school-1', type: 'ADMISSION', amount: 125, status: 'PUBLISHED', classId: 'class-1', academicYearId: 'year-1', termId: 'term-1' },
    { id: 'draft', schoolId: 'school-1', type: 'ADMISSION', amount: 50, status: 'DRAFT', classId: 'class-1' },
    { id: 'tuition', schoolId: 'school-1', type: 'TUITION', amount: 500, status: 'PUBLISHED', classId: 'class-1' },
    { id: 'other-class', schoolId: 'school-1', type: 'ADMISSION', amount: 25, status: 'PUBLISHED', classId: 'class-2' },
    { id: 'other-school', schoolId: 'school-2', type: 'ADMISSION', amount: 25, status: 'PUBLISHED', classId: 'class-1' }
  ];
  const assessment = assessAdmissionFees({ structures, schoolId: 'school-1', classId: 'class-1', academicYearId: 'year-1', termId: 'term-1', assessedAt: '2026-10-09T00:00:00.000Z' });
  assert.equal(assessment.total, 125);
  assert.equal(assessment.status, 'ASSESSED');
  assert.equal(assessment.paymentStatus, 'NOT_PAID');
  assert.deepEqual(assessment.items.map((item) => item.feeStructureId), ['admission-1']);
});

test('missing admission fees is represented as a zero assessment rather than a payment', () => {
  const assessment = assessAdmissionFees({ structures: [], schoolId: 'school-1', classId: 'class-1', academicYearId: 'year-1', termId: 'term-1' });
  assert.equal(assessment.total, 0);
  assert.deepEqual(assessment.items, []);
  assert.equal(assessment.paymentStatus, 'NOT_PAID');
});
