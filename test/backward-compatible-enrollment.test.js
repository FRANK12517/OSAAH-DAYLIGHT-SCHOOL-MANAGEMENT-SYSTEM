import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdmissionEnrollmentService } from '../src/admission-enrollment.js';

function serviceFor(row) {
  return createAdmissionEnrollmentService({
    database: {
      transaction: async () => { throw new Error('not used'); },
      query: async (sql, params = []) => {
        if (!sql.includes('FROM parent_student_links')) return [];
        if (!row || params[4] !== 'year-2026' || params[5] !== 'class-1') return [];
        return [row];
      }
    }
  });
}

const scope = {
  parentUserId: 'parent-1', schoolId: 'school-1', permanentStudentId: 'OSAAH/2026/0001',
  academicYearId: 'year-2026', termId: 'term-1', termName: '1st Term', classId: 'class-1'
};

test('explicit-term enrollment authorizes the matching Parent academic context', async () => {
  const service = serviceFor({ classId: 'class-1', termId: 'term-1' });
  assert.equal(await service.parentEnrolledInClass(scope), true);
  assert.equal(await service.parentEnrolledInClass({ ...scope, termId: 'term-2' }), false);
});

test('legacy NULL-term enrollment authorizes Student Summary only at the same year/class scope', async () => {
  const service = serviceFor({ classId: 'class-1', termId: null });
  assert.equal(await service.parentEnrolledInClass(scope), true);
  assert.equal(await service.parentEnrolledInClass({ ...scope, classId: 'class-2' }), false);
  assert.equal(await service.parentEnrolledInClass({ ...scope, academicYearId: 'year-2027' }), false);
});

test('legacy NULL-term enrollment cannot authorize arbitrary term records without evidence', async () => {
  const service = serviceFor({ classId: 'class-1', termId: null });
  assert.equal(await service.parentEnrolledInClass({ ...scope, recordType: 'attendance' }), false);
  assert.equal(await service.parentEnrolledInClass({ ...scope, recordType: 'attendance', legacyTermEvidence: async () => true }), true);
});

test('legacy NULL-term evidence is scoped to the requested record context', async () => {
  const service = serviceFor({ classId: 'class-1', termId: null });
  let seen;
  const result = await service.parentEnrolledInClass({ ...scope, recordType: 'fees', legacyTermEvidence: async (input) => { seen = input; return input.termId === 'term-1' && input.classId === 'class-1'; } });
  assert.equal(result, true);
  assert.equal(seen.academicYearId, 'year-2026');
  assert.equal(seen.termName, '1st Term');
});
