import test from 'node:test';
import assert from 'node:assert/strict';
import { createParentDashboardService } from '../src/parent-dashboard.js';
import { createParentHistoricalRecordsService } from '../src/parent-historical-records.js';

const child = {
  id: 'student-1',
  studentId: 'student-1',
  studentProfileId: 'profile-1',
  permanentStudentId: 'OSAAH/2024/0123',
  firstName: 'Ama',
  lastName: 'Mensah',
  schoolId: 'school-1',
  classId: 'class-jhs-3',
  className: 'JHS 3',
  isTestRecord: false
};
const actor = {
  id: 'parent-1',
  portal: 'parent',
  roleKey: 'PARENT',
  schoolId: 'school-1',
  permissions: new Set(['children.read'])
};

function durableAcademic() {
  return {
    async options() {
      return {
        academicYears: [{ id: 'year-2024', name: '2024/2025' }, { id: 'year-2026', name: '2026/2027', isCurrent: true }],
        terms: [{ id: 'term-1', name: '1st Term', academicYearId: 'year-2024' }, { id: 'term-current', name: '1st Term', academicYearId: 'year-2026', isCurrent: true }],
        classes: [{ id: 'class-jhs-3', name: 'JHS 3' }]
      };
    }
  };
}

function parentDashboard(historicalRecords, authorize = async () => child) {
  return createParentDashboardService({
    students: {},
    admissionEnrollment: { authorizeParentStudent: authorize },
    durableAcademic: durableAcademic(),
    historicalRecords,
    cards: []
  });
}

test('historical contexts are exact stored enrollment tuples and remain scoped to the active linked Parent child', async () => {
  let captured;
  const database = {
    async query(sql, params) {
      captured = { sql, params };
      return [
        { academicYearId: 'year-2024', academicYearName: '2024/2025', termId: 'term-1', termName: '1st Term', classId: 'class-jhs-3', className: 'JHS 3' },
        { academicYearId: 'year-2024', academicYearName: '2024/2025', termId: 'term-1', termName: '1st Term', classId: 'class-jhs-3', className: 'JHS 3' },
        { academicYearId: null, academicYearName: null, termId: null, termName: null, classId: 'unscoped-class', className: 'Unknown' }
      ];
    }
  };
  const service = createParentHistoricalRecordsService({ database });
  const result = await service.listHistoricalContexts(actor, child);
  assert.deepEqual(result, [{
    academicYearId: 'year-2024', academicYearName: '2024/2025',
    termId: 'term-1', termName: '1st Term', classId: 'class-jhs-3', className: 'JHS 3'
  }]);
  assert.deepEqual(captured.params, ['school-1', 'parent-1', 'school-1', child.permanentStudentId]);
  assert.match(captured.sql, /psl\.link_status='ACTIVE'/);
  assert.match(captured.sql, /psl\.parent_user_id=\?/);
  assert.match(captured.sql, /s\.school_id=\?/);
  assert.match(captured.sql, /s\.permanent_student_id=\?/);
  assert.match(captured.sql, /COALESCE\(s\.is_test_record,0\)=0/);
  assert.match(captured.sql, /student_enrollments/);
  assert.doesNotMatch(captured.sql, /is_current\s*=\s*1/i);
});

test('promotion history exposes only stored canonical decision, academic year, and decision date', async () => {
  let capturedSql = '';
  const service = createParentHistoricalRecordsService({ database: {
    async query(sql, params) {
      capturedSql = sql;
      assert.deepEqual(params, ['school-1', 'parent-1', 'school-1', child.permanentStudentId]);
      return [{ id: 'decision-1', academicYearId: 'year-2024', academicYearName: '2024/2025', decision: 'REPEAT', decisionDate: '2025-06-01T12:00:00Z' }];
    }
  } });
  const records = await service.listPromotionHistory(actor, child);
  assert.deepEqual(records, [{ academicYearId: 'year-2024', academicYearName: '2024/2025', decision: 'REPEAT', decisionDate: '2025-06-01T12:00:00Z' }]);
  assert.match(capturedSql, /promotion_decisions/);
  assert.match(capturedSql, /pd\.decision/);
  assert.match(capturedSql, /pd\.decided_at/);
  assert.match(capturedSql, /psl\.link_status='ACTIVE'/);
  assert.doesNotMatch(capturedSql, /toClass|promotedTo|class_id/i);
});

test('completed archive returns only explicit completion status or completed enrollment markers', async () => {
  const service = createParentHistoricalRecordsService({ database: {
    async query(sql, params) {
      assert.deepEqual(params, ['school-1', 'parent-1', 'school-1', child.permanentStudentId]);
      assert.match(sql, /student_status/);
      assert.match(sql, /enrollment_status/);
      return [
        { studentStatus: 'COMPLETED', academicYearId: 'year-2024', academicYearName: '2024/2025', termId: 'term-1', termName: '1st Term', classId: 'class-jhs-3', className: 'JHS 3', enrollmentStatus: 'COMPLETED' },
        { studentStatus: 'ACTIVE', enrollmentStatus: 'ACTIVE' }
      ];
    }
  } });
  assert.deepEqual(await service.listCompletedRecords(actor, child), [{
    status: 'COMPLETED', academicYearId: 'year-2024', academicYearName: '2024/2025',
    termId: 'term-1', termName: '1st Term', classId: 'class-jhs-3', className: 'JHS 3', completedAt: null
  }]);
});

test('historical database failures propagate instead of becoming empty success responses', async () => {
  const failure = new Error('database unavailable');
  const service = createParentHistoricalRecordsService({ database: { query: async () => { throw failure; } } });
  await assert.rejects(service.listHistoricalContexts(actor, child), (error) => error === failure);
});

test('historical database service rejects non-Parent actors and missing child identity', async () => {
  const service = createParentHistoricalRecordsService({ database: { query: async () => [] } });
  await assert.rejects(service.listHistoricalContexts({ ...actor, portal: 'school' }, child), (error) => error.status === 403);
  await assert.rejects(service.listPromotionHistory(actor, { ...child, permanentStudentId: '' }), (error) => error.status === 403);
});

test('Parent records exposes only configured historical record types after resolving the authorized child', async () => {
  const called = [];
  const historicalRecords = {
    async listHistoricalContexts(requestActor, requestChild) { called.push(['contexts', requestActor.id, requestChild.permanentStudentId]); return [{ academicYearId: 'year-2024', termId: 'term-1', classId: 'class-jhs-3' }]; },
    async listPromotionHistory(requestActor, requestChild) { called.push(['promotion', requestActor.id, requestChild.permanentStudentId]); return [{ decision: 'REPEAT' }]; },
    async listCompletedRecords(requestActor, requestChild) { called.push(['completion', requestActor.id, requestChild.permanentStudentId]); return [{ status: 'COMPLETED', className: 'JHS 3' }]; }
  };
  const dashboard = parentDashboard(historicalRecords);
  const options = await dashboard.options(actor);
  assert.deepEqual(options.recordTypes.filter((item) => item.id.includes('historical') || item.id === 'promotion-history' || item.id === 'completed-records').map((item) => item.id), ['historical-contexts', 'promotion-history', 'completed-records']);
  const contexts = await dashboard.loadRecord(actor, { permanentStudentId: child.permanentStudentId, recordType: 'historical-contexts' });
  const promotions = await dashboard.loadRecord(actor, { permanentStudentId: child.permanentStudentId, recordType: 'promotion-history' });
  const completed = await dashboard.loadRecord(actor, { permanentStudentId: child.permanentStudentId, recordType: 'completed-records' });
  assert.equal(contexts.contexts[0].classId, 'class-jhs-3');
  assert.equal(promotions.records[0].decision, 'REPEAT');
  assert.equal('toClassId' in promotions.records[0], false);
  assert.equal(completed.records[0].status, 'COMPLETED');
  assert.equal(completed.records[0].className, 'JHS 3');
  assert.deepEqual(called, [
    ['contexts', actor.id, child.permanentStudentId],
    ['promotion', actor.id, child.permanentStudentId],
    ['completion', actor.id, child.permanentStudentId]
  ]);
});

test('historical record routes cannot use a fabricated or cross-parent child identifier', async () => {
  let historyCalled = false;
  const dashboard = parentDashboard({
    async listHistoricalContexts() { historyCalled = true; return []; },
    async listPromotionHistory() { historyCalled = true; return []; },
    async listCompletedRecords() { historyCalled = true; return []; }
  }, async ({ permanentStudentId }) => permanentStudentId === child.permanentStudentId ? child : null);
  await assert.rejects(dashboard.loadRecord(actor, { permanentStudentId: 'OSAAH/2024/9999', recordType: 'historical-contexts' }), (error) => error.status === 403 && error.code === 'PARENT_STUDENT_FORBIDDEN');
  assert.equal(historyCalled, false);
});

test('empty historical and promotion history responses remain neutral, while completion needs no next-class enrollment', async () => {
  const dashboard = parentDashboard({
    async listHistoricalContexts() { return []; },
    async listPromotionHistory() { return []; },
    async listCompletedRecords() { return [{ status: 'COMPLETED', className: 'JHS 3', academicYearName: '2024/2025' }]; }
  });
  assert.deepEqual((await dashboard.loadRecord(actor, { permanentStudentId: child.permanentStudentId, recordType: 'historical-contexts' })).contexts, []);
  assert.deepEqual((await dashboard.loadRecord(actor, { permanentStudentId: child.permanentStudentId, recordType: 'promotion-history' })).records, []);
  const completed = await dashboard.loadRecord(actor, { permanentStudentId: child.permanentStudentId, recordType: 'completed-records' });
  assert.equal(completed.records[0].className, 'JHS 3');
});
