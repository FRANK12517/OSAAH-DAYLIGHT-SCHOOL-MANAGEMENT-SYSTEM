import test from 'node:test';
import assert from 'node:assert/strict';
import { formatFeeAmountFromMinorUnits, formatPublishedDateTime, latestPublishedFeeSummary } from '../public/fee-publication-summary.js';

test('published fee summary groups persisted obligations and chooses the latest publication time', () => {
  const summary = latestPublishedFeeSummary([
    { fee_structure_id: 'fee-1', fee_type_name: 'Admission Fee', academic_year_id: 'year-2026', academic_year_name: '2026/2027 Academic Year', term_id: 'term-1', term_name: '1st Term', applicability_type: 'WHOLE_SCHOOL', amount_minor: 19000, status: 'PUBLISHED', published_at: '2026-10-10 10:00:00' },
    { fee_structure_id: 'fee-1', fee_type_name: 'Admission Fee', academic_year_id: 'year-2026', academic_year_name: '2026/2027 Academic Year', term_id: 'term-1', term_name: '1st Term', applicability_type: 'WHOLE_SCHOOL', amount_minor: 19000, status: 'PUBLISHED', published_at: '2026-10-10 10:01:00' },
    { fee_structure_id: 'fee-2', academic_year_id: '2026/2027', term_id: '1st Term', applicability_type: 'WHOLE_SCHOOL', amount_minor: 9000, status: 'DRAFT', published_at: '2026-10-11 10:00:00' }
  ]);
  assert.equal(summary.feeType, 'Admission Fee');
  assert.equal(summary.academicYearName, '2026/2027 Academic Year');
  assert.equal(summary.termName, '1st Term');
  assert.equal(summary.amountMinor, 19000);
  assert.equal(summary.studentCount, 2);
  assert.equal(summary.publishedAt, '2026-10-10 10:01:00');
});

test('published fee summary formats Ghana cedi and stored timestamps for Ghana', () => {
  assert.equal(formatFeeAmountFromMinorUnits(19000), 'GH₵ 190.00');
  assert.deepEqual(formatPublishedDateTime('2026-11-12 10:00:00'), { date: '12 Nov 2026', time: '10:00 am' });
});
