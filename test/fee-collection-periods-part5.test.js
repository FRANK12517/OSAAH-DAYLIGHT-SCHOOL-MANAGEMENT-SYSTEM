import test from 'node:test';
import assert from 'node:assert/strict';
import { createFeeCollections, EXTRA_CLASSES_PERIODS, CANTEEN_PERIODS } from '../src/fee-collections.js';
import { createFeeCollectionsRepository } from '../src/fee-collections-repository.js';

const actor = { id: 'accountant-1', schoolId: 'school-a', roleKey: 'ACCOUNTANT_BURSAR', permissions: new Set(['*']) };

test('Extra Classes accepts all three terms and Vacation Classes, while Canteen does not', () => {
  const service = createFeeCollections({ schoolId: 'school-a' });
  for (const [index, period] of EXTRA_CLASSES_PERIODS.entries()) service.recordCollection({ collectionType: 'EXTRA_CLASS', collectionDate: `2026-09-${String(index + 1).padStart(2, '0')}`, collectionPeriod: period, amountReceivedMinor: 100 }, actor);
  assert.deepEqual(service.listCollections(actor, 'EXTRA_CLASS').map(row => row.collectionPeriod), EXTRA_CLASSES_PERIODS);
  assert.deepEqual(CANTEEN_PERIODS, ['1st Term', '2nd Term', '3rd Term']);
  assert.throws(() => service.recordCollection({ collectionType: 'CANTEEN', collectionDate: '2026-09-10', collectionPeriod: 'Vacation Classes', amountReceivedMinor: 100 }, actor), /Canteen collections support only/);
});

test('collection records retain period, academic year, class, date, and amount', () => {
  const service = createFeeCollections({ schoolId: 'school-a' });
  const row = service.recordCollection({ collectionType: 'EXTRA_CLASS', collectionDate: '2026-09-10', collectionPeriod: 'Vacation Classes', academicYearId: 'year-1', classId: 'class-1', amountReceivedMinor: 1250 }, actor);
  assert.equal(row.collectionPeriod, 'Vacation Classes');
  assert.equal(row.academicYearId, 'year-1');
  assert.equal(row.classId, 'class-1');
  assert.equal(row.collectionDate, '2026-09-10');
  assert.equal(row.amountReceivedMinor, 1250);
  assert.equal(service.listCollections(actor, 'EXTRA_CLASS')[0].collectionPeriod, 'Vacation Classes');
});

test('durable collection repository persists and reports collection periods', async () => {
  const rows = [];
  const adapter = {
    async execute(sql, params) { if (sql.startsWith('INSERT INTO fee_collection_records')) rows.push({ school_id: params[1], collection_type: params[2], class_id: params[3], collection_date: params[4], amount_received_minor: params[6], academic_year_id: params[9], term_id: params[10], collection_period: params[11] }); },
    async query(sql, params) { return rows.filter(row => row.school_id === params[0]); },
    async transaction(work) { return work(this); }
  };
  const repository = createFeeCollectionsRepository({ adapter });
  await repository.createCollection({ collectionType: 'EXTRA_CLASS', collectionDate: '2026-09-10', academicYearId: 'year-1', termId: 'Vacation Classes', collectionPeriod: 'Vacation Classes', classId: 'class-1', amountReceivedMinor: 1250 }, actor);
  await repository.createCollection({ collectionType: 'CANTEEN', collectionDate: '2026-09-11', academicYearId: 'year-1', termId: '1st Term', collectionPeriod: '1st Term', amountReceivedMinor: 500 }, actor);
  await assert.rejects(() => repository.createCollection({ collectionType: 'CANTEEN', collectionDate: '2026-09-12', collectionPeriod: 'Vacation Classes', amountReceivedMinor: 500 }, actor), /Canteen collections support only/);
  const reloaded = await repository.listCollections({ collection_type: 'EXTRA_CLASS', collection_period: 'Vacation Classes' }, actor);
  assert.equal(reloaded.length, 1);
  const report = await repository.aggregateCollections({ collection_type: 'EXTRA_CLASS', collection_period: 'Vacation Classes' }, actor);
  assert.equal(report.totalCollectedMinor, 1250);
  assert.equal(report.collection_period_breakdown[0].collection_period, 'Vacation Classes');
});
